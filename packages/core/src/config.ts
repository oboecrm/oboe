import type {
  ComponentReference,
  ModuleConfig,
  OboeConfig,
  TypeScriptConfig,
} from "./types.js";

const RESOLVED_CONFIG = Symbol.for("@oboe/core/resolved-config");
const warnedLegacyComponents = new Set<string>();

const defaultTypeScriptConfig: Required<TypeScriptConfig> = {
  autoGenerate: false,
  declare: true,
  outputFile: "./oboe-types.generated.ts",
};

export function defineModule<TModule extends ModuleConfig>(
  module: TModule
): TModule {
  return module;
}

export function defineConfig<const TConfig extends OboeConfig>(
  config: TConfig
): TConfig {
  return config;
}

function normalizeTypeScriptConfig(config: OboeConfig): OboeConfig {
  return {
    ...config,
    typescript: {
      ...defaultTypeScriptConfig,
      ...config.typescript,
    },
  };
}

function componentReferencePath(value: ComponentReference) {
  return typeof value === "string" ? value : value.path;
}

function isLegacyComponentReference(value: ComponentReference) {
  const candidate = componentReferencePath(value);

  return (
    !candidate.startsWith("/") &&
    !candidate.startsWith("./") &&
    !candidate.startsWith("@")
  );
}

function warnLegacyComponent(value: ComponentReference, context: string) {
  const candidate = componentReferencePath(value);

  if (
    process.env.NODE_ENV === "production" ||
    !isLegacyComponentReference(value) ||
    warnedLegacyComponents.has(candidate)
  ) {
    return;
  }

  warnedLegacyComponents.add(candidate);
  console.warn(
    `Legacy component reference "${candidate}" in ${context} is deprecated. Switch to a Payload-style component path.`
  );
}

function warnForLegacyComponents(config: OboeConfig) {
  for (const [slot, component] of Object.entries(
    config.admin?.components ?? {}
  )) {
    warnLegacyComponent(component, `admin.components.${slot}`);
  }

  for (const [slot, view] of Object.entries(config.admin?.views ?? {})) {
    warnLegacyComponent(view.component, `admin.views.${slot}`);
  }

  for (const moduleConfig of config.modules) {
    for (const collection of moduleConfig.collections) {
      for (const [slot, view] of Object.entries(
        collection.admin?.views ?? {}
      )) {
        warnLegacyComponent(
          view.component,
          `modules.${moduleConfig.slug}.collections.${collection.slug}.admin.views.${slot}`
        );
      }
    }
  }
}

export function resolveConfig<TConfig extends OboeConfig>(
  config: TConfig
): OboeConfig {
  if ((config as OboeConfig & { [RESOLVED_CONFIG]?: true })[RESOLVED_CONFIG]) {
    return config;
  }

  const plugins = config.plugins ?? [];
  const resolved = normalizeTypeScriptConfig(
    plugins.reduce<OboeConfig>((currentConfig, plugin) => {
      if (!plugin.extendConfig) {
        return currentConfig;
      }

      return plugin.extendConfig(currentConfig);
    }, config)
  );

  warnForLegacyComponents(resolved);
  Object.defineProperty(resolved, RESOLVED_CONFIG, {
    enumerable: false,
    value: true,
  });

  return resolved;
}
