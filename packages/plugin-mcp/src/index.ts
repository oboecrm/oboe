import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  McpServer,
  type ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CollectionConfig,
  CollectionQuery,
  CollectionWhere,
  GlobalConfig,
  HttpRouteConfig,
  OboeConfig,
  OboeRuntime,
  PluginConfig,
  SelectFieldOption,
  SelectShape,
} from "@oboe/core";
import * as z from "zod/v4";

export type {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
  ResourceTemplate,
};

type McpCollectionOperation =
  | "count"
  | "create"
  | "delete"
  | "find"
  | "findById"
  | "update";
type McpGlobalOperation = "find" | "update";

type McpFieldOwner =
  | Pick<CollectionConfig, "slug">
  | Pick<GlobalConfig, "slug">;

interface McpCollectionOperationOptions {
  count?: boolean;
  create?: boolean;
  delete?: boolean;
  find?: boolean;
  findById?: boolean;
  update?: boolean;
}

interface McpGlobalOperationOptions {
  find?: boolean;
  update?: boolean;
}

export interface McpCollectionAccessSettings
  extends Partial<Record<McpCollectionOperation, boolean>> {}

export interface McpGlobalAccessSettings
  extends Partial<Record<McpGlobalOperation, boolean>> {}

export interface McpAuthContext {
  collections?: Record<string, McpCollectionAccessSettings>;
  globals?: Record<string, McpGlobalAccessSettings>;
  keyId?: string;
  user?: unknown;
}

export interface McpCollectionOption {
  defaultSelect?: SelectShape;
  description?: string;
  enabled?: boolean | McpCollectionOperationOptions;
  overrideResponse?: (args: {
    auth: McpAuthContext;
    operation: McpCollectionOperation;
    req: Request;
    result: unknown;
    runtime: OboeRuntime;
    slug: string;
  }) => Promise<unknown> | unknown;
}

export interface McpGlobalOption {
  description?: string;
  enabled?: boolean | McpGlobalOperationOptions;
  overrideResponse?: (args: {
    auth: McpAuthContext;
    operation: McpGlobalOperation;
    req: Request;
    result: unknown;
    runtime: OboeRuntime;
    slug: string;
  }) => Promise<unknown> | unknown;
}

export interface McpCustomTool {
  description?: string;
  handler: (args: {
    auth: McpAuthContext;
    params: Record<string, unknown>;
    req: Request;
    runtime: OboeRuntime;
  }) => Promise<CallToolResult | unknown> | CallToolResult | unknown;
  inputSchema?: z.ZodRawShape;
  name: string;
  title?: string;
}

export interface McpCustomPrompt {
  argsSchema?: z.ZodRawShape;
  description?: string;
  handler: (args: {
    auth: McpAuthContext;
    params: Record<string, unknown>;
    req: Request;
    runtime: OboeRuntime;
  }) => Promise<GetPromptResult> | GetPromptResult;
  name: string;
  title?: string;
}

export interface McpCustomResource {
  description?: string;
  handler: (args: {
    auth: McpAuthContext;
    params: Record<string, unknown>;
    req: Request;
    runtime: OboeRuntime;
  }) => Promise<ReadResourceResult> | ReadResourceResult;
  mimeType?: string;
  name: string;
  title?: string;
  uri: ResourceTemplate | string;
}

export interface McpEventBase {
  at: string;
  request: Request;
}

export interface McpAuthFailureEvent extends McpEventBase {
  reason: "invalid-key" | "missing-bearer-token";
  type: "auth.failed";
}

export interface McpAccessDeniedEvent extends McpEventBase {
  operation: string;
  slug: string;
  type: "access.denied";
}

export interface McpToolSuccessEvent extends McpEventBase {
  operation: string;
  slug: string;
  type: "tool.success";
}

export interface McpToolErrorEvent extends McpEventBase {
  error: string;
  operation: string;
  slug: string;
  type: "tool.error";
}

export type McpEvent =
  | McpAccessDeniedEvent
  | McpAuthFailureEvent
  | McpToolErrorEvent
  | McpToolSuccessEvent;

export interface McpPluginOptions {
  apiKeys?: {
    collectionSlug?: string;
    userCollection?: string;
  };
  collections?: Record<string, boolean | McpCollectionOption>;
  disabled?: boolean;
  globals?: Record<string, boolean | McpGlobalOption>;
  mcp?: {
    maxDuration?: number;
    onEvent?: (event: McpEvent) => Promise<void> | void;
    prompts?: McpCustomPrompt[];
    resources?: McpCustomResource[];
    serverInfo?: {
      name: string;
      version?: string;
    };
    tools?: McpCustomTool[];
  };
  overrideAuth?: (args: {
    getDefaultAuthContext: () => Promise<McpAuthContext | null>;
    req: Request;
    runtime: OboeRuntime;
    token: string | null;
  }) => Promise<McpAuthContext | null> | McpAuthContext | null;
  route?: string;
}

export interface IssuedMcpApiKey {
  keyHash: string;
  keyPrefix: string;
  plainTextKey: string;
}

const DEFAULT_ROUTE = "/api/mcp";
const DEFAULT_API_KEY_COLLECTION = "mcp-api-keys";
const KEY_PREFIX_LENGTH = 16;
const MCP_MODULE_SLUG = "oboe-mcp";
const COLLECTION_TOOL_OPERATIONS: McpCollectionOperation[] = [
  "find",
  "findById",
  "count",
  "create",
  "update",
  "delete",
];
const GLOBAL_TOOL_OPERATIONS: McpGlobalOperation[] = ["find", "update"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function timingSafeHexEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function issueMcpApiKey(): IssuedMcpApiKey {
  const random = randomBytes(24).toString("hex");
  const plainTextKey = `oboe_mcp_${random}`;

  return {
    keyHash: sha256(plainTextKey),
    keyPrefix: plainTextKey.slice(0, KEY_PREFIX_LENGTH),
    plainTextKey,
  };
}

function bearerTokenFromRequest(request: Request) {
  const header = request.headers.get("authorization");

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function normalizeRoute(route: string | undefined) {
  const value = route ?? DEFAULT_ROUTE;

  if (!value.startsWith("/")) {
    throw new Error(`MCP route "${value}" must start with "/".`);
  }

  return value;
}

function ensureSlugIsAvailable(
  config: OboeConfig,
  slug: string,
  label: string
) {
  for (const moduleConfig of config.modules) {
    if (moduleConfig.slug === slug) {
      throw new Error(
        `MCP plugin cannot add ${label} "${slug}" because the slug is already in use.`
      );
    }

    for (const collection of moduleConfig.collections) {
      if (collection.slug === slug) {
        throw new Error(
          `MCP plugin cannot add ${label} "${slug}" because the slug is already in use.`
        );
      }
    }
  }
}

function fieldDescription(field: { label?: string; name: string }) {
  return field.label ?? field.name;
}

function selectValues(options?: SelectFieldOption[]) {
  return options?.map((option) => option.value) ?? [];
}

function zodForField(
  owner: McpFieldOwner,
  field: CollectionConfig["fields"][number]
) {
  switch (field.type) {
    case "boolean":
      return z.boolean().describe(fieldDescription(field));
    case "date":
      return z.string().describe(fieldDescription(field));
    case "email":
      return z.string().email().describe(fieldDescription(field));
    case "json":
      return z
        .record(z.string(), z.unknown())
        .describe(fieldDescription(field));
    case "number":
      return z.number().describe(fieldDescription(field));
    case "relation":
    case "relationship":
      return z
        .string()
        .describe(
          `${fieldDescription(field)} (${field.relationTo ?? owner.slug} id)`
        );
    case "select": {
      const values = selectValues(field.options);

      if (values.length > 0) {
        return z
          .enum(values as [string, ...string[]])
          .describe(fieldDescription(field));
      }

      return z.string().describe(fieldDescription(field));
    }
    default:
      return z.string().describe(fieldDescription(field));
  }
}

function createInputShape(collection: CollectionConfig) {
  return Object.fromEntries(
    collection.fields
      .filter((field) => field.name !== "file")
      .map((field) => [field.name, zodForField(collection, field)])
  );
}

function createCreateSchema(collection: CollectionConfig) {
  return z.object(createInputShape(collection));
}

function createUpdateSchema(collection: CollectionConfig) {
  return createCreateSchema(collection).partial();
}

function querySchema(): z.ZodRawShape {
  return {
    depth: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).optional(),
    page: z.number().int().min(1).optional(),
    pagination: z.boolean().optional(),
    select: z.record(z.string(), z.unknown()).optional(),
    sort: z.union([z.string(), z.array(z.string())]).optional(),
    where: z.record(z.string(), z.unknown()).optional(),
  };
}

function documentToolResult(result: unknown): CallToolResult {
  return {
    content: [
      {
        text: JSON.stringify(result, null, 2),
        type: "text",
      },
    ],
    structuredContent: isPlainObject(result)
      ? result
      : {
          value: result,
        },
  };
}

function isCallToolResult(result: unknown): result is CallToolResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray((result as { content?: unknown }).content)
  );
}

function normalizeToolResult(result: unknown) {
  return isCallToolResult(result) ? result : documentToolResult(result);
}

function toolErrorResult(message: string): CallToolResult {
  return {
    content: [
      {
        text: message,
        type: "text",
      },
    ],
    isError: true,
  };
}

function collectionToolName(slug: string, operation: McpCollectionOperation) {
  return `collection.${slug}.${operation}`;
}

function globalToolName(slug: string, operation: McpGlobalOperation) {
  return `global.${slug}.${operation}`;
}

function normalizeCollectionOption(
  collection: CollectionConfig,
  value: boolean | McpCollectionOption
) {
  const option =
    value === true
      ? ({ enabled: true } satisfies McpCollectionOption)
      : value === false
        ? ({ enabled: {} } satisfies McpCollectionOption)
        : value;
  const enabled = option.enabled ?? true;
  const base =
    enabled === true
      ? Object.fromEntries(
          COLLECTION_TOOL_OPERATIONS.map((operation) => [operation, true])
        )
      : { ...enabled };

  if (collection.upload) {
    base.create = false;
    base.update = false;
  }

  return {
    ...option,
    enabled: base as McpCollectionAccessSettings,
  };
}

function normalizeGlobalOption(value: boolean | McpGlobalOption) {
  const option =
    value === true
      ? ({ enabled: true } satisfies McpGlobalOption)
      : value === false
        ? ({ enabled: {} } satisfies McpGlobalOption)
        : value;
  const enabled = option.enabled ?? true;

  return {
    ...option,
    enabled:
      enabled === true
        ? ({
            find: true,
            update: true,
          } satisfies McpGlobalAccessSettings)
        : { ...enabled },
  };
}

function capabilityAllowed(
  settings:
    | Partial<Record<string, Partial<Record<string, boolean>>>>
    | undefined,
  slug: string,
  operation: string
) {
  const scoped = settings?.[slug];

  if (!scoped) {
    return false;
  }

  return scoped[operation] === true;
}

function collectionQueryFromArgs(
  args: Record<string, unknown>,
  defaultSelect?: SelectShape
) {
  return {
    depth: typeof args.depth === "number" ? args.depth : undefined,
    limit: typeof args.limit === "number" ? args.limit : undefined,
    page: typeof args.page === "number" ? args.page : undefined,
    pagination:
      typeof args.pagination === "boolean" ? args.pagination : undefined,
    select: (args.select as SelectShape | undefined) ?? defaultSelect,
    sort: (args.sort as CollectionQuery["sort"] | undefined) ?? undefined,
    where: (args.where as CollectionQuery["where"] | undefined) ?? undefined,
  } satisfies CollectionQuery;
}

async function maybeLoadUser(
  runtime: OboeRuntime,
  userCollection: string | undefined,
  userValue: unknown,
  req: Request
) {
  if (!userCollection || typeof userValue !== "string") {
    return userValue;
  }

  return await runtime.findById({
    collection: userCollection,
    id: userValue,
    overrideAccess: true,
    req,
  });
}

function createApiKeyCollection(
  userCollection: string,
  slug: string
): CollectionConfig {
  return {
    access: {
      create: () => false,
      delete: () => false,
      read: () => false,
      update: () => false,
    },
    fields: [
      { name: "name", required: true, type: "text" },
      { name: "keyPrefix", required: true, type: "text" },
      { name: "keyHash", required: true, type: "text" },
      { name: "enabled", type: "boolean" },
      { name: "expiresAt", type: "date" },
      { name: "lastUsedAt", type: "date" },
      { name: "user", relationTo: userCollection, type: "relation" },
      { name: "collections", type: "json" },
      { name: "globals", type: "json" },
    ],
    labels: {
      plural: "MCP API Keys",
      singular: "MCP API Key",
    },
    slug,
  };
}

async function emitEvent(
  onEvent: ((event: McpEvent) => Promise<void> | void) | undefined,
  event: McpEvent
) {
  await onEvent?.(event);
}

async function defaultAuthContextForRequest(args: {
  apiKeyCollectionSlug: string;
  options: McpPluginOptions;
  req: Request;
  runtime: OboeRuntime;
}) {
  const token = bearerTokenFromRequest(args.req);

  if (!token) {
    return null;
  }

  const prefix = token.slice(0, KEY_PREFIX_LENGTH);
  const keyHash = sha256(token);
  const records = await args.runtime.find({
    collection: args.apiKeyCollectionSlug,
    overrideAccess: true,
    query: {
      depth: 0,
      limit: 10,
      pagination: false,
      where: {
        keyPrefix: {
          eq: prefix,
        },
      } satisfies CollectionWhere,
    },
    req: args.req,
  });
  const record = records.docs.find((doc) => {
    const candidateHash = doc.keyHash;

    return (
      typeof candidateHash === "string" &&
      /^[0-9a-f]+$/i.test(candidateHash) &&
      timingSafeHexEquals(candidateHash, keyHash)
    );
  });

  if (!record || record.enabled === false) {
    return null;
  }

  if (typeof record.expiresAt === "string") {
    const expiresAt = new Date(record.expiresAt).getTime();

    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      return null;
    }
  }

  await args.runtime.update({
    collection: args.apiKeyCollectionSlug,
    data: {
      lastUsedAt: new Date().toISOString(),
    },
    id: String(record.id),
    overrideAccess: true,
    req: args.req,
  });

  const userCollection =
    args.options.apiKeys?.userCollection ??
    args.runtime.config.auth?.collection;

  return {
    collections: isPlainObject(record.collections)
      ? (record.collections as Record<string, McpCollectionAccessSettings>)
      : undefined,
    globals: isPlainObject(record.globals)
      ? (record.globals as Record<string, McpGlobalAccessSettings>)
      : undefined,
    keyId: String(record.id),
    user: await maybeLoadUser(
      args.runtime,
      userCollection,
      record.user,
      args.req
    ),
  } satisfies McpAuthContext;
}

async function resolveAuthContext(args: {
  apiKeyCollectionSlug: string;
  options: McpPluginOptions;
  req: Request;
  runtime: OboeRuntime;
}) {
  const token = bearerTokenFromRequest(args.req);
  const getDefaultAuthContext = () =>
    defaultAuthContextForRequest({
      apiKeyCollectionSlug: args.apiKeyCollectionSlug,
      options: args.options,
      req: args.req,
      runtime: args.runtime,
    });

  return (
    (await args.options.overrideAuth?.({
      getDefaultAuthContext,
      req: args.req,
      runtime: args.runtime,
      token,
    })) ?? (await getDefaultAuthContext())
  );
}

async function authorizeRequest(args: {
  apiKeyCollectionSlug: string;
  options: McpPluginOptions;
  req: Request;
  runtime: OboeRuntime;
}) {
  const auth = await resolveAuthContext(args);

  if (auth) {
    return auth;
  }

  await emitEvent(args.options.mcp?.onEvent, {
    at: new Date().toISOString(),
    reason: bearerTokenFromRequest(args.req)
      ? "invalid-key"
      : "missing-bearer-token",
    request: args.req,
    type: "auth.failed",
  });

  return null;
}

function unauthorizedResponse() {
  return new Response(
    JSON.stringify({
      error: "Unauthorized",
    }),
    {
      headers: {
        "content-type": "application/json",
      },
      status: 401,
    }
  );
}

async function applyCollectionOverrideResponse(
  option: ReturnType<typeof normalizeCollectionOption>,
  args: {
    auth: McpAuthContext;
    operation: McpCollectionOperation;
    req: Request;
    result: unknown;
    runtime: OboeRuntime;
    slug: string;
  }
) {
  return option.overrideResponse
    ? await option.overrideResponse(args)
    : args.result;
}

async function applyGlobalOverrideResponse(
  option: ReturnType<typeof normalizeGlobalOption>,
  args: {
    auth: McpAuthContext;
    operation: McpGlobalOperation;
    req: Request;
    result: unknown;
    runtime: OboeRuntime;
    slug: string;
  }
) {
  return option.overrideResponse
    ? await option.overrideResponse(args)
    : args.result;
}

function assertNoCustomNameCollisions(options: McpPluginOptions) {
  const customNames = new Set([
    ...(options.mcp?.tools?.map((tool) => tool.name) ?? []),
    ...(options.mcp?.prompts?.map((prompt) => prompt.name) ?? []),
    ...(options.mcp?.resources?.map((resource) => resource.name) ?? []),
  ]);

  for (const [slug] of Object.entries(options.collections ?? {})) {
    for (const operation of COLLECTION_TOOL_OPERATIONS) {
      const name = collectionToolName(slug, operation);

      if (customNames.has(name)) {
        throw new Error(`MCP tool name collision: "${name}".`);
      }
    }
  }

  for (const [slug] of Object.entries(options.globals ?? {})) {
    for (const operation of GLOBAL_TOOL_OPERATIONS) {
      const name = globalToolName(slug, operation);

      if (customNames.has(name)) {
        throw new Error(`MCP tool name collision: "${name}".`);
      }
    }
  }
}

function registerCollectionTools(args: {
  auth: McpAuthContext;
  options: McpPluginOptions;
  req: Request;
  runtime: OboeRuntime;
  server: McpServer;
}) {
  for (const [slug, rawOption] of Object.entries(
    args.options.collections ?? {}
  )) {
    const collection = args.runtime.schema.collections.get(slug);

    if (!collection) {
      throw new Error(`Unknown MCP collection "${slug}".`);
    }

    const option = normalizeCollectionOption(collection, rawOption);
    const description =
      option.description ?? `MCP access for the "${slug}" collection.`;

    if (option.enabled.find) {
      args.server.registerTool(
        collectionToolName(slug, "find"),
        {
          annotations: { readOnlyHint: true },
          description: `${description} Find documents.`,
          inputSchema: querySchema(),
          title: `Find ${slug}`,
        },
        async (params) => {
          if (!capabilityAllowed(args.auth.collections, slug, "find")) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "find",
              request: args.req,
              slug,
              type: "access.denied",
            });
            return toolErrorResult(
              `MCP access denied for collection "${slug}" find.`
            );
          }

          try {
            const result = await args.runtime.find({
              collection: slug,
              query: collectionQueryFromArgs(params, option.defaultSelect),
              req: args.req,
              user: args.auth.user,
            });
            const finalResult = await applyCollectionOverrideResponse(option, {
              auth: args.auth,
              operation: "find",
              req: args.req,
              result,
              runtime: args.runtime,
              slug,
            });
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "find",
              request: args.req,
              slug,
              type: "tool.success",
            });
            return normalizeToolResult(finalResult);
          } catch (error) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              operation: "find",
              request: args.req,
              slug,
              type: "tool.error",
            });
            return toolErrorResult(
              error instanceof Error ? error.message : "Unknown error."
            );
          }
        }
      );
    }

    if (option.enabled.findById) {
      args.server.registerTool(
        collectionToolName(slug, "findById"),
        {
          annotations: { readOnlyHint: true },
          description: `${description} Find a document by id.`,
          inputSchema: {
            depth: z.number().int().min(0).optional(),
            id: z.string(),
            select: z.record(z.string(), z.unknown()).optional(),
          },
          title: `Find ${slug} by id`,
        },
        async (params) => {
          if (!capabilityAllowed(args.auth.collections, slug, "findById")) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "findById",
              request: args.req,
              slug,
              type: "access.denied",
            });
            return toolErrorResult(
              `MCP access denied for collection "${slug}" findById.`
            );
          }

          try {
            const result = await args.runtime.findById({
              collection: slug,
              depth:
                typeof params.depth === "number" ? params.depth : undefined,
              id: String(params.id),
              req: args.req,
              select:
                (params.select as SelectShape | undefined) ??
                option.defaultSelect,
              user: args.auth.user,
            });
            const finalResult = await applyCollectionOverrideResponse(option, {
              auth: args.auth,
              operation: "findById",
              req: args.req,
              result,
              runtime: args.runtime,
              slug,
            });
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "findById",
              request: args.req,
              slug,
              type: "tool.success",
            });
            return normalizeToolResult(finalResult);
          } catch (error) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              operation: "findById",
              request: args.req,
              slug,
              type: "tool.error",
            });
            return toolErrorResult(
              error instanceof Error ? error.message : "Unknown error."
            );
          }
        }
      );
    }

    if (option.enabled.count) {
      args.server.registerTool(
        collectionToolName(slug, "count"),
        {
          annotations: { readOnlyHint: true },
          description: `${description} Count documents.`,
          inputSchema: {
            where: z.record(z.string(), z.unknown()).optional(),
          },
          title: `Count ${slug}`,
        },
        async (params) => {
          if (!capabilityAllowed(args.auth.collections, slug, "count")) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "count",
              request: args.req,
              slug,
              type: "access.denied",
            });
            return toolErrorResult(
              `MCP access denied for collection "${slug}" count.`
            );
          }

          try {
            const result = await args.runtime.count({
              collection: slug,
              query: {
                where: params.where as CollectionWhere | undefined,
              },
              req: args.req,
              user: args.auth.user,
            });
            const finalResult = await applyCollectionOverrideResponse(option, {
              auth: args.auth,
              operation: "count",
              req: args.req,
              result,
              runtime: args.runtime,
              slug,
            });
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "count",
              request: args.req,
              slug,
              type: "tool.success",
            });
            return normalizeToolResult(finalResult);
          } catch (error) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              operation: "count",
              request: args.req,
              slug,
              type: "tool.error",
            });
            return toolErrorResult(
              error instanceof Error ? error.message : "Unknown error."
            );
          }
        }
      );
    }

    if (option.enabled.create) {
      args.server.registerTool(
        collectionToolName(slug, "create"),
        {
          description: `${description} Create a document.`,
          inputSchema: {
            data: createCreateSchema(collection),
            depth: z.number().int().min(0).optional(),
            select: z.record(z.string(), z.unknown()).optional(),
          },
          title: `Create ${slug}`,
        },
        async (params) => {
          if (!capabilityAllowed(args.auth.collections, slug, "create")) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "create",
              request: args.req,
              slug,
              type: "access.denied",
            });
            return toolErrorResult(
              `MCP access denied for collection "${slug}" create.`
            );
          }

          try {
            const result = await args.runtime.create({
              collection: slug,
              data: params.data as Record<string, unknown>,
              depth:
                typeof params.depth === "number" ? params.depth : undefined,
              req: args.req,
              select:
                (params.select as SelectShape | undefined) ??
                option.defaultSelect,
              user: args.auth.user,
            });
            const finalResult = await applyCollectionOverrideResponse(option, {
              auth: args.auth,
              operation: "create",
              req: args.req,
              result,
              runtime: args.runtime,
              slug,
            });
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "create",
              request: args.req,
              slug,
              type: "tool.success",
            });
            return normalizeToolResult(finalResult);
          } catch (error) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              operation: "create",
              request: args.req,
              slug,
              type: "tool.error",
            });
            return toolErrorResult(
              error instanceof Error ? error.message : "Unknown error."
            );
          }
        }
      );
    }

    if (option.enabled.update) {
      args.server.registerTool(
        collectionToolName(slug, "update"),
        {
          description: `${description} Update a document.`,
          inputSchema: {
            data: createUpdateSchema(collection),
            depth: z.number().int().min(0).optional(),
            id: z.string(),
            select: z.record(z.string(), z.unknown()).optional(),
          },
          title: `Update ${slug}`,
        },
        async (params) => {
          if (!capabilityAllowed(args.auth.collections, slug, "update")) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "update",
              request: args.req,
              slug,
              type: "access.denied",
            });
            return toolErrorResult(
              `MCP access denied for collection "${slug}" update.`
            );
          }

          try {
            const result = await args.runtime.update({
              collection: slug,
              data: params.data as Record<string, unknown>,
              depth:
                typeof params.depth === "number" ? params.depth : undefined,
              id: String(params.id),
              req: args.req,
              select:
                (params.select as SelectShape | undefined) ??
                option.defaultSelect,
              user: args.auth.user,
            });
            const finalResult = await applyCollectionOverrideResponse(option, {
              auth: args.auth,
              operation: "update",
              req: args.req,
              result,
              runtime: args.runtime,
              slug,
            });
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "update",
              request: args.req,
              slug,
              type: "tool.success",
            });
            return normalizeToolResult(finalResult);
          } catch (error) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              operation: "update",
              request: args.req,
              slug,
              type: "tool.error",
            });
            return toolErrorResult(
              error instanceof Error ? error.message : "Unknown error."
            );
          }
        }
      );
    }

    if (option.enabled.delete) {
      args.server.registerTool(
        collectionToolName(slug, "delete"),
        {
          description: `${description} Delete a document.`,
          inputSchema: {
            depth: z.number().int().min(0).optional(),
            id: z.string(),
            select: z.record(z.string(), z.unknown()).optional(),
          },
          title: `Delete ${slug}`,
        },
        async (params) => {
          if (!capabilityAllowed(args.auth.collections, slug, "delete")) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "delete",
              request: args.req,
              slug,
              type: "access.denied",
            });
            return toolErrorResult(
              `MCP access denied for collection "${slug}" delete.`
            );
          }

          try {
            const result = await args.runtime.delete({
              collection: slug,
              depth:
                typeof params.depth === "number" ? params.depth : undefined,
              id: String(params.id),
              req: args.req,
              select:
                (params.select as SelectShape | undefined) ??
                option.defaultSelect,
              user: args.auth.user,
            });
            const finalResult = await applyCollectionOverrideResponse(option, {
              auth: args.auth,
              operation: "delete",
              req: args.req,
              result,
              runtime: args.runtime,
              slug,
            });
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "delete",
              request: args.req,
              slug,
              type: "tool.success",
            });
            return normalizeToolResult(finalResult);
          } catch (error) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              operation: "delete",
              request: args.req,
              slug,
              type: "tool.error",
            });
            return toolErrorResult(
              error instanceof Error ? error.message : "Unknown error."
            );
          }
        }
      );
    }
  }
}

function registerGlobalTools(args: {
  auth: McpAuthContext;
  options: McpPluginOptions;
  req: Request;
  runtime: OboeRuntime;
  server: McpServer;
}) {
  for (const [slug, rawOption] of Object.entries(args.options.globals ?? {})) {
    const globalConfig = args.runtime.schema.globals.get(slug);

    if (!globalConfig) {
      throw new Error(`Unknown MCP global "${slug}".`);
    }

    const option = normalizeGlobalOption(rawOption);
    const description =
      option.description ?? `MCP access for the "${slug}" global.`;

    if (option.enabled.find) {
      args.server.registerTool(
        globalToolName(slug, "find"),
        {
          annotations: { readOnlyHint: true },
          description: `${description} Read the global.`,
          title: `Find global ${slug}`,
        },
        async () => {
          if (!capabilityAllowed(args.auth.globals, slug, "find")) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "find",
              request: args.req,
              slug,
              type: "access.denied",
            });
            return toolErrorResult(
              `MCP access denied for global "${slug}" find.`
            );
          }

          try {
            const result = await args.runtime.findGlobal({
              req: args.req,
              slug,
              user: args.auth.user,
            });
            const finalResult = await applyGlobalOverrideResponse(option, {
              auth: args.auth,
              operation: "find",
              req: args.req,
              result,
              runtime: args.runtime,
              slug,
            });
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "find",
              request: args.req,
              slug,
              type: "tool.success",
            });
            return normalizeToolResult(finalResult);
          } catch (error) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              operation: "find",
              request: args.req,
              slug,
              type: "tool.error",
            });
            return toolErrorResult(
              error instanceof Error ? error.message : "Unknown error."
            );
          }
        }
      );
    }

    if (option.enabled.update) {
      const shape = Object.fromEntries(
        globalConfig.fields.map((field) => [
          field.name,
          zodForField(globalConfig, field),
        ])
      );

      args.server.registerTool(
        globalToolName(slug, "update"),
        {
          description: `${description} Update the global.`,
          inputSchema: {
            data: z.object(shape),
          },
          title: `Update global ${slug}`,
        },
        async (params) => {
          if (!capabilityAllowed(args.auth.globals, slug, "update")) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "update",
              request: args.req,
              slug,
              type: "access.denied",
            });
            return toolErrorResult(
              `MCP access denied for global "${slug}" update.`
            );
          }

          try {
            const result = await args.runtime.updateGlobal({
              data: params.data as Record<string, unknown>,
              req: args.req,
              slug,
              user: args.auth.user,
            });
            const finalResult = await applyGlobalOverrideResponse(option, {
              auth: args.auth,
              operation: "update",
              req: args.req,
              result,
              runtime: args.runtime,
              slug,
            });
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              operation: "update",
              request: args.req,
              slug,
              type: "tool.success",
            });
            return normalizeToolResult(finalResult);
          } catch (error) {
            await emitEvent(args.options.mcp?.onEvent, {
              at: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              operation: "update",
              request: args.req,
              slug,
              type: "tool.error",
            });
            return toolErrorResult(
              error instanceof Error ? error.message : "Unknown error."
            );
          }
        }
      );
    }
  }
}

function registerCustomTools(args: {
  auth: McpAuthContext;
  options: McpPluginOptions;
  req: Request;
  runtime: OboeRuntime;
  server: McpServer;
}) {
  for (const tool of args.options.mcp?.tools ?? []) {
    args.server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        title: tool.title,
      },
      async (params) => {
        try {
          const result = normalizeToolResult(
            await tool.handler({
              auth: args.auth,
              params,
              req: args.req,
              runtime: args.runtime,
            })
          );
          await emitEvent(args.options.mcp?.onEvent, {
            at: new Date().toISOString(),
            operation: tool.name,
            request: args.req,
            slug: tool.name,
            type: "tool.success",
          });
          return result;
        } catch (error) {
          await emitEvent(args.options.mcp?.onEvent, {
            at: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
            operation: tool.name,
            request: args.req,
            slug: tool.name,
            type: "tool.error",
          });
          return toolErrorResult(
            error instanceof Error ? error.message : "Unknown error."
          );
        }
      }
    );
  }
}

function registerCustomPrompts(args: {
  auth: McpAuthContext;
  options: McpPluginOptions;
  req: Request;
  runtime: OboeRuntime;
  server: McpServer;
}) {
  for (const prompt of args.options.mcp?.prompts ?? []) {
    args.server.registerPrompt(
      prompt.name,
      {
        argsSchema: prompt.argsSchema,
        description: prompt.description,
        title: prompt.title,
      },
      async (params) =>
        await prompt.handler({
          auth: args.auth,
          params,
          req: args.req,
          runtime: args.runtime,
        })
    );
  }
}

function registerCustomResources(args: {
  auth: McpAuthContext;
  options: McpPluginOptions;
  req: Request;
  runtime: OboeRuntime;
  server: McpServer;
}) {
  for (const resource of args.options.mcp?.resources ?? []) {
    if (typeof resource.uri === "string") {
      args.server.registerResource(
        resource.name,
        resource.uri,
        {
          description: resource.description,
          mimeType: resource.mimeType,
          title: resource.title,
        },
        async () =>
          await resource.handler({
            auth: args.auth,
            params: {},
            req: args.req,
            runtime: args.runtime,
          })
      );
      continue;
    }

    args.server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: resource.mimeType,
        title: resource.title,
      },
      async (params) =>
        await resource.handler({
          auth: args.auth,
          params: params as unknown as Record<string, unknown>,
          req: args.req,
          runtime: args.runtime,
        })
    );
  }
}

async function handleMcpRequest(args: {
  apiKeyCollectionSlug: string;
  options: McpPluginOptions;
  req: Request;
  runtime: OboeRuntime;
}) {
  const auth = await authorizeRequest(args);

  if (!auth) {
    return unauthorizedResponse();
  }

  const server = new McpServer({
    name: args.options.mcp?.serverInfo?.name ?? "@oboe/plugin-mcp",
    version: args.options.mcp?.serverInfo?.version ?? "0.1.0",
  });

  registerCollectionTools({
    auth,
    options: args.options,
    req: args.req,
    runtime: args.runtime,
    server,
  });
  registerGlobalTools({
    auth,
    options: args.options,
    req: args.req,
    runtime: args.runtime,
    server,
  });
  registerCustomTools({
    auth,
    options: args.options,
    req: args.req,
    runtime: args.runtime,
    server,
  });
  registerCustomPrompts({
    auth,
    options: args.options,
    req: args.req,
    runtime: args.runtime,
    server,
  });
  registerCustomResources({
    auth,
    options: args.options,
    req: args.req,
    runtime: args.runtime,
    server,
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const response = await transport.handleRequest(args.req);

  if (typeof args.options.mcp?.maxDuration === "number") {
    response.headers.set(
      "x-oboe-mcp-max-duration",
      String(args.options.mcp.maxDuration)
    );
  }

  return response;
}

function createMcpRoute(
  route: string,
  options: McpPluginOptions,
  apiKeyCollectionSlug: string
): HttpRouteConfig {
  return {
    async handler(request: Request, context: { runtime: OboeRuntime }) {
      return await handleMcpRequest({
        apiKeyCollectionSlug,
        options,
        req: request,
        runtime: context.runtime,
      });
    },
    method: "POST",
    path: route,
  };
}

export function mcpPlugin(options: McpPluginOptions): PluginConfig {
  return {
    extendConfig(config: OboeConfig): OboeConfig {
      if (options.disabled === true) {
        return config;
      }

      const route = normalizeRoute(options.route);
      const apiKeyCollectionSlug =
        options.apiKeys?.collectionSlug ?? DEFAULT_API_KEY_COLLECTION;
      const userCollection =
        options.apiKeys?.userCollection ?? config.auth?.collection;

      if (!userCollection) {
        throw new Error(
          "MCP plugin requires apiKeys.userCollection or config.auth.collection."
        );
      }

      assertNoCustomNameCollisions(options);
      ensureSlugIsAvailable(config, apiKeyCollectionSlug, "collection");
      ensureSlugIsAvailable(config, MCP_MODULE_SLUG, "module");

      return {
        ...config,
        http: {
          ...config.http,
          routes: [
            ...(config.http?.routes ?? []),
            createMcpRoute(route, options, apiKeyCollectionSlug),
          ],
        },
        modules: [
          ...config.modules,
          {
            collections: [
              createApiKeyCollection(userCollection, apiKeyCollectionSlug),
            ],
            slug: MCP_MODULE_SLUG,
          },
        ],
      };
    },
    name: "@oboe/plugin-mcp",
  };
}
