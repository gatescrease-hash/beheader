/**
 * parser.ts — Token stream -> FormulaAst (PROJECT_BRIEF §5.3, stage 2 of 4).
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.3's full v1 grammar: literals, references (dotted
 * `name.path` AND bare cell refs), the entire operator precedence chain, function
 * calls, and ranges restricted to an aggregate function's direct argument. Also
 * implements **D-029** (`AND`/`OR`/`NOT` as BOTH infix/prefix operators and callable
 * functions, both forms meaning the same thing) and inherits **Q-004**'s still-open,
 * still-provisional uppercase-only cell-reference form unchanged (this file makes no
 * new ruling on it — see `address.ts`'s `isCellReferenceForm`, reused here rather than
 * duplicated).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * This is an ORDINARY file inside the now-reviewed `formula/` subsystem (0029-REVIEW
 * signed off `ast.ts`; entry 0030 added `lexer.ts` with no trigger firing), not a new
 * subsystem's first file. 0029-REVIEW's own carried note predicted this file would be
 * denser than `lexer.ts` — "parser.ts is where D-029, Q-004, and range placement all
 * land at once" — and it was; see the cycle's own log entry for why REVIEW:
 * RECOMMENDED is the honest self-assessment here even though no single §6.1 trigger
 * cleanly fired.
 *
 * WHAT THIS IS
 *   Two exported entry points:
 *   - `parseFormulaTokens(tokens, objects, tableObjectId?)` — the real parser,
 *     consuming an already-`lex`ed `Token[]` (stage-separation: this file never scans
 *     characters). Returns a `FormulaAst` or a `ParseError`; NEVER throws.
 *   - `parseFormula(source, objects, tableObjectId?)` — the convenience wrapper real
 *     callers (a future `link`/`set` command, table cell input, text's `{= }`
 *     embedding — all later cycles) will actually use: calls `lex`, then
 *     `parseFormulaTokens`. A `LexError` from the lex stage is returned as-is — it is
 *     structurally identical to this file's own `ParseError` (both are `#PARSE`-
 *     shaped; see `ParseError`'s own doc comment for why that's declared fresh here
 *     rather than imported, following `LexError`'s and `AddressError`'s own precedent).
 *
 *   `objects` is the same `AddressableObject[]` shape `address.ts` already defines —
 *   §5.2: "A resolver maps name -> ID at parse time; stored ASTs hold IDs, not
 *   names," so THIS file is where that resolution happens for formulas, exactly the
 *   way `parseAddress` already does it for a bare address string. An unresolvable
 *   name is therefore a hard `#PARSE` here, immediately, regardless of which branch of
 *   an `IF` it sits in (§5.3: "An unresolvable reference is a PARSE-time error
 *   regardless of branch, because names are resolved to IDs at parse time").
 *
 *   `tableObjectId` is how a caller supplies "the table this formula lives in" (§5.3:
 *   bare cell refs are "legal only inside a table cell formula and mean 'this table,
 *   that cell'"). Omitted (or `undefined`) for every other context — §5.3: "Bare refs
 *   in text formulas are a parse error," which falls out for free here: with no table
 *   context, a bare single-segment cell-shaped word has nowhere to resolve against and
 *   falls through to `address.ts`'s ordinary `name.path` rejection (see
 *   `parseReferenceAddress`). This file TRUSTS that a caller-supplied `tableObjectId`
 *   names a real table — it does not re-verify that against `objects` — the same
 *   layered-validation posture `address.ts` itself documents (a schema/graph-shape
 *   check belongs to a later validation layer, ultimately `mutation.ts`'s
 *   `validateIntegrity`, D-017's own precedent: parse-time correctness is necessary,
 *   not sufficient, and the mutation layer re-checks independently regardless).
 *
 *   The full precedence chain (§5.3, loosest to tightest), each its own tier function,
 *   all but the two tightest built from ONE shared left-associative-binary-op helper
 *   (`parseLeftAssociativeExpr`) rather than five near-identical loops:
 *   `OR -> AND -> comparison -> + - -> * / % -> ^ -> unary - / NOT -> primary`.
 *   `^` is LEFT-associative — the brief is silent on this, and this project's own
 *   stated model for the formula language is Excel (§1), whose `^` is itself
 *   left-associative (`2^3^2` = `(2^3)^2` = 64, not 512) — so this is not an arbitrary
 *   pick, it is the one reading consistent with the brief's own chosen precedent.
 *   Reversible either way: nothing is stored as re-parseable source text (§5.11 stores
 *   the AST, never source), so a future change to this choice would affect only
 *   NEWLY-typed formulas, never a previously-saved document.
 *
 *   `A1:B4` (§5.3's range grammar) is parsed WHEREVER it is syntactically reachable —
 *   a bare reference immediately followed by `:` and a second bare reference, with no
 *   restriction on POSITION at parse time (see `parseReferenceOrRangeExpr`) — and its
 *   §5.3 placement restriction ("only as an argument to an aggregate function") is
 *   enforced SEPARATELY, by `validateRangePlacement`, a single tree walk over the
 *   finished AST run once by `parseFormulaTokens` right before returning success. This
 *   two-pass split (permissive parse, then a placement check) is deliberately simpler
 *   than threading an "am I a direct aggregate argument" flag through every precedence
 *   tier function, and it has one disclosed, deliberate consequence: because
 *   parentheses add NO node to this AST (§5.3's grammar has no `ParenNode` — a
 *   parenthesized sub-expression parses to exactly the tree its contents would have
 *   produced unparenthesized), `SUM((A1:B4))` is indistinguishable, post-parse, from
 *   `SUM(A1:B4)` and is therefore ACCEPTED, identically. This is judged the right,
 *   simpler reading of "only as an argument to an aggregate function" — nothing in
 *   §5.3 suggests a redundant paren should specifically defeat that.
 *
 *   `AND`/`OR`/`NOT` (D-029) work in BOTH forms because `lexer.ts` gives them their
 *   own keyword token types (`and`/`or`/`not`, never `identifier`) and this file
 *   checks, at every point a NAME could start either an infix/prefix operator OR a
 *   function call, whether the token immediately after is `(`: if so, it is a call
 *   (`parsePrimaryExpr` dispatches to `parseFunctionCallExpr`, using the keyword
 *   token's own `text` — already exactly `"AND"`/`"OR"`/`"NOT"` — as the function
 *   name); if not, it is the operator form (`parseAndExpr`/`parseOrExpr`'s ordinary
 *   infix loop, or `parseUnaryExpr`'s prefix handling for `NOT`). `IF` needs none of
 *   this special-casing — it was never a keyword token to begin with (`lexer.ts`'s own
 *   header: `IF` lexes as a plain `identifier`), so `IF(...)` is handled by the exact
 *   same "identifier followed by `(`" path every other built-in function name is.
 *
 *   This file does NOT validate a function's NAME or ARITY (`FOO(1,2,3)` for an
 *   unrecognised `"FOO"` parses successfully as a `FunctionCallNode` — `functions.ts`,
 *   a later cycle, is the registry that rejects it) — with exactly one, narrow,
 *   brief-mandated exception: which names may take a range argument (`SUM`/`MIN`/
 *   `MAX`/`AVG`, §5.3's own words), needed to enforce the range-placement rule THIS
 *   cycle, before `functions.ts` exists to own that vocabulary generally. This is a
 *   disclosed, minimal duplication expected to fold into `functions.ts`'s registry
 *   later (e.g. an `isAggregate` flag per entry) rather than staying a second list
 *   forever — not done now because `functions.ts` does not exist yet.
 *
 * INVARIANTS UPHELD HERE
 *   - `parseFormulaTokens`/`parseFormula` NEVER throw. Every malformed input is a
 *     returned `ParseError`, never an exception — matching `lexer.ts`'s own discipline
 *     and §5.1's "errors must never throw across the evaluation loop."
 *   - Every `ReferenceNode` this file produces holds a resolved `Address` — an ID, not
 *     a name (§5.2) — via `address.ts`'s own `parseAddress`, or (bare cell refs only)
 *     built directly against the caller-supplied `tableObjectId`. No path is ever
 *     hand-built from string concatenation outside those two, already-reviewed call
 *     sites.
 *   - A `RangeNode` this file produces always has `start`/`end` that are themselves
 *     resolved `Address`es (via the same `parseReferenceAddress` bare references go
 *     through) — never an arbitrary expression, matching `RangeNode`'s own type shape.
 *
 * NOT DONE HERE
 *   - `extractDependencies` (`formula/deps.ts`), evaluation (`formula/eval.ts`), the
 *     function registry (`formula/functions.ts`) — all later, unbatched cycles.
 *   - Validating a function's name/arity beyond the narrow aggregate-placement
 *     exception above (see WHAT THIS IS).
 *   - Text's `{= }` / `{? }{:}{?}` embedding syntax (§5.6) — a block-tree concern,
 *     Phase 5, layered ON TOP of this file (a text dependency walker calls into this
 *     parser for each embedded formula's inner expression text; it does not change
 *     anything about how that inner text itself is parsed).
 *   - The leading `=` that marks a table cell's raw text as a formula rather than a
 *     literal (§5.3's own examples, e.g. `= polygon_1.origin.x * 2`) is NOT part of
 *     this file's grammar at all — `=` inside an expression is the EQUALITY
 *     comparison operator (§5.3's own precedence chain). Deciding "does this cell's
 *     raw text need to go through `parseFormula` at all" is a caller-level policy
 *     (whoever wires this into table cell input, a later cycle) that strips any
 *     leading `=` BEFORE calling this file, exactly as it must decide "is this
 *     literal text or a formula" in the first place.
 *   - A known, disclosed limitation inherited from `lexer.ts`'s own design: two
 *     directly-adjacent purely-numeric path segments merge into one decimal NUMBER
 *     token at the lexer stage (`a.1.5.b` lexes as `identifier(a) dot number(1.5) dot
 *     identifier(b)`, not four segments) — see `lexer.ts`'s own header. This never
 *     arises for any address this schema actually produces (`vertex.N.x`/`vertex.N.y`
 *     is the only numeric-segment shape in the whole brief, always a single index,
 *     never two consecutive numeric segments), so it is not fixed here — fixing it
 *     would require the lexer to carry grammar context it is deliberately free of.
 */
import { type Address, type AddressableObject, bareCellAddress, isAddressError, isCellReferenceForm, parseAddress } from "../address.ts";
import type { BinaryOperator, FormulaAst } from "./ast.ts";
import { lex, type LexError, type Token } from "./lexer.ts";

/**
 * The failure shape this file returns for malformed input — declared fresh, not
 * imported from `lexer.ts`, following `LexError`'s own precedent (`address.ts`'s
 * `AddressError` and `ast.ts`'s `ErrorNode` made the identical choice for `#REF`):
 * additively widenable, no import coupling to a type this file's own callers have no
 * other reason to depend on. Structurally identical to `LexError` on purpose — a
 * `LexError` returned by `parseFormula`'s internal `lex` call is a valid `ParseError`
 * with no conversion needed (see the file header).
 *
 * `start` is best-effort: most `ParseError`s point at the exact offending token, but
 * `validateRangePlacement`'s post-parse structural check has no source position left
 * to report (the AST carries none — see `ast.ts`) and uses `0` rather than inventing
 * one. Callers building a human-readable message (§5.10) should treat `start` as a
 * hint, not a guarantee.
 */
export interface ParseError {
  readonly error: "#PARSE";
  readonly message: string;
  readonly start: number;
}

/**
 * Narrows a `parseFormula`/`parseFormulaTokens` result to its `ParseError` arm — same
 * reason and same shape as `address.ts`'s `isAddressError` (D-014's principle: declare
 * the narrowing once, import it everywhere, never re-derive it with a cast).
 *
 * Discriminates on the VALUE of `error` (`"#PARSE"`), never on the mere PRESENCE of an
 * `error` field (D-032, 0032-REVIEW-phase1). `ast.ts`'s `ErrorNode` — `{ type: "error";
 * error: "#REF" }`, D-028 — is a `FormulaAst`, i.e. a member of this function's own
 * argument union, and it HAS an `error` field: a presence check reports a perfectly
 * good repaired AST as a parse failure. Nothing constructs an `ErrorNode` yet, so this
 * was latent rather than live, but it becomes reachable the moment §5.4's
 * reference-adjustment pass writes one (a cell holding `= B1` whose column is deleted
 * repairs to an `ErrorNode` AT THE ROOT).
 */
export function isParseError(value: unknown): value is ParseError {
  return typeof value === "object" && value !== null && "error" in value && value.error === "#PARSE";
}

/**
 * Narrows `lex`'s own `readonly Token[] | LexError` result to its error arm. A plain
 * `Array.isArray` check at the `parseFormula` call site does not narrow a
 * `ReadonlyArray`-flavoured union reliably under this project's TS config — an
 * explicit type predicate here does, and is a smaller, more legible fix than an `as`
 * cast at the call site.
 */
function isLexError(result: readonly Token[] | LexError): result is LexError {
  return !Array.isArray(result);
}

/** §5.3's four aggregate functions — the only names a `RangeNode` may be a direct argument of. See the file header for why this is a small, disclosed, temporary duplication rather than a `functions.ts` lookup. */
const AGGREGATE_FUNCTION_NAMES: ReadonlySet<string> = new Set(["SUM", "MIN", "MAX", "AVG"]);

const OR_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([["or", "OR"]]);
const AND_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([["and", "AND"]]);
const COMPARISON_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([
  ["eq", "="],
  ["ne", "<>"],
  ["lt", "<"],
  ["gt", ">"],
  ["le", "<="],
  ["ge", ">="],
]);
const ADDITIVE_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([
  ["plus", "+"],
  ["minus", "-"],
]);
const MULTIPLICATIVE_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([
  ["star", "*"],
  ["slash", "/"],
  ["percent", "%"],
]);
const POWER_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([["caret", "^"]]);

/**
 * This file's own mutable parsing state: the token list, a cursor into it, and the
 * two pieces of resolution context every reference needs (§5.2's object list; §5.3's
 * "which table" for a bare cell ref). Local to a single `parseFormulaTokens` call,
 * never exported, never touches document state — the same category of transient,
 * discard-after-use working data `lexer.ts`'s `lex` keeps in its own local variables,
 * just given a name here because ~10 functions share it instead of one loop body.
 */
interface ParserState {
  readonly tokens: readonly Token[];
  pos: number;
  readonly objects: readonly AddressableObject[];
  readonly tableObjectId: string | undefined;
}

/** The token at the cursor. Always safe: `advance` refuses to move past the trailing `eof` token (see below), so `pos` never exceeds `tokens.length - 1`. */
function peek(state: ParserState): Token {
  return state.tokens[state.pos] as Token; // Safe: see doc comment above.
}

/** The token `offset` positions ahead of the cursor, clamped to the trailing `eof` token if that would run past the end — lets callers check "is a `(` next" without consuming anything. */
function peekAt(state: ParserState, offset: number): Token {
  const index = state.pos + offset;
  const clamped = index < state.tokens.length ? index : state.tokens.length - 1;
  return state.tokens[clamped] as Token; // Safe: tokens is non-empty (always ends in eof, per lex's own contract) and clamped is within bounds.
}

/** Consumes and returns the current token, unless it is already `eof` — an `eof` token is never consumed, so repeated calls at end-of-input keep returning it rather than reading past the array. */
function advance(state: ParserState): Token {
  const token = peek(state);
  if (token.type !== "eof") {
    state.pos += 1;
  }
  return token;
}

/** A single, consistently-worded "found the wrong thing" error, used everywhere a specific token was required and something else was there. */
function unexpectedTokenError(token: Token, expected: string): ParseError {
  const found = token.type === "eof" ? "end of formula" : `"${token.text}"`;
  return { error: "#PARSE", message: `expected ${expected}, found ${found}`, start: token.start };
}

/** Consumes the current token if it has type `type`; otherwise reports it as unexpected, naming what was wanted (`description`, e.g. `'")"'`). */
function expect(state: ParserState, type: Token["type"], description: string): Token | ParseError {
  const token = peek(state);
  if (token.type !== type) {
    return unexpectedTokenError(token, description);
  }
  return advance(state);
}

/**
 * The ONE loop every left-associative binary-operator precedence tier shares (`OR`,
 * `AND`, comparison, `+ -`, `* / %`, `^` — six tiers, one implementation): parse the
 * next tighter tier, then keep consuming `operator right` pairs from `operatorTokens`
 * for as long as one matches the current token, folding left-to-right. See the file
 * header for why `^` being included here (rather than given special right-associative
 * handling) is a deliberate, documented choice, not an oversight.
 */
function parseLeftAssociativeExpr(
  state: ParserState,
  nextTier: (state: ParserState) => FormulaAst | ParseError,
  operatorTokens: ReadonlyMap<string, BinaryOperator>,
): FormulaAst | ParseError {
  let left = nextTier(state);
  if (isParseError(left)) {
    return left;
  }
  while (true) {
    const operator = operatorTokens.get(peek(state).type);
    if (operator === undefined) {
      return left;
    }
    advance(state);
    const right = nextTier(state);
    if (isParseError(right)) {
      return right;
    }
    left = { type: "binaryOp", operator, left, right };
  }
}

function parseOrExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parseAndExpr, OR_OPERATOR_TOKENS);
}

function parseAndExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parseComparisonExpr, AND_OPERATOR_TOKENS);
}

function parseComparisonExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parseAdditiveExpr, COMPARISON_OPERATOR_TOKENS);
}

function parseAdditiveExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parseMultiplicativeExpr, ADDITIVE_OPERATOR_TOKENS);
}

function parseMultiplicativeExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parsePowerExpr, MULTIPLICATIVE_OPERATOR_TOKENS);
}

function parsePowerExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parseUnaryExpr, POWER_OPERATOR_TOKENS);
}

/**
 * §5.3's two prefix operators. `NOT` is handled here only when NOT immediately
 * followed by `(` — `NOT(` is the call form (D-029) and is left for `parsePrimaryExpr`
 * to dispatch, the same way every other function name is. Both operators recurse into
 * `parseUnaryExpr` itself (not straight to `parsePrimaryExpr`), so repeated prefixes
 * (`- -3`, `NOT NOT a`) parse correctly rather than being artificially limited to one.
 */
function parseUnaryExpr(state: ParserState): FormulaAst | ParseError {
  const token = peek(state);

  if (token.type === "minus") {
    advance(state);
    const operand = parseUnaryExpr(state);
    if (isParseError(operand)) {
      return operand;
    }
    return { type: "unaryOp", operator: "-", operand };
  }

  if (token.type === "not" && peekAt(state, 1).type !== "lparen") {
    advance(state);
    const operand = parseUnaryExpr(state);
    if (isParseError(operand)) {
      return operand;
    }
    return { type: "unaryOp", operator: "NOT", operand };
  }

  return parsePrimaryExpr(state);
}

/** Whether `token` could name a function call — the identifier form, or one of D-029's three operator keywords used in call syntax (`AND(...)`/`OR(...)`/`NOT(...)`). `TRUE`/`FALSE` (their own `boolean` token type) are deliberately excluded: they are literals, never callable. */
function isFunctionNameToken(token: Token): boolean {
  return token.type === "identifier" || token.type === "and" || token.type === "or" || token.type === "not";
}

/**
 * Literals, parenthesized sub-expressions, function calls, and references/ranges —
 * everything at the grammar's tightest tier. See the file header for the `AND`/`OR`/
 * `NOT`-as-call dispatch and the range/reference split.
 */
function parsePrimaryExpr(state: ParserState): FormulaAst | ParseError {
  const token = peek(state);

  if (token.type === "number" || token.type === "string" || token.type === "boolean") {
    advance(state);
    return { type: "literal", value: token.value };
  }

  if (token.type === "lparen") {
    advance(state);
    const inner = parseOrExpr(state);
    if (isParseError(inner)) {
      return inner;
    }
    const closing = expect(state, "rparen", '")"');
    if (isParseError(closing)) {
      return closing;
    }
    return inner;
  }

  if (isFunctionNameToken(token) && peekAt(state, 1).type === "lparen") {
    return parseFunctionCallExpr(state, token.text);
  }

  if (token.type === "identifier") {
    return parseReferenceOrRangeExpr(state);
  }

  return unexpectedTokenError(token, "an expression");
}

/** `NAME(arg, arg, ...)` (§5.3), zero or more comma-separated arguments, each a full expression (`parseOrExpr`, the top of the precedence chain) — so `SUM(A1:B4)`'s single argument can itself be a range (see the file header on range placement) while `IF(a > b, 1, 2)`'s three arguments are ordinary expressions. */
function parseFunctionCallExpr(state: ParserState, name: string): FormulaAst | ParseError {
  advance(state); // the name token itself — already peeked by the caller

  const openParen = expect(state, "lparen", '"("');
  if (isParseError(openParen)) {
    return openParen;
  }

  const args: FormulaAst[] = [];
  if (peek(state).type !== "rparen") {
    const first = parseOrExpr(state);
    if (isParseError(first)) {
      return first;
    }
    args.push(first);
    while (peek(state).type === "comma") {
      advance(state);
      const next = parseOrExpr(state);
      if (isParseError(next)) {
        return next;
      }
      args.push(next);
    }
  }

  const closeParen = expect(state, "rparen", '")" to close the argument list');
  if (isParseError(closeParen)) {
    return closeParen;
  }

  return { type: "functionCall", name, args };
}

/**
 * A leading reference (`name.path...` or a bare cell ref) — and, if a `:` immediately
 * follows it, the whole thing is a range instead (§5.3). Both endpoints of a range are
 * parsed by the SAME `parseReferenceAddress` a plain reference uses — a range's
 * endpoints are always simple addresses, never general expressions, matching
 * `RangeNode`'s own type (`start`/`end`: `Address`, not `FormulaAst`).
 */
function parseReferenceOrRangeExpr(state: ParserState): FormulaAst | ParseError {
  const startAddress = parseReferenceAddress(state);
  if (isParseError(startAddress)) {
    return startAddress;
  }

  if (peek(state).type === "colon") {
    advance(state);
    const endAddress = parseReferenceAddress(state);
    if (isParseError(endAddress)) {
      return endAddress;
    }
    return { type: "range", start: startAddress, end: endAddress };
  }

  return { type: "reference", address: startAddress };
}

/**
 * Consumes one dotted reference (`name.path.path...`) or, for a single cell-ref-shaped
 * segment inside a table context, a bare cell ref (§5.3) — and resolves it to a stored
 * `Address` (§5.2: names resolve to IDs at PARSE time). A dotted reference is resolved
 * through `address.ts`'s own `parseAddress`, reusing D-005's surface-to-stored path
 * mapping rather than re-deriving it; a bare cell ref is built directly against
 * `state.tableObjectId` (there is no name to look up — the table is already known).
 *
 * Rejects: any unresolvable name (a hard `#PARSE`, immediately — §5.3's own rule, no
 * branch is more or less "live" at parse time), or a bare single word with no table
 * context and no dot (falls through to `parseAddress`'s own "expected name.path"
 * rejection — this is what makes "bare refs in text formulas are a parse error" true).
 */
function parseReferenceAddress(state: ParserState): Address | ParseError {
  const startToken = peek(state);

  const first = consumePathSegment(state);
  if (isParseError(first)) {
    return first;
  }
  const segments: string[] = [first];

  while (peek(state).type === "dot") {
    advance(state);
    const next = consumePathSegment(state);
    if (isParseError(next)) {
      return next;
    }
    segments.push(next);
  }

  if (segments.length === 1) {
    const only = segments[0] as string; // Safe: segments.length === 1, just checked.
    if (state.tableObjectId !== undefined && isCellReferenceForm(only)) {
      // Both halves of the mapping come from address.ts — the FORM check and the stored
      // PATH shape. Hand-building ["cells", only] here would be a second copy of
      // toStoredPath's own mapping, free to drift (0032-REVIEW-phase1).
      return bareCellAddress(state.tableObjectId, only);
    }
  }

  const resolved = parseAddress(segments.join("."), state.objects);
  if (isAddressError(resolved)) {
    return { error: "#PARSE", message: resolved.message, start: startToken.start };
  }
  return resolved;
}

/** One path segment: an ordinary word, or (only reachable after a `.`, per `lexer.ts`'s own disclosed numeric-segment quirk) a purely-numeric segment like `vertex.0.x`'s `0`. */
function consumePathSegment(state: ParserState): string | ParseError {
  const token = peek(state);
  if (token.type === "identifier" || token.type === "number") {
    advance(state);
    return token.text;
  }
  return unexpectedTokenError(token, "a name or path segment");
}

/**
 * §5.3's range-placement rule, enforced as a single post-parse tree walk rather than
 * threaded through every precedence tier — see the file header for why. Returns the
 * first misplaced range found (depth-first, left to right), or `undefined` if every
 * `RangeNode` in the tree is a direct argument of an aggregate `FunctionCallNode`.
 */
function validateRangePlacement(ast: FormulaAst): ParseError | undefined {
  return walkForRangePlacement(ast, false);
}

function walkForRangePlacement(node: FormulaAst, isDirectAggregateArgument: boolean): ParseError | undefined {
  switch (node.type) {
    case "range":
      if (!isDirectAggregateArgument) {
        return {
          error: "#PARSE",
          message:
            "a range (e.g. A1:B4) is only legal as a direct argument to an aggregate function (SUM, MIN, MAX, AVG)",
          start: 0, // No source position survives into the built AST — see ParseError's own doc comment.
        };
      }
      return undefined;
    case "literal":
    case "reference":
    case "error":
      return undefined;
    case "binaryOp":
      return walkForRangePlacement(node.left, false) ?? walkForRangePlacement(node.right, false);
    case "unaryOp":
      return walkForRangePlacement(node.operand, false);
    case "functionCall": {
      const isAggregate = AGGREGATE_FUNCTION_NAMES.has(node.name);
      for (const arg of node.args) {
        const error = walkForRangePlacement(arg, isAggregate);
        if (error !== undefined) {
          return error;
        }
      }
      return undefined;
    }
    default: {
      // Compile-time exhaustiveness (this assignment is a `tsc` error the moment
      // `FormulaAst` grows a variant), WITHOUT a throw: this file's stated invariant is
      // that it never throws, and `document.ts` casts a loaded formula slot's `ast`
      // unchecked, so a hand-edited file is a real path by which a shape the compiler
      // believes impossible could reach this walk (0032-REVIEW-phase1).
      const exhaustive: never = node;
      return {
        error: "#PARSE",
        message: `unrecognised formula AST node: ${JSON.stringify(exhaustive)}`,
        start: 0,
      };
    }
  }
}

/**
 * Parses an already-`lex`ed token stream into a `FormulaAst` (§5.3, parser stage).
 * `tokens` MUST end in an `eof` token, as every `lex` result does — a hand-built
 * fixture that omits one is a caller bug, not something this file defends against.
 * Never throws: every malformed input is a returned `ParseError`.
 */
export function parseFormulaTokens(
  tokens: readonly Token[],
  objects: readonly AddressableObject[],
  tableObjectId?: string,
): FormulaAst | ParseError {
  const state: ParserState = { tokens, pos: 0, objects, tableObjectId };

  if (peek(state).type === "eof") {
    return { error: "#PARSE", message: "empty formula", start: peek(state).start };
  }

  const ast = parseOrExpr(state);
  if (isParseError(ast)) {
    return ast;
  }

  const trailing = peek(state);
  if (trailing.type !== "eof") {
    return {
      error: "#PARSE",
      message: `unexpected trailing input starting at "${trailing.text}"`,
      start: trailing.start,
    };
  }

  const placementError = validateRangePlacement(ast);
  if (placementError !== undefined) {
    return placementError;
  }

  return ast;
}

/**
 * Lexes and parses `source` in one call — the entry point real callers use (a future
 * `link`/`set` command, table cell input, text's `{= }` embedding). See the file
 * header for what this file deliberately leaves to the caller (stripping a leading
 * `=`, deciding whether `source` needs parsing at all).
 */
export function parseFormula(
  source: string,
  objects: readonly AddressableObject[],
  tableObjectId?: string,
): FormulaAst | ParseError {
  const tokens = lex(source);
  if (isLexError(tokens)) {
    return tokens; // Structurally a valid ParseError too; see this file's own ParseError doc comment.
  }
  return parseFormulaTokens(tokens, objects, tableObjectId);
}
