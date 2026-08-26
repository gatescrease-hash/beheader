# 0082 — REVIEW (phase 3)
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0081-command-handlers-objects   Reviewing: entry 0081 (`command/commands.ts`'s
`delete`, `refs` and `list` handlers).
Trigger: §6.1 item 5 (three test expectations removed), self-reported by the entry.

Diff reviewed: `0a005ee` — `src/command/commands.ts` (+295/-11) and `src/command/commands.test.ts`
(+213/-3). Re-measured: **2 source files, 508 added / 14 deleted = 522 changed**, exactly the
entry's number. No engine file touched, as claimed.

Verdict: **ACCEPT WITH EDITS.** Two findings fixed here, two on the fix list, one ruling
(**D-079**).

The cycle is the strongest of this run. `refs` was wrong, the implementer found it *by probe on
their own code after twelve tests had passed over the wrong version*, and the entry leads with that
instead of burying it. The fix — derive the blocking half over the document WITHOUT the target — is
the correct one, and I re-derived it from three directions below. `delete` choosing NEITHER of
§5.1.1's paths, and owning only the two sentences `mutate` cannot say, is exactly the right seam.

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld, checked mechanically. `window.`/`document.`/`canvas`/
  `globalThis.` over `src/engine` returns header prose and identifier names only. The only
  `render/` import outside `render/` is still `commands.test.ts`'s, pre-existing and argued for in
  that file's header (0080-REVIEW). No `render/` import in `command/` **source**.
- **Rule 2 (state changes only through `mutation.ts`)** — upheld. `deleteObject` builds one
  `DeleteObjectOperation` and calls `mutate`; there is no assignment to `objects` or `journal`
  anywhere in the new code. `refs` and `list` return the document they were handed **by identity** —
  probed, not read: `outcome.document === before` is `true` for both, and the journal is untouched.
- **Rule 3 (two-layer naming)** — upheld, and `list` is the load-bearing case: it prints names and
  types and **no ids**, which the entry argues from §5.2 and a test pins by asserting no object's
  id appears in the output. Probed the other direction too — `refs TABLE_1` and `refs table_1.a1`
  answer about `table_1` and `table_1.A1`, i.e. the STORED name, never the typed one.
- **Rule 5 (dumbest correct implementation)** — upheld, deliberately. `refs <object>` derives the
  edge set twice and `declaresSlotPath` walks a million declared cell paths one at a time; measured
  here at 324–341 ms and 669 ms on `rows=1000 cols=1000`. Rule 5's accepted trade. **Do not "fix"
  it** (D-077 clause 3).
- **Rules 4, 6, 7** — not touched. The diff creates no slot and evaluates nothing.

## 2. Invariant audit

Slot set fixed during evaluation, derived slots inside the topological pass, eager/total
extraction, plain serializable state: not touched — the new code reads `deriveEdges` and formats
strings. The two `Set`s added are local to one call and never reach a `GraphObject`.

**No dangling edges** is the invariant this cycle is actually about, and it is upheld in the strong
sense: `refs`'s blocking half reads the identical edge set `validateIntegrity` sees when `delete`
runs, so the two cannot name different dependents. **Rejection leaves prior state unchanged** —
re-ran the `JSON.stringify` snapshot test, and confirmed independently that a refused `delete`
hands the caller back its own document.

## 3. Spec conformance

§5.10's three lines do what the brief's own examples say, and §5.1.1's purpose sentence — "so the
user can see what points at something before deleting it" — is met in the only way that counts:
**`refs` and `delete` agree**. I checked that from three sides.

- A range over cells **nobody has written**: `refs table_1` names `table_2.A1`, and `delete
  table_1` refuses naming `table_2.A1`. This is the case that was wrong before the fix.
- A range over cells that **are** written: same agreement, and the collapse to the range's start
  cell (the entry's own disclosure) does not change who is named.
- A table whose `rows` has been made a **formula** (D-046's fail-closed enumeration, zero declared
  cells): `refs table_1` and `delete table_1` still agree.

Three readings worth confirming explicitly:

- **`delete` choosing neither path is right.** The flag reaches `DeleteObjectOperation` and `mutate`
  selects §5.1.1's rejection or repair. A handler-side pre-check would be a second, weaker
  definition of the rule that executes — and the entry's Decision 3 says it was written and dropped
  for exactly that reason, having also missed the range case. **Endorsed; do not revisit.**
- **The remedy sentence being unconditional on the rejection path is right,** and I checked the
  argument rather than accepting it. Over a document `mutate` committed, removing an object cannot
  trip D-017 or D-018 (both per-surviving-object), cannot trip D-025 (values are checked before
  evaluation and none of them changed), and cannot build a cycle out of a smaller edge set — the
  dangling-reference check is the only reachable rejection. §5.11's "loading applies objects through
  the mutation API" keeps that true for a loaded file too.
- **`refs` accepting a `derived` target while `resolveWritableSlot` refuses one** is right: §5.1
  makes a derived slot a first-class graph node other formulas may read, and asking who reads it is
  not an attempt to write it.

## 4. Findings

### F1 — the depth band is not a property of the terms. NOT fixed; ruled **D-079**

Entry 0081 measured `~3,000` terms of `table_1.B1 + …` against entry 0079's `~5,000` terms of
`1 + 1 + …`, and concluded the depth "depends on what the terms are, not just how many" — with
STATUS telling the next implementer to **set the depth limit from the worst term**. Both
measurements reproduce exactly. The conclusion drawn from them does not hold, and the instruction
built on it would set the limit from a number that is not a bound.

Same tree, same code, one process each, `set table_1.A1 = <n terms>`:

```
ladder 1000 -> 3000:                 3000 x "table_1.B1"   THREW       (reproduces entry 0081)
                                     3000 x "1"            committed
                                     5000 x "1"            THREW       (reproduces entry 0079)

ladder 1000 -> 2000 -> 2500 -> 3000: 3000 x "table_1.B1"   COMMITTED
                                     4000 x "table_1.B1"   THREW

ladder 1000 -> ... -> 5000:          6000 x "table_1.B1"   COMMITTED
cold, same size, next process:       6000 x "table_1.B1"   THREW
```

**The same formula both commits and throws, in the same process, depending only on what parsed
before it.** The recursion depth a V8 stack affords is not a function of the input; it moves with
how the recursive functions happen to be compiled at the moment of the call. A limit set at "3,000,
from the worst term" would therefore be a limit that still throws, and a limit set from any
measurement at all is a number with no property behind it.

1,000 terms committed in **every** run I made, of both shapes. The limit belongs at or below that,
as a fixed constant with a test on the constant — not near any measured failure. **D-079** rules
this and fix-list item 1 is restated accordingly. Neither entry misreported anything: each stated
what it fed the parser, as D-078 clause 3 asks. What was missing is that a stack-depth number is
not the kind of thing that can be a bound.

### F2 — `refs`'s summary counted EDGES and called them dependents. FIXED at this review

Probed, not reasoned about:

```
set polygon_1.origin.x = table_1.A1 + table_1.A2
refs table_1  ->  table_1.A1 → polygon_1.origin.x
                  table_1.A2 → polygon_1.origin.x
                  2 inbound dependents: 2 on other objects, 0 on table_1 itself
```

There is **one** dependent. `refs polygon_1` said `13 inbound dependents` where nine slots depend
on it (five parameters feed `vertices`, which feeds eight). "Dependent" in this codebase is a slot
— `Edge.dependentSlot`, and §5.1.1's "naming every dependent" — so the line asserted a count of
slots and printed a count of edges. The dedup two lines above it states the opposite principle in
so many words ("the operator is being told which SLOTS read the target"), and the number that
actually answers §5.1.1's question is the slot count: it is how many slots have to be unlinked
before the delete stops being refused.

Fixed by carrying both counts and printing both: `2 inbound edges from 1 dependent slot: 1 on other
objects, 0 on table_1 itself`. The split counts slots; the lines are edges, one per line, so every
number in the report is checkable against the report. Mutation-checked: collapsing the slot count
back to the line count fails 2 tests, and the true own/others swap now fails 8 (it failed 5 at
entry 0081, because the counts now come from the same predicate as the lines).

### F3 — a comment falsified by this cycle's own edit, in the test file. FIXED at this review

`EVERY_REGISTRY_EXAMPLE`'s doc read "the twelve above plus the seven this file now runs". After
this cycle moved three lines out of `UNHANDLED_EXAMPLES` it is six above and eleven below; it was
already wrong at nine-and-eight when entry 0079 changed the same list, and **0080-REVIEW — mine —
did not catch it.** Rewritten without counts at all: the test immediately below pins the set
against `COMMAND_NAMES`, so a count in the prose is a second, hand-maintained claim that can only
rot. The implementer was diligent about exactly this in `commands.ts` (correcting "twelve arms" to
"six", and disclosing that it had been wrong at nine before this cycle) — the miss is in the file
where the numbers were not about the thing under test.

### F4 — `delete`'s refusal names one dependent once per missing source. NOT fixed — engine, §4

```
set polygon_1.origin.x = table_1.A1 + table_1.A2
delete table_1  ->  polygon_1.origin.x references a slot that does not exist;
                    polygon_1.origin.x references a slot that does not exist
                    — unlink each, or "delete table_1 force" to rewrite them to #REF instead
```

`findDanglingReferences` groups by missing SOURCE and formats one problem per group, so a dependent
that reads two slots of the deleted object is named twice in one sentence. This is pre-existing in
`mutation.ts` and was unreachable by command until this cycle gave `delete` a handler; §4 forbids
the implementer fixing it here and forbids me rewriting an engine function at review. Fix-list item
3. The shape to copy is the one F2 just put beside it: count the distinct dependents, name each
once. The handler's own remedy sentence is correctly appended once, after the whole joined message.

### Two observations, no action

- **`refs <address>` refuses for a cell of a table whose `rows` is a formula** — D-046 reads a
  dimension `literal`-only, so zero cells are declared and `declaresSlotPath` says no. The message
  ("object type `table` does not declare one") is then not the reason. `refs <object>` and `delete`
  both still answer correctly for the same document, so the operator is refused rather than misled.
  Folded into fix-list item 2, which is already about that message.
- **The ORDER of the two halves is thinly pinned.** Swapping only the two line arrays, leaving the
  counts, fails 1 test. Not worth a test of its own; noted so nobody reads F2's 8-failure number as
  covering it.

## 5. Legibility audit

Header updated in the present tense and honestly — `NOT DONE HERE` now names `rename` and says why
it is different, and the stale "twelve arms" was corrected with its own staleness disclosed (D-065
discipline, and the entry does not pretend the number was right yesterday). Vocabulary locked: I
grepped the added lines for *property*, *field*, *node*, *computed* — "first-class graph node" and
"computed by its object's schema" both track the brief's own §5.1 wording, so neither is synonym
drift. No `any`. The `refs` doc argues the rejected alternative (read the current edge set) and
shows the document that falsifies it, which is the most valuable comment added this cycle. Test
names are behaviour sentences naming the clause they defend.

## 6. Honesty audit — entry 0081

**The log matches the diff and the claimed results are real — re-run, not read.** `npx tsc
--noEmit` and `-p tsconfig.engine.json` both exit 0; `npx vitest run` gives 24 files / 1003 tests,
0 skipped, no `.only`/`.skip` in the tree. 977 → 1003 = 29 new − 3 removed ✓, `commands.test.ts`
75 → 101 ✓, 522 lines / 2 files ✓.

**The mutation-check table reproduces.** I re-ran two of the twelve independently: N1 (blocking half
read from the current edge set) fails 2, M3 (force remedy dropped) fails 1 — the entry's numbers
exactly. The size probe reproduces too: create 1,588–1,689 ms, `refs table_1` 324–341 ms, `refs
table_1.ALL1000` 669 ms, `list`/`delete` 0 ms, no throw.

Scope: no expansion. `rename` was deferred for a stated structural reason — it needs a
`renameObject` `Operation` in a load-bearing file and deserves to be reviewed as an engine change —
which is the right call. D-075's `effect` correctly untouched; clause 4 correctly implemented by NOT
widening anything. Phase 3 and Phase 4 both explicitly not claimed, each with its reason.

"Where I got stuck" is the best section in the entry and is unflattering in the way this project
asks for: the wrong first version, the twelve tests that passed over it, and the admission that it
was found by probing rather than by reading. The three disclosed-not-fixed items (the range's start
cell as source, the double edge derivation, the duplicate schema lookup) are all real and all
disclosed at the right size.

**The one gap is F1's**: a measurement stated as a term-cost property when it is also a property of
what ran before it. The entry reports what it ran, which is what D-078 clause 3 requires; the
conclusion is what over-reaches, and it over-reaches into an instruction for the next cycle, which
is why it is ruled rather than noted.

The entry's own "cheapest gap left" — no test anywhere of an EXTERNAL formula reading a `derived`
slot of an object that is then deleted — I probed and then pinned (edit 5). It behaves exactly as
the entry predicted: `refs` names it, a plain `delete` is refused, `force` repairs the cell to
`#REF`.

## 7. Open questions

- **Q-008** (`-0` legal document state) — deferred again. Untouched by this diff; blocks nothing.
- **Q-012** (world units vs screen pixels) — deferred, unchanged. Still due with the `style`-slots
  cycle and still blocking `pan`'s argument grammar.
- **No new questions.** F1 produced a ruling, not a question: it is a fact about the runtime, not an
  ambiguity in the brief.

## 8. Edits made at this review

1. `src/command/commands.ts` — `refs`'s summary line carries both counts, and the split counts
   dependent SLOTS (F2), with the reason in place.
2. `src/command/commands.ts` — `PartitionedDependents` carries `onTargetSlotCount` /
   `elsewhereSlotCount`; `partitionDependents` fills them from the same predicate that sorts the
   lines, so the two can never disagree. Its doc says which number answers which question.
3. `src/command/commands.ts` — `countedNoun`'s doc said "two messages here count something"; edit 1
   made it three. D-065 binds the reviewer too.
4. `src/command/commands.test.ts` — six summary expectations updated, plus a new test pinning the
   two counts APART on `= table_1.A1 + table_1.A2` (2 edges, 1 dependent slot).
5. `src/command/commands.test.ts` — the stale count comment rewritten (F3), and a test added for the
   disclosed derived-slot gap (§6 above).

Nothing else was touched and no engine file was opened. After the edits: both configs compile,
**1005/1005 tests pass**, 0 skipped, and both new expectations are mutation-checked (2 and 3
failures respectively; 8 for the full partition swap).

## 9. Fix list

**None of it blocks the next slice.**

1. **Depth-limit the recursive descent, from a CONSTANT (F1, D-079).** `formula/parser.ts` returns
   `#PARSE` past a fixed depth instead of unwinding; `format.ts` guards its own recursion for the
   loaded-file path. Set the constant at or below **1,000** nesting levels — the depth every run
   here survived — and pin the constant with a test. **Do NOT derive it from entry 0079's 5,000,
   entry 0081's 3,000, or any new measurement** (D-079 clause 2). Then remove the exception
   sentences the four sites carry. Take it **before** `main.ts`.
2. **Give the missing-slot refusal a remedy.** Message only; **D-047 clause 4 does not move**
   (0080-REVIEW F4). Now also reachable through `refs`, and in D-046's formula-dimension corner its
   "object type X does not declare one" clause is not the reason. `delete`'s own refusal is the
   worked example of a remedy done right.
3. **NEW — `findDanglingReferences` names a dependent once per missing source (F4).** Group by
   dependent, or dedupe within the message. `mutation.ts`, owned by the cycle that opens it.
4. **Carried from 0074-REVIEW §9 through 0080-REVIEW, all six unchanged, none blocking:** (1)
   D-074's refused prompt answer · (2) the usage line for the form a prompting command was used in ·
   (3) what a quoted command WORD means, and entry 0072's "only site" claim · (4) disclose
   0074-REVIEW F4's two message changes and test (a) · (5) `set = x`'s self-contradictory message ·
   (6) `parser.ts`'s header restating D-069 · the twelve bare "this cycle" sites in test files ·
   `render/slots.ts` at the THIRD consumer of `readNumber`/`asPointArray` · `.gitattributes`.

## 10. Where Phase 3 stands, and the next slice

`render/` is complete and reviewed. `command/parser.ts`, `command/prompt.ts` and now all of
`command/commands.ts` except `rename` and D-075's five effect commands are reviewed. No
load-bearing file has unreviewed changes, so §6.2 holds nothing back.

STATUS's order still stands: **`rename`**, then D-075's effects, then `main.ts`, with the depth
limit taken before `main.ts`. `rename` adds an `Operation` kind to `mutation.ts` — that does not
force an immediate stop by itself (§6.1 covers the dangerous cases and none of them fire), but the
file is load-bearing, so §6.2 keeps Phase 4 shut until the review that follows it, and the cycle
should say so in its own log entry.

**Phase 3's criterion is correctly not claimed** and cannot be until `main.ts` holds a canvas.
Phase 4's is correctly not claimed for a second reason on top of that.

## 11. Verdict

**ACCEPT WITH EDITS.**

Three commands, no engine change, and the one hard question in them — who counts as reading an
object that is about to stop existing — answered against the edge set the deletion is actually
validated on rather than the one that looks equivalent. The two findings I fixed are both counting
claims: a summary that counted edges and called them slots, and a comment that counted examples
nobody had recounted. The one I ruled on is a counting claim too, of the dangerous kind — a number
measured once and then used as a bound.
