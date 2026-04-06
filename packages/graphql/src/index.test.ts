import { createOboeRuntime, defineConfig, defineModule } from "@oboe/core";
import { createMemoryAdapter } from "@oboe/core/testing";
import { GraphQLString } from "graphql";
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
        mutation CreateContact($data: ContactsCreateInput!) {
          createContacts(data: $data) {
            id
            name
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
            totalDocs
            docs {
              id
              name
            }
          }
        }
      `,
    })) as {
      data?: {
        contactsList?: {
          docs: Array<{ id: string; name: string }>;
          totalDocs: number;
        };
      };
    };

    expect(result.data?.contactsList?.docs[0]?.name).toBe("Oboe Dev");
    expect(result.data?.contactsList?.totalDocs).toBe(1);
  });

  it("supports collection-specific where inputs and custom GraphQL extensions", async () => {
    const runtime = createOboeRuntime({
      config: defineConfig({
        graphQL: {
          queries: () => ({
            healthcheck: {
              resolve: () => "ok",
              type: GraphQLString,
            },
          }),
        },
        modules: [
          defineModule({
            collections: [
              {
                fields: [
                  { name: "name", type: "text" },
                  { name: "score", type: "number" },
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

    await runtime.create({
      collection: "contacts",
      data: { name: "Alpha", score: 10 },
    });

    const result = (await service.execute({
      query: `
        query FilteredContacts {
          contactsList(where: { score: { gte: 5 } }) {
            docs {
              name
            }
          }
          healthcheck
        }
      `,
    })) as {
      data?: {
        contactsList?: { docs: Array<{ name: string }> };
        healthcheck?: string;
      };
    };

    expect(result.data?.contactsList?.docs).toEqual([{ name: "Alpha" }]);
    expect(result.data?.healthcheck).toBe("ok");
  });
});
