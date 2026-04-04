import type {
  AuditEntry,
  CollectionQuery,
  CompiledSchema,
  DatabaseAdapter,
  JobRequest,
  OboeRecord,
} from "@oboe/core";
import type { RelationalQueryable } from "@oboe/storage-relational";
import { RelationalStorage } from "@oboe/storage-relational";
import Database from "better-sqlite3";

import { bootstrapSql, sqliteDialect } from "./dialect.js";

export { bootstrapSql } from "./dialect.js";
export { sqliteDialect } from "./dialect.js";

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
    transaction: async <T>(callback: (queryable: RelationalQueryable) => Promise<T>) => {
      const run = (database.transaction as unknown as <TReturn>(
        fn: () => Promise<TReturn>
      ) => () => Promise<TReturn>)(() => callback(queryable));
      return await run();
    },
  };

  return queryable;
}

export class SqliteAdapter implements DatabaseAdapter {
  private readonly database: Database.Database | SqliteDatabaseLike;
  private readonly storage: RelationalStorage;

  constructor(options: SqliteAdapterOptions) {
    this.database = options.database;
    this.storage = new RelationalStorage(sqliteDialect, createQueryable(options.database));
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
    const run = (this.database.transaction as unknown as <TReturn>(
      fn: () => Promise<TReturn>
    ) => () => Promise<TReturn>)(() => callback(this));
    return await run();
  }

  async update(args: {
    collection: string;
    data: Record<string, unknown>;
    id: string;
  }): Promise<OboeRecord | null> {
    return this.storage.update(args);
  }
}

export function createSqliteAdapter(options: SqliteAdapterOptions) {
  return new SqliteAdapter(options);
}
