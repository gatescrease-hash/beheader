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
 * INVARIANTS UPHELD HERE
 *   - Never throws; reads only, writes nothing (Rule 2).
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
 */
import type { CameraState } from "../engine/document.ts";
import { formatCellReference, parseCellReference } from "../engine/address.ts";
import { TABLE_TYPE, TEXT_TYPE, type GraphObject } from "../engine/graph/node.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import { screenToWorld, worldToScreen, type ScreenPoint } from "./camera.ts";
import { objectExtent, type WorldExtent } from "./extent.ts";
import { hitTest } from "./hittest.ts";
import { readNumber, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";

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
 * The box the editor draws for a `text` object whose `content` is empty, so it
 * has no `extent.ts` extent (D-066) — reached when D-124 hands a just-created
 * empty box straight to the editor. World units, round and untuned (Rule 5),
 * the same size `extent.ts`'s own no-measurer fallback uses; it is the EDITOR's
 * affordance and never enters graph state (D-125 clause 6).
 */
const EMPTY_TEXT_EDITOR_WIDTH = 240;
const EMPTY_TEXT_EDITOR_HEIGHT = 20;

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
  const ratio = Number.isFinite(ratioBackingPerCss) && ratioBackingPerCss > 0 ? ratioBackingPerCss : 1;
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
