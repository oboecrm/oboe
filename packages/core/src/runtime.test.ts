import { describe, expect, it } from "vitest";

import { defineConfig, defineModule } from "./config.js";
import { createOboeRuntime } from "./runtime.js";
import { createMemoryAdapter } from "./testing/memory-adapter.js";
import { OboeValidationError } from "./types.js";

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
    expect(created.stage).toBe("new");
    expect(created.afterChangeSeen).toBe(true);
    expect(loaded?.afterReadSeen).toBe(true);
    expect(seenEvents).toEqual(["created"]);
    expect(adapter.jobs).toHaveLength(1);
    expect(adapter.audits).toHaveLength(1);
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

  it("runs beforeChange hooks before built-in validation", async () => {
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
                  beforeChange: [
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
});
