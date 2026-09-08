/**
 * address.test.ts
 *
 * Name rules, the address parser, the address formatter, and the A1 cell
 * helpers.
 * A round trip through parse and format must give back the same address.
 */
import { describe, expect, it } from "vitest";
import {
  type Address,
  type AddressableObject,
  bareCellAddress,
  checkNameAvailable,
  columnLettersToIndex,
  findObjectByName,
  formatAddress,
  formatCellReference,
  generateDefaultName,
  indexToColumnLetters,
  isAddressError,
  isCellReferenceForm,
  isNameTaken,
  isValidName,
  parseAddress,
  parseCellReference,
} from "./address.ts";
import { RESERVED_WORDS } from "./formula/lexer.ts";
import type { ObjectType } from "./graph/node.ts";

function objects(
  ...entries: Array<[id: string, name: string, type?: ObjectType]>
): AddressableObject[] {
  return entries.map(([id, name, type = "polygon"]) => ({ id, name, type }));
}

function parseOk(input: string, docObjects: readonly AddressableObject[]): Address {
  const result = parseAddress(input, docObjects);
  if (isAddressError(result)) {
    throw new Error(`expected "${input}" to parse, got error: ${result.message}`);
  }
  return result;
}

describe("isValidName", () => {
  it("accepts names starting with a letter or underscore, then letters/digits/underscores", () => {
    expect(isValidName("polygon_1")).toBe(true);
    expect(isValidName("_private")).toBe(true);
    expect(isValidName("a")).toBe(true);
    expect(isValidName("Table_X2")).toBe(true);
  });

  it("rejects a name starting with a digit", () => {
    expect(isValidName("1abc")).toBe(false);
  });

  it("rejects a name containing a space, dash, or dot", () => {
    expect(isValidName("has space")).toBe(false);
    expect(isValidName("has-dash")).toBe(false);
    expect(isValidName("has.dot")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidName("")).toBe(false);
  });
});

describe("findObjectByName", () => {
  it("looks up a name case-insensitively", () => {
    const docObjects = objects(["obj_1", "table_x"]);
    expect(findObjectByName("Table_X", docObjects)?.id).toBe("obj_1");
    expect(findObjectByName("TABLE_X", docObjects)?.id).toBe("obj_1");
    expect(findObjectByName("table_x", docObjects)?.id).toBe("obj_1");
  });

  it("returns undefined for a name with no match", () => {
    expect(findObjectByName("nope", objects(["obj_1", "table_x"]))).toBeUndefined();
  });
});

describe("isNameTaken / checkNameAvailable", () => {
  it("flags a case-insensitive collision as taken", () => {
    const docObjects = objects(["obj_1", "polygon_1"]);
    expect(isNameTaken("Polygon_1", docObjects)).toBe(true);
  });

  it("excludeId lets a rename check ignore the object's own current name", () => {
    const docObjects = objects(["obj_1", "polygon_1"]);
    expect(isNameTaken("polygon_1", docObjects, "obj_1")).toBe(false);
  });

  it("checkNameAvailable rejects a name that fails the grammar", () => {
    const result = checkNameAvailable("1bad", objects());
    expect(result.ok).toBe(false);
  });

  it("checkNameAvailable rejects a name already in use by another object (rename collision)", () => {
    const docObjects = objects(["obj_1", "polygon_1"], ["obj_2", "polygon_2"]);
    const result = checkNameAvailable("polygon_1", docObjects, "obj_2");
    expect(result.ok).toBe(false);
  });

  it("checkNameAvailable accepts a valid, unused name", () => {
    const result = checkNameAvailable("intersection_a", objects(["obj_1", "polygon_1"]));
    expect(result.ok).toBe(true);
  });

  it("checkNameAvailable rejects every word the formula lexer treats as a keyword", () => {
    for (const reserved of RESERVED_WORDS) {
      expect(checkNameAvailable(reserved, objects()).ok).toBe(false);
    }
  });

  it("checkNameAvailable rejects a reserved word in ANY case, not just the uppercase the lexer matches", () => {
    const result = checkNameAvailable("True", objects());
    expect(result.ok === false && result.message).toBe(
      '"True" is a reserved word — the formula language reads AND, OR, NOT, TRUE, FALSE as formula keywords in any case, so no formula could reference this object; choose another name',
    );
  });

  it("checkNameAvailable accepts a name that merely CONTAINS a reserved word — the rule is the whole name", () => {
    expect(checkNameAvailable("android", objects()).ok).toBe(true);
    expect(checkNameAvailable("not_1", objects()).ok).toBe(true);
  });

  it("pins the reserved set itself, so growing the lexer's keyword table is a visible diff here", () => {
    expect([...RESERVED_WORDS].sort()).toEqual(["AND", "FALSE", "NOT", "OR", "TRUE"]);
  });
});

describe("generateDefaultName", () => {
  it("starts at _1 when no object of this type exists", () => {
    expect(generateDefaultName("polygon", objects())).toBe("polygon_1");
  });

  it("skips a taken name and returns the next free one", () => {
    const docObjects = objects(["obj_1", "polygon_1"]);
    expect(generateDefaultName("polygon", docObjects)).toBe("polygon_2");
  });

  it("respects case-insensitive collisions when picking the next free name", () => {
    const docObjects = objects(["obj_1", "Polygon_1"]);
    expect(generateDefaultName("polygon", docObjects)).toBe("polygon_2");
  });

  it("does not skip past a gap left by a deleted object's freed name", () => {
    const docObjects = objects(["obj_2", "polygon_2"]);
    expect(generateDefaultName("polygon", docObjects)).toBe("polygon_1");
  });
});

describe("parseAddress", () => {
  it("resolves a simple table-cell address to {objectId, path: ['cells', ref]}", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    const result = parseAddress("table_x.A1", docObjects);
    expect(result).toEqual({ objectId: "obj_3", path: ["cells", "A1"] });
  });

  it("resolves a multi-segment path", () => {
    const docObjects = objects(["obj_7", "polygon_1"]);
    const result = parseAddress("polygon_1.origin.x", docObjects);
    expect(result).toEqual({ objectId: "obj_7", path: ["origin", "x"] });
  });

  it("resolves the object name case-insensitively", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    expect(parseAddress("TABLE_X.A1", docObjects)).toEqual({ objectId: "obj_3", path: ["cells", "A1"] });
  });

  it("bareCellAddress agrees with parseAddress: two spellings of one cell resolve to ONE slot", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    expect(bareCellAddress("obj_3", "A1")).toEqual(parseAddress("table_x.A1", docObjects));
    expect(bareCellAddress("obj_3", "AB12")).toEqual(parseAddress("table_x.AB12", docObjects));
  });

  it("bareCellAddress normalises a lowercase bare ref the same way parseAddress does", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    expect(bareCellAddress("obj_3", "a1")).toEqual(parseAddress("table_x.A1", docObjects));
    expect(bareCellAddress("obj_3", "a1")).toEqual(parseAddress("table_x.a1", docObjects));
  });

  it("leaves a path that is already 2+ segments alone on a table, e.g. table_x.cells.A1", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    expect(parseAddress("table_x.cells.A1", docObjects)).toEqual({ objectId: "obj_3", path: ["cells", "A1"] });
  });

  it("does not apply the table cells-prefix mapping to a non-table object", () => {
    const docObjects = objects(["obj_7", "polygon_1", "polygon"]);
    expect(parseAddress("polygon_1.radius", docObjects)).toEqual({ objectId: "obj_7", path: ["radius"] });
  });

  it.each(["rows", "cols", "opacity", "cells", "typo"])(
    "does not treat the non-A1-form table path %s as a cell reference",
    (segment) => {
      const docObjects = objects(["obj_3", "table_x", "table"]);
      expect(parseAddress(`table_x.${segment}`, docObjects)).toEqual({
        objectId: "obj_3",
        path: [segment],
      });
    },
  );

  it("maps a lowercase cell ref, normalised to uppercase", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    expect(parseAddress("table_x.a1", docObjects)).toEqual({ objectId: "obj_3", path: ["cells", "A1"] });
  });

  it("a lowercase and an uppercase spelling of the same cell resolve to the IDENTICAL stored Address", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    expect(parseAddress("table_x.a1", docObjects)).toEqual(parseAddress("table_x.A1", docObjects));
    expect(parseAddress("table_x.aB12", docObjects)).toEqual(parseAddress("table_x.AB12", docObjects));
  });

  it("the written-out stored form is normalised too: table_x.cells.a1 is the SAME slot as table_x.a1", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    expect(parseAddress("table_x.cells.a1", docObjects)).toEqual({ objectId: "obj_3", path: ["cells", "A1"] });
    expect(parseAddress("table_x.cells.a1", docObjects)).toEqual(parseAddress("table_x.A1", docObjects));
  });

  it("a row with leading zeros is NOT a cell reference, so A007 never becomes a second slot beside A7", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    expect(isCellReferenceForm("A007")).toBe(false);
    expect(isCellReferenceForm("A7")).toBe(true);
    expect(parseAddress("table_x.A007", docObjects)).toEqual({ objectId: "obj_3", path: ["A007"] });
  });

  it("row 0 is not a cell reference — A1 notation has no row 0", () => {
    expect(isCellReferenceForm("A0")).toBe(false);
    expect(parseCellReference("A0")).toBeUndefined();
  });

  it("parseCellReference and isCellReferenceForm agree on every shape, because they share one pattern", () => {
    for (const candidate of ["A1", "a1", "AB12", "Z99", "A007", "A0", "A", "1", "A1B", "", "AA0"]) {
      expect(parseCellReference(candidate) !== undefined).toBe(isCellReferenceForm(candidate));
    }
  });

  it("maps a multi-letter, multi-digit cell ref such as AB12", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    expect(parseAddress("table_x.AB12", docObjects)).toEqual({
      objectId: "obj_3",
      path: ["cells", "AB12"],
    });
  });

  it("accepts a numeric path segment, for per-vertex slots like vertex.0.x", () => {
    const docObjects = objects(["obj_5", "polyline_1"]);
    expect(parseAddress("polyline_1.vertex.0.x", docObjects)).toEqual({
      objectId: "obj_5",
      path: ["vertex", "0", "x"],
    });
  });

  it("rejects an unknown object name with a #REF naming the name", () => {
    const result = parseAddress("nonexistent.A1", objects());
    expect(isAddressError(result)).toBe(true);
    if (isAddressError(result)) {
      expect(result.message).toContain("nonexistent");
    }
  });

  it("rejects an address with no path segment", () => {
    expect(parseAddress("table_x", objects(["obj_3", "table_x"]))).toMatchObject({ error: "#REF" });
  });

  it("rejects an address with an empty segment", () => {
    const docObjects = objects(["obj_3", "table_x"]);
    expect(parseAddress("table_x..A1", docObjects)).toMatchObject({ error: "#REF" });
    expect(parseAddress("table_x.", docObjects)).toMatchObject({ error: "#REF" });
    expect(parseAddress(".A1", docObjects)).toMatchObject({ error: "#REF" });
  });

  it("rejects an empty string", () => {
    expect(parseAddress("", objects())).toMatchObject({ error: "#REF" });
  });

  it("rejects a path segment containing a disallowed character", () => {
    const docObjects = objects(["obj_3", "table_x"]);
    expect(parseAddress("table_x.A 1", docObjects)).toMatchObject({ error: "#REF" });
  });

  it("never throws on malformed input", () => {
    expect(() => parseAddress("....", objects())).not.toThrow();
  });
});

describe("isAddressError", () => {
  it("distinguishes an AddressError from a successful Address", () => {
    expect(isAddressError({ error: "#REF", message: "x" })).toBe(true);
    expect(isAddressError({ objectId: "obj_1", path: ["x"] })).toBe(false);
  });
});

describe("formatAddress", () => {
  it("round-trips a parsed table-cell address back to its canonical (short) string", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    const parsed = parseOk("table_x.A1", docObjects);
    expect(parsed).toEqual({ objectId: "obj_3", path: ["cells", "A1"] });
    expect(formatAddress(parsed, docObjects)).toBe("table_x.A1");
  });

  it("rejects a stale objectId with a #REF", () => {
    const result = formatAddress({ objectId: "obj_999", path: ["A1"] }, objects());
    expect(result).toMatchObject({ error: "#REF" });
  });

  it("reflects a rename with no change to the stored address", () => {
    const before = objects(["obj_7", "polygon_1"]);

    const stored = parseOk("polygon_1.origin.x", before);

    expect(Object.keys(stored).sort()).toEqual(["objectId", "path"]);
    expect(JSON.stringify(stored)).not.toContain("polygon_1");

    const after = objects(["obj_7", "intersection_a"]);
    expect(stored).toEqual({ objectId: "obj_7", path: ["origin", "x"] });

    expect(formatAddress(stored, after)).toBe("intersection_a.origin.x");
    expect(formatAddress(stored, before)).toBe("polygon_1.origin.x");
  });
});

describe("parseAddress / formatAddress round-trip every address form", () => {
  const docObjects = objects(
    ["obj_3", "table_x", "table"],
    ["obj_7", "polygon_1", "polygon"],
    ["obj_9", "script_2", "script"],
  );

  it.each<[surface: string, expected: Address]>([
    ["table_x.A1", { objectId: "obj_3", path: ["cells", "A1"] }],
    ["polygon_1.origin.x", { objectId: "obj_7", path: ["origin", "x"] }],
    ["polygon_1.centroid.x", { objectId: "obj_7", path: ["centroid", "x"] }],
    ["script_2.out.result", { objectId: "obj_9", path: ["out", "result"] }],
    ["script_2.in.speed", { objectId: "obj_9", path: ["in", "speed"] }],
  ])("%s", (surface, expected) => {
    const parsed = parseOk(surface, docObjects);
    expect(parsed).toEqual(expected);
    expect(formatAddress(parsed, docObjects)).toBe(surface);
  });

  it("does not strip a cells prefix whose second segment is not an A1-form ref", () => {
    expect(formatAddress({ objectId: "obj_3", path: ["cells", "rows"] }, docObjects)).toBe(
      "table_x.cells.rows",
    );
  });
});

describe("columnLettersToIndex / indexToColumnLetters — bijective base 26", () => {
  it.each<[letters: string, index: number]>([
    ["A", 1],
    ["B", 2],
    ["Z", 26],
    ["AA", 27],
    ["AB", 28],
    ["AZ", 52],
    ["BA", 53],
    ["ZZ", 702],
    ["AAA", 703],
  ])("%s <-> %i", (letters, index) => {
    expect(columnLettersToIndex(letters)).toBe(index);
    expect(indexToColumnLetters(index)).toBe(letters);
  });

  it("columnLettersToIndex accepts either case", () => {
    expect(columnLettersToIndex("ab")).toBe(28);
    expect(columnLettersToIndex("Ab")).toBe(28);
  });

  it("indexToColumnLetters always produces uppercase", () => {
    expect(indexToColumnLetters(28)).toBe("AB");
  });

  it("round-trips every index from 1 to 1000 with no collision (bijective, not merely injective within a small sample)", () => {
    const seen = new Set<string>();
    for (let index = 1; index <= 1000; index += 1) {
      const letters = indexToColumnLetters(index);
      expect(seen.has(letters), `duplicate letters "${letters}" at index ${index}`).toBe(false);
      seen.add(letters);
      expect(columnLettersToIndex(letters)).toBe(index);
    }
  });
});

describe("parseCellReference / formatCellReference", () => {
  it.each<[reference: string, column: number, row: number]>([
    ["A1", 1, 1],
    ["Z9", 26, 9],
    ["AA1", 27, 1],
    ["AB12", 28, 12],
  ])("splits %s into {column: %i, row: %i} and back", (reference, column, row) => {
    expect(parseCellReference(reference)).toEqual({ column, row });
    expect(formatCellReference({ column, row })).toBe(reference);
  });

  it("parseCellReference accepts either case and formatCellReference always answers uppercase", () => {
    expect(parseCellReference("ab12")).toEqual({ column: 28, row: 12 });
    expect(formatCellReference({ column: 28, row: 12 })).toBe("AB12");
  });

  it("parseCellReference returns undefined, never throws, for a non-cell-shaped string", () => {
    expect(parseCellReference("")).toBeUndefined();
    expect(parseCellReference("12A")).toBeUndefined();
    expect(parseCellReference("A")).toBeUndefined();
    expect(parseCellReference("1")).toBeUndefined();
    expect(parseCellReference("A1B2")).toBeUndefined();
  });

  it("agrees with bareCellAddress/toStoredPath's own TABLE_CELL_PATH_PREFIX shape (no drift between the two mappings)", () => {
    const coordinates = parseCellReference("b3");
    expect(coordinates).toEqual({ column: 2, row: 3 });
    const ref = formatCellReference(coordinates as { column: number; row: number });
    expect(bareCellAddress("obj_1", ref)).toEqual(bareCellAddress("obj_1", "b3"));
  });
});
