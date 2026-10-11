/**
 * box.ts
 *
 * The one rule for the box of an object: the corners of the rectangle that
 * holds it on the canvas, as the top left and the bottom right point.
 *
 * Two readers share this rule. The derived `box` slot gives it to formulas, so
 * a connector reads `rect_1.box` to find where a line starts. The render layer
 * draws a selection, hit-tests a press and fits the view by the same rule,
 * through `objectBox`. A second rule in either place would let a connector aim
 * at a box the operator cannot see.
 *
 * `objectBox` takes a reader rather than the object's slots, because the
 * derived slot has to read every value through the evaluator, which holds
 * values newer than the object it was handed, and the render layer reads the
 * committed object directly. The structure of an object, which is its type,
 * the kinds of its slots and its ports, comes from the object in both cases,
 * because only a mutation changes structure and a mutation re-derives the box.
 *
 * A group has no box here, because its boundary depends on members found by a
 * scan over the document, and section 11 of SPEC.md gives that as the reason a
 * group is drawn rather than addressable. A geometry shape takes its box from
 * its own derived bounds, so the box of a path with arcs in it is exact.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import type { Address } from "../address.ts";
import { slotKey, type GraphObject, type Point, type Value } from "../graph/node.ts";
import { scriptBoxHeight, SCRIPT_BOX_WIDTH } from "../script/script.ts";
import { DOCREF_FALLBACK_HEIGHT, DOCREF_FALLBACK_WIDTH } from "./doc.ts";
import { FRAME_HEIGHT_PATH, FRAME_WIDTH_PATH } from "./frame.ts";
import {
  BOUNDS_MAX_X_PATH,
  BOUNDS_MAX_Y_PATH,
  BOUNDS_MIN_X_PATH,
  BOUNDS_MIN_Y_PATH,
  BOX_PATH,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
} from "./geometry.ts";
import { IMAGE_HEIGHT_PATH, IMAGE_WIDTH_PATH } from "./image.ts";
import { MATH_MEASURED_HEIGHT_PATH, MATH_MEASURED_WIDTH_PATH } from "./math.ts";
import type { DerivedSlotSchema } from "./schema.ts";
import { DEFAULT_SLIDER_WIDTH, SLIDER_HEIGHT, SLIDER_WIDTH_PATH } from "./slider.ts";
import { getTableDimensions, tableColumnWidthPath, tableRowHeightPath, tableSizes, TABLE_COLS_PATH, TABLE_ROWS_PATH } from "./table.ts";
import {
  TEXT_AUTORESIZE_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_MEASURED_HEIGHT_PATH,
  TEXT_MEASURED_WIDTH_PATH,
  TEXT_RESOLVED_CONTENT_PATH,
  TEXT_WIDTH_PATH,
} from "./text.ts";
import { textBoxSize } from "./textbox.ts";

/** A box in world units, from its least to its greatest corner. */
export interface ObjectBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Gives the value at a path of the object being boxed, or undefined where it has no slot. */
export type BoxReader = (path: readonly string[]) => Value | undefined;

const GEOMETRY_BOUNDS_PATHS: readonly (readonly string[])[] = [BOUNDS_MIN_X_PATH, BOUNDS_MIN_Y_PATH, BOUNDS_MAX_X_PATH, BOUNDS_MAX_Y_PATH];

function finiteNumber(value: Value | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: Value | undefined): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

/** A box from a corner and a size, or undefined where a part is missing or the result leaves the finite numbers. */
function sizedBox(x: number | undefined, y: number | undefined, width: number | undefined, height: number | undefined): ObjectBox | undefined {
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  const box = { minX: x, minY: y, maxX: x + width, maxY: y + height };
  return Number.isFinite(box.maxX) && Number.isFinite(box.maxY) ? box : undefined;
}

/**
 * The paths of the object the box reads, limited to the slots the object
 * carries, because an edge from a slot that does not exist fails the integrity
 * check. A table reads the width of each column and the height of each row
 * that has one of its own, and a mutation that gives a column its first width
 * re-derives these edges with the object.
 */
export function boxDependencyPaths(object: GraphObject): readonly (readonly string[])[] {
  const slots = object.slots;
  const paths = ((): readonly (readonly string[])[] => {
    switch (object.type) {
      case "circle":
      case "polygon":
      case "rect":
      case "polyline":
        return GEOMETRY_BOUNDS_PATHS;
      case "text":
        return [ORIGIN_X_PATH, ORIGIN_Y_PATH, TEXT_RESOLVED_CONTENT_PATH, TEXT_WIDTH_PATH, TEXT_HEIGHT_PATH, TEXT_AUTORESIZE_PATH, TEXT_MEASURED_WIDTH_PATH, TEXT_MEASURED_HEIGHT_PATH];
      case "table":
        return [
          ORIGIN_X_PATH,
          ORIGIN_Y_PATH,
          TABLE_ROWS_PATH,
          TABLE_COLS_PATH,
          ...Object.keys(slots).filter((key) => /^(columns\.[1-9]\d*\.width|rowsizes\.[1-9]\d*\.height)$/.test(key)).map((key) => key.split(".")),
        ];
      case "image":
        return [ORIGIN_X_PATH, ORIGIN_Y_PATH, IMAGE_WIDTH_PATH, IMAGE_HEIGHT_PATH];
      case "script":
        return [ORIGIN_X_PATH, ORIGIN_Y_PATH];
      case "math":
        return [ORIGIN_X_PATH, ORIGIN_Y_PATH, MATH_MEASURED_WIDTH_PATH, MATH_MEASURED_HEIGHT_PATH];
      case "docref":
        return [ORIGIN_X_PATH, ORIGIN_Y_PATH, ["measuredWidth"], ["measuredHeight"]];
      case "slider":
        return [ORIGIN_X_PATH, ORIGIN_Y_PATH, SLIDER_WIDTH_PATH];
      case "frame":
        return [ORIGIN_X_PATH, ORIGIN_Y_PATH, FRAME_WIDTH_PATH, FRAME_HEIGHT_PATH];
      default:
        return [];
    }
  })();
  return paths.filter((path) => slots[slotKey(path)] !== undefined);
}

/**
 * The box of an object, or undefined for an object with no box to give: a
 * type with no place on the canvas, a group, a text with nothing in it, or an
 * object whose place or size holds something other than a number.
 *
 * A table, a text and a script take a missing origin as zero, the way they
 * have always drawn, and every other type needs a number in its origin.
 */
export function objectBox(object: GraphObject, read: BoxReader): ObjectBox | undefined {
  const x = finiteNumber(read(ORIGIN_X_PATH));
  const y = finiteNumber(read(ORIGIN_Y_PATH));
  switch (object.type) {
    case "circle":
    case "polygon":
    case "rect":
    case "polyline": {
      const [minX, minY, maxX, maxY] = GEOMETRY_BOUNDS_PATHS.map((path) => finiteNumber(read(path)));
      if (minX === undefined || minY === undefined || maxX === undefined || maxY === undefined || maxX < minX || maxY < minY) {
        return undefined;
      }
      return { minX, minY, maxX, maxY };
    }
    case "text": {
      const resolved = read(TEXT_RESOLVED_CONTENT_PATH);
      if (typeof resolved !== "string" || resolved === "") {
        return undefined;
      }
      const autoresize = read(TEXT_AUTORESIZE_PATH);
      const size = textBoxSize({
        fixedWidth: finiteNumber(read(TEXT_WIDTH_PATH)),
        fixedHeight: finiteNumber(read(TEXT_HEIGHT_PATH)),
        autoresize: typeof autoresize === "boolean" ? autoresize : true,
        measuredWidth: finiteNumber(read(TEXT_MEASURED_WIDTH_PATH)),
        measuredHeight: finiteNumber(read(TEXT_MEASURED_HEIGHT_PATH)),
      });
      return sizedBox(x ?? 0, y ?? 0, size.width, size.height);
    }
    case "table": {
      const { rows, cols } = getTableDimensions(object);
      const { widths, heights } = tableSizes(rows, cols, read);
      const width = widths.reduce((sum, size) => sum + size, 0);
      const height = heights.reduce((sum, size) => sum + size, 0);
      return width > 0 && height > 0 ? sizedBox(x ?? 0, y ?? 0, width, height) : undefined;
    }
    case "image":
      return sizedBox(x, y, positiveNumber(read(IMAGE_WIDTH_PATH)), positiveNumber(read(IMAGE_HEIGHT_PATH)));
    case "script":
      return sizedBox(x ?? 0, y ?? 0, SCRIPT_BOX_WIDTH, scriptBoxHeight(object.ports?.in.length ?? 0, object.ports?.out.length ?? 0));
    case "math":
      return sizedBox(x, y, finiteNumber(read(MATH_MEASURED_WIDTH_PATH)), finiteNumber(read(MATH_MEASURED_HEIGHT_PATH)));
    // A copy evaluated with no real measurer holds #MEASURE in both measured
    // slots, and the fallback keeps it a box an operator can press.
    case "docref":
      return sizedBox(x ?? 0, y ?? 0, finiteNumber(read(["measuredWidth"])) ?? DOCREF_FALLBACK_WIDTH, finiteNumber(read(["measuredHeight"])) ?? DOCREF_FALLBACK_HEIGHT);
    case "slider":
      return sizedBox(x, y, positiveNumber(read(SLIDER_WIDTH_PATH)) ?? DEFAULT_SLIDER_WIDTH, SLIDER_HEIGHT);
    case "frame":
      return sizedBox(x, y, positiveNumber(read(FRAME_WIDTH_PATH)), positiveNumber(read(FRAME_HEIGHT_PATH)));
    default:
      return undefined;
  }
}

/** Zero for a negative zero, which is not legal document state. */
function plainZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** The value the `box` slot holds for a box: two points, or null for no box. */
export function boxValue(box: ObjectBox | undefined): Value {
  if (box === undefined) {
    return null;
  }
  const corners: Point[] = [
    { x: plainZero(box.minX), y: plainZero(box.minY) },
    { x: plainZero(box.maxX), y: plainZero(box.maxY) },
  ];
  return corners;
}

/** The derived `box` slot, which every type with a place on the canvas declares, except a group. */
export const BOX_DERIVED_SLOT: DerivedSlotSchema = {
  path: BOX_PATH,
  dependencies: {
    kind: "dynamic",
    resolve: (object): readonly Address[] => boxDependencyPaths(object).map((path) => ({ objectId: object.id, path })),
  },
  compute: (object, read) => boxValue(objectBox(object, (path) => read({ objectId: object.id, path }))),
};
