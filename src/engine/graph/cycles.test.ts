/**
 * cycles.test.ts — Tests for naive DFS cycle detection (§5.1 step 5).
 *
 * Colocated with cycles.ts per D-001. These tests build `Edge[]` fixtures by
 * hand rather than deriving them from real formula ASTs through `mutation.ts`,
 * so they exercise cycle detection itself and nothing upstream of it.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import { addressKey, type Edge } from "./edge.ts";
import { detectCycle } from "./cycles.ts";

/** A short-hand for building a same-shaped Address in every test below. */
function slot(objectId: string, ...path: readonly string[]): Address {
  return { objectId, path };
}

/** A short-hand for building an Edge from two slot() calls. */
function edge(source: Address, dependent: Address): Edge {
  return { sourceSlot: source, dependentSlot: dependent };
}

/**
 * Verifies a reported cycle is a GENUINE cycle against the edges it was
 * detected from, rather than asserting one specific array literal — the DFS's
 * exact traversal order (which node it starts from, which neighbor it visits
 * first) is an implementation detail this test suite should not be pinned to.
 * A genuine cycle of length n has a real edge from cycle[i] to
 * cycle[(i + 1) % n] for every i, wrapping around.
 */
function isGenuineCycle(cycle: readonly Address[], edges: readonly Edge[]): boolean {
  if (cycle.length === 0) {
    return false;
  }
  return cycle.every((current, i) => {
    const next = cycle[(i + 1) % cycle.length];
    return edges.some(
      (candidate) => addressKey(candidate.sourceSlot) === addressKey(current) && addressKey(candidate.dependentSlot) === addressKey(next as Address),
    );
  });
}

describe("detectCycle — acyclic graphs report hasCycle: false", () => {
  it("reports no cycle for an empty edge set", () => {
    expect(detectCycle([])).toEqual({ hasCycle: false });
  });

  it("reports no cycle for a simple chain A -> B -> C", () => {
    const a = slot("obj_1", "value");
    const b = slot("obj_2", "in", "a");
    const c = slot("obj_3", "in", "a");
    const edges = [edge(a, b), edge(b, c)];
    expect(detectCycle(edges)).toEqual({ hasCycle: false });
  });

  it("reports no cycle for a diamond DAG (two paths converging on one node)", () => {
    // A -> B -> D and A -> C -> D. D has two inbound edges but the graph is
    // still acyclic — this is the case a naive "any node visited twice" check
    // (rather than real coloring) would get wrong.
    const a = slot("obj_1", "value");
    const b = slot("obj_2", "in", "a");
    const c = slot("obj_3", "in", "a");
    const d = slot("obj_4", "out", "result");
    const edges = [edge(a, b), edge(a, c), edge(b, d), edge(c, d)];
    expect(detectCycle(edges)).toEqual({ hasCycle: false });
  });

  it("reports no cycle across multiple disjoint acyclic components", () => {
    const a = slot("obj_1", "value");
    const b = slot("obj_2", "value");
    const x = slot("obj_3", "value");
    const y = slot("obj_4", "value");
    const edges = [edge(a, b), edge(x, y)];
    expect(detectCycle(edges)).toEqual({ hasCycle: false });
  });

  it("tolerates duplicate edges without falsely reporting a cycle", () => {
    const a = slot("obj_1", "value");
    const b = slot("obj_2", "in", "a");
    const edges = [edge(a, b), edge(a, b)];
    expect(detectCycle(edges)).toEqual({ hasCycle: false });
  });
});

describe("detectCycle — cyclic graphs report hasCycle: true, naming every slot in the cycle", () => {
  it("detects a self-referencing edge as a genuine one-slot cycle (§5.3: not special-cased)", () => {
    const a = slot("obj_1", "cells", "A6");
    const edges = [edge(a, a)];
    const result = detectCycle(edges);
    expect(result.hasCycle).toBe(true);
    if (result.hasCycle) {
      expect(result.cycle).toEqual([a]);
      expect(isGenuineCycle(result.cycle, edges)).toBe(true);
    }
  });

  it("detects a direct two-slot cycle A -> B -> A, naming both slots", () => {
    const a = slot("obj_1", "in", "a");
    const b = slot("obj_2", "out", "result");
    const edges = [edge(a, b), edge(b, a)];
    const result = detectCycle(edges);
    expect(result.hasCycle).toBe(true);
    if (result.hasCycle) {
      expect(result.cycle).toHaveLength(2);
      expect(new Set(result.cycle.map(addressKey))).toEqual(new Set([addressKey(a), addressKey(b)]));
      expect(isGenuineCycle(result.cycle, edges)).toBe(true);
    }
  });

  it("detects a longer cycle A -> B -> C -> A", () => {
    const a = slot("obj_1", "in", "a");
    const b = slot("obj_2", "in", "b");
    const c = slot("obj_3", "out", "result");
    const edges = [edge(a, b), edge(b, c), edge(c, a)];
    const result = detectCycle(edges);
    expect(result.hasCycle).toBe(true);
    if (result.hasCycle) {
      expect(result.cycle).toHaveLength(3);
      expect(isGenuineCycle(result.cycle, edges)).toBe(true);
    }
  });

  it("finds a cycle embedded among unrelated acyclic edges (full DFS over the whole graph, not just the first component)", () => {
    const unrelatedA = slot("obj_1", "value");
    const unrelatedB = slot("obj_2", "in", "a");
    const cycleA = slot("obj_3", "in", "a");
    const cycleB = slot("obj_4", "out", "result");
    const edges = [
      edge(unrelatedA, unrelatedB), // visited first (acyclic), and MUST NOT stop the DFS early
      edge(cycleA, cycleB),
      edge(cycleB, cycleA),
    ];
    const result = detectCycle(edges);
    expect(result.hasCycle).toBe(true);
    if (result.hasCycle) {
      expect(isGenuineCycle(result.cycle, edges)).toBe(true);
      expect(new Set(result.cycle.map(addressKey))).toEqual(new Set([addressKey(cycleA), addressKey(cycleB)]));
    }
  });

  it("detects a cycle reachable only after a non-cyclic detour (B has an extra outgoing edge to an unrelated node)", () => {
    // A -> B -> C -> A is the cycle; B ALSO points at an unrelated D. This
    // defends against an implementation that stops exploring a node's
    // neighbors as soon as ONE of them turns out to be acyclic.
    const a = slot("obj_1", "in", "a");
    const b = slot("obj_2", "in", "b");
    const c = slot("obj_3", "out", "result");
    const d = slot("obj_5", "value");
    const edges = [edge(a, b), edge(b, d), edge(b, c), edge(c, a)];
    const result = detectCycle(edges);
    expect(result.hasCycle).toBe(true);
    if (result.hasCycle) {
      expect(isGenuineCycle(result.cycle, edges)).toBe(true);
      expect(result.cycle.map(addressKey)).not.toContain(addressKey(d));
    }
  });

  it("names ONLY the slots in the cycle, never the upstream slots the DFS walked through to reach it", () => {
    // root -> tail -> a -> b -> a. The cycle is a <-> b; root and tail feed
    // into it but are NOT in it. §5.10 requires a rejection message to name
    // "the specific slots involved", and §6's acceptance criterion is that the
    // OFFENDING slots are named — naming an innocent upstream slot tells the
    // user a slot is in a cycle when it is not. This defends the one
    // non-obvious line in detectCycle: the reported cycle is sliced from where
    // the gray node ENTERED the stack, not from the stack's root.
    const root = slot("obj_1", "value");
    const tail = slot("obj_2", "in", "a");
    const a = slot("obj_3", "in", "a");
    const b = slot("obj_4", "out", "result");
    const edges = [edge(root, tail), edge(tail, a), edge(a, b), edge(b, a)];
    const result = detectCycle(edges);
    expect(result.hasCycle).toBe(true);
    if (result.hasCycle) {
      expect(isGenuineCycle(result.cycle, edges)).toBe(true);
      expect(new Set(result.cycle.map(addressKey))).toEqual(new Set([addressKey(a), addressKey(b)]));
    }
  });
});
