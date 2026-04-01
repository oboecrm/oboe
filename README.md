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
- `@oboe/db-postgres` is the first official database adapter
- `@oboe/jobs` handles retry-aware background work and webhook-style flows
- `apps/studio` is the official Next.js shell for admin, API, and GraphQL

That gives Oboe a Payload-like developer experience without forcing the entire platform to be
Next.js-native at the core.

## Quickstart

Before running the studio locally, make sure you have:

- Node.js 22+
- pnpm 10+
- a reachable PostgreSQL database

Install dependencies:

```bash
pnpm install
```

Set a database URL and start the workspace:

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/oboe
pnpm dev
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

## Monorepo Layout

This repository is a `pnpm + Turborepo` monorepo.

- [`apps/studio`](./apps/studio): official Next.js admin shell
- [`packages/core`](./packages/core): config DSL, schema compiler, Local API, hooks, access, events
- [`packages/db-postgres`](./packages/db-postgres): Postgres adapter and bootstrap SQL
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
- a Postgres-first adapter with audit log and job outbox tables
- generated admin collection screens
- custom CRM-oriented views such as pipeline, timeline, and activity composer
- basic tests covering core runtime, HTTP, GraphQL, jobs, and Postgres adapter behavior

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
