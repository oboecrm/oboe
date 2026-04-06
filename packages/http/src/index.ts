import {
  type CollectionQuery,
  type OboeRuntime,
  OboeValidationError,
} from "@oboe/core";

import { createOpenAPIDocument, createSwaggerHtml } from "./openapi.js";

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

export { createOpenAPIDocument, createSwaggerHtml };

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
