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

import { mySqlDialect } from "./dialect.js";

export { bootstrapSql, mySqlDialect } from "./dialect.js";

interface ResultLike {
  affectedRows?: number;
  insertId?: number;
}

type MySqlRows = unknown[] | ResultLike;

export interface MySqlClientLike {
  beginTransaction?: () => Promise<void>;
  commit?: () => Promise<void>;
  execute: (sql: string, params?: unknown[]) => Promise<[MySqlRows, unknown]>;
  getConnection?: () => Promise<MySqlPoolConnectionLike>;
  release?: () => void;
  rollback?: () => Promise<void>;
}

export interface MySqlPoolConnectionLike extends MySqlClientLike {
  beginTransaction: () => Promise<void>;
  commit: () => Promise<void>;
  release: () => void;
  rollback: () => Promise<void>;
}

export interface MySqlAdapterOptions {
  client: MySqlClientLike;
}

function hasConnectionFactory(
  value: MySqlClientLike
): value is MySqlClientLike & {
  getConnection: () => Promise<MySqlPoolConnectionLike>;
} {
  return typeof value.getConnection === "function";
}

function hasTransactionMethods(
  value: MySqlClientLike
): value is MySqlPoolConnectionLike {
  return (
    typeof value.beginTransaction === "function" &&
    typeof value.commit === "function" &&
    typeof value.rollback === "function"
  );
}

function createQueryable(client: MySqlClientLike) {
  return {
    query: async <TRow = Record<string, unknown>>({
      params,
      sql,
    }: {
      params: unknown[];
      sql: string;
    }) => {
      const [rows] = await client.execute(sql, params as never);
      if (Array.isArray(rows)) {
        return {
          rows: rows as TRow[],
        };
      }

      return {
        affectedRows: rows.affectedRows,
        lastInsertId: rows.insertId,
        rows: [] as TRow[],
      };
    },
  };
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
  log: Array<{ createdAt?: string; created_at?: string; message: string }> | string;
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
  value: Array<{ createdAt?: string; created_at?: string; message: string }> | string
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

export class MySqlAdapter implements DatabaseAdapter {
  private readonly client: MySqlClientLike;
  private readonly storage: RelationalStorage;

  constructor(options: MySqlAdapterOptions) {
    this.client = options.client;
    this.storage = new RelationalStorage(
      mySqlDialect,
      createQueryable(options.client)
    );
  }

  private async queryRows<TRow = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) {
    const [rows] = await this.client.execute(sql, params);
    return (Array.isArray(rows) ? rows : []) as TRow[];
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
where id = ?
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
    await this.client.execute(
      `
update oboe_job_outbox
set
  log = json_merge_preserve(coalesce(log, json_array()), cast(? as json)),
  updated_at = CURRENT_TIMESTAMP
where id = ?`.trim(),
      [JSON.stringify(args.entries), args.id]
    );

    return this.findJobById(args.id);
  }

  async claimJobs(args: ClaimJobsArgs): Promise<Job[]> {
    if (!hasConnectionFactory(this.client) && !hasTransactionMethods(this.client)) {
      throw new Error("MySQL job claiming requires transaction support.");
    }

    const connection = hasConnectionFactory(this.client)
      ? await this.client.getConnection()
      : this.client;

    try {
      await connection.beginTransaction?.();
      const selectParams: unknown[] = [];
      let queueClause = "";

      if (!args.allQueues) {
        selectParams.push(args.queue ?? "default");
        queueClause = "and queue = ?";
      }
      selectParams.push(args.limit ?? 10);

      const [claimableRows] = await connection.execute(
        `
select id
from (
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
) claimable
where concurrency_key is null or concurrency_rank = 1
order by ${resolveProcessingOrder(args.processingOrder)}
limit ?
for update skip locked`.trim(),
        selectParams
      );
      const ids = (Array.isArray(claimableRows) ? claimableRows : []) as Array<{
        id: string;
      }>;

      if (ids.length === 0) {
        await connection.commit?.();
        return [];
      }

      const placeholders = ids.map(() => "?").join(", ");
      await connection.execute(
        `
update oboe_job_outbox
set
  attempt = attempt + 1,
  started_at = CURRENT_TIMESTAMP,
  status = 'processing',
  updated_at = CURRENT_TIMESTAMP
where id in (${placeholders})`.trim(),
        ids.map((row) => row.id)
      );

      const [rows] = await connection.execute(
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
where id in (${placeholders})`.trim(),
        ids.map((row) => row.id)
      );

      await connection.commit?.();
      return ((Array.isArray(rows) ? rows : []) as JobRow[]).map(toJob);
    } catch (error) {
      await connection.rollback?.();
      throw error;
    } finally {
      connection.release?.();
    }
  }

  async completeJob(args: CompleteJobArgs): Promise<Job | null> {
    await this.client.execute(
      `
update oboe_job_outbox
set
  completed_at = CURRENT_TIMESTAMP,
  log = json_merge_preserve(coalesce(log, json_array()), cast(? as json)),
  output = coalesce(cast(? as json), output),
  status = 'completed',
  updated_at = CURRENT_TIMESTAMP
where id = ?`.trim(),
      [JSON.stringify(args.log ?? []), args.output ? JSON.stringify(args.output) : null, args.id]
    );

    return this.findJobById(args.id);
  }

  async countRunnableOrActiveJobs(args: CountJobsArgs = {}): Promise<number> {
    const params: unknown[] = [];
    let queueClause = "";

    if (!args.allQueues) {
      params.push(args.queue ?? "default");
      queueClause = "and queue = ?";
    }

    const [row] = await this.queryRows<{ count: number | string }>(
      `
select count(*) as count
from oboe_job_outbox
where (
  status = 'processing'
  or (status = 'queued' and wait_until <= CURRENT_TIMESTAMP)
)
${queueClause}`.trim(),
      params
    );

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
      waitUntil: job.runAt ?? new Date().toISOString().slice(0, 19).replace("T", " "),
    });
  }

  async failJob(args: FailJobArgs): Promise<Job | null> {
    await this.client.execute(
      `
update oboe_job_outbox
set
  completed_at = case when ? then completed_at else CURRENT_TIMESTAMP end,
  last_error = ?,
  log = json_merge_preserve(coalesce(log, json_array()), cast(? as json)),
  started_at = case when ? then null else started_at end,
  status = case when ? then 'queued' else 'failed' end,
  updated_at = CURRENT_TIMESTAMP
where id = ?`.trim(),
      [args.retry ? 1 : 0, args.error, JSON.stringify(args.log ?? []), args.retry ? 1 : 0, args.retry ? 1 : 0, args.id]
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
    if (!hasConnectionFactory(this.client)) {
      if (hasTransactionMethods(this.client)) {
        await this.client.beginTransaction();
        try {
          const result = await callback(
            new MySqlAdapter({ client: this.client })
          );
          await this.client.commit();
          return result;
        } catch (error) {
          await this.client.rollback();
          throw error;
        }
      }

      return callback(this);
    }

    const connection = await this.client.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(new MySqlAdapter({ client: connection }));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
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

export function createMySqlAdapter(options: MySqlAdapterOptions) {
  return new MySqlAdapter(options);
}
