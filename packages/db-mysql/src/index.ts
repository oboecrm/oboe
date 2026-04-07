import type {
  AuditEntry,
  CollectionQuery,
  CompiledSchema,
  DatabaseAdapter,
  JobRequest,
  OboeGlobalRecord,
  OboeRecord,
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
