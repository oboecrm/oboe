import type {
  AuditEntry,
  CollectionQuery,
  CompiledSchema,
  DatabaseAdapter,
  JobRequest,
  OboeRecord,
} from "@oboe/core";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export interface PostgresQueryable {
  query: <TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ) => Promise<QueryResult<TRow>>;
}

export interface PostgresAdapterOptions {
  pool: Pool | PostgresQueryable;
}

export const bootstrapSql = `
CREATE TABLE IF NOT EXISTS oboe_records (
  id text PRIMARY KEY,
  collection text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oboe_records_collection_idx
  ON oboe_records (collection);

CREATE TABLE IF NOT EXISTS oboe_audit_log (
  id bigserial PRIMARY KEY,
  collection text NOT NULL,
  record_id text NOT NULL,
  operation text NOT NULL,
  actor jsonb,
  payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oboe_job_outbox (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text,
  attempts integer NOT NULL DEFAULT 1,
  run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS oboe_job_outbox_idempotency_idx
  ON oboe_job_outbox (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
`;

function isPool(value: Pool | PostgresQueryable): value is Pool {
  return typeof (value as Pool).connect === "function";
}

function toRecord(row: {
  collection: string;
  created_at: Date | string;
  data: Record<string, unknown>;
  id: string;
  updated_at: Date | string;
}): OboeRecord {
  return {
    collection: row.collection,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    data: row.data,
    id: row.id,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

function buildWhereClause(query?: CollectionQuery) {
  if (!query?.where || Object.keys(query.where).length === 0) {
    return {
      sql: "",
      values: [] as unknown[],
    };
  }

  return {
    sql: " AND data @> $2::jsonb",
    values: [JSON.stringify(query.where)],
  };
}

export class PostgresAdapter implements DatabaseAdapter {
  private readonly pool: Pool | PostgresQueryable;
  private readonly queryable: PostgresQueryable;

  constructor(options: PostgresAdapterOptions) {
    this.pool = options.pool;

    if (isPool(options.pool)) {
      const pool = options.pool;
      this.queryable = {
        query: async <TRow extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: unknown[]
        ) =>
          pool.query<TRow>(
            text,
            values as Parameters<Pool["query"]>[1] | undefined
          ) as Promise<QueryResult<TRow>>,
      };
      return;
    }

    this.queryable = options.pool;
  }

  async create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<OboeRecord> {
    const result = await this.queryable.query<{
      collection: string;
      created_at: Date | string;
      data: Record<string, unknown>;
      id: string;
      updated_at: Date | string;
    }>(
      `
        INSERT INTO oboe_records (id, collection, data)
        VALUES ($1, $2, $3::jsonb)
        RETURNING id, collection, data, created_at, updated_at
      `,
      [crypto.randomUUID(), args.collection, JSON.stringify(args.data)]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Postgres adapter failed to return the created record.");
    }

    return toRecord(row);
  }

  async delete(args: {
    collection: string;
    id: string;
  }): Promise<OboeRecord | null> {
    const result = await this.queryable.query<{
      collection: string;
      created_at: Date | string;
      data: Record<string, unknown>;
      id: string;
      updated_at: Date | string;
    }>(
      `
        DELETE FROM oboe_records
        WHERE collection = $1 AND id = $2
        RETURNING id, collection, data, created_at, updated_at
      `,
      [args.collection, args.id]
    );

    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async enqueueJob(job: JobRequest): Promise<void> {
    await this.queryable.query(
      `
        INSERT INTO oboe_job_outbox (name, payload, idempotency_key, attempts, run_at)
        VALUES ($1, $2::jsonb, $3, $4, $5)
        ON CONFLICT (idempotency_key)
        WHERE idempotency_key IS NOT NULL
        DO NOTHING
      `,
      [
        job.name,
        JSON.stringify(job.payload),
        job.idempotencyKey ?? null,
        job.attempts ?? 1,
        job.runAt ?? new Date().toISOString(),
      ]
    );
  }

  async find(args: {
    collection: string;
    query?: CollectionQuery;
  }): Promise<OboeRecord[]> {
    const where = buildWhereClause(args.query);
    const limit = args.query?.limit ? ` LIMIT ${args.query.limit}` : "";
    const result = await this.queryable.query<{
      collection: string;
      created_at: Date | string;
      data: Record<string, unknown>;
      id: string;
      updated_at: Date | string;
    }>(
      `
        SELECT id, collection, data, created_at, updated_at
        FROM oboe_records
        WHERE collection = $1${where.sql}
        ORDER BY updated_at DESC${limit}
      `,
      [args.collection, ...where.values]
    );

    return result.rows.map(toRecord);
  }

  async findById(args: {
    collection: string;
    id: string;
  }): Promise<OboeRecord | null> {
    const result = await this.queryable.query<{
      collection: string;
      created_at: Date | string;
      data: Record<string, unknown>;
      id: string;
      updated_at: Date | string;
    }>(
      `
        SELECT id, collection, data, created_at, updated_at
        FROM oboe_records
        WHERE collection = $1 AND id = $2
      `,
      [args.collection, args.id]
    );

    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async initialize(_schema: CompiledSchema): Promise<void> {
    await this.queryable.query(bootstrapSql);
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    await this.queryable.query(
      `
        INSERT INTO oboe_audit_log (collection, record_id, operation, actor, payload, occurred_at)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
      `,
      [
        entry.collection,
        entry.id,
        entry.operation,
        JSON.stringify(entry.actor ?? null),
        JSON.stringify(entry.payload ?? null),
        entry.at,
      ]
    );
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
        pool: client as unknown as PoolClient,
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
    const result = await this.queryable.query<{
      collection: string;
      created_at: Date | string;
      data: Record<string, unknown>;
      id: string;
      updated_at: Date | string;
    }>(
      `
        UPDATE oboe_records
        SET data = data || $3::jsonb,
            updated_at = now()
        WHERE collection = $1 AND id = $2
        RETURNING id, collection, data, created_at, updated_at
      `,
      [args.collection, args.id, JSON.stringify(args.data)]
    );

    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }
}

export function createPostgresAdapter(options: PostgresAdapterOptions) {
  return new PostgresAdapter(options);
}
