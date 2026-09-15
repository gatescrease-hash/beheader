/**
 * lexer.ts
 *
 * Turns the LaTeX that a math field writes into tokens. It is the first of the
 * four stages of the math language: lexer, parser, names and eval.
 *
 * The source is LaTeX because that is what the editor produces, so the lexer
 * answers to a generator rather than to a person. Three of its rules follow
 * from that.
 *
 * A subscript belongs to the name in front of it. MathLive writes a value
 * named x_ans as x_{ans}, and a reader who sees two tokens there would take
 * the second for a factor. So a letter, a low line and a braced run of letters
 * and digits arrive as one identifier token whose name is x_ans, which is also
 * the spelling a port name takes.
 *
 * A multi-letter name reaches LaTeX through \operatorname or \mathrm, because
 * two bare letters beside each other mean a product in mathematics. Both
 * commands lex to a single identifier.
 *
 * Some commands arrive with no meaning for an evaluator. \left and \right
 * size a bracket to its content, and the short commands built from a comma, a
 * colon or an exclamation mark space it, as does a lone backslash before a
 * space. All of them are dropped here, so the parser sees the bracket alone.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

export type MathTokenType =
  | "number"
  | "identifier"
  | "command"
  | "plus"
  | "minus"
  | "star"
  | "slash"
  | "caret"
  | "equals"
  | "comma"
  | "underscore"
  | "bar"
  | "reference"
  | "solve"
  | "lbrace"
  | "rbrace"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "eof";

export interface MathToken {
  readonly type: MathTokenType;
  /** The source text this token covers, for a message that quotes it. */
  readonly text: string;
  /** The index in the source where the token starts, for a message that points. */
  readonly start: number;
  /** The value of a number token, and 0 for every other type. */
  readonly value: number;
  /**
   * The resolved name of an identifier token, with a subscript joined by a low
   * line, the word of a command token without its backslash, the address a
   * reference token wraps, or the unknown a solve token names. It is empty for
   * every other type.
   */
  readonly name: string;
}

export interface MathLexError {
  readonly error: "#PARSE";
  readonly message: string;
  readonly start: number;
}

export function isMathLexError(result: readonly MathToken[] | MathLexError): result is MathLexError {
  return "error" in result;
}

/** The commands with no meaning for an evaluator, which the lexer drops. */
const IGNORED_COMMANDS = new Set(["left", "right", "quad", "qquad", "displaystyle", "limits", "nolimits"]);

/** The single characters that follow a backslash to make a space. */
const SPACING_CHARACTERS = new Set([",", ";", ":", "!", " "]);

/** The commands that wrap a multi-letter name. */
const NAME_COMMANDS = new Set(["operatorname", "mathrm", "text", "mathit"]);

/**
 * The command that wraps an address of the document. Its argument is taken
 * whole, so the dots and the low lines in an address reach the parser as one
 * token rather than as a product of letters, which is what juxtaposition would
 * otherwise make of them.
 */
export const MATH_REFERENCE_COMMAND = "gpref";

/**
 * The command that marks the unknown of an implicit line. Notation writes
 * x^2+3=y with nothing to say which letter the object solves for, and a rule
 * that worked it out from the rest of the source would change what a line
 * solves for when an unrelated line above it was edited. So the unknown is
 * written, and the command carries it.
 */
export const MATH_SOLVE_COMMAND = "solve";

const SYMBOL_TOKENS: Readonly<Record<string, MathTokenType>> = {
  "+": "plus",
  "-": "minus",
  "*": "star",
  "/": "slash",
  "^": "caret",
  "=": "equals",
  ",": "comma",
  "_": "underscore",
  "|": "bar",
  "{": "lbrace",
  "}": "rbrace",
  "(": "lparen",
  ")": "rparen",
  "[": "lbracket",
  "]": "rbracket",
};

function isLetter(character: string): boolean {
  return /^[A-Za-z]$/.test(character);
}

function isDigit(character: string): boolean {
  return /^[0-9]$/.test(character);
}

function isNameCharacter(character: string): boolean {
  return /^[A-Za-z0-9]$/.test(character);
}

function token(type: MathTokenType, text: string, start: number, value = 0, name = ""): MathToken {
  return { type, text, start, value, name };
}

function failure(message: string, start: number): MathLexError {
  return { error: "#PARSE", message, start };
}

/**
 * Reads the subscript that follows a name, and returns the suffix to join to
 * it. A subscript is a single character or a braced run, which is the pair of
 * forms LaTeX allows, and an empty result means the name carries none.
 */
function readSubscript(source: string, from: number): { suffix: string; next: number } | MathLexError {
  if (source[from] !== "_") {
    return { suffix: "", next: from };
  }
  let at = from + 1;
  if (source[at] === "{") {
    at += 1;
    let suffix = "";
    while (at < source.length && source[at] !== "}") {
      const character = source[at] as string;
      if (!isNameCharacter(character)) {
        return failure(`a subscript holds letters and digits, and this one holds "${character}"`, at);
      }
      suffix += character;
      at += 1;
    }
    if (source[at] !== "}") {
      return failure("a subscript that opens with a brace needs a closing brace", from);
    }
    if (suffix === "") {
      return failure("a subscript with nothing in it has no meaning", from);
    }
    return { suffix, next: at + 1 };
  }
  const single = source[at];
  if (single === undefined || !isNameCharacter(single)) {
    return failure("a subscript needs a letter or a digit after the underscore", from);
  }
  return { suffix: single, next: at + 1 };
}

/**
 * Reads the braced argument of the address command. It takes every character
 * an address can carry, the dot included, and stops at the closing brace.
 */
function readBracedAddress(source: string, from: number): { text: string; next: number } | MathLexError {
  if (source[from] !== "{") {
    return failure("an address needs a braced address after it", from);
  }
  let at = from + 1;
  let text = "";
  while (at < source.length && source[at] !== "}") {
    const character = source[at] as string;
    if (!isNameCharacter(character) && character !== "_" && character !== ".") {
      return failure(`an address holds letters, digits, underscores and dots, and this one holds "${character}"`, at);
    }
    text += character;
    at += 1;
  }
  if (source[at] !== "}") {
    return failure("an address needs a closing brace", from);
  }
  if (text === "") {
    return failure("an address with nothing in it has no meaning", from);
  }
  return { text, next: at + 1 };
}

/** Reads the braced argument of \operatorname or \mathrm as one name. */
function readBracedName(source: string, from: number): { name: string; next: number } | MathLexError {
  if (source[from] !== "{") {
    return failure("a name command needs a braced name after it", from);
  }
  let at = from + 1;
  let name = "";
  while (at < source.length && source[at] !== "}") {
    const character = source[at] as string;
    if (!isNameCharacter(character) && character !== "_") {
      return failure(`a name holds letters, digits and underscores, and this one holds "${character}"`, at);
    }
    name += character;
    at += 1;
  }
  if (source[at] !== "}") {
    return failure("a name command needs a closing brace", from);
  }
  if (name === "") {
    return failure("a name with nothing in it has no meaning", from);
  }
  return { name, next: at + 1 };
}

/**
 * Turns one line of LaTeX into tokens, or reports the first place it could not
 * read. The result always ends with an eof token, so the parser reads a token
 * at every position without a bounds check.
 */
export function tokenizeMath(source: string): readonly MathToken[] | MathLexError {
  const tokens: MathToken[] = [];
  let at = 0;

  while (at < source.length) {
    const character = source[at] as string;

    if (character === " " || character === "\t" || character === "\r") {
      at += 1;
      continue;
    }

    if (character === "\\") {
      const after = source[at + 1];
      if (after !== undefined && SPACING_CHARACTERS.has(after)) {
        at += 2;
        continue;
      }
      let end = at + 1;
      while (end < source.length && isLetter(source[end] as string)) {
        end += 1;
      }
      const word = source.slice(at + 1, end);
      if (word === "") {
        return failure("a backslash with no command after it has no meaning", at);
      }
      if (word === MATH_REFERENCE_COMMAND) {
        const braced = readBracedAddress(source, end);
        if ("error" in braced) {
          return braced;
        }
        tokens.push(token("reference", source.slice(at, braced.next), at, 0, braced.text));
        at = braced.next;
        continue;
      }
      if (word === MATH_SOLVE_COMMAND) {
        const braced = readBracedName(source, end);
        if ("error" in braced) {
          return braced;
        }
        tokens.push(token("solve", source.slice(at, braced.next), at, 0, braced.name));
        at = braced.next;
        continue;
      }
      if (NAME_COMMANDS.has(word)) {
        const braced = readBracedName(source, end);
        if ("error" in braced) {
          return braced;
        }
        const subscript = readSubscript(source, braced.next);
        if ("error" in subscript) {
          return subscript;
        }
        const name = subscript.suffix === "" ? braced.name : `${braced.name}_${subscript.suffix}`;
        tokens.push(token("identifier", source.slice(at, subscript.next), at, 0, name));
        at = subscript.next;
        continue;
      }
      if (IGNORED_COMMANDS.has(word)) {
        at = end;
        continue;
      }
      tokens.push(token("command", source.slice(at, end), at, 0, word));
      at = end;
      continue;
    }

    if (isDigit(character) || (character === "." && isDigit(source[at + 1] ?? ""))) {
      let end = at;
      while (end < source.length && isDigit(source[end] as string)) {
        end += 1;
      }
      if (source[end] === "." && isDigit(source[end + 1] ?? "")) {
        end += 1;
        while (end < source.length && isDigit(source[end] as string)) {
          end += 1;
        }
      }
      const text = source.slice(at, end);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        return failure(`"${text}" does not read as a number`, at);
      }
      tokens.push(token("number", text, at, value));
      at = end;
      continue;
    }

    if (isLetter(character)) {
      const subscript = readSubscript(source, at + 1);
      if ("error" in subscript) {
        return subscript;
      }
      const name = subscript.suffix === "" ? character : `${character}_${subscript.suffix}`;
      tokens.push(token("identifier", source.slice(at, subscript.next), at, 0, name));
      at = subscript.next;
      continue;
    }

    if (character === ".") {
      return failure(
        `a bare dotted address has no meaning in notation, because letters beside each other multiply. Write \\${MATH_REFERENCE_COMMAND}{...} around it`,
        at,
      );
    }

    const symbol = SYMBOL_TOKENS[character];
    if (symbol !== undefined) {
      tokens.push(token(symbol, character, at));
      at += 1;
      continue;
    }

    return failure(`"${character}" has no meaning in a formula`, at);
  }

  tokens.push(token("eof", "", source.length));
  return tokens;
}
