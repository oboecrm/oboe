import type {
  CollectionConfig,
  CollectionStorageConfig,
  GenerateFileURL,
  OboeConfig,
  PluginConfig,
  StorageAdapterFactory,
  StorageServeMode,
} from "@oboe/core";
import { mapCollections } from "@oboe/core";

export type {
  CollectionStorageConfig,
  GeneratedStorageAdapter,
  GenerateFileURL,
  StorageAdapterFactory,
  StorageServeMode,
  StoredFileData,
  UploadInputFile,
} from "@oboe/core";

export interface CollectionStorageOptions {
  adapter?: StorageAdapterFactory;
  generateFileURL?: GenerateFileURL;
  prefix?: string;
  serveMode?: StorageServeMode;
}

export interface StoragePluginOptions {
  collections: Partial<Record<string, CollectionStorageOptions | true>>;
  enabled?: boolean;
}

function normalizeCollectionStorageOption(
  value: CollectionStorageOptions | true
): CollectionStorageConfig {
  return value === true ? {} : value;
}

function extendCollection(
  collection: CollectionConfig,
  option: CollectionStorageOptions | true
): CollectionConfig {
  return {
    ...collection,
    storage: {
      ...collection.storage,
      ...normalizeCollectionStorageOption(option),
    },
  };
}

export function storagePlugin(options: StoragePluginOptions): PluginConfig {
  return {
    extendConfig(config: OboeConfig): OboeConfig {
      if (options.enabled === false) {
        return config;
      }

      return mapCollections(config, (collection) => {
        const option = options.collections[collection.slug];

        return option ? extendCollection(collection, option) : collection;
      });
    },
    name: "@oboe/plugin-storage",
  };
}
