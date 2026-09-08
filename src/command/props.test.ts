/**
 * props.test.ts
 *
 * Slot descriptors for the panel and for the props command.
 */

import { describe, expect, it } from "vitest";
import type { GraphObject } from "../engine/graph/node.ts";
import { isParseError, parseFormula } from "../engine/formula/parser.ts";
import { buildSlotDescriptors, describeSlotValue } from "./props.ts";

function valueObject(id: string, name: string, value: number): GraphObject {
  return { id, name, type: "value", slots: { value: { kind: "literal", value } } };
}

describe("buildSlotDescriptors — one object's slots, in schema order", () => {
  it("describes a literal slot: its path, its kind, and its value", () => {
    const object = valueObject("obj_1", "value_1", 42);
    expect(buildSlotDescriptors(object, [object])).toEqual([{ path: ["value"], kind: "literal", value: 42 }]);
  });

  it("returns an empty list for a type with no schema entry, never throwing (`primitives/schema.ts`'s registry)", () => {
    const object: GraphObject = { id: "obj_1", name: "polyline_1", type: "polyline", slots: {} };
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

  it("reconstructs a formula slot's source against CURRENT names, without a leading '='", () => {
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

  it("renames the formula's source when the object it points at is renamed, because a stored AST holds an ID, not a name", () => {
    const source = valueObject("obj_1", "value_1", 42);
    const ast = parseFormula("value_1.value", [source]);
    if (isParseError(ast)) {
      throw new Error(`fixture formula failed to parse: ${ast.message}`);
    }
    const holder: GraphObject = { id: "obj_2", name: "value_2", type: "value", slots: { value: { kind: "formula", ast, value: 42 } } };
    const renamed: GraphObject = { ...source, name: "intersection_a" };
    expect(buildSlotDescriptors(holder, [renamed, holder])[0]).toEqual({ path: ["value"], kind: "formula", value: 42, formulaSource: "intersection_a.value" });
  });

  describe("a table's `cells.*` family", () => {
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

    it("names the grid shape and how many cells are WRITTEN, never the declared extent", () => {
      const object = table(4, 4, { A1: 1, B2: 2 });
      const summary = buildSlotDescriptors(object, [object]).find((descriptor) => descriptor.path[0] === "cells");
      expect(summary).toEqual({ path: ["cells"], kind: "literal", value: "4×4 grid — 2 of 16 cells written", synthetic: true });
    });

    it("reports zero written cells honestly for a freshly created table, because creation makes no cell slots", () => {
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

describe("describeSlotValue — every Value variant", () => {
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

describe("describeSlotValue — maxDecimals: panel-only display rounding", () => {
  it("with no options at all, a number renders exactly as it did before options existed", () => {
    expect(describeSlotValue(10.000000000000002)).toBe("10.000000000000002");
    expect(describeSlotValue(152.95081246064453)).toBe("152.95081246064453");
  });

  it("rounds to AT MOST maxDecimals decimal places and TRIMS trailing zeros, so an integer stays bare", () => {
    expect(describeSlotValue(10.000000000000002, { maxDecimals: 4 })).toBe("10");
    expect(describeSlotValue(152.95081246064453, { maxDecimals: 4 })).toBe("152.9508");
    expect(describeSlotValue(1.5, { maxDecimals: 4 })).toBe("1.5");
  });

  it("a non-zero value that would round to 0 shows in EXPONENTIAL form instead of lying with '0'", () => {
    expect(describeSlotValue(1.2246467991473532e-16, { maxDecimals: 4 })).toBe("1.2246e-16");
    expect(describeSlotValue(-1.2246467991473532e-16, { maxDecimals: 4 })).toBe("-1.2246e-16");
  });

  it("an EXACT zero still renders as plain '0', not exponential — clause 3 is about hiding a lie, and zero is not one", () => {
    expect(describeSlotValue(0, { maxDecimals: 4 })).toBe("0");
  });

  it("rounds each component of a Point independently", () => {
    expect(describeSlotValue({ x: 10.000000000000002, y: 1.2246467991473532e-16 }, { maxDecimals: 4 })).toBe("10,1.2246e-16");
  });

  it("leaves every other Value variant untouched by maxDecimals", () => {
    expect(describeSlotValue("42", { maxDecimals: 4 })).toBe('"42"');
    expect(describeSlotValue(true, { maxDecimals: 4 })).toBe("true");
    expect(describeSlotValue(null, { maxDecimals: 4 })).toBe("nothing");
    expect(describeSlotValue({ error: "#REF", message: "no such slot" }, { maxDecimals: 4 })).toBe("#REF: no such slot");
    expect(describeSlotValue([{ x: 0, y: 0 }, { x: 1, y: 1 }], { maxDecimals: 4 })).toBe("2 points");
  });
});

describe("describeSlotValue — a very long string is elided, so an image data URL cannot flood a log line or a panel row", () => {
  const LONG = `data:image/png;base64,${"A".repeat(178)}`;

  it("shows the head of a long string and its true length, never the whole of it", () => {
    const described = describeSlotValue(LONG);
    expect(described).toBe('"data:image/png;base64,AAAAAAAAAAAAAAAAAA…" (200 characters)');
    expect(described).not.toContain(LONG);
  });

  it("renders a short string whole, quoted, exactly as before", () => {
    expect(describeSlotValue("sans-serif")).toBe('"sans-serif"');
  });

  it("renders a long string whole when the caller asks for it, which is how an edit seed stays typeable back", () => {
    expect(describeSlotValue(LONG, { fullStrings: true })).toBe(`"${LONG}"`);
  });

  it("elides independently of maxDecimals, so the panel's rounded display still gets the short form", () => {
    expect(describeSlotValue(LONG, { maxDecimals: 4 })).toContain("(200 characters)");
  });
});
