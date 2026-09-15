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
import { formatAddress, isAddressError, parseAddress, type Address } from "../address.ts";
import { hasMathMeasurer, type EvalContext } from "../eval-context.ts";
import { isErrorValue, MATH_TYPE, slotKey, type GraphObject, type Slot, type Value } from "../graph/node.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH } from "./geometry.ts";
import type { MathProgram } from "../math/ast.ts";
import { evaluateMathObject, mathAddressKey } from "../math/eval.ts";
import { isMathNameError, resolveMathNames, type MathNames } from "../math/names.ts";
import { MATH_REFERENCE_COMMAND } from "../math/lexer.ts";
import { isMathParseError, parseMath } from "../math/parser.ts";
import type { DerivedSlotCompute, DerivedSlotDependencies, DerivedSlotSchema } from "./schema.ts";

export const MATH_SOURCE_PATH: readonly string[] = ["source"];

export const MATH_DISPLAY_PATH: readonly string[] = ["display"];

/** What a math object shows when nobody is editing it. */
export type MathDisplay = "source" | "value" | "both";

export const MATH_DISPLAY_VALUES: readonly MathDisplay[] = ["source", "value", "both"];

export const MATH_DEFAULT_DISPLAY: MathDisplay = "source";

export const MATH_MEASURED_WIDTH_PATH: readonly string[] = ["measuredWidth"];

export const MATH_MEASURED_HEIGHT_PATH: readonly string[] = ["measuredHeight"];

/**
 * The size notation is drawn at. It is a constant rather than a slot, because
 * nothing yet reads a font size off a math object and a slot an operator can
 * write is a row in the panel and a field in every saved document. A style
 * slot arrives when something asks for one.
 */
export const MATH_FONT_SIZE = 18;

/** The space between the notation and the edge of the box around it. */
export const MATH_BOX_PADDING = 8;

/** The size of the box drawn for a source that measures to nothing. */
export const MATH_EMPTY_BOX = { width: 120, height: 40 } as const;

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

/**
 * A name as LaTeX writes it, so an export called x_ans reads as x with ans
 * under it rather than as four letters and a low line.
 */
function nameAsLatex(name: string): string {
  const [head, ...rest] = name.split("_");
  if (head === undefined) {
    return name;
  }
  const base = head.length === 1 ? head : `\\operatorname{${head}}`;
  return rest.length === 0 ? base : `${base}_{${rest.join("_")}}`;
}

/**
 * A number as LaTeX writes it, short enough to read at a glance. A value that
 * is not a number, which is what an error is, reads as the code it carries, so
 * a failed line says so where its result would be.
 */
function valueAsLatex(value: Value | undefined): string {
  if (value === undefined) {
    return "?";
  }
  if (isErrorValue(value)) {
    return `\\text{${value.error}}`;
  }
  if (typeof value !== "number") {
    return "\\text{?}";
  }
  const rounded = Number(value.toPrecision(MATH_VALUE_DIGITS));
  return String(rounded);
}

/** How many significant digits a displayed result carries. */
export const MATH_VALUE_DIGITS = 6;

/**
 * The LaTeX a math object draws, for the display setting it carries.
 *
 * One function serves the measurement in the engine and the drawing in the
 * render layer. Two of them would drift, and a box measured from one string
 * with another string drawn into it is a box of the wrong size.
 *
 * The value form shows one line for each name the source defines. The both
 * form appends the result to the line that produced it, which reads the way an
 * equation does: the working, then an equals sign, then the answer.
 */
export function mathDisplayLatex(
  source: string,
  display: MathDisplay,
  program: MathProgram | undefined,
  exports: ReadonlyMap<string, Value>,
): string {
  if (display === "source" || program === undefined) {
    return source;
  }

  const sourceLines = source.split("\n");
  const definitions = program.lines.filter((line) => line.type === "definition");

  if (display === "value") {
    if (definitions.length === 0) {
      return source;
    }
    return definitions
      .map((line) => `${nameAsLatex(line.name)}=${valueAsLatex(exports.get(line.name))}`)
      .join("\\\\");
  }

  const resultByLine = new Map<number, string>();
  for (const line of definitions) {
    resultByLine.set(line.sourceLine, valueAsLatex(exports.get(line.name)));
  }
  return sourceLines
    .map((text, index) => {
      const result = resultByLine.get(index);
      return result === undefined ? text : `${text}=${result}`;
    })
    .filter((text) => text.trim() !== "")
    .join("\\\\");
}

/**
 * The LaTeX an object draws right now, read off its own slots. The renderer
 * calls this, and the measured slots call mathDisplayLatex with the values
 * evaluation has in hand.
 */
export function readMathDisplayLatex(object: GraphObject): string {
  const source = readMathSource(object);
  const displaySlot = object.slots[slotKey(MATH_DISPLAY_PATH)]?.value;
  const display = MATH_DISPLAY_VALUES.find((entry) => entry === displaySlot) ?? MATH_DEFAULT_DISPLAY;
  if (display === "source") {
    return source;
  }
  const program = parseMath(source);
  if (isMathParseError(program)) {
    return source;
  }
  const exports = new Map<string, Value>();
  for (const name of object.ports?.out ?? []) {
    const slot = object.slots[slotKey(mathOutPortPath(name))];
    if (slot !== undefined) {
      exports.set(name, slot.value);
    }
  }
  return mathDisplayLatex(source, display, program, exports);
}

/**
 * The width and the height of the notation, including the padding around it.
 * Both read the source alone, because the notation is drawn from the source
 * and from nothing an input port carries.
 *
 * An empty source measures to a box an operator can still see and click,
 * rather than to nothing, so a math object created before anything is typed
 * into it has a place on the canvas.
 */
function makeMathMeasureCompute(axis: "width" | "height"): DerivedSlotCompute {
  return (object, read, context) => {
    const source = read({ objectId: object.id, path: MATH_SOURCE_PATH });
    if (source === undefined) {
      return { error: "#REF", message: "math: source did not resolve to a value" };
    }
    if (isErrorValue(source)) {
      return source;
    }
    if (typeof source !== "string") {
      return { error: "#TYPE", message: "math: source holds something other than text" };
    }
    if (source.trim() === "") {
      return MATH_EMPTY_BOX[axis];
    }

    const displayValue = read({ objectId: object.id, path: MATH_DISPLAY_PATH });
    const display = MATH_DISPLAY_VALUES.find((entry) => entry === displayValue) ?? MATH_DEFAULT_DISPLAY;

    let latex = source;
    if (display !== "source") {
      const program = parseMath(source);
      if (!isMathParseError(program)) {
        const exports = new Map<string, Value>();
        for (const name of object.ports?.out ?? []) {
          const value = read({ objectId: object.id, path: mathOutPortPath(name) });
          if (value !== undefined) {
            exports.set(name, value);
          }
        }
        latex = mathDisplayLatex(source, display, program, exports);
      }
    }
    if (!hasMathMeasurer(context)) {
      return {
        error: "#MEASURE",
        message: `math: ${object.name} has no measurer that can size notation wired, so it cannot be measured`,
      };
    }
    const measurer = (context as EvalContext).measurer;
    const measured = measurer.measureMath?.(latex, { fontSize: MATH_FONT_SIZE });
    if (measured === undefined) {
      return { error: "#MEASURE", message: `math: ${object.name} could not be measured` };
    }
    const value = axis === "width" ? measured.width : measured.height;
    if (!Number.isFinite(value)) {
      return { error: "#MEASURE", message: `math: ${object.name} measured to a size that is not a finite number` };
    }
    return value + MATH_BOX_PADDING * 2;
  };
}

/**
 * What a measurement reads. It is the source, the display setting, and every
 * export, because the value forms draw those results and a box has to be the
 * size of what goes in it.
 */
function mathMeasureDependencies(): DerivedSlotDependencies {
  return {
    kind: "dynamic",
    resolve: (object) => [
      { objectId: object.id, path: MATH_SOURCE_PATH },
      { objectId: object.id, path: MATH_DISPLAY_PATH },
      ...(object.ports?.out ?? []).map((name): Address => ({ objectId: object.id, path: mathOutPortPath(name) })),
    ],
  };
}

export const MATH_MEASURED_SLOTS: readonly DerivedSlotSchema[] = [
  {
    path: MATH_MEASURED_WIDTH_PATH,
    dependencies: mathMeasureDependencies(),
    compute: makeMathMeasureCompute("width"),
  },
  {
    path: MATH_MEASURED_HEIGHT_PATH,
    dependencies: mathMeasureDependencies(),
    compute: makeMathMeasureCompute("height"),
  },
];

/**
 * The addresses a source reads out of the document, which the schema declares
 * so the graph carries an edge into every one of them. Reading them means
 * parsing the source, which happens at edge derivation time and never during
 * evaluation, so the slot set stays fixed for a whole pass.
 *
 * An address naming a slot that is gone is reported all the same. Leaving it
 * out would drop the edge in silence, and deleting the object a source reads
 * would then quietly break that source instead of being refused with the
 * dependent named, which is the answer section 4 of the spec gives for every
 * other slot.
 */
export function mathSourceReferences(object: GraphObject): readonly Address[] {
  const reading = readMathNames(readMathSource(object));
  return isMathSourceError(reading) ? [] : reading.names.references;
}

/** The addresses a parsed program reads, without going back to the text. */
function collectProgramReferences(program: MathProgram): readonly Address[] {
  const names = resolveMathNames(program);
  return isMathNameError(names) ? [] : names.references;
}

function mathOutDependencies(): DerivedSlotDependencies {
  return {
    kind: "dynamic",
    resolve: (object) => [
      { objectId: object.id, path: MATH_SOURCE_PATH },
      ...(object.ports?.in ?? []).map((name): Address => ({ objectId: object.id, path: mathInPortPath(name) })),
      ...mathSourceReferences(object),
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

    const references: Record<string, number> = {};
    for (const address of program.lines.length === 0 ? [] : collectProgramReferences(program)) {
      const value = read(address);
      if (value === undefined) {
        return { error: "#REF", message: `math: ${mathAddressKey(address)} did not resolve to a value` };
      }
      if (isErrorValue(value)) {
        return value;
      }
      if (typeof value !== "number") {
        return { error: "#TYPE", message: `math: ${mathAddressKey(address)} holds something other than a number` };
      }
      references[mathAddressKey(address)] = value;
    }

    const evaluation = evaluateMathObject(program, inputs, references);
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
 * A math object with nothing typed into it yet, carrying every slot its schema
 * declares. The two measured slots are part of that set, so an object built any
 * other way fails the integrity check the moment an edge derives into one.
 */
export function createMathObject(id: string, name: string, originX: number, originY: number): GraphObject {
  return {
    id,
    name,
    type: MATH_TYPE,
    ports: { in: [], out: [] },
    slots: {
      [slotKey(ORIGIN_X_PATH)]: { kind: "literal", value: originX },
      [slotKey(ORIGIN_Y_PATH)]: { kind: "literal", value: originY },
      [slotKey(MATH_SOURCE_PATH)]: { kind: "literal", value: "" },
      [slotKey(MATH_DISPLAY_PATH)]: { kind: "literal", value: MATH_DEFAULT_DISPLAY },
      [slotKey(MATH_MEASURED_WIDTH_PATH)]: { kind: "derived", value: null },
      [slotKey(MATH_MEASURED_HEIGHT_PATH)]: { kind: "derived", value: null },
    },
  };
}

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

  for (const measured of MATH_MEASURED_SLOTS) {
    const key = slotKey(measured.path);
    const existing = slots[key];
    if (existing?.kind !== "derived") {
      slots[key] = { kind: "derived", value: null };
    }
  }

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

/** Finds every reference macro in a source, so both directions share one scan. */
function rewriteReferences(source: string, rewrite: (inside: string) => string | undefined): string {
  const opening = `\\${MATH_REFERENCE_COMMAND}{`;
  let out = "";
  let at = 0;
  for (;;) {
    const start = source.indexOf(opening, at);
    if (start < 0) {
      return out + source.slice(at);
    }
    const close = source.indexOf("}", start + opening.length);
    if (close < 0) {
      return out + source.slice(at);
    }
    const inside = source.slice(start + opening.length, close);
    const replaced = rewrite(inside) ?? inside;
    out += source.slice(at, start) + opening + replaced + "}";
    at = close + 1;
  }
}

/**
 * A source as an operator reads it, with each address showing the name its
 * object carries now. The stored form holds an object id, so this is what turns
 * the stored form back into the one a person typed, the same way a formula is
 * shown.
 */
export function mathSourceWithNames(source: string, objects: readonly GraphObject[]): string {
  return rewriteReferences(source, (inside) => {
    const dot = inside.indexOf(".");
    if (dot <= 0) {
      return undefined;
    }
    const address: Address = { objectId: inside.slice(0, dot), path: inside.slice(dot + 1).split(".") };
    const formatted = formatAddress(address, objects);
    return isAddressError(formatted) ? undefined : formatted;
  });
}

/**
 * A source as it is stored, with each address holding the id of the object it
 * names. An address that names nothing is left as the operator wrote it, so the
 * mutation that writes the source can refuse it and say which one was wrong.
 */
export function mathSourceWithIds(source: string, objects: readonly GraphObject[]): string {
  return rewriteReferences(source, (inside) => {
    const parsed = parseAddress(inside, objects);
    return isAddressError(parsed) ? undefined : `${parsed.objectId}.${parsed.path.join(".")}`;
  });
}

/**
 * The addresses a source names that the document does not carry. The mutation
 * that writes a source reads this, so a reference to something absent is
 * refused with the address in the message rather than left to fail later as an
 * edge into a slot that is not there.
 */
export function unresolvedMathReferences(source: string, objects: readonly GraphObject[]): readonly string[] {
  const reading = readMathNames(source);
  if (isMathSourceError(reading)) {
    return [];
  }
  const missing: string[] = [];
  for (const address of reading.names.references) {
    const object = objects.find((candidate) => candidate.id === address.objectId);
    if (object === undefined || object.slots[slotKey(address.path)] === undefined) {
      missing.push(mathAddressKey(address));
    }
  }
  return missing;
}
