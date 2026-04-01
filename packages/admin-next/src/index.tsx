import type { CompiledCollection, OboeRecord, OboeRuntime } from "@oboe/core";
import React from "react";

const shellStyle: React.CSSProperties = {
  background:
    "radial-gradient(circle at top left, rgba(218, 240, 229, 0.9), rgba(242, 238, 226, 0.95) 45%, rgba(255, 255, 255, 1) 100%)",
  color: "#102418",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  minHeight: "100vh",
  padding: "32px",
};

const panelStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.88)",
  border: "1px solid rgba(16, 36, 24, 0.08)",
  borderRadius: "20px",
  boxShadow: "0 18px 48px rgba(16, 36, 24, 0.08)",
  padding: "24px",
};

const mutedStyle: React.CSSProperties = {
  color: "#476452",
};

function titleForCollection(collection: CompiledCollection) {
  return collection.labels?.plural ?? collection.slug;
}

export function AdminDashboard(props: { runtime: OboeRuntime }) {
  return (
    <div style={shellStyle}>
      <div style={panelStyle}>
        <p style={{ ...mutedStyle, marginTop: 0 }}>OboeCRM Studio</p>
        <h1
          style={{ fontSize: "2.4rem", marginBottom: "0.5rem", marginTop: 0 }}
        >
          Code-first CRM shell
        </h1>
        <p style={{ ...mutedStyle, marginBottom: "2rem", maxWidth: 760 }}>
          Generated CRUD is the default surface. Custom CRM views, workflow
          hooks, and delivery adapters layer on top of the same runtime.
        </p>

        <div
          style={{
            display: "grid",
            gap: "16px",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {[...props.runtime.schema.collections.values()].map((collection) => (
            <a
              href={`/admin/${collection.slug}`}
              key={collection.slug}
              style={{
                ...panelStyle,
                color: "inherit",
                padding: "20px",
                textDecoration: "none",
              }}
            >
              <strong style={{ display: "block", fontSize: "1.1rem" }}>
                {titleForCollection(collection)}
              </strong>
              <span style={mutedStyle}>Module: {collection.moduleSlug}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CollectionListView(props: {
  basePath?: string;
  collection: CompiledCollection;
  docs: OboeRecord[];
}) {
  const basePath = props.basePath ?? "/admin";
  const columns = props.collection.admin?.defaultColumns?.length
    ? props.collection.admin.defaultColumns
    : props.collection.fields.slice(0, 4).map((field) => field.name);

  return (
    <div style={shellStyle}>
      <div style={panelStyle}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <p style={{ ...mutedStyle, marginBottom: "0.25rem", marginTop: 0 }}>
              Generated collection view
            </p>
            <h1 style={{ margin: 0 }}>
              {titleForCollection(props.collection)}
            </h1>
          </div>

          <a href={`${basePath}/${props.collection.slug}/new`}>Create record</a>
        </div>

        <div
          style={{
            display: "flex",
            gap: "12px",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          {getCollectionViewLinks(props.collection).map((view) => (
            <a
              href={`${basePath}/${props.collection.slug}?view=${view.key}`}
              key={view.key}
            >
              {view.label}
            </a>
          ))}
        </div>

        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th align="left">id</th>
              {columns.map((column) => (
                <th align="left" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.docs.map((doc) => (
              <tr key={doc.id}>
                <td style={{ padding: "12px 0" }}>
                  <a href={`${basePath}/${props.collection.slug}/${doc.id}`}>
                    {doc.id}
                  </a>
                </td>
                {columns.map((column) => (
                  <td key={column}>{String(doc.data[column] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RecordDetailView(props: {
  collection: CompiledCollection;
  doc: OboeRecord;
}) {
  return (
    <div style={shellStyle}>
      <div style={panelStyle}>
        <p style={{ ...mutedStyle, marginTop: 0 }}>
          {props.collection.slug} record
        </p>
        <h1 style={{ marginTop: 0 }}>
          {String(
            props.doc.data[props.collection.admin?.titleField ?? "id"] ??
              props.doc.id
          )}
        </h1>

        <dl
          style={{
            display: "grid",
            gap: "12px",
            gridTemplateColumns: "max-content 1fr",
          }}
        >
          <dt>id</dt>
          <dd>{props.doc.id}</dd>
          {props.collection.fields.map((field) => (
            <React.Fragment key={field.name}>
              <dt>{field.label ?? field.name}</dt>
              <dd>{String(props.doc.data[field.name] ?? "")}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function RecordCreateView(props: { collection: CompiledCollection }) {
  return (
    <div style={shellStyle}>
      <div style={panelStyle}>
        <p style={{ ...mutedStyle, marginTop: 0 }}>Generated create view</p>
        <h1 style={{ marginTop: 0 }}>
          Create {props.collection.labels?.singular ?? props.collection.slug}
        </h1>
        <p style={mutedStyle}>
          POST JSON to <code>/api/{props.collection.slug}</code> or replace this
          screen with a custom admin form.
        </p>
        <pre
          style={{
            background: "#102418",
            borderRadius: "16px",
            color: "#eff5ef",
            overflowX: "auto",
            padding: "16px",
          }}
        >
          {JSON.stringify(
            Object.fromEntries(
              props.collection.fields.map((field) => [
                field.name,
                `<${field.type}>`,
              ])
            ),
            null,
            2
          )}
        </pre>
      </div>
    </div>
  );
}

export function PipelineView(props: {
  docs: OboeRecord[];
  stageField?: string;
}) {
  const stageField = props.stageField ?? "stage";
  const groups = new Map<string, OboeRecord[]>();

  for (const doc of props.docs) {
    const stage = String(doc.data[stageField] ?? "unassigned");
    const bucket = groups.get(stage) ?? [];
    bucket.push(doc);
    groups.set(stage, bucket);
  }

  return (
    <div
      style={{
        display: "grid",
        gap: "16px",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      }}
    >
      {[...groups.entries()].map(([stage, docs]) => (
        <section key={stage} style={panelStyle}>
          <h2 style={{ marginTop: 0 }}>{stage}</h2>
          {docs.map((doc) => (
            <article
              key={doc.id}
              style={{
                borderTop: "1px solid rgba(16, 36, 24, 0.08)",
                paddingTop: "12px",
              }}
            >
              <strong>{String(doc.data.name ?? doc.id)}</strong>
              <div style={mutedStyle}>
                {String(doc.data.owner ?? "Unassigned")}
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

export function TimelineView(props: { docs: OboeRecord[] }) {
  return (
    <div style={panelStyle}>
      <h2 style={{ marginTop: 0 }}>Timeline</h2>
      {props.docs.map((doc) => (
        <article
          key={doc.id}
          style={{
            borderTop: "1px solid rgba(16, 36, 24, 0.08)",
            paddingTop: "12px",
          }}
        >
          <strong>{String(doc.data.type ?? "activity")}</strong>
          <div style={mutedStyle}>
            {new Date(doc.updatedAt).toLocaleString()}
          </div>
          <p>{String(doc.data.summary ?? doc.data.name ?? "")}</p>
        </article>
      ))}
    </div>
  );
}

export function ActivityComposer() {
  return (
    <div style={panelStyle}>
      <h2 style={{ marginTop: 0 }}>Activity composer</h2>
      <p style={mutedStyle}>
        Replace this slot with a custom component to log calls, notes, or
        follow-ups from the generated admin shell.
      </p>
    </div>
  );
}

export function getCollectionViewLinks(collection: CompiledCollection) {
  return Object.entries(collection.admin?.views ?? {}).map(([key, view]) => ({
    key,
    label: view.label,
    path: view.path,
  }));
}
