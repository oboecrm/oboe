import type {
  OboeDocument,
  OboeGlobalDocument,
  OboeGlobalRecord,
  OboeRecord,
} from "../types.js";

export function toPublicDocument(record: OboeRecord): OboeDocument {
  return {
    ...record.data,
    createdAt: record.createdAt,
    id: record.id,
    updatedAt: record.updatedAt,
  };
}

export function toPublicGlobalDocument(
  record: OboeGlobalRecord
): OboeGlobalDocument {
  return {
    ...record.data,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function cloneRecord(record: OboeRecord): OboeRecord {
  return {
    ...record,
    data: structuredClone(record.data),
  };
}

export function cloneGlobalRecord(record: OboeGlobalRecord): OboeGlobalRecord {
  return {
    ...record,
    data: structuredClone(record.data),
  };
}
