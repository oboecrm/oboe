import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "packages/http/vitest.config.ts",
  "packages/graphql/vitest.config.ts",
  "packages/jobs/vitest.config.ts",
  "packages/storage-relational/vitest.config.ts",
  "packages/plugin-storage/vitest.config.ts",
  "packages/storage-gcs/vitest.config.ts",
  "packages/storage-r2/vitest.config.ts",
  "packages/storage-s3/vitest.config.ts",
  "packages/storage-vercel-blob/vitest.config.ts",
  "packages/db-postgres/vitest.config.ts",
  "packages/db-mysql/vitest.config.ts",
  "packages/db-sqlite/vitest.config.ts",
]);
