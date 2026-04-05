import type { AuditEntry, CollectionQuery, JobRequest } from "@oboe/core";
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
    attempts: int("attempts").notNull().default(1),
    createdAt: datetime("created_at", {
      mode: "string",
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    id: serial("id").primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 191 }),
    name: varchar("name", { length: 191 }).notNull(),
    payload: json("payload").notNull(),
    runAt: datetime("run_at", {
      mode: "string",
    })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("oboe_job_outbox_idempotency_idx").on(table.idempotencyKey),
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
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name varchar(191) NOT NULL,
  payload json NOT NULL,
  idempotency_key varchar(191),
  attempts int NOT NULL DEFAULT 1,
  run_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY oboe_job_outbox_idempotency_idx (idempotency_key)
);`.trim(),
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
  buildEnqueueJobStatement(job: JobRequest) {
    return toStatement(
      new MySqlInsertBuilder(oboeJobOutbox, session, dialect)
        .values({
          attempts: job.attempts ?? 1,
          idempotencyKey: job.idempotencyKey ?? null,
          name: job.name,
          payload: job.payload,
          runAt:
            job.runAt ??
            new Date().toISOString().slice(0, 19).replace("T", " "),
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
