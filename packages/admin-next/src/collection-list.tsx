import type { CompiledCollection, OboeDocument } from "@oboe/core";
import { formatValue, titleForCollection } from "./shared.js";
import { mutedStyle, panelStyle, shellStyle } from "./styles.js";
import { getCollectionViewLinks } from "./view-links.js";

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
