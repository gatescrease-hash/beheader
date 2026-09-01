# STATUS — as of entry 0107

STATE: **CLEAR TO PROCEED.** Both configs compile, **1238/1238** tests pass, 0 skipped, 0 `.only`,
`npm run build` succeeds. Entry **0107** built **D-101 + D-106 together** (N properties panels, each
draggable by its header and each with a dismiss control that hides it without deselecting) and is
**NOT YET REVIEWED** — see item 1 below for exactly what that does and does not block.

**THE NEXT SLICE IS D-102 — the paperclip and editing.** It is queued behind entry 0107 per D-103
clause 4, and per PROCESS_BRIEF §6 it gets its own **mandatory** review point regardless of the batch
cap once it lands. Whether D-102 may **start** before entry 0107 is reviewed is NOT a hard block —
no §6.1 trigger fired for entry 0107, and the batch cap (1/3 cycles, 510+86 lines / 6 files) is not
reached — but entry 0107's own log entry recommends review first, for a reason worth reading before
deciding to proceed anyway: see item 1.

Current phase: **4 — cross-object linking, the validation moment.** **Phase 3 is PASSED and its gate
is CLOSED** (0091-REVIEW). Phase 4 is OPEN and NOT claimed.

Last review point: **0105-REVIEW-phase4** (ACCEPT WITH EDITS; **D-105** ruled). Entry 0106-RULINGS
(the human, no code) and entry 0107 (D-101+D-106) both landed since, neither yet reviewed.
Cycles since last review: **1/3** · diff since last review: **510 insertions, 86 deletions across 6
files** (cap 800/10) — well under, but see item 1 on why "under the cap" isn't the whole answer here.

## Read this first — the nine things a cold reader needs

**1. ENTRY 0107 BUILT D-101 + D-106 AND IT IS UNREVIEWED — READ ITS OWN LOG BEFORE TOUCHING
`main.ts`, `render/renderer.ts`, OR `index.html`.** No `PROCESS_BRIEF §6.1` trigger fired (it is not
a phase gate, not a new subsystem's first file, no brief deviation, no worked-around rule, no changed
test expectation, no new dependency in the PROJECT — see the next paragraph, no repeated failed
attempt, nothing from §8). The batch cap is not reached either. **So starting D-102 next in the same
batch is technically permitted.** The entry's own log recommends review anyway, and says why: D-102
is about to add the FIRST code that writes DOCUMENT state from a mouse gesture (D-103's own framing),
and it will be built directly on top of entry 0107's interaction pattern for panel dragging and
dismissal — delegated listeners on the panel container plus a `window`-level drag-gesture tracker,
deliberately UNLIKE the canvas's own per-element pattern, because `updatePanels` rebuilds every panel
element on every paint and a listener bound to a specific header would be torn down mid-gesture. A
human has not seen this pattern run. It WAS verified live, in a real Chromium instance driven by
Playwright — installed transiently outside the project (`npm install --no-save` in the OS scratch
directory; **`package.json`/`package-lock.json` are unchanged, confirmed by `git status`**) — clicking,
shift-clicking, dragging a panel header, and clicking a dismiss button through real browser events,
with zero console/page errors. That is real signal, not a substitute for the human's own look before
D-102 stacks more mouse-driven writes on the same pattern. The reviewer's two open questions (entry
0107's log, bottom) are about exactly this.

**2. D-101 AND D-106 ARE BOTH FULLY BUILT — DO NOT RE-BUILD EITHER.** `AppState` gained a `panels:
PanelUiRegistry` field (`Record<string, { dismissed: boolean; manualPosition: PanelPlacement |
undefined }>`) — APPLICATION state, never touched by `mutate`, never saved (D-101 clause 7, D-106
clause 6). `withInteraction` is the ONE place `AppState.interaction` is ever assigned; it prunes
`panels` down to the current selection every time, which is what makes D-101 clause 6 / D-106
clause 6's "discarded when the object leaves the selection" true everywhere at once rather than at
each call site. `dismissPanel`/`movePanel` are the two panel-only transitions, both no-ops for an
object that is not currently selected. The DOM half now builds ONE panel element per PANELLED
object (`panelElements: Map<string, HTMLElement>` in `start`'s closure), each with a header carrying
a name and a `×` dismiss button; the header is the ONLY interactive part of a panel this cycle
(`pointer-events: auto`; the body stays `pointer-events: none` until D-102). `renderDocument` gained
a 7th parameter, `panelledObjectIds`, defaulting to `selectedObjectIds` — a SEPARATE list from the
selection (D-106 clause 5): a selected-but-dismissed object keeps its highlight but gets its canvas
name label back, because nothing else is showing it. Entry 0104's interim "the panel shows only for
a selection of exactly one" reading is GONE, as D-106 clause 1 required.

**3. THAT BATCH (0101/0102) WAS REVIEWED AND CLEARED (0103-REVIEW-phase4, ACCEPT WITH EDITS); ENTRY
0104 (D-100) WAS THEN BUILT, REVIEWED (0105-REVIEW, ACCEPT WITH EDITS), AND RULED ON (0106-RULINGS).**
Entry 0101 fixed D-097 (the vanishing table). Entry 0102 built D-098 (drag-notice dedup) and D-099
(the panel's 4-decimal rounding). Entry 0104 built D-100 (the selection becomes a list); 0105-REVIEW
fixed one defect (D-105: a press must always end a drag armed before it) and ratified the rest;
0106-RULINGS closed Q-015 (the shift-click toggle, confirmed final) and ruled D-106 (item 2 above).

**4. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101).** `mutation.ts`'s `findInvalidDimensionWrites`
rejects a `setSlot` that would leave `table`'s `rows`/`cols` non-`literal`, non-number, non-integer,
or outside `MIN_TABLE_LINES..MAX_TABLE_LINES` (now in `engine/primitives/table.ts`). D-097, D-098,
D-099 are all CLOSED — do not re-fix any of them.

**5. `main.ts`'s DOM HALF (`start`) IS STILL UNTESTED BY CONSTRUCTION (D-001) AND IS NOW LARGER.**
Entry 0107 added the panel container map, the placement/drag/dismiss helpers, and three new listeners
(one delegated `pointerdown`, one delegated `click`, two `window`-level for the drag gesture's
continuation). All of it was verified by hand — see item 1 — but none of it is under an assertion.
D-102 will grow this further (row inputs, the paperclip). **Before adding another interactive
control here, read entry 0107's "Decisions I made" 1-2 for why the delegated/`window`-level pattern
was chosen over the canvas's own per-element one**, and reconsider whether it still fits once a row
can hold focus (D-102 clause 8's own no-rebuild-while-editing requirement).

**6. D-104 IS STILL OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED YET.** `insertTableLine`/
`deleteTableLine` write the same two dimension slots `findInvalidDimensionWrites` bounds for
`setSlot`, but `findInvalidTableResizes` only bounds their INDEX, not the resulting COUNT — so a
`deleteTableLine` on a one-row table would still land `rows` on `0`. **Not reachable by any command
today** (§5.10's row/column commands are unbuilt). D-104 binds whichever cycle builds those commands
to close this in `findInvalidTableResizes`, not `findInvalidDimensionWrites`. Untouched by entry 0107.

**7. THE PROPERTIES PANEL IS NOW WRITABLE IN DESIGN ONLY — D-102 HAS NOT STARTED.** D-094 built the
read-only display; D-101/D-106 (entry 0107) built N of them with drag and dismiss; **D-102 is what
makes a row's own value editable** (the paperclip affordance, `set`/`unlink` through `executeCommand`,
never `mutate` directly) and it has not started.

**8. `commands.ts`'s D-100-era `select` effect and `command/props.ts`'s enumeration are UNCHANGED by
entry 0107** — `select <name>` still replaces the whole selection with one object (D-100 clause 7; no
command-line multi-select syntax exists), and `buildSlotDescriptors`/`describeSlotValue` are the same
ONE enumeration D-094 clause 9 requires, read by both `props` and every panel alike.

**9. A HUMAN SESSION IS STILL OWED FOR PHASE 4'S OWN GATE** — two polygons bound through a table, in
one document. Nothing in entries 0101-0107 is that session; all of it makes that session easier to
run once it happens.

## Next cycles — D-103's order, and it is binding

Numbering shifted again: the phase-4 review took entry 0103, D-100 took entry 0104, entry 0106 was
the human's own rulings (no build), and D-101+D-106 together took entry 0107.

1. ~~**Entry 0101 — D-097, the vanishing table.**~~ **DONE.**
2. ~~**Entry 0102 — D-098 + D-099.**~~ **DONE.**
3. ~~**Entry 0104 — D-100, the selection becomes a list.**~~ **DONE and REVIEWED** (0105-REVIEW).
   ~~**Entry 0106-RULINGS**~~ — the human closed Q-015 and ruled D-106.
4. ~~**Entry 0107 — D-101 + D-106 together: N panels, drag and dismiss.**~~ **DONE, NOT YET
   REVIEWED** — see item 1.
5. **Entry 0108 (or whichever number follows) — D-102, the paperclip and editing.** Gets its own
   mandatory review point regardless of the batch cap (D-103 clause 4). Read entry 0107's log in
   full first, in particular its two questions for the reviewer — a ruling on either could change
   how D-102's own mouse-driven writes should be wired.

**Still queued behind all of that, unchanged:** D-090's prompt-sequence preview · D-088 clauses 2–4
and D-089 (the command input's behaviour) · §5.11's load boundary in `document.ts` (D-083 clause 4's
depth check, D-081's `createObject` name gate, whose pinned "duplicate DOES commit" test must FLIP).

**A human session is still owed for Phase 4's own gate** — two polygons bound through a table, in
one document. Everything above makes that session easier; none of it IS that session.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · table primitive through row/column insert/delete and
`delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit (0058) ·
`primitives/geometry.ts` (0060) · `render/renderer.ts`'s original body/table drawing (0062, widened
by 0093/0094/0107) · `render/hittest.ts` (0064) · entry 0065's header audit · `render/interaction.ts`
(0067, its D-098 widening at 0102 reviewed at 0103) · `command/parser.ts` (0069) ·
`command/prompt.ts` + D-071's formula path (0071) · entries 0072–0073's fix-list work (0074) ·
`command/commands.ts`'s seam and its four creation handlers, `document.ts`'s `mintObjectId`,
`TABLE_SCHEMA`'s `origin.x`/`origin.y` (0078) · `commands.ts`'s four slot commands through one
`writeSlot` path, `engine/formula/format.ts` (0080) · `commands.ts`'s `delete`/`refs`/`list` (0082) ·
`mutation.ts`'s `RenameObjectOperation` + `findInvalidRenames`, `commands.ts`'s `rename` (0084) ·
`CommandEffect` and the five effect handlers (0086) · the two formula depth limits (0088) ·
`main.ts` rewritten from the stub, `render/camera.ts`'s `clampCamera`/`clampZoom`,
`render/hittest.ts`'s `documentExtent` (moved to `render/extent.ts` at 0096), `index.html` (0089,
reviewed 0090/0091, widened at 0107) · entry 0093's selection highlight / error badge / formula-driven
indicator (D-068) and D-092 clause 1's name label, entry 0094's chrome-anchor fix (0095-REVIEW, ACCEPT) ·
entry 0096's `render/slots.ts` + `render/extent.ts` split (D-093) and entry 0097's `command/props.ts`
+ `props` command (0098-REVIEW, ACCEPT WITH EDITS; D-096, its D-099 widening at 0102 reviewed at
0103) · entry 0099's `render/panel.ts` + `buildPanelModel` + the panel DOM + clause
3's name suppression (REVIEWED: ACCEPT at 0100-REVIEW, no edits; its D-099 widening at 0102 reviewed
at 0103) · entry 0104's `interaction.ts`/`renderer.ts`/`main.ts` selection-list widening (REVIEWED:
ACCEPT WITH EDITS at 0105-REVIEW; D-105).

## Built this batch, NOT yet reviewed (cycle 1/3 since 0105-REVIEW)

**Entry 0107 — D-101 + D-106, N panels with drag and dismiss.** `main.ts`'s `PanelUiState`/
`PanelUiRegistry`/`AppState.panels`, `withInteraction`/`prunePanelsToSelection`, `dismissPanel`/
`movePanel`, and the DOM half's `panelElements` map, `panelledObjectIds()`, `updatePanels`,
`panelElement`, `placePanelElement`, and the delegated drag/dismiss listeners; `renderer.ts`'s
`panelledObjectIds` parameter and the split `panelledIds`/`selectedIds` sets in the chrome pass;
`index.html`'s `#panels` container and its CSS. Tests in `main.test.ts` (9 new) and
`renderer.test.ts` (4 new). Mutation-checked (see entry 0107's own log) and manually verified live in
a real browser (see item 1 above). **Not yet reviewed** — see item 1 for what that does and does not
block.

## Not started

**D-102** · D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots · point-in-polygon fill hit-testing
(D-067) · §5.4's formula bar / in-place cell editing · §5.11's load-boundary validation (D-081,
D-083 clause 4) · D-088 clauses 2–4 · D-089 · Phases 5–7.

**Phase 4 is OPEN and NOT claimed.** (a) data drives geometry and (b) geometry drives data are both
reachable from typed lines; (c) partial binding under drag is demonstrated in `main.test.ts`. What
is missing is all three in ONE document, authored by a human.

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 1–10 unchanged and open.

1. **§5.11's loader validates a loaded formula's AST depth once, at the boundary** (**D-083**
   clause 4), with **D-081**'s `createObject` name gate. Owned by `document.ts`'s cycle.
2. **Give the missing-slot refusal a remedy.** Message only; D-047 clause 4 does not move.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE.** `mutation.ts`.
4. **`zoom`'s refusal names `Infinity` rather than what was typed.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged, none blocking.**
6. **A middle-drag pan started outside the canvas is untested.** Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** where its neighbour has a paragraph (**D-091**).
   Owned by the `style`-slots cycle.
8. **The screen-space chrome constants and `PANEL_OBJECT_GAP_CSS` are untuned** — chosen, not
   measured (Rule 5). The human has now seen the panel and did not object to the gap.
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return.** Harmless today.
   Still owned by whichever cycle actually addresses it — untouched by entry 0107 (which changed
   ONLY which objects count as panelled for the suppression pass, not the function's own state-leak).
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED**
    now that `props.ts` exists (0095-REVIEW §4).
11. **The panel's `overflow: auto` scroll position resets on every paint**, because
    `writePanel` rebuilds each panel's rows whole and paint runs on every pointer move (0100-REVIEW
    §3). **Superseded for the editing case by D-102 clause 8**, which must solve the general form —
    entry 0107 did NOT solve it (drag/dismiss do not need a row's scroll position preserved; a row's
    own open text input, D-102's, does).
12. **A right-flipped panel that hits the right clamp overlaps its own object** (0100-REVIEW §3).
    Correct per D-094 clause 11 as written; revisit only if the human asks after seeing it.
13. **`insertTableLine`/`deleteTableLine` are not bounded by `MIN_TABLE_LINES`/`MAX_TABLE_LINES`**
    (0103-REVIEW §6). Deleting the last row lands `rows` on `0` — D-097's vanishing state, reached
    by the one write path D-097 does not cover. **Not operator-reachable**: no command builds either
    operation. **D-104** owns it and binds the cycle that builds §5.10's row/column commands, which
    **must not land without it**; the fix goes in `findInvalidTableResizes`, never in
    `findInvalidDimensionWrites`.

## Known problems (detail lives where the pointer says)

- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** rather
  than removing it — a narrower, disclosed remnant of the vanishing-table gap. D-097 (entry 0101)
  closed the KIND/RANGE half; this stranded-slot half is ordinary D-047 empty state (invisible to
  `enumerateTableCellSlotPaths`, not a defect), not reachable except through a raw `setSlot`
  bypassing `insertTableLine`/`deleteTableLine`. See `primitives/table.ts`'s header.
- **`main.ts`'s `start` is untested code and D-102 will grow it further still** — the panel drag/
  dismiss listeners entry 0107 added join the existing list, canvas sizing, the log rewrite, the
  file picker, and the selection hand-off as untested-by-construction (D-001). 0090-REVIEW found
  four defects here and none elsewhere; entry 0107 verified its own additions live in a real
  browser (see "Read this first" item 1) but that is one run, not a re-runnable assertion.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
  D-094 does not ask for hiding it and the selection highlight is equally off-screen — consistent,
  not fixed on suspicion (Rule 5). Unchanged by N panels: each is clamped independently.
- **The chrome layout is still UNSEEN beyond entry 0094's anchor fix.** Labels of two adjacent
  objects can still overlap — **D-095 says build no collision avoidance until a human asks, and
  D-101 clause 3 extends that stance to panels** (confirmed live at entry 0107: two panels CAN
  overlap, by design).
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses
  2–4 not built. **There is no command history** (**D-089**, queued).
- **A hand-edited saved file can throw a `RangeError` out of the Load button** — fix-list item 1.
- **Every pointer move repaints the canvas, rewrites the whole log's `textContent`, and rebuilds
  every panel's DOM whole.** Immediate-mode. Unmeasured and acceptable today (Rule 5) — **but D-102
  clause 8 makes it a correctness problem the moment a row's text input is open, and that clause is
  binding.** Entry 0107's drag/dismiss listeners were deliberately designed NOT to depend on any
  element surviving a rebuild (see its "Decisions I made" 1-2) precisely because of this.
- **`escape` is bound to the window**, so it cancels a live prompt from anywhere. **D-100 clause 5
  and D-102 clause 7 give it a third duty and an innermost-first order** — input, then prompt, then
  selection. Dismissing a panel is deliberately NOT on this list (D-106 clause 8: dismissal is a
  click on a control, never a key).
- **`zoom`'s echoed line names the REQUEST and `main.ts` adds a second line with the RESULT** —
  deliberate, D-082 clause 5.
- **`format.ts`'s elision does not re-parse** — a disclosed exception to the round-trip property.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046) — a state
  D-097 makes unreachable BY COMMAND (entry 0101), though a loaded file can still carry it, so the
  refusal stays.
- **A bare reference to an EMPTY cell is REFUSED.** 0080-REVIEW F4 ruled it STANDS.
- **`createObject` does not check the name it carries** — pinned by a test asserting a duplicate
  DOES commit, which **D-081** says must FLIP in the load cycle.
- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are
  `describeSlotValue`'s `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade, **not a
  defect** (D-077 clause 3).
- **`render/renderer.ts`'s `formatCellValue` and `command/props.ts`'s `describeSlotValue` are two
  separate `Value`-to-text formatters** never reconciled. **D-099 clause 5 keeps it that way
  deliberately** — the human chose panel-only rounding (entry 0102 built it), so on-canvas cell
  text keeps full precision and the two now disagree on purpose. Reconciling them is its own slice
  and needs its own ask. `mutation.ts`'s `describeDimensionSlotValue` (entry 0101) is a THIRD,
  narrower formatter, scoped to one rejection message's "Got:" clause — not a display path, and
  not a precedent for a fourth anywhere else.
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name ·
  comment debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`)
  · dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off
  · `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-106**) binds without restatement here.

**D-097, D-098, D-099 are all IMPLEMENTED AND REVIEWED** — entries 0101 and 0102, cleared at
0103-REVIEW-phase4 (ACCEPT WITH EDITS). Do not re-attempt or duplicate any of them.

**D-100 is IMPLEMENTED AND REVIEWED** — entry 0104, cleared at 0105-REVIEW-phase4 (ACCEPT WITH
EDITS; D-105 ruled there). Q-015 is CLOSED (confirmed by the human at 0106-RULINGS).

**D-101 and D-106 are IMPLEMENTED at entry 0107, NOT YET REVIEWED.** Do not re-build either — see
"Read this first" items 1-2 for exactly what is built and what the reviewer should look at first.

**D-104 is NEW and NOT implemented** (0103-REVIEW). It is not owed by the next cycle — it is owed by
the cycle that builds §5.10's row/column commands. See "Read this first" item 6 and fix-list 13.

**D-102 (queued, next):** the panel becomes writable, `pointer-events: none` is lifted OFF THE BODY
(the header already lost it at entry 0107), the paperclip is blue for a `formula` slot and grey for
a `literal` one, and **every panel write goes through `executeCommand`, never `mutate`**.

**Q-014 IS CLOSED → D-102.** The human ruled the writing/linking half at entry 0100. §5.10's "no
panels, no toolbars" now carries one amendment, made twice by the same human: a display panel
(D-094, extended to N by D-101/D-106) that is also an authoring surface (D-102, not yet built).
**Q-013 is NOT mooted** — `set <address> = <formula>` stays the spelling and D-102 clause 6 reuses
it verbatim.

**D-094's fourteen clauses stand, with clause 10 amended by D-102 clause 1 (queued) and clause 3
generalised by D-100 clause 8 and again by D-106 clause 5.** Everything else in it is unchanged and
IMPLEMENTED at entry 0099.

**From 0098-REVIEW — D-096, four clauses:** (1) a ruling's file/move list is a CEILING, its
rationale governs a divergence, and a divergence **must be named in the log entry** — entries 0099,
0101, 0102, and 0107 have each disclosed their own; (2) the table `cells` summary keeps
`kind: "literal"` and `SlotDescriptor` grows no fourth kind — the optional `synthetic?: true` that
ruling deferred is D-102's; (3) a new `dynamic` group MUST add its own summary branch in `props.ts`
in the same cycle — **D-097 clause 6 extends that duty to the write check**; (4) `props`'s registry
position and unknown-name message stand.

**From 0095-REVIEW — D-093** (the `render/` split — IMPLEMENTED at 0096) · **D-094** (the panel —
IMPLEMENTED at 0099, extended to N panels at 0107) · **D-095** (chrome hangs from the extent's
top-centre; **no inter-object label collision avoidance is to be built** — extended to panels by
D-101 clause 3, confirmed live at entry 0107).

**From 0091-REVIEW (the human's session):** **D-088** (clause 1 built, 2–4 queued) · **D-089**
(queued) · **D-090** (queued) · **D-091** (the grey grid stands).

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
D-097's write-time refusal (entry 0101) sits BESIDE that read, not inside it, and does not weaken
it. Anyone tempted to "fix" a future dimension bug by honouring a formula dimension's cached value
is about to violate Rule 6 — read D-046's rationale first.

**Superseded in part: D-086 clause 2's "one backing pixel is one CSS pixel"** — the backing store
matches the DISPLAY, and clause 3's conversion is built at `screenPointOf` and, since entry 0099, in
the other direction inside `placePropertiesPanel`/`placePanelElement`.

**From 0090-REVIEW, all four implemented:** **D-084** · **D-085** · **D-086** · **D-087**.
**From entry 0089:** **D-075**/**D-082** · **D-062** · **D-061** · **D-066** · **D-072** ·
**D-027 clause 2**. Still owed, unchanged: **D-074** · **D-081** · **D-083 clause 4**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** and **`src/render/slots.ts`**
(`DEFAULT_SHAPE_STROKE_WIDTH`, `TABLE_CELL_*`, `SELECTION_HIGHLIGHT_WIDTH`): world units or screen
pixels? Provisional (a) world units. Due with the `style`-slots cycle. `PANEL_OBJECT_GAP_CSS` does
NOT take a side — it is CSS pixels by a stated reason.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.

**No other `PROVISIONAL` tags exist.** Q-015 was closed and reconciled at entry 0106-RULINGS.
Q-014 is closed (→ D-102). Next free: **Q-016**.

## Gotchas for the next model

- **ENTRY 0107 IS BUILT BUT UNREVIEWED.** No trigger makes this a hard stop, but its own log
  recommends review before D-102 builds further mouse-driven writes on the SAME interaction pattern
  — read "Read this first" item 1 before deciding to proceed anyway.
- **`AppState.interaction` is assigned in exactly ONE place: `withInteraction`.** It is what keeps
  `AppState.panels` pruned to the current selection (D-101 clause 6, D-106 clause 6). A future call
  site that assigns `interaction` directly (as three call sites did before entry 0107) SILENTLY
  reopens the bug D-105's own class of finding was about — a stale flag surviving a selection change
  nothing pointed at.
- **`renderDocument`'s `panelledObjectIds` and `selectedObjectIds` are DELIBERATELY two different
  lists** (D-106 clause 5) — do not collapse them back into one. The highlight pass reads
  `selectedObjectIds`; the name-suppression pass reads `panelledObjectIds`; a selected-but-dismissed
  object is in the first list and not the second, ON PURPOSE.
- **A panel's DOM element is NOT the thing to hang gesture state off of.** `updatePanels` rebuilds
  every panel whole on every paint (immediate-mode, same as the log and the canvas), so a listener
  or `setPointerCapture` bound to a specific header element is torn down mid-gesture. Entry 0107's
  drag tracks a closure variable (`panelDrag`) and continues on `window`; the dismiss/drag-start
  listeners are delegated on `panelsContainer`, never on a per-panel element. Read this before D-102
  adds row-level interactivity that might be tempted to bind a listener to a row that gets rebuilt.
- **`mouse.click(..., { modifiers: [...] })` in Playwright/Chromium does NOT set the corresponding
  modifier flag (e.g. `shiftKey`) on the synthesized `pointerdown` in at least one observed
  combination** — `page.keyboard.down("Shift")` / `up("Shift")` around a plain click does. Cost real
  time at entry 0107 (a shift-click test looked like a real `additive` regression until isolated).
  Relevant only if a future cycle scripts the browser again for verification.
- **A dismissed panel's object does NOT automatically un-dismiss on a plain click that merely
  narrows a multi-selection down to it** — only if the object actually LEFT the selection first
  (shift-click it out and back in, or escape and reselect, per D-106 clause 6's own words). Confirmed
  both in a unit test and live in a real browser at entry 0107; see its log's manual-verification
  step 6 and its second open question for the reviewer.
- **`placePropertiesPanel` needed NO change for N panels** — it takes the extent as an argument,
  which is exactly why D-094 clause 11 put it in `render/`. `main.ts`'s `placePanelElement` is the
  new wrapper that decides whether to call it at all (skipped outright for a DETACHED/dragged panel
  — D-101 clause 5's "no longer consulted," taken literally).
- **A drag notice dedupes by TEXT, per GESTURE** — `pointerDown` resets it, `pointerUp` discards
  it. Do NOT reach for `Date.now()` for this or anything else in `interaction.ts`; it is
  deterministic and every test depends on that (D-098's own rationale for rejecting a wall-clock
  throttle).
- **`describeSlotValue` must never be copied.** D-099 clause 1 gives it an optional `maxDecimals`
  instead. `renderer.ts`'s `formatCellValue` is already a second, disclosed formatter (D-099
  clause 5); `mutation.ts`'s `describeDimensionSlotValue` (entry 0101) is a narrow THIRD, scoped
  to one rejection message's "Got:" clause — not a display path, and not a precedent for adding a
  fourth anywhere else.
- **A test that passes on its FIRST run is not yet trusted — mutation-check it.** Entry 0107's own
  log names three such checks (the pruning helper, the `panelledObjectIds` split, the two no-op
  guards), each broken-then-reverted with the affected tests confirmed red then green.
- **`buildSlotDescriptors` is the ONE schema walk for display** (D-094 clause 9). N panels and
  `props` all read it. Before writing any other reader of `schema.nonDerivedSlotPaths`/
  `derivedSlots`, check whether it already answers the question.
- **An editable panel MUST NOT be rebuilt whole on every paint** (D-102 clause 8, still queued).
  Entry 0107's panels ARE still rebuilt whole every paint — correct for now, because nothing in
  them can hold focus yet. This becomes a live correctness requirement the moment D-102 adds a row
  text input, not before.
- **The panel writes through `executeCommand` and nothing else** (D-102 clause 5, still queued). Not
  `mutate`, not `writeSlot`. Entry 0107 added no write path of its own to document state — dismissal
  and manual position are APPLICATION state only (see the gotcha above on `withInteraction`).
- **`render/panel.ts` is PURE and tested; the panel DOM in `main.ts` is not.**
- **The panel is positioned in CSS pixels; `worldToScreen` returns BACKING pixels.** Divide by the
  ratio the canvas actually has (`canvas.width / bounds.width`), never `devicePixelRatio` by
  assumption. This has shipped as a bug once, in the other direction (entry 0091's pan speed).
- **The canvas is a FLEX CHILD, so nothing floats over it as written** — entry 0099 wrapped it in a
  `position: relative` `#stage`, and `index.html`'s header comment says so (D-065).
- **A properties panel is not a `table` object and must never be spoken of as one** (D-094 clause 1).
  It is DOM furniture; it never enters `state.document`, never goes through `mutate`, is never
  saved, never appears in `list`. **D-101 clause 7 says the same about a dragged panel's position,
  and D-106 clause 6 the same again about a dismissal.**
- **`main.ts` can be tested, and the trick is the bottom of the file** — the bootstrap is guarded on
  `typeof document !== "undefined"`.
- **The global `document` and `state.document` are different things.**
- **An object's non-derived slot paths are NOT a list you may render** — `resolveNonDerivedSlotPaths`
  on a large table returns 90,000–130,000 paths. Never spread a collection the user can size (D-077).
- **`origin` does not mean the same thing across object types** — a circle's/polygon's CENTRE, a
  rect's/table's TOP-LEFT CORNER. "Where is this object, visually" wants `objectExtent`.
- **A test that asserts an OFFSET cannot catch a wrong ANCHOR** (entries 0093/0094). When adding a
  positioned thing, pin the ABSOLUTE position for at least two geometries that differ.
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change fires.**
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it**
  (D-065).
- **`clampZoom` takes `(requestedZoom, fallbackZoom)`, not a camera.** · **An `effect` is a REQUEST,
  not a report** (D-082 clause 5). · **A pan gesture is not the `pan` command.** · **`command/` may
  not see a `CameraState`, a selection, or a DOM handle** (`render/panel.ts` may — it is `render/`).
  · **`parser.ts` validates the FORM of a number, not its usefulness.** · **A name §5.2 allows is not
  automatically a name §5.3 can READ (D-080).** · **`writeSlot` in `commands.ts` is the ONE place a
  slot is written by command**, and `withCamera` in `main.ts` the ONE place the camera is written. ·
  **A formula's SOURCE does not exist anywhere** — it is reconstructed from the AST against current
  names, every paint. · **`executeCommand` is the ONLY place a `Command` meets a `Document`
  (D-069)** — and D-102 clause 5 is what keeps that true once the panel can write. · **Find the
  recursion before you bound it** (entry 0087).
- **The operator cannot see what you can see.** The panel exists because that question kept going
  unasked. **The human's session at 0100 produced three ruled fixes (D-097/D-098/D-099), all three
  now built (entries 0101/0102) — the panel is what made all three visible in the first place.**
  Entry 0107 made that true for MORE THAN ONE object at once.
