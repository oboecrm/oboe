import type { ValidationIssue } from "@oboe/core";

import type {
  FormFieldDefinition,
  PublicRedirect,
  SanitizedFormDocument,
} from "./types.js";

function isMissing(value: unknown) {
  return value === undefined || value === null || value === "";
}

function coerceText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return "";
}

function normalizeFieldValue(
  field: FormFieldDefinition,
  rawValue: unknown,
  issues: ValidationIssue[]
) {
  const path: PropertyKey[] = ["submissionData", field.name];
  const fallback = field.defaultValue;
  const value = isMissing(rawValue) ? fallback : rawValue;

  if (field.blockType === "message") {
    return undefined;
  }

  if (isMissing(value)) {
    if (field.required) {
      issues.push({
        message: `Field "${field.name}" is required.`,
        path,
      });
    }

    return undefined;
  }

  switch (field.blockType) {
    case "checkbox": {
      const normalized =
        typeof value === "boolean"
          ? value
          : typeof value === "string"
            ? value === "true" || value === "on" || value === "1"
            : Boolean(value);

      if (field.required && !normalized) {
        issues.push({
          message: `Field "${field.name}" must be checked.`,
          path,
        });
      }

      return normalized;
    }
    case "number": {
      const normalized =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value)
            : Number.NaN;

      if (!Number.isFinite(normalized)) {
        issues.push({
          message: `Field "${field.name}" must be a valid number.`,
          path,
        });
        return undefined;
      }

      return normalized;
    }
    case "date": {
      const normalized = coerceText(value);
      if (!normalized || Number.isNaN(Date.parse(normalized))) {
        issues.push({
          message: `Field "${field.name}" must be a valid date.`,
          path,
        });
        return undefined;
      }

      return normalized;
    }
    case "email": {
      const normalized = coerceText(value);
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(normalized)) {
        issues.push({
          message: `Field "${field.name}" must be a valid email address.`,
          path,
        });
        return undefined;
      }

      return normalized;
    }
    case "radio":
    case "select": {
      const normalized = coerceText(value);
      if (!field.options.some((option) => option.value === normalized)) {
        issues.push({
          message: `Field "${field.name}" must match one of the configured options.`,
          path,
        });
        return undefined;
      }

      return normalized;
    }
    case "text":
    case "textarea": {
      const normalized = coerceText(value);

      if (!normalized && field.required) {
        issues.push({
          message: `Field "${field.name}" is required.`,
          path,
        });
        return undefined;
      }

      return normalized || undefined;
    }
    default:
      return undefined;
  }
}

export function validateSubmissionData(args: {
  form: SanitizedFormDocument;
  submissionData: Record<string, unknown>;
}) {
  const issues: ValidationIssue[] = [];
  const data: Record<string, unknown> = {};

  for (const field of args.form.fields) {
    const value = normalizeFieldValue(
      field,
      args.submissionData[field.name],
      issues
    );

    if (value !== undefined && field.blockType !== "message") {
      data[field.name] = value;
    }
  }

  return {
    issues,
    value: data,
  };
}

export function buildConfirmationPayload(form: SanitizedFormDocument): {
  confirmationMessage?: string;
  confirmationType: "message" | "redirect";
  redirect?: PublicRedirect;
} {
  return {
    confirmationMessage: form.confirmationMessage,
    confirmationType: form.confirmationType,
    redirect: form.redirectURL
      ? {
          url: form.redirectURL,
        }
      : undefined,
  };
}
