/**
 * parser.ts — Token stream -> FormulaAst (PROJECT_BRIEF §5.3, stage 2 of 4).
 *
 * IMPLEMENTS: §5.3's full v1 grammar — literals, references (dotted `name.path` AND
 * bare cell refs), the entire operator precedence chain, function calls, and ranges
 * restricted to an aggregate function's direct argument. Also **D-029** (`AND`/`OR`/
 * `NOT` as BOTH infix/prefix operators and callable functions, both meaning the same
 * thing), **D-038** (an unrecognised function name, or a known one with the wrong
 * argument count, is a `#PARSE`-time rejection), and **D-045** (a range whose two
 * endpoints name different objects is rejected here too). Inherits **D-039**'s
 * either-case cell-reference form unchanged, via `address.ts`'s `isCellReferenceForm`
 * — reused, never duplicated.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   Two entry points, neither of which ever throws:
 *   - `parseFormulaTokens(tokens, objects, tableObjectId?)` — the real parser, over an
 *     already-`lex`ed `Token[]`. This file never scans characters (stage separation).
 *   - `parseFormula(source, objects, tableObjectId?)` — the convenience wrapper real
 *     callers use: `lex`, then parse. A `LexError` is returned as-is, being
 *     structurally identical to this file's own `ParseError` (both `#PARSE`-shaped).
 *
 *   `objects` is `address.ts`'s `AddressableObject[]`. §5.2: "A resolver maps name ->
 *   ID at parse time; stored ASTs hold IDs, not names" — so THIS is where that happens
 *   for formulas. An unresolvable name is a hard `#PARSE` immediately, regardless of
 *   which branch of an `IF` it sits in (§5.3 says so explicitly, because names resolve
 *   at parse time, not evaluation time).
 *
 *   `tableObjectId` supplies "the table this formula lives in", for §5.3's bare cell
 *   refs. Omitted in every other context, which makes "bare refs in text formulas are
 *   a parse error" fall out for free: with no table context a bare cell-shaped word
 *   has nowhere to resolve and falls through to the ordinary `name.path` rejection.
 *   This file TRUSTS a caller-supplied `tableObjectId` names a real table rather than
 *   re-verifying it — the same layered-validation posture `address.ts` documents, and
 *   D-017's precedent: parse-time correctness is necessary, not sufficient, and
 *   `mutation.ts` re-checks independently regardless.
 *
 *   The precedence chain (§5.3, loosest to tightest), each its own tier function, all
 *   but the two tightest built from ONE shared left-associative helper rather than
 *   five near-identical loops:
 *   `OR -> AND -> comparison -> + - -> * / % -> ^ -> unary - / NOT -> primary`.
 *   `^` is LEFT-associative. The brief is silent; this project's stated model for the
 *   formula language is Excel (§1), whose `^` is itself left-associative (`2^3^2` =
 *   64, not 512) — the one reading consistent with the brief's own chosen precedent,
 *   and reversible either way, since §5.11 stores the AST and never re-parseable
 *   source text, so a change would affect only newly-typed formulas.
 *
 *   RANGE PLACEMENT IS A SEPARATE PASS. `A1:B4` parses wherever it is syntactically
 *   reachable, and §5.3's "only as an argument to an aggregate function" restriction
 *   is enforced by `validateRangePlacement`, one walk over the finished AST run just
 *   before returning success. Simpler than threading an "am I a direct aggregate
 *   argument" flag through every tier, with one disclosed consequence: parentheses add
 *   no node to this AST (§5.3's grammar has no `ParenNode`), so `SUM((A1:B4))` is
 *   post-parse indistinguishable from `SUM(A1:B4)` and is ACCEPTED identically. Judged
 *   the right reading — nothing in §5.3 suggests a redundant paren should defeat it.
 *
 *   `AND`/`OR`/`NOT` work in both forms because `lexer.ts` gives them their own
 *   keyword token types, and this file checks at every point a name could start either
 *   whether the next token is `(`: if so it is a call, using the keyword token's own
 *   text as the function name; if not, the operator form. `IF` needs none of this — it
 *   was never a keyword token, so `IF(...)` takes the same "identifier followed by `(`"
 *   path as `SUM`.
 *
 *   Which names may take a range argument (`SUM`/`MIN`/`MAX`/`AVG`) is imported as
 *   `functions.ts`'s `RANGE_ACCEPTING_FUNCTION_NAMES`, never kept as a second local
 *   copy — the same "declare vocabulary once" principle as D-009/D-014.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. Every malformed input is a returned `ParseError`, matching
 *     `lexer.ts`'s discipline and §5.1's "errors must never throw across the
 *     evaluation loop."
 *   - Every `ReferenceNode` produced here holds a RESOLVED `Address` — an ID, not a
 *     name (§5.2) — via `address.ts`'s `parseAddress`, or (bare cell refs only) built
 *     against the caller-supplied `tableObjectId`. No path is ever hand-built from
 *     string concatenation outside those two call sites.
 *   - Every `RangeNode`'s `start`/`end` are themselves resolved `Address`es, through
 *     the same path bare references take — never an arbitrary expression.
 *
 * NOT DONE HERE
 *   - Deciding WHEN this runs relative to typing. D-038 requires validation "when a
 *     formula is committed, never per keystroke" — a caller-level policy, not
 *     something this file can enforce; it validates whatever it is called with.
 *     Keeping a rejected formula's source alive for editing is likewise the caller's
 *     job: this returns a `ParseError` and never mutates or discards its input.
 *   - Text's `{= }` / `{? }{:}{?}` embedding (§5.6) — a block-tree concern, Phase 5,
 *     layered ON TOP of this file.
 *   - The leading `=` marking a cell's raw text as a formula. Inside an expression `=`
 *     is the EQUALITY operator; deciding "does this text go through `parseFormula` at
 *     all" is caller-level policy that strips any leading `=` first.
 *   - A disclosed limitation inherited from `lexer.ts`: two directly-adjacent
 *     purely-numeric path segments merge into one decimal NUMBER token (`a.1.5.b`
 *     lexes as three segments, not four). This never arises for any address the schema
 *     produces (`vertex.N.x` is the only numeric-segment shape in the brief, always a
 *     single index), and fixing it would require the lexer to carry grammar context it
 *     is deliberately free of.
 */
import { type Address, type AddressableObject, bareCellAddress, isAddressError, isCellReferenceForm, parseAddress } from "../address.ts";
import type { BinaryOperator, FormulaAst } from "./ast.ts";
import { checkArity, getFunctionEntry, RANGE_ACCEPTING_FUNCTION_NAMES } from "./functions.ts";
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

/**
 * `NAME(arg, arg, ...)` (§5.3), zero or more comma-separated arguments, each a full
 * expression (`parseOrExpr`, the top of the precedence chain) — so `SUM(A1:B4)`'s
 * single argument can itself be a range (see the file header on range placement)
 * while `IF(a > b, 1, 2)`'s three arguments are ordinary expressions.
 *
 * Once the full argument list is known, validates the call against `functions.ts`'s
 * registry (D-038): an unrecognised name, or a known name called with the wrong
 * argument count, is a `#PARSE` rejection naming the function and pointing at
 * `nameToken.start` — the same position a caller would highlight if it read the
 * offending name back out of the source. Arity is checked ONLY after a name is known
 * to exist, matching `checkArity`'s own contract (it has nothing to check an unknown
 * name's arity against).
 */
function parseFunctionCallExpr(state: ParserState, name: string): FormulaAst | ParseError {
  const nameToken = peek(state);
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

  const entry = getFunctionEntry(name);
  if (entry === undefined) {
    return { error: "#PARSE", message: `unknown function "${name}"`, start: nameToken.start };
  }
  const arityCheck = checkArity(entry.name, entry.arity, args.length);
  if (!arityCheck.ok) {
    return { error: "#PARSE", message: arityCheck.message, start: nameToken.start };
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
      // D-045: which objects two endpoints name is decidable from the formula
      // text alone, with no value read — the same D-038 line the placement
      // check just above already applies. `primitives/table.ts`'s
      // `enumerateRangeCellAddresses` keeps its own matching check as the
      // defensive arm for a hand-built or loaded AST; this is the reachable
      // rejection for anything actually typed.
      if (node.start.objectId !== node.end.objectId) {
        return {
          error: "#PARSE",
          message: "a range's two endpoints must be cells in the same table",
          start: 0, // Same reason as above — no source position survives into a RangeNode.
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
      const isAggregate = RANGE_ACCEPTING_FUNCTION_NAMES.has(node.name);
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
