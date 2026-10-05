/**
 * recovery.ts
 *
 * Whether a document holds work the operator has not saved, and the recovery
 * copy kept in the browser while it does.
 *
 * A document is dirty when its journal is not the journal it had at the last
 * save or load. The comparison reads the length and the last entry, compared
 * by identity: an entry object is made once, by the commit that appends it, and
 * no operation moves it to another index, so the last entry stands for every
 * entry before it. An undo back to the point of the last save therefore reads
 * as clean again, which comparing whole arrays by identity would miss, because
 * an undo hands back a new array.
 *
 * The recovery copy is the saved form of the document under one key. It covers
 * a tab that closed, and it never replaces the file a save writes. Storage
 * arrives as an argument, so the tests run with a fake, and every read and write
 * survives a browser that refuses storage, which a private window can do.
 *
 * Host-layer code: it reads the engine through its public surface and touches
 * no DOM. main.ts owns the timer, the page title and the warning on leaving.
 */
import { saveDocument, type Document, type MutationJournalEntry } from "./engine/index.ts";

export const RECOVERY_KEY = "beheader.recovery";

/** The parts of the browser's Storage this file uses. */
export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RecoveryCopy {
  readonly savedAt: string;
  readonly json: string;
}

/**
 * True when the journal differs from the one at the last save or load. A
 * document never saved or loaded, such as a restored recovery copy, has a
 * saved journal of null, and is dirty once it holds any entry.
 */
export function isDirty(journal: readonly MutationJournalEntry[], saved: readonly MutationJournalEntry[] | null): boolean {
  if (saved === null) {
    return journal.length > 0;
  }
  return journal.length !== saved.length || (journal.length > 0 && journal[journal.length - 1] !== saved[saved.length - 1]);
}

export function writeRecovery(storage: RecoveryStorage, document: Document, now: Date): boolean {
  try {
    storage.setItem(RECOVERY_KEY, JSON.stringify({ savedAt: now.toISOString(), json: saveDocument(document) }));
    return true;
  } catch {
    return false;
  }
}

export function readRecovery(storage: RecoveryStorage): RecoveryCopy | undefined {
  try {
    const raw = storage.getItem(RECOVERY_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<RecoveryCopy>;
    return typeof parsed.savedAt === "string" && typeof parsed.json === "string" ? { savedAt: parsed.savedAt, json: parsed.json } : undefined;
  } catch {
    return undefined;
  }
}

export function clearRecovery(storage: RecoveryStorage): void {
  try {
    storage.removeItem(RECOVERY_KEY);
  } catch {
    // A browser that refuses storage leaves nothing to clear.
  }
}
