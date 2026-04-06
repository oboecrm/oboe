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
});
