import {
  type CollectionQuery,
  type CompiledCollection,
  type FieldConfig,
  type OboeRuntime,
  OboeValidationError,
} from "@oboe/core";

export interface HttpHandlerOptions {
  basePath?: string;
  runtime: OboeRuntime;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}

function html(markup: string, status = 200) {
  return new Response(markup, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
    status,
  });
}

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

function parseBoolean(value: string | null) {
  if (value === null) {
    return undefined;
  }

  return value === "true";
}

function parseJsonParameter<TValue>(value: string | null): TValue | undefined {
  if (!value) {
    return undefined;
  }

  return JSON.parse(value) as TValue;
}

function parseSort(url: URL) {
  const direct = url.searchParams.get("sort");
  const arrayEntries = [...url.searchParams.entries()]
    .filter(([key]) => /^sort\[\d+\]$/.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);

  if (arrayEntries.length > 0) {
    return arrayEntries;
  }

  return direct ?? undefined;
}

function parseCollectionQuery(url: URL): CollectionQuery {
  const limit = url.searchParams.get("limit");
  const page = url.searchParams.get("page");
  const depth = url.searchParams.get("depth");

  return {
    depth: depth ? Number(depth) : undefined,
    limit: limit ? Number(limit) : undefined,
    page: page ? Number(page) : undefined,
    pagination: parseBoolean(url.searchParams.get("pagination")),
    select: parseJsonParameter(url.searchParams.get("select")),
    sort: parseSort(url),
    where: parseJsonParameter(url.searchParams.get("where")),
  };
}

function normalizeSegments(url: URL, basePath: string) {
  const path = url.pathname.startsWith(basePath)
    ? url.pathname.slice(basePath.length)
    : url.pathname;

  return path.split("/").filter(Boolean);
}

export function createHttpHandler(options: HttpHandlerOptions) {
  const basePath = options.basePath ?? "/api";
  const openApiDocument = () => createOpenAPIDocument(options.runtime);

  return async function handle(request: Request) {
    try {
      const url = new URL(request.url);
      const segments = normalizeSegments(url, basePath);
      const [first, second] = segments;
      const query = parseCollectionQuery(url);

      if (first === "health") {
        return json({
          status: "ok",
        });
      }

      if (first === "openapi.json") {
        return json(openApiDocument());
      }

      if (first === "docs") {
        return html(createSwaggerHtml(`${basePath}/openapi.json`));
      }

      if (first === "functions" && second) {
        const body =
          request.method === "GET" || request.method === "DELETE"
            ? {}
            : ((await request.json()) as Record<string, unknown>);

        return json(
          await options.runtime.callServerFunction({
            input: body,
            name: second,
            req: request,
          })
        );
      }

      const customServerFunction = Object.entries(
        options.runtime.config.serverFunctions ?? {}
      ).find(([, definition]) => {
        if (!definition.rest?.path) {
          return false;
        }

        return (
          definition.rest.path === url.pathname &&
          (definition.rest.method ?? "POST") === request.method
        );
      });

      if (customServerFunction) {
        const [name] = customServerFunction;
        const body =
          request.method === "GET" || request.method === "DELETE"
            ? {}
            : ((await request.json()) as Record<string, unknown>);

        return json(
          await options.runtime.callServerFunction({
            input: body,
            name,
            req: request,
          })
        );
      }

      if (!first) {
        return json(
          {
            collections: [...options.runtime.schema.collections.keys()],
          },
          200
        );
      }

      if (request.method === "GET" && second === "count") {
        return json(
          await options.runtime.count({
            collection: first,
            query: {
              where: query.where,
            },
            req: request,
          })
        );
      }

      if (request.method === "GET" && !second) {
        return json(
          await options.runtime.find({
            collection: first,
            query,
            req: request,
          })
        );
      }

      if (request.method === "POST" && !second) {
        const body = (await request.json()) as Record<string, unknown>;
        const doc = await options.runtime.create({
          collection: first,
          data: body,
          depth: query.depth,
          req: request,
          select: query.select,
        });
        return json(doc, 201);
      }

      if (request.method === "GET" && second) {
        const doc = await options.runtime.findById({
          collection: first,
          depth: query.depth,
          id: second,
          req: request,
          select: query.select,
        });

        return doc ? json(doc) : json({ error: "Not found" }, 404);
      }

      if ((request.method === "PATCH" || request.method === "PUT") && second) {
        const body = (await request.json()) as Record<string, unknown>;
        const doc = await options.runtime.update({
          collection: first,
          data: body,
          depth: query.depth,
          id: second,
          req: request,
          select: query.select,
        });

        return doc ? json(doc) : json({ error: "Not found" }, 404);
      }

      if (request.method === "DELETE" && second) {
        const doc = await options.runtime.delete({
          collection: first,
          depth: query.depth,
          id: second,
          req: request,
          select: query.select,
        });

        return doc ? json(doc) : json({ error: "Not found" }, 404);
      }

      return json(
        {
          error: "Unsupported route",
        },
        404
      );
    } catch (error) {
      if (error instanceof OboeValidationError) {
        return json(
          {
            error: error.message,
            issues: error.issues,
          },
          400
        );
      }

      if (error instanceof Error && error.message.startsWith("Access denied")) {
        return json(
          {
            error: error.message,
          },
          403
        );
      }

      throw error;
    }
  };
}
