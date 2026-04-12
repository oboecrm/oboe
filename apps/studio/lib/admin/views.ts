import type { CompiledCollection } from "@oboe/core";
import {
  FORM_BUILDER_VIEW_KEY,
  getFormBuilderMetadata,
} from "@oboe/plugin-form-builder";
import { notFound } from "next/navigation";

export function getSelectedAdminView(
  searchParams: Record<string, string | string[] | undefined>
) {
  return Array.isArray(searchParams.view)
    ? searchParams.view[0]
    : searchParams.view;
}

export function resolveCollectionAdminView(
  collection: CompiledCollection,
  searchParams: Record<string, string | string[] | undefined>
) {
  const selectedView = getSelectedAdminView(searchParams);
  const customView = selectedView
    ? collection.admin?.views?.[selectedView]
    : undefined;
  const builderView = collection.admin?.views?.[FORM_BUILDER_VIEW_KEY];
  const builderMetadata = getFormBuilderMetadata(collection);

  if (selectedView && !customView && selectedView !== FORM_BUILDER_VIEW_KEY) {
    notFound();
  }

  return {
    builderMetadata,
    builderView,
    customView,
    selectedView,
  };
}
