/**
 * math.ts
 *
 * Joins the math language to the graph. It declares the slots a math object
 * carries, the addresses each export reads, and the compute function behind
 * every export.
 *
 * A math object holds its equations in one literal slot named source. The
 * names that source defines become derived slots under out, and the free names
 * it reads become slots under in. Both lists are held in the ports of the
 * object rather than worked out here, because ports change only through a
 * mutation. Evaluation therefore leaves the slot set alone: this file reads
 * ports to say which slots exist, and reads source only to say what they hold.
 *
 * Every export parses the whole source and evaluates the whole program, so a
 * source with four exports parses four times per pass. The simplest correct
 * arrangement is worth more here than the saving, and a cache would have to be
 * invalidated from the one place that writes source.
 *
 * An input port carries a number, because the math language computes over
 * numbers alone. A port holding anything else gives a type error on every
 * export that reads it rather than on the port, since a port is a literal slot
 * and a literal holds whatever an operator typed.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import type { Address } from "../address.ts";
import { isErrorValue, slotKey, type GraphObject, type Slot, type Value } from "../graph/node.ts";
import { evaluateMathObject } from "../math/eval.ts";
import { isMathNameError, resolveMathNames, type MathNames } from "../math/names.ts";
import { isMathParseError, parseMath } from "../math/parser.ts";
import type { DerivedSlotCompute, DerivedSlotDependencies, DerivedSlotSchema } from "./schema.ts";

export const MATH_SOURCE_PATH: readonly string[] = ["source"];

export function mathInPortPath(name: string): readonly string[] {
  return ["in", name];
}

export function mathOutPortPath(name: string): readonly string[] {
  return ["out", name];
}

export function enumerateMathInPaths(object: GraphObject): readonly (readonly string[])[] {
  return (object.ports?.in ?? []).map(mathInPortPath);
}

/**
 * The source text of an object, or an empty string where the slot is missing
 * or holds something other than a string. An empty source parses to a program
 * with no lines, which exports nothing and reads nothing.
 */
export function readMathSource(object: GraphObject): string {
  const slot = object.slots[slotKey(MATH_SOURCE_PATH)];
  if (slot === undefined || typeof slot.value !== "string") {
    return "";
  }
  return slot.value;
}

export interface MathSourceReading {
  readonly names: MathNames;
  readonly source: string;
}

/**
 * Why a source could not be read. The lexer, the parser and the name binder
 * all report the same shape, because a caller acts on all three the same way:
 * it refuses the mutation and shows the line.
 */
export interface MathSourceError {
  readonly error: "#PARSE";
  readonly message: string;
  /** The line of the source the failure happened on, counted from zero. */
  readonly line: number;
}

export function isMathSourceError(result: MathSourceReading | MathSourceError): result is MathSourceError {
  return "error" in result;
}

/**
 * Reads a source text and reports the names it implies, or the failure that
 * stopped it. The mutation that writes source calls this to work out the slot
 * set, and a caller that wants to check a source before writing it calls the
 * same function, so the two can never disagree.
 */
export function readMathNames(source: string): MathSourceReading | MathSourceError {
  const program = parseMath(source);
  if (isMathParseError(program)) {
    return program;
  }
  const names = resolveMathNames(program);
  if (isMathNameError(names)) {
    return names;
  }
  return { names, source };
}

function mathOutDependencies(): DerivedSlotDependencies {
  return {
    kind: "dynamic",
    resolve: (object) => [
      { objectId: object.id, path: MATH_SOURCE_PATH },
      ...(object.ports?.in ?? []).map((name): Address => ({ objectId: object.id, path: mathInPortPath(name) })),
    ],
  };
}

function makeMathOutputCompute(exportName: string): DerivedSlotCompute {
  return (object, read) => {
    const source = read({ objectId: object.id, path: MATH_SOURCE_PATH });
    if (source === undefined) {
      return { error: "#REF", message: `math: source did not resolve to a value` };
    }
    if (isErrorValue(source)) {
      return source;
    }
    if (typeof source !== "string") {
      return { error: "#TYPE", message: "math: source holds something other than text" };
    }

    const program = parseMath(source);
    if (isMathParseError(program)) {
      return { error: "#MATH", message: `math: line ${program.line + 1} does not parse, and ${program.message}` };
    }

    const inputs: Record<string, number> = {};
    for (const name of object.ports?.in ?? []) {
      const value = read({ objectId: object.id, path: mathInPortPath(name) });
      if (value === undefined) {
        return { error: "#REF", message: `math: in.${name} did not resolve to a value` };
      }
      if (isErrorValue(value)) {
        return value;
      }
      if (typeof value !== "number") {
        return { error: "#TYPE", message: `math: in.${name} holds something other than a number` };
      }
      inputs[name] = value;
    }

    const evaluation = evaluateMathObject(program, inputs);
    const result = evaluation.exports[exportName];
    if (result === undefined) {
      return { error: "#MATH", message: `math: the source no longer defines "${exportName}"` };
    }
    return result;
  };
}

export function enumerateMathOutDerivedSlots(object: GraphObject): readonly DerivedSlotSchema[] {
  return (object.ports?.out ?? []).map((name) => ({
    path: mathOutPortPath(name),
    dependencies: mathOutDependencies(),
    compute: makeMathOutputCompute(name),
  }));
}

/** The value an input port takes when the source first names it. */
export const MATH_DEFAULT_INPUT: Value = 0;

/**
 * Rebuilds an object around a new source text: the source slot itself, one
 * input slot for each free name, and one export slot for each defined name.
 *
 * A port that survives the edit keeps the slot it had, so an operator who
 * linked in.speed to a table cell and then edits an unrelated line does not
 * lose that link. A port the new source stops reading loses its slot, and an
 * export it stops defining loses its slot as well. An outside formula that
 * read that export then fails the integrity check, rather than reading a value
 * that nothing computes.
 *
 * The caller checks the source first. A source that does not parse never
 * arrives here, because a half parsed source would take every export away
 * from whatever reads them.
 */
export function applyMathSource(object: GraphObject, source: string, names: MathNames): GraphObject {
  const slots: Record<string, Slot> = {};

  for (const [key, slot] of Object.entries(object.slots)) {
    if (slot === undefined) {
      continue;
    }
    const isPortSlot = key.startsWith("in.") || key.startsWith("out.");
    if (!isPortSlot && key !== slotKey(MATH_SOURCE_PATH)) {
      slots[key] = slot;
    }
  }

  slots[slotKey(MATH_SOURCE_PATH)] = { kind: "literal", value: source };

  for (const name of names.inputs) {
    const key = slotKey(mathInPortPath(name));
    const existing = object.slots[key];
    slots[key] = existing ?? { kind: "literal", value: MATH_DEFAULT_INPUT };
  }

  for (const name of names.exports) {
    const key = slotKey(mathOutPortPath(name));
    const existing = object.slots[key];
    slots[key] = existing?.kind === "derived" ? existing : { kind: "derived", value: null };
  }

  return { ...object, ports: { in: [...names.inputs], out: [...names.exports] }, slots };
}
