# 0060 — REVIEW (phase 3)
Date: 2026-08-24   Phase: 3   Model: reviewer
Reviewing: entry 0059-geometry-presets (1 cycle, 5 source files, ~1,148 changed lines)
Previous review: 0058-REVIEW-phase3 (ACCEPT WITH EDITS)

**VERDICT: ACCEPT WITH EDITS.** Eight comment-only edits made by me, listed in §6. Two rulings
minted: **D-063** (headers state the present, never "this cycle") and **D-064** (preset winding is
an invariant). Four fix-list items for the next cycle, none blocking. Phase 3 continues; the next
slice is `render/renderer.ts` as STATUS.md proposes.

This is the strongest cycle in the log so far. The mutation-testing in Decision 4 — writing a
defensive guard, then discovering by probe that it was dead and deleting it rather than shipping it
— is exactly the behaviour PROCESS_BRIEF §10 is trying to produce, and it was done unprompted.
Almost everything below is calibration, not correction.

---

## 1. Rule audit

- **Rule 1 (engine purity)** — UPHELD. Grepped `document.`/`window.`/`canvas`/`render/` across
  `src/engine/`: every hit is prose in a comment or a local named `document` in a test.
  `geometry.ts` imports `address.ts`, `graph/node.ts`, `primitives/schema.ts` and nothing else.
- **Rule 2 (mutation-only state change)** — UPHELD, not really at stake: `geometry.ts` is pure
  compute and `mutation.ts` was not touched.
- **Rule 3 (addressing)** — not touched. Paths are consumed, never concatenated; every path is a
  shared exported constant.
- **Rule 4 (one formula engine)** — not touched.
- **Rule 5 (dumbest correct implementation)** — UPHELD, and worth naming because it looks violated
  and is not. `centroid.x` and `centroid.y` each recompute the whole centroid; the four `bounds.*`
  slots each recompute the whole bounds; `edgePairs` allocates a pair array per call. That is four
  to eight times more arithmetic than needed, and it is the CORRECT choice here — Rule 5 and §4
  ("NEVER optimise") are explicit, and a memoised version would be the harder thing to delete when
  `polyline` reshapes this. Flagged only so a future cycle does not "fix" it and call that an
  improvement.
- **Rule 6 (slot set fixed during evaluation)** — UPHELD, and this is the cycle's central spec
  claim. Every preset's parameter count is fixed, all three schemas declare `static`
  `nonDerivedSlotPaths`, and no per-vertex slot exists for these types. §5.5's own reason for the
  single `vertices` slot is implemented as written, not approximated.
- **Rule 7 (no §8 deferred items)** — UPHELD. `polyline`, `explode`, `addvertex`/`delvertex`,
  `Segment`/`closed`/`style` all correctly declined, each with a stated reason.

## 2. Invariant audit

The one that mattered: **derived slots evaluate INSIDE the topological pass, never a post-pass.**
This cycle introduces the first derived→derived chain in the codebase (`centroid`/`area`/`length`/
`bounds.*` all depend on `vertices`, which is itself derived), so the ban on a `recompute()` pass
was under real load for the first time. It holds, and the test proving it is a good one: a table
cell drives `polygon.radius` (formula) drives `vertices` (derived) drives `bounds.maxX` (derived),
and editing the cell moves `bounds.maxX` from 5 to 10 in a single `mutate`. I re-ran it and also
confirmed the single-call case independently — a radius 2→4 resize quadruples `area` inside one
mutation, so nothing is reading a previous propagation's value.

Rejection-leaves-state-unchanged, no dangling edges, plain serializable state: not touched, and
`Point[]` is plain data throughout. No `#CYCLE` value introduced. Dependencies are declared
statically, eager and total.

## 3. Spec conformance (§5.5)

Checked clause by clause against the brief's own words, including the over-specified parts.

- Preset slot lists match §5.5 exactly: `polygon(sides, radius, origin, rotation)`,
  `circle(origin, radius)`, `rect(origin, width, height)`. Verified against the registry, not just
  the source.
- All nine derived slots present per type — `vertices` plus §5.5's `centroid.x`, `centroid.y`,
  `area`, `length`, `bounds.{minX,minY,maxX,maxY}`.
- "**not writable**... binding to one is rejected." Verified by probe through the real `mutate`,
  not by reading: `set circle_1.area 99` and a formula written to `centroid.x` are both rejected
  ("derived slots can never be converted (§5.1)"). This comes free from registration, which is the
  right shape — no new per-type enforcement was invented.
- "For `circle`, the derived `vertices` slot yields a polygonal approximation... the renderer still
  draws a true arc." Implemented as written, and the circle's area test correctly compares against
  the inscribed 32-gon's area rather than πr², which is the honest assertion.
- "Consumers always read `vertices`" — the eight shared slots read `vertices` and nothing else, so
  the identical-interface promise that makes `explode` cheap later is already real.

## 4. Legibility audit

Headers present, vocabulary locked (the single "properties" is TypeScript's own record properties,
not a synonym for slot), no `any` anywhere in the diff, tests named as behaviour sentences. Two
problems, both fixed in §6:

1. **`geometry.ts` claimed "Load-bearing per Rule 3."** It is not. Rule 3 governs the ADDRESSING
   scheme; this file only consumes addresses. §6.2's load-bearing list is `address.ts`,
   `mutation.ts`, `graph/*`, `primitives/schema.ts`, `document.ts` — geometry is not on it, and
   `primitives/table.ts`, the exact structural analogue, makes no such claim. This is not cosmetic:
   §6.2 uses "load-bearing" to gate when a later PHASE may start, so a file that self-declares into
   that list over-triggers the gate for every future cycle that touches it.
2. **Eight new D-060 violations**, while 0058-REVIEW Finding 2's sweep of thirteen older ones is
   still outstanding — including one in NEW non-test source (`geometry.ts`'s opening sentence,
   "This cycle builds the three PARAMETRIC presets"), which falsified STATUS.md's standing claim
   that "Non-test source is clean." Ruled as **D-063** rather than only fixed, because this is now
   the second review to find it and the authoring instinct behind it will recur on every new file.

**Header budget** (§5.2: 20-40 ordinary, ~80 load-bearing): `geometry.ts`'s is 100 lines. I am NOT
asking for a trim, because it is not this cycle's defect — `mutation.ts` is 151, `formula/eval.ts`
105, `primitives/table.ts` 101, all post-audit and accepted at 0055/0058. The budget is being
systematically exceeded across the codebase; that is a codebase-wide question for a future audit
pass, not a bill to hand the one cycle that happened to arrive next. Every line of this header is
doing real work.

## 5. Honesty audit

**The log matches the diff, and the claimed numbers are real.** I re-ran everything rather than
reading it: both typecheck configs clean, 714/714 tests, 17 files, 0 skipped, and `geometry.test.ts`
at 41 / `schema.test.ts` at 31 exactly as the entry reconciles them. Zero `.only`/`.skip`/`.todo`.
The diff is 5 source files, matching the declared scope with no silent expansion — nothing was
touched that the entry does not name. The §6.1 trigger-5 disclosure (three re-pointed test fixtures)
is accurate and, importantly, **no test was weakened**: each fixture was re-pointed from `circle` to
`polyline` so the behaviour under test — "a type with genuinely no schema entry" — is still being
tested, rather than the assertion being softened to keep it green. That is the right move, and it
was disclosed instead of buried.

Two calibrations, neither a defect in the code:

- **Decision 4's premise, verified.** `finalizeVertices`'s dropped `-0` guard rests on
  "`origin.<axis>` is always an already-legal (never-`-0`) slot value," which the comment asserts
  without saying why it is guaranteed. I checked the guarantee rather than accepting it: `mutate`
  rejects an authored `-0` literal (probed — "would hold an illegal value (-0)... (D-025/Q-008)"),
  and every formula result routes through `finiteResult`, which normalises `-0` to `+0` (D-033).
  So the premise holds and the deletion is correct. It rests on **Q-008's still-PROVISIONAL option
  (a)** — but harmlessly: under (b) or (c), `-0` would become legal or be normalised on entry, and
  `hasIllegalNumber` would stop rejecting it in the same motion, so the guard and the hazard
  disappear together. No tag needed; recording the check so the next reviewer need not redo it.
  This mattered more than it looks: `hasIllegalNumber` walks into `Point[]`, so a `-0` vertex would
  have been re-rejected on the NEXT mutation and wedged the document, not merely looked untidy.
- **The claimed asymmetry between the two guards is real but narrower than stated.** The entry and
  STATUS.md say `finiteOrTypeError`'s `-0` branch is "genuinely reachable" against
  `finalizeVertices`' dead one. Reachable through the BUNDLE'S CONTRACT — yes, and the guard is
  required. Reachable through any PRESET — no: all three presets wind counterclockwise, so
  `computeCentroid` never divides by a negative signed area today. I verified this across `rotation`
  values `0, 1, -1, 2.5, π` plus a degenerate zero-width rect; the doubled signed area is strictly
  positive every time. The test's clockwise square is hand-fed, not pipeline-produced. The code is
  right — `verticesDerivedSlots` is explicitly the shared bundle `polyline` will reuse, and an
  arbitrary `Point[]` is its stated contract — but the lesson STATUS.md teaches the next model
  ("don't assume symmetry between two guards that look alike") is sharper stated correctly: one
  guard is unreachable BY ALGEBRA under any input, the other is unreachable only under today's
  callers. That distinction is now **D-064**, along with the winding invariant itself, which three
  later consumers (renderer fill rule, winding-number hit tests, and `explode`, which snapshots
  `vertices` in this order into user-editable slots) will inherit whether or not they notice.

## 6. Edits made (all comment-only; typecheck and 714/714 re-verified after)

1. `geometry.ts` header — "This cycle builds the three PARAMETRIC presets" → present tense (D-063).
2. `geometry.ts` header — removed the false "Load-bearing per Rule 3"; replaced with an accurate
   statement of why §6.1 trigger 2 applies and why §6.2 does not.
3. `geometry.ts` header — "done in the SAME cycle (see that file's own diff)" → names the file and
   entry 0059 (D-063: a comment never points at a diff as its justification).
4. `geometry.test.ts` — "the geometry cycle's log entry" → "entry 0059", plus a note that the `-0`
   fixture's clockwise winding is contract-reachable, not preset-reachable (D-064).
5–8. `schema.test.ts` ×2 and `mutation.test.ts` ×2 — four diary comments ("X was this fixture's type
   until the geometry cycle...", "REAL as of this cycle") rewritten to state the present fact and
   date it by entry number.

I did not touch a line of logic. Every behavioural choice in this cycle stands as the implementer
made it.

## 7. Answers to the implementer's three questions

**Q1 — Was registering all three in `SCHEMAS` in the same cycle right, or should it have waited the
way `table`'s did?** Right, and Decision 2's reasoning is the correct reasoning. `table`'s
registration was deferred because the dynamic-slot-family MECHANISM did not exist yet (D-017), not
because "register in a later cycle" is a policy. No mechanism was missing here — three `static`
entries are the shape `VALUE_SCHEMA`/`ADD_SCHEMA` already had. Deferring would have shipped an inert
file that no test could exercise through `mutate`, and the two end-to-end tests that give this cycle
most of its value could not have been written. Correctly reasoned from the difference rather than
copied from the precedent.

**Q2 — Is the area-weighted centroid over-engineering?** No. Keep it. This is not an optimisation or
a generalisation — it is the correct formula for the thing the brief names ("centroid"), at the same
line count as the wrong one. Rule 5 bans building elaborate machinery for speed; it does not ask you
to implement a formula you know to be wrong for the shapes the same exported function will be handed
one phase later. The pinning test using an irregular quadrilateral with hand-derived, numerically
DIFFERENT answers is what makes this defensible rather than merely asserted — a test that only
checked "close to the vertex mean" would have proved nothing. That is the right instinct.

**Q3 — Is `readNumericSlots`'s generic-over-`K` worth the complexity?** Yes, keep it. You flagged the
right thing to be uneasy about and came down on the correct side. The alternative is three copies of
the same four-branch propagation ladder (`undefined`→`#REF`, error→propagate, non-number→`#TYPE`,
else bind), and those four branches are precisely what must never drift between presets — a fourth
preset copying a third's ladder and dropping the error-propagation branch is a realistic failure.
The generic is confined to one function, forced by `noUncheckedIndexedAccess` rather than chosen for
elegance, and the single `as` is explained. §13's tie-breakers agree: smaller diff, and easier to
delete later.

## 8. Fix list for the next cycle (none blocking; may ride along with any slice)

1. **Pin the winding invariant with a test** (D-064) — one test asserting a strictly positive doubled
   signed area for all three presets. Cheap, and it protects three future consumers from a silent
   corner-order change.
2. **`sides` has no upper bound.** `Number.isInteger(sides) && sides >= 3` admits `1e9`. Measured at
   this review: `sides=1e6` completes in 549ms; `1e9` allocates a billion `Point`s and hangs or OOMs.
   Same class as the already-recorded "no bound on how large `rows`/`cols` may be set", and it should
   be recorded the same way — **add it to STATUS.md's Known problems; do NOT fix it in isolation.**
   Rule 5 makes this a non-goal, §4 forbids the drive-by fix, and if a bound is ever added it should
   be one ruling covering `rows`/`cols`/`sides` together, not a third round of the same patch.
3. **STATUS.md's "Non-test source is clean" (re D-060) was false and is true again** after edit 1.
   Keep the claim honest as new files land — D-063 now governs it. The thirteen older test-file sites
   from 0058-REVIEW Finding 2 remain outstanding and still block nothing.
4. **Minor, no action needed unless it becomes noisy:** the two new files are LF while the rest of
   the repo is CRLF, and there is no `.gitattributes`. Harmless today; worth knowing before someone
   blames a whitespace-only diff on a tool.

## 9. Open questions

- **Q-008** — remains OPEN and provisional, unchanged. This cycle newly DEPENDS on its option (a)
  (see §5) but is safe under every option, so it still blocks nothing. Not ruled here: it is the
  human's product call and nothing is waiting on it.
- **Q-001, Q-002** — still OPEN, still Phase 3 command-surface questions. `command/` does not exist
  yet, so they are not yet due; the cycle that builds `command/parser.ts` takes them as PROVISIONAL
  under D-004 if the human has not ruled by then. Unchanged from 0058-REVIEW.
- No new questions raised this cycle, correctly — every choice the entry lists (rotation units,
  winding, `sides`/`radius` domain) is genuinely reversible and was disclosed rather than escalated.
  Winding is now pinned by D-064, which is the one that most needed it.
- Next free: **Q-012**.

## 10. Where phase 3 stands

Three of the four §6.1-trigger-2 files remain: `render/renderer.ts`, `render/hittest.ts` /
`interaction.ts`, `command/parser.ts` — each its own review point, as 0058-REVIEW §8 set out.
`render/renderer.ts` is the right next slice: camera math and a real primitive with a `vertices`
slot both exist now, so it is the first cycle that can put anything on screen. Phase 3's criterion
("create a polygon and a table by command, see both drawn, pan/zoom, select, drag") is correctly NOT
claimed.

Two standing reminders for that cycle, both from probes at this review rather than from the log.
**`render/` is not `engine/`** — Rule 1 stops being free there, and D-062's camera clamp is owed at
that boundary by whichever cycle first loads a document into a live canvas. And **`createObject`
requires the caller to supply all nine derived-slot placeholders** (D-018; probed — omitting them
fails with nine "slot does not exist" messages). The command layer that creates a circle by typing
`circle` must build them from `getObjectSchema`, exactly as `geometry.test.ts`'s own helper does.
That helper is the pattern to copy.
