/**
 * script.test.ts
 *
 * These tests cover the script node ports, the placeholder a node shows with
 * no runner or no code, and the run that goes through a runner.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import type { GraphObject, Value } from "../graph/node.ts";
import { NULL_EVAL_CONTEXT, type EvalContext, type ScriptAnswer, type ScriptRequest } from "../eval-context.ts";
import { mutate, refreshHostInputs } from "../mutation.ts";
import {
  enumerateScriptInPaths,
  enumerateScriptOutDerivedSlots,
  enumerateScriptPlaceholderPaths,
  evaluateScriptOutput,
  scriptInPortPath,
  scriptOutPortPath,
  scriptPlaceholderPath,
  scriptValue,
  type ScriptNode,
} from "./script.ts";

function scriptObject(ports?: { readonly in: readonly string[]; readonly out: readonly string[] }): GraphObject {
  return ports === undefined ? { id: "obj_1", name: "script_1", type: "script", slots: {} } : { id: "obj_1", name: "script_1", type: "script", slots: {}, ports };
}

describe("scriptInPortPath / scriptOutPortPath / scriptPlaceholderPath", () => {
  it("builds the three port-family paths by name, never by index", () => {
    expect(scriptInPortPath("factor")).toEqual(["in", "factor"]);
    expect(scriptOutPortPath("result")).toEqual(["out", "result"]);
    expect(scriptPlaceholderPath("result")).toEqual(["placeholder", "result"]);
  });
});

describe("enumerateScriptInPaths / enumerateScriptPlaceholderPaths", () => {
  it("returns no paths for a portless object (absent ports, the freshly-created state)", () => {
    expect(enumerateScriptInPaths(scriptObject())).toEqual([]);
    expect(enumerateScriptPlaceholderPaths(scriptObject())).toEqual([]);
  });

  it("returns one path per declared name, in declared order — in.* from ports.in, placeholder.* from ports.out", () => {
    const object = scriptObject({ in: ["factor", "speed"], out: ["result"] });
    expect(enumerateScriptInPaths(object)).toEqual([["in", "factor"], ["in", "speed"]]);
    expect(enumerateScriptPlaceholderPaths(object)).toEqual([["placeholder", "result"]]);
  });

  it("never throws for a portless or a wired object", () => {
    expect(() => enumerateScriptInPaths(scriptObject())).not.toThrow();
    expect(() => enumerateScriptPlaceholderPaths(scriptObject({ in: [], out: ["a"] }))).not.toThrow();
  });
});

describe("evaluateScriptOutput — the one function seam", () => {
  const node = (placeholders: Readonly<Record<string, Value>>): ScriptNode => ({
    language: "python",
    source: "print('unused')",
    in: {},
    out: {},
    placeholders,
  });

  it("returns the named port's placeholder value", () => {
    expect(evaluateScriptOutput(node({ result: 42 }), "result", {})).toBe(42);
  });

  it("returns null when the named port has no placeholder entry — the stub's own `?? null`", () => {
    expect(evaluateScriptOutput(node({}), "result", {})).toBeNull();
  });

  it("ignores `source` and `inputs` entirely — the stub never executes and never reads its inputs", () => {
    expect(evaluateScriptOutput(node({ result: "unaffected" }), "result", { anything: 999 })).toBe("unaffected");
  });
});

describe("enumerateScriptOutDerivedSlots", () => {
  it("returns no derived slots for a portless object", () => {
    expect(enumerateScriptOutDerivedSlots(scriptObject())).toEqual([]);
  });

  it("returns one DerivedSlotSchema per declared out port, in declared order, each with dynamic dependencies", () => {
    const object = scriptObject({ in: [], out: ["result", "extra"] });
    const slots = enumerateScriptOutDerivedSlots(object);
    expect(slots.map((slot) => slot.path)).toEqual([["out", "result"], ["out", "extra"]]);
    expect(slots.every((slot) => slot.dependencies.kind === "dynamic")).toBe(true);
  });

  it("resolves dependencies as every current in.* address PLUS the port's OWN placeholder address — never another port's", () => {
    const object = scriptObject({ in: ["factor", "speed"], out: ["result", "extra"] });
    const slots = enumerateScriptOutDerivedSlots(object);
    const resultDeps = slots[0]?.dependencies;
    if (resultDeps === undefined || resultDeps.kind !== "dynamic") {
      throw new Error("test setup: expected out.result's dependencies to be dynamic");
    }
    expect(resultDeps.resolve(object, [])).toEqual([
      { objectId: "obj_1", path: ["in", "factor"] },
      { objectId: "obj_1", path: ["in", "speed"] },
      { objectId: "obj_1", path: ["placeholder", "result"] },
    ]);
    const extraDeps = slots[1]?.dependencies;
    if (extraDeps === undefined || extraDeps.kind !== "dynamic") {
      throw new Error("test setup: expected out.extra's dependencies to be dynamic");
    }
    expect(extraDeps.resolve(object, [])).toEqual([
      { objectId: "obj_1", path: ["in", "factor"] },
      { objectId: "obj_1", path: ["in", "speed"] },
      { objectId: "obj_1", path: ["placeholder", "extra"] },
    ]);
  });
});

describe("out.<port>'s compute function", () => {
  function computeFor(object: GraphObject, portName: string) {
    const compute = enumerateScriptOutDerivedSlots(object).find((slot) => slot.path.join(".") === `out.${portName}`)?.compute;
    if (compute === undefined) {
      throw new Error(`test setup: expected out.${portName}'s compute to exist`);
    }
    return compute;
  }

  function readFrom(values: Record<string, Value>) {
    return (address: Address): Value | undefined => values[address.path.join(".")];
  }

  it("returns the placeholder value when every input and the placeholder resolve", () => {
    const object = scriptObject({ in: ["factor"], out: ["result"] });
    const result = computeFor(object, "result")(object, readFrom({ "in.factor": 10, "placeholder.result": 99 }));
    expect(result).toBe(99);
  });

  it("with no in ports declared, reads only the placeholder", () => {
    const object = scriptObject({ in: [], out: ["result"] });
    const result = computeFor(object, "result")(object, readFrom({ "placeholder.result": 7 }));
    expect(result).toBe(7);
  });

  it("propagates an ErrorValue from an in.* input unchanged, in PORT-DECLARATION ORDER, because an error propagates", () => {
    const object = scriptObject({ in: ["factor", "speed"], out: ["result"] });
    const upstreamError = { error: "#DIV0", message: "upstream division by zero" } as const;
    const result = computeFor(object, "result")(object, readFrom({ "in.factor": upstreamError, "in.speed": 1, "placeholder.result": 5 }));
    expect(result).toEqual(upstreamError);
  });

  it("checks the SECOND in.* port only once the first resolves cleanly", () => {
    const object = scriptObject({ in: ["factor", "speed"], out: ["result"] });
    const upstreamError = { error: "#PARSE", message: "upstream parse error" } as const;
    const result = computeFor(object, "result")(object, readFrom({ "in.factor": 1, "in.speed": upstreamError, "placeholder.result": 5 }));
    expect(result).toEqual(upstreamError);
  });

  it("returns #REF, never throws, when an in.* address did not resolve at all", () => {
    const object = scriptObject({ in: ["factor"], out: ["result"] });
    const result = computeFor(object, "result")(object, readFrom({ "placeholder.result": 5 }));
    expect(result).toMatchObject({ error: "#REF" });
  });

  it("propagates an ErrorValue from the placeholder unchanged", () => {
    const object = scriptObject({ in: [], out: ["result"] });
    const upstreamError = { error: "#TYPE", message: "bad placeholder" } as const;
    const result = computeFor(object, "result")(object, readFrom({ "placeholder.result": upstreamError }));
    expect(result).toEqual(upstreamError);
  });

  it("returns #REF, never throws, when the placeholder did not resolve at all", () => {
    const object = scriptObject({ in: [], out: ["result"] });
    const result = computeFor(object, "result")(object, readFrom({}));
    expect(result).toMatchObject({ error: "#REF" });
  });

  it("never throws for any of the above inputs", () => {
    const object = scriptObject({ in: ["factor"], out: ["result"] });
    expect(() => computeFor(object, "result")(object, readFrom({}))).not.toThrow();
  });
});

describe("scripts through a runner", () => {
  const answering = (answer: (request: ScriptRequest) => ScriptAnswer): EvalContext & { requests: ScriptRequest[] } => {
    const requests: ScriptRequest[] = [];
    return { measurer: NULL_EVAL_CONTEXT.measurer, scripts: { run: (request) => { requests.push(request); return answer(request); } }, requests };
  };
  const node = (source: string, placeholders: Readonly<Record<string, Value>> = {}): ScriptNode =>
    ({ language: "python", source, in: {}, out: {}, placeholders });

  it("gives the entry of the port's name from a finished run, and the placeholder with no runner or no code", () => {
    const context = answering(() => ({ status: "done", outputs: { result: 6, other: "x" } }));
    expect(evaluateScriptOutput(node("return {}"), "result", { a: 3 }, context.scripts)).toBe(6);
    expect(context.requests).toEqual([{ source: "return {}", inputs: { a: 3 } }]);
    expect(evaluateScriptOutput(node("return {}", { result: 1 }), "result", {})).toBe(1);
    expect(evaluateScriptOutput(node("  \n", { result: 2 }), "result", {}, context.scripts)).toBe(2);
  });

  it("shows a run under way as pending, a failure as #SCRIPT, and a missing entry by the names that did come back", () => {
    expect(evaluateScriptOutput(node("x"), "result", {}, answering(() => ({ status: "pending" })).scripts))
      .toEqual({ error: "#PENDING", message: "the script is running" });
    expect(evaluateScriptOutput(node("x"), "result", {}, answering(() => ({ status: "failed", message: "NameError: y" })).scripts))
      .toEqual({ error: "#SCRIPT", message: "NameError: y" });
    expect(evaluateScriptOutput(node("x"), "result", {}, answering(() => ({ status: "done", outputs: { total: 1 } })).scripts))
      .toEqual({ error: "#SCRIPT", message: 'the script returned no "result", only "total"' });
  });

  it("turns what a script returned into a value a slot holds, and refuses every other shape", () => {
    expect(scriptValue(2.5)).toBe(2.5);
    expect(scriptValue("text")).toBe("text");
    expect(scriptValue(true)).toBe(true);
    expect(scriptValue(undefined)).toBeNull();
    expect(scriptValue({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(scriptValue([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0, [1, 2], { x: 1, y: 2, z: 3 }, { a: 1 }, [{ x: Number.NaN, y: 0 }]]) {
      expect(scriptValue(bad)).toMatchObject({ error: "#SCRIPT" });
    }
  });

  it("runs again when the source or an input changes, and picks up a late answer when the host refreshes", () => {
    let answers: Record<string, ScriptAnswer> = {};
    const context = answering((request) => answers[`${request.source}|${JSON.stringify(request.inputs)}`] ?? { status: "pending" });
    const created = mutate([], [
      { kind: "createObject", object: { id: "v", name: "speed", type: "value", slots: { value: { kind: "literal", value: 3 } } } },
      { kind: "createObject", object: { id: "s", name: "script_1", type: "script", slots: {
        "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 },
        language: { kind: "literal", value: "python" }, source: { kind: "literal", value: "" },
      } } },
      { kind: "addPort", objectId: "s", family: "in", name: "speed" },
      { kind: "setSlot", address: { objectId: "s", path: ["in", "speed"] }, slot: { kind: "formula", ast: { type: "reference", address: { objectId: "v", path: ["value"] } }, value: null } },
      { kind: "addPort", objectId: "s", family: "out", name: "double" },
      { kind: "setSlot", address: { objectId: "s", path: ["placeholder", "double"] }, slot: { kind: "literal", value: 0 } },
      { kind: "setSlot", address: { objectId: "s", path: ["out", "double"] }, slot: { kind: "derived", value: null } },
    ], [], context);
    if (!created.ok) throw new Error(created.message);
    const out = (objects: readonly GraphObject[]) => objects.find((object) => object.id === "s")?.slots["out.double"]?.value;
    expect(out(created.objects)).toBe(0);

    const coded = mutate(created.objects, [{ kind: "setSlot", address: { objectId: "s", path: ["source"] }, slot: { kind: "literal", value: "return {'double': speed * 2}" } }], created.journal, context);
    if (!coded.ok) throw new Error(coded.message);
    expect(out(coded.objects)).toMatchObject({ error: "#PENDING" });

    answers = { "return {'double': speed * 2}|{\"speed\":3}": { status: "done", outputs: { double: 6 } } };
    const refreshed = refreshHostInputs(coded.objects, context);
    expect(refreshed.ok && out(refreshed.objects)).toBe(6);

    const faster = mutate(coded.objects, [{ kind: "setSlot", address: { objectId: "v", path: ["value"] }, slot: { kind: "literal", value: 5 } }], coded.journal, context);
    if (!faster.ok) throw new Error(faster.message);
    expect(out(faster.objects)).toMatchObject({ error: "#PENDING" });
    expect(context.requests.at(-1)).toEqual({ source: "return {'double': speed * 2}", inputs: { speed: 5 } });
  });
});
