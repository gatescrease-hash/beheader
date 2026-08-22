/**
 * main.ts — Wires engine + render + command together.
 *
 * IMPLEMENTS: PROJECT_BRIEF §4 (entry point). Placeholder only.
 * LAYER: application entry. May touch the DOM — this is the one file allowed to.
 *
 * WHAT THIS IS
 *   Currently a stub. Phase 0 (this cycle) builds only address.ts; there is no engine,
 *   renderer, or command module to wire in yet. This file exists so the Vite scaffold
 *   has a valid entry point and `npm run dev` / `npm run build` succeed.
 *
 * NOT DONE HERE
 *   Everything. Wiring begins in Phase 3 (PROJECT_BRIEF §6) once render/ and command/
 *   exist.
 */

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.textContent = "Graphpaper — engine under construction (Phase 0).";
}
