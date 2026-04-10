import type {
  AppendJobLogArgs,
  AuditEntry,
  ClaimJobsArgs,
  CollectionQuery,
  CompiledSchema,
  CompleteJobArgs,
  CountJobsArgs,
  DatabaseAdapter,
  FailJobArgs,
  Job,
  JobRequest,
  OboeGlobalRecord,
  OboeRecord,
  ProcessingOrder,
  QueueableJob,
} from "@oboe/core";
import type { RelationalQueryable } from "@oboe/storage-relational";
import { RelationalStorage } from "@oboe/storage-relational";
import type Database from "better-sqlite3";

import { sqliteDialect } from "./dialect.js";

export { bootstrapSql, sqliteDialect } from "./dialect.js";

export interface SqliteDatabaseLike {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => {
      changes: number;
      lastInsertRowid: bigint | number;
    };
  };
  transaction: <T>(callback: () => T) => () => T;
}

export interface SqliteAdapterOptions {
  database: Database.Database | SqliteDatabaseLike;
}

const GLOBAL_COLLECTION = "__oboe_globals";

function withoutGlobalSlug(data: Record<string, unknown>) {
  const { slug: _slug, ...rest } = data;
  return rest;
}

function createQueryable(
  database: Database.Database | SqliteDatabaseLike
): RelationalQueryable {
  let queryable!: RelationalQueryable;
  queryable = {
    query: async <TRow = Record<string, unknown>>({
      params,
      sql,
    }: {
      params: unknown[];
      sql: string;
    }) => {
      const trimmed = sql.trim().toLowerCase();
      const statement = database.prepare(sql);
      if (trimmed.startsWith("select")) {
        return {
          rows: statement.all(...params) as TRow[],
        };
      }

      const result = statement.run(...params);
      return {
        affectedRows: result.changes,
        lastInsertId: result.lastInsertRowid,
        rows: [] as TRow[],
      };
    },
    transaction: async <T>(
      callback: (queryable: RelationalQueryable) => Promise<T>
    ) => {
      const run = (
        database.transaction as unknown as <TReturn>(
          fn: () => Promise<TReturn>
        ) => () => Promise<TReturn>
      )(() => callback(queryable));
      return await run();
    },
  };

  return queryable;
}

async function findStoredGlobal(
  storage: RelationalStorage,
  slug: string
): Promise<OboeRecord | null> {
  const [record] = await storage.find({
    collection: GLOBAL_COLLECTION,
    query: {
      limit: 1,
      where: {
        slug: {
          eq: slug,
        },
      },
    },
  });

  return record ?? null;
}

interface JobRow {
  attempt: number;
  completed_at: string | null;
  concurrency_key: string | null;
  created_at: string;
  id: string;
  idempotency_key: string | null;
  input: Record<string, unknown> | string;
  last_error: string | null;
  log:
    | Array<{ createdAt?: string; created_at?: string; message: string }>
    | string;
  max_retries: number;
  output: Record<string, unknown> | string | null;
  queue: string;
  started_at: string | null;
  status: string;
  task_slug: string;
  updated_at: string;
  wait_until: string;
}

function parseObject(
  value: Record<string, unknown> | string | null
): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  return typeof value === "string"
    ? (JSON.parse(value) as Record<string, unknown>)
    : value;
}

function parseLog(
  value:
    | Array<{ createdAt?: string; created_at?: string; message: string }>
    | string
) {
  const entries =
    typeof value === "string"
      ? (JSON.parse(value) as Array<{
          createdAt?: string;
          created_at?: string;
          message: string;
        }>)
      : value;

  return entries.map((entry) => ({
    createdAt: entry.createdAt ?? entry.created_at ?? new Date().toISOString(),
    message: entry.message,
  }));
}

function toJob(row: JobRow): Job {
  return {
    attempt: row.attempt,
    completedAt: row.completed_at,
    concurrencyKey: row.concurrency_key,
    createdAt: row.created_at,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    input: parseObject(row.input) ?? {},
    lastError: row.last_error,
    log: parseLog(row.log),
    maxRetries: row.max_retries,
    output: parseObject(row.output),
    queue: row.queue,
    startedAt: row.started_at,
    status: row.status as Job["status"],
    task: row.task_slug,
    updatedAt: row.updated_at,
    waitUntil: row.wait_until,
  };
}

function resolveProcessingOrder(order: ProcessingOrder = "createdAt") {
  return order === "createdAt" ? "created_at asc" : "created_at desc";
}

export class SqliteAdapter implements DatabaseAdapter {
  private readonly database: Database.Database | SqliteDatabaseLike;
  private readonly storage: RelationalStorage;

  constructor(options: SqliteAdapterOptions) {
    this.database = options.database;
    this.storage = new RelationalStorage(
      sqliteDialect,
      createQueryable(options.database)
    );
  }

  private queryRows<TRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ) {
    return this.database.prepare(sql).all(...params) as TRow[];
  }

  private findJobById(id: string): Job | null {
    const [row] = this.queryRows<JobRow>(
      `
select
  attempt,
  completed_at,
  concurrency_key,
  created_at,
  id,
  idempotency_key,
  input,
  last_error,
  log,
  max_retries,
  output,
  queue,
  started_at,
  status,
  task_slug,
  updated_at,
  wait_until
from oboe_job_outbox
where id = ?
limit 1`.trim(),
      [id]
    );

    return row ? toJob(row) : null;
  }

  private findJobByIdempotencyKey(key: string): Job | null {
    const [row] = this.queryRows<JobRow>(
      `
select
  attempt,
  completed_at,
  concurrency_key,
  created_at,
  id,
  idempotency_key,
  input,
  last_error,
  log,
  max_retries,
  output,
  queue,
  started_at,
  status,
  task_slug,
  updated_at,
  wait_until
from oboe_job_outbox
where idempotency_key = ?
limit 1`.trim(),
      [key]
    );

    return row ? toJob(row) : null;
  }

  async create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<OboeRecord> {
    return this.storage.create(args);
  }

  async delete(args: {
    collection: string;
    id: string;
  }): Promise<OboeRecord | null> {
    return this.storage.delete(args);
  }

  async appendJobLog(args: AppendJobLogArgs): Promise<Job | null> {
    const existing = this.findJobById(args.id);
    if (!existing) {
      return null;
    }

    this.database
      .prepare(
        `
update oboe_job_outbox
set
  log = ?,
  updated_at = CURRENT_TIMESTAMP
where id = ?`.trim()
      )
      .run(JSON.stringify([...existing.log, ...args.entries]), args.id);

    return this.findJobById(args.id);
  }

  async claimJobs(args: ClaimJobsArgs): Promise<Job[]> {
    const limit = args.limit ?? 10;
    const values: unknown[] = [];
    let queueClause = "";

    if (!args.allQueues) {
      values.push(args.queue ?? "default");
      queueClause = "and queue = ?";
    }

    values.push(limit);
    const claim = (
      this.database.transaction as unknown as <TReturn>(
        fn: () => TReturn
      ) => () => TReturn
    )(() => {
      const rows = this.queryRows<JobRow>(
        `
select
  attempt,
  completed_at,
  concurrency_key,
  created_at,
  id,
  idempotency_key,
  input,
  last_error,
  log,
  max_retries,
  output,
  queue,
  started_at,
  status,
  task_slug,
  updated_at,
  wait_until
from (
  select
    attempt,
    completed_at,
    concurrency_key,
    created_at,
    id,
    idempotency_key,
    input,
    last_error,
    log,
    max_retries,
    output,
    queue,
    started_at,
    status,
    task_slug,
    updated_at,
    wait_until,
    row_number() over (
      partition by concurrency_key
      order by ${resolveProcessingOrder(args.processingOrder)}
    ) as concurrency_rank
  from oboe_job_outbox job
  where status = 'queued'
    and wait_until <= CURRENT_TIMESTAMP
    ${queueClause}
    and (
      concurrency_key is null
      or not exists (
        select 1
        from oboe_job_outbox active
        where active.status = 'processing'
          and active.concurrency_key = job.concurrency_key
      )
    )
)
where concurrency_key is null or concurrency_rank = 1
order by ${resolveProcessingOrder(args.processingOrder)}
limit ?`.trim(),
        values
      );

      for (const row of rows) {
        this.database
          .prepare(
            `
update oboe_job_outbox
set
  attempt = attempt + 1,
  started_at = CURRENT_TIMESTAMP,
  status = 'processing',
  updated_at = CURRENT_TIMESTAMP
where id = ?`.trim()
          )
          .run(row.id);
      }

      return rows
        .map((row) => this.findJobById(row.id))
        .filter(Boolean) as Job[];
    });

    return claim();
  }

  async completeJob(args: CompleteJobArgs): Promise<Job | null> {
    const existing = this.findJobById(args.id);
    if (!existing) {
      return null;
    }

    this.database
      .prepare(
        `
update oboe_job_outbox
set
  completed_at = CURRENT_TIMESTAMP,
  log = ?,
  output = ?,
  status = 'completed',
  updated_at = CURRENT_TIMESTAMP
where id = ?`.trim()
      )
      .run(
        JSON.stringify([...existing.log, ...(args.log ?? [])]),
        args.output
          ? JSON.stringify(args.output)
          : existing.output
            ? JSON.stringify(existing.output)
            : null,
        args.id
      );

    return this.findJobById(args.id);
  }

  async countRunnableOrActiveJobs(args: CountJobsArgs = {}): Promise<number> {
    const values: unknown[] = [];
    let queueClause = "";

    if (!args.allQueues) {
      values.push(args.queue ?? "default");
      queueClause = "and queue = ?";
    }

    const row = this.database
      .prepare(
        `
select count(*) as count
from oboe_job_outbox
where (
  status = 'processing'
  or (status = 'queued' and wait_until <= CURRENT_TIMESTAMP)
)
${queueClause}`.trim()
      )
      .get(...values) as { count: number | string } | undefined;

    return Number(row?.count ?? 0);
  }

  async enqueueJob(job: JobRequest): Promise<void> {
    await this.queueJob({
      id: crypto.randomUUID(),
      idempotencyKey: job.idempotencyKey ?? null,
      input: job.payload,
      maxRetries: 0,
      queue: "default",
      task: job.name,
      waitUntil: job.runAt ?? new Date().toISOString(),
    });
  }

  async failJob(args: FailJobArgs): Promise<Job | null> {
    const existing = this.findJobById(args.id);
    if (!existing) {
      return null;
    }

    this.database
      .prepare(
        `
update oboe_job_outbox
set
  completed_at = case when ? = 1 then completed_at else CURRENT_TIMESTAMP end,
  last_error = ?,
  log = ?,
  started_at = case when ? = 1 then null else started_at end,
  status = case when ? = 1 then 'queued' else 'failed' end,
  updated_at = CURRENT_TIMESTAMP
where id = ?`.trim()
      )
      .run(
        args.retry ? 1 : 0,
        args.error,
        JSON.stringify([...existing.log, ...(args.log ?? [])]),
        args.retry ? 1 : 0,
        args.retry ? 1 : 0,
        args.id
      );

    return this.findJobById(args.id);
  }

  async find(args: {
    collection: string;
    query?: CollectionQuery;
  }): Promise<OboeRecord[]> {
    return this.storage.find(args);
  }

  async findById(args: {
    collection: string;
    id: string;
  }): Promise<OboeRecord | null> {
    return this.storage.findById(args);
  }

  async findGlobal(args: { slug: string }): Promise<OboeGlobalRecord | null> {
    const record = await findStoredGlobal(this.storage, args.slug);

    if (!record) {
      return null;
    }

    return {
      createdAt: record.createdAt,
      data: withoutGlobalSlug(record.data),
      slug: args.slug,
      updatedAt: record.updatedAt,
    };
  }

  async initialize(schema: CompiledSchema): Promise<void> {
    return this.storage.initialize(schema);
  }

  async queueJob(job: QueueableJob): Promise<Job> {
    if (job.idempotencyKey) {
      const existing = this.findJobByIdempotencyKey(job.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const queued = await this.storage.queueJob(job);
    return job.idempotencyKey
      ? (this.findJobByIdempotencyKey(job.idempotencyKey) ?? queued)
      : queued;
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    return this.storage.recordAudit(entry);
  }

  async transaction<T>(
    callback: (adapter: DatabaseAdapter) => Promise<T>
  ): Promise<T> {
    const run = (
      this.database.transaction as unknown as <TReturn>(
        fn: () => Promise<TReturn>
      ) => () => Promise<TReturn>
    )(() => callback(this));
    return await run();
  }

  async update(args: {
    collection: string;
    data: Record<string, unknown>;
    id: string;
  }): Promise<OboeRecord | null> {
    return this.storage.update(args);
  }

  async updateGlobal(args: {
    data: Record<string, unknown>;
    slug: string;
  }): Promise<OboeGlobalRecord> {
    const existing = await findStoredGlobal(this.storage, args.slug);
    const updated = await this.storage.update({
      collection: GLOBAL_COLLECTION,
      data: {
        ...args.data,
        slug: args.slug,
      },
      id: existing?.id ?? "",
    });

    if (updated && existing) {
      return {
        createdAt: updated.createdAt,
        data: withoutGlobalSlug(updated.data),
        slug: args.slug,
        updatedAt: updated.updatedAt,
      };
    }

    const created = await this.storage.create({
      collection: GLOBAL_COLLECTION,
      data: {
        ...args.data,
        slug: args.slug,
      },
    });

    return {
      createdAt: created.createdAt,
      data: withoutGlobalSlug(created.data),
      slug: args.slug,
      updatedAt: created.updatedAt,
    };
  }
}

export function createSqliteAdapter(options: SqliteAdapterOptions) {
  return new SqliteAdapter(options);
}
