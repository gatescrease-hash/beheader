/**
 * extent.ts — One object's drawn extent, and the document's.
 *
 * IMPLEMENTS: D-066 (drawn extent, clickable extent and labelled extent are
 * ONE extent) and §5.10's `fit`, which reads `documentExtent` (via
 * `main.ts`).
 * LAYER: render (pure). No canvas, DOM, or window. May import: engine/*
 * (read-only), `./slots.ts`. NEVER imports `renderer.ts` or `hittest.ts`.
 * NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `objectExtent(object)` — one object's drawn box in world space, or
 *   `undefined` for an object that draws nothing. `documentExtent(objects)`
 *   folds that over every object, for `fit`.
 *
 *   This file is the other half of D-093's split (see `slots.ts`'s header
 *   for the full story). `hittest.ts` used to define these two functions AND
 *   import `readNumber`/`asPointArray`/`TABLE_CELL_*` back out of
 *   `renderer.ts`, which defined THOSE and imported `objectExtent` out of
 *   `hittest.ts` in turn — a module cycle that resolved only because every
 *   cross-file reference sat inside a function body (0094's ESCALATION).
 *   `renderer.ts` and `hittest.ts` now both import this file; neither
 *   imports the other, and this file imports neither.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. An object with no extent (missing/wrong-typed/empty
 *     `vertices`, a non-finite vertex, or a table with zero rows or columns)
 *     returns `undefined` rather than a degenerate box (D-066).
 *   - Reads only, writes nothing (Rule 2).
 *   - Built from the SAME reads `hittest.ts`'s tests and `renderer.ts`'s
 *     drawing use — via `slots.ts` — never a second, independently computed
 *     box (D-010).
 *
 * NOT DONE HERE
 *   - Hit-testing (`hittest.ts`) and drawing (`renderer.ts`) themselves.
 */
import { getSlot, type GraphObject } from "../engine/graph/node.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH, VERTICES_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import { asPointArray, readNumber, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";

/**
 * The world-space box an object occupies — `minX <= maxX`, `minY <= maxY`
 * always, because every producer below builds it from real coordinates.
 */
export interface WorldExtent {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * One object's drawn extent, or `undefined` for an object that draws nothing.
 *
 * Two consumers read this, both by D-066 ("one extent"): `hittest.ts`'s
 * click test needs the same box `renderer.ts` draws, and `renderer.ts` hangs
 * an object's screen-space chrome (name label, error badge, formula-driven
 * indicator) from this box's top-centre. Neither computes a second reading
 * of the same question.
 */
export function objectExtent(object: GraphObject): WorldExtent | undefined {
  switch (object.type) {
    case "circle":
    case "polygon":
    case "rect":
      return verticesExtent(object);
    case "table":
      return tableExtent(object);
    case "polyline":
    case "text":
    case "script":
    case "image":
    case "value":
    case "add":
      return undefined; // Draws nothing yet (`renderer.ts`'s header) — nothing to bound.
    default: {
      const exhaustive: never = object.type;
      void exhaustive;
      return undefined;
    }
  }
}

/** The bounding box of a shape's `vertices`. `undefined` for a missing/wrong-typed/empty `vertices` slot, and for one holding a non-finite coordinate — the same "never throws, this one object simply does not participate" posture `hittest.ts`'s own tests take. */
function verticesExtent(object: GraphObject): WorldExtent | undefined {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  if (vertices === undefined || vertices.length === 0) {
    return undefined;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return undefined;
  }
  return { minX, minY, maxX, maxY };
}

/** A table's drawn box, read exactly as `hittest.ts`'s `hitTestTable` reads it — including D-066's guard, so a table that draws nothing has no extent. */
function tableExtent(object: GraphObject): WorldExtent | undefined {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);
  const width = cols * TABLE_CELL_WIDTH;
  const height = rows * TABLE_CELL_HEIGHT;
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { minX: originX, minY: originY, maxX: originX + width, maxY: originY + height };
}

/**
 * The box containing every object that draws something, or `undefined` when
 * none does — §5.10's `fit`, which `main.ts` performs (D-075 clause 3).
 *
 * Returning `undefined` for "nothing to fit to" rather than a zero box keeps the
 * decision with the caller: `commands.ts` already refuses `fit` over an EMPTY
 * document (D-082 clause 1), and this is the OTHER emptiness — a document whose
 * objects all draw nothing — which no document read could have refused, and
 * which D-066 says is the same case.
 */
export function documentExtent(objects: readonly GraphObject[]): WorldExtent | undefined {
  let extent: WorldExtent | undefined;
  for (const object of objects) {
    const objectBox = objectExtent(object);
    if (objectBox === undefined) {
      continue;
    }
    extent =
      extent === undefined
        ? objectBox
        : {
            minX: Math.min(extent.minX, objectBox.minX),
            minY: Math.min(extent.minY, objectBox.minY),
            maxX: Math.max(extent.maxX, objectBox.maxX),
            maxY: Math.max(extent.maxY, objectBox.maxY),
          };
  }
  return extent;
}
