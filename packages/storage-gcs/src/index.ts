import { Storage, type StorageOptions } from "@google-cloud/storage";
import type { PluginConfig, StorageAdapterFactory } from "@oboe/core";
import {
  type CollectionStorageOptions,
  storagePlugin,
} from "@oboe/plugin-storage";

function normalizePathSegment(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "." && segment !== "..")
    .join("/")
    .replace(/^\/+/, "")
    .replace(/[^\w./-]/g, "-");
}

function sanitizeFilename(filename: string) {
  const segments = normalizePathSegment(filename).split("/");
  return segments[segments.length - 1] || "file";
}

function resolveBaseUrl(args: { baseUrl?: string; bucket: string }) {
  if (args.baseUrl) {
    return args.baseUrl.replace(/\/+$/, "");
  }

  return `https://storage.googleapis.com/${args.bucket}`;
}

export interface GcsStorageOptions {
  baseUrl?: string;
  bucket: string;
  collections: Partial<
    Record<string, Omit<CollectionStorageOptions, "adapter"> | true>
  >;
  config?: StorageOptions;
  enabled?: boolean;
}

export function createGcsAdapterFactory(
  options: GcsStorageOptions
): StorageAdapterFactory {
  const client = new Storage(options.config);
  const bucket = client.bucket(options.bucket);
  const baseUrl = resolveBaseUrl(options);

  return ({ prefix }) => ({
    generateURL({ file }) {
      return `${baseUrl}/${normalizePathSegment(file.storageKey)}`;
    },
    async handleDelete({ file }) {
      await bucket.file(file.storageKey).delete();
    },
    async handleDownload({ file }) {
      const [buffer] = await bucket.file(file.storageKey).download();
      const bytes = Uint8Array.from(buffer);

      return new Response(new Blob([bytes]), {
        headers: {
          "content-length": String(buffer.byteLength),
          "content-type": file.mimeType,
        },
        status: 200,
      });
    },
    async handleUpload({ file }) {
      const filename = sanitizeFilename(file.filename);
      const key = prefix
        ? `${normalizePathSegment(prefix)}/${crypto.randomUUID()}-${filename}`
        : `${crypto.randomUUID()}-${filename}`;

      await bucket.file(key).save(Buffer.from(file.buffer), {
        contentType: file.mimeType,
        resumable: false,
      });

      return {
        filename,
        filesize: file.filesize,
        mimeType: file.mimeType,
        prefix,
        storageAdapter: "gcs",
        storageKey: key,
      };
    },
    name: "gcs",
  });
}

export function gcsStorage(options: GcsStorageOptions): PluginConfig {
  const adapter = createGcsAdapterFactory(options);

  return storagePlugin({
    collections: Object.fromEntries(
      Object.entries(options.collections).map(([slug, value]) => [
        slug,
        {
          ...(value === true ? {} : value),
          adapter,
        },
      ])
    ),
    enabled: options.enabled,
  });
}
