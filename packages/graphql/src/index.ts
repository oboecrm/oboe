import type {
  CollectionQuery,
  CompiledCollection,
  OboeRuntime,
  SelectShape,
} from "@oboe/core";
import * as GraphQL from "graphql";

function toPascalCase(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

function parseJsonLiteral(
  ast: Parameters<GraphQL.GraphQLScalarType["parseLiteral"]>[0]
): unknown {
  switch (ast.kind) {
    case GraphQL.Kind.STRING:
    case GraphQL.Kind.BOOLEAN:
      return ast.value;
    case GraphQL.Kind.INT:
    case GraphQL.Kind.FLOAT:
      return Number(ast.value);
    case GraphQL.Kind.NULL:
      return null;
    case GraphQL.Kind.OBJECT:
      return Object.fromEntries(
        ast.fields.map((field) => [
          field.name.value,
          parseJsonLiteral(field.value),
        ])
      );
    case GraphQL.Kind.LIST:
      return ast.values.map((value) => parseJsonLiteral(value));
    default:
      return null;
  }
}

const JsonScalar = new GraphQL.GraphQLScalarType({
  name: "JSON",
  parseLiteral(ast) {
    return parseJsonLiteral(ast);
  },
  parseValue(value) {
    return value;
  },
  serialize(value) {
    return value;
  },
});

const stringOperatorsType = new GraphQL.GraphQLInputObjectType({
  name: "OboeStringWhereInput",
  fields: {
    contains: { type: GraphQL.GraphQLString },
    endsWith: { type: GraphQL.GraphQLString },
    eq: { type: GraphQL.GraphQLString },
    exists: { type: GraphQL.GraphQLBoolean },
    gt: { type: GraphQL.GraphQLString },
    gte: { type: GraphQL.GraphQLString },
    in: { type: new GraphQL.GraphQLList(GraphQL.GraphQLString) },
    like: { type: GraphQL.GraphQLString },
    lt: { type: GraphQL.GraphQLString },
    lte: { type: GraphQL.GraphQLString },
    ne: { type: GraphQL.GraphQLString },
    notIn: { type: new GraphQL.GraphQLList(GraphQL.GraphQLString) },
    startsWith: { type: GraphQL.GraphQLString },
  },
});

const numberOperatorsType = new GraphQL.GraphQLInputObjectType({
  name: "OboeNumberWhereInput",
  fields: {
    eq: { type: GraphQL.GraphQLFloat },
    exists: { type: GraphQL.GraphQLBoolean },
    gt: { type: GraphQL.GraphQLFloat },
    gte: { type: GraphQL.GraphQLFloat },
    in: { type: new GraphQL.GraphQLList(GraphQL.GraphQLFloat) },
    lt: { type: GraphQL.GraphQLFloat },
    lte: { type: GraphQL.GraphQLFloat },
    ne: { type: GraphQL.GraphQLFloat },
    notIn: { type: new GraphQL.GraphQLList(GraphQL.GraphQLFloat) },
  },
});

const booleanOperatorsType = new GraphQL.GraphQLInputObjectType({
  name: "OboeBooleanWhereInput",
  fields: {
    eq: { type: GraphQL.GraphQLBoolean },
    exists: { type: GraphQL.GraphQLBoolean },
    ne: { type: GraphQL.GraphQLBoolean },
  },
});

const jsonOperatorsType = new GraphQL.GraphQLInputObjectType({
  name: "OboeJsonWhereInput",
  fields: {
    eq: { type: JsonScalar },
    exists: { type: GraphQL.GraphQLBoolean },
    ne: { type: JsonScalar },
  },
});

function fieldScalarType(collection: CompiledCollection, fieldName: string) {
  if (fieldName === "id") {
    return GraphQL.GraphQLID;
  }

  if (fieldName === "createdAt" || fieldName === "updatedAt") {
    return GraphQL.GraphQLString;
  }

  const field = collection.fields.find((entry) => entry.name === fieldName);

  if (!field) {
    return GraphQL.GraphQLString;
  }

  switch (field.type) {
    case "boolean":
      return GraphQL.GraphQLBoolean;
    case "number":
      return GraphQL.GraphQLFloat;
    case "json":
      return JsonScalar;
    case "relation":
    case "relationship":
      return GraphQL.GraphQLID;
    default:
      return GraphQL.GraphQLString;
  }
}

function fieldWhereType(field: CompiledCollection["fields"][number]) {
  switch (field.type) {
    case "boolean":
      return booleanOperatorsType;
    case "number":
      return numberOperatorsType;
    case "json":
      return jsonOperatorsType;
    default:
      return stringOperatorsType;
  }
}

function collectSelections(
  selectionSet: GraphQL.SelectionSetNode | undefined,
  info: GraphQL.GraphQLResolveInfo
) {
  const result: SelectShape = {};

  if (!selectionSet) {
    return result;
  }

  for (const selection of selectionSet.selections) {
    if (selection.kind === GraphQL.Kind.FIELD) {
      const key = selection.name.value;
      result[key] = selection.selectionSet
        ? collectSelections(selection.selectionSet, info)
        : true;
      continue;
    }

    if (selection.kind === GraphQL.Kind.INLINE_FRAGMENT) {
      Object.assign(result, collectSelections(selection.selectionSet, info));
      continue;
    }

    if (selection.kind === GraphQL.Kind.FRAGMENT_SPREAD) {
      const fragment = info.fragments[selection.name.value];
      if (fragment) {
        Object.assign(result, collectSelections(fragment.selectionSet, info));
      }
    }
  }

  return result;
}

function normalizeGraphQLSelect(
  collection: CompiledCollection,
  select: SelectShape
): SelectShape {
  const normalized: SelectShape = {};

  for (const [key, value] of Object.entries(select)) {
    const relationIdField = collection.fields.find(
      (field) => `${field.name}ID` === key
    );

    if (relationIdField) {
      normalized[relationIdField.name] = true;
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function selectFromInfo(
  collection: CompiledCollection,
  info: GraphQL.GraphQLResolveInfo,
  nestedPath?: string[]
) {
  const baseSelect = collectSelections(info.fieldNodes[0]?.selectionSet, info);

  if (!nestedPath || nestedPath.length === 0) {
    return normalizeGraphQLSelect(collection, baseSelect);
  }

  let current: SelectShape | boolean | undefined = baseSelect;
  for (const key of nestedPath) {
    if (!current || current === true || !(key in current)) {
      return undefined;
    }

    current = current[key] as SelectShape | boolean | undefined;
  }

  if (!current || current === true) {
    return undefined;
  }

  return normalizeGraphQLSelect(collection, current);
}

function queryArgs(whereType: GraphQL.GraphQLInputObjectType) {
  return {
    depth: { type: GraphQL.GraphQLInt },
    limit: { type: GraphQL.GraphQLInt },
    page: { type: GraphQL.GraphQLInt },
    pagination: { type: GraphQL.GraphQLBoolean },
    sort: { type: GraphQL.GraphQLString },
    where: { type: whereType },
  };
}

export interface GraphQLService {
  execute: (args: {
    query: string;
    variables?: Record<string, unknown>;
  }) => Promise<unknown>;
  schema: GraphQL.GraphQLSchema;
}

export function createGraphQLService(runtime: OboeRuntime): GraphQLService {
  const documentTypes = new Map<string, GraphQL.GraphQLObjectType>();
  const whereTypes = new Map<string, GraphQL.GraphQLInputObjectType>();
  const createInputTypes = new Map<string, GraphQL.GraphQLInputObjectType>();
  const updateInputTypes = new Map<string, GraphQL.GraphQLInputObjectType>();
  const paginatedTypes = new Map<string, GraphQL.GraphQLObjectType>();

  const getDocumentType = (collection: CompiledCollection) => {
    const existing = documentTypes.get(collection.slug);
    if (existing) {
      return existing;
    }

    const type = new GraphQL.GraphQLObjectType({
      name: `${toPascalCase(collection.slug)}Document`,
      fields: () => {
        const baseFields: GraphQL.GraphQLFieldConfigMap<unknown, unknown> = {
          createdAt: {
            type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLString),
          },
          id: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLID) },
          updatedAt: {
            type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLString),
          },
        };

        for (const field of collection.fields) {
          if (
            (field.type === "relation" || field.type === "relationship") &&
            field.relationTo
          ) {
            const relatedCollection = runtime.schema.collections.get(
              field.relationTo
            );
            baseFields[`${field.name}ID`] = {
              type: GraphQL.GraphQLID,
              resolve: (source: unknown) => {
                const doc = source as Record<string, unknown>;
                const value = doc[field.name];

                if (value && typeof value === "object" && "id" in value) {
                  return value.id;
                }

                return typeof value === "string" ? value : null;
              },
            };
            baseFields[field.name] = {
              resolve: (source: unknown) => {
                const doc = source as Record<string, unknown>;
                const value = doc[field.name];
                return value && typeof value === "object" ? value : null;
              },
              type: relatedCollection
                ? getDocumentType(relatedCollection)
                : JsonScalar,
            };
            continue;
          }

          baseFields[field.name] = {
            type: fieldScalarType(collection, field.name),
          };
        }

        return baseFields;
      },
    });

    documentTypes.set(collection.slug, type);
    return type;
  };

  const getWhereType = (collection: CompiledCollection) => {
    const existing = whereTypes.get(collection.slug);
    if (existing) {
      return existing;
    }

    let type!: GraphQL.GraphQLInputObjectType;
    type = new GraphQL.GraphQLInputObjectType({
      name: `${toPascalCase(collection.slug)}WhereInput`,
      fields: () => ({
        and: {
          type: new GraphQL.GraphQLList(new GraphQL.GraphQLNonNull(type)),
        },
        or: {
          type: new GraphQL.GraphQLList(new GraphQL.GraphQLNonNull(type)),
        },
        ...Object.fromEntries(
          collection.fields.map((field) => [
            field.name,
            { type: fieldWhereType(field) },
          ])
        ),
        createdAt: { type: stringOperatorsType },
        id: { type: stringOperatorsType },
        updatedAt: { type: stringOperatorsType },
      }),
    });

    whereTypes.set(collection.slug, type);
    return type;
  };

  const getInputType = (
    collection: CompiledCollection,
    mode: "create" | "update"
  ) => {
    const cache = mode === "create" ? createInputTypes : updateInputTypes;
    const existing = cache.get(collection.slug);
    if (existing) {
      return existing;
    }

    const input = new GraphQL.GraphQLInputObjectType({
      name: `${toPascalCase(collection.slug)}${mode === "create" ? "Create" : "Update"}Input`,
      fields: Object.fromEntries(
        collection.fields.map((field) => {
          const scalar =
            field.type === "json"
              ? JsonScalar
              : fieldScalarType(collection, field.name);
          return [
            field.name,
            {
              type:
                mode === "create" && field.required
                  ? new GraphQL.GraphQLNonNull(scalar)
                  : scalar,
            },
          ];
        })
      ),
    });

    cache.set(collection.slug, input);
    return input;
  };

  const getPaginatedType = (collection: CompiledCollection) => {
    const existing = paginatedTypes.get(collection.slug);
    if (existing) {
      return existing;
    }

    const type = new GraphQL.GraphQLObjectType({
      name: `${toPascalCase(collection.slug)}ListResult`,
      fields: {
        docs: {
          type: new GraphQL.GraphQLNonNull(
            new GraphQL.GraphQLList(
              new GraphQL.GraphQLNonNull(getDocumentType(collection))
            )
          ),
        },
        hasNextPage: {
          type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLBoolean),
        },
        hasPrevPage: {
          type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLBoolean),
        },
        limit: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLInt) },
        nextPage: { type: GraphQL.GraphQLInt },
        page: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLInt) },
        pagingCounter: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLInt) },
        prevPage: { type: GraphQL.GraphQLInt },
        totalDocs: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLInt) },
        totalPages: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLInt) },
      },
    });

    paginatedTypes.set(collection.slug, type);
    return type;
  };

  const countResultType = new GraphQL.GraphQLObjectType({
    name: "OboeCountResult",
    fields: {
      totalDocs: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLInt) },
    },
  });

  const queryFields: GraphQL.GraphQLFieldConfigMap<unknown, unknown> = {};
  const mutationFields: GraphQL.GraphQLFieldConfigMap<unknown, unknown> = {};

  for (const collection of runtime.schema.collections.values()) {
    const listSelectPath = ["docs"];

    queryFields[`${collection.slug}List`] = {
      args: queryArgs(getWhereType(collection)),
      resolve: async (
        _root,
        args: CollectionQuery,
        _context,
        info: GraphQL.GraphQLResolveInfo
      ) =>
        runtime.find({
          collection: collection.slug,
          query: {
            ...args,
            select: selectFromInfo(collection, info, listSelectPath),
          },
        }),
      type: new GraphQL.GraphQLNonNull(getPaginatedType(collection)),
    };

    queryFields[`${collection.slug}ById`] = {
      args: {
        depth: { type: GraphQL.GraphQLInt },
        id: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLID) },
      },
      resolve: async (
        _root,
        args: { depth?: number; id: string },
        _context,
        info: GraphQL.GraphQLResolveInfo
      ) =>
        runtime.findById({
          collection: collection.slug,
          depth: args.depth,
          id: args.id,
          select: selectFromInfo(collection, info),
        }),
      type: getDocumentType(collection),
    };

    queryFields[`${collection.slug}Count`] = {
      args: {
        where: { type: getWhereType(collection) },
      },
      resolve: async (_root, args: { where?: CollectionQuery["where"] }) =>
        runtime.count({
          collection: collection.slug,
          query: {
            where: args.where,
          },
        }),
      type: new GraphQL.GraphQLNonNull(countResultType),
    };

    mutationFields[`create${toPascalCase(collection.slug)}`] = {
      args: {
        data: {
          type: new GraphQL.GraphQLNonNull(getInputType(collection, "create")),
        },
        depth: { type: GraphQL.GraphQLInt },
      },
      resolve: async (
        _root,
        args: { data: Record<string, unknown>; depth?: number },
        _context,
        info: GraphQL.GraphQLResolveInfo
      ) =>
        runtime.create({
          collection: collection.slug,
          data: args.data,
          depth: args.depth,
          select: selectFromInfo(collection, info),
        }),
      type: new GraphQL.GraphQLNonNull(getDocumentType(collection)),
    };

    mutationFields[`update${toPascalCase(collection.slug)}`] = {
      args: {
        data: {
          type: new GraphQL.GraphQLNonNull(getInputType(collection, "update")),
        },
        depth: { type: GraphQL.GraphQLInt },
        id: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLID) },
      },
      resolve: async (
        _root,
        args: { data: Record<string, unknown>; depth?: number; id: string },
        _context,
        info: GraphQL.GraphQLResolveInfo
      ) =>
        runtime.update({
          collection: collection.slug,
          data: args.data,
          depth: args.depth,
          id: args.id,
          select: selectFromInfo(collection, info),
        }),
      type: getDocumentType(collection),
    };

    mutationFields[`delete${toPascalCase(collection.slug)}`] = {
      args: {
        depth: { type: GraphQL.GraphQLInt },
        id: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLID) },
      },
      resolve: async (
        _root,
        args: { depth?: number; id: string },
        _context,
        info: GraphQL.GraphQLResolveInfo
      ) =>
        runtime.delete({
          collection: collection.slug,
          depth: args.depth,
          id: args.id,
          select: selectFromInfo(collection, info),
        }),
      type: getDocumentType(collection),
    };
  }

  Object.assign(
    queryFields,
    argsToFieldMap(
      runtime.config.graphQL?.queries?.({ GraphQL, oboe: runtime })
    )
  );
  Object.assign(
    mutationFields,
    argsToFieldMap(
      runtime.config.graphQL?.mutations?.({ GraphQL, oboe: runtime })
    )
  );

  const schema = new GraphQL.GraphQLSchema({
    mutation: new GraphQL.GraphQLObjectType({
      name: "Mutation",
      fields: mutationFields,
    }),
    query: new GraphQL.GraphQLObjectType({
      name: "Query",
      fields: queryFields,
    }),
  });

  const service: GraphQLService = {
    async execute({ query, variables }) {
      return GraphQL.graphql({
        schema,
        source: query,
        variableValues: variables,
      });
    },
    schema,
  };

  runtime.setGraphQLExecutor({
    execute: service.execute,
  });

  return service;
}

function argsToFieldMap(value: Record<string, unknown> | undefined) {
  return (value ?? {}) as GraphQL.GraphQLFieldConfigMap<unknown, unknown>;
}

export function createGraphQLHandler(service: GraphQLService) {
  return async function handle(request: Request) {
    const body = (await request.json()) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    const result = await service.execute(body);

    return new Response(JSON.stringify(result), {
      headers: {
        "content-type": "application/json",
      },
    });
  };
}
