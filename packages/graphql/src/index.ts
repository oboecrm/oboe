import type { OboeRuntime } from "@oboe/core";
import {
  GraphQLFloat,
  GraphQLID,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  graphql,
  Kind,
} from "graphql";

function toPascalCase(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

function parseJsonLiteral(
  ast: Parameters<GraphQLScalarType["parseLiteral"]>[0]
): unknown {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.NULL:
      return null;
    case Kind.OBJECT:
      return Object.fromEntries(
        ast.fields.map((field) => [
          field.name.value,
          parseJsonLiteral(field.value),
        ])
      );
    case Kind.LIST:
      return ast.values.map((value) => parseJsonLiteral(value));
    default:
      return null;
  }
}

const JsonScalar = new GraphQLScalarType({
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

const OboeRecordType = new GraphQLObjectType({
  name: "OboeRecord",
  fields: {
    collection: {
      type: new GraphQLNonNull(GraphQLString),
    },
    createdAt: {
      type: new GraphQLNonNull(GraphQLString),
    },
    data: {
      type: new GraphQLNonNull(JsonScalar),
    },
    id: {
      type: new GraphQLNonNull(GraphQLID),
    },
    updatedAt: {
      type: new GraphQLNonNull(GraphQLString),
    },
  },
});

export interface GraphQLService {
  execute: (args: {
    query: string;
    variables?: Record<string, unknown>;
  }) => Promise<unknown>;
  schema: GraphQLSchema;
}

export function createGraphQLService(runtime: OboeRuntime): GraphQLService {
  const queryFields = Object.fromEntries(
    [...runtime.schema.collections.keys()].flatMap((slug) => {
      return [
        [
          `${slug}List`,
          {
            args: {
              limit: {
                type: GraphQLFloat,
              },
              where: {
                type: JsonScalar,
              },
            },
            resolve: async (
              _root: unknown,
              args: { limit?: number; where?: Record<string, unknown> }
            ) =>
              runtime.find({
                collection: slug,
                query: {
                  limit: args.limit,
                  where: args.where,
                },
              }),
            type: new GraphQLNonNull(
              new GraphQLList(new GraphQLNonNull(OboeRecordType))
            ),
          },
        ],
        [
          `${slug}ById`,
          {
            args: {
              id: {
                type: new GraphQLNonNull(GraphQLID),
              },
            },
            resolve: async (_root: unknown, args: { id: string }) =>
              runtime.findById({
                collection: slug,
                id: args.id,
              }),
            type: OboeRecordType,
          },
        ],
      ];
    })
  );

  const mutationFields = Object.fromEntries(
    [...runtime.schema.collections.keys()].flatMap((slug) => {
      const pascal = toPascalCase(slug);

      return [
        [
          `create${pascal}`,
          {
            args: {
              data: {
                type: new GraphQLNonNull(JsonScalar),
              },
            },
            resolve: async (
              _root: unknown,
              args: { data: Record<string, unknown> }
            ) =>
              runtime.create({
                collection: slug,
                data: args.data,
              }),
            type: new GraphQLNonNull(OboeRecordType),
          },
        ],
        [
          `update${pascal}`,
          {
            args: {
              data: {
                type: new GraphQLNonNull(JsonScalar),
              },
              id: {
                type: new GraphQLNonNull(GraphQLID),
              },
            },
            resolve: async (
              _root: unknown,
              args: { data: Record<string, unknown>; id: string }
            ) =>
              runtime.update({
                collection: slug,
                data: args.data,
                id: args.id,
              }),
            type: OboeRecordType,
          },
        ],
        [
          `delete${pascal}`,
          {
            args: {
              id: {
                type: new GraphQLNonNull(GraphQLID),
              },
            },
            resolve: async (_root: unknown, args: { id: string }) =>
              runtime.delete({
                collection: slug,
                id: args.id,
              }),
            type: OboeRecordType,
          },
        ],
      ];
    })
  );

  const schema = new GraphQLSchema({
    mutation: new GraphQLObjectType({
      name: "Mutation",
      fields: mutationFields,
    }),
    query: new GraphQLObjectType({
      name: "Query",
      fields: queryFields,
    }),
  });

  const service: GraphQLService = {
    async execute({ query, variables }) {
      return graphql({
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
