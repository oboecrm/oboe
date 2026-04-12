import type {
  BaseGeneratedTypes,
  CollectionDocumentForSlug,
  GeneratedTypes,
} from "../../types.js";
import type { DeleteCollectionOperationArgs } from "./types.js";

export async function deleteCollectionOperation<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
>(
  args: DeleteCollectionOperationArgs<TGeneratedTypes, TSlug>
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

  if (
    !(await deps.canAccess({
      collection: collectionConfig,
      id,
      operation: "delete",
      overrideAccess,
      req,
      user,
    }))
  ) {
    throw new Error(`Access denied for delete on "${collection}".`);
  }

  await deps.runCollectionBeforeOperation({
    collection: collectionConfig,
    context,
    hookArgs: operationArgs,
    oboe: deps.runtime,
    operation: "delete",
    req,
    user,
  });

  let existing = await deps.db.findById({
    collection,
    id,
  });
  existing = existing ? deps.cloneRecord(existing) : null;

  if (existing) {
    for (const hook of collectionConfig.hooks?.beforeDelete ?? []) {
      existing = await hook({
        ...deps.collectionHookBase({
          collection: collectionConfig,
          context,
          oboe: deps.runtime,
          operation: "delete",
          req,
          user,
        }),
        doc: existing,
      });
    }
  }

  let doc = await deps.db.delete({
    collection,
    id,
  });

  if (doc) {
    doc = deps.cloneRecord(doc);

    for (const hook of collectionConfig.hooks?.afterDelete ?? []) {
      doc = await hook({
        ...deps.collectionHookBase({
          collection: collectionConfig,
          context,
          oboe: deps.runtime,
          operation: "delete",
          req,
          user,
        }),
        doc,
      });
    }

    try {
      await deps.cleanupUploadedFile({
        collection: collectionConfig,
        file: deps.getStoredFileData(doc.data.file),
        req,
        user,
      });
    } catch (error) {
      console.error(error);
    }

    await deps.db.recordAudit?.({
      actor: user,
      at: new Date().toISOString(),
      collection,
      id,
      operation: "delete",
      payload: doc.data,
    });
    await deps.events.emit(`${collection}.deleted`, { collection, id });
  }

  const result = doc
    ? await deps.materializeDocument({
        collectionSlug: collection,
        context,
        depth,
        overrideAccess,
        record: doc,
        req,
        select,
        user,
      })
    : null;

  return (await deps.runCollectionAfterOperation({
    collection: collectionConfig,
    context,
    hookArgs: operationArgs,
    oboe: deps.runtime,
    operation: "delete",
    req,
    result,
    user,
  })) as CollectionDocumentForSlug<TGeneratedTypes, TSlug> | null;
}
