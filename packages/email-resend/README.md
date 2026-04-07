# @oboe/email-resend

Resend email provider for Oboe.

This package wires the Resend Email API into Oboe's common `sendEmail` interface while still exposing a low-level Resend client for provider-specific features such as broadcasts and custom endpoints.

## Install

```bash
pnpm add @oboe/email-resend
```

## Basic Usage

```ts
import { defineConfig, defineModule } from "@oboe/core";
import { resendEmail } from "@oboe/email-resend";

export default defineConfig({
  modules: [
    defineModule({
      slug: "crm",
      collections: [],
    }),
  ],
  plugins: [
    resendEmail({
      apiKey: process.env.RESEND_API_KEY!,
      defaultFromAddress: "info@oboe.dev",
      defaultFromName: "Oboe",
    }),
  ],
});
```

## Runtime Usage

```ts
await oboe.sendEmail({
  to: "dev@example.com",
  subject: "Hello",
  text: "It works.",
});
```

## Resend Client Access

```ts
import { getResendClient } from "@oboe/email-resend";

const resend = getResendClient(oboe);

await resend?.request("/broadcasts", {
  method: "POST",
  body: {
    name: "Launch campaign",
  },
});
```

## Options

```ts
type ResendAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  defaultFromAddress: string;
  defaultFromName: string;
};
```

Notes:

- `baseUrl` defaults to `https://api.resend.com`
- `oboe.sendEmail()` stays provider-agnostic
- provider-specific calls should go through `getResendClient(oboe)` or `createResendClient(...)`
