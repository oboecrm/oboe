import { compileSchema, defineConfig, defineModule } from "@oboe/core";
import { describe, expect, it } from "vitest";

import { storagePlugin } from "./index.js";

describe("storagePlugin", () => {
  it("injects collection storage settings for targeted collections", () => {
    const config = defineConfig({
      modules: [
        defineModule({
          collections: [
            {
              fields: [{ name: "name", type: "text" }],
              slug: "media",
              upload: true,
            },
          ],
          slug: "assets",
        }),
      ],
      plugins: [
        storagePlugin({
          collections: {
            media: {
              prefix: "uploads",
              serveMode: "direct",
            },
          },
        }),
      ],
    });

    const media = compileSchema(config).collections.get("media");

    expect(media?.storage?.prefix).toBe("uploads");
    expect(media?.storage?.serveMode).toBe("direct");
  });

  it("falls back to local storage when disabled without changing upload schema", () => {
    const enabled = compileSchema(
      defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [{ name: "name", type: "text" }],
                slug: "media",
                upload: true,
              },
            ],
            slug: "assets",
          }),
        ],
        plugins: [
          storagePlugin({
            collections: {
              media: {
                prefix: "uploads",
              },
            },
          }),
        ],
      })
    );

    const disabled = compileSchema(
      defineConfig({
        modules: [
          defineModule({
            collections: [
              {
                fields: [{ name: "name", type: "text" }],
                slug: "media",
                upload: true,
              },
            ],
            slug: "assets",
          }),
        ],
        plugins: [
          storagePlugin({
            collections: {
              media: {
                prefix: "uploads",
              },
            },
            enabled: false,
          }),
        ],
      })
    );

    expect(
      enabled.collections.get("media")?.fields.map(({ name }) => name)
    ).toEqual(
      disabled.collections.get("media")?.fields.map(({ name }) => name)
    );
    expect(disabled.collections.get("media")?.storage).toBeUndefined();
  });
});
