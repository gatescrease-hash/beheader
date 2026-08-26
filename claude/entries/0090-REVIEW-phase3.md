# 0090 — REVIEW (phase 3)
Date: 2026-08-26   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0089-main-wiring   Reviewing: entry 0089 (`main.ts` rewritten from the stub;
`clampCamera`/`clampZoom`/`IDENTITY_ZOOM` in `render/camera.ts`; `documentExtent` in
`render/hittest.ts`; `index.html`).
Trigger: **§6.1 item 1 — a phase acceptance criterion is claimed.** Also §6.3 (over the cap in one
cycle), self-reported.

Diff reviewed: `4087a9e` — re-measured over `src/` plus `index.html`: **7 files, 1,438 added / 55
deleted.** The entry's "~1438 changed lines / 7 files" is exact.

Verdict: **ACCEPT WITH EDITS.** Four findings, all four fixed here. Four rulings — **D-084**
(the gate), **D-085** (space-drag), **D-086** (canvas backing size), **D-087** (degenerate vs flat
extent). No fix-list item added; one closed.

The headline is uncomfortable and worth stating plainly. **Every one of this review's four findings
is in the half of `main.ts` no test reaches**, and every one of them would have been visible within
ten seconds of a human clicking on the canvas: the canvas's backing store never matched its CSS
size, so *every click landed somewhere other than where the picture showed it*; the space-drag pan
could not fire at all; and `save` is dropped by some browsers. The pure half — 35 tests, five seeded
mutants — came through the audit without a single correctness finding. The split entry 0089 chose
was the right call and it paid; what it also did was concentrate all the remaining risk in one
place, and that place is now measured rather than merely flagged. **D-084** is the ruling that
follows.

## 1. Rule audit

- **Rule 1 (no DOM in `engine/`)** — upheld, checked mechanically. `grep -rn "document\.|window\.|canvas"`
  over `src/engine/**` non-test files returns eleven hits, all of them the project's own `Document`
  parameter named `document`, plus one comment about the angles a canvas actually has. No `render/`
  import anywhere in `engine/`. `main.ts` is where the DOM starts, which is §4's own arrangement.
- **Rule 2 (mutation-only state change)** — upheld, and this was the finding I expected to have and
  did not. `main.ts` writes exactly two document fields directly: `camera` (D-027 clause 2 and
  D-075 clause 5 both put it outside `mutate`, and `withCamera` is its one site), and
  `{ objects, journal }` in `pointerMoveTo` — which are precisely and only the two fields `mutate`
  returns, handed straight out of `interaction.ts`. Nothing is reconstructed and nothing is dropped:
  `nextObjectId`, `formatVersion` and `camera` ride the spread because no mutation touches them.
  The dangerous shape (a caller rebuilding a document from parts) is here, but it is exact.
- **Rule 3 (addressing)** — not touched. `main.ts` resolves no name and re-derives no identity
  (D-082 clause 4); `select` uses the ID it was handed, and there is no lookup by name in the file.
- **Rule 4 (one formula engine)** — not touched.
- **Rule 5 (dumbest correct implementation)** — upheld, and one of my edits spends against it
  deliberately: the canvas size is now re-read once per paint (a layout read per frame). D-086
  states why that is not a trade this project declines.
- **Rule 6 (slot set fixed during evaluation)** — not touched.
- **Rule 7 (nothing from §8)** — upheld. No grouping, no undo UI, no drag-through-to-source, no
  second viewport. The drag remains §5.9's per-component rule.

## 2. Invariant audit

Untouched by this diff, one line: slot set fixed during evaluation; derived slots inside the
topological pass; dependency extraction eager and total; evaluation lazy; rejection leaves prior
state bit-for-bit unchanged; no dangling edges. All of them live below the seam this cycle wired and
none of the wiring reaches them.

Two that this cycle *does* own, both checked:

- **Graph state plain and serializable.** `AppState` holds a `Document`, an `InteractionState`, a
  `PendingCommand | undefined` and a `readonly string[]`. No closures, no class instances, no live
  `Map`s. The one function-valued thing in the file — `openDocument`'s two callbacks — is a
  parameter, never stored.
- **The camera in `AppState` is always inside `[MIN_ZOOM, MAX_ZOOM]`.** New this cycle, and it holds:
  `initialAppState` clamps, and every other write is `withCamera` fed by a `camera.ts` producer. All
  five call sites traced. This is D-062 finally built, and it closes a hazard that had been described
  in three headers and enforced nowhere.

## 3. Spec conformance

- **§5.9's gestures.** Click-to-select ✓, drag-to-move through `mutate` ✓, escape-to-deselect ✓,
  wheel zoom-to-cursor ✓ (the world point under the cursor is pinned by a test), middle-drag pan ✓,
  **space-drag pan ✗ — F3, fixed here.** Per-component drag feedback reaches the log, which is
  "non-blocking feedback" in the only surface that currently exists; the on-canvas half is D-068's.
- **§5.10's command line.** Persistent input bar at the bottom ✓, scrolling log above it ✓, minimal
  chrome ✓ (`index.html` is a canvas, a div and an input; no panels, no toolbars). "Always focused
  when the user is not editing text or a cell" ✓ — focused at startup and re-focused after a canvas
  press. That last one is what collided with space-drag; **D-085** settles the collision rather than
  letting one clause quietly win.
- **§5.11's save/load.** Save via JSON download ✓ (**F4** — the mechanism was fragile, fixed here);
  load via file input ✓; no file manager ✓. A refused file reports and changes nothing ✓.
- **§5.10's `fit` and `zoom`.** Both performed here per D-075 clause 3. `zoom` about the viewport
  centre is a judgement the brief is silent on and entry 0089's reasoning is right — a typed factor
  has no cursor. `fit` had **F2**.
- **The over-specified part most likely to be normalised away**, checked deliberately: §5.9's
  "dragging calls the mutation API — it never writes object state directly." It does. Even the
  refusal path leaves `lastWorldPoint` un-advanced so a refused delta folds into the next move
  instead of being dropped. That is more careful than the brief asked for.

## 4. Findings

### F1 — the canvas's backing size never matched its CSS size, so every click landed off the picture. FIXED here

`start` sized the backing store once, in `resize()`, *before* `apply(state)` drew the first log line.
The log is a flex sibling that grows with every echoed line up to its `max-height: 9em`, so the
canvas's CSS height shrinks — with no `window` `resize` event behind it, because the window did not
resize. From the first frame onward `canvas.height !== canvas.clientHeight`.

Why that is a correctness bug and not a cosmetic one: the browser scales the backing store to fill
the CSS box, so the *picture* stays plausible. But `screenPointOf` reports CSS pixels off
`getBoundingClientRect`, and `hitTest`, `renderDocument` and `viewport()` all consume backing pixels,
and nothing between them converts. Click at CSS y=250 in a 500px-tall box backed by a 600px store,
and the hit test asks about the world point under screen y=250 while the picture drew it at 300.
Clicks miss, drags slip by the ratio, and `fit` fits to the wrong viewport. The symptom looks exactly
like a hit-testing bug, and `hittest.ts` — which is correct — is where the next reader would have
gone.

Fixed by folding the size sync into `paint()` itself, so it happens before every draw rather than on
one event; `resize` now just calls `paint`, and the separate `resize()` helper is gone. **D-086**
states the invariant this buys ("one backing pixel is one CSS pixel") and binds a future
device-pixel-ratio cycle to introduce the conversion at `screenPointOf` in the same change.

### F2 — `fit` called a 200×0 rect "a single point" and refused to fit it. FIXED here

`fitToDocument`'s guard read `width > 0 && height > 0`. D-066's degeneracy is a *point* — both axes
zero — and entry 0089's own prose says so ("zero width AND height"), but the code fires on either
axis. `rect x=0 y=0 w=200 h=0` is legal (no creation handler bounds a rect's size), and `fit` on it
reported *"the document's extent is a single point — centred it at zoom 1"* about a rect two hundred
units wide, and did not fit.

Reproduced at review before changing anything. The arithmetic never needed the guard it was given:
dividing by a zero axis yields `Infinity`, and `Math.min` against the other axis discards it. Fixed
to `(width > 0 || height > 0)`, with a comment saying why the `Math.min` is load-bearing, and pinned
by a new test in `main.test.ts` asserting the fitted zoom is the width-derived one and that the
message does *not* say "single point". Mutation-checked: reverting the fix fails exactly that test
and nothing else, so it was genuinely uncovered. The existing zero-radius-circle test (a true point)
still passes unchanged — the two cases are now distinguished rather than conflated. **D-087**.

### F3 — §5.9's space-drag pan could not fire. FIXED here

`if (event.key === " " && event.target !== input) { spaceHeld = true; }`. The input is focused at
startup and re-focused after every canvas `pointerdown`, so `event.target` is the input for
essentially every keystroke and `spaceHeld` never became true. §5.9 names two pan gestures; one was
wired and one was dead. Middle-drag working is why §5.9's *pan* was still satisfiable, which is also
why the suite had nothing to say.

The guard's intent was right — a space typed mid-command must not yank the canvas — but the test was
structural where it needed to be about state. Fixed to arm on a space while `input.value === ""`,
consuming the keystroke. An empty input is the exact state in which a space means nothing as text.
**D-085** also forbids `target !== input` as a guard for any future global key, for the same reason.

### F4 — `save` is dropped by some browsers. FIXED here

`downloadDocument` created a detached `<a>`, clicked it, and called `URL.revokeObjectURL` in the same
tick. Both halves are known-fragile: a detached anchor's programmatic click is ignored outside
Chrome, and revoking a blob URL synchronously after `click()` can cancel the download that click just
started. In an environment with no browser and no test, this is the kind of thing that gets found by
a user losing a document. Fixed to append, click, remove, and revoke on a zero timeout.

I want to be honest about the standard of evidence, since §5 of this process is about not
overclaiming: F1, F2 and F3 I reproduced. **F4 I did not** — it needs the browser this review also
does not have. It is fixed on the strength of two well-documented failure modes, and the fix is
strictly safer than what it replaces. If both halves turn out to be unnecessary in every browser the
human uses, the cost was six lines.

## 5. Legibility audit

Headers present on all three changed source files; vocabulary locked throughout (I grepped the diff
for `property`, `field`, `node` and `computed` used as synonyms — clean); no `any` anywhere; tests
named as behaviour sentences, including the long D-references, which is this file's established
style.

One header claim corrected, under **D-065**'s own rule that a comment is yours once you falsify it:
`main.ts`'s LAYER line said "the one file no test reaches", which entry 0089 falsified by writing
`main.test.ts`. The entry noticed three such falsifications in *other* files and corrected them all,
then left the one in the file it was writing. It now reads in the present tense, citing D-065 and
naming D-082 as where the false claim came from.

Otherwise this is the most legible file the project has produced. The `NOTE ON ONE NAME` comment
about the global `document` versus `state.document` is exactly D-060's "good" tier, and the four
`NOT DONE HERE` items each name the decision that owns the missing work rather than describing it.

## 6. Honesty audit

Re-ran everything rather than reading it. `npx tsc --noEmit` and `-p tsconfig.engine.json`: both
clean. `npx vitest run`: **1125 passed, 25 files, 0 skipped**, matching the entry's paste exactly.
`npm run build` succeeds. Diff numbers exact. No `.only` anywhere.

Spot-checked the mutation table by re-seeding one of the five faults myself (`fit`'s degenerate guard
always true): one test killed, as claimed. The table is real.

The log matches the diff with one discrepancy, and it is the one that produced **F2**: the entry
describes the degenerate guard as "zero width AND height" while the code it shipped tests either
axis. That is a description *more* correct than the code — the implementer wrote down the right rule
and then wrote a different one — which is the opposite of the failure mode this audit usually hunts.
Recorded, not held against the entry.

No silent scope expansion: the two `render/` additions are each argued from something `main.ts` could
not be written without, and `documentExtent` landing in `hittest.ts` rather than a new file is D-066
applied correctly. Nothing on the fix list was quietly picked up, and item 5 was answered by
declining to act and saying so — the right shape for a message-policy question.

The entry's "Where I got stuck" section is the strongest one this log has had. It names the untested
`start`, names the load exposure it made reachable, names the unmeasured repaint, and names the `fit`
margin as a number nobody measured. Three of my four findings are inside the region it flagged as
unassertable. It did not know which lines were wrong; it knew exactly where they would be.

## 7. Open questions

- **Q-012** (world vs screen units for stroke width and cell size) — **deferred, reasoned.** Still
  correctly blocked on the `style`-slots cycle, and this cycle did not narrow it. The pan *gesture*
  landing without the pan *command* is the right split: the gesture needs no argument grammar.
- **Q-008** (`-0` in `graph/node.ts`) — deferred, blocking nothing, unchanged.
- No new questions raised, and none should have been.

## 8. Edits made

All in `src/main.ts` unless noted.

1. `paint()` re-reads the canvas's backing size before drawing; the `resize()` helper is deleted and
   `window`'s `resize` listener now calls `paint` (F1, D-086).
2. `fitToDocument`'s `fits` guard is `(width > 0 || height > 0)`, with the comment explaining why
   `Math.min` handles the flat axis (F2, D-087).
3. The space key arms the pan gesture on an empty input and is consumed (F3, D-085).
4. `downloadDocument` appends the anchor, clicks, removes it, and revokes on a timeout (F4).
5. The file header's LAYER line no longer claims no test reaches this file (D-065).
6. `src/main.test.ts`: one new test, "fits a FLAT extent to its one real axis instead of calling it a
   point", mutation-checked against the reverted fix.

Nothing else was touched. `camera.ts` and `hittest.ts` are accepted as written — `clampCamera`, the
`clampZoom` signature change and `documentExtent` are all argued correctly and tested, and I have no
edits to make to either.

**After edits: `tsc` clean on both configs, `vitest run` 1126 passed / 0 skipped / 25 files.**

## 9. Fix list

Numbering restarts here. One item closed by ruling; nothing added.

1. **§5.11's loader validates a loaded formula's AST depth once, at the boundary** (**D-083** clause
   4), together with **D-081**'s `createObject` name gate. Owned by `document.ts`'s cycle.
   **User-reachable since entry 0089 wired the Load button** — the severity changed, the ownership
   did not.
2. **Give the missing-slot refusal a remedy** — "references a slot that does not exist" tells the
   operator nothing to do. Message only; **D-047** clause 4 does not move.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE** — a refused 1,000-term
   formula repeats the same sentence a thousand times. `mutation.ts`; owned by the cycle that opens
   that function.
4. **`zoom`'s refusal names `Infinity` rather than what was typed.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged, none blocking:** (1) D-074's refused prompt
   answer · (2) the usage line for the form a prompting command was used in · (3) what a quoted
   command WORD means · (4) disclose 0074-REVIEW F4's two message changes and test (a) · (5)
   `set = x`'s self-contradictory message · (6) `parser.ts`'s header restating D-069 · the twelve
   bare "this cycle" sites in test files · `render/slots.ts` at the THIRD consumer of
   `readNumber`/`asPointArray` · `.gitattributes`.

**CLOSED — the old item 5, a single command echoing a ~200 KB line.** Entry 0089 declined to act and
asked for a ruling. Ruling: **it stays as it is, and it is not a defect.** The log is the operator's
transcript of what they typed; a 200 KB line is a line the operator typed. An ellipsis policy would
make this the first silently shortened message in a codebase whose entire debugging story is that
every message names exactly what it is talking about. Reopen it only if a real session becomes
unusable, in which case the fix belongs to the log element, not to the message.

## 10. Where Phase 3 stands, and the next slice

**The criterion is accepted as engineering and the gate is NOT closed.** See **D-084** for the full
ruling; in one line: `main.test.ts` demonstrates the criterion as strongly as a test can, and this
review has just demonstrated that a green suite over the testable half does not cover a criterion
written in the operator's verbs. A human runs it once, writes down what they saw, and the gate
closes. No implementer cycle may claim that step.

**Next slice: D-068's visual-feedback trio** — selection highlight, error badge, formula-driven
indicator, together, in `renderer.ts`, with `renderDocument` widened to carry the selection, and that
cycle owning the transform reset before screen-space chrome. Two reasons it goes first rather than
the `document.ts` load boundary: it is inside Phase 3, and it is the one remaining piece that changes
what the manual check will show. Do it first and D-084's check is worth performing once.

The `document.ts` cycle (D-081 + D-083 clause 4, fix-list item 1) is the slice after. It is
load-bearing under §6.2, so it needed this review landed first — which it now is.

## 11. Verdict

**ACCEPT WITH EDITS.**

Four findings, all fixed here, all four in the untested DOM half — which is the result, not an aside.
Four rulings: **D-084** (the Phase 3 gate needs one human run), **D-085** (space-drag arms on an empty
input bar), **D-086** (one backing pixel is one CSS pixel, re-read per paint), **D-087** (a degenerate
extent is a point; a flat one is fitted). Fix list: one item closed, none added.

Entry 0089 is the best cycle in this log. It split a file specifically so the rules inside it could be
tested, tested them thirty-five ways, mutation-checked a suite that passed first try, and then wrote
down precisely where its own blind spot was — and the blind spot is where all four findings turned out
to live. That is what an honest log is *for*: it did not prevent the bugs, it pointed the reviewer
straight at them.
