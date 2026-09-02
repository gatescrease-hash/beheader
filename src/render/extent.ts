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
 *     `vertices`, a non-finite vertex, a table with zero rows or columns, or a
 *     `text` object with no resolved content) returns `undefined` rather than a
 *     degenerate box (D-066).
 *   - Reads only, writes nothing (Rule 2).
 *   - Built from the SAME reads `hittest.ts` and `renderer.ts`'s drawing use —
 *     via `slots.ts` and (for `text`) the shared `TEXT_*_PATH` constants —
 *     never a second, independently computed box (D-010). `hittest.ts`'s
 *     `text` bounding-box test calls THIS function.
 *
 * NOT DONE HERE
 *   - MEASURING a `text` object. This file has no `ctx` and never will; the
 *     measurement arrives as graph state, through the `measuredWidth` /
 *     `measuredHeight` derived slots the topological pass already computed
 *     (**D-123**).
 *   - DECIDING how a set size, a measurement and `autoresize` combine into a
 *     box — `textbox.ts`'s `textBoxSize`, which `renderer.ts` and the in-place
 *     editor read too. This file supplies that rule's four inputs and anchors
 *     its answer at `origin`; it does not hold a second copy of it.
 */
import { getSlot, type GraphObject } from "../engine/graph/node.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH, VERTICES_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import {
  TEXT_AUTORESIZE_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_MEASURED_HEIGHT_PATH,
  TEXT_MEASURED_WIDTH_PATH,
  TEXT_RESOLVED_CONTENT_PATH,
  TEXT_WIDTH_PATH,
} from "../engine/primitives/text.ts";
import { asPointArray, readBoolean, readNumber, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";
import { textBoxSize } from "./textbox.ts";

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
    case "text":
      return textExtent(object);
    case "polyline":
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
 * A `text` object's drawn box (§5.6, §5.9's "bounding box for text"), positioned
 * from `origin.x`/`origin.y` — the top-left corner, the same meaning `rect` and
 * `table` give `origin` and the same point `renderer.ts`'s `drawText` starts the
 * first line at. `undefined` for a `text` object with no resolved content
 * (`resolvedContent` unset, non-string, or empty) — an empty text box takes no
 * room, matching `render/measure.ts`'s `{ width: 0, height: 0 }` for an empty
 * string. Never throws.
 *
 * The SIZE is `textbox.ts`'s `textBoxSize` — the one rule the renderer's
 * alignment and the in-place editor's live growing box also read, so the drawn
 * box, the click box and the box being typed into can never disagree (D-010).
 * This function's whole job for a `text` object is to read the four slots that
 * rule needs and anchor the result at `origin`.
 *
 * The rule in one line: the box grows to fit its text ALWAYS (a text box never
 * crops — the human, 2026-09-02), and shrinks back below a size the operator
 * set only when `autoresize` says so. `autoresize` defaults to `true` when the
 * slot is missing, which is what lets a document saved before that slot existed
 * keep the hug-the-text behaviour it had.
 */
function textExtent(object: GraphObject): WorldExtent | undefined {
  const resolved = getSlot(object, TEXT_RESOLVED_CONTENT_PATH)?.value;
  if (typeof resolved !== "string" || resolved === "") {
    return undefined;
  }
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { width, height } = textBoxSize({
    fixedWidth: readNumber(object, TEXT_WIDTH_PATH),
    fixedHeight: readNumber(object, TEXT_HEIGHT_PATH),
    autoresize: readBoolean(object, TEXT_AUTORESIZE_PATH) ?? true,
    measuredWidth: readNumber(object, TEXT_MEASURED_WIDTH_PATH),
    measuredHeight: readNumber(object, TEXT_MEASURED_HEIGHT_PATH),
  });
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
