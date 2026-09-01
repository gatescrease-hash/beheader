# 0123 — RULINGS: the human answers Q-020. D-117
Date: 2026-09-01   Phase: 5   Model: reviewer (recording the human's decision)
Previous entry: 0122-RULINGS   Last review: 0121-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)

## What the human ruled

**Q-020 → D-117**, option (b), in full: "Rule Q-020 with option b."

Option (b) was: render the error CODE in place, marked, rather than propagating the whole text
object to that `ErrorValue` or rendering the broken source verbatim. So `{= 1 / 0 }` resolves to
`!#DIV0` — the `!` convention D-116 established, applied to a computed error rather than to broken
source text — and the rest of the object renders normally. Full ruling: **D-117**.

## Why this needed its own decision rather than falling out of D-116

D-116 covers a span that never produced an AST at all (a parse failure) — there is no computed
value to show, so it shows the operator's own source back to them. This ruling covers a span that
parsed fine and evaluated to an `ErrorValue` — there IS a value, and it is legitimately broken
graph state (§5.1). Showing the SOURCE here (`!{= 1 / 0 }`) would tell the operator less than
showing the CODE (`!#DIV0`): they already have their own source in front of them; what they lack is
knowing it failed and how. D-117 records this distinction explicitly (clause 3) so a later reader
does not "simplify" the two mechanisms into one.

## What I changed in the tree

**Nothing.** Like D-116, this is a pure ruling — `evaluateBlockTree` does not yet implement either
D-116 or D-117; both remain owed by the Phase 5 wiring cycle, which now has both answers in hand
before it starts rather than discovering the gap mid-build. No code, no test, no shape change was
needed to record this one: D-115's `BlockParseErrorBlock` shape (added at 0121-REVIEW, widened at
0122) has nothing to do with this case — a runtime-broken formula is a perfectly well-formed
`FormulaBlock`/`ConditionalBlock` whose `formula/eval.ts` evaluation happens to yield an
`ErrorValue`, not a parse-time `error`-kind `Block` at all. Nothing in the existing data model needed
touching for this ruling to be recordable.

## Open questions

Q-020 is closed. Q-017, Q-016, Q-012, Q-008 unchanged. Next free: **Q-021** (unchanged — no new
question was raised this cycle).

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs; unchanged from 0122, since no code was touched)

$ npx vitest run
 Test Files  28 passed (28)
      Tests  1329 passed (1329)
```

0 skipped, 0 `.only`. Numbers identical to entry 0122's because this entry changed no source file —
`claude/DECISIONS.md` and `claude/OPEN_QUESTIONS.md` only.
