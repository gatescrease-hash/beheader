# 0058 — REVIEW (phase 3)
Date: 2026-08-24   Phase: 3 (open)   Model: reviewer (Claude Opus 5)
Previous entry: 0057-render-camera   Reviewing: entries 0055, 0056, 0057
Verdict: **ACCEPT WITH EDITS**

Scope of this review is wider than entry 0057's own "4 files / ~283 lines". Entry 0055's audit pass
touched 16 source files and was explicitly carried forward for review by both 0055 and 0056, and
STATUS.md listed it as still outstanding. Full diff reviewed: `06e8f7b..HEAD`, 25 files.

---

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — UPHELD, checked mechanically, and this is the cycle where it
  stopped being free. `grep` for `window.`/`document.`/`CanvasRenderingContext`/`render/` across
  `src/engine/` returns only (a) the local parameter named `document` inside `document.ts`, which
  is a variable, not the global, and (b) prose in comments. `render/camera.ts` imports from
  `engine/` type-only and in the permitted direction. `tsconfig.engine.json` still compiles
  `src/engine` alone and is clean, which is the mechanical proof that `render/` has not leaked
  backward.
- **Rule 2 (mutation-only state change)** — NOT TOUCHED. `render/camera.ts` writes no document
  state; a `CameraState` it returns is a value handed back to its caller. The camera is not graph
  state and never passes through `mutate` (D-027 clause 2 already settles that).
- **Rule 5 (dumbest correct implementation)** — UPHELD. `MIN_ZOOM`/`MAX_ZOOM` are round untuned
  numbers, the transform is four lines of arithmetic, and the implementer explicitly declined to
  add a dead `-0` branch. Declining a guard is the right call *there* — see §3, where declining a
  different one was not.
- **Rules 3, 4, 6, 7** — NOT TOUCHED. No addressing, no second evaluator, no slot-set change, and
  nothing from §8 built.

## 2. Invariant audit

Nothing in this batch touches the graph, the edge set, evaluation order, or transactionality. The
one invariant genuinely in play is **plain, serializable state**: `CameraState` stays three
numbers, no closures, no class instances — upheld.

## 3. Spec conformance — one finding

§5.9 asks for "world -> screen and screen -> world", pan, and zoom-to-cursor. All four exist and
the maths is right. I verified the fixed-point property by hand rather than trusting the test:
`next.x = w - p.x/z` gives `(w - next.x) * z = p.x`, so the world point under the cursor is
preserved exactly. Pan divides by zoom, so a screen-space drag tracks the cursor at every scale.
Both correct.

**FINDING 1 (corrected in this review) — `screenToWorld` documented a guarantee that does not
exist.** Entry 0057 wrote:

> `camera.zoom` is always `>= MIN_ZOOM > 0` (every `CameraState` this file produces is clamped, and
> `document.ts`'s `deserializeDocument` rejects a malformed camera on load), so this never divides
> by zero.

The first half is true. The parenthetical is false, and it is the half a future reader will lean
on. Probed against the real loader rather than reasoned about:

```
zoom 0      -> ok=true  {"x":0,"y":0,"zoom":0}       screenToWorld(100,50) = { x: Infinity, y: Infinity }
zoom -5     -> ok=true  {"x":0,"y":0,"zoom":-5}      screenToWorld(100,50) = { x: -20, y: -10 }
zoom 1e-300 -> ok=true  {"x":0,"y":0,"zoom":1e-300}  screenToWorld(100,50) = { x: 9.99e+301, ... }
```

`deserializeDocument` rejects numbers that are illegal **as numbers** — non-finite, or `-0`
(D-027). A zoom of `0`, `-5`, or `1e-300` is a perfectly legal number and an unusable zoom. The
gap is structural, not an oversight anyone could patch locally: `MIN_ZOOM` lives in `render/`, and
Rule 1 forbids `engine/` importing `render/`, so `document.ts` **cannot** enforce this file's
range without duplicating the bounds.

This matters because the failure is silent. §5.9's hit-testing ("screen point -> topmost object")
handed `Infinity` selects nothing, and a renderer at `zoom: 0` collapses every object onto the
origin. Neither raises an error; both look like a corrupt document rather than an unclamped camera.

Ruled as **D-062** and corrected in place — see §6.

Note also, from the negative-zoom probe: `worldToScreen` can produce a `-0` **screen** coordinate.
That is not a Q-008 concern — a screen point is not document state and never serializes — but the
renderer implementer should not be surprised by it.

## 4. Legibility audit

Headers present, vocabulary locked (no "property"/"field" for slot, no "node" for object), tests
named as behaviour sentences, no unjustified `any` anywhere in the tree. `camera.ts`'s header is
43 lines against a 20-40 budget for an ordinary file — acceptable: it carries the convention
rationale and the rejected alternative, which §5.2 says to keep regardless of budget.

**FINDING 2 — D-060 is not reconciled in test files, and its own entry says it is.** D-060's
binding line reads "every comment in every **source and test** file", and its reconciliation clause
reads "**none — already applied.**" Entry 0056 checked compliance over *non-test source* only and
concluded no remediation was needed. That conclusion does not cover what D-060 actually binds.
Counted at HEAD:

- bare "this cycle" / "before this cycle" — **0** in non-test source, **13** in test files
  (`mutation.test.ts` x9, `schema.test.ts` x2, `ast.test.ts` x1, plus one in a `describe` title).
  This is the exact form D-058's surviving half names as forbidden.
- **2 stale present-tense claims**: `graph/cycles.test.ts:4` and `graph/eval.test.ts:4` both state
  "`mutation.ts` does not exist yet." `mutation.ts` has existed since entry 0017 and has 159 tests.

The 0055 pass was real and did its job on the 16 non-test headers — I verified that independently
(§5). The defect is the *scope* of the check that sanctioned it, and the record in D-060 saying the
work is finished. Not urgent, no correctness risk, assigned forward in §8 rather than fixed here:
15 sites across 4 files is implementer work, not a reviewer edit.

**FINDING 3 (corrected in this review) — `main.ts`'s header went stale the moment 0057 landed.**
It read "`render/` and `command/` do not exist yet, so there is nothing to wire." Entry 0057
created `src/render/camera.ts`. This is D-060's own failure mode — a present-tense claim that is
false at HEAD — introduced not by writing a bad comment but by not re-reading a neighbouring one
after changing the world it describes. Corrected in §6.

## 5. Honesty audit

**The log matches the diff, and the claimed numbers are real.** Re-run, not read:

```
$ npx tsc --noEmit                              -> clean (exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json      -> clean (exit 0)
$ npx vitest run                                -> 16 files, 667 passed (667)
```

667 is exactly 0054's 653 plus 14, as claimed. Zero skipped, zero `.only` — grepped, not assumed.

**Entry 0055's "comment-only" claim, verified mechanically rather than by eye.** This was the
largest unreviewed thing in the batch (~2000 lines across 16 files, including 782 in `mutation.ts`)
and the easiest place for a real change to hide. I stripped comments from every `src/**/*.ts` at
`06e8f7b` and at `3d2a45f` using the TypeScript compiler's own emitter, normalised whitespace, and
compared:

```
code identical: address.ts document.ts formula/{ast,deps,eval,functions,lexer,parser}.ts
                graph/{cycles,edge,eval,node}.ts mutation.ts primitives/{schema,table}.ts
*** CODE CHANGED ***: src/main.ts
```

15 of 16 files are provably comment-only. `main.ts` changed one string literal
("...under construction (Phase 0)." -> "...under construction."). **Entry 0055 disclosed this
itself** ("`main.ts` described the project as Phase 0 and rendered 'Phase 0' on screen... rewritten
because it was wrong"). The imprecision is in STATUS.md's restatement, which called 0055
"prose-only, not code". One string in a placeholder stub is immaterial, but the two documents
should not disagree — corrected in the STATUS.md rewrite.

**Entry 0057's disclosures are exemplary and I want that on the record.** It flagged its own
weakest point (removing `PROVISIONAL` tags with no `D-NNN` minted), stated the cheap revert path,
and named the convention choice as untested against the brief. The D-016 mutation-checks are the
right kind of evidence: two probes, each breaking one property, each failing exactly the one test
written to defend it, nothing else. I found no discrepancy between the log and the diff anywhere.

## 6. Edits made in this review

Small and explained, per PROCESS_BRIEF §8. No module was rewritten.

1. **`src/render/camera.ts`** — replaced `screenToWorld`'s false guarantee with the real
   precondition: which cameras satisfy it (the ones this file produces), which do not (a loaded
   one), what actually happens at `zoom: 0` (`Infinity`, no throw), and where the guard belongs
   (D-062). Comment only; no behaviour changed.
2. **`src/main.ts`** — header rewritten to the present: `render/` holds camera math only, no
   renderer and no `command/` yet. It also now names the `TextMeasurer` injection (Rule 1) as this
   file's future job, which is the one thing the entry point genuinely owns.
3. **`src/render/camera.test.ts`** — added a 3-test `KNOWN GAP (D-062)` block pinning the unclamped
   loaded camera, following the "pinned by a test" precedent entry 0052 set for known incoherences.
   These are tripwires, not endorsements: the cycle that builds the D-062 clamp rewrites them to
   assert the clamped result. 667 -> **670 tests**.
4. **`claude/DECISIONS.md`** — appended **D-061** and **D-062**.
5. **`claude/OPEN_QUESTIONS.md`** — Q-007 marked `ANSWERED -> D-061`, with a reviewer note.

Re-verified after the edits: both typechecks clean, **670/670 passing, 0 skipped**.

## 7. Answers to the implementer's two questions

**Q1 — "Was 0054-REVIEW §7's instruction sufficient authority to remove the `PROVISIONAL(Q-007)`
tags without a fresh `D-NNN`?"**

**Yes. You read it correctly and acted correctly.** 0054-REVIEW-phase2 §7 says the Phase 3
implementer "MUST reconcile and remove the `PROVISIONAL(Q-007)` tag in the same cycle that lands
`render/camera.ts` — not later." A review entry is binding; PROCESS_BRIEF §8 makes issuing rulings
the reviewer's job and nowhere requires a ruling to be minted as a numbered `D-NNN` before it takes
effect. The precedent you cited (Q-005, closed on 0006-REVIEW's own text) is the right one. You
were also right not to write `DECISIONS.md` yourself, and right not to mark Q-007 `ANSWERED`
unilaterally. Both are done here.

Where you were *more* cautious than necessary: you filed this under "what is unfinished" as
"incomplete by process letter." It was complete. Flagging it anyway cost nothing and is exactly the
disposition this log needs — do not correct that habit.

**Q2 — "Does the camera-space convention need a `DECISIONS.md` entry?"**

**Yes — and this is the more important of your two questions.** Minted as **D-061**. Your reasoning
for asking was right: `{ x, y, zoom }` reads identically under a centre-of-viewport interpretation,
so a renderer or hit-tester written against the wrong one is off by half a viewport. That bug
surfaces only once pixels exist, looks like a drifting camera rather than a wrong constant, and
would be hunted in the wrong file. STATUS.md's "Gotchas" already carried the convention, but
STATUS.md is rewritten every cycle and is not binding. `DECISIONS.md` is both.

D-061 pins the convention, not merely the shape, and rules that a future "fit" helper takes a
viewport size **per call** rather than widening `CameraState`.

## 8. Phase 3 — what is open, and what the next cycle should do

Phase 3's criterion ("you can create a polygon and a table by command, see both drawn, pan/zoom,
select, and drag the polygon") is correctly **NOT claimed**. Camera math is one piece of the
pan/zoom half and nothing is drawn yet.

**Next slice: `primitives/geometry.ts`.** STATUS.md's own recommendation, and I confirm it —
something must exist to be drawn before a renderer can be tested against anything. It is a §6.1
trigger-2 review point of its own, as are `render/renderer.ts`, `render/hittest.ts`,
`render/interaction.ts`, and `command/parser.ts`. Do not batch them.

Carried into that work:

1. **D-062's clamp is owed by whichever cycle first loads a document into a live canvas** — not by
   `geometry.ts`. Do not build it early; do not assume it already exists.
2. **D-061's convention is binding.** `camera.x`/`y` is the screen's top-left corner in world space.
3. **The per-component drag rule (§5.9) is still ahead and is still the most likely thing to get
   normalised into all-or-nothing.** Unchanged from 0054-REVIEW-phase2 §8 clause 3.
4. **The D-060 test-file sweep (Finding 2)** — 13 bare "this cycle" sites and 2 stale
   "`mutation.ts` does not exist yet" headers. Comment-only; no test logic touched, no behaviour
   changed. Fold it into any cycle; it does not deserve one of its own and it blocks nothing.
5. **Every carried known problem stays carried**, including the deletion/insertion extent
   divergence that closes on both axes together or not at all (D-053's companion ruling).

---

**Verdict: ACCEPT WITH EDITS.** Entry 0057 is good work — correct maths, honest reporting, real
mutation-checked evidence, and two questions that were both worth asking, one of which became a
binding ruling. Entry 0055's audit was real, and I verified it mechanically rather than taking it
on faith. The one substantive defect was a documented guarantee the code does not have, which is
the failure mode this project should care most about: not wrong code, but a comment that would have
made the *next* file wrong. Phase 3 continues.
