import type { CompiledCollection } from "@oboe/core";

export interface CollectionViewLinkOptions {
  basePath?: string;
  docId?: string;
}

function getCollectionViewLinksWithOptions(
  collection: CompiledCollection,
  options: CollectionViewLinkOptions
) {
  const basePath = options.basePath ?? "/admin";
  const hrefBase = options.docId
    ? `${basePath}/${collection.slug}/${options.docId}`
    : `${basePath}/${collection.slug}`;

  return Object.entries(collection.admin?.views ?? {})
    .filter(([, view]) => options.docId || view.path !== "/builder")
    .map(([key, view]) => ({
      href: `${hrefBase}?view=${key}`,
      key,
      label: view.label,
      path: view.path,
    }));
}

export function getCollectionViewLinks(
  collection: CompiledCollection,
  options?: CollectionViewLinkOptions
) {
  return getCollectionViewLinksWithOptions(collection, options ?? {});
}
