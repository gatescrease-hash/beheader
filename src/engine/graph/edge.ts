/**
 * edge.ts
 *
 * An Edge is a dependency: it points from the slot that supplies a value to
 * the slot that reads it. addressKey turns an address into the string the
 * cycle check and the topological sort use to compare two slots.
 *
 * Nothing outside mutation.ts ever builds an Edge. The whole edge set is
 * derived from scratch on every mutation, out of the stored formula ASTs and
 * the schema, so an edge cannot go stale or survive the slot it pointed at.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import { slotKey } from "./node.ts";
import type { Address } from "../address.ts";

export interface Edge {
  readonly sourceSlot: Address;
  readonly dependentSlot: Address;
}

export function addressKey(address: Address): string {
  return `${address.objectId}::${slotKey(address.path)}`;
}
