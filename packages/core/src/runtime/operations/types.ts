import type {
  BaseGeneratedTypes,
  CollectionDocumentForSlug,
  CollectionHookArgsBase,
  CollectionInputForSlug,
  CollectionQuery,
  CompiledCollection,
  CountResult,
  DatabaseAdapter,
  EventBus,
  FindResult,
  GeneratedTypes,
  HookContext,
  OboeDocument,
  OboeRecord,
  OboeRuntime,
  SelectShape,
  StoredFileData,
  UploadInputFile,
} from "../../types.js";

export interface MaterializeDocumentArgs {
  collectionSlug: string;
  context: HookContext;
  depth?: number;
  overrideAccess?: boolean;
  record: OboeRecord;
  req?: Request;
  select?: SelectShape;
  user?: unknown;
}

export interface CollectionRuntimeOperationDeps<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
> {
  canAccess: (args: {
    collection: CompiledCollection;
    data?: Record<string, unknown>;
    id?: string;
    operation: "create" | "delete" | "read" | "update";
    overrideAccess?: boolean;
    req?: Request;
    user?: unknown;
  }) => Promise<boolean>;
  cleanupUploadedFile: (args: {
    collection: CompiledCollection;
    file?: StoredFileData | null;
    req?: Request;
    user?: unknown;
  }) => Promise<void>;
  cloneRecord: (record: OboeRecord) => OboeRecord;
  collectionHookBase: (args: {
    collection: CompiledCollection;
    context: HookContext;
    oboe: OboeRuntime<TGeneratedTypes>;
    operation: "delete";
    req?: Request;
    user?: unknown;
  }) => CollectionHookArgsBase;
  countRecords: (records: OboeRecord[]) => CountResult;
  db: DatabaseAdapter;
  events: EventBus;
  filterRecords: (
    records: OboeRecord[],
    query?: CollectionQuery
  ) => OboeRecord[];
  paginateDocuments: (
    records: OboeRecord[],
    query?: CollectionQuery
  ) => {
    docs: OboeRecord[];
    hasNextPage: boolean;
    hasPrevPage: boolean;
    limit: number;
    nextPage: number | null;
    page: number;
    pagingCounter: number;
    prevPage: number | null;
    totalDocs: number;
    totalPages: number;
  };
  getStoredFileData: (value: unknown) => StoredFileData | null;
  loadVisibleRecord: (args: {
    collectionSlug: string;
    context: HookContext;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    user?: unknown;
  }) => Promise<OboeRecord | null>;
  materializeDocument: (args: MaterializeDocumentArgs) => Promise<OboeDocument>;
  prepareValidatedData: (args: {
    collection: CompiledCollection;
    context: HookContext;
    data: Record<string, unknown>;
    file?: UploadInputFile;
    operation: "create" | "update";
    originalDoc?: OboeRecord | null;
    req?: Request;
    user?: unknown;
  }) => Promise<Record<string, unknown>>;
  runAfterChange: (args: {
    collection: CompiledCollection;
    context: HookContext;
    doc: OboeRecord;
    oboe: OboeRuntime<TGeneratedTypes>;
    operation: "create" | "update";
    originalDoc?: OboeRecord | null;
    req?: Request;
    user?: unknown;
  }) => Promise<OboeRecord>;
  runCollectionAfterOperation: <TResult>(args: {
    collection: CompiledCollection;
    context: HookContext;
    hookArgs: Record<string, unknown>;
    oboe: OboeRuntime<TGeneratedTypes>;
    operation: "create" | "delete" | "read" | "update";
    req?: Request;
    result: TResult;
    user?: unknown;
  }) => Promise<TResult>;
  runCollectionBeforeOperation: (args: {
    collection: CompiledCollection;
    context: HookContext;
    hookArgs: Record<string, unknown>;
    oboe: OboeRuntime<TGeneratedTypes>;
    operation: "create" | "delete" | "read" | "update";
    req?: Request;
    user?: unknown;
  }) => Promise<void>;
  runCollectionReadPipeline: (args: {
    collection: CompiledCollection;
    context: HookContext;
    doc: OboeRecord;
    oboe: OboeRuntime<TGeneratedTypes>;
    operation: "create" | "read" | "update";
    req?: Request;
    user?: unknown;
  }) => Promise<OboeRecord>;
  runFieldHookPhase: (args: {
    collection: CompiledCollection;
    context: HookContext;
    data: Record<string, unknown>;
    fields: CompiledCollection["fields"];
    hookName: "afterChange";
    oboe: OboeRuntime<TGeneratedTypes>;
    operation: "create" | "update";
    originalDoc?: OboeRecord | null;
    req?: Request;
    user?: unknown;
  }) => Promise<Record<string, unknown>>;
  runtime: OboeRuntime<TGeneratedTypes>;
  uploadCollectionFile: (args: {
    collection: CompiledCollection;
    data: Record<string, unknown>;
    file?: UploadInputFile;
    req?: Request;
    user?: unknown;
  }) => Promise<StoredFileData | null>;
}

export interface CountCollectionOperationArgs<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
> {
  callArgs: {
    collection: TSlug;
    overrideAccess?: boolean;
    query?: Pick<CollectionQuery, "where">;
    req?: Request;
    user?: unknown;
  };
  collectionConfig: CompiledCollection;
  deps: CollectionRuntimeOperationDeps<TGeneratedTypes>;
}

export interface FindCollectionOperationArgs<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
> {
  callArgs: {
    collection: TSlug;
    overrideAccess?: boolean;
    query?: CollectionQuery;
    req?: Request;
    user?: unknown;
  };
  collectionConfig: CompiledCollection;
  context: HookContext;
  deps: CollectionRuntimeOperationDeps<TGeneratedTypes>;
}

export interface FindByIdCollectionOperationArgs<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
> {
  callArgs: {
    collection: TSlug;
    depth?: number;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  };
  collectionConfig: CompiledCollection;
  context: HookContext;
  deps: CollectionRuntimeOperationDeps<TGeneratedTypes>;
}

export interface CreateCollectionOperationArgs<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
> {
  callArgs: {
    collection: TSlug;
    data: CollectionInputForSlug<TGeneratedTypes, TSlug>;
    depth?: number;
    file?: UploadInputFile;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  };
  collectionConfig: CompiledCollection;
  context: HookContext;
  deps: CollectionRuntimeOperationDeps<TGeneratedTypes>;
}

export interface UpdateCollectionOperationArgs<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
> {
  callArgs: {
    collection: TSlug;
    data: Partial<CollectionInputForSlug<TGeneratedTypes, TSlug>>;
    depth?: number;
    file?: UploadInputFile;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  };
  collectionConfig: CompiledCollection;
  context: HookContext;
  deps: CollectionRuntimeOperationDeps<TGeneratedTypes>;
}

export interface DeleteCollectionOperationArgs<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
> {
  callArgs: {
    collection: TSlug;
    depth?: number;
    id: string;
    overrideAccess?: boolean;
    req?: Request;
    select?: SelectShape;
    user?: unknown;
  };
  collectionConfig: CompiledCollection;
  context: HookContext;
  deps: CollectionRuntimeOperationDeps<TGeneratedTypes>;
}

export type FindCollectionOperationResult<
  TGeneratedTypes extends Partial<BaseGeneratedTypes>,
  TSlug extends string,
> = FindResult<CollectionDocumentForSlug<TGeneratedTypes, TSlug>>;
