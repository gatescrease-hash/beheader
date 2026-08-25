# 0066 — render/interaction.ts (selection and per-component drag)
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (implementer)
Previous entry: 0065-AUDIT-header-budget   Last review: 0064-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~742 lines / 6 files changed so far.

## Declared scope

`render/interaction.ts` — §5.9's interaction clause as a pure state machine: click to select, drag
to move (through `mutate`, per component), escape to deselect. Its test file, and the D-065 comment
corrections my own work forced.

## Explicitly not in scope

- **Any drawing.** §5.9's visual-feedback trio (selection highlight, error badge, formula-driven
  slot indicator) stays unbuilt. All three are draw-time work over a `ctx` this file never receives,
  and they need one cycle together — see "Decisions I made" 1.
- **DOM event listeners and `main.ts` wiring.** This file takes plain screen points; `main.ts`
  listens. That also means **D-062's zoom clamp is still owed** and still belongs at `main.ts`'s
  boundary.
- **§5.9's per-vertex drag path** for objects with no `origin` slot — nothing can have per-vertex
  slots yet. See "Decisions I made" 2.
- **Pan/zoom gesture binding**, `command/*`, the `TABLE_SCHEMA` `origin.x`/`origin.y` entry, and
  every carried known problem in `STATUS.md`.

## What I did

### `src/render/interaction.ts` (new, 345 lines) — §5.9

Four exported transitions over a plain `InteractionState` (`selectedObjectId`, `drag`), each
returning new state rather than mutating it:

- **`pointerDown(screenPoint, objects, camera)`** — §5.9's "click to select". Calls `hitTest`,
  selects the result, and arms a `DragState` holding the object's **id** and the world point pressed
  at. Takes no prior state: what is under the pointer decides the whole interaction state.
- **`pointerMove(state, screenPoint, objects, journal, camera)`** — the drag. Converts to world
  space via `camera.ts`'s `screenToWorld`, takes the delta since the last committed step, plans one
  `setSlot` per movable component, and calls `mutate`. Returns the new state, the objects/journal to
  hold from here, `notices` (§5.9's non-blocking feedback), and `rejection`.
- **`pointerUp(state)`** — ends the drag, keeps the selection.
- **`deselect()`** — §5.9's "escape to deselect": clears selection *and* any drag in progress, so a
  half-finished gesture cannot survive the key.

**§5.9's per-component rule is the substance of the file.** `planComponent` writes a component only
when its slot is `literal` *and* holds a number; a `formula` or `derived` component produces a
notice instead, and `describeSlotDriver` builds §5.9's own example message ("x is driven by
`table_x.A1`") from `formula/deps.ts`'s `extractDependencies`. Because that extraction is eager and
total (§5.3), the notice names every slot a branching formula *could* read — which is the honest
answer to "what drives this", and is stated as such in the function's doc comment rather than left
to look like a bug.

Rule 2 is upheld structurally: the file has no assignment to any slot anywhere. `mutate` is the only
write.

### `src/render/interaction.test.ts` (new, 362 lines) — 22 tests

Fixtures are built through the real `mutate()` wherever a current schema can produce the object, so
a drag is proved end to end — operation, commit, and the derived-slot re-evaluation that follows.
The drag test asserts `vertices` and `centroid.x` moved with `origin`, which is the payoff of going
through the mutation channel instead of writing the slot.

Tests worth naming because they discriminate rather than merely pass:

- *"slides in Y only when origin.x is driven, and the notice names what drives it"* — a real
  `table_x` with `A1 = 10`, a real `rect` whose `origin.x` is a formula reading it, both committed in
  one batch. X stays at the cell's value, Y moves, and the notice contains `table_x.A1`.
- *"does nothing at all when EVERY component is driven, and reports both"* — asserts `objects` and
  `journal` come back by **identity** (`toBe`), so "did nothing" means no mutation happened at all,
  not a mutation that changed nothing.
- *"converts the screen delta into world units at the current zoom"* — a 20x20 screen delta at
  zoom 2 must move the rect by 10, not 20. A missing conversion fails it.
- *"keeps moving the right object across steps, because the drag holds an id and not a stale
  snapshot"* — two chained moves of +3 then +4 land on 7. A held `GraphObject` would land on 4.
- *"a rejected mutation returns the caller's own objects, journal and state, and the pending delta
  survives to the next move"* — the second half is the discriminating half: because
  `lastWorldPoint` never advanced, the retry's Y delta is still the full 7. Had the drag advanced
  through the rejection, Y would stay at 0.
- *"writes only the component that actually changed"* — one operation in the journal entry, not two.

### Comment corrections — D-065 (`main.ts`, `camera.ts`, `hittest.ts`, `renderer.ts`)

I grepped the tree for `interaction` before writing this entry, per D-065, and found five comments
my own work falsified. All five are cross-file claims of the kind D-065 assigns to whoever falsifies
them, not drive-by refactors:

1. `camera.ts` — "Reading the mouse/wheel, or any DOM event handling — **a future**
   `render/interaction.ts`." Doubly false now: the file exists, and it does **not** read a mouse.
   Retargeted to `main.ts`, which is what actually listens.
2. `hittest.ts` — "Selection state, **event handling**, and calling any mutation —
   `render/interaction.ts`'s job." Two of three are now true and built; event handling is `main.ts`'s.
   Split accordingly.
3. `renderer.ts` (HAZARD) — the camera-transform reset "**Lands on `render/interaction.ts`**
   (0062-REVIEW edit 3)." It does not: this file draws nothing. Reassigned to whichever cycle first
   draws screen-space chrome. **I dropped the `0062-REVIEW edit 3` citation** rather than carry it
   onto a claim I am reversing — the chronology belongs here, in the log, not on the corrected line.
4. `renderer.ts` (NOT DONE HERE) — the visual trio "Deferred to `render/interaction.ts`, with
   **hit-testing** and all event handling." Rewritten to say the trio is built nowhere, that
   `interaction.ts` holds the selection state but draws nothing, and that hit-testing is
   `hittest.ts`'s. **Disclosure:** the hit-testing half of that sentence was falsified by entry 0063,
   not by me. I corrected it because it sits inside the sentence my own work forced me to rewrite;
   correcting half a sentence and leaving the other half false would be worse. Flagging it rather
   than letting it pass as mine.
5. `main.ts` — its inventory of what `render/` holds omitted both `hittest.ts` (0063's debt, same
   situation as 4) and `interaction.ts` (mine). Rewritten as "nothing is wired here yet", which is a
   statement about `main.ts` itself and cannot expire the same way.

I also added one line to `interaction.ts`'s own NOT DONE HERE for §5.4's formula bar / in-place cell
editing, because `renderer.ts` points here for it. That makes an existing pointer true by naming the
gap on this side, which is cheaper than retargeting the pointer.

## Decisions I made

**1. This file draws nothing.** §5.9's visual-feedback trio is deferred whole rather than done a
third at a time. Reasons, in order: an error badge needs an `ErrorValue` scan and a formula-driven
indicator needs a slot-kind scan, so all three are draw-time passes over the same object list;
`renderer.ts` already owns drawing and would be the natural home; and mixing a `ctx` into a pure
state machine costs this file its "no canvas fake needed" testability for no gain today. **This
contradicts 0064-REVIEW §10 item 4's expectation** that this cycle would need `renderer.test.ts`'s
context fake. It did not, because it draws nothing. Flagging that directly rather than letting the
carry-in quietly lapse — if the reviewer wants the highlight in this file, that is a `REVISE` I will
take.

**2. Per-vertex dragging is deferred, on D-067's shape.** §5.9's editable-path clause is conditioned
on an object with per-vertex slots and no `origin`; `polyline` has no schema entry and `explode` is
unbuilt, so no such object can exist. D-067 ruled exactly this shape of deferral correct (a clause
conditioned on its own subject). Rather than silently ignoring the gesture, such an object gets a
notice naming itself. A `table` gets that same notice today for a *different* reason — no
`origin.x`/`origin.y` in `TABLE_SCHEMA` (entry 0061) — which is stated in the header so the two do
not get confused.

**3. A press on empty canvas clears the selection.** §5.9 names "click to select" and "escape to
deselect" and does not say what an empty-canvas click does. I read the selection off the hit result,
`undefined` included, which is the branch-free reading and the smaller implementation. Escape still
has its own job (it also kills an in-progress drag, which a press does not). Reversible in one line;
raised as a reviewer question below rather than as a `Q-NNN`, since nothing structural turns on it.

**4. A rejected drag step does not advance `lastWorldPoint`.** The accumulated delta is retried on
the next move instead of being silently dropped. The alternative (advance regardless) loses distance
on every rejection, which would look like a drag that lags the cursor with nothing logged.

**5. No zero-delta writes, and `mutate` is never called with an empty batch.** A component whose
delta is exactly zero produces no operation. `mutate` rejects an empty batch outright, so the
all-components-driven case must not call it at all — which is also the correct behaviour on its own
terms (§5.9: "Only when every component is driven does the drag do nothing").

**6. No legality pre-check before `mutate`.** A drag that would push a coordinate to `Infinity` is
refused by `mutate` (D-025), not by an arithmetic guard here. Re-deciding value legality in `render/`
would be a second source of truth for D-025/D-027. The rejection path is tested.

**7. I am not the third consumer of `readNumber`/`asPointArray`,** so 0064-REVIEW §5's
`render/slots.ts` trigger has **not** fired. This file needs slot **kind**, which those two helpers
deliberately ignore (0062-REVIEW §2: "reading a value to DRAW is not the same as reading one to size
the SLOT SET" — the same distinction from the other side). It reads `getSlot` directly. Stated so
the trigger's count stays honest.

## Verification (real output)

```
$ npx tsc --noEmit
(exit 0, no output)

$ npx tsc --noEmit -p tsconfig.engine.json
(exit 0, no output)

$ npx vitest run
 ✓ src/engine/graph/node.test.ts (27 tests)
 ✓ src/engine/formula/ast.test.ts (14 tests)
 ✓ src/engine/formula/lexer.test.ts (36 tests)
 ✓ src/engine/primitives/table.test.ts (69 tests)
 ✓ src/engine/address.test.ts (70 tests)
 ✓ src/engine/graph/cycles.test.ts (11 tests)
 ✓ src/engine/formula/parser.test.ts (55 tests)
 ✓ src/engine/formula/deps.test.ts (35 tests)
 ✓ src/engine/primitives/schema.test.ts (31 tests)
 ✓ src/engine/formula/eval.test.ts (53 tests)
 ✓ src/engine/formula/functions.test.ts (46 tests)
 ✓ src/engine/document.test.ts (26 tests)
 ✓ src/render/camera.test.ts (17 tests)
 ✓ src/engine/primitives/geometry.test.ts (45 tests)
 ✓ src/engine/graph/eval.test.ts (18 tests)
 ✓ src/render/hittest.test.ts (17 tests)
 ✓ src/render/renderer.test.ts (18 tests)
 ✓ src/render/interaction.test.ts (22 tests)
 ✓ src/engine/mutation.test.ts (159 tests)
 ✓ src/engine/graph/edge.test.ts (6 tests)

 Test Files  20 passed (20)
      Tests  775 passed (775)
```

753 before, 775 after — the 22 new tests, nothing else changed. Zero skipped, zero `.only`
(grepped).

## Acceptance criteria status

Phase 3 criterion: *"you can create a polygon and a table by command, see both drawn, pan/zoom,
select, and drag the polygon."* — **NOT YET, and not claimed.** Select and drag now exist and are
tested (`interaction.test.ts`), and pan/zoom exists in `camera.ts`. What is missing is unchanged
from entry 0065: there is no `command/` to create anything with and no `main.ts` wiring, so none of
it is reachable from a screen. Two slices remain (`command/*`, then `main.ts`).

## Where I got stuck / what is unfinished

- **Two of my own test expectations were wrong on the first run**, both arithmetic rather than code
  defects, and both are worth recording because the second one nearly hid a real property.
  (a) The derived-component fixture put a `derived` slot at `rect`'s schema-declared *non-derived*
  `origin.x`, so D-018's kind-mismatch check rejected the whole mutation and `origin.y` never moved.
  Rebuilt on `polyline`, which has no schema entry at all — D-017's one permitted exception, and the
  only type that can legally carry that shape today. (b) The rejection-retry test expected
  `origin.x` to return to `0` after the retry. It does not: `lastWorldPoint` never advanced, so the
  retry's X delta is genuinely zero and X keeps the value the rejected step failed to change. My
  expectation was the wrong one; the code was right. Corrected the assertion and the comment
  explaining why it discriminates.
- **The file header is 64 lines** against §5.2's 20-40 for an ordinary file. I checked what the
  excess is doing, per §5.2, and cut what I could (two bullets merged, one invariant tightened) —
  it went 65 → 64, because what remains is §5.2's own keep-always list: two hazards with owners,
  four deferrals each naming who owns them, five invariants, one rejected alternative. For context,
  `camera.ts` is 42, `hittest.ts` 62, `renderer.ts` 78. This sits inside entry 0065's recommended
  ~60-70 range and outside the currently binding one; I am reporting rather than pretending.
- **`escape`/`deselect` is untested against a real key**, because no key handling exists. The
  transition is tested; the binding is `main.ts`'s and does not exist.
- **No end-to-end test through a *command*** — same carried gap 0062/0064-REVIEW record for the
  renderer's and hit test's table paths. My fixtures go through `mutate()`, which is as far as this
  slice can reach.
- **A drag fires one mutation per pointer move, each deep-cloning the document** (§5.9's drag
  performance note). Untouched deliberately: Rule 5, and the brief says throttle only if it is
  visibly laggy — which cannot be observed until `main.ts` exists.

## Open questions raised

None. No `PROVISIONAL` tag added; the reversible calls above are disclosed here and as reviewer
questions rather than as `Q-NNN`, since none of them shapes the data model, addressing, or the
mutation sequence. Next free is still **Q-013**.

## Review point

**Fired: §6.1 trigger 2** — the first file of the interaction subsystem. `render/interaction.ts` has
no prior reviewed code to extend, and the design choices baked into it (a pure state machine with
no `ctx`; the per-component plan/notice split; a rejection that does not advance the drag) are
exactly the expensive-to-get-wrong kind. Batch would otherwise be at cycle 1/3, ~742 lines / 6 files
(cap 800/10) — already near the line size cap on its own.
