import type { AuditEntry, CollectionQuery, JobRequest } from "@oboe/core";
import type {
  AppliedRelationalMigration,
  RelationalDialect,
  RelationalStatement,
} from "@oboe/storage-relational";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  PgDeleteBase,
  PgDialect,
  PgInsertBuilder,
  PgUpdateBuilder,
  pgTable,
  QueryBuilder,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const dialect = new PgDialect();
const queryBuilder = new QueryBuilder(dialect);
const session = {} as never;

const oboeRecords = pgTable(
  "oboe_records",
  {
    id: text("id").primaryKey(),
    collection: text("collection").notNull(),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("oboe_records_collection_idx").on(table.collection)]
);

const oboeAuditLog = pgTable("oboe_audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  collection: text("collection").notNull(),
  recordId: text("record_id").notNull(),
  operation: text("operation").notNull(),
  actor: jsonb("actor"),
  payload: jsonb("payload"),
  occurredAt: timestamp("occurred_at", {
    mode: "string",
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
});

const oboeJobOutbox = pgTable(
  "oboe_job_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key"),
    attempts: integer("attempts").notNull().default(1),
    runAt: timestamp("run_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("oboe_job_outbox_idempotency_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ]
);

const oboeMigrations = pgTable("oboe_migrations", {
  appliedAt: timestamp("applied_at", {
    mode: "string",
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
  dialect: text("dialect").notNull(),
  id: text("id").primaryKey(),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
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

function buildWhereClause(collection: string, query?: CollectionQuery) {
  if (!query?.where || Object.keys(query.where).length === 0) {
    return eq(oboeRecords.collection, collection);
  }

  return and(
    eq(oboeRecords.collection, collection),
    sql`${oboeRecords.data} @> ${JSON.stringify(query.where)}::jsonb`
  );
}

function toStatement(statement: {
  params: unknown[];
  sql: string;
}): RelationalStatement {
  return {
    params: statement.params,
    sql: statement.sql,
  };
}

function migrationTableStatement() {
  return {
    params: [],
    sql: `
CREATE TABLE IF NOT EXISTS oboe_migrations (
  id text PRIMARY KEY,
  name text NOT NULL,
  dialect text NOT NULL,
  manifest_checksum text NOT NULL,
  manifest jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);`.trim(),
  };
}

export const bootstrapSql = [
  `
CREATE TABLE IF NOT EXISTS oboe_records (
  id text PRIMARY KEY,
  collection text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`.trim(),
  `
CREATE INDEX IF NOT EXISTS oboe_records_collection_idx
  ON oboe_records (collection);`.trim(),
  `
CREATE TABLE IF NOT EXISTS oboe_audit_log (
  id bigserial PRIMARY KEY,
  collection text NOT NULL,
  record_id text NOT NULL,
  operation text NOT NULL,
  actor jsonb,
  payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);`.trim(),
  `
CREATE TABLE IF NOT EXISTS oboe_job_outbox (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text,
  attempts integer NOT NULL DEFAULT 1,
  run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);`.trim(),
  `
CREATE UNIQUE INDEX IF NOT EXISTS oboe_job_outbox_idempotency_idx
  ON oboe_job_outbox (idempotency_key)
  WHERE idempotency_key IS NOT NULL;`.trim(),
  migrationTableStatement().sql,
].join("\n\n");

export const postgresDialect: RelationalDialect = {
  capabilities: {
    jsonContains: true,
    jsonMerge: true,
    nativeReturning: true,
    partialIndexes: true,
    transactionSupport: true,
  },
  name: "postgres",
  buildBootstrapStatements() {
    return bootstrapSql.split("\n\n").map((statement) => ({
      params: [],
      sql: statement,
    }));
  },
  buildCreateRecordStatement(args) {
    const builder = new PgInsertBuilder(oboeRecords, session, dialect).values({
      collection: args.collection,
      data: args.data,
      id: args.id,
    });
    return toStatement(
      args.returning
        ? builder.returning(recordSelection).toSQL()
        : builder.toSQL()
    );
  },
  buildDeleteRecordStatement(args) {
    const builder = new PgDeleteBase(oboeRecords, session, dialect).where(
      and(
        eq(oboeRecords.collection, args.collection),
        eq(oboeRecords.id, args.id)
      )
    );
    return toStatement(
      args.returning
        ? builder.returning(recordSelection).toSQL()
        : builder.toSQL()
    );
  },
  buildEnqueueJobStatement(job: JobRequest) {
    return toStatement(
      new PgInsertBuilder(oboeJobOutbox, session, dialect)
        .values({
          attempts: job.attempts ?? 1,
          idempotencyKey: job.idempotencyKey ?? null,
          name: job.name,
          payload: job.payload,
          runAt: job.runAt ?? new Date().toISOString(),
        })
        .onConflictDoNothing({
          target: oboeJobOutbox.idempotencyKey,
          where: sql`${oboeJobOutbox.idempotencyKey} IS NOT NULL`,
        })
        .toSQL()
    );
  },
  buildFindRecordByIdStatement(args) {
    return toStatement(
      queryBuilder
        .select(recordSelection)
        .from(oboeRecords)
        .where(
          and(
            eq(oboeRecords.collection, args.collection),
            eq(oboeRecords.id, args.id)
          )
        )
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
      new PgInsertBuilder(oboeMigrations, session, dialect)
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
      sql: "SELECT '{}'::jsonb AS supported",
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
      sql: "SELECT (to_regclass('public.oboe_migrations') IS NOT NULL)::int AS exists",
    };
  },
  buildRecordAuditStatement(entry: AuditEntry) {
    return toStatement(
      new PgInsertBuilder(oboeAuditLog, session, dialect)
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
    const builder = new PgUpdateBuilder(oboeRecords, session, dialect)
      .set({
        data: sql`${oboeRecords.data} || ${JSON.stringify(args.data)}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(oboeRecords.collection, args.collection),
          eq(oboeRecords.id, args.id)
        )
      );
    return toStatement(
      args.returning
        ? builder.returning(recordSelection).toSQL()
        : builder.toSQL()
    );
  },
};
