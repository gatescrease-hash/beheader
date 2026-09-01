# 0115 — Phase 4's gate test: (a), (b) and (c) in one document, pinned
Date: 2026-09-01   Phase: 4   Model: reviewer (acting as implementer at the human's direction — see
"Decisions I made" 1)
Previous entry: 0114-REVIEW-phase4-gate   Last review: 0114-REVIEW-phase4-gate
Batch: cycle 1 of up to 3 since last review; 1 file / 132 insertions, 2 deletions.

## Declared scope

The executable half of Phase 4's gate, and nothing else: one `describe` block in `src/main.test.ts`
building the document the human ran by hand at entry 0114 — two polygons and a table — and asserting
**(a)**, **(b)**, **(c)** and the absence of a false cycle. No production code, in this or any other
file.

## Explicitly not in scope

**D-109** (F7's cell rounding/clipping, F8's refused-command line loss) — ruled, owed, untouched.
**D-110** (Q-018's empty-cell reversal) — newly ruled by the human this session, load-bearing, and
explicitly a `REVIEW: REQUIRED` slice of its own; nothing here anticipates it. **Q-017** (table
headers) — still open. None of these is a prerequisite for the gate.

## What I did

**`src/main.test.ts`** — one new top-level `describe`, six tests, one local helper:

- `firstVertexOf(object)` — the derived first vertex, for aiming a canvas press at a real stroke.
  Extracted because three of the six tests need it; it is the same lookup the pre-existing drag test
  at line 723 does inline.
- `gateDocument()` — the fixture, as typed lines through `submitLine`, matching this file's stated
  posture that "a fixture that skipped the typing would not be testing that": `table rows=4 cols=4`,
  `set table_1.A1 500`, `polygon_1` (driven), `polygon_2` (driving), `link polygon_1.origin.x
  table_1.A1` **(a)**, `set table_1.B1 = polygon_2.origin.x * 2` **(b)**.
- **"builds the whole document without a single refusal"** — both bindings exist, by slot KIND and
  by value, with no cyclic refusal anywhere in the log.
- **"(a) data drives geometry"** — `set table_1.A1 650` moves `polygon_1.origin.x`, and its DERIVED
  `centroid.x` follows, so the assertion is about geometry rather than only about the slot.
- **"(b) geometry drives data"** — dragging `polygon_2` by a vertex updates `table_1.B1` to twice its
  new `origin.x`, in the same mutation.
- **"(c) partial binding"** — dragging `polygon_1` moves Y and leaves the driven X at 650, with
  §5.9's feedback naming `table_1.A1` in the log.
- **"all three hold in ONE state at once"** — the criterion's own wording: (a), then (b), then (c),
  then all three asserted over the SAME final state.
- **"no FALSE cycle, and cycle detection is still alive"** — `set table_1.A1 = polygon_1.origin.x`
  closes a real loop and IS refused, and the refused mutation leaves `state.document` the same object
  (§5.1's bit-for-bit rollback).

Why the last test exists: asserting only "the gate document is not reported as cyclic" would pass
just as well if cycle detection were switched off entirely. The pair is the actual claim — this
document is not a cycle, *and* the detector that says so still works.

## Decisions I made

1. **I wrote this as the reviewer, at the human's direction, and that is a role deviation worth
   naming.** PROCESS_BRIEF §1 says the reviewer "does not do bulk implementation"; six tests in one
   file with no production code is surgical rather than bulk, and 0105-REVIEW's own edits to
   `interaction.ts`/`interaction.test.ts` are the precedent. The consequence is recorded honestly in
   "Review point" below: **I must not also be the one who clears this gate.**
2. **`gateDocument()` is a function, not a shared `beforeEach` state.** Each test builds its own
   document. Slower and entirely irrelevant at this size (Rule 5), and it keeps every test readable
   start to finish without scrolling to a fixture — the same choice the rest of this file already
   makes.
3. **(c) asserts the Y delta against the camera's own zoom** (`30 / state.document.camera.zoom`)
   rather than a hard-coded 130, everywhere except the composite test where the whole chain is
   pinned absolutely. Mirrors line 711's existing posture; a test that hard-codes a screen-to-world
   conversion silently stops testing the conversion.
4. **The composite test pins `origin.y` ABSOLUTELY (130)**, deliberately breaking decision 3's rule
   in the one place it should be broken: `STATUS.md`'s standing gotcha is that "a test that asserts
   an OFFSET cannot catch a wrong ANCHOR." The composite is the test that should notice if the whole
   document ends up somewhere unexpected.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npx vitest run
 Test Files  27 passed (27)
      Tests  1268 passed (1268)
```

Zero skipped, zero `.only`. 1268 = 1262 (entry 0112's count, unchanged through 0113/0114 which
touched no code) + 6 new.

**Mutation-checked (D-016), three checks, each confirmed red then green** — and the second one
changed the code:

- **Removed the `link` line from `gateDocument`** → 5 of the 6 failed. (b) correctly SURVIVED, which
  is the right answer: (b) does not depend on the link. Reverted, green.
- **Replaced `set table_1.B1 = polygon_2.origin.x * 2` with the literal `set table_1.B1 600`** → only
  2 failed. **"builds the whole document" did NOT fail, because 600 is exactly `300 * 2` — a literal
  holding the coincidentally-correct number satisfied a value-only assertion.** That is the test
  being weak, not the mutation being unfair, so I strengthened it: it now asserts the slot KIND of
  both bindings is `formula` before asserting their values. Re-ran the same mutation against the
  strengthened test → 3 failed, including "builds". Reverted, green.
- **Changed the cyclic command to a non-cyclic one** (`table_1.C1` instead of `table_1.A1`) → the
  cycle test failed with "expected '> set table_1.C1 = …' to contain 'cyclic'", confirming it passes
  because a cycle is genuinely detected and not because some other refusal happens to say so.
  Reverted, green.

## Acceptance criteria status

**Phase 4 criterion: "(a) data drives geometry · (b) geometry drives data · (c) partial binding —
all three hold simultaneously in one document, with no false cycle" — PINNED, and CLAIMED
COMPLETE.** Demonstrated by: the six tests above, in particular "all three hold in ONE state at
once" for the composite and "no FALSE cycle…" for the cycle half.

The manual check, described separately and honestly as §12.1 requires: **the human ran this document
by hand at the gate session recorded in entry 0114** and reported it working in both directions with
no false cycle. This entry does not replace that session — it makes it repeatable. Both halves of
§12.1 are now satisfied for the first time.

## Where I got stuck / what is unfinished

- **Nothing about the criterion.** The tests went in cleanly; the only real work was the mutation
  check, which is also the only thing that found a defect (in my own test).
- **The weak assertion I shipped and then caught is the honest headline here.** I wrote a value-only
  check for a BINDING, and a value-only check cannot tell a binding from a coincidence. It passed on
  the first run and would have gone in unnoticed without the mutation check — which is exactly the
  standing warning in `STATUS.md` ("a test that passes on its FIRST run is not yet trusted"), earning
  its place again.
- **`main.ts`'s DOM half is still untested by construction** (D-001). This slice tests the pure half,
  which is where the criterion actually lives; the canvas presses go through `pointerDownAt`/
  `pointerMoveTo`, not through real DOM events.

## Open questions raised

None new. No `PROVISIONAL(Q-NNN)` tag added or touched. **Q-018 was ANSWERED by the human this
session → D-110** (not built). **Q-017** unchanged and open. **Q-008/Q-012** unchanged and deferred.

## Review point

**Fired: PROCESS_BRIEF §6.1 trigger 1 — a phase acceptance criterion is claimed complete.** This is
the backbone trigger and admits no exceptions: "Every phase gate is reviewed before the next phase
begins."

**And a second, specific reason this one cannot be self-cleared: I wrote it as the reviewer**
(decision 1). §12.3 gives the reviewer the job of running the rule audit and opening the next phase;
doing that over my own diff would make the gate's verdict worthless. **Phase 5 must not begin until
someone other than this session has cleared it.** The diff is small (one test file, no production
code) and the mutation checks above are described concretely enough to re-run, so that review should
be cheap — but it is not optional, and it is not mine.

Cycles since last review: 1/3. Diff: 132 insertions / 2 deletions across 1 file (cap 800/10).

**REVIEW: REQUIRED.**
Reason: §6.1 trigger 1 (phase gate claimed), compounded by the author being the reviewer.
Questions for reviewer:
  1. Is "no false cycle" adequately pinned by the pair (this document is not cyclic + a real cycle
     still is), or does the criterion want a third case — e.g. a cycle that only closes once an
     empty cell is populated, which **D-110** will make reachable and which nothing tests today?
