import { compileSchema, defineConfig, defineModule } from "@oboe/core";
import { describe, expect, it } from "vitest";

import { createGcsAdapterFactory, gcsStorage } from "./index.js";

describe("gcsStorage", () => {
  it("wraps storagePlugin with adapter injection and collection overrides", () => {
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
        gcsStorage({
          bucket: "oboe-media",
          collections: {
            media: {
              prefix: "public",
              serveMode: "direct",
            },
          },
          config: {
            projectId: "oboe-dev",
          },
        }),
      ],
    });

    const media = compileSchema(config).collections.get("media");

    expect(media?.storage?.prefix).toBe("public");
    expect(media?.storage?.serveMode).toBe("direct");
    expect(media?.storage?.adapter).toBeTypeOf("function");
  });

  it("generates stable public URLs from adapter defaults", async () => {
    const adapter = createGcsAdapterFactory({
      bucket: "oboe-media",
      collections: {},
      config: {
        projectId: "oboe-dev",
      },
    })({
      collection: {
        fields: [],
        slug: "media",
        upload: true,
      },
      prefix: "public",
      serveMode: "direct",
    });

    const url = await adapter.generateURL?.({
      collection: {
        fields: [],
        slug: "media",
        upload: true,
      },
      file: {
        filename: "avatar.png",
        filesize: 128,
        mimeType: "image/png",
        prefix: "public",
        storageAdapter: "gcs",
        storageKey: "public/example-avatar.png",
      },
    });

    expect(url).toBe(
      "https://storage.googleapis.com/oboe-media/public/example-avatar.png"
    );
  });
});
