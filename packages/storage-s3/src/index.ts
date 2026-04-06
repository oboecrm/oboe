import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
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

async function bodyToUint8Array(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    return body;
  }

  if (body && typeof body === "object" && "transformToByteArray" in body) {
    const transformToByteArray = body.transformToByteArray;
    if (typeof transformToByteArray === "function") {
      return await transformToByteArray.call(body);
    }
  }

  if (
    body &&
    typeof body === "object" &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === "function"
  ) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<
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

  throw new Error("Unsupported S3 response body.");
}

function resolveBaseUrl(args: {
  baseUrl?: string;
  bucket: string;
  config: S3ClientConfig;
}) {
  if (args.baseUrl) {
    return args.baseUrl.replace(/\/+$/, "");
  }

  const endpoint = args.config.endpoint;
  if (typeof endpoint === "string") {
    return `${endpoint.replace(/\/+$/, "")}/${args.bucket}`;
  }

  const region =
    typeof args.config.region === "string" ? args.config.region : "us-east-1";

  return `https://${args.bucket}.s3.${region}.amazonaws.com`;
}

export interface S3StorageOptions {
  baseUrl?: string;
  bucket: string;
  collections: Partial<
    Record<string, Omit<CollectionStorageOptions, "adapter"> | true>
  >;
  config: S3ClientConfig;
  enabled?: boolean;
}

export function createS3AdapterFactory(
  options: S3StorageOptions
): StorageAdapterFactory {
  const client = new S3Client(options.config);
  const baseUrl = resolveBaseUrl({
    baseUrl: options.baseUrl,
    bucket: options.bucket,
    config: options.config,
  });

  return ({ prefix }) => ({
    generateURL({ file }) {
      return `${baseUrl}/${normalizePathSegment(file.storageKey)}`;
    },
    async handleDelete({ file }) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: options.bucket,
          Key: file.storageKey,
        })
      );
    },
    async handleDownload({ file }) {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: options.bucket,
          Key: file.storageKey,
        })
      );
      const buffer = await bodyToUint8Array(response.Body);

      return new Response(Buffer.from(buffer), {
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

      await client.send(
        new PutObjectCommand({
          Body: file.buffer,
          Bucket: options.bucket,
          ContentLength: file.filesize,
          ContentType: file.mimeType,
          Key: key,
        })
      );

      return {
        filename,
        filesize: file.filesize,
        mimeType: file.mimeType,
        prefix,
        storageAdapter: "s3",
        storageKey: key,
      };
    },
    name: "s3",
  });
}

export function s3Storage(options: S3StorageOptions): PluginConfig {
  const adapter = createS3AdapterFactory(options);

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
