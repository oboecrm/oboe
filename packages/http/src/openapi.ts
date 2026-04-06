import type { CompiledCollection, FieldConfig, OboeRuntime } from "@oboe/core";

function schemaForField(field: FieldConfig) {
  switch (field.type) {
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { format: "date-time", type: "string" };
    case "email":
      return { format: "email", type: "string" };
    case "json":
      return {};
    case "number":
      return { type: "number" };
    case "relation":
    case "relationship":
      return field.relationTo
        ? {
            oneOf: [
              { type: "string" },
              { $ref: `#/components/schemas/${field.relationTo}Document` },
            ],
          }
        : { type: "string" };
    case "select":
      return field.options?.length
        ? {
            enum: field.options.map((option) => option.value),
            type: "string",
          }
        : { type: "string" };
    default:
      return { type: "string" };
  }
}

function documentSchema(collection: CompiledCollection) {
  return {
    additionalProperties: false,
    properties: {
      createdAt: { format: "date-time", type: "string" },
      id: { type: "string" },
      updatedAt: { format: "date-time", type: "string" },
      ...Object.fromEntries(
        collection.fields.map((field) => [field.name, schemaForField(field)])
      ),
    },
    required: ["id", "createdAt", "updatedAt"],
    type: "object",
  };
}

function requestSchema(collection: CompiledCollection, partial = false) {
  const required = partial
    ? []
    : collection.fields
        .filter((field) => field.required)
        .map((field) => field.name);

  return {
    additionalProperties: false,
    properties: Object.fromEntries(
      collection.fields.map((field) => {
        const schema =
          field.type === "relation" || field.type === "relationship"
            ? { type: "string" }
            : schemaForField(field);
        return [field.name, schema];
      })
    ),
    required,
    type: "object",
  };
}

function paginatedSchema(collection: CompiledCollection) {
  return {
    additionalProperties: false,
    properties: {
      docs: {
        items: {
          $ref: `#/components/schemas/${collection.slug}Document`,
        },
        type: "array",
      },
      hasNextPage: { type: "boolean" },
      hasPrevPage: { type: "boolean" },
      limit: { type: "integer" },
      nextPage: { nullable: true, type: "integer" },
      page: { type: "integer" },
      pagingCounter: { type: "integer" },
      prevPage: { nullable: true, type: "integer" },
      totalDocs: { type: "integer" },
      totalPages: { type: "integer" },
    },
    required: [
      "docs",
      "totalDocs",
      "limit",
      "totalPages",
      "page",
      "pagingCounter",
      "hasPrevPage",
      "hasNextPage",
      "prevPage",
      "nextPage",
    ],
    type: "object",
  };
}

function queryParameters() {
  return [
    {
      in: "query",
      name: "where",
      schema: { type: "string" },
    },
    {
      in: "query",
      name: "sort",
      schema: { type: "string" },
    },
    {
      in: "query",
      name: "page",
      schema: { minimum: 1, type: "integer" },
    },
    {
      in: "query",
      name: "limit",
      schema: { minimum: 1, type: "integer" },
    },
    {
      in: "query",
      name: "pagination",
      schema: { type: "boolean" },
    },
    {
      in: "query",
      name: "depth",
      schema: { minimum: 0, type: "integer" },
    },
    {
      in: "query",
      name: "select",
      schema: { type: "string" },
    },
  ];
}

export function createOpenAPIDocument(runtime: OboeRuntime) {
  const components = {
    schemas: {
      CountResult: {
        additionalProperties: false,
        properties: {
          totalDocs: { type: "integer" },
        },
        required: ["totalDocs"],
        type: "object",
      },
      ErrorResponse: {
        additionalProperties: false,
        properties: {
          error: { type: "string" },
          issues: {
            items: {
              additionalProperties: false,
              properties: {
                message: { type: "string" },
                path: {
                  items: {
                    oneOf: [{ type: "string" }, { type: "integer" }],
                  },
                  type: "array",
                },
              },
              required: ["message"],
              type: "object",
            },
            type: "array",
          },
        },
        required: ["error"],
        type: "object",
      },
    } as Record<string, unknown>,
  };

  const paths: Record<string, unknown> = {};

  for (const collection of runtime.schema.collections.values()) {
    components.schemas[`${collection.slug}Document`] =
      documentSchema(collection);
    components.schemas[`${collection.slug}ListResponse`] =
      paginatedSchema(collection);
    components.schemas[`${collection.slug}CreateRequest`] =
      requestSchema(collection);
    components.schemas[`${collection.slug}UpdateRequest`] = requestSchema(
      collection,
      true
    );

    paths[`/api/${collection.slug}`] = {
      get: {
        operationId: `list${collection.slug}`,
        parameters: queryParameters(),
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  $ref: `#/components/schemas/${collection.slug}ListResponse`,
                },
              },
            },
            description: "List documents",
          },
        },
      },
      post: {
        operationId: `create${collection.slug}`,
        parameters: queryParameters().filter((parameter) =>
          ["depth", "select"].includes(String(parameter.name))
        ),
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: `#/components/schemas/${collection.slug}CreateRequest`,
              },
            },
          },
        },
        responses: {
          "201": {
            content: {
              "application/json": {
                schema: {
                  $ref: `#/components/schemas/${collection.slug}Document`,
                },
              },
            },
            description: "Created document",
          },
        },
      },
    };

    paths[`/api/${collection.slug}/count`] = {
      get: {
        operationId: `count${collection.slug}`,
        parameters: [
          {
            in: "query",
            name: "where",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CountResult",
                },
              },
            },
            description: "Count documents",
          },
        },
      },
    };

    paths[`/api/${collection.slug}/{id}`] = {
      delete: {
        operationId: `delete${collection.slug}`,
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
          ...queryParameters().filter((parameter) =>
            ["depth", "select"].includes(String(parameter.name))
          ),
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  $ref: `#/components/schemas/${collection.slug}Document`,
                },
              },
            },
            description: "Deleted document",
          },
        },
      },
      get: {
        operationId: `get${collection.slug}`,
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
          ...queryParameters().filter((parameter) =>
            ["depth", "select"].includes(String(parameter.name))
          ),
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  $ref: `#/components/schemas/${collection.slug}Document`,
                },
              },
            },
            description: "Document by id",
          },
        },
      },
      patch: {
        operationId: `update${collection.slug}`,
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
          ...queryParameters().filter((parameter) =>
            ["depth", "select"].includes(String(parameter.name))
          ),
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: `#/components/schemas/${collection.slug}UpdateRequest`,
              },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  $ref: `#/components/schemas/${collection.slug}Document`,
                },
              },
            },
            description: "Updated document",
          },
        },
      },
    };
  }

  return {
    components,
    info: {
      title: "Oboe REST API",
      version: "0.1.0",
    },
    openapi: "3.1.0",
    paths,
  };
}

export function createSwaggerHtml(specUrl: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Oboe API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(specUrl)},
        dom_id: '#swagger-ui',
      });
    </script>
  </body>
</html>`;
}
