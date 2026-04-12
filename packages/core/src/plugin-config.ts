import type {
  CollectionConfig,
  HttpRouteConfig,
  ModuleConfig,
  OboeConfig,
} from "./types.js";

export function appendHttpRoutes(
  config: OboeConfig,
  routes: HttpRouteConfig[]
): OboeConfig {
  return {
    ...config,
    http: {
      ...config.http,
      routes: [...(config.http?.routes ?? []), ...routes],
    },
  };
}

export function appendModules(
  config: OboeConfig,
  modules: ModuleConfig[]
): OboeConfig {
  return {
    ...config,
    modules: [...config.modules, ...modules],
  };
}

export function mapCollections(
  config: OboeConfig,
  mapCollection: (
    collection: CollectionConfig,
    moduleConfig: ModuleConfig
  ) => CollectionConfig
) {
  return {
    ...config,
    modules: config.modules.map((moduleConfig) => ({
      ...moduleConfig,
      collections: moduleConfig.collections.map((collection) =>
        mapCollection(collection, moduleConfig)
      ),
    })),
  };
}

export function mergeCollectionConfig(
  base: CollectionConfig,
  override?: Partial<CollectionConfig>
): CollectionConfig {
  if (!override) {
    return base;
  }

  return {
    ...base,
    ...override,
    access: {
      ...base.access,
      ...override.access,
    },
    admin: {
      ...base.admin,
      ...override.admin,
      views: {
        ...base.admin?.views,
        ...override.admin?.views,
      },
    },
    hooks: {
      ...base.hooks,
      ...override.hooks,
    },
    storage: {
      ...base.storage,
      ...override.storage,
    },
  };
}
