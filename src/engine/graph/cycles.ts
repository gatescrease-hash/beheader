/**
 * cycles.ts
 *
 * Finds a cycle in the edge set with a depth first search, so that mutation.ts
 * can refuse a mutation that would make one.
 *
 * A cycle is always an error here and never something to resolve. When
 * detectCycle finds one it returns every slot around the loop in order,
 * because the operator cannot fix a circular reference without seeing which
 * slots take part in it.
 *
 * The search runs from scratch over the whole edge set on every mutation. This
 * code is unoptimized for the sake of simplicity, and it has no incremental
 * mode.
 * An explicit stack preserves depth first order without consuming a call
 * frame for each dependent slot in a long chain.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import { addressKey, type Edge } from "./edge.ts";
import type { Address } from "../address.ts";

export type CycleCheckResult =
  | { readonly hasCycle: false }
  | { readonly hasCycle: true; readonly cycle: readonly Address[] };

type Color = "white" | "gray" | "black";

/** Searches the whole edge set. On a cycle it returns every slot in it, in order. */
export function detectCycle(edges: readonly Edge[]): CycleCheckResult {
  const allNodes = new Map<string, Address>();
  const outgoing = new Map<string, Address[]>();

  function outgoingArcsFor(address: Address): Address[] {
    const key = addressKey(address);
    const existing = outgoing.get(key);
    if (existing !== undefined) {
      return existing;
    }
    allNodes.set(key, address);
    const created: Address[] = [];
    outgoing.set(key, created);
    return created;
  }

  for (const edge of edges) {
    outgoingArcsFor(edge.dependentSlot);
    outgoingArcsFor(edge.sourceSlot).push(edge.dependentSlot);
  }

  const colors = new Map<string, Color>();
  function colorOf(key: string): Color {
    return colors.get(key) ?? "white";
  }

  const stack: { address: Address; next: number }[] = [];
  for (const [key, address] of allNodes) {
    if (colorOf(key) !== "white") continue;
    colors.set(key, "gray");
    stack.push({ address, next: 0 });
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const frameKey = addressKey(frame.address);
      const neighbor = outgoing.get(frameKey)?.[frame.next++];
      if (neighbor === undefined) {
        colors.set(frameKey, "black");
        stack.pop();
        continue;
      }
      const neighborKey = addressKey(neighbor);
      const neighborColor = colorOf(neighborKey);
      if (neighborColor === "gray") {
        const start = stack.findIndex((entry) => addressKey(entry.address) === neighborKey);
        return { hasCycle: true, cycle: stack.slice(start).map((entry) => entry.address) };
      }
      if (neighborColor === "white") {
        colors.set(neighborKey, "gray");
        stack.push({ address: neighbor, next: 0 });
      }
    }
  }

  return { hasCycle: false };
}
