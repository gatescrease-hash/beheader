/**
 * edge.test.ts — Tests for the Edge shape (§5.1).
 *
 * Colocated with edge.ts per D-001. Deriving edges from ASTs/schema declarations
 * is mutation.ts's job (not built yet) — these tests only confirm the shape.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import type { Edge } from "./edge.ts";

describe("Edge", () => {
  it("is sourceSlot -> dependentSlot, matching §5.1's definition exactly", () => {
    const sourceSlot: Address = { objectId: "obj_1", path: ["value"] };
    const dependentSlot: Address = { objectId: "obj_2", path: ["in", "a"] };
    const edge: Edge = { sourceSlot, dependentSlot };
    expect(edge.sourceSlot).toEqual({ objectId: "obj_1", path: ["value"] });
    expect(edge.dependentSlot).toEqual({ objectId: "obj_2", path: ["in", "a"] });
  });

  it("a self-referencing edge is representable as data (rejection happens elsewhere, at mutation time)", () => {
    // §5.3: "A self-inclusive range (A6 = SUM(A1:A6)) produces a genuine self-edge
    // and is correctly rejected as a cycle." Edge itself has no opinion on this —
    // graph/cycles.ts (not built yet) is what rejects it. This test pins that the
    // Edge shape does not (and should not) prevent constructing one.
    const slot: Address = { objectId: "obj_1", path: ["a"] };
    const edge: Edge = { sourceSlot: slot, dependentSlot: slot };
    expect(edge.sourceSlot).toEqual(edge.dependentSlot);
  });
});
