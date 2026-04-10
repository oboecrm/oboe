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
import { RelationalStorage } from "@oboe/storage-relational";

import { postgresDialect } from "./dialect.js";

export { bootstrapSql, postgresDialect } from "./dialect.js";

export interface PostgresAdapterOptions {
  pool: PostgresPoolLike | PostgresQueryable;
}

export interface PostgresQueryable {
  query: <TRow = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{
    rowCount?: number | null;
    rows: TRow[];
  }>;
}

export interface PostgresPoolLike extends PostgresQueryable {
  connect: () => Promise<PostgresTransactionClientLike>;
}

export interface PostgresTransactionClientLike extends PostgresQueryable {
  release: () => void;
}

function isPool(
  value: PostgresPoolLike | PostgresQueryable
): value is PostgresPoolLike {
  return typeof (value as PostgresPoolLike).connect === "function";
}

const GLOBAL_COLLECTION = "__oboe_globals";

function withoutGlobalSlug(data: Record<string, unknown>) {
  const { slug: _slug, ...rest } = data;
  return rest;
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

export class PostgresAdapter implements DatabaseAdapter {
  private readonly pool: PostgresPoolLike | PostgresQueryable;
  private readonly storage: RelationalStorage;

  constructor(options: PostgresAdapterOptions) {
    this.pool = options.pool;
    const queryable = isPool(options.pool)
      ? {
          query: async <TRow = Record<string, unknown>>({
            params,
            sql,
          }: {
            params: unknown[];
            sql: string;
          }) => {
            const result = await options.pool.query<TRow>(sql, params);
            return {
              affectedRows: result.rowCount ?? undefined,
              rows: result.rows,
            };
          },
        }
      : {
          query: async <TRow = Record<string, unknown>>({
            params,
            sql,
          }: {
            params: unknown[];
            sql: string;
          }) => {
            const result = await options.pool.query<TRow>(sql, params);
            return {
              affectedRows: result.rowCount ?? undefined,
              rows: result.rows,
            };
          },
        };

    this.storage = new RelationalStorage(postgresDialect, queryable);
  }

  private async queryRows<TRow = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) {
    const result = await this.pool.query<TRow>(text, values);
    return result.rows;
  }

  private async findJobById(id: string): Promise<Job | null> {
    const [row] = await this.queryRows<JobRow>(
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
where id = $1
limit 1`.trim(),
      [id]
    );

    return row ? toJob(row) : null;
  }

  private async findJobByIdempotencyKey(key: string): Promise<Job | null> {
    const [row] = await this.queryRows<JobRow>(
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
where idempotency_key = $1
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
    await this.pool.query(
      `
update oboe_job_outbox
set
  log = coalesce(log, '[]'::jsonb) || $2::jsonb,
  updated_at = now()
where id = $1`.trim(),
      [args.id, JSON.stringify(args.entries)]
    );

    return this.findJobById(args.id);
  }

  async claimJobs(args: ClaimJobsArgs): Promise<Job[]> {
    const values: unknown[] = [];
    let queueFilter = "";

    if (!args.allQueues) {
      values.push(args.queue ?? "default");
      queueFilter = `and queue = $${values.length}`;
    }

    values.push(args.limit ?? 10);

    const rows = await this.queryRows<JobRow>(
      `
with ranked as (
  select
    id,
    concurrency_key,
    created_at,
    row_number() over (
      partition by concurrency_key
      order by ${resolveProcessingOrder(args.processingOrder)}
    ) as concurrency_rank
  from oboe_job_outbox job
  where status = 'queued'
    and wait_until <= now()
    ${queueFilter}
    and (
      concurrency_key is null
      or not exists (
        select 1
        from oboe_job_outbox active
        where active.status = 'processing'
          and active.concurrency_key = job.concurrency_key
      )
    )
),
claimable as (
  select id
  from ranked
  where concurrency_key is null or concurrency_rank = 1
  order by ${resolveProcessingOrder(args.processingOrder)}
  limit $${values.length}
  for update skip locked
)
update oboe_job_outbox queued
set
  attempt = queued.attempt + 1,
  started_at = now(),
  status = 'processing',
  updated_at = now()
from claimable
where queued.id = claimable.id
returning
  queued.attempt,
  queued.completed_at,
  queued.concurrency_key,
  queued.created_at,
  queued.id,
  queued.idempotency_key,
  queued.input,
  queued.last_error,
  queued.log,
  queued.max_retries,
  queued.output,
  queued.queue,
  queued.started_at,
  queued.status,
  queued.task_slug,
  queued.updated_at,
  queued.wait_until`.trim(),
      values
    );

    return rows.map(toJob);
  }

  async completeJob(args: CompleteJobArgs): Promise<Job | null> {
    const [row] = await this.queryRows<JobRow>(
      `
update oboe_job_outbox
set
  completed_at = now(),
  log = coalesce(log, '[]'::jsonb) || $3::jsonb,
  output = coalesce($2::jsonb, output),
  status = 'completed',
  updated_at = now()
where id = $1
returning
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
  wait_until`.trim(),
      [
        args.id,
        args.output ? JSON.stringify(args.output) : null,
        JSON.stringify(args.log ?? []),
      ]
    );

    return row ? toJob(row) : null;
  }

  async countRunnableOrActiveJobs(args: CountJobsArgs = {}): Promise<number> {
    const values: unknown[] = [];
    let queueFilter = "";

    if (!args.allQueues) {
      values.push(args.queue ?? "default");
      queueFilter = `and queue = $${values.length}`;
    }

    const rows = await this.queryRows<{ count: string }>(
      `
select count(*)::text as count
from oboe_job_outbox
where (
  status = 'processing'
  or (status = 'queued' and wait_until <= now())
)
${queueFilter}`.trim(),
      values
    );

    return Number(rows[0]?.count ?? 0);
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
    const [row] = await this.queryRows<JobRow>(
      `
update oboe_job_outbox
set
  completed_at = case when $4::boolean then completed_at else now() end,
  last_error = $2,
  log = coalesce(log, '[]'::jsonb) || $3::jsonb,
  started_at = case when $4::boolean then null else started_at end,
  status = case when $4::boolean then 'queued' else 'failed' end,
  updated_at = now()
where id = $1
returning
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
  wait_until`.trim(),
      [args.id, args.error, JSON.stringify(args.log ?? []), args.retry]
    );

    return row ? toJob(row) : null;
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

  async initialize(_schema: CompiledSchema): Promise<void> {
    return this.storage.initialize(_schema);
  }

  async queueJob(job: QueueableJob): Promise<Job> {
    if (job.idempotencyKey) {
      const existing = await this.findJobByIdempotencyKey(job.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const queued = await this.storage.queueJob(job);
    return job.idempotencyKey
      ? ((await this.findJobByIdempotencyKey(job.idempotencyKey)) ?? queued)
      : queued;
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    return this.storage.recordAudit(entry);
  }

  async transaction<T>(
    callback: (adapter: DatabaseAdapter) => Promise<T>
  ): Promise<T> {
    if (!isPool(this.pool)) {
      return callback(this);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const txAdapter = new PostgresAdapter({
        pool: client as PostgresTransactionClientLike,
      });
      const result = await callback(txAdapter);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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

export function createPostgresAdapter(options: PostgresAdapterOptions) {
  return new PostgresAdapter(options);
}
