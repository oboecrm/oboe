import type {
  AuditEntry,
  CollectionQuery,
  CompiledSchema,
  DatabaseAdapter,
  JobRequest,
  OboeRecord,
} from "@oboe/core";
import { RelationalStorage } from "@oboe/storage-relational";

import { bootstrapSql, mySqlDialect } from "./dialect.js";

export { bootstrapSql } from "./dialect.js";
export { mySqlDialect } from "./dialect.js";

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

export class MySqlAdapter implements DatabaseAdapter {
  private readonly client: MySqlClientLike;
  private readonly storage: RelationalStorage;

  constructor(options: MySqlAdapterOptions) {
    this.client = options.client;
    this.storage = new RelationalStorage(mySqlDialect, createQueryable(options.client));
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

  async initialize(schema: CompiledSchema): Promise<void> {
    return this.storage.initialize(schema);
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
          const result = await callback(new MySqlAdapter({ client: this.client }));
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
}

export function createMySqlAdapter(options: MySqlAdapterOptions) {
  return new MySqlAdapter(options);
}
