import { describe, expect, it } from "vitest";
import { mutate, type Operation } from "../mutation.ts";
import { parseFormula } from "../formula/parser.ts";
import { slotKey, type GraphObject } from "../graph/node.ts";
import { applyMathSource, createMathObject, isMathSourceError, readMathNames, MATH_SOURCE_PATH, mathInPortPath, mathOutPortPath } from "./math.ts";

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
    expect(object.slots[slotKey(mathInPortPath("a"))]).toEqual({ kind: "literal", value: 0 });
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
    expect(object?.slots["out.w"]?.value).toMatchObject({ error: "#DIV0" });
  });
});
