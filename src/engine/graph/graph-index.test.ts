/**
 * graph-index.test.ts
 *
 * These tests cover the committed-state index on its own: building it from an
 * edge array and per-object facts, the name scope a text resolves against,
 * laying a batch's changes over it without touching it, and handing it from
 * one list to the next on commit. mutation.test.ts covers the batches that
 * read it.
 */
import { describe, expect, it } from "vitest";
import { NULL_EVAL_CONTEXT } from "../eval-context.ts";
import {
  attachGraphIndex,
  buildGraphIndex,
  commitGraphIndex,
  edgeChanges,
  graphIndexOf,
  nameScope,
  stagedLookup,
  wordsOf,
  type GraphIndexChanges,
  type ObjectFacts,
} from "./graph-index.ts";
import type { Edge } from "./edge.ts";
import type { GraphObject } from "./node.ts";

const value = (id: string, name = id): GraphObject => ({ id, name, type: "value", slots: { value: { kind: "literal", value: 1 } } });
const at = (objectId: string) => ({ objectId, path: ["value"] });
const edge = (from: string, to: string): Edge => ({ sourceSlot: at(from), dependentSlot: at(to) });
const referencesFromEdges = (_object: GraphObject, ownEdges: readonly Edge[]): ObjectFacts => ({
  references: [...new Set(ownEdges.map((own) => own.sourceSlot.objectId))],
  words: [],
  contextSlots: [],
});

describe("the committed-state index", () => {
  const objects = [value("a"), value("b"), value("c")];
  const edges = [edge("a", "c"), edge("b", "c")];

  it("groups edges by the object of their dependent slot, and indexes both directions and the objects that name each object", () => {
    const index = buildGraphIndex(objects, edges, referencesFromEdges, NULL_EVAL_CONTEXT);
    expect(index.byId.get("c")).toBe(objects[2]);
    expect(index.ownEdges.get("c")).toEqual(edges);
    expect(index.dependents.get("a::value")).toEqual([at("c")]);
    expect(index.sources.get("c::value")).toEqual([at("a"), at("b")]);
    expect([...(index.referrers.get("a") ?? [])]).toEqual(["c"]);
    expect([...(index.names.get("b") ?? [])]).toEqual(["b"]);
  });

  it("lays a batch over the index for a staged lookup, changes nothing in it until commit, then hands it on", () => {
    const index = buildGraphIndex(objects, edges, referencesFromEdges, NULL_EVAL_CONTEXT);
    attachGraphIndex(objects, index);
    const renamed = { ...objects[2]!, name: "renamed" };
    const ownEdges = new Map([["c", [edge("b", "c")]]]);
    const changes: GraphIndexChanges = {
      objects: new Map<string, GraphObject | null>([["c", renamed], ["a", null]]),
      ownEdges,
      facts: new Map([["c", referencesFromEdges(renamed, [edge("b", "c")])]]),
      ...edgeChanges(index, ownEdges),
    };
    const staged = stagedLookup(index, changes);
    expect(staged.sources("c::value")).toEqual([at("b")]);
    expect(staged.dependents("a::value")).toEqual([]);
    expect(staged.objectById("a")).toBeUndefined();
    expect(staged.objectById("c")?.name).toBe("renamed");
    expect(index.sources.get("c::value")).toEqual([at("a"), at("b")]);
    expect(index.byId.has("a")).toBe(true);

    const next = [objects[1]!, renamed];
    commitGraphIndex(index, changes, [], NULL_EVAL_CONTEXT, objects, next);
    expect(graphIndexOf(objects)).toBeUndefined();
    expect(graphIndexOf(next)).toBe(index);
    expect(index.byId.has("a")).toBe(false);
    expect(index.names.has("c")).toBe(false);
    expect([...(index.names.get("renamed") ?? [])]).toEqual(["c"]);
    expect(index.referrers.has("a")).toBe(false);
    expect(index.dependents.has("a::value")).toBe(false);
  });

  it("refuses to describe a list whose length no longer matches", () => {
    const index = buildGraphIndex(objects, edges, referencesFromEdges, NULL_EVAL_CONTEXT);
    const list = [...objects];
    attachGraphIndex(list, index);
    list.push(value("d"));
    expect(graphIndexOf(list)).toBeUndefined();
  });
});

describe("the words and name scope a text resolves against", () => {
  it("lowercases each run of letters, digits and underscores once", () => {
    expect(wordsOf("Speed {= Circle_1.radius * 2 } and circle_1")).toEqual(["speed", "circle_1", "radius", "2", "and"]);
  });

  it("finds the objects a word names, in any case, and always the document variable object", () => {
    const doc: GraphObject = { id: "d", name: "doc", type: "doc", slots: {} };
    const circle = value("c1", "Circle_1");
    const byId = new Map([["d", doc], ["c1", circle]]);
    const names = new Map([["doc", ["d"]], ["circle_1", ["c1"]]]);
    const scope = nameScope((word) => names.get(word) ?? [], (id) => byId.get(id));
    expect(scope(["circle_1", "radius"])).toEqual([circle, doc]);
    expect(scope([])).toEqual([doc]);
  });
});
