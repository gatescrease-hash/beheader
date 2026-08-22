/**
 * address.test.ts — Tests for the addressing scheme (§5.2).
 *
 * Colocated with address.ts per D-001. These are the tests the seed reviewer
 * (0000-SEED-reviewer.md) flagged as checked hardest: the two-layer name/ID split
 * (rename does not touch stored Addresses) and pure-engine hygiene.
 */
import { describe, expect, it } from "vitest";
import {
  type Address,
  type AddressableObject,
  checkNameAvailable,
  findObjectByName,
  formatAddress,
  generateDefaultName,
  isAddressError,
  isNameTaken,
  isValidName,
  parseAddress,
} from "./address.ts";

// `type` defaults to "polygon" — an arbitrary non-table type — for every test that
// isn't specifically exercising the table/cells path mapping (D-005).
function objects(...entries: Array<[id: string, name: string, type?: string]>): AddressableObject[] {
  return entries.map(([id, name, type = "polygon"]) => ({ id, name, type }));
}

/** Parses and asserts success, narrowing away the AddressError arm for the caller. */
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
  it("looks up a name case-insensitively, per §5.2", () => {
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
    // polygon_1 was deleted; only polygon_2 exists. The next default is polygon_1,
    // not polygon_3 — see the rationale comment in address.ts.
    const docObjects = objects(["obj_2", "polygon_2"]);
    expect(generateDefaultName("polygon", docObjects)).toBe("polygon_1");
  });
});

describe("parseAddress", () => {
  it("resolves a simple table-cell address to {objectId, path: ['cells', ref]} (D-005, §5.4)", () => {
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

  it("leaves a path that is already 2+ segments alone on a table, e.g. table_x.cells.A1", () => {
    const docObjects = objects(["obj_3", "table_x", "table"]);
    expect(parseAddress("table_x.cells.A1", docObjects)).toEqual({ objectId: "obj_3", path: ["cells", "A1"] });
  });

  it("does not apply the table cells-prefix mapping to a non-table object", () => {
    const docObjects = objects(["obj_7", "polygon_1", "polygon"]);
    expect(parseAddress("polygon_1.radius", docObjects)).toEqual({ objectId: "obj_7", path: ["radius"] });
  });

  it("accepts a numeric path segment, for per-vertex slots like vertex.0.x (§5.5)", () => {
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
    // The table type is what makes this test actually exercise D-005's mapping —
    // without it, "table_x.A1" would parse to path ["A1"] under the default
    // non-table type and the test would pass without touching toStoredPath at all.
    const docObjects = objects(["obj_3", "table_x", "table"]);
    const parsed = parseOk("table_x.A1", docObjects);
    expect(parsed).toEqual({ objectId: "obj_3", path: ["cells", "A1"] });
    expect(formatAddress(parsed, docObjects)).toBe("table_x.A1");
  });

  it("rejects a stale objectId with a #REF", () => {
    const result = formatAddress({ objectId: "obj_999", path: ["A1"] }, objects());
    expect(result).toMatchObject({ error: "#REF" });
  });

  // The load-bearing guarantee (§5.2, Rule 3): a stored Address never contains a
  // user-facing name, so renaming an object costs nothing — the same stored
  // Address simply formats differently afterwards. Flagged explicitly by the seed
  // reviewer (0000-SEED-reviewer.md) as the test that must exist before anything
  // else reads addresses.
  it("reflects a rename with no change to the stored address", () => {
    const before = objects(["obj_7", "polygon_1"]);

    // A formula elsewhere is authored against the name and parsed to a stored
    // Address at that moment (§5.2: "stored ASTs hold IDs, not names").
    const stored = parseOk("polygon_1.origin.x", before);

    // The stored Address is exactly {objectId, path} — no name field exists to
    // even accidentally carry the old name forward.
    expect(Object.keys(stored).sort()).toEqual(["objectId", "path"]);
    expect(JSON.stringify(stored)).not.toContain("polygon_1");

    // Rename obj_7 to intersection_a. This is a new objects array (rename is a
    // mutation elsewhere); the point under test is that `stored` itself is
    // untouched by it — same object, same reference, still {objectId: "obj_7", ...}.
    const after = objects(["obj_7", "intersection_a"]);
    expect(stored).toEqual({ objectId: "obj_7", path: ["origin", "x"] });

    // Formatting the SAME stored Address against the new name table now shows the
    // new name, without the Address itself having been touched.
    expect(formatAddress(stored, after)).toBe("intersection_a.origin.x");
    expect(formatAddress(stored, before)).toBe("polygon_1.origin.x");
  });
});

// D-005 (0002-REVIEW-phase0, fixing F-1): parseAddress and formatAddress must be
// exact inverses for every address form PROJECT_BRIEF §5.2's table specifies,
// including the one case (table cells) where the surface string and the stored
// path genuinely differ.
describe("parseAddress / formatAddress round-trip every address form in §5.2's table", () => {
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
});
