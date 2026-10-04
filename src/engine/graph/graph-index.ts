/**
 * graph-index.ts
 *
 * An index of a committed document state. It holds each object by its ID, the
 * edges whose dependent slot belongs to each object, the dependents and
 * sources of every slot, the objects each object names and the reverse, the
 * IDs behind each object name, the words in each text object's content and the
 * reverse, and the slots that read the evaluation context. mutation.ts builds
 * one for every state it commits, and a later batch reads it to find the
 * objects it has to look at again instead of deriving and checking the whole
 * document.
 *
 * The objects one object names are the reason the reverse map exists. An
 * object's edges and its checks read the objects it names: their slot sets,
 * their table extents, a copy's variable and a member's layer. So when a batch
 * changes an object, the objects that name it are the only others whose edges
 * or checks can change. A formula names objects by ID, and so do a math source,
 * a copy's target and a layer membership. Text content names them by the name
 * they carry, which is resolved again every time the content is read, so a
 * batch that creates, renames or deletes an object also has to reach every text
 * whose content holds that name as a word. The word map covers that. A word is
 * any lowercased run of the characters a name can hold, so it takes in every
 * spelling a name can be resolved from, and some that it cannot.
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
 * than copying it keeps a commit in proportion to what the batch changed.
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
  readonly byId: Map<string, GraphObject>;
  /** The edges whose dependent slot belongs to each object, keyed by object ID. */
  readonly ownEdges: Map<string, readonly Edge[]>;
  readonly dependents: Map<string, readonly Address[]>;
  readonly sources: Map<string, readonly Address[]>;
  /** The IDs each object names. */
  readonly references: Map<string, readonly string[]>;
  /** The IDs of the objects that name each ID. */
  readonly referrers: Map<string, Set<string>>;
  /** The IDs carrying each lowercased object name. */
  readonly names: Map<string, Set<string>>;
  /** The lowercased words in each text object's content. */
  readonly words: Map<string, readonly string[]>;
  /** The IDs of the text objects whose content holds each word. */
  readonly readersOfWord: Map<string, Set<string>>;
  /** The derived slots of each object whose schema entry reads the evaluation context. */
  readonly contextSlots: Map<string, readonly Address[]>;
  /** The context those slots were last evaluated against. */
  context: EvalContext;
}

/** What one object contributes to the index apart from its edges. */
export interface ObjectFacts {
  readonly references: readonly string[];
  readonly words: readonly string[];
  readonly contextSlots: readonly Address[];
}

/**
 * Everything a batch changes in the index, built before it commits. An object
 * mapped to null is one the batch deleted. Each object in `objects` carries its
 * edges in `ownEdges` and its facts in `facts`.
 */
export interface GraphIndexChanges {
  readonly objects: ReadonlyMap<string, GraphObject | null>;
  readonly ownEdges: ReadonlyMap<string, readonly Edge[]>;
  readonly facts: ReadonlyMap<string, ObjectFacts>;
  readonly dependents: ReadonlyMap<string, readonly Address[]>;
  readonly sources: ReadonlyMap<string, readonly Address[]>;
}

const NONE: readonly Address[] = [];
const indexes = new WeakMap<readonly GraphObject[], GraphIndex>();

/** The lowercased words of a text, which include every spelling of a name it can hold. */
export function wordsOf(text: string): readonly string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9_]+/g) ?? [])];
}

function addTo(map: Map<string, Set<string>>, key: string, id: string): void {
  const set = map.get(key);
  if (set === undefined) map.set(key, new Set([id]));
  else set.add(id);
}

function removeFrom(map: Map<string, Set<string>>, key: string, id: string): void {
  const set = map.get(key);
  if (set === undefined) return;
  set.delete(id);
  if (set.size === 0) map.delete(key);
}

export function buildGraphIndex(
  objects: readonly GraphObject[],
  edges: readonly Edge[],
  factsOf: (object: GraphObject, ownEdges: readonly Edge[], scope: NameScope) => ObjectFacts,
  context: EvalContext,
): GraphIndex {
  const index: GraphIndex = {
    byId: new Map(),
    ownEdges: new Map(),
    dependents: new Map(),
    sources: new Map(),
    references: new Map(),
    referrers: new Map(),
    names: new Map(),
    words: new Map(),
    readersOfWord: new Map(),
    contextSlots: new Map(),
    context,
  };
  const ownEdges = new Map<string, Edge[]>();
  const dependents = new Map<string, Address[]>();
  const sources = new Map<string, Address[]>();
  for (const edge of edges) {
    const own = ownEdges.get(edge.dependentSlot.objectId);
    if (own === undefined) ownEdges.set(edge.dependentSlot.objectId, [edge]);
    else own.push(edge);
    const outgoing = dependents.get(addressKey(edge.sourceSlot));
    if (outgoing === undefined) dependents.set(addressKey(edge.sourceSlot), [edge.dependentSlot]);
    else outgoing.push(edge.dependentSlot);
    const incoming = sources.get(addressKey(edge.dependentSlot));
    if (incoming === undefined) sources.set(addressKey(edge.dependentSlot), [edge.sourceSlot]);
    else incoming.push(edge.sourceSlot);
  }
  for (const [key, list] of ownEdges) index.ownEdges.set(key, list);
  for (const [key, list] of dependents) index.dependents.set(key, list);
  for (const [key, list] of sources) index.sources.set(key, list);
  for (const object of objects) {
    index.byId.set(object.id, object);
    addTo(index.names, object.name.toLowerCase(), object.id);
  }
  const scope = nameScope((word) => index.names.get(word) ?? [], (id) => index.byId.get(id));
  for (const object of objects) {
    recordFacts(index, object.id, factsOf(object, ownEdges.get(object.id) ?? [], scope));
  }
  return index;
}

/**
 * The objects a text could resolve a name against, given the words in it: the
 * objects named by one of those words, and the document variable object, which
 * a bare variable name resolves through. Name resolution compares lowercased
 * names, so resolving against this list finds every object resolving against
 * the whole document would find.
 */
export type NameScope = (words: readonly string[]) => readonly GraphObject[];

export function nameScope(holders: (word: string) => Iterable<string>, objectById: (id: string) => GraphObject | undefined): NameScope {
  return (words) => {
    const found = new Map<string, GraphObject>();
    for (const word of [...words, "doc"]) {
      for (const id of holders(word)) {
        const object = objectById(id);
        if (object !== undefined && object.name.toLowerCase() === word) found.set(id, object);
      }
    }
    return [...found.values()];
  };
}

function recordFacts(index: GraphIndex, id: string, facts: ObjectFacts): void {
  index.references.set(id, facts.references);
  for (const referenced of facts.references) addTo(index.referrers, referenced, id);
  if (facts.words.length > 0) index.words.set(id, facts.words);
  for (const word of facts.words) addTo(index.readersOfWord, word, id);
  if (facts.contextSlots.length > 0) index.contextSlots.set(id, facts.contextSlots);
}

function forgetFacts(index: GraphIndex, id: string): void {
  for (const referenced of index.references.get(id) ?? []) removeFrom(index.referrers, referenced, id);
  for (const word of index.words.get(id) ?? []) removeFrom(index.readersOfWord, word, id);
  index.references.delete(id);
  index.words.delete(id);
  index.contextSlots.delete(id);
}

/** The index of this list, or undefined when the list did not come from a commit that left one. */
export function graphIndexOf(objects: readonly GraphObject[]): GraphIndex | undefined {
  const index = indexes.get(objects);
  return index !== undefined && index.byId.size === objects.length ? index : undefined;
}

export function attachGraphIndex(objects: readonly GraphObject[], index: GraphIndex): void {
  indexes.set(objects, index);
}

/** An object of the staged state: the batch's own version, or else the committed one. */
export function stagedObject(index: GraphIndex, objects: ReadonlyMap<string, GraphObject | null>, id: string): GraphObject | undefined {
  const staged = objects.get(id);
  return staged === null ? undefined : staged ?? index.byId.get(id);
}

/**
 * The graph a batch has staged, read through the committed index with the
 * batch's own changes laid over it. Nothing in the index changes until the
 * batch commits, so a refusal leaves it describing the list it belongs to.
 * With no changes it reads the committed state.
 */
export function stagedLookup(index: GraphIndex, changes?: GraphIndexChanges): GraphLookup {
  return {
    objectById: (id) => (changes === undefined ? index.byId.get(id) : stagedObject(index, changes.objects, id)),
    dependents: (key) => changes?.dependents.get(key) ?? index.dependents.get(key) ?? NONE,
    sources: (key) => changes?.sources.get(key) ?? index.sources.get(key) ?? NONE,
  };
}

/**
 * The replacement dependents and sources entries for a batch whose objects
 * carry new edges. A dependents entry keeps every dependent outside the changed
 * objects in its order, then appends the new ones, and a sources entry is
 * rebuilt from the new edges. Evaluation sorts the slots it visits by
 * dependency, so the order within an entry has no effect on any value.
 */
export function edgeChanges(
  index: GraphIndex,
  ownEdges: ReadonlyMap<string, readonly Edge[]>,
): { readonly dependents: ReadonlyMap<string, readonly Address[]>; readonly sources: ReadonlyMap<string, readonly Address[]> } {
  const changed = new Set(ownEdges.keys());
  // Every entry below is a fresh array, so the pushes never reach a list the
  // committed index still holds.
  const dependents = new Map<string, Address[]>();
  const sources = new Map<string, Address[]>();
  for (const [objectId, edges] of ownEdges) {
    for (const edge of [...(index.ownEdges.get(objectId) ?? []), ...edges]) {
      const sourceKey = addressKey(edge.sourceSlot);
      if (!dependents.has(sourceKey)) {
        dependents.set(sourceKey, (index.dependents.get(sourceKey) ?? NONE).filter((address) => !changed.has(address.objectId)));
      }
    }
    for (const edge of index.ownEdges.get(objectId) ?? []) {
      sources.set(addressKey(edge.dependentSlot), []);
    }
  }
  for (const edges of ownEdges.values()) {
    for (const edge of edges) {
      dependents.get(addressKey(edge.sourceSlot))!.push(edge.dependentSlot);
      const dependentKey = addressKey(edge.dependentSlot);
      const incoming = sources.get(dependentKey);
      if (incoming === undefined) sources.set(dependentKey, [edge.sourceSlot]);
      else incoming.push(edge.sourceSlot);
    }
  }
  return { dependents, sources };
}

/**
 * Applies a batch's changes and hands the index from the list before the batch
 * to the list it committed. `evaluated` holds the records evaluation replaced
 * after staging, which are the ones the committed list carries.
 */
export function commitGraphIndex(
  index: GraphIndex,
  changes: GraphIndexChanges,
  evaluated: Iterable<GraphObject>,
  context: EvalContext,
  previous: readonly GraphObject[],
  next: readonly GraphObject[],
): void {
  for (const [id, object] of changes.objects) {
    const old = index.byId.get(id);
    if (old !== undefined) removeFrom(index.names, old.name.toLowerCase(), id);
    if (object === null) {
      index.byId.delete(id);
    } else {
      index.byId.set(id, object);
      addTo(index.names, object.name.toLowerCase(), id);
    }
  }
  for (const [id, facts] of changes.facts) {
    forgetFacts(index, id);
    if (changes.objects.get(id) !== null) recordFacts(index, id, facts);
  }
  for (const [id, object] of changes.objects) {
    if (object === null) forgetFacts(index, id);
  }
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
  for (const object of evaluated) {
    index.byId.set(object.id, object);
  }
  index.context = context;
  indexes.delete(previous);
  indexes.set(next, index);
}
