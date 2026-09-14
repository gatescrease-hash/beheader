import { describe, expect, it } from "vitest";
import { completeAddress, completeObjectName, longestCommonPrefix, objectSlotPaths } from "./complete.ts";
import { createMathObject } from "./primitives/math.ts";
import type { GraphObject } from "./graph/node.ts";

function circle(id: string, name: string): GraphObject {
  return {
    id,
    name,
    type: "circle",
    slots: {
      "origin.x": { kind: "literal", value: 0 },
      "origin.y": { kind: "literal", value: 0 },
      radius: { kind: "literal", value: 1 },
    },
  };
}

function table(id: string, name: string): GraphObject {
  return {
    id,
    name,
    type: "table",
    slots: {
      "origin.x": { kind: "literal", value: 0 },
      "origin.y": { kind: "literal", value: 0 },
      rows: { kind: "literal", value: 2 },
      cols: { kind: "literal", value: 2 },
      "cells.A1": { kind: "literal", value: 0 },
      "cells.A2": { kind: "literal", value: 0 },
      "cells.B1": { kind: "literal", value: 0 },
      "cells.B2": { kind: "literal", value: 0 },
    },
  };
}

const DOCUMENT: readonly GraphObject[] = [circle("obj_1", "circle_1"), circle("obj_2", "circle_2"), table("obj_3", "table_1")];

const texts = (result: { candidates: readonly { text: string }[] }): string[] => result.candidates.map((entry) => entry.text);

describe("longestCommonPrefix", () => {
  it("gives the run every string starts with", () => {
    expect(longestCommonPrefix(["circle_1", "circle_2"])).toBe("circle_");
  });

  it("gives the whole of a lone string", () => {
    expect(longestCommonPrefix(["table_1"])).toBe("table_1");
  });

  it("gives nothing for strings that share no start, and for none at all", () => {
    expect(longestCommonPrefix(["abc", "xyz"])).toBe("");
    expect(longestCommonPrefix([])).toBe("");
  });
});

describe("completeObjectName", () => {
  it("offers every name that starts with what was typed", () => {
    expect(texts(completeObjectName("circle", DOCUMENT))).toEqual(["circle_1", "circle_2"]);
  });

  it("fills as far as the names agree and stops there", () => {
    expect(completeObjectName("c", DOCUMENT).fill).toBe("circle_");
  });

  it("fills the whole name when only one matches", () => {
    expect(completeObjectName("t", DOCUMENT).fill).toBe("table_1");
  });

  it("offers everything for an empty word", () => {
    expect(texts(completeObjectName("", DOCUMENT))).toHaveLength(3);
  });

  it("matches without regard to case, and writes the spelling the document holds", () => {
    expect(completeObjectName("TAB", DOCUMENT).fill).toBe("table_1");
  });

  it("offers nothing for a name no object starts with", () => {
    expect(completeObjectName("zz", DOCUMENT)).toEqual({ candidates: [], fill: "" });
  });
});

describe("objectSlotPaths", () => {
  it("gives the slots of a type as an operator writes them", () => {
    expect(objectSlotPaths(circle("obj_1", "circle_1"))).toEqual(expect.arrayContaining(["origin.x", "radius"]));
  });

  it("gives a table cell its surface spelling, not the key the slot map uses", () => {
    const paths = objectSlotPaths(table("obj_3", "table_1"));
    expect(paths).toContain("A1");
    expect(paths).not.toContain("cells.A1");
  });

  it("includes a derived slot, because a formula can read one", () => {
    expect(objectSlotPaths(circle("obj_1", "circle_1"))).toContain("centroid.x");
  });

  it("includes the ports a math object carries", () => {
    const object = { ...createMathObject("obj_9", "math_1", 0, 0), ports: { in: ["a"], out: ["y"] } };
    const paths = objectSlotPaths(object);
    expect(paths).toContain("in.a");
    expect(paths).toContain("out.y");
  });

  it("gives nothing for a type with no schema", () => {
    expect(objectSlotPaths({ id: "obj_1", name: "x", type: "math", slots: {} } as GraphObject)).not.toHaveLength(0);
  });
});

describe("completeAddress", () => {
  it("completes an object name before the first dot", () => {
    expect(completeAddress("circ", DOCUMENT).fill).toBe("circle_");
  });

  it("completes a slot after the dot, carrying the object name along", () => {
    expect(texts(completeAddress("table_1.A", DOCUMENT))).toEqual(["table_1.A1", "table_1.A2"]);
  });

  it("fills as far as the slots agree", () => {
    expect(completeAddress("circle_1.orig", DOCUMENT).fill).toBe("circle_1.origin.");
  });

  it("offers every slot for a bare dot, which is what a second completion shows", () => {
    expect(texts(completeAddress("table_1.", DOCUMENT))).toContain("table_1.B2");
  });

  it("offers nothing for an object that does not exist", () => {
    expect(completeAddress("nowhere.x", DOCUMENT)).toEqual({ candidates: [], fill: "" });
  });

  it("finds the object without regard to case and writes its real name", () => {
    expect(completeAddress("TABLE_1.A1", DOCUMENT).fill).toBe("table_1.A1");
  });

  it("offers nothing for a slot no path starts with", () => {
    expect(completeAddress("circle_1.zz", DOCUMENT)).toEqual({ candidates: [], fill: "" });
  });
});
