import { describe, expect, it } from "vitest";

import type { DatabaseAdapter } from "../types.js";

export function runDatabaseAdapterContract(args: {
  createAdapter: () => DatabaseAdapter;
  name: string;
}) {
  describe(args.name, () => {
    it("supports create, read, update, and delete", async () => {
      const adapter = args.createAdapter();
      const created = await adapter.create({
        collection: "contacts",
        data: {
          email: "dev@oboecrm.dev",
          name: "Oboe Dev",
        },
      });

      const listed = await adapter.find({
        collection: "contacts",
      });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(created.id);

      const updated = await adapter.update({
        collection: "contacts",
        data: {
          name: "Updated Dev",
        },
        id: created.id,
      });
      expect(updated?.data.name).toBe("Updated Dev");

      const deleted = await adapter.delete({
        collection: "contacts",
        id: created.id,
      });
      expect(deleted?.id).toBe(created.id);
      expect(
        await adapter.find({
          collection: "contacts",
        })
      ).toHaveLength(0);
    });

    it("supports global read and update", async () => {
      const adapter = args.createAdapter();
      expect(
        await adapter.findGlobal({
          slug: "site-settings",
        })
      ).toBeNull();

      const updated = await adapter.updateGlobal({
        data: {
          title: "Oboe",
        },
        slug: "site-settings",
      });

      expect(updated.data.title).toBe("Oboe");
      expect(
        await adapter.findGlobal({
          slug: "site-settings",
        })
      ).toMatchObject({
        data: {
          title: "Oboe",
        },
        slug: "site-settings",
      });
    });
  });
}
