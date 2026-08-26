# STATUS — as of entry 0085

STATE: **GREEN.** Both configs compile, 1056/1056 tests pass, 0 skipped, 0 `.only`. Entry 0085
(`select`/`zoom`/`fit`/`save`/`load` under D-075) is **built and NOT yet reviewed**, and it fired
**§6.1 trigger 5** (a test's expectations changed), so a review point is REQUIRED before the next
slice.

Current phase: **3 — canvas, camera, geometry, command line.** **Every §5.10 command the parser can
produce now reaches a handler that runs** — the four creations, the four slot commands, `rename`,
`delete`, `refs`, `list`, and now the five that change no document state and return an EFFECT
instead. The eight §5.10 commands that need a schema or an `Operation` kind nobody has written
(`polyline`/`text`/`script`/`image`/`explode`/`addvertex`/`delvertex`/`pan`) are refused by
`parser.ts` before a `Command` exists. **`main.ts` still holds no canvas and listens for nothing, so
no pixel has ever come out of this project and no effect has ever been performed.** Phase 3
criterion (§6): *"create a polygon and a table by command, see both drawn, pan/zoom, select, and
drag the polygon."* The engine half is done and tested; the visible half is untested and unbuilt.
NOT claimed.

Last review point: **0084-REVIEW-phase3, ACCEPT WITH EDITS.**
Cycles since last review: **1/3** · diff since last review: **~317 lines / 2 files** (cap 800/10).
**§6.2 holds nothing back: no load-bearing file has unreviewed changes** — entry 0085 touched
`command/commands.ts` and its test only.

## Read this first — the three things a cold reader needs

**1. `executeCommand` THROWS on one typed line, and NO measurement bounds it (D-079).** A formula whose
AST nests too deep exhausts the stack inside `formula/parser.ts`'s recursive descent and a `RangeError`
unwinds out of the command line; `formatFormula` fails the same way. Entry 0079 saw it at ~5,000 terms
of `1 + 1 + …`, entry 0081 at ~3,000 terms of `table_1.B1 + …`, and 0082-REVIEW showed **the same
formula committing and throwing in one process depending only on what parsed before it** — the depth a
V8 frame costs moves with how the function was compiled. So the band is not a property of the terms
either. Fix-list item 1 owns this: a depth limit in the parser returning `#PARSE`, the same guard on
`format.ts`'s recursion for the loaded-file path, **and the limit set from a FIXED CONSTANT at or below
1,000 nesting levels — never from any of these numbers** (D-079 clause 2). Take it before `main.ts`: a
`RangeError` out of a canvas repaint is far harder to attribute than one out of a command line.

**2. An EFFECT is how a command reaches the camera, the selection, or a file — and nothing performs one
yet (D-075).** `CommandOutcome`'s success arm now carries an optional `effect: CommandEffect`, plain
serializable data naming an object by ID. `commands.ts` does the identity and domain work (`select`
resolves the name and refuses an unknown one; `zoom` refuses a non-positive or non-finite factor; `fit`
refuses an empty document) and `main.ts` is supposed to do the rest. **`main.ts` is still the stub**, so
every effect is currently produced and dropped. The seam is pinned only from the `command/` side.

**3. `refs` had to simulate the deletion, and the reason is not obvious.** `refs <object>` derives its
blocking half over the document **without** that object, because a range over cells nobody has written
expands to **no edges at all** (D-047 item 1) and only becomes the one dangling edge `deriveEdges`
falls back to once the table it names is gone. A `refs` reading the current edge set answered
"nothing references table_1" for a document whose `delete table_1` is refused — found by probe at
entry 0081, after twelve tests over the wrong version had passed. Do not "simplify" it back.

**Still binding, one line: five names §5.2's grammar allows are NOT available** — `AND`, `OR`, `NOT`,
`TRUE`, `FALSE` lex as formula keywords and `checkNameAvailable` refuses them in every case (**D-080**).
Function names are safe and are NOT reserved.

## Next slice — the depth limit, then `main.ts`

1. **The parser depth limit** (fix-list item 1) — its own small slice, blocks nothing else, and set
   from **D-079**'s constant rather than from any measured band. Take it BEFORE step 2
   (0080-REVIEW F3). It also removes the "ONE MEASURED EXCEPTION" sentences the four sites carry,
   including `executeCommand`'s.
2. Then **`main.ts`**: ONE clamped camera to `renderDocument`, `hitTest` and
   `pointerDown`/`pointerMove` (D-062); **perform the five effects** — `select` into
   `render/interaction.ts`'s selection state, `zoom` as `camera.zoom * factor` through
   `zoomAtScreenPoint`, `fit` from a viewport size `main.ts` supplies (D-061) with its own guard on a
   degenerate single-point extent (D-066), `save`/`load` through §5.11 — and write `Document.camera`
   directly, never through `mutate` (D-027 clause 2); reset the canvas transform before screen-space
   chrome; and **wire `prompt.ts` — a canvas click during a live sequence is a `picked` response, not
   a selection**, with screen→world done by `camera.ts` before it reaches `command/`.

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
`rename` handler (0084).

## Built this batch, not yet reviewed

**Entry 0085 — D-075's effects.** Two files, `command/commands.ts` and its test.

- **`CommandEffect`**, exported from `commands.ts`: `{ select, objectId }` · `{ zoom, factor }` ·
  `{ fit }` · `{ save }` · `{ load }`. Plain, serializable, discriminated on `kind`, an object named
  by **ID** and never by name, and carrying no `CameraState` (D-075 clauses 2 and 5). A test JSON
  round-trips every arm to pin that mechanically.
- **`CommandOutcome`'s success arm gains `effect?`** — OPTIONAL, so all eleven existing handlers and
  every caller are untouched, and `list`/`refs` keep carrying none (D-075 clause 4, now tested).
- **The five handlers.** `select` resolves the name through the same case-insensitive §5.2 lookup
  `delete` and `rename` use and refuses an unknown one HERE (clause 1). `zoom` passes the factor
  through untouched and refuses one that is not finite and `> 0` — a DOMAIN refusal, the posture
  `refuseCountOutOfRange` already takes; the `[MIN_ZOOM, MAX_ZOOM]` RANGE stays in `render/camera.ts`
  (D-062). `fit` refuses an EMPTY document and its effect carries nothing — the extent is `render/`'s
  geometry. `save`/`load` return the document they were given, by identity, and serialize nothing.
- **`noHandlerYet` is deleted**; `COMMANDS_WITH_HANDLERS` lists all sixteen registry words and the
  coverage test is now `COMMANDS_WITH_HANDLERS === COMMAND_NAMES`. **This is the §6.1 trigger 5 that
  fired**: five tests asserting those words are refused are gone, because those words now run.
- **Three falsified sentences in `commands.ts` corrected** (D-065) — `executeCommand`'s doc claimed
  "a command with no handler yet" among its refusals and "five arms with no handler yet" among its
  switch arms, and an INVARIANTS bullet said the same.

## Not started

`main.ts` wiring (including PERFORMING any effect), §5.9's visual-feedback trio (**D-068**), §5.9's
per-vertex drag path, `polyline`/`explode`/`addvertex`/`delvertex`, `style` slots, point-in-polygon
fill hit-testing (D-067), §5.4's formula bar / in-place cell editing · Phases 4–7.

**Phase 4 is close and is NOT claimed.** (a) data drives geometry and (b) geometry drives data are both
reachable from typed lines and are demonstrated by `commands.test.ts`'s "the loop these four commands
close" block. (c) partial binding under DRAG exists in `render/interaction.ts` (0066) but no test puts
all three in ONE document, which is what "simultaneously" requires — and §6 forbids starting a phase
before its predecessor's criterion passes, which Phase 3's has not.

## Open fix list — **read 0084-REVIEW §9 for the full text**

**Unchanged by entry 0085: it added nothing and closed nothing.**

1. **Depth-limit `formula/parser.ts`'s recursive descent, from a CONSTANT** — return `#PARSE` past a
   fixed depth instead of unwinding, guard `format.ts`'s recursion for the loaded-file path, then
   remove the exception sentences the four sites now carry and pin the CONSTANT with a test. Set it at
   or below **1,000** nesting levels and **never from a measurement** (**D-079**) — see "Read this
   first" item 1. Blocks nothing; take it before `main.ts`.
2. **Give the missing-slot refusal a remedy** — "references a slot that does not exist" is true and
   tells the operator nothing to do. Message only: **D-047 clause 4 does not move** (0080-REVIEW F4).
   `delete`'s refusal, **D-080's reserved-word refusal** and now `fit`'s "create one first" are the
   worked examples of a refusal that names what to do instead. The same message is also reachable from
   `refs`, where in D-046's formula-dimension corner its "object type X does not declare one" clause is
   not the reason either (0082-REVIEW §4).
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE**, so `delete table_1` over
   `polygon_1.origin.x = table_1.A1 + table_1.A2` says `polygon_1.origin.x references a slot that does
   not exist; polygon_1.origin.x references a slot that does not exist`. Pre-existing in `mutation.ts`,
   user-visible only since `delete` got a handler. Group by dependent, or dedupe within the message
   (0082-REVIEW F4). Owned by the cycle that opens that function.

**Carried from 0074-REVIEW §9 through 0084-REVIEW, all six unchanged, none blocking:** (1) report a
refused prompt answer with the sequence's own message — **D-074**, the one with a ruling behind it ·
(2) a usage line for the form a prompting command was used in, folded into 0069-REVIEW F3's sweep over
all sixteen `usage` strings · (3) decide what a quoted command WORD means, and correct entry 0072's
"only site" claim · (4) disclose 0074-REVIEW F4's two message changes, test (a) · (5) `set = x` wrongly
says `"set" takes no formula` — it lives in `parser.ts`'s argument matching · (6) `parser.ts`'s header
restating D-069 · the twelve bare "this cycle" sites in test files · `render/slots.ts` at the THIRD
consumer of `readNumber`/`asPointArray` · `.gitattributes`.

## Known problems (detail lives where the pointer says)

- **`executeCommand` throws on a deep enough formula, and nothing measured bounds it (D-079)** — see the
  top of this file. Owned by fix-list item 1.
- **Every `CommandEffect` is produced and dropped.** `main.ts` performs none of them, so `select`
  selects nothing, `zoom`/`fit` move no camera, and `save`/`load` touch no file. The handlers report
  success because the part they own succeeded; that is honest but it is not the whole gesture. Entry
  0085, by design — `main.ts` is the next-but-one slice.
- **`zoom`'s echoed line names the REQUEST, not the result** (`zoom by 2`). A factor that the camera
  then clamps produces a line that overstates what happened; reporting the clamped value is
  `main.ts`'s, and it has the clamped camera to report it from.
- **`fit`'s effect carries nothing**, so `main.ts` computes the extent itself. If that computation ever
  needs something only `command/` can resolve, the arm grows a field. Nothing suggests it will —
  and refusing the empty document here does NOT discharge `main.ts`'s guard on a degenerate
  single-point extent (D-066).
- **A `delete` refusal can name the same dependent twice** — `mutate` groups by missing source. Fix-list
  item 3; the handler's remedy sentence is appended once, correctly.
- **`refs` names a range's START cell as the source** when the range's table is being removed, so the
  line reads `table_1.A1 → table_2.A1` for a formula that reads `A1:A4`. The DEPENDENT is right, which
  is what §5.1.1 asks to be named, and the source is a real address rather than an invented one — but
  it is less than the whole truth. Entry 0081, disclosed not fixed.
- **`refs <object>` derives edges twice**, once over the document and once over the document without
  the target. Rule 5's accepted trade; measured at 326 ms for the largest table D-070 allows.
- **Two sites now ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. Disclosed at entry 0081 under §4's no-refactor rule;
  `declaresSlotPath`'s doc names the condition for merging them and forbids a third site.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** — D-046 reads a dimension
  `literal`-only, so no cell is declared and the refusal's "object type `table` does not declare one" is
  not the reason. `refs <object>` and `delete` still answer that document correctly, so the operator is
  refused rather than misled. Fix-list item 2 (message only). Reachable only by `link`ing a dimension.
- **A bare reference to an EMPTY cell is REFUSED.** `set table_1.A1 = table_1.B1` on a fresh table fails
  with "references a slot that does not exist", because creation makes no cell slots (D-047) and D-047
  clause 4 makes an absent cell fine inside a RANGE and not fine as a plain reference. **0080-REVIEW F4
  ruled it STANDS.** Only the MESSAGE changes (fix-list item 2); do not re-raise the behaviour.
- **`createObject` does not check the name it carries.** `findInvalidRenames` checks every RENAME and
  reads a created object's name only to keep its simulation honest, so a duplicate or ungrammatical
  name still commits through `createObject`. `commands.ts` avoids it by minting through
  `generateDefaultName`; §5.11's loader is the reachable route. **Pinned by a test that asserts the
  duplicate DOES commit**, so closing it is a visible diff. **Ruled D-081 at 0084-REVIEW**: the
  direction is settled (same `checkNameAvailable` gate, extending `findInvalidRenames`'s own
  simulation, rejecting the whole batch and naming every offender) and the **load cycle owns it**. The
  pinned test is meant to FLIP then; that is not a test being weakened.
- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. All report
  "not built", not "unknown command" (`COMMANDS_SPECIFIED_BUT_NOT_BUILT`), and they never reach
  `commands.ts`.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered** — all four creatable types
  have schemas, so nothing can reach it. `describeSlotValue`'s `Point` and `Point[]` arms are uncovered
  for the same kind of reason.
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

Every ruling in `DECISIONS.md` (D-001 through **D-081**) binds without restatement here. Newest:
**D-074** a prompt sequence's own refusal IS the message — **still open**, fix-list item 3(1) ·
**D-075** a command that changes no document state returns an EFFECT as plain data — **IMPLEMENTED
end to end on the `command/` side as of entry 0085**; clause 3 (`main.ts` performs it) has no
performer yet · **D-076** a header's PROSE is capped at 15 lines and every other length budget is
withdrawn — **length is not a finding, do not report it** · **D-077** a dynamic slot family's size is
DOCUMENT STATE · **D-078** a probe that falsifies a property falsifies EVERY claim of it on that call
path · **D-079** a stack-depth measurement is an OBSERVATION, never a bound · **D-080** the five words
§5.3 lexes as formula keywords are NOT available object names, in ANY case, refused by
`checkNameAvailable` from `formula/lexer.ts`'s exported `RESERVED_WORDS`; function names are NOT
reserved · **D-081** `createObject`'s own name is gated by the same `checkNameAvailable`, by extending
`findInvalidRenames`'s simulation, rejecting the whole batch — **owed by the §5.11 load cycle**, and
the pinned "duplicate DOES commit" test is meant to flip then.

**D-057 is IMPLEMENTED end to end as of entry 0081**. **D-040/D-041 are implemented** (entry 0079) and
**Q-001/Q-002 are reconciled**. **§5.2 now has exactly one gate with three clauses** (grammar, D-080's
reserved words, uniqueness) and one caller in `mutation.ts`.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the `TABLE_CELL_*`
constants): world units or screen pixels? Provisional (a) world units. Due with the `style`-slots cycle
— and also blocking `pan`'s argument grammar.
**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.
Next free: **Q-014**.

## Gotchas for the next model

- **An `effect` is a REQUEST, not a report.** `commands.ts` echoes what was asked for wherever the
  result is on the far side of the seam (`zoom by 2`, `saving document`), and past tense only where
  nothing after the return can fail (`selected polygon_1`). Keep that split when you add an arm, and
  when `main.ts` learns to report the clamped result.
- **`command/` may not see a `CameraState`, a selection, or a DOM handle — not even to describe one.**
  D-075's effect is the whole vocabulary. If an arm wants a camera, the design is wrong.
- **`parser.ts` validates the FORM of a number, not its usefulness.** `zoom 0`, `zoom -2` and a run of
  400 digits (`Number` reads it as `Infinity`) all parse; `1e999` does NOT, because `NUMBER_PATTERN`
  has no exponent form. A handler that cares must check the domain itself.
- **A name §5.2 allows is not automatically a name §5.3 can READ (D-080).** `checkNameAvailable` is the
  one gate; if you add a naming path (a loader, an import, a duplicate-and-rename gesture), route it
  through that gate rather than re-checking §5.2 yourself.
- **A range over cells nobody has written creates NO edges** (D-047 item 1) and becomes ONE dangling
  edge the moment the table it names disappears. That asymmetry is why `refs <object>` simulates the
  removal. Anything else that asks "who reads this object" inherits the same trap.
- **`delete` appends the remedy to `mutate`'s message rather than pre-checking.** The pre-check version
  was written and dropped: it is a second, weaker definition of §5.1.1 beside the real one, and it
  misses the range case above. If you add a destructive command, do the same.
- **A measurement can be less general than it looks (D-078 clause 3, D-079).** Entry 0079's ~5,000-term
  band and entry 0081's ~3,000-term band are the same defect, and 0082-REVIEW showed the same formula
  landing on both sides of it in one process. State what you fed it, and never build a limit on it.
- **Correct every claim a probe falsifies, not the one you were reading (D-078).** Grep the call path in
  both directions.
- **`writeSlot` in `commands.ts` is the ONE place a slot is written by command.** Put a fourth
  slot-writing command through it; do not add a second path.
- **A formula's SOURCE does not exist anywhere.** It is reconstructed from the AST by
  `formula/format.ts` against current names. Do not add a source field to `FormulaSlot`.
- **`executeCommand` is the ONLY place a `Command` meets a `Document` (D-069).** It returns a NEW
  document; the caller stores it. The success arm ALWAYS carries one — including `refs`, `list`,
  `select`, `save` and `load`, which return the one they were handed, by identity.
- **A creation handler never lists derived slot paths.** It fills them from `schema.derivedSlots` with
  `value: null`, and step 7 of the same mutation overwrites them before anything commits.
- **`mintObjectId` returns the ADVANCED counter with the id.** Store both or you mint a duplicate.
  Deleting an object frees its NAME and never its id (D-002) — pinned by a test at 0081.
- **A rename rewrites ONE field, and that is not an oversight.** Every stored AST holds an ID (§5.3),
  so no formula, edge or value moves. If you ever find yourself writing a name-rewriting pass, something
  upstream stored a name it should not have.
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
  passed twelve tests and was wrong; entry 0085 seeded three faults at once and got 9 failures.
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change fires**
  (entry 0073). Entries 0079, 0081, 0083 and 0085 all reported a trigger for handler work.
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Grep for the name of every file and capability you create, and **re-read the headers of the
  files you edited**. Entry 0085 deleted `noHandlerYet` and had to correct three sentences elsewhere in
  the same file that still described it.
- **Line endings:** every file entry 0085 touched is CRLF on disk, unchanged. The working tree is mixed
  overall and `git diff` shows only real changes under `core.autocrlf=true`; `.gitattributes` is still
  owed (fix list, carried).
- **Do NOT report the LENGTH of anything (D-076)** — not a header, not this file, not a source file. The
  one length rule that survives is **`WHAT THIS IS` capped at 15 lines**, binding new and edited headers
  only.
