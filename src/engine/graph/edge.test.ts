/**
 * edge.test.ts
 *
 * These tests cover the edge record and its key.
 */

import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import { addressKey, type Edge } from "./edge.ts";

describe("Edge", () => {
  it("is sourceSlot -> dependentSlot", () => {
    const sourceSlot: Address = { objectId: "obj_1", path: ["value"] };
    const dependentSlot: Address = { objectId: "obj_2", path: ["in", "a"] };
    const edge: Edge = { sourceSlot, dependentSlot };
    expect(edge.sourceSlot).toEqual({ objectId: "obj_1", path: ["value"] });
    expect(edge.dependentSlot).toEqual({ objectId: "obj_2", path: ["in", "a"] });
  });

  it("a self-referencing edge is representable as data (rejection happens elsewhere, at mutation time)", () => {
    const slot: Address = { objectId: "obj_1", path: ["a"] };
    const edge: Edge = { sourceSlot: slot, dependentSlot: slot };
    expect(edge.sourceSlot).toEqual(edge.dependentSlot);
  });
});

describe("addressKey", () => {
  it("joins objectId and the slot's path with '::'", () => {
    const address: Address = { objectId: "obj_3", path: ["cells", "A1"] };
    expect(addressKey(address)).toBe("obj_3::cells.A1");
  });

  it("is equal for two structurally-equal Addresses that are different array/object instances", () => {
    const a: Address = { objectId: "obj_1", path: ["origin", "x"] };
    const b: Address = { objectId: "obj_1", path: ["origin", "x"] };
    expect(addressKey(a)).toBe(addressKey(b));
  });

  it("distinguishes the SAME path on two DIFFERENT objects (the reason this differs from slotKey)", () => {
    const tableA: Address = { objectId: "obj_1", path: ["cells", "A1"] };
    const tableB: Address = { objectId: "obj_2", path: ["cells", "A1"] };
    expect(addressKey(tableA)).not.toBe(addressKey(tableB));
  });

  it("distinguishes two different paths on the SAME object", () => {
    const x: Address = { objectId: "obj_1", path: ["origin", "x"] };
    const y: Address = { objectId: "obj_1", path: ["origin", "y"] };
    expect(addressKey(x)).not.toBe(addressKey(y));
  });
});
