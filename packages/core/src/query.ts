import type {
  CollectionQuery,
  CollectionWhere,
  FindResult,
  OboeDocument,
  OboeRecord,
  SelectNode,
  SelectShape,
} from "./types.js";

const DEFAULT_DEPTH = 2;
const DEFAULT_LIMIT = 10;
const OPERATOR_KEYS = new Set([
  "contains",
  "endsWith",
  "eq",
  "exists",
  "gt",
  "gte",
  "in",
  "like",
  "lt",
  "lte",
  "ne",
  "notIn",
  "startsWith",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFieldValue(record: OboeRecord, field: string) {
  if (field === "id" || field === "createdAt" || field === "updatedAt") {
    return record[field];
  }

  return record.data[field];
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          key in right && deepEqual(left[key], right[key as keyof typeof right])
      )
    );
  }

  return false;
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }

  if (left === undefined || left === null) {
    return 1;
  }

  if (right === undefined || right === null) {
    return -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right));
}

function isOperatorObject(value: unknown) {
  return (
    isPlainObject(value) &&
    Object.keys(value).some((key) => OPERATOR_KEYS.has(key))
  );
}

function matchesOperator(value: unknown, operator: string, expected: unknown) {
  switch (operator) {
    case "contains":
      return typeof value === "string" && value.includes(String(expected));
    case "endsWith":
      return typeof value === "string" && value.endsWith(String(expected));
    case "eq":
      return deepEqual(value, expected);
    case "exists":
      return (value !== undefined && value !== null) === Boolean(expected);
    case "gt":
      return compareValues(value, expected) > 0;
    case "gte":
      return compareValues(value, expected) >= 0;
    case "in":
      return (
        Array.isArray(expected) &&
        expected.some((entry) => deepEqual(value, entry))
      );
    case "like":
      return typeof value === "string" && value.includes(String(expected));
    case "lt":
      return compareValues(value, expected) < 0;
    case "lte":
      return compareValues(value, expected) <= 0;
    case "ne":
      return !deepEqual(value, expected);
    case "notIn":
      return (
        Array.isArray(expected) &&
        expected.every((entry) => !deepEqual(value, entry))
      );
    case "startsWith":
      return typeof value === "string" && value.startsWith(String(expected));
    default:
      return false;
  }
}

function matchesFieldCondition(value: unknown, condition: unknown) {
  if (isOperatorObject(condition)) {
    return Object.entries(condition as Record<string, unknown>).every(
      ([operator, expected]) => matchesOperator(value, operator, expected)
    );
  }

  return deepEqual(value, condition);
}

export function matchesWhere(
  record: OboeRecord,
  where?: CollectionWhere
): boolean {
  if (!where) {
    return true;
  }

  const andConditions = Array.isArray(where.and) ? where.and : undefined;
  const orConditions = Array.isArray(where.or) ? where.or : undefined;

  if (
    andConditions &&
    !andConditions.every((condition) => matchesWhere(record, condition))
  ) {
    return false;
  }

  if (
    orConditions &&
    !orConditions.some((condition) => matchesWhere(record, condition))
  ) {
    return false;
  }

  return Object.entries(where).every(([field, condition]) => {
    if (field === "and" || field === "or") {
      return true;
    }

    return matchesFieldCondition(getFieldValue(record, field), condition);
  });
}

export function normalizeSort(sort: CollectionQuery["sort"]) {
  const values = Array.isArray(sort)
    ? sort
    : typeof sort === "string"
      ? sort
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];

  return values.map((entry) => ({
    direction: entry.startsWith("-") ? "desc" : "asc",
    field: entry.replace(/^[+-]/, ""),
  }));
}

export function sortRecords(
  records: OboeRecord[],
  sort: CollectionQuery["sort"]
) {
  const sortFields = normalizeSort(sort);

  if (sortFields.length === 0) {
    return [...records].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  return [...records].sort((left, right) => {
    for (const sortField of sortFields) {
      const comparison = compareValues(
        getFieldValue(left, sortField.field),
        getFieldValue(right, sortField.field)
      );

      if (comparison !== 0) {
        return sortField.direction === "desc" ? -comparison : comparison;
      }
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function projectValue(
  value: unknown,
  selectNode: SelectNode | undefined
): unknown {
  if (!isPlainObject(selectNode) || !isPlainObject(value)) {
    return value;
  }

  return applySelect(value as OboeDocument, selectNode);
}

export function applySelect(
  document: OboeDocument,
  select?: SelectShape
): OboeDocument {
  if (!select || Object.keys(select).length === 0) {
    return document;
  }

  const metaFields = new Set(["id", "createdAt", "updatedAt"]);
  const selectedEntries = Object.entries(select);
  const includeMode = selectedEntries.some(
    ([, value]) => value === true || isPlainObject(value)
  );

  const next = {
    createdAt: document.createdAt,
    id: document.id,
    updatedAt: document.updatedAt,
  } as OboeDocument;

  for (const [key, value] of Object.entries(document)) {
    if (metaFields.has(key)) {
      continue;
    }

    const selectNode = select[key];

    if (includeMode) {
      if (selectNode === undefined || selectNode === false) {
        continue;
      }

      next[key] = projectValue(value, selectNode);
      continue;
    }

    if (selectNode === false) {
      continue;
    }

    next[key] = projectValue(value, selectNode);
  }

  return next;
}

export function paginateDocuments<TDocument>(
  docs: TDocument[],
  query?: CollectionQuery
): FindResult<TDocument> {
  const limit = Math.max(1, query?.limit ?? DEFAULT_LIMIT);
  const pagination = query?.pagination ?? true;
  const page = Math.max(1, query?.page ?? 1);

  if (!pagination) {
    const sliced = docs.slice(0, limit);
    return {
      docs: sliced,
      hasNextPage: false,
      hasPrevPage: false,
      limit,
      nextPage: null,
      page: 1,
      pagingCounter: sliced.length > 0 ? 1 : 0,
      prevPage: null,
      totalDocs: sliced.length,
      totalPages: sliced.length > 0 ? 1 : 0,
    };
  }

  const totalDocs = docs.length;
  const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / limit);
  const normalizedPage = totalPages === 0 ? 1 : Math.min(page, totalPages);
  const startIndex = (normalizedPage - 1) * limit;
  const pageDocs = docs.slice(startIndex, startIndex + limit);

  return {
    docs: pageDocs,
    hasNextPage: totalPages > 0 && normalizedPage < totalPages,
    hasPrevPage: normalizedPage > 1 && totalPages > 0,
    limit,
    nextPage:
      totalPages > 0 && normalizedPage < totalPages ? normalizedPage + 1 : null,
    page: normalizedPage,
    pagingCounter: pageDocs.length > 0 ? startIndex + 1 : 0,
    prevPage: normalizedPage > 1 ? normalizedPage - 1 : null,
    totalDocs,
    totalPages,
  };
}

export function defaultDepth(depth?: number) {
  return depth ?? DEFAULT_DEPTH;
}
