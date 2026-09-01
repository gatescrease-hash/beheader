/**
 * main.ts — Wires engine + render + command together, and performs every effect.
 *
 * IMPLEMENTS: PROJECT_BRIEF §4 (entry point), §5.9's event wiring, §5.10's input
 * bar and scrolling log, §5.11's save/load through the DOM. Binding here: D-075
 * and D-082 (performing a `CommandEffect`), D-062 (clamping a loaded camera),
 * D-061 and D-066 (`fit`), D-027 clause 2 (`camera` is written directly, never
 * through `mutate`), D-072 (a canvas pick answers a live prompt step), D-101
 * (one properties panel per selected object, dragged by its header), D-106
 * (every selected object's panel shows by default; a dismiss control hides one
 * without deselecting, and a dismissed object's canvas name returns),
 * **D-102** (the panel becomes WRITABLE: a paperclip per modifiable row, every
 * write the `Command` the command line would have built, run through
 * `executeCommand` — never `mutate`, never `writeSlot`), **D-107** (a
 * panel gesture never leaves the command bar's keyboard homeless, and a
 * handler bound to DOM a repaint can destroy acts only while it still owns
 * what it names), and **D-109** clause 3 (a refused line stays in the input;
 * only an accepted one clears it).
 * LAYER: application entry. May touch the DOM — this is the ONE file allowed to.
 *        May import: engine/*, render/*, command/*. Imported by nothing but
 *        `main.test.ts`, which reaches the pure half through the bootstrap guard
 *        at the bottom (D-065: D-082 called this "the one file no test reaches",
 *        and entry 0089 falsified that).
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
 *   - **D-102 clause 5**: a panel row's write is a `Command`
 *     (`buildPanelSetCommand`/`unlink`) run through `executeCommand`, the exact
 *     same seam a typed line uses (D-069) — never a direct `mutate` call, and
 *     never `commands.ts`'s internal `writeSlot`. A panel write therefore
 *     inherits every refusal a typed `set`/`link`/`unlink` already has, D-097's
 *     table-dimension guard included, for free.
 *   - **D-107**: every panel `pointerdown` prevents the DOM's own default focus
 *     move and places focus deliberately instead — the command bar, unless a
 *     row editor already owns the keyboard. `onCancel` acts only while
 *     `openEditor` still names the exact row it was built for, so a blur fired
 *     by a repaint that already moved on cannot cancel someone else's gesture.
 *   - **D-109 clause 3**: the command bar's `keydown` listener clears
 *     `input.value` only when `submitLine`'s returned `AppTransition.refused`
 *     is `false`. A refusal leaves the line in place for correction.
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
 *   - **Drawing** §5.9's visual feedback trio, D-092 clause 1's name labels,
 *     or D-090's prompt preview — all `render/renderer.ts`'s (0092-REVIEW),
 *     which this file hands `state.interaction.selectedObjectIds` to and
 *     nothing more (D-082 clause 4: no name resolved, no chrome drawn here).
 *   - **The placement ARITHMETIC of D-094's properties panel** — a pure tested
 *     function in `render/panel.ts` (clause 11), called once per PANEL now
 *     (**D-101**). This file builds one panel element per selected object with
 *     a drawn extent, from `command/props.ts`'s descriptors (D-094 clause 9),
 *     re-placed every paint (clause 13) unless the operator has DRAGGED it —
 *     **D-101** clause 5's manual position, held in `AppState.panels`, wins
 *     instead.
 *   - **Slot-to-slot linking BY DRAGGING between two panels** (D-102 clause 9,
 *     explicitly NOT this cycle's). A row now takes typed text, which is D-102's
 *     whole mechanism for Q-014's remaining half; dragging one row onto another
 *     is a further feature the human has not asked for.
 *   - **Which objects get a panel at all** is `AppState.panels`' own
 *     `dismissed` flag (**D-106**): every selected object with a drawn extent
 *     shows one BY DEFAULT, and dismissing it hides that one panel without
 *     touching the selection. Both `dismissed` and a dragged panel's manual
 *     position are discarded the moment the object leaves the selection
 *     (D-101 clause 6, D-106 clause 6) — `withInteraction` is the one place
 *     that prunes `AppState.panels` down to the current selection, so every
 *     caller that replaces `interaction` goes through it rather than
 *     assigning the field directly.
 *   - Injecting a Canvas2D `TextMeasurer` (Rule 1). `render/measure.ts`'s
 *     measurer is built (entry 0131) and §5.6's `measuredHeight` consumes one,
 *     but this file does not yet build an `EvalContext` around it or thread it
 *     through `executeCommand` / the loader / the drag path — so `measuredHeight`
 *     reports `#MEASURE` in the running app until it does (D-118). The next
 *     Phase 5 slice.
 *   - Validating a LOADED document beyond what `loadDocument` checks. D-081 and
 *     D-083 clause 4 are owed by a `document.ts` cycle, not by this one; see
 *     STATUS.md's known problems for what that leaves reachable from the Load
 *     button.
 *   - Throttling drag mutations to animation frames (§5.9's perf note). One
 *     `mutate` per pointer move, as specified — a fix MUST throttle and MUST NOT
 *     write outside the mutation API.
 */
import { createEmptyDocument, loadDocument, saveDocument, type CameraState, type Document } from "./engine/document.ts";
import { slotKey, type GraphObject } from "./engine/graph/node.ts";
import { executeCommand, type CommandEffect } from "./command/commands.ts";
import { parseCommandNumber, type SetFormulaCommand, type SetLiteralCommand, type UnlinkCommand } from "./command/parser.ts";
import { beginCommand, cancelCommand, respond, type CommandSession, type PendingCommand, type PromptResponse } from "./command/prompt.ts";
import { buildSlotDescriptors, describeSlotValue } from "./command/props.ts";
import { clampCamera, clampZoom, panByScreenDelta, screenToWorld, zoomAtScreenPoint, MAX_ZOOM, MIN_ZOOM, type ScreenPoint } from "./render/camera.ts";
import { documentExtent, objectExtent, type WorldExtent } from "./render/extent.ts";
import { deselect, pointerDown, pointerMove, pointerUp, INITIAL_INTERACTION_STATE, type InteractionState } from "./render/interaction.ts";
import { placePropertiesPanel, type PanelPlacement } from "./render/panel.ts";
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
 * One selected object's panel, as the operator has left it (**D-101**, **D-106**).
 * `dismissed` is D-106 clause 2's per-panel hide; `manualPosition` is D-101
 * clause 5's drag-detached CSS point, `undefined` while the panel still
 * follows its object via `placePropertiesPanel`. A missing entry in
 * `AppState.panels` means both defaults: shown, auto-placed — the common case,
 * which is why `panelUiState` below returns this shape rather than every
 * caller writing `?? { dismissed: false, manualPosition: undefined }` itself.
 *
 * APPLICATION state, never DOCUMENT state (D-101 clause 7, D-106 clause 6): it
 * never enters `state.document`, never goes through `mutate`, is never saved.
 */
export interface PanelUiState {
  readonly dismissed: boolean;
  readonly manualPosition: PanelPlacement | undefined;
}

const DEFAULT_PANEL_UI_STATE: PanelUiState = { dismissed: false, manualPosition: undefined };

/** Every selected object's panel state that differs from the default, keyed by object id. Plain and serializable, like every other collection here — though nothing ever serializes it (it is UI state, not document state). */
export type PanelUiRegistry = Readonly<Record<string, PanelUiState>>;

/**
 * Everything the application holds. Plain data, like every other state shape in
 * this codebase — the DOM half below keeps exactly one of these in one variable
 * and replaces it wholesale, so there is no second place a change can hide.
 *
 * `pending` is the prompt sequence in progress (D-072), `undefined` when the
 * input bar is waiting for a fresh command word. `log` is §5.10's scrolling
 * echo, oldest first. `panels` is D-101/D-106's per-panel UI state — see
 * `PanelUiState`'s own doc comment, and `withInteraction` below for the one
 * place it is kept in sync with the selection.
 */
export interface AppState {
  readonly document: Document;
  readonly interaction: InteractionState;
  readonly pending: PendingCommand | undefined;
  readonly log: readonly string[];
  readonly panels: PanelUiRegistry;
}

/** What §5.11 asks the DOM half to do with a file. `save`/`load` are the only two effects this file cannot finish on its own. */
export type FileRequest = "save" | "load";

/**
 * A transition's result: the new state, plus a file request when the operator
 * asked for one, plus whether the line that produced it was REFUSED.
 *
 * Why the request travels back out rather than being done in place: the pure
 * half cannot open a file picker, and returning a description keeps every
 * transition testable — the same reason `commands.ts` returns an effect instead
 * of performing one (D-075). `refused` exists for the same reason, one layer
 * up: **D-109** clause 3 says a refused command keeps the operator's typed line
 * in the input bar rather than clearing it, and only the DOM half owns
 * `input.value`. Meaningless outside `submitLine`'s own path — `pointerDownAt`'s
 * plain click and every branch of `performEffect` are reached only once a
 * command has already been ACCEPTED, so they carry `false` via `transition`'s
 * own default parameter and are never read for it.
 */
export interface AppTransition {
  readonly state: AppState;
  readonly fileRequest: FileRequest | undefined;
  readonly refused: boolean;
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
    panels: {},
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

/**
 * A state with `interaction` replaced, its selection kept in sync with
 * `panels` (**D-101** clause 6, **D-106** clause 6). This is the ONE place
 * that assigns `interaction`, so that pruning cannot be forgotten at a new
 * call site the way a hand-repeated check could be (D-010's shape, applied to
 * a state transition rather than a schema walk).
 *
 * Every caller that can CHANGE which objects are selected — a press, escape,
 * `select <name>` — goes through here. `pointerMoveTo`/`pointerUpNow` do not:
 * neither ever changes `selectedObjectIds`, only `drag`, so routing them here
 * too would cost a call for a prune that is always a no-op.
 */
function withInteraction(state: AppState, interaction: InteractionState): AppState {
  return { ...state, interaction, panels: prunePanelsToSelection(state.panels, interaction.selectedObjectIds) };
}

/** Drops every `panels` entry whose object id is no longer selected — D-101 clause 6 and D-106 clause 6's shared rule, stated once. Returns `panels` BY REFERENCE when nothing needed dropping, matching this file's existing "no same-valued rebuild" posture (`interaction.ts`'s own `widenEmittedNotices` takes the same care). */
function prunePanelsToSelection(panels: PanelUiRegistry, selectedObjectIds: readonly string[]): PanelUiRegistry {
  const selected = new Set(selectedObjectIds);
  const kept = Object.entries(panels).filter(([objectId]) => selected.has(objectId));
  return kept.length === Object.keys(panels).length ? panels : Object.fromEntries(kept);
}

/** `state.panels[objectId]`, defaulted (see `PanelUiState`'s own doc comment) — the one place that reads the registry, so a caller never repeats the `?? DEFAULT` fallback. */
function panelUiState(state: AppState, objectId: string): PanelUiState {
  return state.panels[objectId] ?? DEFAULT_PANEL_UI_STATE;
}

/**
 * Hides one selected object's panel WITHOUT deselecting it (**D-106** clauses
 * 2-3) — the dismiss control in the panel's header calls this. A no-op,
 * returning `state` unchanged, for an object that is not currently selected:
 * there is no panel to hide, and `withInteraction` would discard the entry on
 * the very next selection change anyway (clause 6), so writing it here too
 * would be a write nothing can ever observe.
 */
export function dismissPanel(state: AppState, objectId: string): AppState {
  if (!state.interaction.selectedObjectIds.includes(objectId)) {
    return state;
  }
  return { ...state, panels: { ...state.panels, [objectId]: { ...panelUiState(state, objectId), dismissed: true } } };
}

/**
 * Records a panel's manually-dragged CSS position (**D-101** clause 5) — the
 * operator dragging it by its header. Detaching it this way means
 * `placePropertiesPanel` is no longer consulted for this object's panel until
 * it leaves and re-enters the selection (clause 6): the position here WINS.
 * Same no-op posture as `dismissPanel` for an object that is not selected.
 */
export function movePanel(state: AppState, objectId: string, position: PanelPlacement): AppState {
  if (!state.interaction.selectedObjectIds.includes(objectId)) {
    return state;
  }
  return { ...state, panels: { ...state.panels, [objectId]: { ...panelUiState(state, objectId), manualPosition: position } } };
}

/**
 * A transition that changed state and asked for no file. `refused` defaults to
 * `false` — every caller except `advance`'s own refusal branches wants that,
 * since D-109 clause 3's distinction only exists on `submitLine`'s path.
 */
function transition(state: AppState, refused: boolean = false): AppTransition {
  return { state, fileRequest: undefined, refused };
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
  return withInteraction(cancelled, deselect());
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
        // D-109 clause 3: refused — the operator's line stays in the input.
        return transition(withLog(cleared, [outcome.message]), true);
      }
      const executed = withLog({ ...cleared, document: outcome.document }, outcome.lines);
      // The document part is done; the rest is this file's (D-075 clause 3).
      return outcome.effect === undefined ? transition(executed) : performEffect(outcome.effect, executed, viewport);
    }
    case "prompting":
      // D-109 clause 3, applied to one step of a live sequence: `session.error`
      // is set exactly when THIS answer was refused and the same step is being
      // asked again (`sessionLines`'s own reading of it) — the typed answer
      // stays put, same as a refused `set`. No error means the previous answer
      // was ACCEPTED and the sequence moved on to the next step; the input
      // clears for it, same as any other accepted line.
      return transition(withLog({ ...state, pending: session.pending }, sessionLines(session)), session.error !== undefined);
    case "failed":
    case "cancelled":
      // "cancelled" never actually reaches here (`respond` never returns it;
      // `escape` builds it directly, bypassing `advance`) — `true` is the
      // conservative reading if that ever changes, not a claim it is exercised.
      return transition(withLog({ ...state, pending: undefined }, [sessionMessage(session)]), true);
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
      // `select <name>` REPLACES the whole selection with this one object
      // (D-100 clause 7) — no multi-select command syntax exists; the mouse is
      // where multi-selection lives. The drag is cleared, not carried: a
      // selection made from the input bar has no pointer holding it, and
      // `render/interaction.ts`'s `DragState` means "a pointer is dragging
      // this right now".
      return transition(withInteraction(state, { selectedObjectIds: [effect.objectId], drag: undefined }));
    case "zoom":
      return transition(zoomBy(state, effect.factor, viewport));
    case "fit":
      return transition(fitToDocument(state, viewport));
    case "save":
      return { state, fileRequest: "save", refused: false };
    case "load":
      return { state, fileRequest: "load", refused: false };
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
  // D-066's degeneracy is BOTH extents zero — a point. A FLAT extent (a rect of
  // zero height, a run of collinear vertices) has a real axis to fit to, and the
  // `Math.min` below already handles the other: dividing by a zero extent gives
  // `Infinity`, which loses the min to the finite axis. Requiring both to be
  // positive reported a 200x0 rect as "a single point" and refused to fit it
  // (0090-REVIEW F2).
  const fits = (width > 0 || height > 0) && viewport.width > 0 && viewport.height > 0;
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
 * (D-072), and otherwise §5.9's "click to select" — widened by **D-100** to a
 * multi-object selection — which also arms a drag.
 *
 * `additive` is the shift key (D-100 clauses 3-4): `false` for a plain click,
 * `true` to add to (or toggle out of) the selection instead of replacing it.
 * Defaults to `false` so every existing caller — a typed `select`, a test —
 * keeps meaning "plain click" without naming the modifier.
 *
 * The screen->world conversion for a pick happens HERE, through
 * `render/camera.ts`, because `command/` may never import `render/` and must
 * receive a world point (D-069, D-072).
 */
export function pointerDownAt(state: AppState, screenPoint: ScreenPoint, viewport: Viewport, additive: boolean = false): AppTransition {
  if (state.pending !== undefined) {
    const world = screenToWorld(state.document.camera, screenPoint);
    return respondToPrompt(state, { kind: "picked", point: { x: world.x, y: world.y } }, viewport);
  }
  return transition(withInteraction(state, pointerDown(state.interaction, screenPoint, state.document.objects, state.document.camera, additive)));
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
// The properties panel's row model (D-094 clauses 3-9)
// ---------------------------------------------------------------------------

/**
 * One row of the properties panel: the slot PATH exactly as the operator would
 * type it after the object's name (D-094 clause 4), the last evaluated VALUE as
 * `command/props.ts`'s `describeSlotValue` renders it — rounded to at most 4
 * decimal places, per **D-099** — and — only for a formula slot (D-094 clause
 * 6) — the source `formula/format.ts` reconstructed, without a leading `=`
 * (the DOM writer adds one).
 *
 * `editSeed` (**D-107**, fixing F3) is a SEPARATE string from `value`: the
 * same slot rendered through `describeSlotValue` with NO `maxDecimals`, which
 * is what the command line would accept back unchanged. `value` stays rounded
 * for display — D-099 is not weakened — but seeding a row's editor with the
 * ROUNDED string let committing an untouched row silently truncate a literal
 * (`0.123456789` opened as `0.1235` and, if left untouched, committed as
 * `0.1235`). Two formatter calls over the SAME value, never a fourth
 * formatter (`STATUS.md`'s standing rule) — `describeSlotValue`'s one
 * optional argument is all either needs.
 *
 * `kind` and `synthetic` (**D-102** clause 2) carry `command/props.ts`'s
 * `SlotDescriptor` fields of the same name through to the DOM writer, which is
 * what decides whether a row gets a paperclip at all (never for a `derived` or
 * `synthetic` row) and which colour it gets (clause 3: blue for `formula`,
 * grey for `literal`). A `derived` row's `kind` is carried too, though nothing
 * reads it there — `main.ts`'s own `derived: boolean` grouping is what the DOM
 * writer actually branches on, the same split `PanelModel` already made.
 */
export interface PanelRow {
  readonly path: string;
  readonly value: string;
  readonly editSeed: string;
  readonly formulaSource: string | undefined;
  readonly kind: "literal" | "formula" | "derived";
  readonly synthetic: boolean;
}

/**
 * The properties panel's content for one object (D-094 clauses 3, 5, 7): its
 * name as the header, then its slots in SCHEMA declaration order split into the
 * two groups clause 5 names — `modifiable` (kind `literal` or `formula`, the
 * ones an operator may `set`/`link`/`unlink`) above the thick rule, `derived`
 * (read-only) below it and rendered in italics by the DOM writer.
 *
 * Built from `command/props.ts`'s `buildSlotDescriptors` and no other reading
 * of the schema (D-094 clause 9): the panel and `props` must never disagree
 * about what slots an object has.
 */
export interface PanelModel {
  readonly header: string;
  readonly modifiable: readonly PanelRow[];
  readonly derived: readonly PanelRow[];
}

export function buildPanelModel(object: GraphObject, objects: readonly GraphObject[]): PanelModel {
  const grouped = buildSlotDescriptors(object, objects).map((descriptor) => ({
    row: {
      path: slotKey(descriptor.path),
      // D-099: the ONE caller that rounds a displayed number — 4 decimal
      // places, trimmed — so float dust (`10.000000000000002`) doesn't read
      // as precision. `props`'s own output (`commands.ts`) stays untouched.
      value: describeSlotValue(descriptor.value, { maxDecimals: 4 }),
      // D-107 (F3): the EDIT seed, unrounded — what an untouched commit must
      // write back bit-for-bit. Same formatter, no `maxDecimals`, never a
      // third copy of the display logic.
      editSeed: describeSlotValue(descriptor.value),
      formulaSource: descriptor.formulaSource,
      kind: descriptor.kind,
      synthetic: descriptor.synthetic === true,
    },
    derived: descriptor.kind === "derived",
  }));
  return {
    header: object.name,
    modifiable: grouped.filter((entry) => !entry.derived).map((entry) => entry.row),
    derived: grouped.filter((entry) => entry.derived).map((entry) => entry.row),
  };
}

// ---------------------------------------------------------------------------
// Writing through the panel (**D-102**) — every write is the `Command` the
// command line would have built for the same input, run through the SAME
// `executeCommand` (D-069). Nothing here calls `mutate` or `writeSlot`
// directly (clause 5).
// ---------------------------------------------------------------------------

/** The full address a panel row's write targets, exactly as the operator would type it after the object's name (D-094 clause 4) — `row.path` already IS that suffix, so this is one string join, never a second address-building idiom. */
function panelSlotAddress(objectName: string, path: string): string {
  return `${objectName}.${path}`;
}

/**
 * D-102 clause 6: disambiguates the text a panel row's input held at commit
 * into the SAME two `Command` shapes the command line's own `set` produces —
 * a bare number is a LITERAL write, anything else a FORMULA write. A leading
 * `=` the operator typed is absorbed rather than doubled, so retyping what was
 * already shown (a formula's own reconstructed source, or a plain edit) does
 * not accidentally nest a second `=`.
 *
 * This is deliberately narrower than `parser.ts`'s own `set` grammar: there is
 * no quoted-string or `TRUE`/`FALSE` reading here, because a panel row is a
 * bare text input with no quoting affordance. A string literal is reachable
 * the same way a formula reaches one — typing `"hello"` — which is D-102
 * clause 6 read literally, not a gap this cycle is leaving open.
 */
function buildPanelSetCommand(target: string, raw: string): SetLiteralCommand | SetFormulaCommand {
  const trimmed = raw.trim();
  const asNumber = parseCommandNumber(trimmed);
  if (asNumber !== undefined) {
    return { kind: "set", target, value: asNumber };
  }
  const expression = trimmed.startsWith("=") ? trimmed.slice(1) : trimmed;
  return { kind: "set-formula", target, source: `=${expression}` };
}

/** One panel-synthesised `Command`, rendered the way the operator would have typed it — D-102 clause 7's "echo of the synthesised command itself". */
function describePanelCommand(command: SetLiteralCommand | SetFormulaCommand | UnlinkCommand): string {
  switch (command.kind) {
    case "set":
      return `set ${command.target} ${command.value}`;
    case "set-formula":
      return `set ${command.target} ${command.source}`;
    case "unlink":
      return `unlink ${command.target}`;
    default: {
      const exhaustive: never = command;
      void exhaustive;
      return "";
    }
  }
}

/**
 * Runs one panel-synthesised `Command` through `executeCommand` (D-102 clause
 * 5) and echoes it into the log exactly as a typed line would be (clause 7):
 * the synthesised command first, then whatever `executeCommand` itself would
 * have echoed — its result lines, or its refusal message.
 *
 * A panel write is always `set`/`set-formula`/`unlink`, none of which ever
 * carries a `CommandEffect` (D-075 — those five belong to `select`/`zoom`/
 * `fit`/`save`/`load`), so there is no effect to perform here and none is
 * looked for; a future panel-built command that DID carry one would need this
 * function widened deliberately, not silently ignored.
 */
function runPanelCommand(state: AppState, command: SetLiteralCommand | SetFormulaCommand | UnlinkCommand): AppState {
  const echoed = withLog(state, [`> ${describePanelCommand(command)}`]);
  const outcome = executeCommand(command, echoed.document);
  if (!outcome.ok) {
    return withLog(echoed, [outcome.message]);
  }
  return withLog({ ...echoed, document: outcome.document }, outcome.lines);
}

/**
 * Commits a panel row's open text input (D-102 clauses 4-7) — the GREY
 * paperclip's Enter key. A stale `objectId` (the object was deleted or left
 * the selection while the input was open) is a no-op, `state` returned
 * unchanged, rather than a throw or a refusal with nothing to name (D-023's
 * posture, applied to a UI event instead of a stored address).
 */
export function commitPanelEdit(state: AppState, objectId: string, path: string, raw: string): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) {
    return state;
  }
  return runPanelCommand(state, buildPanelSetCommand(panelSlotAddress(object.name, path), raw));
}

/** Unlinks one panel row (D-102 clause 4's BLUE paperclip) — `unlink <address>`, run the same way `commitPanelEdit` runs a `set`. Same stale-id no-op posture. */
export function unlinkPanelSlot(state: AppState, objectId: string, path: string): AppState {
  const object = state.document.objects.find((candidate) => candidate.id === objectId);
  if (object === undefined) {
    return state;
  }
  return runPanelCommand(state, { kind: "unlink", target: panelSlotAddress(object.name, path) });
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
 * Where a panel-drag gesture stands (**D-101** clause 4). `offsetLeft`/`Top`
 * is the pointer's position WITHIN the panel at the moment the header was
 * pressed, in CSS pixels — held constant for the gesture so the point the
 * operator grabbed stays under the pointer, the same "delta from a fixed
 * reference" shape `PanGesture` uses for the canvas.
 */
interface PanelDragGesture {
  readonly objectId: string;
  readonly offsetLeft: number;
  readonly offsetTop: number;
}

/** What to do with the text an open panel row input holds (**D-102** clauses 4, 6-7): Enter's `onCommit`, Escape's or blur's `onCancel`. Built fresh per row, once, when the row's editor opens — see `panelEditInput`'s own doc comment for why one input never needs a second pair. */
interface PanelEditHandlers {
  readonly onCommit: (raw: string) => void;
  readonly onCancel: () => void;
}

/** Which row is open for editing, and what its input should do (**D-102** clause 8: at most one, across every panel — `openEditor` below is a single value, not a per-panel map). */
interface PanelRowEdit {
  readonly path: string;
  readonly handlers: PanelEditHandlers;
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
function start(canvas: HTMLCanvasElement, logElement: HTMLElement, input: HTMLInputElement, panelsContainer: HTMLElement): void {
  const context = canvas.getContext("2d");
  if (context === null) {
    logElement.textContent = "this browser gave no 2D canvas context — nothing can be drawn";
    return;
  }

  let state = initialAppState(createEmptyDocument(), ["Graphpaper. Type a command, or a command word alone to be prompted."]);
  let pan: PanGesture | undefined;
  let spaceHeld = false;
  // One DOM element per PANELLED object id, reused across paints — D-101's N
  // panels, each held here rather than in `AppState` (D-101 clause 7: a DOM
  // handle is not plain, serializable state). Keyed the same way `AppState.panels`
  // is, so the two stay easy to reason about together even though neither reads
  // the other directly.
  const panelElements = new Map<string, HTMLElement>();
  let panelDrag: PanelDragGesture | undefined;
  // The one panel row currently open for editing, across every panel (**D-102**
  // clause 4's GREY paperclip). `undefined` — the common case — means no row
  // anywhere is being edited. `updatePanels` reads this to decide which panel
  // (if any) must NOT be rebuilt whole this paint (clause 8).
  let openEditor: { readonly objectId: string; readonly path: string } | undefined;

  const viewport = (): Viewport => ({ width: canvas.width, height: canvas.height });

  /**
   * A screen point in BACKING pixels, which is the space `hitTest`,
   * `renderDocument` and `viewport()` all work in (D-086 clause 2).
   *
   * The ratio is read off the canvas itself rather than from
   * `devicePixelRatio`, so it stays exact through the rounding `paint` does when
   * it sizes the backing store, and degrades to 1 for a canvas the layout has
   * given no width.
   */
  const screenPointOf = (event: PointerEvent | WheelEvent): ScreenPoint => {
    const bounds = canvas.getBoundingClientRect();
    const ratioX = bounds.width > 0 ? canvas.width / bounds.width : 1;
    const ratioY = bounds.height > 0 ? canvas.height / bounds.height : 1;
    return { x: (event.clientX - bounds.left) * ratioX, y: (event.clientY - bounds.top) * ratioY };
  };

  // The canvas's BACKING size follows its CSS size times the display's device
  // pixel ratio. A backing store sized in CSS pixels is stretched by the display
  // and every line drawn into it is resampled, which is the fuzziness entry 0091
  // reported: the log and the command input are DOM text and stay sharp, so only
  // the picture looks soft (D-086, widened at 0091-REVIEW).
  //
  // `screenPointOf` above converts INTO this space, which D-086 clause 3 requires
  // to happen in the same change: a pointer event carries CSS pixels and
  // everything downstream of here consumes backing pixels.
  //
  // Re-read before every paint rather than on `resize` alone, because the log
  // growing shortens the canvas with no window resize behind it (0090-REVIEW F1).
  // Rule 5: one layout read per frame is not a cost this project trades
  // correctness for.
  const paint = (): void => {
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const backingWidth = Math.round(canvas.clientWidth * ratio);
    const backingHeight = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    // Every selected object reaches the renderer as an ID only (D-082 clause
    // 4's own rule, applied here too): this file resolves no name, and
    // `renderer.ts` draws no highlight at all for an id naming nothing
    // (D-068), now over the whole list (D-100 clause 8). `panelledIds` is a
    // SEPARATE list (D-106 clause 5) — every selected object with a drawn
    // extent whose panel is not dismissed — because a dismissed panel's
    // object keeps its highlight but gets its canvas name label back.
    const panelledIds = panelledObjectIds();
    renderDocument(context, canvas.width, canvas.height, state.document.objects, state.document.camera, state.interaction.selectedObjectIds, panelledIds);
    updatePanels(panelledIds);
  };

  /**
   * Which selected objects actually show a panel right now (**D-106** clause
   * 5's `panelledObjectIds`): selected, drawing something (so there is an
   * extent to hang a panel off — D-094 clause 2's rule, unchanged), and not
   * dismissed. Computed once per paint and handed to both `renderDocument`
   * (the suppression pass) and `updatePanels` (which panels to build), so the
   * two can never disagree about which objects have one (D-010's shape).
   */
  const panelledObjectIds = (): readonly string[] => {
    const ids: string[] = [];
    for (const objectId of state.interaction.selectedObjectIds) {
      const object = state.document.objects.find((candidate) => candidate.id === objectId);
      const extent = object === undefined ? undefined : objectExtent(object);
      if (object === undefined || extent === undefined || panelUiState(state, objectId).dismissed) {
        continue;
      }
      ids.push(objectId);
    }
    return ids;
  };

  /**
   * Builds, fills and places one panel per id in `panelledIds` (**D-101**),
   * and removes every panel element whose id is no longer in it — the
   * "everything currently shown, nothing else" immediate-mode posture this
   * file already takes for the log and the canvas. `panelElements` persists
   * elements across paints (a fresh `<div>` per id every time would only cost
   * churn, not correctness — nothing here relies on element identity
   * surviving a paint, because the drag gesture below tracks its own state in
   * `panelDrag`, not in the DOM).
   *
   * **D-102 clause 8**: the one panel whose row `openEditor` names is the
   * exception — `writePanel`'s `replaceChildren` would drop that row's open
   * input's focus, caret and typed text on the very next paint, which runs on
   * every pointer move, making the feature unusable rather than slow. So a
   * panel is skipped ONLY while it is already showing exactly the editor it
   * should be (its own `dataset.editingPath` already matches); every other
   * panel, and this one whenever nothing on it is being edited, is rebuilt
   * every paint exactly as before — the skip must never fire for "nothing is
   * being edited", or a panel that is never edited would freeze after its
   * first paint.
   */
  const updatePanels = (panelledIds: readonly string[]): void => {
    const shown = new Set(panelledIds);
    if (openEditor !== undefined && !shown.has(openEditor.objectId)) {
      // Its object left the panelled set — deselected, dismissed, or its
      // extent vanished — while the row's editor was open. Nothing left to
      // edit; D-023's posture, applied to a UI gesture instead of a stored
      // address.
      openEditor = undefined;
    }
    for (const objectId of panelledIds) {
      const object = state.document.objects.find((candidate) => candidate.id === objectId);
      const extent = object === undefined ? undefined : objectExtent(object);
      if (object === undefined || extent === undefined) {
        continue; // Unreachable — `panelledObjectIds` already checked both — but this file never throws on a stale id (D-023's posture).
      }
      const element = panelElement(objectId);
      const editing: PanelRowEdit | undefined =
        openEditor !== undefined && openEditor.objectId === objectId
          ? { path: openEditor.path, handlers: panelEditHandlers(objectId, openEditor.path) }
          : undefined;
      // The skip applies ONLY while THIS panel is already showing exactly the
      // editor it should be showing — every other panel, and this one
      // whenever nothing on it is being edited, is rebuilt every paint
      // exactly as before (immediate-mode, so a live value — a derived
      // `centroid` moving mid-drag — keeps updating on screen). `editing ===
      // undefined` must never take the skip path, or a panel that is never
      // edited would freeze after its first paint.
      const alreadyShowingThisEditor = editing !== undefined && element.dataset.editingPath === editing.path;
      if (!alreadyShowingThisEditor) {
        writePanel(element, buildPanelModel(object, state.document.objects), editing);
        element.dataset.editingPath = editing?.path ?? "";
        if (editing !== undefined) {
          const opened = element.querySelector<HTMLInputElement>(".panel-row__input");
          if (opened === null) {
            // F4 / D-107: the row `openEditor` names is not in the model just
            // built — its path left the object's schema while the object
            // stayed panelled. Nothing exists to focus, commit, or cancel;
            // clearing the gate here is what stops it latching forever
            // (`alreadyShowingThisEditor` would otherwise keep matching a
            // dataset string that names nothing, freezing this panel).
            openEditor = undefined;
          } else {
            // Focus it and select its seeded text so typing straight over it
            // works, matching the command bar's own "always focused" spirit
            // for the one control that now competes with it (§5.10: "not
            // editing text or a cell").
            opened.focus();
            opened.select();
          }
        }
      }
      placePanelElement(element, extent, panelUiState(state, objectId).manualPosition);
    }
    for (const [objectId, element] of panelElements) {
      if (!shown.has(objectId)) {
        element.remove();
        panelElements.delete(objectId);
      }
    }
  };

  /**
   * Builds the `onCommit`/`onCancel` pair for the one row currently open at
   * `objectId`/`path` (**D-102** clauses 4, 6-7). Reads `state` live at call
   * time, like every other closure in `start` — the input this is attached to
   * survives many paints (clause 8), so a snapshot taken when it was CREATED
   * would go stale the moment anything else in the document changed.
   *
   * **D-107 fix items 2-3 (F1, F2)**: both branches restore the command bar's
   * keyboard, and `onCancel` acts only while `openEditor` still names THIS
   * exact row. Without the guard, a blur fired by the repaint that opens a
   * DIFFERENT row's editor — this row's own input being torn out of the DOM as
   * a side effect — would clear the editor that repaint just opened, out from
   * under it (F2's "the operator must click twice").
   */
  const panelEditHandlers = (objectId: string, path: string): PanelEditHandlers => ({
    onCommit: (raw: string) => {
      openEditor = undefined;
      input.focus();
      apply(commitPanelEdit(state, objectId, path, raw));
    },
    onCancel: () => {
      if (openEditor === undefined || openEditor.objectId !== objectId || openEditor.path !== path) {
        return; // Stale: some other gesture already moved `openEditor` on.
      }
      openEditor = undefined;
      input.focus();
      paint();
    },
  });

  /** The DOM element for `objectId`'s panel, creating and appending it the first time it is shown. */
  const panelElement = (objectId: string): HTMLElement => {
    const existing = panelElements.get(objectId);
    if (existing !== undefined) {
      return existing;
    }
    const element = document.createElement("div");
    element.className = "panel";
    element.dataset.objectId = objectId;
    panelsContainer.appendChild(element);
    panelElements.set(objectId, element);
    return element;
  };

  /**
   * One panel's placement (D-094 clauses 11-13, **D-101** clause 5): a
   * DRAGGED panel's manual CSS position wins outright and `placePropertiesPanel`
   * is not even called — clause 5's "no longer consulted while detached,"
   * taken literally, and also what makes a detached panel NOT follow pan or
   * zoom (nothing here re-derives its position from the camera). Otherwise
   * the same measured-after-the-rows-are-in placement D-094 always used.
   */
  const placePanelElement = (element: HTMLElement, extent: WorldExtent, manualPosition: PanelPlacement | undefined): void => {
    if (manualPosition !== undefined) {
      element.style.left = `${manualPosition.left}px`;
      element.style.top = `${manualPosition.top}px`;
      return;
    }
    // D-094 clause 12: worldToScreen is in BACKING pixels, the panel is laid
    // out in CSS pixels — divide by the ratio the canvas actually has, read
    // off the canvas the way `screenPointOf` reads it, never
    // `devicePixelRatio` by assumption.
    const bounds = canvas.getBoundingClientRect();
    const ratio = bounds.width > 0 ? canvas.width / bounds.width : 1;
    const panelRect = element.getBoundingClientRect();
    const placement = placePropertiesPanel(
      extent,
      state.document.camera,
      ratio,
      { width: bounds.width, height: bounds.height },
      { width: panelRect.width, height: panelRect.height },
    );
    element.style.left = `${placement.left}px`;
    element.style.top = `${placement.top}px`;
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

  window.addEventListener("resize", paint);

  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") {
      return;
    }
    const line = input.value;
    const outcome = submitLine(state, line, viewport());
    // D-109 clause 3: a refused command keeps what the operator typed, so it
    // can be corrected in place; only an accepted line clears the input.
    if (!outcome.refused) {
      input.value = "";
    }
    applyTransition(outcome);
  });

  // §5.10: the input bar is "always focused when the user is not editing text or
  // a cell" — neither of which exists yet, so it is simply always focused.
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      apply(escape(state));
      return;
    }
    // §5.9's space-drag meets §5.10's always-focused input bar: every space key
    // arrives at the input, so a `target !== input` guard made the gesture
    // unreachable (0090-REVIEW F3). An EMPTY input is the one case where a space
    // means nothing as text — no command word starts with one — so that is where
    // the gesture wins, and the keystroke is swallowed rather than typed.
    if (event.key === " " && input.value === "") {
      event.preventDefault();
      spaceHeld = true;
    }
  });
  window.addEventListener("keyup", (event: KeyboardEvent) => {
    if (event.key === " ") {
      spaceHeld = false;
    }
  });

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    // Both lines are about the command input keeping the keyboard (§5.10:
    // "always focused when the user is not editing text or a cell"). A press on
    // the canvas moves focus to the body as its DEFAULT action, which runs AFTER
    // this listener — so `input.focus()` alone was undone a moment later, and
    // every keystroke after a click went nowhere until the operator clicked the
    // input (entry 0091). Refusing the default keeps the focus where it is, and
    // the `focus()` call recovers it when something else already took it.
    event.preventDefault();
    input.focus();
    canvas.setPointerCapture(event.pointerId);
    const point = screenPointOf(event);
    if (event.button === 1 || spaceHeld) {
      pan = { lastScreenX: point.x, lastScreenY: point.y };
      return;
    }
    // D-100 clauses 3-4: shift is the additive-selection modifier.
    applyTransition(pointerDownAt(state, point, viewport(), event.shiftKey));
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    const point = screenPointOf(event);
    if (pan !== undefined) {
      // Backing-pixel deltas, like every other screen number here: a CSS-pixel
      // delta would pan at 1/ratio of the pointer's speed on a scaled display.
      apply(panByScreen(state, point.x - pan.lastScreenX, point.y - pan.lastScreenY));
      pan = { lastScreenX: point.x, lastScreenY: point.y };
      return;
    }
    apply(pointerMoveTo(state, point));
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

  // D-101 clause 4: a panel is dragged by its HEADER only. ONE delegated
  // listener on the container (rather than one per header, re-attached every
  // `updatePanels` rebuild) so a rebuild mid-gesture cannot drop it — see
  // `panelDrag`'s own doc comment for why the gesture continues on `window`
  // rather than on the header element for the same reason. The dismiss
  // button sits inside the header (D-106 clause 2), so it is excluded below
  // FIRST — otherwise pressing it would also arm a drag.
  //
  // **D-107 fix item 1 (F1)**: `preventDefault()` now runs for every panel
  // press — not only a header press, which is all the previous version
  // covered — EXCEPT a press inside the row editor's OWN input: that element
  // already legitimately owns the keyboard (§5.10's "editing text or a cell"
  // carve-out), and its native mousedown handling is what places the caret at
  // the clicked character, not merely "moves focus" — preventing THAT default
  // would break clicking inside an open editor to reposition the caret while
  // fixing nothing, since a focused input never suffers the "focus falls to
  // body" bug this exists to stop (verified live: without this carve-out, a
  // click anywhere in an open input's text moved the caret to the END
  // regardless of where the pointer landed). Everywhere else, focus is placed
  // DELIBERATELY: the command bar, but only when no row editor is open — an
  // open editor's input keeps the keyboard, never both at once and never
  // neither.
  panelsContainer.addEventListener("pointerdown", (event: PointerEvent) => {
    const target = event.target as HTMLElement;
    const insideOpenEditor = target.closest(".panel-row__input") !== null;
    if (!insideOpenEditor) {
      event.preventDefault();
    }
    if (openEditor === undefined && !insideOpenEditor) {
      input.focus();
    }
    if (target.closest(".panel-dismiss") !== null) {
      return;
    }
    const header = target.closest(".panel-header");
    const element = header === null ? null : (header.closest(".panel") as HTMLElement | null);
    const objectId = element?.dataset.objectId;
    if (element === null || objectId === undefined) {
      return;
    }
    // D-101 clause 8: a panel drag must not reach the canvas. This listener
    // is on `panelsContainer`, a sibling of `canvas` under `#stage`, so the
    // press never fires there to begin with — nothing to suppress, unlike
    // the canvas's own pointerdown (D-088).
    const bounds = element.getBoundingClientRect();
    panelDrag = { objectId, offsetLeft: event.clientX - bounds.left, offsetTop: event.clientY - bounds.top };
  });

  /**
   * D-101's drag gesture continues on `window`, deliberately NOT on the
   * header element `pointerdown` fired on. `updatePanels` rebuilds every
   * panel element on every paint, and a paint runs on every `apply` this very
   * listener triggers — so a listener or `setPointerCapture` bound to that
   * header would be torn down mid-gesture the moment the first `pointermove`
   * repainted it. Reading `panelDrag` from `window` events instead survives
   * that by construction, the same reason `pan` above is tracked in a
   * closure variable rather than on the canvas element's own state.
   */
  window.addEventListener("pointermove", (event: PointerEvent) => {
    if (panelDrag === undefined) {
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    apply(
      movePanel(state, panelDrag.objectId, {
        left: event.clientX - bounds.left - panelDrag.offsetLeft,
        top: event.clientY - bounds.top - panelDrag.offsetTop,
      }),
    );
  });
  const endPanelDrag = (): void => {
    panelDrag = undefined;
  };
  window.addEventListener("pointerup", endPanelDrag);
  window.addEventListener("pointercancel", endPanelDrag);

  // D-106 clauses 2-3: the dismiss control hides one panel without touching
  // the selection. Delegated the same way and for the same reason as the
  // drag listener above.
  panelsContainer.addEventListener("click", (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const dismissButton = target.closest(".panel-dismiss");
    if (dismissButton !== null) {
      const element = dismissButton.closest(".panel") as HTMLElement | null;
      const objectId = element?.dataset.objectId;
      if (objectId !== undefined) {
        apply(dismissPanel(state, objectId));
      }
      return;
    }

    // D-102 clauses 2-4: a paperclip on a modifiable row. Delegated the same
    // way and for the same reason as the dismiss control above — the row it
    // sits on is rebuilt whole on every paint (until its own editor opens,
    // clause 8), so a listener bound to the paperclip element itself would be
    // torn down mid-gesture.
    const clip = target.closest(".panel-clip");
    if (clip === null) {
      return;
    }
    const rowElement = clip.closest(".panel-row") as HTMLElement | null;
    const panelNode = clip.closest(".panel") as HTMLElement | null;
    const objectId = panelNode?.dataset.objectId;
    const path = rowElement?.dataset.path;
    if (objectId === undefined || path === undefined) {
      return;
    }
    if (clip.classList.contains("panel-clip--formula")) {
      // Clause 4: BLUE unlinks immediately — no input to open.
      apply(unlinkPanelSlot(state, objectId, path));
      return;
    }
    // Clause 4: GREY opens that row's own text input. `updatePanels` (next
    // paint) is what actually builds it and moves focus into it.
    openEditor = { objectId, path };
    paint();
  });

  apply(state);
  input.focus();
}

/** §5.10's scrolling log, redrawn whole. Immediate-mode, like the canvas: there is no diffing here and nothing to keep in sync. */
function drawLog(logElement: HTMLElement, lines: readonly string[]): void {
  logElement.textContent = lines.join("\n");
  logElement.scrollTop = logElement.scrollHeight;
}

/**
 * D-094's properties panel, redrawn whole (immediate-mode, like the log and the
 * canvas). Header, then the modifiable rows, then — if there are any — the thick
 * rule (clause 5) and the derived rows. Every piece of text goes in through
 * `textContent`: an object's name and a slot's value are user-controlled, and
 * `<b>` is a legal object name (D-094 clause 14).
 *
 * The header now carries a DISMISS control beside the name (**D-106** clause
 * 2) — `main.ts`'s delegated listeners above find both it and the header's
 * drag handle by class name, never by element identity, which is what lets
 * this function rebuild the header whole on every call without breaking a
 * gesture already in progress (see `panelDrag`'s own doc comment in `start`).
 */
function writePanel(panelElement: HTMLElement, model: PanelModel, editing: PanelRowEdit | undefined): void {
  const header = document.createElement("div");
  header.className = "panel-header";
  const name = document.createElement("span");
  name.className = "panel-header__name";
  name.textContent = model.header;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "panel-dismiss";
  dismiss.textContent = "×"; // ×, a plain glyph rather than an icon (Rule 5).
  dismiss.setAttribute("aria-label", `hide the ${model.header} panel`);
  header.append(name, dismiss);
  const children: HTMLElement[] = [header];

  for (const row of model.modifiable) {
    children.push(panelRowElement(row, false, editing));
  }
  if (model.derived.length > 0) {
    const rule = document.createElement("div");
    rule.className = "panel-rule";
    children.push(rule);
    for (const row of model.derived) {
      // A derived row is never the one `editing` names (D-102 clause 2: it
      // carries no paperclip at all, so nothing can have opened one on it),
      // but `editing` is still passed through rather than hard-coded
      // `undefined` — one caller, one meaning, never two spellings of "not
      // editable" for what is structurally the same row-building call.
      children.push(panelRowElement(row, true, editing));
    }
  }
  panelElement.replaceChildren(...children);
}

/**
 * One panel row: `<path>` and, on its right, either the value (D-094 clause 6
 * shows a formula's reconstructed source too) or — when `editing` names this
 * row — a text input in its place (**D-102** clauses 4, 6-7). `derived` rows
 * get the italic class (D-094 clause 5) and, being read-only, never a
 * paperclip; neither does a `synthetic` row (D-102 clause 2 — the table
 * `cells` summary stands for a whole family, not one slot to write).
 *
 * `dataset.path` is what the delegated paperclip-click listener in `start`
 * reads to know which row was clicked — never a listener bound to the row
 * itself, for the same rebuild-mid-gesture reason every other panel listener
 * here is delegated (see `panelDrag`'s own doc comment).
 */
function panelRowElement(row: PanelRow, derived: boolean, editing: PanelRowEdit | undefined): HTMLElement {
  const element = document.createElement("div");
  element.className = derived ? "panel-row panel-row--derived" : "panel-row";
  element.dataset.path = row.path;

  const path = document.createElement("span");
  path.className = "panel-row__path";
  path.textContent = row.path;

  const right = document.createElement("span");
  right.className = "panel-row__right";
  if (editing !== undefined && editing.path === row.path) {
    // D-107 (F3): the SEED, not the rounded display `value` — see
    // `PanelRow.editSeed`'s own doc comment for why they must differ.
    right.append(panelEditInput(row.editSeed, editing.handlers));
  } else {
    if (!derived && !row.synthetic) {
      right.append(panelClipElement(row));
    }
    const value = document.createElement("span");
    value.className = "panel-row__value";
    value.textContent = row.formulaSource === undefined ? row.value : `= ${row.formulaSource}  (${row.value})`;
    right.append(value);
  }

  element.append(path, right);
  return element;
}

/**
 * D-102 clauses 2-3: a paperclip on a MODIFIABLE, non-synthetic row — bold
 * blue when the slot's KIND is `formula`, faded grey when it is `literal`.
 * The icon reports the kind, never whether a formula happens to reference
 * anything, so it can never disagree with the `= ...` text beside it (the
 * human's own reasoning at D-102 clause 3). A plain glyph, like the dismiss
 * control's `×` (Rule 5) — no icon font, no SVG.
 */
function panelClipElement(row: PanelRow): HTMLElement {
  const clip = document.createElement("span");
  clip.className = row.kind === "formula" ? "panel-clip panel-clip--formula" : "panel-clip panel-clip--literal";
  clip.textContent = "📎";
  clip.setAttribute("aria-label", row.kind === "formula" ? `unlink ${row.path} — it is driven by a formula` : `edit ${row.path}`);
  return clip;
}

/**
 * The GREY paperclip's text input (D-102 clauses 4, 6-7), seeded with
 * `PanelRow.editSeed` — the unrounded value, per D-107's own fix (F3), not
 * the rounded `value` text shown beside it.
 *
 * Every keydown here `stopPropagation`s, unconditionally: none of it may
 * reach the window-level handlers built for the ALWAYS-focused command bar
 * (space held for a pan-drag, Escape's cancel-then-deselect) — §5.10's own
 * carve-out, "not editing text or a cell," made true of a panel row for the
 * first time this cycle. This is also what gives Escape its D-102 clause 7
 * meaning here for free: stopped before it ever reaches the `window`
 * listener, so ONLY this input's own handler sees it, and the selection is
 * never touched — no separate check needed at that outer listener.
 *
 * `settled` guards against calling a handler twice: committing or cancelling
 * triggers a repaint that removes this very input from the DOM (D-102 clause
 * 8 — the panel is rebuilt once, to show the plain row again), and removing a
 * focused element fires its OWN `blur` — which would otherwise re-invoke
 * `onCancel` a second time, reentrantly, from inside the repaint the first
 * call already started.
 */
function panelEditInput(seed: string, handlers: PanelEditHandlers): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "panel-row__input";
  input.value = seed;
  let settled = false;
  const commit = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    handlers.onCommit(input.value);
  };
  const cancel = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    handlers.onCancel();
  };
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      commit();
    } else if (event.key === "Escape") {
      cancel();
    }
  });
  input.addEventListener("blur", cancel);
  return input;
}

/** §5.11's "save via JSON download". */
function downloadDocument(state: Document): void {
  const url = URL.createObjectURL(new Blob([saveDocument(state)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "graphpaper.json";
  // In the document, and revoked LATER: a detached anchor's click is ignored by
  // some browsers, and revoking the URL in the same tick can cancel the download
  // the click just started (0090-REVIEW F4).
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
  const panelsContainer = document.querySelector<HTMLElement>("#panels");
  if (canvas !== null && logElement !== null && input !== null && panelsContainer !== null) {
    start(canvas, logElement, input, panelsContainer);
  }
}
