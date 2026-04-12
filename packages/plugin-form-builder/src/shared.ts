import type {
  CollectionConfig,
  CollectionValidationContext,
  SchemaParseResult,
  ValidationIssue,
} from "@oboe/core";

import type {
  FormBuilderCollectionConfig,
  FormBuilderCollectionMetadata,
  FormBuilderDocumentData,
  FormEmailDefinition,
  FormFieldDefinition,
  FormFieldOption,
  FormFieldType,
  PublicFormDocument,
  SanitizedFormDocument,
} from "./types.js";

export const DEFAULT_FORM_SLUG = "forms";
export const DEFAULT_SUBMISSION_SLUG = "form-submissions";
export const DEFAULT_ROUTE_BASE = "/api/form-builder";

const DEFAULT_FIELD_LABELS: Record<FormFieldType, string> = {
  checkbox: "Checkbox",
  date: "Date",
  email: "Email",
  message: "Message",
  number: "Number",
  radio: "Radio",
  select: "Select",
  text: "Text",
  textarea: "Textarea",
};

const DEFAULT_ENABLED_FIELD_TYPES: FormFieldType[] = [
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeWidth(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return Math.min(100, Math.max(1, Math.round(parsed)));
}

function sanitizeOptions(
  value: unknown,
  path: PropertyKey[],
  issues: ValidationIssue[]
): FormFieldOption[] {
  if (!Array.isArray(value)) {
    issues.push({
      message: "Select and radio fields must define an options array.",
      path,
    });
    return [];
  }

  const options = value.flatMap<FormFieldOption>((option, index) => {
    if (!isPlainObject(option)) {
      issues.push({
        message: "Field options must be objects.",
        path: [...path, index],
      });
      return [];
    }

    const label = asTrimmedString(option.label);
    const optionValue = asTrimmedString(option.value);

    if (!label || !optionValue) {
      issues.push({
        message: "Field options must include both label and value.",
        path: [...path, index],
      });
      return [];
    }

    return [
      {
        label,
        value: optionValue,
      },
    ];
  });

  if (options.length === 0) {
    issues.push({
      message: "Select and radio fields must define at least one option.",
      path,
    });
  }

  return options;
}

function defaultFieldLabel(type: FormFieldType, index: number) {
  return `${DEFAULT_FIELD_LABELS[type]} ${index + 1}`;
}

export function getEnabledFieldTypes(
  value: Partial<Record<FormFieldType, boolean>> | undefined
): FormFieldType[] {
  if (!value) {
    return DEFAULT_ENABLED_FIELD_TYPES;
  }

  const enabled = DEFAULT_ENABLED_FIELD_TYPES.filter(
    (fieldType) => value[fieldType] !== false
  );

  return enabled.length > 0 ? enabled : (["text"] as FormFieldType[]);
}

export function createFormBuilderMetadata(args: {
  allowedFieldTypes: FormFieldType[];
  defaultToEmail?: string;
  routeBase: string;
}): FormBuilderCollectionMetadata {
  return {
    allowedFieldTypes: args.allowedFieldTypes,
    defaultToEmail: args.defaultToEmail,
    routeBase: args.routeBase,
  };
}

export function getFormBuilderMetadata(
  collection: CollectionConfig
): FormBuilderCollectionMetadata | undefined {
  return (collection as FormBuilderCollectionConfig).formBuilder;
}

export function sanitizeFieldDefinitions(
  value: unknown,
  allowedFieldTypes: FormFieldType[]
): { issues: ValidationIssue[]; value: FormFieldDefinition[] } {
  const issues: ValidationIssue[] = [];

  if (!Array.isArray(value)) {
    return {
      issues: [
        {
          message: "Form fields must be an array.",
          path: ["fields"],
        },
      ],
      value: [],
    };
  }

  const seenNames = new Set<string>();
  const fields = value.flatMap<FormFieldDefinition>((item, index) => {
    if (!isPlainObject(item)) {
      issues.push({
        message: "Form fields must be objects.",
        path: ["fields", index],
      });
      return [];
    }

    const blockType = asTrimmedString(item.blockType) as FormFieldType;
    if (!allowedFieldTypes.includes(blockType)) {
      issues.push({
        message: `Unsupported form field type "${String(item.blockType)}".`,
        path: ["fields", index, "blockType"],
      });
      return [];
    }

    const name = asTrimmedString(item.name) || `${blockType}-${index + 1}`;
    if (seenNames.has(name)) {
      issues.push({
        message: `Duplicate form field name "${name}".`,
        path: ["fields", index, "name"],
      });
      return [];
    }
    seenNames.add(name);

    const label =
      asTrimmedString(item.label) || defaultFieldLabel(blockType, index);
    const required = Boolean(item.required);
    const width = sanitizeWidth(item.width);
    const placeholder = asTrimmedString(item.placeholder) || undefined;
    const base = {
      blockType,
      label,
      name,
      placeholder,
      required,
      width,
    };

    switch (blockType) {
      case "checkbox":
        return [
          {
            ...base,
            blockType,
            defaultValue: Boolean(item.defaultValue),
          },
        ];
      case "number": {
        const parsed =
          typeof item.defaultValue === "number"
            ? item.defaultValue
            : typeof item.defaultValue === "string" && item.defaultValue.trim()
              ? Number(item.defaultValue)
              : undefined;
        return [
          {
            ...base,
            blockType,
            defaultValue:
              parsed !== undefined && Number.isFinite(parsed)
                ? parsed
                : undefined,
          },
        ];
      }
      case "message": {
        const message = asTrimmedString(item.message);
        if (!message) {
          issues.push({
            message: "Message fields require a message.",
            path: ["fields", index, "message"],
          });
          return [];
        }

        return [
          {
            ...base,
            blockType,
            message,
            required: false,
          },
        ];
      }
      case "select":
      case "radio": {
        const options = sanitizeOptions(
          item.options,
          ["fields", index, "options"],
          issues
        );
        const defaultValue = asTrimmedString(item.defaultValue) || undefined;

        if (
          defaultValue &&
          !options.some((option) => option.value === defaultValue)
        ) {
          issues.push({
            message: "Default value must match one of the configured options.",
            path: ["fields", index, "defaultValue"],
          });
        }

        return [
          {
            ...base,
            blockType,
            defaultValue,
            options,
          },
        ];
      }
      case "date":
      case "email":
      case "text":
      case "textarea":
        return [
          {
            ...base,
            blockType,
            defaultValue: asTrimmedString(item.defaultValue) || undefined,
          },
        ];
    }

    return [];
  });

  return {
    issues,
    value: fields,
  };
}

export function sanitizeEmailDefinitions(value: unknown): {
  issues: ValidationIssue[];
  value: FormEmailDefinition[];
} {
  const issues: ValidationIssue[] = [];

  if (value === undefined || value === null || value === "") {
    return {
      issues,
      value: [],
    };
  }

  if (!Array.isArray(value)) {
    return {
      issues: [
        {
          message: "Form emails must be an array.",
          path: ["emails"],
        },
      ],
      value: [],
    };
  }

  const emails = value.flatMap<FormEmailDefinition>((item, index) => {
    if (!isPlainObject(item)) {
      issues.push({
        message: "Email definitions must be objects.",
        path: ["emails", index],
      });
      return [];
    }

    const subject = asTrimmedString(item.subject);
    const message = asTrimmedString(item.message);
    const emailTo = asTrimmedString(item.emailTo) || undefined;

    if (!subject) {
      issues.push({
        message: "Email subject is required.",
        path: ["emails", index, "subject"],
      });
    }

    if (!message) {
      issues.push({
        message: "Email message is required.",
        path: ["emails", index, "message"],
      });
    }

    if (!subject || !message) {
      return [];
    }

    return [
      {
        bcc: asTrimmedString(item.bcc) || undefined,
        cc: asTrimmedString(item.cc) || undefined,
        emailFrom: asTrimmedString(item.emailFrom) || undefined,
        emailTo,
        message,
        replyTo: asTrimmedString(item.replyTo) || undefined,
        subject,
      },
    ];
  });

  return {
    issues,
    value: emails,
  };
}

export function sanitizeFormDocumentData(args: {
  allowedFieldTypes: FormFieldType[];
  value: unknown;
}): SchemaParseResult<Record<string, unknown>> {
  if (!isPlainObject(args.value)) {
    return {
      issues: [
        {
          message: "Form config must be an object.",
          path: [],
        },
      ],
    };
  }

  const issues: ValidationIssue[] = [];
  const slug = asTrimmedString(args.value.slug);
  const title = asTrimmedString(args.value.title);
  const status =
    asTrimmedString(args.value.status) === "published" ? "published" : "draft";
  const confirmationType =
    asTrimmedString(args.value.confirmationType) === "redirect"
      ? "redirect"
      : "message";
  const confirmationMessage =
    asTrimmedString(args.value.confirmationMessage) || undefined;
  const submitButtonLabel =
    asTrimmedString(args.value.submitButtonLabel) || undefined;
  const redirectURL = asTrimmedString(args.value.redirectURL) || undefined;

  if (!slug) {
    issues.push({
      message: "Form slug is required.",
      path: ["slug"],
    });
  }

  if (!title) {
    issues.push({
      message: "Form title is required.",
      path: ["title"],
    });
  }

  if (confirmationType === "redirect" && !redirectURL) {
    issues.push({
      message: "Redirect URL is required when confirmation type is redirect.",
      path: ["redirectURL"],
    });
  }

  const fields = sanitizeFieldDefinitions(
    args.value.fields,
    args.allowedFieldTypes
  );
  const emails = sanitizeEmailDefinitions(args.value.emails);
  issues.push(...fields.issues, ...emails.issues);

  if (issues.length > 0) {
    return {
      issues,
    };
  }

  const sanitized: FormBuilderDocumentData = {
    confirmationMessage,
    confirmationType,
    emails: emails.value,
    fields: fields.value,
    redirectURL,
    slug,
    status,
    submitButtonLabel,
    title,
  };

  return {
    value: sanitized as unknown as Record<string, unknown>,
  };
}

export function sanitizeFormDocumentRecord(args: {
  allowedFieldTypes: FormFieldType[];
  doc: Record<string, unknown>;
  id?: string;
}) {
  const parsed = sanitizeFormDocumentData({
    allowedFieldTypes: args.allowedFieldTypes,
    value: args.doc,
  });

  if (!parsed.value || parsed.issues) {
    return null;
  }

  return {
    ...(parsed.value as unknown as SanitizedFormDocument),
    id: args.id,
  } satisfies SanitizedFormDocument;
}

export function createFormCollectionSchema(args: {
  allowedFieldTypes: FormFieldType[];
}) {
  return {
    parse(value: unknown, _context: CollectionValidationContext) {
      return sanitizeFormDocumentData({
        allowedFieldTypes: args.allowedFieldTypes,
        value,
      });
    },
  };
}

export function toPublicFormDocument(
  form: SanitizedFormDocument
): PublicFormDocument {
  return {
    confirmationMessage: form.confirmationMessage,
    confirmationType: form.confirmationType,
    fields: form.fields,
    id: form.id ?? "",
    redirect: form.redirectURL
      ? {
          url: form.redirectURL,
        }
      : undefined,
    slug: form.slug,
    submitButtonLabel: form.submitButtonLabel,
    title: form.title,
  };
}

export function normalizeBuilderPayload(
  value: string,
  allowedFieldTypes: FormFieldType[]
) {
  const parsed = JSON.parse(value) as unknown;
  const result = sanitizeFormDocumentData({
    allowedFieldTypes,
    value: parsed,
  });

  if (!result.value || result.issues) {
    throw new Error(
      result.issues?.map((issue) => issue.message).join(", ") ??
        "Invalid form builder payload."
    );
  }

  return result.value as unknown as FormBuilderDocumentData;
}
