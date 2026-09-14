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

  const stack: Address[] = [];

  function visit(address: Address): readonly Address[] | undefined {
    const key = addressKey(address);
    colors.set(key, "gray");
    stack.push(address);

    for (const neighbor of outgoing.get(key) ?? []) {
      const neighborKey = addressKey(neighbor);
      const neighborColor = colorOf(neighborKey);

      if (neighborColor === "gray") {
        const cycleStart = stack.findIndex((onStack) => addressKey(onStack) === neighborKey);
        return stack.slice(cycleStart);
      }
      if (neighborColor === "white") {
        const found = visit(neighbor);
        if (found !== undefined) {
          return found;
        }
      }
    }

    colors.set(key, "black");
    stack.pop();
    return undefined;
  }

  for (const [key, address] of allNodes) {
    if (colorOf(key) === "white") {
      const cycle = visit(address);
      if (cycle !== undefined) {
        return { hasCycle: true, cycle };
      }
    }
  }

  return { hasCycle: false };
}
