/**
 * table.test.ts
 *
 * These tests cover cell math, range expansion, and the row and column resize
 * passes. It covers the repair to a #REF node.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import type { GraphObject, Value } from "../graph/node.ts";
import {
  DEFAULT_TABLE_COLS,
  DEFAULT_TABLE_ROWS,
  deleteTableLine,
  enumerateRangeCellAddresses,
  enumerateTableCellSlotPaths,
  getTableDimensions,
  insertTableLine,
  isRangeEnumerationError,
  isTableDimensionResizable,
  repairCellAddressForDelete,
  repairRangeEndpointsForDelete,
  shiftCellAddressForInsert,
  TABLE_COLS_PATH,
  TABLE_ROWS_PATH,
  type RangeEnumerationError,
} from "./table.ts";

function cell(objectId: string, ref: string): Address {
  return { objectId, path: ["cells", ref] };
}

function tableWithDimensions(rows: Value, cols: Value): GraphObject {
  return {
    id: "obj_1",
    name: "table_x",
    type: "table",
    slots: {
      [TABLE_ROWS_PATH.join(".")]: { kind: "literal", value: rows },
      [TABLE_COLS_PATH.join(".")]: { kind: "literal", value: cols },
    },
  };
}

function tableWithFormulaDimensions(rows: number, cols: number): GraphObject {
  return {
    id: "obj_1",
    name: "table_x",
    type: "table",
    slots: {
      [TABLE_ROWS_PATH.join(".")]: { kind: "formula", ast: { type: "literal", value: rows }, value: rows },
      [TABLE_COLS_PATH.join(".")]: { kind: "formula", ast: { type: "literal", value: cols }, value: cols },
    },
  };
}

const TABLE_8X8 = tableWithDimensions(DEFAULT_TABLE_ROWS, DEFAULT_TABLE_COLS);

describe("default dimensions, 8 by 8", () => {
  it("is 8x8", () => {
    expect(DEFAULT_TABLE_ROWS).toBe(8);
    expect(DEFAULT_TABLE_COLS).toBe(8);
  });
});

describe("enumerateRangeCellAddresses — the rectangle between two same-table endpoints, bounded by current extent", () => {
  it("a single-cell range yields exactly that one address", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "A1"), TABLE_8X8);
    expect(result).toEqual([cell("obj_1", "A1")]);
  });

  it("a 2x2 rectangle is enumerated row-major (every column of a row before the next row)", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "B2"), TABLE_8X8);
    expect(result).toEqual([cell("obj_1", "A1"), cell("obj_1", "B1"), cell("obj_1", "A2"), cell("obj_1", "B2")]);
  });

  it("reversed endpoints (bottom-right to top-left) produce the identical rectangle", () => {
    const forward = enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "B2"), TABLE_8X8);
    const reversed = enumerateRangeCellAddresses(cell("obj_1", "B2"), cell("obj_1", "A1"), TABLE_8X8);
    expect(reversed).toEqual(forward);
  });

  it("a single row range", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "C1"), TABLE_8X8);
    expect(result).toEqual([cell("obj_1", "A1"), cell("obj_1", "B1"), cell("obj_1", "C1")]);
  });

  it("a single column range", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "A3"), TABLE_8X8);
    expect(result).toEqual([cell("obj_1", "A1"), cell("obj_1", "A2"), cell("obj_1", "A3")]);
  });

  it("spans a multi-letter column boundary correctly (Z -> AA -> AB), bounded by a table wide enough to hold it", () => {
    const wide = tableWithDimensions(1, 28);
    const result = enumerateRangeCellAddresses(cell("obj_1", "Z1"), cell("obj_1", "AB1"), wide);
    expect(result).toEqual([cell("obj_1", "Z1"), cell("obj_1", "AA1"), cell("obj_1", "AB1")]);
  });

  it("a range extending past the table's current extent is CLAMPED, not #REF — SUM(A1:Z99) over an 8x8 table enumerates only the 8x8 rectangle", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "Z99"), TABLE_8X8);
    expect(isRangeEnumerationError(result)).toBe(false);
    expect((result as readonly Address[])).toHaveLength(8 * 8);
    expect((result as readonly Address[])[(result as readonly Address[]).length - 1]).toEqual(cell("obj_1", "H8"));
  });

  it("a range entirely beyond the table's extent clamps to EMPTY, not an error", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "J1"), cell("obj_1", "J1"), TABLE_8X8);
    expect(isRangeEnumerationError(result)).toBe(false);
    expect(result).toEqual([]);
  });

  it("a range with no bound on the far side (e.g. reversed past the extent) still clamps correctly", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "Z99"), cell("obj_1", "A1"), TABLE_8X8);
    expect(result).toEqual((enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "Z99"), TABLE_8X8)));
  });

  it("a formula-kind rows/cols slot is treated as 0 regardless of its cached value — the same Rule 6 guard enumerateTableCellSlotPaths uses", () => {
    const formulaDriven = tableWithFormulaDimensions(8, 8);
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "B2"), formulaDriven);
    expect(result).toEqual([]);
  });

  it("rejects a range whose two endpoints name DIFFERENT objects, a defensive arm, because the parser already refuses this", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_2", "B4"), TABLE_8X8);
    expect(isRangeEnumerationError(result)).toBe(true);
    expect((result as RangeEnumerationError).error).toBe("#REF");
  });

  it("rejects an endpoint that is not a well-formed cell address (wrong path shape)", () => {
    const notACell: Address = { objectId: "obj_1", path: ["origin", "x"] };
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), notACell, TABLE_8X8);
    expect(isRangeEnumerationError(result)).toBe(true);
  });

  it("rejects an endpoint whose second segment does not parse as a cell reference", () => {
    const malformed: Address = { objectId: "obj_1", path: ["cells", "not-a-cell"] };
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), malformed, TABLE_8X8);
    expect(isRangeEnumerationError(result)).toBe(true);
  });

  it("rejects an endpoint with the wrong path length", () => {
    const tooLong: Address = { objectId: "obj_1", path: ["cells", "A1", "extra"] };
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), tooLong, TABLE_8X8);
    expect(isRangeEnumerationError(result)).toBe(true);
  });

  it("is robust to a lowercase cell reference in a hand-built Address, although a real Address never carries one after normalisation", () => {
    const lowercase: Address = { objectId: "obj_1", path: ["cells", "a1"] };
    const result = enumerateRangeCellAddresses(lowercase, cell("obj_1", "A1"), TABLE_8X8);
    expect(result).toEqual([cell("obj_1", "A1")]);
  });
});

describe("isRangeEnumerationError", () => {
  it("is false for a successful enumeration and true for a RangeEnumerationError", () => {
    expect(isRangeEnumerationError(enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "A1"), TABLE_8X8))).toBe(false);
    expect(isRangeEnumerationError(enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_2", "A1"), TABLE_8X8))).toBe(true);
  });
});

describe("enumerateTableCellSlotPaths — the dynamic slot family", () => {
  it("enumerates every cell path for a 2x3 table, row-major (every column of one row before the next)", () => {
    expect(enumerateTableCellSlotPaths(tableWithDimensions(2, 3))).toEqual([
      ["cells", "A1"],
      ["cells", "B1"],
      ["cells", "C1"],
      ["cells", "A2"],
      ["cells", "B2"],
      ["cells", "C2"],
    ]);
  });

  it("enumerates the default 8x8 extent, 64 paths, starting/ending at the expected corners", () => {
    const paths = enumerateTableCellSlotPaths(tableWithDimensions(DEFAULT_TABLE_ROWS, DEFAULT_TABLE_COLS));
    expect(paths).toHaveLength(64);
    expect(paths[0]).toEqual(["cells", "A1"]);
    expect(paths[paths.length - 1]).toEqual(["cells", "H8"]);
  });

  it("spans a multi-letter column boundary (rows=1, cols=28 reaches AB)", () => {
    const paths = enumerateTableCellSlotPaths(tableWithDimensions(1, 28));
    expect(paths[paths.length - 1]).toEqual(["cells", "AB1"]);
  });

  it("is empty for a table with no dimension slots at all — never throws", () => {
    const bare: GraphObject = { id: "obj_1", name: "table_x", type: "table", slots: {} };
    expect(() => enumerateTableCellSlotPaths(bare)).not.toThrow();
    expect(enumerateTableCellSlotPaths(bare)).toEqual([]);
  });

  it("is empty (not thrown) for a non-numeric, negative, or non-integer dimension", () => {
    expect(enumerateTableCellSlotPaths(tableWithDimensions("eight" as unknown as number, 8))).toEqual([]);
    expect(enumerateTableCellSlotPaths(tableWithDimensions(-1, 8))).toEqual([]);
    expect(enumerateTableCellSlotPaths(tableWithDimensions(2.5, 8))).toEqual([]);
  });

  it("is empty for rows=0 or cols=0 (a legitimate, if degenerate, extent) rather than an error", () => {
    expect(enumerateTableCellSlotPaths(tableWithDimensions(0, 8))).toEqual([]);
    expect(enumerateTableCellSlotPaths(tableWithDimensions(8, 0))).toEqual([]);
  });

  it("never invents a table-domain path shape outside address.ts's TABLE_CELL_PATH_PREFIX ('cells')", () => {
    const paths = enumerateTableCellSlotPaths(tableWithDimensions(1, 1));
    expect(paths).toEqual([["cells", "A1"]]);
  });

  it("a formula-kind dimension slot is treated as 0, the SAME guard enumerateRangeCellAddresses now shares", () => {
    expect(enumerateTableCellSlotPaths(tableWithFormulaDimensions(8, 8))).toEqual([]);
  });
});

function tableWithCells(rows: number, cols: number, cells: Record<string, Value>): GraphObject {
  const slots: Record<string, { kind: "literal"; value: Value }> = {
    [TABLE_ROWS_PATH.join(".")]: { kind: "literal", value: rows },
    [TABLE_COLS_PATH.join(".")]: { kind: "literal", value: cols },
  };
  for (const [ref, value] of Object.entries(cells)) {
    slots[`cells.${ref}`] = { kind: "literal", value };
  }
  return { id: "obj_1", name: "table_x", type: "table", slots };
}

describe("getTableDimensions — the reader that insertTableLine and mutation.ts share", () => {
  it("reads rows/cols off a literal-dimensioned table", () => {
    expect(getTableDimensions(tableWithDimensions(5, 3))).toEqual({ rows: 5, cols: 3 });
  });

  it("is {0, 0} for a table with no dimension slots at all", () => {
    expect(getTableDimensions({ id: "obj_1", name: "table_x", type: "table", slots: {} })).toEqual({ rows: 0, cols: 0 });
  });
});

describe("isTableDimensionResizable — a dimension slot must stay literal", () => {
  it("is true for a literal dimension", () => {
    const table = tableWithDimensions(3, 3);
    expect(isTableDimensionResizable(table, "row")).toBe(true);
    expect(isTableDimensionResizable(table, "column")).toBe(true);
  });

  it("is true for an ABSENT dimension slot (a table a creation command never built — a load, or a raw setSlot)", () => {
    const bare: GraphObject = { id: "obj_1", name: "table_x", type: "table", slots: {} };
    expect(isTableDimensionResizable(bare, "row")).toBe(true);
    expect(isTableDimensionResizable(bare, "column")).toBe(true);
  });

  it("is false for a formula-kind dimension slot — the one case readTableDimension reads as a fail-safe 0", () => {
    const table = tableWithFormulaDimensions(2, 2);
    expect(isTableDimensionResizable(table, "row")).toBe(false);
    expect(isTableDimensionResizable(table, "column")).toBe(false);
  });

  it("checks each axis independently", () => {
    const mixed: GraphObject = {
      id: "obj_1",
      name: "table_x",
      type: "table",
      slots: {
        [TABLE_ROWS_PATH.join(".")]: { kind: "literal", value: 2 },
        [TABLE_COLS_PATH.join(".")]: { kind: "formula", ast: { type: "literal", value: 2 }, value: 2 },
      },
    };
    expect(isTableDimensionResizable(mixed, "row")).toBe(true);
    expect(isTableDimensionResizable(mixed, "column")).toBe(false);
  });
});

describe("shiftCellAddressForInsert — the reference adjustment arithmetic for one address", () => {
  it("shifts a row at or after the insertion index by one", () => {
    expect(shiftCellAddressForInsert(cell("obj_1", "A3"), "obj_1", "row", 3)).toEqual(cell("obj_1", "A4"));
    expect(shiftCellAddressForInsert(cell("obj_1", "A5"), "obj_1", "row", 3)).toEqual(cell("obj_1", "A6"));
  });

  it("leaves a row strictly before the insertion index unchanged", () => {
    expect(shiftCellAddressForInsert(cell("obj_1", "A2"), "obj_1", "row", 3)).toEqual(cell("obj_1", "A2"));
  });

  it("shifts a column the same way, independent of row", () => {
    expect(shiftCellAddressForInsert(cell("obj_1", "C1"), "obj_1", "column", 3)).toEqual(cell("obj_1", "D1"));
    expect(shiftCellAddressForInsert(cell("obj_1", "B1"), "obj_1", "column", 3)).toEqual(cell("obj_1", "B1"));
  });

  it("leaves an address on a DIFFERENT object completely unchanged", () => {
    const other = cell("obj_2", "A5");
    expect(shiftCellAddressForInsert(other, "obj_1", "row", 3)).toBe(other);
  });

  it("leaves a non-cell address on the SAME table unchanged (e.g. a reference to `rows` itself)", () => {
    const rowsAddress: Address = { objectId: "obj_1", path: ["rows"] };
    expect(shiftCellAddressForInsert(rowsAddress, "obj_1", "row", 3)).toBe(rowsAddress);
  });
});

describe("insertTableLine — the row and column insert", () => {
  it("increments rows and shifts every populated cell at or after the index down by one row", () => {
    const table = tableWithCells(3, 1, { A1: 1, A2: 2, A3: 3 });
    const result = insertTableLine(table, "row", 2);

    expect(getTableDimensions(result)).toEqual({ rows: 4, cols: 1 });
    expect(result.slots["cells.A1"]).toEqual({ kind: "literal", value: 1 });
    expect(result.slots["cells.A2"]).toBeUndefined();
    expect(result.slots["cells.A3"]).toEqual({ kind: "literal", value: 2 });
    expect(result.slots["cells.A4"]).toEqual({ kind: "literal", value: 3 });
  });

  it("does the same for a column insertion, independent of rows", () => {
    const table = tableWithCells(1, 3, { A1: "a", B1: "b", C1: "c" });
    const result = insertTableLine(table, "column", 2);

    expect(getTableDimensions(result)).toEqual({ rows: 1, cols: 4 });
    expect(result.slots["cells.A1"]).toEqual({ kind: "literal", value: "a" });
    expect(result.slots["cells.B1"]).toBeUndefined();
    expect(result.slots["cells.C1"]).toEqual({ kind: "literal", value: "b" });
    expect(result.slots["cells.D1"]).toEqual({ kind: "literal", value: "c" });
  });

  it("inserting AFTER every existing row (index = rows+1) appends an empty row and moves nothing", () => {
    const table = tableWithCells(2, 1, { A1: 1, A2: 2 });
    const result = insertTableLine(table, "row", 3);

    expect(getTableDimensions(result)).toEqual({ rows: 3, cols: 1 });
    expect(result.slots["cells.A1"]).toEqual({ kind: "literal", value: 1 });
    expect(result.slots["cells.A2"]).toEqual({ kind: "literal", value: 2 });
    expect(result.slots["cells.A3"]).toBeUndefined();
  });

  it("clamps an out-of-range index rather than producing a nonsensical result (defensive arm — see doc comment)", () => {
    const table = tableWithCells(2, 1, { A1: 1, A2: 2 });
    const tooHigh = insertTableLine(table, "row", 999);
    expect(getTableDimensions(tooHigh)).toEqual({ rows: 3, cols: 1 });

    const tooLow = insertTableLine(table, "row", -5);
    expect(getTableDimensions(tooLow)).toEqual({ rows: 3, cols: 1 });
    expect(tooLow.slots["cells.A1"]).toBeUndefined();
    expect(tooLow.slots["cells.A2"]).toEqual({ kind: "literal", value: 1 });
  });

  it("re-asserts rows as literal even if it was some other kind before — and, per THAT SAME guard, a formula-kind rows/cols already read as 0, so inserting a row on a table read this way starts from 0, not the formula's cached value", () => {
    const result = insertTableLine(tableWithFormulaDimensions(2, 2), "row", 1);
    expect(result.slots[TABLE_ROWS_PATH.join(".")]).toEqual({ kind: "literal", value: 1 });
  });

  it("never throws, including on a table with no dimension slots at all", () => {
    const bare: GraphObject = { id: "obj_1", name: "table_x", type: "table", slots: {} };
    expect(() => insertTableLine(bare, "row", 1)).not.toThrow();
    expect(getTableDimensions(insertTableLine(bare, "row", 1))).toEqual({ rows: 1, cols: 0 });
  });

  describe("a slot this function does not own survives a resize", () => {
    it("a literal slot at an UNRECOGNISED path (not rows/cols/a cell) survives an insert", () => {
      const table = tableWithCells(1, 1, { A1: 1 });
      const withNote: GraphObject = { ...table, slots: { ...table.slots, note: { kind: "literal", value: "hello" } } };
      const result = insertTableLine(withNote, "row", 1);
      expect(result.slots.note).toEqual({ kind: "literal", value: "hello" });
    });

    it("a cell slot OUTSIDE the table's current declared extent survives an insert", () => {
      const table = tableWithCells(2, 1, { A1: 1, A2: 2 });
      const withOutOfExtentCell: GraphObject = { ...table, slots: { ...table.slots, "cells.A5": { kind: "literal", value: 99 } } };
      const result = insertTableLine(withOutOfExtentCell, "row", 1);
      expect(result.slots["cells.A5"]).toEqual({ kind: "literal", value: 99 });
    });

    it("carries an arbitrary extra slot through a resize untouched, such as origin.x and origin.y, and not just the two named in this test file", () => {
      const table = tableWithCells(1, 1, { A1: 1 });
      const withPosition: GraphObject = {
        ...table,
        slots: {
          ...table.slots,
          "origin.x": { kind: "literal", value: 10 },
          "origin.y": { kind: "literal", value: 20 },
        },
      };
      const result = insertTableLine(withPosition, "column", 1);
      expect(result.slots["origin.x"]).toEqual({ kind: "literal", value: 10 });
      expect(result.slots["origin.y"]).toEqual({ kind: "literal", value: 20 });
    });
  });
});

describe("repairCellAddressForDelete — the same arithmetic for a delete", () => {
  it("reports \"deleted\" for a cell whose own row is the one being removed", () => {
    expect(repairCellAddressForDelete(cell("obj_1", "A3"), "obj_1", "row", 3)).toBe("deleted");
  });

  it("shifts a row strictly after the deleted index back by one", () => {
    expect(repairCellAddressForDelete(cell("obj_1", "A5"), "obj_1", "row", 3)).toEqual(cell("obj_1", "A4"));
  });

  it("leaves a row strictly before the deleted index unchanged", () => {
    const address = cell("obj_1", "A2");
    expect(repairCellAddressForDelete(address, "obj_1", "row", 3)).toBe(address);
  });

  it("does the same for a column deletion, independent of row", () => {
    expect(repairCellAddressForDelete(cell("obj_1", "D1"), "obj_1", "column", 2)).toEqual(cell("obj_1", "C1"));
    expect(repairCellAddressForDelete(cell("obj_1", "B1"), "obj_1", "column", 2)).toBe("deleted");
    const before = cell("obj_1", "A1");
    expect(repairCellAddressForDelete(before, "obj_1", "column", 2)).toBe(before);
  });

  it("leaves an address on a DIFFERENT object completely unchanged", () => {
    const other = cell("obj_2", "A5");
    expect(repairCellAddressForDelete(other, "obj_1", "row", 3)).toBe(other);
  });

  it("leaves a non-cell address on the SAME table unchanged (e.g. a reference to `rows` itself)", () => {
    const rowsAddress: Address = { objectId: "obj_1", path: ["rows"] };
    expect(repairCellAddressForDelete(rowsAddress, "obj_1", "row", 3)).toBe(rowsAddress);
  });
});

describe("repairRangeEndpointsForDelete — it clamps to the extent that remains, or gives #REF", () => {
  it("leaves both endpoints unchanged when the deleted row is entirely AFTER the range", () => {
    const result = repairRangeEndpointsForDelete(cell("obj_1", "A1"), cell("obj_1", "A5"), "obj_1", "row", 8);
    expect(result).toEqual({ start: cell("obj_1", "A1"), end: cell("obj_1", "A5") });
  });

  it("shifts BOTH endpoints back by one when the deleted row is entirely BEFORE the range", () => {
    const result = repairRangeEndpointsForDelete(cell("obj_1", "A5"), cell("obj_1", "A8"), "obj_1", "row", 1);
    expect(result).toEqual({ start: cell("obj_1", "A4"), end: cell("obj_1", "A7") });
  });

  it("narrows a range that spans the deleted row (deleted line is strictly INTERIOR): lower bound unchanged, upper bound -1", () => {
    const result = repairRangeEndpointsForDelete(cell("obj_1", "A1"), cell("obj_1", "A5"), "obj_1", "row", 3);
    expect(result).toEqual({ start: cell("obj_1", "A1"), end: cell("obj_1", "A4") });
  });

  it("clamps when the deleted row IS the range's lower bound", () => {
    const result = repairRangeEndpointsForDelete(cell("obj_1", "A1"), cell("obj_1", "A5"), "obj_1", "row", 1);
    expect(result).toEqual({ start: cell("obj_1", "A1"), end: cell("obj_1", "A4") });
  });

  it("clamps when the deleted row IS the range's upper bound", () => {
    const result = repairRangeEndpointsForDelete(cell("obj_1", "A1"), cell("obj_1", "A5"), "obj_1", "row", 5);
    expect(result).toEqual({ start: cell("obj_1", "A1"), end: cell("obj_1", "A4") });
  });

  it("returns \"deleted\" for a single-cell range that names only the deleted line, because a range deleted in full becomes #REF", () => {
    expect(repairRangeEndpointsForDelete(cell("obj_1", "A3"), cell("obj_1", "A3"), "obj_1", "row", 3)).toBe("deleted");
  });

  it("decides which endpoint is the lower/upper bound by VALUE, not by which AST field holds it (a reversed A5:A1 range)", () => {
    const result = repairRangeEndpointsForDelete(cell("obj_1", "A5"), cell("obj_1", "A1"), "obj_1", "row", 5);
    expect(result).toEqual({ start: cell("obj_1", "A4"), end: cell("obj_1", "A1") });
  });

  it("only touches the axis being deleted — the other axis's coordinate survives on each endpoint independently", () => {
    const result = repairRangeEndpointsForDelete(cell("obj_1", "B1"), cell("obj_1", "D5"), "obj_1", "row", 3);
    expect(result).toEqual({ start: cell("obj_1", "B1"), end: cell("obj_1", "D4") });
  });

  it("leaves BOTH endpoints unchanged, as a pair, when the range names a DIFFERENT object", () => {
    const start = cell("obj_2", "A1");
    const end = cell("obj_2", "A5");
    expect(repairRangeEndpointsForDelete(start, end, "obj_1", "row", 3)).toEqual({ start, end });
  });

  it("leaves both endpoints unchanged, defensively, when an endpoint is not a well-formed cell address", () => {
    const start: Address = { objectId: "obj_1", path: ["rows"] };
    const end = cell("obj_1", "A5");
    expect(repairRangeEndpointsForDelete(start, end, "obj_1", "row", 3)).toEqual({ start, end });
  });
});

describe("deleteTableLine — the row and column delete, and the first user of the repair path", () => {
  it("decrements rows, drops the cell AT the deleted index, and shifts every cell after it back by one row", () => {
    const table = tableWithCells(4, 1, { A1: 1, A2: 2, A3: 3, A4: 4 });
    const result = deleteTableLine(table, "row", 2);

    expect(getTableDimensions(result)).toEqual({ rows: 3, cols: 1 });
    expect(result.slots["cells.A1"]).toEqual({ kind: "literal", value: 1 });
    expect(result.slots["cells.A2"]).toEqual({ kind: "literal", value: 3 });
    expect(result.slots["cells.A3"]).toEqual({ kind: "literal", value: 4 });
    expect(result.slots["cells.A4"]).toBeUndefined();
  });

  it("does the same for a column deletion, independent of rows", () => {
    const table = tableWithCells(1, 4, { A1: "a", B1: "b", C1: "c", D1: "d" });
    const result = deleteTableLine(table, "column", 2);

    expect(getTableDimensions(result)).toEqual({ rows: 1, cols: 3 });
    expect(result.slots["cells.A1"]).toEqual({ kind: "literal", value: "a" });
    expect(result.slots["cells.B1"]).toEqual({ kind: "literal", value: "c" });
    expect(result.slots["cells.C1"]).toEqual({ kind: "literal", value: "d" });
    expect(result.slots["cells.D1"]).toBeUndefined();
  });

  it("deleting the LAST remaining row leaves a 0-row table with no cells", () => {
    const table = tableWithCells(1, 1, { A1: 1 });
    const result = deleteTableLine(table, "row", 1);
    expect(getTableDimensions(result)).toEqual({ rows: 0, cols: 1 });
    expect(result.slots["cells.A1"]).toBeUndefined();
  });

  it("re-asserts rows/cols as literal even if it was some other kind before, same posture as insertTableLine", () => {
    const result = deleteTableLine(tableWithFormulaDimensions(2, 2), "row", 1);
    expect(result.slots[TABLE_ROWS_PATH.join(".")]).toEqual({ kind: "literal", value: 0 });
  });

  it("never throws, including on a table with no dimension slots at all", () => {
    const bare: GraphObject = { id: "obj_1", name: "table_x", type: "table", slots: {} };
    expect(() => deleteTableLine(bare, "row", 1)).not.toThrow();
    expect(getTableDimensions(deleteTableLine(bare, "row", 1))).toEqual({ rows: 0, cols: 0 });
  });

  describe("a slot this function does not own survives a deletion", () => {
    it("a literal slot at an UNRECOGNISED path survives a delete", () => {
      const table = tableWithCells(2, 1, { A1: 1, A2: 2 });
      const withNote: GraphObject = { ...table, slots: { ...table.slots, note: { kind: "literal", value: "hello" } } };
      const result = deleteTableLine(withNote, "row", 1);
      expect(result.slots.note).toEqual({ kind: "literal", value: "hello" });
    });

    it("a cell slot OUTSIDE the table's current declared extent survives a delete", () => {
      const table = tableWithCells(2, 1, { A1: 1, A2: 2 });
      const withOutOfExtentCell: GraphObject = { ...table, slots: { ...table.slots, "cells.A5": { kind: "literal", value: 99 } } };
      const result = deleteTableLine(withOutOfExtentCell, "row", 1);
      expect(result.slots["cells.A5"]).toEqual({ kind: "literal", value: 99 });
    });

    it("keeps an arbitrary extra slot, such as origin.x and origin.y, through a delete", () => {
      const table = tableWithCells(2, 1, { A1: 1, A2: 2 });
      const withPosition: GraphObject = {
        ...table,
        slots: { ...table.slots, "origin.x": { kind: "literal", value: 10 }, "origin.y": { kind: "literal", value: 20 } },
      };
      const result = deleteTableLine(withPosition, "row", 1);
      expect(result.slots["origin.x"]).toEqual({ kind: "literal", value: 10 });
      expect(result.slots["origin.y"]).toEqual({ kind: "literal", value: 20 });
    });
  });
});
