# 0067 — REVIEW (phase 3)
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0066-render-interaction   Reviewing: entry 0066 (`render/interaction.ts`)
Trigger: §6.1 item 2 — first file of the interaction subsystem.

Diff reviewed: `ae0ea4d` — `src/render/interaction.ts` (new, 344 lines),
`src/render/interaction.test.ts` (new, 362), plus comment-only edits to `main.ts` (+12/-6),
`camera.ts` (+3/-2), `hittest.ts` (+3/-3), `renderer.ts` (+7/-5). 6 source files, ~741 lines,
matching the log's "~742 / 6 files".

## 1. Rule audit

Rules 3, 6, 7 — not touched. This file stores no address it did not receive, changes no slot set,
and builds nothing from §8.

**Rule 1 — upheld.** Grepped `engine/` for `document.`/`window.`/`canvas`: only header prose and
`document.ts`'s own field reads. No `engine/` file imports `render/`. `interaction.ts` sits in
`render/` and imports `engine/*` one-way, and — like `camera.ts` and `hittest.ts` — touches no
canvas at all. It is in `render/` because it depends on `CameraState`/`screenToWorld`, which Rule 1
forbids the reverse of. Consistent with the argument 0064-REVIEW §1 accepted for `hittest.ts`.

**Rule 2 — upheld, and structurally rather than by discipline.** There is no assignment to any slot
anywhere in the file; `mutate` is the only write. Grepped `render/` and `main.ts` for `.slots[`
writes — the one hit is a test READ. The per-component plan is built as data (`ComponentPlan`,
`DragPlan`) and handed to `mutate` in one batch, which is the shape that makes "never writes
directly" checkable rather than assertable.

**Rule 4 — not touched**, and worth one line because it could have been: the driver notice reuses
`formula/deps.ts`'s `extractDependencies` rather than walking the AST itself. A second walk over
`FormulaAst` here would have been D-052's violation reached sideways.

**Rule 5 — upheld.** A linear `objects.find` per move, a full `mutate` (whole-document clone, whole
graph re-evaluated) per pointer move, no throttling, no preview layer. That is exactly what §5.9's
drag-performance note says to build first and the log correctly declines to optimise it.

## 2. Invariant audit

Slot set fixed during evaluation, derived slots inside the topological pass, eager/total extraction,
lazy evaluation, no dangling edges — none touched by this file, all inherited through `mutate`.

**"Rejection leaves prior state bit-for-bit unchanged" — upheld and tested from the caller's side.**
`PointerMoveOutcome` returns the caller's OWN `objects`/`journal` references on rejection, and the
test asserts them with `toBe`, not `toEqual`. That is the right assertion: `toEqual` would pass for
a rebuilt-but-equal array and would not prove nothing was staged.

**Graph state plain and serializable — upheld.** `DragState` is a string and two numbers. Nothing in
`InteractionState` is a live object, a closure, or a `Map`. The one thing worth noting is that
`InteractionState` is not graph state at all — it is render-layer state that never enters a
`Document` — and it still obeys the rule, which is the cheap and correct posture.

**Never throws — upheld.** Every call it makes (`hitTest`, `screenToWorld`, `getSlot`,
`extractDependencies`, `formatAddress`, `mutate`) documents the same. Tested with an object whose
`origin.x` holds an `ErrorValue` and whose `origin.y` is absent entirely.

## 3. Spec conformance (§5.9), by probe

I ran five probes against the built API rather than reading for conformance.

**P1 — the reactive payoff, end to end. Works.** A real `polygon_b` and a real `table_x` whose `B1`
holds `= polygon_b.origin.x * 2`, both committed through `mutate`. Pressing on the polygon's
`(-50, 0)` vertex and moving +10:

```
B1 before: 0    hit: obj_1    rejection: undefined
origin.x after: 10            B1 after: 20
```

That is **Phase 4(b)'s exact shape — "geometry drives data" — already working**, one commit, no
false cycle. Not claimed as Phase 4 (that gate needs all three clauses simultaneously in one
document, plus the pixels), but it is the strongest single piece of evidence this cycle produced and
the log undersells it by not probing it.

**P5 — the eager/total notice claim is real.** `origin.x` driven by `IF(A1, B1, C1)` produces:

```
'rect_1.origin.x did not move: it is driven by a formula reading table_x.A1, table_x.B1, table_x.C1'
```

All three, not the live branch. §5.3's "eager and TOTAL" surfaced in user-facing text, which is the
first place in this codebase that clause becomes visible to the operator. **Nothing defended it** —
see edit 3.

**P2/P4 — the D-062 hazard, characterised.** At `zoom: 0`, `pointerDown` arms a drag holding
`{ x: Infinity, y: NaN }`, and the first move produces:

```
rejection: operation 1 of 2: rect_1.origin.x would hold an illegal value (NaN)... (D-025/Q-008);
           operation 2 of 2: rect_1.origin.y would hold an illegal value (NaN)... (D-025/Q-008)
origin.x: 0    journal len: 1 (unchanged)
```

**Deliberately NOT fixed here**, and this is the correct outcome rather than a tolerated one: D-062
and 0062-REVIEW §9 put the clamp at `main.ts`'s boundary once, and 0064-REVIEW Finding 2 declined
the identical fix in `hittest.ts` for the identical reason. A guard here would split the clamp
across three files. What is worth recording is that **the drag's failure mode is strictly better
than the hit test's**: `hitTest` at `zoom: 0` silently returns the wrong object, while a drag
refuses loudly, corrupts nothing, and journals nothing. The header did not say this; it does now
(edit 1).

**§5.9, clause by clause.**

- *"click to select"* — correct. Selection is read off `hitTest`'s result, `undefined` included.
- *"drag to move"* — correct, through `mutate`, with derived slots re-evaluated in the same pass
  (the drag test asserts `vertices` and `centroid.x` moved with `origin`).
- *"escape to deselect"* — `deselect()` clears selection AND an in-progress drag. Clearing the drag
  is not stated by §5.9 and is the right reading: a gesture that survives its own cancellation is
  the surprising option.
- *"Dragging calls the mutation API — it never writes object state directly"* — §1 above.
- *"A drag writes to `origin.x` and `origin.y` independently"* — correct, and I checked the reading
  that could have been wrong. The two writes go in ONE `mutate` batch, not two calls. "Independently"
  governs the per-component DECISION (one may move while the other does not), which is honoured;
  §5.1 separately and explicitly says "Dragging... should [use a batch]". Two mutations per pointer
  move would be two clones and two journal entries for one gesture step. The implementation is right
  and the brief settles it — now stated in the header (edit 2), because a reader could reasonably
  read "independently" the other way.
- *"Only when every component is driven does the drag do nothing"* — correct, and the test asserts
  `objects`/`journal` by identity, so "nothing" means `mutate` was never called. It must not be:
  `mutate` rejects an empty batch.
- *"show non-blocking feedback (e.g. 'x is driven by `table_x.A1`')"* — correct, and literally so.

**D-040 conformance, which nothing in the diff cited.** D-040 lets `set` overwrite a formula slot
and then bounds itself: "**Dragging is NOT covered** ... A drag is a continuous gesture, not a
statement of intent." The implementation obeys it exactly. It is the single ruling that forbids the
most tempting wrong behaviour in this file, and it was uncited — fixed in edit 2.

## 4. Findings

**No defect found in the shipped behaviour.** Five probes, four rule greps, and a full re-run
produced no incorrect result, no silent failure, and no unproven claim in the source. What follows
is one weak test, one untested claim, and two hazard/citation gaps — all fixed at this review.

### Edit 1 — the HAZARD block did not say what a DRAG does at `zoom: 0`

It described `hitTest`'s failure (every hit lands on the topmost object) and stopped there, leaving a
reader to assume the drag inherits the same silent wrongness. It does not — P2/P4 show it rejects
loudly and journals nothing. Added, with the caveat that the message names the value rather than the
camera, so the drag can never succeed and never explains why. This makes the hazard note describe
the file it is in.

### Edit 2 — two uncited rulings on the two most likely wrong readings

Added a sentence naming **D-040**'s "dragging is NOT covered" bound (the ruling against a drag
behaving like `set`), and a short paragraph settling "independently" vs. the single batch (§5.9 vs.
§5.1). Both are places where a future cycle would otherwise have to re-derive an argument that is
already ruled or already in the brief.

### Edit 3 — the eager/total notice claim had a doc comment and no test

`describeSlotDriver`'s doc comment states that the notice names every slot a branching formula could
read, which P5 confirms. Nothing in the suite exercised a branching formula — the driver tests all
used a bare reference, where eager and lazy extraction give the same answer and the test cannot
discriminate. Added one test with `IF(A1, B1, C1)` asserting all three names appear. §5.6: a brief
"deliberate" deserves a test that names it. Same posture as 0064-REVIEW §6 writing D-064's owed
pinning test rather than carrying it forward again.

### Edit 4 — one near-tautological assertion

*"holds the object's id, not the GraphObject"* asserted `expect(state.drag).not.toHaveProperty
("object")` — the absence of one guessed field name. Replaced with a key-set assertion
(`["lastWorldPoint", "objectId"]`) plus an identity check on the id, so ANY extra field fails it,
not just one spelled `object`. The property being defended is real and is the STATUS gotcha this
cycle inherited; it now has an assertion that can actually catch its violation.

### Not a finding — `INITIAL_INTERACTION_STATE` is returned by reference and is not frozen

`pointerDown` on empty canvas and `deselect()` both return the module constant itself
(`=== INITIAL_INTERACTION_STATE` is `true`; `Object.isFrozen` is `false`). Every field is `readonly`,
so nothing can reach it through the type system. **And there is direct precedent in a load-bearing
engine file**: `document.ts`'s `createEmptyDocument()` returns `DEFAULT_CAMERA` by reference the same
way, reviewed and accepted at Phase 0. Consistent with the codebase; not worth a divergence.

### Not a finding — `advanced` is built before the branch that may discard it

The rejection path computes an `InteractionState` it does not return. One object allocation per
rejected drag step, in a file that clones the entire document per accepted one. Rule 5.

## 5. Answering the log's own escalation

Entry 0066 Decision 1 flags directly that it **contradicts 0064-REVIEW §10 item 4**, which expected
this cycle to need `renderer.test.ts`'s context fake. **The implementer is right and my earlier
expectation was wrong.** §5.9's interaction sentence ("click to select, drag to move, escape to
deselect") and §5.9's visual-feedback bullet (highlight, error badge, formula-driven indicator) are
different clauses; the second is drawing, needs a `ctx` and the transform reset, and its three items
share one implementation shape. Splitting one of three off into a state-machine file would have put
a canvas dependency into the only `render/` file that can be tested without one, for a third of a
feature. The deferral is correct as reasoned.

Two consequences I am ruling rather than leaving to be re-argued a fourth time (§5.9's feedback trio
has now been deferred by 0061, 0062 and 0066): see **D-068** below.

**Answering the implementer's reviewer question on the empty-canvas click** (Decision 3): a press on
empty canvas clearing the selection is **accepted as built**. §5.9 is silent, both readings are one
line, and the branch-free one is the smaller implementation (§13's first tiebreaker). Escape retains
a distinct job — it also kills an in-progress drag, which a press does not. No `Q-NNN`, no
`PROVISIONAL` tag: correctly judged as not load-bearing.

## 6. Ruling issued at this review

**D-068** — recorded in `DECISIONS.md`: §5.9's visual-feedback trio lands in ONE cycle, in the
renderer, and `render/interaction.ts` is not its home. Full text there.

## 7. Legibility audit

Headers present, layer and allowed imports stated, brief sections cited throughout. Vocabulary
locked — "object", "slot", "literal", "formula", "derived", "address", "mutation", "journal",
"preset"; no "property", no "field" for slot, no "node" for object. Zero `any`. The discriminated-
union `switch` in `describeSlotDriver` carries the `const exhaustive: never` idiom. Test names are
behaviour sentences naming the clause they defend. D-060/D-063 clean: no diary comments, no "this
cycle" anywhere in either new file (grepped), every header sentence present-tense.

**D-065 discharged, and unusually well.** The sweep found five falsified cross-file claims and fixed
all five, and the log discloses which half of two of them was inherited debt from entry 0063 rather
than claiming credit for it. The `main.ts` rewrite is the best of the five: it converts an inventory
of what `render/` holds (a sentence with a one-cycle shelf life, exactly D-065's preventive half)
into a statement about `main.ts` itself. Dropping the `0062-REVIEW edit 3` citation from a claim it
was reversing is also right — a citation attached to an inverted claim misattributes the reversal to
the entry that made the original.

**Header budget.** 64 lines at the implementer's hand-off, against §5.2's 20-40 for an ordinary file;
76 after my four edits. **I am billing myself for that, not the implementer:** the file arrived at 64
after a disclosed trim pass, my edits took it to 79, and I then tightened my own two additions back
to 76 rather than leaving them at full length. What is there is §5.2's keep-always material (two
hazards with owners, four deferrals each naming an owner, five invariants, two rejected
alternatives). For context: `camera.ts` 42, `hittest.ts` 62, `renderer.ts` 78, `mutation.ts` 151.
Entry 0065's recommendation to the human — raise the ordinary budget to ~60-70 — stands, and this
file is now one line-count above that range because of a reviewer edit, which is a data point in its
favour rather than against it.

## 8. Honesty audit

The log matches the diff. I re-ran everything rather than reading the pasted output:

```
$ npx tsc --noEmit                              -> exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json      -> exit 0, no output
$ npx vitest run                                -> 20 files, 775 passed (775), 0 skipped
```

775 confirmed (753 + 22), 20 files, `interaction.test.ts` contributing 22. No `.only`, no `.skip`,
no `todo` in `src/`. Batch accounting (cycle 1/3, ~742 lines, 6 files) is accurate — I measured 741.
No scope expansion: the four comment-only edits outside the new files are each disclosed, each is
D-065 work, and none touches logic.

Two things to credit specifically, both the honest move rather than the flattering one. **The log
flags its own contradiction of a carry-in from my previous review** (Decision 1 vs. 0064-REVIEW §10
item 4) and offers to take a `REVISE` on it, instead of quietly not needing the context fake and
saying nothing. And **the "Where I got stuck" section reports two wrong test expectations in
detail**, including the one where the code was right and the expectation was wrong — the more
embarrassing of the two, and the one a less honest log omits because the tests pass now either way.
The D-018 lesson from the first (an object with a schema-forbidden slot shape cannot go through
`mutate` at all; fixture it on `polyline`, D-017's exception) is now a STATUS gotcha, which is where
it earns its keep.

One small inaccuracy, stated as an observation: the log says `interaction.ts` is 345 lines; it is
344. The trim pass described two paragraphs later is what accounts for it. Nothing turns on it.

**Post-edit verification, re-run:**

```
$ npx tsc --noEmit                              -> exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json      -> exit 0, no output
$ npx vitest run                                -> 20 files, 776 passed (776), 0 skipped
```

## 9. Open questions

- **Q-012** (world vs screen for stroke width / cell size / font size) — OPEN, deferred, untouched.
  `interaction.ts` takes no side: its only screen-space constant is `hittest.ts`'s hit tolerance,
  which §5.9 denominates in pixels outright. Still due with the `style`-slots cycle.
- **Q-008** (`-0` as legal document state) — OPEN, deferred, untouched. Worth one line because this
  cycle could have reopened it and does not: a drag's `slot.value + delta` cannot produce `-0`,
  because the zero-delta guard returns before any component whose delta is `±0`, and `mutate`
  already refuses a stored `-0` operand.
- **Q-001 / Q-002** — ANSWERED (D-041, D-040) and now due at `command/parser.ts`, one slice away.
  D-040 is additionally load-bearing for THIS file, per §3.
- No new questions raised by entry 0066, and none needed. Next free: **Q-013**.

## 10. Where Phase 3 stands, and the next slice

`render/` is complete for Phase 3: camera, renderer, hit-testing, interaction. **`command/parser.ts`
is the next slice** — it fires §6.1 trigger 2 in its own right, and D-040/D-041 come due there.
Then `main.ts`, which is the only thing standing between the tree and the Phase 3 gate.

Four things those cycles carry in from here.

1. **D-062's clamp is `main.ts`'s, and it is now owed by three consumers**, not two:
   `renderDocument`, `hitTest`, and `pointerDown`/`pointerMove` must be handed the SAME clamped
   camera. Hand two of them different cameras and the picture, the click and the drag land in
   different coordinate systems with nothing logged.
2. **`main.ts` must reset the canvas transform** before drawing anything screen-space after
   `renderDocument` — `interaction.ts` does not do it, because it draws nothing (D-068).
3. **The table-creation command owes `TABLE_SCHEMA` an `origin.x`/`origin.y` pair**, at the paths
   `renderer.ts`, `hittest.ts` and `interaction.ts` already read. Until it lands, every table
   reports itself undraggable — correctly, and for a reason unrelated to §5.9's per-vertex clause.
4. **`command/parser.ts` is the first consumer of `parseFormula` from a user surface** (D-038's
   four conditions: validate on commit not per keystroke, carry the offending name and position,
   keep `FUNCTION_REGISTRY` enumerable, never discard rejected source text). Read D-038 before
   writing it.

Phase 3's criterion is correctly NOT claimed.

## 11. Fix list (none blocking)

1. **`sides`/`rows`/`cols` have no upper bound** — carried from 0060/0062/0064-REVIEW. Unchanged
   stance: one ruling covers all three or none does.
2. **An end-to-end test through a table-creation command** when one lands — carried from
   0062-REVIEW. Now owed by three files (`renderer`, `hittest`, `interaction`), all of which pin
   their table paths against fixtures rather than commands.
3. **The thirteen bare "this cycle" sites in test files** and the two stale "does not exist yet"
   claims in `primitives/schema.test.ts` — carried, still blocking nothing.
4. **`render/slots.ts` at the THIRD consumer** of `readNumber`/`asPointArray` — still at two.
   Entry 0066 Decision 7 is correct that it is not the third: it needs slot KIND, which those two
   deliberately discard (0062-REVIEW §2). Trigger unfired.
5. **`.gitattributes`** — carried.

## 12. Verdict

**ACCEPT WITH EDITS.** `render/interaction.ts` is the right shape for a subsystem's first file: a
pure state machine with four transitions, no `ctx`, arguments narrow enough that the whole file is
testable without a canvas fake, and a plan/notice split that makes §5.9's per-component rule the
visible centre of the file rather than a branch buried in a handler. It gets the two clauses most
likely to be normalised away exactly right — per-component dragging, and a rejection that does not
advance the drag — and it obeys D-040's "dragging is NOT covered" bound without having been pointed
at it.

No behavioural defect found across five probes. Four edits: one hazard note completed, two rulings
cited, one untested "deliberate" given a test, one near-tautological assertion strengthened. One
ruling issued (**D-068**), one prior review expectation of mine withdrawn as wrong (0064-REVIEW §10
item 4), one implementer question answered (empty-canvas click, accepted as built).

Phase 3 continues; `command/parser.ts` is open for the next cycle.
