import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from "@azure/storage-blob";
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

async function readableToUint8Array(
  stream: NodeJS.ReadableStream | undefined
): Promise<Uint8Array> {
  if (!stream) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<
    Uint8Array | Buffer | string
  >) {
    chunks.push(
      typeof chunk === "string"
        ? new TextEncoder().encode(chunk)
        : new Uint8Array(chunk)
    );
  }

  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function resolveServiceUrl(options: AzureBlobStorageOptions) {
  if (options.serviceUrl) {
    return options.serviceUrl.replace(/\/+$/, "");
  }

  if (!options.accountName) {
    throw new Error(
      "Azure Blob storage requires accountName when serviceUrl is not provided."
    );
  }

  return `https://${options.accountName}.blob.core.windows.net`;
}

function resolveBaseUrl(options: AzureBlobStorageOptions) {
  if (options.baseUrl) {
    return options.baseUrl.replace(/\/+$/, "");
  }

  return `${resolveServiceUrl(options)}/${options.container}`;
}

function createBlobServiceClient(options: AzureBlobStorageOptions) {
  if (options.connectionString) {
    return BlobServiceClient.fromConnectionString(options.connectionString);
  }

  const serviceUrl = resolveServiceUrl(options);

  if (options.accountName && options.accountKey) {
    return new BlobServiceClient(
      serviceUrl,
      new StorageSharedKeyCredential(options.accountName, options.accountKey)
    );
  }

  if (options.sasToken) {
    const token = options.sasToken.replace(/^\?/, "");
    return new BlobServiceClient(`${serviceUrl}?${token}`);
  }

  throw new Error(
    "Azure Blob storage requires either connectionString, accountName + accountKey, or sasToken."
  );
}

export interface AzureBlobStorageOptions {
  accountKey?: string;
  accountName?: string;
  baseUrl?: string;
  collections: Partial<
    Record<string, Omit<CollectionStorageOptions, "adapter"> | true>
  >;
  connectionString?: string;
  container: string;
  enabled?: boolean;
  sasToken?: string;
  serviceUrl?: string;
}

export function createAzureBlobAdapterFactory(
  options: AzureBlobStorageOptions
): StorageAdapterFactory {
  const service = createBlobServiceClient(options);
  const container = service.getContainerClient(options.container);
  const baseUrl = resolveBaseUrl(options);

  return ({ prefix }) => ({
    generateURL({ file }) {
      return `${baseUrl}/${normalizePathSegment(file.storageKey)}`;
    },
    async handleDelete({ file }) {
      await container.deleteBlob(file.storageKey, {
        deleteSnapshots: "include",
      });
    },
    async handleDownload({ file }) {
      const blob = container.getBlobClient(file.storageKey);
      const response = await blob.download();
      const body = await readableToUint8Array(response.readableStreamBody);

      return new Response(Buffer.from(body), {
        headers: {
          "content-length": String(body.byteLength),
          "content-type": response.contentType || file.mimeType,
        },
        status: 200,
      });
    },
    async handleUpload({ file }) {
      const filename = sanitizeFilename(file.filename);
      const key = prefix
        ? `${normalizePathSegment(prefix)}/${crypto.randomUUID()}-${filename}`
        : `${crypto.randomUUID()}-${filename}`;

      const blob = container.getBlockBlobClient(key);
      const upload = await blob.uploadData(Buffer.from(file.buffer), {
        blobHTTPHeaders: {
          blobContentType: file.mimeType,
        },
      });

      return {
        filename,
        filesize: file.filesize,
        mimeType: file.mimeType,
        prefix,
        providerMetadata: {
          etag: upload.etag,
          url: blob.url,
        },
        storageAdapter: "azure-blob",
        storageKey: key,
      };
    },
    name: "azure-blob",
  });
}

export function azureBlobStorage(
  options: AzureBlobStorageOptions
): PluginConfig {
  const adapter = createAzureBlobAdapterFactory(options);

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
