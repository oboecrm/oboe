import { compileSchema, defineConfig, defineModule } from "@oboe/core";
import { describe, expect, it } from "vitest";

import { azureBlobStorage, createAzureBlobAdapterFactory } from "./index.js";

describe("azureBlobStorage", () => {
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
        azureBlobStorage({
          accountKey: "azure-account-key",
          accountName: "oboeassets",
          collections: {
            media: {
              prefix: "public",
              serveMode: "direct",
            },
          },
          container: "media",
        }),
      ],
    });

    const media = compileSchema(config).collections.get("media");

    expect(media?.storage?.prefix).toBe("public");
    expect(media?.storage?.serveMode).toBe("direct");
    expect(media?.storage?.adapter).toBeTypeOf("function");
  });

  it("generates direct URLs from the configured Azure container", async () => {
    const adapter = createAzureBlobAdapterFactory({
      accountKey: "azure-account-key",
      accountName: "oboeassets",
      collections: {},
      container: "media",
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
        storageAdapter: "azure-blob",
        storageKey: "public/avatar.png",
      },
    });

    expect(url).toBe(
      "https://oboeassets.blob.core.windows.net/media/public/avatar.png"
    );
  });
});
