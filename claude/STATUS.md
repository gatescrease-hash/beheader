# STATUS — as of entry 0076

STATE: **GREEN, awaiting review.** Both configs compile, 925/925 tests pass, 0 skipped, 0 `.only`.
Entry 0075 fired **§6.1 trigger 5** (three `schema.test.ts` expectations changed) and is over
§6.3's cap (~835 lines / 13 files vs 800/10). `command/commands.ts`, `document.ts`'s
`mintObjectId` and `TABLE_SCHEMA`'s origin pair are **unreviewed**. Entry 0076 is the human's
RULINGS entry that followed — **D-075** and **D-076**, one comment changed, no behaviour.

Current phase: **3 — canvas, camera, geometry, command line.** `render/` and `command/` are now
both complete enough to wire: a typed or picked line becomes a `Command` (`parser.ts`/`prompt.ts`)
and the four CREATION commands run against a `Document` (`commands.ts`). **`main.ts` still holds
no canvas and listens for nothing, so no pixel has ever come out of this project.** Phase 3
criterion (§6): *"create a polygon and a table by command, see both drawn, pan/zoom, select, and
drag the polygon."* Creation works and is tested; the visible half is untested. NOT claimed.

Last review point: **0074-REVIEW-phase3, ACCEPT WITH EDITS.**
Cycles since last review: **1/3** · diff since last review: **~835 lines / 13 files** (cap 800/10).

## Next slice — `commands.ts`'s SLOT commands (§5.10, §5.1)

`set` / `set-formula` / `link` / `unlink`, in one cycle, because their debts are one debt:

1. **D-071 clause 4** — `link` and a formula-writing `set` share ONE slot-writing path. First call
   to `parseFormula` in the codebase, so **D-038's four conditions come due here**: validate on
   commit not per keystroke, carry the offending name and position in the `#PARSE`, keep
   `FUNCTION_REGISTRY` enumerable, never discard the source text.
2. **D-040/D-041** — reconcile Q-001/Q-002, do not re-decide. `set` over a formula slot REPLACES
   it and reports the formula source it replaced; `unlink` keeps the value last displayed, errors
   included.
3. A `derived` slot rejects both `set` and `link` (§5.1, D-040 bound 3). Bare cell refs:
   `parseFormula` takes a `tableObjectId` — a cell formula passes it, a non-cell formula must not.

Then `rename`/`delete`/`refs`/`list` (D-057's `brokenSlots` surfaces at `delete … force`) —
`list` and `refs` need no effect, they just return `lines` (D-075 clause 4).

Then `select`/`zoom`/`fit`/`save`/`load` **under D-075**: widen `CommandOutcome`'s success arm with
an optional plain-data `effect`; `commands.ts` still resolves `select intersection_a` and refuses an
unknown name; `main.ts` performs it. Then `main.ts` itself: ONE clamped camera to `renderDocument`,
`hitTest` and `pointerDown`/`pointerMove` (D-062); `zoom`/`fit` write `Document.camera` directly,
never through `mutate` (D-027 clause 2); reset the canvas transform before screen-space chrome; and
**wire `prompt.ts` — a canvas click during a live sequence is a `picked` response, not a
selection**, with screen→world done by `camera.ts` before it reaches `command/`.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · the whole table primitive through row/column
insert/delete and `delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit
(0058) · `primitives/geometry.ts` (0060) · `render/renderer.ts` (0062) · `render/hittest.ts` (0064) ·
entry 0065's header audit · `render/interaction.ts` (0067) · `command/parser.ts` (0069) ·
`command/prompt.ts` + D-071's formula path (0071) · entries 0072–0073's fix-list work (0074).

## Built this batch, not yet reviewed (entry 0075)

- **`src/command/commands.ts`** (new, 332) — `executeCommand(command, document)`, D-069's only
  meeting point. Four creation handlers; the other twelve `Command` arms routed and reporting
  `"<word>" has no handler yet — nothing was changed`, from an exhaustive switch. **D-070's bounds
  live here** (`MAX_POLYGON_SIDES` 1000, `MIN`/`MAX_TABLE_LINES` 1/1000), before any `Operation`.
- **`src/command/commands.test.ts`** (new, 369, 42 tests) — including the end-to-end pair that
  discharges the carried "end-to-end test through a table-creation command".
- **`src/engine/document.ts`** (+25, load-bearing) — `mintObjectId` returns `{ id, nextObjectId }`
  so D-002's advance cannot be forgotten. `obj_<n>` now exists in code exactly once.
- **`src/engine/primitives/schema.ts`** (+21/-9, load-bearing) and its test (+8/-6, **trigger 5**)
  — `TABLE_SCHEMA` declares `origin.x`/`origin.y`. **What this buys is `link table_x.origin.x
  <address>`**, since D-017 lets only a declared path hold a `formula` slot; drawing already worked.
- **Eight comment-only files** (`main.ts`, `renderer.ts`, `interaction.ts`, `hittest.ts` + test,
  `table.ts` + test, `mutation.ts`) — D-065 corrections for claims entry 0075 falsified.

## Not started

`set`/`link`/`unlink`/`rename`/`delete`/`refs`/`list` handlers, `select`/`zoom`/`fit`/`save`/`load`
effects, `main.ts` wiring, §5.9's visual-feedback trio (**D-068**), §5.9's per-vertex drag path,
`polyline`/`explode`/`addvertex`/`delvertex`, `style` slots, point-in-polygon fill hit-testing
(D-067), §5.4's formula bar / in-place cell editing · Phases 4–7. **Phase 4(b)'s shape already
works and is unclaimed** (0067-REVIEW probe P1); its authoring path (D-071/D-073) is complete and
reviewed, and a polygon can now be created to try it on.

## Open fix list — **read 0074-REVIEW §9 for the full text**; all six unchanged

None of it is `commands.ts` work and none blocked entry 0075. One line each: (1) report a refused
prompt answer with the sequence's own message, not `fromParse` — **D-074**, the one with a ruling
behind it · (2) a prompting command needs a usage line for the form it was used in, folded into
0069-REVIEW F3's sweep over all sixteen `usage` strings · (3) decide what a quoted command WORD
means, and correct entry 0072's "only site" claim · (4) disclose 0074-REVIEW F4's two message
changes, test (a) · (5) `set = x` wrongly says `"set" takes no formula` · (6) carried:
`parser.ts`'s header restating D-069 · the twelve bare "this cycle" sites and two stale claims in
test files · `render/slots.ts` at the THIRD consumer of `readNumber`/`asPointArray` ·
`.gitattributes`. **Item 6's "end-to-end test through a table-creation command" is DONE (0075).**

## Known problems (detail lives where the pointer says)

- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. All
  report "not built", not "unknown command" (`COMMANDS_SPECIFIED_BUT_NOT_BUILT`).
- **Twelve commands parse and then refuse** with "has no handler yet" (0075). Honest and correct
  for now; closes over the next two cycles. **`createObjectFromCommand`'s "type has no schema"
  branch is uncovered** — all four creatable types have schemas, so nothing can reach it.
- **A refused prompt answer is reported by the wrong grammar** — `circle 100,100 abc` blames
  `100,100`. Ruled **D-074**, fix-list item 1; no test pins the current behaviour.
- **Prompt order, wording and the `<8>` default form are a reading of AutoCAD, not the brief's.**
  Cheap to change; the human should say if any reads wrong in use. **No repeat-last-command
  gesture**; it needs the input bar.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — repair unbounded, slot walk
  extent-bounded; reachable only via a raw `setSlot`, pinned by `mutation.test.ts`'s "KNOWN
  INCOHERENCE" test, and D-053 forbids a one-sided fix.
- **This file is over §2's "< 150 lines"** — 169 at 0074-REVIEW, 181 now. Unlike the header budget
  (settled by D-076), no one has ruled on this one; raise it once, do not carry it every cycle.
- **Three carried render gaps, all deliberate:** one `mutate` per pointer move, each deep-cloning
  the document (§5.9's perf note — any fix MUST throttle, never write outside `mutation.ts`) · cell
  text is not clipped to its cell (§5.4 silent, Rule 5) · `readNumber`/`asPointArray` still have
  two consumers, and move to `render/slots.ts` at the THIRD (0064-REVIEW §5).
- **Carried unchanged, each with its pointer:** a loaded camera is not range-checked (D-062) ·
  `set-formula` is a `kind` that is not a registry name, so `parser.test.ts`'s "every command has
  an example" test cannot reach it — `commands.test.ts` now covers it explicitly · comment debt in
  TEST files only (0058-REVIEW F2) · mixed line endings in the WORKING TREE only
  (`core.autocrlf=true`) · dangling-reference messages name the DEPENDENT, not the missing SOURCE
  (0045-REVIEW F4) · D-022's bounded-correctness claim fails for `table` (0043-REVIEW §7 Q1) ·
  `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only, owed text boxes at Phase 5 ·
  journal structure unvalidated beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's
  `style` field · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-076**) binds without restatement here. Newest:
**D-070** creation counts bounded by the HANDLER, out of range REJECTS — **implemented at 0075** ·
**D-071** a formula is authored with `set <address> = <source>` · **D-072** a command word alone
enters a prompt sequence · **D-073** a formula's source is NEVER tokenized by the command lexer —
discharged at 0072 · **D-074** a prompt sequence's own refusal IS the message — **still open,
fix-list item 1** · **D-075** a command that changes no document state returns an EFFECT as plain
data and `main.ts` performs it; `commands.ts` still resolves the name and reports the refusal ·
**D-076** a header's PROSE is capped at 15 lines, its lists are not capped, and **header length is
no longer a finding — do not report one for being long.**

**D-047's open clause is settled: a created table has NO cell slots**, confirmed by the human at
entry 0076 on the condition D-047 clause 3 already guarantees — an absent cell and a `null` cell
behave identically inside an aggregate.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants): world units or screen pixels? Provisional (a) world units. Due with the
`style`-slots cycle — and also blocking `pan`'s argument grammar.
**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.
**Q-001/Q-002 are ANSWERED (D-041, D-040) and come due at the NEXT cycle's `set`/`unlink`
handlers** — reconcile, do not re-decide. Next free: **Q-014**.

## Gotchas for the next model

- **`executeCommand` is the ONLY place a `Command` meets a `Document` (D-069).** It returns a NEW
  document; the caller stores it. The success arm ALWAYS carries one, even for a command that
  changed nothing, so there is no caller-side branch.
- **A creation handler never lists derived slot paths.** It fills them from `schema.derivedSlots`
  with `value: null`, and step 7 of the same mutation overwrites them before anything commits. Add
  a derived slot to a schema and creation needs no edit.
- **`mintObjectId` returns the ADVANCED counter with the id.** Store both or you mint a duplicate.
  It advances only on success — a refused creation takes no id.
- **A created table has `origin.x`/`origin.y` and `rows`/`cols`, and NO cells.** `TABLE_SCHEMA`
  declares the origin pair, which is what makes `link table_x.origin.x` possible at all (D-017).
- **A command word alone is not an error (D-072).** `beginCommand` in `command/prompt.ts` is the
  entry point for a typed line, not `parseCommand`. **A pick reaches `command/` as a WORLD point**,
  converted by `camera.ts` — never import `render/` into `command/` source (a TEST may, and
  `commands.test.ts` does, in one block, to prove the seam). **`parser.ts` resolves NOTHING and
  takes no document (D-069)**, and **a formula's source is opaque to `command/` past its `=`
  (D-073)** — only formula ARITY is rejected there, and no prompting command may declare a
  `literal-or-formula` position (a test pins it).
- **A non-finite or `-0` number, and a fractional or negative COORDINATE, all still reach `mutate`
  unchanged** — D-031 clause 3. **Only the three COUNTS are bounded, and only in the handler**
  (D-070). A coordinate that overflows is refused by `mutate` with a good message; see entry 0075.
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Entry 0075 owed eight such corrections. Grep for the name of every file and capability
  you just created, before writing your entry.
- **Preserve each file's LINE ENDINGS when editing.** `document.ts`/`schema.ts` are CRLF;
  `parser.ts`, `main.ts` and `render/*` are LF. An editor that normalises rewrites the whole file
  and buries a four-line change in a 500-line diff.
- **Three different reasons to read a slot, and they do NOT unify** (0062-, 0067-REVIEW): to
  DRAW/HIT-TEST (`readNumber`, kind-blind), to SIZE the slot set (`readTableDimension`,
  `literal`-only), to decide whether it may be WRITTEN (`interaction.ts`, kind-aware).
- **Cite the ruling you actually mean.** Standing: D-064 (presets wind counterclockwise) · D-005 (a
  slot's stored key is the PATH joined with `.`) · D-066 (a degenerate extent needs its OWN guard) ·
  D-061 (`camera.x`/`.y` is the world point at the screen's TOP-LEFT corner). House style: close
  every union `switch` with `const exhaustive: never = x; void exhaustive;`, and **`render/` and
  `command/` are not `engine/`** — run BOTH tsconfigs anyway.
- **Mutation-check a suite that passes first try — and check the checker.** Strip ANSI
  (`sed 's/\x1b\[[0-9;]*m//g'`) and assert on the `Tests  N failed` line, then break one assertion
  on purpose and confirm the checker notices (D-016's lesson, one layer up).
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change
  fires** (entry 0073). Apply §6.1 mechanically — 0075 fired trigger 5 for a test expectation two
  reviews had explicitly asked for.
- **Do NOT report a header for being long (D-076).** PROCESS_BRIEF §5.2's 20–40 / ~80 budget is
  withdrawn. What IS capped is `WHAT THIS IS` at 15 lines; `INVARIANTS UPHELD HERE` and `NOT DONE
  HERE` are uncapped, one line per item. Twelve files miss the prose cap today and stay as they
  are — it binds new and edited headers only, and there is no sweep.
