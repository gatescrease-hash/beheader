/**
 * groups.test.ts
 *
 * These tests cover group membership as the integrity check sees it, the
 * descendants of a group, the operations that group and ungroup objects, and
 * a group's ports and origin as ordinary slots other objects bind to.
 */
import { describe, expect, it } from "vitest";
import {
  ancestorGroups,
  createGroupObject,
  GROUP_MEMBERSHIP_PATH,
  groupDescendants,
  groupingOperations,
  groupOf,
  groupProblem,
  membershipProblem,
  ungroupingOperations,
} from "./groups.ts";
import type { GraphObject, Slot } from "./graph/node.ts";
import { FULL_EVALUATION_STRATEGY, mutate, type MutationJournalEntry, type Operation } from "./mutation.ts";

const value = (id: string, x = 0): GraphObject => ({ id, name: id, type: "value", slots: { value: { kind: "literal", value: x } } });
const member = (object: GraphObject, group: string | null): GraphObject =>
  ({ ...object, slots: { ...object.slots, "view.group": { kind: "literal", value: group } } });
const byIdIn = (objects: readonly GraphObject[]) => (id: string) => objects.find((object) => object.id === id);

describe("group membership", () => {
  it("reads the group an object belongs to, and none for an empty or absent membership", () => {
    expect(groupOf(member(value("a"), "g"))).toBe("g");
    expect(groupOf(member(value("a"), null))).toBeUndefined();
    expect(groupOf(value("a"))).toBeUndefined();
  });

  it("refuses a membership that is not a literal ID, or that names something other than a group", () => {
    const group = createGroupObject("g", "group_1", 0, 0);
    const objects = [group, value("v")];
    expect(membershipProblem(member(value("a"), "g"), byIdIn(objects))).toBeUndefined();
    expect(membershipProblem(member(value("a"), "v"), byIdIn(objects))).toContain("does not exist");
    expect(membershipProblem(member(value("a"), "missing"), byIdIn(objects))).toContain("does not exist");
    const formula: GraphObject = { ...value("a"), slots: { "view.group": { kind: "formula", ast: { type: "literal", value: "g" }, value: "g" } } };
    expect(membershipProblem(formula, byIdIn(objects))).toContain("must be a literal group ID");
  });

  it("refuses a group that sits inside itself through any chain", () => {
    const outer = member(createGroupObject("g1", "outer", 0, 0), "g2");
    const inner = member(createGroupObject("g2", "inner", 0, 0), "g1");
    expect(groupProblem([outer, inner])).toBe("outer: a group cannot sit inside itself");
    expect(groupProblem([member(createGroupObject("g1", "outer", 0, 0), "g1")])).toContain("cannot sit inside itself");
    expect(groupProblem([createGroupObject("g1", "outer", 0, 0), member(createGroupObject("g2", "inner", 0, 0), "g1")])).toBeUndefined();
  });

  it("lists the groups around an object and the objects inside a group at any depth", () => {
    const outer = createGroupObject("g1", "outer", 0, 0);
    const inner = member(createGroupObject("g2", "inner", 0, 0), "g1");
    const a = member(value("a"), "g2");
    const b = member(value("b"), "g1");
    const objects = [outer, inner, a, b, value("c")];
    expect(ancestorGroups(a, byIdIn(objects)).map((group) => group.id)).toEqual(["g2", "g1"]);
    expect(groupDescendants("g1", objects).map((object) => object.id)).toEqual(["g2", "a", "b"]);
    expect(groupDescendants("g2", objects).map((object) => object.id)).toEqual(["a"]);
  });
});

describe("grouping and ungrouping through mutate", () => {
  function committed(operations: readonly Operation[], objects: readonly GraphObject[] = [], journal: readonly MutationJournalEntry[] = []) {
    const result = mutate(objects, operations, journal);
    if (!result.ok) throw new Error(result.message);
    return result;
  }

  it("gathers objects into a group, which nests inside the group they already shared", () => {
    let state = committed([value("a"), value("b"), value("c")].map((object): Operation => ({ kind: "createObject", object })));
    state = committed(groupingOperations(createGroupObject("g1", "outer", 0, 0), state.objects), state.objects, state.journal);
    expect(state.objects.filter((object) => groupOf(object) === "g1").map((object) => object.id)).toEqual(["a", "b", "c"]);
    const [a, b] = state.objects.filter((object) => object.id === "a" || object.id === "b");
    state = committed(groupingOperations(createGroupObject("g2", "inner", 0, 0), [a!, b!]), state.objects, state.journal);
    expect(groupOf(state.objects.find((object) => object.id === "g2")!)).toBe("g1");
    expect(groupOf(state.objects.find((object) => object.id === "a")!)).toBe("g2");
  });

  it("dissolves a group into the group around it and keeps every member", () => {
    let state = committed([value("a"), value("b")].map((object): Operation => ({ kind: "createObject", object })));
    state = committed(groupingOperations(createGroupObject("g1", "outer", 0, 0), state.objects), state.objects, state.journal);
    state = committed(groupingOperations(createGroupObject("g2", "inner", 0, 0), [state.objects.find((object) => object.id === "a")!]), state.objects, state.journal);
    state = committed(ungroupingOperations(state.objects.find((object) => object.id === "g2")!, state.objects, false), state.objects, state.journal);
    expect(state.objects.map((object) => object.id)).toEqual(["a", "b", "g1"]);
    expect(groupOf(state.objects.find((object) => object.id === "a")!)).toBe("g1");
  });

  it("refuses to delete a group whose members still name it, and refuses a membership loop, with the same words on both paths", () => {
    let state = committed([value("a")].map((object): Operation => ({ kind: "createObject", object })));
    state = committed(groupingOperations(createGroupObject("g1", "outer", 0, 0), state.objects), state.objects, state.journal);
    const remove: Operation[] = [{ kind: "deleteObject", objectId: "g1" }];
    const indexed = mutate(state.objects, remove, state.journal);
    expect(indexed).toEqual(mutate(state.objects, remove, state.journal, undefined, FULL_EVALUATION_STRATEGY));
    expect(indexed.ok === false && indexed.message).toBe("a: the group it belongs to does not exist");
    const loop: Operation[] = [{ kind: "setSlot", address: { objectId: "g1", path: GROUP_MEMBERSHIP_PATH }, slot: { kind: "literal", value: "g1" } }];
    expect(mutate(state.objects, loop, state.journal)).toMatchObject({ ok: false, message: "outer: a group cannot sit inside itself" });
  });

  it("gives its members a frame built from formulas, through its origin and its outputs", () => {
    const formula = (objectId: string, path: readonly string[], offset: number): Slot => ({
      kind: "formula",
      ast: { type: "binaryOp", operator: "+", left: { type: "reference", address: { objectId, path } }, right: { type: "literal", value: offset } },
      value: null,
    });
    let state = committed([
      { kind: "createObject", object: createGroupObject("g1", "frame", 100, 50) },
      { kind: "createObject", object: { id: "a", name: "a", type: "value", slots: { value: formula("g1", ["origin", "x"], 20), "view.group": { kind: "literal", value: "g1" } } } },
      { kind: "addPort", objectId: "g1", family: "out", name: "width" },
      { kind: "setSlot", address: { objectId: "g1", path: ["placeholder", "width"] }, slot: { kind: "literal", value: 30 } },
      { kind: "setSlot", address: { objectId: "g1", path: ["out", "width"] }, slot: { kind: "derived", value: null } },
      { kind: "createObject", object: { id: "b", name: "b", type: "value", slots: { value: formula("g1", ["out", "width"], 1), "view.group": { kind: "literal", value: "g1" } } } },
    ]);
    const read = (id: string) => state.objects.find((object) => object.id === id)?.slots.value?.value;
    expect(read("a")).toBe(120);
    expect(read("b")).toBe(31);
    state = committed([{ kind: "setSlot", address: { objectId: "g1", path: ["origin", "x"] }, slot: { kind: "literal", value: 300 } }], state.objects, state.journal);
    expect(read("a")).toBe(320);
  });
});
