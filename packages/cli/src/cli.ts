#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileSchema } from "@oboe/core";
import { mySqlDialect } from "@oboe/db-mysql";
import { postgresDialect } from "@oboe/db-postgres";
import { sqliteDialect } from "@oboe/db-sqlite";
import {
  createGeneratedMigration,
  createRelationalManifest,
  getPendingMigrations,
  manifestMatchesCurrentSchema,
  type RelationalDialect,
  type RelationalMigration,
  RelationalMigrator,
  type RelationalQueryable,
  type RelationalStatement,
} from "@oboe/storage-relational";
import Database from "better-sqlite3";
import mysql from "mysql2/promise";
import { Pool } from "pg";
import { tsImport } from "tsx/esm/api";

type DialectName = "mysql" | "postgres" | "sqlite";

interface CliOptions {
  config: string;
  dialect: DialectName;
  file?: string;
  name?: string;
  url?: string;
}

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const options: Record<string, string> = {};

  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || !value) {
      continue;
    }

    options[key.slice(2)] = value;
  }

  return {
    command,
    options: {
      config: options.config ?? "oboe.config.ts",
      dialect: options.dialect as DialectName,
      file: options.file,
      name: options.name,
      url: options.url,
    } satisfies CliOptions,
  };
}

async function loadConfig(configPath: string) {
  const resolvedPath = path.resolve(process.cwd(), configPath);
  const module = await tsImport(
    pathToFileURL(resolvedPath).href,
    import.meta.url
  );
  return module.default;
}

function getDialect(name: DialectName): RelationalDialect {
  switch (name) {
    case "mysql":
      return mySqlDialect;
    case "postgres":
      return postgresDialect;
    case "sqlite":
      return sqliteDialect;
  }
}

function getMigrationDir(dialect: DialectName) {
  return path.join(process.cwd(), ".oboe", "migrations", dialect);
}

async function listGeneratedMigrations(
  dialect: DialectName
): Promise<RelationalMigration[]> {
  const directory = getMigrationDir(dialect);
  try {
    const entries = await readdir(directory);
    const metadataFiles = entries
      .filter((entry) => entry.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right));

    return await Promise.all(
      metadataFiles.map(async (entry) => {
        const content = await readFile(path.join(directory, entry), "utf8");
        return JSON.parse(content) as RelationalMigration;
      })
    );
  } catch {
    return [];
  }
}

function splitSqlStatements(content: string) {
  return content
    .split(/;\s*\n+/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

async function createQueryable(options: CliOptions): Promise<{
  close: () => Promise<void>;
  queryable: RelationalQueryable;
}> {
  if (options.dialect === "postgres") {
    const pool = new Pool({
      connectionString: options.url ?? process.env.DATABASE_URL,
    });

    return {
      close: async () => {
        await pool.end();
      },
      queryable: {
        query: async ({ params, sql }) => {
          const result = await pool.query(sql, params);
          return {
            affectedRows: result.rowCount ?? undefined,
            rows: result.rows,
          };
        },
        transaction: async (callback) => {
          const client = await pool.connect();
          const txQueryable: RelationalQueryable = {
            query: async ({ params, sql }) => {
              const result = await client.query(sql, params);
              return {
                affectedRows: result.rowCount ?? undefined,
                rows: result.rows,
              };
            },
          };

          try {
            await client.query("BEGIN");
            const result = await callback(txQueryable);
            await client.query("COMMIT");
            return result;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        },
      },
    };
  }

  if (options.dialect === "mysql") {
    const pool = mysql.createPool({
      uri: options.url ?? process.env.DATABASE_URL,
    });
    const normalizeRows = <TRow>(
      rows:
        | mysql.OkPacket[]
        | mysql.ResultSetHeader
        | mysql.ResultSetHeader[]
        | mysql.RowDataPacket[]
        | mysql.RowDataPacket[][]
        | [mysql.RowDataPacket[], mysql.ResultSetHeader]
    ) => {
      if (Array.isArray(rows)) {
        return rows as TRow[];
      }

      return [] as TRow[];
    };

    return {
      close: async () => {
        await pool.end();
      },
      queryable: {
        query: async <TRow = Record<string, unknown>>({
          params,
          sql,
        }: RelationalStatement) => {
          const [rows] = await pool.execute(sql, params as never);
          if (Array.isArray(rows)) {
            return {
              rows: normalizeRows<TRow>(rows),
            };
          }

          return {
            affectedRows: rows.affectedRows,
            lastInsertId: rows.insertId,
            rows: [],
          };
        },
        transaction: async (callback) => {
          const connection = await pool.getConnection();
          const txQueryable: RelationalQueryable = {
            query: async <TRow = Record<string, unknown>>({
              params,
              sql,
            }: RelationalStatement) => {
              const [rows] = await connection.execute(sql, params as never);
              if (Array.isArray(rows)) {
                return {
                  rows: normalizeRows<TRow>(rows),
                };
              }

              return {
                affectedRows: rows.affectedRows,
                lastInsertId: rows.insertId,
                rows: [],
              };
            },
          };

          try {
            await connection.beginTransaction();
            const result = await callback(txQueryable);
            await connection.commit();
            return result;
          } catch (error) {
            await connection.rollback();
            throw error;
          } finally {
            connection.release();
          }
        },
      },
    };
  }

  const database = new Database(
    options.file ??
      process.env.SQLITE_FILE ??
      path.join(process.cwd(), ".oboe", "oboe.db")
  );

  return {
    close: async () => {
      database.close();
    },
    queryable: (() => {
      let queryable!: RelationalQueryable;
      queryable = {
        query: async <TRow = Record<string, unknown>>({
          params,
          sql,
        }: RelationalStatement) => {
          const statement = database.prepare(sql);
          if (sql.trim().toLowerCase().startsWith("select")) {
            return {
              rows: statement.all(...params) as TRow[],
            };
          }

          const result = statement.run(...params);
          return {
            affectedRows: result.changes,
            lastInsertId: result.lastInsertRowid,
            rows: [] as TRow[],
          };
        },
        transaction: async (callback) => {
          const run = (
            database.transaction as unknown as <TReturn>(
              fn: () => Promise<TReturn>
            ) => () => Promise<TReturn>
          )(() => callback(queryable));
          return await run();
        },
      };

      return queryable;
    })(),
  };
}

async function commandGenerate(options: CliOptions) {
  const config = await loadConfig(options.config);
  const schema = compileSchema(config);
  const id = `${new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}_${options.name ?? "bootstrap"}`;
  const generated = createGeneratedMigration({
    dialect: options.dialect,
    id,
    name: options.name ?? "bootstrap",
    schema,
  });
  const dialect = getDialect(options.dialect);
  const directory = getMigrationDir(options.dialect);
  const existing = await listGeneratedMigrations(options.dialect);
  const latest = existing[existing.length - 1];

  if (latest && latest.manifest.checksum === generated.manifest.checksum) {
    console.log(
      `No migration generated. ${options.dialect} manifest is unchanged.`
    );
    return;
  }

  const sqlContent = `${dialect
    .buildBootstrapStatements({
      manifest: generated.manifest,
    })
    .map((statement) => statement.sql)
    .join("\n\n")}\n`;

  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${id}.sql`), sqlContent, "utf8");
  await writeFile(
    path.join(directory, `${id}.json`),
    JSON.stringify(
      {
        dialect: options.dialect,
        id,
        manifest: generated.manifest,
        name: options.name ?? "bootstrap",
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Generated ${options.dialect} migration ${id}.`);
}

async function commandMigrate(options: CliOptions) {
  const generated = await listGeneratedMigrations(options.dialect);
  const { close, queryable } = await createQueryable(options);
  const dialect = getDialect(options.dialect);
  const migrator = new RelationalMigrator(dialect, queryable);

  try {
    const applied = await migrator.listAppliedMigrations().catch(async () => {
      if (!(await migrator.migrationTableExists().catch(() => false))) {
        return [];
      }
      return [];
    });
    const pending = getPendingMigrations({
      applied,
      generated,
    });
    const directory = getMigrationDir(options.dialect);

    const apply = async (tx: RelationalQueryable) => {
      for (const migration of pending) {
        const sqlContent = await readFile(
          path.join(directory, `${migration.id}.sql`),
          "utf8"
        );

        for (const statement of splitSqlStatements(sqlContent)) {
          await tx.query({
            params: [],
            sql: statement,
          });
        }

        await tx.query(
          dialect.buildInsertAppliedMigrationStatement({
            ...migration,
            appliedAt: new Date().toISOString(),
          })
        );
      }
    };

    if (queryable.transaction) {
      await queryable.transaction(apply);
    } else {
      await apply(queryable);
    }

    console.log(`Applied ${pending.length} ${options.dialect} migration(s).`);
  } finally {
    await close();
  }
}

async function commandStatus(options: CliOptions) {
  const config = await loadConfig(options.config);
  const schema = compileSchema(config);
  const generated = await listGeneratedMigrations(options.dialect);
  const latest = generated[generated.length - 1];
  const { close, queryable } = await createQueryable(options);
  const dialect = getDialect(options.dialect);
  const migrator = new RelationalMigrator(dialect, queryable);

  try {
    const applied = await migrator.listAppliedMigrations().catch(() => []);
    const pending = getPendingMigrations({
      applied,
      generated,
    });
    const drift = latest
      ? !manifestMatchesCurrentSchema(schema, latest.manifest)
      : true;

    console.log(
      JSON.stringify(
        {
          applied: applied.map((migration) => migration.id),
          currentManifest: createRelationalManifest(schema).checksum,
          drift,
          generated: generated.map((migration) => migration.id),
          pending: pending.map((migration) => migration.id),
        },
        null,
        2
      )
    );
  } finally {
    await close();
  }
}

async function commandPush(options: CliOptions) {
  const config = await loadConfig(options.config);
  const schema = compileSchema(config);
  const manifest = createRelationalManifest(schema);
  const dialect = getDialect(options.dialect);
  const { close, queryable } = await createQueryable(options);

  try {
    const apply = async (tx: RelationalQueryable) => {
      for (const statement of dialect.buildBootstrapStatements({ manifest })) {
        await tx.query(statement);
      }

      await tx.query(
        dialect.buildInsertAppliedMigrationStatement({
          appliedAt: new Date().toISOString(),
          dialect: options.dialect,
          id: `push_${manifest.checksum.slice(0, 12)}`,
          manifest,
          name: "db-push",
        })
      );
    };

    if (queryable.transaction) {
      await queryable.transaction(apply);
    } else {
      await apply(queryable);
    }

    console.log(`Pushed current ${options.dialect} schema to the database.`);
  } finally {
    await close();
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || !options.dialect) {
    throw new Error(
      "Usage: oboe <migrate:generate|migrate|migrate:status|db:push> --dialect <postgres|mysql|sqlite> [--config oboe.config.ts] [--url ...] [--file ...]"
    );
  }

  switch (command) {
    case "migrate:generate":
      await commandGenerate(options);
      return;
    case "migrate":
      await commandMigrate(options);
      return;
    case "migrate:status":
      await commandStatus(options);
      return;
    case "db:push":
      await commandPush(options);
      return;
    default:
      throw new Error(`Unknown command "${command}".`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
