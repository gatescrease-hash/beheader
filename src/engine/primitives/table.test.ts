/**
 * table.test.ts — tests for primitives/table.ts (PROJECT_BRIEF §5.4, §5.3; D-036;
 * the dynamic-slot-family mechanism, D-017/0041-REVIEW-phase2 §9; range-evaluation
 * wiring's bounding, D-044/D-046).
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import type { GraphObject, Value } from "../graph/node.ts";
import {
  DEFAULT_TABLE_COLS,
  DEFAULT_TABLE_ROWS,
  enumerateRangeCellAddresses,
  enumerateTableCellSlotPaths,
  isRangeEnumerationError,
  TABLE_COLS_PATH,
  TABLE_ROWS_PATH,
  type RangeEnumerationError,
} from "./table.ts";

function cell(objectId: string, ref: string): Address {
  return { objectId, path: ["cells", ref] };
}

/** A table object with only its two fixed dimension slots populated at the given values — no cells. */
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

/** A table whose `rows`/`cols` are `formula`-kind (cached at the given value) rather than `literal` — D-046's guard. */
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

describe("default dimensions (§5.4: \"Default 8×8\")", () => {
  it("is 8x8", () => {
    expect(DEFAULT_TABLE_ROWS).toBe(8);
    expect(DEFAULT_TABLE_COLS).toBe(8);
  });
});

describe("enumerateRangeCellAddresses — the rectangle between two same-table endpoints, bounded by current extent (D-036/D-044)", () => {
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

  it("D-044: a range extending past the table's current extent is CLAMPED, not #REF — SUM(A1:Z99) over an 8x8 table enumerates only the 8x8 rectangle", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "Z99"), TABLE_8X8);
    expect(isRangeEnumerationError(result)).toBe(false);
    expect((result as readonly Address[])).toHaveLength(8 * 8);
    expect((result as readonly Address[])[(result as readonly Address[]).length - 1]).toEqual(cell("obj_1", "H8"));
  });

  it("D-044: a range entirely beyond the table's extent clamps to EMPTY, not an error", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "J1"), cell("obj_1", "J1"), TABLE_8X8);
    expect(isRangeEnumerationError(result)).toBe(false);
    expect(result).toEqual([]);
  });

  it("D-044: a range with no bound on the far side (e.g. reversed past the extent) still clamps correctly", () => {
    const result = enumerateRangeCellAddresses(cell("obj_1", "Z99"), cell("obj_1", "A1"), TABLE_8X8);
    expect(result).toEqual((enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "Z99"), TABLE_8X8)));
  });

  it("D-046: a formula-kind rows/cols slot is treated as 0 regardless of its cached value — the same Rule 6 guard enumerateTableCellSlotPaths uses", () => {
    const formulaDriven = tableWithFormulaDimensions(8, 8);
    const result = enumerateRangeCellAddresses(cell("obj_1", "A1"), cell("obj_1", "B2"), formulaDriven);
    expect(result).toEqual([]);
  });

  it("rejects a range whose two endpoints name DIFFERENT objects (disclosed decision, file header; defensive arm post-D-045)", () => {
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

  it("is robust to a lowercase cell reference in a hand-built Address, though a real Address never carries one post-D-039 normalisation", () => {
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

describe("enumerateTableCellSlotPaths — the dynamic slot family (D-017/0041-REVIEW-phase2 §9)", () => {
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

  it("D-046: a formula-kind dimension slot is treated as 0, the SAME guard enumerateRangeCellAddresses now shares", () => {
    expect(enumerateTableCellSlotPaths(tableWithFormulaDimensions(8, 8))).toEqual([]);
  });
});
