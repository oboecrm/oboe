# OboeCRM

OboeCRM is an open-source, code-first CRM for developers.

It takes inspiration from PayloadCMS, but applies that model to CRM instead of content management:

- define CRM schema and modules in TypeScript
- generate admin CRUD from configuration metadata
- share one runtime across Local API, REST, and GraphQL
- layer custom CRM views like pipeline and timeline on top of generated screens
- self-host and customize deeply without vendor lock-in

## Why a code-first CRM?

Most CRMs are optimized for fixed product workflows. OboeCRM is aimed at teams that want the CRM
to behave more like application code:

- keep schema, access rules, hooks, and extensions in Git
- model `contacts`, `companies`, `deals`, `activities`, and custom objects in code
- extend the official admin instead of fighting a closed UI
- run your own API and jobs on top of the same runtime
- use Next.js as the official studio shell without making Next.js the core runtime

## Current Direction

OboeCRM is early, but the architecture is already shaped around the v1 concept:

- `@oboe/core` is the framework-agnostic heart of the system
- `@oboe/http` mounts REST on top of the shared runtime
- `@oboe/graphql` mounts GraphQL on top of the shared runtime
- `@oboe/admin-next` renders generated admin views and CRM-specific screens
- `@oboe/storage-relational` provides the shared relational storage and migration layer
- `@oboe/db-postgres`, `@oboe/db-mysql`, and `@oboe/db-sqlite` are the official relational adapters
- `@oboe/plugin-storage` applies upload and file storage behavior to upload-enabled collections
- `@oboe/storage-azure-blob` is the official Azure Blob Storage provider for uploads
- `@oboe/storage-gcs` is the official Google Cloud Storage provider for uploads
- `@oboe/storage-r2` is the official Cloudflare R2 provider for uploads
- `@oboe/storage-s3` is the first official object storage provider for uploads
- `@oboe/storage-vercel-blob` is the official Vercel Blob provider for uploads
- `@oboe/cli` owns schema migration and `db:push` workflows
- `@oboe/jobs` handles retry-aware background work and webhook-style flows
- `apps/studio` is the official Next.js shell for admin, API, and GraphQL

That gives Oboe a Payload-like developer experience without forcing the entire platform to be
Next.js-native at the core.

## Quickstart

Before running the studio locally, make sure you have:

- Node.js 22+
- pnpm 10+
- a reachable PostgreSQL, MySQL 8+, or SQLite database

Install dependencies:

```bash
pnpm install
```

Set a database URL and start the workspace:

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/oboe
pnpm dev
```

To generate or apply relational schema migrations through Oboe:

```bash
pnpm --filter @oboe/cli build
pnpm exec oboe migrate:generate --dialect postgres --config apps/studio/oboe.config.ts
pnpm exec oboe migrate --dialect postgres --config apps/studio/oboe.config.ts --url "$DATABASE_URL"
```

Then open:

- `http://localhost:3000/admin`
- `http://localhost:3000/api`
- `http://localhost:3000/graphql`

## Example Config

OboeCRM is built around a code-first config. The studio in this repository uses an
[`oboe.config.ts`](./apps/studio/oboe.config.ts) shaped like this:

```ts
import { defineConfig, defineModule } from "@oboe/core";

export default defineConfig({
  modules: [
    defineModule({
      slug: "crm",
      collections: [
        {
          slug: "contacts",
          fields: [
            { name: "name", type: "text", required: true },
            { name: "email", type: "email" },
            { name: "company", type: "relation", relationTo: "companies" },
          ],
        },
        {
          slug: "deals",
          admin: {
            views: {
              pipeline: {
                label: "Pipeline",
                path: "/pipeline",
                component: "pipeline-view",
              },
            },
          },
          fields: [
            { name: "name", type: "text", required: true },
            { name: "stage", type: "select" },
            { name: "value", type: "number" },
          ],
        },
      ],
    }),
  ],
});
```

The goal is to make CRM structure feel like application code, not point-and-click configuration.

## Upload Storage

Oboe now supports upload-enabled collections with pluggable file storage.

- enable uploads per collection with `upload: true` or `upload: { ... }`
- store file metadata in a reserved `file` field inside the document record
- use `@oboe/plugin-storage` for low-level custom adapters
- use `@oboe/storage-s3` for generic S3-compatible providers
- use `@oboe/storage-azure-blob` for Azure Blob Storage
- use `@oboe/storage-gcs` for Google Cloud Storage
- use `@oboe/storage-r2` for Cloudflare R2 with Oboe-specific defaults
- use `@oboe/storage-vercel-blob` for Vercel-hosted Blob stores

Example:

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
            maxFileSize: 5 * 1024 * 1024,
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

`serveMode` controls the file URL returned in `doc.file.url`:

- `proxy`: returns `/api/:collection/:id/file` and streams through Oboe access control
- `direct`: returns a provider URL generated by `generateFileURL` or the adapter's `generateURL`

Stored file metadata lives in the reserved `file` field:

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

Create an upload document through REST with `multipart/form-data`:

- `file`: binary file part
- `data`: JSON string for the rest of the document payload

## Monorepo Layout

This repository is a `pnpm + Turborepo` monorepo.

- [`apps/studio`](./apps/studio): official Next.js admin shell
- [`packages/core`](./packages/core): config DSL, schema compiler, Local API, hooks, access, events
- [`packages/storage-relational`](./packages/storage-relational): shared relational manifests, migrations, and storage behavior
- [`packages/plugin-storage`](./packages/plugin-storage): low-level upload storage plugin and adapter contract
- [`packages/storage-azure-blob`](./packages/storage-azure-blob): Azure Blob Storage provider
- [`packages/storage-gcs`](./packages/storage-gcs): Google Cloud Storage provider
- [`packages/storage-r2`](./packages/storage-r2): Cloudflare R2 provider wrapper
- [`packages/storage-s3`](./packages/storage-s3): S3-compatible storage provider wrapper
- [`packages/storage-vercel-blob`](./packages/storage-vercel-blob): Vercel Blob provider
- [`packages/db-postgres`](./packages/db-postgres): Postgres adapter
- [`packages/db-mysql`](./packages/db-mysql): MySQL 8+ adapter
- [`packages/db-sqlite`](./packages/db-sqlite): SQLite adapter
- [`packages/cli`](./packages/cli): `oboe migrate` and `oboe db:push`
- [`packages/http`](./packages/http): fetch-native REST handler
- [`packages/graphql`](./packages/graphql): GraphQL schema and executor
- [`packages/admin-next`](./packages/admin-next): generated admin React components and CRM view slots
- [`packages/jobs`](./packages/jobs): retry-aware background job runner
- [`packages/create-oboe-app`](./packages/create-oboe-app): starter app bootstrapper
- [`templates/starter`](./templates/starter): starter files for new apps

## What Exists Today

The current implementation already includes:

- `defineConfig()` and `defineModule()` for CRM modeling
- schema compilation and a shared runtime for Local API behavior
- REST and GraphQL mounted on top of the same runtime
- a shared relational storage layer with migration metadata
- upload-enabled collections with pluggable object storage
- low-level storage plugin and official S3 / R2 / GCS / Azure Blob / Vercel Blob providers
- official Postgres, MySQL, and SQLite adapters
- an Oboe CLI for migration generation, apply, status, and `db:push`
- generated admin collection screens
- custom CRM-oriented views such as pipeline, timeline, and activity composer
- basic tests covering core runtime, HTTP, GraphQL, jobs, and relational adapter behavior

## Scripts

```bash
pnpm dev
pnpm build
pnpm check
pnpm format
pnpm typecheck
pnpm lint
pnpm test
```

## Roadmap

The current repository is focused on architecture and platform shape. Next major steps include:

- richer relation-aware storage beyond a single JSONB record table
- generated create/edit forms in the admin
- stronger auth, access control, and user management
- durable workers for events, jobs, and webhook delivery
- plugin and module APIs for distributing reusable CRM functionality
- better starter templates and project scaffolding

## Philosophy

OboeCRM is trying to sit in a different place than a traditional SaaS CRM:

- less "configure your workspace through settings pages"
- more "define your CRM as code"
- less "fixed pipeline product"
- more "extensible application platform for customer data and workflows"

If PayloadCMS is "code-first CMS", OboeCRM aims to be "code-first CRM".

## Contributing

This project is still taking shape, so the best contributions right now are:

- architecture feedback
- schema and API design feedback
- admin UX ideas for generated CRM screens
- implementation help on adapters, runtime, and studio features

For now, the repository itself is the source of truth.
