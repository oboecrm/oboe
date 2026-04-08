import { resolveConfig } from "./config.js";
import type {
  CompiledCollection,
  CompiledSchema,
  FieldConfig,
  GlobalConfig,
  ModuleConfig,
  OboeConfig,
  StorageServeMode,
} from "./types.js";

function assertUnique(slug: string, seen: Set<string>, label: string) {
  if (seen.has(slug)) {
    throw new Error(`Duplicate ${label} slug "${slug}" detected.`);
  }

  seen.add(slug);
}

function isRelationshipField(field: FieldConfig) {
  return field.type === "relation" || field.type === "relationship";
}

function validateRelationshipFields(
  collections: Map<string, CompiledCollection>
) {
  for (const collection of collections.values()) {
    for (const field of collection.fields) {
      if (!isRelationshipField(field)) {
        continue;
      }

      if (!field.relationTo) {
        throw new Error(
          `Relationship field "${collection.slug}.${field.name}" must define relationTo.`
        );
      }

      if (!collections.has(field.relationTo)) {
        throw new Error(
          `Relationship field "${collection.slug}.${field.name}" refers to unknown collection "${field.relationTo}".`
        );
      }
    }
  }
}

function createStoredFileField(): FieldConfig {
  return {
    name: "file",
    type: "json",
  };
}

function normalizeServeMode(
  value: StorageServeMode | undefined
): StorageServeMode {
  return value ?? "proxy";
}

export function compileSchema(config: OboeConfig): CompiledSchema {
  const resolvedConfig = resolveConfig(config);
  const moduleSlugs = new Set<string>();
  const collectionSlugs = new Set<string>();
  const globalSlugs = new Set<string>();
  const modules = new Map<string, ModuleConfig>();
  const collections = new Map<string, CompiledCollection>();
  const globals = new Map<string, GlobalConfig>();

  for (const moduleConfig of resolvedConfig.modules) {
    assertUnique(moduleConfig.slug, moduleSlugs, "module");
    modules.set(moduleConfig.slug, moduleConfig);

    for (const collection of moduleConfig.collections) {
      assertUnique(collection.slug, collectionSlugs, "collection");

      if (collection.storage && !collection.upload) {
        throw new Error(
          `Collection "${collection.slug}" cannot define storage without enabling upload.`
        );
      }

      if (
        collection.upload &&
        collection.fields.some((field) => field.name === "file")
      ) {
        throw new Error(
          `Upload-enabled collection "${collection.slug}" cannot define the reserved "file" field.`
        );
      }

      const fields = collection.upload
        ? [...collection.fields, createStoredFileField()]
        : collection.fields;
      collections.set(collection.slug, {
        ...collection,
        admin: {
          ...collection.admin,
          views: {
            ...resolvedConfig.admin?.views,
            ...collection.admin?.views,
          },
        },
        fields,
        moduleSlug: moduleConfig.slug,
        storage: collection.storage
          ? {
              ...collection.storage,
              serveMode: normalizeServeMode(collection.storage.serveMode),
            }
          : undefined,
      });
    }

    for (const global of moduleConfig.globals ?? []) {
      assertUnique(global.slug, globalSlugs, "global");
      globals.set(global.slug, global);
    }
  }

  validateRelationshipFields(collections);

  return {
    collections,
    config: resolvedConfig,
    globals,
    modules,
  };
}

export function getCompiledCollection(schema: CompiledSchema, slug: string) {
  const collection = schema.collections.get(slug);
  if (!collection) {
    throw new Error(`Unknown collection "${slug}".`);
  }

  return collection;
}

export function getCompiledGlobal(schema: CompiledSchema, slug: string) {
  const global = schema.globals.get(slug);
  if (!global) {
    throw new Error(`Unknown global "${slug}".`);
  }

  return global;
}
