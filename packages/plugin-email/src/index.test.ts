import { defineConfig, defineModule } from "@oboe/core";
import { describe, expect, it } from "vitest";

import { emailPlugin } from "./index.js";

describe("emailPlugin", () => {
  it("injects top-level email config", async () => {
    const adapter = () => ({
      defaultFromAddress: "info@oboe.dev",
      defaultFromName: "Oboe",
      name: "test-email",
      sendEmail: async () => ({ ok: true }),
    });
    const config = defineConfig({
      modules: [
        defineModule({
          collections: [],
          slug: "crm",
        }),
      ],
      plugins: [
        emailPlugin({
          adapter,
        }),
      ],
    });

    expect(await config.email).toBe(adapter);
  });

  it("leaves existing config untouched when disabled", () => {
    const config = defineConfig({
      modules: [
        defineModule({
          collections: [],
          slug: "crm",
        }),
      ],
      plugins: [
        emailPlugin({
          adapter: () => ({
            defaultFromAddress: "info@oboe.dev",
            defaultFromName: "Oboe",
            name: "test-email",
            sendEmail: async () => ({ ok: true }),
          }),
          enabled: false,
        }),
      ],
    });

    expect(config.email).toBeUndefined();
  });
});
