import { expect, it } from "vitest";
import { bootstrapSql, sqliteDialect } from "./index.js";

it("includes the migration table in bootstrap sql", () => {
  expect(bootstrapSql).toContain("CREATE TABLE IF NOT EXISTS oboe_migrations");
});

it("uses JSON1 functions for where clauses", () => {
  const statement = sqliteDialect.buildFindRecordsStatement({
    collection: "contacts",
    query: {
      where: {
        name: "Oboe Dev",
      },
    },
  });

  expect(statement.sql).toContain("json_extract");
  expect(statement.params).toContain("$.name");
});
