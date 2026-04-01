import { describe, expect, it } from "vitest";

import { defineConfig, defineModule } from "./config.js";
import { compileSchema } from "./schema.js";

describe("defineConfig", () => {
  it("keeps module and admin view metadata intact", () => {
    const config = defineConfig({
      admin: {
        views: {
          timeline: {
            component: "timeline-view",
            label: "Timeline",
            path: "/timeline",
          },
        },
      },
      modules: [
        defineModule({
          collections: [
            {
              admin: {
                views: {
                  pipeline: {
                    component: "pipeline-view",
                    label: "Pipeline",
                    path: "/pipeline",
                  },
                },
              },
              fields: [
                {
                  name: "name",
                  type: "text",
                },
              ],
              slug: "deals",
            },
          ],
          label: "Revenue",
          slug: "sales",
        }),
      ],
    });

    const schema = compileSchema(config);
    const deals = schema.collections.get("deals");

    expect(schema.modules.get("sales")?.label).toBe("Revenue");
    expect(deals?.moduleSlug).toBe("sales");
    expect(deals?.admin?.views?.timeline?.path).toBe("/timeline");
    expect(deals?.admin?.views?.pipeline?.path).toBe("/pipeline");
  });
});
