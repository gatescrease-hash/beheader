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
import { toSurfacePath } from "./address.ts";
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
 */
export function completeAddress(partial: string, objects: readonly GraphObject[]): CompletionResult {
  const dot = partial.indexOf(".");
  if (dot < 0) {
    return completeObjectName(partial, objects);
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
