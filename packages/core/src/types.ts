export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "json"
  | "number"
  | "boolean"
  | "date"
  | "select"
  | "relation"
  | "relationship";

export interface BaseFieldConfig {
  label?: string;
  maxDepth?: number;
  name: string;
  required?: boolean;
}

export interface ValidationIssue {
  message: string;
  path?: PropertyKey[];
}

export type ValidationIssueResult =
  | string
  | ValidationIssue
  | ValidationIssue[]
  | null
  | undefined;

export interface SchemaParseSuccess<TValue = unknown> {
  issues?: undefined;
  value: TValue;
}

export interface SchemaParseFailure {
  issues: ValidationIssue[];
  value?: unknown;
}

export type SchemaParseResult<TValue = unknown> =
  | SchemaParseSuccess<TValue>
  | SchemaParseFailure;

export interface SchemaAdapter<TContext = unknown, TValue = unknown> {
  parse: (
    value: unknown,
    context: TContext
  ) => SchemaParseResult<TValue> | Promise<SchemaParseResult<TValue>>;
}

export interface StandardSchemaIssue {
  message: string;
  path?: Array<
    | PropertyKey
    | {
        key?: PropertyKey;
        path?: PropertyKey;
      }
  >;
}

export interface StandardSchemaLike<TValue = unknown> {
  "~standard": {
    validate: (
      value: unknown,
      options?: Record<string, unknown>
    ) =>
      | Promise<{ issues: StandardSchemaIssue[] } | { value: TValue }>
      | { issues: StandardSchemaIssue[] }
      | { value: TValue };
  };
}

export interface FieldValidationContext {
  collection: CollectionConfig;
  data: Record<string, unknown>;
  field: FieldConfig;
  operation: Exclude<CollectionOperation, "delete" | "read">;
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}

export interface CollectionValidationContext {
  collection: CollectionConfig;
  data: Record<string, unknown>;
  operation: Exclude<CollectionOperation, "delete" | "read">;
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}

export type FieldSchema =
  | SchemaAdapter<FieldValidationContext>
  | StandardSchemaLike;

export type CollectionSchema =
  | SchemaAdapter<CollectionValidationContext, Record<string, unknown>>
  | StandardSchemaLike<Record<string, unknown>>;

export type FieldValidator = (args: {
  context: FieldValidationContext;
  value: unknown;
}) => ValidationIssueResult | Promise<ValidationIssueResult>;

export type CollectionValidator = (args: {
  context: CollectionValidationContext;
  data: Record<string, unknown>;
}) => ValidationIssueResult | Promise<ValidationIssueResult>;

export class OboeValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[], message = "Validation failed") {
    super(message);
    this.name = "OboeValidationError";
    this.issues = issues;
  }
}

export class OboeEmailError extends Error {
  readonly cause?: unknown;
  readonly provider?: string;
  readonly statusCode?: number;

  constructor(args: {
    cause?: unknown;
    message: string;
    provider?: string;
    statusCode?: number;
  }) {
    super(args.message);
    this.name = "OboeEmailError";
    this.cause = args.cause;
    this.provider = args.provider;
    this.statusCode = args.statusCode;
  }
}

export interface SelectFieldOption {
  label: string;
  value: string;
}

export interface FieldConfig extends BaseFieldConfig {
  options?: SelectFieldOption[];
  relationTo?: string;
  schema?: FieldSchema;
  type: FieldType;
  validate?: FieldValidator;
}

export interface UploadConfig {
  maxFileSize?: number;
  mimeTypes?: string[];
}

export interface UploadInputFile {
  buffer: Uint8Array;
  filename: string;
  filesize: number;
  mimeType: string;
}

export interface StoredFileData {
  filename: string;
  filesize: number;
  mimeType: string;
  prefix?: string;
  providerMetadata?: Record<string, unknown>;
  storageAdapter: string;
  storageKey: string;
  url?: string;
}

export interface SendEmailAddressObject {
  address: string;
  name?: string;
}

export type SendEmailAddress = string | SendEmailAddressObject;

export type SendEmailAddressValue = SendEmailAddress | SendEmailAddress[];

export interface SendEmailAttachment {
  content: Buffer | Uint8Array | string;
  contentType?: string;
  filename: string;
}

export interface SendEmailOptions {
  attachments?: SendEmailAttachment[];
  bcc?: SendEmailAddressValue;
  cc?: SendEmailAddressValue;
  from?: SendEmailAddress;
  headers?: Record<string, string>;
  html?: string;
  replyTo?: SendEmailAddressValue;
  subject?: string;
  text?: string;
  to?: SendEmailAddressValue;
}

export interface InitializedEmailAdapter<TSendEmailResponse = unknown> {
  clients?: Record<string, unknown>;
  defaultFromAddress: string;
  defaultFromName: string;
  name: string;
  sendEmail: (
    message: SendEmailOptions
  ) => Promise<TSendEmailResponse> | TSendEmailResponse;
}

export type EmailAdapter<TSendEmailResponse = unknown> = (args: {
  oboe: OboeRuntime;
}) => InitializedEmailAdapter<TSendEmailResponse>;

export type StorageServeMode = "direct" | "proxy";

export type GenerateFileURL = (args: {
  collection: CollectionConfig;
  file: StoredFileData;
  req?: Request;
}) => Promise<string> | string;

export interface StorageAdapterUploadArgs {
  collection: CollectionConfig;
  data: Record<string, unknown>;
  file: UploadInputFile;
  req?: Request;
  user?: unknown;
}

export interface StorageAdapterDeleteArgs {
  collection: CollectionConfig;
  file: StoredFileData;
  req?: Request;
  user?: unknown;
}

export interface StorageAdapterDownloadArgs {
  collection: CollectionConfig;
  file: StoredFileData;
  req?: Request;
  user?: unknown;
}

export interface StorageAdapterGenerateURLArgs {
  collection: CollectionConfig;
  file: StoredFileData;
  req?: Request;
}

export interface GeneratedStorageAdapter {
  generateURL?: (
    args: StorageAdapterGenerateURLArgs
  ) => Promise<string> | string;
  handleDelete: (args: StorageAdapterDeleteArgs) => Promise<void> | void;
  handleDownload: (
    args: StorageAdapterDownloadArgs
  ) => Promise<Response> | Response;
  handleUpload: (
    args: StorageAdapterUploadArgs
  ) => Promise<StoredFileData> | StoredFileData;
  name: string;
  onInit?: () => Promise<void> | void;
}

export type StorageAdapterFactory = (args: {
  collection: CollectionConfig;
  prefix?: string;
  serveMode: StorageServeMode;
}) => GeneratedStorageAdapter;

export interface CollectionStorageConfig {
  adapter?: StorageAdapterFactory;
  generateFileURL?: GenerateFileURL;
  prefix?: string;
  serveMode?: StorageServeMode;
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
  schema?: CollectionSchema;
  slug: string;
  storage?: CollectionStorageConfig;
  upload?: boolean | UploadConfig;
  validate?: CollectionValidator;
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

export interface GraphQLConfig {
  mutations?: (args: {
    GraphQL: unknown;
    oboe: OboeRuntime;
  }) => Record<string, unknown>;
  queries?: (args: {
    GraphQL: unknown;
    oboe: OboeRuntime;
  }) => Record<string, unknown>;
}

export interface ServerFunctionContext<TInput = Record<string, unknown>> {
  input: TInput;
  oboe: OboeRuntime;
  req?: Request;
  user?: unknown;
}

export interface ServerFunctionRestConfig {
  method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  path?: string;
}

export interface ServerFunctionConfig<
  TInput = Record<string, unknown>,
  TOutput = unknown,
> {
  handler: (
    context: ServerFunctionContext<TInput>
  ) => Promise<TOutput> | TOutput;
  rest?: ServerFunctionRestConfig;
}

export interface OboeConfig {
  admin?: AdminConfig;
  auth?: AuthConfig;
  email?: EmailAdapter | Promise<EmailAdapter>;
  graphQL?: GraphQLConfig;
  jobs?: JobsConfig;
  modules: ModuleConfig[];
  plugins?: PluginConfig[];
  serverFunctions?: Record<string, ServerFunctionConfig>;
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

export type SortDirection = "asc" | "desc";

export type SortParam = string | string[];

export type SelectNode = boolean | SelectShape;

export interface SelectShape {
  [key: string]: SelectNode;
}

export interface FieldWhereOperators {
  contains?: string;
  endsWith?: string;
  eq?: unknown;
  exists?: boolean;
  gt?: number | string;
  gte?: number | string;
  in?: unknown[];
  like?: string;
  lt?: number | string;
  lte?: number | string;
  ne?: unknown;
  notIn?: unknown[];
  startsWith?: string;
}

export interface CollectionWhere {
  and?: CollectionWhere[];
  or?: CollectionWhere[];
  [field: string]: CollectionWhere[] | FieldWhereOperators | unknown;
}

export interface CollectionQuery {
  depth?: number;
  limit?: number;
  page?: number;
  pagination?: boolean;
  select?: SelectShape;
  sort?: SortParam;
  where?: CollectionWhere;
}

export interface OboeRecord {
  collection: string;
  createdAt: string;
  data: Record<string, unknown>;
  id: string;
  updatedAt: string;
}

export interface OboeDocument {
  createdAt: string;
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface FindResult<TDocument = OboeDocument> {
  docs: TDocument[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
  nextPage: number | null;
  page: number;
  pagingCounter: number;
  prevPage: number | null;
  totalDocs: number;
  totalPages: number;
}

export interface CountResult {
  totalDocs: number;
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
  callServerFunction: <
    TInput = Record<string, unknown>,
    TOutput = unknown,
  >(args: {
    input?: TInput;
    name: string;
    req?: Request;
    user?: unknown;
  }) => Promise<TOutput>;
  config: OboeConfig;
  count: (args: {
    collection: string;
    overrideAccess?: boolean;
    query?: Pick<CollectionQuery, "where">;
    req?: Request;
    user?: unknown;
  }) => Promise<CountResult>;
  create: (args: {
    collection: string;
    data: Record<string, unknown>;
    depth?: number;
    file?: UploadInputFile;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  }) => Promise<OboeDocument>;
  db: DatabaseAdapter;
  delete: (args: {
    collection: string;
    depth?: number;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  }) => Promise<OboeDocument | null>;
  downloadFile: (args: {
    collection: string;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    user?: unknown;
  }) => Promise<Response | null>;
  email: {
    getClient: <T = unknown>(name: string) => T | undefined;
  };
  events: EventBus;
  find: (args: {
    collection: string;
    overrideAccess?: boolean;
    query?: CollectionQuery;
    req?: Request;
    user?: unknown;
  }) => Promise<FindResult>;
  findById: (args: {
    collection: string;
    depth?: number;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  }) => Promise<OboeDocument | null>;
  graphql: GraphQLExecutor;
  initialize: () => Promise<void>;
  jobs: JobDispatcher;
  schema: CompiledSchema;
  sendEmail: (message: SendEmailOptions) => Promise<unknown>;
  setGraphQLExecutor: (executor: GraphQLExecutor) => void;
  update: (args: {
    collection: string;
    data: Record<string, unknown>;
    depth?: number;
    file?: UploadInputFile;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  }) => Promise<OboeDocument | null>;
}

export type CollectionOperation = "create" | "delete" | "read" | "update";
