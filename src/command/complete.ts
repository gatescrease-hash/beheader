/**
 * complete.ts
 *
 * Answers what a completion key pressed at a point in a half typed line should
 * write. It reads the registry in parser.ts to learn which word the cursor sits
 * in and what that word holds, and it asks the engine for the candidates when
 * that word names something in the document.
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
import { completeAddress, completeObjectName, longestCommonPrefix, type Completion, type GraphObject } from "../engine/index.ts";
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

function completionOf(from: number, to: number, result: { candidates: readonly Completion[]; fill: string }): LineCompletion {
  return { from, to, fill: result.fill, candidates: result.candidates.map((entry) => entry.text) };
}

/**
 * What a completion key should do at this cursor. It returns nothing where the
 * word under the cursor holds something the document does not name, such as the
 * content of a text object or a number.
 */
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

  const kinds = positionalKinds(first.text);
  const named = namedArgumentKeys(first.text);

  // Which positional this word is. A named argument and a flag each belong to
  // no position, so counting skips over both.
  let position = 0;
  for (const word of words.slice(1)) {
    if (current !== undefined && word.start === current.start) {
      break;
    }
    if (!isNamedArgument(word.text, named)) {
      position += 1;
    }
  }

  if (current !== undefined && isNamedArgument(current.text, named)) {
    return undefined;
  }

  const kind = kinds[position];
  if (kind === "object") {
    return completionOf(from, to, completeObjectName(typed, objects));
  }
  if (kind === "address") {
    return completionOf(from, to, completeAddress(typed, objects));
  }
  return undefined;
}
