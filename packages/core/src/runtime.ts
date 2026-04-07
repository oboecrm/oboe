import { createEventBus } from "./events.js";
import {
  applySelect,
  defaultDepth,
  matchesWhere,
  paginateDocuments,
  sortRecords,
} from "./query.js";
import { compileSchema, getCompiledCollection } from "./schema.js";
import type {
  CollectionConfig,
  CollectionQuery,
  CollectionValidationContext,
  CountResult,
  DatabaseAdapter,
  EventBus,
  FieldConfig,
  FieldValidationContext,
  GraphQLExecutor,
  InitializedEmailAdapter,
  JobDispatcher,
  JobRequest,
  OboeConfig,
  OboeDocument,
  OboeRecord,
  OboeRuntime,
  SchemaAdapter,
  SchemaParseFailure,
  SchemaParseResult,
  SelectShape,
  SendEmailOptions,
  StandardSchemaIssue,
  StandardSchemaLike,
  StoredFileData,
  UploadConfig,
  UploadInputFile,
  ValidationIssue,
  ValidationIssueResult,
} from "./types.js";
import { OboeEmailError, OboeValidationError } from "./types.js";
import {
  getCollectionFileProxyPath,
  getCollectionServeMode,
  getCollectionStorageAdapter,
} from "./upload-storage.js";

const noopGraphQLExecutor: GraphQLExecutor = {
  async execute() {
    throw new Error("GraphQL executor has not been attached to this runtime.");
  },
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRelationshipField(field: FieldConfig) {
  return field.type === "relation" || field.type === "relationship";
}

function isSchemaAdapter(value: unknown): value is SchemaAdapter {
  return (
    typeof value === "object" &&
    value !== null &&
    "parse" in value &&
    typeof value.parse === "function"
  );
}

function isStandardSchemaLike(value: unknown): value is StandardSchemaLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "~standard" in value &&
    typeof value["~standard"] === "object" &&
    value["~standard"] !== null &&
    "validate" in value["~standard"] &&
    typeof value["~standard"].validate === "function"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return true;
    case "object":
      if (Array.isArray(value)) {
        return value.every((item) => isJsonValue(item));
      }

      return Object.values(value).every((item) => isJsonValue(item));
    default:
      return false;
  }
}

function isMissingValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

function normalizePath(path?: PropertyKey[]) {
  return path ? [...path] : [];
}

function prefixIssuePath(path: PropertyKey[], issue: ValidationIssue) {
  return {
    ...issue,
    path: [...path, ...normalizePath(issue.path)],
  };
}

function normalizeValidationIssue(
  result: Exclude<ValidationIssueResult, ValidationIssue[] | null | undefined>,
  path: PropertyKey[]
): ValidationIssue {
  if (typeof result === "string") {
    return {
      message: result,
      path,
    };
  }

  return prefixIssuePath(path, result);
}

function normalizeValidationIssues(
  result: ValidationIssueResult,
  path: PropertyKey[] = []
): ValidationIssue[] {
  if (!result) {
    return [];
  }

  if (Array.isArray(result)) {
    return result.map((issue) => prefixIssuePath(path, issue));
  }

  return [normalizeValidationIssue(result, path)];
}

function normalizeStandardSchemaPath(
  path?: StandardSchemaIssue["path"]
): PropertyKey[] {
  if (!path) {
    return [];
  }

  return path.reduce<PropertyKey[]>((segments, segment) => {
    if (
      typeof segment === "object" &&
      segment !== null &&
      ("key" in segment || "path" in segment)
    ) {
      const key = segment.key ?? segment.path;
      if (key !== undefined) {
        segments.push(key);
      }

      return segments;
    }

    segments.push(segment as PropertyKey);
    return segments;
  }, []);
}

function normalizeSchemaFailure(
  failure: SchemaParseFailure,
  fallbackPath: PropertyKey[]
): ValidationIssue[] {
  return failure.issues.map((issue) => ({
    message: issue.message,
    path: [...fallbackPath, ...normalizePath(issue.path)],
  }));
}

function normalizeThrownValidationIssues(
  error: unknown,
  fallbackPath: PropertyKey[]
) {
  if (error instanceof OboeValidationError) {
    return error.issues.map((issue) => ({
      message: issue.message,
      path: [...fallbackPath, ...normalizePath(issue.path)],
    }));
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues.flatMap((issue) => {
      if (
        typeof issue === "object" &&
        issue !== null &&
        "message" in issue &&
        typeof issue.message === "string"
      ) {
        return [
          {
            message: issue.message,
            path: [
              ...fallbackPath,
              ...normalizePath(
                "path" in issue && Array.isArray(issue.path)
                  ? (issue.path as PropertyKey[])
                  : undefined
              ),
            ],
          },
        ];
      }

      return [];
    });
  }

  return [
    {
      message: error instanceof Error ? error.message : String(error),
      path: fallbackPath,
    },
  ];
}

async function parseWithSchema<TContext>(args: {
  context: TContext;
  fallbackPath: PropertyKey[];
  schema: SchemaAdapter<TContext> | StandardSchemaLike;
  value: unknown;
}): Promise<{ issues: ValidationIssue[] } | { value: unknown }> {
  let result: SchemaParseResult;

  try {
    if (isSchemaAdapter(args.schema)) {
      result = await args.schema.parse(args.value, args.context);
    } else if (isStandardSchemaLike(args.schema)) {
      const standardResult = await args.schema["~standard"].validate(
        args.value,
        {
          context: args.context,
        }
      );

      result =
        "issues" in standardResult
          ? {
              issues: standardResult.issues.map((issue) => ({
                message: issue.message,
                path: normalizeStandardSchemaPath(issue.path),
              })),
            }
          : {
              value: standardResult.value,
            };
    } else {
      throw new Error("Unsupported schema object passed to validation.");
    }
  } catch (error) {
    return {
      issues: normalizeThrownValidationIssues(error, args.fallbackPath),
    } as const;
  }

  if (result.issues) {
    return {
      issues: normalizeSchemaFailure(result, args.fallbackPath),
    } as const;
  }

  return {
    value: result.value,
  } as const;
}

function builtInFieldIssues(args: {
  collection: CollectionConfig;
  data: Record<string, unknown>;
  db: DatabaseAdapter;
  field: FieldConfig;
}) {
  const path = [args.field.name];
  const value = args.data[args.field.name];

  if (args.field.required && isMissingValue(value)) {
    return [
      {
        message: `Field "${args.collection.slug}.${args.field.name}" is required.`,
        path,
      },
    ];
  }

  if (isMissingValue(value)) {
    return [];
  }

  switch (args.field.type) {
    case "email":
      if (typeof value !== "string" || !EMAIL_PATTERN.test(value)) {
        return [
          {
            message: `Field "${args.collection.slug}.${args.field.name}" must be a valid email address.`,
            path,
          },
        ];
      }
      return [];
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return [
          {
            message: `Field "${args.collection.slug}.${args.field.name}" must be a finite number.`,
            path,
          },
        ];
      }
      return [];
    case "boolean":
      if (typeof value !== "boolean") {
        return [
          {
            message: `Field "${args.collection.slug}.${args.field.name}" must be a boolean.`,
            path,
          },
        ];
      }
      return [];
    case "date":
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        return [
          {
            message: `Field "${args.collection.slug}.${args.field.name}" must be a valid date string.`,
            path,
          },
        ];
      }
      return [];
    case "select":
      if (
        typeof value !== "string" ||
        ((args.field.options?.length ?? 0) > 0 &&
          !args.field.options?.some((option) => option.value === value))
      ) {
        return [
          {
            message: `Field "${args.collection.slug}.${args.field.name}" must match one of the configured options.`,
            path,
          },
        ];
      }
      return [];
    case "json":
      if (!isJsonValue(value)) {
        return [
          {
            message: `Field "${args.collection.slug}.${args.field.name}" must be valid JSON data.`,
            path,
          },
        ];
      }
      return [];
    case "relation":
    case "relationship":
      if (typeof value !== "string") {
        return [
          {
            message: `Relationship field "${args.collection.slug}.${args.field.name}" must be a record id string.`,
            path,
          },
        ];
      }
      if (!args.field.relationTo) {
        return [];
      }
      return [
        {
          message: "__relationship__",
          path,
        },
      ];
    default:
      return [];
  }
}

async function validateRelationshipIssue(args: {
  collection: CollectionConfig;
  db: DatabaseAdapter;
  field: FieldConfig;
  issue: ValidationIssue;
  value: unknown;
}) {
  if (!isRelationshipField(args.field) || !args.field.relationTo) {
    return args.issue;
  }

  if (args.issue.message !== "__relationship__") {
    return args.issue;
  }

  const related = await args.db.findById({
    collection: args.field.relationTo,
    id: String(args.value),
  });

  if (related) {
    return null;
  }

  return {
    message: `Relationship field "${args.collection.slug}.${args.field.name}" refers to missing ${args.field.relationTo} record "${String(args.value)}".`,
    path: args.issue.path,
  };
}

async function runBuiltInFieldValidation(args: {
  candidateData: Record<string, unknown>;
  collection: CollectionConfig;
  db: DatabaseAdapter;
}) {
  const issues: ValidationIssue[] = [];

  for (const field of args.collection.fields) {
    const builtInIssues = builtInFieldIssues({
      collection: args.collection,
      data: args.candidateData,
      db: args.db,
      field,
    });

    for (const issue of builtInIssues) {
      if (issue.message === "__relationship__") {
        const nextIssue = await validateRelationshipIssue({
          collection: args.collection,
          db: args.db,
          field,
          issue,
          value: args.candidateData[field.name],
        });

        if (nextIssue) {
          issues.push(nextIssue);
        }
        continue;
      }

      issues.push(issue);
    }
  }

  return issues;
}

async function runFieldSchemaValidation(args: {
  candidateData: Record<string, unknown>;
  collection: CollectionConfig;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}) {
  const issues: ValidationIssue[] = [];

  for (const field of args.collection.fields) {
    if (!field.schema) {
      continue;
    }

    const context: FieldValidationContext = {
      collection: args.collection,
      data: args.candidateData,
      field,
      operation: args.operation,
      originalDoc: args.originalDoc,
      req: args.req,
      user: args.user,
    };
    const result = await parseWithSchema({
      context,
      fallbackPath: [field.name],
      schema: field.schema,
      value: args.candidateData[field.name],
    });

    if ("issues" in result) {
      issues.push(...result.issues);
      continue;
    }

    args.candidateData[field.name] = result.value;
  }

  return issues;
}

async function runFieldValidatorValidation(args: {
  candidateData: Record<string, unknown>;
  collection: CollectionConfig;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}) {
  const issues: ValidationIssue[] = [];

  for (const field of args.collection.fields) {
    if (!field.validate) {
      continue;
    }

    const context: FieldValidationContext = {
      collection: args.collection,
      data: args.candidateData,
      field,
      operation: args.operation,
      originalDoc: args.originalDoc,
      req: args.req,
      user: args.user,
    };
    let result: ValidationIssueResult;

    try {
      result = await field.validate({
        context,
        value: args.candidateData[field.name],
      });
    } catch (error) {
      issues.push(...normalizeThrownValidationIssues(error, [field.name]));
      continue;
    }

    issues.push(...normalizeValidationIssues(result, [field.name]));
  }

  return issues;
}

async function runCollectionSchemaValidation(args: {
  candidateData: Record<string, unknown>;
  collection: CollectionConfig;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}): Promise<{
  candidateData: Record<string, unknown>;
  issues: ValidationIssue[];
}> {
  if (!args.collection.schema) {
    return {
      candidateData: args.candidateData,
      issues: [],
    };
  }

  const context: CollectionValidationContext = {
    collection: args.collection,
    data: args.candidateData,
    operation: args.operation,
    originalDoc: args.originalDoc,
    req: args.req,
    user: args.user,
  };
  const result = await parseWithSchema({
    context,
    fallbackPath: [],
    schema: args.collection.schema,
    value: args.candidateData,
  });

  if ("issues" in result) {
    return {
      candidateData: args.candidateData,
      issues: result.issues,
    };
  }

  if (!isPlainObject(result.value)) {
    return {
      candidateData: args.candidateData,
      issues: [
        {
          message: `Collection schema for "${args.collection.slug}" must return an object.`,
          path: [],
        },
      ],
    };
  }

  return {
    candidateData: result.value,
    issues: [],
  };
}

async function runCollectionValidatorValidation(args: {
  candidateData: Record<string, unknown>;
  collection: CollectionConfig;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}) {
  if (!args.collection.validate) {
    return [];
  }

  const context: CollectionValidationContext = {
    collection: args.collection,
    data: args.candidateData,
    operation: args.operation,
    originalDoc: args.originalDoc,
    req: args.req,
    user: args.user,
  };
  let result: ValidationIssueResult;

  try {
    result = await args.collection.validate({
      context,
      data: args.candidateData,
    });
  } catch (error) {
    return normalizeThrownValidationIssues(error, []);
  }

  return normalizeValidationIssues(result);
}

function createJobDispatcher(
  db: DatabaseAdapter,
  fallback: JobDispatcher
): JobDispatcher {
  return {
    async enqueue(job) {
      if (db.enqueueJob) {
        await db.enqueueJob(job);
        return;
      }

      await fallback.enqueue(job);
    },
  };
}

async function canAccess(args: {
  collection: CollectionConfig;
  data?: Record<string, unknown>;
  id?: string;
  operation: "create" | "delete" | "read" | "update";
  overrideAccess?: boolean;
  req?: Request;
  user?: unknown;
}) {
  if (args.overrideAccess) {
    return true;
  }

  const resolver = args.collection.access?.[args.operation];

  if (!resolver) {
    return true;
  }

  return resolver({
    action: args.operation,
    collection: args.collection,
    data: args.data,
    id: args.id,
    req: args.req,
    user: args.user,
  });
}

async function runAfterRead(args: {
  collection: CollectionConfig;
  doc: OboeRecord;
  req?: Request;
  user?: unknown;
}) {
  let doc = await attachResolvedFileUrl(args);

  for (const hook of args.collection.hooks?.afterRead ?? []) {
    doc = await hook({
      context: {
        collection: args.collection,
        operation: "read",
        req: args.req,
        user: args.user,
      },
      doc,
    });
  }

  return doc;
}

function getUploadConfig(collection: CollectionConfig): UploadConfig | null {
  if (!collection.upload) {
    return null;
  }

  return typeof collection.upload === "object" ? collection.upload : {};
}

function getStoredFileData(value: unknown): StoredFileData | null {
  if (!isPlainObject(value)) {
    return null;
  }

  if (
    typeof value.filename !== "string" ||
    typeof value.filesize !== "number" ||
    typeof value.mimeType !== "string" ||
    typeof value.storageAdapter !== "string" ||
    typeof value.storageKey !== "string"
  ) {
    return null;
  }

  return {
    filename: value.filename,
    filesize: value.filesize,
    mimeType: value.mimeType,
    prefix: typeof value.prefix === "string" ? value.prefix : undefined,
    providerMetadata: isPlainObject(value.providerMetadata)
      ? value.providerMetadata
      : undefined,
    storageAdapter: value.storageAdapter,
    storageKey: value.storageKey,
    url: typeof value.url === "string" ? value.url : undefined,
  };
}

async function resolveFileUrl(args: {
  collection: CollectionConfig;
  file: StoredFileData;
  id: string;
  req?: Request;
}) {
  if (getCollectionServeMode(args.collection) === "proxy") {
    return getCollectionFileProxyPath({
      collection: args.collection.slug,
      id: args.id,
    });
  }

  if (args.collection.storage?.generateFileURL) {
    return await args.collection.storage.generateFileURL({
      collection: args.collection,
      file: args.file,
      req: args.req,
    });
  }

  const adapter = getCollectionStorageAdapter(args.collection);
  if (adapter.generateURL) {
    return await adapter.generateURL({
      collection: args.collection,
      file: args.file,
      req: args.req,
    });
  }

  return getCollectionFileProxyPath({
    collection: args.collection.slug,
    id: args.id,
  });
}

async function attachResolvedFileUrl(args: {
  collection: CollectionConfig;
  doc: OboeRecord;
  req?: Request;
}) {
  const file = getStoredFileData(args.doc.data.file);
  if (!file) {
    return args.doc;
  }

  return {
    ...args.doc,
    data: {
      ...args.doc.data,
      file: {
        ...file,
        url: await resolveFileUrl({
          collection: args.collection,
          file,
          id: args.doc.id,
          req: args.req,
        }),
      },
    },
  };
}

function validateUploadInput(args: {
  collection: CollectionConfig;
  data: Record<string, unknown>;
  file?: UploadInputFile;
  operation: "create" | "update";
}): ValidationIssue[] {
  const upload = getUploadConfig(args.collection);
  if (!upload) {
    return args.file
      ? [
          {
            message: `Collection "${args.collection.slug}" does not accept file uploads.`,
            path: ["file"],
          },
        ]
      : [];
  }

  const issues: ValidationIssue[] = [];

  if (typeof args.data.file !== "undefined") {
    issues.push({
      message: `Field "${args.collection.slug}.file" is managed by Oboe and cannot be set directly.`,
      path: ["file"],
    });
  }

  if (args.operation === "create" && !args.file) {
    issues.push({
      message: `Upload-enabled collection "${args.collection.slug}" requires a file on create.`,
      path: ["file"],
    });
    return issues;
  }

  if (!args.file) {
    return issues;
  }

  if (
    typeof upload.maxFileSize === "number" &&
    args.file.filesize > upload.maxFileSize
  ) {
    issues.push({
      message: `Uploaded file exceeds maxFileSize for "${args.collection.slug}".`,
      path: ["file"],
    });
  }

  if (
    upload.mimeTypes?.length &&
    !upload.mimeTypes.includes(args.file.mimeType)
  ) {
    issues.push({
      message: `Uploaded file mime type "${args.file.mimeType}" is not allowed for "${args.collection.slug}".`,
      path: ["file"],
    });
  }

  return issues;
}

async function uploadCollectionFile(args: {
  collection: CollectionConfig;
  data: Record<string, unknown>;
  file?: UploadInputFile;
  req?: Request;
  user?: unknown;
}) {
  if (!args.file || !getUploadConfig(args.collection)) {
    return null;
  }

  return await getCollectionStorageAdapter(args.collection).handleUpload({
    collection: args.collection,
    data: args.data,
    file: args.file,
    req: args.req,
    user: args.user,
  });
}

async function cleanupUploadedFile(args: {
  collection: CollectionConfig;
  file: StoredFileData | null;
  req?: Request;
  user?: unknown;
}) {
  if (!args.file) {
    return;
  }

  await getCollectionStorageAdapter(args.collection).handleDelete({
    collection: args.collection,
    file: args.file,
    req: args.req,
    user: args.user,
  });
}

async function runBeforeChange(args: {
  collection: CollectionConfig;
  data: Record<string, unknown>;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}) {
  let data = args.data;

  for (const hook of args.collection.hooks?.beforeChange ?? []) {
    data = await hook({
      context: {
        collection: args.collection,
        operation: args.operation,
        req: args.req,
        user: args.user,
      },
      data,
      originalDoc: args.originalDoc,
    });
  }

  return data;
}

async function runAfterChange(args: {
  collection: CollectionConfig;
  doc: OboeRecord;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}) {
  let doc = args.doc;

  for (const hook of args.collection.hooks?.afterChange ?? []) {
    doc = await hook({
      context: {
        collection: args.collection,
        operation: args.operation,
        req: args.req,
        user: args.user,
      },
      doc,
      originalDoc: args.originalDoc,
    });
  }

  return doc;
}

async function prepareValidatedData(args: {
  collection: CollectionConfig;
  data: Record<string, unknown>;
  db: DatabaseAdapter;
  file?: UploadInputFile;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}) {
  const nextData = await runBeforeChange({
    collection: args.collection,
    data: args.data,
    operation: args.operation,
    originalDoc: args.originalDoc,
    req: args.req,
    user: args.user,
  });
  let candidateData =
    args.operation === "update"
      ? {
          ...(args.originalDoc?.data ?? {}),
          ...nextData,
        }
      : nextData;
  const issues: ValidationIssue[] = [];

  issues.push(
    ...validateUploadInput({
      collection: args.collection,
      data: nextData,
      file: args.file,
      operation: args.operation,
    })
  );

  issues.push(
    ...(await runBuiltInFieldValidation({
      candidateData,
      collection: args.collection,
      db: args.db,
    }))
  );
  issues.push(
    ...(await runFieldSchemaValidation({
      candidateData,
      collection: args.collection,
      operation: args.operation,
      originalDoc: args.originalDoc,
      req: args.req,
      user: args.user,
    }))
  );
  issues.push(
    ...(await runFieldValidatorValidation({
      candidateData,
      collection: args.collection,
      operation: args.operation,
      originalDoc: args.originalDoc,
      req: args.req,
      user: args.user,
    }))
  );

  const collectionSchemaResult = await runCollectionSchemaValidation({
    candidateData,
    collection: args.collection,
    operation: args.operation,
    originalDoc: args.originalDoc,
    req: args.req,
    user: args.user,
  });
  candidateData = collectionSchemaResult.candidateData;
  issues.push(...collectionSchemaResult.issues);

  if (collectionSchemaResult.issues.length === 0) {
    issues.push(
      ...(await runCollectionValidatorValidation({
        candidateData,
        collection: args.collection,
        operation: args.operation,
        originalDoc: args.originalDoc,
        req: args.req,
        user: args.user,
      }))
    );
  }

  if (issues.length > 0) {
    throw new OboeValidationError(issues);
  }

  return candidateData;
}

function toPublicDocument(record: OboeRecord): OboeDocument {
  return {
    ...record.data,
    createdAt: record.createdAt,
    id: record.id,
    updatedAt: record.updatedAt,
  };
}

function normalizeEmailMessage(args: {
  defaultFromAddress: string;
  defaultFromName: string;
  message: SendEmailOptions;
}): SendEmailOptions {
  if (args.message.from) {
    return args.message;
  }

  return {
    ...args.message,
    from: {
      address: args.defaultFromAddress,
      name: args.defaultFromName,
    },
  };
}

export function createOboeRuntime(args: {
  config: OboeConfig;
  db: DatabaseAdapter;
  events?: EventBus;
  jobs?: JobDispatcher;
}): OboeRuntime {
  const schema = compileSchema(args.config);
  const events = args.events ?? createEventBus();
  const fallbackJobs = args.jobs ?? {
    async enqueue(_job: JobRequest) {
      return;
    },
  };
  const jobs = createJobDispatcher(args.db, fallbackJobs);
  let graphql = noopGraphQLExecutor;
  let emailAdapter: InitializedEmailAdapter | null | undefined;
  let emailAdapterPromise: Promise<InitializedEmailAdapter | null> | null =
    null;

  const loadVisibleRecord = async (loadArgs: {
    collectionSlug: string;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    user?: unknown;
  }) => {
    const collection = getCompiledCollection(schema, loadArgs.collectionSlug);

    if (
      !(await canAccess({
        collection,
        id: loadArgs.id,
        operation: "read",
        overrideAccess: loadArgs.overrideAccess,
        req: loadArgs.req,
        user: loadArgs.user,
      }))
    ) {
      throw new Error(`Access denied for read on "${collection.slug}".`);
    }

    const record = await args.db.findById({
      collection: collection.slug,
      id: loadArgs.id,
    });

    if (!record) {
      return null;
    }

    return runAfterRead({
      collection,
      doc: record,
      req: loadArgs.req,
      user: loadArgs.user,
    });
  };

  const materializeDocument = async (materializeArgs: {
    collectionSlug: string;
    depth?: number;
    overrideAccess?: boolean;
    record: OboeRecord;
    req?: Request;
    select?: SelectShape;
    seen?: Set<string>;
    user?: unknown;
  }): Promise<OboeDocument> => {
    const collection = getCompiledCollection(
      schema,
      materializeArgs.collectionSlug
    );
    const seen = materializeArgs.seen ?? new Set<string>();
    const nextDepth = defaultDepth(materializeArgs.depth);
    const key = `${materializeArgs.collectionSlug}:${materializeArgs.record.id}`;
    const baseDocument = toPublicDocument(materializeArgs.record);

    if (seen.has(key)) {
      return applySelect(baseDocument, materializeArgs.select);
    }

    seen.add(key);

    for (const field of collection.fields) {
      if (!isRelationshipField(field) || !field.relationTo) {
        continue;
      }

      const rawValue = baseDocument[field.name];
      if (typeof rawValue !== "string") {
        continue;
      }

      const allowedDepth =
        field.maxDepth === undefined
          ? nextDepth
          : Math.min(nextDepth, field.maxDepth);

      if (allowedDepth <= 0) {
        continue;
      }

      const nestedSelect =
        materializeArgs.select &&
        isPlainObject(materializeArgs.select[field.name])
          ? (materializeArgs.select[field.name] as SelectShape)
          : undefined;

      const related = await loadVisibleRecord({
        collectionSlug: field.relationTo,
        id: rawValue,
        overrideAccess: materializeArgs.overrideAccess,
        req: materializeArgs.req,
        user: materializeArgs.user,
      }).catch(() => null);

      if (!related) {
        continue;
      }

      baseDocument[field.name] = await materializeDocument({
        collectionSlug: field.relationTo,
        depth: allowedDepth - 1,
        overrideAccess: materializeArgs.overrideAccess,
        record: related,
        req: materializeArgs.req,
        seen,
        select: nestedSelect,
        user: materializeArgs.user,
      });
    }

    return applySelect(baseDocument, materializeArgs.select);
  };

  const filterRecords = (records: OboeRecord[], query?: CollectionQuery) =>
    sortRecords(
      records.filter((record) => matchesWhere(record, query?.where)),
      query?.sort
    );

  const countRecords = (records: OboeRecord[]): CountResult => ({
    totalDocs: records.length,
  });

  const getInitializedEmailAdapter = async () => {
    if (emailAdapter !== undefined) {
      return emailAdapter;
    }

    if (emailAdapterPromise) {
      return emailAdapterPromise;
    }

    emailAdapterPromise = (async () => {
      const adapterFactory = args.config.email ? await args.config.email : null;

      emailAdapter = adapterFactory ? adapterFactory({ oboe: runtime }) : null;

      return emailAdapter;
    })();

    try {
      return await emailAdapterPromise;
    } finally {
      emailAdapterPromise = null;
    }
  };

  const runtime: OboeRuntime = {
    auth: {
      collection() {
        return args.config.auth?.collection;
      },
    },
    async callServerFunction<
      TInput = Record<string, unknown>,
      TOutput = unknown,
    >(callArgs: {
      input?: TInput;
      name: string;
      req?: Request;
      user?: unknown;
    }) {
      const { input, name, req, user } = callArgs;
      const definition = args.config.serverFunctions?.[name];

      if (!definition) {
        throw new Error(`Unknown server function "${name}".`);
      }

      return (await definition.handler({
        input: (input ?? {}) as Record<string, unknown>,
        oboe: runtime,
        req,
        user,
      })) as TOutput;
    },
    config: args.config,
    async count({ collection, overrideAccess, query, req, user }) {
      const collectionConfig = getCompiledCollection(schema, collection);

      if (
        !(await canAccess({
          collection: collectionConfig,
          operation: "read",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for read on "${collection}".`);
      }

      const records = await args.db.find({
        collection,
      });

      return countRecords(filterRecords(records, { where: query?.where }));
    },
    async create({
      collection,
      data,
      depth,
      file,
      overrideAccess,
      req,
      select,
      user,
    }) {
      const collectionConfig = getCompiledCollection(schema, collection);

      if (
        !(await canAccess({
          collection: collectionConfig,
          data,
          operation: "create",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(
          `Access denied for create on "${collectionConfig.slug}".`
        );
      }

      const candidateData = await prepareValidatedData({
        collection: collectionConfig,
        data,
        db: args.db,
        file,
        operation: "create",
        req,
        user,
      });
      const uploadedFile = await uploadCollectionFile({
        collection: collectionConfig,
        data: candidateData,
        file,
        req,
        user,
      });
      let created: OboeRecord;
      try {
        created = await args.db.create({
          collection,
          data: uploadedFile
            ? {
                ...candidateData,
                file: uploadedFile,
              }
            : candidateData,
        });
      } catch (error) {
        await cleanupUploadedFile({
          collection: collectionConfig,
          file: uploadedFile,
          req,
          user,
        });
        throw error;
      }
      const doc = await runAfterChange({
        collection: collectionConfig,
        doc: created,
        operation: "create",
        req,
        user,
      });

      await args.db.recordAudit?.({
        actor: user,
        at: new Date().toISOString(),
        collection,
        id: doc.id,
        operation: "create",
        payload: doc.data,
      });
      await events.emit(`${collection}.created`, {
        collection,
        id: doc.id,
      });

      const readable = await runAfterRead({
        collection: collectionConfig,
        doc,
        req,
        user,
      });

      return materializeDocument({
        collectionSlug: collection,
        depth,
        overrideAccess,
        record: readable,
        req,
        select,
        user,
      });
    },
    db: args.db,
    async delete({ collection, depth, id, overrideAccess, req, select, user }) {
      const collectionConfig = getCompiledCollection(schema, collection);

      if (
        !(await canAccess({
          collection: collectionConfig,
          id,
          operation: "delete",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for delete on "${collection}".`);
      }

      const doc = await args.db.delete({
        collection,
        id,
      });

      if (doc) {
        try {
          await cleanupUploadedFile({
            collection: collectionConfig,
            file: getStoredFileData(doc.data.file),
            req,
            user,
          });
        } catch (error) {
          console.error(error);
        }

        await args.db.recordAudit?.({
          actor: user,
          at: new Date().toISOString(),
          collection,
          id,
          operation: "delete",
          payload: doc.data,
        });
        await events.emit(`${collection}.deleted`, { collection, id });
      }

      return doc
        ? materializeDocument({
            collectionSlug: collection,
            depth,
            overrideAccess,
            record: doc,
            req,
            select,
            user,
          })
        : null;
    },
    email: {
      getClient<T = unknown>(name: string): T | undefined {
        return emailAdapter?.clients?.[name] as T | undefined;
      },
    },
    events,
    async find({ collection, overrideAccess, query, req, user }) {
      const collectionConfig = getCompiledCollection(schema, collection);

      if (
        !(await canAccess({
          collection: collectionConfig,
          operation: "read",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for read on "${collection}".`);
      }

      const records = filterRecords(
        await args.db.find({
          collection,
        }),
        query
      );
      const page = paginateDocuments(records, query);
      const docs = await Promise.all(
        page.docs.map(async (record) =>
          materializeDocument({
            collectionSlug: collection,
            depth: query?.depth,
            overrideAccess,
            record: await runAfterRead({
              collection: collectionConfig,
              doc: record,
              req,
              user,
            }),
            req,
            select: query?.select,
            user,
          })
        )
      );

      return {
        ...page,
        docs,
      };
    },
    async findById({
      collection,
      depth,
      id,
      overrideAccess,
      req,
      select,
      user,
    }) {
      const doc = await loadVisibleRecord({
        collectionSlug: collection,
        id,
        overrideAccess,
        req,
        user,
      });

      if (!doc) {
        return null;
      }

      return materializeDocument({
        collectionSlug: collection,
        depth,
        overrideAccess,
        record: doc,
        req,
        select,
        user,
      });
    },
    graphql,
    async initialize() {
      await args.db.initialize?.(schema);
      await getInitializedEmailAdapter();

      for (const collection of schema.collections.values()) {
        if (!collection.upload) {
          continue;
        }

        await getCollectionStorageAdapter(collection).onInit?.();
      }
    },
    jobs,
    schema,
    async sendEmail(message) {
      const adapter = await getInitializedEmailAdapter();

      if (!adapter) {
        throw new OboeEmailError({
          message: "Email adapter is not configured.",
        });
      }

      return await adapter.sendEmail(
        normalizeEmailMessage({
          defaultFromAddress: adapter.defaultFromAddress,
          defaultFromName: adapter.defaultFromName,
          message,
        })
      );
    },
    setGraphQLExecutor(executor) {
      graphql = executor;
      this.graphql = graphql;
    },
    async update({
      collection,
      data,
      depth,
      file,
      id,
      overrideAccess,
      req,
      select,
      user,
    }) {
      const collectionConfig = getCompiledCollection(schema, collection);

      if (
        !(await canAccess({
          collection: collectionConfig,
          data,
          id,
          operation: "update",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for update on "${collection}".`);
      }

      const existing = await args.db.findById({ collection, id });
      const candidateData = await prepareValidatedData({
        collection: collectionConfig,
        data,
        db: args.db,
        file,
        operation: "update",
        originalDoc: existing,
        req,
        user,
      });
      const previousFile = getStoredFileData(existing?.data.file);
      const uploadedFile = await uploadCollectionFile({
        collection: collectionConfig,
        data: candidateData,
        file,
        req,
        user,
      });
      let updated: OboeRecord | null;
      try {
        updated = await args.db.update({
          collection,
          data: uploadedFile
            ? {
                ...candidateData,
                file: uploadedFile,
              }
            : candidateData,
          id,
        });
      } catch (error) {
        await cleanupUploadedFile({
          collection: collectionConfig,
          file: uploadedFile,
          req,
          user,
        });
        throw error;
      }

      if (!updated) {
        await cleanupUploadedFile({
          collection: collectionConfig,
          file: uploadedFile,
          req,
          user,
        });
        return null;
      }

      if (uploadedFile && previousFile) {
        try {
          await cleanupUploadedFile({
            collection: collectionConfig,
            file: previousFile,
            req,
            user,
          });
        } catch (error) {
          console.error(error);
        }
      }

      const doc = await runAfterChange({
        collection: collectionConfig,
        doc: updated,
        operation: "update",
        originalDoc: existing,
        req,
        user,
      });

      await args.db.recordAudit?.({
        actor: user,
        at: new Date().toISOString(),
        collection,
        id,
        operation: "update",
        payload: doc.data,
      });
      await events.emit(`${collection}.updated`, { collection, id });

      const readable = await runAfterRead({
        collection: collectionConfig,
        doc,
        req,
        user,
      });

      return materializeDocument({
        collectionSlug: collection,
        depth,
        overrideAccess,
        record: readable,
        req,
        select,
        user,
      });
    },
    async downloadFile({ collection, id, overrideAccess, req, user }) {
      const collectionConfig = getCompiledCollection(schema, collection);

      if (
        !(await canAccess({
          collection: collectionConfig,
          id,
          operation: "read",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for read on "${collection}".`);
      }

      const record = await args.db.findById({
        collection,
        id,
      });

      if (!record) {
        return null;
      }

      const storedFile = getStoredFileData(record.data.file);
      if (!storedFile) {
        return null;
      }

      return await getCollectionStorageAdapter(collectionConfig).handleDownload(
        {
          collection: collectionConfig,
          file: storedFile,
          req,
          user,
        }
      );
    },
  };

  return runtime;
}
