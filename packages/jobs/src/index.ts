import type {
  Job,
  JobDispatcher,
  JobRequest,
  QueueJobRequest,
  RunJobsArgs,
  RunJobsResult,
} from "@oboe/core";

export interface JobHandlerContext {
  attempts: number;
  idempotencyKey?: string;
}

export interface InMemoryJobRunnerOptions {
  deadLetters?: Job[];
  retryLimit?: number;
}

export class InMemoryJobRunner implements JobDispatcher {
  readonly deadLetters: Job[];
  private readonly completedJobs = new Map<string, Job>();
  private readonly handlers = new Map<
    string,
    (
      payload: Record<string, unknown>,
      context: JobHandlerContext
    ) => Promise<void> | void
  >();
  private readonly idempotencyKeys = new Set<string>();
  private readonly queueStore: Job[] = [];
  private readonly retryLimit: number;

  constructor(options: InMemoryJobRunnerOptions = {}) {
    this.deadLetters = options.deadLetters ?? [];
    this.retryLimit = options.retryLimit ?? 3;
  }

  async drain() {
    while (this.queueStore.length > 0) {
      const job = this.queueStore.shift();

      if (!job) {
        continue;
      }

      if (job.status !== "queued") {
        continue;
      }

      if (job.waitUntil > new Date().toISOString()) {
        this.queueStore.push(job);
        break;
      }

      const handler = this.handlers.get(job.task);
      if (!handler) {
        throw new Error(`No job handler registered for "${job.task}".`);
      }

      try {
        job.attempt += 1;
        job.startedAt = new Date().toISOString();
        job.status = "processing";
        await handler(job.input, {
          attempts: job.attempt,
          idempotencyKey: job.idempotencyKey ?? undefined,
        });
        job.completedAt = new Date().toISOString();
        job.status = "completed";
        if (job.idempotencyKey) {
          this.idempotencyKeys.add(job.idempotencyKey);
          this.completedJobs.set(job.idempotencyKey, {
            ...job,
          });
        }
      } catch {
        if (job.attempt > this.retryLimit) {
          job.completedAt = new Date().toISOString();
          job.status = "failed";
          this.deadLetters.push({
            ...job,
          });
          continue;
        }

        this.queueStore.push({
          ...job,
          startedAt: null,
          status: "queued",
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  async enqueue(job: JobRequest) {
    await this.queue({
      idempotencyKey: job.idempotencyKey,
      input: job.payload,
      task: job.name,
      waitUntil: job.runAt,
    });
  }

  get size() {
    return this.queueStore.length;
  }

  on(
    name: string,
    handler: (
      payload: Record<string, unknown>,
      context: JobHandlerContext
    ) => Promise<void> | void
  ) {
    this.handlers.set(name, handler);

    return () => {
      this.handlers.delete(name);
    };
  }

  async queue(job: QueueJobRequest): Promise<Job> {
    if (job.idempotencyKey && this.idempotencyKeys.has(job.idempotencyKey)) {
      const completed = this.completedJobs.get(job.idempotencyKey);
      if (completed) {
        return completed;
      }
      const existing = this.queueStore.find(
        (entry) => entry.idempotencyKey === job.idempotencyKey
      );
      if (existing) {
        return existing;
      }
    }

    const now = new Date().toISOString();
    const created: Job = {
      attempt: 0,
      completedAt: null,
      concurrencyKey: null,
      createdAt: now,
      id: crypto.randomUUID(),
      idempotencyKey: job.idempotencyKey ?? null,
      input: {
        ...job.input,
      },
      lastError: null,
      log: job.log ?? [],
      maxRetries: this.retryLimit,
      output: null,
      queue: job.queue ?? "default",
      startedAt: null,
      status: "queued",
      task: job.task,
      updatedAt: now,
      waitUntil:
        typeof job.waitUntil === "string"
          ? job.waitUntil
          : job.waitUntil?.toISOString() ?? now,
    };
    this.queueStore.push(created);
    return created;
  }

  async run(_args: RunJobsArgs = {}): Promise<RunJobsResult> {
    const before = this.queueStore.filter((job) => job.status === "queued").length;
    await this.drain();
    return {
      remaining: this.queueStore.filter((job) => job.status === "queued").length,
      total: before,
    };
  }
}

export function createInMemoryJobRunner(options?: InMemoryJobRunnerOptions) {
  return new InMemoryJobRunner(options);
}
