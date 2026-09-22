/**
 * eval.ts
 *
 * Evaluates either the whole document or an affected set of slots. Both paths
 * sort the slots they evaluate into dependency order, so a slot always reads
 * inputs that have already been recomputed. The affected path reads a cached
 * value from the committed graph when an input sits outside that set.
 * The depth first sort uses an explicit stack, so long dependency chains
 * retain their traversal order without exhausting the JavaScript call stack.
 *
 * The three kinds of slot go through this single pass. A literal returns the
 * value it stores, a formula evaluates its AST, and a derived slot calls the
 * compute function its schema declares. Because all three take the same path,
 * a derived value is never one evaluation behind the literal that feeds it.
 *
 * Evaluation never throws. A formula that fails leaves an error value in its
 * own slot and the pass carries on, so one broken formula cannot blank the
 * rest of the document.
 *
 * Nothing here knows about any object type. A script node is one more derived
 * slot as far as this file is concerned, so a new primitive can arrive without
 * any change to the evaluator.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import type { Address } from "../address.ts";
import { NULL_EVAL_CONTEXT, type EvalContext } from "../eval-context.ts";
import type { FormulaAst } from "../formula/ast.ts";
import { evaluate as evaluateFormulaAst, type ReadRange, type ReadSlot } from "../formula/eval.ts";
import { enumerateRangeCellAddresses, isInExtentTableCellAddress, isRangeEnumerationError } from "../primitives/table.ts";
import { getObjectSchema, resolveDerivedSlots, type DerivedSlotSchema } from "../primitives/schema.ts";
import { addressKey, type Edge } from "./edge.ts";
import { slotKey, type GraphObject, type Slot, type Value } from "./node.ts";

export type SlotEvaluationObserver = (address: Address) => void;

/**
 * Evaluates every slot of every object, in topological order. It returns the
 * new object list. An error becomes an error value in a slot. It never
 * throws, because one bad formula does not stop the rest.
 */
export function evaluate(
  objects: readonly GraphObject[],
  edges: readonly Edge[],
  context: EvalContext = NULL_EVAL_CONTEXT,
): readonly GraphObject[] {
  const nodesByKey = new Map<string, { readonly object: GraphObject; readonly key: string }>();
  for (const object of objects) {
    for (const key of Object.keys(object.slots)) {
      nodesByKey.set(`${object.id}::${key}`, { object, key });
    }
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const sourceKey = addressKey(edge.sourceSlot);
    const arcs = outgoing.get(sourceKey);
    if (arcs === undefined) {
      outgoing.set(sourceKey, [addressKey(edge.dependentSlot)]);
    } else {
      arcs.push(addressKey(edge.dependentSlot));
    }
  }

  const topologicalOrder = sortNodeKeys(nodesByKey.keys(), outgoing);

  const evaluatedValues = new Map<string, Value>();
  const readEvaluated = (address: Address): Value | undefined => evaluatedValues.get(addressKey(address));

  const updatedSlotsByObjectId = new Map<string, Record<string, Slot>>();
  function slotsFor(objectId: string): Record<string, Slot> {
    const existing = updatedSlotsByObjectId.get(objectId);
    if (existing !== undefined) {
      return existing;
    }
    const created: Record<string, Slot> = {};
    updatedSlotsByObjectId.set(objectId, created);
    return created;
  }

  for (const nodeKey of topologicalOrder) {
    const node = nodesByKey.get(nodeKey);
    if (node === undefined) {
      continue;
    }
    const { object, key } = node;
    const slot = object.slots[key];
    if (slot === undefined) {
      continue;
    }

    const value = evaluateSlot(object, key, slot, objects, edges, readEvaluated, context);
    evaluatedValues.set(nodeKey, value);
    slotsFor(object.id)[key] = nextSlot(slot, value);
  }

  return objects.map((object) => ({
    ...object,
    slots: { ...object.slots, ...slotsFor(object.id) },
  }));
}

/**
 * Evaluates only the supplied addresses and keeps cached values everywhere
 * else. The caller supplies the downstream closure, including addresses that
 * disappeared, and this function skips any address with no surviving slot.
 */
export function evaluateAffected(
  objects: readonly GraphObject[],
  edges: readonly Edge[],
  affectedAddresses: readonly Address[],
  context: EvalContext = NULL_EVAL_CONTEXT,
  observer?: SlotEvaluationObserver,
): readonly GraphObject[] {
  const objectsById = new Map(objects.map((object) => [object.id, object]));
  const nodesByKey = new Map<string, { readonly object: GraphObject; readonly key: string; readonly address: Address }>();
  for (const address of affectedAddresses) {
    const object = objectsById.get(address.objectId);
    const key = slotKey(address.path);
    if (object?.slots[key] !== undefined) {
      nodesByKey.set(addressKey(address), { object, key, address });
    }
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const sourceKey = addressKey(edge.sourceSlot);
    const dependentKey = addressKey(edge.dependentSlot);
    if (!nodesByKey.has(sourceKey) || !nodesByKey.has(dependentKey)) {
      continue;
    }
    const arcs = outgoing.get(sourceKey);
    if (arcs === undefined) {
      outgoing.set(sourceKey, [dependentKey]);
    } else {
      arcs.push(dependentKey);
    }
  }

  const topologicalOrder = sortNodeKeys(nodesByKey.keys(), outgoing);
  const evaluatedValues = new Map<string, Value>();
  const readEvaluatedOrCached = (address: Address): Value | undefined => {
    const key = addressKey(address);
    if (evaluatedValues.has(key)) {
      return evaluatedValues.get(key);
    }
    return objectsById.get(address.objectId)?.slots[slotKey(address.path)]?.value;
  };
  const updatedSlotsByObjectId = new Map<string, Record<string, Slot>>();

  for (const nodeKey of topologicalOrder) {
    const node = nodesByKey.get(nodeKey);
    if (node === undefined) {
      continue;
    }
    const slot = node.object.slots[node.key];
    if (slot === undefined) {
      continue;
    }
    const value = evaluateSlot(
      node.object,
      node.key,
      slot,
      objects,
      edges,
      readEvaluatedOrCached,
      context,
    );
    evaluatedValues.set(nodeKey, value);
    const updated = updatedSlotsByObjectId.get(node.object.id) ?? {};
    updated[node.key] = nextSlot(slot, value);
    updatedSlotsByObjectId.set(node.object.id, updated);
    observer?.(node.address);
  }

  return objects.map((object) => {
    const updated = updatedSlotsByObjectId.get(object.id);
    return updated === undefined ? object : { ...object, slots: { ...object.slots, ...updated } };
  });
}

function sortNodeKeys(
  nodeKeys: Iterable<string>,
  outgoing: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const visited = new Set<string>();
  const postorder: string[] = [];
  const stack: { key: string; next: number }[] = [];
  for (const nodeKey of nodeKeys) {
    if (visited.has(nodeKey)) continue;
    visited.add(nodeKey);
    stack.push({ key: nodeKey, next: 0 });
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const next = outgoing.get(frame.key)?.[frame.next++];
      if (next === undefined) {
        postorder.push(frame.key);
        stack.pop();
      } else if (!visited.has(next)) {
        visited.add(next);
        stack.push({ key: next, next: 0 });
      }
    }
  }
  return postorder.reverse();
}

function evaluateSlot(
  object: GraphObject,
  key: string,
  slot: Slot,
  objects: readonly GraphObject[],
  edges: readonly Edge[],
  readValue: (address: Address) => Value | undefined,
  context: EvalContext,
): Value {
  switch (slot.kind) {
    case "literal":
      return slot.value;
    case "formula":
      return evaluateFormula(slot.ast, objects, readValue);
    case "derived":
      return evaluateDerivedSlot(object, key, objects, edges, readValue, context);
  }
}

function nextSlot(slot: Slot, value: Value): Slot {
  switch (slot.kind) {
    case "literal":
      return slot;
    case "formula":
      return { kind: "formula", ast: slot.ast, value };
    case "derived":
      return { kind: "derived", value };
  }
}

function evaluateFormula(
  ast: FormulaAst,
  objects: readonly GraphObject[],
  readValue: (address: Address) => Value | undefined,
): Value {
  const read: ReadSlot = (address) => {
    const value = readValue(address);
    return isEmptyInExtentCell(address, value, objects) ? 0 : value;
  };
  return evaluateFormulaAst(ast, read, buildRangeReader(objects, readValue));
}

function isEmptyInExtentCell(address: Address, rawValue: Value | undefined, objects: readonly GraphObject[]): boolean {
  return (rawValue === undefined || rawValue === null) && isInExtentTableCellAddress(address, objects);
}

function buildRangeReader(
  objects: readonly GraphObject[],
  readValue: (address: Address) => Value | undefined,
): ReadRange {
  return (start, end) => {
    const tableObject = objects.find((candidate) => candidate.id === start.objectId);
    if (tableObject === undefined) {
      return { error: "#REF", message: "a range references an object that does not exist" };
    }
    const cellAddresses = enumerateRangeCellAddresses(start, end, tableObject);
    if (isRangeEnumerationError(cellAddresses)) {
      return cellAddresses;
    }
    const values: Value[] = [];
    for (const cellAddress of cellAddresses) {
      const value = readValue(cellAddress);
      if (value === undefined || value === null) {
        continue;
      }
      values.push(value);
    }
    return values;
  };
}

function evaluateDerivedSlot(
  object: GraphObject,
  key: string,
  objects: readonly GraphObject[],
  edges: readonly Edge[],
  readValue: (address: Address) => Value | undefined,
  context: EvalContext,
): Value {
  const schema = getObjectSchema(object.type);
  const schemaEntry = findDerivedSlotSchemaByKey(schema === undefined ? undefined : resolveDerivedSlots(object, schema.derivedSlots), key);
  if (schemaEntry === undefined) {
    return {
      error: "#REF",
      message: `no schema entry declares a derived slot "${key}" on type "${object.type}"`,
    };
  }

  const ownKey = addressKey({ objectId: object.id, path: schemaEntry.path });
  const declaredDependencyKeys = new Set(
    edges.filter((edge) => addressKey(edge.dependentSlot) === ownKey).map((edge) => addressKey(edge.sourceSlot)),
  );

  const read = (address: Address): Value | undefined => {
    const addressAsKey = addressKey(address);
    const rawValue = readValue(address);
    if (isEmptyInExtentCell(address, rawValue, objects)) {
      return 0;
    }
    if (!declaredDependencyKeys.has(addressAsKey)) {
      return {
        error: "#REF",
        message: "derived slot's compute function read an address outside its declared dependencies",
      };
    }
    return rawValue;
  };

  const readRange = buildRangeReader(objects, readValue);

  return schemaEntry.compute(object, read, context, { readRange, objects });
}

function findDerivedSlotSchemaByKey(
  derivedSlots: readonly DerivedSlotSchema[] | undefined,
  key: string,
): DerivedSlotSchema | undefined {
  return derivedSlots?.find((entry) => slotKey(entry.path) === key);
}
