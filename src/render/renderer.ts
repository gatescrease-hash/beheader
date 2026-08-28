/**
 * renderer.ts — Canvas2D immediate-mode renderer: clear, apply the camera
 * transform, draw every object.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.9 ("Immediate mode. Every invalidation: clear,
 * apply camera transform, draw every visible object in z-order. No retained
 * scene graph, no diffing.") and §5.4's rendering clause ("fixed-size cells,
 * grid lines, numbers right-aligned and strings left-aligned"). Not on §6.2's
 * load-bearing list — this file only CONSUMES the graph.
 * LAYER: render. Touches Canvas2D directly — the one layer Rule 1 does not
 * bind (Rule 1 is `engine/`-only). May import: engine/* (read-only), own
 * layer. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `renderDocument(ctx, viewportWidth, viewportHeight, objects, camera,
 *   selectedObjectId?)` — the one exported entry point, a pure function of
 *   its arguments. It takes `objects`, not a whole engine `Document`: this
 *   file draws graph state, and the narrow argument both keeps it testable
 *   and sidesteps `Document` colliding with the DOM's own global `Document`
 *   type, which this file — unlike `engine/document.ts` — sits alongside.
 *
 *   THREE passes, in this order:
 *     1. Clear the WHOLE viewport in screen space (transform reset to
 *        identity FIRST — see `clearScreen`).
 *     2. Set the camera transform ONCE and draw every object, then (if
 *        `selectedObjectId` names one of them) its selection highlight, in
 *        RAW WORLD-SPACE coordinates — letting the canvas transform do the
 *        conversion. No draw call in this pass ever calls `worldToScreen`
 *        itself. The transform is derived from `camera.ts`'s OWN
 *        `worldToScreen` rather than a second hand-written copy of the
 *        formula (D-010): this file may never compute a different
 *        world<->screen mapping than `camera.ts` does.
 *     3. Reset to identity again and draw every object's SCREEN-SPACE chrome
 *        — a name label (D-092 clause 1), an error badge, a formula-driven
 *        indicator (§5.9, D-068) — each converted through `worldToScreen`
 *        explicitly, because chrome text must stay a constant size regardless
 *        of zoom, unlike the geometry in pass 2.
 *
 *   The highlight is drawn in a SEPARATE pass after every object (not
 *   inline with pass 2's per-object loop) so it is never occluded by a LATER
 *   object in z-order — array order is z-order (below), and a selected
 *   object is not always the last one drawn.
 *
 *   Z-ORDER is `objects`' array order. The brief names z-order but gives
 *   objects no explicit z field, so array order (creation order, absent a
 *   reorder command that does not exist) is the disclosed, reversible
 *   reading — Rule 5's "dumbest correct implementation." `hittest.ts` reads
 *   it the same way, from the other end.
 *
 *   Two §5.5 clauses that are deliberate and must not be normalised away:
 *   `circle` draws a TRUE ARC from `origin`/`radius` ("the renderer still
 *   draws a true arc"), never the polygonal `vertices` approximation that
 *   slot exists for; `polygon`/`rect` read `vertices` and stroke the closed
 *   path it describes ("consumers always read `vertices`"). Every type with
 *   no schema or visual definition yet draws nothing, rather than a
 *   placeholder.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. A missing, wrong-typed, or `ErrorValue` input makes that
 *     ONE object draw nothing — it does not abort the loop or blank the rest
 *     of the frame.
 *   - No engine state is written here (Rule 2) — every function below only
 *     READS `GraphObject`/`Value` and calls `ctx` methods.
 *   - `ctx` is left holding IDENTITY on return, not the camera transform —
 *     the screen-space chrome pass below resets it last, which is what makes
 *     this safe for a caller to draw further screen-space chrome after
 *     (D-092-REVIEW's own D-092, `main.ts` draws none today). The former
 *     HAZARD note here (D-068 said "owned by whichever cycle first draws
 *     screen-space chrome") is THIS cycle and is now closed by construction.
 *   - **A selection highlight, an error badge, and a table's grid extent are
 *     each derived from the SAME reads `drawObject`/`drawTable` already make**
 *     (D-010) — never a second, independently computed outline or box that
 *     could disagree with what is actually drawn.
 *
 * NOT DONE HERE
 *   - **D-090's prompt-sequence preview** (the marker-and-shape a live
 *     `circle`/`polygon`/`rect` prompt would produce). Needs `state.pending`,
 *     which is `main.ts`'s and does not reach this file yet — a separate
 *     cycle, deliberately (0092-REVIEW §5).
 *   - **The formula-driven indicator is read NARROWLY**, as the two
 *     component slots a drag can actually move (`render/interaction.ts`'s
 *     per-component rule): `origin.x`/`origin.y`. A future per-vertex drag
 *     path or a `style` slot bound to a formula gets no indicator yet — this
 *     file has no general "every writable slot on this object" enumeration,
 *     and inventing one is a bigger cycle than D-068 asked for.
 *   - `style` slots (§5.5's `Path` shape) — `geometry.ts` declares none yet,
 *     so every shape draws with one disclosed default stroke, and the
 *     selection highlight and chrome text below are equally untuned (Rule 5).
 *   - Text/script/image objects (no schema — Phases 5/6) and `polyline`'s
 *     per-vertex shape (deferred with `explode`) draw no body AND no chrome —
 *     `chromeAnchorPoint` returns `undefined` for every type with no schema.
 *   - Any bound on `rows`/`cols`/`sides` — a carried known problem; one fix
 *     covers drawing and evaluation together.
 */
import { getSlot, isErrorValue, type GraphObject, type Point, type Value } from "../engine/graph/node.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH, RADIUS_PATH, VERTICES_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import { formatCellReference, TABLE_CELL_PATH_PREFIX } from "../engine/address.ts";
import type { CameraState } from "../engine/document.ts";
import { worldToScreen, type ScreenPoint } from "./camera.ts";

/**
 * World-unit defaults — no `style` slot exists yet (see file header). Round,
 * untuned (Rule 5).
 *
 * PROVISIONAL(Q-012): the WIDTH is in world units, so it scales with zoom —
 * 1 world unit is 0.01 screen px at `MIN_ZOOM` and 100 px at `MAX_ZOOM`.
 * §5.5 puts `strokeWidth` inside the shape's own `style` (a property of the
 * shape, not of the view), which is why this is the taken reading; the cycle
 * that declares real `style` slots settles it.
 */
const DEFAULT_SHAPE_STROKE_STYLE = "#1a1a1a";
const DEFAULT_SHAPE_STROKE_WIDTH = 1;

/**
 * §5.4: "fixed-size cells." World-unit constants — untuned (Rule 5), scale on
 * screen with zoom like everything else drawn here. PROVISIONAL(Q-012), same
 * reading as the stroke width above. Exported: `render/hittest.ts`'s table
 * bounding-box test (§5.9) needs the SAME cell size this file draws with —
 * D-010's "declare once" principle, so a future resize of these two constants
 * can never leave the picture and the click box disagreeing.
 */
export const TABLE_CELL_WIDTH = 80;
export const TABLE_CELL_HEIGHT = 24;
const TABLE_CELL_TEXT_PADDING = 4;
const TABLE_GRID_STROKE_STYLE = "#999999";
const TABLE_CELL_TEXT_STYLE = "#1a1a1a";
const TABLE_CELL_FONT = "14px sans-serif";

/**
 * §5.9's selection highlight (D-068): the SAME path/box `drawObject` built
 * for the selected object, re-stroked in this style. World units, like every
 * other stroke width above (PROVISIONAL(Q-012)) — a screen-space-fixed ring
 * would read as "at this point," not "around this shape."
 */
const SELECTION_HIGHLIGHT_STYLE = "#2456c9";
const SELECTION_HIGHLIGHT_WIDTH = DEFAULT_SHAPE_STROKE_WIDTH * 3;

/**
 * Screen-space chrome (D-092 clause 1, D-068's badge and indicator) — SCREEN
 * pixels, deliberately not PROVISIONAL(Q-012)'s world-unit reading: chrome
 * text must stay one legible size at any zoom, which is the whole reason
 * `drawObjectChrome` runs in its own identity-transform pass (file header).
 * All four constants are Rule 5's "dumbest correct implementation" — chosen,
 * not measured, same as every other constant in this file.
 */
const CHROME_ANCHOR_MARGIN_SCREEN = 6;
const CHROME_TICK_SPACING_SCREEN = 14;
const CHROME_FONT = "12px sans-serif";
const CHROME_LABEL_STYLE = "#1a1a1a";
const CHROME_ERROR_BADGE_STYLE = "#c0392b";
const CHROME_FORMULA_TICK_STYLE = "#2456c9";

/**
 * Clears `viewportWidth` x `viewportHeight` in SCREEN space. MUST run with the
 * transform at identity — `ctx.clearRect` is itself subject to the current
 * transform (same as every other draw call), so clearing BEFORE the camera
 * transform is applied is what makes this clear the whole visible canvas
 * regardless of the current pan/zoom, rather than a camera-warped rectangle
 * that misses corners at any zoom other than 1.
 */
function clearScreen(ctx: CanvasRenderingContext2D, viewportWidth: number, viewportHeight: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, viewportWidth, viewportHeight);
}

/**
 * §5.9's whole sequence, widened by D-068/D-092: clear, apply the camera
 * transform, draw every object in z-order (array order — see file header),
 * draw the selection highlight, then reset to identity and draw every
 * object's screen-space chrome. `selectedObjectId` names no object (`undefined`,
 * or a stale id — D-023-shaped) draws no highlight; never throws.
 */
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  viewportWidth: number,
  viewportHeight: number,
  objects: readonly GraphObject[],
  camera: CameraState,
  selectedObjectId?: string,
): void {
  clearScreen(ctx, viewportWidth, viewportHeight);

  // The camera transform, built from camera.ts's OWN worldToScreen rather than
  // a second copy of `screen = (world - camera) * zoom` (D-010; see header).
  // setTransform(a,b,c,d,e,f): x' = a*x + c*y + e, y' = b*x + d*y + f — with
  // a=d=zoom, b=c=0, (e,f) = worldToScreen(camera, {0,0}), this is EXACTLY
  // worldToScreen for every subsequent world-space draw call.
  const screenOrigin = worldToScreen(camera, { x: 0, y: 0 });
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, screenOrigin.x, screenOrigin.y);

  for (const object of objects) {
    drawObject(ctx, object);
  }

  // Drawn LAST in world space — never inline with the loop above — so the
  // highlight is never occluded by a later object in z-order (file header).
  const selected = selectedObjectId === undefined ? undefined : objects.find((object) => object.id === selectedObjectId);
  if (selected !== undefined) {
    drawSelectionHighlight(ctx, selected);
  }

  // Screen-space chrome: a fresh identity reset (clearScreen's own reasoning
  // applies again — a transform-warped label is not screen-space), then one
  // explicit worldToScreen per object (file header's pass 3).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const object of objects) {
    drawObjectChrome(ctx, camera, object);
  }
}

/** Dispatches by `ObjectType` (§5.1's own switch-not-dispatch-table style, PROCESS_BRIEF §5.5). Every unsupported type draws nothing — see file header. */
function drawObject(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  switch (object.type) {
    case "circle":
      drawCircle(ctx, object);
      return;
    case "polygon":
    case "rect":
      drawVerticesShape(ctx, object);
      return;
    case "table":
      drawTable(ctx, object);
      return;
    case "polyline":
    case "text":
    case "script":
    case "image":
    case "value":
    case "add":
      return; // No schema/visual definition yet (see file header's NOT DONE HERE).
    default: {
      // Compile-time exhaustiveness, WITHOUT a throw — the same arm every other
      // discriminated-union switch in this codebase carries (`formula/deps.ts`,
      // `formula/eval.ts`, `formula/parser.ts`, `mutation.ts`). It is what makes
      // a NEW `ObjectType` a compile error here instead of an object that
      // silently draws nothing: §5.5's `polyline` and §5.6's `text` are both
      // already promised, so this arm has a caller coming (0062-REVIEW edit 1).
      const exhaustive: never = object.type;
      void exhaustive;
      return;
    }
  }
}

/**
 * A slot's current value, narrowed to `number` — `undefined` for anything else
 * (missing, wrong-typed, an `ErrorValue`). Never throws. Exported: `render/
 * hittest.ts` reads the same `origin.x`/`origin.y` paths for its table
 * bounding-box test and must not re-derive this narrowing separately (D-010).
 */
export function readNumber(object: GraphObject, path: readonly string[]): number | undefined {
  const value = getSlot(object, path)?.value;
  return typeof value === "number" ? value : undefined;
}

/**
 * Builds (but does not stroke) §5.5's circle path — `ctx.beginPath()` /
 * `ctx.arc(...)` — from `origin.x`/`origin.y`/`radius` directly, never
 * `vertices` (§5.5: "the renderer still draws a true arc"). Returns whether a
 * path was built, so both `drawCircle` and `drawSelectionHighlight` (D-068)
 * stroke the exact SAME path in different styles rather than each computing
 * their own (D-010) — the highlight can never disagree with what is drawn.
 * `false` for a missing/wrong-typed/negative radius; never throws.
 */
function buildCirclePath(ctx: CanvasRenderingContext2D, object: GraphObject): boolean {
  const originX = readNumber(object, ORIGIN_X_PATH);
  const originY = readNumber(object, ORIGIN_Y_PATH);
  const radius = readNumber(object, RADIUS_PATH);
  if (originX === undefined || originY === undefined || radius === undefined || radius < 0) {
    return false;
  }
  ctx.beginPath();
  ctx.arc(originX, originY, radius, 0, Math.PI * 2);
  return true;
}

function drawCircle(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  if (!buildCirclePath(ctx, object)) {
    return;
  }
  ctx.strokeStyle = DEFAULT_SHAPE_STROKE_STYLE;
  ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
  ctx.stroke();
}

/**
 * Narrows a slot's current value to a `Point[]` — `undefined` for everything
 * else, an `ErrorValue` included. `readonly Point[]` is the ONLY array arm of
 * `Value` (§5.1, `graph/node.ts`), so `Array.isArray` alone excludes every
 * other member and no separate `isErrorValue` guard is needed here (an
 * `ErrorValue` is not an array). Never throws. Exported: `render/hittest.ts`
 * reads the same `vertices` slot for its stroke distance-to-segment test and
 * must not re-derive this narrowing separately (D-010).
 */
export function asPointArray(value: Value | undefined): readonly Point[] | undefined {
  if (value === undefined || !Array.isArray(value)) {
    return undefined;
  }
  return value as readonly Point[];
}

/**
 * Builds (but does not stroke) `polygon`/`rect`'s closed path (§5.5:
 * "Consumers always read `vertices`") — the same D-010 split `buildCirclePath`
 * documents above. `false` for a missing, wrong-typed, `ErrorValue`, or empty
 * `vertices`; never throws.
 */
function buildVerticesPath(ctx: CanvasRenderingContext2D, object: GraphObject): boolean {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  const first = vertices?.[0];
  if (vertices === undefined || first === undefined) {
    return false;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    if (vertex === undefined) {
      continue; // noUncheckedIndexedAccess artifact only — `i` is always in range.
    }
    ctx.lineTo(vertex.x, vertex.y);
  }
  ctx.closePath();
  return true;
}

function drawVerticesShape(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  if (!buildVerticesPath(ctx, object)) {
    return;
  }
  ctx.strokeStyle = DEFAULT_SHAPE_STROKE_STYLE;
  ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
  ctx.stroke();
}

/**
 * §5.4: "fixed-size cells, grid lines... Formula bar / in-place editing" (the
 * latter is `render/interaction.ts`'s job, not built here). Draws every cell
 * in `1..rows x 1..cols` (`getTableDimensions`, D-046-safe) as a bordered
 * rectangle plus its current value, positioned from `origin.x`/`origin.y` —
 * the same two paths every geometry preset uses, and the ones `TABLE_SCHEMA`
 * declares, so one object never has two positions. A table hand-built without
 * them falls back to `(0, 0)` rather than declining to draw, because a
 * missing coordinate is not a reason to hide a grid that has an extent.
 * Never throws.
 */
function drawTable(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);

  ctx.font = TABLE_CELL_FONT;
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= cols; column += 1) {
      const cellLeft = originX + (column - 1) * TABLE_CELL_WIDTH;
      const cellTop = originY + (row - 1) * TABLE_CELL_HEIGHT;

      ctx.strokeStyle = TABLE_GRID_STROKE_STYLE;
      ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
      ctx.strokeRect(cellLeft, cellTop, TABLE_CELL_WIDTH, TABLE_CELL_HEIGHT);

      const cellPath = [TABLE_CELL_PATH_PREFIX, formatCellReference({ column, row })];
      drawCellText(ctx, getSlot(object, cellPath)?.value, cellLeft, cellTop);
    }
  }
}

/**
 * §5.4: "numbers right-aligned and strings left-aligned." Everything that is
 * not a number (string, boolean, a Point/Point[], an ErrorValue) is left-
 * aligned — the brief draws only the number/string line, so this file
 * extends it the same direction for the other members of `Value` (§5.1) a
 * cell can legally hold, rather than inventing a THIRD alignment rule.
 * Draws nothing for an unset cell (`undefined`, D-047's ordinary "legally
 * empty" case) or a `null` value (§5.1) — both display as blank.
 */
function drawCellText(ctx: CanvasRenderingContext2D, value: Value | undefined, cellLeft: number, cellTop: number): void {
  if (value === undefined) {
    return;
  }
  const formatted = formatCellValue(value);
  if (formatted === null) {
    return;
  }
  ctx.fillStyle = TABLE_CELL_TEXT_STYLE;
  ctx.textBaseline = "middle";
  const y = cellTop + TABLE_CELL_HEIGHT / 2;
  if (typeof value === "number") {
    ctx.textAlign = "right";
    ctx.fillText(formatted, cellLeft + TABLE_CELL_WIDTH - TABLE_CELL_TEXT_PADDING, y);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(formatted, cellLeft + TABLE_CELL_TEXT_PADDING, y);
  }
}

/**
 * Every member of `Value` (§5.1) to its cell display text, or `null` for a
 * blank cell — exhaustive by construction (TypeScript narrows `value` to
 * `Point`, the one arm with no explicit check, only after every other arm has
 * returned). An `ErrorValue` displays its bare code (`"#REF"`) — this is NOT
 * yet §5.9's "error badge" (file header); it is the same even-handed
 * treatment every other `Value` member gets, so a broken cell is legible
 * rather than silently blank. `Point`/`Point[]` are not expected to reach a
 * table cell in practice (nothing wires geometry into one yet), but the
 * function stays total over the whole union rather than assuming that.
 */
function formatCellValue(value: Value): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (isErrorValue(value)) {
    return value.error;
  }
  if (Array.isArray(value)) {
    return `[${value.length} points]`;
  }
  // Every other member of Value is ruled out above; TypeScript's negative
  // narrowing across Array.isArray's `arg is any[]` guard does not itself
  // land on the remaining `Point` here, so the cast is explicit — the same
  // "rule out the rest, then cast" shape graph/node.ts's own `hasIllegalNumber`
  // uses for this identical remaining case.
  const point = value as Point;
  return `(${point.x}, ${point.y})`;
}

// ---------------------------------------------------------------------------
// Selection highlight (§5.9, D-068) — world space, drawn last (see caller)
// ---------------------------------------------------------------------------

/**
 * Re-strokes the SAME path/box `drawObject` built for `object`, in
 * `SELECTION_HIGHLIGHT_STYLE` — never a second, independently computed
 * outline (D-010; see `buildCirclePath`/`buildVerticesPath`). A `table` has
 * no single stroked path (a grid of cells), so it is highlighted as its whole
 * drawn extent instead, read the same way `drawTable` positions the grid —
 * including the `?? 0` fallback, so the highlight can never sit somewhere
 * other than where the grid is actually drawn. Draws nothing for a type with
 * no visual definition yet (file header); never throws.
 */
function drawSelectionHighlight(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  switch (object.type) {
    case "circle": {
      if (buildCirclePath(ctx, object)) {
        strokeHighlight(ctx);
      }
      return;
    }
    case "polygon":
    case "rect": {
      if (buildVerticesPath(ctx, object)) {
        strokeHighlight(ctx);
      }
      return;
    }
    case "table": {
      const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
      const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
      const { rows, cols } = getTableDimensions(object);
      const width = cols * TABLE_CELL_WIDTH;
      const height = rows * TABLE_CELL_HEIGHT;
      if (width <= 0 || height <= 0) {
        return; // Same guard drawTable's own grid loop is un-enterable under.
      }
      ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
      ctx.lineWidth = SELECTION_HIGHLIGHT_WIDTH;
      ctx.strokeRect(originX, originY, width, height);
      return;
    }
    case "polyline":
    case "text":
    case "script":
    case "image":
    case "value":
    case "add":
      return; // Nothing drawn for these yet (file header) — nothing to highlight.
    default: {
      const exhaustive: never = object.type;
      void exhaustive;
      return;
    }
  }
}

function strokeHighlight(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
  ctx.lineWidth = SELECTION_HIGHLIGHT_WIDTH;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Screen-space chrome (D-092 clause 1, D-068's badge and indicator)
// ---------------------------------------------------------------------------

/**
 * The point `drawObjectChrome` anchors an object's chrome to — the SAME point
 * `drawObject` positions the object AT, so a label can never sit somewhere
 * other than where the picture actually is (D-010). `circle`/`polygon`/`rect`
 * require `origin.x`/`origin.y` to draw AT ALL, so their chrome anchor is
 * exactly as present as their body is; `table` draws even with a missing
 * origin (the same `?? 0` fallback `drawTable` uses), so its chrome anchor
 * does too. `undefined` for every type with no schema/visual definition yet
 * (file header) — there is nowhere to be "beside."
 */
function chromeAnchorPoint(object: GraphObject): Point | undefined {
  switch (object.type) {
    case "circle":
    case "polygon":
    case "rect": {
      const x = readNumber(object, ORIGIN_X_PATH);
      const y = readNumber(object, ORIGIN_Y_PATH);
      return x === undefined || y === undefined ? undefined : { x, y };
    }
    case "table":
      return { x: readNumber(object, ORIGIN_X_PATH) ?? 0, y: readNumber(object, ORIGIN_Y_PATH) ?? 0 };
    case "polyline":
    case "text":
    case "script":
    case "image":
    case "value":
    case "add":
      return undefined;
    default: {
      const exhaustive: never = object.type;
      void exhaustive;
      return undefined;
    }
  }
}

/**
 * Whether ANY slot on `object` currently holds an `ErrorValue` — §5.9's
 * "error badge on objects holding ErrorValues," read exactly as written: any
 * slot, not only the ones this file happens to draw from (a table cell's
 * formula can be broken while `origin`/`rows`/`cols` are perfectly fine).
 */
function objectHasError(object: GraphObject): boolean {
  return Object.values(object.slots).some((slot) => isErrorValue(slot.value));
}

/**
 * One object's screen-space chrome: its name label (D-092 clause 1), then —
 * if applicable — an error badge and a formula-driven indicator (§5.9,
 * D-068). Draws nothing for an object with no anchor point (see
 * `chromeAnchorPoint`); never throws.
 */
function drawObjectChrome(ctx: CanvasRenderingContext2D, camera: CameraState, object: GraphObject): void {
  const anchor = chromeAnchorPoint(object);
  if (anchor === undefined) {
    return;
  }
  const screen = worldToScreen(camera, anchor);
  drawNameLabel(ctx, screen, object.name);
  if (objectHasError(object)) {
    drawErrorBadge(ctx, screen);
  }
  drawFormulaDrivenTicks(ctx, screen, object);
}

/** D-092 clause 1: a name beside every object, screen-space and always on (Rule 5 — no hover/toggle mechanism yet). Centred above the anchor point. */
function drawNameLabel(ctx: CanvasRenderingContext2D, screen: ScreenPoint, name: string): void {
  ctx.fillStyle = CHROME_LABEL_STYLE;
  ctx.font = CHROME_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(name, screen.x, screen.y - CHROME_ANCHOR_MARGIN_SCREEN);
}

/** §5.9's error badge — a bare "!" beside the name label, distinguished only by colour (Rule 5's dumbest-correct reading; a real icon is a `style`-slots-era polish). */
function drawErrorBadge(ctx: CanvasRenderingContext2D, screen: ScreenPoint): void {
  ctx.fillStyle = CHROME_ERROR_BADGE_STYLE;
  ctx.font = CHROME_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("!", screen.x + CHROME_TICK_SPACING_SCREEN, screen.y - CHROME_ANCHOR_MARGIN_SCREEN);
}

/**
 * §5.9's "a subtle indicator on slots that are formula-driven rather than
 * literal" — read NARROWLY, for now, as the two component slots a drag can
 * actually move (`render/interaction.ts`'s per-component rule): `origin.x`
 * and `origin.y` (file header's NOT DONE HERE). Neither is ever `derived` (no
 * schema declares them so), so `"formula"` is the one kind that needs
 * marking — `render/interaction.ts`'s own drag skips exactly this kind, and
 * the operator has had no other way to learn which axis that is.
 */
function drawFormulaDrivenTicks(ctx: CanvasRenderingContext2D, screen: ScreenPoint, object: GraphObject): void {
  const xDriven = getSlot(object, ORIGIN_X_PATH)?.kind === "formula";
  const yDriven = getSlot(object, ORIGIN_Y_PATH)?.kind === "formula";
  if (!xDriven && !yDriven) {
    return;
  }
  ctx.fillStyle = CHROME_FORMULA_TICK_STYLE;
  ctx.font = CHROME_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  if (xDriven) {
    ctx.fillText("•x", screen.x - CHROME_TICK_SPACING_SCREEN, screen.y + CHROME_ANCHOR_MARGIN_SCREEN);
  }
  if (yDriven) {
    ctx.fillText("•y", screen.x + CHROME_TICK_SPACING_SCREEN, screen.y + CHROME_ANCHOR_MARGIN_SCREEN);
  }
}
