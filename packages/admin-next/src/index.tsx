import type {
  CompiledCollection,
  FieldConfig,
  OboeDocument,
  OboeRuntime,
} from "@oboe/core";
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

const fieldInputStyle: React.CSSProperties = {
  border: "1px solid rgba(16, 36, 24, 0.16)",
  borderRadius: "12px",
  font: "inherit",
  minHeight: "44px",
  padding: "10px 12px",
  width: "100%",
};

const fieldLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: "8px",
};

const submitButtonStyle: React.CSSProperties = {
  background: "#102418",
  border: 0,
  borderRadius: "999px",
  color: "#eff5ef",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  padding: "12px 18px",
};

function titleForCollection(collection: CompiledCollection) {
  return collection.labels?.plural ?? collection.slug;
}

function fieldLabel(field: FieldConfig) {
  return field.label ?? field.name;
}

function isRelationshipField(field: FieldConfig) {
  return field.type === "relation" || field.type === "relationship";
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

function renderDetailValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return (
      <pre
        style={{
          margin: 0,
          overflowX: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return formatValue(value);
}

function renderCreateField(field: FieldConfig) {
  if (field.type === "boolean") {
    return (
      <label
        key={field.name}
        style={{
          alignItems: "center",
          display: "flex",
          gap: "12px",
        }}
      >
        <input
          name={field.name}
          style={{ height: 18, width: 18 }}
          type="checkbox"
          value="true"
        />
        <span>{fieldLabel(field)}</span>
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label key={field.name} style={fieldLabelStyle}>
        <span>
          {fieldLabel(field)}
          {field.required ? " *" : ""}
        </span>
        <textarea
          name={field.name}
          required={field.required}
          rows={5}
          style={{ ...fieldInputStyle, resize: "vertical" }}
        />
      </label>
    );
  }

  if (field.type === "json") {
    return (
      <label key={field.name} style={fieldLabelStyle}>
        <span>
          {fieldLabel(field)}
          {field.required ? " *" : ""}
        </span>
        <textarea
          name={field.name}
          placeholder='{\n  "key": "value"\n}'
          required={field.required}
          rows={8}
          style={{
            ...fieldInputStyle,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            resize: "vertical",
          }}
        />
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label key={field.name} style={fieldLabelStyle}>
        <span>
          {fieldLabel(field)}
          {field.required ? " *" : ""}
        </span>
        <select
          defaultValue=""
          name={field.name}
          required={field.required}
          style={fieldInputStyle}
        >
          <option value="">Select an option</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const inputType =
    field.type === "email"
      ? "email"
      : field.type === "number"
        ? "number"
        : field.type === "date"
          ? "date"
          : "text";
  const placeholder =
    isRelationshipField(field) && field.relationTo
      ? `${field.relationTo} id`
      : undefined;

  return (
    <label key={field.name} style={fieldLabelStyle}>
      <span>
        {fieldLabel(field)}
        {field.required ? " *" : ""}
      </span>
      <input
        name={field.name}
        placeholder={placeholder}
        required={field.required}
        style={fieldInputStyle}
        type={inputType}
      />
    </label>
  );
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
  docs: OboeDocument[];
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
          {getCollectionViewLinks(props.collection, {
            basePath,
          }).map((view) => (
            <a href={view.href} key={view.key}>
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
                  <td key={column}>{formatValue(doc[column])}</td>
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
  basePath?: string;
  collection: CompiledCollection;
  doc: OboeDocument;
}) {
  const basePath = props.basePath ?? "/admin";

  return (
    <div style={shellStyle}>
      <div style={panelStyle}>
        <p style={{ ...mutedStyle, marginTop: 0 }}>
          {props.collection.slug} record
        </p>
        <h1 style={{ marginTop: 0 }}>
          {String(
            props.doc[props.collection.admin?.titleField ?? "id"] ??
              props.doc.id
          )}
        </h1>

        <div
          style={{
            display: "flex",
            gap: "12px",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          {getCollectionViewLinks(props.collection, {
            basePath,
            docId: props.doc.id,
          }).map((view) => (
            <a href={view.href} key={view.key}>
              {view.label}
            </a>
          ))}
        </div>

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
              <dd>{renderDetailValue(props.doc[field.name])}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function RecordCreateView(props: {
  collection: CompiledCollection;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div style={shellStyle}>
      <div style={panelStyle}>
        <p style={{ ...mutedStyle, marginTop: 0 }}>Generated create view</p>
        <h1 style={{ marginTop: 0 }}>
          Create {props.collection.labels?.singular ?? props.collection.slug}
        </h1>
        <p style={mutedStyle}>
          Generated inputs are based on the collection field config. Replace
          this screen with a custom admin form when the workflow needs more than
          CRUD scaffolding.
        </p>
        <form
          action={props.formAction}
          style={{
            display: "grid",
            gap: "16px",
          }}
        >
          {props.collection.fields.map(renderCreateField)}
          <div style={{ display: "flex", gap: "12px" }}>
            <button style={submitButtonStyle} type="submit">
              Create record
            </button>
            <a
              href={`/api/${props.collection.slug}`}
              style={{ ...mutedStyle, alignSelf: "center" }}
            >
              API endpoint
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}

export function PipelineView(props: {
  docs: OboeDocument[];
  stageField?: string;
}) {
  const stageField = props.stageField ?? "stage";
  const groups = new Map<string, OboeDocument[]>();

  for (const doc of props.docs) {
    const stage = String(doc[stageField] ?? "unassigned");
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
              <strong>{String(doc.name ?? doc.id)}</strong>
              <div style={mutedStyle}>{String(doc.owner ?? "Unassigned")}</div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

export function TimelineView(props: { docs: OboeDocument[] }) {
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
          <strong>{String(doc.type ?? "activity")}</strong>
          <div style={mutedStyle}>
            {new Date(doc.updatedAt).toLocaleString()}
          </div>
          <p>{String(doc.summary ?? doc.name ?? "")}</p>
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

function getCollectionViewLinksWithOptions(
  collection: CompiledCollection,
  options: {
    basePath?: string;
    docId?: string;
  }
) {
  const basePath = options.basePath ?? "/admin";
  const hrefBase = options.docId
    ? `${basePath}/${collection.slug}/${options.docId}`
    : `${basePath}/${collection.slug}`;

  return Object.entries(collection.admin?.views ?? {})
    .filter(([, view]) => options.docId || view.path !== "/builder")
    .map(([key, view]) => ({
      href: `${hrefBase}?view=${key}`,
      key,
      label: view.label,
      path: view.path,
    }));
}

export function getCollectionViewLinks(
  collection: CompiledCollection,
  options?: {
    basePath?: string;
    docId?: string;
  }
) {
  return getCollectionViewLinksWithOptions(collection, options ?? {});
}
