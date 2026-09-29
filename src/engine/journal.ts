/**
 * journal.ts
 *
 * Reads back the append-only journal that mutation.ts writes. replayJournal
 * rebuilds a document's objects as they stood after any entry, by re-running
 * those entries over an empty document.
 *
 * replayJournal is unoptimized for the sake of simplicity: one mutate() call
 * per entry from the empty document, with no snapshots. It is the reference an
 * undo has to agree with. An entry that fails to replay aborts the whole replay
 * and reports which entry broke, instead of handing back a half-built document.
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
 * The undo surface rests on the same replay. The position into the journal is
 * the journal's own length: undoJournal hands back the journal without its last
 * entry and the objects as they stood before that entry, and redoJournal puts
 * the entry back. UndoHistory holds the undone entries together with the
 * journal they sit past, compared by identity. A mutation builds a new journal
 * array, so any commit after an undo leaves that journal behind, and the undone
 * entries lapse without the host having to report the commit.
 *
 * Replaying from the empty document would make an undo cost the whole session,
 * so UndoHistory also holds checkpoints: the objects after every
 * CHECKPOINT_INTERVAL entries, gathered as replays pass them. An undo replays
 * from the nearest checkpoint, which bounds it by the interval rather than by
 * the length of the journal. Staging in mutation.ts shares every object record
 * a batch leaves alone, so a checkpoint costs one array of references to
 * records the current state already holds. A checkpoint names the entry just
 * before it, and it applies to a journal only while that journal still holds
 * the same entry object at that place. An entry object is made once, by the
 * commit that appends it, and no operation on a journal moves it to another
 * index, so the entry identifies every entry before it as well.
 *
 * A replay reproduces a document only when every change to it went through
 * mutate(). startUndoHistory checks that once, when a host takes a document
 * up, and a journal that does not rebuild its objects sets a floor at its own
 * length, below which an undo refuses rather than land on a state the document
 * never had.
 *
 * gestureOperations serves a drag, which commits a mutation for each frame so
 * the canvas can draw it. When the gesture ends, the host commits the frames
 * again as one batch against the state from before the press, so an undo
 * reverses the gesture rather than one frame of it.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import { addressKey } from "./graph/edge.ts";
import { NULL_EVAL_CONTEXT, type EvalContext } from "./eval-context.ts";
import type { GraphObject } from "./graph/node.ts";
import { mutate, refreshHostInputs, type MutationJournalEntry, type Operation, type SetSlotOperation } from "./mutation.ts";

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

/** The most entries an undo replays before it reaches the state it wants. */
export const CHECKPOINT_INTERVAL = 32;

/** The objects after the first `through` entries of a journal. */
export interface JournalCheckpoint {
  readonly through: number;
  /** The entry at `through - 1`, which ties the checkpoint to one journal prefix. */
  readonly last: MutationJournalEntry | undefined;
  readonly objects: readonly GraphObject[];
}

/** Host state beside the camera, and never part of a saved file. */
export interface UndoHistory {
  /** Entries undone, the most recent undo last. */
  readonly undone: readonly MutationJournalEntry[];
  /** The journal the undone entries sit past. They lapse once the journal is another one. */
  readonly base: readonly MutationJournalEntry[] | undefined;
  readonly checkpoints: readonly JournalCheckpoint[];
  /** The shortest journal an undo can leave. */
  readonly floor: number;
}

export type UndoResult =
  | {
      readonly ok: true;
      readonly objects: readonly GraphObject[];
      readonly journal: readonly MutationJournalEntry[];
      readonly history: UndoHistory;
      /** The entry the undo removed or the redo put back. */
      readonly entry: MutationJournalEntry;
    }
  | { readonly ok: false; readonly message: string };

function checkpointApplies(checkpoint: JournalCheckpoint, journal: readonly MutationJournalEntry[]): boolean {
  return checkpoint.through <= journal.length && (checkpoint.through === 0 || journal[checkpoint.through - 1] === checkpoint.last);
}

function checkpointAt(journal: readonly MutationJournalEntry[], through: number, objects: readonly GraphObject[]): JournalCheckpoint {
  return { through, last: through === 0 ? undefined : journal[through - 1], objects };
}

/**
 * Takes up a document for undo. It replays the whole journal once, keeping a
 * checkpoint at every interval, and compares the result with the objects the
 * document holds. A journal that rebuilds them allows an undo back to the
 * empty document. Any other journal sets the floor at its own length.
 */
export function startUndoHistory(
  objects: readonly GraphObject[],
  journal: readonly MutationJournalEntry[],
  context: EvalContext = NULL_EVAL_CONTEXT,
): UndoHistory {
  const loaded = checkpointAt(journal, journal.length, objects);
  const checkpoints: JournalCheckpoint[] = [checkpointAt(journal, 0, [])];
  let replayed: readonly GraphObject[] = [];
  for (let index = 0; index < journal.length; index += 1) {
    let result;
    try {
      result = mutate(replayed, journal[index]!.operations, [], context);
    } catch {
      result = undefined;
    }
    if (result === undefined || !result.ok) {
      return { undone: [], base: undefined, checkpoints: [loaded], floor: journal.length };
    }
    replayed = result.objects;
    if ((index + 1) % CHECKPOINT_INTERVAL === 0) {
      checkpoints.push(checkpointAt(journal, index + 1, replayed));
    }
  }
  if (canonicalJson(replayed) !== canonicalJson(objects)) {
    return { undone: [], base: undefined, checkpoints: [loaded], floor: journal.length };
  }
  if (journal.length % CHECKPOINT_INTERVAL !== 0) {
    checkpoints.push(loaded);
  }
  return { undone: [], base: undefined, checkpoints, floor: 0 };
}

/**
 * The objects after the first `through` entries, replayed from the nearest
 * checkpoint that still applies to this journal. The checkpoints that no
 * longer apply are dropped, and the replay adds one at each interval it
 * passes.
 *
 * A checkpoint holds the values evaluation gave its objects when it was taken,
 * and a host can re-evaluate its state since then, such as after a font
 * arrives and a measurement changes. Each replayed entry refreshes the slots
 * that read the evaluation context, and a replay of no entries refreshes them
 * directly, so the result always reflects the context passed in.
 */
function objectsThrough(
  journal: readonly MutationJournalEntry[],
  through: number,
  checkpoints: readonly JournalCheckpoint[],
  context: EvalContext,
): { readonly ok: true; readonly objects: readonly GraphObject[]; readonly checkpoints: readonly JournalCheckpoint[] } | { readonly ok: false; readonly message: string } {
  const kept = checkpoints.filter((checkpoint) => checkpointApplies(checkpoint, journal));
  let start: JournalCheckpoint | undefined;
  for (const checkpoint of kept) {
    if (checkpoint.through <= through && (start === undefined || checkpoint.through > start.through)) {
      start = checkpoint;
    }
  }
  if (start === undefined) {
    return { ok: false, message: "no saved state lies at or before that point in the journal" };
  }
  const gathered = [...kept];
  let objects = start.objects;
  for (let index = start.through; index < through; index += 1) {
    const result = mutate(objects, journal[index]!.operations, [], context);
    if (!result.ok) {
      return { ok: false, message: `journal entry ${index} did not replay: ${result.message}` };
    }
    objects = result.objects;
    const reached = index + 1;
    if (reached % CHECKPOINT_INTERVAL === 0 && !gathered.some((checkpoint) => checkpoint.through === reached)) {
      gathered.push(checkpointAt(journal, reached, objects));
    }
  }
  if (start.through === through) {
    const refreshed = refreshHostInputs(objects, context);
    if (!refreshed.ok) {
      return refreshed;
    }
    objects = refreshed.objects;
  }
  return { ok: true, objects, checkpoints: gathered };
}

/** Steps back over the last entry of the journal. The counter and the camera stay where they are. */
export function undoJournal(
  journal: readonly MutationJournalEntry[],
  history: UndoHistory,
  context: EvalContext = NULL_EVAL_CONTEXT,
): UndoResult {
  const entry = journal[journal.length - 1];
  if (entry === undefined) {
    return { ok: false, message: "nothing to undo" };
  }
  if (journal.length <= history.floor) {
    return {
      ok: false,
      message: "nothing to undo since this document was opened, because the journal saved with it does not rebuild it",
    };
  }
  const truncated = journal.slice(0, -1);
  const rebuilt = objectsThrough(journal, truncated.length, history.checkpoints, context);
  if (!rebuilt.ok) {
    return rebuilt;
  }
  const undone = history.base === journal ? [...history.undone, entry] : [entry];
  return {
    ok: true,
    objects: rebuilt.objects,
    journal: truncated,
    history: { ...history, undone, base: truncated, checkpoints: rebuilt.checkpoints },
    entry,
  };
}

/**
 * Applies the most recently undone entry again. It appends the same entry
 * object rather than a copy, so the checkpoints past it still apply.
 */
export function redoJournal(
  objects: readonly GraphObject[],
  journal: readonly MutationJournalEntry[],
  history: UndoHistory,
  context: EvalContext = NULL_EVAL_CONTEXT,
): UndoResult {
  const entry = history.base === journal ? history.undone[history.undone.length - 1] : undefined;
  if (entry === undefined) {
    return { ok: false, message: "nothing to redo" };
  }
  const result = mutate(objects, entry.operations, journal, context);
  if (!result.ok) {
    return { ok: false, message: `the undone change no longer applies: ${result.message}` };
  }
  const restored = [...journal, entry];
  return {
    ok: true,
    objects: result.objects,
    journal: restored,
    history: { ...history, undone: history.undone.slice(0, -1), base: restored },
    entry,
  };
}

/**
 * The operations of several journal entries as one batch. A run made of
 * setSlot operations alone keeps only the last write to each address, which is
 * the only write the final state holds, and a drag writes nothing else. Any
 * other run keeps every operation in order, because an operation can read the
 * state an earlier one left.
 */
export function gestureOperations(entries: readonly MutationJournalEntry[]): readonly Operation[] {
  const operations = entries.flatMap((entry) => entry.operations);
  if (!operations.every((operation): operation is SetSlotOperation => operation.kind === "setSlot")) {
    return operations;
  }
  const seen = new Set<string>();
  const lastWrites: SetSlotOperation[] = [];
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const operation = operations[index]!;
    const key = addressKey(operation.address);
    if (!seen.has(key)) {
      seen.add(key);
      lastWrites.push(operation);
    }
  }
  return lastWrites.reverse();
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
