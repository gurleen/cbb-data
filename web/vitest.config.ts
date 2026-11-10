import { defineConfig } from "vitest/config";

// Unit tests run in Node (no Workers runtime needed); keep them free of route imports.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["src/**/*.test.{ts,tsx}"], environment: "node" },
});
