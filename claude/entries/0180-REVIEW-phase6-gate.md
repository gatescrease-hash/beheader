# 0180 — REVIEW (Phase 6 gate): entries 0178/0179 audited, the human has SEEN it. **The gate is CLOSED. Phase 7 is OPEN.**
Date: 2026-09-07   Phase: 6 → 7   Model: reviewer (Opus 5)
Reviews: entries **0178** (the port commands) and **0179** (§5.8's rendering) — the diff since
0177-REVIEW — plus the human's on-screen confirmation of the whole of Phase 6.
Previous review: 0177-REVIEW-phase6-scope
Verdict: **ACCEPT WITH EDITS.** Three stale headers fixed, two of my own tests strengthened after
they failed a mutation check. **Phase 6's gate is CLOSED. Phase 7 may begin.**

## 1. The gate's two conditions, and how each was met

| Condition | Source | Status |
|---|---|---|
| The ✅ line passes | PROJECT_BRIEF §6 | **PASSING** — proved at 0171, re-proved independently with two mutation checks at 0172-REVIEW §2/§6. Not re-derived here, as that entry said it need not be. |
| The ✅ line is PERFORMABLE by an operator | **D-146** clause 1 | **PASSING** — entry 0178's typed-criterion test drives it through parsed command lines only, and the human has now walked it by hand. |
| `image` loads and renders properly | **D-142** clause 2 | **CONFIRMED BY THE HUMAN, on screen:** *"Image changes work perfectly. Steps 1-5 pass."* |
| §5.8's node renders and is usable | **D-146** clause 5 | **CONFIRMED BY THE HUMAN, on screen:** *"Script half: works in its current state. Ports link and pass results/update geometry."* |

The screenshot shows all of it in one document: `script_1` as a labelled box with `python` in its
header, `factor` against its left edge and `result` against its right; `image_1` in proportion
inside its frame; `polygon_1` driven through the script node; `table_1` upstream. **That is the
whole of Phase 6 in one picture, and it is the first time any of it has been seen.**

D-142 clause 2 made the human's own look the settling test for "renders properly", precisely
because no automated test can make that claim. It has been made.

## 2. Rule audit — entries 0178/0179

Mechanical checks, run rather than reasoned about:

- **Rule 1 (engine purity)** — `grep` over `src/engine` for `document.`/`window.`/`canvas`/
  `HTMLImage`/`CanvasRendering`, excluding comments and the engine's own `Document` fields: **0
  hits**. `grep` for any `render/` import inside `src/engine`: **0 hits**. `SCRIPT_TYPE` is a bare
  string constant beside `IMAGE_TYPE`; the box geometry lives in `render/slots.ts`, never in the
  engine.
- **Rule 2 (mutation-only state change)** — `addport`/`removeport` build `Operation[]` and call
  `mutate`, like every other handler. No `.slots[...] =` anywhere outside `mutation.ts`.
- **Rule 6 (fixed slot set)** — upheld and, notably, upheld BY CONSTRUCTION: a script node's
  dynamic families are sized by the structural `ports` field, never by an evaluated value, so
  D-046/D-097 have nothing to bind. `addport` changes the port set through the sanctioned
  `Operation`, at mutation time, never during evaluation.
- **Rule 5 (no optimisation)** — the box geometry is five constants and an integer max. Nothing
  cached, nothing measured.
- **Rules 3, 4, 7** — not touched. No addressing change, no second text evaluator.
- **D-066** — upheld structurally: `drawScript`, `drawSelectionHighlight` and `hitTestBoundingBox`
  all read `extent.ts`'s `objectExtent`. A test pins the drawn outline against that extent's own
  numbers rather than against re-computed ones.
- **No unjustified `any`** — the 7 grep hits are all the word "any" in prose.
- **Zero `.only`/`.skip`/`.todo`.**

## 3. Honesty audit, and the caveat it needs

**I wrote 0178 and 0179 myself, at the human's direction.** A self-review is weaker than an
arm's-length one and I am not going to pretend otherwise. What I did instead of trusting my own
reading: ran every check above mechanically, and ran two NEW mutation checks against claims those
entries make. **Both found real test gaps** (§4). That is the second and third time in this batch
that a D-016 check has caught a test asserting a proxy for its claim rather than the claim — the
first was 0179's own, disclosed in that entry.

Entry 0178's and 0179's logs match their diffs. Both disclose their §6.1 triggers, both name what
they left unfinished, and 0178 records that it went the wrong way on placeholder lifetime and was
caught by an existing test. Test counts re-run and confirmed: **1955 passing, 36 files.**

## 4. Findings — two of my own tests were weaker than they read

Both were green, both looked like they pinned §5.8's claims, and neither did.

1. **`drawScript`'s box height.** The test asserted that a 3-in/1-out node is two rows taller than a
   1-in/1-out node. `max(in, out)` and `in + out` give the SAME difference for those two fixtures,
   so "the longer family, never their sum" — the whole "side by side" claim — was untested.
   Neutralising `Math.max(in, out, 1)` to `Math.max(in + out, 1)` passed all 1955 tests. **Rewritten
   to pin ABSOLUTE heights**, including that one in and one out share one row, and that a portless
   node still gets a row. The mutation is now RED.
2. **(Already fixed inside 0179, restated because it is the same mistake.)** The left/right port
   claim was asserted via `ctx.textAlign`, which is a different property from the x it applies to.

**The pattern is worth naming: a test that asserts a DIFFERENCE, a FLAG, or a nearby property
instead of the value the claim is about will pass its own mutation.** Three instances in one batch.

Also fixed: **three stale file headers** still saying `script` has no visual definition
(`renderer.ts`'s NOT DONE HERE, `hittest.ts`'s, and `extent.ts`'s measuring note). §5.2 binds
headers to the present tense, and this is the same defect I raised against entries 0173-0175 at
0176-REVIEW §7 — made, one batch later, by me.

## 5. Edits made by this review

1. `render/renderer.ts`, `render/hittest.ts`, `render/extent.ts` — the three stale headers.
   `extent.ts`'s now states why a script box is fixed rather than measured, where a reader looking
   for that reason would go.
2. `render/renderer.test.ts` — the box-height test rewritten per §4.

```
$ npx tsc --noEmit                            -> 0
$ npx tsc --noEmit -p tsconfig.engine.json    -> 0
$ npx vitest run
 Test Files  36 passed (36)
      Tests  1955 passed (1955)
```

**Mutation checks run by this review**, each reverted from a file copy:

| # | Neutralised | Result |
|---|---|---|
| A | `scriptBoxHeight`'s `max(in, out, 1)` → `max(in + out, 1)` | GREEN before the §4 fix, **RED after** |
| B | `resolvePortTarget`'s `object.type !== SCRIPT_TYPE` guard disabled | RED — a `circle` may not have ports |

## 6. Spec conformance — §5.8, clause by clause

- *"Ports are ordinary slots... `in.<port>` is a normal formula slot... `out.<port>` a normal
  derived slot"* — ✓, and the criterion's `link` proves it: binding `in.factor` is an ordinary
  `link`, with no port-specific path.
- *"`source` is stored and never executed, and is not an input to any derived slot"* — ✓, unchanged
  since 0169 and re-confirmed by grep: no compute reads it.
- *"Ports are declared manually in the UI for now"* — ✓ **as of entry 0178**, and unbuilt for the
  five reports before it.
- *"Render as a labelled box with input ports on the left and output ports on the right"* — ✓ as of
  entry 0179, confirmed on screen.
- *"Build the node as a real, first-class graph citizen whose execution is fake"* — ✓. It draws, is
  selectable, draggable, nameable, hittable and inspectable by the same generic machinery every
  other object uses. **This is the sentence D-142 clause 3 misread and D-146 restored.**

## 7. Open questions

- **Q-029 — ANSWERED (D-146) and BUILT.** Nothing outstanding.
- **Q-008, Q-012, Q-016, Q-017** — untouched by this diff, unchanged, not re-litigated. Q-012's
  tags now include the script box's constants, which is the same world-units-or-pixels question and
  needs no new tag.
- **Q-030 is the next free number.**

## 8. The gate

**PHASE 6 IS CLOSED. PHASE 7 IS OPEN.**

A note for whoever opens it, because it is the same trap this phase fell into. Phase 7 reads:
*"Build by hand from primitives, **via the command line**. No new features should be needed — if
something is impossible here, that is a real gap worth fixing."* That phase states explicitly what
Phase 6 only implied, and what 0177-REVIEW had to discover the hard way: **the criterion is
something a person does, and the way to test it is to do it.** Walk the road network by hand at the
command line early, not at the end. Anything that turns out to be impossible is the phase's actual
deliverable, not an obstacle to it.

Known rough edges carried into Phase 7, none blocking (full detail in STATUS): a long port name
overflows the script box; nothing draws a wire between a bound port and its source; `removeport`
has no `force`; a port cannot be renamed.
