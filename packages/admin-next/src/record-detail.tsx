import type { CompiledCollection, OboeDocument } from "@oboe/core";
import React from "react";
import { renderDetailValue } from "./shared.js";
import { mutedStyle, panelStyle, shellStyle } from "./styles.js";
import { getCollectionViewLinks } from "./view-links.js";

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
