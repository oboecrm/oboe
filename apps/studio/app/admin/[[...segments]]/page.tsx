import {
  AdminDashboard,
  CollectionListView,
  RecordCreateView,
  RecordDetailView,
} from "@oboe/admin-next";
import { FORM_BUILDER_VIEW_KEY } from "@oboe/plugin-form-builder";
import { notFound, redirect } from "next/navigation";

import {
  createBuilderRecord,
  createGeneratedRecord,
  findAdminRecord,
  findAdminRecords,
  updateBuilderRecord,
} from "../../../lib/admin/record-actions";
import { resolveCollectionAdminView } from "../../../lib/admin/views";
import { resolveAdminComponent } from "../../../lib/admin-components";
import { getStudioRuntime } from "../../../lib/runtime";

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
    const { builderMetadata, builderView, customView, selectedView } =
      resolveCollectionAdminView(collection, searchParams);

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

          redirect(
            await createBuilderRecord({
              collection,
              metadata: builderMetadata,
              payload,
            })
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

        redirect(
          await createGeneratedRecord({
            collection,
            formData,
          })
        );
      };

      return (
        <RecordCreateView collection={collection} formAction={createRecord} />
      );
    }

    if (segments[1]) {
      const doc = await findAdminRecord({
        collectionSlug: collection.slug,
        id: segments[1],
        runtime,
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

                redirect(
                  await updateBuilderRecord({
                    collectionSlug: collection.slug,
                    docId: doc.id,
                    metadata: builderMetadata,
                    payload,
                  })
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

    const result = await findAdminRecords({
      collectionSlug: collection.slug,
      runtime,
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
