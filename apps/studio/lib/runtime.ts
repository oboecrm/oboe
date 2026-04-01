import { createOboeRuntime } from "@oboe/core";
import { createPostgresAdapter } from "@oboe/db-postgres";
import { createGraphQLHandler, createGraphQLService } from "@oboe/graphql";
import { createHttpHandler } from "@oboe/http";
import { createInMemoryJobRunner } from "@oboe/jobs";
import { Pool } from "pg";

import config from "../oboe.config";

declare global {
  // eslint-disable-next-line no-var
  var __oboeStudioRuntime:
    | Promise<{
        graphqlHandler: (request: Request) => Promise<Response>;
        httpHandler: (request: Request) => Promise<Response>;
        runtime: ReturnType<typeof createOboeRuntime>;
      }>
    | undefined;
}

function createMissingDatabaseResponse() {
  throw new Error(
    "DATABASE_URL is required to start apps/studio with the Postgres adapter."
  );
}

async function buildRuntime() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    createMissingDatabaseResponse();
  }

  const pool = new Pool({
    connectionString,
  });
  const runtime = createOboeRuntime({
    config,
    db: createPostgresAdapter({
      pool,
    }),
    jobs: createInMemoryJobRunner({
      retryLimit: config.jobs?.retryLimit,
    }),
  });
  await runtime.initialize();
  const graphQLService = createGraphQLService(runtime);

  return {
    graphqlHandler: createGraphQLHandler(graphQLService),
    httpHandler: createHttpHandler({
      runtime,
    }),
    runtime,
  };
}

export function getStudioRuntime() {
  globalThis.__oboeStudioRuntime ??= buildRuntime();
  return globalThis.__oboeStudioRuntime;
}
