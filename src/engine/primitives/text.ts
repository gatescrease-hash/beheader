/**
 * text.ts — The text primitive's block-tree engine: parse, evaluate, extract deps.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.6's block tree ("Parse `content` into a block tree"),
 * its embedded formula syntax (`{= expr }`, `{? cond } ... {:} ... {?}`, nestable),
 * and its dependency-walker requirement ("recurses the block tree and calls
 * `formula/deps.ts` on every embedded AST — including untaken branches"). Rule 4 (one
 * formula engine, reused): every embedded expression parses and evaluates through
 * `formula/parser.ts` / `formula/eval.ts` unchanged, never a second evaluator.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   Three pure functions over `content`'s parsed shape, nothing about a `text` OBJECT
 *   or its schema yet (see NOT DONE HERE):
 *   - `parseTextContent(content, objects)` -> a `Block[]`. Never throws, and never
 *     rejects `content` — it is a LITERAL slot (§5.6), so any string is legal document
 *     state; a malformed `{= }`/`{? }` becomes an `error`-kind `Block` INSTEAD OF a
 *     parse failure (see below), discovered only when something reads it.
 *   - `evaluateBlockTree(blocks, read, readRange?)` -> the resolved `string`, or the
 *     first `ErrorValue` encountered — evaluation SHORT-CIRCUITS (§5.6: only the taken
 *     branch of a conditional is evaluated), reusing `formula/eval.ts`'s `evaluate`
 *     for every embedded AST.
 *   - `extractTextDependencies(blocks)` -> every `Dependency` the tree could read,
 *     EAGERLY and TOTALLY — both branches of every conditional, unconditionally,
 *     mirroring §5.3's `extractDependencies` for `IF` (D-029) at the block-tree level.
 *
 * INVARIANTS UPHELD HERE
 *   - `Block` widens PROJECT_BRIEF §5.6's three-variant union with a FOURTH, `error` —
 *     the same move D-028 made for `FormulaAst` (`ErrorNode`, "its own AST node, never
 *     a widened `LiteralNode`"), for the identical reason: `content` can hold a
 *     syntactically broken `{= }`/`{? }` (an unparseable expression, or a `{? }` never
 *     closed by a matching `{?}`), and this file must never throw or drop that
 *     position silently. A broken span becomes ONE `error` block naming why, and — for
 *     a broken CONDITIONAL — its already-parsed TRUE branch is kept inline rather than
 *     discarded, so the rest of the content survives; the false branch is dropped
 *     (there is no principled way to pick one without a working condition). This is an
 *     implementation decision, not a brief requirement (PROCESS_BRIEF §7 point 2:
 *     reversible, no ruling needed).
 *   - The marker scanner is QUOTE-AWARE over the identical one escape
 *     `formula/lexer.ts` honours (`\"` only) — `{= CONCAT("a}b", 1) }`'s embedded `}`
 *     inside the string must not end the block early (`findUnquotedBrace`). Two
 *     markers share one byte pattern up to their second character (`{?` opens a
 *     conditional OR, with no source between `?` and `}`, closes one — `{?}`); the
 *     third character alone disambiguates them, checked before any brace-scan runs
 *     (`matchMarkerAt`).
 *   - Never throws, over any `string` input, including pathological ones: nesting is
 *     bounded (`MAX_BLOCK_TREE_DEPTH`, the same fixed-constant posture D-079 already
 *     established for `formula/ast.ts`/`parser.ts`'s own recursions), and the top-level
 *     scan is an ITERATIVE loop, not recursive, so a long run of stray `{?}`/`{:}`
 *     markers (§5.6's own leniency for malformed markup, see below) cannot exhaust the
 *     stack the way a recursive retry over the remaining suffix would.
 *   - A reference inside `content` is resolved to an ID at PARSE time, exactly like a
 *     cell formula (§5.2/§5.3) — `parseTextContent` calls `formula/parser.ts`'s
 *     `parseFormula` with NO `tableObjectId`, which is what makes "bare refs in text
 *     formulas are a parse error" (§5.3) fall out for free, with no special case here.
 *   - `extractTextDependencies` never evaluates anything and has no notion of "taken" —
 *     recursing into BOTH `trueBranch` and `falseBranch` unconditionally is what makes
 *     it total by construction, the same shape `formula/deps.ts`'s own header describes
 *     for `IF`.
 *   - `evaluateBlockTree` never evaluates the untaken branch of a conditional, and
 *     stops at the first `ErrorValue` — left to right, matching `formula/eval.ts`'s own
 *     stopping convention exactly, so a broken cell three paragraphs down does not
 *     silently swallow correct text before it.
 *   - A `Point`/`readonly Point[]` value reaching a `{= }` embedding is `#TYPE`, never
 *     stringified — the same "read a scalar component instead" rule §5.1 states for
 *     arithmetic, extended here to text embedding for the same reason (there is no
 *     sensible flat text form for either shape).
 *
 * NOT DONE HERE
 *   - Any `text` OBJECT type, schema entry, or derived slot (`resolvedContent`,
 *     `measuredHeight`) — a later cycle wires this file's three functions into
 *     `primitives/schema.ts`, which is also where `TextMeasurer`/`EvalContext`
 *     threading into `graph/eval.ts` belongs (Rule 1's injected-measurer trap, §5.1).
 *     That cycle must also decide whether `resolvedContent`'s dynamic dependency
 *     resolution and its `read` closure need **D-110**'s empty-in-extent-cell
 *     treatment — this file's `evaluateBlockTree`/`extractTextDependencies` take
 *     whatever `read`/`readRange`/dependency list they are handed and have no opinion
 *     on where those come from, so nothing here forecloses either answer.
 *   - Markdown-lite parsing/rendering, layout, wrapping — `render/`, later. Deliberately
 *     not this file's concern even now: `**bold**`/`# heading`/etc. have no dependency
 *     and no reactive value, so they need no AST — they stay literal text inside a
 *     `text`-kind `Block` for `render/`'s eventual layout pass to interpret (Rule 1:
 *     glyph styling is not engine logic).
 *   - The `{= }`/`{? }` command-line or panel authoring surface — `content` is always
 *     written as a plain string (§5.10's `text` command's own literal argument), the
 *     same way a table cell's formula source is typed, and needs no new mechanism here.
 */
import type { AddressableObject } from "../address.ts";
import type { FormulaAst } from "../formula/ast.ts";
import { extractDependencies, type Dependency } from "../formula/deps.ts";
import { evaluate as evaluateFormulaAst, type ReadRange, type ReadSlot } from "../formula/eval.ts";
import { isParseError, parseFormula } from "../formula/parser.ts";
import { isErrorValue, type ErrorValue, type Value } from "../graph/node.ts";

// ---------------------------------------------------------------------------
// The block tree (§5.6)
// ---------------------------------------------------------------------------

/** Literal source text, copied through as-is — markdown-lite markup included, uninterpreted (see file header). */
export interface TextBlock {
  readonly type: "text";
  readonly value: string;
}

/** One `{= expr }` — evaluate and insert the result (§5.6). */
export interface FormulaBlock {
  readonly type: "formula";
  readonly ast: FormulaAst;
}

/** One `{? cond } ... {:} ... {?}` — `falseBranch` is `[]` when no `{:}` was written (§5.6: "`{:}` is the optional else"). */
export interface ConditionalBlock {
  readonly type: "conditional";
  readonly condition: FormulaAst;
  readonly trueBranch: readonly Block[];
  readonly falseBranch: readonly Block[];
}

/**
 * A syntactically broken `{= }`/`{? }` span (see file header — this variant is this
 * file's own addition, not §5.6's literal union). `evaluateBlockTree` turns it into a
 * `#PARSE` `ErrorValue` for the whole tree it sits in, the same "one broken thing
 * poisons the derived value" posture an ordinary formula slot already has.
 */
export interface BlockParseErrorBlock {
  readonly type: "error";
  readonly message: string;
}

/** §5.6's block tree, widened by one variant — see the file header. */
export type Block = TextBlock | FormulaBlock | ConditionalBlock | BlockParseErrorBlock;

/**
 * The deepest a `{? }` may nest inside `content` before this file refuses to recurse
 * further — same fixed-constant posture as `ast.ts`'s `MAX_FORMULA_AST_DEPTH` and
 * `parser.ts`'s `MAX_FORMULA_PARSE_DEPTH` (D-079): chosen well below any depth this
 * recursion has been let run to, not derived from one. A human nesting `{? }` by hand
 * realistically reaches single digits (§5.6's own worked example nests two); nothing
 * legitimate is lost here.
 */
export const MAX_BLOCK_TREE_DEPTH = 64;

// ---------------------------------------------------------------------------
// Parsing (`content` -> `Block[]`)
// ---------------------------------------------------------------------------

/** Local, mutable scan state for one `parseTextContent` call — never exported, discarded after use, matching `parser.ts`'s own `ParserState` idiom. */
interface TextParseState {
  readonly content: string;
  readonly objects: readonly AddressableObject[];
  pos: number;
  depth: number;
}

/** What a nested `parseBlockSequence` call stopped at — the same three-way split §5.6's grammar has: an else marker, a close marker, or simply running out of `content`. */
type SequenceTerminator = "else" | "close" | "eof";

/**
 * Finds the first `}` at or after `from` that is NOT inside a double-quoted string,
 * honouring the ONE escape `formula/lexer.ts` does (`\"`) — so a formula or condition
 * source containing a string literal with a `}` inside it (`CONCAT("a}b", 1)`) is not
 * cut short. Returns `undefined` if `content` ends first (an unterminated marker,
 * handled by the caller as "not a marker after all" — see `matchMarkerAt`).
 */
function findUnquotedBrace(content: string, from: number): number | undefined {
  let i = from;
  let inString = false;
  while (i < content.length) {
    const ch = content[i];
    if (inString) {
      if (ch === "\\" && content[i + 1] === '"') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      i += 1;
      continue;
    }
    if (ch === "}") {
      return i;
    }
    i += 1;
  }
  return undefined;
}

/** One recognised marker, and where it ends (the index just past its closing character(s)) — see `matchMarkerAt`. */
type Marker =
  | { readonly kind: "formulaOpen"; readonly source: string; readonly end: number }
  | { readonly kind: "conditionalOpen"; readonly source: string; readonly end: number }
  | { readonly kind: "conditionalElse"; readonly end: number }
  | { readonly kind: "conditionalClose"; readonly end: number };

/**
 * Whether `content[pos]` (already known to be `"{"`) starts one of §5.6's four markers.
 * `undefined` means it does not — an unterminated `{=`/`{?` (no unquoted `}` before
 * `content` ends) or any other `{` falls through to "literal character", never a
 * rejection (see file header — this file never fails to make progress).
 *
 * `{?` is checked for the bare CLOSE form (`{?}`, third character `}`, no source
 * between) before the OPEN form is even attempted — the one place two markers share a
 * prefix, so the disambiguation is a single character check, not a backtrack.
 */
function matchMarkerAt(content: string, pos: number): Marker | undefined {
  const second = content[pos + 1];
  if (second === "=") {
    const close = findUnquotedBrace(content, pos + 2);
    if (close === undefined) {
      return undefined;
    }
    return { kind: "formulaOpen", source: content.slice(pos + 2, close), end: close + 1 };
  }
  if (second === "?") {
    if (content[pos + 2] === "}") {
      return { kind: "conditionalClose", end: pos + 3 };
    }
    const close = findUnquotedBrace(content, pos + 2);
    if (close === undefined) {
      return undefined;
    }
    return { kind: "conditionalOpen", source: content.slice(pos + 2, close), end: close + 1 };
  }
  if (second === ":" && content[pos + 2] === "}") {
    return { kind: "conditionalElse", end: pos + 3 };
  }
  return undefined;
}

/**
 * Parses one run of blocks starting at `state.pos`, stopping at whichever comes
 * first: a bare `{:}`, a bare `{?}`, or `content` running out — reporting which via
 * `terminator` so the caller (top level, or `parseConditional` below) knows whether it
 * found a matching marker at all. Consumes the terminating marker's characters when
 * one is found; leaves `state.pos` at `content.length` for `"eof"`.
 */
function parseBlockSequence(state: TextParseState): { readonly blocks: readonly Block[]; readonly terminator: SequenceTerminator } {
  const blocks: Block[] = [];
  let textStart = state.pos;

  const flushText = (end: number): void => {
    if (end > textStart) {
      blocks.push({ type: "text", value: state.content.slice(textStart, end) });
    }
  };

  while (state.pos < state.content.length) {
    if (state.content[state.pos] !== "{") {
      state.pos += 1;
      continue;
    }
    const marker = matchMarkerAt(state.content, state.pos);
    if (marker === undefined) {
      state.pos += 1; // Literal '{' — see matchMarkerAt's own doc comment.
      continue;
    }
    flushText(state.pos);
    switch (marker.kind) {
      case "conditionalElse":
        state.pos = marker.end;
        return { blocks, terminator: "else" };
      case "conditionalClose":
        state.pos = marker.end;
        return { blocks, terminator: "close" };
      case "formulaOpen": {
        state.pos = marker.end;
        const parsed = parseFormula(marker.source, state.objects);
        blocks.push(isParseError(parsed) ? { type: "error", message: parsed.message } : { type: "formula", ast: parsed });
        textStart = state.pos;
        break;
      }
      case "conditionalOpen": {
        state.pos = marker.end;
        for (const block of parseConditional(state, marker.source)) {
          blocks.push(block);
        }
        textStart = state.pos;
        break;
      }
    }
  }
  flushText(state.pos);
  return { blocks, terminator: "eof" };
}

/**
 * Parses one `{? cond } trueBranch [{:} falseBranch] {?}`, `state.pos` already just
 * past the opening marker. Recurses via `parseBlockSequence` for each branch — the
 * SAME function the top level uses, so a nested `{? }` inside either branch is not a
 * special case.
 *
 * Depth-bounded (`MAX_BLOCK_TREE_DEPTH`): past the limit this returns ONE error block
 * and does NOT recurse — the exact "check before recursing" shape `ast.ts`'s
 * `exceedsMaxFormulaAstDepth` and `parser.ts`'s `withNestingStep` already use, so the
 * call stack never grows past the bound even for adversarial input. It deliberately
 * does not attempt to locate this conditional's own matching `{?}` in that case — an
 * inner `{:}`/`{?}` may then be consumed by an ENCLOSING conditional instead, which is
 * accepted: nothing legitimate nests 64 `{? }` levels, and "never throws" outranks
 * "recovers perfectly placed" at a depth no operator reaches.
 */
function parseConditional(state: TextParseState, conditionSource: string): readonly Block[] {
  if (state.depth >= MAX_BLOCK_TREE_DEPTH) {
    return [{ type: "error", message: `text conditional nests too deeply (limit ${MAX_BLOCK_TREE_DEPTH})` }];
  }
  state.depth += 1;
  const trueResult = parseBlockSequence(state);
  let falseBranch: readonly Block[] = [];
  let unclosed = trueResult.terminator === "eof";
  if (trueResult.terminator === "else") {
    const falseResult = parseBlockSequence(state);
    falseBranch = falseResult.blocks;
    unclosed = falseResult.terminator === "eof";
  }
  state.depth -= 1;
  return finishConditional(conditionSource, state.objects, trueResult.blocks, falseBranch, unclosed);
}

/**
 * Turns a parsed conditional's pieces into the `Block[]` `parseConditional` returns —
 * either a real `ConditionalBlock`, or (a broken condition, OR no matching `{?}` was
 * ever found) one `error` block with the already-parsed `trueBranch` kept inline. See
 * the file header for why the false branch is dropped in the broken case rather than
 * guessed at.
 */
function finishConditional(
  conditionSource: string,
  objects: readonly AddressableObject[],
  trueBranch: readonly Block[],
  falseBranch: readonly Block[],
  unclosed: boolean,
): readonly Block[] {
  const condition = parseFormula(conditionSource, objects);
  if (isParseError(condition)) {
    return [{ type: "error", message: condition.message }, ...trueBranch];
  }
  if (unclosed) {
    return [{ type: "error", message: "unclosed {? ... } conditional (no matching {?})" }, ...trueBranch];
  }
  return [{ type: "conditional", condition, trueBranch, falseBranch }];
}

/**
 * Parses `content` into a `Block[]` (§5.6). Never throws and never rejects `content` —
 * see the file header. A stray top-level `{:}` or `{?}`, with no enclosing `{? }`, is
 * lenient the same way markdown-lite itself is: the three marker characters are kept
 * as literal text and scanning continues, rather than treating the whole rest of
 * `content` as broken. This loop is ITERATIVE — not a recursive retry over the
 * remaining suffix — so a `content` consisting of many stray markers back-to-back
 * cannot exhaust the stack (see INVARIANTS UPHELD HERE).
 */
export function parseTextContent(content: string, objects: readonly AddressableObject[]): readonly Block[] {
  const blocks: Block[] = [];
  const state: TextParseState = { content, objects, pos: 0, depth: 0 };
  while (true) {
    const { blocks: sequenceBlocks, terminator } = parseBlockSequence(state);
    for (const block of sequenceBlocks) {
      blocks.push(block);
    }
    if (terminator === "eof") {
      return blocks;
    }
    blocks.push({ type: "text", value: terminator === "else" ? "{:}" : "{?}" });
  }
}

// ---------------------------------------------------------------------------
// Dependency extraction (§5.3's eager/total rule, applied to the block tree)
// ---------------------------------------------------------------------------

/**
 * Walks `blocks` eagerly and totally, exactly like `formula/deps.ts`'s own
 * `extractDependencies` — see that file's header for why this matters: which
 * conditional branch is "live" changes on every edit, so the graph must subscribe to
 * both. Recurses into BOTH `trueBranch` and `falseBranch` of every `ConditionalBlock`
 * unconditionally; a `BlockParseErrorBlock` contributes nothing, the same "absence of
 * a dependency, made explicit" `formula/deps.ts` gives `ErrorNode` (D-028). Never
 * throws; order is not significant (fresh walk every call, Rule 5).
 */
export function extractTextDependencies(blocks: readonly Block[]): readonly Dependency[] {
  const dependencies: Dependency[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
      case "error":
        break;
      case "formula":
        for (const dependency of extractDependencies(block.ast)) {
          dependencies.push(dependency);
        }
        break;
      case "conditional":
        for (const dependency of extractDependencies(block.condition)) {
          dependencies.push(dependency);
        }
        for (const dependency of extractTextDependencies(block.trueBranch)) {
          dependencies.push(dependency);
        }
        for (const dependency of extractTextDependencies(block.falseBranch)) {
          dependencies.push(dependency);
        }
        
        break;
      default: {
        const exhaustive: never = block;
        void exhaustive;
        break;
      }
    }
  }
  return dependencies;
}

// ---------------------------------------------------------------------------
// Evaluation (§5.6: "Evaluation of the tree short-circuits normally")
// ---------------------------------------------------------------------------

/**
 * Renders `value` into the flat text a `{= }` embeds — the same "read a scalar
 * component instead" rule §5.1 states for arithmetic, extended here (see file
 * header). `null` (an explicit null literal, or — once wired into a document, D-110 —
 * an empty in-extent table cell coerced upstream, before this function ever runs)
 * embeds as an empty string: a broken reference is already an `ErrorValue` by the
 * time it would reach here, so a bare `null` reaching this function is a legitimate
 * "nothing to show", not a missing value. A boolean spells out `TRUE`/`FALSE` to match
 * the formula language's OWN literal spelling (§5.3), not JavaScript's lowercase.
 */
function formatValueForEmbedding(value: Value): string | ErrorValue {
  if (isErrorValue(value)) {
    return value;
  }
  if (value === null) {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return {
    error: "#TYPE",
    message: `cannot embed ${Array.isArray(value) ? "a point array" : "a point"} in text; read a scalar component instead`,
  };
}

/** Small, local value-type describer for this file's own conditional-condition error message — the same narrow, non-exported duplicate `formula/eval.ts` keeps privately for an identical purpose (not a `Value` predicate; D-014 governs those, not user-facing text formatting). */
function describeConditionType(value: Value): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "a point array";
  }
  if (typeof value === "object") {
    return "a point";
  }
  return typeof value;
}

/**
 * The recursive worker behind `evaluateBlockTree`, typed precisely as `string |
 * ErrorValue` (never the wider `Value`) so the CONDITIONAL branch below can
 * concatenate a recursive call's result with no cast — see `evaluateBlockTree`'s own
 * doc comment for why the exported function widens the return type instead.
 */
function evaluateBlocks(blocks: readonly Block[], read: ReadSlot, readRange: ReadRange | undefined): string | ErrorValue {
  let result = "";
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        result += block.value;
        break;
      case "error":
        // §5.6 gives no separate "broken text" value shape; propagating exactly like
        // an ordinary formula slot reading broken input is the smaller mechanism
        // (§5.1: "any formula reading an error slot yields an error").
        return { error: "#PARSE", message: block.message };
      case "formula": {
        const value = evaluateFormulaAst(block.ast, read, readRange);
        if (isErrorValue(value)) {
          return value;
        }
        const embedded = formatValueForEmbedding(value);
        if (isErrorValue(embedded)) {
          return embedded;
        }
        result += embedded;
        break;
      }
      case "conditional": {
        const condition = evaluateFormulaAst(block.condition, read, readRange);
        if (isErrorValue(condition)) {
          return condition;
        }
        if (typeof condition !== "boolean") {
          return {
            error: "#TYPE",
            message: `text conditional's condition must evaluate to a boolean, got ${describeConditionType(condition)}`,
          };
        }
        // §5.6: "Evaluation of the tree short-circuits normally" — only the taken
        // branch is ever passed to evaluateBlocks; the other is never touched.
        const branch = evaluateBlocks(condition ? block.trueBranch : block.falseBranch, read, readRange);
        if (isErrorValue(branch)) {
          return branch;
        }
        result += branch;
        break;
      }
      default: {
        const exhaustive: never = block;
        void exhaustive;
        break;
      }
    }
  }
  return result;
}

/**
 * Evaluates `blocks` (§5.6) to the resolved text they produce, or the first
 * `ErrorValue` encountered, stopping there — left to right, matching
 * `formula/eval.ts`'s own eager-argument stopping convention, so one broken embedded
 * formula does not silently discard correct text that came before it in the same
 * evaluation. `read`/`readRange` are handed through unchanged to every embedded AST's
 * `formula/eval.ts` evaluation — this file has no evaluation logic of its own beyond
 * walking the block tree and formatting a result (Rule 4: one evaluator), matching
 * `graph/eval.ts`'s own "builds the callbacks, hands them through" posture.
 *
 * Return type is the wider `Value` (not `string | ErrorValue`) to match
 * `primitives/schema.ts`'s `DerivedSlotCompute` contract directly — the future
 * `resolvedContent` schema entry can pass this function's result straight through
 * with no adapter.
 */
export function evaluateBlockTree(blocks: readonly Block[], read: ReadSlot, readRange?: ReadRange): Value {
  return evaluateBlocks(blocks, read, readRange);
}
