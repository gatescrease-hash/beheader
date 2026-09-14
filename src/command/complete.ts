/**
 * complete.ts
 *
 * Reads a half typed command line and answers two questions from one analysis:
 * what a completion key pressed at a point should write, and which runs of the
 * line named something the document really holds. Both need the same two
 * things, which word a position falls in and what the registry in parser.ts
 * says that word holds, so both are defined here.
 *
 * It splits the line itself rather than through the parser, because the parser
 * refuses a line it cannot read in full and completion runs on lines that are
 * always incomplete. The split here is the tolerant one: it finds word
 * boundaries and quoting well enough to say where the cursor is, and it reports
 * no failure of any kind.
 *
 * A completion writes the longest text every candidate starts with, which is as
 * far as the typing can go before a choice has to be made. Where one candidate
 * matches that is the whole of it, and where several do the operator sees the
 * list and types one more character. This is what a shell does, and an operator
 * who has used one already knows it.
 *
 * Command-layer code: it turns a typed line into mutation calls, and imports
 * from the engine and from its own layer.
 */
import {
  completeAddress,
  completeObjectName,
  isAddressError,
  formulaReferenceResolves,
  formulaReferences,
  longestCommonPrefix,
  objectSlotPaths,
  parseAddress,
  type Completion,
  type GraphObject,
} from "../engine/index.ts";
import { COMMAND_NAMES, namedArgumentKeys, positionalKinds } from "./parser.ts";

export interface LineWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly quoted: boolean;
}

export interface LineCompletion {
  /** Where the completion replaces the line, from this index to that one. */
  readonly from: number;
  readonly to: number;
  /** The text to write there now. It is empty where nothing can be decided. */
  readonly fill: string;
  /** Everything the word could still become, for a list beside the input. */
  readonly candidates: readonly string[];
}

/**
 * Splits a line into words, keeping where each one sits. A quoted run is one
 * word, and an unterminated quote runs to the end of the line, because an
 * operator part way through typing one has not closed it yet.
 */
export function splitLineWords(line: string): readonly LineWord[] {
  const words: LineWord[] = [];
  let index = 0;

  while (index < line.length) {
    if (/\s/.test(line[index] as string)) {
      index += 1;
      continue;
    }
    const start = index;
    if (line[index] === '"') {
      index += 1;
      let text = "";
      while (index < line.length && line[index] !== '"') {
        if (line[index] === "\\" && index + 1 < line.length) {
          text += line[index + 1];
          index += 2;
          continue;
        }
        text += line[index];
        index += 1;
      }
      const closed = line[index] === '"';
      if (closed) {
        index += 1;
      }
      words.push({ text, start, end: index, quoted: true });
      continue;
    }
    while (index < line.length && !/\s/.test(line[index] as string)) {
      index += 1;
    }
    words.push({ text: line.slice(start, index), start, end: index, quoted: false });
  }

  return words;
}

/**
 * The word the cursor is in or at the end of. A cursor after a space belongs to
 * no word, and the caller then completes an empty word at that position.
 */
export function wordAtCursor(words: readonly LineWord[], cursor: number): LineWord | undefined {
  return words.find((word) => cursor >= word.start && cursor <= word.end);
}

function isNamedArgument(text: string, keys: readonly string[]): boolean {
  const equals = text.indexOf("=");
  return equals > 0 && keys.includes(text.slice(0, equals).toLowerCase());
}

/**
 * Which positional argument a word is, or nothing where it falls past the ones
 * the command takes. A named argument and a flag each belong to no position, so
 * counting skips over both.
 */
function positionalKindAt(words: readonly LineWord[], word: LineWord, commandName: string): string | undefined {
  const named = namedArgumentKeys(commandName);
  if (isNamedArgument(word.text, named)) {
    return undefined;
  }
  let position = 0;
  for (const earlier of words.slice(1)) {
    if (earlier.start === word.start) {
      break;
    }
    if (!isNamedArgument(earlier.text, named)) {
      position += 1;
    }
  }
  return positionalKinds(commandName)[position];
}

function completionOf(from: number, to: number, result: { candidates: readonly Completion[]; fill: string }): LineCompletion {
  return { from, to, fill: result.fill, candidates: result.candidates.map((entry) => entry.text) };
}

/**
 * What a completion key should do at this cursor. It returns nothing where the
 * word under the cursor holds something the document does not name, such as the
 * content of a text object or a number.
 */
/**
 * Whether a written address names a slot the document carries right now.
 *
 * parseAddress answers a narrower question, whether the text resolves to an
 * object and a path, and it says yes to a path that object has no slot for.
 * That is right for a caller such as addport, which names a port before it
 * exists. It is wrong for a mark that tells an operator the program knows what
 * they wrote, so this asks the further question.
 */
function namesALiveSlot(text: string, objects: readonly GraphObject[]): boolean {
  const resolved = parseAddress(text, objects);
  if (isAddressError(resolved)) {
    return false;
  }
  const object = objects.find((candidate) => candidate.id === resolved.objectId);
  if (object === undefined) {
    return false;
  }
  const dot = text.indexOf(".");
  const path = dot < 0 ? "" : text.slice(dot + 1).toLowerCase();
  return objectSlotPaths(object).some((candidate) => candidate.toLowerCase() === path);
}

export type LineSpanKind = "command" | "address";

export interface LineSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: LineSpanKind;
}

/**
 * The runs of a line that named something, and what each one named. A run that
 * sits where an address belongs and resolves to nothing is left out, so an
 * operator sees a misspelt name stay plain while a correct one is marked, which
 * is the whole of the report.
 *
 * Nothing here is remembered. The spans are worked out again from the text on
 * every call, so what is marked and what the parser reads can never be two
 * different answers.
 */
export function classifyCommandLine(line: string, objects: readonly GraphObject[]): readonly LineSpan[] {
  const words = splitLineWords(line);
  const first = words[0];
  if (first === undefined) {
    return [];
  }

  const spans: LineSpan[] = [];
  if (COMMAND_NAMES.includes(first.text.toLowerCase())) {
    spans.push({ start: first.start, end: first.end, kind: "command" });
  }

  for (const word of words.slice(1)) {
    if (word.quoted) {
      continue;
    }
    const kind = positionalKindAt(words, word, first.text);
    if (kind === "object") {
      if (objects.some((object) => object.name.toLowerCase() === word.text.toLowerCase())) {
        spans.push({ start: word.start, end: word.end, kind: "address" });
      }
      continue;
    }
    if (kind === "address" && namesALiveSlot(word.text, objects)) {
      spans.push({ start: word.start, end: word.end, kind: "address" });
    }
  }

  return spans;
}

export function completeCommandLine(line: string, cursor: number, objects: readonly GraphObject[]): LineCompletion | undefined {
  const words = splitLineWords(line);
  const current = wordAtCursor(words, cursor);
  const from = current?.start ?? cursor;
  const to = current?.end ?? cursor;
  const typed = current === undefined ? "" : current.text.slice(0, cursor - current.start);

  const first = words[0];
  if (first === undefined || current === first) {
    const matches = COMMAND_NAMES.filter((name) => name.startsWith(typed.toLowerCase()));
    if (matches.length === 0) {
      return undefined;
    }
    return { from, to, fill: longestCommonPrefix(matches), candidates: matches };
  }

  if (current !== undefined && current.quoted) {
    return undefined;
  }

  const kind =
    current === undefined
      ? positionalKinds(first.text)[words.slice(1).filter((word) => !isNamedArgument(word.text, namedArgumentKeys(first.text))).length]
      : positionalKindAt(words, current, first.text);
  if (kind === "object") {
    return completionOf(from, to, completeObjectName(typed, objects));
  }
  if (kind === "address") {
    return completionOf(from, to, completeAddress(typed, objects));
  }
  return undefined;
}

/**
 * A whole new value for a field, and where the caret goes in it. A field
 * completion returns the finished text rather than a range to splice, because
 * it can change the front of the field as well as the run under the cursor, and
 * a caller holding two edits would have to order them itself.
 */
export interface FieldEdit {
  readonly value: string;
  readonly caret: number;
  readonly candidates: readonly string[];
}

/**
 * The mark an equals sign makes at the front of a field, which is how a table
 * cell and a panel row tell a formula from the text it otherwise looks like.
 */
const FORMULA_MARK = "=";

/**
 * What a completion key should write in a field holding a formula.
 *
 * It completes the run under the cursor, and it writes the equals sign at the
 * front where the field has none. A field carrying that sign holds a formula,
 * and a field without one holds the literal text it reads as, so writing the
 * sign here leaves an operator typing an address and nothing else. The sign goes into the text rather
 * than beside it, so the field holds the whole of what it means, and reopening
 * the field later shows the same sign back.
 *
 * A cell of a table passes its own object id, because a bare name such as A1 is
 * an address only there.
 */
export function completeInFormulaField(
  value: string,
  cursor: number,
  objects: readonly GraphObject[],
  tableObjectId?: string,
): FieldEdit | undefined {
  const marked = value.startsWith(FORMULA_MARK);
  const body = marked ? value.slice(FORMULA_MARK.length) : value;
  const bodyCursor = marked ? cursor - FORMULA_MARK.length : cursor;
  if (bodyCursor < 0) {
    return undefined;
  }

  const run = formulaReferences(body).find((entry) => bodyCursor >= entry.start && bodyCursor <= entry.end);
  const typed = run === undefined ? "" : body.slice(run.start, bodyCursor);
  if (run === undefined || typed === "") {
    return undefined;
  }

  const completion = completeAddress(typed, objects);
  if (completion.candidates.length === 0) {
    // A bare cell of this table completes nothing, and it is already an
    // address, so the sign alone is what the field is missing.
    if (!marked && formulaReferenceResolves(typed, objects, tableObjectId)) {
      return { value: `${FORMULA_MARK}${body}`, caret: cursor + FORMULA_MARK.length, candidates: [] };
    }
    return undefined;
  }

  const filled = completion.fill === "" ? typed : completion.fill;
  const nextBody = body.slice(0, run.start) + filled + body.slice(run.end);
  const caretInBody = run.start + filled.length;

  return {
    value: `${FORMULA_MARK}${nextBody}`,
    caret: FORMULA_MARK.length + caretInBody,
    candidates: completion.candidates.map((entry) => entry.text),
  };
}

/**
 * The runs of a formula field that named something the document carries. The
 * equals sign at the front is not part of the formula, so the offsets it
 * returns count from the start of the field rather than from the start of what
 * is parsed.
 */
export function classifyFormulaField(
  value: string,
  objects: readonly GraphObject[],
  tableObjectId?: string,
): readonly LineSpan[] {
  const marked = value.startsWith(FORMULA_MARK);
  if (!marked) {
    return [];
  }
  const body = value.slice(FORMULA_MARK.length);
  const offset = FORMULA_MARK.length;

  return formulaReferences(body)
    .filter((run) => formulaReferenceResolves(run.text, objects, tableObjectId))
    .map((run): LineSpan => ({ start: run.start + offset, end: run.end + offset, kind: "address" }));
}
