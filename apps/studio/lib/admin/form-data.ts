import type { FieldConfig } from "@oboe/core";

export function parseFieldValue(field: FieldConfig, formData: FormData) {
  if (field.type === "boolean") {
    return formData.get(field.name) === "true";
  }

  const rawValue = formData.get(field.name);
  if (typeof rawValue !== "string") {
    return undefined;
  }

  const value = rawValue.trim();
  if (!value) {
    return undefined;
  }

  if (field.type === "number") {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return undefined;
    }

    return parsed;
  }

  if (field.type === "json") {
    return JSON.parse(value) as unknown;
  }

  return value;
}

export function formDataToCollectionInput(
  fields: FieldConfig[],
  formData: FormData
) {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = parseFieldValue(field, formData);

      return value === undefined ? [] : [[field.name, value]];
    })
  );
}
