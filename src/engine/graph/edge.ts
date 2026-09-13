/**
 * edge.ts
 *
 * An Edge record points from a source slot to a dependent slot.
 *
 * The operator never makes an edge. Only mutation.ts derives one, from a
 * formula AST or from a schema. This file is small on purpose.
 *
 * The file belongs to the engine layer and works on plain data alone. It does
 * not use the DOM, a window or a canvas. That keeps it testable without a
 * browser, and ready for a port to Rust.
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
