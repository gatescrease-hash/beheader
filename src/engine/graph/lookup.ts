/**
 * lookup.ts
 *
 * The read side of a dependency graph: an object by its ID, the dependents of a
 * slot, and the sources of a slot. Evaluation and the affected-region search
 * read the graph through GraphLookup rather than through an edge array, so each
 * question costs the size of its answer instead of a pass over every edge.
 *
 * lookupFromEdges builds one from an object list and an edge array, which is
 * what a whole-document pass has in hand. The committed-state index in
 * graph-index.ts answers the same questions for a state it already knows,
 * which is how a small batch avoids rebuilding the maps below at all.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import type { Address } from "../address.ts";
import { addressKey, type Edge } from "./edge.ts";
import type { GraphObject } from "./node.ts";

export interface GraphLookup {
  objectById(id: string): GraphObject | undefined;
  /** The slots that read the slot with this address key. */
  dependents(key: string): readonly Address[];
  /** The slots that the slot with this address key reads. */
  sources(key: string): readonly Address[];
}

const NONE: readonly Address[] = [];

function appendTo(map: Map<string, Address[]>, key: string, address: Address): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [address]);
  } else {
    existing.push(address);
  }
}

/** Builds the dependents and sources of every slot from the edge array, in edge order. */
export function lookupFromEdges(objects: readonly GraphObject[], edges: readonly Edge[]): GraphLookup {
  const objectsById = new Map(objects.map((object) => [object.id, object]));
  const dependents = new Map<string, Address[]>();
  const sources = new Map<string, Address[]>();
  for (const edge of edges) {
    appendTo(dependents, addressKey(edge.sourceSlot), edge.dependentSlot);
    appendTo(sources, addressKey(edge.dependentSlot), edge.sourceSlot);
  }
  return {
    objectById: (id) => objectsById.get(id),
    dependents: (key) => dependents.get(key) ?? NONE,
    sources: (key) => sources.get(key) ?? NONE,
  };
}
