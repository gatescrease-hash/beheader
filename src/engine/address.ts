/**
 * address.ts
 *
 * This file defines the address scheme that the engine uses to name a slot on
 * an object. An address pairs an object ID with a path. parseAddress and
 * formatAddress convert between that pair and its text form. They are the
 * only code that knows that form, so the syntax can change in one place.
 *
 * The scheme has two layers: a stable ID that identifies the object, and a
 * name that the operator controls. A formula resolves the name to an ID when
 * it parses, and the stored AST keeps that ID. So a rename leaves every
 * formula that reads the object untouched.
 *
 * This file also holds the A1 cell helpers, because a cell reference is
 * another form of address. A second copy of that logic drifts away from this
 * one.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 *
 * Most of the engine imports this file, so a change to the address format
 * affects a large part of the codebase.
 */

import { RESERVED_WORDS } from "./formula/lexer.ts";
import { type ObjectType, TABLE_TYPE } from "./graph/node.ts";

export interface AddressableObject {
  readonly id: string;
  readonly name: string;
  readonly type: ObjectType;
}

export interface Address {
  readonly objectId: string;
  readonly path: readonly string[];
}

export interface AddressError {
  readonly error: "#REF";
  readonly message: string;
}

export type NameCheckResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export function isAddressError(value: unknown): value is AddressError {
  return typeof value === "object" && value !== null && "error" in value;
}

const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const PATH_SEGMENT_PATTERN = /^[a-zA-Z0-9_]+$/;

/** Tests a name against the pattern. It does not check for a name in use. */
export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

export function findObjectByName(
  name: string,
  objects: readonly AddressableObject[],
): AddressableObject | undefined {
  const target = name.toLowerCase();
  return objects.find((object) => object.name.toLowerCase() === target);
}

export function findObjectById(
  id: string,
  objects: readonly AddressableObject[],
): AddressableObject | undefined {
  return objects.find((object) => object.id === id);
}

export function isNameTaken(
  name: string,
  objects: readonly AddressableObject[],
  excludeId?: string,
): boolean {
  const target = name.toLowerCase();
  return objects.some((object) => object.id !== excludeId && object.name.toLowerCase() === target);
}

/** Tests a name for both faults: a bad pattern, and a name already in use. */
export function checkNameAvailable(
  name: string,
  objects: readonly AddressableObject[],
  excludeId?: string,
): NameCheckResult {
  if (!isValidName(name)) {
    return {
      ok: false,
      message: `"${name}" is not a valid name — names must match [a-zA-Z_][a-zA-Z0-9_]*`,
    };
  }
  if (RESERVED_WORDS.has(name.toUpperCase())) {
    return {
      ok: false,
      message: `"${name}" is a reserved word — the formula language reads ${[...RESERVED_WORDS].join(", ")} as formula keywords in any case, so no formula could reference this object; choose another name`,
    };
  }
  if (isNameTaken(name, objects, excludeId)) {
    return { ok: false, message: `the name "${name}" is already in use` };
  }
  return { ok: true };
}

/** Makes the next free default name for a type, such as polygon_1. */
export function generateDefaultName(typePrefix: string, objects: readonly AddressableObject[]): string {
  let n = 1;
  while (true) {
    const candidate = `${typePrefix}_${n}`;
    if (!isNameTaken(candidate, objects)) {
      return candidate;
    }
    n += 1;
  }
}

export const TABLE_CELL_PATH_PREFIX = "cells";

const CELL_REFERENCE_PATTERN = /^([A-Za-z]+)([1-9][0-9]*)$/;

function normalizeCellReference(cellReference: string): string {
  return cellReference.toUpperCase();
}

/**
 * True for a bare cell reference such as A1. Only a formula inside a table
 * can use this form, because the table supplies the object that the reference
 * belongs to.
 */
export function isCellReferenceForm(segment: string): boolean {
  return CELL_REFERENCE_PATTERN.test(segment);
}

export function bareCellAddress(tableObjectId: string, cellReference: string): Address {
  return { objectId: tableObjectId, path: [TABLE_CELL_PATH_PREFIX, normalizeCellReference(cellReference)] };
}

/**
 * Column letters run in base 26 with no zero digit, so A is 1, Z is 26 and AA
 * is 27. The minus one in each direction carries that offset.
 */
export function columnLettersToIndex(columnLetters: string): number {
  let index = 0;
  for (const char of columnLetters) {
    index = index * 26 + (char.toUpperCase().charCodeAt(0) - 64);
  }
  return index;
}

export function indexToColumnLetters(index: number): string {
  let remaining = index;
  let letters = "";
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

export interface CellCoordinates {
  readonly column: number;
  readonly row: number;
}

export function parseCellReference(cellReference: string): CellCoordinates | undefined {
  const match = CELL_REFERENCE_PATTERN.exec(cellReference);
  const columnLetters = match?.[1];
  const rowDigits = match?.[2];
  if (columnLetters === undefined || rowDigits === undefined) {
    return undefined;
  }
  return { column: columnLettersToIndex(columnLetters), row: Number(rowDigits) };
}

export function formatCellReference(coordinates: CellCoordinates): string {
  return `${indexToColumnLetters(coordinates.column)}${coordinates.row}`;
}

/**
 * A table cell has two spellings. An operator writes A1, and the graph stores
 * cells.A1. These two functions convert between the pair, so the engine reads
 * one form and the operator reads the other.
 */
function toStoredPath(type: ObjectType, surfacePath: readonly string[]): readonly string[] {
  if (type !== TABLE_TYPE) {
    return surfacePath;
  }
  const onlySegment = surfacePath.length === 1 ? surfacePath[0] : undefined;
  if (onlySegment !== undefined && CELL_REFERENCE_PATTERN.test(onlySegment)) {
    return [TABLE_CELL_PATH_PREFIX, normalizeCellReference(onlySegment)];
  }
  const [prefix, cellReference] = surfacePath;
  if (surfacePath.length === 2 && prefix === TABLE_CELL_PATH_PREFIX && cellReference !== undefined && CELL_REFERENCE_PATTERN.test(cellReference)) {
    return [TABLE_CELL_PATH_PREFIX, normalizeCellReference(cellReference)];
  }
  return surfacePath;
}

function toSurfacePath(type: ObjectType, storedPath: readonly string[]): readonly string[] {
  if (type !== TABLE_TYPE || storedPath.length !== 2 || storedPath[0] !== TABLE_CELL_PATH_PREFIX) {
    return storedPath;
  }
  const cellRef = storedPath[1];
  if (cellRef === undefined || !CELL_REFERENCE_PATTERN.test(cellRef)) {
    return storedPath;
  }
  return [cellRef];
}

/**
 * Turns text into an address. It resolves the object name to an ID, so it
 * needs the current object list.
 */
export function parseAddress(input: string, objects: readonly AddressableObject[]): Address | AddressError {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { error: "#REF", message: "empty address" };
  }

  const segments = trimmed.split(".");
  if (segments.some((segment) => segment.length === 0)) {
    return { error: "#REF", message: `malformed address "${input}" — empty segment` };
  }
  if (segments.length < 2) {
    return {
      error: "#REF",
      message: `malformed address "${input}" — expected "name.path", e.g. "table_x.A1"`,
    };
  }

  const [namePart, ...pathParts] = segments as [string, ...string[]];
  const badSegment = pathParts.find((segment) => !PATH_SEGMENT_PATTERN.test(segment));
  if (badSegment !== undefined) {
    return {
      error: "#REF",
      message: `malformed address "${input}" — invalid path segment "${badSegment}"`,
    };
  }

  const object = findObjectByName(namePart, objects);
  if (object === undefined) {
    return { error: "#REF", message: `no object named "${namePart}"` };
  }

  return { objectId: object.id, path: toStoredPath(object.type, pathParts) };
}

/** Turns an address back into text, under the name the object carries now. */
export function formatAddress(address: Address, objects: readonly AddressableObject[]): string | AddressError {
  const object = findObjectById(address.objectId, objects);
  if (object === undefined) {
    return { error: "#REF", message: `no object with id "${address.objectId}"` };
  }
  return [object.name, ...toSurfacePath(object.type, address.path)].join(".");
}
