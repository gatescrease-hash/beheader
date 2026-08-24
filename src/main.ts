/**
 * main.ts — Wires engine + render + command together.
 *
 * IMPLEMENTS: PROJECT_BRIEF §4 (entry point). Placeholder only.
 * LAYER: application entry. May touch the DOM — this is the one file allowed to.
 *
 * WHAT THIS IS
 *   A stub. `render/` and `command/` do not exist yet, so there is nothing to wire.
 *   This file exists so the Vite scaffold has a valid entry point and `npm run dev` /
 *   `npm run build` succeed.
 *
 * NOT DONE HERE
 *   Everything. Wiring begins in Phase 3 (PROJECT_BRIEF §6), once render/ and command/
 *   exist. See STATUS.md for where the project actually is.
 */

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.textContent = "Graphpaper — engine under construction.";
}
