import { compileSchema, defineConfig, defineModule } from "@oboe/core";
import { describe, expect, it } from "vitest";

import {
  createR2AdapterFactory,
  createR2StorageOptions,
  r2Storage,
} from "./index.js";

describe("r2Storage", () => {
  it("builds S3-compatible config for Cloudflare R2", () => {
    const options = createR2StorageOptions({
      accountId: "account-123",
      bucket: "oboe-media",
      collections: {
        media: true,
      },
      config: {
        credentials: {
          accessKeyId: "key",
          secretAccessKey: "secret",
        },
      },
    });

    expect(options.config.endpoint).toBe(
      "https://account-123.r2.cloudflarestorage.com"
    );
    expect(options.config.forcePathStyle).toBe(true);
    expect(options.config.region).toBe("auto");
  });

  it("wraps s3Storage with adapter injection and collection overrides", async () => {
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
        r2Storage({
          accountId: "account-123",
          baseUrl: "https://cdn.example.com",
          bucket: "oboe-media",
          collections: {
            media: {
              prefix: "private",
              serveMode: "direct",
            },
          },
          config: {
            credentials: {
              accessKeyId: "key",
              secretAccessKey: "secret",
            },
          },
        }),
      ],
    });

    const media = compileSchema(config).collections.get("media");
    const adapter = createR2AdapterFactory({
      accountId: "account-123",
      baseUrl: "https://cdn.example.com",
      bucket: "oboe-media",
      collections: {},
      config: {
        credentials: {
          accessKeyId: "key",
          secretAccessKey: "secret",
        },
      },
    })({
      collection: {
        fields: [],
        slug: "media",
        upload: true,
      },
      prefix: "private",
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
        prefix: "private",
        storageAdapter: "s3",
        storageKey: "private/example-avatar.png",
      },
    });

    expect(media?.storage?.prefix).toBe("private");
    expect(media?.storage?.serveMode).toBe("direct");
    expect(media?.storage?.adapter).toBeTypeOf("function");
    expect(url).toBe("https://cdn.example.com/private/example-avatar.png");
  });
});
