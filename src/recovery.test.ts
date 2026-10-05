/**
 * recovery.test.ts
 *
 * These tests cover the dirty state of a document across commits, undo and
 * save, and the recovery copy against a fake storage, a corrupt entry and a
 * storage that refuses every call.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, loadDocument, mutate, type Document } from "./engine/index.ts";
import { clearRecovery, isDirty, readRecovery, RECOVERY_KEY, writeRecovery, type RecoveryStorage } from "./recovery.ts";

function memoryStorage(): RecoveryStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value), removeItem: (key) => void items.delete(key) };
}

function withValue(document: Document, id: string): Document {
  const result = mutate(document.objects, [{ kind: "createObject", object: { id, name: id, type: "value", slots: { value: { kind: "literal", value: 1 } } } }], document.journal);
  if (!result.ok) throw new Error(result.message);
  return { ...document, objects: result.objects, journal: result.journal };
}

describe("isDirty", () => {
  it("is clean at the saved journal, dirty after a commit, and clean again after undoing back to it", () => {
    const saved = withValue(createEmptyDocument(), "a").journal;
    const edited = withValue({ ...createEmptyDocument(), journal: saved }, "b").journal;
    expect(isDirty(saved, saved)).toBe(false);
    expect(isDirty(edited, saved)).toBe(true);
    expect(isDirty(edited.slice(0, -1), saved)).toBe(false);
  });

  it("treats a document never saved as dirty once it holds an entry", () => {
    expect(isDirty([], null)).toBe(false);
    expect(isDirty(withValue(createEmptyDocument(), "a").journal, null)).toBe(true);
  });
});

describe("the recovery copy", () => {
  it("writes the saved form with its time, reads it back as a loadable document, and clears it", () => {
    const storage = memoryStorage();
    const document = withValue(createEmptyDocument(), "a");
    expect(writeRecovery(storage, document, new Date("2026-10-05T12:00:00Z"))).toBe(true);
    const copy = readRecovery(storage);
    expect(copy?.savedAt).toBe("2026-10-05T12:00:00.000Z");
    const loaded = loadDocument(copy!.json);
    expect(loaded.ok && loaded.document.objects.map((object) => object.id)).toEqual(["a"]);
    clearRecovery(storage);
    expect(readRecovery(storage)).toBeUndefined();
  });

  it("reads nothing from a corrupt entry, and survives a storage that refuses every call", () => {
    const storage = memoryStorage();
    storage.items.set(RECOVERY_KEY, "{not json");
    expect(readRecovery(storage)).toBeUndefined();
    const refusing: RecoveryStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(writeRecovery(refusing, createEmptyDocument(), new Date())).toBe(false);
    expect(readRecovery(refusing)).toBeUndefined();
    expect(() => clearRecovery(refusing)).not.toThrow();
  });
});
