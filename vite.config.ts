import { defineConfig } from "vite";

// The Vite config for the dev server and the build. The Vitest settings sit
// here too, because the two share no options that clash.
export default defineConfig({
  test: {
    // The engine is pure logic and needs no DOM. A render test that needs one
    // can ask for it with a jsdom environment comment at the top of the file.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
