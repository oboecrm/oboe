import type { JobDispatcher, JobRequest } from "@oboe/core";

export interface JobHandlerContext {
  attempts: number;
  idempotencyKey?: string;
}

export interface InMemoryJobRunnerOptions {
  deadLetters?: JobRequest[];
  retryLimit?: number;
}

export class InMemoryJobRunner implements JobDispatcher {
  readonly deadLetters: JobRequest[];
  private readonly handlers = new Map<
    string,
    (
      payload: Record<string, unknown>,
      context: JobHandlerContext
    ) => Promise<void> | void
  >();
  private readonly idempotencyKeys = new Set<string>();
  private readonly queue: JobRequest[] = [];
  private readonly retryLimit: number;

  constructor(options: InMemoryJobRunnerOptions = {}) {
    this.deadLetters = options.deadLetters ?? [];
    this.retryLimit = options.retryLimit ?? 3;
  }

  async drain() {
    while (this.queue.length > 0) {
      const job = this.queue.shift();

      if (!job) {
        continue;
      }

      const handler = this.handlers.get(job.name);
      if (!handler) {
        throw new Error(`No job handler registered for "${job.name}".`);
      }

      try {
        await handler(job.payload, {
          attempts: job.attempts ?? 1,
          idempotencyKey: job.idempotencyKey,
        });
        if (job.idempotencyKey) {
          this.idempotencyKeys.add(job.idempotencyKey);
        }
      } catch {
        const attempts = (job.attempts ?? 1) + 1;
        if (attempts > this.retryLimit) {
          this.deadLetters.push({
            ...job,
            attempts,
          });
          continue;
        }

        this.queue.push({
          ...job,
          attempts,
        });
      }
    }
  }

  async enqueue(job: JobRequest) {
    if (job.idempotencyKey && this.idempotencyKeys.has(job.idempotencyKey)) {
      return;
    }

    this.queue.push({
      ...job,
      attempts: job.attempts ?? 1,
    });
  }

  get size() {
    return this.queue.length;
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
}

export function createInMemoryJobRunner(options?: InMemoryJobRunnerOptions) {
  return new InMemoryJobRunner(options);
}
