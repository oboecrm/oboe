import type {
  AuditEntry,
  CollectionQuery,
  CompiledSchema,
  DatabaseAdapter,
  JobRequest,
  OboeRecord,
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

  async enqueueJob(job: JobRequest): Promise<void> {
    return this.storage.enqueueJob(job);
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

  async initialize(_schema: CompiledSchema): Promise<void> {
    return this.storage.initialize(_schema);
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
}

export function createPostgresAdapter(options: PostgresAdapterOptions) {
  return new PostgresAdapter(options);
}
