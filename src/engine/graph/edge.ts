/**
 * edge.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * The Edge record. An edge points from a source slot to a dependent slot.
 *
 * The operator never makes an edge. Only mutation.ts derives one, from a
 * formula AST or from a schema. This file is small on purpose.
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
