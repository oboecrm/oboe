import { createOboeRuntime, defineConfig, defineModule } from "@oboe/core";
import { createMemoryAdapter } from "@oboe/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createResendClient, getResendClient, resendEmail } from "./index.js";

describe("email-resend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps Oboe sendEmail options to the Resend API payload", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "email_123" }), {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
        plugins: [
          resendEmail({
            apiKey: "re_test",
            defaultFromAddress: "info@oboe.dev",
            defaultFromName: "Oboe",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    await runtime.initialize();

    await runtime.sendEmail({
      attachments: [
        {
          content: "hello world",
          contentType: "text/plain",
          filename: "hello.txt",
        },
      ],
      cc: [{ address: "cc@example.com", name: "CC User" }],
      headers: {
        "x-trace-id": "trace-123",
      },
      replyTo: {
        address: "reply@example.com",
        name: "Reply User",
      },
      subject: "Launch",
      text: "It works.",
      to: ["dev@example.com", { address: "ops@example.com", name: "Ops" }],
    });

    expect(getResendClient(runtime)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: JSON.stringify({
          attachments: [
            {
              content: "aGVsbG8gd29ybGQ=",
              content_type: "text/plain",
              filename: "hello.txt",
            },
          ],
          cc: ["cc@example.com"],
          from: "Oboe <info@oboe.dev>",
          headers: {
            "x-trace-id": "trace-123",
          },
          reply_to: "reply@example.com",
          subject: "Launch",
          text: "It works.",
          to: ["dev@example.com", "ops@example.com"],
        }),
        method: "POST",
      })
    );
  });

  it("normalizes Resend API errors into OboeEmailError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              message: "Bad API key",
              name: "authentication_error",
            }),
            {
              headers: {
                "content-type": "application/json",
              },
              status: 401,
            }
          )
      )
    );

    const runtime = createOboeRuntime({
      config: defineConfig({
        modules: [
          defineModule({
            collections: [],
            slug: "crm",
          }),
        ],
        plugins: [
          resendEmail({
            apiKey: "re_bad",
            defaultFromAddress: "info@oboe.dev",
            defaultFromName: "Oboe",
          }),
        ],
      }),
      db: createMemoryAdapter(),
    });

    await expect(
      runtime.sendEmail({
        subject: "Launch",
        to: "dev@example.com",
      })
    ).rejects.toMatchObject({
      name: "OboeEmailError",
      provider: "resend",
      statusCode: 401,
    });
  });

  it("exposes a low-level request client for custom Resend endpoints", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "broadcast_123" }), {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createResendClient({
      apiKey: "re_test",
      baseUrl: "https://api.resend.com",
    });
    const result = await client.request("/broadcasts", {
      body: {
        name: "Product launch",
      },
      method: "POST",
    });

    expect(result).toEqual({ id: "broadcast_123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/broadcasts",
      expect.objectContaining({
        body: JSON.stringify({
          name: "Product launch",
        }),
        method: "POST",
      })
    );
  });
});
