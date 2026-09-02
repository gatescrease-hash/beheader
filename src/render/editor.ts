/**
 * editor.ts — Which receiver a double-click opens the in-place editor on, and
 * where that editor's overlay floats.
 *
 * IMPLEMENTS: the geometry half of **D-125** (in-place text entry) — clause 1
 * (one editor, over a `text` object's `content` or a table cell, at the
 * receiver's own position) and clause 6 (an empty `text` object still gets a
 * box to edit in, drawn by the editor, never by loosening `extent.ts`). The
 * commit rules (clause 3) and every line of DOM (clauses 5, 7) are `main.ts`'s.
 * LAYER: render (pure). No canvas, DOM, or window — coordinate math over
 * `GraphObject`/`CameraState`. May import: engine/* (read-only), own layer
 * (`./camera.ts`, `./extent.ts`, `./hittest.ts`, `./slots.ts`). NEVER imports
 * command/*, the DOM, or a canvas; NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `editorTargetAt(screenPoint, objects, camera)` walks the SAME `hitTest`
 *   z-order a plain click uses and, when the topmost object under the point is
 *   editable in place, names it: a `text` object as a whole, or a `table`
 *   resolved to the one cell the point falls in. `undefined` for everything
 *   else (a shape, empty canvas, a `text` object with no drawn extent).
 *
 *   `editorPlacement(target, object, camera, ratioBackingPerCss)` returns the
 *   overlay's top-left corner and size in CSS pixels, from the receiver's own
 *   world box — `extent.ts`'s `objectExtent` for a `text` object, the cell's
 *   world rectangle for a cell — through `camera.ts`'s `worldToScreen`, then
 *   divided by the canvas's backing/CSS ratio the way `panel.ts` does.
 *
 *   `editorTextStyle(target, object, camera, ratioBackingPerCss)` returns how
 *   the overlay SETS that text (**D-129**, widened at entry 0147 on the
 *   operator's report): size, family, line height, alignment and whether it
 *   wraps. Every length is the drawn text's own world value scaled by the SAME
 *   `camera.zoom / ratio` the box is, and every slot is read the way
 *   `renderer.ts` reads it for drawing — because the overlay sits ON the drawn
 *   text, so any disagreement about the font or the wrap width shows up as the
 *   editor breaking a line the canvas keeps whole.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws; reads only, writes nothing (Rule 2).
 *   - Every LAYOUT-affecting read here mirrors `renderer.ts`'s
 *     `resolveTextStyle` / `drawText` / `measure.ts`'s `cssFont` read-for-read
 *     (shared `readNumber`/`readText`, the same positive-number tests, the same
 *     blank-family screen, the same `width`-slot wrap rule), so drawn and typed
 *     text lay out the same. `wraps` is `drawText`'s own `wrapWidth` condition,
 *     not a second reading of §5.6's layout rule. `style.color` is the one
 *     `resolveTextStyle` read deliberately NOT mirrored — see NOT DONE HERE.
 *   - World<->screen is `camera.ts`'s own `worldToScreen`/`screenToWorld`,
 *     never a second hand-written copy (D-010).
 *   - A cell's rectangle is the SAME `origin` + `TABLE_CELL_*` reading
 *     `renderer.ts` draws the grid with and `hittest.ts` clicks it with, via
 *     `slots.ts` (D-010) — the overlay lands exactly on the drawn cell.
 *   - An empty `text` object's fallback box is the EDITOR's own affordance
 *     (D-125 clause 6): `extent.ts` still returns `undefined` for it and is
 *     not loosened to fake an extent (D-066).
 *
 * NOT DONE HERE
 *   - Seeding the editor's text, building the commit `Command`, deciding
 *     literal-vs-formula, or any DOM — `main.ts` (D-125 clauses 2-3, 5, 7).
 *   - Opening the editor on a freshly-placed `text` object — D-124's wiring.
 *   - Rendering markdown-lite in the overlay. An editor shows RAW SOURCE
 *     (§5.6's `content`), which is also what `renderer.ts` draws today, so the
 *     two agree; the markdown-lite cycle will make them differ deliberately.
 *   - The cell editor's 4-world-unit text inset (`renderer.ts`'s
 *     `TABLE_CELL_TEXT_PADDING`) and a number cell's right-alignment: the
 *     editor holds the SOURCE being typed, which Excel left-aligns too.
 *   - Matching `style.color` (**D-132**). The overlay keeps one high-contrast
 *     ink, set in `index.html`. Colour cannot move a glyph, so unlike the four
 *     slots above it can never make the typed text lay out differently from the
 *     drawn text — which is the defect D-129 exists to close.
 */
import type { CameraState } from "../engine/document.ts";
import { formatCellReference, parseCellReference } from "../engine/address.ts";
import { TABLE_TYPE, TEXT_TYPE, type GraphObject } from "../engine/graph/node.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import {
  TEXT_STYLE_ALIGN_PATH,
  TEXT_STYLE_FONT_PATH,
  TEXT_STYLE_FONT_SIZE_PATH,
  TEXT_STYLE_LINE_HEIGHT_PATH,
  TEXT_WIDTH_PATH,
} from "../engine/primitives/text.ts";
import { screenToWorld, worldToScreen, type ScreenPoint } from "./camera.ts";
import { objectExtent, type WorldExtent } from "./extent.ts";
import { hitTest } from "./hittest.ts";
import { readNumber, readText, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";

/**
 * What the in-place editor is open on (**D-125** clause 1). A `text` object is
 * named as a whole — its `content` is the single slot the editor writes. A
 * `cell` names the table plus the A1-form reference of the one cell picked, so
 * `main.ts` builds the address through `address.ts`'s formatter and never a
 * string join it invented.
 */
export type EditorTarget =
  | { readonly kind: "text"; readonly objectId: string }
  | { readonly kind: "cell"; readonly objectId: string; readonly cell: string };

/** The editor overlay's box, in CSS pixels from the canvas's top-left — the same space `panel.ts`'s `PanelPlacement` is measured in. */
export interface EditorPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How the overlay sets the text inside that box (**D-129**, widened at entry
 * 0147). `fontSize` and `lineHeight` are CSS pixels — the drawn text's own
 * world lengths scaled by `camera.zoom / ratio`, the same factor the box is
 * scaled by. `wraps` is whether the overlay may break a line at all: FALSE for
 * an auto-width `text` object, because §5.6's "auto width + auto height means
 * no wrapping" is what `renderer.ts` draws, and a `<textarea>` that soft-wraps
 * anyway is the defect the operator reported (one drawn line, two typed ones).
 */
export interface EditorTextStyle {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly lineHeight: number;
  readonly textAlign: "left" | "center" | "right";
  readonly wraps: boolean;
}

/**
 * The box the editor draws for a `text` object whose `content` is empty, so it
 * has no `extent.ts` extent (D-066) — reached when D-124 hands a just-created
 * empty box straight to the editor. World units, round and untuned (Rule 5),
 * the same size `extent.ts`'s own no-measurer fallback uses; it is the EDITOR's
 * affordance and never enters graph state (D-125 clause 6).
 */
const EMPTY_TEXT_EDITOR_WIDTH = 240;
const EMPTY_TEXT_EDITOR_HEIGHT = 20;

/**
 * The world-unit type style the overlay scales from (**D-129**), before
 * `camera.zoom / ratio` is applied. Two groups, and neither is invented here:
 *
 *   - `TEXT_EDITOR_FALLBACK_*` stand in when a `text` object's own `style.*`
 *     slot is missing or unusable, and mirror `renderer.ts`'s `DEFAULT_TEXT_*`
 *     **by value** (16 / 20 / "sans-serif") so a broken-style object's overlay
 *     falls back exactly where its drawn text does. A real `text` object uses
 *     its own slots and never reaches these.
 *   - `CELL_EDITOR_*` mirror `renderer.ts`'s `TABLE_CELL_FONT` ("14px
 *     sans-serif") — a cell has no per-object style slot, so the overlay
 *     matches the one font `drawTable` uses.
 *
 * Mirrored by value rather than imported because `renderer.ts` keeps its
 * fallbacks private, and STATUS already carries the open question of which file
 * OWNS one shared set (`measure.ts` and `renderer.ts` fall back differently
 * today — 0139-REVIEW left it for a ruling). This file is a third reader of the
 * same set; it deliberately does not invent a fourth answer.
 */
const TEXT_EDITOR_FALLBACK_FONT_SIZE = 16;
const TEXT_EDITOR_FALLBACK_LINE_HEIGHT = 20;
const TEXT_EDITOR_FALLBACK_FONT_FAMILY = "sans-serif";
const CELL_EDITOR_FONT_SIZE = 14;
const CELL_EDITOR_FONT_FAMILY = "sans-serif";

/**
 * The receiver a double-click at `screenPoint` opens the editor on, or
 * `undefined` when nothing under the point is editable in place.
 *
 * Uses `hitTest` so the editor opens on exactly the object a click would have
 * selected (same z-order, same per-type test) — a `text` object with no drawn
 * extent is not hittable and so returns `undefined` here too, which is D-125
 * clause 6's case that only D-124's creation path reaches.
 */
export function editorTargetAt(
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  camera: CameraState,
): EditorTarget | undefined {
  const hit = hitTest(screenPoint, objects, camera);
  if (hit === undefined) {
    return undefined;
  }
  if (hit.type === TEXT_TYPE) {
    return { kind: "text", objectId: hit.id };
  }
  if (hit.type === TABLE_TYPE) {
    const cell = cellReferenceAt(hit, screenPoint, camera);
    return cell === undefined ? undefined : { kind: "cell", objectId: hit.id, cell };
  }
  return undefined;
}

/**
 * The A1-form reference of the cell `screenPoint` falls in, or `undefined` when
 * it lands outside the table's row/column extent (a floating-point edge case —
 * `hitTest` already put the point inside the table's drawn box). Built from the
 * same `origin` + `TABLE_CELL_*` reading `hittest.ts`/`renderer.ts` use.
 */
function cellReferenceAt(object: GraphObject, screenPoint: ScreenPoint, camera: CameraState): string | undefined {
  const world = screenToWorld(camera, screenPoint);
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);
  const column = Math.floor((world.x - originX) / TABLE_CELL_WIDTH) + 1;
  const row = Math.floor((world.y - originY) / TABLE_CELL_HEIGHT) + 1;
  if (column < 1 || column > cols || row < 1 || row > rows) {
    return undefined;
  }
  return formatCellReference({ column, row });
}

/**
 * Where the editor overlay's box sits, in CSS pixels (D-125 clause 1: "the same
 * way `main.ts` already places a properties panel").
 *
 * `ratioBackingPerCss` is `canvas.width / bounds.width` (D-086 clause 3): the
 * points `worldToScreen` returns are BACKING pixels and the overlay is laid out
 * in CSS pixels. A non-finite or non-positive ratio falls back to 1, the same
 * "a bad number does not move furniture" posture `panel.ts`/`camera.ts` take.
 */
export function editorPlacement(
  target: EditorTarget,
  object: GraphObject,
  camera: CameraState,
  ratioBackingPerCss: number,
): EditorPlacement {
  const ratio = usableRatio(ratioBackingPerCss);
  const box = target.kind === "text" ? textEditorBox(object) : cellEditorBox(object, target.cell);
  const topLeft = worldToScreen(camera, { x: box.minX, y: box.minY });
  const bottomRight = worldToScreen(camera, { x: box.maxX, y: box.maxY });
  return {
    left: topLeft.x / ratio,
    top: topLeft.y / ratio,
    width: (bottomRight.x - topLeft.x) / ratio,
    height: (bottomRight.y - topLeft.y) / ratio,
  };
}

/**
 * How the overlay sets its text (**D-129**, widened at entry 0147): the size,
 * family, line height and alignment `renderer.ts` would draw the same receiver
 * with, and whether the text may wrap.
 *
 * Every length is a WORLD length scaled by `camera.zoom / ratio` — the identical
 * factor `editorPlacement` scales the box by (clause 1: the overlay sits at the
 * receiver's own position, so its glyphs must scale with it or the two disagree
 * at every zoom but 1).
 *
 * PROVISIONAL(Q-012): that a font size (and `TABLE_CELL_HEIGHT`) is a WORLD
 * length at all is `renderer.ts`'s open reading, which this file FOLLOWS rather
 * than answering a second time. Tagged so Q-012's reconciliation grep finds this
 * site: if it lands on SCREEN pixels, `renderer.ts` stops scaling the drawn font
 * with zoom and this function stops scaling the typed one, in the same cycle.
 *
 * `wraps` is `drawText`'s own wrap condition, re-read rather than re-decided: a
 * positive numeric `width` slot is the wrap boundary, and `"auto"` means no
 * wrapping at all (§5.6). A `<textarea>` soft-wraps by default, which for an
 * auto-width object broke one drawn line into two typed ones — the operator's
 * report at entry 0147.
 */
export function editorTextStyle(
  target: EditorTarget,
  object: GraphObject,
  camera: CameraState,
  ratioBackingPerCss: number,
): EditorTextStyle {
  const scale = camera.zoom / usableRatio(ratioBackingPerCss);
  if (target.kind === "cell") {
    // A cell has no per-object style slots — `drawTable` draws every cell in one
    // font, and centres the line vertically in the cell (`textBaseline`
    // "middle"), which a line box the full cell height reproduces.
    return {
      fontSize: CELL_EDITOR_FONT_SIZE * scale,
      fontFamily: CELL_EDITOR_FONT_FAMILY,
      lineHeight: TABLE_CELL_HEIGHT * scale,
      textAlign: "left",
      wraps: false,
    };
  }
  const fontSize = readNumber(object, TEXT_STYLE_FONT_SIZE_PATH);
  const lineHeight = readNumber(object, TEXT_STYLE_LINE_HEIGHT_PATH);
  const align = readText(object, TEXT_STYLE_ALIGN_PATH);
  const fixedWidth = readNumber(object, TEXT_WIDTH_PATH);
  // A BLANK family is a fallback too, not a typeface: `renderer.ts` draws
  // through `measure.ts`'s `cssFont`, which screens `family.trim() === ""` on
  // top of `readText`'s empty-string screen. Applying only half of that pair
  // here sets an INVALID `font-family` on the overlay, which the CSSOM drops —
  // leaving it on the page's inherited MONOSPACE, which is entry 0147's own
  // defect one corner in (0148-REVIEW).
  const family = readText(object, TEXT_STYLE_FONT_PATH);
  return {
    fontSize: (fontSize !== undefined && fontSize > 0 ? fontSize : TEXT_EDITOR_FALLBACK_FONT_SIZE) * scale,
    fontFamily: family === undefined || family.trim() === "" ? TEXT_EDITOR_FALLBACK_FONT_FAMILY : family,
    lineHeight: (lineHeight !== undefined && lineHeight > 0 ? lineHeight : TEXT_EDITOR_FALLBACK_LINE_HEIGHT) * scale,
    // The same three-way clamp `resolveTextStyle` makes: anything that is not
    // "center"/"right" draws left, so the overlay does too.
    textAlign: align === "center" || align === "right" ? align : "left",
    wraps: fixedWidth !== undefined && fixedWidth > 0,
  };
}

/** The backing/CSS ratio, guarded — a non-finite or non-positive one falls back to 1, the "a bad number does not move furniture" posture `panel.ts`/`camera.ts` take. Shared by both exported functions so the box and its text can never be scaled by different factors. */
function usableRatio(ratioBackingPerCss: number): number {
  return Number.isFinite(ratioBackingPerCss) && ratioBackingPerCss > 0 ? ratioBackingPerCss : 1;
}

/** A `text` object's world box: its drawn extent, or — for an empty one with no extent (D-125 clause 6) — the editor's own fallback box anchored at `origin`. */
function textEditorBox(object: GraphObject): WorldExtent {
  const extent = objectExtent(object);
  if (extent !== undefined) {
    return extent;
  }
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  return {
    minX: originX,
    minY: originY,
    maxX: originX + EMPTY_TEXT_EDITOR_WIDTH,
    maxY: originY + EMPTY_TEXT_EDITOR_HEIGHT,
  };
}

/** One cell's world rectangle, from the table's `origin` and the fixed cell size — the exact rect `renderer.ts`'s `drawTable` strokes for that cell. */
function cellEditorBox(object: GraphObject, cell: string): WorldExtent {
  const coordinates = parseCellReference(cell);
  const column = coordinates?.column ?? 1;
  const row = coordinates?.row ?? 1;
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const left = originX + (column - 1) * TABLE_CELL_WIDTH;
  const top = originY + (row - 1) * TABLE_CELL_HEIGHT;
  return { minX: left, minY: top, maxX: left + TABLE_CELL_WIDTH, maxY: top + TABLE_CELL_HEIGHT };
}
