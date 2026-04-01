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
      docs: Array<{ id: string }>;
    };

    expect(createResponse.status).toBe(201);
    expect(listPayload.docs[0]?.id).toBe(created.id);
  });
});
