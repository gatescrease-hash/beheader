/**
 * clipboard.ts
 *
 * The clipboard of section 22, as plain data and the batches that paste it.
 * The host keeps the payload and talks to the clipboard of the system. This
 * file decides what a copy holds and what a paste writes.
 *
 * A copy of objects holds a snapshot of each one, and of everything inside a
 * copied group. A paste gives each copy a new ID and the next free name for
 * its type. A reference from one copied object to another points at the new
 * copy, in a formula, in the formulas inside text and in the addresses inside
 * notation, so a copied wired pair keeps its wiring between the two copies. A
 * reference to an object outside the copied set still points at the original,
 * so a copied half keeps reading the other half. A copy inside a group whose
 * group was not copied stays in that group while the group exists.
 *
 * A copy of cells holds each cell as a literal or a formula, and its tab
 * separated values for a spreadsheet in another window. A paste of those cells
 * moves each reference to a cell of the copied table by the distance between
 * the copied corner and the pasted corner, as a spreadsheet does, and leaves
 * every other reference alone. A reference moved off the top or the left edge
 * becomes #REF. Text pasted into a cell reads as rows of tab or comma separated
 * values and writes literals, and `import csv` reads a file through the same path.
 *
 * Either paste grows the table to hold what it writes, within the limit of
 * section 7 on rows and columns. A paste past that limit refuses and names the
 * size it needed. A paste is an ordinary batch of writes, so a paste over a
 * formula replaces the formula, and one undo takes the paste back.
 *
 * Command-layer code: it reads the engine through its public surface, and
 * touches no DOM.
 */
import {
  cellAddressToCoordinates,
  formatCellReference,
  generateDefaultName,
  getTableDimensions,
  isErrorValue,
  isTableDimensionResizable,
  MAX_TABLE_LINES,
  mintObjectId,
  rewriteAddressesInAst,
  rewriteMathReferences,
  rewriteTextReferences,
  slotKey,
  TABLE_CELL_PATH_PREFIX,
  TABLE_COLS_PATH,
  TABLE_ROWS_PATH,
  type Address,
  type Document,
  type FormulaAst,
  type GraphObject,
  type Operation,
  type Slot,
  type Value,
} from "../engine/index.ts";

export interface ObjectsPayload {
  readonly kind: "objects";
  readonly objects: readonly GraphObject[];
}

/** One copied cell, or null for an empty one. */
export type CopiedCell = { readonly kind: "literal"; readonly value: Value } | { readonly kind: "formula"; readonly ast: FormulaAst } | null;

export interface CellsPayload {
  readonly kind: "cells";
  readonly tableId: string;
  /** The top left copied cell, counted from 1. */
  readonly top: number;
  readonly left: number;
  readonly rows: readonly (readonly CopiedCell[])[];
}

export type ClipboardPayload = ObjectsPayload | CellsPayload;

/** The objects a copy holds: the ones named and everything inside a named group, with the variable holder and the layers left out. */
export function copyObjects(objects: readonly GraphObject[], ids: readonly string[]): ObjectsPayload {
  const chosen = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const object of objects) {
      const group = object.slots["view.group"];
      if (!chosen.has(object.id) && group?.kind === "literal" && typeof group.value === "string" && chosen.has(group.value)) {
        chosen.add(object.id);
        grew = true;
      }
    }
  }
  const copied = objects.filter((object) => chosen.has(object.id) && object.type !== "doc" && object.type !== "layer");
  return { kind: "objects", objects: JSON.parse(JSON.stringify(copied)) as GraphObject[] };
}

export interface ObjectsPastePlan {
  readonly operations: readonly Operation[];
  readonly nextObjectId: number;
  readonly createdIds: readonly string[];
  readonly names: readonly string[];
}

/** The batch that creates the copies, each moved by the offset from its original. */
export function pasteObjects(document: Document, payload: ObjectsPayload, offset: { readonly x: number; readonly y: number }): ObjectsPastePlan | { readonly ok: false; readonly message: string } {
  const newIds = new Map<string, string>();
  let counter: Document = document;
  for (const object of payload.objects) {
    const minted = mintObjectId(counter);
    if ("ok" in minted) return minted;
    newIds.set(object.id, minted.id);
    counter = { ...counter, nextObjectId: minted.nextObjectId };
  }
  const remap = (address: Address): Address => {
    const id = newIds.get(address.objectId);
    return id === undefined ? address : { ...address, objectId: id };
  };
  const existing = new Set(document.objects.map((object) => object.id));
  const named: GraphObject[] = [...document.objects];
  const created: GraphObject[] = [];
  for (const original of payload.objects) {
    const name = generateDefaultName(original.type, named);
    const placeholder = { ...original, id: newIds.get(original.id)!, name };
    named.push(placeholder);
    created.push(placeholder);
  }
  const after = [...document.objects, ...created];
  const copies = created.map((copy, index) => {
    const original = payload.objects[index]!;
    const slots: Record<string, Slot> = {};
    for (const [key, slot] of Object.entries(original.slots)) {
      const moved = movedSlot(original, key, slot, offset);
      if (moved.kind === "formula") {
        slots[key] = { kind: "formula", ast: rewriteAddressesInAst(moved.ast, remap), value: null };
      } else if (moved.kind === "derived") {
        slots[key] = { kind: "derived", value: null };
      } else if (key === "view.group" && typeof moved.value === "string") {
        const group = newIds.get(moved.value) ?? (existing.has(moved.value) ? moved.value : undefined);
        if (group !== undefined) slots[key] = { kind: "literal", value: group };
      } else if (original.type === "text" && key === "content" && typeof moved.value === "string") {
        slots[key] = { kind: "literal", value: rewriteTextReferences(moved.value, [...document.objects, ...payload.objects.filter((object) => !existing.has(object.id))], after, remap) };
      } else if (original.type === "math" && key === "source" && typeof moved.value === "string") {
        slots[key] = { kind: "literal", value: rewriteMathReferences(moved.value, remap) };
      } else {
        slots[key] = moved;
      }
    }
    return { ...copy, slots } as GraphObject;
  });
  return {
    operations: copies.map((object) => ({ kind: "createObject", object })),
    nextObjectId: counter.nextObjectId,
    createdIds: copies.map((object) => object.id),
    names: copies.map((object) => object.name),
  };
}

/** A position slot moved by the offset when it holds a literal number: the origin, or a vertex of a path with no origin. */
function movedSlot(object: GraphObject, key: string, slot: Slot, offset: { readonly x: number; readonly y: number }): Slot {
  if (slot.kind !== "literal" || typeof slot.value !== "number") return slot;
  const hasOrigin = object.slots["origin.x"] !== undefined || object.slots["origin.y"] !== undefined;
  const axis = hasOrigin
    ? key === "origin.x" ? "x" : key === "origin.y" ? "y" : undefined
    : /^vertex\.\d+\.x$/.test(key) ? "x" : /^vertex\.\d+\.y$/.test(key) ? "y" : undefined;
  return axis === undefined ? slot : { kind: "literal", value: slot.value + offset[axis] };
}

/** The cells of a rectangle of one table, and their tab separated values. */
export function copyCells(table: GraphObject, corner: { readonly row: number; readonly column: number }, size: { readonly rows: number; readonly columns: number }): { readonly payload: CellsPayload; readonly text: string } {
  const rows: CopiedCell[][] = [];
  const lines: string[] = [];
  for (let row = 0; row < size.rows; row += 1) {
    const cells: CopiedCell[] = [];
    const values: string[] = [];
    for (let column = 0; column < size.columns; column += 1) {
      const slot = table.slots[slotKey([TABLE_CELL_PATH_PREFIX, formatCellReference({ row: corner.row + row, column: corner.column + column })])];
      cells.push(slot === undefined || slot.kind === "derived" ? null : slot.kind === "formula" ? { kind: "formula", ast: slot.ast } : { kind: "literal", value: slot.value });
      values.push(slot === undefined ? "" : cellText(slot.value));
    }
    rows.push(cells);
    lines.push(values.join("\t"));
  }
  return { payload: { kind: "cells", tableId: table.id, top: corner.row, left: corner.column, rows }, text: lines.join("\n") };
}

function cellText(value: Value): string {
  if (value === null) return "";
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return String(value).replace(/[\t\n\r]/g, " ");
  if (isErrorValue(value)) return value.error;
  return JSON.stringify(value);
}

export type CellsPastePlan = { readonly ok: true; readonly operations: readonly Operation[]; readonly rows: number; readonly columns: number } | { readonly ok: false; readonly message: string };

/** Pastes copied cells at a corner, moving the references into the copied table by the distance the cells moved. */
export function pasteCells(table: GraphObject, corner: { readonly row: number; readonly column: number }, payload: CellsPayload): CellsPastePlan {
  const rowShift = corner.row - payload.top;
  const columnShift = corner.column - payload.left;
  const shift = (address: Address): Address | undefined => {
    if (address.objectId !== payload.tableId) return address;
    const coordinates = cellAddressToCoordinates(address);
    if (coordinates === undefined) return address;
    const moved = { row: coordinates.row + rowShift, column: coordinates.column + columnShift };
    if (moved.row < 1 || moved.column < 1) return undefined;
    return { ...address, path: [TABLE_CELL_PATH_PREFIX, formatCellReference(moved)] };
  };
  const cells = payload.rows.map((row) => row.map((cell): Slot | null => {
    if (cell === null) return null;
    if (cell.kind === "literal") return { kind: "literal", value: cell.value };
    return { kind: "formula", ast: shiftAst(cell.ast, shift), value: null };
  }));
  return writeCells(table, corner, cells);
}

/**
 * Pastes text as rows of literals. Pasted text is tab separated when any tab
 * is present, and comma separated otherwise. A file read by `import csv`
 * names the comma.
 */
export function pasteText(table: GraphObject, corner: { readonly row: number; readonly column: number }, text: string, delimiter: string = text.includes("\t") ? "\t" : ","): CellsPastePlan {
  const rows = parseDelimited(text, delimiter);
  return writeCells(table, corner, rows.map((row) => row.map((field): Slot | null => (field === "" ? null : { kind: "literal", value: literalOf(field) }))));
}

/** A field as a number when it reads as one, and as text otherwise. */
function literalOf(field: string): number | string {
  const trimmed = field.trim();
  return trimmed !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed) ? Number(trimmed) : field;
}

/**
 * Rows of fields from delimited text. A field in double quotes may hold the
 * delimiter, a line break and a doubled quote, as a spreadsheet writes them.
 * A last line with nothing on it ends the text rather than adding a row.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Writes a block of cells at a corner, growing the table first when the block passes its edge. */
function writeCells(table: GraphObject, corner: { readonly row: number; readonly column: number }, cells: readonly (readonly (Slot | null)[])[]): CellsPastePlan {
  const height = cells.length;
  const width = Math.max(0, ...cells.map((row) => row.length));
  if (height === 0 || width === 0) {
    return { ok: false, message: "the paste holds no cells" };
  }
  const neededRows = corner.row + height - 1;
  const neededColumns = corner.column + width - 1;
  if (neededRows > MAX_TABLE_LINES || neededColumns > MAX_TABLE_LINES) {
    return { ok: false, message: `the paste needs ${table.name} to be ${neededRows} rows by ${neededColumns} columns, past the limit of ${MAX_TABLE_LINES} on each` };
  }
  const dimensions = getTableDimensions(table);
  const operations: Operation[] = [];
  if (neededRows > dimensions.rows) {
    if (!isTableDimensionResizable(table, "row")) return { ok: false, message: `the paste needs ${neededRows} rows, and a formula holds ${table.name}.rows at ${dimensions.rows}` };
    operations.push({ kind: "setSlot", address: { objectId: table.id, path: TABLE_ROWS_PATH }, slot: { kind: "literal", value: neededRows } });
  }
  if (neededColumns > dimensions.cols) {
    if (!isTableDimensionResizable(table, "column")) return { ok: false, message: `the paste needs ${neededColumns} columns, and a formula holds ${table.name}.cols at ${dimensions.cols}` };
    operations.push({ kind: "setSlot", address: { objectId: table.id, path: TABLE_COLS_PATH }, slot: { kind: "literal", value: neededColumns } });
  }
  cells.forEach((row, rowIndex) => row.forEach((slot, columnIndex) => {
    const path = [TABLE_CELL_PATH_PREFIX, formatCellReference({ row: corner.row + rowIndex, column: corner.column + columnIndex })];
    if (slot !== null) {
      operations.push({ kind: "setSlot", address: { objectId: table.id, path }, slot });
    } else if (table.slots[slotKey(path)] !== undefined) {
      operations.push({ kind: "clearSlot", address: { objectId: table.id, path } });
    }
  }));
  return { ok: true, operations, rows: height, columns: width };
}

/** Moves every reference and range end the shift names, and turns one moved off the table into #REF. */
function shiftAst(ast: FormulaAst, shift: (address: Address) => Address | undefined): FormulaAst {
  switch (ast.type) {
    case "literal":
    case "error":
      return ast;
    case "reference": {
      const moved = shift(ast.address);
      return moved === undefined ? { type: "error", error: "#REF" } : { ...ast, address: moved };
    }
    case "range": {
      const start = shift(ast.start);
      const end = shift(ast.end);
      return start === undefined || end === undefined ? { type: "error", error: "#REF" } : { ...ast, start, end };
    }
    case "binaryOp":
      return { ...ast, left: shiftAst(ast.left, shift), right: shiftAst(ast.right, shift) };
    case "unaryOp":
      return { ...ast, operand: shiftAst(ast.operand, shift) };
    case "functionCall":
      return { ...ast, args: ast.args.map((arg) => shiftAst(arg, shift)) };
    default: {
      const exhaustive: never = ast;
      return exhaustive;
    }
  }
}
