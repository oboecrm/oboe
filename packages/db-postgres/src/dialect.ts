import type { AuditEntry, CollectionQuery, QueueableJob } from "@oboe/core";
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
    id: text("id").primaryKey(),
    taskSlug: text("task_slug").notNull(),
    queue: text("queue").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    status: text("status").notNull(),
    waitUntil: timestamp("wait_until", {
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
    startedAt: timestamp("started_at", {
      mode: "string",
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", {
      mode: "string",
      withTimezone: true,
    }),
    attempt: integer("attempt").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    concurrencyKey: text("concurrency_key"),
    lastError: text("last_error"),
    log: jsonb("log").notNull().default(sql`'[]'::jsonb`),
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
    index("oboe_job_outbox_status_wait_until_idx").on(
      table.status,
      table.waitUntil
    ),
    index("oboe_job_outbox_queue_created_at_idx").on(table.queue, table.createdAt),
    index("oboe_job_outbox_concurrency_idx").on(table.concurrencyKey),
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
  id text PRIMARY KEY,
  task_slug text NOT NULL,
  queue text NOT NULL,
  input jsonb NOT NULL,
  output jsonb,
  status text NOT NULL,
  wait_until timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempt integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 0,
  idempotency_key text,
  concurrency_key text,
  last_error text,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);`.trim(),
  `
CREATE UNIQUE INDEX IF NOT EXISTS oboe_job_outbox_idempotency_idx
  ON oboe_job_outbox (idempotency_key)
  WHERE idempotency_key IS NOT NULL;`.trim(),
  `
CREATE INDEX IF NOT EXISTS oboe_job_outbox_status_wait_until_idx
  ON oboe_job_outbox (status, wait_until);`.trim(),
  `
CREATE INDEX IF NOT EXISTS oboe_job_outbox_queue_created_at_idx
  ON oboe_job_outbox (queue, created_at);`.trim(),
  `
CREATE INDEX IF NOT EXISTS oboe_job_outbox_concurrency_idx
  ON oboe_job_outbox (concurrency_key);`.trim(),
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
  buildEnqueueJobStatement(job: QueueableJob) {
    return toStatement(
      new PgInsertBuilder(oboeJobOutbox, session, dialect)
        .values({
          attempt: 0,
          completedAt: null,
          concurrencyKey: job.concurrencyKey ?? null,
          createdAt: sql`now()`,
          id: job.id,
          idempotencyKey: job.idempotencyKey ?? null,
          input: job.input,
          lastError: null,
          log: job.log ?? [],
          maxRetries: job.maxRetries,
          output: null,
          queue: job.queue,
          startedAt: null,
          status: job.status ?? "queued",
          taskSlug: job.task,
          updatedAt: sql`now()`,
          waitUntil: job.waitUntil,
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
