import * as adminNext from "@oboe/admin-next";
import type { ComponentReference } from "@oboe/core";
import * as formBuilderPlugin from "@oboe/plugin-form-builder";
import type React from "react";

function normalizeReference(reference: ComponentReference) {
  if (typeof reference === "string") {
    const [path, exportName] = reference.split("#");
    return {
      exportName: exportName || "default",
      path,
    };
  }

  return {
    exportName: reference.exportName ?? "default",
    path: reference.path,
  };
}

export async function resolveAdminComponent(
  reference: ComponentReference
): Promise<React.ComponentType<Record<string, unknown>>> {
  const normalized = normalizeReference(reference);
  const moduleRecord =
    normalized.path === "@oboe/admin-next"
      ? adminNext
      : normalized.path === "@oboe/plugin-form-builder"
        ? formBuilderPlugin
        : null;

  if (!moduleRecord) {
    throw new Error(
      `Unsupported admin component reference "${normalized.path}".`
    );
  }

  const component =
    moduleRecord[normalized.exportName as keyof typeof moduleRecord];

  if (typeof component !== "function") {
    throw new Error(
      `Admin component export "${normalized.exportName}" was not found in "${normalized.path}".`
    );
  }

  return component as React.ComponentType<Record<string, unknown>>;
}
