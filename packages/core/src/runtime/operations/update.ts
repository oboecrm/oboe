import type {
  BaseGeneratedTypes,
  CollectionDocumentForSlug,
  GeneratedTypes,
  OboeRecord,
} from "../../types.js";
import type { UpdateCollectionOperationArgs } from "./types.js";

export async function updateCollectionOperation<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
>(
  args: UpdateCollectionOperationArgs<TGeneratedTypes, TSlug>
): Promise<CollectionDocumentForSlug<TGeneratedTypes, TSlug> | null> {
  const { callArgs, collectionConfig, context, deps } = args;
  const {
    collection,
    data,
    depth,
    file,
    id,
    overrideAccess,
    req,
    select,
    user,
  } = callArgs;
  const operationArgs: Record<string, unknown> = {
    collection,
    data,
    depth,
    file,
    id,
    overrideAccess,
    select,
  };

  if (
    !(await deps.canAccess({
      collection: collectionConfig,
      data,
      id,
      operation: "update",
      overrideAccess,
      req,
      user,
    }))
  ) {
    throw new Error(`Access denied for update on "${collection}".`);
  }

  await deps.runCollectionBeforeOperation({
    collection: collectionConfig,
    context,
    hookArgs: operationArgs,
    oboe: deps.runtime,
    operation: "update",
    req,
    user,
  });

  const existingRecord = await deps.db.findById({ collection, id });
  const existing = existingRecord ? deps.cloneRecord(existingRecord) : null;
  const candidateData = await deps.prepareValidatedData({
    collection: collectionConfig,
    context,
    data,
    file,
    operation: "update",
    originalDoc: existing,
    req,
    user,
  });
  const previousFile = deps.getStoredFileData(existing?.data.file);
  const uploadedFile = await deps.uploadCollectionFile({
    collection: collectionConfig,
    data: candidateData,
    file,
    req,
    user,
  });

  let updated: OboeRecord | null;

  try {
    updated = await deps.db.update({
      collection,
      data: uploadedFile
        ? {
            ...candidateData,
            file: uploadedFile,
          }
        : candidateData,
      id,
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

  if (!updated) {
    await deps.cleanupUploadedFile({
      collection: collectionConfig,
      file: uploadedFile,
      req,
      user,
    });
    return null;
  }

  const nextRecord = deps.cloneRecord(updated);

  if (uploadedFile && previousFile) {
    try {
      await deps.cleanupUploadedFile({
        collection: collectionConfig,
        file: previousFile,
        req,
        user,
      });
    } catch (error) {
      console.error(error);
    }
  }

  await deps.runFieldHookPhase({
    collection: collectionConfig,
    context,
    data: nextRecord.data,
    fields: collectionConfig.fields,
    hookName: "afterChange",
    oboe: deps.runtime,
    operation: "update",
    originalDoc: existing,
    req,
    user,
  });
  const doc = await deps.runAfterChange({
    collection: collectionConfig,
    context,
    doc: nextRecord,
    oboe: deps.runtime,
    operation: "update",
    originalDoc: existing,
    req,
    user,
  });

  await deps.db.recordAudit?.({
    actor: user,
    at: new Date().toISOString(),
    collection,
    id,
    operation: "update",
    payload: doc.data,
  });
  await deps.events.emit(`${collection}.updated`, { collection, id });

  const readable = await deps.runCollectionReadPipeline({
    collection: collectionConfig,
    context,
    doc,
    oboe: deps.runtime,
    operation: "update",
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
    operation: "update",
    req,
    result,
    user,
  })) as CollectionDocumentForSlug<TGeneratedTypes, TSlug> | null;
}
