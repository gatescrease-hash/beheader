import { defineConfig } from "vite";

// The Vite config for the dev server and the build. The Vitest settings sit
// here too, because the two share no options that clash.
//
// `base` differs between the dev server and the production build. GitHub
// Pages serves a project site under a path (`/beheader-clean/`), not at the
// domain root, so every asset link in the built `index.html` must carry that
// prefix. The dev server has no such prefix, so it stays at `/`.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/beheader-clean/" : "/",
  test: {
    // The engine is pure logic and needs no DOM. A render test that needs one
    // can ask for it with a jsdom environment comment at the top of the file.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
