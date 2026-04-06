# @oboe/storage-gcs

Google Cloud Storage upload provider for Oboe.

This package wires Google Cloud Storage into upload-enabled collections using the official Node.js client library, `@google-cloud/storage`.

## Install

```bash
pnpm add @oboe/storage-gcs
```

## Basic Usage

```ts
import { defineConfig, defineModule } from "@oboe/core";
import { gcsStorage } from "@oboe/storage-gcs";

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
    gcsStorage({
      bucket: process.env.GCS_BUCKET!,
      config: {
        projectId: process.env.GCP_PROJECT_ID,
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

Application Default Credentials:

```bash
export GCS_BUCKET=oboe-media
export GCP_PROJECT_ID=your-project-id
export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/service-account.json
```

Explicit credentials in config:

```ts
gcsStorage({
  bucket: process.env.GCS_BUCKET!,
  config: {
    credentials: {
      client_email: process.env.GCP_CLIENT_EMAIL,
      private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    projectId: process.env.GCP_PROJECT_ID,
  },
  collections: {
    media: true,
  },
});
```

If you want direct public URLs through a CDN or custom domain:

```bash
export GCS_PUBLIC_BASE_URL=https://cdn.example.com
```

Then:

```ts
gcsStorage({
  baseUrl: process.env.GCS_PUBLIC_BASE_URL,
  bucket: process.env.GCS_BUCKET!,
  collections: {
    media: {
      serveMode: "direct",
    },
  },
});
```

## Options

```ts
type GcsStorageOptions = {
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
  config?: StorageOptions;
  enabled?: boolean;
};
```

Notes:

- `serveMode` defaults to `proxy`
- `baseUrl` overrides direct URL generation
- when `baseUrl` is omitted, direct URLs default to `https://storage.googleapis.com/<bucket>/<object>`

## `serveMode`

- `proxy`: `doc.file.url` becomes `/api/:collection/:id/file`
- `direct`: `doc.file.url` is generated from `generateFileURL`, `baseUrl`, or the default GCS object URL

Use `proxy` for private buckets. Use `direct` only when the bucket or CDN path is intentionally public.

## Stored File Metadata

GCS uploads use the same reserved `file` field shape:

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
