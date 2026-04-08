import { createOboeRuntime, defineConfig, defineModule } from "@oboe/core";
import { createMemoryAdapter } from "@oboe/core/testing";
import { describe, expect, it } from "vitest";

import { createHttpHandler } from "./index.js";

describe("createHttpHandler", () => {
  it("maps REST routes onto the shared runtime", async () => {
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
                slug: "contacts",
              },
            ],
            slug: "crm",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });
    const handler = createHttpHandler({
      runtime,
    });

    const createResponse = await handler(
      new Request("http://localhost/api/contacts", {
        body: JSON.stringify({
          name: "Oboe Dev",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      })
    );
    const created = (await createResponse.json()) as { id: string };
    const listResponse = await handler(
      new Request("http://localhost/api/contacts")
    );
    const listPayload = (await listResponse.json()) as {
      docs: Array<{ id: string; name: string }>;
      totalDocs: number;
    };

    expect(createResponse.status).toBe(201);
    expect(listPayload.docs[0]?.id).toBe(created.id);
    expect(listPayload.docs[0]?.name).toBe("Oboe Dev");
    expect(listPayload.totalDocs).toBe(1);
  });

  it("returns 400 with issues when validation fails", async () => {
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
    const handler = createHttpHandler({
      runtime,
    });

    const response = await handler(
      new Request("http://localhost/api/contacts", {
        body: JSON.stringify({
          email: "bad-email",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      })
    );
    const payload = (await response.json()) as {
      error: string;
      issues: Array<{ message: string; path?: PropertyKey[] }>;
    };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Validation failed");
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["name"],
        }),
        expect.objectContaining({
          path: ["email"],
        }),
      ])
    );
  });

  it("serves count and OpenAPI routes", async () => {
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
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
    const handler = createHttpHandler({ runtime });

    await handler(
      new Request("http://localhost/api/contacts", {
        body: JSON.stringify({ name: "Oboe Dev" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );

    const countResponse = await handler(
      new Request("http://localhost/api/contacts/count")
    );
    const countPayload = (await countResponse.json()) as { totalDocs: number };

    const openApiResponse = await handler(
      new Request("http://localhost/api/openapi.json")
    );
    const openApiPayload = (await openApiResponse.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };

    expect(countPayload.totalDocs).toBe(1);
    expect(openApiPayload.openapi).toBe("3.1.0");
    expect(openApiPayload.paths["/api/contacts"]).toBeDefined();
  });

  it("runs custom HTTP routes before built-in REST handling", async () => {
    const runtime = createOboeRuntime({
      config: defineConfig({
        http: {
          routes: [
            {
              async handler() {
                return new Response("custom-ok", {
                  status: 202,
                });
              },
              method: "GET",
              path: "/api/contacts",
            },
          ],
        },
        modules: [
          defineModule({
            collections: [
              {
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
    const handler = createHttpHandler({ runtime });

    const response = await handler(
      new Request("http://localhost/api/contacts")
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("custom-ok");
  });

  it("accepts multipart uploads for upload collections and proxies file downloads", async () => {
    const runtime = createOboeRuntime({
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
                    async handleDownload({ file }) {
                      return new Response(file.filename, {
                        headers: {
                          "content-type": file.mimeType,
                        },
                      });
                    },
                    async handleUpload({ file }) {
                      return {
                        filename: file.filename,
                        filesize: file.filesize,
                        mimeType: file.mimeType,
                        storageAdapter: "test",
                        storageKey: `uploads/${file.filename}`,
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
      db: createMemoryAdapter(),
    });
    const handler = createHttpHandler({ runtime });
    const form = new FormData();

    form.set(
      "data",
      JSON.stringify({
        name: "Avatar",
      })
    );
    form.set(
      "file",
      new File(["avatar-binary"], "avatar.png", { type: "image/png" })
    );

    const createResponse = await handler(
      new Request("http://localhost/api/media", {
        body: form,
        method: "POST",
      })
    );
    const created = (await createResponse.json()) as {
      file: { storageKey: string; url: string };
      id: string;
    };

    const downloadResponse = await handler(
      new Request(`http://localhost/api/media/${created.id}/file`)
    );

    expect(createResponse.status).toBe(201);
    expect(created.file.storageKey).toBe("uploads/avatar.png");
    expect(created.file.url).toBe(`/api/media/${created.id}/file`);
    expect(await downloadResponse.text()).toBe("avatar.png");
    expect(downloadResponse.headers.get("content-type")).toBe("image/png");
  });

  it("supports JSON updates for upload collections and exposes direct URLs", async () => {
    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [{ name: "name", type: "text" }],
                slug: "media",
                storage: {
                  adapter: () => ({
                    generateURL({ file }) {
                      return `https://cdn.example.com/${file.storageKey}`;
                    },
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
                        storageKey: `direct/${file.filename}`,
                      };
                    },
                    name: "test",
                  }),
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
    const handler = createHttpHandler({ runtime });
    const createForm = new FormData();

    createForm.set(
      "data",
      JSON.stringify({
        name: "Avatar",
      })
    );
    createForm.set(
      "file",
      new File(["avatar"], "avatar.png", { type: "image/png" })
    );

    const createResponse = await handler(
      new Request("http://localhost/api/media", {
        body: createForm,
        method: "POST",
      })
    );
    const created = (await createResponse.json()) as { id: string };

    const updateResponse = await handler(
      new Request(`http://localhost/api/media/${created.id}`, {
        body: JSON.stringify({
          name: "Avatar Updated",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "PATCH",
      })
    );
    const updated = (await updateResponse.json()) as {
      file: { url: string };
      name: string;
    };

    expect(updateResponse.status).toBe(200);
    expect(updated.name).toBe("Avatar Updated");
    expect(updated.file.url).toBe("https://cdn.example.com/direct/avatar.png");
  });
});
