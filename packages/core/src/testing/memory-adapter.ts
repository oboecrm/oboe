import { matchesWhere as queryMatchesWhere, sortRecords } from "../query.js";
import type {
  AppendJobLogArgs,
  AuditEntry,
  ClaimJobsArgs,
  CollectionQuery,
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
} from "../types.js";

const GLOBAL_COLLECTION = "__oboe_globals";

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export class MemoryAdapter implements DatabaseAdapter {
  readonly audits: AuditEntry[] = [];
  readonly jobs: Job[] = [];
  readonly store = new Map<string, Map<string, OboeRecord>>();

  private matchesQueueFilter(job: Job, args?: CountJobsArgs | ClaimJobsArgs) {
    if (args?.allQueues) {
      return true;
    }

    return job.queue === (args?.queue ?? "default");
  }

  private runnableJobs(args?: ClaimJobsArgs) {
    const now = new Date().toISOString();
    return this.jobs.filter(
      (job) =>
        job.status === "queued" &&
        job.waitUntil <= now &&
        this.matchesQueueFilter(job, args) &&
        (!job.concurrencyKey ||
          !this.jobs.some(
            (candidate) =>
              candidate.id !== job.id &&
              candidate.status === "processing" &&
              candidate.concurrencyKey === job.concurrencyKey
          ))
    );
  }

  private sortJobs<TJob extends Job>(jobs: TJob[], order: ProcessingOrder) {
    return [...jobs].sort((left, right) => {
      const delta =
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime();
      return order === "createdAt" ? delta : -delta;
    });
  }

  private cloneJob(job: Job): Job {
    return {
      ...job,
      input: {
        ...job.input,
      },
      log: job.log.map((entry) => ({
        ...entry,
      })),
      output: job.output
        ? {
            ...job.output,
          }
        : null,
    };
  }

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

  async appendJobLog(args: AppendJobLogArgs): Promise<Job | null> {
    const job = this.jobs.find((entry) => entry.id === args.id);

    if (!job) {
      return null;
    }

    job.log.push(...args.entries);
    job.updatedAt = new Date().toISOString();
    return this.cloneJob(job);
  }

  async claimJobs(args: ClaimJobsArgs): Promise<Job[]> {
    const order = args.processingOrder ?? "createdAt";
    const limit = args.limit ?? 10;
    const now = new Date().toISOString();
    const seenConcurrencyKeys = new Set<string>();
    const claimed = this.sortJobs(this.runnableJobs(args), order)
      .filter((job) => {
        if (!job.concurrencyKey) {
          return true;
        }

        if (seenConcurrencyKeys.has(job.concurrencyKey)) {
          return false;
        }

        seenConcurrencyKeys.add(job.concurrencyKey);
        return true;
      })
      .slice(0, limit);

    for (const job of claimed) {
      job.attempt += 1;
      job.startedAt = now;
      job.status = "processing";
      job.updatedAt = now;
    }

    return claimed.map((job) => this.cloneJob(job));
  }

  async completeJob(args: CompleteJobArgs): Promise<Job | null> {
    const job = this.jobs.find((entry) => entry.id === args.id);

    if (!job) {
      return null;
    }

    const now = new Date().toISOString();
    job.completedAt = now;
    job.log.push(...(args.log ?? []));
    job.output = args.output ?? null;
    job.status = "completed";
    job.updatedAt = now;
    return this.cloneJob(job);
  }

  async countRunnableOrActiveJobs(args?: CountJobsArgs): Promise<number> {
    const now = new Date().toISOString();
    return this.jobs.filter(
      (job) =>
        this.matchesQueueFilter(job, args) &&
        (job.status === "processing" ||
          (job.status === "queued" && job.waitUntil <= now))
    ).length;
  }

  async enqueueJob(job: JobRequest): Promise<void> {
    await this.queueJob({
      id: randomId(),
      idempotencyKey: job.idempotencyKey ?? null,
      input: job.payload,
      maxRetries: 0,
      queue: "default",
      task: job.name,
      waitUntil: job.runAt ?? new Date().toISOString(),
    });
  }

  async failJob(args: FailJobArgs): Promise<Job | null> {
    const job = this.jobs.find((entry) => entry.id === args.id);

    if (!job) {
      return null;
    }

    const now = new Date().toISOString();
    job.lastError = args.error;
    job.log.push(...(args.log ?? []));
    job.updatedAt = now;
    if (args.retry) {
      job.startedAt = null;
      job.status = "queued";
    } else {
      job.completedAt = now;
      job.status = "failed";
    }

    return this.cloneJob(job);
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

  async findGlobal(args: { slug: string }): Promise<OboeGlobalRecord | null> {
    const record = await this.findById({
      collection: GLOBAL_COLLECTION,
      id: args.slug,
    });

    if (!record) {
      return null;
    }

    return {
      createdAt: record.createdAt,
      data: record.data,
      slug: args.slug,
      updatedAt: record.updatedAt,
    };
  }

  async queueJob(job: QueueableJob): Promise<Job> {
    if (
      job.idempotencyKey &&
      this.jobs.some((entry) => entry.idempotencyKey === job.idempotencyKey)
    ) {
      const existing = this.jobs.find(
        (entry) => entry.idempotencyKey === job.idempotencyKey
      );
      if (!existing) {
        throw new Error("Expected existing job for idempotency key.");
      }

      return this.cloneJob(existing);
    }

    const now = new Date().toISOString();
    const created: Job = {
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
    this.jobs.push(created);
    return this.cloneJob(created);
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

  async updateGlobal(args: {
    data: Record<string, unknown>;
    slug: string;
  }): Promise<OboeGlobalRecord> {
    const existing = await this.findGlobal({
      slug: args.slug,
    });

    if (!existing) {
      const created = await this.create({
        collection: GLOBAL_COLLECTION,
        data: args.data,
      });
      const bucket = this.store.get(GLOBAL_COLLECTION);
      if (bucket) {
        bucket.delete(created.id);
        bucket.set(args.slug, {
          ...created,
          id: args.slug,
        });
      }

      return {
        createdAt: created.createdAt,
        data: args.data,
        slug: args.slug,
        updatedAt: created.updatedAt,
      };
    }

    const updated = await this.update({
      collection: GLOBAL_COLLECTION,
      data: args.data,
      id: args.slug,
    });

    if (!updated) {
      throw new Error(`Failed to update global "${args.slug}".`);
    }

    return {
      createdAt: updated.createdAt,
      data: updated.data,
      slug: args.slug,
      updatedAt: updated.updatedAt,
    };
  }
}

export function createMemoryAdapter() {
  return new MemoryAdapter();
}
