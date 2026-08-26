/**
 * main.ts — Wires engine + render + command together, and performs every effect.
 *
 * IMPLEMENTS: PROJECT_BRIEF §4 (entry point), §5.9's event wiring, §5.10's input
 * bar and scrolling log, §5.11's save/load through the DOM. Binding here: D-075
 * and D-082 (performing a `CommandEffect`), D-062 (clamping a loaded camera),
 * D-061 and D-066 (`fit`), D-027 clause 2 (`camera` is written directly, never
 * through `mutate`), D-072 (a canvas pick answers a live prompt step).
 * LAYER: application entry. May touch the DOM — this is the ONE file allowed to,
 *        and the one file no test reaches. May import: engine/*, render/*,
 *        command/*. Imported by nothing.
 *
 * WHAT THIS IS
 *   Two halves, split so the interesting one is testable. `AppState` and the
 *   pure functions over it (`submitLine`, `pointerDownAt`, `performEffect`, …)
 *   hold the whole application: a `Document`, the selection/drag state, the
 *   prompt sequence in progress, and the lines to echo. They take a `Viewport`
 *   and screen-space points as plain numbers and touch no DOM at all. Below
 *   them, `start` builds the canvas, the log and the input bar, listens, calls
 *   into that half, and paints — the only part of this file that knows a browser
 *   exists, and the only part not under test.
 *
 *   `state.document.camera` is ALWAYS inside `[MIN_ZOOM, MAX_ZOOM]`: every
 *   camera entering this file goes through `render/camera.ts`'s `clampCamera` or
 *   comes out of one of its producers (D-062). Nothing downstream re-checks it.
 *
 * INVARIANTS UPHELD HERE
 *   - Every document state change goes through `executeCommand` or
 *     `render/interaction.ts`, both of which call `mutate` (Rule 2). The one
 *     field this file writes directly is `camera`, which D-027 clause 2 and
 *     D-075 clause 5 keep OUT of `mutate` — it is view state, not graph state.
 *   - An effect is performed through a `switch` on `kind` with the `never`
 *     default (D-082 clause 3), because `effect` is optional on the success arm
 *     and a missing arm would otherwise be silent rather than a compile error.
 *   - This file resolves NO name and re-derives no identity (D-082 clause 4): an
 *     effect names an object by ID and that ID is used as handed over.
 *   - A pick on the canvas during a live prompt sequence is a `picked` response,
 *     never a selection (D-072); screen->world happens here, via
 *     `render/camera.ts`, so `command/` only ever sees a world point (D-069).
 *
 * NOT DONE HERE
 *   - §5.9's visual feedback trio — selection highlight, error badge,
 *     formula-driven indicator. D-068 keeps all three together in ONE cycle in
 *     `render/renderer.ts`, so a selection made here is currently invisible.
 *     That cycle also owns the transform reset before screen-space chrome; this
 *     file draws no chrome, so nothing here needs one yet.
 *   - Injecting a Canvas2D `TextMeasurer` (Rule 1). Nothing evaluates text yet —
 *     §5.6 is Phase 5 — so there is no `EvalContext` to inject one into.
 *   - Validating a LOADED document beyond what `loadDocument` checks. D-081 and
 *     D-083 clause 4 are owed by a `document.ts` cycle, not by this one; see
 *     STATUS.md's known problems for what that leaves reachable from the Load
 *     button.
 *   - Throttling drag mutations to animation frames (§5.9's perf note). One
 *     `mutate` per pointer move, as specified — a fix MUST throttle and MUST NOT
 *     write outside the mutation API.
 */
import { createEmptyDocument, loadDocument, saveDocument, type CameraState, type Document } from "./engine/document.ts";
import { executeCommand, type CommandEffect } from "./command/commands.ts";
import { beginCommand, cancelCommand, respond, type CommandSession, type PendingCommand, type PromptResponse } from "./command/prompt.ts";
import { clampCamera, clampZoom, panByScreenDelta, screenToWorld, zoomAtScreenPoint, MAX_ZOOM, MIN_ZOOM, type ScreenPoint } from "./render/camera.ts";
import { documentExtent } from "./render/hittest.ts";
import { deselect, pointerDown, pointerMove, pointerUp, INITIAL_INTERACTION_STATE, type InteractionState } from "./render/interaction.ts";
import { renderDocument } from "./render/renderer.ts";

// ---------------------------------------------------------------------------
// The pure half — application state, and every transition over it
// ---------------------------------------------------------------------------

/** The canvas's current pixel size. Supplied per call rather than stored, because the browser may resize it between any two events (D-061: the camera itself needs no viewport size). */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * Everything the application holds. Plain data, like every other state shape in
 * this codebase — the DOM half below keeps exactly one of these in one variable
 * and replaces it wholesale, so there is no second place a change can hide.
 *
 * `pending` is the prompt sequence in progress (D-072), `undefined` when the
 * input bar is waiting for a fresh command word. `log` is §5.10's scrolling
 * echo, oldest first.
 */
export interface AppState {
  readonly document: Document;
  readonly interaction: InteractionState;
  readonly pending: PendingCommand | undefined;
  readonly log: readonly string[];
}

/** What §5.11 asks the DOM half to do with a file. `save`/`load` are the only two effects this file cannot finish on its own. */
export type FileRequest = "save" | "load";

/**
 * A transition's result: the new state, plus a file request when the operator
 * asked for one.
 *
 * Why the request travels back out rather than being done in place: the pure
 * half cannot open a file picker, and returning a description keeps every
 * transition testable — the same reason `commands.ts` returns an effect instead
 * of performing one (D-075).
 */
export interface AppTransition {
  readonly state: AppState;
  readonly fileRequest: FileRequest | undefined;
}

/**
 * The state a document opens in: nothing selected, no command in progress, and
 * a camera brought inside `render/`'s zoom range (D-062).
 *
 * Every path that replaces the whole document — startup, and a `load` — comes
 * through here, which is what makes "the camera in `AppState` is always usable"
 * a property of this file rather than a thing each caller remembers.
 */
export function initialAppState(document: Document, log: readonly string[] = []): AppState {
  return {
    document: { ...document, camera: clampCamera(document.camera) },
    interaction: INITIAL_INTERACTION_STATE,
    pending: undefined,
    log,
  };
}

/**
 * A state whose document carries `camera`. The ONE direct state write in this
 * file, and deliberately so: D-027 clause 2 and D-075 clause 5 both put the
 * camera outside the mutation channel, because it is view state that no slot can
 * read and no edge can point at. Every camera change goes through here;
 * `initialAppState` sets the other one, which is D-062's clamping boundary.
 */
function withCamera(state: AppState, camera: CameraState): AppState {
  return { ...state, document: { ...state.document, camera } };
}

/** A state with `lines` appended to the log — §5.10's "echo results and errors in a small scrolling log above the input". */
function withLog(state: AppState, lines: readonly string[]): AppState {
  return lines.length === 0 ? state : { ...state, log: [...state.log, ...lines] };
}

/** A transition that changed state and asked for no file. */
function transition(state: AppState): AppTransition {
  return { state, fileRequest: undefined };
}

/**
 * Runs one line from the input bar (§5.10).
 *
 * Routes to `respond` when a prompt sequence is live and to `beginCommand`
 * otherwise, so the operator's Enter key means the same thing in both cases and
 * `command/prompt.ts` stays the one entry point for a typed line (D-072).
 *
 * A blank line during a live sequence is not sent as an answer: `respond` would
 * refuse it, and an empty input bar is how AutoCAD accepts a default. It is
 * routed as a typed empty answer anyway rather than special-cased here, because
 * the default belongs to the STEP and only `prompt.ts` can read it.
 */
export function submitLine(state: AppState, line: string, viewport: Viewport): AppTransition {
  const echoed = withLog(state, [`> ${line}`]);
  if (state.pending !== undefined) {
    return advance(echoed, respond(state.pending, { kind: "typed", text: line }), viewport);
  }
  return advance(echoed, beginCommand(line), viewport);
}

/**
 * Answers the live prompt step with a canvas pick (D-072: "every prompt accepts
 * a typed value or a picked point").
 *
 * A no-op when no sequence is live — the caller checks first and selects
 * instead, but this is total so that a race between a click and a cancel cannot
 * misroute a point into a command that is no longer running.
 */
export function respondToPrompt(state: AppState, response: PromptResponse, viewport: Viewport): AppTransition {
  if (state.pending === undefined) {
    return transition(state);
  }
  return advance(state, respond(state.pending, response), viewport);
}

/** Abandons a live prompt sequence (D-072 clause 7 — the only path that discards gathered answers), and clears the selection: §5.9's "escape to deselect", one key doing both. */
export function escape(state: AppState): AppState {
  const cancelled = state.pending === undefined ? state : withLog({ ...state, pending: undefined }, [sessionMessage(cancelCommand())]);
  return { ...cancelled, interaction: deselect() };
}

/**
 * Where a `CommandSession` becomes new application state.
 *
 * The four statuses are the whole protocol: a finished command goes to
 * `executeCommand` (D-069 — the only place a `Command` meets a `Document`), a
 * prompting one is held in `pending` and its message echoed, and a failed or
 * cancelled one clears `pending` and echoes why.
 */
function advance(state: AppState, session: CommandSession, viewport: Viewport): AppTransition {
  switch (session.status) {
    case "complete": {
      const cleared: AppState = { ...state, pending: undefined };
      const outcome = executeCommand(session.command, cleared.document);
      if (!outcome.ok) {
        return transition(withLog(cleared, [outcome.message]));
      }
      const executed = withLog({ ...cleared, document: outcome.document }, outcome.lines);
      // The document part is done; the rest is this file's (D-075 clause 3).
      return outcome.effect === undefined ? transition(executed) : performEffect(outcome.effect, executed, viewport);
    }
    case "prompting":
      return transition(withLog({ ...state, pending: session.pending }, sessionLines(session)));
    case "failed":
    case "cancelled":
      return transition(withLog({ ...state, pending: undefined }, [sessionMessage(session)]));
    default: {
      const exhaustive: never = session;
      void exhaustive;
      return transition(state);
    }
  }
}

/** A prompting session's echo: the refusal first when the previous answer was refused, then the step being asked again (D-074 — the sequence's own message, never one re-read from elsewhere). */
function sessionLines(session: Extract<CommandSession, { status: "prompting" }>): readonly string[] {
  return session.error === undefined ? [session.message] : [session.error, session.message];
}

/** The one line a non-prompting session echoes. */
function sessionMessage(session: CommandSession): string {
  switch (session.status) {
    case "failed":
      return session.message;
    case "cancelled":
      return "cancelled";
    case "prompting":
      return session.message;
    case "complete":
      return "";
    default: {
      const exhaustive: never = session;
      void exhaustive;
      return "";
    }
  }
}

// ---------------------------------------------------------------------------
// Performing an effect (D-075 clause 3, D-082 clauses 3-5)
// ---------------------------------------------------------------------------

/**
 * §5.10's `fit` leaves this much of the viewport around the document's extent.
 * Untuned (Rule 5): fitting to the exact edges would half-clip the strokes of
 * the outermost objects, since a stroke straddles its own path.
 */
export const FIT_VIEWPORT_FRACTION = 0.9;

/** §5.9's "zoom to cursor (wheel)" step. One wheel notch multiplies or divides the zoom by this; untuned, and the file that owns the transform deliberately does not interpret wheel deltas (`render/camera.ts`'s NOT DONE HERE). */
export const WHEEL_ZOOM_STEP = 1.1;

/**
 * Performs one `CommandEffect` (D-075 clause 3).
 *
 * The `switch` is exhaustive with a `never` default, and that is required rather
 * than stylistic: `effect` is OPTIONAL on `CommandOutcome`'s success arm, so a
 * new effect kind would otherwise be dropped here in silence (D-082 clause 3).
 *
 * Resolves no name and re-derives no identity — `select` uses the ID it was
 * handed (D-082 clause 4). Reports the RESULT where `commands.ts` could only
 * echo the request: a clamped zoom, and a degenerate extent (clause 5).
 */
export function performEffect(effect: CommandEffect, state: AppState, viewport: Viewport): AppTransition {
  switch (effect.kind) {
    case "select":
      // The drag is cleared, not carried: a selection made from the input bar
      // has no pointer holding it, and `render/interaction.ts`'s `DragState`
      // means "a pointer is dragging this right now".
      return transition({ ...state, interaction: { selectedObjectId: effect.objectId, drag: undefined } });
    case "zoom":
      return transition(zoomBy(state, effect.factor, viewport));
    case "fit":
      return transition(fitToDocument(state, viewport));
    case "save":
      return { state, fileRequest: "save" };
    case "load":
      return { state, fileRequest: "load" };
    default: {
      const exhaustive: never = effect;
      void exhaustive;
      return transition(state);
    }
  }
}

/**
 * `zoom <factor>`, about the viewport's centre — a typed command has no cursor
 * to zoom toward, and the centre is the only point on screen that does not
 * depend on where the mouse happens to be.
 *
 * `commands.ts` has already refused a factor that is not a positive finite
 * multiplier (D-082 clause 1); what is left for this side is the RANGE, which
 * `zoomAtScreenPoint` clamps, and reporting what the camera actually did.
 */
function zoomBy(state: AppState, factor: number, viewport: Viewport): AppState {
  const camera = state.document.camera;
  const requested = camera.zoom * factor;
  const zoomed = zoomAtScreenPoint(camera, { x: viewport.width / 2, y: viewport.height / 2 }, requested);
  return withLog(withCamera(state, zoomed), [describeZoom(zoomed.zoom, requested)]);
}

/**
 * §5.10's `fit`: every object that draws something, inside the viewport.
 *
 * D-066's guard, which `commands.ts` explicitly does NOT discharge by refusing
 * an empty document: an extent can also be a single POINT (one circle of radius
 * 0, or a document whose objects sit on top of each other), and dividing the
 * viewport by a zero extent is what produces the `Infinity` zoom D-027 wrote
 * `finiteOrFallback` for. A degenerate extent centres at the CURRENT zoom
 * instead, which is the only reading of "fit" that means anything for a point.
 */
function fitToDocument(state: AppState, viewport: Viewport): AppState {
  const camera = state.document.camera;
  const extent = documentExtent(state.document.objects);
  if (extent === undefined) {
    // `commands.ts` refused the EMPTY document (D-082 clause 1); this is the
    // other emptiness — objects exist, none of them draws anything.
    return withLog(state, ["nothing on the canvas has an extent to fit to"]);
  }
  const width = extent.maxX - extent.minX;
  const height = extent.maxY - extent.minY;
  const fits = width > 0 && height > 0 && viewport.width > 0 && viewport.height > 0;
  const zoom = fits
    ? clampZoom(Math.min((viewport.width * FIT_VIEWPORT_FRACTION) / width, (viewport.height * FIT_VIEWPORT_FRACTION) / height), camera.zoom)
    : camera.zoom;
  const centreX = (extent.minX + extent.maxX) / 2;
  const centreY = (extent.minY + extent.maxY) / 2;
  // The world point that must land at the screen's centre, expressed as the
  // world point at the screen's TOP-LEFT corner — which is what `camera.x`/`.y`
  // mean (D-061). Clamped rather than trusted: `viewport` comes from the DOM.
  const fitted = clampCamera({ x: centreX - viewport.width / (2 * zoom), y: centreY - viewport.height / (2 * zoom), zoom });
  const line = fits ? describeZoom(fitted.zoom, fitted.zoom) : `the document's extent is a single point — centred it at zoom ${fitted.zoom}`;
  return withLog(withCamera(state, fitted), [line]);
}

/** What the camera actually did, which is this file's to report and not `commands.ts`'s to predict (D-082 clause 5). */
function describeZoom(actual: number, requested: number): string {
  return actual === requested ? `zoom is now ${actual}` : `zoom is now ${actual} — clamped to the ${MIN_ZOOM}-${MAX_ZOOM} range`;
}

// ---------------------------------------------------------------------------
// Pointer and wheel (§5.9)
// ---------------------------------------------------------------------------

/**
 * A press on the canvas: an answer to the live prompt step if there is one
 * (D-072), and otherwise §5.9's "click to select", which also arms a drag.
 *
 * The screen->world conversion for a pick happens HERE, through
 * `render/camera.ts`, because `command/` may never import `render/` and must
 * receive a world point (D-069, D-072).
 */
export function pointerDownAt(state: AppState, screenPoint: ScreenPoint, viewport: Viewport): AppTransition {
  if (state.pending !== undefined) {
    const world = screenToWorld(state.document.camera, screenPoint);
    return respondToPrompt(state, { kind: "picked", point: { x: world.x, y: world.y } }, viewport);
  }
  return transition({ ...state, interaction: pointerDown(screenPoint, state.document.objects, state.document.camera) });
}

/**
 * A pointer move (§5.9's per-component drag). A no-op unless a drag is running,
 * which is what lets the DOM half wire it unconditionally.
 *
 * Notices and a rejection both reach the log: §5.9 asks for "non-blocking
 * feedback" on a component that is driven, and `mutate`'s own refusal is a
 * different thing that must not be swallowed.
 */
export function pointerMoveTo(state: AppState, screenPoint: ScreenPoint): AppState {
  const outcome = pointerMove(state.interaction, screenPoint, state.document.objects, state.document.journal, state.document.camera);
  const moved: AppState = {
    ...state,
    document: { ...state.document, objects: outcome.objects, journal: outcome.journal },
    interaction: outcome.state,
  };
  const lines = outcome.rejection === undefined ? outcome.notices : [...outcome.notices, outcome.rejection];
  return withLog(moved, lines);
}

/** A pointer release: ends the drag, keeps the selection (§5.9 separates selecting from moving). */
export function pointerUpNow(state: AppState): AppState {
  return { ...state, interaction: pointerUp(state.interaction) };
}

/** §5.9's "zoom to cursor (wheel)". A negative `wheelDeltaY` (scroll up, the browser's own sign) zooms IN, matching every other canvas application. */
export function wheelZoomAt(state: AppState, screenPoint: ScreenPoint, wheelDeltaY: number): AppState {
  const camera = state.document.camera;
  const factor = wheelDeltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
  return withCamera(state, zoomAtScreenPoint(camera, screenPoint, camera.zoom * factor));
}

/** §5.9's pan, by a screen-space drag delta. The content follows the pointer at any zoom — `render/camera.ts` owns that arithmetic. */
export function panByScreen(state: AppState, dxScreen: number, dyScreen: number): AppState {
  return withCamera(state, panByScreenDelta(state.document.camera, dxScreen, dyScreen));
}

/** One line into §5.10's log, for something that happened outside a command — a refused file, say. */
export function logLine(state: AppState, line: string): AppState {
  return withLog(state, [line]);
}

/** Replaces the whole document — §5.11's load, and startup. Keeps the log, because the lines already echoed are a record of what the operator did, not of what the document contains. */
export function replaceDocument(state: AppState, document: Document, line: string): AppState {
  return withLog(initialAppState(document, state.log), [line]);
}

// ---------------------------------------------------------------------------
// The DOM half — the only part of this file that knows a browser exists
// ---------------------------------------------------------------------------
//
// NOTE ON ONE NAME: the global `document` below is the BROWSER's document. The
// project's own `Document` (§5.11) is a TYPE and lives on `state.document`.
// They never collide in the compiler (one is a value, the other a type), and
// this comment exists so they do not collide in a reader either.

/** Where the pan gesture stands. §5.9: "pan (middle-drag or space-drag)" — both produce the same screen-space delta. */
interface PanGesture {
  readonly lastScreenX: number;
  readonly lastScreenY: number;
}

/**
 * Builds the canvas, the log and the input bar, wires every listener, and paints
 * (§5.9, §5.10).
 *
 * Untested, and that is a real gap rather than an accepted one: it needs a DOM,
 * and adding one to the test environment is a dependency this project has not
 * taken. Everything it can do without a browser lives above, so what remains
 * here is listener wiring and drawing — checked by hand, described in the log
 * entry, and NOT covered by any assertion.
 */
function start(canvas: HTMLCanvasElement, logElement: HTMLElement, input: HTMLInputElement): void {
  const context = canvas.getContext("2d");
  if (context === null) {
    logElement.textContent = "this browser gave no 2D canvas context — nothing can be drawn";
    return;
  }

  let state = initialAppState(createEmptyDocument(), ["Graphpaper. Type a command, or a command word alone to be prompted."]);
  let pan: PanGesture | undefined;
  let spaceHeld = false;

  const viewport = (): Viewport => ({ width: canvas.width, height: canvas.height });
  const screenPointOf = (event: PointerEvent | WheelEvent): ScreenPoint => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const paint = (): void => {
    renderDocument(context, canvas.width, canvas.height, state.document.objects, state.document.camera);
  };

  const apply = (next: AppState): void => {
    state = next;
    drawLog(logElement, state.log);
    paint();
  };

  const applyTransition = (next: AppTransition): void => {
    apply(next.state);
    if (next.fileRequest === "save") {
      downloadDocument(state.document);
    } else if (next.fileRequest === "load") {
      openDocument(
        (loaded, line) => apply(replaceDocument(state, loaded, line)),
        (message) => apply(logLine(state, message)),
      );
    }
  };

  const resize = (): void => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    paint();
  };

  window.addEventListener("resize", resize);

  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") {
      return;
    }
    const line = input.value;
    input.value = "";
    applyTransition(submitLine(state, line, viewport()));
  });

  // §5.10: the input bar is "always focused when the user is not editing text or
  // a cell" — neither of which exists yet, so it is simply always focused.
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      apply(escape(state));
      return;
    }
    if (event.key === " " && event.target !== input) {
      spaceHeld = true;
    }
  });
  window.addEventListener("keyup", (event: KeyboardEvent) => {
    if (event.key === " ") {
      spaceHeld = false;
    }
  });

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 1 || spaceHeld) {
      pan = { lastScreenX: event.clientX, lastScreenY: event.clientY };
      return;
    }
    applyTransition(pointerDownAt(state, screenPointOf(event), viewport()));
    input.focus();
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (pan !== undefined) {
      apply(panByScreen(state, event.clientX - pan.lastScreenX, event.clientY - pan.lastScreenY));
      pan = { lastScreenX: event.clientX, lastScreenY: event.clientY };
      return;
    }
    apply(pointerMoveTo(state, screenPointOf(event)));
  });

  const endGesture = (event: PointerEvent): void => {
    canvas.releasePointerCapture(event.pointerId);
    pan = undefined;
    apply(pointerUpNow(state));
  };
  canvas.addEventListener("pointerup", endGesture);
  canvas.addEventListener("pointercancel", endGesture);

  canvas.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      event.preventDefault();
      apply(wheelZoomAt(state, screenPointOf(event), event.deltaY));
    },
    { passive: false },
  );

  resize();
  apply(state);
  input.focus();
}

/** §5.10's scrolling log, redrawn whole. Immediate-mode, like the canvas: there is no diffing here and nothing to keep in sync. */
function drawLog(logElement: HTMLElement, lines: readonly string[]): void {
  logElement.textContent = lines.join("\n");
  logElement.scrollTop = logElement.scrollHeight;
}

/** §5.11's "save via JSON download". */
function downloadDocument(state: Document): void {
  const url = URL.createObjectURL(new Blob([saveDocument(state)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "graphpaper.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * §5.11's "load via file input".
 *
 * A refused file reports its reason and changes nothing — `deserializeDocument`
 * is the boundary that decides, and this half neither re-checks it nor repairs
 * it. `onLoaded` receives the document only when there is one; `onRefused`
 * receives the message otherwise, so a caller cannot accidentally treat a
 * failure as a load.
 */
function openDocument(onLoaded: (loaded: Document, line: string) => void, onRefused: (message: string) => void): void {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "application/json,.json";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (file === undefined) {
      return; // The picker was dismissed — not a refusal, and nothing to say.
    }
    void file.text().then((text) => {
      const result = loadDocument(text);
      if (result.ok) {
        onLoaded(result.document, `loaded ${file.name}`);
        return;
      }
      onRefused(result.message);
    });
  });
  picker.click();
}

// The bootstrap. Guarded so that importing this module in a headless test
// environment (`vitest` runs `node`) reaches the pure half above without
// touching a DOM that is not there.
if (typeof document !== "undefined") {
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  const logElement = document.querySelector<HTMLElement>("#log");
  const input = document.querySelector<HTMLInputElement>("#command");
  if (canvas !== null && logElement !== null && input !== null) {
    start(canvas, logElement, input);
  }
}
