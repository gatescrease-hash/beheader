/**
 * slots.ts
 *
 * Layer: render. It reads engine state and calls mutations. It does nothing
 * else across that line. The engine must never import this file.
 *
 * Small readers that pull a number, a string or a boolean out of a slot
 * value. It also holds the fixed sizes of a table cell and a script box.
 *
 * A slot can hold an error or a value of the wrong type. These readers give a
 * safe default instead. They exist so no drawing file writes the same
 * defensive read again.
 */
import { getSlot, type GraphObject, type Point, type Value } from "../engine/graph/node.ts";

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
