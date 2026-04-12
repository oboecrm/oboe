import {
  createOboeRuntime,
  defineConfig,
  defineModule,
  resolveConfig,
} from "@oboe/core";
import { createMemoryAdapter } from "@oboe/core/testing";
import { createHttpHandler } from "@oboe/http";
import { describe, expect, it } from "vitest";

import { prepareEmails } from "./email.js";
import { formBuilderPlugin } from "./index.js";
import {
  normalizeBuilderPayload,
  sanitizeFormDocumentData,
  toPublicFormDocument,
} from "./shared.js";

describe("formBuilderPlugin", () => {
  it("injects managed collections and custom routes", async () => {
    const config = resolveConfig(
      defineConfig({
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
        plugins: [formBuilderPlugin()],
      })
    );

    expect(
      config.modules.some(
        (moduleConfig) => moduleConfig.slug === "oboe-form-builder"
      )
    ).toBe(true);
    expect(
      config.http?.routes?.some(
        (route) => route.path === "/api/form-builder/form"
      )
    ).toBe(true);
    expect(
      config.http?.routes?.some(
        (route) => route.path === "/api/form-builder/submit"
      )
    ).toBe(true);
  });

  it("sanitizes form definitions and rejects invalid blocks", () => {
    const parsed = sanitizeFormDocumentData({
      allowedFieldTypes: ["text", "email"],
      value: {
        confirmationType: "message",
        emails: [],
        fields: [
          {
            blockType: "text",
            label: "Name",
            name: "name",
          },
          {
            blockType: "radio",
            label: "Bad",
            name: "bad",
          },
        ],
        slug: "contact",
        status: "published",
        title: "Contact",
      },
    });

    expect(parsed.issues?.[0]?.message).toContain(
      "Unsupported form field type"
    );
  });

  it("serializes builder payloads into sanitized document data", () => {
    const result = normalizeBuilderPayload(
      JSON.stringify({
        confirmationType: "message",
        emails: [],
        fields: [
          {
            blockType: "select",
            label: "Topic",
            name: "topic",
            options: [{ label: "Sales", value: "sales" }],
          },
        ],
        slug: "contact",
        status: "published",
        title: "Contact",
      }),
      ["select"]
    );

    expect(result.fields[0]).toEqual(
      expect.objectContaining({
        blockType: "select",
        name: "topic",
      })
    );
  });

  it("prepares templated emails from submission data", () => {
    const prepared = prepareEmails({
      defaultToEmail: "ops@example.com",
      form: {
        confirmationType: "message",
        emails: [
          {
            message: "Hello {{name}}",
            subject: "New lead {{name}}",
          },
        ],
        fields: [],
        slug: "contact",
        status: "published",
        title: "Contact",
      },
      submissionData: {
        name: "Ada",
      },
    });

    expect(prepared).toEqual([
      {
        subject: "New lead Ada",
        text: "Hello Ada",
        to: "ops@example.com",
      },
    ]);
  });

  it("removes internal email settings from the public form payload", () => {
    const payload = toPublicFormDocument({
      confirmationType: "message",
      emails: [
        {
          emailTo: "ops@example.com",
          message: "Hello",
          subject: "Subject",
        },
      ],
      fields: [],
      id: "form-1",
      slug: "contact",
      status: "published",
      title: "Contact",
    });

    expect(payload).not.toHaveProperty("emails");
    expect(payload.id).toBe("form-1");
  });

  it("serves published form schemas and rejects draft forms", async () => {
    const runtime = await createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
        plugins: [formBuilderPlugin()],
      }),
      db: createMemoryAdapter(),
    });

    await runtime.initialize();
    await runtime.create({
      collection: "forms",
      data: {
        confirmationType: "message",
        emails: [],
        fields: [
          {
            blockType: "text",
            label: "Name",
            name: "name",
          },
        ],
        slug: "contact",
        status: "published",
        title: "Contact",
      },
      overrideAccess: true,
    });
    await runtime.create({
      collection: "forms",
      data: {
        confirmationType: "message",
        emails: [],
        fields: [],
        slug: "draft-only",
        status: "draft",
        title: "Draft",
      },
      overrideAccess: true,
    });

    const handler = createHttpHandler({ runtime });
    const publishedResponse = await handler(
      new Request("http://localhost/api/form-builder/form?slug=contact")
    );
    const publishedPayload = (await publishedResponse.json()) as {
      slug: string;
    };
    const draftResponse = await handler(
      new Request("http://localhost/api/form-builder/form?slug=draft-only")
    );

    expect(publishedResponse.status).toBe(200);
    expect(publishedPayload.slug).toBe("contact");
    expect(draftResponse.status).toBe(404);
  });

  it("accepts valid submissions, sends email hooks, and returns confirmation", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const runtime = await createOboeRuntime({
      config: defineConfig({
        email: Promise.resolve(() => ({
          defaultFromAddress: "info@oboe.dev",
          defaultFromName: "Oboe",
          name: "memory-email",
          sendEmail: async (message: unknown) => {
            sent.push(message as Record<string, unknown>);
            return { ok: true };
          },
        })),
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
        plugins: [
          formBuilderPlugin({
            beforeEmail: async (emails) =>
              emails.map((email) => ({
                ...email,
                subject: `[hooked] ${email.subject}`,
              })),
            defaultToEmail: "ops@example.com",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    await runtime.initialize();
    await runtime.create({
      collection: "forms",
      data: {
        confirmationMessage: "Thanks",
        confirmationType: "message",
        emails: [
          {
            message: "Lead from {{name}}",
            subject: "Lead {{name}}",
          },
        ],
        fields: [
          {
            blockType: "text",
            label: "Name",
            name: "name",
            required: true,
          },
          {
            blockType: "email",
            label: "Email",
            name: "email",
            required: true,
          },
        ],
        slug: "contact",
        status: "published",
        title: "Contact",
      },
      overrideAccess: true,
    });

    const handler = createHttpHandler({ runtime });
    const response = await handler(
      new Request("http://localhost/api/form-builder/submit", {
        body: JSON.stringify({
          form: "contact",
          submissionData: {
            email: "ada@example.com",
            name: "Ada",
          },
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      })
    );
    const payload = (await response.json()) as {
      confirmationMessage?: string;
      ok: boolean;
    };
    const submissions = await runtime.find({
      collection: "form-submissions",
      overrideAccess: true,
    });

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.confirmationMessage).toBe("Thanks");
    expect(submissions.totalDocs).toBe(1);
    expect(sent[0]?.subject).toBe("[hooked] Lead Ada");
    expect(sent[0]?.to).toBe("ops@example.com");
  });

  it("rejects invalid submissions with validation issues", async () => {
    const runtime = await createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
        plugins: [formBuilderPlugin()],
      }),
      db: createMemoryAdapter(),
    });

    await runtime.initialize();
    await runtime.create({
      collection: "forms",
      data: {
        confirmationType: "redirect",
        emails: [],
        fields: [
          {
            blockType: "select",
            label: "Topic",
            name: "topic",
            options: [{ label: "Sales", value: "sales" }],
            required: true,
          },
        ],
        redirectURL: "https://example.com/thanks",
        slug: "contact",
        status: "published",
        title: "Contact",
      },
      overrideAccess: true,
    });

    const handler = createHttpHandler({ runtime });
    const response = await handler(
      new Request("http://localhost/api/form-builder/submit", {
        body: JSON.stringify({
          form: "contact",
          submissionData: {
            topic: "support",
          },
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      })
    );
    const payload = (await response.json()) as {
      error: string;
      issues: Array<{ path?: PropertyKey[] }>;
    };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Validation failed");
    expect(payload.issues[0]?.path).toEqual(["submissionData", "topic"]);
  });
});
