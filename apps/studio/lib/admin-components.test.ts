import { describe, expect, it } from "vitest";

import { resolveAdminComponent } from "./admin-components";

describe("resolveAdminComponent", () => {
  it("resolves admin-next exports", async () => {
    const component = await resolveAdminComponent(
      "@oboe/admin-next#PipelineView"
    );

    expect(typeof component).toBe("function");
  });

  it("resolves plugin form builder exports", async () => {
    const component = await resolveAdminComponent(
      "@oboe/plugin-form-builder#FormBuilderView"
    );

    expect(typeof component).toBe("function");
  });

  it("throws for unsupported packages", async () => {
    await expect(
      resolveAdminComponent("@unsupported/package#Widget")
    ).rejects.toThrow(
      'Unsupported admin component reference "@unsupported/package".'
    );
  });
});
