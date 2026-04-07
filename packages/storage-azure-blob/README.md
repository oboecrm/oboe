# @oboe/storage-azure-blob

Azure Blob Storage upload provider for Oboe.

This package integrates Azure Blob Storage using the official `@azure/storage-blob` SDK.

## Install

```bash
pnpm add @oboe/storage-azure-blob
```

## Basic Usage

```ts
import { azureBlobStorage } from "@oboe/storage-azure-blob";
import { defineConfig, defineModule } from "@oboe/core";

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
    azureBlobStorage({
      accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
      accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
      container: process.env.AZURE_STORAGE_CONTAINER!,
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

## Authentication Options

You can authenticate in one of three ways:

```ts
azureBlobStorage({
  connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
  container: "media",
  collections: {
    media: true,
  },
});
```

```ts
azureBlobStorage({
  accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
  accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
  container: "media",
  collections: {
    media: true,
  },
});
```

```ts
azureBlobStorage({
  accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
  container: "media",
  sasToken: process.env.AZURE_STORAGE_SAS_TOKEN,
  collections: {
    media: true,
  },
});
```

## Environment Variables

```bash
export AZURE_STORAGE_CONNECTION_STRING=...
export AZURE_STORAGE_ACCOUNT_NAME=...
export AZURE_STORAGE_ACCOUNT_KEY=...
export AZURE_STORAGE_CONTAINER=media
export AZURE_STORAGE_SAS_TOKEN=...
```

## Options

```ts
type AzureBlobStorageOptions = {
  accountKey?: string;
  accountName?: string;
  baseUrl?: string;
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
  connectionString?: string;
  container: string;
  enabled?: boolean;
  sasToken?: string;
  serviceUrl?: string;
};
```

Notes:

- `serveMode` defaults to `proxy`
- `baseUrl` can point at a CDN or custom domain for direct URLs
- without `baseUrl`, direct URLs use `https://<account>.blob.core.windows.net/<container>/<object>`
- `connectionString`, `accountName + accountKey`, or `sasToken` is required

## `serveMode`

- `proxy`: `doc.file.url` becomes `/api/:collection/:id/file`
- `direct`: `doc.file.url` is generated from `baseUrl` or the Azure container URL

Keep `serveMode: "proxy"` for private containers unless you intentionally want direct object URLs.

## Stored File Metadata

Azure Blob uses the same reserved `file` field shape, with provider metadata containing the blob URL and etag:

```ts
type StoredFileData = {
  filename: string;
  filesize: number;
  mimeType: string;
  prefix?: string;
  providerMetadata?: {
    etag?: string;
    url?: string;
  };
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
