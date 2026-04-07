import type {
  AuditEntry,
  CollectionQuery,
  CompiledSchema,
  DatabaseAdapter,
  JobRequest,
  OboeGlobalRecord,
  OboeRecord,
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
