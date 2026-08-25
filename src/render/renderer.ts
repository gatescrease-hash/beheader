/**
 * renderer.ts — Canvas2D immediate-mode renderer: clear, apply the camera
 * transform, draw every object.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.9 ("Immediate mode. Every invalidation: clear,
 * apply camera transform, draw every visible object in z-order. No retained
 * scene graph, no diffing.") and §5.4's rendering clause ("fixed-size cells,
 * grid lines, numbers right-aligned and strings left-aligned"). First file
 * under `render/` with real drawing logic — §6.1 trigger 2 governs its own
 * review point (0060-REVIEW §10 names it explicitly), same posture
 * `primitives/geometry.ts` took: not on §6.2's load-bearing list, since it
 * only CONSUMES the graph, never defines addressing/mutation/schema.
 * LAYER: render. Touches Canvas2D directly — this is the one layer PROJECT_BRIEF
 * §3 Rule 1 does not bind (Rule 1 is `engine/`-only). May import: engine/*
 * (read-only), own layer. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `renderDocument(ctx, viewportWidth, viewportHeight, objects, camera)` — the
 *   one exported entry point, a pure function of its arguments (no retained
 *   state, no diffing, matching §5.9's own words exactly). Takes `objects`, not
 *   a whole engine `Document`: this file draws graph state, it does not care
 *   about `formatVersion`/`nextObjectId`/the journal, and staying narrow keeps
 *   it testable without constructing an irrelevant document (and sidesteps
 *   `Document` colliding with the DOM's own global `Document` type, which this
 *   file — unlike `engine/document.ts` — sits alongside).
 *
 *   Two steps, in order, matching §5.9's own sequence: (1) clear the WHOLE
 *   viewport in screen space (`ctx.setTransform` reset to identity first — see
 *   `clearScreen`'s own comment for why this must happen before any camera
 *   transform is applied); (2) set the camera transform once via
 *   `ctx.setTransform`, derived from `render/camera.ts`'s OWN
 *   `worldToScreen({x:0,y:0})` rather than a second, hand-written copy of the
 *   same formula (D-010's "declare once" principle — this file may never
 *   compute a different world<->screen mapping than `camera.ts` does), then
 *   draw every object using RAW WORLD-SPACE coordinates — the canvas's own
 *   transform does the screen conversion, so no draw call below ever calls
 *   `worldToScreen` itself.
 *
 *   Z-ORDER is `objects`' own array order — the brief names z-order but never
 *   gives objects an explicit z field, so array order (creation order, absent
 *   an explicit reorder command that does not exist yet) is the disclosed,
 *   reversible reading, matching Rule 5's "dumbest correct implementation."
 *
 *   Per-type drawing: `circle` reads `origin.x`/`origin.y`/`radius` directly
 *   and draws a TRUE ARC (`ctx.arc`) — §5.5, verbatim: "the renderer still
 *   draws a true arc," never the polygonal `vertices` approximation that slot
 *   exists for (bounds/hit-testing only). `polygon`/`rect` read the derived
 *   `vertices` slot and stroke the closed path it describes — the "consumers
 *   always read `vertices`" uniformity §5.5 promises. `table` draws a
 *   FIXED-SIZE grid (§5.4) and each cell's current value, right-aligned for a
 *   number and left-aligned otherwise (`formatCellValue`/`drawCellText`).
 *   Every other `ObjectType` (`polyline`, `text`, `script`, `image`, and the
 *   Phase-0-only `value`/`add` fixtures) draws nothing — honest, matching
 *   `primitives/schema.ts`'s own stance of returning `undefined` rather than a
 *   placeholder for a type with no schema/no visual definition yet.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. A missing, wrong-typed, or `ErrorValue` input to any
 *     per-type drawer (a circle with no numeric `radius`, a polygon whose
 *     `vertices` slot holds `#TYPE`) makes that ONE object draw nothing — it
 *     does not abort the loop or blank the rest of the canvas. This is NOT
 *     yet §5.9's "error badge" (see NOT DONE HERE); it is the minimum needed
 *     so one broken object cannot take the whole frame down.
 *   - No engine state is ever written here (Rule 2) — every function below
 *     only READS `GraphObject`/`Value` and calls `ctx` methods.
 *   - `ctx` is left holding the CAMERA transform on return, not identity —
 *     harmless frame to frame (`clearScreen` resets to identity first thing
 *     next frame), but a caller drawing SCREEN-space chrome after this
 *     function — a selection handle, an error badge, a HUD — must reset the
 *     transform itself first or it will be drawn camera-warped. Flagged for
 *     `render/interaction.ts` (0062-REVIEW edit 3).
 *
 * NOT DONE HERE
 *   - Selection highlight, error badges, and "formula-driven" slot indicators
 *     — §5.9 names all three, but each needs state this file has no way to
 *     read yet (a selection model, or a decision about how loudly to flag an
 *     `ErrorValue` — Q-NNN-worthy on its own). Deferred to whichever cycle
 *     builds `render/interaction.ts` and gives selection a home.
 *   - Hit-testing (`render/hittest.ts`) and any mouse/keyboard handling
 *     (`render/interaction.ts`) — this file only draws.
 *   - `style` slots (`strokeColor`/`fillColor`/`strokeWidth`, §5.5's `Path`
 *     shape) — `primitives/geometry.ts` does not declare them yet (its own
 *     NOT DONE HERE), so every shape below draws with ONE disclosed default
 *     stroke style (`DEFAULT_SHAPE_STROKE_STYLE`) until a schema exists to
 *     read from.
 *   - A table's OWN position. `primitives/schema.ts`'s `TABLE_SCHEMA` declares
 *     no `origin.x`/`origin.y` yet (§5.10's `table x=0 y=0 ...` implies one
 *     will exist, but no table-creation command has been built to need it —
 *     `primitives/table.ts`'s own NOT DONE HERE). `drawTable` reads
 *     `ORIGIN_X_PATH`/`ORIGIN_Y_PATH` (the SAME path `circle`/`polygon`/`rect`
 *     already use for their own position, imported from `geometry.ts` rather
 *     than re-declared) and falls back to `(0, 0)` when absent, so a real
 *     table origin — whenever the schema gains one — needs no renderer change
 *     at all, only the fallback ceasing to matter. Disclosed, reversible,
 *     zero document-state impact — not a `Q-NNN` (nothing about the data
 *     model, addressing, or mutation sequence turns on this).
 *   - Text/script/image objects (no schema yet — Phases 5/6).
 *   - `polyline`'s per-vertex slot shape (deferred with `explode`, per
 *     `geometry.ts`'s own NOT DONE HERE).
 *   - Any bound on how large a table's `rows`/`cols` may be, or `sides` for a
 *     polygon — STATUS.md's already-carried known problem; a huge table drawn
 *     here is exactly as slow as `primitives/geometry.ts` computing a huge
 *     `vertices` array, and the fix (if any) covers both together.
 */
import { getSlot, isErrorValue, type GraphObject, type Point, type Value } from "../engine/graph/node.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH, RADIUS_PATH, VERTICES_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import { formatCellReference, TABLE_CELL_PATH_PREFIX } from "../engine/address.ts";
import type { CameraState } from "../engine/document.ts";
import { worldToScreen } from "./camera.ts";

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

/** §5.4: "fixed-size cells." World-unit constants — untuned (Rule 5), scale on screen with zoom like everything else drawn here. PROVISIONAL(Q-012), same reading as the stroke width above. */
const TABLE_CELL_WIDTH = 80;
const TABLE_CELL_HEIGHT = 24;
const TABLE_CELL_TEXT_PADDING = 4;
const TABLE_GRID_STROKE_STYLE = "#999999";
const TABLE_CELL_TEXT_STYLE = "#1a1a1a";
const TABLE_CELL_FONT = "14px sans-serif";

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
 * §5.9's whole sequence: clear, apply the camera transform, draw every object
 * in z-order (array order — see file header). Never throws — see INVARIANTS
 * UPHELD HERE.
 */
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  viewportWidth: number,
  viewportHeight: number,
  objects: readonly GraphObject[],
  camera: CameraState,
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

/** A slot's current value, narrowed to `number` — `undefined` for anything else (missing, wrong-typed, an `ErrorValue`). Never throws. */
function readNumber(object: GraphObject, path: readonly string[]): number | undefined {
  const value = getSlot(object, path)?.value;
  return typeof value === "number" ? value : undefined;
}

/**
 * §5.5, verbatim: "For circle, the derived `vertices` slot yields a polygonal
 * approximation used for bounds and hit-testing; the renderer still draws a
 * true arc." Reads `origin.x`/`origin.y`/`radius` directly — never `vertices`
 * — so a circle's true shape does not depend on `CIRCLE_VERTEX_COUNT` at all.
 * Draws nothing for a missing/wrong-typed/negative radius (never throws).
 */
function drawCircle(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  const originX = readNumber(object, ORIGIN_X_PATH);
  const originY = readNumber(object, ORIGIN_Y_PATH);
  const radius = readNumber(object, RADIUS_PATH);
  if (originX === undefined || originY === undefined || radius === undefined || radius < 0) {
    return;
  }
  ctx.beginPath();
  ctx.arc(originX, originY, radius, 0, Math.PI * 2);
  ctx.strokeStyle = DEFAULT_SHAPE_STROKE_STYLE;
  ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
  ctx.stroke();
}

/**
 * Narrows a slot's current value to a `Point[]` — `undefined` for everything
 * else, an `ErrorValue` included. `readonly Point[]` is the ONLY array arm of
 * `Value` (§5.1, `graph/node.ts`), so `Array.isArray` alone excludes every
 * other member and no separate `isErrorValue` guard is needed here (an
 * `ErrorValue` is not an array). Never throws.
 */
function asPointArray(value: Value | undefined): readonly Point[] | undefined {
  if (value === undefined || !Array.isArray(value)) {
    return undefined;
  }
  return value as readonly Point[];
}

/**
 * `polygon`/`rect` (§5.5: "Consumers always read `vertices`") — strokes the
 * closed path `vertices` describes. Draws nothing for a missing, wrong-typed,
 * `ErrorValue`, or empty `vertices` (never throws).
 */
function drawVerticesShape(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  const first = vertices?.[0];
  if (vertices === undefined || first === undefined) {
    return;
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
  ctx.strokeStyle = DEFAULT_SHAPE_STROKE_STYLE;
  ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
  ctx.stroke();
}

/**
 * §5.4: "fixed-size cells, grid lines... Formula bar / in-place editing" (the
 * latter is `render/interaction.ts`'s job, not built here). Draws every cell
 * in `1..rows x 1..cols` (`getTableDimensions`, D-046-safe) as a bordered
 * rectangle plus its current value, positioned from `originX`/`originY` (see
 * file header's NOT DONE HERE for the `(0,0)` fallback). Never throws.
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
