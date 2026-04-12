import type { OboeDocument } from "@oboe/core";

import { mutedStyle, panelStyle } from "./styles.js";

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
