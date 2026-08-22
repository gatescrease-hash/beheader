import { defineConfig } from "vite";

// Vite dev/build config. Vitest config is colocated here (D-001) rather than in a
// separate vitest.config.ts, since the two share no conflicting options at this stage.
export default defineConfig({
  test: {
    // src/engine/ is pure logic (Rule 1) and needs no DOM to test. Individual test
    // files under src/render/ may opt into `// @vitest-environment jsdom` later.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
