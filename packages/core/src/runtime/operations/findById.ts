import type {
  BaseGeneratedTypes,
  CollectionDocumentForSlug,
  GeneratedTypes,
} from "../../types.js";
import type { FindByIdCollectionOperationArgs } from "./types.js";

export async function findByIdCollectionOperation<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
>(
  args: FindByIdCollectionOperationArgs<TGeneratedTypes, TSlug>
): Promise<CollectionDocumentForSlug<TGeneratedTypes, TSlug> | null> {
  const { callArgs, collectionConfig, context, deps } = args;
  const { collection, depth, id, overrideAccess, req, select, user } = callArgs;
  const operationArgs: Record<string, unknown> = {
    collection,
    depth,
    id,
    overrideAccess,
    select,
  };

  await deps.runCollectionBeforeOperation({
    collection: collectionConfig,
    context,
    hookArgs: operationArgs,
    oboe: deps.runtime,
    operation: "read",
    req,
    user,
  });

  const doc = await deps.loadVisibleRecord({
    collectionSlug: collection,
    context,
    id,
    overrideAccess,
    req,
    user,
  });

  if (!doc) {
    return null;
  }

  const result = await deps.materializeDocument({
    collectionSlug: collection,
    context,
    depth,
    overrideAccess,
    record: doc,
    req,
    select,
    user,
  });

  return (await deps.runCollectionAfterOperation({
    collection: collectionConfig,
    context,
    hookArgs: operationArgs,
    oboe: deps.runtime,
    operation: "read",
    req,
    result,
    user,
  })) as CollectionDocumentForSlug<TGeneratedTypes, TSlug> | null;
}
