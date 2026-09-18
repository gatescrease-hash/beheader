/**
 * journal.ts
 *
 * Reads back the append-only journal that mutation.ts writes. replayJournal
 * rebuilds a document's objects as they stood after any entry, by re-running
 * those entries over an empty document.
 *
 * Replays are unoptimized for the sake of simplicity: one mutate() call per
 * entry, with no snapshots. Undo is replayJournal(journal, journal.length - 1).
 * An entry that fails to replay aborts the whole replay and reports which entry
 * broke, instead of handing back a half-built document.
 *
 * The journal has two limitations. First, a replay restores objects only. The
 * nextObjectId counter and the camera never go into the journal, so whoever
 * calls replayJournal tracks those two separately. Second, a journal is only
 * trustworthy for a document where every change went through mutate(). For a
 * document that arrived some other way, such as a loaded file,
 * journalIsComplete answers whether the journal accounts for it: it replays
 * everything and compares the result against the objects the caller passes in.
 * Loaded journals can contain malformed entries, so replay turns an exception
 * from an entry into a refusal with its index, preserving the load contract.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import { NULL_EVAL_CONTEXT, type EvalContext } from "./eval-context.ts";
import type { GraphObject } from "./graph/node.ts";
import { journalEntryProblem } from "./journal-entry.ts";
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
    // A loaded entry can be any JSON the file held, so its shape is read here
    // rather than left to fail inside mutate(), where the refusal would be the
    // text of a JavaScript TypeError.
    const problem = journalEntryProblem(entry);
    if (problem !== undefined) {
      return { ok: false, message: `journal entry ${index} did not replay: ${problem}`, entry: index };
    }

    // Each mutate() call is given an empty journal to append to, and what it
    // appends is thrown away. A replay only rebuilds objects, and letting the
    // journal accumulate would allocate a fresh array per entry for nothing.
    let result;
    try {
      result = mutate(objects, entry.operations, [], context);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `journal entry ${index} did not replay: ${reason}`, entry: index };
    }
    if (!result.ok) {
      return { ok: false, message: `journal entry ${index} did not replay: ${result.message}`, entry: index };
    }
    objects = result.objects;
  }
  return { ok: true, objects };
}

/**
 * True when a full replay rebuilds exactly the objects given. It answers
 * whether the journal holds the whole history of this document. An undo needs
 * that answer before it offers to step back.
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
