import type {
  BaseGeneratedTypes,
  CollectionDocumentForSlug,
  GeneratedTypes,
} from "../../types.js";
import type {
  FindCollectionOperationArgs,
  FindCollectionOperationResult,
} from "./types.js";

export async function findCollectionOperation<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
>(
  args: FindCollectionOperationArgs<TGeneratedTypes, TSlug>
): Promise<FindCollectionOperationResult<TGeneratedTypes, TSlug>> {
  const { callArgs, collectionConfig, context, deps } = args;
  const { collection, overrideAccess, query, req, user } = callArgs;
  const operationArgs: Record<string, unknown> = {
    collection,
    overrideAccess,
    query,
  };

  if (
    !(await deps.canAccess({
      collection: collectionConfig,
      operation: "read",
      overrideAccess,
      req,
      user,
    }))
  ) {
    throw new Error(`Access denied for read on "${collection}".`);
  }

  await deps.runCollectionBeforeOperation({
    collection: collectionConfig,
    context,
    hookArgs: operationArgs,
    oboe: deps.runtime,
    operation: "read",
    req,
    user,
  });

  const records = deps.filterRecords(
    (
      await deps.db.find({
        collection,
      })
    ).map((record) => deps.cloneRecord(record)),
    query
  );
  const pageResult = deps.paginateDocuments(records, query);
  const docs = await Promise.all(
    pageResult.docs.map(async (record) =>
      deps.materializeDocument({
        collectionSlug: collection,
        context,
        depth: query?.depth,
        overrideAccess,
        record: await deps.runCollectionReadPipeline({
          collection: collectionConfig,
          context,
          doc: record,
          oboe: deps.runtime,
          operation: "read",
          req,
          user,
        }),
        req,
        select: query?.select,
        user,
      })
    )
  );

  return (await deps.runCollectionAfterOperation({
    collection: collectionConfig,
    context,
    hookArgs: operationArgs,
    oboe: deps.runtime,
    operation: "read",
    req,
    result: {
      ...pageResult,
      docs: docs as CollectionDocumentForSlug<TGeneratedTypes, TSlug>[],
    },
    user,
  })) as FindCollectionOperationResult<TGeneratedTypes, TSlug>;
}
