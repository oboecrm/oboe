import type {
  AuditEntry,
  CollectionQuery,
  CompiledSchema,
  Job,
  JobRequest,
  OboeRecord,
  QueueableJob,
} from "@oboe/core";

import { RelationalMigrator } from "./migrator.js";
import type { RelationalDialect, RelationalQueryable } from "./types.js";

interface RecordRow {
  collection: string;
  created_at: Date | string;
  data: Record<string, unknown>;
  id: string;
  updated_at: Date | string;
}

function toRecord(row: RecordRow): OboeRecord {
  const data =
    typeof row.data === "string"
      ? (JSON.parse(row.data) as Record<string, unknown>)
      : row.data;

  return {
    collection: row.collection,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    data,
    id: row.id,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

export class RelationalStorage {
  private readonly migrator: RelationalMigrator;

  constructor(
    private readonly dialect: RelationalDialect,
    private readonly queryable: RelationalQueryable
  ) {
    this.migrator = new RelationalMigrator(dialect, queryable);
  }

  async create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<OboeRecord> {
    const id = crypto.randomUUID();
    const statement = this.dialect.buildCreateRecordStatement({
      collection: args.collection,
      data: args.data,
      id,
      returning: this.dialect.capabilities.nativeReturning,
    });
    const result = await this.queryable.query<RecordRow>(statement);

    if (this.dialect.capabilities.nativeReturning) {
      const row = result.rows[0];
      if (!row) {
        throw new Error(
          "Relational adapter failed to return the created record."
        );
      }

      return toRecord(row);
    }

    const created = await this.findById({
      collection: args.collection,
      id,
    });

    if (!created) {
      throw new Error("Relational adapter failed to load the created record.");
    }

    return created;
  }

  async delete(args: {
    collection: string;
    id: string;
  }): Promise<OboeRecord | null> {
    if (this.dialect.capabilities.nativeReturning) {
      const result = await this.queryable.query<RecordRow>(
        this.dialect.buildDeleteRecordStatement({
          ...args,
          returning: true,
        })
      );

      return result.rows[0] ? toRecord(result.rows[0]) : null;
    }

    const existing = await this.findById(args);
    if (!existing) {
      return null;
    }

    await this.queryable.query(
      this.dialect.buildDeleteRecordStatement({
        ...args,
        returning: false,
      })
    );
    return existing;
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

  async queueJob(job: QueueableJob): Promise<Job> {
    const now = new Date().toISOString();
    await this.queryable.query(
      this.dialect.buildEnqueueJobStatement({
        ...job,
      })
    );

    return {
      attempt: 0,
      completedAt: null,
      concurrencyKey: job.concurrencyKey ?? null,
      createdAt: now,
      id: job.id,
      idempotencyKey: job.idempotencyKey ?? null,
      input: {
        ...job.input,
      },
      lastError: null,
      log: [...(job.log ?? [])],
      maxRetries: job.maxRetries,
      output: null,
      queue: job.queue,
      startedAt: null,
      status: job.status ?? "queued",
      task: job.task,
      updatedAt: now,
      waitUntil: job.waitUntil,
    };
  }

  async find(args: {
    collection: string;
    query?: CollectionQuery;
  }): Promise<OboeRecord[]> {
    const result = await this.queryable.query<RecordRow>(
      this.dialect.buildFindRecordsStatement(args)
    );

    return result.rows.map(toRecord);
  }

  async findById(args: {
    collection: string;
    id: string;
  }): Promise<OboeRecord | null> {
    const result = await this.queryable.query<RecordRow>(
      this.dialect.buildFindRecordByIdStatement(args)
    );

    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async initialize(schema: CompiledSchema): Promise<void> {
    await this.migrator.initialize({
      schema,
    });
  }

  async listAppliedMigrations() {
    return this.migrator.listAppliedMigrations();
  }

  async migrationTableExists() {
    return this.migrator.migrationTableExists();
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    await this.queryable.query(this.dialect.buildRecordAuditStatement(entry));
  }

  async update(args: {
    collection: string;
    data: Record<string, unknown>;
    id: string;
  }): Promise<OboeRecord | null> {
    if (this.dialect.capabilities.nativeReturning) {
      const result = await this.queryable.query<RecordRow>(
        this.dialect.buildUpdateRecordStatement({
          ...args,
          returning: true,
        })
      );

      return result.rows[0] ? toRecord(result.rows[0]) : null;
    }

    await this.queryable.query(
      this.dialect.buildUpdateRecordStatement({
        ...args,
        returning: false,
      })
    );

    return this.findById({
      collection: args.collection,
      id: args.id,
    });
  }
}
