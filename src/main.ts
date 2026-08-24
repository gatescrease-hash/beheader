/**
 * main.ts — Wires engine + render + command together.
 *
 * IMPLEMENTS: PROJECT_BRIEF §4 (entry point). Placeholder only.
 * LAYER: application entry. May touch the DOM — this is the one file allowed to.
 *
 * WHAT THIS IS
 *   A stub. `render/` holds camera math only (`render/camera.ts`, §5.9) and there is
 *   no renderer or `command/` yet, so nothing here has anything to wire together.
 *   This file exists so the Vite scaffold has a valid entry point and `npm run dev` /
 *   `npm run build` succeed.
 *
 * NOT DONE HERE
 *   Everything, including injecting the Canvas2D `TextMeasurer` the engine takes
 *   through its evaluation context (Rule 1) — that arrives with the renderer.
 *   See STATUS.md for where the project actually is.
 */

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.textContent = "Graphpaper — engine under construction.";
}
