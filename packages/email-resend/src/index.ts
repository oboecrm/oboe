import type {
  EmailAdapter,
  OboeRuntime,
  SendEmailAddress,
  SendEmailAddressValue,
  SendEmailAttachment,
  SendEmailOptions,
} from "@oboe/core";
import { OboeEmailError } from "@oboe/core";
import { emailPlugin } from "@oboe/plugin-email";

export type {
  EmailAdapter,
  SendEmailAddress,
  SendEmailAttachment,
  SendEmailOptions,
} from "@oboe/core";

const DEFAULT_RESEND_BASE_URL = "https://api.resend.com";

export interface ResendClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface ResendAdapterOptions extends ResendClientOptions {
  defaultFromAddress: string;
  defaultFromName: string;
}

export interface ResendAttachment {
  content?: string;
  content_type?: string;
  filename?: string;
  path?: string;
}

export interface ResendSendEmailOptions {
  attachments?: ResendAttachment[];
  bcc?: string | string[];
  cc?: string | string[];
  from: string;
  headers?: Record<string, string>;
  html?: string;
  reply_to?: string | string[];
  subject: string;
  text?: string;
  to: string | string[];
}

export interface ResendSendEmailResponse {
  id: string;
}

export interface ResendRequestInit extends Omit<RequestInit, "body"> {
  body?: BodyInit | object | unknown[] | null;
}

export interface ResendClient {
  request: <TResponse = unknown>(
    path: string,
    init?: ResendRequestInit
  ) => Promise<TResponse>;
  sendEmail: (
    payload: ResendSendEmailOptions
  ) => Promise<ResendSendEmailResponse>;
}

function hasConstructor<TValue>(
  value: unknown,
  ctor: new (...args: never[]) => TValue
): value is TValue {
  return typeof ctor !== "undefined" && value instanceof ctor;
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof ArrayBuffer ||
    value instanceof Uint8Array ||
    hasConstructor(value, Blob) ||
    hasConstructor(value, FormData) ||
    hasConstructor(value, URLSearchParams) ||
    hasConstructor(value, ReadableStream)
  );
}

function joinUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  const text = await response.text();
  return text === "" ? undefined : text;
}

function getErrorMessage(statusCode: number, data: unknown) {
  if (typeof data === "string" && data.trim()) {
    return `Resend API request failed: ${statusCode} ${data}`;
  }

  if (data && typeof data === "object") {
    const message =
      "message" in data && typeof data.message === "string"
        ? data.message
        : undefined;
    const name =
      "name" in data && typeof data.name === "string" ? data.name : undefined;

    if (name && message) {
      return `Resend API request failed: ${statusCode} ${name} - ${message}`;
    }

    if (message) {
      return `Resend API request failed: ${statusCode} ${message}`;
    }
  }

  return `Resend API request failed with status ${statusCode}.`;
}

function toBase64(content: SendEmailAttachment["content"]) {
  if (typeof content === "string") {
    return Buffer.from(content).toString("base64");
  }

  return Buffer.from(content).toString("base64");
}

function isEmailAddressObject(
  value: SendEmailAddress
): value is Exclude<SendEmailAddress, string> {
  return typeof value === "object" && value !== null;
}

function formatAddress(address: SendEmailAddress) {
  if (!isEmailAddressObject(address)) {
    return address;
  }

  return address.name
    ? `${address.name} <${address.address}>`
    : address.address;
}

function mapAddresses(addresses?: SendEmailAddressValue) {
  if (!addresses) {
    return undefined;
  }

  if (Array.isArray(addresses)) {
    return addresses.map((address) =>
      isEmailAddressObject(address) ? address.address : address
    );
  }

  return isEmailAddressObject(addresses) ? addresses.address : addresses;
}

function mapAttachments(attachments?: SendEmailAttachment[]) {
  if (!attachments?.length) {
    return undefined;
  }

  return attachments.map((attachment) => ({
    content: toBase64(attachment.content),
    ...(attachment.contentType
      ? {
          content_type: attachment.contentType,
        }
      : {}),
    filename: attachment.filename,
  }));
}

function mapSendEmailOptions(args: {
  defaultFromAddress: string;
  defaultFromName: string;
  message: SendEmailOptions;
}): ResendSendEmailOptions {
  const from = args.message.from
    ? formatAddress(args.message.from)
    : `${args.defaultFromName} <${args.defaultFromAddress}>`;

  return {
    ...(args.message.attachments?.length
      ? {
          attachments: mapAttachments(args.message.attachments),
        }
      : {}),
    ...(args.message.bcc
      ? {
          bcc: mapAddresses(args.message.bcc),
        }
      : {}),
    ...(args.message.cc
      ? {
          cc: mapAddresses(args.message.cc),
        }
      : {}),
    from,
    ...(args.message.headers
      ? {
          headers: args.message.headers,
        }
      : {}),
    ...(args.message.html
      ? {
          html: args.message.html,
        }
      : {}),
    ...(args.message.replyTo
      ? {
          reply_to: mapAddresses(args.message.replyTo),
        }
      : {}),
    subject: args.message.subject ?? "",
    ...(args.message.text
      ? {
          text: args.message.text,
        }
      : {}),
    to: mapAddresses(args.message.to) ?? "",
  };
}

export function createResendClient(options: ResendClientOptions): ResendClient {
  const baseUrl = options.baseUrl ?? DEFAULT_RESEND_BASE_URL;

  return {
    async request<TResponse = unknown>(
      path: string,
      init: ResendRequestInit = {}
    ) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${options.apiKey}`);

      let body: BodyInit | null | undefined;

      if (typeof init.body !== "undefined" && init.body !== null) {
        if (isBodyInit(init.body)) {
          body = init.body;
        } else {
          body = JSON.stringify(init.body);
          if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
          }
        }
      }

      const response = await fetch(joinUrl(baseUrl, path), {
        ...init,
        body,
        headers,
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        throw new OboeEmailError({
          cause: data,
          message: getErrorMessage(response.status, data),
          provider: "resend",
          statusCode: response.status,
        });
      }

      return data as TResponse;
    },
    async sendEmail(payload) {
      return await this.request<ResendSendEmailResponse>("/emails", {
        body: payload,
        method: "POST",
      });
    },
  };
}

export function createResendEmailAdapter(
  options: ResendAdapterOptions
): EmailAdapter<ResendSendEmailResponse> {
  return () => {
    const client = createResendClient(options);

    return {
      clients: {
        resend: client,
      },
      defaultFromAddress: options.defaultFromAddress,
      defaultFromName: options.defaultFromName,
      name: "resend",
      async sendEmail(message) {
        return await client.sendEmail(
          mapSendEmailOptions({
            defaultFromAddress: options.defaultFromAddress,
            defaultFromName: options.defaultFromName,
            message,
          })
        );
      },
    };
  };
}

export function resendEmail(options: ResendAdapterOptions) {
  return emailPlugin({
    adapter: createResendEmailAdapter(options),
  });
}

export function getResendClient(oboe: OboeRuntime) {
  return oboe.email.getClient<ResendClient>("resend");
}
