# @oboe/storage-s3

S3-compatible upload storage provider for Oboe.

This package is a thin wrapper over [`@oboe/plugin-storage`](../plugin-storage/README.md). It wires an S3-backed adapter into one or more upload-enabled collections and supports both proxy and direct URLs.

## Install

```bash
pnpm add @oboe/storage-s3
```

## Basic Usage

```ts
import { defineConfig, defineModule } from "@oboe/core";
import { s3Storage } from "@oboe/storage-s3";

export default defineConfig({
  modules: [
    defineModule({
      slug: "assets",
      collections: [
        {
          slug: "media",
          upload: {
            maxFileSize: 10 * 1024 * 1024,
            mimeTypes: ["image/png", "image/jpeg", "application/pdf"],
          },
          fields: [{ name: "title", type: "text" }],
        },
      ],
    }),
  ],
  plugins: [
    s3Storage({
      bucket: process.env.S3_BUCKET!,
      config: {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
        region: process.env.S3_REGION!,
      },
      collections: {
        media: {
          prefix: "uploads",
          serveMode: "proxy",
        },
      },
    }),
  ],
});
```

## Environment Variables

Typical AWS S3 setup:

```bash
export S3_BUCKET=oboe-media
export S3_REGION=ap-northeast-1
export S3_ACCESS_KEY_ID=...
export S3_SECRET_ACCESS_KEY=...
```

Typical Cloudflare R2 setup through the S3-compatible API:

```bash
export S3_BUCKET=oboe-media
export S3_REGION=auto
export S3_ACCESS_KEY_ID=...
export S3_SECRET_ACCESS_KEY=...
export S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

And then:

```ts
s3Storage({
  bucket: process.env.S3_BUCKET!,
  config: {
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    region: process.env.S3_REGION!,
  },
  collections: {
    media: true,
  },
});
```

## Options

```ts
type S3StorageOptions = {
  baseUrl?: string;
  bucket: string;
  collections: Partial<
    Record<
      string,
      | true
      | {
          generateFileURL?: CollectionStorageOptions["generateFileURL"];
          prefix?: string;
          serveMode?: "direct" | "proxy";
        }
    >
  >;
  config: S3ClientConfig;
  enabled?: boolean;
};
```

Notes:

- `prefix` scopes object keys per collection
- `serveMode` defaults to `proxy`
- `baseUrl` lets you override the generated public base URL when `serveMode` is `direct`
- `enabled: false` disables adapter injection cleanly

## `serveMode`

- `proxy`: Oboe returns `/api/:collection/:id/file` in `doc.file.url`, and file reads are streamed through the app
- `direct`: Oboe returns a provider URL built from `baseUrl` or the inferred bucket URL

Use `proxy` for private assets. Use `direct` for public assets or CDN-fronted buckets.

## Stored File Metadata

S3 uploads are persisted into the reserved `file` field:

```ts
type StoredFileData = {
  filename: string;
  filesize: number;
  mimeType: string;
  prefix?: string;
  providerMetadata?: Record<string, unknown>;
  storageAdapter: string;
  storageKey: string;
  url?: string;
};
```

For S3, `storageKey` is the object key used for `PutObject`, `GetObject`, and `DeleteObject`.

## REST Upload Flow

Upload-enabled collections use:

- `POST /api/:collection` with `multipart/form-data`
- `PATCH /api/:collection/:id` with JSON or `multipart/form-data`
- `GET /api/:collection/:id/file` for proxy downloads

Multipart requests include:

- `file`: binary upload
- `data`: JSON string for the document fields
