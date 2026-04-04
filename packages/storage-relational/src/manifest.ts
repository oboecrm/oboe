import type { CompiledSchema, FieldConfig } from "@oboe/core";
import { createHash } from "node:crypto";

import type { RelationalManifest } from "./types.js";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortKeys(nested)])
    );
  }

  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(sortKeys(value));
}

function summarizeField(field: FieldConfig) {
  return {
    name: field.name,
    options: field.options,
    relationTo: field.relationTo,
    required: field.required ?? false,
    type: field.type,
  };
}

function checksum(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function createRelationalManifest(
  schema: CompiledSchema
): RelationalManifest {
  const schemaSummary = [...schema.collections.values()]
    .map((collection) => ({
      fields: collection.fields.map(summarizeField),
      slug: collection.slug,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  const schemaChecksum = checksum(schemaSummary);
  const manifestBase = {
    schemaChecksum,
    storageObjects: [
      "oboe_records",
      "oboe_audit_log",
      "oboe_job_outbox",
      "oboe_migrations",
    ],
    storageVersion: 1 as const,
  };

  return {
    ...manifestBase,
    checksum: checksum(manifestBase),
  };
}

export function serializeManifest(manifest: RelationalManifest) {
  return stableJson(manifest);
}
