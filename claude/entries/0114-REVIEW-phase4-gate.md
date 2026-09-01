# 0114 — REVIEW (phase 4 gate): the human's session. Criterion WITNESSED, not yet PINNED
Date: 2026-08-31   Phase: 4   Model: reviewer
Reviews: the human's own gate session against the tree at 1cfcf64/a7d3d99 (no new code)
Previous review: 0113-REVIEW-phase4
Verdict: **Phase 4's criterion is SATISFIED IN BEHAVIOUR and WITNESSED. The gate is NOT YET CLOSED
— §12.1 owes one executable test.** Two findings from the session, both new, neither disputing the
result.

## What the human reported

A single document holding a circle, a polygon, and a 4×4 `table_1`, with binding running in both
directions at once — their words: "data drives geometry which drives data." Read off their screen
capture and their command log:

- **(a) data drives geometry** — `table_1` cells drive a shape's dimensions; the circle's radius
  reads `146.8212157315694` out of the table.
- **(b) geometry drives data** — `polygon_1.origin.x` (731.9184 in its properties panel) appears in
  `table_1` under a "Polygon Origin" label, i.e. a cell holding a formula that reads the polygon.
- **Chained through arithmetic, and re-evaluating live** — `set table_1.A2 =
  (table_1.A4)/table_1.D1 + (table_1.B4)/table_1.D1` committed, then `set table_1.D1 = 5` re-drove
  it, with the log echoing the replacement each time.
- **No false cycle.** Nothing in the session was refused as cyclic, and the two directions coexist
  in one document — which is the specific thing Phase 4 exists to prove and the specific thing a
  naive implementation gets wrong.

**This is the product validation the phase gate is actually for, and it passed.** D-084 established
that a human running the app is a real gate condition and not a formality; this session discharges
that condition for Phase 4. Recorded here in the human's own terms so the log carries it.

## Why the gate is nevertheless not CLOSED yet

PROCESS_BRIEF §12.1, verbatim: "The criterion MUST be expressed as executable test(s) before the
phase is claimed complete. A criterion shown only by screenshot, description, or manual fiddling
isn't shown."

Audited the suite for that test. It does not exist:

- `main.test.ts:723` pins **(c)** — a polygon whose `origin.x` is a formula drags in Y only, with
  §5.9's feedback reaching the log. Its own comment explicitly disclaims being Phase 4's (c): "this
  is the Phase 3 half of it."
- `commands.test.ts` pins each *ingredient* — `set table_1.A1 5`, `set table_1.A1 =
  polygon_1.origin.x * 2`, `link polygon_1.origin.x table_1.A1`, and cycle rejection.
- **Nothing pins the composite**, which is the criterion's actual wording: "all three hold
  **simultaneously in one document**, with no false cycle."

That gap is not pedantry and it is not doubt about what the human saw. It is that **the one property
Phase 4 exists to establish is currently protected by nobody.** Any future cycle can break
two-directional binding and the suite stays green; the only detector is another human session. The
ingredients each being tested is not the same as the composite being tested — a false cycle is
precisely a defect that appears only when both directions are present at once.

**Owed: one slice, one test, no production code.** Build the human's document in
`main.test.ts` — two polygons and a table — and assert (a), (b), (c) and the absence of a cycle
rejection, in that one state. The helpers all exist (`typed`, `objectNamed`, `numberAt`,
`pointerDownAt`/`pointerMoveTo`). It is a cheap slice and it converts a witnessed result into a
permanent one. **Phase 5 does not begin before it lands** (§12.4).

## Findings from the session

**F7 — a table cell draws its number at full float precision and nothing clips to the cell.**
`renderer.ts`'s `formatCellValue` returns `String(value)` for a number, so the session's cells drew
`146.8212157315694` and `731.918397470668…`, overrunning their cell borders and overlapping the
neighbouring column — visible and unreadable in the human's capture, where two adjacent cells'
numbers collide into each other.

Two distinct causes, and the human named the first:

1. **No decimal bound.** D-099 already solved exactly this for the properties panel by giving
   `describeSlotValue` a `maxDecimals` option (4, trimmed). `formatCellValue` is the *sanctioned*
   second formatter (D-099 clause 5, deliberate — not a copy to be reconciled), and it simply never
   got the same treatment. Giving it one is consistent with D-099 rather than a new idea.
2. **No width clipping.** Independent of rounding: a long STRING overruns too — "Circle Radius
   Below" spans past its own cell in the same capture. Rounding alone does not fix this, and a
   number wide enough (a large integer) would still overrun.

Neither is an engine concern; both live in `render/renderer.ts`'s `drawCellText`. Ruled **D-109**.

**F8 — a refused command DISCARDS what the operator typed.** `main.ts`'s input `keydown` does
`input.value = ""` *before* `applyTransition(submitLine(...))` and unconditionally
([`main.ts:1063-1065`]), so a line that is refused is gone and must be retyped from scratch.

This is the actual source of the human's second complaint ("basically 'quits' the formula and makes
me re-type it in"). It is worth separating from the empty-cell question underneath it, because **it
is a defect on its own terms and it degrades every refusal in the system**, not only this one: a
mistyped address, a cyclic formula, a D-097 dimension refusal, a `#PARSE` — every one of them
currently costs the whole line. A long formula is exactly where retyping hurts most, and a long
formula is exactly what is most likely to be refused.

Cheap and independent of any ruling: keep the text on refusal, clear it only on success. It
interacts with D-089's unbuilt command history but does not depend on it — history is "get an OLD
line back", this is "don't lose the line you are holding". Ruled **D-109** clause 3.

## The empty-cell reference — NOT ruled here; it is the human's, and it is a REVERSAL

The human asks: should referencing a blank cell auto-assign that cell 0, instead of refusing?

**This overrules a standing ruling, which is why the reviewer is not settling it.** D-047 clause 4
decided the opposite, deliberately: "a range names a REGION, whose membership the system computed,
while a reference names ONE slot the user wrote," so an in-range empty cell is SKIPPED but a bare
reference to a missing slot stays a dangling reference. 0080-REVIEW's F4 re-examined it on the
implementer's request and let it stand, changing only the message. The human is the final arbiter on
product behaviour (D-042) and may reverse it — but a reviewer may not, and the reversal has design
consequences worth stating before it is taken.

Raised as **Q-018**, with the analysis, the three options and their costs. Nothing is tagged;
nothing is built pending the answer.

What I will say as the reviewer, so the human is choosing with the trade-off in hand: the narrow
form of what they are asking for is **coherent and is the spreadsheet idiom** — an in-extent cell of
an existing table is a legal, bounded address (D-044 already bounds ranges by extent), so "this
address is legal but unpopulated" is expressible without weakening §5.1.1's no-dangling-edges rule
at all: emit no edge, read it as empty, and let the edge appear on its own when the cell is
populated, since edges are re-derived from stored ASTs every mutation and never hand-maintained.
The real cost is not structural — it is that **a typo inside the extent becomes silent**:
`= table_1.Q9` would read 0 rather than telling you Q9 is empty. Excel accepts that trade. Whether
this project should is the human's call, and F8's fix removes most of the pain that prompted the
question either way.

## Rule and invariant audit

No code changed since 0113-REVIEW; the tree is byte-identical apart from `claude/`. Rules 1-7 all
stand as audited there. `npx vitest run` → 27 files, 1262 passed, 0 skipped, 0 `.only`; both tsc
configs clean. F7 and F8 are defects in code that was already reviewed and already green — neither
was introduced by entries 0111-0112, and neither is a regression: `formatCellValue` has returned
`String(value)` since entry 0062 and the input has cleared unconditionally since entry 0089. **Both
are things only a human running the app could have found, which is the argument for D-084's stance
and for this session.**

## What happens next

1. **The gate test** (§12.1, above) — the one thing standing between Phase 4 and Phase 5.
2. **D-109's F7/F8 fixes** — small, `render/` and `main.ts`, no engine change. F8 in particular
   should not wait; it taxes every refusal.
3. **Q-018's answer** from the human, then whatever it rules.
4. **Q-017's headers** (0113-REVIEW) — still open, still recommended, and the session bore out why:
   the human was writing `table_1.D1` and `table_1.A4` into a grid with no coordinate markings.

Phase 4's criterion is **WITNESSED — not yet claimed complete.** It may be claimed the moment the
gate test lands.
