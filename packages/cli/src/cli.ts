#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  compileSchema,
  type DatabaseAdapter,
  getOboe,
  type OboeConfig,
} from "@oboe/core";
import { createMySqlAdapter, mySqlDialect } from "@oboe/db-mysql";
import { createPostgresAdapter, postgresDialect } from "@oboe/db-postgres";
import { createSqliteAdapter, sqliteDialect } from "@oboe/db-sqlite";
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

import {
  generateTypesSource,
  resolveTypesOutputPath,
} from "./generate-types.js";

type DialectName = "mysql" | "postgres" | "sqlite";

interface CliOptions {
  allQueues?: boolean;
  config: string;
  cron?: string;
  dialect?: DialectName;
  file?: string;
  limit?: number;
  name?: string;
  queue?: string;
  url?: string;
}

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key?.startsWith("--")) {
      continue;
    }

    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      options[key.slice(2)] = true;
      continue;
    }

    options[key.slice(2)] = value;
    index += 1;
  }

  const stringOption = (value: string | boolean | undefined) =>
    typeof value === "string" ? value : undefined;

  return {
    command,
    options: {
      allQueues: options["all-queues"] === true,
      config: stringOption(options.config) ?? "oboe.config.ts",
      cron: stringOption(options.cron),
      dialect: options.dialect as DialectName,
      file: stringOption(options.file),
      limit:
        typeof options.limit === "string" ? Number(options.limit) : undefined,
      name: stringOption(options.name),
      queue: stringOption(options.queue),
      url: stringOption(options.url),
    } satisfies CliOptions,
  };
}

async function loadConfig(configPath: string) {
  const resolvedPath = path.resolve(process.cwd(), configPath);
  const module = await tsImport(
    pathToFileURL(resolvedPath).href,
    import.meta.url
  );

  return {
    config: (module.default?.default ?? module.default) as OboeConfig,
    resolvedPath,
  };
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

function requireDialect(
  options: CliOptions,
  command:
    | "db:push"
    | "jobs:run"
    | "migrate"
    | "migrate:generate"
    | "migrate:status"
) {
  if (!options.dialect) {
    throw new Error(`The "${command}" command requires --dialect.`);
  }

  return options.dialect;
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

async function createDatabaseAdapter(options: CliOptions): Promise<{
  adapter: DatabaseAdapter;
  close: () => Promise<void>;
}> {
  if (options.dialect === "postgres") {
    const pool = new Pool({
      connectionString: options.url ?? process.env.DATABASE_URL,
    });

    return {
      adapter: createPostgresAdapter({
        pool,
      }),
      close: async () => {
        await pool.end();
      },
    };
  }

  if (options.dialect === "mysql") {
    const pool = mysql.createPool({
      uri: options.url ?? process.env.DATABASE_URL,
    });

    return {
      adapter: createMySqlAdapter({
        client: {
          beginTransaction: async () => {
            await pool.query("START TRANSACTION");
          },
          commit: async () => {
            await pool.query("COMMIT");
          },
          execute: async (sql: string, params?: unknown[]) =>
            (await pool.execute(sql, params as never)) as [
              unknown[] | { affectedRows?: number; insertId?: number },
              unknown,
            ],
          getConnection: async () => {
            const connection = await pool.getConnection();
            return {
              beginTransaction: async () => {
                await connection.beginTransaction();
              },
              commit: async () => {
                await connection.commit();
              },
              execute: async (sql: string, params?: unknown[]) =>
                (await connection.execute(sql, params as never)) as [
                  unknown[] | { affectedRows?: number; insertId?: number },
                  unknown,
                ],
              release: () => {
                connection.release();
              },
              rollback: async () => {
                await connection.rollback();
              },
            };
          },
          rollback: async () => {
            await pool.query("ROLLBACK");
          },
        },
      }),
      close: async () => {
        await pool.end();
      },
    };
  }

  const database = new Database(
    options.file ??
      process.env.SQLITE_FILE ??
      path.join(process.cwd(), ".oboe", "oboe.db")
  );

  return {
    adapter: createSqliteAdapter({
      database,
    }),
    close: async () => {
      database.close();
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCronNumberSet(field: string, min: number, max: number) {
  if (field === "*") {
    return null;
  }

  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      if (!Number.isFinite(step) || step <= 0) {
        throw new Error(`Invalid cron step "${part}".`);
      }
      for (let current = min; current <= max; current += step) {
        values.add(current);
      }
      continue;
    }

    const value = Number(part);
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`Invalid cron value "${part}".`);
    }
    values.add(value);
  }

  return values;
}

function matchesCron(date: Date, expression: string) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new Error(`Unsupported cron "${expression}". Use 5 or 6 fields.`);
  }

  const [secondField, minuteField, hourField] =
    parts.length === 6 ? parts : ["0", parts[0], parts[1]];
  const dayField = parts.length === 6 ? parts[3] : parts[2];
  const monthField = parts.length === 6 ? parts[4] : parts[3];
  const weekDayField = parts.length === 6 ? parts[5] : parts[4];
  const checks = [
    [secondField, date.getSeconds(), 0, 59],
    [minuteField, date.getMinutes(), 0, 59],
    [hourField, date.getHours(), 0, 23],
    [dayField, date.getDate(), 1, 31],
    [monthField, date.getMonth() + 1, 1, 12],
    [weekDayField, date.getDay(), 0, 6],
  ] as const;

  return checks.every(([field, value, min, max]) => {
    const allowed = parseCronNumberSet(field, min, max);
    return allowed ? allowed.has(value) : true;
  });
}

async function commandGenerate(options: CliOptions) {
  const dialectName = requireDialect(options, "migrate:generate");
  const { config } = await loadConfig(options.config);
  const schema = compileSchema(config);
  const id = `${new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}_${options.name ?? "bootstrap"}`;
  const generated = createGeneratedMigration({
    dialect: dialectName,
    id,
    name: options.name ?? "bootstrap",
    schema,
  });
  const dialect = getDialect(dialectName);
  const directory = getMigrationDir(dialectName);
  const existing = await listGeneratedMigrations(dialectName);
  const latest = existing[existing.length - 1];

  if (latest && latest.manifest.checksum === generated.manifest.checksum) {
    console.log(
      `No migration generated. ${dialectName} manifest is unchanged.`
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
        dialect: dialectName,
        id,
        manifest: generated.manifest,
        name: options.name ?? "bootstrap",
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Generated ${dialectName} migration ${id}.`);
}

async function commandMigrate(options: CliOptions) {
  const dialectName = requireDialect(options, "migrate");
  const generated = await listGeneratedMigrations(dialectName);
  const { close, queryable } = await createQueryable(options);
  const dialect = getDialect(dialectName);
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
    const directory = getMigrationDir(dialectName);

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

    console.log(`Applied ${pending.length} ${dialectName} migration(s).`);
  } finally {
    await close();
  }
}

async function commandStatus(options: CliOptions) {
  const dialectName = requireDialect(options, "migrate:status");
  const { config } = await loadConfig(options.config);
  const schema = compileSchema(config);
  const generated = await listGeneratedMigrations(dialectName);
  const latest = generated[generated.length - 1];
  const { close, queryable } = await createQueryable(options);
  const dialect = getDialect(dialectName);
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
  const dialectName = requireDialect(options, "db:push");
  const { config } = await loadConfig(options.config);
  const schema = compileSchema(config);
  const manifest = createRelationalManifest(schema);
  const dialect = getDialect(dialectName);
  const { close, queryable } = await createQueryable(options);

  try {
    const apply = async (tx: RelationalQueryable) => {
      for (const statement of dialect.buildBootstrapStatements({ manifest })) {
        await tx.query(statement);
      }

      await tx.query(
        dialect.buildInsertAppliedMigrationStatement({
          appliedAt: new Date().toISOString(),
          dialect: dialectName,
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

async function commandGenerateTypes(options: CliOptions) {
  const { config, resolvedPath } = await loadConfig(options.config);
  const outputPath = resolveTypesOutputPath({
    config,
    configPath: resolvedPath,
  });
  const source = generateTypesSource(config);

  await writeFile(outputPath, source, "utf8");
  console.log(
    `Generated TypeScript types at ${path.relative(process.cwd(), outputPath)}.`
  );
}

async function commandJobsRun(options: CliOptions) {
  const dialectName = requireDialect(options, "jobs:run");
  const { config } = await loadConfig(options.config);
  const { adapter, close } = await createDatabaseAdapter({
    ...options,
    dialect: dialectName,
  });

  try {
    const runtime = await getOboe({
      config,
      db: adapter,
    });

    const runOnce = async () => {
      const result = await runtime.jobs.run({
        allQueues: options.allQueues,
        limit: options.limit,
        queue: options.queue,
      });
      console.log(JSON.stringify(result));
      return result;
    };

    if (!options.cron) {
      await runOnce();
      return;
    }

    let lastTick = "";
    // Poll once per second and execute when the cron expression matches.
    for (;;) {
      const now = new Date();
      const tick = now.toISOString().slice(0, 19);
      if (tick !== lastTick && matchesCron(now, options.cron)) {
        await runOnce();
        lastTick = tick;
      }
      await sleep(1000);
    }
  } finally {
    await close();
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command) {
    throw new Error(
      "Usage: oboe <generate:types|migrate:generate|migrate|migrate:status|db:push|jobs:run> [--config oboe.config.ts] [--dialect <postgres|mysql|sqlite>] [--url ...] [--file ...]"
    );
  }

  switch (command) {
    case "generate:types":
      await commandGenerateTypes(options);
      return;
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
    case "jobs:run":
      await commandJobsRun(options);
      return;
    default:
      throw new Error(`Unknown command "${command}".`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
