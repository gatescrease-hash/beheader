/**
 * edge.ts
 *
 * An Edge record points from a source slot to a dependent slot.
 *
 * The operator never makes an edge. Only mutation.ts derives one, from a
 * formula AST or from a schema. This file is small on purpose.
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
