import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "miniflare",
    include: ["test/**/*.test.ts"],
    globals: true,
  },
});
