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
 *   Three pure functions over `content`'s parsed shape, plus §5.6's `TextBox`
 *   slot-path constants and the wiring for ALL THREE `text` derived slots that
 *   `primitives/schema.ts` registers — `resolveTextDependencyAddresses` +
 *   `computeResolvedContent`, and `computeMeasuredHeight` /
 *   `computeMeasuredWidth`, the two halves of one measurement (**D-123**) — see
 *   the section further down:
 *   - `parseTextContent(content, objects)` -> a `Block[]`. Never throws, and never
 *     rejects `content` — it is a LITERAL slot (§5.6), so any string is legal document
 *     state; a malformed `{= }`/`{? }` becomes an `error`-kind `Block` INSTEAD OF a
 *     parse failure (see below), discovered only when something reads it.
 *   - `evaluateBlockTree(blocks, read, readRange?)` -> the resolved `string`, ALWAYS
 *     a string: a broken embedded span never blanks the result. A parse-broken
 *     `{= }`/`{? }` renders its own source verbatim behind a `!` mark (**D-116**); a
 *     span that parsed but evaluated to an `ErrorValue` renders `!` + that error's
 *     CODE (**D-117**); the rest of the tree renders normally either way. Conditionals
 *     SHORT-CIRCUIT (§5.6: only the taken branch is evaluated), reusing
 *     `formula/eval.ts`'s `evaluate` for every embedded AST.
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
 *     position silently. Sanctioned and made binding by **D-115**, which also requires
 *     the two fields that make it useful: the offending span's `source` and its `start`
 *     offset into `content` (**D-038** clauses 4 and 2).
 *   - A broken CONDITIONAL collapses to ONE `error` block that holds BOTH already-parsed
 *     branches in its `orphaned` field (**D-115** clause 3, reshaped by **D-116** clause
 *     5). `extractTextDependencies` walks `orphaned`, so extraction stays total for the
 *     very case §5.3's totality rule exists for; `evaluateBlocks` renders the error
 *     block's whole-construct `source` behind a `!` and never looks at `orphaned`. An
 *     inlined branch WOULD render now that an `error` block no longer aborts the tree
 *     (`{? 1 + }yes{:}no{?}` would print `yesno`), which is why 0122 moved the branches
 *     off the sibling list.
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
 *   - `evaluateBlockTree` never evaluates the untaken branch of a conditional. A broken
 *     embedded span is marked in place (`!`, D-116/D-117) rather than aborting the
 *     tree, so text before AND after it still renders — one typo no longer costs the
 *     whole box (the injury D-116 was ruled against).
 *   - A `Point`/`readonly Point[]` value reaching a `{= }` embedding is `#TYPE`, never
 *     stringified — the same "read a scalar component instead" rule §5.1 states for
 *     arithmetic, extended here to text embedding for the same reason (there is no
 *     sensible flat text form for either shape).
 *
 * THE `text` SCHEMA WIRING ALSO LIVES HERE (entries 0127, 0129), plugged into
 * `primitives/schema.ts`'s `TEXT_SCHEMA` the same split `primitives/geometry.ts`
 * uses (pure logic here, registry wiring there):
 *   - `TEXT_*_PATH` constants — §5.6's `TextBox` slot paths, owned here because
 *     this file reads several of them and one spelling must serve both.
 *   - `resolveTextDependencyAddresses(object, objects)` — the `dynamic` dependency
 *     resolver for the `resolvedContent` derived slot. Re-parses `content` (never
 *     cached — **D-114** clause 4) and returns `content` itself plus every address the
 *     block tree references, ranges expanded per cell via the SAME
 *     `primitives/table.ts` enumeration a cell formula's range uses. Runs at
 *     EDGE-DERIVATION time only (Rule 6).
 *   - `computeResolvedContent(object, read, context, deps)` — the `resolvedContent`
 *     compute. Re-parses `content` and hands the block tree to `evaluateBlockTree`
 *     with the `read`/`readRange` `graph/eval.ts`'s `evaluateDerivedSlot` built to a
 *     formula slot's contract (**D-114**: D-110 coercion, a real range reader,
 *     clause 3's ordering). No evaluation logic of its own (Rule 4).
 *   - `computeMeasuredHeight` / `computeMeasuredWidth` — the `measuredHeight`
 *     (§5.6) and `measuredWidth` (**D-123**) computes. Both are pass-throughs
 *     over ONE shared helper, `measureTextBox`: it reads
 *     `resolvedContent`/`width`/`style.*`, hands them to
 *     `context.measurer.measure`, and each compute picks its own component off
 *     the result. Returns `#MEASURE` when only the null measurer is wired
 *     (**D-118**), `#TYPE` for an unusable style or a non-finite box, and
 *     propagates any upstream `ErrorValue`. Line-breaking is the measurer's job,
 *     not this file's (**D-120**).
 *
 * NOT DONE HERE
 *   - Markdown-lite parsing/rendering, layout, wrapping — `render/`, later. Deliberately
 *     not this file's concern even now: `**bold**`/`# heading`/etc. have no dependency
 *     and no reactive value, so they need no AST — they stay literal text inside a
 *     `text`-kind `Block` for `render/`'s eventual layout pass to interpret (Rule 1:
 *     glyph styling is not engine logic).
 *   - A `formula`/`derived`-kind `content` slot's OWN references. `content` is read
 *     `literal`-only for parsing (the same Rule 6 timing `readTableDimension` faces for
 *     `rows`/`cols`): a formula slot's string value is written at evaluation (step 7),
 *     after this file's edge derivation (step 3) has already run, so a `link`ed
 *     `content`'s embedded `{= }`/`{? }` references cannot be tracked. **D-122**
 *     (answering Q-023) closes that gap the way D-046 closed the dimension one — the
 *     `text` command refuses `link text_1.content …` and `set text_1.content = …`
 *     outright (`command/commands.ts`'s `buildSlot`), so `content` is permanently
 *     `literal`-kind and no untracked-reference state is reachable. A plain
 *     `set text_1.content "…"` (a literal write) is how `content` is authored and is
 *     unaffected.
 *   - The `{= }`/`{? }` command-line or panel authoring surface — `content` is always
 *     written as a plain string (§5.10's `text` command's own literal argument), the
 *     same way a table cell's formula source is typed, and needs no new mechanism here.
 */
import type { Address, AddressableObject } from "../address.ts";
import { hasRealMeasurer, type EvalContext, type TextStyle } from "../eval-context.ts";
import type { FormulaAst } from "../formula/ast.ts";
import { extractDependencies, type Dependency } from "../formula/deps.ts";
import { evaluate as evaluateFormulaAst, type ReadRange, type ReadSlot } from "../formula/eval.ts";
import { isParseError, parseFormula } from "../formula/parser.ts";
import { getSlot, hasIllegalNumber, isErrorValue, resolveSlot, type ErrorValue, type GraphObject, type Value } from "../graph/node.ts";
import type { DerivedSlotComputeDeps } from "./schema.ts";
import { enumerateRangeCellAddresses, isInExtentTableCellAddress, isRangeEnumerationError } from "./table.ts";

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
 * file's own addition, not §5.6's literal union; sanctioned by **D-115**).
 * `evaluateBlockTree` renders this block as `!` + `source` (the whole broken span,
 * verbatim, delimiters included) and keeps going — one broken span never blanks the
 * text object (**D-116** clauses 1-2). `orphaned` is walked for dependencies only,
 * never rendered.
 *
 * `source` and `start` are REQUIRED, not decoration (**D-038** clauses 2 and 4, applied
 * at this boundary by **D-115**, widened by **D-116**): `source` is the whole broken
 * span exactly as written, delimiters included, and `start` is its offset INTO
 * `content` — content-space, so a caller can render or underline the span in the
 * operator's own text without re-scanning. D-038 clause 2 says a rejection carries "the
 * offending name and its position... retrofitting positions is the expensive kind of
 * change," and clause 4 says the rejecting layer never discards the source. Both are
 * what let D-116 and D-117 render a broken span (`!{= 1 + }`) instead of blanking
 * the object: a consumer needs exactly these two fields and cannot recover them from
 * `message`.
 */
export interface BlockParseErrorBlock {
  readonly type: "error";
  readonly message: string;
  /**
   * The broken span EXACTLY as the operator wrote it, **delimiters included** —
   * `{= 1 + }`, not ` 1 + ` (**D-116**). It is the whole construct: for a conditional
   * that means `{? c }` through its matching `{?}`, branches and all. This is what
   * D-116 requires be rendered back, so it must round-trip:
   * `content.slice(start, start + source.length) === source`, pinned by test.
   */
  readonly source: string;
  /** Offset of `source`'s first character — the opening `{` — within `content` (D-038 clause 2). */
  readonly start: number;
  /**
   * Blocks that parsed successfully INSIDE this broken construct (a broken
   * conditional's two branches). They are walked by `extractTextDependencies` and
   * NEVER by `evaluateBlocks` — D-115 clause 3 keeps them so extraction stays total,
   * and D-116 is why they cannot sit inline as siblings: an `error` block no longer
   * aborts the tree, so an inlined branch WOULD render, and a broken
   * `{? c }yes{:}no{?}` would print "yesno". Held here instead, they contribute
   * every address the content names and contribute nothing to the text. `[]` for a
   * broken `{= }`, which has no inner blocks.
   */
  readonly orphaned: readonly Block[];
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
        // The span starts at the `{` itself, not at the expression inside it (D-116):
        // what gets rendered back on a failure is what the operator typed, delimiters
        // and all. Captured BEFORE `state.pos` moves.
        const spanStart = state.pos;
        state.pos = marker.end;
        const parsed = parseFormula(marker.source, state.objects);
        blocks.push(
          isParseError(parsed)
            ? {
                type: "error",
                message: parsed.message,
                source: state.content.slice(spanStart, marker.end),
                start: spanStart,
                orphaned: [],
              }
            : { type: "formula", ast: parsed },
        );
        textStart = state.pos;
        break;
      }
      case "conditionalOpen": {
        const spanStart = state.pos; // Same span-starts-at-the-`{` rule as above.
        state.pos = marker.end;
        for (const block of parseConditional(state, marker.source, spanStart)) {
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
function parseConditional(state: TextParseState, conditionSource: string, spanStart: number): readonly Block[] {
  if (state.depth >= MAX_BLOCK_TREE_DEPTH) {
    return [
      {
        type: "error",
        message: `text conditional nests too deeply (limit ${MAX_BLOCK_TREE_DEPTH})`,
        // Only the opening marker was consumed at this point — this arm deliberately
        // does not scan for the matching `{?}` (see this function's doc comment), so
        // the opening marker IS the whole span it can honestly claim.
        source: state.content.slice(spanStart, state.pos),
        start: spanStart,
        orphaned: [],
      },
    ];
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
  // `state.pos` now sits just past this conditional's own closing `{?}` (or at the end
  // of `content` if it never had one), so the whole construct — markers, branches and
  // all — is exactly `content.slice(spanStart, state.pos)`. That is what D-116 renders
  // back, and computing it HERE is what stops a consumer having to re-derive where a
  // conditional ended (two computations that could disagree).
  const span = state.content.slice(spanStart, state.pos);
  return finishConditional(conditionSource, span, spanStart, state.objects, trueResult.blocks, falseBranch, unclosed);
}

/**
 * Turns a parsed conditional's pieces into the `Block[]` `parseConditional` returns —
 * either a real `ConditionalBlock`, or (a broken condition, OR no matching `{?}` was
 * ever found) ONE `error` block carrying BOTH already-parsed branches in its `orphaned`
 * field, whole-construct `span` and all.
 *
 * **Both branches, held in `orphaned` (D-115 clause 3, reshaped by D-116 clause 5).**
 * Keeping only the true branch made `extractTextDependencies` silently NON-TOTAL for
 * exactly the case §5.3's totality rule exists for: a reference living only in the false
 * branch was reported by nobody (measured at 0121-REVIEW: `{? 1 + }x{:}{= poly_1.radius
 * }{?}` extracted `[]`). 0121-REVIEW first fixed this by leaving both branches inline as
 * siblings; **D-116** then ruled that an `error` block no longer aborts the tree, which
 * would make those inline branches RENDER (`yesno`). `orphaned` keeps the dependency
 * totality without that hazard — `extractTextDependencies` walks it, `evaluateBlocks`
 * renders only the error block's own `source` (`!` + the whole span) and never looks at
 * `orphaned`.
 */
function finishConditional(
  conditionSource: string,
  span: string,
  spanStart: number,
  objects: readonly AddressableObject[],
  trueBranch: readonly Block[],
  falseBranch: readonly Block[],
  unclosed: boolean,
): readonly Block[] {
  const orphaned = [...trueBranch, ...falseBranch];
  const condition = parseFormula(conditionSource, objects);
  if (isParseError(condition)) {
    return [{ type: "error", message: condition.message, source: span, start: spanStart, orphaned }];
  }
  if (unclosed) {
    return [
      {
        type: "error",
        message: "unclosed {? ... } conditional (no matching {?})",
        source: span,
        start: spanStart,
        orphaned,
      },
    ];
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
        break;
      case "error":
        // The block itself has no AST (D-028's "absence of a dependency, made
        // explicit"), but a broken CONSTRUCT still holds blocks that parsed fine, and
        // every address they name is an address the content names — D-115 clause 3's
        // totality, now carried inside the error block rather than inline beside it
        // (D-116; see `BlockParseErrorBlock.orphaned`).
        for (const dependency of extractTextDependencies(block.orphaned)) {
          dependencies.push(dependency);
        }
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
 * The one character a broken embedded span is marked with, in place, so the rest of
 * the text object still renders around it (**D-116**, the human's own choice of
 * signifier). It is the shared half of two DIFFERENT mechanisms:
 *   - **D-116** — a span that never PARSED renders `MARK` + its own source verbatim,
 *     delimiters included (`{= 1 + }` -> `!{= 1 + }`). There is no computed value; the
 *     source IS the diagnostic.
 *   - **D-117** — a span that parsed but evaluated to an `ErrorValue` renders `MARK` +
 *     the error's CODE (`{= 1 / 0 }` -> `!#DIV0`), not its source and not its message.
 *     There IS a value; the operator already sees their own source, so the code tells
 *     them more.
 * The `!` IS the signifier: §5.9's error badge is deliberately NOT lit for either case
 * (D-116 clause 3, D-117 clause 4), and the mark is emitted HERE, into the resolved
 * string, never by `render/` — `measuredHeight` is measured FROM that string (D-116
 * clause 4).
 */
const BROKEN_SPAN_MARK = "!";

/**
 * D-117: `MARK` + an `ErrorValue`'s CODE — the in-place rendering for a `{= }`/`{? }`
 * that parsed fine but evaluated to an error (a division by zero, a reference reading
 * an error slot, a `Point` with no flat text form, a non-boolean condition). NOT
 * D-116's mechanism: that renders the operator's own source back because there is no
 * value to show; this shows the code because there IS one and it is simply broken.
 */
function renderRuntimeError(value: ErrorValue): string {
  return `${BROKEN_SPAN_MARK}${value.error}`;
}

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
 * The recursive worker behind `evaluateBlockTree`. Returns a plain `string`, ALWAYS:
 * since D-116/D-117 every broken span is marked in place (`BROKEN_SPAN_MARK`) rather
 * than aborting the tree, so there is no `ErrorValue` channel to thread and a
 * recursive branch call's result concatenates with no check.
 */
function evaluateBlocks(blocks: readonly Block[], read: ReadSlot, readRange: ReadRange | undefined): string {
  let result = "";
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        result += block.value;
        break;
      case "error":
        // D-116: a parse-broken span renders its own source back, verbatim and
        // delimiters included, behind a `!`. The operator sees exactly what they
        // typed and where; the rest of the object still renders. `orphaned` (a
        // broken conditional's parsed branches) is walked by
        // `extractTextDependencies` only — never rendered (D-115 clause 3 / D-116
        // clause 5).
        result += `${BROKEN_SPAN_MARK}${block.source}`;
        break;
      case "formula": {
        const value = evaluateFormulaAst(block.ast, read, readRange);
        if (isErrorValue(value)) {
          result += renderRuntimeError(value); // D-117: `!` + the code, in place
          break;
        }
        const embedded = formatValueForEmbedding(value);
        // A `Point`/`Point[]` with no flat text form is the same D-117 case — it
        // parsed and evaluated fine, it just cannot be embedded.
        result += isErrorValue(embedded) ? renderRuntimeError(embedded) : embedded;
        break;
      }
      case "conditional": {
        const condition = evaluateFormulaAst(block.condition, read, readRange);
        if (isErrorValue(condition)) {
          result += renderRuntimeError(condition); // D-117 clause 6: a broken condition, marked in place
          break;
        }
        if (typeof condition !== "boolean") {
          // D-117 clause 6 names a non-boolean condition alongside an ErrorValue
          // one — same treatment, the `#TYPE` code alone. Neither branch is taken.
          result += renderRuntimeError({
            error: "#TYPE",
            message: `text conditional's condition must evaluate to a boolean, got ${describeConditionType(condition)}`,
          });
          break;
        }
        // §5.6: "Evaluation of the tree short-circuits normally" — only the taken
        // branch is ever passed to evaluateBlocks; the other is never touched. A
        // broken span INSIDE the taken branch is marked there, recursively (D-117
        // clause 6: "no new case exists there").
        result += evaluateBlocks(condition ? block.trueBranch : block.falseBranch, read, readRange);
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
 * Evaluates `blocks` (§5.6) to the resolved text they produce — ALWAYS a `string`.
 * A broken embedded span is marked in place (`!` + its own source for a parse
 * failure, D-116; `!` + the error code for a runtime error, D-117) rather than
 * aborting the tree, so text before AND after a broken span still renders and
 * `resolvedContent` never holds an `ErrorValue` (D-116 clause 3, D-117 clause 4).
 * `read`/`readRange` are handed through unchanged to every embedded AST's
 * `formula/eval.ts` evaluation — this file has no evaluation logic of its own beyond
 * walking the block tree and formatting a result (Rule 4: one evaluator), matching
 * `graph/eval.ts`'s own "builds the callbacks, hands them through" posture.
 *
 * The `read`/`readRange` this function is PASSED must be built to the same contract a
 * formula slot's AST gets: **D-114** requires D-110's empty-in-extent coercion, a real
 * range reader, and clause 3's coercion-before-membership ordering, delivered by
 * widening `graph/eval.ts`'s `evaluateDerivedSlot` — never adapted here. "No adapter"
 * was Decision 4 of entry 0120 and is corrected by D-114. This file takes whatever
 * closures it is handed and has no opinion on where they come from.
 */
export function evaluateBlockTree(blocks: readonly Block[], read: ReadSlot, readRange?: ReadRange): string {
  return evaluateBlocks(blocks, read, readRange);
}

// ---------------------------------------------------------------------------
// The `text` schema entry's wiring halves — the "pure logic here, registry
// there" split `primitives/geometry.ts` uses. This file owns §5.6's `TextBox`
// slot-path vocabulary AND the three derived-slot computes (`resolvedContent`,
// `measuredHeight`, `measuredWidth`); `primitives/schema.ts`'s `TEXT_SCHEMA`
// imports the paths and wires the computes. See the file header.
// ---------------------------------------------------------------------------

/**
 * The nine `text`-specific stored slot paths (§5.6's `TextBox` shape), all
 * `static` — a `text` object's slot set never changes (Rule 6). Owned here (not
 * in `primitives/schema.ts`) because this file reads several of them (`content`
 * for parsing; `resolvedContent`/`width`/`style.*` in `computeMeasuredHeight`)
 * and one spelling must serve both; `TEXT_SCHEMA` imports the list.
 *
 * The other two non-derived paths — `origin.x`/`origin.y` (**D-121**) — are NOT
 * here: they reuse `primitives/geometry.ts`'s `ORIGIN_X_PATH`/`ORIGIN_Y_PATH`,
 * the shared spelling every positioned object uses, and `TEXT_SCHEMA` adds them
 * directly. Nothing in this file reads a `text` object's position.
 *
 * `style.color`/`style.align` are declared (so a formula may drive them — §5.6,
 * D-017) but neither compute here reads them: they change how text is PAINTED,
 * not how much room it takes (`eval-context.ts`'s `TextStyle` omits them for the
 * same reason).
 */
export const TEXT_CONTENT_PATH: readonly string[] = ["content"];
export const TEXT_WIDTH_PATH: readonly string[] = ["width"];
export const TEXT_HEIGHT_PATH: readonly string[] = ["height"];
export const TEXT_OVERFLOW_PATH: readonly string[] = ["overflow"];
export const TEXT_STYLE_FONT_PATH: readonly string[] = ["style", "font"];
export const TEXT_STYLE_FONT_SIZE_PATH: readonly string[] = ["style", "fontSize"];
export const TEXT_STYLE_LINE_HEIGHT_PATH: readonly string[] = ["style", "lineHeight"];
export const TEXT_STYLE_COLOR_PATH: readonly string[] = ["style", "color"];
export const TEXT_STYLE_ALIGN_PATH: readonly string[] = ["style", "align"];

/**
 * The three `derived` slot paths. `resolvedContent` and `measuredHeight` are
 * §5.6's own two; `measuredWidth` is **D-123**'s deliberate extension of that
 * list, so §5.9's "bounding box for text" and D-066's one-extent rule can both
 * hold for an auto-width `text` object (`render/extent.ts` has no `ctx` and
 * cannot measure glyphs itself).
 */
export const TEXT_RESOLVED_CONTENT_PATH: readonly string[] = ["resolvedContent"];
export const TEXT_MEASURED_HEIGHT_PATH: readonly string[] = ["measuredHeight"];
export const TEXT_MEASURED_WIDTH_PATH: readonly string[] = ["measuredWidth"];

/**
 * The `dynamic` dependency resolver for a `text` object's `resolvedContent`
 * derived slot (§5.1: "text_1.resolvedContent depends on whatever slots its parsed
 * block tree happens to reference, which changes whenever content is edited").
 * Called by `mutation.ts`'s `deriveEdges` at EDGE-DERIVATION time only, never
 * during evaluation (Rule 6 / `primitives/schema.ts`'s header).
 *
 * Returns, as a flat `Address[]` — one edge each — :
 *   - `content` itself. §5.6: "resolvedContent (from content plus every referenced
 *     slot)". Unconditional, so a `formula`-driven `content` slot still forces a
 *     re-resolve and so `computeResolvedContent` may `read` it under D-013.
 *   - every address the block tree references, EAGERLY and TOTALLY
 *     (`extractTextDependencies` walks both branches of every conditional AND a
 *     broken conditional's `orphaned` branches — §5.3, D-115 clause 3). A
 *     `RangeDependency` is expanded here, per cell, via the SAME
 *     `enumerateRangeCellAddresses` a cell formula's range uses in `deriveEdges`
 *     and `graph/eval.ts` (**D-114** clause 1): an in-extent cell with no slot
 *     contributes no edge (D-047 clause 1); an unresolvable table falls back to
 *     the range's start address so the dangling-reference check still names it.
 *   - NOT a bare reference to an EMPTY in-extent table cell (**D-110** clause 4):
 *     no edge, exactly as `deriveEdges`'s own bare-reference handling; the
 *     coercion to `0` happens at read time (`graph/eval.ts`), not here.
 *
 * `content` is read `literal`-only — the same Rule 6 timing `primitives/table.ts`'s
 * `readTableDimension` faces for `rows`/`cols`: a `formula` slot's value is written
 * at evaluation time, AFTER this runs. Both the non-literal and the missing case
 * yield `[content]` alone, but their outcomes DIFFER: a MISSING `content` slot makes
 * that self-edge dangling, so `validateIntegrity` REFUSES the object — a `text` with
 * no `content` is malformed (§5.6). A `formula`/`derived` `content` slot cannot be
 * reached through the `text` command at all — **D-122** refuses `link` / `set =` on
 * it (`command/commands.ts`), closing the old F13 untracked-reference gap the way
 * D-046 closed the dimension one. A loaded document could still carry one; its inner
 * references go untracked, exactly as a loaded `formula` `rows` slot's do under
 * D-046. See the file header's NOT DONE HERE.
 *
 * Never throws. This mirrors `deriveEdges` Source 1's own reference/range handling
 * rather than sharing it — `primitives/text.ts` cannot import `mutation.ts` (it
 * would close mutation -> schema -> text -> mutation). The two are a sanctioned
 * hand-maintained PAIR with no compiler link between them: **D-119** binds any
 * change to bare-reference / range / D-110 / D-047 edge derivation to touch both,
 * and forces extraction to a shared module the moment a third consumer appears.
 */
export function resolveTextDependencyAddresses(
  object: GraphObject,
  objects: readonly GraphObject[],
): readonly Address[] {
  const addresses: Address[] = [{ objectId: object.id, path: TEXT_CONTENT_PATH }];
  const contentSlot = getSlot(object, TEXT_CONTENT_PATH);
  if (contentSlot === undefined || contentSlot.kind !== "literal" || typeof contentSlot.value !== "string") {
    return addresses;
  }
  const blocks = parseTextContent(contentSlot.value, objects);
  for (const dependency of extractTextDependencies(blocks)) {
    if (dependency.kind === "reference") {
      // D-110 clause 4: an empty cell within an existing table's current extent
      // gets NO edge — the bare-reference mirror of D-047 clause 1, exactly as
      // `deriveEdges` treats the same address for a cell formula.
      if (resolveSlot(dependency.address, objects) === undefined && isInExtentTableCellAddress(dependency.address, objects)) {
        continue;
      }
      addresses.push(dependency.address);
      continue;
    }
    // range: one address per in-extent cell that HAS a slot (D-047 clause 1).
    const tableObject = objects.find((candidate) => candidate.id === dependency.start.objectId);
    if (tableObject === undefined) {
      addresses.push(dependency.start);
      continue;
    }
    const cellAddresses = enumerateRangeCellAddresses(dependency.start, dependency.end, tableObject);
    if (isRangeEnumerationError(cellAddresses)) {
      addresses.push(dependency.start);
      continue;
    }
    for (const cellAddress of cellAddresses) {
      if (getSlot(tableObject, cellAddress.path) === undefined) {
        continue;
      }
      addresses.push(cellAddress);
    }
  }
  return addresses;
}

/**
 * The `resolvedContent` derived-slot compute (§5.6: "resolvedContent (from
 * content plus every referenced slot)"). Re-parses `content` into a block tree
 * and evaluates it — the tree is NEVER cached (**D-114** clause 4: `content` is
 * the single source of truth, and a cached tree is a second one that can
 * disagree).
 *
 * `read`/`readRange` come from `graph/eval.ts`'s `evaluateDerivedSlot`, built to
 * the SAME contract a formula slot's AST gets (**D-114**: D-110's empty-in-extent
 * coercion, a real range reader on `enumerateRangeCellAddresses`, and clause 3's
 * coercion-before-membership ordering). This function hands them straight to
 * `evaluateBlockTree` and adds no evaluation logic of its own (Rule 4).
 * `deps.objects` is the document's object identity table, needed to RE-PARSE for
 * name -> id resolution (never stored — D-114 clause 4).
 *
 * ALWAYS returns a `string`, unless `content` ITSELF is an `ErrorValue` (a
 * `formula`-driven `content` slot that evaluated to one — §5.1: errors
 * propagate). A broken embedded span is marked in place by `evaluateBlockTree`
 * (`!`, D-116 / D-117), never propagated (D-116 clause 3 / D-117 clause 4).
 * Never throws.
 */
export function computeResolvedContent(
  object: GraphObject,
  read: ReadSlot,
  _context: EvalContext | undefined,
  deps: DerivedSlotComputeDeps | undefined,
): Value {
  const rawContent = read({ objectId: object.id, path: TEXT_CONTENT_PATH });
  if (rawContent !== undefined && isErrorValue(rawContent)) {
    return rawContent;
  }
  const content = typeof rawContent === "string" ? rawContent : "";
  const blocks = parseTextContent(content, deps?.objects ?? []);
  return evaluateBlockTree(blocks, read, deps?.readRange);
}

/** One usable measurement, or the `ErrorValue` the asking compute must return instead — `measureTextBox`'s two outcomes, kept apart so neither compute has to guess which it got. */
type TextBoxMeasurement =
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly error: ErrorValue };

/**
 * The ONE measurement behind BOTH `measuredHeight` (§5.6) and `measuredWidth`
 * (**D-123**): read the declared slots, hand them to `context.measurer.measure`,
 * and give the caller either the whole box or the `ErrorValue` to report in its
 * place. No layout logic of its own — line-breaking lives in the measurer
 * implementation (**D-120**, answering Q-021; `render/measure.ts`).
 *
 * Shared rather than written twice because **D-123** clause 2 requires the pair's
 * failure order to be identical and forbids one succeeding while the other fails
 * — "they answer one question and are computed from one measurement." One helper
 * makes that true by construction rather than by two lists staying in step.
 * `slotLabel` names the derived slot the operator was reading, so a message
 * points at what they asked for; nothing else differs between the two.
 *
 * Declared `static` dependencies (`primitives/schema.ts`, the SAME list for both
 * slots): `resolvedContent`, `width`, and
 * `style.font`/`style.fontSize`/`style.lineHeight` — the fields a size
 * computation actually depends on (`eval-context.ts`'s `TextStyle`).
 * `style.color`/`style.align` and the `height` slot are NOT read: color/align
 * do not affect size, and `height` is the operator's fixed-height/overflow
 * choice, a different thing from "how tall would this be if it grew to fit."
 *
 * Order of failure, all `ErrorValue`s, never a throw:
 *   1. An upstream `ErrorValue` in `resolvedContent`/`width`/any style field
 *      propagates unchanged (§5.1: "errors propagate" — these slots may be
 *      `formula`-driven, §5.6).
 *   2. No real measurer (`hasRealMeasurer` — only `NULL_EVAL_CONTEXT`'s zero-box
 *      stand-in, or `context === undefined` in an isolated unit test) → `#MEASURE`
 *      (**D-118**): a size measured against a zero-box measurer is a size not
 *      earned, worse than an honest error. This fires BEFORE the shape check
 *      below, because with no measurer the shape does not matter — nothing can be
 *      measured either way.
 *   3. A wrong-shaped style (`font` not a string, `fontSize`/`lineHeight` not
 *      numbers — including a missing slot, `undefined`) → `#TYPE`. This is a
 *      fail-closed: `command/commands.ts`'s `createText` supplies sensible style
 *      defaults, so a bare hand-built or loaded `text` object measures as `#TYPE`
 *      rather than the compute inventing a font.
 *   4. A non-finite width OR height back from `measure` → `#TYPE`, for BOTH slots.
 *      `eval-context.ts`'s contract promises finite/non-negative, but an injected
 *      measurer is exactly the component D-118 rules we cannot trust blindly, and
 *      `mutation.ts`'s D-025 slot-value check runs BEFORE `evaluate` and never
 *      re-inspects a derived result — the same gap `add`'s compute guards its sum
 *      against. Both components are checked even though a caller wants only one,
 *      because D-123 clause 2 forbids reporting half of a broken box as a good
 *      answer while the other half errors.
 *
 * **D-120** (answering Q-021): a numeric `width` slot becomes `measure`'s
 * `maxWidth` (the wrap boundary); `"auto"` — or any non-number — means
 * `undefined`, i.e. no wrapping (§5.6 layout). The measurer wraps, not this
 * function; `render/measure.ts` is the real one.
 */
function measureTextBox(
  object: GraphObject,
  read: ReadSlot,
  context: EvalContext | undefined,
  slotLabel: string,
): TextBoxMeasurement {
  const resolved = read({ objectId: object.id, path: TEXT_RESOLVED_CONTENT_PATH });
  const width = read({ objectId: object.id, path: TEXT_WIDTH_PATH });
  const font = read({ objectId: object.id, path: TEXT_STYLE_FONT_PATH });
  const fontSize = read({ objectId: object.id, path: TEXT_STYLE_FONT_SIZE_PATH });
  const lineHeight = read({ objectId: object.id, path: TEXT_STYLE_LINE_HEIGHT_PATH });

  // 1. §5.1: errors propagate. Deterministic order (resolvedContent, width, then
  //    the three style fields) so a doubly-broken object reports the same code
  //    regardless of evaluation timing — the same discipline `add`'s compute uses.
  for (const upstream of [resolved, width, font, fontSize, lineHeight]) {
    if (upstream !== undefined && isErrorValue(upstream)) {
      return { ok: false, error: upstream };
    }
  }

  // 2. D-118: no real measurer -> #MEASURE, never a size off the zero-box one.
  if (!hasRealMeasurer(context)) {
    return {
      ok: false,
      error: {
        error: "#MEASURE",
        message: `${slotLabel}: ${object.name} has no real text measurer wired (only the null EvalContext) — cannot measure`,
      },
    };
  }

  // 3. Fail closed on a style the measurer cannot use. A missing slot reads
  //    `undefined` here and lands in this branch too (D-047's absent spelling is
  //    legal state; a measurement off it is not).
  if (typeof font !== "string" || typeof fontSize !== "number" || typeof lineHeight !== "number") {
    return {
      ok: false,
      error: {
        error: "#TYPE",
        message: `${slotLabel}: ${object.name} needs style.font (string) and style.fontSize / style.lineHeight (numbers)`,
      },
    };
  }
  const style: TextStyle = { font, fontSize, lineHeight };

  const text = typeof resolved === "string" ? resolved : "";
  // D-120: the `width` slot is the wrap boundary when numeric; the measurer
  // (`render/measure.ts`) does the line-breaking, this function does not.
  const maxWidth = typeof width === "number" ? width : undefined;

  // `measure` never throws (eval-context.ts's contract). It also PROMISES a
  // finite, non-negative box — but 4. below does not take that on trust: an
  // injected measurer is the component D-118 exists because we cannot trust
  // blindly, and a non-finite value cached into `measuredHeight`/`measuredWidth`
  // here would commit uncaught (mutation.ts's D-025 check runs before
  // `evaluate`), then propagate through any `= text_1.measuredHeight` binding.
  // `add`'s compute guards its arithmetic result the same way and for the same
  // reason. BOTH components are checked whichever slot asked (D-123 clause 2).
  const measured = context.measurer.measure(text, style, maxWidth);
  if (hasIllegalNumber(measured.width) || hasIllegalNumber(measured.height)) {
    return {
      ok: false,
      error: {
        error: "#TYPE",
        message:
          `${slotLabel}: ${object.name}'s text measurer returned a non-finite box ` +
          `(width ${measured.width}, height ${measured.height})`,
      },
    };
  }
  return { ok: true, width: measured.width, height: measured.height };
}

/**
 * The `measuredHeight` derived-slot compute (§5.6: "measuredHeight (from
 * `resolvedContent`, `width`, and `style`, computed via the injected
 * `TextMeasurer`)") — the `.height` half of `measureTextBox`'s one measurement.
 * That function documents the read set, the failure order, and why the pair
 * shares one measurement (**D-123** clause 2).
 */
export function computeMeasuredHeight(
  object: GraphObject,
  read: ReadSlot,
  context: EvalContext | undefined,
  _deps: DerivedSlotComputeDeps | undefined,
): Value {
  const measurement = measureTextBox(object, read, context, "measuredHeight");
  return measurement.ok ? measurement.height : measurement.error;
}

/**
 * The `measuredWidth` derived-slot compute (**D-123**) — the `.width` half of the
 * SAME measurement `computeMeasuredHeight` takes its height from.
 *
 * Why the slot exists: `render/extent.ts` is pure and has no `ctx`, so for a
 * `text` object whose `width` slot is `"auto"` — which is every object the `text`
 * command creates, `DEFAULT_TEXT_WIDTH` being `"auto"` — it cannot otherwise know
 * how wide the ink is, and §5.9's "bounding box for text" and D-066's
 * one-extent rule cannot both hold. One wrong box is four wrong behaviours (hit
 * test, selection highlight, chrome anchor, `fit`), which is why D-123 rules this
 * a deliberate extension of §5.6's two-derived-slot list, on the same footing as
 * D-121's extension of `TextBox`'s shape.
 *
 * The value is the widest laid-out LINE (`render/measure.ts`) — the ink's own
 * width, never the `width` slot's wrap boundary read back. `extent.ts` prefers a
 * numeric `width` slot when the operator set one and falls back to this
 * otherwise (D-123 clause 3).
 */
export function computeMeasuredWidth(
  object: GraphObject,
  read: ReadSlot,
  context: EvalContext | undefined,
  _deps: DerivedSlotComputeDeps | undefined,
): Value {
  const measurement = measureTextBox(object, read, context, "measuredWidth");
  return measurement.ok ? measurement.width : measurement.error;
}
