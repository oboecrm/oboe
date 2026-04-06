import type { PluginConfig, StorageAdapterFactory } from "@oboe/core";
import {
  type CollectionStorageOptions,
  storagePlugin,
} from "@oboe/plugin-storage";
import { del, get, put } from "@vercel/blob";

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

export interface VercelBlobStorageOptions {
  access?: "private" | "public";
  addRandomSuffix?: boolean;
  allowOverwrite?: boolean;
  cacheControlMaxAge?: number;
  collections: Partial<
    Record<string, Omit<CollectionStorageOptions, "adapter"> | true>
  >;
  enabled?: boolean;
  multipart?: boolean;
  token?: string;
}

export function createVercelBlobAdapterFactory(
  options: VercelBlobStorageOptions
): StorageAdapterFactory {
  const access = options.access ?? "private";

  return ({ prefix }) => ({
    generateURL({ file }) {
      const url = file.providerMetadata?.url;
      return typeof url === "string" ? url : "";
    },
    async handleDelete({ file }) {
      await del(file.storageKey, {
        token: options.token,
      });
    },
    async handleDownload({ file }) {
      const result = await get(file.storageKey, {
        access,
        token: options.token,
      });

      if (!result || result.statusCode !== 200) {
        return new Response("Not found", {
          status: 404,
        });
      }

      return new Response(result.stream, {
        headers: {
          "content-type": result.blob.contentType || file.mimeType,
        },
        status: 200,
      });
    },
    async handleUpload({ file }) {
      const filename = sanitizeFilename(file.filename);
      const pathname = prefix
        ? `${normalizePathSegment(prefix)}/${crypto.randomUUID()}-${filename}`
        : `${crypto.randomUUID()}-${filename}`;

      const blob = await put(pathname, Buffer.from(file.buffer), {
        access,
        addRandomSuffix: options.addRandomSuffix ?? false,
        allowOverwrite: options.allowOverwrite,
        cacheControlMaxAge: options.cacheControlMaxAge,
        contentType: file.mimeType,
        multipart: options.multipart,
        token: options.token,
      });

      return {
        filename,
        filesize: file.filesize,
        mimeType: file.mimeType,
        prefix,
        providerMetadata: {
          downloadUrl: blob.downloadUrl,
          pathname: blob.pathname,
          url: blob.url,
        },
        storageAdapter: "vercel-blob",
        storageKey: blob.pathname,
      };
    },
    name: "vercel-blob",
  });
}

export function vercelBlobStorage(
  options: VercelBlobStorageOptions
): PluginConfig {
  const adapter = createVercelBlobAdapterFactory(options);

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
