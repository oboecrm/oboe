import {
  AdminDashboard,
  CollectionListView,
  RecordCreateView,
  RecordDetailView,
} from "@oboe/admin-next";
import type { FieldConfig } from "@oboe/core";
import {
  FORM_BUILDER_VIEW_KEY,
  getFormBuilderMetadata,
  normalizeBuilderPayload,
} from "@oboe/plugin-form-builder";
import { notFound, redirect } from "next/navigation";

import { resolveAdminComponent } from "../../../lib/admin-components";
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
    const selectedView = Array.isArray(searchParams.view)
      ? searchParams.view[0]
      : searchParams.view;
    const customView = selectedView
      ? collection.admin?.views?.[selectedView]
      : undefined;
    const builderView = collection.admin?.views?.[FORM_BUILDER_VIEW_KEY];
    const builderMetadata = getFormBuilderMetadata(collection);

    if (selectedView && !customView && selectedView !== FORM_BUILDER_VIEW_KEY) {
      notFound();
    }

    if (segments[1] === "new") {
      if (
        builderView &&
        builderMetadata &&
        (!selectedView || selectedView === FORM_BUILDER_VIEW_KEY)
      ) {
        const BuilderComponent = await resolveAdminComponent(
          builderView.component
        );
        const createForm = async (formData: FormData) => {
          "use server";

          const payload = formData.get("payload");
          if (typeof payload !== "string") {
            throw new Error("Missing form builder payload.");
          }

          const { runtime } = await getStudioRuntime();
          const runtimeCollection = runtime.schema.collections.get(
            collection.slug
          );

          if (!runtimeCollection) {
            throw new Error(`Unknown collection "${collection.slug}".`);
          }

          const doc = await runtime.create({
            collection: runtimeCollection.slug,
            data: normalizeBuilderPayload(
              payload,
              builderMetadata.allowedFieldTypes
            ) as unknown as Record<string, unknown>,
            overrideAccess: true,
          });

          redirect(
            `/admin/${runtimeCollection.slug}/${doc.id}?view=${FORM_BUILDER_VIEW_KEY}`
          );
        };

        return (
          <BuilderComponent
            basePath="/admin"
            collection={collection}
            formAction={createForm}
            metadata={builderMetadata}
          />
        );
      }

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
          overrideAccess: true,
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
        overrideAccess: true,
      });
      if (!doc) {
        notFound();
      }

      if (customView) {
        const CustomViewComponent = await resolveAdminComponent(
          customView.component
        );
        const updateForm =
          selectedView === FORM_BUILDER_VIEW_KEY && builderMetadata
            ? async (formData: FormData) => {
                "use server";

                const payload = formData.get("payload");
                if (typeof payload !== "string") {
                  throw new Error("Missing form builder payload.");
                }

                const { runtime } = await getStudioRuntime();
                await runtime.update({
                  collection: collection.slug,
                  data: normalizeBuilderPayload(
                    payload,
                    builderMetadata.allowedFieldTypes
                  ) as unknown as Partial<Record<string, unknown>>,
                  id: doc.id,
                  overrideAccess: true,
                });

                redirect(
                  `/admin/${collection.slug}/${doc.id}?view=${FORM_BUILDER_VIEW_KEY}`
                );
              }
            : undefined;

        return (
          <CustomViewComponent
            basePath="/admin"
            collection={collection}
            doc={doc}
            formAction={updateForm}
            metadata={builderMetadata}
          />
        );
      }

      return (
        <RecordDetailView basePath="/admin" collection={collection} doc={doc} />
      );
    }

    const result = await runtime.find({
      collection: collection.slug,
      overrideAccess: true,
    });

    if (customView) {
      if (selectedView === FORM_BUILDER_VIEW_KEY && builderMetadata) {
        redirect(`/admin/${collection.slug}/new`);
      }

      const CustomViewComponent = await resolveAdminComponent(
        customView.component
      );

      return (
        <main style={{ padding: "32px" }}>
          <CustomViewComponent
            basePath="/admin"
            collection={collection}
            docs={result.docs}
            metadata={builderMetadata}
          />
        </main>
      );
    }

    return (
      <CollectionListView
        basePath="/admin"
        collection={collection}
        docs={result.docs}
      />
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown studio boot error";
    return <SetupError message={message} />;
  }
}
