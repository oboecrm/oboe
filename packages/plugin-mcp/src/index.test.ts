import { createOboeRuntime, defineConfig, defineModule } from "@oboe/core";
import { createMemoryAdapter } from "@oboe/core/testing";
import { createHttpHandler } from "@oboe/http";
import { describe, expect, it } from "vitest";
import * as z from "zod/v4";

import { issueMcpApiKey, mcpPlugin } from "./index.js";

async function createTestRuntime() {
  const issued = issueMcpApiKey();
  const events: string[] = [];
  const runtime = createOboeRuntime({
    config: defineConfig({
      auth: {
        collection: "users",
      },
      modules: [
        defineModule({
          collections: [
            {
              access: {
                read: ({ user }) => isUserRecord(user),
              },
              fields: [
                { name: "name", required: true, type: "text" },
                { name: "stage", type: "text" },
              ],
              slug: "contacts",
            },
            {
              fields: [{ name: "title", type: "text" }],
              slug: "media",
              upload: true,
            },
            {
              auth: true,
              fields: [{ name: "email", required: true, type: "email" }],
              slug: "users",
            },
          ],
          globals: [
            {
              fields: [{ name: "siteName", type: "text" }],
              slug: "settings",
            },
          ],
          slug: "crm",
        }),
      ],
      plugins: [
        mcpPlugin({
          collections: {
            contacts: {
              defaultSelect: {
                name: true,
              },
              enabled: {
                count: true,
                create: true,
                delete: true,
                find: true,
                findById: true,
                update: true,
              },
              overrideResponse({ result }) {
                return {
                  wrapped: result,
                };
              },
            },
            media: true,
          },
          globals: {
            settings: true,
          },
          mcp: {
            onEvent(event) {
              events.push(event.type);
            },
            tools: [
              {
                description: "Echo input.",
                handler({ params }) {
                  return {
                    echoed: params,
                  };
                },
                inputSchema: {
                  value: z.string(),
                },
                name: "custom.echo",
              },
            ],
          },
          overrideAuth: async ({ getDefaultAuthContext, req }) => {
            if (req.headers.get("x-use-override") === "true") {
              return {
                collections: {
                  contacts: {
                    count: true,
                    find: true,
                  },
                },
                globals: {
                  settings: {
                    find: true,
                  },
                },
                user: {
                  email: "override@example.com",
                },
              };
            }

            return await getDefaultAuthContext();
          },
        }),
      ],
    }),
    db: createMemoryAdapter(),
  });
  const user = await runtime.create({
    collection: "users",
    data: {
      email: "reader@example.com",
    },
    overrideAccess: true,
  });

  await runtime.create({
    collection: "contacts",
    data: {
      name: "Alice",
      stage: "new",
    },
    overrideAccess: true,
  });
  await runtime.updateGlobal({
    data: {
      siteName: "Oboe",
    },
    req: new Request("http://localhost/api/settings"),
    slug: "settings",
  });
  await runtime.create({
    collection: "mcp-api-keys",
    data: {
      collections: {
        contacts: {
          count: true,
          create: true,
          delete: true,
          find: true,
          findById: true,
          update: true,
        },
        media: {
          count: true,
          find: true,
          findById: true,
        },
      },
      enabled: true,
      globals: {
        settings: {
          find: true,
          update: true,
        },
      },
      keyHash: issued.keyHash,
      keyPrefix: issued.keyPrefix,
      name: "Default key",
      user: user.id,
    },
    overrideAccess: true,
  });

  return {
    events,
    handler: createHttpHandler({ runtime }),
    issued,
  };
}

function isUserRecord(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    "email" in value &&
    typeof (value as { email?: unknown }).email === "string"
  );
}

function callTool(args: {
  arguments?: Record<string, unknown>;
  authorization?: string;
  handler: ReturnType<typeof createHttpHandler>;
  name: string;
  override?: boolean;
}) {
  return args.handler(
    new Request("http://localhost/api/mcp", {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: args.arguments ?? {},
          name: args.name,
        },
      }),
      headers: {
        ...(args.authorization
          ? { authorization: `Bearer ${args.authorization}` }
          : {}),
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(args.override ? { "x-use-override": "true" } : {}),
      },
      method: "POST",
    })
  );
}

describe("@oboe/plugin-mcp", () => {
  it("issues hashed API keys without exposing persisted secrets", () => {
    const issued = issueMcpApiKey();

    expect(issued.plainTextKey.startsWith("oboe_mcp_")).toBe(true);
    expect(issued.keyPrefix).toBe(issued.plainTextKey.slice(0, 16));
    expect(issued.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("serves collection and global MCP tools over HTTP", async () => {
    const { handler, issued } = await createTestRuntime();

    const findResponse = await callTool({
      authorization: issued.plainTextKey,
      handler,
      name: "collection.contacts.find",
    });
    const findPayload = (await findResponse.json()) as {
      result: {
        content: Array<{ text: string }>;
      };
    };

    expect(findResponse.status).toBe(200);
    expect(findPayload.result.content[0]?.text).toContain('"wrapped"');
    expect(findPayload.result.content[0]?.text).toContain('"Alice"');

    const globalResponse = await callTool({
      arguments: {
        data: {
          siteName: "Oboe CRM",
        },
      },
      authorization: issued.plainTextKey,
      handler,
      name: "global.settings.update",
    });
    const globalPayload = (await globalResponse.json()) as {
      result: {
        content: Array<{ text: string }>;
      };
    };

    expect(globalResponse.status).toBe(200);
    expect(globalPayload.result.content[0]?.text).toContain("Oboe CRM");
  });

  it("rejects requests without valid bearer auth", async () => {
    const { handler } = await createTestRuntime();

    const response = await handler(
      new Request("http://localhost/api/mcp", {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "tools/list",
          params: {},
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
  });

  it("denies operations missing grants and suppresses upload writes", async () => {
    const { handler, issued } = await createTestRuntime();

    const response = await callTool({
      arguments: {
        data: {
          title: "Avatar",
        },
      },
      authorization: issued.plainTextKey,
      handler,
      name: "collection.media.create",
    });
    const payload = (await response.json()) as {
      result: {
        content: Array<{ text: string }>;
        isError?: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.result.isError).toBe(true);
    expect(payload.result.content[0]?.text).toContain("not found");
  });

  it("supports overrideAuth and custom tools", async () => {
    const { events, handler } = await createTestRuntime();

    const response = await callTool({
      arguments: {
        value: "hello",
      },
      handler,
      name: "custom.echo",
      override: true,
    });
    const payload = (await response.json()) as {
      result: {
        content: Array<{ text: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.result.content[0]?.text).toContain("hello");
    expect(events).toContain("tool.success");
  });
});
