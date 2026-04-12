import type { CompiledCollection, FieldConfig } from "@oboe/core";

import { fieldInputStyle, fieldLabelStyle } from "./styles.js";

export function titleForCollection(collection: CompiledCollection) {
  return collection.labels?.plural ?? collection.slug;
}

function fieldLabel(field: FieldConfig) {
  return field.label ?? field.name;
}

function isRelationshipField(field: FieldConfig) {
  return field.type === "relation" || field.type === "relationship";
}

export function formatValue(value: unknown) {
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

export function renderDetailValue(value: unknown) {
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

export function renderCreateField(field: FieldConfig) {
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
