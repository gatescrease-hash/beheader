/**
 * main.ts — Wires engine + render + command together.
 *
 * IMPLEMENTS: PROJECT_BRIEF §4 (entry point). Placeholder only.
 * LAYER: application entry. May touch the DOM — this is the one file allowed to.
 *
 * WHAT THIS IS
 *   A stub: nothing is wired here yet. Both sides of the seam are ready to be —
 *   camera math (`render/camera.ts`), `renderDocument` (`render/renderer.ts`, §5.9),
 *   hit-testing (`render/hittest.ts`) and the selection/drag state machine
 *   (`render/interaction.ts`) all take plain arguments, while `command/parser.ts` and
 *   `command/prompt.ts` turn a typed or picked line into a command object and
 *   `command/commands.ts` runs the creation commands against a document. What is
 *   missing is only on THIS side: nothing here holds a canvas, a document, or an
 *   input bar, and nothing listens for a pointer or a key, so none of the above is
 *   ever called. It exists so the Vite scaffold has a valid entry point and
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
