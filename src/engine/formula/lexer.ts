/**
 * lexer.ts
 *
 * The lexer turns source text into tokens, as stage one of four.
 *
 * A numeric path segment, such as the 0 in vertex.0.x, scans as a number
 * token. The parser knows this and puts it back together.
 *
 * The file belongs to the engine layer and works on plain data alone. It does
 * not use the DOM, a window or a canvas. That keeps it testable without a
 * browser, and ready for a port to Rust.
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

    return { error: "#PARSE", message: `unrecognised character "${ch}" at offset ${i}`, start: i };
  }

  tokens.push({ type: "eof", text: "", start: source.length });
  return tokens;
}
