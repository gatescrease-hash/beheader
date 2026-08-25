/**
 * main.ts — Wires engine + render + command together.
 *
 * IMPLEMENTS: PROJECT_BRIEF §4 (entry point). Placeholder only.
 * LAYER: application entry. May touch the DOM — this is the one file allowed to.
 *
 * WHAT THIS IS
 *   A stub. `render/` holds camera math (`render/camera.ts`) and a ready-to-wire
 *   `renderDocument` (`render/renderer.ts`, §5.9), but there is no `command/` yet —
 *   so there is no way for a user to create an object, and nothing for this file to
 *   put on screen but an empty canvas. This file exists so the Vite scaffold has a
 *   valid entry point and `npm run dev` / `npm run build` succeed.
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
