import {
  ActivityComposer,
  AdminDashboard,
  CollectionListView,
  PipelineView,
  RecordCreateView,
  RecordDetailView,
  TimelineView,
} from "@oboe/admin-next";
import type { FieldConfig } from "@oboe/core";
import { notFound, redirect } from "next/navigation";

import { getStudioRuntime } from "../../../lib/runtime";

function parseFieldValue(field: FieldConfig, formData: FormData) {
  if (field.type === "boolean") {
    return formData.get(field.name) === "true";
  }

  const rawValue = formData.get(field.name);
  if (typeof rawValue !== "string") {
    return undefined;
  }

  const value = rawValue.trim();
  if (!value) {
    return undefined;
  }

  if (field.type === "number") {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return undefined;
    }

    return parsed;
  }

  if (field.type === "json") {
    return JSON.parse(value) as unknown;
  }

  return value;
}

function SetupError(props: { message: string }) {
  return (
    <main
      style={{
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        padding: "32px",
      }}
    >
      <h1>Studio not configured</h1>
      <p>{props.message}</p>
      <p>Set `DATABASE_URL` to boot the Postgres adapter.</p>
    </main>
  );
}

export default async function AdminPage(props: {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const [{ segments = [] }, searchParams, { runtime }] = await Promise.all([
      props.params,
      props.searchParams,
      getStudioRuntime(),
    ]);

    if (segments.length === 0) {
      return <AdminDashboard runtime={runtime} />;
    }

    const collection = runtime.schema.collections.get(segments[0] ?? "");
    if (!collection) {
      notFound();
    }

    if (segments[1] === "new") {
      const createRecord = async (formData: FormData) => {
        "use server";

        const { runtime } = await getStudioRuntime();
        const runtimeCollection = runtime.schema.collections.get(
          collection.slug
        );

        if (!runtimeCollection) {
          throw new Error(`Unknown collection "${collection.slug}".`);
        }

        const data = Object.fromEntries(
          runtimeCollection.fields.flatMap((field) => {
            const value = parseFieldValue(field, formData);

            return value === undefined ? [] : [[field.name, value]];
          })
        );
        const doc = await runtime.create({
          collection: runtimeCollection.slug,
          data,
        });

        redirect(`/admin/${runtimeCollection.slug}/${doc.id}`);
      };

      return (
        <RecordCreateView collection={collection} formAction={createRecord} />
      );
    }

    if (segments[1]) {
      const doc = await runtime.findById({
        collection: collection.slug,
        id: segments[1],
      });
      if (!doc) {
        notFound();
      }

      return <RecordDetailView collection={collection} doc={doc} />;
    }

    const docs = await runtime.find({
      collection: collection.slug,
    });
    const selectedView = Array.isArray(searchParams.view)
      ? searchParams.view[0]
      : searchParams.view;

    if (selectedView === "pipeline") {
      return (
        <main style={{ padding: "32px" }}>
          <PipelineView docs={docs} />
        </main>
      );
    }

    if (selectedView === "timeline") {
      return (
        <main style={{ padding: "32px" }}>
          <TimelineView docs={docs} />
        </main>
      );
    }

    if (selectedView === "composer") {
      return (
        <main style={{ padding: "32px" }}>
          <ActivityComposer />
        </main>
      );
    }

    return <CollectionListView collection={collection} docs={docs} />;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown studio boot error";
    return <SetupError message={message} />;
  }
}
