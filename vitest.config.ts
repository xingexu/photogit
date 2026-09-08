import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "cli/**/*.test.ts", "apps/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] }
  }
});
