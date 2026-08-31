# STATUS — as of entry 0104-selection-becomes-a-list

STATE: **BLOCKED — awaiting review.** Both configs compile, **1223/1223** tests pass, 0 skipped, 0
`.only`, `npm run build` succeeds — the tree is GREEN — but entry **0104** built **D-100** (the
selection becomes a list), and D-100 clause 9 fires a mandatory review point at that cycle's OWN
end regardless of the batch cap. **Do not start D-101 before this review lands.**

Current phase: **4 — cross-object linking, the validation moment.** **Phase 3 is PASSED and its gate
is CLOSED** (0091-REVIEW). Phase 4 is OPEN and NOT claimed.

Last review point: **0103-REVIEW-phase4** (ACCEPT WITH EDITS; **D-104** ruled). Entry **0104** is
built and green but NOT yet reviewed.
Cycles since last review: **1/3** · diff since last review: ~384 lines / 8 files (entry 0104).
**REVIEW: REQUIRED** — D-100 clause 9's own trigger, not the batch cap (1/3, well under it).

## Read this first — the eight things a cold reader needs

**1. THE HUMAN DROVE THE APPLICATION FOR THE FIRST TIME (at 0100) AND IT CHANGED THE QUEUE.** Their
verdict on the panel was "the properties tab is good." What the session produced instead was **one
real defect** (fixed at 0101) and **three product changes** that turn the panel from a display into
an authoring surface. All of it is ruled: **D-097** (the defect, DONE), **D-098** (log spam, DONE),
**D-099** (significant figures, DONE), **D-100** (multi-selection, BUILT at 0104, awaiting review),
**D-101/D-102** (N draggable panels, the paperclip — still queued), **D-103** (the order). **Q-014
is CLOSED** — the human ruled the writing/linking half.

**2. THAT BATCH WAS REVIEWED AND CLEARED (0103-REVIEW-phase4, ACCEPT WITH EDITS); ENTRY 0104 IS THE
NEXT ONE AND IT IS NOT YET REVIEWED.** Entry 0101 fixed D-097 (the vanishing table). Entry 0102
built D-098 (a drag notice is deduplicated per GESTURE, not per pointer sample) and D-099 (the
properties panel rounds a displayed number to at most 4 decimals; `props` does not). That review
re-ran both configs and the suite, matched the logs against the diff, made two documentation edits,
and ruled **D-104** — see item 7 below. Entry **0104** then built **D-100** (the selection becomes a
list) and stopped for review per D-100 clause 9 — see item 8 below. **The next model's job is to
wait for that review, then build entry 0105, D-101 — do not start it unreviewed.**

**3. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101).** `mutation.ts`'s `findInvalidDimensionWrites`
rejects a `setSlot` that would leave `table`'s `rows`/`cols` non-`literal`, non-number,
non-integer, or outside `MIN_TABLE_LINES..MAX_TABLE_LINES` (now in `engine/primitives/table.ts`,
moved from `command/commands.ts` per D-097 clause 3). All four of 0100-REVIEW §6's repro lines
(`set table_1.rows = 5` / `0` / `-2` / `2.5`) now refuse, pinned both as engine-level `mutate` tests
and end to end through the real typed lines.

**4. A DRAG NOTICE FIRES ONCE PER GESTURE NOW, NOT ONCE PER POINTER SAMPLE (entry 0102, D-098).**
`render/interaction.ts`'s `DragState` carries `emittedNotices: readonly string[]` — every notice
TEXT already surfaced this gesture. `pointerDown` starts it empty; `pointerMove` filters against it
and widens it (on the mutate-success AND mutate-rejection paths alike — only the rejection MESSAGE
itself stays undeduplicated); `pointerUp` discards it with the rest of the drag.

**5. THE PROPERTIES PANEL ROUNDS A NUMBER TO 4 DECIMALS; `props` STILL SHOWS FULL PRECISION (entry
0102, D-099).** `command/props.ts`'s `describeSlotValue` gained one optional `{ maxDecimals }`
argument — `main.ts`'s `buildPanelModel` is the ONLY caller that passes `{ maxDecimals: 4 }`.
Rounds AND trims trailing zeros (`10`, never `10.0000`); a non-zero value that would round to `0`
shows in exponential form instead (`1.2246e-16`) so float dust never reads as an outright lie.
`renderer.ts`'s `formatCellValue` stays a disclosed, DELIBERATELY unreconciled second formatter —
on-canvas cell text keeps full precision.

**6. THE PROPERTIES PANEL ITSELF IS BUILT AND REVIEWED (entry 0099, ACCEPT at 0100); IT IS STILL
READ-ONLY.** D-094's fourteen clauses, in `render/panel.ts`, `main.ts`'s `buildPanelModel`
(pure, tested) and the untested DOM half, `index.html`, `renderer.ts`. **D-102 is what makes it
writable, and it has not started.**

**7. D-104 IS STILL OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED YET.** D-097 closed the
vanishing table for a `setSlot`. `insertTableLine`/`deleteTableLine` write the SAME two slots and
`findInvalidTableResizes` bounds only their INDEX — so a `deleteTableLine` on a one-row table still
lands `rows` on `0`. **Not reachable by any command today** (§5.10's row/column commands are
unbuilt), disclosed in two file headers, and **D-104 binds the cycle that builds those commands** to
close the floor inside `findInvalidTableResizes`. Do NOT widen
`findInvalidDimensionWrites` for it — D-104 clause 3 says so explicitly. Untouched by entry 0104.

**8. ENTRY 0104 BUILT D-100 AND IS AWAITING REVIEW — READ ITS OWN LOG BEFORE TOUCHING
`interaction.ts`, `renderer.ts`, OR `main.ts`.** `InteractionState.selectedObjectId: string |
undefined` is now `selectedObjectIds: readonly string[]`. `pointerDown` is reordered (`state` is now
its first argument) and gains `additive: boolean = false` (the shift key): a plain click replaces
the selection or clears it on empty canvas, a shift-click adds the hit object or — PROVISIONAL,
**Q-015** — removes it if already selected, and a shift-click on empty canvas changes nothing. A
drag always arms on the object under the press, even one a shift-click just toggled OUT of the
selection (entry 0104's own reading of clause 6, not yet human-confirmed). `renderDocument`'s
trailing parameter is the same list, defaulted to `[]`; every selected object is now highlighted and
has its name suppressed, not just one. **The properties panel stays ONE panel this cycle** — shown
only for a selection of exactly one, hidden for zero or two-or-more — because D-101 (N panels) is
the next queued cycle and building interim multi-panel behaviour now would be thrown away. `select
<name>` is UNCHANGED: it still replaces the whole selection with one object (D-100 clause 7); no
command-line multi-select syntax exists.

## Next cycles — D-103's order, and it is binding

Numbering shifted by two total now: the phase-4 review took entry 0103, D-100 took entry 0104, so
D-101 is entry **0105**.

1. ~~**Entry 0101 — D-097, the vanishing table.**~~ **DONE.** See "Read this first" item 3.
2. ~~**Entry 0102 — D-098 + D-099.**~~ **DONE.** See "Read this first" items 4–5.
3. ~~**Entry 0104 — D-100, the selection becomes a list.**~~ **BUILT, NOT YET REVIEWED.** See "Read
   this first" item 8. **A review of entry 0104 must land before entry 0105 starts** (D-100 clause
   9 — this is not a batch-cap stop, it is unconditional).
4. **Entry 0105 — D-101, N panels, draggable.** Then **entry 0106 — D-102, the paperclip and
   editing**, which gets its own review point regardless of the batch cap. Both are written against
   a selection that can hold more than one object, so both need D-100 actually reviewed first, not
   merely built.

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
(0067, its D-098 widening at 0102 reviewed at 0103) · `command/parser.ts` (0069) ·
`command/prompt.ts` + D-071's formula path (0071) · entries 0072–0073's fix-list work (0074) ·
`command/commands.ts`'s seam and its four creation handlers, `document.ts`'s `mintObjectId`,
`TABLE_SCHEMA`'s `origin.x`/`origin.y` (0078) · `commands.ts`'s four slot commands through one
`writeSlot` path, `engine/formula/format.ts` (0080) · `commands.ts`'s `delete`/`refs`/`list` (0082) ·
`mutation.ts`'s `RenameObjectOperation` + `findInvalidRenames`, `commands.ts`'s `rename` (0084) ·
`CommandEffect` and the five effect handlers (0086) · the two formula depth limits (0088) ·
`main.ts` rewritten from the stub, `render/camera.ts`'s `clampCamera`/`clampZoom`,
`render/hittest.ts`'s `documentExtent` (moved to `render/extent.ts` at 0096), `index.html` (0089,
reviewed 0090/0091) · entry 0093's selection highlight / error badge / formula-driven indicator
(D-068) and D-092 clause 1's name label, entry 0094's chrome-anchor fix (0095-REVIEW, ACCEPT) ·
entry 0096's `render/slots.ts` + `render/extent.ts` split (D-093) and entry 0097's `command/props.ts`
+ `props` command (0098-REVIEW, ACCEPT WITH EDITS; D-096, its D-099 widening at 0102 reviewed at
0103) · entry 0099's `render/panel.ts` + `buildPanelModel` + the panel DOM + clause
3's name suppression (REVIEWED: ACCEPT at 0100-REVIEW, no edits; its D-099 widening at 0102 reviewed
at 0103).

## Reviewed at 0103-REVIEW-phase4 (ACCEPT WITH EDITS)

**Entry 0101 — D-097, the vanishing table.** `mutation.ts`'s `findInvalidDimensionWrites`;
`MIN_TABLE_LINES`/`MAX_TABLE_LINES` moved to `engine/primitives/table.ts`; `commands.ts` updated to
import rather than declare them; tests in both `mutation.test.ts` and `commands.test.ts`.

**Entry 0102 — D-098 + D-099.** `interaction.ts`'s `DragState.emittedNotices` and the
`widenEmittedNotices` dedup in `pointerMove`; `props.ts`'s `describeSlotValue({ maxDecimals })` and
`formatDisplayNumber`; `main.ts`'s `buildPanelModel` passing `{ maxDecimals: 4 }`. Tests in
`interaction.test.ts`, `props.test.ts`, `main.test.ts`.

**Reviewer's edits at 0103-REVIEW (documentation only, no behaviour changed):** a `NOT DONE HERE`
bullet in `engine/primitives/table.ts` and a paragraph on `findInvalidDimensionWrites`'s doc
comment, both disclosing D-104's gap.

## Built this batch, not yet reviewed

**Entry 0104 — D-100, the selection becomes a list.** `render/interaction.ts`'s `InteractionState.
selectedObjectIds: readonly string[]`, `pointerDown`'s reordered signature and its new `additive`
parameter, `toggleSelection` (PROVISIONAL(Q-015)); `render/renderer.ts`'s `renderDocument` over the
whole list, for both the highlight pass and the chrome name-suppression pass; `main.ts`'s
`performEffect`'s `"select"` case, `pointerDownAt`'s `additive` parameter and the DOM listener's
`event.shiftKey`, and `updatePanel`'s single-panel-only-for-exactly-one-selected reading. Tests in
`interaction.test.ts`, `renderer.test.ts`, `main.test.ts`, plus one call-site fix in
`commands.test.ts`. **Cycles since last review: 1/3 — but D-100 clause 9 forces review regardless.**

## Not started

**D-101 through D-103** · D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
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
   **Entry 0104 opened `drawObjectChrome`'s call site (D-100 clause 8) but did not fix this** — the
   change there was only which objects count as selected, not the function's own state-leak. Still
   owned by whichever cycle actually addresses it.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED**
    now that `props.ts` exists (0095-REVIEW §4).
11. **The panel's `overflow: auto` scroll position resets on every paint**, because
    `replaceChildren` rebuilds the rows and paint runs on every pointer move (0100-REVIEW §3).
    **Superseded for the editing case by D-102 clause 8**, which must solve the general form.
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

Every ruling in `DECISIONS.md` (D-001 through **D-104**) binds without restatement here.

**D-097, D-098, D-099 are all IMPLEMENTED AND REVIEWED** — entries 0101 and 0102, cleared at
0103-REVIEW-phase4 (ACCEPT WITH EDITS). Do not re-attempt or duplicate any of them.

**D-104 is NEW and NOT implemented** (0103-REVIEW). It is not owed by the next cycle — it is owed by
the cycle that builds §5.10's row/column commands. See "Read this first" item 7 and fix-list 13.

**From 0100-REVIEW — D-100 through D-103:** (**D-100**) the selection is a list; plain click
replaces, shift-click adds, escape clears; D-094 clause 3 generalises to every selected object —
**BUILT at entry 0104, awaiting review; do not re-build it** · (**D-101**, queued) one panel per
selected object, dragged by its header, detaching until deselected, with no collision avoidance ·
(**D-102**, queued) the panel becomes writable, `pointer-events: none` is lifted, the paperclip is
blue for a `formula` slot and grey for a `literal` one, and **every panel write goes through
`executeCommand`, never `mutate`** · (**D-103**) the order those are built in.

**Q-014 IS CLOSED → D-102.** The human ruled the writing/linking half at entry 0100. §5.10's "no
panels, no toolbars" now carries one amendment, made twice by the same human: a display panel
(D-094) that is also an authoring surface (D-102). **Q-013 is NOT mooted** — `set <address> =
<formula>` stays the spelling and D-102 clause 6 reuses it verbatim.

**D-094's fourteen clauses stand, with clause 10 amended by D-102 clause 1 and clause 3 generalised
by D-100 clause 8.** Everything else in it is unchanged and IMPLEMENTED at entry 0099.

**From 0098-REVIEW — D-096, four clauses:** (1) a ruling's file/move list is a CEILING, its
rationale governs a divergence, and a divergence **must be named in the log entry** — entry 0099
disclosed its fifth argument unprompted, entry 0101 named its own divergence (a new formatter
instead of reusing `describeIllegalValue`), and entry 0102 did the same (boolean split from number
in `describeSlotValue`'s switch); (2) the table `cells` summary keeps `kind: "literal"` and
`SlotDescriptor` grows no fourth kind — **the optional `synthetic?: true` that ruling deferred is
now D-102 clause 2's, and entry 0105 is the cycle that adds and reads it**; (3) a new `dynamic`
group MUST add its own summary branch in `props.ts` in the same cycle — **D-097 clause 6 extends
that duty to the write check, which entry 0101 satisfies for `table`'s own `cells.*` family (the
only one that exists)**; (4) `props`'s registry position and unknown-name message stand.

**From 0095-REVIEW — D-093** (the `render/` split — IMPLEMENTED at 0096) · **D-094** (the panel —
IMPLEMENTED at 0099) · **D-095** (chrome hangs from the extent's top-centre; **no inter-object label
collision avoidance is to be built** — extended to panels by D-101 clause 3).

**From 0091-REVIEW (the human's session):** **D-088** (clause 1 built, 2–4 queued) · **D-089**
(queued) · **D-090** (queued) · **D-091** (the grey grid stands).

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
D-097's write-time refusal (entry 0101) sits BESIDE that read, not inside it, and does not weaken
it. Anyone tempted to "fix" a future dimension bug by honouring a formula dimension's cached value
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

**`PROVISIONAL(Q-015)` → `src/render/interaction.ts`'s `toggleSelection`, added at entry 0104.** Does
a shift-click on an ALREADY-SELECTED object REMOVE it from the selection? Provisional (a) yes, the
conventional toggle, ruled provisionally as D-100 clause 4, now actually built that way. The
human's to settle; blocking nothing; reversible in one branch and one test if overruled.

**Q-014 is CLOSED (→ D-102).** Next free: **Q-016**.

## Gotchas for the next model

- **ENTRY 0104 IS BUILT BUT UNREVIEWED — DO NOT START D-101 UNTIL A REVIEW OF 0104 LANDS.** D-100
  clause 9 makes this an unconditional stop, not a batch-cap one (the counter is only 1/3). If you
  are the reviewer: the diff is `interaction.ts`/`renderer.ts`/`main.ts` (plus their tests) and
  entry 0104's log names every decision and every mutation-check it ran.
- **`pointerDown`'s signature changed shape, not just its selection field's type.** `state` is now
  its FIRST argument (matching `pointerMove`'s own order) and it gained a fifth, defaulted
  `additive: boolean = false` parameter — the shift key. Any code (or memory) still calling it as
  `pointerDown(screenPoint, objects, camera)` is now calling the wrong overload of nothing and will
  fail to compile, loudly.
- **A drag arms on the object under the press even when a shift-click just toggled it OUT of the
  selection** — entry 0104's own reading of D-100 clause 6, not yet human-confirmed. If the human
  disagrees, it is one branch and one test in `pointerDown` to change.
- **The properties panel is STILL ONE PANEL** after entry 0104 — a selection of exactly one shows
  it, zero or two-or-more hides it. This is a deliberate placeholder for D-101, not an attempt at
  real multi-panel behaviour; do not treat the "hide on multi-select" reading as anything but
  interim.
- **A SIZING SLOT'S BOUND MUST HOLD AT EVERY PATH THAT WRITES IT**, not just the one a ruling
  names (D-104's general form). D-097 was built for `setSlot` and `insertTableLine`/
  `deleteTableLine` were missed because nothing pointed at them. When you bound a value, enumerate
  the WRITERS, not the commands.
- **D-097, D-098, D-099 are all CLOSED — do not re-fix any of them.** `mutation.ts`'s
  `findInvalidDimensionWrites` (rows/cols write-time bound), `interaction.ts`'s per-gesture notice
  dedup (`DragState.emittedNotices`), and `props.ts`'s `describeSlotValue({ maxDecimals })` are all
  built, tested, and mutation-checked (see entries 0101/0102 for the exact before/after failure
  counts each mutation-check produced).
- **`MIN_TABLE_LINES`/`MAX_TABLE_LINES` now live in `engine/primitives/table.ts`**, not
  `command/commands.ts` (D-097 clause 3 — `engine/` may not import `command/`). `commands.ts`
  imports them; nothing re-declares them.
- **A drag notice dedupes by TEXT, per GESTURE** — `pointerDown` resets it, `pointerUp` discards
  it. Do NOT reach for `Date.now()` for this or anything else in `interaction.ts`; it is
  deterministic and every test depends on that (D-098's own rationale for rejecting a wall-clock
  throttle).
- **`describeSlotValue` must never be copied.** D-099 clause 1 gives it an optional `maxDecimals`
  instead. `renderer.ts`'s `formatCellValue` is already a second, disclosed formatter (D-099
  clause 5); `mutation.ts`'s `describeDimensionSlotValue` (entry 0101) is a narrow THIRD, scoped
  to one rejection message's "Got:" clause — not a display path, and not a precedent for adding a
  fourth anywhere else.
- **A test that passes on its FIRST run is not yet trusted — mutation-check it.** Entry 0102's own
  log names a real near-miss: a dedup test moved the pointer along Y only between two samples, so
  X's zero delta skipped the component before it could even produce a notice, and the test passed
  whether or not the dedup fix existed. Caught only by temporarily disabling the fix and watching
  for red.
- **`placePropertiesPanel` needs NO change for N panels** — it takes the extent as an argument,
  which is exactly why D-094 clause 11 put it in `render/`.
- **`buildSlotDescriptors` is the ONE schema walk for display** (D-094 clause 9). N panels and
  `props` all read it. Before writing any other reader of `schema.nonDerivedSlotPaths`/
  `derivedSlots`, check whether it already answers the question.
- **An editable panel MUST NOT be rebuilt whole on every paint** (D-102 clause 8). `updatePanel` →
  `writePanel` → `replaceChildren` runs on every pointer move; an open input would lose focus and
  the caret on the first mouse twitch. Correctness, not performance.
- **The panel writes through `executeCommand` and nothing else** (D-102 clause 5). Not `mutate`,
  not `writeSlot`. That is what makes an editable panel cheap: it inherits every refusal for free —
  D-097's included, automatically, once D-102 lands.
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
