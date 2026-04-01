import { createEventBus } from "./events.js";
import { compileSchema, getCompiledCollection } from "./schema.js";
import type {
  DatabaseAdapter,
  EventBus,
  GraphQLExecutor,
  JobDispatcher,
  JobRequest,
  OboeConfig,
  OboeRecord,
  OboeRuntime,
} from "./types.js";

const noopGraphQLExecutor: GraphQLExecutor = {
  async execute() {
    throw new Error("GraphQL executor has not been attached to this runtime.");
  },
};

function createJobDispatcher(
  db: DatabaseAdapter,
  fallback: JobDispatcher
): JobDispatcher {
  return {
    async enqueue(job) {
      if (db.enqueueJob) {
        await db.enqueueJob(job);
        return;
      }

      await fallback.enqueue(job);
    },
  };
}

async function canAccess(args: {
  collectionSlug: string;
  config: OboeConfig;
  data?: Record<string, unknown>;
  id?: string;
  operation: "create" | "delete" | "read" | "update";
  overrideAccess?: boolean;
  req?: Request;
  user?: unknown;
}) {
  if (args.overrideAccess) {
    return true;
  }

  const collection = getCompiledCollection(
    compileSchema(args.config),
    args.collectionSlug
  );
  const resolver = collection.access?.[args.operation];

  if (!resolver) {
    return true;
  }

  return resolver({
    action: args.operation,
    collection,
    data: args.data,
    id: args.id,
    req: args.req,
    user: args.user,
  });
}

async function runAfterRead(args: {
  collectionSlug: string;
  config: OboeConfig;
  doc: OboeRecord;
  operation: "read";
  req?: Request;
  user?: unknown;
}) {
  const collection = getCompiledCollection(
    compileSchema(args.config),
    args.collectionSlug
  );
  let doc = args.doc;

  for (const hook of collection.hooks?.afterRead ?? []) {
    doc = await hook({
      context: {
        collection,
        operation: args.operation,
        req: args.req,
        user: args.user,
      },
      doc,
    });
  }

  return doc;
}

async function runBeforeChange(args: {
  collectionSlug: string;
  config: OboeConfig;
  data: Record<string, unknown>;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}) {
  const collection = getCompiledCollection(
    compileSchema(args.config),
    args.collectionSlug
  );
  let data = args.data;

  for (const hook of collection.hooks?.beforeChange ?? []) {
    data = await hook({
      context: {
        collection,
        operation: args.operation,
        req: args.req,
        user: args.user,
      },
      data,
      originalDoc: args.originalDoc,
    });
  }

  return data;
}

async function runAfterChange(args: {
  collectionSlug: string;
  config: OboeConfig;
  doc: OboeRecord;
  operation: "create" | "update";
  originalDoc?: OboeRecord | null;
  req?: Request;
  user?: unknown;
}) {
  const collection = getCompiledCollection(
    compileSchema(args.config),
    args.collectionSlug
  );
  let doc = args.doc;

  for (const hook of collection.hooks?.afterChange ?? []) {
    doc = await hook({
      context: {
        collection,
        operation: args.operation,
        req: args.req,
        user: args.user,
      },
      doc,
      originalDoc: args.originalDoc,
    });
  }

  return doc;
}

export function createOboeRuntime(args: {
  config: OboeConfig;
  db: DatabaseAdapter;
  events?: EventBus;
  jobs?: JobDispatcher;
}): OboeRuntime {
  const schema = compileSchema(args.config);
  const events = args.events ?? createEventBus();
  const fallbackJobs = args.jobs ?? {
    async enqueue(_job: JobRequest) {
      return;
    },
  };
  const jobs = createJobDispatcher(args.db, fallbackJobs);
  let graphql = noopGraphQLExecutor;

  return {
    auth: {
      collection() {
        return args.config.auth?.collection;
      },
    },
    config: args.config,
    async create({ collection, data, overrideAccess, req, user }) {
      const collectionConfig = getCompiledCollection(schema, collection);

      if (
        !(await canAccess({
          collectionSlug: collection,
          config: args.config,
          data,
          operation: "create",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(
          `Access denied for create on "${collectionConfig.slug}".`
        );
      }

      const nextData = await runBeforeChange({
        collectionSlug: collection,
        config: args.config,
        data,
        operation: "create",
        req,
        user,
      });
      const created = await args.db.create({
        collection,
        data: nextData,
      });
      const doc = await runAfterChange({
        collectionSlug: collection,
        config: args.config,
        doc: created,
        operation: "create",
        req,
        user,
      });

      await args.db.recordAudit?.({
        actor: user,
        at: new Date().toISOString(),
        collection,
        id: doc.id,
        operation: "create",
        payload: doc.data,
      });
      await events.emit(`${collection}.created`, {
        collection,
        id: doc.id,
      });

      return doc;
    },
    db: args.db,
    async delete({ collection, id, overrideAccess, req, user }) {
      if (
        !(await canAccess({
          collectionSlug: collection,
          config: args.config,
          id,
          operation: "delete",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for delete on "${collection}".`);
      }

      const doc = await args.db.delete({
        collection,
        id,
      });

      if (doc) {
        await args.db.recordAudit?.({
          actor: user,
          at: new Date().toISOString(),
          collection,
          id,
          operation: "delete",
          payload: doc.data,
        });
        await events.emit(`${collection}.deleted`, { collection, id });
      }

      return doc;
    },
    events,
    async find({ collection, overrideAccess, query, req, user }) {
      if (
        !(await canAccess({
          collectionSlug: collection,
          config: args.config,
          operation: "read",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for read on "${collection}".`);
      }

      const docs = await args.db.find({
        collection,
        query,
      });

      return Promise.all(
        docs.map((doc) =>
          runAfterRead({
            collectionSlug: collection,
            config: args.config,
            doc,
            operation: "read",
            req,
            user,
          })
        )
      );
    },
    async findById({ collection, id, overrideAccess, req, user }) {
      if (
        !(await canAccess({
          collectionSlug: collection,
          config: args.config,
          id,
          operation: "read",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for read on "${collection}".`);
      }

      const doc = await args.db.findById({
        collection,
        id,
      });

      if (!doc) {
        return null;
      }

      return runAfterRead({
        collectionSlug: collection,
        config: args.config,
        doc,
        operation: "read",
        req,
        user,
      });
    },
    graphql: graphql,
    async initialize() {
      await args.db.initialize?.(schema);
    },
    jobs,
    schema,
    setGraphQLExecutor(executor) {
      graphql = executor;
      this.graphql = graphql;
    },
    async update({ collection, data, id, overrideAccess, req, user }) {
      if (
        !(await canAccess({
          collectionSlug: collection,
          config: args.config,
          data,
          id,
          operation: "update",
          overrideAccess,
          req,
          user,
        }))
      ) {
        throw new Error(`Access denied for update on "${collection}".`);
      }

      const existing = await args.db.findById({ collection, id });
      const nextData = await runBeforeChange({
        collectionSlug: collection,
        config: args.config,
        data,
        operation: "update",
        originalDoc: existing,
        req,
        user,
      });
      const updated = await args.db.update({
        collection,
        data: nextData,
        id,
      });

      if (!updated) {
        return null;
      }

      const doc = await runAfterChange({
        collectionSlug: collection,
        config: args.config,
        doc: updated,
        operation: "update",
        originalDoc: existing,
        req,
        user,
      });

      await args.db.recordAudit?.({
        actor: user,
        at: new Date().toISOString(),
        collection,
        id,
        operation: "update",
        payload: doc.data,
      });
      await events.emit(`${collection}.updated`, {
        collection,
        id,
      });

      return doc;
    },
  };
}
