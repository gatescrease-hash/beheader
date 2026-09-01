# 0120 — text's block-tree engine: parse, evaluate, extract dependencies
Date: 2026-09-01   Phase: 5   Model: Claude Sonnet 5
Previous entry: 0119-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)   Last review: 0119-REVIEW-phase5
Batch: cycle 1 since last review; 886 lines / 2 files changed so far (both new).

## Declared scope

The text primitive's **block-tree engine only**: `src/engine/primitives/text.ts` parses §5.6's
`{= expr }` / `{? cond } ... {:} ... {?}` embedded-formula syntax out of a raw `content` string into
a `Block[]`, evaluates that tree to its resolved text (short-circuiting, §5.6), and extracts every
dependency it could read (eagerly and totally, including untaken branches — the Phase 5 acceptance
criterion's own words). Fully headless, fully unit-tested against hand-built `read`/`readRange`
callbacks, the same isolation `formula/eval.test.ts` already uses.

## Explicitly not in scope

No `text` object type, no schema entry, no `resolvedContent`/`measuredHeight` derived slots, no
`TextMeasurer`/`EvalContext` threading into `graph/eval.ts`, no `text` command, no markdown-lite
parsing or rendering, no layout. This is deliberately the Phase-1-shaped first slice (formula engine
before cell-slot wiring) applied to Phase 5: the block-tree engine before graph wiring. It is also
the first file of a new subsystem (§6.1 trigger 2) regardless of size, so this cycle stops here for
review rather than continuing into the schema/`graph/eval.ts` half in the same batch.

## What I did

**`src/engine/primitives/text.ts`** (implements §5.6's block tree, its embedded-formula grammar, and
its dependency-walker requirement; Rule 4 — reuses `formula/parser.ts`/`formula/eval.ts`/
`formula/deps.ts` unchanged, no second evaluator):

- `Block` — §5.6's three-variant union (`text`/`formula`/`conditional`) **widened by a fourth,
  `error`**, holding a message. This is my own addition, the same move D-028 made for `FormulaAst`
  (`ErrorNode`) and for the identical reason: `content` is a **literal** slot (§5.6), so it is never
  rejected at commit time the way a cell formula is at parse time — any string is legal, including a
  broken `{= 1 + }` or an unclosed `{? }`. The parser must turn that into *something* rather than
  throw or silently drop the position, and an AST-shaped error node has no home outside a formula
  AST, so a block-shaped one is the smaller, more honest mechanism.
- `parseTextContent(content, objects)` — an iterative (never recursive-over-suffix) scan. The
  formula/condition source extent is found by a QUOTE-AWARE brace scanner (`findUnquotedBrace`,
  honouring the one escape `\"` `formula/lexer.ts` itself honours) so `{= CONCAT("a}b", 1) }`'s
  embedded `}` doesn't end the block early. `{?` is disambiguated between OPEN (`{? cond }`) and
  CLOSE (`{?}`) by its third character alone, checked before any brace-scan runs.
  - A broken embedded expression, or a `{? }` whose condition fails to parse, or one never closed by
    a matching `{?}`, becomes one `error` block. For a broken **conditional** specifically, the
    already-parsed true branch is kept inline right after the error block (the false branch is
    dropped — there is no principled way to pick one without a working condition). Implementation
    decision, reversible, no ruling needed (PROCESS_BRIEF §7 point 2).
  - A stray top-level `{:}`/`{?}` with no enclosing `{? }` is kept as literal text (three marker
    characters), matching markdown-lite's own forgiving spirit, rather than treated as a hard failure.
  - Nesting is bounded (`MAX_BLOCK_TREE_DEPTH = 64`, D-079's fixed-constant posture) — refuses with
    one error block rather than recursing further, never a `RangeError`.
  - Every reference resolves to an ID at parse time via `formula/parser.ts`'s `parseFormula` called
    with **no `tableObjectId`** — this is the entire mechanism behind "bare refs in text formulas are
    a parse error" (§5.3); no special case was needed here.
- `extractTextDependencies(blocks)` — walks eagerly and totally, exactly mirroring
  `formula/deps.ts`'s own header reasoning for `IF`: recurses into **both** `trueBranch` and
  `falseBranch` of every conditional, unconditionally. An `error` block contributes nothing (D-028's
  "absence of a dependency, made explicit," applied here).
- `evaluateBlockTree(blocks, read, readRange?)` — evaluates left to right, stopping at the first
  `ErrorValue` (matching `formula/eval.ts`'s own stopping convention), and evaluates **only** the
  taken branch of a conditional (§5.6: "Evaluation of the tree short-circuits normally"). An `error`
  block propagates as `#PARSE` for the whole tree — the same "any formula reading an error slot
  yields an error" posture (§5.1) applied to a text-authoring-time failure instead of a graph-time
  one. A `Point`/`readonly Point[]` value reaching an embedding is `#TYPE`, never stringified (§5.1's
  "read a scalar component instead," extended to text). A boolean embeds as `TRUE`/`FALSE` (the
  formula language's own literal spelling, §5.3), not JavaScript's lowercase.

**`src/engine/primitives/text.test.ts`** — 35 tests: plain text, `{= }` parsing and resolution
(including the bare-cell-ref parse-error case, the quote-aware brace scan, and an unparseable
expression), `{? }{:}{?}` parsing (no-else, with-else, PROJECT_BRIEF §5.6's own nested worked
example verbatim, a broken condition, an unclosed conditional, stray top-level markers, the depth
bound), dependency extraction (including the untaken-branch case, pinned directly against §5.6's own
acceptance-criterion wording), and evaluation (embedding every scalar type, `null`, error
propagation and its left-to-right stop point, `#TYPE` on a Point, and both short-circuit directions
of the nested worked example).

## Decisions I made

1. **`Block` gains a fourth `error` variant, not in §5.6's literal text.** See "What I did" above.
   Reversible, and PROCESS_BRIEF §7 point 2 applies (no ambiguity that shapes the data model or
   addressing — it is purely how one file represents "this span didn't parse").
2. **A broken conditional keeps its true branch, drops its false branch.** Arbitrary between the two,
   but a choice had to be made to keep parsing recoverable; documented in the file header and pinned
   by a test so a later cycle doesn't "fix" it into something else by accident.
3. **Markdown-lite is not parsed here at all**, not even as inert passthrough nodes — `**bold**` etc.
   stay literal characters inside a `text`-kind `Block` for `render/` to interpret later. It has no
   dependency and no reactive value, so giving it any AST here would be work with no consumer (Rule
   5).
4. **`evaluateBlockTree`'s return type is the full `Value` union**, not `string | ErrorValue`, purely
   so a future `resolvedContent` schema entry (`DerivedSlotCompute`) can pass this function through
   directly with no adapter. The recursive worker underneath (`evaluateBlocks`) is typed precisely,
   so no cast was needed to make the wider public signature type-check.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  28 passed (28)
      Tests  1322 passed (1322)
```

`grep -rnE "\.(only|skip|todo)\("` over `src/` → nothing. `grep -nE "document\.|window\.|canvas|
CanvasRenderingContext2D|from \"\.\./render"` over the new file → only the file header's own prose
naming what it must never import. Rule 1 and Rule 2 both structurally hold: the file touches no
document state and has no rendering import; it is pure functions over a string and callbacks.

**Mutation-checked**, both load-bearing claims:
- Forcing `evaluateBlockTree`'s conditional to always take the true branch: 2 tests went red
  (`toBe("ok")` on the false-branch case, and the nested-example FAIL-leaf case) — the short-circuit
  claim is real, not vacuously true.
- Removing `extractTextDependencies`'s recursion into `falseBranch`: 1 test went red (the untaken-
  branch dependency, pinned directly against §5.6's own acceptance-criterion wording) — the
  eager/total claim is real.

Both mutations reverted; suite re-confirmed green (1322/1322) after restoring.

## Acceptance criteria status

Phase 5's full criterion is NOT yet demonstrated — that needs a `text` object, `resolvedContent`, and
the injected `TextMeasurer`, none of which exist yet (see "Explicitly not in scope"). This cycle
demonstrates, headlessly, the two halves of that criterion that do not need an object: **evaluation
resolves only the taken branch and updates its number** (the nested worked-example tests), and **a
value referenced only inside the currently non-taken branch is still a reported dependency** (the
untaken-branch dependency test, mutation-checked above) — the exact clause 0119-REVIEW's STATUS.md
forward note flagged as "worth a test in that cycle."

## Where I got stuck / what is unfinished

Nothing got stuck; the scope was intentionally cut before the harder half. What is unfinished and
flagged for the next cycle (or for review): whether `resolvedContent`'s dynamic dependency resolution
and its derived-slot `read` closure need **D-110**'s empty-in-extent-cell treatment (0119-REVIEW's
STATUS.md forward note says yes — "an embedded `{= table_x.A1 }` over an empty in-extent cell reads
`0` and emits no edge"). This file's two graph-facing functions (`evaluateBlockTree`,
`extractTextDependencies`) take whatever `read`/`readRange`/dependency list they are handed and have
no opinion on where those come from — nothing here forecloses either answer, but `graph/eval.ts`'s
generic `evaluateDerivedSlot` `read` closure (built for D-013's declared-dependency enforcement) does
**not** currently apply D-110's coercion, only `evaluateFormula`'s own `read` does (D-110 clauses 1-3
live specifically in that closure, per 0119-REVIEW §3's "two different files, two different
questions" gotcha). Wiring `resolvedContent` correctly will need either a third place D-110 is
checked, or a reasoned argument that the existing two already cover it structurally — this is
genuinely a `mutation.ts`/`graph/eval.ts` design question (both load-bearing, §6.2) and belongs in
front of the reviewer before it's built, not guessed at here.

## Open questions raised

None new. No `PROVISIONAL(Q-NNN)` tag was needed — every choice above is disclosed as an
implementation decision (PROCESS_BRIEF §7 point 2), not a guess against brief ambiguity.

## Review point

Fired: **§6.1 trigger 2 — first file of a new subsystem** (`src/engine/primitives/text.ts`, no prior
reviewed code in `primitives/text.*`). This fires regardless of size or of the §6.3 batch cap; stopping
here rather than continuing into schema/graph wiring in the same batch.
