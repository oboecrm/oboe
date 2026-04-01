import { expect, it } from "vitest";

import { bootstrapSql, createPostgresAdapter } from "./index.js";

it("boots schema and uses JSONB-based CRUD statements", async () => {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  const adapter = createPostgresAdapter({
    pool: {
      async query(text: string, values?: unknown[]) {
        statements.push({ text, values });

        if (
          text.includes(
            "RETURNING id, collection, data, created_at, updated_at"
          )
        ) {
          return {
            command: "SELECT",
            fieldCount: 0,
            fields: [],
            oid: 0,
            rowCount: 1,
            rows: [
              {
                collection: "contacts",
                created_at: "2026-04-01T00:00:00.000Z",
                data: {
                  name: "Oboe Dev",
                },
                id: "contact-1",
                updated_at: "2026-04-01T00:00:00.000Z",
              },
            ],
          } as never;
        }

        return {
          command: "SELECT",
          fieldCount: 0,
          fields: [],
          oid: 0,
          rowCount: 0,
          rows: [],
        } as never;
      },
    },
  });

  await adapter.initialize({} as never);
  await adapter.create({
    collection: "contacts",
    data: {
      name: "Oboe Dev",
    },
  });
  await adapter.find({
    collection: "contacts",
    query: {
      where: {
        name: "Oboe Dev",
      },
    },
  });
  await adapter.enqueueJob({
    idempotencyKey: "contact:1",
    name: "sync-contact",
    payload: {
      id: "contact-1",
    },
  });

  expect(statements[0]?.text).toContain(bootstrapSql.trim());
  expect(statements[1]?.text).toContain("INSERT INTO oboe_records");
  expect(statements[2]?.text).toContain("data @> $2::jsonb");
  expect(statements[3]?.text).toContain("INSERT INTO oboe_job_outbox");
});
