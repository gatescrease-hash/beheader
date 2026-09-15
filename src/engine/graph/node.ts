/**
 * node.ts
 *
 * The data model the whole engine is built from: Value and ErrorValue for what
 * a slot can hold, the three kinds of Slot, and GraphObject.
 *
 * A slot is one addressable value on one object, and it is literal, formula or
 * derived. The slots are the nodes of the dependency graph, so a formula in
 * one slot that reads another creates an edge between those two slots rather
 * than between their objects.
 *
 * slotKey joins a path such as ["vertex", "0", "x"] into the single string
 * that GraphObject.slots is keyed by. There is no inverse function, and
 * writing one would be a mistake: a key cannot be split back into a path
 * reliably, because a segment can contain the separator. Code that needs a
 * path asks the schema for it.
 *
 * GraphObject.ports and GraphObject.vertexCount sit beside the slot map rather
 * than inside it. Both change only through a mutation operation, so neither
 * belongs in the set a formula is allowed to write, and document.ts rebuilds
 * both by hand when it loads a file.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import type { Address, AddressableObject } from "../address.ts";
import type { FormulaAst } from "../formula/ast.ts";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type ErrorCode = "#REF" | "#TYPE" | "#DIV0" | "#PARSE" | "#SCRIPT" | "#MEASURE" | "#MATH";

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
  | "math"
  | "value"
  | "doc"
  | "docref"
  | "add";

export const TABLE_TYPE: ObjectType = "table";

export const TEXT_TYPE: ObjectType = "text";

export const IMAGE_TYPE: ObjectType = "image";

export const POLYLINE_TYPE: ObjectType = "polyline";

export const SCRIPT_TYPE: ObjectType = "script";

export const MATH_TYPE: ObjectType = "math";

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
  /**
   * The unknowns a math object solves for, each of which carries a literal
   * slot under seed that the search for its value starts from. It is absent on
   * every other kind of object with ports, and on a math object saved before a
   * source could solve for anything.
   */
  readonly seed?: readonly string[];
}

export function isLegalPortName(name: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(name);
}

export interface GraphObject extends AddressableObject {
  readonly target?: Address;
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
