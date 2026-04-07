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
        async update() {
          return null;
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
