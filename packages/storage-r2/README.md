# @oboe/storage-r2

Cloudflare R2 upload storage provider for Oboe.

This package is a Cloudflare-focused wrapper around [`@oboe/storage-s3`](../storage-s3/README.md). It configures the S3-compatible R2 endpoint for you and keeps the same collection-level DX.

## Install

```bash
pnpm add @oboe/storage-r2
```

## Basic Usage

```ts
import { defineConfig, defineModule } from "@oboe/core";
import { r2Storage } from "@oboe/storage-r2";

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
    r2Storage({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
      bucket: process.env.R2_BUCKET!,
      config: {
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID!,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
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

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export R2_BUCKET=oboe-media
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
```

If you want direct public URLs through a custom domain or R2 public domain:

```bash
export R2_PUBLIC_BASE_URL=https://cdn.example.com
```

Then:

```ts
r2Storage({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
  baseUrl: process.env.R2_PUBLIC_BASE_URL,
  bucket: process.env.R2_BUCKET!,
  config: {
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  },
  collections: {
    media: {
      serveMode: "direct",
    },
  },
});
```

## Options

```ts
type R2StorageOptions = {
  accountId: string;
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
  config?: Omit<S3ClientConfig, "endpoint" | "forcePathStyle" | "region"> & {
    region?: string;
  };
  enabled?: boolean;
  endpoint?: string;
};
```

Notes:

- `accountId` is used to infer `https://<account-id>.r2.cloudflarestorage.com`
- `endpoint` lets you override the inferred endpoint for development or emulation
- `region` defaults to `auto`
- `forcePathStyle` is always enabled for R2
- `serveMode` defaults to `proxy`
- `baseUrl` is the public URL base used for `direct` URLs

## `serveMode`

- `proxy`: `doc.file.url` becomes `/api/:collection/:id/file`
- `direct`: `doc.file.url` is generated from `baseUrl`, `generateFileURL`, or the adapter URL generator

For private files, keep `proxy`. For public buckets or custom domains, use `direct`.

## Stored File Metadata

R2 uses the same reserved `file` shape as other Oboe storage providers:

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

## REST Upload Flow

Upload-enabled collections use:

- `POST /api/:collection` with `multipart/form-data`
- `PATCH /api/:collection/:id` with JSON or `multipart/form-data`
- `GET /api/:collection/:id/file` for proxy downloads

Multipart requests include:

- `file`: binary upload
- `data`: JSON string for document fields
