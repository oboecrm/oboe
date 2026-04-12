"use client";

import type { OboeDocument } from "@oboe/core";
import type React from "react";
import { useMemo, useState } from "react";

import type {
  FormBuilderDocumentData,
  FormBuilderViewProps,
  FormEmailDefinition,
  FormFieldDefinition,
  FormFieldOption,
  FormFieldType,
} from "./types.js";

const shellStyle: React.CSSProperties = {
  background:
    "radial-gradient(circle at top left, rgba(218, 240, 229, 0.9), rgba(242, 238, 226, 0.95) 45%, rgba(255, 255, 255, 1) 100%)",
  color: "#102418",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  minHeight: "100vh",
  padding: "32px",
};

const panelStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.92)",
  border: "1px solid rgba(16, 36, 24, 0.08)",
  borderRadius: "20px",
  boxShadow: "0 18px 48px rgba(16, 36, 24, 0.08)",
  padding: "24px",
};

const mutedStyle: React.CSSProperties = {
  color: "#476452",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid rgba(16, 36, 24, 0.16)",
  borderRadius: "12px",
  font: "inherit",
  minHeight: "44px",
  padding: "10px 12px",
  width: "100%",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "1.1rem",
  fontWeight: 700,
  margin: 0,
};

function defaultField(
  fieldType: FormFieldType,
  index: number
): FormFieldDefinition {
  const base = {
    label: `${fieldType[0]?.toUpperCase() ?? ""}${fieldType.slice(1)} ${index + 1}`,
    name: `${fieldType}_${index + 1}`,
    required: false,
    width: 100,
  };

  switch (fieldType) {
    case "checkbox":
      return {
        ...base,
        blockType: "checkbox",
        defaultValue: false,
      };
    case "date":
      return {
        ...base,
        blockType: "date",
      };
    case "email":
      return {
        ...base,
        blockType: "email",
        placeholder: "name@example.com",
      };
    case "message":
      return {
        ...base,
        blockType: "message",
        message: "Helpful instructions for the person filling out the form.",
        required: false,
      };
    case "number":
      return {
        ...base,
        blockType: "number",
      };
    case "radio":
      return {
        ...base,
        blockType: "radio",
        options: defaultOptions(),
      };
    case "select":
      return {
        ...base,
        blockType: "select",
        options: defaultOptions(),
      };
    case "textarea":
      return {
        ...base,
        blockType: "textarea",
        placeholder: "Tell us more",
      };
    case "text":
      return {
        ...base,
        blockType: "text",
        placeholder: "Type here",
      };
  }
}

function defaultOptions(): FormFieldOption[] {
  return [
    { label: "Option 1", value: "option-1" },
    { label: "Option 2", value: "option-2" },
  ];
}

function defaultEmail(index: number): FormEmailDefinition {
  return {
    message: "New submission received from {{email}}.",
    subject: `Notification ${index + 1}`,
  };
}

function optionKey(option: FormFieldOption) {
  return `${option.value}:${option.label}`;
}

function fieldKey(field: FormFieldDefinition) {
  return `${field.blockType}:${field.name}`;
}

function emailKey(email: FormEmailDefinition) {
  return `${email.subject}:${email.emailTo ?? email.emailFrom ?? "notification"}`;
}

function docToState(doc: OboeDocument | undefined): FormBuilderDocumentData {
  return {
    confirmationMessage:
      typeof doc?.confirmationMessage === "string"
        ? doc.confirmationMessage
        : "",
    confirmationType:
      doc?.confirmationType === "redirect" ? "redirect" : "message",
    emails: Array.isArray(doc?.emails)
      ? (doc.emails as FormEmailDefinition[])
      : [],
    fields: Array.isArray(doc?.fields)
      ? (doc.fields as FormFieldDefinition[])
      : [],
    redirectURL: typeof doc?.redirectURL === "string" ? doc.redirectURL : "",
    slug: typeof doc?.slug === "string" ? doc.slug : "",
    status: doc?.status === "published" ? "published" : "draft",
    submitButtonLabel:
      typeof doc?.submitButtonLabel === "string" ? doc.submitButtonLabel : "",
    title: typeof doc?.title === "string" ? doc.title : "",
  };
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;

  if (nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const [item] = next.splice(index, 1);

  if (!item) {
    return items;
  }

  next.splice(nextIndex, 0, item);
  return next;
}

function FieldOptionEditor(props: {
  fieldIndex: number;
  onChange: (options: FormFieldOption[]) => void;
  options: FormFieldOption[];
}) {
  return (
    <div style={{ display: "grid", gap: "8px" }}>
      {props.options.map((option, optionIndex) => (
        <div
          key={optionKey(option)}
          style={{
            display: "grid",
            gap: "8px",
            gridTemplateColumns: "1fr 1fr auto",
          }}
        >
          <input
            onChange={(event) => {
              const next = [...props.options];
              next[optionIndex] = {
                ...option,
                label: event.target.value,
              };
              props.onChange(next);
            }}
            placeholder="Label"
            style={inputStyle}
            value={option.label}
          />
          <input
            onChange={(event) => {
              const next = [...props.options];
              next[optionIndex] = {
                ...option,
                value: event.target.value,
              };
              props.onChange(next);
            }}
            placeholder="Value"
            style={inputStyle}
            value={option.value}
          />
          <button
            onClick={() => {
              props.onChange(
                props.options.filter((_, current) => current !== optionIndex)
              );
            }}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}

      <button
        onClick={() => {
          props.onChange([
            ...props.options,
            { label: "Option", value: "option" },
          ]);
        }}
        type="button"
      >
        Add option
      </button>
    </div>
  );
}

export function serializeFormBuilderState(state: FormBuilderDocumentData) {
  return JSON.stringify(state);
}

export function FormBuilderView(props: FormBuilderViewProps) {
  const metadata = props.metadata;
  const allowedFieldTypes = metadata?.allowedFieldTypes ?? [
    "text",
    "textarea",
    "email",
    "number",
    "checkbox",
    "select",
    "radio",
    "date",
    "message",
  ];
  const [state, setState] = useState<FormBuilderDocumentData>(() =>
    docToState(props.doc)
  );
  const payload = useMemo(() => serializeFormBuilderState(state), [state]);

  return (
    <div style={shellStyle}>
      <form action={props.formAction} style={{ display: "grid", gap: "20px" }}>
        <input name="payload" type="hidden" value={payload} />
        <div style={panelStyle}>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <div>
              <p style={{ ...mutedStyle, margin: 0 }}>
                Payload-like form builder
              </p>
              <h1 style={{ marginBottom: "6px", marginTop: "8px" }}>
                {props.doc ? "Edit form" : "Create form"}
              </h1>
              <p style={{ ...mutedStyle, margin: 0 }}>
                Forms are stored as JSON internally and exposed publicly through
                the plugin routes.
              </p>
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <button type="submit">Save form</button>
              <a
                href={`${props.basePath ?? "/admin"}/${props.collection.slug}`}
              >
                Back to list
              </a>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <label style={{ display: "grid", gap: "8px" }}>
              <span>Title</span>
              <input
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                required
                style={inputStyle}
                value={state.title}
              />
            </label>
            <label style={{ display: "grid", gap: "8px" }}>
              <span>Slug</span>
              <input
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    slug: event.target.value,
                  }))
                }
                required
                style={inputStyle}
                value={state.slug}
              />
            </label>
            <label style={{ display: "grid", gap: "8px" }}>
              <span>Status</span>
              <select
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    status:
                      event.target.value === "published"
                        ? "published"
                        : "draft",
                  }))
                }
                style={inputStyle}
                value={state.status}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: "8px" }}>
              <span>Submit button label</span>
              <input
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    submitButtonLabel: event.target.value,
                  }))
                }
                placeholder="Send"
                style={inputStyle}
                value={state.submitButtonLabel ?? ""}
              />
            </label>
          </div>
        </div>

        <div style={panelStyle}>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <h2 style={sectionTitleStyle}>Field palette</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {allowedFieldTypes.map((fieldType) => (
                <button
                  key={fieldType}
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      fields: [
                        ...current.fields,
                        defaultField(fieldType, current.fields.length),
                      ],
                    }))
                  }
                  type="button"
                >
                  Add {fieldType}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gap: "16px" }}>
            {state.fields.length === 0 ? (
              <p style={{ ...mutedStyle, margin: 0 }}>
                No fields yet. Add one from the palette above.
              </p>
            ) : null}

            {state.fields.map((field, index) => (
              <section
                key={fieldKey(field)}
                style={{
                  border: "1px solid rgba(16, 36, 24, 0.08)",
                  borderRadius: "16px",
                  display: "grid",
                  gap: "12px",
                  padding: "16px",
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "8px",
                    justifyContent: "space-between",
                  }}
                >
                  <strong>{field.blockType}</strong>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          fields: moveItem(current.fields, index, -1),
                        }))
                      }
                      type="button"
                    >
                      Up
                    </button>
                    <button
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          fields: moveItem(current.fields, index, 1),
                        }))
                      }
                      type="button"
                    >
                      Down
                    </button>
                    <button
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          fields: current.fields.filter(
                            (_, currentIndex) => currentIndex !== index
                          ),
                        }))
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  }}
                >
                  <label style={{ display: "grid", gap: "8px" }}>
                    <span>Name</span>
                    <input
                      onChange={(event) => {
                        const next = [...state.fields];
                        next[index] = { ...field, name: event.target.value };
                        setState((current) => ({ ...current, fields: next }));
                      }}
                      style={inputStyle}
                      value={field.name}
                    />
                  </label>
                  <label style={{ display: "grid", gap: "8px" }}>
                    <span>Label</span>
                    <input
                      onChange={(event) => {
                        const next = [...state.fields];
                        next[index] = { ...field, label: event.target.value };
                        setState((current) => ({ ...current, fields: next }));
                      }}
                      style={inputStyle}
                      value={field.label}
                    />
                  </label>
                  <label style={{ display: "grid", gap: "8px" }}>
                    <span>Width</span>
                    <input
                      max={100}
                      min={1}
                      onChange={(event) => {
                        const next = [...state.fields];
                        next[index] = {
                          ...field,
                          width: Math.min(
                            100,
                            Math.max(1, Number(event.target.value) || 100)
                          ),
                        };
                        setState((current) => ({ ...current, fields: next }));
                      }}
                      style={inputStyle}
                      type="number"
                      value={field.width ?? 100}
                    />
                  </label>
                  {field.blockType !== "message" ? (
                    <label
                      style={{
                        alignItems: "center",
                        display: "flex",
                        gap: "12px",
                        marginTop: "28px",
                      }}
                    >
                      <input
                        checked={Boolean(field.required)}
                        onChange={(event) => {
                          const next = [...state.fields];
                          next[index] = {
                            ...field,
                            required: event.target.checked,
                          };
                          setState((current) => ({ ...current, fields: next }));
                        }}
                        type="checkbox"
                      />
                      <span>Required</span>
                    </label>
                  ) : null}
                </div>

                {field.blockType === "message" ? (
                  <label style={{ display: "grid", gap: "8px" }}>
                    <span>Message</span>
                    <textarea
                      onChange={(event) => {
                        const next = [...state.fields];
                        next[index] = { ...field, message: event.target.value };
                        setState((current) => ({ ...current, fields: next }));
                      }}
                      rows={4}
                      style={{ ...inputStyle, resize: "vertical" }}
                      value={field.message}
                    />
                  </label>
                ) : null}

                {"placeholder" in field || field.blockType !== "checkbox" ? (
                  field.blockType !== "checkbox" &&
                  field.blockType !== "message" ? (
                    <label style={{ display: "grid", gap: "8px" }}>
                      <span>Placeholder</span>
                      <input
                        onChange={(event) => {
                          const next = [...state.fields];
                          next[index] = {
                            ...field,
                            placeholder: event.target.value,
                          };
                          setState((current) => ({ ...current, fields: next }));
                        }}
                        style={inputStyle}
                        value={field.placeholder ?? ""}
                      />
                    </label>
                  ) : null
                ) : null}

                {"defaultValue" in field && field.blockType !== "message" ? (
                  <div style={{ display: "grid", gap: "8px" }}>
                    <span>Default value</span>
                    {field.blockType === "checkbox" ? (
                      <label
                        style={{
                          alignItems: "center",
                          display: "flex",
                          gap: "12px",
                        }}
                      >
                        <input
                          checked={Boolean(field.defaultValue)}
                          onChange={(event) => {
                            const next = [...state.fields];
                            next[index] = {
                              ...field,
                              defaultValue: event.target.checked,
                            };
                            setState((current) => ({
                              ...current,
                              fields: next,
                            }));
                          }}
                          type="checkbox"
                        />
                        <span>Checked by default</span>
                      </label>
                    ) : (
                      <input
                        onChange={(event) => {
                          const next = [...state.fields];
                          next[index] = {
                            ...field,
                            defaultValue:
                              field.blockType === "number"
                                ? Number(event.target.value)
                                : event.target.value,
                          } as FormFieldDefinition;
                          setState((current) => ({ ...current, fields: next }));
                        }}
                        style={inputStyle}
                        type={field.blockType === "number" ? "number" : "text"}
                        value={
                          field.defaultValue === undefined
                            ? ""
                            : String(field.defaultValue)
                        }
                      />
                    )}
                  </div>
                ) : null}

                {field.blockType === "select" || field.blockType === "radio" ? (
                  <FieldOptionEditor
                    fieldIndex={index}
                    onChange={(options) => {
                      const next = [...state.fields];
                      next[index] = { ...field, options };
                      setState((current) => ({ ...current, fields: next }));
                    }}
                    options={field.options}
                  />
                ) : null}
              </section>
            ))}
          </div>
        </div>

        <div style={panelStyle}>
          <h2 style={sectionTitleStyle}>Confirmation</h2>
          <div
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              marginTop: "16px",
            }}
          >
            <label style={{ display: "grid", gap: "8px" }}>
              <span>Confirmation type</span>
              <select
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    confirmationType:
                      event.target.value === "redirect"
                        ? "redirect"
                        : "message",
                  }))
                }
                style={inputStyle}
                value={state.confirmationType}
              >
                <option value="message">Message</option>
                <option value="redirect">Redirect</option>
              </select>
            </label>

            {state.confirmationType === "redirect" ? (
              <label style={{ display: "grid", gap: "8px" }}>
                <span>Redirect URL</span>
                <input
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      redirectURL: event.target.value,
                    }))
                  }
                  placeholder="https://example.com/thanks"
                  style={inputStyle}
                  value={state.redirectURL ?? ""}
                />
              </label>
            ) : null}
          </div>

          {state.confirmationType === "message" ? (
            <label style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
              <span>Confirmation message</span>
              <textarea
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    confirmationMessage: event.target.value,
                  }))
                }
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
                value={state.confirmationMessage ?? ""}
              />
            </label>
          ) : null}
        </div>

        <div style={panelStyle}>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <h2 style={sectionTitleStyle}>Email notifications</h2>
            <button
              onClick={() =>
                setState((current) => ({
                  ...current,
                  emails: [
                    ...current.emails,
                    defaultEmail(current.emails.length),
                  ],
                }))
              }
              type="button"
            >
              Add email
            </button>
          </div>

          <div style={{ display: "grid", gap: "16px" }}>
            {state.emails.length === 0 ? (
              <p style={{ ...mutedStyle, margin: 0 }}>
                No notification emails configured.
              </p>
            ) : null}

            {state.emails.map((email, index) => (
              <section
                key={emailKey(email)}
                style={{
                  border: "1px solid rgba(16, 36, 24, 0.08)",
                  borderRadius: "16px",
                  display: "grid",
                  gap: "12px",
                  padding: "16px",
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <strong>Email {index + 1}</strong>
                  <button
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        emails: current.emails.filter(
                          (_, currentIndex) => currentIndex !== index
                        ),
                      }))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "12px",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  }}
                >
                  {(
                    [
                      ["emailTo", "To"],
                      ["emailFrom", "From"],
                      ["replyTo", "Reply-to"],
                      ["cc", "CC"],
                      ["bcc", "BCC"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} style={{ display: "grid", gap: "8px" }}>
                      <span>{label}</span>
                      <input
                        onChange={(event) => {
                          const next = [...state.emails];
                          next[index] = {
                            ...email,
                            [key]: event.target.value,
                          };
                          setState((current) => ({ ...current, emails: next }));
                        }}
                        placeholder={
                          key === "emailTo" && metadata?.defaultToEmail
                            ? metadata.defaultToEmail
                            : "{{email}}"
                        }
                        style={inputStyle}
                        value={email[key] ?? ""}
                      />
                    </label>
                  ))}
                </div>

                <label style={{ display: "grid", gap: "8px" }}>
                  <span>Subject</span>
                  <input
                    onChange={(event) => {
                      const next = [...state.emails];
                      next[index] = {
                        ...email,
                        subject: event.target.value,
                      };
                      setState((current) => ({ ...current, emails: next }));
                    }}
                    style={inputStyle}
                    value={email.subject}
                  />
                </label>

                <label style={{ display: "grid", gap: "8px" }}>
                  <span>Message</span>
                  <textarea
                    onChange={(event) => {
                      const next = [...state.emails];
                      next[index] = {
                        ...email,
                        message: event.target.value,
                      };
                      setState((current) => ({ ...current, emails: next }));
                    }}
                    rows={5}
                    style={{ ...inputStyle, resize: "vertical" }}
                    value={email.message}
                  />
                </label>
              </section>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
