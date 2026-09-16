/**
 * lexer.ts
 *
 * Turns formula source text into tokens. This is the first of the four stages
 * a formula passes through: lexer, parser, deps and eval.
 *
 * A numeric path segment scans as a number token, so the 0 in vertex.0.x
 * arrives at the parser as a number rather than as part of a name. The parser
 * knows that and joins the pieces back into a path.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

export type WordOrSymbolTokenType =
  | "identifier"
  | "and"
  | "or"
  | "not"
  | "plus"
  | "minus"
  | "star"
  | "slash"
  | "percent"
  | "caret"
  | "eq"
  | "ne"
  | "lt"
  | "gt"
  | "le"
  | "ge"
  | "lparen"
  | "rparen"
  | "comma"
  | "dot"
  | "colon"
  | "eof";

export interface NumberToken {
  readonly type: "number";
  readonly text: string;
  readonly start: number;
  readonly value: number;
}

export interface StringToken {
  readonly type: "string";
  readonly text: string;
  readonly start: number;
  readonly value: string;
}

export interface BooleanToken {
  readonly type: "boolean";
  readonly text: string;
  readonly start: number;
  readonly value: boolean;
}

export interface WordOrSymbolToken {
  readonly type: WordOrSymbolTokenType;
  readonly text: string;
  readonly start: number;
}

export type Token = NumberToken | StringToken | BooleanToken | WordOrSymbolToken;

export interface LexError {
  readonly error: "#PARSE";
  readonly message: string;
  readonly start: number;
}

const KEYWORDS: ReadonlyMap<string, "and" | "or" | "not"> = new Map([
  ["AND", "and"],
  ["OR", "or"],
  ["NOT", "not"],
]);

export const RESERVED_WORDS: ReadonlySet<string> = new Set([...KEYWORDS.keys(), "TRUE", "FALSE"]);

const SINGLE_CHAR_TOKENS: ReadonlyMap<string, WordOrSymbolTokenType> = new Map([
  ["+", "plus"],
  ["-", "minus"],
  ["*", "star"],
  ["/", "slash"],
  ["%", "percent"],
  ["^", "caret"],
  ["=", "eq"],
  ["(", "lparen"],
  [")", "rparen"],
  [",", "comma"],
  [".", "dot"],
  [":", "colon"],
]);

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentifierStart(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_");
}

function isIdentifierPart(ch: string | undefined): boolean {
  return isIdentifierStart(ch) || isDigit(ch);
}

export function lex(source: string): readonly Token[] | LexError {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i] as string;

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }

    if (isDigit(ch)) {
      const start = i;
      while (isDigit(source[i])) {
        i += 1;
      }
      if (source[i] === "." && isDigit(source[i + 1])) {
        i += 1;
        while (isDigit(source[i])) {
          i += 1;
        }
      }
      const text = source.slice(start, i);
      tokens.push({ type: "number", text, start, value: Number(text) });
      continue;
    }

    if (ch === '"') {
      const start = i;
      i += 1;
      let value = "";
      let closed = false;
      while (i < source.length) {
        const c = source[i] as string;
        if (c === '"') {
          i += 1;
          closed = true;
          break;
        }
        if (c === "\\" && source[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        value += c;
        i += 1;
      }
      if (!closed) {
        return {
          error: "#PARSE",
          message: `unterminated string literal starting at offset ${start}`,
          start,
        };
      }
      tokens.push({ type: "string", text: source.slice(start, i), start, value });
      continue;
    }

    if (isIdentifierStart(ch)) {
      const start = i;
      while (isIdentifierPart(source[i])) {
        i += 1;
      }
      const text = source.slice(start, i);
      if (text === "TRUE" || text === "FALSE") {
        tokens.push({ type: "boolean", text, start, value: text === "TRUE" });
      } else {
        const keyword = KEYWORDS.get(text);
        tokens.push({ type: keyword ?? "identifier", text, start });
      }
      continue;
    }

    if (ch === "<") {
      if (source[i + 1] === "=") {
        tokens.push({ type: "le", text: "<=", start: i });
        i += 2;
      } else if (source[i + 1] === ">") {
        tokens.push({ type: "ne", text: "<>", start: i });
        i += 2;
      } else {
        tokens.push({ type: "lt", text: "<", start: i });
        i += 1;
      }
      continue;
    }
    if (ch === ">") {
      if (source[i + 1] === "=") {
        tokens.push({ type: "ge", text: ">=", start: i });
        i += 2;
      } else {
        tokens.push({ type: "gt", text: ">", start: i });
        i += 1;
      }
      continue;
    }

    const singleCharType = SINGLE_CHAR_TOKENS.get(ch);
    if (singleCharType !== undefined) {
      tokens.push({ type: singleCharType, text: ch, start: i });
      i += 1;
      continue;
    }

    // The message names the whole code point, not the one UTF-16 unit the
    // scan is sitting on, so a character outside the basic plane reads as
    // itself rather than as the lone surrogate that is half of it. The offset
    // stays the unit offset, because that is what marks the faulty field.
    const whole = String.fromCodePoint(source.codePointAt(i) as number);
    return { error: "#PARSE", message: `unrecognised character "${whole}" at offset ${i}`, start: i };
  }

  tokens.push({ type: "eof", text: "", start: source.length });
  return tokens;
}
