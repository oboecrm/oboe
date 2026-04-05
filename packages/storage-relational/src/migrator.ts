import type { CompiledSchema } from "@oboe/core";

import { createRelationalManifest, serializeManifest } from "./manifest.js";
import type {
  AppliedRelationalMigration,
  RelationalDialect,
  RelationalInitializationOptions,
  RelationalManifest,
  RelationalMigration,
  RelationalQueryable,
} from "./types.js";

interface MigrationRow {
  applied_at: Date | string;
  dialect: string;
  id: string;
  manifest: Record<string, unknown> | string;
  manifest_checksum: string;
  name: string;
}

function createBootstrapMigration(
  manifest: RelationalManifest,
  dialect: string
): AppliedRelationalMigration {
  return {
    appliedAt: new Date().toISOString(),
    dialect,
    id: `bootstrap_${manifest.checksum.slice(0, 12)}`,
    manifest,
    name: "bootstrap",
  };
}

function parseManifest(raw: MigrationRow["manifest"]): RelationalManifest {
  if (typeof raw === "string") {
    return JSON.parse(raw) as RelationalManifest;
  }

  return raw as unknown as RelationalManifest;
}

function normalizeRow(row: MigrationRow): AppliedRelationalMigration {
  return {
    appliedAt:
      row.applied_at instanceof Date
        ? row.applied_at.toISOString()
        : String(row.applied_at),
    dialect: row.dialect,
    id: row.id,
    manifest: parseManifest(row.manifest),
    name: row.name,
  };
}

export class RelationalMigrator {
  constructor(
    private readonly dialect: RelationalDialect,
    private readonly queryable: RelationalQueryable
  ) {}

  async applyMigrations(migrations: RelationalMigration[]) {
    const run = async (tx: RelationalQueryable) => {
      await this.ensureMigrationTable(tx);

      for (const migration of migrations) {
        const statements = this.dialect.buildBootstrapStatements({
          manifest: migration.manifest,
        });

        for (const statement of statements) {
          await tx.query(statement);
        }

        await tx.query(
          this.dialect.buildInsertAppliedMigrationStatement({
            ...migration,
            appliedAt: new Date().toISOString(),
          })
        );
      }
    };

    if (this.queryable.transaction) {
      await this.queryable.transaction(run);
      return;
    }

    await run(this.queryable);
  }

  async ensureCurrentManifest(
    schema: CompiledSchema,
    environment: "development" | "production"
  ) {
    const manifest = createRelationalManifest(schema);
    await this.assertJsonSupport();

    const migrationTableExists = await this.migrationTableExists();
    if (!migrationTableExists) {
      if (environment === "production") {
        throw new Error(
          `Database schema is not initialized for ${this.dialect.name}. Run "oboe migrate".`
        );
      }

      await this.bootstrap(manifest);
      return;
    }

    const applied = await this.listAppliedMigrations();
    if (applied.length === 0) {
      if (environment === "production") {
        throw new Error(
          `Database schema is not initialized for ${this.dialect.name}. Run "oboe migrate".`
        );
      }

      await this.bootstrap(manifest);
      return;
    }

    const latest = applied[applied.length - 1];
    if (latest?.manifest.checksum !== manifest.checksum) {
      throw new Error(
        `Database schema is behind the current Oboe config for ${this.dialect.name}. Run "oboe migrate".`
      );
    }
  }

  async initialize(options: RelationalInitializationOptions) {
    const environment =
      options.environment ??
      (process.env.NODE_ENV === "production" ? "production" : "development");

    await this.ensureCurrentManifest(options.schema, environment);
  }

  async listAppliedMigrations(): Promise<AppliedRelationalMigration[]> {
    const result = await this.queryable.query<MigrationRow>(
      this.dialect.buildListAppliedMigrationsStatement()
    );

    return result.rows.map(normalizeRow);
  }

  async migrationTableExists() {
    const result = await this.queryable.query<{ exists: number | boolean }>(
      this.dialect.buildMigrationTableExistsStatement()
    );
    const exists = result.rows[0]?.exists;

    return exists === true || exists === 1;
  }

  private async assertJsonSupport() {
    if (!this.dialect.buildJsonSupportStatement) {
      return;
    }

    await this.queryable.query(this.dialect.buildJsonSupportStatement());
  }

  private async bootstrap(manifest: RelationalManifest) {
    const bootstrapMigration = createBootstrapMigration(
      manifest,
      this.dialect.name
    );
    const run = async (tx: RelationalQueryable) => {
      await this.ensureMigrationTable(tx);

      for (const statement of this.dialect.buildBootstrapStatements({
        manifest,
      })) {
        await tx.query(statement);
      }

      await tx.query(
        this.dialect.buildInsertAppliedMigrationStatement(bootstrapMigration)
      );
    };

    if (this.queryable.transaction) {
      await this.queryable.transaction(run);
      return;
    }

    await run(this.queryable);
  }

  private async ensureMigrationTable(queryable: RelationalQueryable) {
    const tableExists = await this.migrationTableExists();
    if (tableExists) {
      return;
    }

    for (const statement of this.dialect.buildBootstrapStatements({
      manifest: {
        checksum: "",
        schemaChecksum: "",
        storageVersion: 1,
      },
    })) {
      if (statement.sql.includes("oboe_migrations")) {
        await queryable.query(statement);
      }
    }
  }
}

export function createGeneratedMigration(args: {
  dialect: string;
  id: string;
  name: string;
  schema: CompiledSchema;
}) {
  const manifest = createRelationalManifest(args.schema);

  return {
    manifest,
    metadata: {
      dialect: args.dialect,
      id: args.id,
      manifest,
      manifestChecksum: manifest.checksum,
      name: args.name,
    },
  };
}

export function getPendingMigrations(args: {
  applied: AppliedRelationalMigration[];
  generated: RelationalMigration[];
}) {
  const appliedIds = new Set(args.applied.map((migration) => migration.id));
  return args.generated.filter((migration) => !appliedIds.has(migration.id));
}

export function manifestMatchesCurrentSchema(
  schema: CompiledSchema,
  manifest: RelationalManifest
) {
  return createRelationalManifest(schema).checksum === manifest.checksum;
}

export function serializeMigrationMetadata(migration: RelationalMigration) {
  return JSON.stringify(
    {
      dialect: migration.dialect,
      id: migration.id,
      manifest: migration.manifest,
      manifestChecksum: migration.manifest.checksum,
      name: migration.name,
    },
    null,
    2
  );
}

export function serializeMigrationManifest(schema: CompiledSchema) {
  return serializeManifest(createRelationalManifest(schema));
}
