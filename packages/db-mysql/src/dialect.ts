import type { AuditEntry, CollectionQuery, QueueableJob } from "@oboe/core";
import type {
  AppliedRelationalMigration,
  RelationalDialect,
  RelationalStatement,
} from "@oboe/storage-relational";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  datetime,
  index,
  int,
  json,
  MySqlDialect,
  mysqlTable,
  QueryBuilder,
  serial,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import {
  MySqlDeleteBase,
  MySqlInsertBuilder,
  MySqlUpdateBuilder,
} from "drizzle-orm/mysql-core/query-builders";

const dialect = new MySqlDialect();
const queryBuilder = new QueryBuilder(dialect);
const session = {} as never;

const oboeRecords = mysqlTable(
  "oboe_records",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    collection: varchar("collection", { length: 191 }).notNull(),
    createdAt: datetime("created_at", {
      mode: "string",
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    data: json("data").$type<Record<string, unknown>>().notNull(),
    updatedAt: datetime("updated_at", {
      mode: "string",
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("oboe_records_collection_idx").on(table.collection)]
);

const oboeAuditLog = mysqlTable("oboe_audit_log", {
  actor: json("actor"),
  collection: varchar("collection", { length: 191 }).notNull(),
  id: serial("id").primaryKey(),
  occurredAt: datetime("occurred_at", {
    mode: "string",
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  operation: varchar("operation", { length: 32 }).notNull(),
  payload: json("payload"),
  recordId: varchar("record_id", { length: 191 }).notNull(),
});

const oboeJobOutbox = mysqlTable(
  "oboe_job_outbox",
  {
    attempt: int("attempt").notNull().default(0),
    completedAt: datetime("completed_at", {
      mode: "string",
    }),
    concurrencyKey: varchar("concurrency_key", { length: 191 }),
    createdAt: datetime("created_at", {
      mode: "string",
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    id: varchar("id", { length: 191 }).primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 191 }),
    input: json("input").notNull(),
    lastError: varchar("last_error", { length: 1024 }),
    log: json("log").notNull(),
    maxRetries: int("max_retries").notNull().default(0),
    output: json("output"),
    queue: varchar("queue", { length: 191 }).notNull(),
    startedAt: datetime("started_at", {
      mode: "string",
    }),
    status: varchar("status", { length: 32 }).notNull(),
    taskSlug: varchar("task_slug", { length: 191 }).notNull(),
    updatedAt: datetime("updated_at", {
      mode: "string",
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    waitUntil: datetime("wait_until", {
      mode: "string",
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("oboe_job_outbox_idempotency_idx").on(table.idempotencyKey),
    index("oboe_job_outbox_status_wait_until_idx").on(table.status, table.waitUntil),
    index("oboe_job_outbox_queue_created_at_idx").on(table.queue, table.createdAt),
    index("oboe_job_outbox_concurrency_idx").on(table.concurrencyKey),
  ]
);

const oboeMigrations = mysqlTable("oboe_migrations", {
  appliedAt: datetime("applied_at", {
    mode: "string",
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  dialect: varchar("dialect", { length: 32 }).notNull(),
  id: varchar("id", { length: 191 }).primaryKey(),
  manifest: json("manifest").$type<Record<string, unknown>>().notNull(),
  manifestChecksum: varchar("manifest_checksum", { length: 64 }).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
});

const recordSelection = {
  collection: oboeRecords.collection,
  created_at: oboeRecords.createdAt,
  data: oboeRecords.data,
  id: oboeRecords.id,
  updated_at: oboeRecords.updatedAt,
};

function toStatement(statement: {
  params: unknown[];
  sql: string;
}): RelationalStatement {
  return {
    params: statement.params,
    sql: statement.sql,
  };
}

function buildWhereClause(collection: string, query?: CollectionQuery) {
  if (!query?.where || Object.keys(query.where).length === 0) {
    return eq(oboeRecords.collection, collection);
  }

  return and(
    eq(oboeRecords.collection, collection),
    sql`JSON_CONTAINS(${oboeRecords.data}, CAST(${JSON.stringify(query.where)} AS JSON))`
  );
}

const bootstrapStatements = [
  `
CREATE TABLE IF NOT EXISTS oboe_records (
  id varchar(191) PRIMARY KEY,
  collection varchar(191) NOT NULL,
  data json NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);`.trim(),
  `
CREATE INDEX oboe_records_collection_idx
  ON oboe_records (collection);`.trim(),
  `
CREATE TABLE IF NOT EXISTS oboe_audit_log (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  collection varchar(191) NOT NULL,
  record_id varchar(191) NOT NULL,
  operation varchar(32) NOT NULL,
  actor json,
  payload json,
  occurred_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);`.trim(),
  `
CREATE TABLE IF NOT EXISTS oboe_job_outbox (
  id varchar(191) PRIMARY KEY,
  task_slug varchar(191) NOT NULL,
  queue varchar(191) NOT NULL,
  input json NOT NULL,
  output json,
  status varchar(32) NOT NULL,
  wait_until datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at datetime,
  completed_at datetime,
  attempt int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 0,
  idempotency_key varchar(191),
  concurrency_key varchar(191),
  last_error varchar(1024),
  log json NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY oboe_job_outbox_idempotency_idx (idempotency_key)
);`.trim(),
  `
CREATE INDEX oboe_job_outbox_status_wait_until_idx
  ON oboe_job_outbox (status, wait_until);`.trim(),
  `
CREATE INDEX oboe_job_outbox_queue_created_at_idx
  ON oboe_job_outbox (queue, created_at);`.trim(),
  `
CREATE INDEX oboe_job_outbox_concurrency_idx
  ON oboe_job_outbox (concurrency_key);`.trim(),
  `
CREATE TABLE IF NOT EXISTS oboe_migrations (
  id varchar(191) PRIMARY KEY,
  name varchar(191) NOT NULL,
  dialect varchar(32) NOT NULL,
  manifest_checksum varchar(64) NOT NULL,
  manifest json NOT NULL,
  applied_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);`.trim(),
];

export const bootstrapSql = bootstrapStatements.join("\n\n");

export const mySqlDialect: RelationalDialect = {
  capabilities: {
    jsonContains: true,
    jsonMerge: true,
    nativeReturning: false,
    partialIndexes: false,
    transactionSupport: true,
  },
  name: "mysql",
  buildBootstrapStatements() {
    return bootstrapStatements.map((statement) => ({
      params: [],
      sql: statement,
    }));
  },
  buildCreateRecordStatement(args) {
    return toStatement(
      new MySqlInsertBuilder(oboeRecords, session, dialect)
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
      new MySqlDeleteBase(oboeRecords, session, dialect)
        .where(
          and(
            eq(oboeRecords.collection, args.collection),
            eq(oboeRecords.id, args.id)
          )
        )
        .toSQL()
    );
  },
  buildEnqueueJobStatement(job: QueueableJob) {
    return toStatement(
      new MySqlInsertBuilder(oboeJobOutbox, session, dialect)
        .values({
          attempt: 0,
          completedAt: null,
          concurrencyKey: job.concurrencyKey ?? null,
          createdAt: sql`CURRENT_TIMESTAMP`,
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
          updatedAt: sql`CURRENT_TIMESTAMP`,
          waitUntil: job.waitUntil,
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
      new MySqlInsertBuilder(oboeMigrations, session, dialect)
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
      sql: "SELECT JSON_EXTRACT('{}', '$') AS supported",
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
      sql: "SELECT COUNT(*) AS exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'oboe_migrations'",
    };
  },
  buildRecordAuditStatement(entry: AuditEntry) {
    return toStatement(
      new MySqlInsertBuilder(oboeAuditLog, session, dialect)
        .values({
          actor: entry.actor ?? null,
          collection: entry.collection,
          occurredAt: entry.at.slice(0, 19).replace("T", " "),
          operation: entry.operation,
          payload: entry.payload ?? null,
          recordId: entry.id,
        })
        .toSQL()
    );
  },
  buildUpdateRecordStatement(args) {
    return toStatement(
      new MySqlUpdateBuilder(oboeRecords, session, dialect)
        .set({
          data: sql`JSON_MERGE_PATCH(${oboeRecords.data}, CAST(${JSON.stringify(args.data)} AS JSON))`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(
          and(
            eq(oboeRecords.collection, args.collection),
            eq(oboeRecords.id, args.id)
          )
        )
        .toSQL()
    );
  },
};
