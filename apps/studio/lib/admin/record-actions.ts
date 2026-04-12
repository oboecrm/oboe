import type { CompiledCollection, OboeRuntime } from "@oboe/core";
import {
  FORM_BUILDER_VIEW_KEY,
  type FormBuilderCollectionMetadata,
  normalizeBuilderPayload,
} from "@oboe/plugin-form-builder";

import { getStudioRuntime } from "../runtime";
import { withAdminAccess } from "./access";
import { formDataToCollectionInput } from "./form-data";

export async function createBuilderRecord(args: {
  collection: CompiledCollection;
  metadata: FormBuilderCollectionMetadata;
  payload: string;
}) {
  const { runtime } = await getStudioRuntime();
  const runtimeCollection = runtime.schema.collections.get(
    args.collection.slug
  );

  if (!runtimeCollection) {
    throw new Error(`Unknown collection "${args.collection.slug}".`);
  }

  const doc = await runtime.create(
    withAdminAccess({
      collection: runtimeCollection.slug,
      data: normalizeBuilderPayload(
        args.payload,
        args.metadata.allowedFieldTypes
      ) as unknown as Record<string, unknown>,
    })
  );

  return `/admin/${runtimeCollection.slug}/${doc.id}?view=${FORM_BUILDER_VIEW_KEY}`;
}

export async function updateBuilderRecord(args: {
  collectionSlug: string;
  docId: string;
  metadata: FormBuilderCollectionMetadata;
  payload: string;
}) {
  const { runtime } = await getStudioRuntime();

  await runtime.update(
    withAdminAccess({
      collection: args.collectionSlug,
      data: normalizeBuilderPayload(
        args.payload,
        args.metadata.allowedFieldTypes
      ) as unknown as Partial<Record<string, unknown>>,
      id: args.docId,
    })
  );

  return `/admin/${args.collectionSlug}/${args.docId}?view=${FORM_BUILDER_VIEW_KEY}`;
}

export async function createGeneratedRecord(args: {
  collection: CompiledCollection;
  formData: FormData;
}) {
  const { runtime } = await getStudioRuntime();
  const runtimeCollection = runtime.schema.collections.get(
    args.collection.slug
  );

  if (!runtimeCollection) {
    throw new Error(`Unknown collection "${args.collection.slug}".`);
  }

  const doc = await runtime.create(
    withAdminAccess({
      collection: runtimeCollection.slug,
      data: formDataToCollectionInput(runtimeCollection.fields, args.formData),
    })
  );

  return `/admin/${runtimeCollection.slug}/${doc.id}`;
}

export async function findAdminRecord(args: {
  collectionSlug: string;
  id: string;
  runtime: OboeRuntime;
}) {
  return args.runtime.findById(
    withAdminAccess({
      collection: args.collectionSlug,
      id: args.id,
    })
  );
}

export async function findAdminRecords(args: {
  collectionSlug: string;
  runtime: OboeRuntime;
}) {
  return args.runtime.find(
    withAdminAccess({
      collection: args.collectionSlug,
    })
  );
}
