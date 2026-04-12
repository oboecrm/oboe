# @oboe/plugin-form-builder

Dynamic form builder plugin for Oboe.

This package adds:

- a managed `forms` collection
- a managed `form-submissions` collection
- a public form schema route
- a public submission route
- a Payload-like builder view for editing form definitions in the admin

## Install

```bash
pnpm add @oboe/plugin-form-builder
```

## Basic usage

```ts
import { defineConfig, defineModule } from "@oboe/core";
import { formBuilderPlugin } from "@oboe/plugin-form-builder";

export default defineConfig({
  modules: [
    defineModule({
      collections: [],
      slug: "crm",
    }),
  ],
  plugins: [
    formBuilderPlugin(),
  ],
});
```
