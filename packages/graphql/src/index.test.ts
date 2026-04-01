import { createOboeRuntime, defineConfig, defineModule } from "@oboe/core";
import { createMemoryAdapter } from "@oboe/core/testing";
import { describe, expect, it } from "vitest";

import { createGraphQLService } from "./index.js";

describe("createGraphQLService", () => {
  it("resolves GraphQL through the shared runtime", async () => {
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
    const service = createGraphQLService(runtime);

    await service.execute({
      query: `
        mutation CreateContact($data: JSON!) {
          createContacts(data: $data) {
            id
          }
        }
      `,
      variables: {
        data: {
          name: "Oboe Dev",
        },
      },
    });

    const result = (await service.execute({
      query: `
        query ListContacts {
          contactsList {
            data
          }
        }
      `,
    })) as {
      data?: {
        contactsList?: Array<{ data: { name: string } }>;
      };
    };

    expect(result.data?.contactsList?.[0]?.data.name).toBe("Oboe Dev");
  });
});
