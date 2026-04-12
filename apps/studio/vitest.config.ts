import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["types.test.ts"],
    include: ["lib/**/*.test.ts"],
  },
});
