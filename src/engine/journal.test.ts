/**
 * journal.test.ts
 *
 * The journal is the only record of how a document reached its state. These
 * tests hold the one property undo rests on. A full replay rebuilds exactly
 * the objects the mutations produced. A replay one entry short gives the
 * state before the last one. The undo surface has to agree with that replay at
 * every position, while it replays no more than one checkpoint interval.
 */
import { describe, expect, it } from "vitest";
import { CHECKPOINT_INTERVAL, gestureOperations, journalIsComplete, redoJournal, replayJournal, startUndoHistory, undoJournal } from "./journal.ts";
import { compareDifferentialValues, generateMutationScenario } from "./differential.ts";
import { executeCommand } from "../command/commands.ts";
import { parseCommand } from "../command/parser.ts";
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
      const loaded = loadDocument(JSON.stringify({ ...createEmptyDocument(), nextObjectId: 2, journal: [built.journal[0], entry] }));
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

/** A session of committed batches from a generated scenario, refusals skipped. */
function generatedSession(seed: number, editBatchCount: number): Built {
  const scenario = generateMutationScenario(seed, { objectCount: 12, editBatchCount });
  let objects = scenario.initialObjects;
  let journal = scenario.initialJournal;
  const creation = mutate([], objects.map((object) => ({ kind: "createObject" as const, object })), []);
  if (!creation.ok) throw new Error(creation.message);
  objects = creation.objects;
  journal = creation.journal;
  for (const batch of scenario.batches) {
    const result = mutate(objects, batch, journal);
    if (result.ok) {
      objects = result.objects;
      journal = result.journal;
    }
  }
  return { objects, journal, afterFirst: creation.objects };
}

/** Wraps each entry so a test can count how many entries a replay reads. */
function countedJournal(journal: readonly MutationJournalEntry[]): { readonly journal: readonly MutationJournalEntry[]; reads: number } {
  const counter = { journal: [] as MutationJournalEntry[], reads: 0 };
  counter.journal = journal.map((entry) => new Proxy(entry, {
    get(target, property, receiver) {
      if (property === "operations") counter.reads += 1;
      return Reflect.get(target, property, receiver);
    },
  }));
  return counter;
}

describe("undoJournal and redoJournal — the undo surface", () => {
  it("agrees with a replay from the start at every position, then redoes back to the end", () => {
    for (const seed of [3, 17, 8675309]) {
      const session = generatedSession(seed, 90);
      let history = startUndoHistory(session.objects, session.journal);
      expect(history.floor).toBe(0);
      let objects = session.objects;
      let journal = session.journal;
      while (journal.length > 0) {
        const undone = undoJournal(journal, history);
        if (!undone.ok) throw new Error(undone.message);
        ({ objects, journal, history } = undone);
        const replayed = replayJournal(session.journal, journal.length);
        if (!replayed.ok) throw new Error(replayed.message);
        expect(compareDifferentialValues(replayed.objects, objects), `seed ${seed}, position ${journal.length}`).toBeUndefined();
      }
      expect(undoJournal(journal, history)).toEqual({ ok: false, message: "nothing to undo" });
      while (journal.length < session.journal.length) {
        const redone = redoJournal(objects, journal, history);
        if (!redone.ok) throw new Error(redone.message);
        ({ objects, journal, history } = redone);
      }
      expect(journal).toEqual(session.journal);
      expect(compareDifferentialValues(session.objects, objects)).toBeUndefined();
      expect(redoJournal(objects, journal, history)).toEqual({ ok: false, message: "nothing to redo" });
    }
  });

  it("replays at most one checkpoint interval per undo, whatever the length of the session", () => {
    const worst = [64, 256, 1024].map((length) => {
      let objects: readonly GraphObject[] = [valueObject("obj_1", "value_1", 0)];
      let journal: readonly MutationJournalEntry[] = [];
      const created = mutate([], [{ kind: "createObject", object: objects[0]! }], []);
      if (!created.ok) throw new Error(created.message);
      ({ objects, journal } = created);
      for (let index = 1; index < length; index += 1) {
        const result = mutate(objects, [{ kind: "setSlot", address: { objectId: "obj_1", path: ["value"] }, slot: { kind: "literal", value: index } }], journal);
        if (!result.ok) throw new Error(result.message);
        ({ objects, journal } = result);
      }
      const counted = countedJournal(journal);
      let history = startUndoHistory(objects, counted.journal);
      let current = counted.journal;
      let most = 0;
      for (let step = 0; step < 40; step += 1) {
        counted.reads = 0;
        const undone = undoJournal(current, history);
        if (!undone.ok) throw new Error(undone.message);
        expect(undone.objects[0]?.slots.value?.value).toBe(length - step - 2 < 0 ? undefined : length - step - 2);
        ({ journal: current, history } = undone);
        most = Math.max(most, counted.reads);
      }
      return most;
    });
    expect(Math.max(...worst)).toBeLessThanOrEqual(CHECKPOINT_INTERVAL);
  });

  it("drops the undone entries once a mutation commits after the undo", () => {
    const built = buildDocument();
    let history = startUndoHistory(built.objects, built.journal);
    const undone = undoJournal(built.journal, history);
    if (!undone.ok) throw new Error(undone.message);
    history = undone.history;
    expect(undone.journal).toHaveLength(2);
    expect(undone.entry).toBe(built.journal[2]);

    const edited = mutate(undone.objects, [{ kind: "setSlot", address: { objectId: "obj_1", path: ["value"] }, slot: { kind: "literal", value: 1 } }], undone.journal);
    if (!edited.ok) throw new Error(edited.message);
    expect(edited.journal).toHaveLength(3);
    expect(edited.journal[2]).not.toBe(built.journal[2]);
    expect(redoJournal(edited.objects, edited.journal, history)).toEqual({ ok: false, message: "nothing to redo" });

    // The earlier entries are the same objects, so the next undo lands on the
    // state after two entries without a replay from the start.
    const again = undoJournal(edited.journal, history);
    if (!again.ok) throw new Error(again.message);
    expect(again.objects).toEqual(undone.objects);

    // Redo brings back the edit and nothing else. The entry undone before the
    // edit lapsed when the edit committed.
    const redone = redoJournal(again.objects, again.journal, again.history);
    if (!redone.ok) throw new Error(redone.message);
    expect(redone.entry).toBe(edited.journal[2]);
    expect(redoJournal(redone.objects, redone.journal, redone.history)).toEqual({ ok: false, message: "nothing to redo" });
  });

  it("stops at the point a document was opened when its journal does not rebuild its objects", () => {
    const built = buildDocument();
    const shortened = built.journal.slice(0, 2);
    const history = startUndoHistory(built.objects, shortened);
    expect(history.floor).toBe(2);
    const refused = undoJournal(shortened, history);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain("does not rebuild it");

    // A change made after the document opened still undoes, back to the state it opened in.
    const edited = mutate(built.objects, [{ kind: "setSlot", address: { objectId: "obj_1", path: ["value"] }, slot: { kind: "literal", value: 9 } }], shortened);
    if (!edited.ok) throw new Error(edited.message);
    const undone = undoJournal(edited.journal, history);
    if (!undone.ok) throw new Error(undone.message);
    expect(undone.objects).toEqual(built.objects);
  });

  it("measures a restored checkpoint with the context passed to the undo, not the one it was taken with", () => {
    const narrow = { measurer: { measure: (text: string) => ({ width: text.length * 8, height: 20 }) } };
    const wide = { measurer: { measure: (text: string) => ({ width: text.length * 10, height: 20 }) } };
    const parsed = parseCommand('text x=0 y=0 "hello"');
    if (!parsed.ok) throw new Error(parsed.message);
    const created = executeCommand(parsed.command, createEmptyDocument(), narrow);
    if (!created.ok) throw new Error(created.message);
    const history = startUndoHistory(created.document.objects, created.document.journal, narrow);
    const edited = mutate(created.document.objects, [{ kind: "setSlot", address: { objectId: created.document.objects[0]!.id, path: ["origin", "x"] }, slot: { kind: "literal", value: 50 } }], created.document.journal, narrow);
    if (!edited.ok) throw new Error(edited.message);

    const undone = undoJournal(edited.journal, history, wide);
    if (!undone.ok) throw new Error(undone.message);
    const replayed = replayJournal(created.document.journal, 1, wide);
    if (!replayed.ok) throw new Error(replayed.message);
    expect(undone.objects).toEqual(replayed.objects);
    expect(undone.objects).not.toEqual(created.document.objects);
  });
});

describe("gestureOperations — one batch for a gesture", () => {
  const write = (objectId: string, value: number) => ({ kind: "setSlot" as const, address: { objectId, path: ["value"] }, slot: { kind: "literal" as const, value } });

  it("keeps the last write to each address from a run of writes, in the order of those last writes", () => {
    expect(gestureOperations([
      { operations: [write("a", 1), write("b", 1)] },
      { operations: [write("a", 2)] },
      { operations: [write("b", 3), write("a", 4)] },
    ])).toEqual([write("b", 3), write("a", 4)]);
  });

  it("keeps every operation in order when the run holds anything other than a write", () => {
    const entries: readonly MutationJournalEntry[] = [
      { operations: [write("a", 1)] },
      { operations: [{ kind: "renameObject" as const, objectId: "a", name: "renamed" }] },
      { operations: [write("a", 2)] },
    ];
    expect(gestureOperations(entries)).toEqual(entries.flatMap((entry) => entry.operations));
  });
});
