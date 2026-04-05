import { expect, it } from "vitest";

import { bootstrapSql, createMySqlAdapter } from "./index.js";

it("builds mysql-compatible statements through the adapter", async () => {
  const statements: Array<{ params?: unknown[]; sql: string }> = [];
  const rows = new Map<string, { data: string; id: string }>();
  const adapter = createMySqlAdapter({
    client: {
      async execute(sql: string, params?: unknown[]) {
        statements.push({ params, sql });

        if (sql.startsWith("insert into `oboe_records`")) {
          const id = String(params?.[0]);
          rows.set(id, {
            data: JSON.stringify({ name: "Oboe Dev" }),
            id,
          });
          return [{ affectedRows: 1, insertId: 1 }, undefined];
        }

        if (
          sql.startsWith(
            "select `collection`, `created_at`, `data`, `id`, `updated_at` from `oboe_records`"
          )
        ) {
          return [
            [
              {
                collection: "contacts",
                created_at: "2026-04-04 00:00:00",
                data:
                  rows.values().next().value?.data ??
                  JSON.stringify({ name: "Oboe Dev" }),
                id: rows.values().next().value?.id ?? "contact-1",
                updated_at: "2026-04-04 00:00:00",
              },
            ],
            undefined,
          ];
        }

        return [[{ exists: 1 }], undefined];
      },
    },
  });

  await adapter.create({
    collection: "contacts",
    data: {
      name: "Oboe Dev",
    },
  });

  expect(bootstrapSql).toContain("CREATE TABLE IF NOT EXISTS oboe_records");
  expect(statements[0]?.sql).toContain("insert into `oboe_records`");
});
