# STATUS — as of entry 0097

STATE: **BLOCKED — awaiting review.** Both configs compile, 1174/1174 tests pass, 0 skipped, 0
`.only`, `npm run build` succeeds — all four **re-run at entry 0097** (implementer), real output
pasted in that entry, plus a three-mutant check on the new file. Entries **0096** and **0097** are
**not yet reviewed**; entries **0093** and **0094** remain **REVIEWED: ACCEPT** (0095-REVIEW), no
reviewer edits to source.

Current phase: **4 — cross-object linking, the validation moment.** **Phase 3 is PASSED and its gate
is CLOSED** (0091-REVIEW, D-084 clause 2 discharged). Nothing procedural stands in front of Phase 4,
and Phase 4 has not been claimed.

Last review point: **0095-REVIEW-phase4** (ACCEPT; D-093, D-094, D-095 ruled).
Cycles since last review: **2/3** · diff since last review: **~941 changed lines / 13 files**
(0096's 427/7 + 0097's 514/6) — **OVER BOTH §6.3 CAPS (800 lines, 10 files)**, on top of 0097's own
§6.1 trigger (first file of a new subsystem, `command/props.ts`).

**REVIEW: REQUIRED.** Entry 0097 built D-092 clause 4's `props <object>` command on a new pure
module, `src/command/props.ts` — a first file of a new subsystem (§6.1 trigger 2), and the queue
said this would happen. **Stop here. Do not start the properties panel (D-094) or anything else
before a review lands** — the panel is explicitly the NEXT consumer of `props.ts`'s enumeration
(D-094 clause 9), so starting it against an unreviewed `props.ts` risks building on something a
review could still change.

**THE HUMAN GAVE A DIRECTIVE AT 0095, WITH A SKETCH: a properties panel.** It is ruled in full as
**D-094** (fourteen clauses) and it **amends `PROJECT_BRIEF.md` §5.10's "no panels"**, once and
narrowly, for a **read-only** panel. The brief now carries a pointer at that sentence. Read D-094
before touching `index.html`, `main.ts`, or `command/`.

## Read this first — the six things a cold reader needs

**1. Chrome hangs from the object's drawn EXTENT, and the bug it replaced is the lesson.** Entry
0093 anchored the name label, error badge and formula-driven indicator to `origin.x`/`origin.y`.
`origin` is a circle's and a polygon's **centre** but a rect's and a table's **top-left corner**
(`primitives/geometry.ts`), so a circle's label drew *inside the circle* while a table's drew above
its grid. **Every test passed** — each asserted "6px above the anchor," which was true for every
type. The defect was in what the anchor MEANT. A human screenshot found it (entry 0094). Chrome now
hangs from the top-centre of `extent.ts`'s `objectExtent` (moved there from `hittest.ts` at entry
0096) — D-066's one extent, used a third time — and all three pieces sit on one measured line above
the object: `[•x •y] name [!]`, with
`ctx.measureText` keeping the badge and ticks clear of the name instead of fixed offsets that only
happened not to collide.

**This is the third consecutive finding that required a human eye, and the first NOT in `main.ts`'s
DOM half.** The standing lesson widens: it is not only untested code that is at risk, it is code
whose tests can only check what their author was already thinking about.

**2. THE IMPORT CYCLE IS CLOSED (D-093, built at entry 0096).** `renderer.ts` used to import
`objectExtent` from `hittest.ts` while `hittest.ts` imported `readNumber`, `asPointArray` and
`TABLE_CELL_*` from `renderer.ts` — a cycle that resolved only because every cross-file reference on
both sides sat inside a function body, never at module top level, so a top-level `const` reading
across it would have failed with a TDZ error. **`src/render/slots.ts`** (`readNumber`,
`asPointArray`, `TABLE_CELL_WIDTH`, `TABLE_CELL_HEIGHT`) and **`src/render/extent.ts`**
(`WorldExtent`, `objectExtent`, `documentExtent`) now hold that shared code; `renderer.ts` and
`hittest.ts` both import them and neither imports the other. Pure move — no logic change, no test
assertion changed, only import lines. Both HAZARD notes are **deleted**, not amended. **If you find
a NEW top-level cross-reference between `renderer.ts` and `hittest.ts`, that is a regression of this
fix, not a return to the old accepted shape — there is no more reason for one to exist.**

**3. THE ADDRESSING VOCABULARY'S SECOND HOLE IS BUILT, PENDING REVIEW.** D-092 named two holes:
object → name (**closed** at 0093/0094, item 1 above) and object → its slots. The second is now
**built at entry 0097, NOT YET REVIEWED**: `props <object>` prints every slot an object's schema
declares — path, kind, value, and a formula's reconstructed source — reading `src/command/props.ts`'s
`buildSlotDescriptors`. A table's `cells.*` family is summarised as ONE row (grid shape, cells
written), never spread (D-077). **D-094's read-only properties panel is next in the queue and is
the enumeration's SECOND and only other permitted reader** (D-094 clause 9: "a second enumeration of
an object's slots is forbidden") — **do not start it before `props.ts` clears review**, since a
review verdict could still change the descriptor shape the panel would otherwise build against.

**4. The human's session at entry 0091 set the rest of the queue.** Ruled: **D-088** (every
printable keystroke reaches the command input wherever focus is; `ctrl`/`alt`/`meta` never route —
clause 1 built, 2–4 owed) · **D-089** (command history on up/down, held in `AppState`) · **D-090**
(a prompt sequence DRAWS its gathered point and the geometry it would produce, from `state.pending`,
never into the document — owed) · **D-091** (the table's grey grid is deliberate and stands).

**Q-014 is now narrowed to WRITING ONLY.** The human ruled the DISPLAY half at 0095 with a sketch —
**D-094**, the read-only properties panel, which also **amends §5.10's "no panels"** once and
narrowly. What is still OPEN and still **the human's alone**: whether a click on a slot row may EDIT
it, and whether two panels may LINK two slots by mouse. **Nothing is built against that half**, and
the panel's `pointer-events: none` is what keeps approving it later an addition rather than an
unwinding.

**5. `main.ts` is two halves, and only one of them is tested.** `AppState` and every transition over
it are pure and have 36 tests. `start` — the canvas, the listeners, the log element, the file
picker, the download anchor — has **none**. Every finding of the last three reviews touched either
`start` or something only a running browser could show.

**6. `load` is wired, and that makes an unbuilt check user-reachable.** A hand-edited document whose
formula AST nests deeper than `MAX_FORMULA_AST_DEPTH` reaches `deserializeDocument` from a button and
throws a `RangeError` out of the file-read promise (**D-083** clause 4's loader check is not built;
**D-081**'s name gate is not either). Owned by `document.ts`'s cycle.

**Still binding, one line: five names §5.2's grammar allows are NOT available** — `AND`, `OR`,
`NOT`, `TRUE`, `FALSE` lex as formula keywords and `checkNameAvailable` refuses them in every case
(**D-080**). Function names are safe and are NOT reserved.

## Next cycles — ordered

**D-093's split (entry 0096) and D-092 clause 4's `props` (entry 0097) are BOTH DONE, NEITHER
REVIEWED.** See "Read this first" items 2 and 3. **A review must land before item 1 below starts** —
0097's own log entry says so, and it is restated here because it is the one instruction in this file
most likely to be skipped by a model that only reads the numbered list. The remaining chain's order
is still ruled, not suggested: each one's destination is the next one's substrate.

1. **`index.html` + `main.ts` + `render/`: D-094's read-only properties panel — BLOCKED on review of
   entry 0097.** Fourteen clauses, all binding; read them before starting. The four that cost the
   most if missed: the placement arithmetic is a **pure tested function** in `render/`, not code in
   `start` (clause 11); the panel is positioned in **CSS pixels** while `worldToScreen` returns
   **backing pixels** (clause 12); the selected object's canvas name label is **suppressed** because
   the name moves into the panel header (clause 3); `pointer-events: none`, because it is
   display-only and that keeps D-085/D-088's focus discipline true by construction (clause 10). It
   consumes `props.ts`'s `SlotDescriptor` directly (D-094 clause 9) — a review edit to that shape
   would need to land here too.
2. **`main.ts` + `renderer.ts`: D-090's prompt-sequence preview.** Needs `state.pending` threaded
   into the render call, plus per-command preview geometry.
3. **D-088 clauses 2–4 + D-089, the command input's behaviour.** Printable-key routing from
   anywhere, and history.
4. **§5.11's load boundary** in `document.ts`: **D-083** clause 4's depth check and **D-081**'s
   `createObject` name gate (whose pinned "duplicate DOES commit" test is meant to FLIP then).

**A human session is owed before Phase 4 is attempted in earnest.** Phase 4's criterion needs a
human to bind two polygons through a table; `props` now exists (pending review) so that human can
discover `origin.x` is a writable path by typing `props polygon_1`, without reading
`primitives/schema.ts` — but the panel, which puts the same information beside the object they just
clicked, is the friendlier surface and is next.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · the whole table primitive through row/column
insert/delete and `delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit
(0058) · `primitives/geometry.ts` (0060) · `render/renderer.ts`'s original body/table drawing (0062,
widened by 0093, unreviewed) · `render/hittest.ts` (0064) · entry 0065's header audit ·
`render/interaction.ts` (0067) · `command/parser.ts` (0069) · `command/prompt.ts` + D-071's formula
path (0071) · entries 0072–0073's fix-list work (0074) · `command/commands.ts`'s seam and its four
creation handlers, `document.ts`'s `mintObjectId`, and `TABLE_SCHEMA`'s `origin.x`/`origin.y` (0078)
· `commands.ts`'s four slot commands through one `writeSlot` path, and `engine/formula/format.ts`
(0080) · `commands.ts`'s `delete`, `refs` and `list` (0082) · `mutation.ts`'s
`RenameObjectOperation` + `findInvalidRenames`, and `commands.ts`'s `rename` handler (0084) ·
`CommandEffect` and the five effect handlers (0086) · the two formula depth limits (0088) ·
`main.ts` rewritten from the stub, `render/camera.ts`'s `clampCamera`/`clampZoom`,
`render/hittest.ts`'s `documentExtent` (moved at entry 0096 to `render/extent.ts`), `index.html`
(0089, reviewed at 0090 and again by the human at 0091 — four defects found and fixed across the
two) · entry 0093's selection highlight/error badge/formula-driven indicator (D-068) and D-092
clause 1's name label, and entry 0094's chrome-anchor fix — both **REVIEWED: ACCEPT at 0095-REVIEW**,
detail retained below.

## Built this batch, not yet reviewed

**Entry 0096 — `render/slots.ts` + `render/extent.ts`: D-093's split.** A pure move closing the
import cycle between `renderer.ts` and `hittest.ts` (see "Read this first" item 2, rewritten this
cycle). `readNumber`/`asPointArray`/`TABLE_CELL_WIDTH`/`TABLE_CELL_HEIGHT` now live in `slots.ts`;
`WorldExtent`/`objectExtent`/`documentExtent` now live in `extent.ts`, importing `slots.ts`.
`renderer.ts` and `hittest.ts` both import both new files; neither imports the other. No function
body changed, no test assertion changed — five other files got a one-to-three-line import or
comment edit (`main.ts`, `camera.ts`, `hittest.test.ts`). `tsc` clean on both configs, **1148/1148**,
`npm run build` succeeds — full output in entry 0096. `REVIEW: NOT NEEDED` (pre-authorised by D-093
itself; no logic change, no new subsystem).

**Entry 0097 — `src/command/props.ts` (new) + the `props` command: D-092 clause 4, D-094 clause 9.**
`buildSlotDescriptors(object, objects)` enumerates every slot a schema declares, in schema order; a
table's `cells.*` family collapses to ONE summary descriptor rather than being spread (D-077).
`describeSlotValue` moved here from `commands.ts` and is exported, per D-094 clause 9's "one
formatter, not two." `parser.ts` gained `PropsCommand` (registry: `props <object>`, between `refs`
and `list` — not a §5.10 command; added through §5.10's own extension mechanism, D-092 clause 4).
`commands.ts`'s `props` handler formats the descriptor list into log lines; no `effect` (D-075
clause 4, D-092 clause 6). 26 new tests (15 in the new `props.test.ts`, 10 in `commands.test.ts`, 1
in `parser.test.ts`). `tsc` clean on both configs, **1174/1174**, `npm run build` succeeds — full
output in entry 0097. Three seeded mutants on `props.ts`, each `diff`-confirmed reverted: the table
summary's `rows × cols` swapped to `rows + cols` killed 4; a literal slot mis-tagged as `formula`
killed 3; the table's dynamic-group summary replaced with full per-cell enumeration (what D-077
forbids) killed 7. **`REVIEW: REQUIRED`** — first file of a new subsystem (§6.1 trigger 2); see
entry 0097's own three questions for the reviewer.

## Reviewed at 0095-REVIEW (detail retained for the record)

**Entry 0093 — `renderer.ts`'s selection highlight, error badge, formula-driven indicator
(D-068), and D-092 clause 1's name label; `main.ts` wired to pass the selection through.**

- **`src/render/renderer.ts`** — `renderDocument` gained a sixth, optional parameter
  (`selectedObjectId?: string`) and a third rendering pass (screen-space chrome, after a second
  identity-transform reset). `buildCirclePath`/`buildVerticesPath` factored out of
  `drawCircle`/`drawVerticesShape` so the highlight re-strokes the SAME path rather than computing
  an independent outline (D-010). 16 new tests; 3 existing table tests updated because a table's
  `fillText` calls genuinely changed.
- **`src/main.ts`** — one line: `paint()`'s `renderDocument` call now passes
  `state.interaction.selectedObjectId`. Resolves no name (D-082 clause 4's discipline, held here
  too).

**Entry 0094 — chrome anchors to the drawn EXTENT, not to `origin`.** The fix for the defect a
human screenshot found in 0093's output (cold-read item 1).

- **`src/render/renderer.ts`** — `chromeAnchorPoint` is four lines: `objectExtent`'s top-centre. The
  per-type `switch` is gone. `drawObjectChrome` lays all three pieces on ONE line above the top
  edge (`[•x •y] name [!]`), with horizontal offsets MEASURED via `ctx.measureText` so a long name
  pushes the badge and ticks out instead of colliding. `drawNameLabel`/`drawErrorBadge`/
  `drawFormulaDrivenTicks` collapse into `drawObjectChrome` + `formulaDrivenTicks(object): string`
  (one right-aligned draw carries both ticks). Dead `ScreenPoint` import removed.
- **`src/render/hittest.ts`** — `objectExtent` exported. No logic change. **This is what created the
  import cycle** (cold-read item 2).
- **Tests** — `renderer.test.ts` at 40 (was 34). Both fakes gained `measureText` as a FIXED-WIDTH
  fake measurer (7px/char), the posture Rule 1 prescribes for the engine's `TextMeasurer` applied a
  layer up. Six existing tests changed, each itemised in entry 0094 §"the six existing tests I
  changed" with the reason this cycle's own change touched it — **none weakened**.
  `main.test.ts`'s Phase 3 acceptance test needed ONLY `measureText` added to its fake; no
  assertion changed.

Verified: `tsc` clean on both configs, **1148/1148**, `npm run build` succeeds. Three-mutant check
against `renderer.ts` (each seeded alone, `diff`-confirmed reverted): anchor at the extent's BOTTOM
killed 12, anchor at the LEFT edge killed 10, offsets ignoring the measured name width killed 5.
Entry 0093's own two mutants killed 8 and 2.

## Not started

**D-094's properties panel** (BLOCKED on review of entry 0097 — see "Next cycles") ·
**D-090's prompt-sequence preview** · §5.9's per-vertex drag
path · `polyline`/`explode`/`addvertex`/`delvertex` · `style` slots · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar / in-place cell editing · §5.11's load-boundary validation
(D-081, D-083 clause 4) · D-088 clauses 2–4 · D-089 · Phases 5–7.

**Phase 4 is OPEN and is NOT claimed.** (a) data drives geometry and (b) geometry drives data are
both reachable from typed lines; (c) partial binding under drag is demonstrated end to end in
`main.test.ts`, with the feedback now reaching BOTH the log and (untested-by-eye) the canvas via
entry 0093's formula-driven indicator. What is missing is all three in ONE document, authored by a
human who can find the paths involved — `props` now exists (entry 0097, pending review) so that
human can type `props polygon_1` and see `origin.x`, but nobody has yet run the human session Phase
4's criterion actually needs.

## Open fix list — **read 0090-REVIEW §9 and 0091-REVIEW §5 for the full text**

Numbering follows 0090-REVIEW §9, restarted there, plus two added at 0091-REVIEW. Unchanged this
cycle. Old item 5 (the ~200 KB echo) is **CLOSED by ruling** — the line stays as typed; 0090-REVIEW
§9 has the reasoning and the one condition that would reopen it.

1. **§5.11's loader validates a loaded formula's AST depth once, at the boundary** (**D-083**
   clause 4). `deps.ts` and `eval.ts` get no depth parameter. **User-reachable** since entry 0089
   wired the Load button. Owned by `document.ts`'s cycle, together with **D-081**'s `createObject`
   name gate.
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
   bare "this cycle" sites in test files · `.gitattributes`. (`render/slots.ts` itself is no
   longer on this list — it was built at entry 0096.)
6. **A middle-drag pan started outside the canvas is untested and unthought-about.** D-088 clause
   1's `preventDefault` handles the ordinary case. Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** where its neighbour has a paragraph. **D-091**
   explains the choice and the constant should say a line of it. Owned by the `style`-slots cycle.
8. **The new screen-space chrome constants (label/badge/tick offsets) are untuned** and this cycle's
   own equivalent of item 7 — chosen, not measured, and disclosed as such in entry 0093. Not a
   defect (Rule 5); revisit only once a human has actually seen the layout.
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return** (0095-REVIEW §5).
   Harmless today — `drawCellText` sets all three itself on every call — but it is the same shape as
   the transform hazard entry 0093 closed. Owned by whichever cycle next opens `drawObjectChrome`.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED
    now that `props.ts` exists** (0095-REVIEW §4). `buildSlotDescriptors` (entry 0097) enumerates
    every writable slot, so the narrowness is now a CHOICE rather than a limitation — not made yet,
    and not this cycle's to make (§4: no refactor of code outside the declared slice). Owned by
    whichever cycle next opens `render/renderer.ts`'s chrome pass.

## Known problems (detail lives where the pointer says)

- **`main.ts`'s `start` is untested code** — every listener, the canvas sizing, the log rewrite, the
  download anchor and the file picker, now including the one-line selection hand-off to
  `renderDocument`. **0090-REVIEW found four defects there and none anywhere else.** Treat a change
  to that region as unverified until someone clicks on it.
- **The chrome layout is still UNSEEN.** Entry 0094 fixed the anchor a screenshot exposed and made
  the offsets measured rather than guessed, but nobody has looked at the result. **Labels of two
  adjacent objects can still overlap each other** — there is no inter-object collision handling and
  entry 0094 deliberately invented none (Rule 5).
- **A prompt sequence still shows nothing where you clicked** — no marker for a picked point, no
  preview of the shape being built. Ruled **D-090**, queued, explicitly deferred out of entry 0093.
- **An operator can now TYPE their way to an object's slots, but there is still no panel.**
  `props <object>` (entry 0097, pending review) prints every slot — path, kind, value, formula
  source — but the operator still has to know the object's NAME first, type it, and read text. The
  properties panel (**D-094**, next in the queue, blocked on review) is what answers "I just clicked
  a shape and want to see this" without typing anything.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only, the two slots a
  drag can move today. A `style` slot bound to a formula, once `style` slots exist, gets no
  indicator without a widening.
- **A printable keystroke does not reach the command input unless it is focused.** The focus is no
  longer lost on a canvas press (D-088 clause 1), but clauses 2–4 (routing from anywhere, excluding
  `ctrl`/`alt`/`meta`) are not built.
- **There is no command history.** Ruled **D-089**, queued.
- **A hand-edited saved file can throw a `RangeError` out of the Load button** — fix-list item 1.
- **Every pointer move repaints the canvas AND rewrites the whole log's `textContent`.** The repaint
  is §5.9's accepted cost; the log rewrite is entry 0089's own and is unmeasured.
- **`fit`'s margin (`FIT_VIEWPORT_FRACTION = 0.9`) is chosen, not measured**, like every other
  untuned constant in `render/` (Rule 5) — now joined by entry 0093's chrome offsets.
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
- **Prompt order, wording and the `<8>` default form are a reading of AutoCAD, not the brief's.**
  **No repeat-last-command gesture** (D-089 will provide one, unbuilt).
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — reachable only via a raw
  `setSlot`, pinned by `mutation.test.ts`'s "KNOWN INCOHERENCE" test; D-053 forbids a one-sided fix.
- **One carried render gap:** cell text is not clipped to its cell (§5.4 silent, Rule 5).
  (0064-REVIEW §5's other item — `readNumber`/`asPointArray` moving to a shared file at their third
  consumer — is CLOSED: they live in `render/slots.ts` as of entry 0096.)
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` that is not a registry name
  (covered explicitly in `commands.test.ts`) · comment debt in TEST files only (0058-REVIEW F2) ·
  mixed line endings in the WORKING TREE only (`core.autocrlf=true`) · dangling-reference messages
  name the DEPENDENT, not the missing SOURCE (0045-REVIEW F4) · D-022's bounded-correctness claim
  fails for `table` (0043-REVIEW §7 Q1) · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only, owed text boxes at Phase 5 ·
  journal structure unvalidated beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's
  `style` field · `noUnusedLocals` off · **new at entry 0097:** `render/renderer.ts`'s
  `formatCellValue` and `command/props.ts`'s `describeSlotValue` are two separate `Value`-to-text
  formatters that were never reconciled — pre-existing duplication `props.ts`'s move made visible
  rather than caused, not fixed because `formatCellValue`'s file was not otherwise open this cycle.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-095**) binds without restatement here.

**From 0095-REVIEW — three new rulings:** **D-093** (the `render/` split that removes the import
cycle — **IMPLEMENTED at entry 0096**, `render/slots.ts` + `render/extent.ts`) · **D-094** (the
read-only floating properties panel the human sketched — fourteen clauses, and the **one amendment
`PROJECT_BRIEF.md` §5.10 has ever taken**, narrow and display-only — **not yet built**) · **D-095**
(chrome hangs from the extent's top-centre and stays there; **no inter-object label collision
avoidance is to be built** — stop re-opening both; not a build item, already true).

**Entries 0093 and 0094 are REVIEWED: ACCEPT** (0095-REVIEW), no source edits by the reviewer. The
reviewer re-ran both typechecks and the suite, and re-seeded entry 0094's strongest mutant — 12
kills, matching the log exactly.

**D-068 and D-092 clause 1 are now IMPLEMENTED, at entry 0093** — selection highlight, error badge,
formula-driven indicator, and the screen-space name label all draw, in `render/renderer.ts`,
verified by 34 tests and two seeded mutants. **Unverified by a human eye** — see "Read this first"
item 1.

**D-092 clause 4 (`props <object>`) is IMPLEMENTED, at entry 0097, NOT YET REVIEWED.**
`src/command/props.ts`'s `buildSlotDescriptors` + `commands.ts`'s `props` handler. **This IS a §6.1
review point** (first file of a new subsystem) — see entry 0097's three questions for the reviewer,
and do not start D-094's panel before this lands, since the panel consumes the same descriptor shape
a review could still change.

**Entry 0096 needed no review** (`REVIEW: NOT NEEDED`) — it built exactly D-093's own ruling, a
pure move with no logic change and no test assertion changed, and D-093 at 0095-REVIEW is itself
the authorisation to touch the two files it edited. Do not re-litigate the split; it is done.

**From 0092-REVIEW:** the addressing vocabulary must be VISIBLE in the running application (D-092's
full text). Neither mechanism amends the brief: the brief is silent on both, and §5.10's "adding a
command is one registry entry" is its own extension mechanism.

**From 0091-REVIEW, from the human's session:** **D-088** (the command input keeps the keyboard —
clause 1 built, 2–4 queued) · **D-089** (command history, queued) · **D-090** (a prompt sequence
draws its gathered point, queued) · **D-091** (the table's grey grid is deliberate and stands).

**Superseded in part: D-086 clause 2's "one backing pixel is one CSS pixel"** — the backing store now
matches the DISPLAY, and clause 3's required conversion is built at `screenPointOf`. `DECISIONS.md`
is append-only, so the clause stands there as written and this line is the correction.

**From 0090-REVIEW, all four implemented:** **D-084** (Phase 3's gate needs a human run — discharged
at 0091) · **D-085** (space-drag arms on an empty input bar) · **D-086** (one canvas backing pixel is
one CSS pixel, re-read before every paint) · **D-087** (a degenerate extent is a POINT; a FLAT extent
is fitted).

**From entry 0089:** **D-075**/**D-082** (an effect is data; performed through an exhaustive switch,
no name resolved) · **D-062** (a loaded camera is clamped in `render/`, at the boundary) · **D-061**
(`camera.x`/`.y` is the world point at the screen's TOP-LEFT corner) · **D-066** (a degenerate extent
needs its OWN guard, narrowed to a true point by D-087) · **D-072** (a pick is a prompt answer, as a
WORLD point) · **D-027 clause 2** (the camera never goes through `mutate`).

Still owed, unchanged: **D-074** (a prompt sequence's own refusal IS the message) · **D-081**
(`createObject`'s name gate, owed by the load cycle) · **D-083 clause 4** (a loaded AST's depth,
checked once at the load boundary).

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants, `SELECTION_HIGHLIGHT_WIDTH`): world units or screen pixels? Provisional
(a) world units. Due with the `style`-slots cycle — still blocking `pan`'s argument grammar, though
not the pan gesture. **Entry 0093's new CHROME constants deliberately do NOT take a side in this —
they are screen pixels by a different, stated reason (legibility at any zoom), not an answer to
what a stroke WIDTH should be.**
**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.

**Q-014 — the properties panel — is OPEN and is the HUMAN'S ALONE.** Narrower since D-092: only
EDITING and LINKING slots by mouse remains in question. **Nothing is built against it, not even a
small version.**

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
  command MAY write it. **A fifth joined at entry 0093: to decide whether it may be HIGHLIGHTED/
  LABELLED** — `chromeAnchorPoint` and `drawSelectionHighlight` deliberately reuse the DRAW/HIT-TEST
  reads rather than becoming a sixth.
- **Mutation-check a suite that passes first try — and check the checker.** Strip ANSI
  (`sed 's/\x1b\[[0-9;]*m//g'`) and assert on the `Tests  N failed` line. Entry 0089 seeded five
  faults and killed 1, 1, 6, 1, 3; entry 0093 seeded two and killed 8, 2.
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change fires.**
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Entry 0089 falsified three; entry 0093 falsified `renderer.ts`'s own HAZARD note about
  `ctx` being left at the camera transform on return — it is now left at identity, by construction.
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
- **The operator cannot see what you can see.** You have `primitives/schema.ts` open; they have a
  canvas and a log. Before adding anything that the operator must NAME to use, ask where they learn
  the name from. D-092 exists because ninety-one entries went by without anyone asking.
- **A chrome anchor MUST reuse the same read the object's BODY uses to position itself**, `?? 0`
  fallback included, or the label/highlight can silently disagree with the picture (D-010, entry
  0093). This is why `chromeAnchorPoint`'s `table` case matches `drawTable`'s fallback exactly
  rather than requiring both slots present like circle/polygon/rect do.
- **A "no text drawn" or "exact fillText array" test written before chrome existed WILL need
  updating**, not exempting, once an object it exercises gets a real anchor point — three
  `renderer.test.ts` table tests changed at entry 0093 for exactly this reason. Check whether the
  test's fixture has `origin.x`/`origin.y` before assuming a chrome change is safe to skip.
- **`origin` does not mean the same thing across object types.** It is a circle's and a polygon's
  CENTRE and a rect's and a table's TOP-LEFT CORNER (`primitives/geometry.ts`). Entry 0093 anchored
  chrome to it and got a label inside every circle; entry 0094 moved to the drawn extent. **Anything
  that needs "where is this object, visually" wants `objectExtent`, never `origin`.**
- **A test that asserts an OFFSET cannot catch a wrong ANCHOR.** Entry 0093's label tests all passed
  while the labels were in the wrong place, because each asserted "6px above the anchor" and that
  was true. When adding a positioned thing, pin the ABSOLUTE position for at least two types whose
  geometry differs — entry 0094 pins a circle (centre-origin) and a table (corner-origin) precisely
  so the next anchor change cannot pass silently.
- **`renderer.ts` and `hittest.ts` WERE a MODULE CYCLE, entries 0094 through 0095.** It worked only
  because every cross-file reference was inside a function body — a top-level `const` reading across
  the boundary would have broken with a TDZ error. **Closed at entry 0096**: `render/slots.ts` +
  `render/extent.ts` now hold the shared code, and neither `renderer.ts` nor `hittest.ts` imports the
  other. If you see a new cross-reference between them, that is a fresh mistake, not this one back.
- **Adding a `ctx` member to `renderer.ts` breaks every hand-rolled fake in the repo**, and there
  are two (`renderer.test.ts`, `main.test.ts`). Entry 0094's `ctx.measureText` failed the Phase 3
  acceptance test with `TypeError: ctx.measureText is not a function` before both fakes were updated.
- **`worldToScreen` returns BACKING pixels; the DOM is laid out in CSS pixels.** The canvas backing
  store is `clientWidth * devicePixelRatio` (`paint`), so a screen point from the renderer is NOT a
  `style.left` value. D-094 clause 12: divide by the ratio the canvas actually has
  (`canvas.width / bounds.width`), read off the canvas the way `screenPointOf` reads it. This
  conversion has already shipped as a bug once, in the other direction (entry 0091's pan speed).
- **The canvas is a FLEX CHILD of `#app`, so nothing can float over it as written.** A panel needs a
  positioned wrapper (a `position: relative` stage around the canvas) or it will push the layout
  around instead of overlaying it. `index.html` holds the whole interface and says so in a comment
  that D-094 falsifies — under D-065 that comment is yours to update in the same cycle.
- **An object's non-derived slot paths are NOT a list you may render.** `resolveNonDerivedSlotPaths`
  on a large table returns 90,000–130,000 paths (measured, 0078-REVIEW). Any surface that shows
  "every slot" summarises a table's cells in one row (D-094 clause 8, D-077).
- **A properties panel is not a `table` object and must never be spoken of as one** (D-094 clause 1).
  The human's own note says so twice. It is DOM furniture; it never enters `state.document`, never
  goes through `mutate`, is never saved, and never appears in `list`.
- **`command/props.ts` now exists, and it is where "every slot an object has" is answered from —
  ONCE.** `buildSlotDescriptors(object, objects)` (entry 0097). Before writing a second walk of
  `schema.nonDerivedSlotPaths`/`schema.derivedSlots` anywhere (the panel included), check whether
  this function already answers the question — D-094 clause 9 forbids a second enumeration outright.
- **`describeSlotValue` lives in `command/props.ts` now, exported, not in `commands.ts`.** Moved at
  entry 0097 (D-094 clause 9) because the panel needs the identical value formatting `set`/`unlink`'s
  echo lines already used. If a future cycle wants to format a slot's value anywhere, import it from
  here — do not write a third copy of the `Value`-to-text switch. (`render/renderer.ts`'s
  `formatCellValue` is a SECOND one, over a narrower slice of `Value` and predating this move — not
  disclosed as related to `describeSlotValue` anywhere, and worth reconciling if a cycle opens that
  file for its own reason.)
- **Entry 0097's table-summary branch checks `object.type === TABLE_TYPE` directly, not "is this a
  dynamic group."** `TABLE_SCHEMA`'s `cells.*` is the ONLY dynamic `NonDerivedSlotPathGroup` in the
  registry today. A future dynamic group on a different type gets silently DROPPED by
  `buildSlotDescriptors`, not enumerated — disclosed in `props.ts`'s own header as a known gap, and
  flagged to the reviewer as entry 0097's first question. Check that question was answered before
  adding a second dynamic group anywhere.
