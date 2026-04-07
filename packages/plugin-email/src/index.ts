import type { EmailAdapter, OboeConfig, PluginConfig } from "@oboe/core";

export type { EmailAdapter, InitializedEmailAdapter } from "@oboe/core";

export interface EmailPluginOptions {
  adapter: EmailAdapter | Promise<EmailAdapter>;
  enabled?: boolean;
}

export function emailPlugin(options: EmailPluginOptions): PluginConfig {
  return {
    extendConfig(config: OboeConfig): OboeConfig {
      if (options.enabled === false) {
        return config;
      }

      return {
        ...config,
        email: options.adapter,
      };
    },
    name: "@oboe/plugin-email",
  };
}
