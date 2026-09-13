/**
 * table.ts
 *
 * This file holds cell address math, range expansion, and the row and column
 * resize passes.
 *
 * A range expands to concrete cells at edge derivation time, from the size
 * the table has now. So an expansion can never go stale.
 *
 * An empty cell inside a range gets no edge. An empty cell that a bare
 * reference names gets no edge either. Both are normal state, not a dangling
 * reference. This is what makes a sparse table work.
 *
 * A row or column delete repairs rather than refuses. It rewrites every
 * inbound reference to #REF and reports what it broke.
 *
 * The file belongs to the engine layer and works on plain data alone. It does
 * not use the DOM, a window or a canvas. That keeps it testable without a
 * browser, and ready for a port to Rust.
 */

import { type Address, formatCellReference, parseCellReference, TABLE_CELL_PATH_PREFIX } from "../address.ts";
import { getSlot, slotKey, TABLE_TYPE, type GraphObject, type Slot } from "../graph/node.ts";

export const MIN_TABLE_LINES = 1;
export const MAX_TABLE_LINES = 1000;

export const DEFAULT_TABLE_ROWS = 8;
export const DEFAULT_TABLE_COLS = 8;

export interface RangeEnumerationError {
  readonly error: "#REF";
  readonly message: string;
}

export function isRangeEnumerationError(
  result: readonly Address[] | RangeEnumerationError,
): result is RangeEnumerationError {
  return !Array.isArray(result);
}

export function cellAddressToCoordinates(address: Address): { readonly column: number; readonly row: number } | undefined {
  if (address.path.length !== 2 || address.path[0] !== TABLE_CELL_PATH_PREFIX) {
    return undefined;
  }
  const cellReference = address.path[1];
  if (cellReference === undefined) {
    return undefined;
  }
  return parseCellReference(cellReference);
}

/**
 * True when the address names a cell inside the current size of a real table.
 * An empty cell inside the extent is normal state, not a dangling reference.
 */
export function isInExtentTableCellAddress(address: Address, objects: readonly GraphObject[]): boolean {
  const coordinates = cellAddressToCoordinates(address);
  if (coordinates === undefined) {
    return false;
  }
  const tableObject = objects.find((candidate) => candidate.id === address.objectId);
  if (tableObject === undefined || tableObject.type !== TABLE_TYPE) {
    return false;
  }
  const { rows, cols } = getTableDimensions(tableObject);
  return coordinates.row <= rows && coordinates.column <= cols;
}

/**
 * Expands a range to the cells inside it, from the size the table has now.
 * It returns a #REF error when the range does not resolve.
 */
export function enumerateRangeCellAddresses(
  start: Address,
  end: Address,
  tableObject: GraphObject,
): readonly Address[] | RangeEnumerationError {
  if (start.objectId !== end.objectId) {
    return {
      error: "#REF",
      message: "a range's two endpoints must be cells in the same table",
    };
  }

  const startCoordinates = cellAddressToCoordinates(start);
  const endCoordinates = cellAddressToCoordinates(end);
  if (startCoordinates === undefined || endCoordinates === undefined) {
    return {
      error: "#REF",
      message: "a range endpoint is not a table cell address",
    };
  }

  const rows = readTableDimension(tableObject, TABLE_ROWS_PATH);
  const cols = readTableDimension(tableObject, TABLE_COLS_PATH);

  const minRow = Math.min(startCoordinates.row, endCoordinates.row);
  const maxRow = Math.min(Math.max(startCoordinates.row, endCoordinates.row), rows);
  const minColumn = Math.min(startCoordinates.column, endCoordinates.column);
  const maxColumn = Math.min(Math.max(startCoordinates.column, endCoordinates.column), cols);

  const addresses: Address[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      addresses.push({ objectId: start.objectId, path: [TABLE_CELL_PATH_PREFIX, formatCellReference({ column, row })] });
    }
  }
  return addresses;
}

export const TABLE_ROWS_PATH: readonly string[] = ["rows"];

export const TABLE_COLS_PATH: readonly string[] = ["cols"];

function readTableDimension(object: GraphObject, path: readonly string[]): number {
  const slot = getSlot(object, path);
  if (slot === undefined || slot.kind !== "literal") {
    return 0;
  }
  if (typeof slot.value !== "number" || !Number.isInteger(slot.value) || slot.value < 0) {
    return 0;
  }
  return slot.value;
}

export function enumerateTableCellSlotPaths(object: GraphObject): readonly (readonly string[])[] {
  const rows = readTableDimension(object, TABLE_ROWS_PATH);
  const cols = readTableDimension(object, TABLE_COLS_PATH);

  const paths: (readonly string[])[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= cols; column += 1) {
      paths.push([TABLE_CELL_PATH_PREFIX, formatCellReference({ column, row })]);
    }
  }
  return paths;
}

export interface TableDimensions {
  readonly rows: number;
  readonly cols: number;
}

/** Reads the row and column count out of the dimension slots. */
export function getTableDimensions(object: GraphObject): TableDimensions {
  return {
    rows: readTableDimension(object, TABLE_ROWS_PATH),
    cols: readTableDimension(object, TABLE_COLS_PATH),
  };
}

export function isTableDimensionResizable(object: GraphObject, axis: "row" | "column"): boolean {
  const slot = getSlot(object, axis === "row" ? TABLE_ROWS_PATH : TABLE_COLS_PATH);
  return slot === undefined || slot.kind === "literal";
}

function shiftCoordinates(
  coordinates: { readonly column: number; readonly row: number },
  axis: "row" | "column",
  index: number,
): { readonly column: number; readonly row: number } {
  if (axis === "row" && coordinates.row >= index) {
    return { column: coordinates.column, row: coordinates.row + 1 };
  }
  if (axis === "column" && coordinates.column >= index) {
    return { column: coordinates.column + 1, row: coordinates.row };
  }
  return coordinates;
}

export function shiftCellAddressForInsert(address: Address, tableId: string, axis: "row" | "column", index: number): Address {
  if (address.objectId !== tableId) {
    return address;
  }
  const coordinates = cellAddressToCoordinates(address);
  if (coordinates === undefined) {
    return address;
  }
  const shifted = shiftCoordinates(coordinates, axis, index);
  if (shifted.row === coordinates.row && shifted.column === coordinates.column) {
    return address;
  }
  return { objectId: address.objectId, path: [TABLE_CELL_PATH_PREFIX, formatCellReference(shifted)] };
}

/** Adds one row or column and shifts every cell after it. */
export function insertTableLine(object: GraphObject, axis: "row" | "column", index: number): GraphObject {
  const { rows, cols } = getTableDimensions(object);
  const bound = axis === "row" ? rows : cols;
  const clampedIndex = Math.max(1, Math.min(index, bound + 1));

  const newSlots: Record<string, Slot> = { ...object.slots };
  newSlots[slotKey(TABLE_ROWS_PATH)] = { kind: "literal", value: axis === "row" ? rows + 1 : rows };
  newSlots[slotKey(TABLE_COLS_PATH)] = { kind: "literal", value: axis === "column" ? cols + 1 : cols };

  const shiftedCells: Record<string, Slot> = {};
  for (const path of enumerateTableCellSlotPaths(object)) {
    const slot = getSlot(object, path);
    if (slot === undefined) {
      continue;
    }
    delete newSlots[slotKey(path)];
    const cellReference = path[1];
    const coordinates = cellReference === undefined ? undefined : parseCellReference(cellReference);
    if (coordinates === undefined) {
      continue;
    }
    const shifted = shiftCoordinates(coordinates, axis, clampedIndex);
    shiftedCells[slotKey([TABLE_CELL_PATH_PREFIX, formatCellReference(shifted)])] = slot;
  }
  Object.assign(newSlots, shiftedCells);

  return { ...object, slots: newSlots };
}

function shiftCoordinatesForDelete(
  coordinates: { readonly column: number; readonly row: number },
  axis: "row" | "column",
  index: number,
): { readonly column: number; readonly row: number } | "deleted" {
  const value = axis === "row" ? coordinates.row : coordinates.column;
  if (value === index) {
    return "deleted";
  }
  if (value > index) {
    return axis === "row"
      ? { column: coordinates.column, row: coordinates.row - 1 }
      : { column: coordinates.column - 1, row: coordinates.row };
  }
  return coordinates;
}

export function repairCellAddressForDelete(address: Address, tableId: string, axis: "row" | "column", index: number): Address | "deleted" {
  if (address.objectId !== tableId) {
    return address;
  }
  const coordinates = cellAddressToCoordinates(address);
  if (coordinates === undefined) {
    return address;
  }
  const shifted = shiftCoordinatesForDelete(coordinates, axis, index);
  if (shifted === "deleted") {
    return "deleted";
  }
  if (shifted.row === coordinates.row && shifted.column === coordinates.column) {
    return address;
  }
  return { objectId: address.objectId, path: [TABLE_CELL_PATH_PREFIX, formatCellReference(shifted)] };
}

function clampRangeEndpointValue(thisValue: number, otherValue: number, index: number): number {
  if (thisValue < index) {
    return thisValue;
  }
  if (thisValue > index) {
    return thisValue - 1;
  }
  return otherValue > index ? index : index - 1;
}

export function repairRangeEndpointsForDelete(
  start: Address,
  end: Address,
  tableId: string,
  axis: "row" | "column",
  index: number,
): { readonly start: Address; readonly end: Address } | "deleted" {
  if (start.objectId !== tableId || end.objectId !== tableId) {
    return { start, end };
  }
  const startCoordinates = cellAddressToCoordinates(start);
  const endCoordinates = cellAddressToCoordinates(end);
  if (startCoordinates === undefined || endCoordinates === undefined) {
    return { start, end };
  }

  const startValue = axis === "row" ? startCoordinates.row : startCoordinates.column;
  const endValue = axis === "row" ? endCoordinates.row : endCoordinates.column;

  if (startValue === index && endValue === index) {
    return "deleted";
  }

  const newStartValue = clampRangeEndpointValue(startValue, endValue, index);
  const newEndValue = clampRangeEndpointValue(endValue, startValue, index);

  const newStartCoordinates =
    axis === "row" ? { column: startCoordinates.column, row: newStartValue } : { column: newStartValue, row: startCoordinates.row };
  const newEndCoordinates =
    axis === "row" ? { column: endCoordinates.column, row: newEndValue } : { column: newEndValue, row: endCoordinates.row };

  return {
    start: { objectId: start.objectId, path: [TABLE_CELL_PATH_PREFIX, formatCellReference(newStartCoordinates)] },
    end: { objectId: end.objectId, path: [TABLE_CELL_PATH_PREFIX, formatCellReference(newEndCoordinates)] },
  };
}

/** Removes one row or column. It repairs each broken reference to a #REF node. */
export function deleteTableLine(object: GraphObject, axis: "row" | "column", index: number): GraphObject {
  const { rows, cols } = getTableDimensions(object);

  const newSlots: Record<string, Slot> = { ...object.slots };
  newSlots[slotKey(TABLE_ROWS_PATH)] = { kind: "literal", value: axis === "row" ? Math.max(0, rows - 1) : rows };
  newSlots[slotKey(TABLE_COLS_PATH)] = { kind: "literal", value: axis === "column" ? Math.max(0, cols - 1) : cols };

  const shiftedCells: Record<string, Slot> = {};
  for (const path of enumerateTableCellSlotPaths(object)) {
    const slot = getSlot(object, path);
    if (slot === undefined) {
      continue;
    }
    delete newSlots[slotKey(path)];
    const cellReference = path[1];
    const coordinates = cellReference === undefined ? undefined : parseCellReference(cellReference);
    if (coordinates === undefined) {
      continue;
    }
    const shifted = shiftCoordinatesForDelete(coordinates, axis, index);
    if (shifted === "deleted") {
      continue;
    }
    shiftedCells[slotKey([TABLE_CELL_PATH_PREFIX, formatCellReference(shifted)])] = slot;
  }
  Object.assign(newSlots, shiftedCells);

  return { ...object, slots: newSlots };
}
