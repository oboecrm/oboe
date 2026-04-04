import type { AuditEntry, CollectionQuery, JobRequest } from "@oboe/core";
import type {
  AppliedRelationalMigration,
  RelationalDialect,
  RelationalStatement,
} from "@oboe/storage-relational";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  QueryBuilder,
  SQLiteSyncDialect,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  SQLiteDeleteBase,
  SQLiteInsertBuilder,
  SQLiteUpdateBuilder,
} from "drizzle-orm/sqlite-core/query-builders";

const dialect = new SQLiteSyncDialect();
const queryBuilder = new QueryBuilder(dialect);
const session = {} as never;

const oboeRecords = sqliteTable(
  "oboe_records",
  {
    id: text("id").primaryKey(),
    collection: text("collection").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("oboe_records_collection_idx").on(table.collection)]
);

const oboeAuditLog = sqliteTable("oboe_audit_log", {
  actor: text("actor", { mode: "json" }),
  collection: text("collection").notNull(),
  id: integer("id").primaryKey({ autoIncrement: true }),
  occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  operation: text("operation").notNull(),
  payload: text("payload", { mode: "json" }),
  recordId: text("record_id").notNull(),
});

const oboeJobOutbox = sqliteTable(
  "oboe_job_outbox",
  {
    attempts: integer("attempts").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    id: integer("id").primaryKey({ autoIncrement: true }),
    idempotencyKey: text("idempotency_key"),
    name: text("name").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    runAt: text("run_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("oboe_job_outbox_idempotency_idx").on(table.idempotencyKey),
  ]
);

const oboeMigrations = sqliteTable("oboe_migrations", {
  appliedAt: text("applied_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  dialect: text("dialect").notNull(),
  id: text("id").primaryKey(),
  manifest: text("manifest", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  manifestChecksum: text("manifest_checksum").notNull(),
  name: text("name").notNull(),
});

const recordSelection = {
  collection: oboeRecords.collection,
  created_at: oboeRecords.createdAt,
  data: oboeRecords.data,
  id: oboeRecords.id,
  updated_at: oboeRecords.updatedAt,
};

function toStatement(statement: { params: unknown[]; sql: string }): RelationalStatement {
  return {
    params: statement.params,
    sql: statement.sql,
  };
}

function buildWhereClause(collection: string, query?: CollectionQuery) {
  const conditions = [eq(oboeRecords.collection, collection)];

  for (const [key, value] of Object.entries(query?.where ?? {})) {
    conditions.push(
      sql`json_extract(${oboeRecords.data}, ${`$.${key}`}) = json_extract(${JSON.stringify(
        value
      )}, '$')`
    );
  }

  return and(...conditions);
}

const bootstrapStatements = [
  `
CREATE TABLE IF NOT EXISTS oboe_records (
  id text PRIMARY KEY,
  collection text NOT NULL,
  data text NOT NULL,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);`.trim(),
  `
CREATE INDEX IF NOT EXISTS oboe_records_collection_idx
  ON oboe_records (collection);`.trim(),
  `
CREATE TABLE IF NOT EXISTS oboe_audit_log (
  id integer PRIMARY KEY AUTOINCREMENT,
  collection text NOT NULL,
  record_id text NOT NULL,
  operation text NOT NULL,
  actor text,
  payload text,
  occurred_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);`.trim(),
  `
CREATE TABLE IF NOT EXISTS oboe_job_outbox (
  id integer PRIMARY KEY AUTOINCREMENT,
  name text NOT NULL,
  payload text NOT NULL,
  idempotency_key text,
  attempts integer NOT NULL DEFAULT 1,
  run_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);`.trim(),
  `
CREATE UNIQUE INDEX IF NOT EXISTS oboe_job_outbox_idempotency_idx
  ON oboe_job_outbox (idempotency_key);`.trim(),
  `
CREATE TABLE IF NOT EXISTS oboe_migrations (
  id text PRIMARY KEY,
  name text NOT NULL,
  dialect text NOT NULL,
  manifest_checksum text NOT NULL,
  manifest text NOT NULL,
  applied_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
);`.trim(),
];

export const bootstrapSql = bootstrapStatements.join("\n\n");

export const sqliteDialect: RelationalDialect = {
  capabilities: {
    jsonContains: true,
    jsonMerge: true,
    nativeReturning: false,
    partialIndexes: false,
    transactionSupport: true,
  },
  name: "sqlite",
  buildBootstrapStatements() {
    return bootstrapStatements.map((statement) => ({
      params: [],
      sql: statement,
    }));
  },
  buildCreateRecordStatement(args) {
    return toStatement(
      new SQLiteInsertBuilder(oboeRecords, session, dialect)
        .values({
          collection: args.collection,
          data: args.data,
          id: args.id,
        })
        .toSQL()
    );
  },
  buildDeleteRecordStatement(args) {
    return toStatement(
      new SQLiteDeleteBase(oboeRecords, session, dialect)
        .where(and(eq(oboeRecords.collection, args.collection), eq(oboeRecords.id, args.id)))
        .toSQL()
    );
  },
  buildEnqueueJobStatement(job: JobRequest) {
    return toStatement(
      new SQLiteInsertBuilder(oboeJobOutbox, session, dialect)
        .values({
          attempts: job.attempts ?? 1,
          idempotencyKey: job.idempotencyKey ?? null,
          name: job.name,
          payload: job.payload,
          runAt: job.runAt ?? new Date().toISOString(),
        })
        .toSQL()
    );
  },
  buildFindRecordByIdStatement(args) {
    return toStatement(
      queryBuilder
        .select(recordSelection)
        .from(oboeRecords)
        .where(and(eq(oboeRecords.collection, args.collection), eq(oboeRecords.id, args.id)))
        .toSQL()
    );
  },
  buildFindRecordsStatement(args) {
    const builder = queryBuilder
      .select(recordSelection)
      .from(oboeRecords)
      .where(buildWhereClause(args.collection, args.query))
      .orderBy(desc(oboeRecords.updatedAt));
    return toStatement(
      typeof args.query?.limit === "number"
        ? builder.limit(args.query.limit).toSQL()
        : builder.toSQL()
    );
  },
  buildInsertAppliedMigrationStatement(migration: AppliedRelationalMigration) {
    return toStatement(
      new SQLiteInsertBuilder(oboeMigrations, session, dialect)
        .values({
          dialect: migration.dialect,
          id: migration.id,
          manifest: migration.manifest as unknown as Record<string, unknown>,
          manifestChecksum: migration.manifest.checksum,
          name: migration.name,
        })
        .toSQL()
    );
  },
  buildJsonSupportStatement() {
    return {
      params: [],
      sql: "SELECT json_valid(json('{}')) AS supported",
    };
  },
  buildListAppliedMigrationsStatement() {
    return toStatement(
      queryBuilder
        .select({
          applied_at: oboeMigrations.appliedAt,
          dialect: oboeMigrations.dialect,
          id: oboeMigrations.id,
          manifest: oboeMigrations.manifest,
          manifest_checksum: oboeMigrations.manifestChecksum,
          name: oboeMigrations.name,
        })
        .from(oboeMigrations)
        .orderBy(oboeMigrations.appliedAt)
        .toSQL()
    );
  },
  buildMigrationTableExistsStatement() {
    return {
      params: [],
      sql: "SELECT COUNT(*) AS exists FROM sqlite_master WHERE type = 'table' AND name = 'oboe_migrations'",
    };
  },
  buildRecordAuditStatement(entry: AuditEntry) {
    return toStatement(
      new SQLiteInsertBuilder(oboeAuditLog, session, dialect)
        .values({
          actor: entry.actor ?? null,
          collection: entry.collection,
          occurredAt: entry.at,
          operation: entry.operation,
          payload: entry.payload ?? null,
          recordId: entry.id,
        })
        .toSQL()
    );
  },
  buildUpdateRecordStatement(args) {
    return toStatement(
      new SQLiteUpdateBuilder(oboeRecords, session, dialect)
        .set({
          data: sql`json_patch(${oboeRecords.data}, json(${JSON.stringify(args.data)}))`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(and(eq(oboeRecords.collection, args.collection), eq(oboeRecords.id, args.id)))
        .toSQL()
    );
  },
};
