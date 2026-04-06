import type { S3ClientConfig } from "@aws-sdk/client-s3";
import type { PluginConfig } from "@oboe/core";
import type { CollectionStorageOptions } from "@oboe/plugin-storage";
import {
  createS3AdapterFactory,
  type S3StorageOptions,
  s3Storage,
} from "@oboe/storage-s3";

export interface R2StorageOptions {
  accountId: string;
  baseUrl?: string;
  bucket: string;
  collections: Partial<
    Record<string, Omit<CollectionStorageOptions, "adapter"> | true>
  >;
  config?: Omit<S3ClientConfig, "endpoint" | "forcePathStyle" | "region"> & {
    region?: string;
  };
  enabled?: boolean;
  endpoint?: string;
}

export function createR2StorageOptions(
  options: R2StorageOptions
): S3StorageOptions {
  return {
    baseUrl: options.baseUrl,
    bucket: options.bucket,
    collections: options.collections,
    config: {
      ...options.config,
      endpoint:
        options.endpoint ??
        `https://${options.accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      region: options.config?.region ?? "auto",
    },
    enabled: options.enabled,
  };
}

export function createR2AdapterFactory(options: R2StorageOptions) {
  return createS3AdapterFactory(createR2StorageOptions(options));
}

export function r2Storage(options: R2StorageOptions): PluginConfig {
  return s3Storage(createR2StorageOptions(options));
}
