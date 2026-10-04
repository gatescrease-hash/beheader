/**
 * graph-index.ts
 *
 * An index of a committed document state: where each object sits in the list,
 * the edges whose dependent slot belongs to each object, the dependents and
 * sources of every slot, and the slots that read the evaluation context.
 * mutation.ts builds one for every state it commits, and a later batch that
 * writes slots which already exist reads it instead of deriving and checking
 * the whole document again.
 *
 * The index is a cache beside graph state rather than part of it. It lives in
 * a WeakMap keyed by the object list it describes, so graph state stays plain
 * data, a list nobody refers to any more takes its index with it, and a list
 * that did not come from mutate() has no index and takes the whole-document
 * path. That path is also the reference the differential test compares the
 * indexed path against, so the index never decides a result on its own.
 *
 * The maps inside are mutable, and one index belongs to one list at a time. A
 * batch that commits through the index hands it on to the list it commits,
 * after updating it in place, and the list before the batch loses it. A later
 * call with that earlier list, such as an undo replay, finds no index and
 * builds a new one on the whole-document path. Handing the index on rather
 * than copying it keeps a commit in proportion to the edges the batch changed.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import type { Address } from "../address.ts";
import type { EvalContext } from "../eval-context.ts";
import { addressKey, type Edge } from "./edge.ts";
import type { GraphLookup } from "./lookup.ts";
import type { GraphObject } from "./node.ts";

export interface GraphIndex {
  readonly positions: ReadonlyMap<string, number>;
  /** The edges whose dependent slot belongs to each object, keyed by object ID. */
  readonly ownEdges: Map<string, readonly Edge[]>;
  readonly dependents: Map<string, readonly Address[]>;
  readonly sources: Map<string, readonly Address[]>;
  /** Every derived slot whose schema entry reads the evaluation context. */
  readonly contextSlots: readonly Address[];
  /** The context those slots were last evaluated against. */
  context: EvalContext;
}

/** Replacement entries for the dependents and sources maps, which a batch builds before it commits. */
export interface GraphIndexChanges {
  readonly ownEdges: ReadonlyMap<string, readonly Edge[]>;
  readonly dependents: ReadonlyMap<string, readonly Address[]>;
  readonly sources: ReadonlyMap<string, readonly Address[]>;
}

const NONE: readonly Address[] = [];
const indexes = new WeakMap<readonly GraphObject[], GraphIndex>();

export function buildGraphIndex(
  objects: readonly GraphObject[],
  edges: readonly Edge[],
  contextSlots: readonly Address[],
  context: EvalContext,
): GraphIndex {
  const positions = new Map(objects.map((object, position) => [object.id, position]));
  const ownEdges = new Map<string, Edge[]>();
  const dependents = new Map<string, Address[]>();
  const sources = new Map<string, Address[]>();
  for (const edge of edges) {
    const own = ownEdges.get(edge.dependentSlot.objectId);
    if (own === undefined) ownEdges.set(edge.dependentSlot.objectId, [edge]);
    else own.push(edge);
    const sourceKey = addressKey(edge.sourceSlot);
    const dependentKey = addressKey(edge.dependentSlot);
    const outgoing = dependents.get(sourceKey);
    if (outgoing === undefined) dependents.set(sourceKey, [edge.dependentSlot]);
    else outgoing.push(edge.dependentSlot);
    const incoming = sources.get(dependentKey);
    if (incoming === undefined) sources.set(dependentKey, [edge.sourceSlot]);
    else incoming.push(edge.sourceSlot);
  }
  return { positions, ownEdges, dependents, sources, contextSlots, context };
}

/** The index of this list, or undefined when the list did not come from a commit that left one. */
export function graphIndexOf(objects: readonly GraphObject[]): GraphIndex | undefined {
  const index = indexes.get(objects);
  return index !== undefined && index.positions.size === objects.length ? index : undefined;
}

export function attachGraphIndex(objects: readonly GraphObject[], index: GraphIndex): void {
  indexes.set(objects, index);
}

/**
 * The graph a batch has staged, read through the committed index with the
 * batch's own changes laid over it. Nothing in the index changes until the
 * batch commits, so a refusal leaves it describing the list it belongs to.
 */
export function stagedLookup(
  objects: readonly GraphObject[],
  index: GraphIndex,
  changes: GraphIndexChanges,
): GraphLookup {
  return {
    objectById: (id) => {
      const position = index.positions.get(id);
      return position === undefined ? undefined : objects[position];
    },
    dependents: (key) => changes.dependents.get(key) ?? index.dependents.get(key) ?? NONE,
    sources: (key) => changes.sources.get(key) ?? index.sources.get(key) ?? NONE,
  };
}

/**
 * The replacement entries that swap the edges of each changed object for new
 * ones. A dependents entry keeps every dependent outside the changed object in
 * its order, then appends the new ones, and a sources entry is rebuilt from the
 * new edges. Evaluation sorts the slots it visits by dependency, so the order
 * within an entry has no effect on any value.
 */
export function edgeChanges(index: GraphIndex, replaced: ReadonlyMap<string, readonly Edge[]>): GraphIndexChanges {
  // Every entry below is a fresh array, so the pushes never reach a list the
  // committed index still holds.
  const dependents = new Map<string, Address[]>();
  const sources = new Map<string, readonly Address[]>();
  for (const [objectId, edges] of replaced) {
    const old = index.ownEdges.get(objectId) ?? [];
    const touchedSources = new Set([...old, ...edges].map((edge) => addressKey(edge.sourceSlot)));
    for (const sourceKey of touchedSources) {
      const current = dependents.get(sourceKey) ?? index.dependents.get(sourceKey) ?? NONE;
      dependents.set(sourceKey, current.filter((address) => address.objectId !== objectId));
    }
    for (const edge of old) {
      sources.set(addressKey(edge.dependentSlot), NONE);
    }
    const rebuilt = new Map<string, Address[]>();
    for (const edge of edges) {
      dependents.get(addressKey(edge.sourceSlot))!.push(edge.dependentSlot);
      const incoming = rebuilt.get(addressKey(edge.dependentSlot));
      if (incoming === undefined) rebuilt.set(addressKey(edge.dependentSlot), [edge.sourceSlot]);
      else incoming.push(edge.sourceSlot);
    }
    for (const [key, list] of rebuilt) {
      sources.set(key, list);
    }
  }
  return { ownEdges: replaced, dependents, sources };
}

/**
 * Applies a batch's changes and hands the index from the list before the batch
 * to the list it committed.
 */
export function commitGraphIndex(
  index: GraphIndex,
  changes: GraphIndexChanges,
  context: EvalContext,
  previous: readonly GraphObject[],
  next: readonly GraphObject[],
): void {
  for (const [objectId, edges] of changes.ownEdges) {
    if (edges.length === 0) index.ownEdges.delete(objectId);
    else index.ownEdges.set(objectId, edges);
  }
  for (const [key, list] of changes.dependents) {
    if (list.length === 0) index.dependents.delete(key);
    else index.dependents.set(key, list);
  }
  for (const [key, list] of changes.sources) {
    if (list.length === 0) index.sources.delete(key);
    else index.sources.set(key, list);
  }
  index.context = context;
  indexes.delete(previous);
  indexes.set(next, index);
}
