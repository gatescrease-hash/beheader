# 0071 — REVIEW (phase 3)
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0070-prompt-sequences   Reviewing: entry 0070 (`command/prompt.ts`, D-071's
formula path)
Trigger: §6.1 item 3 (D-072 extends §5.10) and item 5 (changed test expectations), §6.3's line cap
(~962 against ~800) — **and** entry 0070's own process note: that cycle was written by the reviewer
on human direction and had no independent eye on it. This review is that eye.

Diff reviewed: `7eaaa0f` — `src/command/prompt.ts` (new, 332), `src/command/prompt.test.ts` (new,
250, 32 tests), `src/command/parser.ts` (+239/-26), `src/command/parser.test.ts` (+46/-13), plus
`DECISIONS.md`, `OPEN_QUESTIONS.md`, `STATUS.md` and the entry. 4 source files, ~962 lines.
**Matches the log exactly.**

Verdict: **REVISE.** Two real defects in the surface this cycle created, neither disclosed. One
ruling issued (D-073), one reviewer edit made (F5's hazard note), the survived mutant ruled on.
Nothing found is a regression — the tree is green, the log is honest, and every number in it is
real. The fix list is five items and item 1 should land before `commands.ts` builds on `source`.

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld, checked mechanically. A grep for `window`, `globalThis`,
  `document.createElement|getElementById|querySelector`, `CanvasRenderingContext2D` and
  `HTMLCanvas` across `src/engine/` and `src/command/` returns **header text only**. No `render/`
  import in either directory; nothing in `src/engine/` imports `command/`. `prompt.ts` imports
  exactly one module (`./parser.ts`); `parser.ts` imports exactly one (`engine/primitives/table.ts`,
  for `DEFAULT_TABLE_ROWS`/`_COLS`). D-072 clause 1's real content — a pick arrives as a WORLD
  point and this layer never converts one — holds: there is no camera, no screen coordinate, and no
  canvas fake anywhere in the new test file.
- **Rule 2 (mutation-only state change)** — not touched. Nothing here reaches graph state.
  `PendingCommand` is returned fresh from every call; nothing is mutated in place.
- **Rule 3 (addressing is load-bearing)** — upheld by abstention, which is the point of D-069.
  `set a.b = c.d` carries `target: "a.b"` and `source: "= c.d"` as typed. Nothing resolves.
- **Rule 4 (one formula engine)** — upheld, and this is the cycle where it could first have been
  broken. `parseFormula` is not called, no second expression evaluator appears, and the formula is
  carried as text to the layer that owns parsing it. **F1 below is a defect in how faithfully the
  text is carried, not a second evaluator.**
- **Rule 5 (performance is a non-goal)** — upheld. `findCommandSpec` is a second linear scan over
  sixteen entries and should stay one; `beginCommand` re-tokenizes a line `parseCommand` will
  tokenize again, which is correct at this scale and should not be "fixed."
- **Rule 6 (slot set fixed during evaluation)** — not touched here. D-070's counts still pass
  through unbounded, correctly and deliberately (`prompt.test.ts` pins `sides: 2.5` with a test
  naming D-070), and still come due at `commands.ts`.
- **Rule 7 (nothing from §8)** — upheld. D-072 is an authorised extension of §5.10, not
  gold-plating, and the cycle declined three adjacent temptations by name with an owner on each:
  relative coordinates (`@10,10`), object-selection prompts, and the rubber-band preview.

## 2. Invariant audit

The graph invariants — slot set fixed, derived slots inside the topological pass, eager/total
extraction, lazy evaluation, bit-for-bit rollback, no dangling edges, plain serializable state —
are **not touched**. Nothing in this diff reaches the graph.

Two file-local invariants checked by probe rather than by reading:

- **"Never throws"** — held across every malformed line probed: an empty line, whitespace only,
  a bare `=`, `set = = =`, unterminated quotes, tokens past the end of a sequence, a `respond` with
  an out-of-range `stepIndex`, and a `distance` step whose `relativeTo` answer is missing.
- **`PendingCommand` is plain and serializable** — confirmed, and the file pins it itself with a
  `JSON.stringify` round-trip. The spec is looked up from `commandName` on every call and never
  held, so no closure or live registry object reaches the state. This is the invariant most easily
  lost in a state machine and it was designed for correctly.

## 3. Spec conformance

D-072's eight clauses are each implemented and each pinned by a named test. Clause 3 — both forms
produce the identical `Command` — is pinned the right way: `EQUIVALENT_FORMS` drives every
prompting command down both paths and compares the results, with a coverage assertion that fails
if a command grows `prompts` without an entry, plus a second asserting `prompts` and
`buildFromPrompts` are declared together. That is the difference between pinning the rule and
trusting two `build` functions to agree, and it is the strongest thing in the cycle.

§5.10's `key=value` form is unchanged and still pinned by its own tests. The prompt sequences,
their wording and the `<8>` default form are the previous cycle's reading of AutoCAD, correctly
disclosed as choices rather than derivations; none is load-bearing and all are cheap to change.
I have no better reading to offer and defer them to the human in use.

**D-071 is where conformance breaks. See F1.**

## 4. Findings

### F1 — a formula's source is still tokenized by the command lexer, so §5.3's string literals mostly cannot be typed. **NOT fixed; fix list item 1. Ruled as D-073.**

D-071 clause 1 requires the source to be "the RAW SUBSTRING of the line from the `=` character to
the end of the line, verbatim." `matchArguments` slices exactly that, and a test pins it including
the operator's own spacing. But `parseCommand` tokenizes the **whole line** before `matchArguments`
is ever called, so the command layer's quoting rules run over the formula text first:

```
set a.b = CONCAT("a", "b")              FAIL@17: a quote must open an argument, not sit inside one
set a.b = CONCAT( "a" , "b" )           OK   source: '= CONCAT( "a" , "b" )'
set a.b = IF(t.c > 1, "big", "small")   FAIL@27: a quoted argument ends at its closing quote
set a.b = IF(t.c > 1, "big" , "small" ) OK   source: '= IF(t.c > 1, "big" , "small" )'
set a.b = LEN("hello") > 3              FAIL@14: a quote must open an argument, not sit inside one
set a.b = ((( not a formula             OK   source: '= ((( not a formula'
```

The last line is the tell, and a test pins it deliberately: syntactically broken formulas reach
`commands.ts` untouched, exactly as D-071 clause 2 asks. **Quotes are the only formula characters
the command lexer mangles** — which makes this narrow, and also makes it arbitrary. Whether a
formula is accepted depends on where the operator put spaces around commas and parens.

Why it matters rather than being a curiosity:

- §5.3 gives the language string literals and ships `CONCAT`, `LEN` and string comparison in the
  v1 built-ins. A formula containing one must be typeable, and `set` is now the only way to author
  a formula at all.
- The message actively misdirects. It is about command-argument quoting, it points into the middle
  of the operator's formula, and its advice — `write set text_1.content "a b"` — is the quoting
  that just failed. There is no rule the operator could learn from it.
- §5.4's formula bar and Phase 5's text `{= }` are both specified to share this spelling. A gap
  here propagates.

Note what this is **not**: 0069-REVIEW's F1 fix — a closing quote must be followed by whitespace —
is correct and stays. It is a rule about command *arguments*, and the second failure above is that
correct guard firing on text it was never aimed at. The defect is the ordering, not the guard.

Left for the implementer rather than fixed here: the fix moves *when* tokenization happens
(`parseCommand` tokenizes the head, finds the spec, and stops the lexer at the formula's `=` rather
than running it to end-of-line), which is a change to the parse entry point's structure and needs
its own tests. That is not a surgical reviewer edit. **D-073 rules the boundary** so the next cycle
implements a decided rule rather than re-deriving one, and so §5.4's formula bar inherits it.

### F2 — the prompt path's overflow message blames a token it accepted. **NOT fixed; fix list item 2.**

```
circle 100,100 20 extra   =>  '"circle" does not take the argument "100,100" — usage: circle x=<number> y=<number> r=<number>'   start: 7
rect 0,0 10,10 junk       =>  '"rect" does not take the argument "0,0" — …'                                                      start: 5
polygon 5 0,0 20 9        =>  '"polygon" does not take the argument "5" — …'                                                     start: 8
```

The named token is the one the sequence read **correctly** — `100,100` is the centre it accepted.
The offending token is `extra`, at offset 18, and neither the message nor `start` mentions it. The
operator is told their good input is bad, pointed at the wrong character, and shown the usage line
for a form they did not use.

The cause is `beginCommand`'s "more tokens than the sequence takes → `fromParse(line)`" branch, and
the reasoning behind it is sound for the case it was written for: when the sequence cannot *read* a
token, `parseCommand` produces the better message and writing a second one would be duplication.
Overflow is not that case. At overflow the sequence has succeeded and `beginCommand` knows exactly
what happened — n answers taken, m tokens left — while `parseCommand`, re-reading the line under a
grammar the operator did not use, cannot know any of it. §5.10's "every rejection message must name
the specific slots involved" is the standard, and this is the same family as 0069-REVIEW's F3,
one step worse: F3 named a parameter the usage line did not show; this names a token that was fine.

Left for the implementer because it needs both a behaviour change and a test-expectation change:
`prompt.test.ts`'s "reports too many arguments with the parser's own message rather than a second
one" pins the current message on purpose. Replacing it with an assertion that the message names
`extra` at offset 18 **strengthens** what the test pins — but it is a §6.1 trigger-5 change and
belongs to the cycle that makes it, not to this review.

### F3 — `readResponse`'s refusal channel is a `string`, and the file predicts the step kind that breaks it. **NOT fixed; fix list item 3.**

`readResponse` returns `PromptValue | string`, and `respond` reads a refusal as `typeof read ===
"string"`. `PromptValue` is `number | PromptPoint` today, so this is sound. It stops being sound the
moment a step accepts text — and `usesNamedForm`'s own hazard note anticipates exactly that step
("the first `text`-accepting step would swallow `x=100` as an answer"). On that day every accepted
text answer is read as a refusal and the step re-prompts forever, with no type error to catch it:
widening `PromptValue` to include `string` makes the sentinel ambiguous rather than illegal.

The file contemplates the extension in one place and lays a trap for it in another, which is worth
fixing while it costs eight lines. A discriminated return (`{ok: true, value}` / `{ok: false,
reason}`) makes the widening a compile error instead of an infinite loop. No behaviour changes and
no test moves.

### F4 — a quoted token is silently accepted as a prompt answer. **NOT fixed; fix list item 4.**

```
circle "100,100" "20"   =>  OK {"kind":"circle","x":100,"y":100,"radius":20}
polygon "5" 0,0 20      =>  OK {"kind":"polygon","sides":5,…}
```

`beginCommand` passes `token.text` to `respond` and drops `token.quoted`. Everywhere else on this
line quoting decides type — D-071 clause 3 states it, `readPositionalValue` implements it, and
`usesNamedForm` two functions away reads `token.quoted` deliberately. Here the one bit that decides
type is discarded.

Nothing is harmed today: a quoted point still yields the point the operator meant. It is listed
because it is a silent inconsistency in a file whose neighbours are explicit about the same bit,
and because "quoting decides type" is a rule the operator is being taught elsewhere. Either refuse
a quoted answer or write down why a prompt step is the exception. Either is one line plus a test;
the choice is the implementer's.

### F5 — `tokens[formulaAt]` indexes raw tokens by a positional index. **FIXED (hazard note only).**

```ts
const formulaAt = spec.positional.findIndex((p) => p.kind === "literal-or-formula");
const formulaToken = formulaAt >= 0 ? tokens[formulaAt] : undefined;
```

`tokens` is the undistributed list — positionals, `key=value` tokens and flags interleaved —
while `formulaAt` is an index into `spec.positional`. The two coincide only because `set` is the
sole `literal-or-formula` command and declares no named parameters and no flags. Correct today,
silently wrong for the first command that declares a formula position alongside `key=value`
arguments, which is precisely the "adding a command is one registry entry" path D-072 clause 2
keeps open.

No behaviour is wrong, so this gets a hazard note rather than a restructure — six comment lines
naming the coupling and the fix (distribute first, locate the formula in `positionalTokens`).
Applied; both typecheck configs clean and 874/874 still pass.

### F6 — `STATUS.md` says `parser.ts`'s header is 65 lines. It is 69. **FIXED in the STATUS rewrite.**

Small, but `STATUS.md` is the orientation document and the header budget is a live question the
human is being asked to rule on. The number moved when this cycle added two `NOT DONE HERE`
bullets. `prompt.ts`'s 52 is reported accurately.

## 5. The survived mutant — ruled: KEEP `usesNamedForm`

Entry 0070 disclosed that neutralising `usesNamedForm` to `return false` breaks no test, because
`circle x=100 y=100 r=20` then reaches `parseCommand` through the "a token the sequence could not
read" fallback instead of by being routed there. It invited a reviewer to delete the guard and the
note together. **Reproduced — the mutant survives, 98/98 still pass — and the answer is keep it.**

The reasoning in the log is right and F1 makes it stronger. The fallback holds only while no prompt
step accepts arbitrary text, and F3 shows the file already expects that step to arrive. More
immediately: fix-list item 1 moves when tokenization happens, which is exactly the kind of change
that would quietly convert "routed on purpose" into "no longer works." A four-line predicate that
makes §5.10's documented form independent of an accident is worth its four lines. The hazard note
stays as written; it is a good one.

This is the second useful thing the mutation check produced in two cycles, and the log's account of
its own broken detector — seven-for-seven survival caught by implausibility, not by the script —
is the most valuable paragraph in the entry.

## 6. Open questions

- **Q-013 — ANSWERED → D-071**, correctly reconciled. `grep PROVISIONAL(Q-013)` over `src/` returns
  nothing; the only surviving mention is a `describe` block naming the ruling, which is right.
  `OPEN_QUESTIONS.md` marks it answered **in place** with the reviewer's superseded position kept
  and labelled, per §2. Handled exactly as the process asks.
- **Q-012 (world units vs screen pixels)** — untouched, still open, still deferred to the `style`
  slots cycle, still blocking `pan`'s grammar. Nothing this cycle reached it.
- **Q-008 (`-0`)** — untouched, open, blocking nothing. Confirmed `circle -0,-0 0` still reaches the
  command object with `-0` intact, which is option (a) working as written.
- **Q-001/Q-002 (ANSWERED → D-041/D-040)** — still owed reconciliation at `commands.ts`, unchanged.
- **No new question raised, and none was needed.** Correct: F1 is a defect against a ruling that
  already exists, not an ambiguity in it.
- **Next free: Q-014.**

## 7. Legibility audit

Headers present on both files and both state layer, allowed imports, and brief section. Vocabulary
is locked — *slot*, *literal*, *formula*, *derived*, *address*, *object*, *mutation*, *preset* all
in the brief's senses; the one "property" in the diff is the English word in "the property D-068
protects," not a synonym for slot. No `any` anywhere. Comments are present-tense and D-060-clean:
no diary comments, no bare "this cycle," and every `(D-0XX)` supplements a stated reason rather
than substituting for one. Tests are behaviour sentences and most name the clause they defend.
Every `switch` on a union closes with the house `const exhaustive: never` idiom, including the two
new ones in `readResponse`.

`prompt.ts`'s header is 52 lines against §5.2's 20-40. Reviewed line by line: five invariants,
three deferrals each naming an owner, one hazard about world points. It is keep-always material
under §5.2's own list and it is shorter than `parser.ts`'s 69. **Third data point** after entries
0065 and 0069-REVIEW that a subsystem file cannot state its contract in 40 lines here. The
recommendation is unchanged and still the human's: amend the budget to ~60-70 for a
first-of-subsystem file, or say the material should be cut and which.

`STATUS.md` was 167 lines against §2's "< 150", up from 162. It did its job — it oriented this
review with no trip into `entries/`, which is the only test §2 sets it. Rewritten here at **156**:
the fix list added six lines and a compression pass took out seventeen. Still over, and I am not
going to pretend otherwise having just criticised the overrun — what remains is pointers rather than
prose, and cutting further would start deleting the thing the file exists to carry. Same budget
question as the header, and the same answer: it wants amending, and that is the human's call.

## 8. Honesty audit

Re-run, not read:

```
$ npx tsc --noEmit                          exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json  exit 0, no output
$ npx vitest run                            22 files, 874 passed (874), 0 skipped
$ grep -rnE "\.only\(|\.skip\(|it\.todo|describe\.todo" src/    no output
```

**Every number in the log is real.** 874 = 837 + 32 + 5 reconciles. The diffstat matches the claimed
~962 lines / 5 files (`git show --numstat`: 332 + 250 + 239/26 + 46/13).

**The mutation table was re-run, not read.** Four of its seven rows spot-checked with an
ANSI-stripped detector, against `src/command/` (98 tests):

| Neutralised | Log claims | Observed |
| --- | --- | --- |
| `usesNamedForm` → `false` | SURVIVED | **survived**, 98/98 |
| `rect`'s `min`/`abs` | caught, both `rect` tests | **2 failed** |
| formula source re-joined from tokens | caught, 1 named test | **1 failed** |
| `Math.hypot` → `0` | caught, 5 tests | **5 failed** |

Every count matches, including the survivor. Tree restored and re-verified green after each.

Scope matches the diff with no expansion: nothing outside `command/` was touched, and every carried
known problem in `STATUS.md` is still there untouched, as the entry says. The two changed test
expectations are the two declared — the `set` usage string and `circle =1`'s keyless-pair message —
and both **strengthen** what is pinned: the Q-013 block went from 3 tests pinning a provisional
refusal to 7 pinning the ruled behaviour. No test was weakened, skipped or deleted.

Process artifacts are handled correctly: `DECISIONS.md` is purely additive, no past entry was
modified, and Phase 3's criterion is explicitly **not** claimed — correctly, since nothing executes
a `Command` and no pixel has come from one.

The entry's "Where I got stuck" is six honest items, and its process note putting the role deviation
first is the right instinct. **What it does not contain is F1 or F2** — both in the surface this
cycle built, and F1 against a ruling the same cycle wrote down. That is what the missing independent
eye cost, and it is a good argument for the role split rather than against the cycle.

## 9. Edits made at this review

1. `src/command/parser.ts` — six comment lines above `formulaAt` naming the raw-token/positional-
   index coupling and its fix (F5). No executable line changed.
2. `claude/DECISIONS.md` — **D-073** (formula source is never subject to command-line tokenization).
3. `claude/STATUS.md` — rewritten: the verdict, the fix list, `parser.ts`'s header at 69 (F6).

Nothing was rewritten. No test added, weakened, skipped or deleted — F1's and F2's tests belong to
the cycle that changes the behaviour, and F5 changed no behaviour to test.

## 10. Fix list

**Item 1 is due before `commands.ts` calls `parseFormula`; the rest may ride along with it.**

1. **Stop the command lexer at the formula's `=` (F1, D-073).** `parseCommand` tokenizes the head,
   finds the spec, and — where the spec declares a `literal-or-formula` positional whose token
   begins with an unquoted `=` — takes the remainder of the line raw without tokenizing it. Tests:
   `CONCAT("a", "b")`, `IF(t.c > 1, "big", "small")` and `LEN("hello") > 3` all reach `commands.ts`
   as source, and 0069-REVIEW's F1 guard still rejects `delete "a"force`.
2. **Name the overflow token, not the first one (F2).** `beginCommand`'s "more tokens than the
   sequence takes" branch reports the first extra token and its offset instead of deferring to
   `parseCommand`. The "could not read a token" branch keeps deferring — that one is right.
   `prompt.test.ts`'s "reports too many arguments…" expectation moves with it, strengthened.
3. **Make the refusal channel a discriminated result (F3).** `readResponse` returns
   `{ok: true, value} | {ok: false, reason}` so that adding a `text` accept kind is a compile error
   rather than an infinite re-prompt. No behaviour change, no test moves.
4. **Decide what a quoted prompt answer means (F4).** Refuse it, or write down why a prompt step is
   the one place quoting does not decide type. One line plus a test either way.
5. **Carried, unchanged and still owed:** each `usage` string spelling the parameter names its
   arity errors report (0069-REVIEW F3, sixteen strings, one pass) · `parser.ts`'s header citing
   D-069 and dropping the ~10 lines that restate it (0069-REVIEW fix 1) · an end-to-end test
   through a table-creation command · the thirteen bare "this cycle" sites and two stale claims in
   test files · `render/slots.ts` at the THIRD consumer of `readNumber`/`asPointArray` ·
   `.gitattributes`.

## 11. Where Phase 3 stands, and the next slice

`render/` is complete and reviewed. `command/parser.ts` and `command/prompt.ts` are now reviewed,
subject to the fix list. **`command/commands.ts` is still the next slice** and its debts are
unchanged from 0069-REVIEW §11 — D-040/D-041 reconciled not re-decided, D-070's bounds, D-069's
boundary, D-071 clause 4's one shared slot-writing path, and `TABLE_SCHEMA`'s `origin.x`/`origin.y`
pair — **plus fix-list item 1, which must land first or beside it**, because that cycle is where
`source` is first handed to `parseFormula` and where D-038's four conditions come due.

Then `main.ts`: ONE clamped camera to all three of `renderDocument`, `hitTest` and
`pointerDown`/`pointerMove` (D-062); reset the canvas transform before screen-space chrome; and the
switch D-072 creates — **a canvas click during a live prompt sequence is a `picked` response, not a
selection**, with screen→world done by `camera.ts` before it reaches `command/`.

Phase 3's criterion is correctly not claimed and cannot be until both land.

## 12. Verdict

**REVISE.**

The engineering here is good and the log is the most honest kind: it discloses a role deviation
first, reports itself over the line cap rather than rounding to fit, records a mutation checker
that was silently certifying everything, and asks a reviewer to delete code it could not justify
with a test. `EQUIVALENT_FORMS` pins D-072 clause 3 the right way. `PendingCommand` gets the
serializability invariant right in the place it is easiest to lose. Rule 1 is upheld one layer out
from where it binds, deliberately, and the deferrals are all declared with owners.

REVISE rather than ACCEPT WITH EDITS for two reasons. F1 is a defect against D-071 clause 1's
purpose, written by the same cycle that wrote the clause, and it makes a §5.3 capability
untypeable on a rule the operator cannot infer — and its fix moves the parse entry point's
structure, which is not a reviewer's edit to make. F2 needs a behaviour change and a test
expectation to move with it. Neither is a regression and both are bounded; the tree stays green
in the meantime.

The cycle's own process note called it: this is what the missing second pair of eyes was for. Both
findings sit in the surface the cycle built, one of them against its own ruling, and neither is in
a "stuck" section that is otherwise unusually thorough. The role split earned its keep here — and
the next cycle should go back to an implementer, as the entry itself recommends.

One ruling issued (D-073). One edit made (F5). The survived mutant is ruled: keep it.
