import type { CompiledCollection } from "@oboe/core";
import { renderCreateField } from "./shared.js";
import {
  mutedStyle,
  panelStyle,
  shellStyle,
  submitButtonStyle,
} from "./styles.js";

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
