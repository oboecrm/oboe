import type { OboeDocument } from "@oboe/core";

import { mutedStyle, panelStyle } from "./styles.js";

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
