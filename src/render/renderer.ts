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
 *   selectedObjectIds?, panelledObjectIds?)` — the one exported entry point, a
 *   pure function of its arguments. It takes `objects`, not a whole engine
 *   `Document`: this file draws graph state, and the narrow argument both
 *   keeps it testable and sidesteps `Document` colliding with the DOM's own
 *   global `Document` type, which this file — unlike `engine/document.ts` —
 *   sits alongside.
 *
 *   THREE passes, in this order:
 *     1. Clear the WHOLE viewport in screen space (transform reset to
 *        identity FIRST — see `clearScreen`).
 *     2. Set the camera transform ONCE and draw every object, then — for
 *        every id in `selectedObjectIds` that names one of them (**D-100**
 *        clause 8 widens this from one id to a list) — that object's
 *        selection highlight, in RAW WORLD-SPACE coordinates — letting the
 *        canvas transform do the conversion. No draw call in this pass ever
 *        calls `worldToScreen` itself. The transform is derived from
 *        `camera.ts`'s OWN `worldToScreen` rather than a second hand-written
 *        copy of the formula (D-010): this file may never compute a
 *        different world<->screen mapping than `camera.ts` does.
 *     3. Reset to identity again and draw every object's SCREEN-SPACE chrome
 *        — a name label (D-092 clause 1), an error badge, a formula-driven
 *        indicator (§5.9, D-068) — each converted through `worldToScreen`
 *        explicitly, because chrome text must stay a constant size regardless
 *        of zoom, unlike the geometry in pass 2. Every id in `panelledObjectIds`
 *        (**D-106** clause 5) has its name label suppressed here: its name
 *        moves into its properties panel's header, which `main.ts` draws.
 *        Its badge and ticks still draw — they mark the shape, and the panel
 *        says the same in words.
 *
 *   `selectedObjectIds` (the highlight) and `panelledObjectIds` (the name
 *   suppression) are DELIBERATELY two separate lists, not one collapsed back
 *   together (**D-106** clause 5): a selected object whose panel has been
 *   DISMISSED keeps its highlight — the operator is still working with it —
 *   but gets its canvas name label back, because nothing else is showing it
 *   any more. `panelledObjectIds` defaults to `selectedObjectIds`, which is
 *   what keeps every pre-D-106 call site (every test written before this
 *   ruling, and any future one that has no reason to dismiss a panel) meaning
 *   "the panel follows the selection" without passing a second argument.
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
 *   - `script`/`image` objects (no schema — Phase 6) and `polyline`'s per-vertex
 *     shape (deferred with `explode`) draw no body AND no chrome —
 *     `chromeAnchorPoint` returns `undefined` for every type with no extent.
 *     `text` DOES draw now (entry 0138): `drawText` lays `resolvedContent` out
 *     from `origin` (top-left), wrapping at a numeric `width` slot via the SAME
 *     `layOutLines` the measurer uses (`render/measure.ts`), honouring
 *     `style.font`/`fontSize`/`lineHeight`/`color`/`align`. Its chrome and
 *     selection highlight fall out of `extent.ts`'s new `text` extent.
 *   - Markdown-lite (`**bold**`, `# heading`, `- list`, …) and `overflow`
 *     `"clip"`/`"ellipsis"` — NOT this cycle. `resolvedContent`'s markup is
 *     drawn VERBATIM (exactly as `render/measure.ts` still measures it), and
 *     every `text` object draws with `overflow: "visible"` semantics. Both are
 *     the next Phase 5 slice, together with making the measurer markup-aware.
 *   - Any bound on `rows`/`cols`/`sides` — a carried known problem; one fix
 *     covers drawing and evaluation together.
 */
import { getSlot, isErrorValue, type GraphObject, type Point, type Value } from "../engine/graph/node.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH, RADIUS_PATH, VERTICES_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import {
  TEXT_RESOLVED_CONTENT_PATH,
  TEXT_STYLE_ALIGN_PATH,
  TEXT_STYLE_COLOR_PATH,
  TEXT_STYLE_FONT_PATH,
  TEXT_STYLE_FONT_SIZE_PATH,
  TEXT_STYLE_LINE_HEIGHT_PATH,
  TEXT_WIDTH_PATH,
} from "../engine/primitives/text.ts";
import { formatCellReference, TABLE_CELL_PATH_PREFIX } from "../engine/address.ts";
import type { CameraState } from "../engine/document.ts";
import { worldToScreen } from "./camera.ts";
import { cssFont, layOutLines } from "./measure.ts";
import { asPointArray, readNumber, readText, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";
// D-066's one extent, reused as the chrome anchor (see `chromeAnchorPoint`).
// `extent.ts` and `slots.ts` are D-093's split: neither this file nor
// `hittest.ts` imports the other any more, so there is no cycle to flag here.
import { objectExtent } from "./extent.ts";

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

// §5.4's fixed cell size (`TABLE_CELL_WIDTH`/`TABLE_CELL_HEIGHT`) moved to
// `slots.ts` at D-093's split — `hittest.ts` and `extent.ts` need the SAME
// constants (D-010) and this file no longer defines them, only imports them.
const TABLE_CELL_TEXT_PADDING = 4;
const TABLE_GRID_STROKE_STYLE = "#999999";
const TABLE_CELL_TEXT_STYLE = "#1a1a1a";
const TABLE_CELL_FONT = "14px sans-serif";

/**
 * Fallbacks for a `text` object whose `style.*` slots are absent — reachable
 * only from a hand-built test fixture, since `command/commands.ts`'s `createText`
 * always supplies all five (its own `DEFAULT_TEXT_*`). They exist so `drawText`
 * never feeds `ctx.font` a `NaN` size or `undefined` family; a real `text`
 * object draws with its OWN slot values. World units (Q-012's provisional (a),
 * like `TABLE_CELL_FONT`), round and untuned (Rule 5).
 */
const DEFAULT_TEXT_FILL_STYLE = "#1a1a1a";
const DEFAULT_TEXT_FONT_FAMILY = "sans-serif";
const DEFAULT_TEXT_FONT_SIZE = 16;
const DEFAULT_TEXT_LINE_HEIGHT = 20;

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
const CHROME_GAP_SCREEN = 6;
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
 * §5.9's whole sequence, widened by D-068/D-092/D-100/D-106: clear, apply the
 * camera transform, draw every object in z-order (array order — see file
 * header), draw every selected object's highlight, then reset to identity and
 * draw every object's screen-space chrome. An empty list, or one holding only
 * stale ids (D-023-shaped), draws no highlight and suppresses no label;
 * never throws.
 */
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  viewportWidth: number,
  viewportHeight: number,
  objects: readonly GraphObject[],
  camera: CameraState,
  selectedObjectIds: readonly string[] = [],
  panelledObjectIds: readonly string[] = selectedObjectIds,
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

  // D-100 clause 8: every selected id, not just one. A `Set` so a duplicate
  // (never produced by `interaction.ts`'s own toggle, but not this file's to
  // assume) cannot double-stroke a highlight.
  const selectedIds = new Set(selectedObjectIds);

  // Drawn LAST in world space, in DOCUMENT order — never inline with the loop
  // above — so a highlight is never occluded by a later object in z-order
  // (file header).
  for (const object of objects) {
    if (selectedIds.has(object.id)) {
      drawSelectionHighlight(ctx, object);
    }
  }

  // Screen-space chrome: a fresh identity reset (clearScreen's own reasoning
  // applies again — a transform-warped label is not screen-space), then one
  // explicit worldToScreen per object (file header's pass 3).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // D-106 clause 5: a SEPARATE set from `selectedIds` — see file header.
  const panelledIds = new Set(panelledObjectIds);
  for (const object of objects) {
    // D-094 clause 3, generalised by D-100 clause 8, narrowed again by D-106
    // clause 4: a PANELLED object's NAME moves into its properties panel's
    // header, so it is not also drawn on the canvas. A selected-but-dismissed
    // object is NOT in `panelledIds` and gets its name back. Its badge and
    // ticks are never suppressed either way.
    drawObjectChrome(ctx, camera, object, panelledIds.has(object.id));
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
    case "text":
      drawText(ctx, object);
      return;
    case "polyline":
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
// Text (§5.6) — entry 0138. World space, under the camera transform like every
// other object body: font size is in world units and scales with zoom (Q-012's
// provisional (a), the same reading `drawTable`'s font takes).
// ---------------------------------------------------------------------------

/** One `text` object's paint-relevant style, every field defaulted so `drawText`'s arithmetic and `ctx.font` are always valid (see `DEFAULT_TEXT_*`). */
interface ResolvedTextStyle {
  readonly family: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly color: string;
  readonly align: CanvasTextAlign;
}

/**
 * Reads `style.font`/`fontSize`/`lineHeight`/`color`/`align` off `object`,
 * falling back per field. `align` is clamped to the three §5.6 values a
 * `ctx.textAlign` can be here (`left`/`center`/`right`); anything else — an
 * unknown string, a formula result — reads as `left`, the default.
 */
function resolveTextStyle(object: GraphObject): ResolvedTextStyle {
  const fontSize = readNumber(object, TEXT_STYLE_FONT_SIZE_PATH);
  const lineHeight = readNumber(object, TEXT_STYLE_LINE_HEIGHT_PATH);
  const align = readText(object, TEXT_STYLE_ALIGN_PATH);
  return {
    family: readText(object, TEXT_STYLE_FONT_PATH) ?? DEFAULT_TEXT_FONT_FAMILY,
    fontSize: fontSize !== undefined && fontSize > 0 ? fontSize : DEFAULT_TEXT_FONT_SIZE,
    lineHeight: lineHeight !== undefined && lineHeight > 0 ? lineHeight : DEFAULT_TEXT_LINE_HEIGHT,
    color: readText(object, TEXT_STYLE_COLOR_PATH) ?? DEFAULT_TEXT_FILL_STYLE,
    align: align === "center" || align === "right" ? align : "left",
  };
}

/**
 * §5.6: draws a `text` object's `resolvedContent` from `origin` (its top-left,
 * the same meaning `rect`/`table` give `origin`), wrapping at the `width` slot
 * when it holds a positive number (§5.6's "fixed width + auto height (wrap, grow
 * down) is the default"; `"auto"` — or any non-number — means no wrap).
 *
 * Line-breaking goes through `render/measure.ts`'s `layOutLines` with THIS ctx's
 * `measureText`, so the drawn lines are exactly the ones `measuredHeight` was
 * measured from (D-010) — while the object's `style.*` slots are usable, which
 * they are for every object `createText` builds. A broken style makes the two
 * files fall back differently and their line counts can then disagree; see
 * `measure.ts`'s header. `resolvedContent` already carries any `!`-marked broken
 * span (D-116 and D-117, engine-side) — this function just draws the string.
 *
 * Markdown-lite markup is drawn verbatim and `overflow` is not consulted (both
 * the next slice — file header). Draws nothing for an unset, non-string, or
 * empty `resolvedContent` (an empty text object takes no ink, matching
 * `measure.ts`'s zero box); a `style.*` slot that is missing or holds a
 * non-usable value falls back per `resolveTextStyle` rather than blanking the
 * text. Never throws.
 */
function drawText(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  const resolved = readText(object, TEXT_RESOLVED_CONTENT_PATH);
  if (resolved === undefined) {
    return;
  }
  const style = resolveTextStyle(object);
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;

  ctx.font = cssFont(style.fontSize, style.family);

  const fixedWidth = readNumber(object, TEXT_WIDTH_PATH);
  const wrapWidth = fixedWidth !== undefined && fixedWidth > 0 ? fixedWidth : undefined;
  const lines = layOutLines(resolved, wrapWidth, (line) => ctx.measureText(line).width);

  // Alignment needs a box width: the fixed `width` when set, else the widest
  // laid-out line (auto width — the text is as wide as it draws).
  let boxWidth = wrapWidth ?? 0;
  if (wrapWidth === undefined) {
    for (const line of lines) {
      boxWidth = Math.max(boxWidth, ctx.measureText(line).width);
    }
  }

  ctx.fillStyle = style.color;
  ctx.textBaseline = "top";
  ctx.textAlign = style.align;
  const x = style.align === "center" ? originX + boxWidth / 2 : style.align === "right" ? originX + boxWidth : originX;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue; // noUncheckedIndexedAccess artifact only — `i` is always in range.
    }
    ctx.fillText(line, x, originY + i * style.lineHeight);
  }
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
    case "text": {
      // The SAME box `drawText` draws into and `hittest.ts` clicks against —
      // `extent.ts`'s `objectExtent` (D-066/D-010), not a second reading.
      const extent = objectExtent(object);
      if (extent === undefined) {
        return; // No resolved content — nothing drawn, nothing to highlight.
      }
      ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
      ctx.lineWidth = SELECTION_HIGHLIGHT_WIDTH;
      ctx.strokeRect(extent.minX, extent.minY, extent.maxX - extent.minX, extent.maxY - extent.minY);
      return;
    }
    case "polyline":
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
 * Where an object's chrome hangs from: the TOP-CENTRE of its drawn extent,
 * in world space.
 *
 * **Why the extent and NOT `origin.x`/`origin.y`.** `origin` does not mean the
 * same thing across types — it is a circle's and a polygon's CENTRE but a
 * rect's and a table's TOP-LEFT CORNER (`primitives/geometry.ts`). Entry 0093
 * anchored to it and the result, seen in a browser for the first time at entry
 * 0094, was a table labelled above its grid like a title and a circle labelled
 * *inside itself*. Each was 6px above its own anchor, so every test passed; the
 * defect was in what the anchor MEANT, which is not a thing an offset
 * assertion can catch.
 *
 * The drawn extent is the one quantity that means the same for every type, and
 * D-066 already rules that the drawn extent and the clickable extent are ONE
 * extent — so this reuses `extent.ts`'s `objectExtent` rather than computing a
 * second reading of the same question (D-010). `undefined` for an object that
 * draws nothing, which is exactly the set that has no extent.
 *
 * A consequence worth stating: chrome now appears precisely when an object has
 * a drawn extent, so a hand-built shape with an `origin` but no `vertices`
 * slot gets neither body nor label (it previously got a label). For any object
 * built through `mutate`, `vertices` is a schema-declared derived slot and is
 * always present, so this is a fixture-only difference.
 */
function chromeAnchorPoint(object: GraphObject): Point | undefined {
  const extent = objectExtent(object);
  if (extent === undefined) {
    return undefined;
  }
  // Y grows DOWNWARD in this coordinate system (`drawTable`'s own row layout),
  // so `minY` is the object's TOP edge.
  return { x: (extent.minX + extent.maxX) / 2, y: extent.minY };
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
 * One object's screen-space chrome, laid out as ONE line above the object's
 * top edge: `[•x •y] name [!]`.
 *
 * All three pieces share a baseline and none is drawn inside the shape —
 * entry 0093 put the ticks BELOW the anchor, which under the old centre-anchor
 * meant inside a circle and under the new top-anchor would mean inside every
 * shape. The horizontal offsets are MEASURED off the name (`ctx.measureText`)
 * rather than assumed, so a long name pushes the badge and the ticks out
 * instead of colliding with them.
 *
 * Draws nothing for an object with no anchor point (see `chromeAnchorPoint`);
 * never throws.
 *
 * `suppressName` (D-094 clause 3) omits ONLY the name label — the badge and the
 * ticks still draw. With no name drawn there is no name width to measure, so
 * `halfName` is 0 and the badge and ticks sit a gap either side of the anchor.
 */
function drawObjectChrome(ctx: CanvasRenderingContext2D, camera: CameraState, object: GraphObject, suppressName: boolean): void {
  const anchor = chromeAnchorPoint(object);
  if (anchor === undefined) {
    return;
  }
  const screen = worldToScreen(camera, anchor);
  const baseline = screen.y - CHROME_ANCHOR_MARGIN_SCREEN;

  ctx.font = CHROME_FONT;
  ctx.textBaseline = "bottom";

  // D-092 clause 1: a name for every object, screen-space and always on
  // (Rule 5 — no hover or toggle mechanism yet), EXCEPT the selected one,
  // whose name is in the properties panel's header instead (D-094 clause 3).
  ctx.fillStyle = CHROME_LABEL_STYLE;
  ctx.textAlign = "center";
  if (!suppressName) {
    ctx.fillText(object.name, screen.x, baseline);
  }

  const halfName = suppressName ? 0 : ctx.measureText(object.name).width / 2;

  // §5.9's error badge. A bare "!" in the error colour, to the RIGHT of the
  // name — Rule 5's dumbest correct reading; a drawn icon is `style`-slots-era.
  if (objectHasError(object)) {
    ctx.fillStyle = CHROME_ERROR_BADGE_STYLE;
    ctx.textAlign = "left";
    ctx.fillText("!", screen.x + halfName + CHROME_GAP_SCREEN, baseline);
  }

  const ticks = formulaDrivenTicks(object);
  if (ticks !== "") {
    // To the LEFT of the name, right-aligned so it grows away from it.
    ctx.fillStyle = CHROME_FORMULA_TICK_STYLE;
    ctx.textAlign = "right";
    ctx.fillText(ticks, screen.x - halfName - CHROME_GAP_SCREEN, baseline);
  }
}

/**
 * §5.9's "a subtle indicator on slots that are formula-driven rather than
 * literal", as the text to draw — `""` when neither axis is driven.
 *
 * Read NARROWLY, for now, as the two component slots a drag can actually move
 * (`render/interaction.ts`'s per-component rule): `origin.x` and `origin.y`
 * (file header's NOT DONE HERE). Neither is ever `derived` (no schema declares
 * them so), so `"formula"` is the one kind that needs marking — a drag skips
 * exactly that kind, and the operator has had no other way to learn which axis
 * is the one that will not move.
 */
function formulaDrivenTicks(object: GraphObject): string {
  const xDriven = getSlot(object, ORIGIN_X_PATH)?.kind === "formula";
  const yDriven = getSlot(object, ORIGIN_Y_PATH)?.kind === "formula";
  if (xDriven && yDriven) {
    return "•x •y";
  }
  if (xDriven) {
    return "•x";
  }
  return yDriven ? "•y" : "";
}
