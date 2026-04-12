import type { OboeRuntime } from "@oboe/core";

import type {
  BeforeEmailContext,
  FormBuilderPluginOptions,
  PreparedEmail,
  SanitizedFormDocument,
} from "./types.js";

function templateValue(value: string, submissionData: Record<string, unknown>) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_match, key) => {
    const candidate = submissionData[key];

    if (candidate === undefined || candidate === null) {
      return "";
    }

    if (typeof candidate === "string") {
      return candidate;
    }

    if (typeof candidate === "number" || typeof candidate === "boolean") {
      return String(candidate);
    }

    return JSON.stringify(candidate);
  });
}

export function prepareEmails(args: {
  defaultToEmail?: string;
  form: SanitizedFormDocument;
  submissionData: Record<string, unknown>;
}) {
  return args.form.emails.flatMap<PreparedEmail>((email) => {
    const to = templateValue(
      email.emailTo ?? args.defaultToEmail ?? "",
      args.submissionData
    ).trim();

    if (!to) {
      return [];
    }

    const prepared: PreparedEmail = {
      bcc: email.bcc
        ? templateValue(email.bcc, args.submissionData).trim() || undefined
        : undefined,
      cc: email.cc
        ? templateValue(email.cc, args.submissionData).trim() || undefined
        : undefined,
      from: email.emailFrom
        ? templateValue(email.emailFrom, args.submissionData).trim() ||
          undefined
        : undefined,
      replyTo: email.replyTo
        ? templateValue(email.replyTo, args.submissionData).trim() || undefined
        : undefined,
      subject: templateValue(email.subject, args.submissionData).trim(),
      text: templateValue(email.message, args.submissionData),
      to,
    };

    return prepared.subject && prepared.text ? [prepared] : [];
  });
}

export async function sendPreparedEmails(args: {
  form: SanitizedFormDocument;
  options: FormBuilderPluginOptions;
  req: Request;
  runtime: OboeRuntime;
  submissionData: Record<string, unknown>;
}) {
  const initial = prepareEmails({
    defaultToEmail: args.options.defaultToEmail,
    form: args.form,
    submissionData: args.submissionData,
  });

  if (initial.length === 0) {
    return [];
  }

  const context: BeforeEmailContext = {
    form: args.form,
    req: args.req,
    runtime: args.runtime,
    submissionData: args.submissionData,
  };
  const prepared = args.options.beforeEmail
    ? await args.options.beforeEmail(initial, context)
    : initial;

  await Promise.all(
    prepared.map((email) =>
      args.runtime.sendEmail({
        bcc: email.bcc,
        cc: email.cc,
        from: email.from,
        replyTo: email.replyTo,
        subject: email.subject,
        text: email.text,
        to: email.to,
      })
    )
  );

  return prepared;
}
