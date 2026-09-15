/**
 * complete.ts
 *
 * Works out what an operator part way through typing an address could have
 * meant. It answers with the candidates and with the text a completion key
 * should write now.
 *
 * Completion runs against the schema rather than against the slots an object
 * carries, for the reason the integrity checks do: a schema declares the slot
 * set, and an object whose slots have drifted from it is a fault rather than a
 * different set of addresses. So a slot the schema declares is offered even
 * where the object is missing it, and the refusal that follows names a real
 * problem instead of the completion hiding it.
 *
 * Matching ignores case, because a name lookup ignores case. A candidate
 * always carries the spelling the document holds, so completing tab_ against
 * an object named Table_1 writes Table_1 rather than the lowercase the
 * operator typed.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import { isCellReferenceForm, toSurfacePath } from "./address.ts";
import { lex as lexFormula } from "./formula/lexer.ts";
import type { GraphObject } from "./graph/node.ts";
import { getObjectSchema, resolveDerivedSlots, resolveNonDerivedSlotPaths } from "./primitives/schema.ts";

export type CompletionKind = "object" | "slot";

export interface Completion {
  /** The whole text that replaces what was typed, such as table_1.origin.x. */
  readonly text: string;
  readonly kind: CompletionKind;
}

export interface CompletionResult {
  readonly candidates: readonly Completion[];
  /**
   * The longest text every candidate starts with. A completion key writes this
   * much, which is as far as the typing can go without a choice being made. It
   * equals the whole of a candidate where only one matches.
   */
  readonly fill: string;
}

const NOTHING: CompletionResult = { candidates: [], fill: "" };

/** The longest run of characters that every one of these strings starts with. */
export function longestCommonPrefix(values: readonly string[]): string {
  const first = values[0];
  if (first === undefined) {
    return "";
  }
  let length = first.length;
  for (const value of values) {
    let index = 0;
    while (index < length && index < value.length && value[index] === first[index]) {
      index += 1;
    }
    length = index;
  }
  return first.slice(0, length);
}

function resultOf(candidates: readonly Completion[]): CompletionResult {
  if (candidates.length === 0) {
    return NOTHING;
  }
  return { candidates, fill: longestCommonPrefix(candidates.map((entry) => entry.text)) };
}

function startsWithIgnoringCase(value: string, prefix: string): boolean {
  return value.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}

/** Every object whose name starts with what was typed, in document order. */
export function completeObjectName(partial: string, objects: readonly GraphObject[]): CompletionResult {
  const matches = objects
    .filter((object) => startsWithIgnoringCase(object.name, partial))
    .map((object): Completion => ({ text: object.name, kind: "object" }));
  return resultOf(matches);
}

/**
 * The addresses an object carries, as an operator writes them. A table cell
 * appears as A1 rather than as the cells.A1 the slot map is keyed by, which is
 * the same surface spelling formatAddress gives back.
 */
export function objectSlotPaths(object: GraphObject): readonly string[] {
  const schema = getObjectSchema(object.type);
  if (schema === undefined) {
    return [];
  }
  const stored = [
    ...resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths),
    ...resolveDerivedSlots(object, schema.derivedSlots).map((entry) => entry.path),
  ];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const path of stored) {
    const surface = toSurfacePath(object.type, path).join(".");
    if (surface !== "" && !seen.has(surface)) {
      seen.add(surface);
      paths.push(surface);
    }
  }
  return paths;
}

/**
 * What a partly typed address could become. Before the first dot it completes
 * an object name, and after it the slots of that object, which is why reaching
 * a whole address takes two completions rather than one.
 *
 * A name that is already whole and matches one object alone moves straight on
 * to that object's slots, writing the dot on the way. So an operator completes
 * the object, presses the key again, and is choosing a slot, without typing
 * any of the punctuation that separates the two.
 */
export function completeAddress(partial: string, objects: readonly GraphObject[]): CompletionResult {
  const dot = partial.indexOf(".");
  if (dot < 0) {
    const names = completeObjectName(partial, objects);
    const variables = objects.filter((object) => object.type === "doc").flatMap((object) => Object.keys(object.slots))
      .filter((name) => startsWithIgnoringCase(name, partial)).map((text): Completion => ({ text, kind: "slot" }));
    if (variables.length > 0) return resultOf([...variables, ...names.candidates]);
    const sole = names.candidates.length === 1 ? names.candidates[0] : undefined;
    if (sole !== undefined && sole.text.toLowerCase() === partial.toLowerCase()) {
      // The object is settled, so the choice left is which of its slots. The
      // dot is written here rather than by the operator, so the second
      // completion finishes the address on its own.
      return completeAddress(`${sole.text}.`, objects);
    }
    return names;
  }

  const objectPart = partial.slice(0, dot);
  const pathPart = partial.slice(dot + 1);
  const object = objects.find((candidate) => candidate.name.toLowerCase() === objectPart.toLowerCase());
  if (object === undefined) {
    return NOTHING;
  }

  const matches = objectSlotPaths(object)
    .filter((path) => startsWithIgnoringCase(path, pathPart))
    .map((path): Completion => ({ text: `${object.name}.${path}`, kind: "slot" }));
  return resultOf(matches);
}

/** One run of a formula that reads like an address, and where it sits. */
export interface FormulaReference {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * The runs of a formula that read like an address. A run is a name followed by
 * any number of dotted parts, and a numeric part counts, because a vertex index
 * such as the 0 of vertex.0.x lexes as a number rather than as a name.
 *
 * A formula that will not lex gives nothing rather than a failure. It is being
 * typed, so it spends most of its life unfinished, and the caller wants the
 * runs it can see rather than a reason it saw none.
 */
export function formulaReferences(source: string): readonly FormulaReference[] {
  const tokens = lexFormula(source);
  if (!Array.isArray(tokens)) {
    return [];
  }

  const runs: FormulaReference[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined || token.type !== "identifier") {
      index += 1;
      continue;
    }
    const start = token.start;
    let end = token.start + token.text.length;
    index += 1;

    while (index + 1 < tokens.length) {
      const dot = tokens[index];
      const part = tokens[index + 1];
      if (dot?.type !== "dot" || part === undefined || (part.type !== "identifier" && part.type !== "number")) {
        break;
      }
      end = part.start + part.text.length;
      index += 2;
    }

    runs.push({ start, end, text: source.slice(start, end) });
  }
  return runs;
}

/**
 * Whether a run written in a formula names something the document carries. A
 * bare name is one only inside a table cell, where it means a cell of that same
 * table, which is the rule the formula parser already follows.
 */
export function formulaReferenceResolves(
  text: string,
  objects: readonly GraphObject[],
  tableObjectId?: string,
): boolean {
  if (!text.includes(".")) {
    const doc = objects.find((object) => object.type === "doc");
    if (Object.keys(doc?.slots ?? {}).some((name) => name.toLowerCase() === text.toLowerCase())) return true;
    if (tableObjectId === undefined || !isCellReferenceForm(text)) {
      return false;
    }
    const table = objects.find((object) => object.id === tableObjectId);
    return table !== undefined && objectSlotPaths(table).some((path) => path.toLowerCase() === text.toLowerCase());
  }

  const dot = text.indexOf(".");
  const object = objects.find((candidate) => candidate.name.toLowerCase() === text.slice(0, dot).toLowerCase());
  if (object === undefined) {
    return false;
  }
  const path = text.slice(dot + 1).toLowerCase();
  return objectSlotPaths(object).some((candidate) => candidate.toLowerCase() === path);
}
