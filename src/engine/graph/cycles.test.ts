/**
 * cycles.test.ts
 *
 * These tests cover cycle detection, where a found cycle names every slot in
 * it.
 */

import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import { addressKey, type Edge } from "./edge.ts";
import { detectCycle } from "./cycles.ts";

function slot(objectId: string, ...path: readonly string[]): Address {
  return { objectId, path };
}

function edge(source: Address, dependent: Address): Edge {
  return { sourceSlot: source, dependentSlot: dependent };
}

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
  it("detects a self-referencing edge as a genuine one-slot cycle, with no special case", () => {
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
      edge(unrelatedA, unrelatedB),
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


describe("deep graph traversal", () => {
  it("finds a late cycle in a 20000-node chain and accepts the open chain", () => {
    const addresses = Array.from({ length: 20000 }, (_, index) => slot(String(index), "value"));
    const edges = addresses.slice(1).map((address, index) => edge(addresses[index]!, address));
    expect(detectCycle(edges)).toEqual({ hasCycle: false });
    const cycle = detectCycle([...edges, edge(addresses[19999]!, addresses[19997]!)]);
    expect(cycle).toEqual({ hasCycle: true, cycle: addresses.slice(19997) });
  });
});
