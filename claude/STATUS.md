# STATUS — as of entry 0081

STATE: **GREEN.** Both configs compile, 1003/1003 tests pass, 0 skipped, 0 `.only`. Entry 0081 is
**built and NOT yet reviewed** — it fired §6.1 trigger 5, so a review point is open.

Current phase: **3 — canvas, camera, geometry, command line.** A typed line can now CREATE the four
objects, WIRE them (`set`, `set <address> = <formula>`, `link`, `unlink`), and now READ and REMOVE
them (`refs`, `list`, `delete [force]`). **`main.ts` still holds no canvas and listens for nothing, so
no pixel has ever come out of this project.** Phase 3 criterion (§6): *"create a polygon and a table by
command, see both drawn, pan/zoom, select, and drag the polygon."* The engine half is done and tested;
the visible half is untested and unbuilt. NOT claimed.

Last review point: **0080-REVIEW-phase3, ACCEPT WITH EDITS.**
Cycles since last review: **1/3** · diff since last review: **522 lines / 2 files** (cap 800/10).

## Read this first — the two things a cold reader needs

**1. `executeCommand` THROWS on one typed line, and the band is NOT a constant.** A formula whose AST
nests too deep exhausts the stack inside `formula/parser.ts`'s recursive descent and a `RangeError`
unwinds out of the command line; `formatFormula` fails at the same depth. Entry 0079 measured
**~5,000 terms of `1 + 1 + …`**; entry 0081 measured **~3,000 terms of `table_1.B1 + table_1.B1 + …`**.
**The depth depends on what the terms are, not just how many** — a reference costs more stack than a
literal. 0080-REVIEW's fix-list item 1 owns this (a depth limit in the parser returning `#PARSE`, plus
the same guard on `format.ts`'s recursion for the loaded-file path). **Set the limit from the worst
term, not from entry 0079's number.** Take it before `main.ts`: a `RangeError` out of a canvas repaint
is far harder to attribute than one out of a command line.

**2. `refs` had to simulate the deletion, and the reason is not obvious.** `refs <object>` derives its
blocking half over the document **without** that object, because a range over cells nobody has written
expands to **no edges at all** (D-047 item 1) and only becomes the one dangling edge `deriveEdges`
falls back to once the table it names is gone. A `refs` reading the current edge set answered
"nothing references table_1" for a document whose `delete table_1` is refused — found by probe at
entry 0081, after twelve tests over the wrong version had passed. Do not "simplify" it back.

## Next slice — `rename`, then D-075's effects, then `main.ts`

1. **`rename`** is the one §5.10 object command that needs a NEW `Operation` kind — `renameObject` in
   `mutation.ts`, a load-bearing file. `checkNameAvailable(name, objects, excludeId)` already exists
   and is the single gate (§5.2's grammar plus uniqueness); the handler resolves the old NAME the way
   `delete` now does (`findGraphObjectByName`). Nothing else in §5.10 is blocked on it.
2. Then **`select`/`zoom`/`fit`/`save`/`load` under D-075**: widen `CommandOutcome`'s success arm with
   an optional plain-data `effect`; `commands.ts` still resolves `select intersection_a` and refuses an
   unknown name; `main.ts` performs it.
3. Then **`main.ts`**: ONE clamped camera to `renderDocument`, `hitTest` and
   `pointerDown`/`pointerMove` (D-062); `zoom`/`fit` write `Document.camera` directly, never through
   `mutate` (D-027 clause 2); reset the canvas transform before screen-space chrome; and **wire
   `prompt.ts` — a canvas click during a live sequence is a `picked` response, not a selection**,
   with screen→world done by `camera.ts` before it reaches `command/`.

The parser depth limit (fix-list item 1) is its own small slice and blocks nothing else — but take it
BEFORE step 3, per 0080-REVIEW F3.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · the whole table primitive through row/column
insert/delete and `delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit
(0058) · `primitives/geometry.ts` (0060) · `render/renderer.ts` (0062) · `render/hittest.ts` (0064) ·
entry 0065's header audit · `render/interaction.ts` (0067) · `command/parser.ts` (0069) ·
`command/prompt.ts` + D-071's formula path (0071) · entries 0072–0073's fix-list work (0074) ·
`command/commands.ts`'s seam and its four creation handlers, `document.ts`'s `mintObjectId`, and
`TABLE_SCHEMA`'s `origin.x`/`origin.y` (0078) · `commands.ts`'s four slot commands through one
`writeSlot` path, and `engine/formula/format.ts` (0080).

## Built this batch, not yet reviewed

**Entry 0081 — `command/commands.ts`'s `delete`, `refs` and `list` handlers.** No engine file changed.

- **`delete <object> [force]`** — resolves the name, builds one `DeleteObjectOperation` carrying the
  flag, calls `mutate`. It chooses **neither** of §5.1.1's two paths; the flag selects them inside
  `mutate`. It owns two things `mutate` cannot say: the **remedy** (a rejection names every dependent
  and cannot name a `force` flag, because an `Operation` carries no command syntax) and the **report**
  — **D-057's `brokenSlots` has its first reader here**, formatted against the committed objects per
  D-059.
- **`refs <object|address>`** — every slot that reads the target, printed `source → dependent`, split
  into dependents on other objects and dependents on the target's own object, with a summary line
  counting the two apart. The two forms are told apart by `isValidName` (address.ts's own §5.2 grammar),
  never a dot rule spelled out locally. A `derived` path is an ACCEPTED target here, unlike
  `resolveWritableSlot`'s refusal. See "Read this first" item 2 for the blocking half's derivation.
- **`list`** — `<name> — <type>` per object in creation order, `no objects` when empty. No ids.
- Both read-only commands return the document they were given **by identity** and journal nothing,
  which is why D-075 clause 4 gives them no `effect`.
- 29 new tests, 3 removed (the `"<word>" has no handler yet` ones), **twelve mutation checks, all
  caught**, and a D-077 clause 2 size probe at `rows=1000 cols=1000` plus the deep-formula band.

## Not started

`rename` handler, `select`/`zoom`/`fit`/`save`/`load` effects, `main.ts` wiring, §5.9's visual-feedback
trio (**D-068**), §5.9's per-vertex drag path, `polyline`/`explode`/`addvertex`/`delvertex`, `style`
slots, point-in-polygon fill hit-testing (D-067), §5.4's formula bar / in-place cell editing ·
Phases 4–7.

**Phase 4 is close and is NOT claimed.** (a) data drives geometry and (b) geometry drives data are both
reachable from typed lines and are demonstrated by `commands.test.ts`'s "the loop these four commands
close" block. (c) partial binding under DRAG exists in `render/interaction.ts` (0066) but no test puts
all three in ONE document, which is what "simultaneously" requires — and §6 forbids starting a phase
before its predecessor's criterion passes, which Phase 3's has not.

## Open fix list — **read 0080-REVIEW §9 for the full text**

1. **Depth-limit `formula/parser.ts`'s recursive descent** — return `#PARSE` past a fixed depth instead
   of unwinding, guard `format.ts`'s recursion for the loaded-file path, then remove the exception
   sentences the four sites now carry and pin the bound with a test. **Entry 0081 widened what this has
   to cover** — see "Read this first" item 1. Blocks nothing; take it before `main.ts`.
2. **Give the missing-slot refusal a remedy** — "references a slot that does not exist" is true and
   tells the operator nothing to do. Message only: **D-047 clause 4 does not move** (0080-REVIEW F4).
   Note `delete` now does exactly this for its own refusal, and is the worked example.

**Carried from 0074-REVIEW §9 through 0080-REVIEW, all six unchanged, none blocking:** (1) report a
refused prompt answer with the sequence's own message — **D-074**, the one with a ruling behind it ·
(2) a usage line for the form a prompting command was used in, folded into 0069-REVIEW F3's sweep over
all sixteen `usage` strings · (3) decide what a quoted command WORD means, and correct entry 0072's
"only site" claim · (4) disclose 0074-REVIEW F4's two message changes, test (a) · (5) `set = x` wrongly
says `"set" takes no formula` — it lives in `parser.ts`'s argument matching · (6) `parser.ts`'s header
restating D-069 · the twelve bare "this cycle" sites in test files · `render/slots.ts` at the THIRD
consumer of `readNumber`/`asPointArray` · `.gitattributes`.

## Known problems (detail lives where the pointer says)

- **`executeCommand` throws on a deep enough formula, and the band depends on the terms** — see the top
  of this file. Owned by fix-list item 1.
- **`refs` names a range's START cell as the source** when the range's table is being removed, so the
  line reads `table_1.A1 → table_2.A1` for a formula that reads `A1:A4`. The DEPENDENT is right, which
  is what §5.1.1 asks to be named, and the source is a real address rather than an invented one — but
  it is less than the whole truth. Entry 0081, disclosed not fixed.
- **`refs <object>` derives edges twice**, once over the document and once over the document without
  the target. Rule 5's accepted trade; measured at 326 ms for the largest table D-070 allows.
- **Two sites now ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. Disclosed at entry 0081 under §4's no-refactor rule;
  `declaresSlotPath`'s doc names the condition for merging them and forbids a third site.
- **No test covers an EXTERNAL formula reading a `derived` slot of an object that is then deleted.**
  The repair path treats it as any plain reference, so it should behave, but nothing pins it
  (entry 0081, the cheapest gap left).
- **A bare reference to an EMPTY cell is REFUSED.** `set table_1.A1 = table_1.B1` on a fresh table fails
  with "references a slot that does not exist", because creation makes no cell slots (D-047) and D-047
  clause 4 makes an absent cell fine inside a RANGE and not fine as a plain reference. **0080-REVIEW F4
  ruled it STANDS.** Only the MESSAGE changes (fix-list item 2); do not re-raise the behaviour.
- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. All report
  "not built", not "unknown command" (`COMMANDS_SPECIFIED_BUT_NOT_BUILT`).
- **Six commands parse and then refuse** with "has no handler yet" (`rename`/`select`/`zoom`/`fit`/
  `save`/`load`). Honest and correct for now. **`createObjectFromCommand`'s "type has no schema" branch
  is uncovered** — all four creatable types have schemas, so nothing can reach it. `describeSlotValue`'s
  `Point` and `Point[]` arms are uncovered for the same kind of reason.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION** — 1,000,000 declared cell paths
  re-enumerated on every mutation. Rule 5's accepted trade and **not a defect**; here so the human can
  lower D-070's cap if a real document ever wants to. **Do not "fix" it by tightening a bound**
  (D-077 clause 3).
- **A `#PARSE` position is an offset into the FORMULA, not into the line.** A caret-positioning
  `main.ts` will need `SetFormulaCommand` to carry the line offset of its `=` PLUS the width of the
  whitespace `buildSlot` trims. Additive when wanted.
- **A refused prompt answer is reported by the wrong grammar** — `circle 100,100 abc` blames
  `100,100`. Ruled **D-074**, fix-list item 3(1); no test pins the current behaviour.
- **Prompt order, wording and the `<8>` default form are a reading of AutoCAD, not the brief's.** Cheap
  to change; the human should say if any reads wrong in use. **No repeat-last-command gesture**; it
  needs the input bar.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — repair unbounded, slot walk
  extent-bounded; reachable only via a raw `setSlot`, pinned by `mutation.test.ts`'s "KNOWN
  INCOHERENCE" test, and D-053 forbids a one-sided fix.
- **Three carried render gaps, all deliberate:** one `mutate` per pointer move, each deep-cloning the
  document (§5.9's perf note — any fix MUST throttle, never write outside `mutation.ts`) · cell text is
  not clipped to its cell (§5.4 silent, Rule 5) · `readNumber`/`asPointArray` still have two consumers,
  and move to `render/slots.ts` at the THIRD (0064-REVIEW §5).
- **Carried unchanged, each with its pointer:** a loaded camera is not range-checked (D-062) ·
  `set-formula` is a `kind` that is not a registry name, so `parser.test.ts`'s "every command has an
  example" test cannot reach it — `commands.test.ts` covers it explicitly · comment debt in TEST files
  only (0058-REVIEW F2) · mixed line endings in the WORKING TREE only (`core.autocrlf=true`) ·
  dangling-reference messages name the DEPENDENT, not the missing SOURCE (0045-REVIEW F4) · D-022's
  bounded-correctness claim fails for `table` (0043-REVIEW §7 Q1) · `describeValueType` duplicated in
  `functions.ts`/`eval.ts` · `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only, owed
  text boxes at Phase 5 · journal structure unvalidated beyond `Array.isArray` · `lexer.ts`'s two edge
  cases · §5.11's `style` field · `noUnusedLocals` off.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-078**) binds without restatement here. Newest:
**D-070** creation counts bounded by the HANDLER — implemented at 0075 · **D-071** a formula is authored
with `set <address> = <source>` — implemented at 0079 · **D-072** a command word alone enters a prompt
sequence · **D-073** a formula's source is NEVER tokenized by the command lexer — discharged at 0072 ·
**D-074** a prompt sequence's own refusal IS the message — **still open**, fix-list item 3(1) ·
**D-075** a command that changes no document state returns an EFFECT as plain data — **clause 4 is
implemented at 0081** (`refs`/`list` return `lines` and no effect); clauses 1–3 and 5 are still the
slice after next · **D-076** a header's PROSE is capped at 15 lines and every other length budget is
withdrawn — **length is not a finding, do not report it** · **D-077** a dynamic slot family's size is
DOCUMENT STATE: never spread one into a call, and probe every "never throws" claim at the largest size
the bounds allow · **D-078** a probe that falsifies a property falsifies EVERY claim of it on that call
path.

**D-057 is IMPLEMENTED end to end as of entry 0081**: the channel was built at the `force` slice and
now has a reader — `delete <object> force` reports every slot it broke. **D-040/D-041 are implemented**
(entry 0079) and **Q-001/Q-002 are reconciled**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the `TABLE_CELL_*`
constants): world units or screen pixels? Provisional (a) world units. Due with the `style`-slots cycle
— and also blocking `pan`'s argument grammar.
**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.
Next free: **Q-014**.

## Gotchas for the next model

- **A range over cells nobody has written creates NO edges** (D-047 item 1) and becomes ONE dangling
  edge the moment the table it names disappears. That asymmetry is why `refs <object>` simulates the
  removal. Anything else that asks "who reads this object" inherits the same trap.
- **`delete` appends the remedy to `mutate`'s message rather than pre-checking.** The pre-check version
  was written and dropped: it is a second, weaker definition of §5.1.1 beside the real one, and it
  misses the range case above. If you add a destructive command, do the same.
- **A measurement can be less general than it looks (D-078 clause 3).** Entry 0079's ~5,000-term band
  and entry 0081's ~3,000-term band are the same defect at different term costs. State what you fed it.
- **Correct every claim a probe falsifies, not the one you were reading (D-078).** Grep the call path in
  both directions.
- **`writeSlot` in `commands.ts` is the ONE place a slot is written by command.** Put a fourth
  slot-writing command through it; do not add a second path.
- **A formula's SOURCE does not exist anywhere.** It is reconstructed from the AST by
  `formula/format.ts` against current names. Do not add a source field to `FormulaSlot`.
- **`executeCommand` is the ONLY place a `Command` meets a `Document` (D-069).** It returns a NEW
  document; the caller stores it. The success arm ALWAYS carries one — including `refs` and `list`,
  which return the one they were handed, by identity.
- **A creation handler never lists derived slot paths.** It fills them from `schema.derivedSlots` with
  `value: null`, and step 7 of the same mutation overwrites them before anything commits.
- **`mintObjectId` returns the ADVANCED counter with the id.** Store both or you mint a duplicate.
  Deleting an object frees its NAME and never its id (D-002) — pinned by a test at 0081.
- **A created table has `origin.x`/`origin.y` and `rows`/`cols`, and NO cells.** `set table_x.A1 5` is
  how a cell slot first comes into being.
- **Never spread a collection the user can size (D-077).** `push(...family)`, `Math.max(...family)` all
  pass it as ARGUMENTS and die of `RangeError` past ~125k elements.
- **A command word alone is not an error (D-072).** `beginCommand` in `command/prompt.ts` is the entry
  point for a typed line, not `parseCommand`. **A pick reaches `command/` as a WORLD point** — never
  import `render/` into `command/` source. **`parser.ts` resolves NOTHING and takes no document
  (D-069)**, and **a formula's source is opaque to `command/` past its `=` (D-073)**.
- **Four different reasons to read a slot, and they do NOT unify** (0062-, 0067-REVIEW): to
  DRAW/HIT-TEST (`readNumber`, kind-blind), to SIZE the slot set (`readTableDimension`, `literal`-only),
  to decide whether it may be WRITTEN (`interaction.ts`, kind-aware), and to decide whether a command
  MAY write it (`resolveWritableSlot`, schema-aware). `declaresSlotPath` is the same schema question as
  the fourth, asked without the write; merge them when a cycle opens `resolveWritableSlot`.
- **Cite the ruling you actually mean.** Standing: D-064 (presets wind counterclockwise) · D-005 (a
  slot's stored key is the PATH joined with `.`) · D-066 (a degenerate extent needs its OWN guard) ·
  D-061 (`camera.x`/`.y` is the world point at the screen's TOP-LEFT corner) · D-030 (`^` is
  LEFT-associative). House style: close every union `switch` with `const exhaustive: never = x; void
  exhaustive;`, and **`render/` and `command/` are not `engine/`** — run BOTH tsconfigs anyway.
- **Mutation-check a suite that passes first try — and check the checker.** Strip ANSI
  (`sed 's/\x1b\[[0-9;]*m//g'`) and assert on the `Tests  N failed` line. Entry 0081's first `refs`
  passed twelve tests and was wrong.
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change fires**
  (entry 0073). Entries 0079 and 0081 both fired trigger 5 for handler work and reported it.
- **Preserve each file's LINE ENDINGS when editing.** `document.ts`/`schema.ts`/`mutation.ts` are CRLF
  in the index; `command/commands.ts` and its test are LF on disk.
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Grep for the name of every file and capability you create, and **re-read the headers of the
  files you edited**.
- **Do NOT report the LENGTH of anything (D-076)** — not a header, not this file, not a source file. The
  one length rule that survives is **`WHAT THIS IS` capped at 15 lines**, binding new and edited headers
  only. There is no sweep.
