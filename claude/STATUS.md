# STATUS — as of entry 0088-REVIEW

STATE: **GREEN.** Both configs compile, 1074/1074 tests pass, 0 skipped, 0 `.only`. Entry 0087
(the two formula depth limits, old fix-list item 1) is **built and REVIEWED** —
0088-REVIEW-phase3, **ACCEPT WITH EDITS**, two test defects fixed in review and **D-083** ruled.
The review gate is CLEAR: the next slice is `main.ts`.

Current phase: **3 — canvas, camera, geometry, command line.** Every §5.10 command the parser can
produce reaches a handler that runs, and **`executeCommand` no longer throws on any input** — the
one exception it carried for four entries is closed. The eight §5.10 commands that need a schema or
an `Operation` kind nobody has written (`polyline`/`text`/`script`/`image`/`explode`/`addvertex`/
`delvertex`/`pan`) are refused by `parser.ts` before a `Command` exists. **`main.ts` still holds no
canvas and listens for nothing, so no pixel has ever come out of this project and no effect has ever
been performed.** Phase 3 criterion (§6): *"create a polygon and a table by command, see both drawn,
pan/zoom, select, and drag the polygon."* The engine half is done and tested; the visible half is
untested and unbuilt. NOT claimed.

Last review point: **0088-REVIEW-phase3, ACCEPT WITH EDITS.**
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).
**§6.2 holds nothing back: no file has unreviewed changes.**

## Read this first — the three things a cold reader needs

**1. A formula has TWO depth limits, both fixed constants, and both are RULED (D-079, D-083).**
`MAX_FORMULA_PARSE_DEPTH = 256` (in `formula/parser.ts`) bounds the recursive
DESCENT in *nesting steps* — `parseUnaryExpr` and `parsePrimaryExpr` each cost one, so a parenthesis
or call-argument level costs two, i.e. ~128 levels of `((( … )))`. `MAX_FORMULA_AST_DEPTH = 1000` (in
`formula/ast.ts`) bounds the STORED AST and is checked in `walkForRangePlacement`, the post-parse
walk. Two limits because a left-associative chain (`1 + 1 + …`) is a **loop** in the descent and one
AST level per term — the descent's counter never sees it, which is why the old `RangeError` came out
of the WALK and not out of the descent the fix list named. **No ruling was deviated from** — entry
0087 reported one and 0088-REVIEW F4 found it was not: D-079 clause 2's "at or below 1,000" is a
CEILING and 256 is below it, and the two recursions count in different units (1,000 parenthesis
levels is ~2,000 descent steps). **D-083** says this in binding form, and adds the one thing not
yet built: a loaded AST's depth is validated ONCE at §5.11's load boundary — `deps.ts` and
`eval.ts` never grow a depth parameter, and today they still throw a `RangeError` on a hand-built
40,000-level AST that no parse can produce.

**2. An EFFECT is how a command reaches the camera, the selection, or a file — and nothing performs
one yet (D-075/D-082).** `CommandOutcome`'s success arm carries an optional `effect: CommandEffect`,
plain serializable data naming an object by ID. `commands.ts` does the identity and DOMAIN work
(`select` refuses an unknown name; `zoom` refuses a non-positive or non-finite factor; `fit` refuses
an empty document) and `main.ts` is supposed to do the rest — an exhaustive `switch` with the `never`
default (D-082 clause 3), resolving no name (clause 4). **`main.ts` is still the stub**, so every
effect is produced and dropped.

**3. `refs` had to simulate the deletion, and the reason is not obvious.** `refs <object>` derives
its blocking half over the document **without** that object, because a range over cells nobody has
written expands to **no edges at all** (D-047 item 1) and only becomes the one dangling edge
`deriveEdges` falls back to once the table it names is gone. A `refs` reading the current edge set
answered "nothing references table_1" for a document whose `delete table_1` is refused. Do not
"simplify" it back.

**Still binding, one line: five names §5.2's grammar allows are NOT available** — `AND`, `OR`, `NOT`,
`TRUE`, `FALSE` lex as formula keywords and `checkNameAvailable` refuses them in every case
(**D-080**). Function names are safe and are NOT reserved.

## Next slice — `main.ts`

The parser depth limit is CLOSED and reviewed, so nothing stands between here and the application
file. `main.ts` wants: ONE clamped camera into `renderDocument`, `hitTest` and `pointerDown`/`pointerMove` (D-062);
**performing the five effects** through an exhaustive `switch` on `kind` (**D-082 clause 3**) —
`select` into `render/interaction.ts`'s selection state, `zoom` as `camera.zoom * factor` through
`zoomAtScreenPoint`, `fit` from a viewport size `main.ts` supplies (D-061) with its own guard on a
degenerate single-point extent (D-066), `save`/`load` through §5.11 — writing `Document.camera`
directly and never through `mutate` (D-027 clause 2); resetting the canvas transform before
screen-space chrome; and **wiring `prompt.ts` — a canvas click during a live sequence is a `picked`
response, not a selection**, with screen→world done by `camera.ts` before it reaches `command/`.

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
`rename` handler (0084) · `CommandEffect` and the five effect handlers (0086) · the two formula depth limits (0088).

## Built this batch, not yet reviewed

**Nothing.** The batch is empty — entry 0087 was reviewed at 0088 and the counter is back to 0/3.

What 0087 built, kept here because it is the shape a cold reader most needs after the two constants:

- **`MAX_FORMULA_AST_DEPTH = 1000`** in `formula/ast.ts`, beside the shape it bounds, read by both
  `parser.ts` and `format.ts` so the number exists once (D-010).
- **`MAX_FORMULA_PARSE_DEPTH = 256`** exported from `formula/parser.ts`. `parseUnaryExpr` and
  `parsePrimaryExpr` now delegate through one `withNestingStep` wrapper — one return path, so no
  error arm can leave the counter raised.
- **`walkForRangePlacement` takes a `depth`** and refuses past `MAX_FORMULA_AST_DEPTH` before
  recursing: both the bound on what gets STORED and the guard on that walk's own stack.
- **`format.ts` elides instead of throwing.** `formatNode` takes a `depth` and returns
  `DEPTH_ELISION` (`"..."`) past the same constant. Not an error code — a formula that deep is
  unreadable, not broken, and only a hand-edited saved file can produce one.
- **The four "ONE MEASURED EXCEPTION" sites are corrected** (D-065): three in `commands.ts` (file
  header, `executeCommand`, `writeSlot`) and two in `format.ts`.
- **Sixteen tests** (fifteen from 0087, one added at review). Both constants pinned directly; the
  refusal and the still-parsing case at each limit; the 20,000- and 80,000-term lines that used to
  throw; a 1,000-term formula that **commits and evaluates**, which is what says
  `deps.ts`/`eval.ts`/`format.ts` survive the permitted depth; and that 300 sibling nestings on one
  line do NOT accumulate steps, which is the test that catches a leaked decrement (0088 F1).

## Not started

`main.ts` wiring (including PERFORMING any effect), §5.9's visual-feedback trio (**D-068**), §5.9's
per-vertex drag path, `polyline`/`explode`/`addvertex`/`delvertex`, `style` slots, point-in-polygon
fill hit-testing (D-067), §5.4's formula bar / in-place cell editing · Phases 4–7.

**Phase 4 is close and is NOT claimed.** (a) data drives geometry and (b) geometry drives data are
both reachable from typed lines and demonstrated by `commands.test.ts`'s "the loop these four
commands close" block. (c) partial binding under DRAG exists in `render/interaction.ts` (0066) but no
test puts all three in ONE document, which is what "simultaneously" requires — and §6 forbids
starting a phase before its predecessor's criterion passes, which Phase 3's has not.

## Open fix list — **read 0088-REVIEW §9 for the full text**

**The old item 1 is CLOSED by entry 0087 and reviewed at 0088.** Items 2–5 unchanged. 0088-REVIEW
adds two new ones, numbered 6 and 7 here so the numbers above do not move again.

1. ~~Depth-limit the formula recursion from a CONSTANT (D-079)~~ — **done, entry 0087**, as two
   constants rather than one; reviewed and ruled at 0088 (**D-083**).
2. **Give the missing-slot refusal a remedy** — "references a slot that does not exist" is true and
   tells the operator nothing to do. Message only: **D-047 clause 4 does not move** (0080-REVIEW F4).
   `delete`'s refusal, **D-080's reserved-word refusal** and `fit`'s "create one first" are the
   worked examples. The same message is also reachable from `refs`, where in D-046's
   formula-dimension corner its "object type X does not declare one" clause is not the reason either.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE**, so `delete table_1` over
   `polygon_1.origin.x = table_1.A1 + table_1.A2` says the same sentence twice. Pre-existing in
   `mutation.ts`; group by dependent or dedupe within the message (0082-REVIEW F4). Owned by the
   cycle that opens that function.
4. **`zoom`'s refusal names `Infinity` rather than what was typed** (0086-REVIEW F4). Message only;
   the handler cannot do better without the raw token `parser.ts` has and does not pass. Owned by
   whichever cycle next opens that seam for another reason.
5. **Carried from 0074-REVIEW §9, all six unchanged, none blocking:** (1) report a refused prompt
   answer with the sequence's own message — **D-074** · (2) a usage line for the form a prompting
   command was used in, folded into 0069-REVIEW F3's sweep over all sixteen `usage` strings · (3)
   decide what a quoted command WORD means, and correct entry 0072's "only site" claim · (4) disclose
   0074-REVIEW F4's two message changes, test (a) · (5) `set = x` wrongly says `"set" takes no
   formula` — it lives in `parser.ts`'s argument matching · (6) `parser.ts`'s header restating D-069 ·
   the twelve bare "this cycle" sites in test files · `render/slots.ts` at the THIRD consumer of
   `readNumber`/`asPointArray` · `.gitattributes`.
6. **NEW — §5.11's loader validates a loaded formula's AST depth ONCE, at the boundary**
   (**D-083** clause 4, 0088-REVIEW F3). `deps.ts` and `eval.ts` get no depth parameter and today
   throw a `RangeError` on a 40,000-level hand-built AST; `format.ts`'s guard stands as built.
   Blocks nothing — `parser.ts` refuses anything that deep, so no user-reachable path makes one.
   Owned by the loader's own cycle.
7. **NEW — a single command can echo a ~200 KB line.** `SUM` with 50,000 arguments commits (width
   is unbounded and correctly so: every walk over an argument list is a loop, not a recursion), and
   `writeSlot` echoes the formula it replaced. Nothing throws; it is a question of what `main.ts`
   puts in a DOM console. Owned by the `main.ts` cycle, and possibly answered by doing nothing.

## Known problems (detail lives where the pointer says)

- **Every `CommandEffect` is produced and dropped.** `main.ts` performs none of them, so `select`
  selects nothing, `zoom`/`fit` move no camera, and `save`/`load` touch no file. By design, entry
  0085; `main.ts` is the next slice.
- **`zoom`'s echoed line names the REQUEST, not the result** (`zoom by 2`). Reporting the clamped
  value is `main.ts`'s, and it has the clamped camera to report it from (D-082 clause 5).
- **`fit`'s effect carries nothing**, so `main.ts` computes the extent itself, and refusing the empty
  document in `command/` does NOT discharge `main.ts`'s guard on a degenerate single-point extent
  (D-066).
- **`format.ts`'s elision does not re-parse** — a fourth disclosed exception to the round-trip
  property, reachable only for an AST deeper than any parse can build, i.e. through §5.11's loader.
- **`deps.ts` and `eval.ts` have no depth guard of their own.** Nothing deeper than
  `MAX_FORMULA_AST_DEPTH` can reach them from a typed line, and a test at exactly 1,000 shows they
  survive that; a hand-edited saved file is the open route, and it is §5.11's cycle to close.
- **A `delete` refusal can name the same dependent twice** — `mutate` groups by missing source.
  Fix-list item 3; the handler's remedy sentence is appended once, correctly.
- **`refs` names a range's START cell as the source** when the range's table is being removed, so the
  line reads `table_1.A1 → table_2.A1` for a formula that reads `A1:A4`. The DEPENDENT is right, which
  is what §5.1.1 asks to be named. Entry 0081, disclosed not fixed.
- **`refs <object>` derives edges twice**, once over the document and once over the document without
  the target. Rule 5's accepted trade; measured at 326 ms for the largest table D-070 allows.
- **Two sites now ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. Disclosed at entry 0081 under §4's no-refactor rule;
  `declaresSlotPath`'s doc names the condition for merging them and forbids a third site.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** — D-046 reads a
  dimension `literal`-only, so no cell is declared and the refusal's "object type `table` does not
  declare one" is not the reason. Fix-list item 2 (message only). Reachable only by `link`ing a
  dimension.
- **A bare reference to an EMPTY cell is REFUSED.** `set table_1.A1 = table_1.B1` on a fresh table
  fails with "references a slot that does not exist". **0080-REVIEW F4 ruled it STANDS.** Only the
  MESSAGE changes (fix-list item 2); do not re-raise the behaviour.
- **`createObject` does not check the name it carries.** A duplicate or ungrammatical name still
  commits through it. **Pinned by a test that asserts the duplicate DOES commit.** **Ruled D-081**:
  same `checkNameAvailable` gate, extending `findInvalidRenames`'s own simulation, rejecting the
  whole batch — and the **load cycle owns it**. The pinned test is meant to FLIP then.
- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. All
  report "not built", not "unknown command", and they never reach `commands.ts`.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered** — all four creatable types
  have schemas. `describeSlotValue`'s `Point` and `Point[]` arms are uncovered for the same reason.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade and **not a
  defect**; here so the human can lower D-070's cap if a real document ever wants to. **Do not "fix"
  it by tightening a bound** (D-077 clause 3).
- **A `#PARSE` position is an offset into the FORMULA, not into the line.** A caret-positioning
  `main.ts` will need `SetFormulaCommand` to carry the line offset of its `=` PLUS the width of the
  whitespace `buildSlot` trims. Additive when wanted.
- **A refused prompt answer is reported by the wrong grammar** — `circle 100,100 abc` blames
  `100,100`. Ruled **D-074**, fix-list item 5(1); no test pins the current behaviour.
- **Prompt order, wording and the `<8>` default form are a reading of AutoCAD, not the brief's.**
  Cheap to change; the human should say if any reads wrong in use. **No repeat-last-command gesture**;
  it needs the input bar.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — reachable only via a raw
  `setSlot`, pinned by `mutation.test.ts`'s "KNOWN INCOHERENCE" test, and D-053 forbids a one-sided
  fix.
- **Three carried render gaps, all deliberate:** one `mutate` per pointer move, each deep-cloning the
  document (§5.9's perf note — any fix MUST throttle, never write outside `mutation.ts`) · cell text
  is not clipped to its cell (§5.4 silent, Rule 5) · `readNumber`/`asPointArray` still have two
  consumers, and move to `render/slots.ts` at the THIRD (0064-REVIEW §5).
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

Every ruling in `DECISIONS.md` (D-001 through **D-083**) binds without restatement here. Newest:
**D-074** a prompt sequence's own refusal IS the message — **still open**, fix-list item 5(1) ·
**D-075** a command that changes no document state returns an EFFECT as plain data — implemented on
the `command/` side; clause 3 (`main.ts` performs it) has no performer yet · **D-076** a header's
PROSE is capped at 15 lines and every other length budget is withdrawn — **length is not a finding,
do not report it** · **D-077** a dynamic slot family's size is DOCUMENT STATE · **D-078** a probe that
falsifies a property falsifies EVERY claim of it on that call path · **D-079** a stack-depth
measurement is an OBSERVATION, never a bound — **implemented at entry 0087**, and clause 2's
"at or below 1,000" was NOT deviated from (see D-083 clause 1) · **D-080** the five words
§5.3 lexes as formula keywords are NOT available object names, in ANY case · **D-081**
`createObject`'s own name is gated by the same `checkNameAvailable` — **owed by the §5.11 load
cycle**, and the pinned "duplicate DOES commit" test is meant to flip then · **D-082** `command/`
refuses a camera command's DOMAIN, `render/` clamps its RANGE, and `main.ts` switches over
`CommandEffect` exhaustively and resolves no name · **D-083** D-079's 1,000 is a CEILING, applied
per recursion in that recursion's own unit, and a loaded AST's depth is validated ONCE at the load
boundary — clause 4 is **owed by the §5.11 load cycle**.

**D-057 is IMPLEMENTED end to end as of entry 0081**. **D-040/D-041 are implemented** (entry 0079) and
**Q-001/Q-002 are reconciled**. **§5.2 now has exactly one gate with three clauses** (grammar, D-080's
reserved words, uniqueness) and one caller in `mutation.ts`.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the `TABLE_CELL_*`
constants): world units or screen pixels? Provisional (a) world units. Due with the `style`-slots
cycle — and also blocking `pan`'s argument grammar.
**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.
Next free: **Q-014**.

## Gotchas for the next model

- **Find the recursion before you bound it.** Entry 0087's whole point: the `RangeError` the fix list
  attributed to `parser.ts`'s recursive descent came out of `walkForRangePlacement`, because a
  left-associative chain is a LOOP in the descent and one AST level per term. A limit on the descent
  alone would have changed nothing about the reported line and every test would still have passed.
- **An `effect` is a REQUEST, not a report.** `commands.ts` echoes what was asked for wherever the
  result is on the far side of the seam (`zoom by 2`, `saving document`), and past tense only where
  nothing after the return can fail (`selected polygon_1`) — D-082 clause 5.
- **`command/` may not see a `CameraState`, a selection, or a DOM handle — not even to describe one.**
  D-075's effect is the whole vocabulary. If an arm wants a camera, the design is wrong.
- **`parser.ts` validates the FORM of a number, not its usefulness.** `zoom 0`, `zoom -2` and a run of
  400 digits (`Number` reads it as `Infinity`) all parse; `1e999` does NOT. A handler that cares must
  check the domain itself.
- **A name §5.2 allows is not automatically a name §5.3 can READ (D-080).** `checkNameAvailable` is
  the one gate; route any new naming path through it rather than re-checking §5.2 yourself.
- **A range over cells nobody has written creates NO edges** (D-047 item 1) and becomes ONE dangling
  edge the moment the table it names disappears. That asymmetry is why `refs <object>` simulates the
  removal.
- **`delete` appends the remedy to `mutate`'s message rather than pre-checking.** The pre-check
  version was written and dropped: it is a second, weaker definition of §5.1.1 beside the real one.
- **A measurement can be less general than it looks (D-078 clause 3, D-079).** State what you fed it,
  and never build a limit on it — including the numbers in entry 0087, which are observations.
- **Correct every claim a probe falsifies, not the one you were reading (D-078).** Grep the call path
  in both directions.
- **`writeSlot` in `commands.ts` is the ONE place a slot is written by command.**
- **A formula's SOURCE does not exist anywhere.** It is reconstructed from the AST by
  `formula/format.ts` against current names. Do not add a source field to `FormulaSlot`.
- **`executeCommand` is the ONLY place a `Command` meets a `Document` (D-069)**, it returns a NEW
  document, and it now **never throws** for any input.
- **A creation handler never lists derived slot paths.** It fills them from `schema.derivedSlots` with
  `value: null`, and step 7 of the same mutation overwrites them before anything commits.
- **`mintObjectId` returns the ADVANCED counter with the id.** Store both or you mint a duplicate.
  Deleting an object frees its NAME and never its id (D-002).
- **A rename rewrites ONE field, and that is not an oversight.** Every stored AST holds an ID (§5.3).
- **A created table has `origin.x`/`origin.y` and `rows`/`cols`, and NO cells.** `set table_x.A1 5` is
  how a cell slot first comes into being.
- **Never spread a collection the user can size (D-077).** `push(...family)`, `Math.max(...family)`
  all pass it as ARGUMENTS and die of `RangeError` past ~125k elements.
- **A command word alone is not an error (D-072).** `beginCommand` in `command/prompt.ts` is the entry
  point for a typed line, not `parseCommand`. **A pick reaches `command/` as a WORLD point** — never
  import `render/` into `command/` source. **`parser.ts` resolves NOTHING and takes no document
  (D-069)**, and **a formula's source is opaque to `command/` past its `=` (D-073)**.
- **Four different reasons to read a slot, and they do NOT unify** (0062-, 0067-REVIEW): to
  DRAW/HIT-TEST (`readNumber`, kind-blind), to SIZE the slot set (`readTableDimension`,
  `literal`-only), to decide whether it may be WRITTEN (`interaction.ts`, kind-aware), and to decide
  whether a command MAY write it (`resolveWritableSlot`, schema-aware). `declaresSlotPath` is the same
  schema question as the fourth, asked without the write; merge them when a cycle opens
  `resolveWritableSlot`.
- **Cite the ruling you actually mean.** Standing: D-064 (presets wind counterclockwise) · D-005 (a
  slot's stored key is the PATH joined with `.`) · D-066 (a degenerate extent needs its OWN guard) ·
  D-061 (`camera.x`/`.y` is the world point at the screen's TOP-LEFT corner) · D-030 (`^` is
  LEFT-associative). House style: close every union `switch` with `const exhaustive: never = x; void
  exhaustive;`, and **`render/` and `command/` are not `engine/`** — run BOTH tsconfigs anyway.
- **Mutation-check a suite that passes first try — and check the checker.** Strip ANSI
  (`sed 's/\x1b\[[0-9;]*m//g'`) and assert on the `Tests  N failed` line. Entry 0087 seeded three
  faults and got 9 failures across 3 files.
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change fires**
  (entry 0073). It is also not a diagnosis: see the first gotcha.
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Grep for the name of every file and capability you create, and re-read the headers of the
  files you edited.
- **Line endings:** `formula/parser.test.ts` and `formula/format.test.ts` are LF on disk and were kept
  LF; the four source files entry 0087 touched are CRLF and were kept CRLF. The working tree is mixed
  overall and `git diff` shows only real changes under `core.autocrlf=true`; `.gitattributes` is still
  owed (fix list, carried).
- **Do NOT report the LENGTH of anything (D-076)** — not a header, not this file, not a source file.
  The one length rule that survives is **`WHAT THIS IS` capped at 15 lines**, binding new and edited
  headers only.
