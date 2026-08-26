# 0084 — REVIEW (phase 3)
Date: 2026-08-26   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0083-command-handlers-rename   Reviewing: entry 0083 (`RenameObjectOperation` and
`findInvalidRenames` in `engine/mutation.ts`, and the `rename` handler in `command/commands.ts`).
Trigger: §6.1 item 5 (one stub test expectation removed) plus §6.2 (`mutation.ts` is load-bearing
and had unreviewed changes), both self-reported by the entry.

Diff reviewed: `963a224` — `src/engine/mutation.ts` (+122/-4), `src/engine/mutation.test.ts` (+158),
`src/command/commands.ts` (+48/-6), `src/command/commands.test.ts` (+86/-1). Re-measured: **4 files,
414 added / 11 deleted = 425 changed**, exactly the entry's number.

Verdict: **ACCEPT WITH EDITS.** Four findings, all four fixed here; two rulings (**D-080**,
**D-081**); nothing added to the fix list.

The operation is the right size and the right shape. A rename that rewrites one field is what §5.3
was designed to make possible, and this is the first cycle that gets to spend it — the entry says
so, the doc comment says so, and a test proves it by asserting the edge set is identical either
side of the rename. Refusing to model a name as a slot at a magic path is the correct call and is
argued from the type, not from taste. The one thing the cycle could not have been expected to look
for, it did not look for: §5.2's grammar and §5.3's keyword list overlap on five words, and
`rename` is the first command in this project that lets a user reach the overlap.

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld, checked mechanically. `document.`/`window.`/`canvas`/
  `render/` over `src/engine` returns only the local parameter named `document` in `document.ts`
  and prose in headers. `mutation.ts` gained one import, `checkNameAvailable` from `address.ts` —
  engine to engine.
- **Rule 2 (state changes only through `mutation.ts`)** — upheld. `renameObject` is a sixth
  `Operation`, not a shortcut around one; the handler builds it and calls `mutate`. No assignment
  to `objects` or `journal` anywhere in the new code, and `applyOperation`'s rename branch returns
  a fresh array of fresh objects rather than writing `object.name`.
- **Rule 3 (two-layer naming)** — upheld, and this is the cycle where the rule pays. The stored
  `Address` is untouched by a rename; `formatAddress` resolves the new name from the id; a test
  pins the AST as still naming `obj_1` after the rename, and another pins the derived edge set as
  identical. Probed the display direction independently: after `rename table_1 grid`, `refs grid`
  prints `grid.A1 → polygon_1.origin.x` and the polygon still evaluates.
- **Rule 5 (dumbest correct implementation)** — upheld. `findInvalidRenames` walks the batch once
  with an array and a linear `find`, mirroring the existence check beside it. No index, no memo.
- **Rules 4, 6, 7** — not touched. The diff creates no slot, evaluates nothing, and adds no
  expression evaluator.

## 2. Invariant audit

Slot set fixed during evaluation, derived slots inside the topological pass, eager/total
extraction, lazy evaluation: not touched — a rename changes no slot and no AST.

**Graph state plain and serializable** — upheld, and worth one line because the operation is new:
`RenameObjectOperation` is three strings, it lands in the journal verbatim, and `JSON.stringify`
round-trips it. **No dangling edges** — upheld vacuously and provably: `deriveEdges` reads ids and
schema, never names, and the test comparing edge sets across the rename is the proof rather than
the claim. **Rejection leaves prior state bit-for-bit unchanged** — re-ran both snapshot tests
(operation level and typed-line level) and they hold; the new pre-staging check returns before
`cloneObjects` is ever called.

## 3. Spec conformance

§5.10's `rename polygon_1 intersection_a` runs, and §5.2's three sentences are enforced where the
brief puts them: "unique across the document, case-insensitive for lookup, `[a-zA-Z_][a-zA-Z0-9_]*`"
and "**Reject rename to an existing name.**" All four behaviours have tests naming the rule.

Two readings the cycle made, both correct:

- **A case-only rename is ACCEPTED** (`rename polygon_1 POLYGON_1`). §5.2 makes names
  case-insensitive *for lookup* and mutable; it does not say the stored spelling is fixed, and
  uniqueness excluding the object itself is what `excludeId` is for. Accepting it is the reading
  that leaves the user in control of display case without inventing a rule.
- **The new name is judged by `mutate`, not by the handler or the parser.** One gate, and the
  refusal for `rename polygon_1 3bad` arrives from `address.ts`'s own words. This is the same seam
  `delete` established at entry 0081 and it is holding.

**Where the brief is silent, and nobody had reached it before: F1.** §5.2's grammar admits `TRUE`,
`FALSE`, `AND`, `OR` and `NOT`; §5.3 lexes all five as literals and operators. Neither section
mentions the other, and until `rename` existed no user-chosen name existed either. Ruled **D-080**.

## 4. Findings

### F1 — `rename` could name an object something no formula can ever reference. FIXED here; ruled **D-080**

`rename table_1 TRUE` committed. Afterwards:

```
link polygon_1.origin.x TRUE.A1        unexpected trailing input starting at "." (position 4)
set  polygon_1.origin.y = TRUE.A1 + 1  unexpected trailing input starting at "." (position 4)
rename ... AND / OR / NOT              expected an expression, found "AND" (position 0)
refs TRUE                              TRUE.A1 → polygon_1.origin.x
```

The name never survives the lexer, so it never reaches `parseAddress` and no NEW reference to that
object can be written — by formula or by `link`, which is a formula path (D-071). Formulas that
already read it keep working, because they hold the id; `list`, `delete`, `refs` and `set <literal>`
keep working, because they resolve names without the formula grammar. So the object is half
reachable, and `refs` prints an address the operator cannot type back in — a §5.10 rejection story
failing in the worst available way.

I swept the candidates rather than guessing at them. Exactly five names break, and they are exactly
`formula/lexer.ts`'s keyword table plus its two boolean literals: `IF`, `SUM`, `PI`, `ALL`, `A1`,
and the lowercase `and`/`true` all parse and resolve normally. That the *function* names are safe is
the reason **D-080 clause 5** forbids widening the reserved set to them.

Fixed at the one gate that already exists: `checkNameAvailable` refuses a reserved word, in any
case, reading the set from `lexer.ts` rather than re-spelling it (D-010). Case-insensitively on
purpose — see D-080 clause 3.

**This cycle introduced the reachability, not the overlap.** No fault is implied in the entry: the
overlap is between two brief sections neither of which mentions the other, and every name in the
project before this cycle came from `generateDefaultName`.

### F2 — `mutation.ts`'s own header was falsified in three places by this cycle. FIXED here

The file header still said **"FIVE operation kinds"** and listed the five, said **"Four
PRECONDITIONS run over the whole batch before staging"** and listed four, and `NOT DONE HERE` said
**"Operation kinds beyond the five above."** Entry 0083 added a sixth kind and a fifth precondition
and updated `commands.ts`'s header but not this one — while STATUS's own gotcha list says, in these
words, "**re-read the headers of the files you edited**" (D-065). A reader who greps this header for
the operation set gets a false answer about the file they are standing in.

Corrected to six and five, with `renameObject` and `findInvalidRenames` named. `mutate`'s own doc
comment had the same shape of problem and a longer standing: it enumerates "two checks... a THIRD
check" and has never mentioned `findInvalidTableResizes`, which has been a pre-staging check since
entry 0047. It now names the fourth and fifth and points at the functions that own them, rather than
restating either.

**On D-076 and this edit:** correcting false sentences in a header is not "editing the header" in
the sense that triggers the 15-line prose cap, and I did not re-cut `WHAT THIS IS` while I was in
there. D-076 says the cap "is not a licence to sweep"; reading it as one would make every
correctness fix to a long header cost a rewrite, which is the opposite of what it is for. I report
no length anywhere in this review.

### F3 — the doc comment for `findInvalidTableResizes` was left heading `findInvalidRenames`. FIXED here

The new function was inserted between `findInvalidTableResizes`'s doc comment and
`findInvalidTableResizes` itself, so the file read:

```
/** Entry 0047/.../0052's row/column resize precondition ... */   <- all about table resizes
/** §5.2's name rules for every renameObject ... */
function findInvalidRenames(...)
function findInvalidTableResizes(...)                             <- now undocumented
```

Two doc comments stacked on one function, the first of them about a different function entirely, and
the project's most heavily-argued precondition left bare. Fixed by moving the whole rename block
BELOW `findInvalidTableResizes`, which restores the original contiguity rather than shuffling the
table comment past the `TrackedTableState` interface that belongs with it. Comment-only: I diffed
`mutation.ts` with all comment and blank lines stripped, both sides sorted, and the code is
identical to `963a224`.

### F4 — two comments in `address.ts` claim a guarantee this cycle's own test disproves. FIXED here; ruled **D-081**

`checkNameAvailable`'s doc opened "The single gate a create or rename mutation must pass before
writing a name," and `parseAddress` carries "no object can exist with an invalid name
(`checkNameAvailable` is the only gate that creates/renames one)". Entry 0083 established the
opposite in three places — its log, `findInvalidRenames`'s doc, and a test that asserts a duplicate
name *does* commit through `createObject` — and did it well; but the two comments asserting the
totality sit in a file the cycle did not open, and they are the ones a future implementer will read
before deciding they need not check a loaded name. D-065 makes a falsified claim the falsifier's,
wherever it lives.

Both rewritten to say what is true: `renameObject` passes the gate, `createObject` does not yet, and
`parseAddress`'s message is imprecise rather than wrong for a document that does hold a bad name.
The code side is **D-081** and belongs to the load cycle.

### Two observations, no action

- **`rename polygon_1 polygon_1` commits and appends a journal entry for an operation that changed
  nothing.** That is in mild tension with the empty-batch rejection's stated rationale ("a
  committed batch that applied nothing would still append... a false record of history"), but it is
  the same shape as `setSlot` writing a value a slot already holds, which has always committed. An
  operation that ran is not an empty batch. No change.
- **`findInvalidRenames`'s `tracked` array is mutated in place** (`entry.name = ...`, `splice`)
  while everything around it is `readonly`. It is a local simulation that never escapes the
  function and never becomes a `GraphObject` — the same latitude `findInvalidTableResizes`'s `Map`
  already takes. Noted so the next reader does not mistake it for a Rule 2 problem.

## 5. Legibility audit

Vocabulary locked. I grepped the added lines for *property*, *field*, *node*, *computed*: "one
field" appears in `RenameObjectOperation`'s doc about `GraphObject.name`, which is genuinely a field
and not a slot — the doc's whole point is that a name is *not* a slot, and it argues it from
`GraphObject.slots`, `Slot` kind, and `Value`. That is the opposite of synonym drift. No `any`.
Test names are behaviour sentences naming the clause they defend; the two `describe` blocks split
along the right seam (what the operation does, versus what the batch simulation decides).

The best comment added this cycle is the "NOT a `setSlot` with a special path" paragraph, because it
records a rejected alternative and the reason — D-017's check would have to be taught to ignore an
invented path. That is the expensive kind of knowledge §5.2 asks to be kept. The worst thing in the
diff is F3, which is a placement accident rather than a writing one.

`commands.ts`'s header was updated honestly and in the present tense, including the arm count on
`executeCommand`'s doc — the count that F2 shows was missed one file over.

## 6. Honesty audit — entry 0083

**The log matches the diff, and the claimed results are real — re-run, not read.** `npx tsc
--noEmit` and `-p tsconfig.engine.json` both exit 0 on `963a224`; `npm test` gives 24 files /
**1032 tests**, 0 failed, 0 skipped, and no `.only`/`.skip`/`.todo` in the tree. 1005 → 1032 = 28
new − 1 removed ✓. 425 lines / 4 files ✓. Six `Operation` kinds in the union ✓.

**The mutation-check table reproduces.** I re-ran three of the five independently, against the
source, reverting each: stubbing `findInvalidRenames`'s result to `[]` fails **9**; returning
`objects` unchanged from the rename branch fails **11**; dropping `excludeId` from the
`checkNameAvailable` call fails **2**. The entry's numbers exactly, and the full suite is green
again after each revert.

**The removed test expectation is a stub deletion, not a weakening.** `rename` left
`UNHANDLED_EXAMPLES` because it is no longer unhandled, and gained a line in
`EVERY_REGISTRY_EXAMPLE`; the two sweep tests that pin both lists against `COMMAND_NAMES` still
pass, so no command word can go unrouted. Same shape as entry 0081's three removals.

**Scope: no expansion, and one deliberate non-expansion reported at the right size.** The
`createObject` name gap is disclosed in the log, in the function's own doc, in STATUS, and pinned by
a test that asserts the current behaviour — which is the most useful form of disclosure available,
because closing it is now a diff against a named test. Fix-list item 1 (the parser depth limit),
D-075's `effect`, and `main.ts` are all correctly untouched and each says why. Phase 3 and Phase 4
both explicitly not claimed.

**The gap in the entry is F1's**, and it is a gap in what the cycle thought to check rather than in
what it reported. The entry's own framing — "§5.2's two rules have exactly one gate, and it now has
a caller" — is exactly right, and is what made the third rule's absence invisible: the gate enforces
what §5.2 says, and the problem is what §5.3 says.

## 7. Open questions

- **Entry 0083's question 1 — the `createObject` name gap: right call, and whose?** Right call;
  ruled **D-081**. The direction is now settled (same gate, extend the same simulation, reject the
  whole batch) so the load cycle inherits a decision rather than a question.
- **Entry 0083's question 2 — should the first refused rename stop the walk?** No. Keep gathering.
  Every other check in `mutation.ts` names every offender in one pass, for D-021/0020's reason: a
  corrupted saved document benefits from seeing all of them at once. The batch is all-or-nothing, so
  both messages describe the batch *as submitted*, which is what the operator sent; and the
  alternative the question hints at — applying a REFUSED rename to the simulation so the later one
  passes — would be strictly worse, because it reports a document state that will never exist. The
  in-place comment (`// Not applied to the simulation — a refused rename changes no name.`) already
  says the right thing.
- **Q-008** (`-0` legal document state) — deferred again. Untouched by this diff; blocks nothing.
- **Q-012** (world units vs screen pixels) — deferred, unchanged. Still due with the `style`-slots
  cycle and still blocking `pan`'s argument grammar.
- **No new questions.** F1 produced a ruling rather than a question: the two brief sections do not
  conflict, they simply never mention each other, and one gate settles it.

## 8. Edits made at this review

Six files. Nothing in `mutation.ts` but comments; nothing anywhere that changes an accepted
behaviour except F1's refusal.

1. `src/engine/formula/lexer.ts` — exports `RESERVED_WORDS`, built from the existing `KEYWORDS`
   table plus `TRUE`/`FALSE` so it cannot drift from what `lex` actually matches (D-080 clause 2).
   Its doc says why a caller outside `formula/` reads it. The file header is untouched.
2. `src/engine/address.ts` — `checkNameAvailable` refuses a reserved word in any case, between the
   grammar check and the uniqueness check, with the reason and the remedy in the message:
   `"TRUE" is a reserved word — §5.3 reads AND, OR, NOT, TRUE, FALSE as formula keywords in any
   case, so no formula could reference this object; choose another name`.
3. `src/engine/address.ts` — `checkNameAvailable`'s doc and `parseAddress`'s NAME_PATTERN comment
   corrected (F4), naming D-081 for the `createObject` half.
4. `src/engine/mutation.ts` — file header: six operation kinds, five preconditions, "beyond the six
   above" (F2). `mutate`'s doc names the fourth and fifth checks.
5. `src/engine/mutation.ts` — `findInvalidRenames` and its doc moved below `findInvalidTableResizes`
   so each doc comment heads its own function again (F3). Code identical, verified by a
   comment-stripped diff.
6. Tests: `address.test.ts` (+4 — every reserved word refused, a mixed-case one with its exact
   message, `android`/`not_1` accepted, and the set's contents pinned), `mutation.test.ts` (+1, the
   refusal at the operation level), `commands.test.ts` (+3 — the typed line refused, refused in any
   case with prior state unchanged, and the positive case: an accepted new name is still
   formula-referenceable, `set polygon_1.radius = grid.A1 + 1` evaluating to 6).

After the edits: both configs compile, **1040/1040 tests pass**, 0 skipped, 0 `.only`.
Mutation-checked my own gate — disabling the `RESERVED_WORDS` branch fails **5** of the 8 new tests
(the other three assert acceptance, correctly unaffected).

## 9. Fix list

**Unchanged from 0082-REVIEW §9. Nothing was added by this review, and nothing on it blocks the next
slice.**

1. **Depth-limit `formula/parser.ts`'s recursive descent, from a CONSTANT (D-079).** Return `#PARSE`
   past a fixed depth instead of unwinding; guard `format.ts`'s recursion for the loaded-file path;
   set the constant at or below **1,000** nesting levels, never from a measurement; pin the constant
   with a test; then remove the exception sentences the four sites carry. Take it **before**
   `main.ts`.
2. **Give the missing-slot refusal a remedy.** Message only; **D-047 clause 4 does not move**.
   `delete`'s refusal — and now D-080's — are the worked examples of a refusal that says what to do.
3. **`findDanglingReferences` names a dependent once per missing source.** Group by dependent or
   dedupe within the message. `mutation.ts`, owned by the cycle that opens that function.
4. **Carried from 0074-REVIEW §9, all six unchanged, none blocking:** (1) D-074's refused prompt
   answer · (2) the usage line for the form a prompting command was used in · (3) what a quoted
   command WORD means, and entry 0072's "only site" claim · (4) disclose 0074-REVIEW F4's two
   message changes and test (a) · (5) `set = x`'s self-contradictory message · (6) `parser.ts`'s
   header restating D-069 · the twelve bare "this cycle" sites in test files · `render/slots.ts` at
   the THIRD consumer of `readNumber`/`asPointArray` · `.gitattributes`.

## 10. Where Phase 3 stands, and the next slice

`mutation.ts`'s changes are reviewed, so **§6.2 no longer holds Phase 4 shut** — though Phase 3's
own criterion has to pass first regardless, and it cannot until `main.ts` holds a canvas.

Every §5.10 command about an existing object's identity is now built and reviewed. STATUS's order
stands and is unchanged by this review:

1. **D-075's `effect`** for `select`/`zoom`/`fit`/`save`/`load` — widen `CommandOutcome`'s success
   arm with an optional plain-data effect; `commands.ts` still resolves the name and refuses an
   unknown one; `main.ts` performs it.
2. **The parser depth limit** (fix-list item 1), its own small slice, taken **before** step 3.
3. **`main.ts`** — one clamped camera into `renderDocument`/`hitTest`/`pointerDown`/`pointerMove`
   (D-062), `zoom`/`fit` writing `Document.camera` directly and never through `mutate` (D-027
   clause 2), the transform reset before screen-space chrome, and `prompt.ts` wired so a canvas
   click during a live sequence is a `picked` response with screen→world done in `camera.ts`.

**Phase 3's criterion is correctly not claimed.** Phase 4's is correctly not claimed for the second
reason the entry gives on top of that.

## 11. Verdict

**ACCEPT WITH EDITS.**

The engine change is small, argued from the type system rather than from preference, and tested from
both ends — the operation and the typed line — with a mutation-check table that reproduces exactly.
Three of my four findings are comments that stopped being true the moment this code landed, two of
them in files the cycle edited and one in a file it only depended on; that is the ordinary tax of a
codebase whose comments carry this much load, and the discipline that catches them is already
written down in STATUS's own gotchas.

The fourth is the real one, and it is the kind this project's review step exists for: a rule that is
correct against the section it cites and wrong against the section nobody thought to open. `rename`
is the first command that hands a user the naming layer, and the naming layer and the formula
grammar disagree about five words. One clause at one gate, and the two layers agree again.
