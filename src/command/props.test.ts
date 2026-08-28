/**
 * props.test.ts — Tests for `command/props.ts` (D-092 clause 4, D-094 clause 9).
 *
 * Unit-level, against hand-built `GraphObject`s: `commands.test.ts`'s `props`
 * block exercises this file end to end, through a typed line and real
 * creation/`link` commands. Here the claim is about the MECHANISM —
 * declaration order, the dynamic-group skip, and every `Value` variant
 * `describeSlotValue` renders — independent of how an object came to exist.
 */
import { describe, expect, it } from "vitest";
import type { GraphObject } from "../engine/graph/node.ts";
import { isParseError, parseFormula } from "../engine/formula/parser.ts";
import { buildSlotDescriptors, describeSlotValue } from "./props.ts";

/** A `value` object (Phase 0's one-literal-slot fixture type) holding `value`. */
function valueObject(id: string, name: string, value: number): GraphObject {
  return { id, name, type: "value", slots: { value: { kind: "literal", value } } };
}

describe("buildSlotDescriptors — one object's slots, in schema order (D-094 clause 7)", () => {
  it("describes a literal slot: its path, its kind, and its value", () => {
    const object = valueObject("obj_1", "value_1", 42);
    expect(buildSlotDescriptors(object, [object])).toEqual([{ path: ["value"], kind: "literal", value: 42 }]);
  });

  it("returns an empty list for a type with no schema entry, never throwing (`primitives/schema.ts`'s registry)", () => {
    const object: GraphObject = { id: "obj_1", name: "text_1", type: "text", slots: {} };
    expect(buildSlotDescriptors(object, [object])).toEqual([]);
  });

  it("lists non-derived slots before derived ones, each in the schema's OWN declared order (`add`'s two ins, then its one out)", () => {
    const object: GraphObject = {
      id: "obj_1",
      name: "add_1",
      type: "add",
      slots: {
        "in.a": { kind: "literal", value: 2 },
        "in.b": { kind: "literal", value: 3 },
        "out.result": { kind: "derived", value: 5 },
      },
    };
    expect(buildSlotDescriptors(object, [object])).toEqual([
      { path: ["in", "a"], kind: "literal", value: 2 },
      { path: ["in", "b"], kind: "literal", value: 3 },
      { path: ["out", "result"], kind: "derived", value: 5 },
    ]);
  });

  it("reconstructs a formula slot's source against CURRENT names (§5.2), without a leading '='", () => {
    const source = valueObject("obj_1", "value_1", 42);
    const other = valueObject("obj_2", "value_2", 0);
    const objects = [source, other];
    const ast = parseFormula("value_1.value + 1", objects);
    if (isParseError(ast)) {
      throw new Error(`fixture formula failed to parse: ${ast.message}`);
    }
    const formulaHolder: GraphObject = { ...other, slots: { value: { kind: "formula", ast, value: 43 } } };
    expect(buildSlotDescriptors(formulaHolder, [source, formulaHolder])).toEqual([
      { path: ["value"], kind: "formula", value: 43, formulaSource: "value_1.value + 1" },
    ]);
  });

  it("renames the formula's source when the object it points at is renamed, because a stored AST holds an ID, not a name (§5.2)", () => {
    const source = valueObject("obj_1", "value_1", 42);
    const ast = parseFormula("value_1.value", [source]);
    if (isParseError(ast)) {
      throw new Error(`fixture formula failed to parse: ${ast.message}`);
    }
    const holder: GraphObject = { id: "obj_2", name: "value_2", type: "value", slots: { value: { kind: "formula", ast, value: 42 } } };
    const renamed: GraphObject = { ...source, name: "intersection_a" };
    expect(buildSlotDescriptors(holder, [renamed, holder])[0]).toEqual({ path: ["value"], kind: "formula", value: 42, formulaSource: "intersection_a.value" });
  });

  describe("a table's `cells.*` family — D-077, D-094 clause 8", () => {
    function table(rows: number, cols: number, cellSlots: Record<string, number>): GraphObject {
      const cellEntries = Object.fromEntries(Object.entries(cellSlots).map(([cell, value]) => [`cells.${cell}`, { kind: "literal" as const, value }]));
      return {
        id: "obj_1",
        name: "table_1",
        type: "table",
        slots: {
          "origin.x": { kind: "literal", value: 0 },
          "origin.y": { kind: "literal", value: 0 },
          rows: { kind: "literal", value: rows },
          cols: { kind: "literal", value: cols },
          ...cellEntries,
        },
      };
    }

    it("is NEVER enumerated path by path — one descriptor stands in for the whole family", () => {
      const object = table(4, 4, { A1: 1, B2: 2 });
      const descriptors = buildSlotDescriptors(object, [object]);
      expect(descriptors.filter((descriptor) => descriptor.path[0] === "cells")).toHaveLength(1);
    });

    it("names the grid shape and how many cells are WRITTEN, never the declared extent (D-047's absent-is-empty)", () => {
      const object = table(4, 4, { A1: 1, B2: 2 });
      const summary = buildSlotDescriptors(object, [object]).find((descriptor) => descriptor.path[0] === "cells");
      expect(summary).toEqual({ path: ["cells"], kind: "literal", value: "4×4 grid — 2 of 16 cells written" });
    });

    it("reports zero written cells honestly for a freshly created table (D-047: creation makes no cell slots)", () => {
      const object = table(8, 8, {});
      const summary = buildSlotDescriptors(object, [object]).find((descriptor) => descriptor.path[0] === "cells");
      expect(summary?.value).toBe("8×8 grid — 0 of 64 cells written");
    });

    it("lists the table's own slots before the cells summary, in schema order", () => {
      const object = table(2, 2, {});
      expect(buildSlotDescriptors(object, [object]).map((descriptor) => descriptor.path.join("."))).toEqual(["origin.x", "origin.y", "rows", "cols", "cells"]);
    });
  });
});

describe("describeSlotValue — every Value variant (§5.1), moved here at D-094 clause 9", () => {
  it("renders null as 'nothing', because a blank cell should not print an empty string", () => {
    expect(describeSlotValue(null)).toBe("nothing");
  });

  it("renders an ErrorValue as its code and message", () => {
    expect(describeSlotValue({ error: "#REF", message: "no such slot" })).toBe("#REF: no such slot");
  });

  it("quotes a string, distinguishing it from a bare number typed the same way", () => {
    expect(describeSlotValue("42")).toBe('"42"');
    expect(describeSlotValue(42)).toBe("42");
  });

  it("renders a boolean as TRUE/FALSE-cased JS, matching how it prints elsewhere", () => {
    expect(describeSlotValue(true)).toBe("true");
  });

  it("renders a Point[] as its count, never spreading the points themselves", () => {
    expect(describeSlotValue([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBe("3 points");
  });

  it("renders a bare Point as 'x,y'", () => {
    expect(describeSlotValue({ x: 3, y: 4 })).toBe("3,4");
  });
});
