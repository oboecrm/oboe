# @oboe/plugin-storage

Low-level upload storage plugin for Oboe.

Use this package when you want to attach custom file storage behavior to one or more upload-enabled collections. If you only need S3-compatible storage, prefer [`@oboe/storage-s3`](../storage-s3/README.md).

## What It Does

- injects collection-level storage config through `plugins`
- keeps upload schema stable across environments
- defaults to Oboe local filesystem storage when no adapter is provided
- supports proxy or direct file URLs through `serveMode`

## Install

```bash
pnpm add @oboe/plugin-storage
```

## Basic Usage

```ts
import { defineConfig, defineModule } from "@oboe/core";
import { storagePlugin, type StorageAdapterFactory } from "@oboe/plugin-storage";

const memoryStorage: StorageAdapterFactory = ({ prefix }) => ({
  name: "memory",
  async handleUpload({ file }) {
    return {
      filename: file.filename,
      filesize: file.filesize,
      mimeType: file.mimeType,
      prefix,
      storageAdapter: "memory",
      storageKey: prefix ? `${prefix}/${file.filename}` : file.filename,
    };
  },
  async handleDelete() {},
  async handleDownload({ file }) {
    return new Response(file.filename);
  },
  generateURL({ file }) {
    return `https://cdn.example.com/${file.storageKey}`;
  },
});

export default defineConfig({
  modules: [
    defineModule({
      slug: "assets",
      collections: [
        {
          slug: "media",
          upload: true,
          fields: [{ name: "title", type: "text" }],
        },
      ],
    }),
  ],
  plugins: [
    storagePlugin({
      collections: {
        media: {
          adapter: memoryStorage,
          prefix: "uploads",
          serveMode: "proxy",
        },
      },
    }),
  ],
});
```

## Collection Options

`storagePlugin({ collections })` accepts the following options per collection:

```ts
type CollectionStorageOptions = {
  adapter?: StorageAdapterFactory;
  generateFileURL?: (args: {
    collection: CollectionConfig;
    file: StoredFileData;
    req?: Request;
  }) => Promise<string> | string;
  prefix?: string;
  serveMode?: "direct" | "proxy";
};
```

Notes:

- `serveMode` defaults to `proxy`
- `adapter` is optional; when omitted, Oboe uses local filesystem storage
- `generateFileURL` overrides the public URL only when `serveMode` is `direct`

## Adapter Contract

```ts
type GeneratedStorageAdapter = {
  name: string;
  handleUpload: (args: {
    collection: CollectionConfig;
    data: Record<string, unknown>;
    file: UploadInputFile;
    req?: Request;
    user?: unknown;
  }) => Promise<StoredFileData> | StoredFileData;
  handleDelete: (args: {
    collection: CollectionConfig;
    file: StoredFileData;
    req?: Request;
    user?: unknown;
  }) => Promise<void> | void;
  handleDownload: (args: {
    collection: CollectionConfig;
    file: StoredFileData;
    req?: Request;
    user?: unknown;
  }) => Promise<Response> | Response;
  generateURL?: (args: {
    collection: CollectionConfig;
    file: StoredFileData;
    req?: Request;
  }) => Promise<string> | string;
  onInit?: () => Promise<void> | void;
};
```

## `serveMode`

- `proxy`: `doc.file.url` becomes `/api/:collection/:id/file`, and downloads go through Oboe access control plus `handleDownload`
- `direct`: `doc.file.url` is generated from `generateFileURL` or adapter `generateURL`

Use `proxy` for private files. Use `direct` for public buckets or signed URL flows that your adapter controls.

## Stored File Metadata

Upload-enabled collections get a reserved `file` field managed by Oboe:

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

`url` is resolved at read time and is not persisted as the source of truth.

## REST Upload Shape

For upload-enabled collections:

- `POST /api/:collection` requires `multipart/form-data`
- `PATCH /api/:collection/:id` accepts either JSON or `multipart/form-data`
- `GET /api/:collection/:id/file` proxies file downloads

Multipart requests use:

- `file`: binary file part
- `data`: JSON string for the rest of the document fields
