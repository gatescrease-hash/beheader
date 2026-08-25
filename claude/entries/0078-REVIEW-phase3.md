# 0078 — REVIEW (phase 3)
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0077-RULINGS   Reviewing: entry 0075 (`command/commands.ts` + the four creation
handlers). Entries 0076 and 0077 are the human's own rulings and are read as binding, not graded.
Trigger: §6.1 item 5 (`schema.test.ts`'s three `resolveNonDerivedSlotPaths` expectations changed),
plus §6.3's cap (~835 lines / 13 files against 800/10) and §6.2 (`document.ts`, `schema.ts`).

Diff reviewed: `c461f82` — `src/command/commands.ts` (+332), `src/command/commands.test.ts` (+369),
`src/engine/document.ts` (+25), `src/engine/primitives/schema.ts` (+21/-9), `schema.test.ts` (+8/-6),
and eight comment-only files. **13 source files, 835 changed lines — matches the log and
`STATUS.md` to the line** (`git show --numstat`, summed: 789 added, 46 deleted).

Verdict: **ACCEPT WITH EDITS.** Four findings. One is serious and is **mine, not the
implementer's**: `table x=0 y=0 rows=1000 cols=200` — both counts inside the range D-070 ruled —
threw a `RangeError` out of `executeCommand`. Found by probe, fixed here, ruled **D-077**. Entry
0075 implemented D-070 exactly as written; the ruling was what was wrong.

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld, checked mechanically. `window`, `globalThis`,
  `document.createElement|getElementById|querySelector`, `CanvasRenderingContext2D`, `HTMLCanvas`
  and any `render/` import across `src/engine/` and `src/command/` return **header text only**.
  `commands.ts` imports eight engine modules and `./parser.ts`, nothing else. The one crossing is
  in `commands.test.ts`, which imports `render/hittest.ts` and `render/interaction.ts` in its last
  block on purpose — a TEST proving the seam, which is the shape STATUS already records as allowed.
- **Rule 2 (mutation-only state change)** — upheld, and this is the cycle that had to earn it.
  `commands.ts` builds a `GraphObject` and hands it to `mutate`; it writes no slot, no journal
  entry, and no object list of its own. The `Document` it returns takes every graph-bearing field
  from `mutate`'s result, and `nextObjectId` is the counter D-002 makes document state. Probed:
  the caller's own document is unchanged after both a success and a refusal.
- **Rule 3 (addressing)** — upheld by abstention. Creation mints an id and a name; it resolves no
  address, and `generateDefaultName` is `address.ts`'s (case-insensitive — probed with a seeded
  `CIRCLE_1`, which correctly yields `circle_2`, so a default name can never collide).
- **Rule 4** — not touched. `parseFormula` is still called nowhere in `command/`.
- **Rule 5 (performance is a non-goal)** — upheld, including where it was tempting not to. See §4
  F1: the right fix for the `RangeError` was a loop, **not** a tighter bound, and D-077 clause 3
  says so in writing.
- **Rule 6 (slot set fixed during evaluation)** — upheld, and the design that upholds it is the
  best thing in this cycle. Creation fills derived slots from `schema.derivedSlots` mechanically
  and lets step 7 of the same mutation overwrite the `null`; nothing type-specific, nothing
  hand-listed. Probed: a fresh circle already holds 32 vertices, a real `area`, and slots at
  **every** declared non-derived path (`circle` 3/3, `polygon` 5/5, `rect` 4/4) with no undeclared
  extras. D-070's counts are checked before any `Operation` exists, so no slot set is ever built
  and then refused.
- **Rule 7** — not touched.

## 2. Invariant audit

- **Derived slots inside the topological pass** — proved by the fresh-circle test, not asserted.
- **Rejection leaves prior state untouched** — probed at both refusal paths (D-070's count check,
  which never reaches `mutate`, and `mutate`'s own D-025 refusal of an overflowed coordinate). The
  counter does not advance on either.
- **No dangling edges** — a created table declares one cell path per `rows x cols` and carries a
  slot only where something was written. `deriveEdges` skips the unpopulated ones (D-047 clause 1)
  and emits nothing. This is the state the human confirmed at entry 0076; see F3 for the comment
  that still called it malformed.
- **Graph state plain and serializable** — probed end to end for the first time through the
  creation path: a document built by `circle` + `polygon` + `table` commands, saved and reloaded,
  is **identical**. Phase 0's clause 4 still holds over objects no Phase 0 test could construct.
- **Never throws** — **violated.** F1.

## 3. Spec conformance

All four handler forms are §5.10's own example lines, argument for argument, and all four preset
slot sets are §5.5's: `circle(origin, radius)`, `polygon(sides, radius, origin, rotation)`,
`rect(origin, width, height)`. `polygon`'s `rotation` defaults to `0` because §5.10's form gives it
no argument — correct, and disclosed rather than silent. §5.4's 8x8 default arrives from the
parser. §5.10's echo ("echo results and errors in a small scrolling log") is `lines`, one entry per
line.

**D-070, all four clauses, implemented as ruled** — including clause 3's example message verbatim
(`sides must be a whole number from 3 to 1000, got 2.5`) and `MIN_POLYGON_SIDES` imported rather
than re-spelled. **D-018** is satisfied structurally rather than by a hand-written list, which is
the stronger reading. **D-002**'s counter now advances at exactly one call site because
`mintObjectId` returns the pair — a good, cheap design.

**`TABLE_SCHEMA`'s origin pair is correct and its justification is exactly right:** an undeclared
literal already drew, and what the schema entry buys is D-017's rule that only a declared path may
hold a `formula` slot. The behavioural test writes a formula slot at `table_1.origin.x` through
`mutate` and reads `42` back out — the claim proved at the level it is made.

## 4. Findings

### F1 — `table x=0 y=0 rows=1000 cols=200` threw `RangeError` out of `executeCommand`, with both counts inside D-070's range. FIXED at this review. Ruled D-077.

Found by probe, not by reading:

```
table x=0 y=0 rows=300 cols=300   (90,000 cells)    OK in 83ms
table x=0 y=0 rows=1000 cols=130  (130,000 cells)   THREW RangeError: Maximum call stack size exceeded
table x=0 y=0 rows=1000 cols=200  (200,000 cells)   THREW RangeError
table x=0 y=0 rows=1000 cols=1000                   THREW RangeError
beginCommand("table x=0 y=0 rows=1000 cols=1000")   THREW RangeError   (the path a typed line uses)
```

The single site was `primitives/schema.ts`'s `paths.push(...group.enumerate(object))`. A spread
reads as concatenation and compiles to a call with N arguments; N here is `rows x cols`.

It breaks three separate written guarantees at once: `commands.ts`'s header ("never throws") and
`executeCommand`'s own doc; `resolveNonDerivedSlotPaths`'s own doc, whose stated reason — "this
function does nothing beyond concatenating its results" — was true and was the wrong thing to be
sure about; and `document.ts`'s. That last one is **pre-existing and reachable without any
command**: `loadDocument` on a hand-edited file holding a `rows=1000 cols=200` table threw the same
`RangeError`, past a header that says the file never throws.

**This is a defect in D-070, not in entry 0075.** The ruling bounded the COUNTS; the hazard is the
SIZE OF THE FAMILY the counts declare, and D-070's own rationale — "a hang with no error, the one
class of failure this project's error-value idiom cannot express" — names exactly what got through.
Entry 0075 implemented the ruling as written, wrote a test named for the hazard ("refuses a table
row count that would allocate an unbounded slot family"), and could not have found this: every
table in the tree is three orders of magnitude below the break, so none of its six mutation checks
could reach it either.

**Fixed here** — the spread is a loop, with the reason in place. **Do not tighten D-070's numbers
instead**: measured with the loop, the worst corner the bounds allow (`rows=1000 cols=1000`,
1,000,000 declared paths) commits in ~1.2 s and round-trips, and `rows=1000 cols=200` in 222 ms.
That is Rule 5's accepted trade, not a wedge. D-077 clause 3 binds this so a later cycle cannot
"fix" it by shrinking a number.

**Second occurrence, hence a ruling.** 0035-REVIEW Finding 4 found `Math.min(...numbers)` in
`formula/functions.ts`; D-036 clause 5 assigned the fix; the range-wiring cycle replaced it with
`.reduce` and left a comment naming `RangeError`. That fix was right and the generalisation never
happened — the same shape was sitting in the one function every mutation calls, over the one
collection the user sizes directly. §8's "a recurring misunderstanding becomes a ruling" is
precisely this.

### F2 — `document.ts`'s header says the file does NOT do the thing this cycle added to it. FIXED at this review.

The cycle added `mintObjectId` to `document.ts`. Sixty lines above it, `NOT DONE HERE` still read:

> - Allocating a fresh object id from `nextObjectId` (incrementing the counter, choosing a type's
> default slot values) — a FUTURE command-layer concern (§5.10, Phase 3)

That is D-063's own class (a header stating its own file's present contract) reached through
D-065's door, in the file the cycle deliberately opened, and it is the worst place for it: a reader
greps `document.ts` to find out whether ids are minted there and is told no. The half about a
type's starting slot VALUES is still true and still `commands.ts`'s; only the id half moved.
Corrected to say both.

The implementer's eight-file D-065 sweep was careful and correct as far as it went — every one of
those eight is a real falsified claim about another file. What it missed is the file it was
editing, which is the harder direction to see.

### F3 — `deriveEdges` calls a command-created table's own state a "malformed/incomplete fixture". FIXED at this review.

`mutation.ts`'s unpopulated-path branch read: *"this path isn't populated on this particular object
(a malformed/incomplete fixture — mutation.ts's future object-creation step should never produce
one)"*. Entry 0075's decision 1, confirmed by the human at entry 0076, makes an 8x8 table
**declare 68 paths and carry 4 slots** (probed) — so all 64 absent cells take that branch on every
mutation, and the comment tells the next reader that ruled-correct state is malformed. It also
attributes object creation to a "future" step of `mutation.ts`, which is neither future nor
`mutation.ts`'s.

Corrected to say what the branch actually sees and why it is ordinary, citing D-047 and naming
`command/commands.ts`. The same file's header carried the same sentence in its `NOT DONE HERE` —
the creation command as "a command-layer concern" with no file named — and now names it. That one
is marginal on its own; it is here because the body doc 320 lines below it had ALREADY been
corrected by this cycle, which is what made one file saying both things visible.

### F4 — `commands.test.ts`'s "never throws for any command in the registry" covers 6 of 17. NOT fixed; fix list item 1.

```ts
it("never throws for any command in the registry, run against an empty document", () => {
  for (const line of ["circle x=0 y=0 r=1", "polygon sides=3 x=0 y=0 r=1", "rect x=0 y=0 w=1 h=1",
                      "table x=0 y=0", "list", "save"]) {
```

The name claims the registry; the body is a six-item literal. This is the test whose name a later
cycle will trust instead of reading — the same overclaim shape 0074-REVIEW F3 found in a log entry,
here in an assertion. The material to make it true is already in the file: `UNHANDLED_EXAMPLES`'s
twelve lines plus the four creation lines **are** the whole registry, and the block below already
pins that union against `COMMAND_NAMES`. Two lines.

Being honest about what this would and would not have caught: **not F1.** A registry sweep runs
every command word once with small arguments; F1 needed a large in-range count. The size probe that
does catch it is now `schema.test.ts`'s, at the mechanism (D-077 clause 2).

## 5. Legibility audit

Headers present on both new files, both stating layer, allowed imports and brief section, both
present-tense, no diary comments, no bare "this cycle", vocabulary locked, no `any` anywhere in
`src/command/`. `commands.ts`'s switch closes with the house `const exhaustive: never` idiom. Tests
are behaviour sentences and most name the ruling they defend.

`WHAT THIS IS` is within D-076's 15-line cap on the new file and on every header edited by this
cycle and this review. Per D-076 clause 3 nothing else about length is reported, here or in
`STATUS.md`.

Two comments worth naming as the good kind, because they are the ones a future cycle will need:
`createObjectFromCommand`'s explanation of why derived slots come from the schema and why their
`null` never escapes, and `createTable`'s explanation of which spelling of an empty cell it picked
and why either was legal. Both give the reason, not the pointer.

## 6. Honesty audit — entry 0075

Re-run, not read:

```
$ npx tsc --noEmit                          exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json  exit 0, no output
$ npx vitest run                            23 files, 925 passed (925), 0 skipped   [926 after this review's test]
$ grep -rnE "\.only\(|\.skip\(|it\.todo|describe\.todo" src/    no output
$ git status --short                        clean
```

**Every number in entry 0075 is real**, including the diffstat (835 / 13, to the line) and the
baseline (883 + 42 = 925).

**Three of the six mutation-check rows re-run, ANSI-stripped, asserted on the `Tests` line:**

| Neutralised | Log claims | Observed |
| --- | --- | --- |
| `refuseCountOutOfRange` → always in range | 6 failed | **6 failed**, and the six named are the six the log names |
| `TABLE_SCHEMA` → origin paths removed | 4 failed | **4 failed** (the behavioural test + the three `schema.test.ts` ones) |
| `noHandlerYet` → drop the command word | 13 failed | **13 failed** |

Tree restored and re-verified green after each.

**Scope matches the diff.** Nothing outside the declared slice plus the D-065 corrections; every
comment-only file is genuinely comment-only (`git show` confirms); `DECISIONS.md` was not written
to by the implementer; `entries/` is append-only. The eight D-065 corrections are all real
falsifications, and each is stated in the log.

**The self-assessment is unusually honest and two of its three items are now moot.** It reported
being over the §6.3 cap without excusing it, and reported the two length problems D-076 had retired
hours earlier — which is not a defect in the entry, just a ruling arriving between two files. The
one item that stands is its own: a tighter slice was available (the seam plus `circle`), and the
reasoning for not taking it is stated rather than hidden.

**One thing the log gets half wrong.** It declines `mutation.test.ts:2038`'s stale claim on the
ground that "still-deferred resize/creation cycle" means resize, which landed at 0047/0050. The
resize half was already stale; the **creation** half of that same phrase is falsified by this
cycle, so under D-065 that site now has an owner instead of being ambient debt. It is one line in a
test file and it goes on the fix list, not into a finding.

**Phase 3's criterion is correctly NOT claimed**, and the entry says plainly that no pixel has come
out of this project. That is the sentence a less honest log would have softened.

## 7. Open questions

- **Q-012 (world units vs screen pixels)** — untouched, open, still deferred to the `style`-slots
  cycle, still blocking `pan`'s grammar.
- **Q-008 (`-0`)** — untouched, open, blocking nothing.
- **Q-001/Q-002 (ANSWERED → D-041/D-040)** — still owed reconciliation at the `set`/`unlink`
  handlers, i.e. the next cycle. Unchanged.
- **No new question raised by entry 0075, and none was needed** — everything it decided was
  pre-cleared by an existing ruling or is a disclosed reversible choice. F1 is a defect against a
  ruling, not an ambiguity in one, which is why it is D-077 and not a Q.
- Live `PROVISIONAL` tags are Q-008 (`graph/node.ts`) and Q-012 (`render/renderer.ts`) and no
  others, matching `STATUS.md`. **Next free: Q-014.**

## 8. Edits made at this review

1. `src/engine/primitives/schema.ts` — the `dynamic`-group spread becomes a loop (F1), with the
   reason and the measured break in place; the function's "never throws" paragraph now says what
   actually keeps it true. **Mutation-checked, and the checker checked**: restoring the spread
   fails exactly the new test (1 failed / 925 passed); with the loop, 926/926.
2. `src/engine/primitives/schema.test.ts` — one test, in the existing `resolveNonDerivedSlotPaths`
   block: the 200,004 paths a `rows=1000 cols=200` table declares resolve without throwing. Costs
   ~36 ms and runs the REAL schema and enumerator, not a fake.
3. `src/engine/document.ts` — the `NOT DONE HERE` bullet that denied `mintObjectId` (F2). Comment
   only.
4. `src/engine/mutation.ts` — the `deriveEdges` branch comment (F3) and the header bullet beside
   it. Comment only.
5. `claude/DECISIONS.md` — **D-077**.

No behaviour changed except F1's, which converts a throw into the return the callers already
expect. No test was weakened, skipped or deleted.

## 9. Fix list

**None of it blocks the next slice.** The next cycle opens `commands.ts` anyway, so items 1–2 ride
along with it.

1. **Make `commands.test.ts`'s registry sweep cover the registry (F4).** Iterate
   `UNHANDLED_EXAMPLES`'s lines plus the four creation lines — that union is already pinned against
   `COMMAND_NAMES` in the block below it — or rename the test to say what it checks.
2. **Correct `mutation.test.ts:2038`'s "still-deferred resize/creation cycle"** (§6 above), and
   with it the two carried stale claims in `schema.test.ts` that this cycle's own edits sat beside.
   These are the carried test-file comment debt (0058-REVIEW F2), one of which now has an owner.
3. **Carried unchanged from 0074-REVIEW §9, all six, none touched by entry 0075 and none blocking:**
   (1) report a refused prompt answer with the sequence's own message (**D-074**) · (2) a usage line
   for the form a prompting command was used in, folded into 0069-REVIEW F3's sweep · (3) decide
   what a quoted command WORD means, and correct entry 0072's "only site" claim · (4) disclose
   0074-REVIEW F4's two message changes and test (a) · (5) `set = x`'s self-contradictory message ·
   (6) `parser.ts`'s header restating D-069 · `render/slots.ts` at the THIRD consumer of
   `readNumber`/`asPointArray` · `.gitattributes`. **Item 6's end-to-end table-creation test is
   DONE** (0075), and this review's own probes confirm it tests what it claims.

## 10. Where Phase 3 stands, and the next slice

`render/` is complete and reviewed. `command/parser.ts`, `command/prompt.ts` and now
`command/commands.ts`'s seam and creation half are reviewed. `document.ts` and
`primitives/schema.ts` are clean as of this review, so **§6.2 no longer holds a later phase back on
anything touched this batch.**

Next slice is unchanged from what `STATUS.md` proposes and it is the right one: the SLOT commands
(`set`/`set-formula`/`link`/`unlink`) in one cycle, where D-040/D-041 get **reconciled, not
re-decided**, and D-038's four conditions come due at the first `parseFormula` call in the codebase.
Then `rename`/`delete`/`refs`/`list`, then D-075's effects, then `main.ts`.

Phase 3's criterion is correctly not claimed and cannot be until `main.ts` holds a canvas.

## 11. Verdict

**ACCEPT WITH EDITS.**

The seam is the right shape. `executeCommand` is the only place a `Command` meets a `Document`,
the creation path is one function all four handlers share, the slot set comes from the schema
rather than a list someone has to remember to update, the id and the counter move together, and
the switch is exhaustive from the first commit so the twelve unbuilt arms refuse by name instead of
silently succeeding. The tests push real lines through the real parser, the end-to-end pair
discharges a debt carried since 0062-REVIEW, and the log matches the diff to the line.

F1 is serious and it is not this cycle's. That is the second review running to say so — 0074-REVIEW
F1 was the same shape, a defect in its predecessor's ruling that the implementer had obeyed — and
the pattern is worth naming: **entry 0075 obeyed a ruling
exactly, and the ruling was the thing that was wrong.** The implementer's job under §4 is to obey
it, which is what happened; the reviewer's job is to probe the range the ruling permits, which is
what did not happen at 0069-REVIEW and does now (D-077 clause 2).

F2 and F3 are two comments in files this cycle opened, and both are the direction D-065 is hardest
to see from: not "another file does not exist yet" but "this file does not do what I just made it
do." F4 is a test name promising more than it checks.

REVISE would say the work needs redoing. It does not: 926/926, both typechecks clean, and the next
cycle can start on top of this without waiting for any of the fix list.

One ruling issued (D-077). Five edits made, one of them behavioural and mutation-checked.
