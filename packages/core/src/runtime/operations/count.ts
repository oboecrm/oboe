import type {
  BaseGeneratedTypes,
  CountResult,
  GeneratedTypes,
} from "../../types.js";
import type { CountCollectionOperationArgs } from "./types.js";

export async function countCollectionOperation<
  TGeneratedTypes extends Partial<BaseGeneratedTypes> = GeneratedTypes,
  TSlug extends string = string,
>(
  args: CountCollectionOperationArgs<TGeneratedTypes, TSlug>
): Promise<CountResult> {
  const { callArgs, collectionConfig, deps } = args;
  const { collection, overrideAccess, query, req, user } = callArgs;

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

  const records = await deps.db.find({
    collection,
  });

  return deps.countRecords(
    deps.filterRecords(records, { where: query?.where })
  );
}
