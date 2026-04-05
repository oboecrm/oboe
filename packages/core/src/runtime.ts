import { createEventBus } from "./events.js";
import { compileSchema, getCompiledCollection } from "./schema.js";
import type {
  CollectionConfig,
  CollectionValidationContext,
  DatabaseAdapter,
  EventBus,
  FieldConfig,
  FieldValidationContext,
  GraphQLExecutor,
  JobDispatcher,
  JobRequest,
  OboeConfig,
  OboeRecord,
  OboeRuntime,
  SchemaAdapter,
  SchemaParseFailure,
  SchemaParseResult,
  StandardSchemaIssue,
  StandardSchemaLike,
  ValidationIssue,
  ValidationIssueResult,
} from "./types.js";
import { OboeValidationError } from "./types.js";

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
  schema: ReturnType<typeof compileSchema>;
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
  schema: ReturnType<typeof compileSchema>;
}) {
  const issues: ValidationIssue[] = [];

  for (const field of args.collection.fields) {
    const builtInIssues = builtInFieldIssues({
      collection: args.collection,
      data: args.candidateData,
      db: args.db,
      field,
      schema: args.schema,
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
      issues: [] as ValidationIssue[],
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
    issues: [] as ValidationIssue[],
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
  collectionSlug: string;
  config: OboeConfig;
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

  const collection = getCompiledCollection(
    compileSchema(args.config),
    args.collectionSlug
  );
  const resolver = collection.access?.[args.operation];

  if (!resolver) {
    return true;
  }

  return resolver({
    action: args.operation,
    collection,
    data: args.data,
    id: args.id,
    req: args.req,
    user: args.user,
  });
}

async function runAfterRead(args: {
  collectionSlug: string;
  config: OboeConfig;
  doc: OboeRecord;
  operation: "read";
  req?: Request;
  user?: unknown;
}) {
  const collection = getCompiledCollection(
    compileSchema(args.config),
    args.collectionSlug
  );
  let doc = args.doc;

  for (const hook of collection.hooks?.afterRead ?? []) {
    doc = await hook({
      context: {
        collection,
        operation: args.operation,
        req: args.req,
        user: args.user,
      },
      doc,
    });
  }

  return doc;
}

async function runBeforeChange(args: {
  collectionSlug: string;
  config: OboeConfig;
  data: Record<string, unknown>;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}) {
  const collection = getCompiledCollection(
    compileSchema(args.config),
    args.collectionSlug
  );
  let data = args.data;

  for (const hook of collection.hooks?.beforeChange ?? []) {
    data = await hook({
      context: {
        collection,
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
  collectionSlug: string;
  config: OboeConfig;
  doc: OboeRecord;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}) {
  const collection = getCompiledCollection(
    compileSchema(args.config),
    args.collectionSlug
  );
  let doc = args.doc;

  for (const hook of collection.hooks?.afterChange ?? []) {
    doc = await hook({
      context: {
        collection,
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
  collectionSlug: string;
  config: OboeConfig;
  data: Record<string, unknown>;
  db: DatabaseAdapter;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  schema: ReturnType<typeof compileSchema>;
  user?: unknown;
}) {
  const collection = getCompiledCollection(args.schema, args.collectionSlug);
  const nextData = await runBeforeChange({
    collectionSlug: args.collectionSlug,
    config: args.config,
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
    ...(await runBuiltInFieldValidation({
      candidateData,
      collection,
      db: args.db,
      schema: args.schema,
    }))
  );
  issues.push(
    ...(await runFieldSchemaValidation({
      candidateData,
      collection,
      operation: args.operation,
      originalDoc: args.originalDoc,
      req: args.req,
      user: args.user,
    }))
  );
  issues.push(
    ...(await runFieldValidatorValidation({
      candidateData,
      collection,
      operation: args.operation,
      originalDoc: args.originalDoc,
      req: args.req,
      user: args.user,
    }))
  );

  const collectionSchemaResult = await runCollectionSchemaValidation({
    candidateData,
    collection,
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
        collection,
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

  return {
    auth: {
      collection() {
        return args.config.auth?.collection;
      },
    },
    config: args.config,
    async create({ collection, data, overrideAccess, req, user }) {
      const collectionConfig = getCompiledCollection(schema, collection);

      if (
        !(await canAccess({
          collectionSlug: collection,
          config: args.config,
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
        collectionSlug: collection,
        config: args.config,
        data,
        db: args.db,
        operation: "create",
        req,
        schema,
        user,
      });
      const created = await args.db.create({
        collection,
        data: candidateData,
      });
      const doc = await runAfterChange({
        collectionSlug: collection,
        config: args.config,
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

      return doc;
    },
    db: args.db,
    async delete({ collection, id, overrideAccess, req, user }) {
      if (
        !(await canAccess({
          collectionSlug: collection,
          config: args.config,
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

      return doc;
    },
    events,
    async find({ collection, overrideAccess, query, req, user }) {
      if (
        !(await canAccess({
          collectionSlug: collection,
          config: args.config,
          operation: "read",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for read on "${collection}".`);
      }

      const docs = await args.db.find({
        collection,
        query,
      });

      return Promise.all(
        docs.map((doc) =>
          runAfterRead({
            collectionSlug: collection,
            config: args.config,
            doc,
            operation: "read",
            req,
            user,
          })
        )
      );
    },
    async findById({ collection, id, overrideAccess, req, user }) {
      if (
        !(await canAccess({
          collectionSlug: collection,
          config: args.config,
          id,
          operation: "read",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for read on "${collection}".`);
      }

      const doc = await args.db.findById({
        collection,
        id,
      });

      if (!doc) {
        return null;
      }

      return runAfterRead({
        collectionSlug: collection,
        config: args.config,
        doc,
        operation: "read",
        req,
        user,
      });
    },
    graphql: graphql,
    async initialize() {
      await args.db.initialize?.(schema);
    },
    jobs,
    schema,
    setGraphQLExecutor(executor) {
      graphql = executor;
      this.graphql = graphql;
    },
    async update({ collection, data, id, overrideAccess, req, user }) {
      if (
        !(await canAccess({
          collectionSlug: collection,
          config: args.config,
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
        collectionSlug: collection,
        config: args.config,
        data,
        db: args.db,
        operation: "update",
        originalDoc: existing,
        req,
        schema,
        user,
      });
      const updated = await args.db.update({
        collection,
        data: candidateData,
        id,
      });

      if (!updated) {
        return null;
      }

      const doc = await runAfterChange({
        collectionSlug: collection,
        config: args.config,
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
      await events.emit(`${collection}.updated`, {
        collection,
        id,
      });

      return doc;
    },
  };
}
