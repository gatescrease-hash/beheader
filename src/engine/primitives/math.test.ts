import { describe, expect, it } from "vitest";
import { mutate, type Operation } from "../mutation.ts";
import { objectSlotPaths } from "../complete.ts";
import { parseFormula } from "../formula/parser.ts";
import { slotKey, type GraphObject } from "../graph/node.ts";
import {
  applyMathSource,
  createMathObject,
  isMathSourceError,
  mathDisplayLatex,
  readMathDisplayLatex,
  mathSourceWithIds,
  mathSourceWithNames,
  readMathNames,
  unresolvedMathReferences,
  MATH_SOURCE_PATH,
  mathInPortPath,
  mathOutPortPath,
  mathSeedPath,
} from "./math.ts";
import type { MathProgram } from "../math/ast.ts";
import { isMathParseError, parseMath } from "../math/parser.ts";
import type { Value } from "../graph/node.ts";

/** A bare math object, before any source reaches it. */
function emptyMath(id = "obj_1", name = "math_1"): GraphObject {
  return createMathObject(id, name, 0, 0);
}

function table(id: string, name: string, cells: Record<string, GraphObject["slots"][string]>): GraphObject {
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
      ...cells,
    },
  };
}

describe("readMathNames", () => {
  it("reports the export and the input of the worked example, and binds the differential", () => {
    const reading = readMathNames("x_{ans}=\\int_{2}^{8}\\sin(x_{input})dx");
    expect(isMathSourceError(reading)).toBe(false);
    if (isMathSourceError(reading)) return;
    expect(reading.names.exports).toEqual(["x_ans"]);
    expect(reading.names.inputs).toEqual(["x_input"]);
  });

  it("keeps a name bound by a sum out of the input list", () => {
    const reading = readMathNames("s=\\sum_{i=1}^{n}i");
    if (isMathSourceError(reading)) throw new Error(reading.message);
    expect(reading.names.inputs).toEqual(["n"]);
    expect(reading.names.exports).toEqual(["s"]);
  });

  it("keeps a function parameter out of the input list", () => {
    const reading = readMathNames("f(t)=t^2+c\ny=f(3)");
    if (isMathSourceError(reading)) throw new Error(reading.message);
    expect(reading.names.inputs).toEqual(["c"]);
    expect(reading.names.functions).toEqual(["f"]);
    expect(reading.names.exports).toEqual(["y"]);
  });

  it("refuses a line that reads a name defined below it", () => {
    const reading = readMathNames("b=a\na=1");
    expect(isMathSourceError(reading)).toBe(true);
    if (!isMathSourceError(reading)) return;
    // The message points at the line that defines the name, which is the line
    // an operator moves to fix it.
    expect(reading.line).toBe(1);
    expect(reading.message).toContain("above");
  });

  it("refuses a function that calls itself, so evaluation cannot recurse forever", () => {
    const reading = readMathNames("f(x)=f(x)\ny=f(1)");
    expect(isMathSourceError(reading)).toBe(true);
  });
});

describe("applyMathSource", () => {
  it("adds one input slot per free name and one export slot per definition", () => {
    const reading = readMathNames("y=2a+b");
    if (isMathSourceError(reading)) throw new Error(reading.message);
    const object = applyMathSource(emptyMath(), "y=2a+b", reading.names);

    expect(object.ports).toEqual({ in: ["a", "b"], out: ["y"] });
    expect(object.slots[slotKey(mathInPortPath("a"))]).toEqual({ kind: "literal", value: null });
    expect(object.slots[slotKey(mathOutPortPath("y"))]).toEqual({ kind: "derived", value: null });
    expect(object.slots[slotKey(MATH_SOURCE_PATH)]).toEqual({ kind: "literal", value: "y=2a+b" });
    expect(object.slots["origin.x"]).toEqual({ kind: "literal", value: 0 });
  });

  it("keeps the slot of an input the new source still reads, so a link survives an edit", () => {
    const first = readMathNames("y=a");
    if (isMathSourceError(first)) throw new Error(first.message);
    let object = applyMathSource(emptyMath(), "y=a", first.names);
    object = {
      ...object,
      slots: { ...object.slots, "in.a": { kind: "literal", value: 7 } },
    };

    const second = readMathNames("y=a+1");
    if (isMathSourceError(second)) throw new Error(second.message);
    object = applyMathSource(object, "y=a+1", second.names);

    expect(object.slots["in.a"]).toEqual({ kind: "literal", value: 7 });
  });

  it("drops the slot of an input the new source stopped reading", () => {
    const first = readMathNames("y=a+b");
    if (isMathSourceError(first)) throw new Error(first.message);
    let object = applyMathSource(emptyMath(), "y=a+b", first.names);
    expect(object.slots["in.b"]).toBeDefined();

    const second = readMathNames("y=a");
    if (isMathSourceError(second)) throw new Error(second.message);
    object = applyMathSource(object, "y=a", second.names);

    expect(object.slots["in.b"]).toBeUndefined();
    expect(object.ports).toEqual({ in: ["a"], out: ["y"] });
  });
});

describe("mathDisplayLatex", () => {
  function programOf(source: string): MathProgram {
    const parsed = parseMath(source);
    if (isMathParseError(parsed)) throw new Error(parsed.message);
    return parsed;
  }

  it("gives the source back for the source form", () => {
    expect(mathDisplayLatex("y=a+1", "source", programOf("y=a+1"), new Map())).toBe("y=a+1");
  });

  it("gives one result per definition for the value form", () => {
    const exports = new Map<Value, Value>([["y", 4]]) as ReadonlyMap<string, Value>;
    expect(mathDisplayLatex("y=2+2", "value", programOf("y=2+2"), exports)).toBe("y=4");
  });

  it("writes a subscripted name the way LaTeX writes one", () => {
    const exports: ReadonlyMap<string, Value> = new Map([["x_ans", 3]]);
    expect(mathDisplayLatex("x_{ans}=3", "value", programOf("x_{ans}=3"), exports)).toBe("x_{ans}=3");
  });

  it("wraps a name of more than one letter in an operator command", () => {
    const exports: ReadonlyMap<string, Value> = new Map([["rate_a", 2]]);
    const source = "\\operatorname{rate}_{a}=2";
    expect(mathDisplayLatex(source, "value", programOf(source), exports)).toBe("\\operatorname{rate}_{a}=2");
  });

  it("appends the result to the line that produced it for the both form", () => {
    const exports: ReadonlyMap<string, Value> = new Map([["y", 4]]);
    expect(mathDisplayLatex("y=2+2", "both", programOf("y=2+2"), exports)).toBe("y=2+2=4");
  });

  it("keeps each line against its own result across several lines", () => {
    const source = "a=1\nb=2";
    const exports: ReadonlyMap<string, Value> = new Map([["a", 1], ["b", 2]]);
    expect(mathDisplayLatex(source, "both", programOf(source), exports)).toBe("a=1=1\\\\b=2=2");
  });

  it("leaves a line that defines nothing without a result", () => {
    const source = "a=1\n2+2";
    const exports: ReadonlyMap<string, Value> = new Map([["a", 1]]);
    expect(mathDisplayLatex(source, "both", programOf(source), exports)).toBe("a=1=1\\\\2+2");
  });

  it("shows the code of a failed line where its result would be", () => {
    const exports: ReadonlyMap<string, Value> = new Map([["y", { error: "#DIV0", message: "a division by zero" }]]);
    expect(mathDisplayLatex("y=1/z", "value", programOf("y=1/z"), exports)).toBe("y=\\text{#DIV0}");
  });

  it("rounds a long result to something a reader can take in", () => {
    const exports: ReadonlyMap<string, Value> = new Map([["y", 5.048825908847379]]);
    expect(mathDisplayLatex("y=1", "value", programOf("y=1"), exports)).toBe("y=5.04883");
  });

  it("gives the source back for a value form over a source that defines nothing", () => {
    expect(mathDisplayLatex("2+2", "value", programOf("2+2"), new Map())).toBe("2+2");
  });
});

describe("readMathDisplayLatex", () => {
  function built(source: string, display: string): GraphObject {
    const created = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "setMathSource", objectId: "obj_1", source },
        { kind: "setSlot", address: { objectId: "obj_1", path: ["display"] }, slot: { kind: "literal", value: display } },
      ],
      [],
    );
    if (!created.ok) throw new Error(created.message);
    return created.objects[0] as GraphObject;
  }

  it("draws the source under the source setting", () => {
    expect(readMathDisplayLatex(built("y=2+2", "source"))).toBe("y=2+2");
  });

  it("draws the result under the value setting, reading it off the export slot", () => {
    expect(readMathDisplayLatex(built("y=2+2", "value"))).toBe("y=4");
  });

  it("draws both under the both setting", () => {
    expect(readMathDisplayLatex(built("y=2+2", "both"))).toBe("y=2+2=4");
  });

  it("falls back to the source for a setting it does not know", () => {
    expect(readMathDisplayLatex(built("y=2+2", "sideways"))).toBe("y=2+2");
  });
});

describe("a math object in the graph", () => {
  it("evaluates the worked example and hands the value to a table cell", () => {
    const math = emptyMath();
    const sheet = table("obj_2", "table_x", {});

    const create: Operation[] = [
      { kind: "createObject", object: math },
      { kind: "createObject", object: sheet },
      { kind: "setMathSource", objectId: "obj_1", source: "x_{ans}=\\int_{2}^{8}\\sin(x_{input})dx" },
    ];
    const built = mutate([], create, []);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // The cell reads the export, and the port carries the number the integral
    // integrates over.
    const cellFormula = parseFormula("math_1.out.x_ans", built.objects);
    expect("error" in cellFormula).toBe(false);
    if ("error" in cellFormula) return;
    const cellAst = cellFormula;

    const wired = mutate(
      built.objects,
      [
        { kind: "setSlot", address: { objectId: "obj_1", path: mathInPortPath("x_input") }, slot: { kind: "literal", value: 1 } },
        { kind: "setSlot", address: { objectId: "obj_2", path: ["cells", "A1"] }, slot: { kind: "formula", ast: cellAst, value: null } },
      ],
      built.journal,
    );
    expect(wired.ok).toBe(true);
    if (!wired.ok) return;

    // Six units of width times sin(1), which Simpson's rule reaches exactly
    // because the integrand holds still across the range.
    const expected = 6 * Math.sin(1);
    const cell = wired.objects.find((object) => object.id === "obj_2")?.slots["cells.A1"];
    expect(cell?.value).toBeCloseTo(expected, 9);

    // A new number in the port moves the cell, which is the whole point of the
    // object being a graph citizen.
    const moved = mutate(
      wired.objects,
      [{ kind: "setSlot", address: { objectId: "obj_1", path: mathInPortPath("x_input") }, slot: { kind: "literal", value: 2 } }],
      wired.journal,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const movedCell = moved.objects.find((object) => object.id === "obj_2")?.slots["cells.A1"];
    expect(movedCell?.value).toBeCloseTo(6 * Math.sin(2), 9);
  });

  it("refuses a source that does not parse and leaves the old exports in place", () => {
    const built = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "setMathSource", objectId: "obj_1", source: "y=1" },
      ],
      [],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const broken = mutate(built.objects, [{ kind: "setMathSource", objectId: "obj_1", source: "y=(1+" }], built.journal);
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.message).toContain("line 1");

    const survivor = built.objects.find((object) => object.id === "obj_1");
    expect(survivor?.slots["out.y"]).toBeDefined();
  });

  it("refuses two math objects that define each other, and names both slots", () => {
    const first = emptyMath("obj_1", "math_1");
    const second = emptyMath("obj_2", "math_2");

    const built = mutate(
      [],
      [
        { kind: "createObject", object: first },
        { kind: "createObject", object: second },
        { kind: "setMathSource", objectId: "obj_1", source: "a=p+1" },
        { kind: "setMathSource", objectId: "obj_2", source: "b=q+1" },
      ],
      [],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const readsSecond = parseFormula("math_2.out.b", built.objects);
    const readsFirst = parseFormula("math_1.out.a", built.objects);
    if ("error" in readsSecond || "error" in readsFirst) throw new Error("the addresses did not resolve");

    const circular = mutate(
      built.objects,
      [
        { kind: "setSlot", address: { objectId: "obj_1", path: mathInPortPath("p") }, slot: { kind: "formula", ast: readsSecond, value: null } },
        { kind: "setSlot", address: { objectId: "obj_2", path: mathInPortPath("q") }, slot: { kind: "formula", ast: readsFirst, value: null } },
      ],
      built.journal,
    );

    expect(circular.ok).toBe(false);
    if (circular.ok) return;
    expect(circular.message).toContain("cyclic dependency");
    expect(circular.message).toContain("math_1.out.a");
    expect(circular.message).toContain("math_2.out.b");
  });

  it("refuses a math source written onto an object of another type", () => {
    const sheet = table("obj_1", "table_x", {});
    const result = mutate([], [{ kind: "createObject", object: sheet }, { kind: "setMathSource", objectId: "obj_1", source: "y=1" }], []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("holds no equations");
  });

  it("puts an error value on the export whose line fails, and a number on the one that works", () => {
    const built = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "setMathSource", objectId: "obj_1", source: "g=2+2\nw=1/z" },
      ],
      [],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const object = built.objects.find((entry) => entry.id === "obj_1");
    expect(object?.slots["out.g"]?.value).toBe(4);
    expect(object?.slots["out.w"]?.value).toMatchObject({ error: "#MATH", message: expect.stringContaining('"z" has no value here') });
  });

  it("names the empty port on the lines that read it, and leaves the other exports alone", () => {
    const built = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "setMathSource", objectId: "obj_1", source: "g=2+2\nw=1/z\nv=z+1" },
      ],
      [],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const object = built.objects.find((entry) => entry.id === "obj_1");
    expect(object?.slots["in.z"]).toEqual({ kind: "literal", value: null });
    expect(object?.slots["out.g"]?.value).toBe(4);
    expect(object?.slots["out.w"]?.value).toMatchObject({ error: "#MATH", message: expect.stringContaining('"z" has no value here') });
    expect(object?.slots["out.v"]?.value).toMatchObject({ error: "#MATH" });
  });

  it("exports a number from every line once the port carries one", () => {
    const built = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "setMathSource", objectId: "obj_1", source: "w=1/z" },
      ],
      [],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const filled = mutate(
      built.objects,
      [{ kind: "setSlot", address: { objectId: "obj_1", path: mathInPortPath("z") }, slot: { kind: "literal", value: 4 } }],
      [],
    );
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(filled.objects.find((entry) => entry.id === "obj_1")?.slots["out.w"]?.value).toBe(0.25);
  });
});

describe("an address inside math source", () => {
  function sheet(id = "obj_2", name = "table_1"): GraphObject {
    return table(id, name, { "cells.A1": { kind: "literal", value: 7 } });
  }

  it("reads the address as a reference rather than as a product of letters", () => {
    const reading = readMathNames("y=\\gpref{obj_2.cells.A1}+1");
    if (isMathSourceError(reading)) throw new Error(reading.message);
    expect(reading.names.references).toEqual([{ objectId: "obj_2", path: ["cells", "A1"] }]);
    expect(reading.names.inputs).toEqual([]);
  });

  it("names the command in the refusal for a bare dotted address", () => {
    const reading = readMathNames("y=table_1.A1");
    expect(isMathSourceError(reading)).toBe(true);
    if (!isMathSourceError(reading)) return;
    expect(reading.message).toContain("gpref");
  });

  it("evaluates a reference from the value the document carries", () => {
    const built = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "createObject", object: sheet() },
        { kind: "setMathSource", objectId: "obj_1", source: "y=\\gpref{obj_2.cells.A1}*2" },
      ],
      [],
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.objects.find((o) => o.id === "obj_1")?.slots["out.y"]?.value).toBe(14);
  });

  it("follows the cell it reads when that cell changes", () => {
    const built = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "createObject", object: sheet() },
        { kind: "setMathSource", objectId: "obj_1", source: "y=\\gpref{obj_2.cells.A1}*2" },
      ],
      [],
    );
    if (!built.ok) throw new Error(built.message);
    const moved = mutate(
      built.objects,
      [{ kind: "setSlot", address: { objectId: "obj_2", path: ["cells", "A1"] }, slot: { kind: "literal", value: 10 } }],
      built.journal,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.objects.find((o) => o.id === "obj_1")?.slots["out.y"]?.value).toBe(20);
  });

  it("refuses a source naming a slot the document does not carry", () => {
    const result = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "setMathSource", objectId: "obj_1", source: "y=\\gpref{obj_9.cells.A1}" },
      ],
      [],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("obj_9.cells.A1");
  });

  it("refuses to delete an object a math source reads, naming the slot", () => {
    const built = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "createObject", object: sheet() },
        { kind: "setMathSource", objectId: "obj_1", source: "y=\\gpref{obj_2.cells.A1}" },
      ],
      [],
    );
    if (!built.ok) throw new Error(built.message);
    const removed = mutate(built.objects, [{ kind: "deleteObject", objectId: "obj_2" }], built.journal);
    expect(removed.ok).toBe(false);
  });

  it("turns a name into the id the document stores, and back again", () => {
    const objects = [sheet()];
    const typed = "y=\\gpref{table_1.A1}";
    const stored = mathSourceWithIds(typed, objects);
    expect(stored).toBe("y=\\gpref{obj_2.cells.A1}");
    expect(mathSourceWithNames(stored, objects)).toBe(typed);
  });

  it("shows the new name after a rename, with the source untouched", () => {
    const renamed = [sheet("obj_2", "grid")];
    expect(mathSourceWithNames("y=\\gpref{obj_2.cells.A1}", renamed)).toBe("y=\\gpref{grid.A1}");
  });

  it("leaves an address it cannot resolve as it was written", () => {
    expect(mathSourceWithIds("y=\\gpref{nowhere.A1}", [sheet()])).toBe("y=\\gpref{nowhere.A1}");
  });

  it("refuses a plain write to the source slot, which would leave the ports behind", () => {
    const built = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "setMathSource", objectId: "obj_1", source: "y=a+1" },
      ],
      [],
    );
    if (!built.ok) throw new Error(built.message);

    const direct = mutate(
      built.objects,
      [{ kind: "setSlot", address: { objectId: "obj_1", path: ["source"] }, slot: { kind: "literal", value: "z=q+1" } }],
      built.journal,
    );
    expect(direct.ok).toBe(false);
    if (direct.ok) return;
    expect(direct.message).toContain("ports");
    expect(built.objects[0]?.ports).toEqual({ in: ["a"], out: ["y"] });
  });

  it("finds the addresses a source names that the document does not carry", () => {
    expect(unresolvedMathReferences("y=\\gpref{obj_9.radius}", [sheet()])).toEqual(["obj_9.radius"]);
    expect(unresolvedMathReferences("y=\\gpref{obj_2.cells.A1}", [sheet()])).toEqual([]);
  });
});

describe("a math object that solves for an unknown", () => {
  /** A math object with a source on it, built through the mutation path. */
  function built(source: string, extra: readonly Operation[] = []): readonly GraphObject[] {
    const result = mutate(
      [],
      [{ kind: "createObject", object: emptyMath() }, { kind: "setMathSource", objectId: "obj_1", source }, ...extra],
      [],
    );
    if (!result.ok) throw new Error(result.message);
    return result.objects;
  }

  function math(objects: readonly GraphObject[]): GraphObject {
    const object = objects.find((candidate) => candidate.id === "obj_1");
    if (object === undefined) throw new Error("the math object is gone");
    return object;
  }

  it("gives the unknown an export slot and a seed slot", () => {
    const object = math(built("\\solve{x}x^2=9"));
    expect(object.slots[slotKey(mathOutPortPath("x"))]).toMatchObject({ kind: "derived" });
    expect(object.slots[slotKey(mathSeedPath("x"))]).toEqual({ kind: "literal", value: 0 });
    expect(object.ports?.seed).toEqual(["x"]);
  });

  it("gives the unknown no input port, so one name never takes two slots", () => {
    expect(math(built("\\solve{x}x^2=9")).ports?.in).toEqual([]);
  });

  it("evaluates the export to the root nearest the seed", () => {
    expect(math(built("\\solve{x}x^2=9")).slots["out.x"]?.value).toBeCloseTo(3, 9);
  });

  it("moves the answer from one root to the other when the seed moves", () => {
    const objects = built("\\solve{x}x^2=9", [
      { kind: "setSlot", address: { objectId: "obj_1", path: mathSeedPath("x") }, slot: { kind: "literal", value: -2 } },
    ]);
    expect(math(objects).slots["out.x"]?.value).toBeCloseTo(-3, 9);
  });

  it("lets a formula drive the seed, so an operator can sweep a root across a range", () => {
    const objects = built("\\solve{x}x^2=9");
    const seedFormula = parseFormula("0-2", objects);
    if ("error" in seedFormula) throw new Error("the formula did not parse");
    const swept = mutate(
      objects,
      [{ kind: "setSlot", address: { objectId: "obj_1", path: mathSeedPath("x") }, slot: { kind: "formula", ast: seedFormula, value: null } }],
      [],
    );
    expect(swept.ok).toBe(true);
    if (!swept.ok) return;
    expect(math(swept.objects).slots["out.x"]?.value).toBeCloseTo(-3, 9);
  });

  it("exposes the solved value to the rest of the document like any other export", () => {
    const objects = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "createObject", object: table("obj_2", "table_x", {}) },
        { kind: "setMathSource", objectId: "obj_1", source: "\\solve{x}x^2=9" },
      ],
      [],
    );
    expect(objects.ok).toBe(true);
    if (!objects.ok) return;
    const reads = parseFormula("math_1.out.x", objects.objects);
    if ("error" in reads) throw new Error("the address did not resolve");
    const wired = mutate(
      objects.objects,
      [{ kind: "setSlot", address: { objectId: "obj_2", path: ["cells", "A1"] }, slot: { kind: "formula", ast: reads, value: null } }],
      objects.journal,
    );
    expect(wired.ok).toBe(true);
    if (!wired.ok) return;
    expect(wired.objects.find((object) => object.id === "obj_2")?.slots["cells.A1"]?.value).toBeCloseTo(3, 9);
  });

  it("keeps the seed an operator moved when an unrelated line of the source is edited", () => {
    const objects = built("\\solve{x}x^2=9", [
      { kind: "setSlot", address: { objectId: "obj_1", path: mathSeedPath("x") }, slot: { kind: "literal", value: -2 } },
    ]);
    const edited = mutate(objects, [{ kind: "setMathSource", objectId: "obj_1", source: "\\solve{x}x^2=9\nb=1" }], []);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(math(edited.objects).slots[slotKey(mathSeedPath("x"))]).toEqual({ kind: "literal", value: -2 });
    expect(math(edited.objects).slots["out.x"]?.value).toBeCloseTo(-3, 9);
  });

  it("takes the seed slot away with the line that asked for it", () => {
    const objects = built("\\solve{x}x^2=9");
    const edited = mutate(objects, [{ kind: "setMathSource", objectId: "obj_1", source: "y=1" }], []);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(math(edited.objects).slots[slotKey(mathSeedPath("x"))]).toBeUndefined();
    expect(math(edited.objects).ports?.seed).toBeUndefined();
  });

  it("puts an error value on an unknown whose equation has no root the search reaches", () => {
    expect(math(built("\\solve{x}x^2+1=0")).slots["out.x"]?.value).toMatchObject({ error: "#MATH" });
  });

  it("gives a type error where a seed holds something other than a number", () => {
    const objects = built("\\solve{x}x^2=9", [
      { kind: "setSlot", address: { objectId: "obj_1", path: mathSeedPath("x") }, slot: { kind: "literal", value: "near three" } },
    ]);
    expect(math(objects).slots["out.x"]?.value).toMatchObject({ error: "#TYPE" });
  });

  it("solves against a slot of another object, read once before the search starts", () => {
    const objects = mutate(
      [],
      [
        { kind: "createObject", object: emptyMath() },
        { kind: "createObject", object: table("obj_2", "table_x", { "cells.A1": { kind: "literal", value: 49 } }) },
        { kind: "setMathSource", objectId: "obj_1", source: "\\solve{x}x^2=\\gpref{obj_2.cells.A1}" },
      ],
      [],
    );
    expect(objects.ok).toBe(true);
    if (!objects.ok) return;
    expect(objects.objects.find((object) => object.id === "obj_1")?.slots["out.x"]?.value).toBeCloseTo(7, 6);
  });

  it("completes the address of a seed, because a seed is an ordinary slot", () => {
    expect(objectSlotPaths(math(built("\\solve{x}x^2=9")))).toContain("seed.x");
  });

  it("shows the solved value after an arrow in the both form, so it reads as an answer", () => {
    const objects = built("\\solve{x}x^2=9", [
      { kind: "setSlot", address: { objectId: "obj_1", path: ["display"] }, slot: { kind: "literal", value: "both" } },
    ]);
    expect(readMathDisplayLatex(math(objects))).toBe("\\solve{x}x^2=9\\Rightarrow x=3");
  });

  it("shows the solved value beside the other results in the value form", () => {
    const objects = built("a=1\n\\solve{x}x^2=9", [
      { kind: "setSlot", address: { objectId: "obj_1", path: ["display"] }, slot: { kind: "literal", value: "value" } },
    ]);
    expect(readMathDisplayLatex(math(objects))).toBe("a=1\\\\x=3");
  });
});
