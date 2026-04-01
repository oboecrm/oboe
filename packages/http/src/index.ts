import type { CollectionQuery, OboeRuntime } from "@oboe/core";

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

function parseCollectionQuery(url: URL): CollectionQuery {
  const where = url.searchParams.get("where");
  const limit = url.searchParams.get("limit");

  return {
    limit: limit ? Number(limit) : undefined,
    where: where ? (JSON.parse(where) as Record<string, unknown>) : undefined,
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

  return async function handle(request: Request) {
    const url = new URL(request.url);
    const segments = normalizeSegments(url, basePath);
    const [first, second] = segments;

    if (first === "health") {
      return json({
        status: "ok",
      });
    }

    if (!first) {
      return json(
        {
          collections: [...options.runtime.schema.collections.keys()],
        },
        200
      );
    }

    if (request.method === "GET" && !second) {
      const docs = await options.runtime.find({
        collection: first,
        query: parseCollectionQuery(url),
        req: request,
      });
      return json({
        docs,
      });
    }

    if (request.method === "POST" && !second) {
      const body = (await request.json()) as Record<string, unknown>;
      const doc = await options.runtime.create({
        collection: first,
        data: body,
        req: request,
      });
      return json(doc, 201);
    }

    if (request.method === "GET" && second) {
      const doc = await options.runtime.findById({
        collection: first,
        id: second,
        req: request,
      });

      return doc ? json(doc) : json({ error: "Not found" }, 404);
    }

    if ((request.method === "PATCH" || request.method === "PUT") && second) {
      const body = (await request.json()) as Record<string, unknown>;
      const doc = await options.runtime.update({
        collection: first,
        data: body,
        id: second,
        req: request,
      });

      return doc ? json(doc) : json({ error: "Not found" }, 404);
    }

    if (request.method === "DELETE" && second) {
      const doc = await options.runtime.delete({
        collection: first,
        id: second,
        req: request,
      });

      return doc ? json(doc) : json({ error: "Not found" }, 404);
    }

    return json(
      {
        error: "Unsupported route",
      },
      404
    );
  };
}
