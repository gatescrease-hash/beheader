# STATUS — as of entry 0091-REVIEW

STATE: **GREEN.** Both configs compile, 1126/1126 tests pass, 0 skipped, 0 `.only`, `npm run build`
succeeds.

Current phase: **4 — cross-object linking, the validation moment.** **Phase 3 is PASSED and its gate
is CLOSED.** The criterion was demonstrated by executable test at entry 0089 and confirmed by a
human running the application at entry **0091** (D-084 clause 2, discharged). Nothing procedural
stands in front of Phase 4.

Last review point: **0091-REVIEW-phase3, the human's manual check.**
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).

## Read this first — the four things a cold reader needs

**1. A human has now used this application, and that is where the last four defects came from.**
Entry 0091 records the session. Two defects, both invisible to 1,126 passing tests, both in
`main.ts`'s DOM half, both found in the first two minutes: the command input lost its focus on every
canvas press (a press moves focus to the body as its DEFAULT action, which runs *after* the listener
that called `focus()`), and the canvas backing store was sized in CSS pixels, so every line was
resampled on a scaled display. Both fixed at 0091-REVIEW. **This is the second consecutive review
where every finding was in that region.** 0091-REVIEW §7 asks for D-084's mechanism — a human
session — at every phase gate from here.

**2. The human's session set the next three cycles, and raised one question only they can answer.**
Ruled and queued: **D-088** (every printable keystroke reaches the command input wherever focus is;
`ctrl`/`alt`/`meta` combinations never route), **D-089** (command history on up/down, held in
`AppState`), **D-090** (a prompt sequence that has gathered a point DRAWS it, and the geometry it
would produce, from `state.pending` and never into the document). Answered: **D-091** (the table's
grey grid against a near-black outline is deliberate and stands). **Escalated: Q-014, a properties
panel** — the human asked for one and §5.10 says "no panels, no toolbars", so it needs a brief
amendment and no model may settle it. Nothing is built against it.

**3. `main.ts` is two halves, and only one of them is tested.** `AppState` and every transition over
it (`submitLine`, `performEffect`, `pointerDownAt`, `pointerMoveTo`, `wheelZoomAt`, `panByScreen`,
`escape`, `replaceDocument`, …) are pure, take plain numbers plus a `Viewport`, and have 36 tests.
`start` — the canvas, the listeners, the log element, the file picker, the download anchor — has
**none**, because testing it needs a DOM and that needs a dependency this project will not add.
**Every finding of the last two reviews lived in `start`.** D-089 clause 1 is the standing response:
new behaviour goes in `AppState` where it can be asserted, and only the listener stays down there.

**4. `load` is wired, and that makes an unbuilt check user-reachable.** A hand-edited document whose
formula AST nests deeper than `MAX_FORMULA_AST_DEPTH` reaches `deserializeDocument` from a button and
throws a `RangeError` out of the file-read promise (**D-083** clause 4's loader check is not built;
**D-081**'s name gate is not either). Nothing this build SAVES can contain such an AST — `parser.ts`
refuses it. Owned by `document.ts`'s cycle.

**Still binding, one line: five names §5.2's grammar allows are NOT available** — `AND`, `OR`,
`NOT`, `TRUE`, `FALSE` lex as formula keywords and `checkNameAvailable` refuses them in every case
(**D-080**). Function names are safe and are NOT reserved.

## Next cycles — ordered, and the order is reasoned in 0091-REVIEW §6

1. **D-068's feedback trio + D-090's prompt preview, together, in `renderer.ts`.** Selection
   highlight, error badge, formula-driven indicator, and the marker-plus-preview for a prompt
   sequence that has gathered a point. One cycle because they need the same new capability (drawing
   something that is not an object) and the same transform reset before screen-space chrome. Between
   them they answer both halves of what the human could not see.
2. **D-088 + D-089, the command input's behaviour.** Printable-key routing and history.
3. **§5.11's load boundary** in `document.ts`: **D-083** clause 4's depth check and **D-081**'s
   `createObject` name gate (whose pinned "duplicate DOES commit" test is meant to FLIP then).

**Phase 4 should follow those three, and that is a recommendation rather than a rule** (0091-REVIEW
§6). Its criterion (c) requires "feedback that X is driven" during a drag, which is D-068's third
piece. Phase 4 is reachable today with that feedback in the log, and demonstrates far more with it
on the canvas.


## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · the whole table primitive through row/column
insert/delete and `delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit
(0058) · `primitives/geometry.ts` (0060) · `render/renderer.ts` (0062) · `render/hittest.ts` (0064) ·
entry 0065's header audit · `render/interaction.ts` (0067) · `command/parser.ts` (0069) ·
`command/prompt.ts` + D-071's formula path (0071) · entries 0072–0073's fix-list work (0074) ·
`command/commands.ts`'s seam and its four creation handlers, `document.ts`'s `mintObjectId`, and
`TABLE_SCHEMA`'s `origin.x`/`origin.y` (0078) · `commands.ts`'s four slot commands through one
`writeSlot` path, and `engine/formula/format.ts` (0080) · `commands.ts`'s `delete`, `refs` and `list`
(0082) · `mutation.ts`'s `RenameObjectOperation` + `findInvalidRenames`, and `commands.ts`'s
`rename` handler (0084) · `CommandEffect` and the five effect handlers (0086) · the two formula depth
limits (0088).

## Reviewed at 0090-REVIEW (ACCEPT WITH EDITS)

**Entry 0089 — `main.ts`, and the two render/ additions it needed.**

- **`src/main.ts`** — rewritten from the stub. The pure half (`AppState` + transitions) and the DOM
  half (`start`, the download anchor, the file picker), split so the rules are testable and the
  browser is not. 36 tests in `src/main.test.ts`. 0090-REVIEW fixed four defects: the canvas
  backing size (F1, **D-086**), `fit`'s over-broad degeneracy guard (F2, **D-087**), the unreachable
  space-drag (F3, **D-085**), and the download anchor (F4).
- **`src/render/camera.ts`** — `clampCamera` (D-062's boundary, in one function) and `clampZoom`
  exported with its signature changed to `(requestedZoom, fallbackZoom)`, because `fit` must know
  the clamped zoom before it can place a camera. `IDENTITY_ZOOM` exported. Two header claims the
  work falsified are corrected (D-065).
- **`src/render/hittest.ts`** — `documentExtent(objects)`, the box `fit` fits to, built from the same
  per-type reads the hit tests make (D-066: drawn extent and clickable extent are one extent).
  Degenerate extents are skipped exactly as they are un-hittable.
- **`index.html`** — canvas, log, input bar, minimal CSS. No behaviour.

Verified at review, re-run not re-read: `tsc` clean on both configs, 1126/1126, `npm run build` succeeds. Entry 0089's own five-mutant check
against `main.ts` (each seeded alone, reverted after) killed 1, 1, 6, 1 and 3 tests respectively.

## Not started

§5.9's visual-feedback trio (**D-068**) · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots · point-in-polygon fill hit-testing
(D-067) · §5.4's formula bar / in-place cell editing · §5.11's load-boundary validation (D-081,
D-083 clause 4) · Phases 4–7.

**Phase 4 is OPEN and is NOT claimed.** (a) data drives geometry and (b) geometry drives data are
both reachable from typed lines; (c) partial binding under drag is demonstrated end to end in
`main.test.ts` ("drags a polygon whose origin.x is a formula along Y only"), with the feedback
reaching the LOG rather than the canvas. What is missing is all three in ONE document, and (c)'s
"feedback that X is driven" wants the on-canvas half D-068 owns. Nothing procedural forbids starting
it — 0091-REVIEW §6 recommends the three queued cycles first, and that is a recommendation.

## Open fix list — **read 0090-REVIEW §9 and 0091-REVIEW §5 for the full text**

Numbering follows 0090-REVIEW §9, which restarted it, plus two added at 0091-REVIEW. Old item 5 (the
~200 KB echo) is **CLOSED by ruling** — the line stays as typed, and it is not a defect; 0090-REVIEW
§9 has the reasoning and the one condition that would reopen it.

1. **§5.11's loader validates a loaded formula's AST depth once, at the boundary** (**D-083**
   clause 4). `deps.ts` and `eval.ts` get no depth parameter. **Now user-reachable** — entry 0089
   wired the Load button (see item 4 of the cold-read section). Owned by `document.ts`'s cycle,
   together with **D-081**'s `createObject` name gate.
2. **Give the missing-slot refusal a remedy** — "references a slot that does not exist" tells the
   operator nothing to do. Message only: **D-047 clause 4 does not move**.
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
6. **A middle-drag pan started outside the canvas is untested and unthought-about.** D-088 clause
   1's `preventDefault` handles the ordinary case. Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** where its neighbour has a paragraph. **D-091**
   explains the choice and the constant should say a line of it. Owned by the `style`-slots cycle.

## Known problems (detail lives where the pointer says)

- **`main.ts`'s `start` is untested code** — every listener, the canvas sizing, the log rewrite, the
  download anchor and the file picker. Minimised, not solved. Entry 0089, "where I got stuck", and
  **0090-REVIEW found four defects there and none anywhere else.** Treat a change to that region as
  unverified until someone clicks on it.
- **A human HAS now used it** (entry 0091), and found two defects the whole suite could not. Both
  fixed. **The three fixes made at 0091-REVIEW are themselves unverified by any test** — focus
  retention, the device-pixel-ratio backing store, and backing-pixel pan deltas. Confirm them by
  eye at the next session.
- **A prompt sequence shows nothing where you clicked** — no marker for a picked point, no preview
  of the shape being built, so picking a circle's radius is a guess. Ruled **D-090**, queued with
  D-068.
- **A printable keystroke does not reach the command input unless it is focused.** The focus is no
  longer lost on a canvas press, but D-088 clauses 2–4 (routing from anywhere, excluding
  `ctrl`/`alt`/`meta`) are not built.
- **There is no command history.** Ruled **D-089**, queued.
- **A selection changes nothing on screen** (D-068), and **an error badge and the formula-driven
  indicator do not exist** either. All three are one cycle's work.
- **A hand-edited saved file can throw a `RangeError` out of the Load button** — fix-list item 1.
- **Every pointer move repaints the canvas AND rewrites the whole log's `textContent`.** The repaint
  is §5.9's accepted cost; the log rewrite is entry 0089's own and is unmeasured.
- **`fit`'s margin (`FIT_VIEWPORT_FRACTION = 0.9`) is chosen, not measured**, like every other
  untuned constant in `render/` (Rule 5).
- **`escape` is bound to the window**, so it cancels a live prompt sequence from anywhere, including
  mid-typing. Believed right (AutoCAD's behaviour); untested in use.
- **`zoom`'s echoed line names the REQUEST and `main.ts` adds a second line with the RESULT.**
  Two lines for one command, deliberately: D-082 clause 5 puts the clamped value on this side.
- **`format.ts`'s elision does not re-parse** — a disclosed exception to the round-trip property,
  reachable only through a loaded AST deeper than any parse can build.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed. The
  DEPENDENT is right, which is what §5.1.1 asks. Entry 0081, disclosed not fixed.
- **`refs <object>` derives edges twice.** Rule 5's accepted trade; 326 ms for the largest table
  D-070 allows.
- **Two sites now ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. Disclosed at entry 0081; a THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046). Fix-list
  item 2 (message only).
- **A bare reference to an EMPTY cell is REFUSED.** **0080-REVIEW F4 ruled it STANDS.** Message only.
- **`createObject` does not check the name it carries** — pinned by a test asserting a duplicate DOES
  commit, which **D-081** says must FLIP in the load cycle.
- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**, and note
  that the pan GESTURE is wired (middle-drag and space-drag) while the COMMAND is not.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are
  `describeSlotValue`'s `Point`/`Point[]` arms — all four creatable types have schemas.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade, **not a
  defect**, and **not to be "fixed" by tightening a bound** (D-077 clause 3).
- **A `#PARSE` position is an offset into the FORMULA, not into the line.** A caret-positioning UI
  will need `SetFormulaCommand` to carry the line offset of its `=` plus the trimmed whitespace.
- **A refused prompt answer is reported by the wrong grammar** — ruled **D-074**, fix-list item 6(1).
- **Prompt order, wording and the `<8>` default form are a reading of AutoCAD, not the brief's** —
  and now that the input bar exists, the human can finally judge them in use. **No repeat-last-command
  gesture.**
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — reachable only via a raw
  `setSlot`, pinned by `mutation.test.ts`'s "KNOWN INCOHERENCE" test; D-053 forbids a one-sided fix.
- **Two carried render gaps:** cell text is not clipped to its cell (§5.4 silent, Rule 5) ·
  `readNumber`/`asPointArray` still have two consumers and move to `render/slots.ts` at the THIRD
  (0064-REVIEW §5 — `documentExtent` deliberately did NOT become one, by living in `hittest.ts`).
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` that is not a registry name
  (covered explicitly in `commands.test.ts`) · comment debt in TEST files only (0058-REVIEW F2) ·
  mixed line endings in the WORKING TREE only (`core.autocrlf=true`) · dangling-reference messages
  name the DEPENDENT, not the missing SOURCE (0045-REVIEW F4) · D-022's bounded-correctness claim
  fails for `table` (0043-REVIEW §7 Q1) · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only, owed text boxes at Phase 5 ·
  journal structure unvalidated beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's
  `style` field · `noUnusedLocals` off.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-091**) binds without restatement here.

**New at 0091-REVIEW, from the human's session:** **D-088** (the command input keeps the keyboard:
a canvas press refuses the browser's default focus move, every printable keystroke routes to the
input from anywhere, and `ctrl`/`alt`/`meta` combinations never route — clause 1 built, 2–4 queued)
· **D-089** (command history on up/down, in `AppState` and not in two variables inside `start`;
submitted lines including refused ones, never prompt answers) · **D-090** (a prompt sequence draws
its gathered point and the geometry it would produce, from `state.pending`, never into the document)
· **D-091** (the table's grey grid against a near-black outline is deliberate and stands).

**Superseded in part: D-086 clause 2's "one backing pixel is one CSS pixel"** — the backing store now
matches the DISPLAY, and clause 3's required conversion is built at `screenPointOf`. 0091-REVIEW §4
records why the original was the right fix and the wrong constant. `DECISIONS.md` is append-only, so
the clause stands there as written and this line is the correction.

**New at 0090-REVIEW, all four already applied in code:** **D-084** (Phase 3's gate is cleared only
by a human run, recorded in a numbered entry — no implementer cycle may claim it) · **D-085**
(§5.9's space-drag arms on a space while the input bar is EMPTY, and `target !== input` is never an
acceptable guard for a global key, because §5.10 makes the input the target of everything) ·
**D-086** (one canvas backing pixel is one CSS pixel, re-read before every paint; a future
device-pixel-ratio cycle must add the conversion at `screenPointOf` in the same change) · **D-087**
(a degenerate extent is a POINT — both axes zero; a FLAT extent is fitted to the axis it has, and is
never described as a point).

The ones entry 0089 implemented: **D-075** and **D-082** (an effect is data; `main.ts` performs it through an
exhaustive switch and resolves no name) — **now implemented end to end, clauses 3 and 4 included** ·
**D-062** (a loaded camera is clamped in `render/`, at the boundary) — **implemented as
`clampCamera`, called by `main.ts` at every document replacement** · **D-061** (`camera.x`/`.y` is the
world point at the screen's TOP-LEFT corner) — the convention `fit`'s arithmetic is written against ·
**D-066** (a degenerate extent needs its OWN guard) — `fit`'s single-point branch, narrowed to a
true point by **D-087** · **D-072** (a pick
is a prompt answer, as a WORLD point) · **D-027 clause 2** (the camera never goes through `mutate`).

Still owed, unchanged: **D-074** (a prompt sequence's own refusal IS the message) · **D-081**
(`createObject`'s name gate, owed by the load cycle) · **D-083 clause 4** (a loaded AST's depth,
checked once at the load boundary) · **D-068** (§5.9's feedback trio, one cycle, in `renderer.ts`).

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants): world units or screen pixels? Provisional (a) world units. Due with the
`style`-slots cycle — and still blocking `pan`'s argument grammar, though not the pan gesture.
**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.

**Q-014 — the properties panel — is OPEN and is the HUMAN'S ALONE.** They asked for one at entry
0091; §5.10 says "no panels, no toolbars". It needs a brief amendment, so no implementer and no
reviewer may settle it, and **nothing is built against it, not even a small version**. The
recommendation in `OPEN_QUESTIONS.md` is option (a). Note it would also moot **Q-013** (how a
general formula is authored, which §5.10 has no command for and Phase 4(b) needs).

Next free: **Q-015**.

## Gotchas for the next model

- **`main.ts` can be tested, and the trick is the bottom of the file.** The bootstrap is guarded on
  `typeof document !== "undefined"`, so importing the module under `node` runs nothing. Do not remove
  that guard, and do not move DOM work above it.
- **The global `document` and `state.document` are different things** and always will be in this
  file. One is a value (the browser's), the other a type and a field (§5.11's). They do not collide
  in the compiler; they collide in readers.
- **`clampZoom` now takes `(requestedZoom, fallbackZoom)`, not a camera.** It was changed so `fit`
  could learn the clamped zoom before placing a camera at it.
- **An `effect` is a REQUEST, not a report** (D-082 clause 5). `commands.ts` echoes what was asked
  for; `main.ts` echoes what happened. That is why `zoom 2` produces two lines.
- **A pan gesture is not the `pan` command.** The gesture is wired; the command is refused as "not
  built" pending Q-012.
- **Find the recursion before you bound it** (entry 0087's lesson, still the best one here).
- **`command/` may not see a `CameraState`, a selection, or a DOM handle — not even to describe one.**
  D-075's effect is the whole vocabulary.
- **`parser.ts` validates the FORM of a number, not its usefulness.** `zoom 0` and `zoom -2` parse;
  `commands.ts` refuses them (D-082 clause 1) rather than letting `clampZoom` absorb them.
- **A name §5.2 allows is not automatically a name §5.3 can READ (D-080).**
- **A range over cells nobody has written creates NO edges** (D-047 item 1) and becomes ONE dangling
  edge the moment its table disappears — which is why `refs <object>` simulates the removal.
- **`writeSlot` in `commands.ts` is the ONE place a slot is written by command**, and
  `withCamera` in `main.ts` is the ONE place the camera is written at all.
- **A formula's SOURCE does not exist anywhere.** It is reconstructed from the AST by
  `formula/format.ts` against current names.
- **`executeCommand` is the ONLY place a `Command` meets a `Document` (D-069)**, it returns a NEW
  document, and it never throws.
- **`mintObjectId` returns the ADVANCED counter with the id.** Deleting an object frees its NAME and
  never its id (D-002).
- **Never spread a collection the user can size (D-077).**
- **Four different reasons to read a slot, and they do NOT unify** (0062-, 0067-REVIEW): to
  DRAW/HIT-TEST, to SIZE a slot family, to decide whether it may be WRITTEN, and to decide whether a
  command MAY write it.
- **Mutation-check a suite that passes first try — and check the checker.** Strip ANSI
  (`sed 's/\x1b\[[0-9;]*m//g'`) and assert on the `Tests  N failed` line. Entry 0089 seeded five
  faults one at a time and killed 1, 1, 6, 1 and 3 tests.
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change fires.**
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Entry 0089 falsified three: `camera.ts`'s "the only two producers", `screenToWorld`'s
  "D-062 puts that guard in `render/`" (it is now built), and `hittest.ts`'s "the one exported entry
  point".
- **Line endings:** the working tree is mixed under `core.autocrlf=true` and `git diff` shows only
  real changes. `.gitattributes` is still owed (fix list).
- **Do NOT report the LENGTH of anything (D-076)** — the one surviving rule is `WHAT THIS IS` capped
  at 15 lines, binding new and edited headers only.
- **A global key handler may NOT be guarded on `event.target !== input` (D-085).** §5.10 focuses the
  input bar at startup and again after every canvas press, so that test is false essentially never
  and any gesture behind it is dead code that compiles, tests green, and does nothing.
- **One canvas backing pixel is one CSS pixel, and `paint()` is what keeps it true (D-086).** The
  canvas is a flex child above a log that GROWS, so its CSS size changes with no `resize` event
  behind it. If a click ever seems to land in the wrong place, this is the first thing to check and
  `hittest.ts` is the wrong place to look.
- **`Infinity` is not always a bug in `fit`'s arithmetic.** Dividing the viewport by a zero extent
  yields it, and the `Math.min` against the other axis discards it — which is why D-087's degeneracy
  is BOTH axes and not either.
- **A browser's DEFAULT action runs AFTER your listener.** A press on the canvas moves focus to the
  body, which is why `input.focus()` inside a `pointerdown` handler was undone a moment later and
  the command input went deaf after the first click (entry 0091). `preventDefault` is the fix, not
  a second `focus()` call.
- **The canvas backing store is in DEVICE pixels and pointer events are in CSS pixels.**
  `screenPointOf` is the one conversion between them (D-086 clause 3). Anything new that reads a
  pointer event goes through it — a raw `clientX` delta pans at the wrong speed on a scaled display,
  which is a bug that shipped and was found only because the fuzziness forced the conversion.
- **`window.devicePixelRatio` is not always an integer.** Windows at 125% scaling gives 1.25, so
  `paint` rounds the backing size and `screenPointOf` reads the ratio back off the canvas instead of
  trusting the multiplication.
