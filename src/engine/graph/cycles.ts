/**
 * cycles.ts
 *
 * Cycle detection walks the whole edge set, depth first.
 *
 * A cycle is an error, and never a problem to solve. The result names every
 * slot in the cycle, because that message is the whole debug story for the
 * operator.
 *
 * The search runs from scratch on every mutation. That is Rule 5 at work.
 *
 * The file belongs to the engine layer and works on plain data alone. It does
 * not use the DOM, a window or a canvas. That keeps it testable without a
 * browser, and ready for a port to Rust.
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
