# STATUS — as of entry 0109

STATE: **GREEN** (compiles, all tests pass). Both configs compile, **1244/1244** tests pass, 0
skipped, 0 `.only`, `npm run build` succeeds. Entry **0109** built **D-102** — the properties panel
becomes WRITABLE: a paperclip per modifiable row (blue for `formula`, grey for `literal`), every
write the `Command` the command line would have built, run through `executeCommand`. **This is a
MANDATORY review point (D-103 clause 4) — REVIEW: REQUIRED, regardless of the batch cap.**

Current phase: **4 — cross-object linking, the validation moment.** **Phase 3 is PASSED and its gate
is CLOSED** (0091-REVIEW). Phase 4 is OPEN and NOT claimed.

Last review point: **0105-REVIEW-phase4** (ACCEPT WITH EDITS; **D-105** ruled). Entries 0106-RULINGS
(the human, no code), 0107 (D-101+D-106), 0108 (verdict correction, no code), and 0109 (D-102,
**this entry**) all landed since, with NO review point in between.
Cycles since last review: **3/3 — the cap, AND D-103 clause 4, both fire on this same entry.**
Cumulative diff since 0105-REVIEW (excluding `claude/`): **960 insertions, 102 deletions across
exactly 10 files** — `git diff --stat 052f156 -- . ':!claude'`. That is over the 800-line half of
the cap and exactly at the 10-file half; either alone would have forced a review here even without
D-103 clause 4's own mandatory trigger. Both point the same direction: **stop, and get this reviewed
before any further cycle.**

## Read this first — the ten things a cold reader needs

**1. ENTRY 0109 BUILT D-102. REVIEW: REQUIRED — do not build anything else before this is reviewed.**
D-103 clause 4 names this cycle by description ("D-102 is the first code in this project that writes
state from a mouse gesture in the DOM") and the batch cap is independently exceeded (see above). Both
`commitPanelEdit`/`unlinkPanelSlot` (the pure, tested half — six new tests) and the DOM half
(`openEditor`, `panelEditHandlers`, `panelClipElement`, `panelEditInput`, the extended click delegate)
are built. Read entry 0109's own log in full — in particular its Decision 2 (a self-caught bug: the
naive "skip rebuild while editing" gate would have frozen every panel after its first paint, fixed
before it ever ran) and its two questions for the reviewer.

**2. D-102 IS FULLY BUILT — DO NOT RE-BUILD IT.** Every clause: pointer-events lifted off the whole
panel body (clause 1, disclosed cost: a panel can now block clicks on the part of its object it
overlaps — D-101 clause 5's drag is the remedy); a paperclip on every modifiable, non-`synthetic` row
(clause 2 — `SlotDescriptor` gained `readonly synthetic?: true`, set only on the table's `cells`
summary row, D-096 clause 2's deferred field, now read); bold blue / faded grey by `kind` (clause 3);
blue unlinks immediately, grey opens a seeded input (clause 4); every write is a synthesised `Command`
through `executeCommand`, never `mutate`/`writeSlot` (clause 5); disambiguation at commit — bare
number is a literal `set`, anything else a formula `set` with a leading `=` absorbed, not doubled
(clause 6); the log gets the echoed synthesised command plus the result or refusal, and Escape with
an input open closes ONLY the input (clause 7, achieved structurally — the input's own `keydown`
`stopPropagation`s, so the keystroke never reaches the window-level Escape handler at all, no guard
needed there); the editing panel is not rebuilt while its input is open, and EVERY OTHER PANEL (and
this one whenever nothing on it is being edited) still rebuilds every paint exactly as before (clause
8 — see item 1's self-caught bug); drag-linking between two panels is explicitly NOT built (clause 9).

**3. Q-014 IS NOW FULLY CLOSED, IN CODE.** D-094 (display), D-100 (selection), D-101 (N panels),
D-106 (dismiss), D-102 (writing) — every ruling that answers it is built. What is left of the whole
arc is a HUMAN SESSION actually using it (see item 9 below), and D-102's own review.

**4. ONE READING DECISION IS WORTH THE REVIEWER'S EYES: a panel-typed STRING reaches a FORMULA slot,
never a literal one.** D-102 clause 6 says "a bare number... anything else...", and a panel row has
no quoting affordance — so `"hello"` typed into a row is read the same way a formula reads it (a
string-literal expression), landing as a `formula` slot holding that string. Typing `hello` with no
quotes is a formula naming an object called `hello`, which will refuse if none exists — also correct
per the literal ruling, also worth a second look. See entry 0109's "Decisions I made" 1 and its first
question for the reviewer.

**5. `main.ts`'s DOM HALF (`start`) IS STILL UNTESTED BY CONSTRUCTION (D-001) AND IS NOW LARGER
AGAIN.** Entry 0109 added the largest single expansion to it so far in one entry: `openEditor`,
`panelEditHandlers`, `panelClipElement`, `panelEditInput` (with a `settled`-flag reentrancy guard —
see entry 0109's Decision 4 for why one is needed), and the click delegate's second branch. Verified
live in a real browser (two Playwright scripts, described in entry 0109's log, zero console/page
errors) — that is several runs, by one person, not a re-runnable assertion.

**6. D-101 AND D-106 ARE STILL FULLY BUILT from entry 0107** — nothing about N panels, drag, or
dismiss changed this cycle. See prior STATUS revisions (0105→0108's own text, preserved in `entries/`)
for their own detail; not restated here now that D-102 sits on top of them cleanly.

**7. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101).** `mutation.ts`'s `findInvalidDimensionWrites`
rejects a `setSlot` that would leave `table`'s `rows`/`cols` non-`literal`, non-number, non-integer,
or outside `MIN_TABLE_LINES..MAX_TABLE_LINES`. D-097, D-098, D-099 are all CLOSED — do not re-fix any
of them. **D-102's own writes inherit this refusal for free** (item 2 above, clause 5's whole point).

**8. D-104 IS STILL OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED YET.** `insertTableLine`/
`deleteTableLine` are not bounded by `MIN_TABLE_LINES`/`MAX_TABLE_LINES` the way `setSlot` now is.
**Not reachable by any command today** (§5.10's row/column commands are unbuilt). Owed by whichever
cycle builds those commands (`findInvalidTableResizes`, never `findInvalidDimensionWrites`).
Untouched by entries 0107 or 0109.

**9. A HUMAN SESSION IS STILL OWED FOR PHASE 4'S OWN GATE** — two polygons bound through a table, in
one document. Nothing in entries 0101-0109 is that session; entry 0109 in particular makes that
session's LINKING half doable with the mouse instead of only the command line, for the first time.

**10. `commands.ts`'s D-100-era `select` effect and `props.ts`'s enumeration are UNCHANGED by entry
0109 beyond the one added `synthetic` field** — `select <name>` still replaces the whole selection
with one object (D-100 clause 7), and `buildSlotDescriptors`/`describeSlotValue` are still the ONE
enumeration/formatter D-094 clause 9 requires, read by `props`, every panel's display, AND now every
panel's edit seed.

## Next — this cycle's own review, then Phase 4's own human session

D-102's review point is not optional and not batch-absorbable (item 1 above). **Nothing should build
on top of `main.ts`/`index.html`/`props.ts` until it lands.**

After that review clears, the honest next step is the standing one: **a human session for Phase 4's
own gate** — two polygons bound through a table in one document, now authored either by typed
commands or by clicking a grey paperclip and typing into a row. Everything built through entry 0109
makes that session easier; none of it IS that session.

**Still queued behind all of that, unchanged:** D-090's prompt-sequence preview · D-088 clauses 2–4
and D-089 (the command input's behaviour) · §5.11's load boundary in `document.ts` (D-083 clause 4's
depth check, D-081's `createObject` name gate, whose pinned "duplicate DOES commit" test must FLIP) ·
**D-104** (fix-list item 13, owed by whichever cycle builds row/column commands) · D-102 clause 9
(drag-linking between two panels — not asked for yet).

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
reviewed 0090/0091, widened at 0107/0109) · entry 0093's selection highlight / error badge / formula-driven
indicator (D-068) and D-092 clause 1's name label, entry 0094's chrome-anchor fix (0095-REVIEW, ACCEPT) ·
entry 0096's `render/slots.ts` + `render/extent.ts` split (D-093) and entry 0097's `command/props.ts`
+ `props` command (0098-REVIEW, ACCEPT WITH EDITS; D-096, its D-099 widening at 0102 reviewed at
0103, its D-102 `synthetic` widening at entry 0109 NOT yet reviewed — see below) · entry 0099's
`render/panel.ts` + `buildPanelModel` + the panel DOM + clause 3's name suppression (REVIEWED: ACCEPT
at 0100-REVIEW, no edits; its D-099 widening at 0102 reviewed at 0103) · entry 0104's
`interaction.ts`/`renderer.ts`/`main.ts` selection-list widening (REVIEWED: ACCEPT WITH EDITS at
0105-REVIEW; D-105).

## Built this batch, NOT yet reviewed (cycle 3/3 since 0105-REVIEW — review REQUIRED, see above)

**Entry 0107 — D-101 + D-106, N panels with drag and dismiss.** See entries 0107/0108's own text for
full detail. **REVIEW: NOT NEEDED was entry 0107's OWN verdict** (no §6.1 trigger fired on its own
diff) — that verdict stands for THAT diff, but the batch it belongs to now has a mandatory review
regardless, forced by entry 0109 (item 1 above). Nothing here supersedes 0107's own honest
self-assessment; it is simply being reviewed together with what came after it, per D-103's own
"batching is about fewer, larger reviews" spirit.

**Entry 0108 — verdict correction, no code.** Restates entry 0107's verdict as `REVIEW: NOT NEEDED`
after the human overruled a hedged `RECOMMENDED`. Adds nothing to the batch's diff total.

**Entry 0109 — D-102, the paperclip and editing.** `command/props.ts`'s `synthetic` field;
`main.ts`'s panel-write pure functions (`commitPanelEdit`, `unlinkPanelSlot`, and their private
helpers) plus the DOM half's editing machinery; `index.html`'s interactive-panel CSS. Six new tests
in `main.test.ts`'s own describe block, three existing test expectations widened (D-096 clause 1's
disclosure duty — see entry 0109's log). Mutation-checked (three checks, each confirmed red then
green) and manually verified live in a real browser (two scripts, zero console/page errors — see
entry 0109's own log for the full transcript). **REVIEW: REQUIRED** (D-103 clause 4 — see the top of
this file).

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots · point-in-polygon fill hit-testing
(D-067) · §5.4's formula bar / in-place cell editing · §5.11's load-boundary validation (D-081,
D-083 clause 4) · D-088 clauses 2–4 · D-089 · D-102 clause 9 (drag-linking between two panels) ·
Phases 5–7.

**Phase 4 is OPEN and NOT claimed.** (a) data drives geometry and (b) geometry drives data are both
reachable from typed lines OR, as of entry 0109, from a panel's paperclip; (c) partial binding under
drag is demonstrated in `main.test.ts`. What is missing is all three in ONE document, authored by a
human.

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
   Still owned by whichever cycle actually addresses it.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED**
    now that `props.ts` exists (0095-REVIEW §4).
11. **The panel's `overflow: auto` scroll position resets on every paint** for a panel that is NOT
    currently editing, because `writePanel` still rebuilds each such panel's rows whole and paint
    runs on every pointer move (0100-REVIEW §3). **D-102 clause 8's supersession for the EDITING
    case is now DISCHARGED** (entry 0109: a panel with an open row input is not rebuilt while it is
    open, so ITS scroll position is preserved for the duration of the edit) — this item's remaining,
    narrower scope is the ORDINARY display-only case, still open, still nobody's yet.
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
  than removing it — see `primitives/table.ts`'s header. Unchanged.
- **`main.ts`'s `start` is untested code and keeps growing** — entry 0109 added the biggest single
  expansion yet (item 5 above). Verified live but not by a re-runnable assertion.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
  Unchanged by N panels or by D-102: each is clamped independently.
- **The chrome layout is still UNSEEN beyond entry 0094's anchor fix.** Labels of two adjacent
  objects can still overlap — **D-095 says build no collision avoidance until a human asks, and
  D-101 clause 3 extends that stance to panels.**
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses
  2–4 not built. **There is no command history** (**D-089**, queued).
- **A hand-edited saved file can throw a `RangeError` out of the Load button** — fix-list item 1.
- **Every pointer move repaints the canvas and rewrites the whole log's `textContent`; every panel
  NOT currently editing is still rebuilt whole every paint too** (fix-list item 11's own remaining
  scope). Immediate-mode, unmeasured and acceptable today (Rule 5) — the one place this is now a
  CORRECTNESS requirement rather than a performance question, a row's own open input, is handled
  (D-102 clause 8, entry 0109).
- **`escape` is bound to the window**, so it cancels a live prompt from anywhere. D-100 clause 5 and
  D-102 clause 7 give it a third duty and an innermost-first order — input, then prompt, then
  selection. **Entry 0109 achieves the innermost step STRUCTURALLY**: a row's own `keydown` listener
  `stopPropagation`s, so the window handler never even sees the key while an editor is open — no
  explicit guard was added there, and `updatePanels`'s own pruning is the self-healing backstop if
  focus is ever somehow elsewhere. Dismissing a panel is deliberately NOT on this list (D-106 clause
  8: dismissal is a click on a control, never a key).
- **`zoom`'s echoed line names the REQUEST and `main.ts` adds a second line with the RESULT** —
  deliberate, D-082 clause 5.
- **`format.ts`'s elision does not re-parse** — a disclosed exception to the round-trip property.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046) — a state
  D-097 makes unreachable BY COMMAND, though a loaded file can still carry it, so the refusal stays.
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
  separate `Value`-to-text formatters** never reconciled (D-099 clause 5, deliberate). `mutation.ts`'s
  `describeDimensionSlotValue` is a THIRD, narrower formatter, scoped to one rejection message.
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

**D-101 and D-106 are IMPLEMENTED at entry 0107. D-102 is IMPLEMENTED at entry 0109. NONE OF THE
THREE ARE YET REVIEWED** — entry 0109 is what makes the review mandatory (item 1 above); do not
re-build any of them while waiting for it.

**D-104 is NEW and NOT implemented** (0103-REVIEW). It is not owed by the next cycle — it is owed by
the cycle that builds §5.10's row/column commands. See "Read this first" item 8 and fix-list 13.

**Q-014 IS CLOSED** — every ruling that answers it (D-094, D-100, D-101, D-106, D-102) is now BUILT,
as of entry 0109. **Q-013 is NOT mooted** — `set <address> = <formula>` stays the spelling; D-102's
panel reuses the exact same synthesised form (entry 0109's `buildPanelSetCommand`), never a second
one.

**D-094's fourteen clauses stand, with clause 10 now SUPERSEDED by D-102 clause 1 (entry 0109 —
`pointer-events: none` is LIFTED off the panel body) and clause 3 generalised by D-100 clause 8 and
again by D-106 clause 5.** Everything else in it is unchanged and IMPLEMENTED at entry 0099.

**From 0098-REVIEW — D-096, four clauses:** (1) a ruling's file/move list is a CEILING, its
rationale governs a divergence, and a divergence **must be named in the log entry** — entries 0099,
0101, 0102, 0107, and 0109 have each disclosed their own; (2) the table `cells` summary keeps
`kind: "literal"` and `SlotDescriptor`'s deferred `synthetic?: true` field is now ADDED, at entry
0109, exactly as clause 2 anticipated ("when editing arrives... that cycle adds..."); (3) a new
`dynamic` group MUST add its own summary branch in `props.ts` in the same cycle — **D-097 clause 6
extends that duty to the write check**; (4) `props`'s registry position and unknown-name message
stand.

**From 0095-REVIEW — D-093** (the `render/` split — IMPLEMENTED at 0096) · **D-094** (the panel —
IMPLEMENTED at 0099, extended to N panels at 0107, made writable at 0109) · **D-095** (chrome hangs
from the extent's top-centre; no inter-object label collision avoidance is to be built — extended to
panels by D-101 clause 3).

**From 0091-REVIEW (the human's session):** **D-088** (clause 1 built, 2–4 queued) · **D-089**
(queued) · **D-090** (queued) · **D-091** (the grey grid stands).

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
D-097's write-time refusal sits BESIDE that read, not inside it, and does not weaken it.

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

**No other `PROVISIONAL` tags exist.** Next free: **Q-016**.

## Gotchas for the next model

- **ENTRY 0109 IS BUILT AND UNREVIEWED. REVIEW: REQUIRED (D-103 clause 4) — do not build anything
  else on `main.ts`/`index.html`/`props.ts` until it clears.** Read entry 0109's log in full first.
- **A gate that "skips a rebuild while editing" must default to REBUILDING, never to skipping.**
  Entry 0109's own near-miss (its Decision 2): comparing a persisted "not editing" marker to itself
  is always equal, so a naive version of the D-102 clause 8 skip would have frozen every panel
  forever after its first paint, the moment ANY panel existed — not only the one being edited. The
  correct shape checks `editing !== undefined` FIRST; the skip is the exception, never the default.
- **`event.stopPropagation()` on a row input's OWN `keydown` is what gives Escape its "input only,
  not the selection" meaning (D-102 clause 7) — no change was needed at the window-level Escape
  listener.** DOM event bubbling already orders "innermost first"; stopping it at the input is the
  narrowest fix. If a future control needs the same property, reach for this before touching the
  shared window listener.
- **Removing a FOCUSED element from the DOM fires its own `blur`.** `panelEditInput`'s `settled`
  flag exists because committing or cancelling a row's edit triggers exactly the repaint that
  removes that very input — without the guard, `onCancel` would fire a second, reentrant time from
  inside the first call's own repaint. Relevant to any future DOM code in this file that removes a
  focused element as a side effect of its own event handler.
- **A panel-typed bare word with no quotes and no leading `=` is a FORMULA reference, not a string
  literal** (D-102 clause 6, entry 0109's Decision 1) — typing `hello` into a row asks for an object
  named `hello`, and refuses if none exists. A literal string needs to be typed quoted
  (`"hello"`), the same as inside any formula.
- **`AppState.interaction` is assigned in exactly ONE place: `withInteraction`.** It is what keeps
  `AppState.panels` pruned to the current selection (D-101 clause 6, D-106 clause 6). A future call
  site that assigns `interaction` directly SILENTLY reopens the bug D-105's own class of finding was
  about — a stale flag surviving a selection change nothing pointed at.
- **`renderDocument`'s `panelledObjectIds` and `selectedObjectIds` are DELIBERATELY two different
  lists** (D-106 clause 5) — do not collapse them back into one.
- **A panel's DOM element is NOT the thing to hang MOST gesture state off of** — `updatePanels`
  rebuilds every panel whole on every paint BY DEFAULT (D-101's drag/dismiss track their own state
  in closures for exactly this reason). **The one deliberate exception is a row's own open `<input>`
  while it is being edited** (D-102 clause 8): that ONE element is kept alive on purpose, which is
  why `panelEditInput`'s own listeners may safely be bound DIRECTLY to it rather than delegated —
  see entry 0109's answer to entry 0107's first open question.
- **`mouse.click(..., { modifiers: [...] })` in Playwright/Chromium does NOT set the corresponding
  modifier flag on the synthesized `pointerdown` in at least one observed combination** —
  `page.keyboard.down("Shift")`/`up("Shift")` around a plain click does. Cost real time at entry
  0107; not hit again at entry 0109 (no modifier-click was needed), but still true if a future cycle
  scripts the browser again.
- **A dismissed panel's object does NOT automatically un-dismiss on a plain click that merely
  narrows a multi-selection down to it** — only if the object actually LEFT the selection first.
- **`placePropertiesPanel` needed NO change for N panels, and needs none for D-102 either** — it
  takes the extent as an argument and knows nothing about a row's own content.
- **A drag notice dedupes by TEXT, per GESTURE.** Do NOT reach for `Date.now()` for this or anything
  else in `interaction.ts`.
- **`describeSlotValue` must never be copied.** `maxDecimals` is its one optional argument (D-099);
  `renderer.ts`'s `formatCellValue` is a disclosed second formatter; `mutation.ts`'s
  `describeDimensionSlotValue` a narrow third. No fourth, anywhere.
- **A test that passes on its FIRST run is not yet trusted — mutation-check it.** Entry 0109's own
  log names three such checks for its new pure functions, each broken-then-reverted with the
  affected test confirmed red then green.
- **`buildSlotDescriptors` is the ONE schema walk for display** (D-094 clause 9). `props`, every
  panel's DISPLAY, and now every panel's EDIT SEED (entry 0109's `commitPanelEdit`'s row value comes
  from the SAME `PanelRow.value` the display already computed) all read it.
- **The panel writes through `executeCommand` and nothing else** (D-102 clause 5, entry 0109). Not
  `mutate`, not `writeSlot`. `runPanelCommand` is the ONE place a panel-synthesised `Command` meets
  `executeCommand` — mirroring `commands.ts`'s own D-069 stance one layer up.
- **`render/panel.ts` is PURE and tested; the panel DOM in `main.ts` is not.**
- **The panel is positioned in CSS pixels; `worldToScreen` returns BACKING pixels.** Divide by the
  ratio the canvas actually has, never `devicePixelRatio` by assumption.
- **The canvas is a FLEX CHILD, so nothing floats over it as written** — `#stage` is `position:
  relative` (D-065).
- **A properties panel is not a `table` object and must never be spoken of as one** (D-094 clause 1).
  It is DOM furniture; it never enters `state.document`, never goes through `mutate`, is never
  saved, never appears in `list`. The same is true of a row's OPEN INPUT and its typed-but-uncommitted
  text — `openEditor` and its handlers are closure state in `start`, never `AppState`.
- **`main.ts` can be tested, and the trick is the bottom of the file** — the bootstrap is guarded on
  `typeof document !== "undefined"`.
- **The global `document` and `state.document` are different things.**
- **An object's non-derived slot paths are NOT a list you may render** — a large table's full set
  can be six figures. Never spread a collection the user can size (D-077).
- **`origin` does not mean the same thing across object types** — a circle's/polygon's CENTRE, a
  rect's/table's TOP-LEFT CORNER. "Where is this object, visually" wants `objectExtent`.
- **A test that asserts an OFFSET cannot catch a wrong ANCHOR.** When adding a positioned thing, pin
  the ABSOLUTE position for at least two geometries that differ.
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change fires.**
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it**
  (D-065).
- **`clampZoom` takes `(requestedZoom, fallbackZoom)`, not a camera.** · **An `effect` is a REQUEST,
  not a report** (D-082 clause 5). · **A pan gesture is not the `pan` command.** · **`command/` may
  not see a `CameraState`, a selection, or a DOM handle** (`render/panel.ts` may — it is `render/`).
  · **`parser.ts` validates the FORM of a number, not its usefulness.** · **A name §5.2 allows is not
  automatically a name §5.3 can READ (D-080).** · **`writeSlot` in `commands.ts` is the ONE place a
  slot is written by COMMAND-LINE command**, `runPanelCommand` in `main.ts` the ONE place a slot is
  written by PANEL command (both, underneath, are `executeCommand` calls — D-069 stays singular),
  and `withCamera` in `main.ts` the ONE place the camera is written. · **A formula's SOURCE does not
  exist anywhere** — it is reconstructed from the AST against current names, every paint. ·
  **`executeCommand` is the ONLY place a `Command` meets a `Document` (D-069)** — true for a typed
  line AND for a panel write, as of entry 0109. · **Find the recursion before you bound it.**
- **The operator cannot see what you can see.** The panel exists because that question kept going
  unasked. Entry 0109 answers a second version of it — "I can see it, but can I CHANGE it without
  leaving the mouse" — the same way: build the surface, wire it through the one path everything else
  already trusts, and inherit every refusal that path already has.
