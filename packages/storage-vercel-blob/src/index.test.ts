import { compileSchema, defineConfig, defineModule } from "@oboe/core";
import { describe, expect, it } from "vitest";

import { createVercelBlobAdapterFactory, vercelBlobStorage } from "./index.js";

describe("vercelBlobStorage", () => {
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
        vercelBlobStorage({
          access: "public",
          collections: {
            media: {
              prefix: "public",
              serveMode: "direct",
            },
          },
          token: "vercel_blob_rw_store_123",
        }),
      ],
    });

    const media = compileSchema(config).collections.get("media");

    expect(media?.storage?.prefix).toBe("public");
    expect(media?.storage?.serveMode).toBe("direct");
    expect(media?.storage?.adapter).toBeTypeOf("function");
  });

  it("returns stored provider URL when available", async () => {
    const adapter = createVercelBlobAdapterFactory({
      access: "public",
      collections: {},
      token: "vercel_blob_rw_store_123",
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
        providerMetadata: {
          url: "https://store.public.blob.vercel-storage.com/public/avatar.png",
        },
        storageAdapter: "vercel-blob",
        storageKey: "public/avatar.png",
      },
    });

    expect(url).toBe(
      "https://store.public.blob.vercel-storage.com/public/avatar.png"
    );
  });
});
