import type {
  BaseGeneratedTypes,
  CollectionDocumentForSlug,
  GeneratedTypes,
  OboeRecord,
} from "../../types.js";
import type { CreateCollectionOperationArgs } from "./types.js";

export async function createCollectionOperation<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
>(
  args: CreateCollectionOperationArgs<TGeneratedTypes, TSlug>
): Promise<CollectionDocumentForSlug<TGeneratedTypes, TSlug>> {
  const { callArgs, collectionConfig, context, deps } = args;
  const { collection, data, depth, file, overrideAccess, req, select, user } =
    callArgs;
  const operationArgs: Record<string, unknown> = {
    collection,
    data,
    depth,
    file,
    overrideAccess,
    select,
  };

  if (
    !(await deps.canAccess({
      collection: collectionConfig,
      data,
      operation: "create",
      overrideAccess,
      req,
      user,
    }))
  ) {
    throw new Error(`Access denied for create on "${collectionConfig.slug}".`);
  }

  await deps.runCollectionBeforeOperation({
    collection: collectionConfig,
    context,
    hookArgs: operationArgs,
    oboe: deps.runtime,
    operation: "create",
    req,
    user,
  });

  const candidateData = await deps.prepareValidatedData({
    collection: collectionConfig,
    context,
    data,
    file,
    operation: "create",
    req,
    user,
  });
  const uploadedFile = await deps.uploadCollectionFile({
    collection: collectionConfig,
    data: candidateData,
    file,
    req,
    user,
  });

  let created: OboeRecord;

  try {
    created = await deps.db.create({
      collection,
      data: uploadedFile
        ? {
            ...candidateData,
            file: uploadedFile,
          }
        : candidateData,
    });
  } catch (error) {
    await deps.cleanupUploadedFile({
      collection: collectionConfig,
      file: uploadedFile,
      req,
      user,
    });
    throw error;
  }

  const nextRecord = deps.cloneRecord(created);
  await deps.runFieldHookPhase({
    collection: collectionConfig,
    context,
    data: nextRecord.data,
    fields: collectionConfig.fields,
    hookName: "afterChange",
    oboe: deps.runtime,
    operation: "create",
    req,
    user,
  });
  const doc = await deps.runAfterChange({
    collection: collectionConfig,
    context,
    doc: nextRecord,
    oboe: deps.runtime,
    operation: "create",
    req,
    user,
  });

  await deps.db.recordAudit?.({
    actor: user,
    at: new Date().toISOString(),
    collection,
    id: doc.id,
    operation: "create",
    payload: doc.data,
  });
  await deps.events.emit(`${collection}.created`, {
    collection,
    id: doc.id,
  });

  const readable = await deps.runCollectionReadPipeline({
    collection: collectionConfig,
    context,
    doc,
    oboe: deps.runtime,
    operation: "create",
    req,
    user,
  });
  const result = await deps.materializeDocument({
    collectionSlug: collection,
    context,
    depth,
    overrideAccess,
    record: readable,
    req,
    select,
    user,
  });

  return (await deps.runCollectionAfterOperation({
    collection: collectionConfig,
    context,
    hookArgs: operationArgs,
    oboe: deps.runtime,
    operation: "create",
    req,
    result,
    user,
  })) as CollectionDocumentForSlug<TGeneratedTypes, TSlug>;
}
