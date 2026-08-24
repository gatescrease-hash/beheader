/**
 * lexer.ts — Formula source text -> token stream (PROJECT_BRIEF §5.3, stage 1 of 4).
 *
 * IMPLEMENTS: §5.3 ("Lexer -> recursive-descent (or Pratt) parser -> AST -> evaluator.
 * Keep those four stages genuinely separate") — the whole of that first stage and
 * nothing more. It has NO grammar knowledge: it does not know that `IF` takes 2-3
 * arguments, that a range may only appear inside an aggregate call, or that a bare
 * `A1` is only legal inside a table cell formula. All of that is `parser.ts`'s job.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   `lex(source)` scans left to right and returns either the complete token list
 *   (always ending in an `eof` token) or a single `LexError`. It NEVER throws — §6's
 *   Phase 1 criterion requires "malformed input yields #PARSE rather than throwing".
 *
 *   Four token SHAPES, not one per punctuation character:
 *   - `NumberToken`/`StringToken`/`BooleanToken` carry a `value` already parsed out of
 *     the text, because the scan that found the token's extent already computed it —
 *     recomputing it in `parser.ts` would be the same work in two places that could
 *     disagree.
 *   - `WordOrSymbolToken` covers every keyword, operator, punctuation mark,
 *     name-shaped word, and the `eof` marker. None need anything beyond `type`, so one
 *     shape covers all of them (Rule 5, the same reasoning `ast.ts`'s `LiteralNode`
 *     applies to AST nodes).
 *   Discriminated on `type`, never by structural shape (D-014).
 *
 *   Decisions this file settles. All are reversible: nothing here is ever stored —
 *   §5.11 serializes ASTs, never source text — so a lexing-policy change migrates
 *   nothing.
 *   - **Numbers are unsigned**: `[0-9]+(\.[0-9]+)?`, no leading dot, no exponent, and
 *     critically no leading `-`. §5.3 lists `-2` as a literal example, but `-` also
 *     starts the unary-minus production in the same precedence chain; the brief's own
 *     grammar resolves this by making `-2` a `UnaryOpNode`. A minus is therefore always
 *     a standalone token, in every position, and `parser.ts` decides binary vs. unary.
 *   - **Keywords (`AND`/`OR`/`NOT`/`TRUE`/`FALSE`) are exact-uppercase, case-
 *     sensitive.** Every occurrence in §5.3 is uppercase, and D-008 set this project's
 *     forward-safe default for a similar keyword-like token: uppercase now, lowercase
 *     acceptance is purely additive later. Anything not matching exactly lexes as an
 *     ordinary `identifier`.
 *   - **`IF` gets no keyword token.** Unlike `AND`/`OR`/`NOT` it appears only in
 *     §5.3's built-ins list, never in the precedence chain, so it lexes as a plain
 *     `identifier` exactly like `SUM`. This is what keeps a built-in-function name
 *     list out of this file entirely — that vocabulary belongs to `functions.ts`.
 *   - **The one specified string escape, `\"`, is honoured; nothing else is.** A
 *     backslash not followed by `"` is copied through literally. §5.3 specifies
 *     exactly one escape, so this file invents no others. Disclosed consequence: a
 *     string cannot end in a literal backslash immediately before its closing quote.
 *   - **A token stream always ends in one `eof` token**, so `parser.ts` can always
 *     peek one ahead without a bounds check.
 *
 * INVARIANTS UPHELD HERE
 *   - `lex` NEVER throws. Every malformed input (unrecognised character, unterminated
 *     string) is a returned `LexError` — pinned by a test wrapping calls in try/catch.
 *   - `lex`'s output accounts for EVERY character of `source`: each is either consumed
 *     into some token's `text` or is skipped whitespace — pinned by a test asserting
 *     exact `start` offsets across a mixed fixture, so a future change cannot silently
 *     drop or duplicate a character.
 *
 * NOT DONE HERE
 *   - Grammar, precedence, AST construction (`parser.ts`).
 *   - Whether a numeric token's `value` is legal DOCUMENT state. A long enough digit
 *     run lexes to `Infinity` here exactly as `Number(...)` would. Correctly not this
 *     file's job — nothing here is document state until a mutation writes it in;
 *     `mutation.ts`'s `findIllegalSlotValues` catches it, and as of D-031 that check
 *     walks a stored AST's literals too, so such a token is rejected before it could
 *     serialize to `null`.
 *   - Recognising `A1`-shaped identifiers as cell references or resolving any
 *     identifier to an `Address` — all needs grammar context this file has none of.
 *     One consequence flagged for `parser.ts`: because `identifier` requires a LEADING
 *     letter or underscore (matching `address.ts`'s `NAME_PATTERN`), a purely-numeric
 *     path segment scans as a `number` token, so `vertex.0.x` arrives as
 *     `identifier dot number dot identifier` and the parser must accept a `number`
 *     token's `text` as a path segment when reassembling a dotted reference.
 */

/** Every `WordOrSymbolToken` variant: keywords, operators, punctuation, plain words, and `eof`. */
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

/** A number literal (§5.3): `[0-9]+(\.[0-9]+)?`. `value` is already `Number(text)` — see the file header. */
export interface NumberToken {
  readonly type: "number";
  readonly text: string;
  readonly start: number;
  readonly value: number;
}

/**
 * A double-quoted string literal (§5.3), `\"` the only recognised escape (file header).
 * `value` has the escape already resolved; `text` is the raw source slice, quotes
 * included.
 */
export interface StringToken {
  readonly type: "string";
  readonly text: string;
  readonly start: number;
  readonly value: string;
}

/** `TRUE` or `FALSE` (§5.3), matched case-sensitively, exact uppercase — see the file header. */
export interface BooleanToken {
  readonly type: "boolean";
  readonly text: string;
  readonly start: number;
  readonly value: boolean;
}

/**
 * Every keyword, operator, punctuation mark, name-shaped word, and the trailing `eof`
 * marker — none of these need anything beyond `type` to be meaningful. See the file
 * header for why one shape covers all of them.
 */
export interface WordOrSymbolToken {
  readonly type: WordOrSymbolTokenType;
  readonly text: string;
  readonly start: number;
}

/** One token in a formula's source text. Discriminated on `type` — see the file header. */
export type Token = NumberToken | StringToken | BooleanToken | WordOrSymbolToken;

/**
 * The failure shape `lex` returns for malformed input — the `#PARSE` arm of
 * `graph/node.ts`'s `ErrorCode` (§5.1), spelled out as its own one-member literal
 * rather than imported, the same choice `address.ts`'s `AddressError` and
 * `formula/ast.ts`'s `ErrorNode` already made for `#REF` (additively widenable, no
 * import coupling to a union this file has no other reason to depend on). `start` is
 * the source offset the problem begins at, for a caller building a human-readable
 * message (§5.10: "every rejection message must name the specific...").
 *
 * Discriminating a `lex` result from a real token list needs no predicate: one is an
 * array, the other is not — `Array.isArray(result)` suffices, unlike `AddressError`
 * (D-014/`isAddressError`'s reason for existing), which must be told apart from
 * another plain object shape.
 */
export interface LexError {
  readonly error: "#PARSE";
  readonly message: string;
  readonly start: number;
}

/** §5.3's three keyword operators that also double as functions (D-029) — `TRUE`/`FALSE` are handled separately, as literals, not operators. */
const KEYWORDS: ReadonlyMap<string, "and" | "or" | "not"> = new Map([
  ["AND", "and"],
  ["OR", "or"],
  ["NOT", "not"],
]);

/** Every punctuation/operator character that is unambiguous on its own — no two-character form to look ahead for (`<`/`>` are handled separately; they might extend to `<=`/`<>`/`>=`). */
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

/**
 * Scans `source` into a flat token stream (§5.3, lexer stage). See the file header for
 * the full design. Never throws: an unrecognised character or an unterminated string
 * returns a `LexError` instead of unwinding.
 */
export function lex(source: string): readonly Token[] | LexError {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i] as string; // Safe: i < source.length, just checked by the while condition.

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }

    if (isDigit(ch)) {
      const start = i;
      while (isDigit(source[i])) {
        i += 1;
      }
      // A fractional part is consumed only when a digit actually follows the dot
      // (file header: "no leading dot" — `5.` deliberately leaves the dot for the
      // NEXT token, since a dot with nothing numeric after it is a reference
      // separator, not part of this number).
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
        const c = source[i] as string; // Safe: i < source.length, just checked by the while condition.
        if (c === '"') {
          i += 1;
          closed = true;
          break;
        }
        // The one specified escape (§5.3): `\"` -> a literal quote. Any other
        // backslash is copied through as its own character — see the file header.
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
