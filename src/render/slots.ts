/**
 * slots.ts
 *
 * Small readers pull a number, a string or a boolean out of a slot value. It
 * also holds the fixed sizes of a table cell and a script box.
 *
 * A slot can hold an error or a value of the wrong type. These readers give a
 * safe default instead. They exist so no drawing file writes the same
 * defensive read again.
 *
 * The file belongs to the render layer. It reads engine state and calls
 * mutations, and it crosses that line for nothing else. The engine holds no
 * import of this file, which keeps the drawing code replaceable.
 */
import {
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH,
  getSlot,
  type GraphObject,
  type Point,
  STYLE_FILL_COLOR_PATH,
  STYLE_STROKE_COLOR_PATH,
  STYLE_STROKE_WIDTH_PATH,
  type Value,
} from "../engine/index.ts";

/** What a shape draws with. A fill of undefined means the shape draws its outline only. */
export interface ShapeStyle {
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly fillColor: string | undefined;
}

/**
 * The three style slots of a shape, each with a safe answer. A slot that holds
 * an error, a wrong type or nothing falls back to a default. The canvas judges
 * the colour string itself, so nothing here tries to parse one.
 */
export function readShapeStyle(object: GraphObject): ShapeStyle {
  const width = readNumber(object, STYLE_STROKE_WIDTH_PATH);
  return {
    strokeColor: readText(object, STYLE_STROKE_COLOR_PATH) ?? DEFAULT_STROKE_COLOR,
    strokeWidth: width !== undefined && Number.isFinite(width) && width > 0 ? width : DEFAULT_STROKE_WIDTH,
    fillColor: readText(object, STYLE_FILL_COLOR_PATH),
  };
}

export function readNumber(object: GraphObject, path: readonly string[]): number | undefined {
  const value = getSlot(object, path)?.value;
  return typeof value === "number" ? value : undefined;
}

export function readText(object: GraphObject, path: readonly string[]): string | undefined {
  const value = getSlot(object, path)?.value;
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function readBoolean(object: GraphObject, path: readonly string[]): boolean | undefined {
  const value = getSlot(object, path)?.value;
  return typeof value === "boolean" ? value : undefined;
}

export function asPointArray(value: Value | undefined): readonly Point[] | undefined {
  if (value === undefined || !Array.isArray(value)) {
    return undefined;
  }
  return value as readonly Point[];
}

export const TABLE_CELL_WIDTH = 80;
export const TABLE_CELL_HEIGHT = 24;

export const SCRIPT_BOX_WIDTH = 140;
export const SCRIPT_HEADER_HEIGHT = 24;
export const SCRIPT_PORT_ROW_HEIGHT = 18;

export function scriptBoxHeight(inPortCount: number, outPortCount: number): number {
  return SCRIPT_HEADER_HEIGHT + Math.max(inPortCount, outPortCount, 1) * SCRIPT_PORT_ROW_HEIGHT;
}
