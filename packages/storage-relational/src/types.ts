import type {
  AuditEntry,
  CollectionQuery,
  CompiledSchema,
  JobRequest,
} from "@oboe/core";

export interface RelationalStatement {
  params: unknown[];
  sql: string;
}

export interface RelationalQueryResult<TRow = Record<string, unknown>> {
  affectedRows?: number;
  lastInsertId?: bigint | number | string;
  rows: TRow[];
}

export interface RelationalQueryable {
  query: <TRow = Record<string, unknown>>(
    statement: RelationalStatement
  ) => Promise<RelationalQueryResult<TRow>>;
  transaction?: <T>(callback: (queryable: RelationalQueryable) => Promise<T>) => Promise<T>;
}

export interface RelationalDialectCapabilities {
  jsonContains: boolean;
  jsonMerge: boolean;
  nativeReturning: boolean;
  partialIndexes: boolean;
  transactionSupport: boolean;
}

export interface RelationalManifest {
  checksum: string;
  schemaChecksum: string;
  storageVersion: 1;
}

export interface RelationalMigration {
  dialect: string;
  id: string;
  manifest: RelationalManifest;
  name: string;
}

export interface AppliedRelationalMigration extends RelationalMigration {
  appliedAt: string;
}

export interface RelationalDialect {
  capabilities: RelationalDialectCapabilities;
  name: string;
  buildBootstrapStatements: (args: {
    manifest: RelationalManifest;
  }) => RelationalStatement[];
  buildCreateRecordStatement: (args: {
    collection: string;
    data: Record<string, unknown>;
    id: string;
    returning: boolean;
  }) => RelationalStatement;
  buildDeleteRecordStatement: (args: {
    collection: string;
    id: string;
    returning: boolean;
  }) => RelationalStatement;
  buildEnqueueJobStatement: (job: JobRequest) => RelationalStatement;
  buildFindRecordByIdStatement: (args: {
    collection: string;
    id: string;
  }) => RelationalStatement;
  buildFindRecordsStatement: (args: {
    collection: string;
    query?: CollectionQuery;
  }) => RelationalStatement;
  buildInsertAppliedMigrationStatement: (
    migration: AppliedRelationalMigration
  ) => RelationalStatement;
  buildJsonSupportStatement?: () => RelationalStatement;
  buildListAppliedMigrationsStatement: () => RelationalStatement;
  buildMigrationTableExistsStatement: () => RelationalStatement;
  buildRecordAuditStatement: (entry: AuditEntry) => RelationalStatement;
  buildUpdateRecordStatement: (args: {
    collection: string;
    data: Record<string, unknown>;
    id: string;
    returning: boolean;
  }) => RelationalStatement;
}

export interface RelationalInitializationOptions {
  environment?: "development" | "production";
  schema: CompiledSchema;
}
