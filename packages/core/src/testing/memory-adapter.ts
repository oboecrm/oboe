import { matchesWhere as queryMatchesWhere, sortRecords } from "../query.js";
import type {
  AuditEntry,
  CollectionQuery,
  DatabaseAdapter,
  JobRequest,
  OboeRecord,
} from "../types.js";

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export class MemoryAdapter implements DatabaseAdapter {
  readonly audits: AuditEntry[] = [];
  readonly jobs: JobRequest[] = [];
  readonly store = new Map<string, Map<string, OboeRecord>>();

  async create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<OboeRecord> {
    const now = new Date().toISOString();
    const record: OboeRecord = {
      collection: args.collection,
      createdAt: now,
      data: args.data,
      id: randomId(),
      updatedAt: now,
    };

    const bucket =
      this.store.get(args.collection) ?? new Map<string, OboeRecord>();
    bucket.set(record.id, record);
    this.store.set(args.collection, bucket);

    return record;
  }

  async delete(args: {
    collection: string;
    id: string;
  }): Promise<OboeRecord | null> {
    const bucket = this.store.get(args.collection);
    const existing = bucket?.get(args.id) ?? null;
    bucket?.delete(args.id);
    return existing;
  }

  async enqueueJob(job: JobRequest): Promise<void> {
    this.jobs.push(job);
  }

  async find(args: {
    collection: string;
    query?: CollectionQuery;
  }): Promise<OboeRecord[]> {
    const bucket =
      this.store.get(args.collection) ?? new Map<string, OboeRecord>();
    const docs = sortRecords(
      [...bucket.values()].filter((doc) =>
        queryMatchesWhere(doc, args.query?.where)
      ),
      args.query?.sort
    );

    if (args.query?.limit) {
      return docs.slice(0, args.query.limit);
    }

    return docs;
  }

  async findById(args: {
    collection: string;
    id: string;
  }): Promise<OboeRecord | null> {
    return this.store.get(args.collection)?.get(args.id) ?? null;
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    this.audits.push(entry);
  }

  async update(args: {
    collection: string;
    data: Record<string, unknown>;
    id: string;
  }): Promise<OboeRecord | null> {
    const bucket = this.store.get(args.collection);
    const existing = bucket?.get(args.id);

    if (!existing || !bucket) {
      return null;
    }

    const next: OboeRecord = {
      ...existing,
      data: {
        ...existing.data,
        ...args.data,
      },
      updatedAt: new Date().toISOString(),
    };
    bucket.set(args.id, next);
    return next;
  }
}

export function createMemoryAdapter() {
  return new MemoryAdapter();
}
