import type {
  CompiledCollection,
  CompiledSchema,
  FieldConfig,
  ModuleConfig,
  OboeConfig,
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

export function compileSchema(config: OboeConfig): CompiledSchema {
  const moduleSlugs = new Set<string>();
  const collectionSlugs = new Set<string>();
  const globalSlugs = new Set<string>();
  const modules = new Map<string, ModuleConfig>();
  const collections = new Map<string, CompiledCollection>();
  const globals = new Map();

  for (const moduleConfig of config.modules) {
    assertUnique(moduleConfig.slug, moduleSlugs, "module");
    modules.set(moduleConfig.slug, moduleConfig);

    for (const collection of moduleConfig.collections) {
      assertUnique(collection.slug, collectionSlugs, "collection");
      collections.set(collection.slug, {
        ...collection,
        admin: {
          ...collection.admin,
          views: {
            ...config.admin?.views,
            ...collection.admin?.views,
          },
        },
        moduleSlug: moduleConfig.slug,
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
    config,
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
