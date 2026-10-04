/**
 * script.ts
 *
 * The script node: a box of Python with input ports and output ports, which
 * the rest of the engine treats like any other object, because its ports are
 * ordinary slots. An in.<port> slot is a formula slot, so it binds to some
 * upstream address. An out.<port> slot is a derived slot whose schema names
 * every in.* slot on the node, the source, and the port's placeholder.
 *
 * Adding a port is two operations that have to land in one batch: the name and
 * the value. The moment an out.* port exists, the integrity check demands that
 * every address it declares resolves to a real slot, so an addPort on its own
 * fails.
 *
 * evaluateScriptOutput is the one place a script runs. The engine cannot run
 * Python, and running it takes time the engine never waits for, so the run
 * goes through the ScriptRunner the evaluation context carries. The runner
 * answers at once from what the host already knows: a finished result, a
 * failure, or "pending" for a run still under way, which the output shows as an
 * error with the pending code until the host evaluates again with the answer in hand. That
 * is why each output declares that it reads the context: a host that gets an
 * answer refreshes the slots that read the context, and the outputs are among
 * them. A context with no runner, such as a headless test, and a node with no
 * code yet, both give the placeholder, so a node is usable before any code is
 * written and before any runtime exists.
 *
 * A script returns a dict, and each output port takes the entry of its name.
 * scriptValue turns whatever came back into a value the graph can hold, and
 * refuses anything else with #SCRIPT rather than guessing a conversion.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import type { Address } from "../address.ts";
import type { ScriptRunner } from "../eval-context.ts";
import { hasIllegalNumber, isErrorValue, type GraphObject, type Value } from "../graph/node.ts";
import type { DerivedSlotCompute, DerivedSlotDependencies, DerivedSlotSchema } from "../primitives/schema.ts";

export interface ScriptNode {
  readonly language: "python";
  readonly source: string;
  readonly in: Readonly<Record<string, Value>>;
  readonly out: Readonly<Record<string, Value>>;
  readonly placeholders: Readonly<Record<string, Value>>;
}

/**
 * The value of one output port. It runs the script through the runner, and
 * gives the placeholder when there is no runner or no code.
 */
export function evaluateScriptOutput(
  node: ScriptNode,
  portName: string,
  inputs: Readonly<Record<string, Value>>,
  runner?: ScriptRunner,
): Value {
  if (runner === undefined || node.source.trim() === "") {
    return node.placeholders[portName] ?? null;
  }
  const answer = runner.run({ source: node.source, inputs });
  if (answer.status === "pending") {
    return { error: "#PENDING", message: "the script is running" };
  }
  if (answer.status === "failed") {
    return { error: "#SCRIPT", message: answer.message };
  }
  if (!Object.hasOwn(answer.outputs, portName)) {
    const returned = Object.keys(answer.outputs);
    return {
      error: "#SCRIPT",
      message: `the script returned no "${portName}"${returned.length === 0 ? "" : `, only ${returned.map((key) => `"${key}"`).join(", ")}`}`,
    };
  }
  return scriptValue(answer.outputs[portName]);
}

function isPointLike(raw: unknown): raw is { readonly x: number; readonly y: number } {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    && Object.keys(raw).length === 2 && typeof (raw as { x?: unknown }).x === "number" && typeof (raw as { y?: unknown }).y === "number";
}

/**
 * A value a script returned, as a graph value. A number, a string, a boolean
 * and None carry over. A dict holding exactly x and y becomes a point, and a
 * list of those becomes a list of points, because those are the shapes a
 * geometry slot reads. A number that is not finite, or negative zero, is not
 * legal document state, so it comes back as #SCRIPT like any other shape the
 * graph cannot hold.
 */
export function scriptValue(raw: unknown): Value {
  const refuse = (what: string): Value => ({ error: "#SCRIPT", message: `the script returned ${what}, which a slot cannot hold` });
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return hasIllegalNumber(raw) ? refuse(Object.is(raw, -0) ? "-0" : String(raw)) : raw;
  if (typeof raw === "string" || typeof raw === "boolean") return raw;
  if (isPointLike(raw)) return hasIllegalNumber(raw) ? refuse("a point that is not finite") : { x: raw.x, y: raw.y };
  if (Array.isArray(raw)) {
    if (raw.every(isPointLike) && !hasIllegalNumber(raw)) return raw.map((point) => ({ x: point.x, y: point.y }));
    return refuse("a list that is not a list of points");
  }
  return refuse(`a ${typeof raw === "object" ? "dict or object" : typeof raw}`);
}

export const SCRIPT_LANGUAGE_PATH: readonly string[] = ["language"];

export const SCRIPT_SOURCE_PATH: readonly string[] = ["source"];

export function scriptInPortPath(name: string): readonly string[] {
  return ["in", name];
}

export function scriptOutPortPath(name: string): readonly string[] {
  return ["out", name];
}

export function scriptPlaceholderPath(name: string): readonly string[] {
  return ["placeholder", name];
}

export function enumerateScriptInPaths(object: GraphObject): readonly (readonly string[])[] {
  return (object.ports?.in ?? []).map(scriptInPortPath);
}

export function enumerateScriptPlaceholderPaths(object: GraphObject): readonly (readonly string[])[] {
  return (object.ports?.out ?? []).map(scriptPlaceholderPath);
}

function scriptOutDependencies(portName: string): DerivedSlotDependencies {
  return {
    kind: "dynamic",
    resolve: (object) => [
      ...(object.ports?.in ?? []).map((name): Address => ({ objectId: object.id, path: scriptInPortPath(name) })),
      // A node written before scripts ran can carry ports with no source slot,
      // and an edge into a slot that is not there would refuse the document.
      ...(object.slots[SCRIPT_SOURCE_PATH[0]!] === undefined ? [] : [{ objectId: object.id, path: SCRIPT_SOURCE_PATH }]),
      { objectId: object.id, path: scriptPlaceholderPath(portName) },
    ],
  };
}

function makeScriptOutputCompute(portName: string): DerivedSlotCompute {
  return (object, read, context) => {
    const inputs: Record<string, Value> = {};
    for (const name of object.ports?.in ?? []) {
      const value = read({ objectId: object.id, path: scriptInPortPath(name) });
      if (value === undefined) {
        return { error: "#REF", message: `script: in.${name} did not resolve to a value` };
      }
      if (isErrorValue(value)) {
        return value;
      }
      inputs[name] = value;
    }

    const placeholderValue = read({ objectId: object.id, path: scriptPlaceholderPath(portName) });
    if (placeholderValue === undefined) {
      return { error: "#REF", message: `script: out.${portName}'s placeholder value did not resolve` };
    }
    if (isErrorValue(placeholderValue)) {
      return placeholderValue;
    }

    const source = read({ objectId: object.id, path: SCRIPT_SOURCE_PATH });
    const node: ScriptNode = {
      language: "python",
      source: typeof source === "string" ? source : "",
      in: inputs,
      out: {},
      placeholders: { [portName]: placeholderValue },
    };
    return evaluateScriptOutput(node, portName, inputs, context?.scripts);
  };
}

export function enumerateScriptOutDerivedSlots(object: GraphObject): readonly DerivedSlotSchema[] {
  return (object.ports?.out ?? []).map((name) => ({
    path: scriptOutPortPath(name),
    usesContext: true,
    dependencies: scriptOutDependencies(name),
    compute: makeScriptOutputCompute(name),
  }));
}
