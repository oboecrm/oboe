import { defineConfig, defineModule } from "@oboe/core";

export default defineConfig({
  modules: [
    defineModule({
      collections: [
        {
          fields: [
            {
              name: "name",
              type: "text",
            },
          ],
          slug: "contacts",
        },
      ],
      slug: "crm",
    }),
  ],
});
