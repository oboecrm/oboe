# @oboe/plugin-email

Low-level email plugin for Oboe.

Use this package when you want to attach a custom email adapter to the Oboe runtime. If you only need Resend, prefer [`@oboe/email-resend`](../email-resend/README.md).

## Install

```bash
pnpm add @oboe/plugin-email
```

## Basic Usage

```ts
import { defineConfig, defineModule } from "@oboe/core";
import { emailPlugin, type EmailAdapter } from "@oboe/plugin-email";

const memoryEmailAdapter: EmailAdapter = () => ({
  defaultFromAddress: "info@oboe.dev",
  defaultFromName: "Oboe",
  name: "memory-email",
  async sendEmail(message) {
    console.log(message);
    return { accepted: true };
  },
});

export default defineConfig({
  modules: [
    defineModule({
      slug: "crm",
      collections: [],
    }),
  ],
  plugins: [
    emailPlugin({
      adapter: memoryEmailAdapter,
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

## Options

```ts
type EmailPluginOptions = {
  adapter: EmailAdapter | Promise<EmailAdapter>;
  enabled?: boolean;
};
```

Notes:

- `enabled: false` disables adapter injection cleanly
- `adapter` may be async, which allows provider clients to bootstrap before runtime initialization
