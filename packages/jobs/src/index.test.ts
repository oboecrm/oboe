import { describe, expect, it } from "vitest";

import { createInMemoryJobRunner } from "./index.js";

describe("InMemoryJobRunner", () => {
  it("retries failures and then dead-letters", async () => {
    const runner = createInMemoryJobRunner({
      retryLimit: 2,
    });
    let attempts = 0;

    runner.on("always-fail", async () => {
      attempts += 1;
      throw new Error("boom");
    });

    await runner.enqueue({
      name: "always-fail",
      payload: {},
    });
    await runner.drain();

    expect(attempts).toBe(2);
    expect(runner.deadLetters).toHaveLength(1);
  });

  it("deduplicates by idempotency key after success", async () => {
    const runner = createInMemoryJobRunner();
    const handled: string[] = [];

    runner.on("sync", async (payload) => {
      handled.push(String(payload.id));
    });

    await runner.enqueue({
      idempotencyKey: "contact:1",
      name: "sync",
      payload: {
        id: "1",
      },
    });
    await runner.drain();
    await runner.enqueue({
      idempotencyKey: "contact:1",
      name: "sync",
      payload: {
        id: "1",
      },
    });
    await runner.drain();

    expect(handled).toEqual(["1"]);
  });
});
