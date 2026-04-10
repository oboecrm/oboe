import { describe, expect, it } from "vitest";

import { defineConfig, defineModule } from "./config.js";
import { createOboeRuntime } from "./runtime.js";
import { createMemoryAdapter } from "./testing/memory-adapter.js";
import type {
  AuditEntry,
  CollectionQuery,
  JobRequest,
  OboeRecord,
} from "./types.js";
import { OboeEmailError, OboeValidationError } from "./types.js";

describe("createOboeRuntime", () => {
  it("rejects sendEmail when no email adapter is configured", async () => {
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    await expect(
      runtime.sendEmail({
        subject: "Hello",
        to: "dev@example.com",
      })
    ).rejects.toBeInstanceOf(OboeEmailError);
  });

  it("resolves promised email adapters and applies the default sender", async () => {
    const sentMessages: Array<Record<string, unknown>> = [];
    const resendClient = {
      request: async () => ({ ok: true }),
    };
    const runtime = createOboeRuntime({
      config: defineConfig({
        email: Promise.resolve(() => ({
          clients: {
            resend: resendClient,
          },
          defaultFromAddress: "info@oboe.dev",
          defaultFromName: "Oboe",
          name: "test-email",
          async sendEmail(message) {
            sentMessages.push(message as Record<string, unknown>);
            return {
              accepted: true,
            };
          },
        })),
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    await runtime.initialize();

    await runtime.sendEmail({
      subject: "Hello",
      to: "dev@example.com",
    });

    expect(runtime.email.getClient("resend")).toBe(resendClient);
    expect(sentMessages).toEqual([
      {
        from: {
          address: "info@oboe.dev",
          name: "Oboe",
        },
        subject: "Hello",
        to: "dev@example.com",
      },
    ]);
  });

  it("shares Local API behavior across collection hooks, events, and jobs", async () => {
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
                  beforeValidate: [
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
    expect(created.stage).toBe("new");
    expect(created.afterChangeSeen).toBe(true);
    expect(loaded?.afterReadSeen).toBe(true);
    expect(seenEvents).toEqual(["created"]);
    expect(adapter.jobs).toHaveLength(1);
    expect(adapter.audits).toHaveLength(1);
  });

  it("queues durable jobs and runs task handlers", async () => {
    const adapter = createMemoryAdapter();
    const runtime = createOboeRuntime({
      config: defineConfig({
        jobs: {
          tasks: [
            {
              async handler({ input }) {
                return {
                  output: {
                    syncedId: String(input.id),
                  },
                };
              },
              outputSchema: [
                {
                  name: "syncedId",
                  type: "text",
                },
              ],
              slug: "sync-contact",
            },
          ],
        },
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
      }),
      db: adapter,
    });

    const queued = await runtime.jobs.queue({
      input: {
        id: "contact-1",
      },
      task: "sync-contact",
    });
    const result = await runtime.jobs.run();

    expect(queued.status).toBe("queued");
    expect(result.total).toBe(1);
    expect(adapter.jobs[0]?.status).toBe("completed");
    expect(adapter.jobs[0]?.output).toEqual({
      syncedId: "contact-1",
    });
  });

  it("does not claim future jobs before waitUntil", async () => {
    const adapter = createMemoryAdapter();
    let handled = 0;
    const runtime = createOboeRuntime({
      config: defineConfig({
        jobs: {
          tasks: [
            {
              async handler() {
                handled += 1;
              },
              slug: "future-task",
            },
          ],
        },
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
      }),
      db: adapter,
    });

    await runtime.jobs.queue({
      input: {},
      task: "future-task",
      waitUntil: "2099-01-01T00:00:00.000Z",
    });
    const result = await runtime.jobs.run();

    expect(result.total).toBe(0);
    expect(handled).toBe(0);
    expect(adapter.jobs[0]?.status).toBe("queued");
  });

  it("retries failed tasks and marks them failed after max retries", async () => {
    const adapter = createMemoryAdapter();
    let attempts = 0;
    const runtime = createOboeRuntime({
      config: defineConfig({
        jobs: {
          tasks: [
            {
              async handler() {
                attempts += 1;
                throw new Error("boom");
              },
              retries: 1,
              slug: "always-fail",
            },
          ],
        },
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
      }),
      db: adapter,
    });

    await runtime.jobs.queue({
      input: {},
      task: "always-fail",
    });
    await runtime.jobs.run();
    await runtime.jobs.run();

    expect(attempts).toBe(2);
    expect(adapter.jobs[0]?.status).toBe("failed");
    expect(adapter.jobs[0]?.lastError).toBe("boom");
  });

  it("claims at most one queued job per concurrency key in a batch", async () => {
    const adapter = createMemoryAdapter();
    const handled: string[] = [];
    const runtime = createOboeRuntime({
      config: defineConfig({
        jobs: {
          tasks: [
            {
              concurrency: {
                key: ({ input }) => String(input.group),
              },
              async handler({ input }) {
                handled.push(String(input.id));
              },
              slug: "serial-task",
            },
          ],
        },
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
      }),
      db: adapter,
    });

    await runtime.jobs.queue({
      input: {
        group: "contacts",
        id: "1",
      },
      task: "serial-task",
    });
    await runtime.jobs.queue({
      input: {
        group: "contacts",
        id: "2",
      },
      task: "serial-task",
    });

    const firstRun = await runtime.jobs.run({
      limit: 10,
    });
    const secondRun = await runtime.jobs.run({
      limit: 10,
    });

    expect(firstRun.total).toBe(1);
    expect(secondRun.total).toBe(1);
    expect(handled).toEqual(["1", "2"]);
  });

  it("respects processing order and legacy enqueue shim", async () => {
    const adapter = createMemoryAdapter();
    const handled: string[] = [];
    const runtime = createOboeRuntime({
      config: defineConfig({
        jobs: {
          processingOrder: "-createdAt",
          tasks: [
            {
              async handler({ input }) {
                handled.push(String(input.id));
              },
              slug: "ordered-task",
            },
          ],
        },
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
      }),
      db: adapter,
    });

    await runtime.jobs.enqueue({
      name: "ordered-task",
      payload: {
        id: "oldest",
      },
    });
    await runtime.jobs.enqueue({
      name: "ordered-task",
      payload: {
        id: "newest",
      },
    });
    adapter.jobs[0] = {
      ...adapter.jobs[0]!,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    adapter.jobs[1] = {
      ...adapter.jobs[1]!,
      createdAt: "2026-01-02T00:00:00.000Z",
    };

    await runtime.jobs.run({
      limit: 2,
    });

    expect(handled).toEqual(["newest", "oldest"]);
  });

  it("accepts relationship aliases and validates related records exist", async () => {
    const adapter = createMemoryAdapter();
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [
                  {
                    name: "name",
                    type: "text",
                  },
                ],
                slug: "companies",
              },
              {
                fields: [
                  {
                    name: "name",
                    type: "text",
                  },
                  {
                    name: "company",
                    relationTo: "companies",
                    type: "relationship",
                  },
                ],
                slug: "contacts",
              },
            ],
            slug: "crm",
          }),
        ],
      }),
      db: adapter,
    });

    const company = await runtime.create({
      collection: "companies",
      data: {
        name: "Oboe Inc",
      },
    });
    const created = await runtime.create({
      collection: "contacts",
      data: {
        company: company.id,
        name: "Oboe Dev",
      },
    });

    await expect(
      runtime.create({
        collection: "contacts",
        data: {
          company: "missing-company",
          name: "Broken Contact",
        },
      })
    ).rejects.toMatchObject({
      issues: [
        {
          message:
            'Relationship field "contacts.company" refers to missing companies record "missing-company".',
          path: ["company"],
        },
      ],
    });

    expect(created.company).toMatchObject({
      id: company.id,
      name: "Oboe Inc",
    });
  });

  it("runs beforeValidate hooks before built-in validation", async () => {
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [
                  {
                    name: "value",
                    required: true,
                    type: "number",
                  },
                ],
                hooks: {
                  beforeValidate: [
                    ({ data }) => ({
                      ...data,
                      value:
                        typeof data.value === "string"
                          ? Number(data.value)
                          : data.value,
                    }),
                  ],
                },
                slug: "deals",
              },
            ],
            slug: "crm",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    const created = await runtime.create({
      collection: "deals",
      data: {
        value: "42" as unknown as number,
      },
    });

    expect(created.value).toBe(42);
  });

  it("runs collection and field hooks in the expected order", async () => {
    const order: string[] = [];
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [
                  {
                    hooks: {
                      afterChange: [
                        async ({ value }) => {
                          order.push("field.afterChange");
                          return `${String(value)}-saved`;
                        },
                      ],
                      afterRead: [
                        async ({ value }) => {
                          order.push("field.afterRead");
                          return `${String(value)}-read`;
                        },
                      ],
                      beforeChange: [
                        async ({ value }) => {
                          order.push("field.beforeChange");
                          return `${String(value)}-prepared`;
                        },
                      ],
                      beforeValidate: [
                        async ({ value }) => {
                          order.push("field.beforeValidate");
                          return String(value).trim();
                        },
                      ],
                    },
                    name: "title",
                    type: "text",
                  },
                ],
                hooks: {
                  afterChange: [
                    async ({ doc }) => {
                      order.push("collection.afterChange");
                      return doc;
                    },
                  ],
                  afterOperation: [
                    async ({ result }) => {
                      order.push("collection.afterOperation");
                      return result;
                    },
                  ],
                  afterRead: [
                    async ({ doc }) => {
                      order.push("collection.afterRead");
                      return doc;
                    },
                  ],
                  beforeChange: [
                    async ({ data }) => {
                      order.push("collection.beforeChange");
                      return data;
                    },
                  ],
                  beforeOperation: [
                    async () => {
                      order.push("collection.beforeOperation");
                    },
                  ],
                  beforeRead: [
                    async ({ doc }) => {
                      order.push("collection.beforeRead");
                      return doc;
                    },
                  ],
                  beforeValidate: [
                    async ({ data }) => {
                      order.push("collection.beforeValidate");
                      return data;
                    },
                  ],
                },
                slug: "posts",
              },
            ],
            slug: "content",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    const created = await runtime.create({
      collection: "posts",
      data: {
        title: "  hello  ",
      },
    });

    expect(created.title).toBe("hello-prepared-saved-read");
    expect(order).toEqual([
      "collection.beforeOperation",
      "collection.beforeValidate",
      "field.beforeValidate",
      "collection.beforeChange",
      "field.beforeChange",
      "field.afterChange",
      "collection.afterChange",
      "collection.beforeRead",
      "field.afterRead",
      "collection.afterRead",
      "collection.afterOperation",
    ]);
  });

  it("reuses shared hook context across nested runtime calls on the same request", async () => {
    const request = new Request("https://example.com/api/posts");
    const seen: string[] = [];
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [{ name: "name", type: "text" }],
                hooks: {
                  beforeOperation: [
                    async ({ context, req, oboe, operation }) => {
                      context.trace = ["companies.beforeOperation"];
                      seen.push(String((context.trace as string[])[0]));
                      if (operation === "create" && req) {
                        await oboe.create({
                          collection: "contacts",
                          data: { name: "Nested" },
                          req,
                        });
                      }
                    },
                  ],
                },
                slug: "companies",
              },
              {
                fields: [
                  {
                    hooks: {
                      beforeValidate: [
                        async ({ context, value }) => {
                          seen.push(
                            `${(context.trace as string[] | undefined)?.[0] ?? "missing"}:${String(value)}`
                          );
                          return value;
                        },
                      ],
                    },
                    name: "name",
                    type: "text",
                  },
                ],
                slug: "contacts",
              },
            ],
            slug: "crm",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    await runtime.create({
      collection: "companies",
      data: {
        name: "Acme",
      },
      req: request,
    });

    expect(seen).toContain("companies.beforeOperation");
    expect(seen).toContain("companies.beforeOperation:Nested");
  });

  it("runs global hooks and field hooks for singleton globals", async () => {
    const order: string[] = [];
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [],
            globals: [
              {
                fields: [
                  {
                    hooks: {
                      afterRead: [
                        async ({ value }) => {
                          order.push("field.afterRead");
                          return `${String(value)}-read`;
                        },
                      ],
                      beforeChange: [
                        async ({ value }) => {
                          order.push("field.beforeChange");
                          return String(value).trim();
                        },
                      ],
                      beforeValidate: [
                        async ({ value }) => {
                          order.push("field.beforeValidate");
                          return String(value).toUpperCase();
                        },
                      ],
                    },
                    name: "siteName",
                    type: "text",
                  },
                ],
                hooks: {
                  afterChange: [
                    async ({ doc }) => {
                      order.push("global.afterChange");
                      return doc;
                    },
                  ],
                  afterOperation: [
                    async ({ result }) => {
                      order.push("global.afterOperation");
                      return result;
                    },
                  ],
                  afterRead: [
                    async ({ doc }) => {
                      order.push("global.afterRead");
                      return doc;
                    },
                  ],
                  beforeChange: [
                    async ({ data }) => {
                      order.push("global.beforeChange");
                      return data;
                    },
                  ],
                  beforeOperation: [
                    async () => {
                      order.push("global.beforeOperation");
                    },
                  ],
                  beforeRead: [
                    async ({ doc }) => {
                      order.push("global.beforeRead");
                      return doc;
                    },
                  ],
                  beforeValidate: [
                    async ({ data }) => {
                      order.push("global.beforeValidate");
                      return data;
                    },
                  ],
                },
                slug: "site-settings",
              },
            ],
            slug: "settings",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    const updated = await runtime.updateGlobal({
      data: {
        siteName: " oboe ",
      },
      slug: "site-settings",
    });
    const loaded = await runtime.findGlobal({
      slug: "site-settings",
    });

    expect(updated.siteName).toBe("OBOE-read");
    expect(loaded?.siteName).toBe("OBOE-read");
    expect(order).toEqual([
      "global.beforeOperation",
      "global.beforeValidate",
      "field.beforeValidate",
      "global.beforeChange",
      "field.beforeChange",
      "global.afterChange",
      "global.beforeRead",
      "field.afterRead",
      "global.afterRead",
      "global.afterOperation",
      "global.beforeOperation",
      "global.beforeRead",
      "field.afterRead",
      "global.afterRead",
      "global.afterOperation",
    ]);
  });

  it("rejects invalid built-in field values and validates merged update state", async () => {
    const adapter = createMemoryAdapter();
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [
                  {
                    name: "name",
                    required: true,
                    type: "text",
                  },
                  {
                    name: "email",
                    type: "email",
                  },
                  {
                    name: "stage",
                    options: [
                      { label: "Lead", value: "lead" },
                      { label: "Won", value: "won" },
                    ],
                    type: "select",
                  },
                ],
                slug: "contacts",
              },
              {
                fields: [
                  {
                    name: "name",
                    type: "text",
                  },
                ],
                slug: "companies",
              },
              {
                fields: [
                  {
                    name: "amount",
                    type: "number",
                  },
                  {
                    name: "company",
                    relationTo: "companies",
                    type: "relationship",
                  },
                  {
                    name: "meta",
                    type: "json",
                  },
                ],
                slug: "deals",
              },
            ],
            slug: "crm",
          }),
        ],
      }),
      db: adapter,
    });

    await expect(
      runtime.create({
        collection: "contacts",
        data: {
          email: "bad-email",
          stage: "invalid",
        },
      })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["name"],
        }),
        expect.objectContaining({
          path: ["email"],
        }),
        expect.objectContaining({
          path: ["stage"],
        }),
      ]),
    });

    await expect(
      runtime.create({
        collection: "deals",
        data: {
          amount: Number.POSITIVE_INFINITY,
          company: "missing-company",
          meta: 10n as unknown as number,
        },
      })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["amount"],
        }),
        expect.objectContaining({
          path: ["company"],
        }),
        expect.objectContaining({
          path: ["meta"],
        }),
      ]),
    });

    const invalidRecordId = "seed-contact";
    adapter.store.set(
      "contacts",
      new Map([
        [
          invalidRecordId,
          {
            collection: "contacts",
            createdAt: new Date().toISOString(),
            data: {
              email: "still-bad",
              name: "",
              stage: "lead",
            },
            id: invalidRecordId,
            updatedAt: new Date().toISOString(),
          },
        ],
      ])
    );

    await expect(
      runtime.update({
        collection: "contacts",
        data: {
          stage: "won",
        },
        id: invalidRecordId,
      })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["name"],
        }),
        expect.objectContaining({
          path: ["email"],
        }),
      ]),
    });
  });

  it("applies field and collection schemas, including standard-schema style objects", async () => {
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [
                  {
                    name: "name",
                    schema: {
                      async parse(value) {
                        return {
                          value: String(value ?? "")
                            .trim()
                            .toUpperCase(),
                        };
                      },
                    },
                    type: "text",
                  },
                  {
                    name: "stage",
                    type: "text",
                  },
                ],
                schema: {
                  "~standard": {
                    async validate(value) {
                      const data = value as Record<string, unknown>;
                      return {
                        value: {
                          ...data,
                          stage: data.stage === undefined ? "lead" : data.stage,
                        },
                      };
                    },
                  },
                },
                slug: "contacts",
              },
            ],
            slug: "crm",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    const created = await runtime.create({
      collection: "contacts",
      data: {
        name: "  oboe dev  ",
      },
    });
    const updated = await runtime.update({
      collection: "contacts",
      data: {},
      id: created.id,
    });

    expect(created).toMatchObject({
      name: "OBOE DEV",
      stage: "lead",
    });
    expect(updated).toMatchObject({
      name: "OBOE DEV",
      stage: "lead",
    });
  });

  it("surfaces field and collection validator issues with stable paths", async () => {
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [
                  {
                    name: "name",
                    type: "text",
                    validate: ({ value }) =>
                      value === "blocked"
                        ? {
                            message: "Name is blocked.",
                          }
                        : undefined,
                  },
                  {
                    name: "email",
                    type: "email",
                  },
                ],
                slug: "contacts",
                validate: ({ data }) =>
                  data.email === "taken@example.com"
                    ? [
                        {
                          message: "Email is already taken.",
                          path: ["email"],
                        },
                      ]
                    : undefined,
              },
            ],
            slug: "crm",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    await expect(
      runtime.create({
        collection: "contacts",
        data: {
          email: "taken@example.com",
          name: "blocked",
        },
      })
    ).rejects.toBeInstanceOf(OboeValidationError);

    await expect(
      runtime.create({
        collection: "contacts",
        data: {
          email: "taken@example.com",
          name: "blocked",
        },
      })
    ).rejects.toMatchObject({
      issues: [
        {
          message: "Name is blocked.",
          path: ["name"],
        },
        {
          message: "Email is already taken.",
          path: ["email"],
        },
      ],
    });
  });

  it("supports where, sort, pagination, select, depth, and count through one query contract", async () => {
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [{ name: "name", required: true, type: "text" }],
                slug: "companies",
              },
              {
                fields: [
                  { name: "name", required: true, type: "text" },
                  {
                    maxDepth: 1,
                    name: "company",
                    relationTo: "companies",
                    type: "relation",
                  },
                  { name: "score", type: "number" },
                  { name: "status", type: "text" },
                ],
                slug: "contacts",
              },
            ],
            slug: "crm",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    const company = await runtime.create({
      collection: "companies",
      data: { name: "Acme" },
    });
    await runtime.create({
      collection: "contacts",
      data: { company: company.id, name: "Beta", score: 2, status: "lead" },
    });
    await runtime.create({
      collection: "contacts",
      data: { company: company.id, name: "Alpha", score: 10, status: "won" },
    });

    const result = await runtime.find({
      collection: "contacts",
      query: {
        depth: 1,
        limit: 1,
        page: 1,
        select: {
          company: {
            name: true,
          },
          name: true,
          score: true,
        },
        sort: ["-score", "name"],
        where: {
          and: [{ score: { gte: 2 } }],
          or: [{ status: { eq: "won" } }, { name: { startsWith: "B" } }],
        },
      },
    });

    expect(result.totalDocs).toBe(2);
    expect(result.totalPages).toBe(2);
    expect(result.docs[0]).toMatchObject({
      company: {
        name: "Acme",
      },
      name: "Alpha",
      score: 10,
    });

    const count = await runtime.count({
      collection: "contacts",
      query: {
        where: {
          score: { gte: 2 },
        },
      },
    });

    expect(count.totalDocs).toBe(2);
  });

  it("enforces access control across find, findById, and count", async () => {
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                access: {
                  read: ({ user }) => Boolean(user),
                },
                fields: [{ name: "name", type: "text" }],
                slug: "contacts",
              },
            ],
            slug: "crm",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    await runtime.create({
      collection: "contacts",
      data: { name: "Protected" },
      overrideAccess: true,
    });

    await expect(
      runtime.find({
        collection: "contacts",
      })
    ).rejects.toThrow('Access denied for read on "contacts".');
    await expect(
      runtime.count({
        collection: "contacts",
      })
    ).rejects.toThrow('Access denied for read on "contacts".');

    const result = await runtime.find({
      collection: "contacts",
      user: { id: "user-1" },
    });

    expect(result.docs).toHaveLength(1);
  });

  it("stores upload metadata, resolves URLs, and deletes replaced files", async () => {
    const uploads: string[] = [];
    const deletes: string[] = [];
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [{ name: "name", type: "text" }],
                slug: "media",
                storage: {
                  adapter: ({ prefix }) => ({
                    generateURL({ file }) {
                      return `https://cdn.example.com/${file.storageKey}`;
                    },
                    async handleDelete({ file }) {
                      deletes.push(file.storageKey);
                    },
                    async handleDownload({ file }) {
                      return new Response(file.filename);
                    },
                    async handleUpload({ file }) {
                      const storageKey = prefix
                        ? `${prefix}/${file.filename}`
                        : file.filename;
                      uploads.push(storageKey);
                      return {
                        filename: file.filename,
                        filesize: file.filesize,
                        mimeType: file.mimeType,
                        prefix,
                        storageAdapter: "test",
                        storageKey,
                      };
                    },
                    name: "test",
                  }),
                  prefix: "assets",
                  serveMode: "direct",
                },
                upload: true,
              },
            ],
            slug: "assets",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    const created = await runtime.create({
      collection: "media",
      data: {
        name: "Avatar",
      },
      file: {
        buffer: new Uint8Array([1, 2, 3]),
        filename: "avatar.png",
        filesize: 3,
        mimeType: "image/png",
      },
    });

    expect(created.file).toMatchObject({
      filename: "avatar.png",
      storageKey: "assets/avatar.png",
      url: "https://cdn.example.com/assets/avatar.png",
    });

    const updated = await runtime.update({
      collection: "media",
      data: {
        name: "Avatar v2",
      },
      file: {
        buffer: new Uint8Array([4, 5, 6]),
        filename: "avatar-v2.png",
        filesize: 3,
        mimeType: "image/png",
      },
      id: created.id,
    });

    expect(updated?.file).toMatchObject({
      filename: "avatar-v2.png",
      storageKey: "assets/avatar-v2.png",
      url: "https://cdn.example.com/assets/avatar-v2.png",
    });
    expect(uploads).toEqual(["assets/avatar.png", "assets/avatar-v2.png"]);
    expect(deletes).toEqual(["assets/avatar.png"]);

    await runtime.delete({
      collection: "media",
      id: created.id,
    });

    expect(deletes).toEqual(["assets/avatar.png", "assets/avatar-v2.png"]);
  });

  it("cleans up uploaded files when create or update persistence fails", async () => {
    const deletedOnCreateFailure: string[] = [];
    const createFailureRuntime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [{ name: "name", type: "text" }],
                slug: "media",
                storage: {
                  adapter: () => ({
                    async handleDelete({ file }) {
                      deletedOnCreateFailure.push(file.storageKey);
                    },
                    async handleDownload() {
                      return new Response(null, { status: 204 });
                    },
                    async handleUpload({ file }) {
                      return {
                        filename: file.filename,
                        filesize: file.filesize,
                        mimeType: file.mimeType,
                        storageAdapter: "test",
                        storageKey: `create/${file.filename}`,
                      };
                    },
                    name: "test",
                  }),
                },
                upload: true,
              },
            ],
            slug: "assets",
          }),
        ],
      }),
      db: {
        async create() {
          throw new Error("create failed");
        },
        async delete() {
          return null;
        },
        async find() {
          return [];
        },
        async findById() {
          return null;
        },
        async findGlobal() {
          return null;
        },
        async update() {
          return null;
        },
        async updateGlobal() {
          throw new Error("not implemented");
        },
      },
    });

    await expect(
      createFailureRuntime.create({
        collection: "media",
        data: {
          name: "Broken",
        },
        file: {
          buffer: new Uint8Array([1]),
          filename: "broken.png",
          filesize: 1,
          mimeType: "image/png",
        },
      })
    ).rejects.toThrow("create failed");
    expect(deletedOnCreateFailure).toEqual(["create/broken.png"]);

    const failingAdapter = createMemoryAdapter();
    const seedRuntime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [{ name: "name", type: "text" }],
                slug: "media",
                storage: {
                  adapter: () => ({
                    async handleDelete() {},
                    async handleDownload() {
                      return new Response(null, { status: 204 });
                    },
                    async handleUpload({ file }) {
                      return {
                        filename: file.filename,
                        filesize: file.filesize,
                        mimeType: file.mimeType,
                        storageAdapter: "test",
                        storageKey: `seed/${file.filename}`,
                      };
                    },
                    name: "test",
                  }),
                },
                upload: true,
              },
            ],
            slug: "assets",
          }),
        ],
      }),
      db: failingAdapter,
    });

    const existing = await seedRuntime.create({
      collection: "media",
      data: {
        name: "Seed",
      },
      file: {
        buffer: new Uint8Array([1]),
        filename: "seed.png",
        filesize: 1,
        mimeType: "image/png",
      },
    });

    const deletedOnUpdateFailure: string[] = [];
    const forwardingDb = {
      audits: failingAdapter.audits,
      jobs: failingAdapter.jobs,
      store: failingAdapter.store,
      async create(args: Parameters<typeof failingAdapter.create>[0]) {
        return failingAdapter.create(args);
      },
      async delete(args: Parameters<typeof failingAdapter.delete>[0]) {
        return failingAdapter.delete(args);
      },
      async enqueueJob(job: JobRequest) {
        return failingAdapter.enqueueJob(job);
      },
      async find(args: { collection: string; query?: CollectionQuery }) {
        return failingAdapter.find(args);
      },
      async findById(args: { collection: string; id: string }) {
        return failingAdapter.findById(args);
      },
      async findGlobal(args: { slug: string }) {
        return failingAdapter.findGlobal(args);
      },
      async recordAudit(entry: AuditEntry) {
        return failingAdapter.recordAudit(entry);
      },
      async update(_args: {
        collection: string;
        data: Record<string, unknown>;
        id: string;
      }): Promise<OboeRecord | null> {
        throw new Error("update failed");
      },
      async updateGlobal(args: {
        data: Record<string, unknown>;
        slug: string;
      }) {
        return failingAdapter.updateGlobal(args);
      },
    };
    const updateFailureRuntime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [{ name: "name", type: "text" }],
                slug: "media",
                storage: {
                  adapter: () => ({
                    async handleDelete({ file }) {
                      deletedOnUpdateFailure.push(file.storageKey);
                    },
                    async handleDownload() {
                      return new Response(null, { status: 204 });
                    },
                    async handleUpload({ file }) {
                      return {
                        filename: file.filename,
                        filesize: file.filesize,
                        mimeType: file.mimeType,
                        storageAdapter: "test",
                        storageKey: `update/${file.filename}`,
                      };
                    },
                    name: "test",
                  }),
                },
                upload: true,
              },
            ],
            slug: "assets",
          }),
        ],
      }),
      db: forwardingDb,
    });

    await expect(
      updateFailureRuntime.update({
        collection: "media",
        data: {
          name: "Broken update",
        },
        file: {
          buffer: new Uint8Array([2]),
          filename: "update.png",
          filesize: 1,
          mimeType: "image/png",
        },
        id: existing.id,
      })
    ).rejects.toThrow("update failed");

    expect(deletedOnUpdateFailure).toEqual(["update/update.png"]);
  });
});
