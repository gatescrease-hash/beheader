/**
 * graph-index.test.ts
 *
 * These tests cover the committed-state index on its own: building it from an
 * edge array, laying a batch's edge changes over it without touching it, and
 * handing it from one list to the next on commit. mutation.test.ts covers the
 * batches that read it.
 */
import { describe, expect, it } from "vitest";
import { NULL_EVAL_CONTEXT } from "../eval-context.ts";
import { attachGraphIndex, buildGraphIndex, commitGraphIndex, edgeChanges, graphIndexOf, stagedLookup } from "./graph-index.ts";
import type { Edge } from "./edge.ts";
import type { GraphObject } from "./node.ts";

const value = (id: string): GraphObject => ({ id, name: id, type: "value", slots: { value: { kind: "literal", value: 1 } } });
const at = (objectId: string) => ({ objectId, path: ["value"] });
const edge = (from: string, to: string): Edge => ({ sourceSlot: at(from), dependentSlot: at(to) });

describe("the committed-state index", () => {
  const objects = [value("a"), value("b"), value("c")];
  const edges = [edge("a", "c"), edge("b", "c")];

  it("groups edges by the object of their dependent slot, and indexes both directions", () => {
    const index = buildGraphIndex(objects, edges, [], NULL_EVAL_CONTEXT);
    expect(index.positions.get("c")).toBe(2);
    expect(index.ownEdges.get("c")).toEqual(edges);
    expect(index.dependents.get("a::value")).toEqual([at("c")]);
    expect(index.sources.get("c::value")).toEqual([at("a"), at("b")]);
  });

  it("lays a rewiring over the index for a staged lookup and changes nothing in it until commit", () => {
    const index = buildGraphIndex(objects, edges, [], NULL_EVAL_CONTEXT);
    attachGraphIndex(objects, index);
    const changes = edgeChanges(index, new Map([["c", [edge("b", "c")]]]));
    const staged = stagedLookup(objects, index, changes);
    expect(staged.sources("c::value")).toEqual([at("b")]);
    expect(staged.dependents("a::value")).toEqual([]);
    expect(index.sources.get("c::value")).toEqual([at("a"), at("b")]);
    expect(index.dependents.get("a::value")).toEqual([at("c")]);

    const next = [...objects];
    commitGraphIndex(index, changes, NULL_EVAL_CONTEXT, objects, next);
    expect(graphIndexOf(objects)).toBeUndefined();
    expect(graphIndexOf(next)).toBe(index);
    expect(index.dependents.has("a::value")).toBe(false);
    expect(index.sources.get("c::value")).toEqual([at("b")]);
  });

  it("refuses to describe a list whose length no longer matches", () => {
    const index = buildGraphIndex(objects, edges, [], NULL_EVAL_CONTEXT);
    const list = [...objects];
    attachGraphIndex(list, index);
    list.push(value("d"));
    expect(graphIndexOf(list)).toBeUndefined();
  });
});
