/**
 * stub.ts
 *
 * The script node: a real participant in the graph with a placeholder body. It
 * exists so that the surrounding machinery is built and tested before any
 * scripting language arrives.
 *
 * Its ports are ordinary slots, so the rest of the engine treats it like any
 * other object. An in.<port> slot is a formula slot, so it
 * binds to some upstream address. An out.<port> slot is a derived slot whose
 * schema names every in.* slot on the node. The source slot is a literal that
 * nothing reads, so editing the script text triggers no recompute.
 *
 * Adding a port is two operations that have to land in one batch: the name and
 * the value. The moment an out.* port exists, the integrity check demands that
 * every address it declares resolves to a real slot, so an addPort on its own
 * fails.
 *
 * evaluateScriptOutput returns the placeholder. When a real language arrives,
 * that one function body is what changes.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import type { Address } from "../address.ts";
import { isErrorValue, type GraphObject, type Value } from "../graph/node.ts";
import type { DerivedSlotCompute, DerivedSlotDependencies, DerivedSlotSchema } from "../primitives/schema.ts";

export interface ScriptNode {
  readonly language: "python";
  readonly source: string;
  readonly in: Readonly<Record<string, Value>>;
  readonly out: Readonly<Record<string, Value>>;
  readonly placeholders: Readonly<Record<string, Value>>;
}

/**
 * The fake body of a script node. It returns the placeholder for the port.
 * When Python arrives, only this function changes.
 */
export function evaluateScriptOutput(node: ScriptNode, portName: string, inputs: Readonly<Record<string, Value>>): Value {
  void inputs;
  return node.placeholders[portName] ?? null;
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
      { objectId: object.id, path: scriptPlaceholderPath(portName) },
    ],
  };
}

function makeScriptOutputCompute(portName: string): DerivedSlotCompute {
  return (object, read) => {
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

    const node: ScriptNode = {
      language: "python",
      source: "",
      in: inputs,
      out: {},
      placeholders: { [portName]: placeholderValue },
    };
    return evaluateScriptOutput(node, portName, inputs);
  };
}

export function enumerateScriptOutDerivedSlots(object: GraphObject): readonly DerivedSlotSchema[] {
  return (object.ports?.out ?? []).map((name) => ({
    path: scriptOutPortPath(name),
    dependencies: scriptOutDependencies(name),
    compute: makeScriptOutputCompute(name),
  }));
}
