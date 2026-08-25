/**
 * main.ts — Wires engine + render + command together.
 *
 * IMPLEMENTS: PROJECT_BRIEF §4 (entry point). Placeholder only.
 * LAYER: application entry. May touch the DOM — this is the one file allowed to.
 *
 * WHAT THIS IS
 *   A stub: nothing is wired here yet. `render/` is ready to be — camera math
 *   (`render/camera.ts`), `renderDocument` (`render/renderer.ts`, §5.9), hit-testing
 *   (`render/hittest.ts`) and the selection/drag state machine
 *   (`render/interaction.ts`) all exist and all take plain arguments, and
 *   `command/parser.ts` turns a typed line into a command object. What is missing is
 *   on this side of the seam: nothing here listens for a pointer, a key, or a command
 *   line, and no command HANDLER exists to turn a command object into a mutation — so
 *   nothing can create an object and there is nothing for this file to put on screen
 *   but an empty canvas. It exists so the Vite scaffold has a valid entry point and
 *   `npm run dev` / `npm run build` succeed.
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
