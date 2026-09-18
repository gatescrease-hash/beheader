/**
 * journal-entry.test.ts
 *
 * The check that stands between a loaded journal and mutate(). A file can
 * carry any JSON at all in its journal, so these hold the two properties a
 * replay rests on: an entry that mutate() could not read is refused here
 * first, and the refusal is a sentence about the file rather than the text of
 * a JavaScript TypeError.
 */
import { describe, expect, it } from "vitest";
import { journalEntryProblem } from "./journal-entry.ts";

const address = { objectId: "obj_1", path: ["value"] };

describe("journalEntryProblem — the shape of one loaded entry", () => {
  it("passes a batch holding one operation of every kind", () => {
    const operations = [
      { kind: "createObject", object: { id: "obj_1", name: "w", type: "value", slots: { value: { kind: "literal", value: 1 } } } },
      { kind: "setSlot", address, slot: { kind: "literal", value: 2 } },
      { kind: "clearSlot", address },
      { kind: "renameObject", objectId: "obj_1", name: "x" },
      { kind: "renameVariable", address, name: "y" },
      { kind: "deleteObject", objectId: "obj_1" },
      { kind: "deleteObject", objectId: "obj_1", force: true },
      { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 0 },
      { kind: "deleteTableLine", objectId: "obj_1", axis: "column", index: 1 },
      { kind: "addPort", objectId: "obj_1", family: "in", name: "a" },
      { kind: "removePort", objectId: "obj_1", family: "out", name: "r" },
      { kind: "setMathSource", objectId: "obj_1", source: "y=1" },
      { kind: "addVertex", objectId: "obj_1", point: { x: 1, y: 2 } },
      { kind: "deleteVertex", objectId: "obj_1", index: 0 },
      { kind: "explode", objectId: "obj_1" },
      { kind: "splitEdge", objectId: "obj_1", index: 0, point: { x: 1, y: 2 } },
    ];

    expect(journalEntryProblem({ operations })).toBeUndefined();
  });

  it.each([null, "garbage", 42, {}, { operations: null }, { operations: "a" }])(
    "refuses an entry that carries no operations array: %j",
    (entry) => {
      expect(journalEntryProblem(entry)).toBe('an entry is an object with an "operations" array');
    },
  );

  it("passes an entry whose operations array is empty, which mutate refuses itself", () => {
    // Emptiness is a question about the batch rather than about the shape of
    // an operation, and mutate() already names it.
    expect(journalEntryProblem({ operations: [] })).toBeUndefined();
  });

  it("names the index of the operation that fails, not the first one", () => {
    const operations = [{ kind: "clearSlot", address }, { kind: "clearSlot", address }, { kind: "frobnicate" }];
    expect(journalEntryProblem({ operations })).toBe('operation 2 has an unrecognised kind "frobnicate"');
  });

  it.each([
    [{ kind: "renameObject", objectId: "obj_1" }, 'operation 0 (renameObject) has a string "name", not undefined'],
    [{ kind: "renameObject", objectId: 7, name: "x" }, 'operation 0 (renameObject) has a string "objectId", not 7'],
    [{ kind: "deleteVertex", objectId: "obj_1", index: "0" }, 'operation 0 (deleteVertex) has a number "index", not "0"'],
    [{ kind: "explode", objectId: "obj_1", force: "yes" }, 'operation 0 (explode) has a boolean "force" where it has one, not "yes"'],
    [{ kind: "insertTableLine", objectId: "obj_1", axis: "diagonal", index: 0 }, 'operation 0 (insertTableLine) sets "axis" to "row" or "column", not "diagonal"'],
    [{ kind: "addPort", objectId: "obj_1", family: "seed", name: "a" }, 'operation 0 (addPort) sets "family" to "in" or "out", not "seed"'],
    [{ kind: "clearSlot", address: { objectId: "obj_1" } }, 'operation 0 (clearSlot) has an "address" with a string objectId and a path of strings'],
    [{ kind: "addVertex", objectId: "obj_1", point: { x: 1 } }, 'operation 0 (addVertex) has a "point" with a numeric x and y'],
    [{ kind: "setSlot", address, slot: { kind: "literal" } }, "operation 0 (setSlot) slot is a literal with no value"],
    [{ kind: "setSlot", address, slot: { kind: "formula" } }, "operation 0 (setSlot) slot is a formula with no ast"],
    [{ kind: "setSlot", address }, 'operation 0 (setSlot) has a "slot"'],
    [{ kind: "createObject" }, 'operation 0 (createObject) has an "object"'],
    [{ kind: "createObject", object: { id: "obj_1", name: "w", type: "value" } }, 'operation 0 (createObject) object has a "slots" object'],
    [{ kind: "createObject", object: { id: "obj_1", name: "w", type: "value", slots: {}, ports: { in: "a" } } }, 'operation 0 (createObject) object has "ports" with an "in" list and an "out" list'],
    [{ kind: "createObject", object: { id: "obj_1", name: "w", type: "value", slots: {}, target: "x" } }, 'operation 0 (createObject) object has a "target" with a string objectId and a path of strings'],
    [{ kind: "createObject", object: { id: "obj_1", name: "w", type: "value", slots: {}, vertexCount: "4" } }, 'operation 0 (createObject) object has a number "vertexCount" where it has one, not "4"'],
  ])("names what an operation is missing: %j", (operation, expected) => {
    expect(journalEntryProblem({ operations: [operation] })).toBe(expected);
  });

  it("reads the formula tree of a slot, so a broken one is refused before evaluation", () => {
    const slot = { kind: "formula", ast: { type: "conditional" } };
    expect(journalEntryProblem({ operations: [{ kind: "setSlot", address, slot }] })).toBe(
      'operation 0 (setSlot) slot is a formula whose ast "conditional" is not a formula node type',
    );
  });

  it("names the slot of an object payload by its key", () => {
    const object = { id: "obj_1", name: "w", type: "value", slots: { width: { kind: "bogus" } } };
    expect(journalEntryProblem({ operations: [{ kind: "createObject", object }] })).toBe(
      'operation 0 (createObject) object slot "width" is of an unrecognised kind "bogus"',
    );
  });

  it("carries no text from a JavaScript exception into a refusal", () => {
    // The wording an operator used to see. A replay that reached mutate() with
    // a malformed entry reported the interpreter's own sentence.
    for (const entry of [null, { operations: [null] }, { operations: [{ kind: "createObject" }] }]) {
      expect(journalEntryProblem(entry)).not.toContain("Cannot read properties");
    }
  });
});
