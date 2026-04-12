import type {
  CollectionConfig,
  OboeConfig,
  OboeRuntime,
  PluginConfig,
} from "@oboe/core";
import {
  appendHttpRoutes,
  appendModules,
  mergeCollectionConfig,
} from "@oboe/core";

import { sendPreparedEmails } from "./email.js";
import {
  createFormBuilderMetadata,
  createFormCollectionSchema,
  DEFAULT_FORM_SLUG,
  DEFAULT_ROUTE_BASE,
  DEFAULT_SUBMISSION_SLUG,
  getEnabledFieldTypes,
  sanitizeFormDocumentRecord,
  toPublicFormDocument,
} from "./shared.js";
import {
  buildConfirmationPayload,
  validateSubmissionData,
} from "./submission.js";
import {
  FORM_BUILDER_COMPONENT,
  FORM_BUILDER_MODULE_SLUG,
  FORM_BUILDER_VIEW_KEY,
  type FormBuilderPluginOptions,
  type FormFieldType,
} from "./types.js";

export {
  FormBuilderView,
  serializeFormBuilderState,
} from "./FormBuilderView.js";
export {
  getFormBuilderMetadata,
  normalizeBuilderPayload,
  toPublicFormDocument,
} from "./shared.js";
export type * from "./types.js";
export {
  FORM_BUILDER_COMPONENT,
  FORM_BUILDER_MODULE_SLUG,
  FORM_BUILDER_VIEW_KEY,
} from "./types.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status,
  });
}

async function parseJsonRequest(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function createFormsCollection(args: {
  allowedFieldTypes: FormFieldType[];
  formSlug: string;
  options: FormBuilderPluginOptions;
  routeBase: string;
}): CollectionConfig {
  const metadata = createFormBuilderMetadata({
    allowedFieldTypes: args.allowedFieldTypes,
    defaultToEmail: args.options.defaultToEmail,
    routeBase: args.routeBase,
  });

  const base: CollectionConfig = {
    access: {
      create: () => false,
      delete: () => false,
      read: () => false,
      update: () => false,
    },
    admin: {
      defaultColumns: ["title", "slug", "status"],
      titleField: "title",
      views: {
        [FORM_BUILDER_VIEW_KEY]: {
          component: FORM_BUILDER_COMPONENT,
          label: "Builder",
          path: "/builder",
        },
      },
    },
    fields: [
      {
        name: "slug",
        required: true,
        type: "text",
      },
      {
        name: "title",
        required: true,
        type: "text",
      },
      {
        name: "status",
        options: [
          { label: "Draft", value: "draft" },
          { label: "Published", value: "published" },
        ],
        required: true,
        type: "select",
      },
      {
        name: "submitButtonLabel",
        type: "text",
      },
      {
        name: "confirmationType",
        options: [
          { label: "Message", value: "message" },
          { label: "Redirect", value: "redirect" },
        ],
        required: true,
        type: "select",
      },
      {
        name: "confirmationMessage",
        type: "textarea",
      },
      {
        name: "redirectURL",
        type: "text",
      },
      {
        name: "fields",
        required: true,
        type: "json",
      },
      {
        name: "emails",
        type: "json",
      },
    ],
    labels: {
      plural: "Forms",
      singular: "Form",
    },
    schema: createFormCollectionSchema({
      allowedFieldTypes: args.allowedFieldTypes,
    }),
    slug: args.formSlug,
  };

  const merged = mergeCollectionConfig(
    base,
    args.options.formOverrides
  ) as CollectionConfig & {
    formBuilder?: typeof metadata;
  };
  merged.formBuilder = metadata;

  return merged;
}

function createSubmissionCollection(args: {
  formSlug: string;
  options: FormBuilderPluginOptions;
  submissionSlug: string;
}): CollectionConfig {
  const base: CollectionConfig = {
    access: {
      create: () => false,
      delete: () => false,
      read: () => false,
      update: () => false,
    },
    admin: {
      defaultColumns: ["form", "createdAt"],
    },
    fields: [
      {
        name: "form",
        relationTo: args.formSlug,
        required: true,
        type: "relation",
      },
      {
        name: "submissionData",
        required: true,
        type: "json",
      },
    ],
    labels: {
      plural: "Form Submissions",
      singular: "Form Submission",
    },
    slug: args.submissionSlug,
  };

  return mergeCollectionConfig(base, args.options.formSubmissionOverrides);
}

async function findPublishedForm(args: {
  allowedFieldTypes: FormFieldType[];
  formSlug: string;
  runtime: OboeRuntime;
  slug: string;
}) {
  const result = await args.runtime.find({
    collection: args.formSlug,
    overrideAccess: true,
    query: {
      limit: 1,
      pagination: false,
      where: {
        slug: {
          eq: args.slug,
        },
        status: {
          eq: "published",
        },
      },
    },
  });
  const doc = result.docs[0];

  if (!doc) {
    return null;
  }

  return sanitizeFormDocumentRecord({
    allowedFieldTypes: args.allowedFieldTypes,
    doc,
    id: doc.id,
  });
}

export function formBuilderPlugin(
  options: FormBuilderPluginOptions = {}
): PluginConfig {
  const allowedFieldTypes = getEnabledFieldTypes(options.fields);
  const formSlug = options.formSlug ?? DEFAULT_FORM_SLUG;
  const submissionSlug = options.submissionSlug ?? DEFAULT_SUBMISSION_SLUG;
  const routeBase = options.routeBase ?? DEFAULT_ROUTE_BASE;

  return {
    extendConfig(config: OboeConfig): OboeConfig {
      if (options.enabled === false) {
        return config;
      }

      const formsCollection = createFormsCollection({
        allowedFieldTypes,
        formSlug,
        options,
        routeBase,
      });
      const submissionsCollection = createSubmissionCollection({
        formSlug,
        options,
        submissionSlug,
      });

      return appendModules(
        appendHttpRoutes(config, [
          {
            async handler(request, { runtime }) {
              const url = new URL(request.url);
              const slug = url.searchParams.get("slug")?.trim();

              if (!slug) {
                return json(
                  {
                    error: "Missing required query param `slug`.",
                  },
                  400
                );
              }

              const form = await findPublishedForm({
                allowedFieldTypes,
                formSlug,
                runtime,
                slug,
              });

              if (!form) {
                return json(
                  {
                    error: `Published form "${slug}" was not found.`,
                  },
                  404
                );
              }

              return json(toPublicFormDocument(form));
            },
            method: "GET",
            path: `${routeBase}/form`,
          },
          {
            async handler(request, { runtime }) {
              const body = await parseJsonRequest(request);

              if (!body) {
                return json(
                  {
                    error: "Request body must be valid JSON.",
                  },
                  400
                );
              }

              const formName =
                typeof body.form === "string" ? body.form.trim() : "";
              const submissionData =
                typeof body.submissionData === "object" &&
                body.submissionData !== null &&
                !Array.isArray(body.submissionData)
                  ? (body.submissionData as Record<string, unknown>)
                  : null;

              if (!formName || !submissionData) {
                return json(
                  {
                    error:
                      "Request body must include `form` and `submissionData`.",
                  },
                  400
                );
              }

              const form = await findPublishedForm({
                allowedFieldTypes,
                formSlug,
                runtime,
                slug: formName,
              });

              if (!form?.id) {
                return json(
                  {
                    error: `Published form "${formName}" was not found.`,
                  },
                  404
                );
              }

              const validated = validateSubmissionData({
                form,
                submissionData,
              });

              if (validated.issues.length > 0) {
                return json(
                  {
                    error: "Validation failed",
                    issues: validated.issues,
                  },
                  400
                );
              }

              await runtime.create({
                collection: submissionSlug,
                data: {
                  form: form.id,
                  submissionData: validated.value,
                },
                overrideAccess: true,
                req: request,
              });

              await sendPreparedEmails({
                form,
                options,
                req: request,
                runtime,
                submissionData: validated.value,
              });

              return json({
                ok: true,
                ...buildConfirmationPayload(form),
              });
            },
            method: "POST",
            path: `${routeBase}/submit`,
          },
        ]),
        [
          {
            collections: [formsCollection, submissionsCollection],
            slug: FORM_BUILDER_MODULE_SLUG,
          },
        ]
      );
    },
    name: "@oboe/plugin-form-builder",
  };
}
