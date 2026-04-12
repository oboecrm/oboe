import type { OboeRuntime } from "@oboe/core";
import { titleForCollection } from "./shared.js";
import { mutedStyle, panelStyle, shellStyle } from "./styles.js";

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
