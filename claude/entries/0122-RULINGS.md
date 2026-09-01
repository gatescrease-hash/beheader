# 0122 — RULINGS: the human answers Q-019. D-116, and the shape change it forces
Date: 2026-09-01   Phase: 5   Model: reviewer (recording the human's decision)
Previous entry: 0121-REVIEW-phase5   Last review: 0121-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)

## What the human ruled

**Q-019 → D-116**, a hybrid of the question's options (b) and (c), in their own words:

> "Let's try and do a hybrid of B and C. If a broken span is written, it should render literally, but
> with some signifyier in the text itself to add an indication that it's broken beyond just writing
> out the literal. Could we do something where a broken span renders literally but just has an
> exclamation mark added at the beginning: `{= 1 + }` renders as `!{= 1 + }`"

So: a parse-broken span renders itself, verbatim, prefixed with `!`; the rest of the text object
renders normally; the `!` is the signifier and no error badge is added for this case. Full ruling,
including the two consequences recording it surfaced, is **D-116**.

## What recording it surfaced — two things the question did not anticipate

Both are consequences of the ruling rather than amendments to it, and both are now clauses of D-116.

**1. The mark must be emitted by the ENGINE, not by `render/` (D-116 clause 4).** §5.6 makes
`measuredHeight` a derived slot computed FROM `resolvedContent`. If `render/` prepended the `!` at
draw time, `measuredHeight` would be measured from a string one character shorter than the one
actually drawn — two views of one value, drifting by construction. Adding a character to a string is
content resolution, not glyph styling, so Rule 1 is untouched by putting it in the engine.

**2. D-116 collides with D-115 clause 3, and clause 3's shape had to move (D-116 clause 5).** This is
the one worth reading twice. 0121-REVIEW kept a broken conditional's two branches INLINE, as
siblings after the `error` block, and justified it as safe with this sentence: *"rendering is
unaffected either way, because the `error` block short-circuits `evaluateBlocks` before either
branch is reached."* D-116 deletes that premise — an `error` block stops short-circuiting. Under the
new ruling those inlined branches would RENDER, and `{? 1 + }yes{:}no{?}` would print `yesno`.

So the branches moved INSIDE the error block, as `orphaned`: walked by
`extractTextDependencies`, never by `evaluateBlocks`. D-115 clause 3's totality is preserved
exactly — the same addresses are reported — while the rendering hazard the ruling would have
introduced never exists.

**The lesson, recorded because it is the second time in two entries the same shape has bitten:**
0121-REVIEW's finding F13 was that entry 0120 justified a recovery choice against a consumer that
did not exist yet (rendering) and missed the one that did (extraction). One entry later, the
reviewer's own fix was justified by "rendering is unaffected" — a claim true only under a behaviour
the human then changed. **A safety argument that rests on what another component currently does is
only as durable as that component's current behaviour; prefer one that rests on structure.**
`orphaned` is that structural version: it is not rendered because nothing renders it, not because
something else happens to return first.

## What I changed in the tree

Data shape only — **D-116 clauses 1-4 are NOT built** (see "Not built" below).

**`src/engine/primitives/text.ts`:**
- `BlockParseErrorBlock.source` is now the **whole broken span exactly as written, delimiters
  included** (`{= 1 + }`, not ` 1 + `), and for a conditional it runs from `{?` through its matching
  `{?}`, branches and all. `start` points at the opening `{`. The round trip
  `content.slice(start, start + source.length) === source` is the contract and is pinned. The
  previous shape (inner text only, no delimiters) was written by 0121-REVIEW one commit earlier and
  could not express D-116 clause 1 at all — the span cannot be rendered back without the delimiters
  it excluded.
- `BlockParseErrorBlock.orphaned: readonly Block[]` added, per clause 5 above.
- `extractTextDependencies` recurses into `orphaned`; `evaluateBlocks` does not look at it.
- Computing the construct's span in `parseConditional` (where `state.pos` already sits just past the
  closing `{?}`) rather than leaving a consumer to re-derive where a conditional ended — two
  computations of one fact is the drift this project rules against repeatedly.

**`src/engine/primitives/text.test.ts`:** five expectations updated to the new shape. These are
changed test expectations (§6.1 trigger 5) and they are **authorised in advance by D-116's own
reconciliation note**, so they are not an escalation — the same standing D-110 gave the tests it
flipped. Nothing was weakened: the two behaviour claims (a broken conditional's dependencies stay
total; the error block carries a round-tripping span and offset) are asserted more strictly than
before, and the totality test did not need touching at all, which is the evidence that the shape
change preserved the dependency set rather than papering over a loss.

## Not built — owed by the Phase 5 wiring cycle

**D-116 clauses 1-4.** `evaluateBlockTree` still returns `#PARSE` for a tree containing an `error`
block; nothing prepends `!`; `resolvedContent` does not exist yet to hold either result. The wiring
cycle owes all of it, with tests, and owes it alongside **Q-020**.

## Open questions

**Q-020 — RAISED, the human's, blocking the wiring cycle's display half.** D-116 covers a
PARSE-broken span. It deliberately does not cover a span that parses fine and evaluates to an
`ErrorValue` (`{= 1 / 0 }` → `#DIV0`), which is a different thing: §5.1 calls an `ErrorValue`
legitimate state that PROPAGATES. Today both cases blank the box; after D-116 is built they would
diverge unless Q-020 is answered. Options and a recommendation ((b): render the error code in place,
marked) are in `OPEN_QUESTIONS.md`. **Do not extend D-116 to runtime errors by analogy** — that is
exactly the "read the ruling at its worked examples rather than its sentence" failure D-113 was
written about, run in reverse.

Q-017, Q-016, Q-012, Q-008 unchanged. Next free: **Q-021**.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  28 passed (28)
      Tests  1329 passed (1329)
```

0 skipped, 0 `.only`. Mutation-checked: removing `extractTextDependencies`'s recursion into
`orphaned` turns exactly one test red — "a reference living ONLY in the false branch of a BROKEN
conditional is still reported" — confirming `orphaned` is genuinely load-bearing for totality and
not just a place the branches were parked. The compiler found all five stale fixtures on its own
(D-006 earning its keep for the second consecutive entry).

Diff, measured with `git diff --numstat` after the last edit rather than estimated during it (the
correction 0121-REVIEW §6 already had to make once, caught the same way): **+96 / −42 across 2
source files** — `text.ts` +62/−23, `text.test.ts` +34/−19.
