import { defineConfig, defineModule } from "@oboe/core";
import { compileSchema } from "@oboe/core";
import { expect, it } from "vitest";

import { createRelationalManifest } from "./manifest.js";

it("creates a stable manifest checksum from the compiled schema", () => {
  const schema = compileSchema(
    defineConfig({
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
    })
  );

  const first = createRelationalManifest(schema);
  const second = createRelationalManifest(schema);

  expect(first.checksum).toBe(second.checksum);
  expect(first.storageVersion).toBe(1);
});
