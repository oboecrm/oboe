import { compileSchema, defineConfig, defineModule } from "@oboe/core";
import { describe, expect, it } from "vitest";

import { createS3AdapterFactory, s3Storage } from "./index.js";

describe("s3Storage", () => {
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
        s3Storage({
          bucket: "oboe-media",
          collections: {
            media: {
              prefix: "public",
              serveMode: "direct",
            },
          },
          config: {
            region: "ap-northeast-1",
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
    const adapter = createS3AdapterFactory({
      bucket: "oboe-media",
      collections: {},
      config: {
        region: "ap-northeast-1",
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
        storageAdapter: "s3",
        storageKey: "public/example-avatar.png",
      },
    });

    expect(url).toBe(
      "https://oboe-media.s3.ap-northeast-1.amazonaws.com/public/example-avatar.png"
    );
  });
});
