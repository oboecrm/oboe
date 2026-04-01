export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "number"
  | "boolean"
  | "date"
  | "select"
  | "relation";

export interface BaseFieldConfig {
  label?: string;
  name: string;
  required?: boolean;
}

export interface SelectFieldOption {
  label: string;
  value: string;
}

export interface FieldConfig extends BaseFieldConfig {
  options?: SelectFieldOption[];
  relationTo?: string;
  type: FieldType;
}

export interface AdminViewConfig {
  component: string;
  label: string;
  path: string;
}

export interface AdminActionConfig {
  label: string;
  permission?: string;
}

export interface CollectionAccessContext {
  action: CollectionOperation;
  collection: CollectionConfig;
  data?: Record<string, unknown>;
  id?: string;
  req?: Request;
  user?: unknown;
}

export type CollectionAccessResolver = (
  context: CollectionAccessContext
) => boolean | Promise<boolean>;

export interface HookContext {
  collection: CollectionConfig;
  operation: CollectionOperation;
  req?: Request;
  user?: unknown;
}

export type BeforeChangeHook = (args: {
  context: HookContext;
  data: Record<string, unknown>;
  originalDoc?: OboeRecord | null;
}) => Record<string, unknown> | Promise<Record<string, unknown>>;

export type AfterChangeHook = (args: {
  context: HookContext;
  doc: OboeRecord;
  originalDoc?: OboeRecord | null;
}) => OboeRecord | Promise<OboeRecord>;

export type AfterReadHook = (args: {
  context: HookContext;
  doc: OboeRecord;
}) => OboeRecord | Promise<OboeRecord>;

export interface CollectionHooks {
  afterChange?: AfterChangeHook[];
  afterRead?: AfterReadHook[];
  beforeChange?: BeforeChangeHook[];
}

export interface CollectionAdminConfig {
  defaultColumns?: string[];
  titleField?: string;
  views?: Record<string, AdminViewConfig>;
}

export interface CollectionConfig {
  access?: Partial<Record<CollectionOperation, CollectionAccessResolver>>;
  admin?: CollectionAdminConfig;
  auth?: boolean;
  fields: FieldConfig[];
  hooks?: CollectionHooks;
  labels?: {
    plural?: string;
    singular?: string;
  };
  slug: string;
}

export interface GlobalConfig {
  fields: FieldConfig[];
  slug: string;
}

export interface ModuleConfig {
  collections: CollectionConfig[];
  globals?: GlobalConfig[];
  label?: string;
  slug: string;
}

export interface PluginConfig {
  extendConfig?: (config: OboeConfig) => OboeConfig;
  name: string;
}

export interface AdminConfig {
  actions?: Record<string, AdminActionConfig>;
  components?: Record<string, string>;
  views?: Record<string, AdminViewConfig>;
}

export interface AuthConfig {
  collection?: string;
}

export interface JobsConfig {
  retryLimit?: number;
}

export interface OboeConfig {
  admin?: AdminConfig;
  auth?: AuthConfig;
  jobs?: JobsConfig;
  modules: ModuleConfig[];
  plugins?: PluginConfig[];
}

export interface CompiledCollection extends CollectionConfig {
  moduleSlug: string;
}

export interface CompiledSchema {
  collections: Map<string, CompiledCollection>;
  config: OboeConfig;
  globals: Map<string, GlobalConfig>;
  modules: Map<string, ModuleConfig>;
}

export interface CollectionQuery {
  limit?: number;
  where?: Record<string, unknown>;
}

export interface OboeRecord {
  collection: string;
  createdAt: string;
  data: Record<string, unknown>;
  id: string;
  updatedAt: string;
}

export interface AuditEntry {
  actor?: unknown;
  at: string;
  collection: string;
  id: string;
  operation: CollectionOperation;
  payload?: Record<string, unknown>;
}

export interface JobRequest {
  attempts?: number;
  idempotencyKey?: string;
  name: string;
  payload: Record<string, unknown>;
  runAt?: string;
}

export interface GraphQLExecutor {
  execute: (args: {
    query: string;
    variables?: Record<string, unknown>;
  }) => Promise<unknown>;
}

export interface JobDispatcher {
  enqueue: (job: JobRequest) => Promise<void>;
}

export interface EventBus {
  emit: (name: string, payload: Record<string, unknown>) => Promise<void>;
  on: (
    name: string,
    listener: (payload: Record<string, unknown>) => void | Promise<void>
  ) => () => void;
}

export interface DatabaseAdapter {
  create: (args: {
    collection: string;
    data: Record<string, unknown>;
  }) => Promise<OboeRecord>;
  delete: (args: {
    collection: string;
    id: string;
  }) => Promise<OboeRecord | null>;
  enqueueJob?: (job: JobRequest) => Promise<void>;
  find: (args: {
    collection: string;
    query?: CollectionQuery;
  }) => Promise<OboeRecord[]>;
  findById: (args: {
    collection: string;
    id: string;
  }) => Promise<OboeRecord | null>;
  initialize?: (schema: CompiledSchema) => Promise<void>;
  recordAudit?: (entry: AuditEntry) => Promise<void>;
  transaction?: <T>(
    callback: (adapter: DatabaseAdapter) => Promise<T>
  ) => Promise<T>;
  update: (args: {
    collection: string;
    data: Record<string, unknown>;
    id: string;
  }) => Promise<OboeRecord | null>;
}

export interface OboeRuntime {
  auth: {
    collection: () => string | undefined;
  };
  config: OboeConfig;
  create: (args: {
    collection: string;
    data: Record<string, unknown>;
    overrideAccess?: boolean;
    req?: Request;
    user?: unknown;
  }) => Promise<OboeRecord>;
  db: DatabaseAdapter;
  delete: (args: {
    collection: string;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    user?: unknown;
  }) => Promise<OboeRecord | null>;
  events: EventBus;
  find: (args: {
    collection: string;
    overrideAccess?: boolean;
    query?: CollectionQuery;
    req?: Request;
    user?: unknown;
  }) => Promise<OboeRecord[]>;
  findById: (args: {
    collection: string;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    user?: unknown;
  }) => Promise<OboeRecord | null>;
  graphql: GraphQLExecutor;
  initialize: () => Promise<void>;
  jobs: JobDispatcher;
  schema: CompiledSchema;
  setGraphQLExecutor: (executor: GraphQLExecutor) => void;
  update: (args: {
    collection: string;
    data: Record<string, unknown>;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    user?: unknown;
  }) => Promise<OboeRecord | null>;
}

export type CollectionOperation = "create" | "delete" | "read" | "update";
