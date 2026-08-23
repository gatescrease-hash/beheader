/**
 * lexer.ts — Formula source text -> token stream (PROJECT_BRIEF §5.3, stage 1 of 4).
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.3 ("Lexer -> recursive-descent (or Pratt) parser -> AST
 * -> evaluator. Keep those four stages genuinely separate"). This is that first stage,
 * and the whole of it: turning a formula's raw source text into a flat list of `Token`s.
 * It has NO grammar knowledge — it does not know that `IF` takes 2-3 arguments, that a
 * range may only appear inside an aggregate call, or that a bare `A1` is only legal
 * inside a table cell formula. All of that is `parser.ts`'s job (a later, unbatched
 * cycle — 0029-REVIEW-phase1's carried constraint 1: do not batch it behind this file).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * This is an ORDINARY file inside the now-reviewed `formula/` subsystem (0029-REVIEW
 * signed off `ast.ts`), not a new subsystem's first file — §6.4's expected verdict for
 * this cycle is REVIEW: NOT NEEDED, unless something below actually fires a §6.1
 * trigger.
 *
 * WHAT THIS IS
 *   `lex(source)` scans `source` left to right and returns either the complete token
 *   list (always ending in an "eof" token) or a single `LexError`. It NEVER throws —
 *   §6's Phase 1 criterion requires "malformed input yields #PARSE rather than
 *   throwing," and a thrown exception from any stage that can run during a mutation
 *   would violate §5.1's "errors must never throw across the evaluation loop" (Rule 2).
 *
 *   Token kinds, and why there are exactly four SHAPES (not one per punctuation
 *   character):
 *   - `NumberToken` / `StringToken` / `BooleanToken` — carry a `value` already parsed
 *     out of the source text (a JS `number`/`string`/`boolean`), because the scan that
 *     finds each token's extent (walking digits, resolving the one string escape) has
 *     already computed it — recomputing it a second time in `parser.ts` would be the
 *     same work done twice, in two places that could disagree.
 *   - `WordOrSymbolToken` — every keyword, operator, punctuation mark, name-shaped
 *     word, and the trailing `eof` marker. None of these need anything beyond `type` to
 *     be meaningful, so one shape covers all of them — Rule 5's "dumbest correct" shape,
 *     the same reasoning `formula/ast.ts`'s `LiteralNode` already applies to AST nodes
 *     (one type for three literal kinds, not three near-identical interfaces).
 *   `Token = NumberToken | StringToken | BooleanToken | WordOrSymbolToken`, discriminated
 *   on `type` — D-014's principle (a predicate/union is declared once, narrowed by
 *   `type`, never by structural shape) extended to a new union.
 *
 *   Design decisions this file settles, all reversible (nothing here is stored —
 *   formula ASTs are what §5.11 serializes, never source text, so a lexing-policy
 *   change later migrates nothing):
 *
 *   - **Numbers are unsigned in the grammar this lexer implements**:
 *     `[0-9]+(\.[0-9]+)?` — no leading dot, no exponent notation, and critically NO
 *     leading `-`. §5.3 lists `-2` as a literal example, but `-` is also the FIRST
 *     character of the unary-minus production in the SAME precedence chain ("unary - /
 *     NOT") — the brief's own grammar already resolves this by making `-2` a
 *     `UnaryOpNode("-", LiteralNode(2))`, not a signed number literal (see `ast.ts`).
 *     A minus sign is therefore always lexed as a standalone `minus` token, in every
 *     position; `parser.ts` decides whether a given occurrence is binary or unary.
 *   - **Keywords (`AND`, `OR`, `NOT`, `TRUE`, `FALSE`) are recognised case-sensitively,
 *     exact uppercase only.** Every occurrence in §5.3 is written uppercase, and D-008
 *     already set this project's forward-safe default for a similar keyword-like token
 *     (the A1 cell-reference form): uppercase now, lowercase acceptance is purely
 *     additive later. `and`/`And`/`FALSE ` (trailing space aside) lexes as an ordinary
 *     `identifier` when not exactly matching, recoverable later without migrating
 *     anything stored.
 *   - **`IF` gets no keyword token.** Unlike `AND`/`OR`/`NOT`, `IF` appears ONLY in
 *     §5.3's built-ins list, never in the operator precedence chain — it is exclusively
 *     `FunctionCallNode`-shaped (`ast.ts`'s own header says so), so `IF` lexes as a
 *     plain `identifier`, exactly like `SUM` or `ROUND`. This is what keeps this file
 *     free of any built-in-function name list to hardcode — that vocabulary belongs to
 *     `functions.ts`'s registry (§5.3: "table-driven... so adding one is a single
 *     line"), not to the lexer.
 *   - **The one specified string escape, `\"`, is honoured; nothing else is.** A
 *     backslash not immediately followed by `"` is copied through literally as its own
 *     character, not consumed as part of a pair — §5.3 specifies exactly one escape and
 *     no general backslash-escaping scheme, so this file invents no others. One
 *     disclosed consequence: a string literal cannot end in a literal backslash
 *     immediately before its closing quote (that backslash always pairs with the quote
 *     as the one defined escape instead) — an obscure edge the brief gives no guidance
 *     on and not worth a Q-NNN for.
 *   - **A token stream always ends in one `eof` token.** `parser.ts` can therefore
 *     always peek one token ahead without a bounds check of its own.
 *
 * INVARIANTS UPHELD HERE
 *   - `lex` NEVER throws. Every malformed input (an unrecognised character, an
 *     unterminated string) is a returned `LexError`, never an exception — pinned by a
 *     dedicated test wrapping calls in try/catch.
 *   - `lex`'s output, read start-to-end, accounts for every character of `source`:
 *     each one is either consumed into some token's `text` or is whitespace skipped
 *     between tokens — pinned by a test asserting exact `start` offsets across a mixed
 *     fixture, so a future change cannot silently drop or duplicate a character.
 *
 * NOT DONE HERE
 *   - Grammar, precedence, and AST construction (`parser.ts` — later, unbatched cycle).
 *   - Whether a numeric token's `value` is legal DOCUMENT state (D-025/D-027's
 *     `isIllegalNumber`) — a long enough digit run lexes to `Infinity` here exactly the
 *     way `Number("1" + "0".repeat(400))` does in plain JS. Correctly not this file's
 *     job: nothing this file produces is document state until a later mutation writes
 *     it in. **But the check that must catch it does not exist yet** — corrected at
 *     0032-REVIEW-phase1, which found this comment claiming otherwise.
 *     `validateIntegrity`'s `findIllegalSlotValues` walks each slot's `value` field
 *     ONLY; it never walks a formula slot's stored `ast`, so a `LiteralNode` holding
 *     `Infinity` would pass it and then serialize to `null` (§6 clause 4's
 *     round-trip-identically claim, falsified — D-025's own reasoning). Unreachable
 *     TODAY only because `findUnsupportedFormulaAsts` rejects every non-reference AST
 *     shape outright. **D-031** binds the fix to the cycle that removes that shield.
 *   - Recognising `A1`-shaped identifiers as cell references, resolving any identifier
 *     to an `Address`, or deciding whether a numeric-looking path segment (the `0` in
 *     `vertex.0.x`) is part of a reference rather than an arithmetic literal — all of
 *     that needs grammar context this file deliberately has none of. One consequence
 *     flagged for `parser.ts`: because this lexer's `identifier` pattern requires a
 *     LEADING letter or underscore (matching `address.ts`'s own `NAME_PATTERN`), a
 *     purely-numeric path segment scans as a `number` token, not an `identifier` — a
 *     reference like `vertex.0.x` therefore arrives at the parser as
 *     `identifier(vertex) dot number(0) dot identifier(x)`, and the parser must accept
 *     a `number` token's `text` as a path segment when reassembling a dotted reference.
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
