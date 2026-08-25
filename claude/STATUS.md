# STATUS — as of entry 0080

STATE: **GREEN.** Both configs compile, 977/977 tests pass, 0 skipped, 0 `.only`. Entry 0079 has
been **reviewed and accepted with edits** (0080-REVIEW-phase3): two findings fixed at the review,
two on its fix list, one new ruling (**D-078**). Nothing is awaiting review; the next slice is free
to start.

Current phase: **3 — canvas, camera, geometry, command line.** A typed line can now CREATE the four
objects and WIRE them: `set`, `set <address> = <formula>`, `link` and `unlink` all run against a
`Document`. **`main.ts` still holds no canvas and listens for nothing, so no pixel has ever come out
of this project.** Phase 3 criterion (§6): *"create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon."* The engine half is done and tested; the visible
half is untested and unbuilt. NOT claimed.

Last review point: **0080-REVIEW-phase3, ACCEPT WITH EDITS.**
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).

## Read this first — the one known defect, and it now has an owner

**`executeCommand` THROWS on one typed line.** `set table_1.A1 = 1 + 1 + …` at about 5,000 terms
exhausts the stack inside `formula/parser.ts`'s recursive descent and a `RangeError` unwinds out of
the command line. `formatFormula` fails at the same depth; measured together at entry 0079, band
5,000–6,000, stack-sensitive. `commands.ts`'s header and `executeCommand`'s doc now STATE this
exception instead of claiming a never-throws property that is false.

This is D-077 clause 2 working — the claim was probed instead of reasoned about — and it is the
same shape as 0078-REVIEW's F1: a "never throws" assertion over something the user sizes.
0080-REVIEW reproduced it independently and made it **fix-list item 1**: a depth limit in the
recursive-descent parser returning `#PARSE` rather than unwinding, plus the same guard on
`format.ts`'s own recursion, because a `#PARSE` at authoring time does nothing for an AST that
arrived from a LOADED file. **Take it as its own small slice before `main.ts`** — a `RangeError` out
of a canvas repaint is far harder to attribute than one out of a command line. `format.ts` and
`writeSlot` now state the exception too (D-078); `parser.ts`'s two claims stay uncorrected until the
depth limit makes them true again.

## Next slice — `rename`/`delete`/`refs`/`list`, then D-075's effects

1. **`rename`/`delete`** resolve a NAME, not an address, so `checkNameAvailable` and §5.2's grammar
   come due; `delete` carries §5.1.1's two paths and surfaces D-057's `brokenSlots` at
   `delete … force`.
2. **`refs`/`list`** need no effect — they read the document and return `lines` (D-075 clause 4).
   `refs` is the one that finally has something to report, now that `link` can make an edge.
3. Then **`select`/`zoom`/`fit`/`save`/`load` under D-075**: widen `CommandOutcome`'s success arm
   with an optional plain-data `effect`; `commands.ts` still resolves `select intersection_a` and
   refuses an unknown name; `main.ts` performs it.
4. Then **`main.ts`**: ONE clamped camera to `renderDocument`, `hitTest` and
   `pointerDown`/`pointerMove` (D-062); `zoom`/`fit` write `Document.camera` directly, never through
   `mutate` (D-027 clause 2); reset the canvas transform before screen-space chrome; and **wire
   `prompt.ts` — a canvas click during a live sequence is a `picked` response, not a selection**,
   with screen→world done by `camera.ts` before it reaches `command/`.

The parser depth limit (fix-list item 1) is its own small slice and blocks nothing else — but take
it BEFORE step 4, per 0080-REVIEW F3.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · the whole table primitive through row/column
insert/delete and `delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit
(0058) · `primitives/geometry.ts` (0060) · `render/renderer.ts` (0062) · `render/hittest.ts` (0064) ·
entry 0065's header audit · `render/interaction.ts` (0067) · `command/parser.ts` (0069) ·
`command/prompt.ts` + D-071's formula path (0071) · entries 0072–0073's fix-list work (0074) ·
`command/commands.ts`'s seam and its four creation handlers, `document.ts`'s `mintObjectId`, and
`TABLE_SCHEMA`'s `origin.x`/`origin.y` (0078) · **`commands.ts`'s four slot commands through
one `writeSlot` path, and `engine/formula/format.ts` (0080)**.

## What entry 0079 built, as reviewed at 0080

- **`command/commands.ts`'s four slot commands** — `set` (literal), `set <address> = <formula>`,
  `link`, `unlink` — through ONE `writeSlot` path (D-071 clause 4), with D-040's replaced-formula
  report and D-041's kept value discharged in that one place. Three refusals live in
  `resolveWritableSlot`: an unresolvable address, a `derived` slot, and a path the schema does not
  declare (which also gives a table cell its extent check for free).
- **`src/engine/formula/format.ts` (new)** — `formatFormula(ast, objects)`, §5.2's "displaying a
  formula maps IDs back to current names." It exists because D-040 requires reporting the source of
  a replaced formula and NOTHING stores source: a stored source string would go stale on the first
  `rename`, so it is reconstructed from the AST. Consequence, visible and deliberate: the operator
  gets the formula's meaning spelled canonically, not their keystrokes — `1+2 * 3` reports as
  `1 + 2 * 3`.
- Fix-list items 1 and 2 of 0078-REVIEW §9, plus five D-065 comment corrections.

## Not started

`rename`/`delete`/`refs`/`list` handlers, `select`/`zoom`/`fit`/`save`/`load` effects, `main.ts`
wiring, §5.9's visual-feedback trio (**D-068**), §5.9's per-vertex drag path, `polyline`/`explode`/
`addvertex`/`delvertex`, `style` slots, point-in-polygon fill hit-testing (D-067), §5.4's formula
bar / in-place cell editing · Phases 4–7.

**Phase 4 is close and is NOT claimed.** (a) data drives geometry and (b) geometry drives data are
both reachable from typed lines now and are demonstrated by `commands.test.ts`'s "the loop these
four commands close" block. (c) partial binding under DRAG exists in `render/interaction.ts` (0066)
but no test puts all three in ONE document, which is what "simultaneously" requires — and §6 forbids
starting a phase before its predecessor's criterion passes, which Phase 3's has not.

## Open fix list — **read 0080-REVIEW §9 for the full text**

1. **Depth-limit `formula/parser.ts`'s recursive descent** — return `#PARSE` past a fixed depth
   instead of unwinding, guard `format.ts`'s recursion for the loaded-file path, then remove the
   exception sentences the four sites now carry and pin the bound with a test. See the top of this
   file. Blocks nothing; take it before `main.ts`.
2. **Give the missing-slot refusal a remedy** — "references a slot that does not exist" is true and
   tells the operator nothing to do. Message only: **D-047 clause 4 does not move** (0080-REVIEW F4
   ruled it stands, and the surprise below is the ruled behaviour).

**Carried from 0074-REVIEW §9 through 0078-REVIEW, all six unchanged, none blocking:** (1) report a
refused prompt answer with the sequence's own message — **D-074**, the one with a ruling behind it ·
(2) a usage line for the form a prompting command was used in, folded into 0069-REVIEW F3's sweep
over all sixteen `usage` strings · (3) decide what a quoted command WORD means, and correct entry
0072's "only site" claim · (4) disclose 0074-REVIEW F4's two message changes, test (a) · (5)
`set = x` wrongly says `"set" takes no formula` — it lives in `parser.ts`'s argument matching · (6)
`parser.ts`'s header restating D-069 · the twelve bare "this cycle" sites in test files ·
`render/slots.ts` at the THIRD consumer of `readNumber`/`asPointArray` · `.gitattributes`.

0078-REVIEW §9's items 1 and 2 are **DONE** (entry 0079, confirmed at 0080).

## Known problems (detail lives where the pointer says)

- **`executeCommand` throws at ~5,000 formula nesting levels** — see the top of this file. Owned by
  fix-list item 1. Every claim on that call path now states the exception except `parser.ts`'s two,
  which the depth limit will make true outright rather than qualified (D-078).
- **A bare reference to an EMPTY cell is REFUSED.** `set table_1.A1 = table_1.B1` on a fresh table
  fails with "references a slot that does not exist", because creation makes no cell slots (D-047)
  and D-047 clause 4 makes an absent cell fine inside a RANGE and not fine as a plain reference.
  Ruled behaviour, working as written, pinned by a test at 0079 — and still going to surprise the
  operator, since `= SUM(B1:B4)` works on the same empty table. **0080-REVIEW F4 looked and ruled it
  STANDS** — a range names a region and tolerates absence, a bare reference names one slot the
  operator wrote. Only the MESSAGE changes (fix-list item 2); do not re-raise the behaviour.
- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. All
  report "not built", not "unknown command" (`COMMANDS_SPECIFIED_BUT_NOT_BUILT`).
- **Nine commands parse and then refuse** with "has no handler yet" (`rename`/`delete`/`refs`/
  `list`/`select`/`zoom`/`fit`/`save`/`load`). Honest and correct for now; closes over the next two
  cycles. **`createObjectFromCommand`'s "type has no schema" branch is uncovered** — all four
  creatable types have schemas, so nothing can reach it. `describeSlotValue`'s `Point` and `Point[]`
  arms are uncovered for the same kind of reason (no command can put either in a slot yet).
- **A 1000×1000 table is legal and costs ~1.2 s per MUTATION** — 1,000,000 declared cell paths
  re-enumerated on every mutation, measured at 0078-REVIEW. Rule 5's accepted trade and **not a
  defect**; here so the human can lower D-070's cap if a real document ever wants to. **Do not
  "fix" it by tightening a bound (D-077 clause 3).**
- **A `#PARSE` position is an offset into the FORMULA, not into the line.** `commands.ts` never sees
  the line, only the trimmed source `parser.ts` sliced for it, so a caret-positioning `main.ts` will
  need `SetFormulaCommand` to carry the line offset of its `=` PLUS the width of the whitespace
  `buildSlot` trims. Additive when wanted.
- **A refused prompt answer is reported by the wrong grammar** — `circle 100,100 abc` blames
  `100,100`. Ruled **D-074**, fix-list item 3(1); no test pins the current behaviour.
- **Prompt order, wording and the `<8>` default form are a reading of AutoCAD, not the brief's.**
  Cheap to change; the human should say if any reads wrong in use. **No repeat-last-command
  gesture**; it needs the input bar.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — repair unbounded, slot walk
  extent-bounded; reachable only via a raw `setSlot`, pinned by `mutation.test.ts`'s "KNOWN
  INCOHERENCE" test, and D-053 forbids a one-sided fix.
- **Three carried render gaps, all deliberate:** one `mutate` per pointer move, each deep-cloning
  the document (§5.9's perf note — any fix MUST throttle, never write outside `mutation.ts`) · cell
  text is not clipped to its cell (§5.4 silent, Rule 5) · `readNumber`/`asPointArray` still have
  two consumers, and move to `render/slots.ts` at the THIRD (0064-REVIEW §5).
- **Carried unchanged, each with its pointer:** a loaded camera is not range-checked (D-062) ·
  `set-formula` is a `kind` that is not a registry name, so `parser.test.ts`'s "every command has
  an example" test cannot reach it — `commands.test.ts` covers it explicitly · comment debt in
  TEST files only (0058-REVIEW F2) · mixed line endings in the WORKING TREE only
  (`core.autocrlf=true`) · dangling-reference messages name the DEPENDENT, not the missing SOURCE
  (0045-REVIEW F4) · D-022's bounded-correctness claim fails for `table` (0043-REVIEW §7 Q1) ·
  `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only, owed text boxes at Phase 5 ·
  journal structure unvalidated beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's
  `style` field · `noUnusedLocals` off.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-078**) binds without restatement here. Newest:
**D-070** creation counts bounded by the HANDLER — implemented at 0075 · **D-071** a formula is
authored with `set <address> = <source>` — implemented at 0079, clause 4's ONE path included ·
**D-072** a command word alone enters a prompt sequence · **D-073** a formula's source is NEVER
tokenized by the command lexer — discharged at 0072 · **D-074** a prompt sequence's own refusal IS
the message — **still open**, fix-list item 3(1) · **D-075** a command that changes no document
state returns an EFFECT as plain data — **not yet implemented**, it is the slice after next ·
**D-076** a header's PROSE is capped at 15 lines and every other length budget is withdrawn —
**length is not a finding, do not report it** · **D-077** a dynamic slot family's size is DOCUMENT
STATE: never spread one into a call, and probe every "never throws" claim at the largest size the
bounds allow · **D-078** a probe that falsifies a property falsifies EVERY claim of it on that call
path — correct all of them, in both directions, or the finding is not discharged; a claim false only
past a size bound is QUALIFIED with the measurement, not deleted, and this authorises no sweep.

**D-040 and D-041 are IMPLEMENTED, not merely ruled** (entry 0079), and **Q-001/Q-002 are
reconciled**: D-041's kept value is `FormulaSlot.value`, D-040's report is `formatFormula` of the
AST that was there. Neither had a `PROVISIONAL` tag in the tree. **D-038's four conditions are
discharged** at the codebase's first `parseFormula` call from `command/`.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants): world units or screen pixels? Provisional (a) world units. Due with the
`style`-slots cycle — and also blocking `pan`'s argument grammar.
**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.
Next free: **Q-014**.

## Gotchas for the next model

- **Correct every claim a probe falsifies, not the one you were reading (D-078).** Entry 0079
  measured the throw and fixed `commands.ts`; `format.ts`'s own header still said "Never throws" in
  a file that same cycle created. Grep the call path in both directions — what throws, what asserts
  the property while calling it, what asserts it while being called by it.
- **A `#PARSE` position is an offset into the string the message QUOTES.** `buildSlot` trims the
  formula source before parsing for exactly that reason (0080-REVIEW F1); a position measured
  against a different string than the one printed beside it is worse than no position at all.
- **Probe a "never throws" claim; do not reason about it (D-077 clause 2).** Entry 0079 did, and it
  cost the claim: `executeCommand` throws at ~5,000 formula nesting levels. Two reviews running have
  now found this shape. If your cycle writes or inherits a never-throws sentence, find the user-sized
  thing behind it and push it to the bound.
- **`writeSlot` in `commands.ts` is the ONE place a slot is written by command.** `set`, `link` and
  `unlink` are three requests into it, not three code paths. D-040's report lives there for exactly
  that reason — put a fourth slot-writing command through it, do not add a second path.
- **A formula's SOURCE does not exist anywhere.** It is reconstructed from the AST by
  `formula/format.ts` against current names. Do not add a source field to `FormulaSlot`: §5.2's
  whole point is that a rename rewrites nothing, and a stored string would go stale.
- **`executeCommand` is the ONLY place a `Command` meets a `Document` (D-069).** It returns a NEW
  document; the caller stores it. The success arm ALWAYS carries one.
- **A creation handler never lists derived slot paths.** It fills them from `schema.derivedSlots`
  with `value: null`, and step 7 of the same mutation overwrites them before anything commits.
- **`mintObjectId` returns the ADVANCED counter with the id.** Store both or you mint a duplicate.
- **A created table has `origin.x`/`origin.y` and `rows`/`cols`, and NO cells.** `set table_x.A1 5`
  is how a cell slot first comes into being. Its declared-but-absent cell paths take
  `deriveEdges`'s unpopulated branch on every mutation: ordinary state, not a defect (D-047).
- **Never spread a collection the user can size (D-077).** `push(...family)`, `Math.max(...family)`
  all pass it as ARGUMENTS and die of `RangeError` past ~125k elements.
- **A command word alone is not an error (D-072).** `beginCommand` in `command/prompt.ts` is the
  entry point for a typed line, not `parseCommand`. **A pick reaches `command/` as a WORLD point** —
  never import `render/` into `command/` source (a TEST may, and `commands.test.ts` does, in one
  block, to prove the seam). **`parser.ts` resolves NOTHING and takes no document (D-069)**, and
  **a formula's source is opaque to `command/` past its `=` (D-073)**.
- **A non-finite or `-0` number, and a fractional or negative COORDINATE, all still reach `mutate`
  unchanged** — D-031 clause 3. **Only the three COUNTS are bounded, and only in the handler**
  (D-070).
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Entry 0079 owed five and made them; grep for the name of every file and capability you
  create, and **re-read the headers of the files you edited** — that is the direction 0078-REVIEW F2
  called hardest to see.
- **Preserve each file's LINE ENDINGS when editing.** `document.ts`/`schema.ts`/`mutation.ts` are
  CRLF in the index; every file entry 0079 touched is LF on disk.
- **Three different reasons to read a slot, and they do NOT unify** (0062-, 0067-REVIEW): to
  DRAW/HIT-TEST (`readNumber`, kind-blind), to SIZE the slot set (`readTableDimension`,
  `literal`-only), to decide whether it may be WRITTEN (`interaction.ts`, kind-aware). A fourth is
  now beside them: to decide whether a command MAY write it (`resolveWritableSlot`, schema-aware).
- **Cite the ruling you actually mean.** Standing: D-064 (presets wind counterclockwise) · D-005 (a
  slot's stored key is the PATH joined with `.`) · D-066 (a degenerate extent needs its OWN guard) ·
  D-061 (`camera.x`/`.y` is the world point at the screen's TOP-LEFT corner) · D-030 (`^` is
  LEFT-associative — `format.ts` depends on it). House style: close every union `switch` with
  `const exhaustive: never = x; void exhaustive;`, and **`render/` and `command/` are not
  `engine/`** — run BOTH tsconfigs anyway.
- **Mutation-check a suite that passes first try — and check the checker.** Strip ANSI
  (`sed 's/\x1b\[[0-9;]*m//g'`) and assert on the `Tests  N failed` line. Entry 0079's
  `format.test.ts` passed 18/18 first try and two neutralisations proved it was checking.
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change
  fires** (entry 0073). Entry 0079 fired trigger 5 for a test change 0078-REVIEW had asked for, and
  reported it.
- **Do NOT report the LENGTH of anything (D-076)** — not a header, not this file, not a source
  file. The one length rule that survives is **`WHAT THIS IS` capped at 15 lines**, and it binds new
  and edited headers only. There is no sweep.
