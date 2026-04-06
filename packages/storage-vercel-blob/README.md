# @oboe/storage-vercel-blob

Vercel Blob upload provider for Oboe.

This package integrates Vercel Blob using the official `@vercel/blob` SDK. It supports both public and private Blob stores.

## Install

```bash
pnpm add @oboe/storage-vercel-blob
```

## Basic Usage

```ts
import { defineConfig, defineModule } from "@oboe/core";
import { vercelBlobStorage } from "@oboe/storage-vercel-blob";

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
    vercelBlobStorage({
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
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
export BLOB_READ_WRITE_TOKEN=...
```

For public Blob stores with direct URLs:

```ts
vercelBlobStorage({
  access: "public",
  token: process.env.BLOB_READ_WRITE_TOKEN,
  collections: {
    media: {
      serveMode: "direct",
    },
  },
});
```

## Options

```ts
type VercelBlobStorageOptions = {
  access?: "private" | "public";
  addRandomSuffix?: boolean;
  allowOverwrite?: boolean;
  cacheControlMaxAge?: number;
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
  enabled?: boolean;
  multipart?: boolean;
  token?: string;
};
```

Notes:

- `access` defaults to `private`
- `serveMode` defaults to `proxy`
- `token` defaults to `process.env.BLOB_READ_WRITE_TOKEN` inside the SDK when omitted
- `direct` only makes sense for public stores, or when you intentionally want to expose the raw Blob URL

## `serveMode`

- `proxy`: `doc.file.url` becomes `/api/:collection/:id/file`, and Oboe reads blobs through `get()`
- `direct`: `doc.file.url` is taken from the uploaded blob URL stored in metadata

For private Blob stores, keep `serveMode: "proxy"` so reads stay behind your app's access control.

## Stored File Metadata

Vercel Blob uses the same reserved `file` field shape, with provider metadata containing the Blob URL:

```ts
type StoredFileData = {
  filename: string;
  filesize: number;
  mimeType: string;
  prefix?: string;
  providerMetadata?: {
    downloadUrl?: string;
    pathname?: string;
    url?: string;
  };
  storageAdapter: string;
  storageKey: string;
  url?: string;
};
```

`storageKey` is the Vercel Blob pathname returned by `put()`.

## REST Upload Flow

Upload-enabled collections use:

- `POST /api/:collection` with `multipart/form-data`
- `PATCH /api/:collection/:id` with JSON or `multipart/form-data`
- `GET /api/:collection/:id/file` for proxy downloads

Multipart requests include:

- `file`: binary upload
- `data`: JSON string for document fields
