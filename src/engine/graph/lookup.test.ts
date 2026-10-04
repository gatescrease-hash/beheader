/**
 * lookup.test.ts
 *
 * These tests cover the lookup a whole-document pass builds from an edge
 * array: objects by ID, and the dependents and sources of a slot in edge order.
 */
import { describe, expect, it } from "vitest";
import { lookupFromEdges } from "./lookup.ts";
import type { GraphObject } from "./node.ts";

const value = (id: string): GraphObject => ({ id, name: id, type: "value", slots: { value: { kind: "literal", value: 1 } } });
const at = (objectId: string) => ({ objectId, path: ["value"] });

describe("lookupFromEdges", () => {
  it("answers dependents and sources in edge order, and an empty list for a slot with none", () => {
    const lookup = lookupFromEdges([value("a"), value("b"), value("c")], [
      { sourceSlot: at("a"), dependentSlot: at("b") },
      { sourceSlot: at("a"), dependentSlot: at("c") },
      { sourceSlot: at("b"), dependentSlot: at("c") },
    ]);
    expect(lookup.dependents("a::value")).toEqual([at("b"), at("c")]);
    expect(lookup.sources("c::value")).toEqual([at("a"), at("b")]);
    expect(lookup.dependents("c::value")).toEqual([]);
    expect(lookup.objectById("b")?.id).toBe("b");
    expect(lookup.objectById("missing")).toBeUndefined();
  });
});
