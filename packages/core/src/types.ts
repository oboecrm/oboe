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
  collection?: CollectionConfig;
  data: Record<string, unknown>;
  field: FieldConfig;
  global?: GlobalConfig;
  operation: FieldHookOperation;
  originalDoc?: OboeGlobalRecord | OboeRecord | null;
  path: string[];
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

export interface GlobalValidationContext {
  data: Record<string, unknown>;
  global: GlobalConfig;
  operation: "update";
  originalDoc?: OboeGlobalRecord | null;
  req?: Request;
  user?: unknown;
}

export type FieldSchema =
  | SchemaAdapter<FieldValidationContext>
  | StandardSchemaLike;

export type CollectionSchema =
  | SchemaAdapter<CollectionValidationContext, Record<string, unknown>>
  | StandardSchemaLike<Record<string, unknown>>;

export type GlobalSchema =
  | SchemaAdapter<GlobalValidationContext, Record<string, unknown>>
  | StandardSchemaLike<Record<string, unknown>>;

export type FieldValidator = (args: {
  context: FieldValidationContext;
  value: unknown;
}) => ValidationIssueResult | Promise<ValidationIssueResult>;

export type CollectionValidator = (args: {
  context: CollectionValidationContext;
  data: Record<string, unknown>;
}) => ValidationIssueResult | Promise<ValidationIssueResult>;

export type GlobalValidator = (args: {
  context: GlobalValidationContext;
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
  hooks?: FieldHooks;
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

export interface RawComponentReference {
  exportName?: string;
  path: string;
}

export type ComponentReference = RawComponentReference | string;

export interface AdminViewConfig {
  component: ComponentReference;
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

export interface GlobalAccessContext {
  action: GlobalOperation;
  data?: Record<string, unknown>;
  global: GlobalConfig;
  req?: Request;
  user?: unknown;
}

export type GlobalAccessResolver = (
  context: GlobalAccessContext
) => boolean | Promise<boolean>;

export interface HookContext extends Record<string, unknown> {}

export interface HookArgsBase {
  context: HookContext;
  oboe: OboeRuntime;
  req?: Request;
  user?: unknown;
}

export interface CollectionHookArgsBase extends HookArgsBase {
  collection: CollectionConfig;
  operation: CollectionOperation;
}

export interface CollectionBeforeOperationHookArgs
  extends CollectionHookArgsBase {
  args: Record<string, unknown>;
}

export type CollectionBeforeOperationHook = (
  args: CollectionBeforeOperationHookArgs
) => void | Promise<void>;

export interface CollectionBeforeValidateHookArgs
  extends CollectionHookArgsBase {
  data: Record<string, unknown>;
  originalDoc?: OboeRecord | null;
}

export type CollectionBeforeValidateHook = (
  args: CollectionBeforeValidateHookArgs
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface CollectionBeforeChangeHookArgs extends CollectionHookArgsBase {
  data: Record<string, unknown>;
  originalDoc?: OboeRecord | null;
}

export type CollectionBeforeChangeHook = (
  args: CollectionBeforeChangeHookArgs
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface CollectionAfterChangeHookArgs extends CollectionHookArgsBase {
  doc: OboeRecord;
  originalDoc?: OboeRecord | null;
}

export type CollectionAfterChangeHook = (
  args: CollectionAfterChangeHookArgs
) => OboeRecord | Promise<OboeRecord>;

export interface CollectionReadHookArgs extends CollectionHookArgsBase {
  doc: OboeRecord;
}

export type CollectionBeforeReadHook = (
  args: CollectionReadHookArgs
) => OboeRecord | Promise<OboeRecord>;

export type CollectionAfterReadHook = (
  args: CollectionReadHookArgs
) => OboeRecord | Promise<OboeRecord>;

export interface CollectionDeleteHookArgs extends CollectionHookArgsBase {
  doc: OboeRecord;
}

export type CollectionBeforeDeleteHook = (
  args: CollectionDeleteHookArgs
) => OboeRecord | Promise<OboeRecord>;

export type CollectionAfterDeleteHook = (
  args: CollectionDeleteHookArgs
) => OboeRecord | Promise<OboeRecord>;

export interface CollectionAfterOperationHookArgs
  extends CollectionHookArgsBase {
  args: Record<string, unknown>;
  result: unknown;
}

export type CollectionAfterOperationHook = (
  args: CollectionAfterOperationHookArgs
) => unknown | Promise<unknown>;

export interface GlobalHookArgsBase extends HookArgsBase {
  global: GlobalConfig;
  operation: GlobalOperation;
}

export interface GlobalBeforeOperationHookArgs extends GlobalHookArgsBase {
  args: Record<string, unknown>;
}

export type GlobalBeforeOperationHook = (
  args: GlobalBeforeOperationHookArgs
) => void | Promise<void>;

export interface GlobalBeforeValidateHookArgs extends GlobalHookArgsBase {
  data: Record<string, unknown>;
  originalDoc?: OboeGlobalRecord | null;
}

export type GlobalBeforeValidateHook = (
  args: GlobalBeforeValidateHookArgs
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface GlobalBeforeChangeHookArgs extends GlobalHookArgsBase {
  data: Record<string, unknown>;
  originalDoc?: OboeGlobalRecord | null;
}

export type GlobalBeforeChangeHook = (
  args: GlobalBeforeChangeHookArgs
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface GlobalAfterChangeHookArgs extends GlobalHookArgsBase {
  doc: OboeGlobalRecord;
  originalDoc?: OboeGlobalRecord | null;
}

export type GlobalAfterChangeHook = (
  args: GlobalAfterChangeHookArgs
) => OboeGlobalRecord | Promise<OboeGlobalRecord>;

export interface GlobalReadHookArgs extends GlobalHookArgsBase {
  doc: OboeGlobalRecord;
}

export type GlobalBeforeReadHook = (
  args: GlobalReadHookArgs
) => OboeGlobalRecord | Promise<OboeGlobalRecord>;

export type GlobalAfterReadHook = (
  args: GlobalReadHookArgs
) => OboeGlobalRecord | Promise<OboeGlobalRecord>;

export interface GlobalAfterOperationHookArgs extends GlobalHookArgsBase {
  args: Record<string, unknown>;
  result: unknown;
}

export type GlobalAfterOperationHook = (
  args: GlobalAfterOperationHookArgs
) => unknown | Promise<unknown>;

export interface FieldHookScope {
  collection?: CollectionConfig;
  global?: GlobalConfig;
}

export interface FieldHookArgsBase extends FieldHookScope, HookArgsBase {
  data: Record<string, unknown>;
  field: FieldConfig;
  operation: FieldHookOperation;
  originalDoc?: OboeGlobalRecord | OboeRecord | null;
  path: string[];
  siblingData: Record<string, unknown>;
  value: unknown;
}

export type FieldBeforeValidateHook = (
  args: FieldHookArgsBase
) => unknown | Promise<unknown>;

export type FieldBeforeChangeHook = (
  args: FieldHookArgsBase
) => unknown | Promise<unknown>;

export type FieldAfterChangeHook = (
  args: FieldHookArgsBase
) => unknown | Promise<unknown>;

export type FieldAfterReadHook = (
  args: FieldHookArgsBase
) => unknown | Promise<unknown>;

export interface FieldHooks {
  afterChange?: FieldAfterChangeHook[];
  afterRead?: FieldAfterReadHook[];
  beforeChange?: FieldBeforeChangeHook[];
  beforeValidate?: FieldBeforeValidateHook[];
}

export interface CollectionHooks {
  afterChange?: CollectionAfterChangeHook[];
  afterDelete?: CollectionAfterDeleteHook[];
  afterOperation?: CollectionAfterOperationHook[];
  afterRead?: CollectionAfterReadHook[];
  beforeChange?: CollectionBeforeChangeHook[];
  beforeDelete?: CollectionBeforeDeleteHook[];
  beforeOperation?: CollectionBeforeOperationHook[];
  beforeRead?: CollectionBeforeReadHook[];
  beforeValidate?: CollectionBeforeValidateHook[];
}

export interface GlobalHooks {
  afterChange?: GlobalAfterChangeHook[];
  afterOperation?: GlobalAfterOperationHook[];
  afterRead?: GlobalAfterReadHook[];
  beforeChange?: GlobalBeforeChangeHook[];
  beforeOperation?: GlobalBeforeOperationHook[];
  beforeRead?: GlobalBeforeReadHook[];
  beforeValidate?: GlobalBeforeValidateHook[];
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
  access?: Partial<Record<GlobalOperation, GlobalAccessResolver>>;
  fields: FieldConfig[];
  hooks?: GlobalHooks;
  schema?: GlobalSchema;
  slug: string;
  validate?: GlobalValidator;
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

export interface HttpRouteContext {
  runtime: OboeRuntime;
}

export interface HttpRouteConfig {
  handler: (
    request: Request,
    context: HttpRouteContext
  ) => Promise<Response> | Response;
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  path: string;
}

export interface HttpConfig {
  routes?: HttpRouteConfig[];
}

export interface AdminConfig {
  actions?: Record<string, AdminActionConfig>;
  components?: Record<string, ComponentReference>;
  views?: Record<string, AdminViewConfig>;
}

export interface AuthConfig {
  collection?: string;
}

export type ProcessingOrder = "-createdAt" | "createdAt";

export interface JobLogEntry {
  createdAt: string;
  message: string;
}

export type JobStatus = "completed" | "failed" | "processing" | "queued";

export interface TaskConcurrencyConfig<
  TInput = Record<string, unknown>,
  TSlug extends string = string,
> {
  key: (args: {
    input: TInput;
    req?: Request;
    task: TaskConfig<TSlug, TInput>;
  }) => string | null;
}

export interface TaskSuccessContext<
  TInput = Record<string, unknown>,
  TOutput = Record<string, unknown>,
> {
  input: TInput;
  job: Job;
  oboe: OboeRuntime;
  output: TOutput;
  req?: Request;
}

export interface TaskFailureContext<TInput = Record<string, unknown>> {
  error: Error;
  input: TInput;
  job: Job;
  oboe: OboeRuntime;
  req?: Request;
}

export interface TaskHandlerContext<
  TInput = Record<string, unknown>,
  TSlug extends string = string,
> {
  input: TInput;
  job: Job;
  oboe: OboeRuntime;
  req?: Request;
  task: TaskConfig<TSlug, TInput>;
}

export interface TaskConfig<
  TSlug extends string = string,
  TInput = Record<string, unknown>,
  TOutput = Record<string, unknown>,
> {
  concurrency?: TaskConcurrencyConfig<TInput, TSlug>;
  handler: (context: TaskHandlerContext<TInput, TSlug>) =>
    | Promise<
        | {
            output?: TOutput;
          }
        | undefined
      >
    | {
        output?: TOutput;
      }
    | undefined;
  inputSchema?: FieldConfig[];
  interfaceName?: string;
  label?: string;
  onFail?: (context: TaskFailureContext<TInput>) => Promise<void> | void;
  onSuccess?: (
    context: TaskSuccessContext<TInput, TOutput>
  ) => Promise<void> | void;
  outputSchema?: FieldConfig[];
  retries?: number;
  slug: TSlug;
}

export interface JobsConfig {
  defaultRetries?: number;
  processingOrder?:
    | ProcessingOrder
    | {
        default: ProcessingOrder;
        queues?: Record<string, ProcessingOrder>;
      }
    | ((args: { queue: string }) => ProcessingOrder);
  retryLimit?: number;
  tasks?: TaskConfig[];
}

export interface TypeScriptConfig {
  autoGenerate?: boolean;
  declare?: boolean;
  outputFile?: string;
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
  http?: HttpConfig;
  jobs?: JobsConfig;
  modules: ModuleConfig[];
  plugins?: PluginConfig[];
  serverFunctions?: Record<string, ServerFunctionConfig>;
  typescript?: TypeScriptConfig;
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

export interface OboeGlobalRecord {
  createdAt: string;
  data: Record<string, unknown>;
  slug: string;
  updatedAt: string;
}

export interface OboeGlobalDocument {
  createdAt: string;
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

export interface BaseGeneratedTypes {
  collectionInputs: Record<string, Record<string, unknown>>;
  collections: Record<string, OboeDocument>;
  globalInputs: Record<string, Record<string, unknown>>;
  globals: Record<string, OboeGlobalDocument>;
  taskInputs: Record<string, Record<string, unknown>>;
  taskOutputs: Record<string, Record<string, unknown>>;
}

// biome-ignore lint/suspicious/noEmptyInterface: declaration merging anchor for generated types
export interface GeneratedTypes {}

type GeneratedCollections<TGeneratedTypes extends Partial<BaseGeneratedTypes>> =
  TGeneratedTypes extends {
    collections: infer TCollections;
  }
    ? TCollections extends object
      ? TCollections
      : Record<string, OboeDocument>
    : Record<string, OboeDocument>;

type GeneratedCollectionInputs<
  TGeneratedTypes extends Partial<BaseGeneratedTypes>,
> = TGeneratedTypes extends {
  collectionInputs: infer TInputs;
}
  ? TInputs extends object
    ? TInputs
    : Record<string, Record<string, unknown>>
  : Record<string, Record<string, unknown>>;

type GeneratedGlobals<TGeneratedTypes extends Partial<BaseGeneratedTypes>> =
  TGeneratedTypes extends {
    globals: infer TGlobals;
  }
    ? TGlobals extends object
      ? TGlobals
      : Record<string, OboeGlobalDocument>
    : Record<string, OboeGlobalDocument>;

type GeneratedGlobalInputs<
  TGeneratedTypes extends Partial<BaseGeneratedTypes>,
> = TGeneratedTypes extends {
  globalInputs: infer TInputs;
}
  ? TInputs extends object
    ? TInputs
    : Record<string, Record<string, unknown>>
  : Record<string, Record<string, unknown>>;

type GeneratedTaskInputs<TGeneratedTypes extends Partial<BaseGeneratedTypes>> =
  TGeneratedTypes extends {
    taskInputs: infer TInputs;
  }
    ? TInputs extends object
      ? TInputs
      : Record<string, Record<string, unknown>>
    : Record<string, Record<string, unknown>>;

type GeneratedTaskOutputs<TGeneratedTypes extends Partial<BaseGeneratedTypes>> =
  TGeneratedTypes extends {
    taskOutputs: infer TOutputs;
  }
    ? TOutputs extends object
      ? TOutputs
      : Record<string, Record<string, unknown>>
    : Record<string, Record<string, unknown>>;

export type CollectionDocumentForSlug<
  TGeneratedTypes extends Partial<BaseGeneratedTypes>,
  TSlug extends string,
> = TSlug extends keyof GeneratedCollections<TGeneratedTypes>
  ? GeneratedCollections<TGeneratedTypes>[TSlug]
  : OboeDocument;

export type CollectionInputForSlug<
  TGeneratedTypes extends Partial<BaseGeneratedTypes>,
  TSlug extends string,
> = TSlug extends keyof GeneratedCollectionInputs<TGeneratedTypes>
  ? GeneratedCollectionInputs<TGeneratedTypes>[TSlug]
  : Record<string, unknown>;

export type GlobalDocumentForSlug<
  TGeneratedTypes extends Partial<BaseGeneratedTypes>,
  TSlug extends string,
> = TSlug extends keyof GeneratedGlobals<TGeneratedTypes>
  ? GeneratedGlobals<TGeneratedTypes>[TSlug]
  : OboeGlobalDocument;

export type GlobalInputForSlug<
  TGeneratedTypes extends Partial<BaseGeneratedTypes>,
  TSlug extends string,
> = TSlug extends keyof GeneratedGlobalInputs<TGeneratedTypes>
  ? GeneratedGlobalInputs<TGeneratedTypes>[TSlug]
  : Record<string, unknown>;

export type TaskInputForSlug<
  TGeneratedTypes extends Partial<BaseGeneratedTypes>,
  TSlug extends string,
> = TSlug extends keyof GeneratedTaskInputs<TGeneratedTypes>
  ? GeneratedTaskInputs<TGeneratedTypes>[TSlug]
  : Record<string, unknown>;

export type TaskOutputForSlug<
  TGeneratedTypes extends Partial<BaseGeneratedTypes>,
  TSlug extends string,
> = TSlug extends keyof GeneratedTaskOutputs<TGeneratedTypes>
  ? GeneratedTaskOutputs<TGeneratedTypes>[TSlug]
  : Record<string, unknown>;

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

export interface Job {
  attempt: number;
  completedAt: string | null;
  concurrencyKey: string | null;
  createdAt: string;
  id: string;
  idempotencyKey: string | null;
  input: Record<string, unknown>;
  lastError: string | null;
  log: JobLogEntry[];
  maxRetries: number;
  output: Record<string, unknown> | null;
  queue: string;
  startedAt: string | null;
  status: JobStatus;
  task: string;
  updatedAt: string;
  waitUntil: string;
}

export interface QueueJobRequest {
  idempotencyKey?: string;
  input: Record<string, unknown>;
  log?: JobLogEntry[];
  processingOrder?: ProcessingOrder;
  queue?: string;
  req?: Request;
  task: string;
  waitUntil?: Date | string;
}

export interface QueueJobArgs<
  TGeneratedTypes extends Partial<BaseGeneratedTypes>,
  TTask extends string,
> extends Omit<QueueJobRequest, "input" | "task"> {
  input: TaskInputForSlug<TGeneratedTypes, TTask>;
  task: TTask;
}

export interface RunJobsArgs {
  allQueues?: boolean;
  limit?: number;
  processingOrder?: ProcessingOrder;
  queue?: string;
}

export interface RunJobsResult {
  remaining: number;
  total: number;
}

export interface QueueableJob {
  concurrencyKey?: string | null;
  id: string;
  idempotencyKey?: string | null;
  input: Record<string, unknown>;
  log?: JobLogEntry[];
  maxRetries: number;
  processingOrder?: ProcessingOrder;
  queue: string;
  status?: JobStatus;
  task: string;
  waitUntil: string;
}

export interface ClaimJobsArgs {
  allQueues?: boolean;
  limit?: number;
  processingOrder?: ProcessingOrder;
  queue?: string;
}

export interface CompleteJobArgs {
  id: string;
  log?: JobLogEntry[];
  output?: Record<string, unknown>;
}

export interface FailJobArgs {
  error: string;
  id: string;
  log?: JobLogEntry[];
  retry: boolean;
}

export interface AppendJobLogArgs {
  entries: JobLogEntry[];
  id: string;
}

export interface CountJobsArgs {
  allQueues?: boolean;
  queue?: string;
}

export interface GraphQLExecutor {
  execute: (args: {
    query: string;
    variables?: Record<string, unknown>;
  }) => Promise<unknown>;
}

export interface JobDispatcher<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
> {
  enqueue: (job: JobRequest) => Promise<void>;
  queue: <TTask extends string>(
    job: QueueJobArgs<TGeneratedTypes, TTask>
  ) => Promise<Job>;
  run: (args?: RunJobsArgs) => Promise<RunJobsResult>;
}

export interface EventBus {
  emit: (name: string, payload: Record<string, unknown>) => Promise<void>;
  on: (
    name: string,
    listener: (payload: Record<string, unknown>) => void | Promise<void>
  ) => () => void;
}

export interface DatabaseAdapter {
  appendJobLog?: (args: AppendJobLogArgs) => Promise<Job | null>;
  claimJobs?: (args: ClaimJobsArgs) => Promise<Job[]>;
  completeJob?: (args: CompleteJobArgs) => Promise<Job | null>;
  countRunnableOrActiveJobs?: (args?: CountJobsArgs) => Promise<number>;
  create: (args: {
    collection: string;
    data: Record<string, unknown>;
  }) => Promise<OboeRecord>;
  delete: (args: {
    collection: string;
    id: string;
  }) => Promise<OboeRecord | null>;
  enqueueJob?: (job: JobRequest) => Promise<void>;
  failJob?: (args: FailJobArgs) => Promise<Job | null>;
  find: (args: {
    collection: string;
    query?: CollectionQuery;
  }) => Promise<OboeRecord[]>;
  findById: (args: {
    collection: string;
    id: string;
  }) => Promise<OboeRecord | null>;
  findGlobal: (args: { slug: string }) => Promise<OboeGlobalRecord | null>;
  initialize?: (schema: CompiledSchema) => Promise<void>;
  queueJob?: (job: QueueableJob) => Promise<Job>;
  recordAudit?: (entry: AuditEntry) => Promise<void>;
  transaction?: <T>(
    callback: (adapter: DatabaseAdapter) => Promise<T>
  ) => Promise<T>;
  update: (args: {
    collection: string;
    data: Record<string, unknown>;
    id: string;
  }) => Promise<OboeRecord | null>;
  updateGlobal: (args: {
    data: Record<string, unknown>;
    slug: string;
  }) => Promise<OboeGlobalRecord>;
}

export interface OboeRuntime<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
> {
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
  count: <TSlug extends string>(args: {
    collection: TSlug;
    overrideAccess?: boolean;
    query?: Pick<CollectionQuery, "where">;
    req?: Request;
    user?: unknown;
  }) => Promise<CountResult>;
  create: <TSlug extends string>(args: {
    collection: TSlug;
    data: CollectionInputForSlug<TGeneratedTypes, TSlug>;
    depth?: number;
    file?: UploadInputFile;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  }) => Promise<CollectionDocumentForSlug<TGeneratedTypes, TSlug>>;
  db: DatabaseAdapter;
  delete: <TSlug extends string>(args: {
    collection: TSlug;
    depth?: number;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  }) => Promise<CollectionDocumentForSlug<TGeneratedTypes, TSlug> | null>;
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
  find: <TSlug extends string>(args: {
    collection: TSlug;
    overrideAccess?: boolean;
    query?: CollectionQuery;
    req?: Request;
    user?: unknown;
  }) => Promise<FindResult<CollectionDocumentForSlug<TGeneratedTypes, TSlug>>>;
  findById: <TSlug extends string>(args: {
    collection: TSlug;
    depth?: number;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  }) => Promise<CollectionDocumentForSlug<TGeneratedTypes, TSlug> | null>;
  findGlobal: <TSlug extends string>(args: {
    req?: Request;
    slug: TSlug;
    user?: unknown;
  }) => Promise<GlobalDocumentForSlug<TGeneratedTypes, TSlug> | null>;
  graphql: GraphQLExecutor;
  initialize: () => Promise<void>;
  jobs: JobDispatcher<TGeneratedTypes>;
  schema: CompiledSchema;
  sendEmail: (message: SendEmailOptions) => Promise<unknown>;
  setGraphQLExecutor: (executor: GraphQLExecutor) => void;
  update: <TSlug extends string>(args: {
    collection: TSlug;
    data: Partial<CollectionInputForSlug<TGeneratedTypes, TSlug>>;
    depth?: number;
    file?: UploadInputFile;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  }) => Promise<CollectionDocumentForSlug<TGeneratedTypes, TSlug> | null>;
  updateGlobal: <TSlug extends string>(args: {
    data: GlobalInputForSlug<TGeneratedTypes, TSlug>;
    req?: Request;
    slug: TSlug;
    user?: unknown;
  }) => Promise<GlobalDocumentForSlug<TGeneratedTypes, TSlug>>;
}

export type CollectionOperation = "create" | "delete" | "read" | "update";
export type GlobalOperation = "read" | "update";
export type FieldHookOperation = "create" | "read" | "update";
