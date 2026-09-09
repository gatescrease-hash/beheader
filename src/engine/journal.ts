/**
 * journal.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * The reader of the append only journal that mutation.ts writes. It rebuilds
 * the objects of a document as they stood after any entry. It runs the same
 * operations again over an empty document.
 *
 * Rule 5 governs the cost. A replay runs one mutation for each entry, and it
 * keeps no snapshot. Undo reads the state before the last entry as
 * replayJournal(journal, journal.length - 1).
 *
 * Two traps. A replay rebuilds objects and nothing else, because nextObjectId
 * and the camera never enter the journal, so the caller keeps its own. And a
 * journal is complete only for a document that every mutation built. A
 * document that arrives any other way needs journalIsComplete before anything
 * trusts a replay of it.
 */
import { NULL_EVAL_CONTEXT, type EvalContext } from "./eval-context.ts";
import type { GraphObject } from "./graph/node.ts";
import { mutate, type MutationJournalEntry } from "./mutation.ts";

export type JournalReplayResult =
  | { readonly ok: true; readonly objects: readonly GraphObject[] }
  | { readonly ok: false; readonly message: string; readonly entry: number };

/**
 * The objects as they stood after the first `through` entries. A `through` of
 * 0 gives the empty document every journal starts from.
 *
 * It refuses rather than guesses when an entry does not replay. A journal that
 * cannot replay is a defect, and a silent half document hides it.
 */
export function replayJournal(
  journal: readonly MutationJournalEntry[],
  through: number,
  context: EvalContext = NULL_EVAL_CONTEXT,
): JournalReplayResult {
  if (!Number.isInteger(through) || through < 0 || through > journal.length) {
    return {
      ok: false,
      message: `a replay must stop at a whole entry count from 0 to ${journal.length}, got ${through}`,
      entry: -1,
    };
  }

  let objects: readonly GraphObject[] = [];
  for (let index = 0; index < through; index += 1) {
    const entry = journal[index];
    if (entry === undefined) {
      return { ok: false, message: `journal entry ${index} is missing`, entry: index };
    }
    // The journal this replay hands over stays empty. Nothing reads it back,
    // and a copy that grows costs one array for each entry.
    const result = mutate(objects, entry.operations, [], context);
    if (!result.ok) {
      return { ok: false, message: `journal entry ${index} did not replay: ${result.message}`, entry: index };
    }
    objects = result.objects;
  }
  return { ok: true, objects };
}

/**
 * True when a full replay rebuilds exactly the objects given. It answers
 * whether the journal holds the whole history of this document, which is what
 * an undo must know before it offers to step back.
 */
export function journalIsComplete(
  objects: readonly GraphObject[],
  journal: readonly MutationJournalEntry[],
  context: EvalContext = NULL_EVAL_CONTEXT,
): boolean {
  const replayed = replayJournal(journal, journal.length, context);
  return replayed.ok && canonicalJson(replayed.objects) === canonicalJson(objects);
}

/**
 * A stable text form of a value. It sorts the keys of an object, so two slot
 * maps that hold the same slots match whatever order somebody built them in.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
