import { describe, expect, it } from "vitest";

import { defineConfig, defineModule } from "./config.js";
import { createOboeRuntime } from "./runtime.js";
import { createMemoryAdapter } from "./testing/memory-adapter.js";

describe("createOboeRuntime", () => {
  it("shares Local API behavior across hooks, events, and jobs", async () => {
    const adapter = createMemoryAdapter();
    const runtime = createOboeRuntime({
      config: defineConfig({
        auth: {
          collection: "users",
        },
        modules: [
          defineModule({
            collections: [
              {
                fields: [
                  {
                    name: "name",
                    type: "text",
                  },
                  {
                    name: "stage",
                    type: "text",
                  },
                ],
                hooks: {
                  afterChange: [
                    async ({ doc }) => ({
                      ...doc,
                      data: {
                        ...doc.data,
                        afterChangeSeen: true,
                      },
                    }),
                  ],
                  afterRead: [
                    async ({ doc }) => ({
                      ...doc,
                      data: {
                        ...doc.data,
                        afterReadSeen: true,
                      },
                    }),
                  ],
                  beforeChange: [
                    async ({ data }) => ({
                      ...data,
                      stage: data.stage ?? "new",
                    }),
                  ],
                },
                slug: "contacts",
              },
            ],
            slug: "crm",
          }),
        ],
      }),
      db: adapter,
    });
    const seenEvents: string[] = [];
    runtime.events.on("contacts.created", async () => {
      seenEvents.push("created");
    });

    const created = await runtime.create({
      collection: "contacts",
      data: {
        name: "Oboe Dev",
      },
    });
    await runtime.jobs.enqueue({
      idempotencyKey: "contact:1",
      name: "sync-contact",
      payload: {
        id: created.id,
      },
    });
    const loaded = await runtime.findById({
      collection: "contacts",
      id: created.id,
    });

    expect(runtime.auth.collection()).toBe("users");
    expect(created.data.stage).toBe("new");
    expect(created.data.afterChangeSeen).toBe(true);
    expect(loaded?.data.afterReadSeen).toBe(true);
    expect(seenEvents).toEqual(["created"]);
    expect(adapter.jobs).toHaveLength(1);
    expect(adapter.audits).toHaveLength(1);
  });
});
