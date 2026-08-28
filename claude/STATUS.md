# STATUS — as of entry 0100-REVIEW-phase4

STATE: **GREEN, and fully reviewed.** Both configs compile, **1191/1191** tests pass, 0 skipped,
0 `.only`, `npm run build` succeeds — re-run by the reviewer at 0100, matching entry 0099's claims
exactly. Entry **0099** (D-094's read-only properties panel) is **REVIEWED: ACCEPT**, no edits.

Current phase: **4 — cross-object linking, the validation moment.** **Phase 3 is PASSED and its gate
is CLOSED** (0091-REVIEW). Phase 4 is OPEN and NOT claimed.

Last review point: **0100-REVIEW-phase4** (ACCEPT; **D-097 through D-103** ruled).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files**.

**NEXT: entry 0101 builds D-097 — the vanishing table.** D-103 fixes the order of the next four
cycles and it is not negotiable; see "Next cycles".

## Read this first — the six things a cold reader needs

**1. THE HUMAN DROVE THE APPLICATION FOR THE FIRST TIME (at 0100) AND IT CHANGED THE QUEUE.** Their
verdict on the panel was "the properties tab is good." What the session produced instead was **one
real defect** (below) and **three product changes** that turn the panel from a display into an
authoring surface. All of it is ruled: **D-097** (the defect), **D-098** (log spam), **D-099**
(significant figures), **D-100/D-101/D-102** (multi-selection, N draggable panels, the paperclip),
**D-103** (the order). **Q-014 is CLOSED** — the human ruled the writing/linking half.

**2. THE DEFECT: A TABLE VANISHES WHEN ITS `rows` OR `cols` IS SET, AND THE WRITE SAYS IT WORKED.**
Four ways, all reproduced at 0100-REVIEW §6, all echoing success:

```
> set table_1.rows = 5     rows = {kind:"formula", value:5}    objectExtent -> undefined
> set table_1.rows 0       rows = {kind:"literal", value:0}    objectExtent -> undefined
> set table_1.rows -2      rows = {kind:"literal", value:-2}   objectExtent -> undefined
> set table_1.rows 2.5     rows = {kind:"literal", value:2.5}  objectExtent -> undefined
```

The table stops drawing, `fit` says *"nothing on the canvas has an extent to fit to"*, and `list`
still lists it. **D-046's fail-closed read is NOT the bug and does not move** — Rule 6 requires it.
The bug is that nothing refuses the WRITE: `commands.ts` bounds `rows`/`cols` at CREATION only
(D-070) and `set` goes through the generic `writeSlot` → `setSlot` path. **D-097** closes it in
`mutation.ts`, not in the `set` handler, because D-102 is about to add a second write path.

**3. THE PROPERTIES PANEL IS BUILT AND REVIEWED (entry 0099, ACCEPT at 0100).** D-094's fourteen
clauses, in `render/panel.ts` (`placePropertiesPanel` — pure, tested), `main.ts` (`buildPanelModel`
pure and tested; `writePanel`/`panelRowElement`/`updatePanel` the untested DOM half), `index.html`
(a `position: relative` `#stage` so `#panel` can overlay the canvas), and `renderer.ts` (the
selected object's canvas name label is suppressed — clause 3 — its badge and ticks still draw).
**It is READ-ONLY today and D-102 is what changes that.**

**4. Chrome hangs from the object's drawn EXTENT, and the bug it replaced is the standing lesson.**
Entry 0093 anchored chrome to `origin`, which is a circle's/polygon's CENTRE but a rect's/table's
TOP-LEFT CORNER, so a circle's label drew inside it. **Every test passed** — each asserted an
OFFSET from the anchor, and the defect was in what the anchor MEANT. Chrome now hangs from
`render/extent.ts`'s `objectExtent` top-centre.

**The lesson restated, because §6's defect is the same shape: it is not only untested code that is
at risk, it is code whose tests can only check what their author was already thinking about.**
`readTableDimension`'s fail-closed `0` HAS a test. Nobody tested the path that produces the `0`,
because everyone looking at that function was thinking about a malformed LOADED document, not about
a typed command.

**5. THE IMPORT CYCLE IS CLOSED (D-093, entry 0096).** `src/render/slots.ts` (`readNumber`,
`asPointArray`, `TABLE_CELL_*`) and `src/render/extent.ts` (`WorldExtent`, `objectExtent`,
`documentExtent`) hold the shared code; neither `renderer.ts` nor `hittest.ts` imports the other,
and `panel.ts` imports `./camera.ts` + `./extent.ts` only. **A new top-level cross-reference between
`renderer.ts` and `hittest.ts` is a regression of this fix.**

**6. `main.ts` is two halves and only one is tested.** `AppState` and every transition over it are
pure and tested (including `buildPanelModel`). `start` — the canvas, the listeners, the log, the
file picker, `updatePanel` and the panel DOM — has no test. **Every finding of the last several
reviews touched `start` or something only a running browser could show, and D-101/D-102 grow that
region substantially.** Treat any change there as unverified until someone clicks on it.

## Next cycles — D-103's order, and it is binding

1. **Entry 0101 — D-097, the vanishing table.** `mutation.ts` gains `findInvalidDimensionWrites`,
   simulated left-to-right over the batch like `findInvalidTableResizes` and `findInvalidRenames`.
   Refuses a dynamic-family sizing slot that is non-`literal`, non-number, non-integer, or outside
   `MIN_TABLE_LINES..MAX_TABLE_LINES`. **Those two constants MOVE to
   `engine/primitives/table.ts`** (authorised by D-097 clause 3, must be named in the log entry per
   D-096 clause 1) because `engine/` may not import `command/`. One test per row of D-097's table,
   each asserting the refusal AND that the document is bit-for-bit unchanged.
2. **Entry 0102 — D-098 + D-099.** Once-per-drag-gesture notices in `interaction.ts`'s `DragState`;
   `describeSlotValue` gains an optional `maxDecimals` that only `buildPanelModel` passes. Small,
   independent, unrelated to each other.
3. **Entry 0103 — D-100, the selection becomes a list.** `selectedObjectIds: readonly string[]`
   across `interaction.ts`, `renderer.ts`, `main.ts`. Plain click replaces, shift-click adds,
   escape clears. **Review point at its end** (D-100 clause 9) — it changes a state shape every
   prior cycle was written against, and every test that builds an `InteractionState`.
4. **Entry 0104 — D-101, N panels, draggable.** Then **entry 0105 — D-102, the paperclip and
   editing**, which gets its own review point regardless of the batch cap.

**Still queued behind all of that, unchanged:** D-090's prompt-sequence preview · D-088 clauses 2–4
and D-089 (the command input's behaviour) · §5.11's load boundary in `document.ts` (D-083 clause 4's
depth check, D-081's `createObject` name gate, whose pinned "duplicate DOES commit" test must FLIP).

**A human session is still owed for Phase 4's own gate** — two polygons bound through a table, in
one document. Everything above makes that session easier; none of it IS that session.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · table primitive through row/column insert/delete and
`delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit (0058) ·
`primitives/geometry.ts` (0060) · `render/renderer.ts`'s original body/table drawing (0062, widened
by 0093/0094) · `render/hittest.ts` (0064) · entry 0065's header audit · `render/interaction.ts`
(0067) · `command/parser.ts` (0069) · `command/prompt.ts` + D-071's formula path (0071) · entries
0072–0073's fix-list work (0074) · `command/commands.ts`'s seam and its four creation handlers,
`document.ts`'s `mintObjectId`, `TABLE_SCHEMA`'s `origin.x`/`origin.y` (0078) · `commands.ts`'s four
slot commands through one `writeSlot` path, `engine/formula/format.ts` (0080) · `commands.ts`'s
`delete`/`refs`/`list` (0082) · `mutation.ts`'s `RenameObjectOperation` + `findInvalidRenames`,
`commands.ts`'s `rename` (0084) · `CommandEffect` and the five effect handlers (0086) · the two
formula depth limits (0088) · `main.ts` rewritten from the stub, `render/camera.ts`'s
`clampCamera`/`clampZoom`, `render/hittest.ts`'s `documentExtent` (moved to `render/extent.ts` at
0096), `index.html` (0089, reviewed 0090/0091) · entry 0093's selection highlight / error badge /
formula-driven indicator (D-068) and D-092 clause 1's name label, entry 0094's chrome-anchor fix
(0095-REVIEW, ACCEPT) · entry 0096's `render/slots.ts` + `render/extent.ts` split (D-093) and entry
0097's `command/props.ts` + `props` command (0098-REVIEW, ACCEPT WITH EDITS; D-096) · **entry 0099's
`render/panel.ts` + `buildPanelModel` + the panel DOM + clause 3's name suppression — REVIEWED:
ACCEPT at 0100-REVIEW, no edits.**

## Nothing is unreviewed

The working tree is clean and every entry through 0099 has a verdict. Entry 0101 starts from a
reviewed baseline.

## Not started

**D-097 through D-103, all of them** · D-090's prompt-sequence preview · §5.9's per-vertex drag
path · `polyline`/`explode`/`addvertex`/`delvertex` · `style` slots · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar / in-place cell editing · §5.11's load-boundary validation
(D-081, D-083 clause 4) · D-088 clauses 2–4 · D-089 · Phases 5–7.

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
   Owned by whichever cycle next opens `drawObjectChrome` — D-100 clause 8 will.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED**
    now that `props.ts` exists (0095-REVIEW §4).
11. **The panel's `overflow: auto` scroll position resets on every paint**, because
    `replaceChildren` rebuilds the rows and paint runs on every pointer move (0100-REVIEW §3).
    **Superseded for the editing case by D-102 clause 8**, which must solve the general form.
12. **A right-flipped panel that hits the right clamp overlaps its own object** (0100-REVIEW §3).
    Correct per D-094 clause 11 as written; revisit only if the human asks after seeing it.

## Known problems (detail lives where the pointer says)

- **A TABLE VANISHES WHEN ITS DIMENSION IS SET TO A FORMULA, `0`, A NEGATIVE, OR A NON-INTEGER** —
  the defect above. **Ruled D-097, entry 0101's whole slice.** Until it lands, `set <table>.rows`
  is a trap.
- **`main.ts`'s `start` is untested code and D-101/D-102 will grow it substantially** — every
  listener, the canvas sizing, the log rewrite, the file picker, the selection hand-off,
  `updatePanel`, and soon N panels with drag and text inputs. 0090-REVIEW found four defects here
  and none elsewhere.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
  D-094 does not ask for hiding it and the selection highlight is equally off-screen — consistent,
  not fixed on suspicion (Rule 5).
- **The chrome layout is still UNSEEN beyond entry 0094's anchor fix.** Labels of two adjacent
  objects can still overlap — **D-095 says build no collision avoidance until a human asks, and
  D-101 clause 3 extends that stance to panels.**
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses
  2–4 not built. **There is no command history** (**D-089**, queued).
- **A hand-edited saved file can throw a `RangeError` out of the Load button** — fix-list item 1.
- **Every pointer move repaints the canvas, rewrites the whole log's `textContent`, and rebuilds the
  panel DOM whole.** Immediate-mode. Unmeasured and acceptable today (Rule 5) — **but D-102 clause 8
  makes it a correctness problem the moment a text input is open, and that clause is binding.**
- **`escape` is bound to the window**, so it cancels a live prompt from anywhere. **D-100 clause 5
  and D-102 clause 7 give it a third duty and an innermost-first order** — input, then prompt, then
  selection.
- **`zoom`'s echoed line names the REQUEST and `main.ts` adds a second line with the RESULT** —
  deliberate, D-082 clause 5.
- **`format.ts`'s elision does not re-parse** — a disclosed exception to the round-trip property.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046) — a state
  **D-097 makes unreachable by command**, though a loaded file can still carry it, so the refusal
  stays.
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
  deliberately** — the human chose panel-only rounding, so on-canvas cell text keeps full precision
  and the two now disagree on purpose. Reconciling them is its own slice and needs its own ask.
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name ·
  comment debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`)
  · dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off
  · `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-103**) binds without restatement here.

**From 0100-REVIEW — D-097 through D-103, all seven:** (**D-097**) a dynamic-family sizing slot is
bounded at EVERY write, in `mutation.ts`, not only at creation · (**D-098**) a drag notice is
emitted once per drag GESTURE, deduplicated in `DragState`, NOT on a wall clock · (**D-099**) the
panel rounds a displayed number to at most 4 decimals through an optional argument on the ONE
formatter, and a non-zero value that rounds to zero shows in exponential form · (**D-100**) the
selection is a list; plain click replaces, shift-click adds, escape clears; D-094 clause 3
generalises to every selected object · (**D-101**) one panel per selected object, dragged by its
header, detaching until deselected, with no collision avoidance · (**D-102**) the panel becomes
writable, `pointer-events: none` is lifted, the paperclip is blue for a `formula` slot and grey for
a `literal` one, and **every panel write goes through `executeCommand`, never `mutate`** ·
(**D-103**) the order those are built in.

**Q-014 IS CLOSED → D-102.** The human ruled the writing/linking half at entry 0100. §5.10's "no
panels, no toolbars" now carries one amendment, made twice by the same human: a display panel
(D-094) that is also an authoring surface (D-102). **Q-013 is NOT mooted** — `set <address> =
<formula>` stays the spelling and D-102 clause 6 reuses it verbatim.

**D-094's fourteen clauses stand, with clause 10 amended by D-102 clause 1 and clause 3 generalised
by D-100 clause 8.** Everything else in it is unchanged and IMPLEMENTED at entry 0099.

**From 0098-REVIEW — D-096, four clauses:** (1) a ruling's file/move list is a CEILING, its
rationale governs a divergence, and a divergence **must be named in the log entry** — **this worked
on its first cycle in force** (entry 0099 disclosed its fifth argument unprompted); (2) the table
`cells` summary keeps `kind: "literal"` and `SlotDescriptor` grows no fourth kind — **the optional
`synthetic?: true` that ruling deferred is now D-102 clause 2's, and entry 0105 is the cycle that
adds and reads it**; (3) a new `dynamic` group MUST add its own summary branch in `props.ts` in the
same cycle — **D-097 clause 6 extends that duty to the write check**; (4) `props`'s registry
position and unknown-name message stand.

**From 0095-REVIEW — D-093** (the `render/` split — IMPLEMENTED at 0096) · **D-094** (the panel —
IMPLEMENTED at 0099) · **D-095** (chrome hangs from the extent's top-centre; **no inter-object label
collision avoidance is to be built** — extended to panels by D-101 clause 3).

**From 0091-REVIEW (the human's session):** **D-088** (clause 1 built, 2–4 queued) · **D-089**
(queued) · **D-090** (queued) · **D-091** (the grey grid stands).

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
D-097 adds the write-time refusal that should always have been beside it; it does not weaken the
read. Anyone tempted to "fix" the vanishing table by honouring a formula dimension's cached value
is about to violate Rule 6 — read D-046's rationale first.

**Superseded in part: D-086 clause 2's "one backing pixel is one CSS pixel"** — the backing store
matches the DISPLAY, and clause 3's conversion is built at `screenPointOf` and, since entry 0099, in
the other direction inside `placePropertiesPanel`.

**From 0090-REVIEW, all four implemented:** **D-084** · **D-085** · **D-086** · **D-087**.
**From entry 0089:** **D-075**/**D-082** · **D-062** · **D-061** · **D-066** · **D-072** ·
**D-027 clause 2**. Still owed, unchanged: **D-074** · **D-081** · **D-083 clause 4**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** and **`src/render/slots.ts`**
(`DEFAULT_SHAPE_STROKE_WIDTH`, `TABLE_CELL_*`, `SELECTION_HIGHLIGHT_WIDTH`): world units or screen
pixels? Provisional (a) world units. Due with the `style`-slots cycle. `PANEL_OBJECT_GAP_CSS` does
NOT take a side — it is CSS pixels by a stated reason.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.

**`PROVISIONAL(Q-015)` → `src/render/interaction.ts`, to be added by entry 0103.** Does a
shift-click on an ALREADY-SELECTED object REMOVE it from the selection? Provisional (a) yes, the
conventional toggle, ruled provisionally as D-100 clause 4. The human's to settle; blocking nothing.

**Q-014 is CLOSED (→ D-102).** Next free: **Q-016**.

## Gotchas for the next model

- **`set <table>.rows` is a trap until D-097 lands.** Four accepted writes make the table invisible
  and every one of them echoes success. Do not "fix" it in `objectExtent` or in `readTableDimension`
  — the refusal goes in `mutation.ts` (D-097 clause 2).
- **`MIN_TABLE_LINES`/`MAX_TABLE_LINES` are about to move** from `command/commands.ts` to
  `engine/primitives/table.ts` (D-097 clause 3), because `engine/` may not import `command/`.
- **A drag notice fires per pointer EVENT today.** D-098 dedupes it in `DragState` — do not reach
  for `Date.now()`; `interaction.ts` is deterministic and every test depends on that.
- **`describeSlotValue` must never be copied.** D-099 clause 1 gives it an optional `maxDecimals`
  instead. `renderer.ts`'s `formatCellValue` is already a second formatter, disclosed and
  deliberately unreconciled (D-099 clause 5). A THIRD is forbidden.
- **`placePropertiesPanel` needs NO change for N panels** — it takes the extent as an argument,
  which is exactly why D-094 clause 11 put it in `render/`.
- **`buildSlotDescriptors` is the ONE schema walk for display** (D-094 clause 9). N panels and
  `props` all read it. Before writing any other reader of `schema.nonDerivedSlotPaths`/
  `derivedSlots`, check whether it already answers the question.
- **An editable panel MUST NOT be rebuilt whole on every paint** (D-102 clause 8). `updatePanel` →
  `writePanel` → `replaceChildren` runs on every pointer move; an open input would lose focus and
  the caret on the first mouse twitch. Correctness, not performance.
- **The panel writes through `executeCommand` and nothing else** (D-102 clause 5). Not `mutate`,
  not `writeSlot`. That is what makes an editable panel cheap: it inherits every refusal for free.
- **`render/panel.ts` is PURE and tested; the panel DOM in `main.ts` is not.**
- **The panel is positioned in CSS pixels; `worldToScreen` returns BACKING pixels.** Divide by the
  ratio the canvas actually has (`canvas.width / bounds.width`), never `devicePixelRatio` by
  assumption. This has shipped as a bug once, in the other direction (entry 0091's pan speed).
- **The canvas is a FLEX CHILD, so nothing floats over it as written** — entry 0099 wrapped it in a
  `position: relative` `#stage`, and `index.html`'s header comment says so (D-065).
- **A properties panel is not a `table` object and must never be spoken of as one** (D-094 clause 1).
  It is DOM furniture; it never enters `state.document`, never goes through `mutate`, is never
  saved, never appears in `list`. **D-101 clause 7 says the same about a dragged panel's position.**
- **`main.ts` can be tested, and the trick is the bottom of the file** — the bootstrap is guarded on
  `typeof document !== "undefined"`.
- **The global `document` and `state.document` are different things.**
- **An object's non-derived slot paths are NOT a list you may render** — `resolveNonDerivedSlotPaths`
  on a large table returns 90,000–130,000 paths. Never spread a collection the user can size (D-077).
- **`origin` does not mean the same thing across object types** — a circle's/polygon's CENTRE, a
  rect's/table's TOP-LEFT CORNER. "Where is this object, visually" wants `objectExtent`.
- **A test that asserts an OFFSET cannot catch a wrong ANCHOR** (entries 0093/0094). When adding a
  positioned thing, pin the ABSOLUTE position for at least two geometries that differ.
- **Mutation-check a suite that passes first try — and check the checker.** Strip ANSI and assert on
  the `Tests N failed` line.
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
  unasked. **The human's session at 0100 is the second time it has paid off, and the vanishing table
  is what 1191 passing tests looked like from the inside.**
