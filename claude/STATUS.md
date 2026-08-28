# STATUS — as of entry 0099-properties-panel

STATE: **GREEN — built this batch, NOT yet reviewed.** Both configs compile, **1191/1191** tests
pass, 0 skipped, 0 `.only`, `npm run build` succeeds (32 modules) — real output in entry 0099.
Entry **0099** built **D-094's read-only properties panel** and is **awaiting review** (§6.1
trigger 2 — first file of a new subsystem, `render/panel.ts`). Entries **0096** and **0097** are
**REVIEWED: ACCEPT WITH EDITS** (0098-REVIEW-phase4); **0093**/**0094** remain **REVIEWED: ACCEPT**
(0095-REVIEW).

Current phase: **4 — cross-object linking, the validation moment.** **Phase 3 is PASSED and its gate
is CLOSED** (0091-REVIEW). Phase 4 is OPEN and NOT claimed.

Last review point: **0098-REVIEW-phase4** (ACCEPT WITH EDITS; **D-096** ruled, four clauses).
Cycles since last review: **1/3** · diff since last review: **~460 lines / 7 files**.

**NEXT: this cycle needs a review before the next slice starts.** Entry 0099 is a §6.1 trigger 2
stop. After it clears, the queue continues at D-090's prompt-sequence preview (see "Next cycles").

## Read this first — the six things a cold reader needs

**1. THE PROPERTIES PANEL IS BUILT (entry 0099, awaiting review).** D-094's fourteen clauses, in
`render/panel.ts` (new — the pure placement function, `placePropertiesPanel`), `main.ts`
(`buildPanelModel` builds rows from `command/props.ts`'s ONE enumeration — D-094 clause 9 — and
`writePanel`/`updatePanel` are the DOM half, untested like the rest of `start`), `index.html` (the
canvas now sits in a `position: relative` `#stage` so `#panel` can overlay it; `pointer-events:
none`, clause 10), and `renderer.ts` (one line: the SELECTED object's canvas name label is
suppressed — clause 3 — its badge and ticks still draw). **The panel is READ-ONLY. Nothing is
built against Q-014's editing/linking half and `pointer-events: none` is what keeps approving that
later an addition, not an unwinding.** The DOM wiring is unseen by any test and by any human — the
manual-check list is in entry 0099's "Where I got stuck".

**2. Chrome hangs from the object's drawn EXTENT, and the bug it replaced is the lesson.** Entry
0093 anchored chrome to `origin.x`/`origin.y`; `origin` is a circle's/polygon's **centre** but a
rect's/table's **top-left corner** (`primitives/geometry.ts`), so a circle's label drew *inside*
the circle. **Every test passed** — each asserted an OFFSET from the anchor, which was right for
every type; the defect was in what the anchor MEANT, and a human screenshot found it (entry 0094).
Chrome now hangs from the top-centre of `render/extent.ts`'s `objectExtent`, one measured line:
`[•x •y] name [!]`. **The panel now takes the selected object's `name` off that line** (D-094
clause 3) — the badge and ticks stay.

**This is the standing lesson: it is not only untested code that is at risk, it is code whose tests
can only check what their author was already thinking about.** Entry 0099 adds more of exactly the
kind of code that lesson is about — an untested DOM half.

**3. THE IMPORT CYCLE IS CLOSED (D-093, entry 0096).** `renderer.ts` and `hittest.ts` used to
import each other through function bodies only — a latent TDZ trap. **`src/render/slots.ts`**
(`readNumber`, `asPointArray`, `TABLE_CELL_*`) and **`src/render/extent.ts`** (`WorldExtent`,
`objectExtent`, `documentExtent`) now hold the shared code; neither `renderer.ts` nor `hittest.ts`
imports the other. **`render/panel.ts` (entry 0099) imports `./camera.ts` and `./extent.ts` only —
the DAG is intact.** A NEW top-level cross-reference between `renderer.ts` and `hittest.ts` is a
regression of this fix, not a return to an old accepted shape.

**4. THE ADDRESSING VOCABULARY IS NOW VISIBLE TWO WAYS.** D-092 named two holes: object → name
(closed at 0093/0094) and object → its slots. `props <object>` (entry 0097, reviewed 0098) prints
every slot — path, kind, value, formula source — from `src/command/props.ts`'s
`buildSlotDescriptors`. **The properties panel (entry 0099) is the enumeration's SECOND and only
other permitted reader** (D-094 clause 9): it puts the same information beside the object the
operator just clicked, no typing. A table's `cells.*` family is ONE summary row in both (D-077,
D-094 clause 8, D-096 clause 2).

**5. The human's session at entry 0091 set the rest of the queue.** Ruled: **D-088** (every
printable keystroke reaches the command input — clause 1 built, 2–4 owed) · **D-089** (command
history on up/down) · **D-090** (a prompt sequence DRAWS its gathered point, from `state.pending`,
never into the document — owed) · **D-091** (the table's grey grid stands).

**Q-014 is now WRITING/LINKING ONLY.** The human ruled the DISPLAY half at 0095 (**D-094**, the
read-only panel — built at 0099) and amended §5.10's "no panels" once, narrowly. Still OPEN and the
human's alone: whether a click on a slot row may EDIT it, and whether two panels may LINK two slots
by mouse. **Nothing is built against that half.**

**6. `main.ts` is two halves, and only one is tested — and entry 0099 grew the untested one.**
`AppState` and every transition over it are pure and tested (now including `buildPanelModel`).
`start` — the canvas, the listeners, the log, the file picker, **and now `updatePanel` / the panel
DOM** — has no test. Every finding of the last several reviews touched `start` or something only a
running browser could show. `placePropertiesPanel` (the panel's arithmetic) IS tested — D-094
clause 11 put it in `render/` for exactly that reason.

**Also still binding:** a hand-edited document whose formula AST nests deeper than
`MAX_FORMULA_AST_DEPTH` throws a `RangeError` out of the Load button (**D-083** clause 4 not built;
**D-081**'s name gate not either) — owned by `document.ts`'s cycle. And five names §5.2's grammar
allows are NOT available: `AND`/`OR`/`NOT`/`TRUE`/`FALSE` lex as keywords (**D-080**).

## Next cycles — ordered

**Queue item 1 (D-094's panel) is BUILT at entry 0099 and awaits review.** Nothing new should
start until it clears (§6.1 trigger 2). After review:

1. **`main.ts` + `renderer.ts`: D-090's prompt-sequence preview.** Needs `state.pending` threaded
   into the render call, plus per-command preview geometry (the marker for a picked point, the
   shape a live `circle`/`polygon`/`rect` prompt would produce). Deferred out of entry 0093.
2. **D-088 clauses 2–4 + D-089, the command input's behaviour.** Printable-key routing from
   anywhere (excluding `ctrl`/`alt`/`meta`), and history on up/down held in `AppState`.
3. **§5.11's load boundary** in `document.ts`: **D-083** clause 4's depth check and **D-081**'s
   `createObject` name gate (whose pinned "duplicate DOES commit" test is meant to FLIP then).

**A human session is owed before Phase 4 is attempted in earnest.** Phase 4's criterion needs a
human to bind two polygons through a table; `props` and now the panel both exist to let that human
discover `origin.x` is a writable path — the panel by clicking, `props` by typing.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · table primitive through row/column insert/delete and
`delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit (0058) ·
`primitives/geometry.ts` (0060) · `render/renderer.ts`'s original body/table drawing (0062, widened
by 0093/0094, reviewed 0095) · `render/hittest.ts` (0064) · entry 0065's header audit ·
`render/interaction.ts` (0067) · `command/parser.ts` (0069) · `command/prompt.ts` + D-071's formula
path (0071) · entries 0072–0073's fix-list work (0074) · `command/commands.ts`'s seam and its four
creation handlers, `document.ts`'s `mintObjectId`, `TABLE_SCHEMA`'s `origin.x`/`origin.y` (0078) ·
`commands.ts`'s four slot commands through one `writeSlot` path, `engine/formula/format.ts` (0080) ·
`commands.ts`'s `delete`/`refs`/`list` (0082) · `mutation.ts`'s `RenameObjectOperation` +
`findInvalidRenames`, `commands.ts`'s `rename` (0084) · `CommandEffect` and the five effect handlers
(0086) · the two formula depth limits (0088) · `main.ts` rewritten from the stub, `render/camera.ts`'s
`clampCamera`/`clampZoom`, `render/hittest.ts`'s `documentExtent` (moved to `render/extent.ts` at
0096), `index.html` (0089, reviewed 0090/0091) · entry 0093's selection highlight / error badge /
formula-driven indicator (D-068) and D-092 clause 1's name label, entry 0094's chrome-anchor fix —
**REVIEWED: ACCEPT at 0095-REVIEW** · entry 0096's `render/slots.ts` + `render/extent.ts` split
(D-093) and entry 0097's `command/props.ts` + `props` command (D-092 clause 4 / D-094 clause 9) —
**REVIEWED: ACCEPT WITH EDITS at 0098-REVIEW** (D-096, four clauses).

## Built this batch — NOT yet reviewed

**Entry 0099 — D-094's read-only properties panel.** Seven files:
- **`src/render/panel.ts`** (new) — `placePropertiesPanel(extent, camera, ratioBackingPerCss,
  viewport, panel)` → CSS-pixel top-left. Anchors left of the extent, flips right when it would
  cross the canvas's left edge, clamps to stay on the canvas (clause 11); converts
  `worldToScreen`'s backing pixels to CSS pixels by the canvas's own ratio (clause 12); non-finite
  ratio → 1. Imports `./camera.ts` + `./extent.ts` only. 9 tests (`panel.test.ts`, new).
- **`src/main.ts`** — `buildPanelModel(object, objects)` (exported, pure, tested): splits
  `buildSlotDescriptors`' output into `modifiable`/`derived` in schema order (clauses 5, 7, 9),
  each row carrying `slotKey` path / value / formula source (clauses 4, 6). `writePanel` +
  `panelRowElement` (module-level DOM writers) and `updatePanel` (a `start` closure, called from
  `paint`): show the panel when the selection resolves to an object with an `objectExtent`
  (clause 2), re-place it every paint (clause 13). 4 tests (`main.test.ts`).
- **`index.html`** — `#stage` wraps the canvas (`position: relative`); `#panel` is
  `position: absolute`, `pointer-events: none`, `hidden` by default; `.panel-rule` 3px, derived
  rows italic (clause 5). File-header comment rewritten (D-065 — it claimed "no panels").
- **`src/render/renderer.ts`** — `drawObjectChrome` gains `suppressName`; `renderDocument` passes
  `object.id === selectedObjectId` (clause 3). Badge and ticks NOT suppressed. 4 tests
  (`renderer.test.ts`).

Verified: `tsc` clean both configs, **1191/1191**, `npm run build` succeeds. Four seeded mutants,
each `diff`-confirmed reverted: `panel.ts` never-flip killed 4, `panel.ts` left-offset killed 8,
`panel.ts` ratio-guard-removed killed 1, `renderer.ts` always-draw-name killed 3 — full detail in
entry 0099.

## Reviewed at 0098-REVIEW (ACCEPT WITH EDITS — detail retained for the record)

**Reviewer edits: two doc comments in `src/command/props.ts`, no behaviour.** Two bare "this cycle"
diaries rewritten to the present (§5.4/D-060); `describeSlotValue`'s dropped D-041 rationale
restored. **One finding, ratified not reverted:** D-093 clause 1 named five declarations to move to
`slots.ts` and entry 0096 moved four (`TABLE_CELL_TEXT_PADDING` stayed, correctly — one consumer,
module-private) without disclosing the omission. Ruled generally as **D-096 clause 1**: a ruling's
file list is a CEILING, its rationale governs a divergence, and the divergence MUST be named in the
log entry. **Entry 0099 applied this** — its fifth `placePropertiesPanel` argument (the ratio,
required by clause 12 and not in clause 11's list of four) is named in "Decisions I made".

**Entry 0096 — `render/slots.ts` + `render/extent.ts`: D-093's split.** Pure move, import cycle
closed. **1148/1148**, rechecked declaration-by-declaration by the reviewer.

**Entry 0097 — `src/command/props.ts` (new) + `props`: D-092 clause 4, D-094 clause 9.**
`buildSlotDescriptors(object, objects)` enumerates every schema slot in schema order; a table's
`cells.*` collapses to ONE summary (D-077). `describeSlotValue` moved here, exported. **1174/1174**;
three seeded mutants killed 4/3/7. **D-096 clauses 2–4** answer entry 0097's questions — the summary
keeps `kind: "literal"`, NO fourth `SlotDescriptor` kind (an optional `synthetic?: true` is for the
editing cycle), the table-specific `object.type === TABLE_TYPE` branch stands, `props`'s registry
position and refusal message stand.

## Reviewed at 0095-REVIEW (detail retained for the record)

**Entry 0093 — `renderer.ts`'s selection highlight, error badge, formula-driven indicator (D-068),
D-092 clause 1's name label; `main.ts` wired to pass the selection through.** `renderDocument` gained
`selectedObjectId?` and a third (screen-space chrome) pass. 16 new tests.

**Entry 0094 — chrome anchors to the drawn EXTENT, not `origin`.** `chromeAnchorPoint` = `objectExtent`'s
top-centre; the per-type `switch` is gone; all three chrome pieces on ONE measured line. `objectExtent`
exported from `hittest.ts` (this created the import cycle D-093/0096 then closed). Both fakes gained a
fixed-width `measureText`. Six existing tests changed, none weakened. **1148/1148**; three mutants
killed 12/10/5.

## Not started

**D-090's prompt-sequence preview** · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots · point-in-polygon fill hit-testing
(D-067) · §5.4's formula bar / in-place cell editing · §5.11's load-boundary validation (D-081,
D-083 clause 4) · D-088 clauses 2–4 · D-089 · Q-014's editing/linking half · Phases 5–7.

**Phase 4 is OPEN and NOT claimed.** (a) data drives geometry and (b) geometry drives data are both
reachable from typed lines; (c) partial binding under drag is demonstrated in `main.test.ts`. What
is missing is all three in ONE document, authored by a human — `props` and the panel now both exist
to help that human find the paths, but nobody has run the session.

## Open fix list — read 0090-REVIEW §9 and 0091-REVIEW §5 for the full text

Numbering follows 0090-REVIEW §9. Unchanged this cycle except items 9/10, still open.

1. **§5.11's loader validates a loaded formula's AST depth once, at the boundary** (**D-083**
   clause 4). User-reachable since the Load button. Owned by `document.ts`'s cycle, with **D-081**'s
   `createObject` name gate.
2. **Give the missing-slot refusal a remedy.** Message only; D-047 clause 4 does not move.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE.** `mutation.ts`.
4. **`zoom`'s refusal names `Infinity` rather than what was typed.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged, none blocking** (see that entry).
6. **A middle-drag pan started outside the canvas is untested.** Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** where its neighbour has a paragraph (**D-091**).
   Owned by the `style`-slots cycle.
8. **The screen-space chrome constants (label/badge/tick offsets) are untuned** — chosen, not
   measured (Rule 5). **Entry 0099 adds `PANEL_OBJECT_GAP_CSS` to this list** — same posture,
   revisit once a human has seen the panel.
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return** (0095-REVIEW §5).
   Harmless today. Owned by whichever cycle next opens `drawObjectChrome` — **entry 0099 opened it
   for clause 3's one line and deliberately did not touch this** (§4).
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED
    now that `props.ts` exists** (0095-REVIEW §4). Not this cycle's to make — entry 0099 opened
    `renderer.ts` for clause 3 only.

## Known problems (detail lives where the pointer says)

- **`main.ts`'s `start` is untested code, and entry 0099 enlarged it** — every listener, the canvas
  sizing, the log rewrite, the file picker, the selection hand-off, **and now `updatePanel` + the
  panel DOM (`writePanel`/`panelRowElement`)**. 0090-REVIEW found four defects here and none
  elsewhere. Treat any change to this region as unverified until someone clicks on it. **The panel
  DOM has been seen by no test and no human** — entry 0099's "Where I got stuck" has the manual
  check.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas
  edge.** D-094 does not ask for hiding it, and the selection highlight is equally off-screen, so
  it is consistent — not fixed on suspicion (Rule 5).
- **The chrome layout is still UNSEEN** beyond entry 0094's anchor fix. Labels of two adjacent
  objects can still overlap — no inter-object collision handling, and D-095 says build none until a
  human asks.
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses
  2–4 not built. **There is no command history** (**D-089**, queued).
- **A hand-edited saved file can throw a `RangeError` out of the Load button** — fix-list item 1.
- **Every pointer move repaints the canvas AND rewrites the whole log's `textContent`** — and now
  also rebuilds the panel DOM whole every paint (immediate-mode, like the log). Unmeasured; the
  panel is a handful of rows.
- **`escape` is bound to the window**, so it cancels a live prompt from anywhere. Untested in use.
- **`zoom`'s echoed line names the REQUEST and `main.ts` adds a second line with the RESULT** —
  deliberate, D-082 clause 5.
- **`format.ts`'s elision does not re-parse** — a disclosed exception to the round-trip property.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed
  (entry 0081).
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046). Fix-list
  item 2.
- **A bare reference to an EMPTY cell is REFUSED.** 0080-REVIEW F4 ruled it STANDS. (This is why
  entry 0099's `buildPanelModel` test `link`s to a cell only after `set`ting it.)
- **`createObject` does not check the name it carries** — pinned by a test asserting a duplicate
  DOES commit, which **D-081** says must FLIP in the load cycle.
- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012** (the
  pan GESTURE is wired, the COMMAND is not).
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are
  `describeSlotValue`'s `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade, **not a
  defect** (D-077 clause 3).
- **`render/renderer.ts`'s `formatCellValue` and `command/props.ts`'s `describeSlotValue` are two
  separate `Value`-to-text formatters** never reconciled — pre-existing, `props.ts`'s move made it
  visible. Entry 0099's panel uses `describeSlotValue` (via `buildPanelModel`), so a table cell's
  panel-summary text and its on-canvas text still come from two different formatters. Not fixed —
  neither file was open for that reason.
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name ·
  comment debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`)
  · dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off
  · `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-096**) binds without restatement here.

**D-094 — the read-only properties panel — is IMPLEMENTED at entry 0099** (awaiting review). Its
fourteen clauses stand unamended. It is the ONE amendment `PROJECT_BRIEF.md` §5.10 has ever taken,
narrow and display-only. **Q-014's remaining half (editing/linking slots by mouse) is untouched and
the human's alone.**

**From 0098-REVIEW — D-096, four clauses:** (1) a ruling's file/move list is a CEILING, its
rationale governs a divergence, and a divergence **must be named in the log entry** — binds every
cycle; (2) the table `cells` summary keeps `kind: "literal"`, `SlotDescriptor` grows **no fourth
kind** (an optional `synthetic?: true` belongs to the editing cycle); (3) the table-specific
`object.type === TABLE_TYPE` branch stands, and **a new `dynamic` group in `primitives/schema.ts`
MUST add its own summary branch in `props.ts` in the same cycle**; (4) `props`'s registry position
and unknown-name message stand.

**From 0095-REVIEW — D-093** (the `render/` split — IMPLEMENTED at 0096) · **D-094** (the panel —
IMPLEMENTED at 0099) · **D-095** (chrome hangs from the extent's top-centre; **no inter-object
label collision avoidance is to be built**).

**D-068 and D-092 clause 1 are IMPLEMENTED at entry 0093**, REVIEWED at 0095. **D-092 clause 4
(`props`) is IMPLEMENTED at 0097**, REVIEWED at 0098. The `SlotDescriptor` shape is settled (**D-096**
clause 2).

**From 0092-REVIEW:** the addressing vocabulary must be VISIBLE in the running application (D-092).
Neither `props` nor the panel amends the brief beyond §5.10's one narrow panel amendment.

**From 0091-REVIEW (the human's session):** **D-088** (clause 1 built, 2–4 queued) · **D-089**
(queued) · **D-090** (queued) · **D-091** (the grey grid stands).

**Superseded in part: D-086 clause 2's "one backing pixel is one CSS pixel"** — the backing store
now matches the DISPLAY, and clause 3's conversion is built at `screenPointOf` and, **since entry
0099, in the other direction inside `placePropertiesPanel`** (D-094 clause 12).

**From 0090-REVIEW, all four implemented:** **D-084** (Phase 3's gate needs a human run — discharged
0091) · **D-085** (space-drag arms on an empty input bar) · **D-086** (backing pixel = CSS pixel,
re-read before every paint) · **D-087** (a degenerate extent is a POINT; a FLAT extent is fitted).

**From entry 0089:** **D-075**/**D-082** (an effect is data, performed through an exhaustive switch)
· **D-062** (a loaded camera is clamped in `render/`) · **D-061** (`camera.x`/`.y` is the world point
at the screen's TOP-LEFT corner) · **D-066** (a degenerate extent needs its OWN guard) · **D-072** (a
pick is a prompt answer, as a WORLD point) · **D-027 clause 2** (the camera never goes through
`mutate`).

Still owed, unchanged: **D-074** · **D-081** · **D-083 clause 4**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** and **`src/render/slots.ts`**
(`DEFAULT_SHAPE_STROKE_WIDTH`, `TABLE_CELL_*`, `SELECTION_HIGHLIGHT_WIDTH`): world units or screen
pixels? Provisional (a) world units. Due with the `style`-slots cycle. **Entry 0099's
`PANEL_OBJECT_GAP_CSS` does NOT take a side — it is CSS pixels by a stated reason (a DOM element is
laid out in CSS pixels), like the chrome constants, not an answer to what a stroke WIDTH should
be.**
**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.

**Q-014 — the properties panel's WRITING/LINKING half — is OPEN and the HUMAN'S ALONE.** The
DISPLAY half is closed (D-094, built at 0099). Only EDITING and LINKING slots by mouse remain.
**Nothing is built against it — `render/panel.ts` and the panel DOM are display-only,
`pointer-events: none`.**

Next free: **Q-015**.

## Gotchas for the next model

- **`render/panel.ts` is PURE and tested; the panel DOM in `main.ts` is not.** `placePropertiesPanel`
  is the arithmetic (D-094 clause 11 put it in `render/` so it would be tested — entry 0090's four
  defects were all in untested `start` code). `buildPanelModel` (in `main.ts`, exported) is the row
  model and is tested. `writePanel`/`panelRowElement`/`updatePanel` touch the DOM and are not.
- **The panel is positioned in CSS pixels; `worldToScreen` returns BACKING pixels.** `placeProperties
  Panel` divides by the ratio the canvas actually has (`canvas.width / bounds.width`), read off the
  canvas the way `screenPointOf` reads it — never `devicePixelRatio` by assumption (D-094 clause 12,
  D-086 clause 3). This conversion has shipped as a bug once already, in the other direction (entry
  0091's pan speed).
- **The canvas is a FLEX CHILD, so nothing floats over it as written.** Entry 0099 wrapped it in a
  `position: relative` `#stage`. `index.html`'s header comment now says so — under D-065 that comment
  is the next model's to keep true.
- **`buildPanelModel` and `props` MUST agree** — both read `command/props.ts`'s `buildSlotDescriptors`
  and nothing else walks the schema for display (D-094 clause 9). Before writing any third reader of
  `schema.nonDerivedSlotPaths`/`derivedSlots`, check whether `buildSlotDescriptors` already answers
  it.
- **The panel's thick rule renders only when there is at least one derived row** (entry 0099's
  call). Every schema today has ≥1 non-derived path, so the modifiable group is never empty.
- **The selected object's canvas NAME is suppressed (D-094 clause 3); its badge and ticks are
  not.** `drawObjectChrome(ctx, camera, object, suppressName)` — `suppressName` is
  `object.id === selectedObjectId`, derived inside `renderDocument`, no signature change. With the
  name gone, `halfName` is 0 and badge/ticks sit a gap either side of the anchor.
- **A "no text drawn" or "exact fillText array" renderer test WILL need updating** once an object it
  exercises gets a real anchor point — and now also if it selects that object (the name label
  vanishes). Check the fixture's `selectedObjectId` and its `vertices`/`origin` slots before
  assuming a chrome change is safe to skip.
- **`main.ts` can be tested, and the trick is the bottom of the file.** The bootstrap is guarded on
  `typeof document !== "undefined"`. Entry 0099 added `#panel` to the bootstrap's element query and
  to `start`'s parameters — the guard still skips all of it under `node`.
- **The global `document` and `state.document` are different things** — one the browser's value,
  the other §5.11's type/field.
- **An object's non-derived slot paths are NOT a list you may render** — `resolveNonDerivedSlotPaths`
  on a large table returns 90,000–130,000 paths. `buildSlotDescriptors` (and therefore the panel and
  `props`) summarise a table's cells in ONE row (D-094 clause 8, D-077, D-096 clause 3).
- **A properties panel is not a `table` object and must never be spoken of as one** (D-094 clause 1).
  It is DOM furniture; it never enters `state.document`, never goes through `mutate`, is never
  saved, never appears in `list`.
- **`describeSlotValue` lives in `command/props.ts`, exported** (moved at 0097). `main.ts`'s
  `buildPanelModel` imports it. Do not write a third `Value`-to-text switch — `renderer.ts`'s
  `formatCellValue` is already a second one, disclosed and unreconciled.
- **`clampZoom` takes `(requestedZoom, fallbackZoom)`, not a camera.**
- **An `effect` is a REQUEST, not a report** (D-082 clause 5).
- **A pan gesture is not the `pan` command.** The gesture is wired; the command is refused pending
  Q-012.
- **Find the recursion before you bound it** (entry 0087's lesson).
- **`command/` may not see a `CameraState`, a selection, or a DOM handle.** D-075's effect is the
  whole vocabulary. (`render/panel.ts` may see a `CameraState` — it is `render/`, not `command/`.)
- **`parser.ts` validates the FORM of a number, not its usefulness.**
- **A name §5.2 allows is not automatically a name §5.3 can READ (D-080).**
- **`writeSlot` in `commands.ts` is the ONE place a slot is written by command**, and `withCamera`
  in `main.ts` is the ONE place the camera is written.
- **A formula's SOURCE does not exist anywhere** — it is reconstructed from the AST by
  `formula/format.ts` against current names. The panel's formula rows reconstruct it every paint.
- **`executeCommand` is the ONLY place a `Command` meets a `Document` (D-069)**; it returns a NEW
  document and never throws.
- **Never spread a collection the user can size (D-077).**
- **Mutation-check a suite that passes first try — and check the checker.** Strip ANSI and assert
  on the `Tests N failed` line. Entry 0099 seeded four and killed 4, 8, 1, 3.
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change
  fires.**
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Entry 0099 falsified `index.html`'s "no panels" comment and `main.ts`'s NOT DONE HERE.
- **`origin` does not mean the same thing across object types** — a circle's/polygon's CENTRE, a
  rect's/table's TOP-LEFT CORNER. Anything that needs "where is this object, visually" wants
  `objectExtent`, never `origin`.
- **A test that asserts an OFFSET cannot catch a wrong ANCHOR** (entry 0093/0094). When adding a
  positioned thing, pin the ABSOLUTE position for at least two geometries that differ —
  `panel.test.ts` pins exact CSS coordinates under identity and under a panned+zoomed camera.
- **The operator cannot see what you can see.** Before adding anything the operator must NAME to
  use, ask where they learn the name from. The panel exists because that question kept going
  unasked.
