import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// The Vite config for the dev server and the build. The Vitest settings are
// in this file too, because the two share no options that clash. `base`
// differs between the dev server and the production build. GitHub Pages
// serves a project site under a path (`/beheader/`), and not at the
// domain root. So every asset link in the built `index.html` carries that
// prefix. The dev server has no such prefix, so it stays at `/`.
//
// The script worker loads Pyodide from `pyodide/` beside the page.
// pyodideAssets serves the five files that interpreter needs from the npm
// package while the dev server runs, and copies them into the build, so a
// script runs with no network at all. The worker is an ES module because it
// imports the interpreter at run time.
const PYODIDE_FILES: Readonly<Record<string, string>> = {
  "pyodide.mjs": "text/javascript",
  "pyodide.asm.mjs": "text/javascript",
  "pyodide.asm.wasm": "application/wasm",
  "python_stdlib.zip": "application/zip",
  "pyodide-lock.json": "application/json",
};

function pyodideAssets(): Plugin {
  const folder = resolve("node_modules/pyodide");
  return {
    name: "beheader-pyodide-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/pyodide\/([^?]+)/.exec(request.url ?? "");
        const type = match === null ? undefined : PYODIDE_FILES[match[1]!];
        if (match === null || type === undefined) {
          next();
          return;
        }
        response.setHeader("Content-Type", type);
        response.end(readFileSync(resolve(folder, match[1]!)));
      });
    },
    generateBundle() {
      for (const name of Object.keys(PYODIDE_FILES)) {
        this.emitFile({ type: "asset", fileName: `pyodide/${name}`, source: readFileSync(resolve(folder, name)) });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/beheader/" : "/",
  plugins: [pyodideAssets()],
  worker: { format: "es" },
  test: {
    // The engine is pure logic and does not touch the DOM. A render test that
    // needs one can ask for it with a jsdom environment comment at the top of
    // the file.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
