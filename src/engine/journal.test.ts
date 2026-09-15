/**
 * journal.test.ts
 *
 * The journal is the only record of how a document reached its state. These
 * tests hold the one property undo rests on. A full replay rebuilds exactly
 * the objects the mutations produced. A replay one entry short gives the
 * state before the last one.
 */
import { describe, expect, it } from "vitest";
import { journalIsComplete, replayJournal } from "./journal.ts";
import { createEmptyDocument, loadDocument } from "./document.ts";
import { mutate, type MutationJournalEntry } from "./mutation.ts";
import { slotKey, type GraphObject, type Slot } from "./graph/node.ts";
import { getObjectSchema, resolveDerivedSlots } from "./primitives/schema.ts";

function valueObject(id: string, name: string, value: number): GraphObject {
  return { id, name, type: "value", slots: { value: { kind: "literal", value } } };
}

/** A rect, so a replay has real derived slots to rebuild and not only literals. */
function rectObject(id: string, name: string, width: number): GraphObject {
  const slots: Record<string, Slot> = {
    "origin.x": { kind: "literal", value: 0 },
    "origin.y": { kind: "literal", value: 0 },
    width: { kind: "literal", value: width },
    height: { kind: "literal", value: 3 },
  };
  const stub: GraphObject = { id, name, type: "rect", slots };
  for (const derived of resolveDerivedSlots(stub, getObjectSchema("rect")?.derivedSlots ?? [])) {
    slots[slotKey(derived.path)] = { kind: "derived", value: null };
  }
  return stub;
}

interface Built {
  readonly objects: readonly GraphObject[];
  readonly journal: readonly MutationJournalEntry[];
  readonly afterFirst: readonly GraphObject[];
}

/** Three mutations: a value, a rect, then a wider rect. */
function buildDocument(): Built {
  const steps = [
    [{ kind: "createObject" as const, object: valueObject("obj_1", "value_1", 7) }],
    [{ kind: "createObject" as const, object: rectObject("obj_2", "rect_1", 4) }],
    [{ kind: "setSlot" as const, address: { objectId: "obj_2", path: ["width"] }, slot: { kind: "literal" as const, value: 10 } }],
  ];
  let objects: readonly GraphObject[] = [];
  let journal: readonly MutationJournalEntry[] = [];
  let afterFirst: readonly GraphObject[] = [];
  steps.forEach((operations, index) => {
    const result = mutate(objects, operations, journal);
    if (!result.ok) {
      throw new Error(`test setup: step ${index} refused: ${result.message}`);
    }
    objects = result.objects;
    journal = result.journal;
    if (index === 0) {
      afterFirst = result.objects;
    }
  });
  return { objects, journal, afterFirst };
}

describe("replayJournal — the reader undo needs", () => {
  it.each([null, "garbage", 42, {}, { operations: null }, { operations: [null] }, { operations: [{ kind: "createObject" }] }])(
    "refuses a malformed loaded entry without throwing: %j",
    (entry) => {
      const built = buildDocument();
      const loaded = loadDocument(JSON.stringify({ ...createEmptyDocument(), journal: [built.journal[0], entry] }));
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const result = replayJournal(loaded.document.journal, 2);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.entry).toBe(1);
        expect(result.message).toContain("journal entry 1 did not replay");
      }
      expect(journalIsComplete([], loaded.document.journal)).toBe(false);
    },
  );

  it("rebuilds exactly the objects the mutations produced, derived values included", () => {
    const built = buildDocument();
    const replayed = replayJournal(built.journal, built.journal.length);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.objects).toEqual(built.objects);
    expect(replayed.objects.find((object) => object.id === "obj_2")?.slots["area"]?.value).toBeCloseTo(30);
  });

  it("gives the state before the last entry, which is what one step of undo reads", () => {
    const built = buildDocument();
    const undone = replayJournal(built.journal, built.journal.length - 1);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.objects.find((object) => object.id === "obj_2")?.slots["width"]?.value).toBe(4);
    expect(undone.objects.find((object) => object.id === "obj_2")?.slots["area"]?.value).toBeCloseTo(12);
  });

  it("gives the empty document at 0, the state every journal starts from", () => {
    const replayed = replayJournal(buildDocument().journal, 0);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.objects).toEqual([]);
  });

  it("steps back one entry at a time, each step matching what that mutation left behind", () => {
    const built = buildDocument();
    const afterOne = replayJournal(built.journal, 1);
    expect(afterOne.ok).toBe(true);
    if (!afterOne.ok) return;
    expect(afterOne.objects).toEqual(built.afterFirst);
  });

  it("refuses a stopping point that is not a whole entry count in range, naming the range", () => {
    const journal = buildDocument().journal;
    for (const through of [-1, 1.5, journal.length + 1]) {
      const refused = replayJournal(journal, through);
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.message).toContain(`0 to ${journal.length}`);
      }
    }
  });

  it("REFUSES and names the entry when one does not replay, rather than hand back half a document", () => {
    // Drop the entry that creates the rect. The next entry then has no target.
    const journal = buildDocument().journal;
    const broken = [journal[0], journal[2]].filter((entry): entry is MutationJournalEntry => entry !== undefined);
    const replayed = replayJournal(broken, broken.length);
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) {
      expect(replayed.entry).toBe(1);
      expect(replayed.message).toContain("journal entry 1 did not replay");
    }
  });
});

describe("journalIsComplete — whether a journal holds the whole history", () => {
  it("says yes for a document every mutation built", () => {
    const built = buildDocument();
    expect(journalIsComplete(built.objects, built.journal)).toBe(true);
  });

  it("says no for a document whose journal lost an entry", () => {
    const built = buildDocument();
    expect(journalIsComplete(built.objects, built.journal.slice(0, 2))).toBe(false);
  });

  it("says no for a document that arrived with objects and no journal at all", () => {
    const built = buildDocument();
    expect(journalIsComplete(built.objects, [])).toBe(false);
  });

  it("says yes for the empty document, which has nothing to account for", () => {
    expect(journalIsComplete([], [])).toBe(true);
  });
});
