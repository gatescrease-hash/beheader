/**
 * Generates deterministic documents and mutation batches, then compares the
 * results of two evaluation strategies after every batch. The reference and
 * candidate both travel through mutate(), so they share mutation semantics
 * while their evaluation passes can differ.
 *
 * Structural comparison is exact by default. Object key order is ignored,
 * while array order, journal entries, broken-slot lists, refusal messages and
 * negative zero remain observable. A numeric tolerance applies only at the
 * exact path named by its policy, which prevents one approximate calculation
 * from weakening comparison of the rest of a document.
 *
 * The generator uses an explicit seed and reports it with a mismatch. A failed
 * case can therefore be repeated without preserving hidden random state.
 *
 * The runner deep freezes every state it hands to mutate(). Staging shares the
 * records a batch leaves alone, so a write into one of them would reach the
 * state before the batch and every earlier state that shares it. A module runs
 * in strict mode, where a write into a frozen record throws a TypeError, so
 * such a write fails the run at the step that made it.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import type { Address } from "./address.ts";
import { NULL_EVAL_CONTEXT, type EvalContext } from "./eval-context.ts";
import type { FormulaAst } from "./formula/ast.ts";
import { slotKey, type GraphObject, type Slot } from "./graph/node.ts";
import { getObjectSchema, resolveDerivedSlots } from "./primitives/schema.ts";
import {
  mutate,
  type EvaluationStrategy,
  type MutationJournalEntry,
  type MutationResult,
  type Operation,
} from "./mutation.ts";

export type ComparisonPathPart = string | number;

export interface NumericTolerance {
  readonly path: readonly ComparisonPathPart[];
  readonly absTolerance: number;
  readonly relTolerance: number;
}

export interface DifferentialComparisonPolicy {
  readonly numericTolerances?: readonly NumericTolerance[];
}

export interface DifferentialMismatch {
  readonly path: readonly ComparisonPathPart[];
  readonly reason: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

export interface GeneratedMutationScenario {
  readonly seed: number;
  readonly initialObjects: readonly GraphObject[];
  readonly initialJournal: readonly MutationJournalEntry[];
  readonly batches: readonly (readonly Operation[])[];
}

export interface MutationScenarioOptions {
  readonly objectCount?: number;
  readonly editBatchCount?: number;
}

export type DifferentialRunResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly seed: number;
      readonly batchIndex: number;
      readonly mismatch: DifferentialMismatch;
    };

function samePath(left: readonly ComparisonPathPart[], right: readonly ComparisonPathPart[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function toleranceAt(
  path: readonly ComparisonPathPart[],
  policy: DifferentialComparisonPolicy,
): NumericTolerance | undefined {
  return policy.numericTolerances?.find((entry) => samePath(entry.path, path));
}

function compareNumbers(
  expected: number,
  actual: number,
  path: readonly ComparisonPathPart[],
  policy: DifferentialComparisonPolicy,
): boolean {
  if (Object.is(expected, actual)) {
    return true;
  }
  if (expected === 0 && actual === 0) {
    return false;
  }
  const tolerance = toleranceAt(path, policy);
  if (
    tolerance === undefined
    || tolerance.absTolerance < 0
    || tolerance.relTolerance < 0
    || !Number.isFinite(expected)
    || !Number.isFinite(actual)
  ) {
    return false;
  }
  return Math.abs(actual - expected)
    <= tolerance.absTolerance + tolerance.relTolerance * Math.abs(expected);
}

function compareAtPath(
  expected: unknown,
  actual: unknown,
  path: readonly ComparisonPathPart[],
  policy: DifferentialComparisonPolicy,
): DifferentialMismatch | undefined {
  if (typeof expected === "number" && typeof actual === "number") {
    return compareNumbers(expected, actual, path, policy)
      ? undefined
      : { path, reason: "numeric values differ", expected, actual };
  }
  if (Object.is(expected, actual)) {
    return undefined;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { path, reason: "one value is an array and the other is not", expected, actual };
    }
    if (expected.length !== actual.length) {
      return { path, reason: "array lengths differ", expected: expected.length, actual: actual.length };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = compareAtPath(expected[index], actual[index], [...path, index], policy);
      if (mismatch !== undefined) {
        return mismatch;
      }
    }
    return undefined;
  }
  if (expected !== null && actual !== null && typeof expected === "object" && typeof actual === "object") {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const expectedKeys = Object.keys(expectedRecord).sort();
    const actualKeys = Object.keys(actualRecord).sort();
    const keyMismatch = compareAtPath(expectedKeys, actualKeys, [...path, "<keys>"], policy);
    if (keyMismatch !== undefined) {
      return { path, reason: "object keys differ", expected: expectedKeys, actual: actualKeys };
    }
    for (const key of expectedKeys) {
      const mismatch = compareAtPath(expectedRecord[key], actualRecord[key], [...path, key], policy);
      if (mismatch !== undefined) {
        return mismatch;
      }
    }
    return undefined;
  }
  return { path, reason: "values differ", expected, actual };
}

/** Returns the first observable difference, with object key order normalized. */
export function compareDifferentialValues(
  expected: unknown,
  actual: unknown,
  policy: DifferentialComparisonPolicy = {},
): DifferentialMismatch | undefined {
  return compareAtPath(expected, actual, [], policy);
}

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }

  integer(bound: number): number {
    return Math.floor(this.next() * bound);
  }
}

function address(index: number): Address {
  return { objectId: `obj_${index + 1}`, path: ["value"] };
}

function referenceAst(random: SeededRandom, targetIndex: number): FormulaAst {
  const firstIndex = random.integer(targetIndex);
  const left: FormulaAst = { type: "reference", address: address(firstIndex) };
  if (targetIndex < 2 || random.next() < 0.5) {
    return {
      type: "binaryOp",
      operator: "+",
      left,
      right: { type: "literal", value: random.integer(21) - 10 },
    };
  }
  return {
    type: "binaryOp",
    operator: "+",
    left,
    right: { type: "reference", address: address(random.integer(targetIndex)) },
  };
}

function literalSlot(value: number): Slot {
  return { kind: "literal", value };
}

function formulaSlot(ast: FormulaAst): Slot {
  return { kind: "formula", ast, value: null };
}

function setValue(objectIndex: number, slot: Slot): Operation {
  return { kind: "setSlot", address: address(objectIndex), slot };
}

function cell(reference: string): Address {
  return { objectId: "obj_grid", path: ["cells", reference] };
}

/** A text object holding the content, the sizes and fonts its measurements read, and the derived slots its schema declares. */
function textObject(id: string, name: string, content: string): GraphObject {
  const slots: Record<string, Slot> = {
    content: { kind: "literal", value: content },
    width: { kind: "literal", value: "auto" },
    height: { kind: "literal", value: "auto" },
    "style.font": { kind: "literal", value: "sans-serif" },
    "style.fontSize": { kind: "literal", value: 16 },
    "style.lineHeight": { kind: "literal", value: 20 },
  };
  const stub: GraphObject = { id, name, type: "text", slots };
  for (const entry of resolveDerivedSlots(stub, getObjectSchema("text")?.derivedSlots ?? [])) {
    slots[slotKey(entry.path)] = { kind: "derived", value: null };
  }
  return stub;
}

/**
 * Creates, renames, deletes, cell writes and clears, over a text that names an
 * object before it exists, after it is renamed away, and after it is deleted,
 * then a group with a member that binds to its origin, a group loop, and a
 * delete that refuses until the member leaves.
 * Text is the one reader that names an object by the name it carries rather
 * than by its ID, so these batches reach every way a structural change can
 * reach an object that does not name it by ID.
 */
function structuralBatches(random: SeededRandom, objectCount: number): Operation[][] {
  const extra = `extra_${random.integer(5)}`;
  const read = address(1 + random.integer(objectCount - 1));
  const extraAddress: Address = { objectId: "obj_extra", path: ["value"] };
  return [
    [{ kind: "createObject", object: textObject("obj_note", "note", `seen {= ${extra}.value } of {= value_2.value }`) }],
    [{ kind: "createObject", object: { id: "obj_extra", name: extra, type: "value", slots: { value: formulaSlot({ type: "reference", address: read }) } } }],
    [{ kind: "setSlot", address: read, slot: literalSlot(random.integer(41) - 20) }],
    [{ kind: "renameObject", objectId: "obj_extra", name: `${extra}_renamed` }],
    [{ kind: "renameObject", objectId: "obj_extra", name: extra }],
    [{ kind: "renameObject", objectId: "obj_extra", name: "value_3" }],
    [{
      kind: "createObject",
      object: { id: "obj_grid", name: "grid", type: "table", slots: { rows: literalSlot(2), cols: literalSlot(2) } },
    }, {
      kind: "setSlot", address: cell("A1"), slot: formulaSlot({ type: "reference", address: extraAddress }),
    }, {
      kind: "setSlot", address: cell("B1"), slot: formulaSlot({ type: "functionCall", name: "SUM", args: [{ type: "range", start: cell("A1"), end: cell("A2") }] }),
    }],
    [{ kind: "setSlot", address: cell("B2"), slot: formulaSlot({ type: "functionCall", name: "SUM", args: [{ type: "range", start: cell("A1"), end: cell("B2") }] }) }],
    [{ kind: "setSlot", address: cell("A2"), slot: literalSlot(random.integer(9) + 1) }],
    [{ kind: "setSlot", address: read, slot: formulaSlot({ type: "reference", address: cell("B1") }) }],
    [{ kind: "createObject", object: { id: "obj_watch", name: "watch", type: "value", slots: { value: formulaSlot({ type: "reference", address: cell("B1") }) } } }],
    [{ kind: "clearSlot", address: cell("A1") }],
    [{ kind: "deleteObject", objectId: "obj_extra" }],
    [{ kind: "deleteObject", objectId: "obj_grid" }],
    [{ kind: "setSlot", address: { objectId: "obj_watch", path: ["value"] }, slot: literalSlot(3) }],
    [{ kind: "deleteObject", objectId: "obj_grid" }],
    [
      { kind: "createObject", object: { id: "obj_brief", name: "brief", type: "value", slots: { value: literalSlot(1) } } },
      { kind: "renameObject", objectId: "obj_brief", name: extra },
      { kind: "setSlot", address: { objectId: "obj_brief", path: ["value"] }, slot: literalSlot(2) },
    ],
    [
      { kind: "createObject", object: { id: "obj_gone", name: "gone", type: "value", slots: { value: literalSlot(1) } } },
      { kind: "deleteObject", objectId: "obj_gone" },
    ],
    [{ kind: "deleteObject", objectId: "obj_note" }],
    [
      { kind: "createObject", object: { id: "obj_frame", name: "frame", type: "group", slots: {
        "origin.x": literalSlot(10), "origin.y": literalSlot(10), language: { kind: "literal", value: "python" }, source: { kind: "literal", value: "" },
      } } },
      { kind: "setSlot", address: { objectId: read.objectId, path: ["view", "group"] }, slot: { kind: "literal", value: "obj_frame" } },
    ],
    [{ kind: "setSlot", address: read, slot: formulaSlot({ type: "reference", address: { objectId: "obj_frame", path: ["origin", "x"] } }) }],
    [{ kind: "setSlot", address: { objectId: "obj_frame", path: ["origin", "x"] }, slot: literalSlot(random.integer(50)) }],
    [{ kind: "setSlot", address: { objectId: "obj_frame", path: ["view", "group"] }, slot: { kind: "literal", value: "obj_frame" } }],
    [{ kind: "deleteObject", objectId: "obj_frame" }],
    [
      { kind: "setSlot", address: read, slot: literalSlot(4) },
      { kind: "setSlot", address: { objectId: read.objectId, path: ["view", "group"] }, slot: { kind: "literal", value: null } },
      { kind: "deleteObject", objectId: "obj_frame" },
    ],
  ];
}

/** The object with every derived slot its schema declares, holding no value yet. */
function withDerivedSlots(object: GraphObject): GraphObject {
  const slots: Record<string, Slot> = { ...object.slots };
  for (const entry of resolveDerivedSlots(object, getObjectSchema(object.type)?.derivedSlots ?? [])) {
    slots[slotKey(entry.path)] = { kind: "derived", value: null };
  }
  return { ...object, slots };
}

function at(objectId: string, ...path: string[]): Address {
  return { objectId, path };
}

function readerOf(id: string, name: string, read: Address): Operation {
  return { kind: "createObject", object: { id, name, type: "value", slots: { value: formulaSlot({ type: "reference", address: read }) } } };
}

/**
 * Every structural operation the indexed path takes, each with readers whose
 * addresses shift or break: a table resized by line and by extent, a path
 * that gains, loses and splits vertices, an explode with and without force,
 * ports added and removed, a math source rewritten under a reader of its
 * export, document variables created, copied, renamed and cleared, a layer
 * membership, and a forced delete of a table that something reads. Some of
 * them refuse, so a refusal through each operation reaches the comparison as
 * well.
 */
function everyStructuralOperation(random: SeededRandom, objectCount: number): Operation[][] {
  const sheet = "obj_sheet";
  const path = "obj_path";
  const runner = "obj_runner";
  const equation = "obj_eq";
  const docId = "obj_doc";
  const valueRead = address(1 + random.integer(objectCount - 1));
  const valueWrite = address(1 + random.integer(objectCount - 1));
  const point = (x: number, y: number): { x: number; y: number } => ({ x, y });
  const pathPoints = [point(0, 0), point(40, 0), point(40, 30), point(0, 30)];
  const pathSlots: Record<string, Slot> = { closed: { kind: "literal", value: false } };
  pathPoints.forEach((vertex, index) => {
    pathSlots[`vertex.${index}.x`] = literalSlot(vertex.x);
    pathSlots[`vertex.${index}.y`] = literalSlot(vertex.y);
  });
  const rect = (id: string, name: string): GraphObject => withDerivedSlots({
    id,
    name,
    type: "rect",
    slots: { "origin.x": literalSlot(0), "origin.y": literalSlot(0), width: literalSlot(10 + random.integer(10)), height: literalSlot(5) },
  });
  return [
    [
      { kind: "createObject", object: { id: sheet, name: "sheet", type: "table", slots: { rows: literalSlot(3), cols: literalSlot(3) } } },
      { kind: "setSlot", address: at(sheet, "cells", "A1"), slot: literalSlot(random.integer(9) + 1) },
      { kind: "setSlot", address: at(sheet, "cells", "B2"), slot: formulaSlot({ type: "binaryOp", operator: "*", left: { type: "reference", address: at(sheet, "cells", "A1") }, right: { type: "literal", value: 2 } }) },
      { kind: "setSlot", address: at(sheet, "cells", "C3"), slot: formulaSlot({ type: "functionCall", name: "SUM", args: [{ type: "range", start: at(sheet, "cells", "A1"), end: at(sheet, "cells", "B2") }] }) },
    ],
    [readerOf("obj_sheet_reader", "sheet_reader", at(sheet, "cells", "B2"))],
    [{ kind: "insertTableLine", objectId: sheet, axis: "row", index: 1 + random.integer(2) }],
    [{ kind: "insertTableLine", objectId: sheet, axis: "column", index: 1 }],
    [{ kind: "deleteTableLine", objectId: sheet, axis: "row", index: 1 }],
    [{ kind: "deleteTableLine", objectId: sheet, axis: "column", index: 1 + random.integer(2) }],
    [{ kind: "setSlot", address: at(sheet, "rows"), slot: literalSlot(2 + random.integer(4)) }],
    [{ kind: "setSlot", address: at(sheet, "cols"), slot: literalSlot(1) }],
    [{ kind: "setSlot", address: at(sheet, "cols"), slot: literalSlot(4) }],
    [{ kind: "setSlot", address: at(sheet, "cols"), slot: literalSlot(2.5) }],
    // A slider holds its value in a literal that readers take up, and a
    // formula in that value makes it a gauge of another slot.
    [{ kind: "createObject", object: { id: "obj_slider", name: "slider", type: "slider", slots: { "origin.x": literalSlot(0), "origin.y": literalSlot(0), width: literalSlot(200), min: literalSlot(0), max: literalSlot(10), step: literalSlot(1), value: literalSlot(random.integer(10)) } } }],
    [readerOf("obj_slider_reader", "slider_reader", at("obj_slider", "value"))],
    [{ kind: "setSlot", address: at("obj_slider", "value"), slot: literalSlot(random.integer(10)) }],
    [{ kind: "setSlot", address: at("obj_slider", "value"), slot: formulaSlot({ type: "reference", address: at(sheet, "cells", "A1") }) }],
    [{ kind: "createObject", object: withDerivedSlots({ id: path, name: "path", type: "polyline", vertexCount: pathPoints.length, slots: pathSlots }) }],
    [readerOf("obj_path_reader", "path_reader", at(path, "vertex", "2", "x"))],
    [{ kind: "addVertex", objectId: path, point: point(random.integer(50), 60) }],
    [{ kind: "splitEdge", objectId: path, index: random.integer(2), point: point(20, 0) }],
    [{ kind: "deleteVertex", objectId: path, index: 0 }],
    [{ kind: "deleteVertex", objectId: path, index: 1 + random.integer(2) }],
    [{ kind: "deleteVertex", objectId: path, index: 1 + random.integer(2), force: true }],
    [{ kind: "createObject", object: rect("obj_box", "box") }],
    [{ kind: "explode", objectId: "obj_box" }],
    [{ kind: "createObject", object: rect("obj_box_two", "box_two") }, readerOf("obj_box_reader", "box_reader", at("obj_box_two", "width"))],
    [{ kind: "explode", objectId: "obj_box_two" }],
    [{ kind: "explode", objectId: "obj_box_two", force: true }],
    [{ kind: "createObject", object: withDerivedSlots({ id: runner, name: "runner", type: "script", slots: { "origin.x": literalSlot(0), "origin.y": literalSlot(0), language: { kind: "literal", value: "python" }, source: { kind: "literal", value: "" } } }) }],
    [{ kind: "addPort", objectId: runner, family: "in", name: "gain" }, { kind: "setSlot", address: at(runner, "in", "gain"), slot: formulaSlot({ type: "reference", address: valueRead }) }],
    [
      { kind: "addPort", objectId: runner, family: "out", name: "result" },
      { kind: "setSlot", address: at(runner, "placeholder", "result"), slot: literalSlot(random.integer(9)) },
      { kind: "setSlot", address: at(runner, "out", "result"), slot: { kind: "derived", value: null } },
    ],
    [readerOf("obj_runner_reader", "runner_reader", at(runner, "out", "result"))],
    [{ kind: "removePort", objectId: runner, family: "out", name: "result" }],
    [{ kind: "removePort", objectId: runner, family: "in", name: "gain" }],
    [{ kind: "addPort", objectId: runner, family: "in", name: "not a name" }],
    [{ kind: "createObject", object: withDerivedSlots({ id: equation, name: "eq", type: "math", slots: { "origin.x": literalSlot(0), "origin.y": literalSlot(0), source: { kind: "literal", value: "" }, display: { kind: "literal", value: "source" } } }) }],
    [{ kind: "setMathSource", objectId: equation, source: "y=x*2" }],
    [{ kind: "setSlot", address: at(equation, "in", "x"), slot: formulaSlot({ type: "reference", address: valueRead }) }],
    [readerOf("obj_eq_reader", "eq_reader", at(equation, "out", "y"))],
    [{ kind: "setMathSource", objectId: equation, source: `y=x*${2 + random.integer(3)}+w` }],
    [{ kind: "setMathSource", objectId: equation, source: "z=x" }],
    [{ kind: "setMathSource", objectId: equation, source: "y=(" }],
    [{ kind: "createObject", object: { id: docId, name: "doc", type: "doc", slots: { rate: literalSlot(random.integer(9)) } } }],
    [{ kind: "setSlot", address: at(docId, "speed"), slot: literalSlot(5) }],
    [{ kind: "createObject", object: withDerivedSlots({ id: "obj_speed_copy", name: "speed_copy", type: "docref", target: at(docId, "speed"), slots: { "origin.x": literalSlot(0), "origin.y": literalSlot(0) } }) }],
    [{ kind: "setSlot", address: valueWrite, slot: formulaSlot({ type: "binaryOp", operator: "+", left: { type: "reference", address: at(docId, "speed") }, right: { type: "reference", address: at(docId, "rate") } }) }],
    [{ kind: "renameVariable", address: at(docId, "speed"), name: "pace" }],
    [{ kind: "renameVariable", address: at(docId, "pace"), name: "rate" }],
    [{ kind: "clearSlot", address: at(docId, "pace") }],
    [{ kind: "setSlot", address: valueWrite, slot: literalSlot(1) }],
    [{ kind: "clearSlot", address: at(docId, "pace") }],
    [{ kind: "setSlot", address: at(docId, "value_1"), slot: literalSlot(1) }],
    [{ kind: "createObject", object: { id: "obj_layer", name: "tier", type: "layer", slots: { "view.visible": { kind: "literal", value: true }, "view.order": literalSlot(0) } } }],
    [{ kind: "setSlot", address: at(valueRead.objectId, "view", "layer"), slot: { kind: "literal", value: "obj_layer" } }],
    [{ kind: "deleteObject", objectId: "obj_layer" }],
    [{ kind: "setSlot", address: at(valueRead.objectId, "view", "layer"), slot: { kind: "literal", value: null } }],
    [{ kind: "deleteObject", objectId: "obj_layer" }],
    [{ kind: "deleteObject", objectId: sheet, force: true }],
  ];
}

/** Builds a repeatable acyclic graph, valid edits, refusals, cycle attempts, structural changes and a forced repair. */
export function generateMutationScenario(
  seed: number,
  options: MutationScenarioOptions = {},
): GeneratedMutationScenario {
  const requestedObjectCount = options.objectCount ?? 9;
  const requestedEditBatchCount = options.editBatchCount ?? 12;
  const objectCount = Number.isFinite(requestedObjectCount)
    ? Math.max(3, Math.floor(requestedObjectCount))
    : 9;
  const editBatchCount = Number.isFinite(requestedEditBatchCount)
    ? Math.max(1, Math.floor(requestedEditBatchCount))
    : 12;
  const random = new SeededRandom(seed);
  const initialObjects = Array.from({ length: objectCount }, (_, index): GraphObject => ({
    id: `obj_${index + 1}`,
    name: `value_${index + 1}`,
    type: "value",
    slots: { value: literalSlot(random.integer(101) - 50) },
  }));
  const batches: Operation[][] = [];

  batches.push(Array.from({ length: objectCount - 1 }, (_, offset) => {
    const targetIndex = offset + 1;
    return setValue(targetIndex, formulaSlot(referenceAst(random, targetIndex)));
  }));

  for (let batchIndex = 0; batchIndex < editBatchCount; batchIndex += 1) {
    const operationCount = 1 + random.integer(3);
    const batch: Operation[] = [];
    for (let operationIndex = 0; operationIndex < operationCount; operationIndex += 1) {
      const targetIndex = random.integer(objectCount);
      const slot = targetIndex === 0 || random.next() < 0.45
        ? literalSlot(random.integer(201) - 100)
        : formulaSlot(referenceAst(random, targetIndex));
      batch.push(setValue(targetIndex, slot));
    }
    batches.push(batch);
  }

  batches.splice(Math.floor(batches.length / 2), 0, [
    setValue(objectCount - 1, formulaSlot({
      type: "reference",
      address: { objectId: "missing", path: ["value"] },
    })),
  ]);
  // A slot that reads itself, and a reader at the head of the chains that
  // reads the last object, which closes a loop whenever the last object reads
  // back to it. Both reach the cycle check with only existing slots written.
  batches.push([setValue(1, formulaSlot({ type: "reference", address: address(1) }))]);
  batches.push([setValue(1, formulaSlot({ type: "reference", address: address(objectCount - 1) }))]);
  batches.push([setValue(objectCount, literalSlot(1))]);
  batches.push(...structuralBatches(random, objectCount));
  batches.push(...everyStructuralOperation(random, objectCount));
  batches.push([setValue(1, formulaSlot({ type: "reference", address: address(0) }))]);
  batches.push([{ kind: "deleteObject", objectId: address(0).objectId, force: true }]);

  return { seed, initialObjects, initialJournal: [], batches };
}

/** Freezes every record, slot, AST and value reachable from the argument. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Runs the same scenario through both strategies and reports the first difference. */
export function runMutationDifferential(
  scenario: GeneratedMutationScenario,
  referenceStrategy: EvaluationStrategy,
  candidateStrategy: EvaluationStrategy,
  context: EvalContext = NULL_EVAL_CONTEXT,
  policy: DifferentialComparisonPolicy = {},
): DifferentialRunResult {
  let referenceObjects = scenario.initialObjects;
  let referenceJournal = scenario.initialJournal;
  let candidateObjects = scenario.initialObjects;
  let candidateJournal = scenario.initialJournal;

  for (let batchIndex = 0; batchIndex < scenario.batches.length; batchIndex += 1) {
    const batch = scenario.batches[batchIndex]!;
    deepFreeze([referenceObjects, referenceJournal, candidateObjects, candidateJournal]);
    const expected: MutationResult = mutate(
      referenceObjects,
      batch,
      referenceJournal,
      context,
      referenceStrategy,
    );
    const actual: MutationResult = mutate(
      candidateObjects,
      batch,
      candidateJournal,
      context,
      candidateStrategy,
    );
    const mismatch = compareDifferentialValues(expected, actual, policy);
    if (mismatch !== undefined) {
      return { ok: false, seed: scenario.seed, batchIndex, mismatch };
    }
    if (expected.ok && actual.ok) {
      referenceObjects = expected.objects;
      referenceJournal = expected.journal;
      candidateObjects = actual.objects;
      candidateJournal = actual.journal;
    }
  }
  return { ok: true };
}

function formatComparisonPath(path: readonly ComparisonPathPart[]): string {
  return path.reduce<string>((formatted, part) =>
    typeof part === "number" ? `${formatted}[${part}]` : `${formatted}.${part}`, "$"
  );
}

/** Throws a test failure that identifies the reproducible case and first differing field. */
export function assertMutationDifferential(
  scenario: GeneratedMutationScenario,
  referenceStrategy: EvaluationStrategy,
  candidateStrategy: EvaluationStrategy,
  context: EvalContext = NULL_EVAL_CONTEXT,
  policy: DifferentialComparisonPolicy = {},
): void {
  const result = runMutationDifferential(
    scenario,
    referenceStrategy,
    candidateStrategy,
    context,
    policy,
  );
  if (!result.ok) {
    throw new Error(
      `differential mismatch for seed ${result.seed}, batch ${result.batchIndex}, `
      + `${formatComparisonPath(result.mismatch.path)}: ${result.mismatch.reason}`,
    );
  }
}
