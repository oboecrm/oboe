import type { ModuleConfig, OboeConfig } from "./types.js";

export function defineModule<TModule extends ModuleConfig>(
  module: TModule
): TModule {
  return module;
}

export function defineConfig<TConfig extends OboeConfig>(
  config: TConfig
): OboeConfig {
  const plugins = config.plugins ?? [];

  return plugins.reduce<OboeConfig>((currentConfig, plugin) => {
    if (!plugin.extendConfig) {
      return currentConfig;
    }

    return plugin.extendConfig(currentConfig);
  }, config);
}
