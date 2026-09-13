/**
 * node.ts
 *
 * The data model is Value, ErrorValue, the three slot kinds, and GraphObject.
 *
 * A slot is one addressable value on an object. It is literal, formula or
 * derived. Slots are the nodes of the dependency graph.
 *
 * slotKey joins a path into one string key. There is no sanctioned inverse.
 * Code that needs a path gets it from the schema, because the join has no
 * inverse.
 *
 * The file belongs to the engine layer and works on plain data alone. It does
 * not use the DOM, a window or a canvas. That keeps it testable without a
 * browser, and ready for a port to Rust.
 */

import type { Address, AddressableObject } from "../address.ts";
import type { FormulaAst } from "../formula/ast.ts";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type ErrorCode = "#REF" | "#TYPE" | "#DIV0" | "#PARSE" | "#SCRIPT" | "#MEASURE";

export interface ErrorValue {
  readonly error: ErrorCode;
  readonly message: string;
}

export type Value = number | string | boolean | Point | readonly Point[] | null | ErrorValue;

export function isErrorValue(value: Value): value is ErrorValue {
  return typeof value === "object" && value !== null && "error" in value;
}

export function isIllegalNumber(n: number): boolean {
  return !Number.isFinite(n) || Object.is(n, -0);
}

export function hasIllegalNumber(value: Value): boolean {
  if (typeof value === "number") {
    return isIllegalNumber(value);
  }
  if (Array.isArray(value)) {
    return (value as readonly Point[]).some((point) => isIllegalNumber(point.x) || isIllegalNumber(point.y));
  }
  if (typeof value === "object" && value !== null && !isErrorValue(value)) {
    const point = value as Point;
    return isIllegalNumber(point.x) || isIllegalNumber(point.y);
  }
  return false;
}

export type ObjectType =
  | "circle"
  | "polygon"
  | "polyline"
  | "rect"
  | "text"
  | "table"
  | "script"
  | "image"
  | "value"
  | "add";

export const TABLE_TYPE: ObjectType = "table";

export const TEXT_TYPE: ObjectType = "text";

export const IMAGE_TYPE: ObjectType = "image";

export const POLYLINE_TYPE: ObjectType = "polyline";

export const SCRIPT_TYPE: ObjectType = "script";

export interface LiteralSlot {
  readonly kind: "literal";
  readonly value: Value;
}

export interface FormulaSlot {
  readonly kind: "formula";
  readonly ast: FormulaAst;
  readonly value: Value;
}

export interface DerivedSlot {
  readonly kind: "derived";
  readonly value: Value;
}

export type Slot = LiteralSlot | FormulaSlot | DerivedSlot;

export interface GraphObjectPorts {
  readonly in: readonly string[];
  readonly out: readonly string[];
}

export function isLegalPortName(name: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(name);
}

export interface GraphObject extends AddressableObject {
  readonly slots: Readonly<Record<string, Slot>>;
  readonly ports?: GraphObjectPorts;

  /**
   * The vertex count of a polyline. It exists only on that type. It changes
   * only through addvertex or delvertex, never through set, so it sits beside
   * the slots instead of inside them.
   */
  readonly vertexCount?: number;
}

/**
 * Joins a path into the one string key that GraphObject.slots uses.
 * There is no inverse. Get a path from the schema, never from a key.
 */
export function slotKey(path: readonly string[]): string {
  return path.join(".");
}

export function getSlot(object: GraphObject, path: readonly string[]): Slot | undefined {
  return object.slots[slotKey(path)];
}

/** Finds the slot an address names, or undefined when nothing is there. */
export function resolveSlot(address: Address, objects: readonly GraphObject[]): Slot | undefined {
  const object = objects.find((candidate) => candidate.id === address.objectId);
  if (object === undefined) {
    return undefined;
  }
  return getSlot(object, address.path);
}
