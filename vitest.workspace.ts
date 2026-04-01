import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "packages/http/vitest.config.ts",
  "packages/graphql/vitest.config.ts",
  "packages/jobs/vitest.config.ts",
  "packages/db-postgres/vitest.config.ts",
]);
