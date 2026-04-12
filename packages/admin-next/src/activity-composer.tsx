import { mutedStyle, panelStyle } from "./styles.js";

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
