# 0074 — REVIEW (phase 3)
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0073-correction-review-verdict   Reviewing: entries 0072 (0071-REVIEW's fix list,
items 1–4) and 0073 (verdict correction, documentation only)
Trigger: §6.1 item 5, fired by entry 0072's replacement of `prompt.test.ts`'s "reports too many
arguments" expectation — mis-stated as `RECOMMENDED` at 0072 and corrected to `REQUIRED` at 0073.
Entry 0073's reading of the trigger is right; see §6 below.

Diff reviewed: `1fdb4f0`, `c85b8b1` — `src/command/parser.ts` (+155/-87), `src/command/parser.test.ts`
(+39), `src/command/prompt.ts` (+95/-29), `src/command/prompt.test.ts` (+38/-4), plus `STATUS.md` and
the two entries. 4 source files, 447 lines. **Matches the log exactly** (`git show --numstat`:
39 + 155/87 + 38/4 + 95/29 = 447).

Verdict: **ACCEPT WITH EDITS.** All four fix-list items landed and every one is proven. One ruling
issued (D-074), one edit made (a registry-invariant test). Six findings, none a regression, none
blocking `commands.ts`. The largest — F1 — is a defect in **my predecessor's ruling**, not in this
cycle's work: entry 0072 was told to keep the branch that carries it, and did.

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld, checked mechanically. A grep for `window`, `globalThis`,
  `document.createElement|getElementById|querySelector`, `CanvasRenderingContext2D`, `HTMLCanvas`
  and any `render/` import across `src/engine/` and `src/command/` returns **header text only** (plus
  one `geometry.ts` comment naming Canvas2D's rect convention). `prompt.ts` still imports exactly one
  module (`./parser.ts`); `parser.ts` still imports exactly one (`engine/primitives/table.ts`). No
  canvas fake anywhere in the new tests. D-073's fix widened neither import list.
- **Rule 2 (mutation-only state change)** — not touched. Nothing here reaches graph state.
- **Rule 3 (addressing)** — upheld by abstention. `set a.b = CONCAT("a", "b")` still carries
  `target: "a.b"` and the source verbatim; nothing resolves.
- **Rule 4 (one formula engine)** — upheld, and this is the cycle that had to earn it. The restructure
  moves *when* the command lexer stops; it does not read the formula. `parseFormula` is still not
  called here and no second scanner appeared. Probed: `set a.b = "unterminated` parses, carrying
  `= "unterminated` verbatim — the command layer has no opinion on a formula's quotes, which is
  D-073 clause 2 working.
- **Rule 5 (performance is a non-goal)** — upheld, and the restructure resisted the obvious
  temptation. `matchArguments`'s loop skips whitespace to peek, then hands `nextToken` the same
  offset to skip it again. Two scans of the same spaces, correct at this scale, and it is what makes
  the peek legible. Do not "fix" it.
- **Rule 6, Rule 7** — not touched. D-070's counts still pass through unbounded and still come due at
  `commands.ts`.

## 2. Invariant audit

Graph invariants not touched — nothing in this diff reaches the graph.

Two file-local ones re-probed rather than read:

- **Never throws** — held across `set = x`, `set a.b =`, `set a.b =   `, `set a.b c = d`,
  `notacommand "a`, `notacommand a"b`, `circle 100,100 a"b`, `""`, and every fix-list example.
- **No unbounded loop in the new lexer** — `nextToken` advances at least one character on every
  non-whitespace start and returns `token: undefined` at end of line; `matchArguments` and
  `tokenizeCommandLine` both break on that. Checked by reading, since a hang has no test shape.

## 3. Spec conformance — D-073, D-071, and F5's resolution

**D-073 is implemented, all three clauses.** Probed at the parse entry point and one layer up:

```
set a.b = CONCAT("a", "b")              OK   source: '= CONCAT("a", "b")'
set a.b = IF(t.c > 1, "big", "small")   OK   source: '= IF(t.c > 1, "big", "small")'
set a.b = LEN("hello") > 3              OK   source: '= LEN("hello") > 3'
set a.b =CONCAT("a","b")                OK   source: '=CONCAT("a","b")'
set a.b = ((( not a formula             OK   source: '= ((( not a formula'   (clause 3: still opaque)
set a.b =                               FAIL@9  "set" needs a formula after "=" (clause 3: arity, the one allowed rejection)
set a"b = CONCAT("x")                   FAIL@5  a quote must open an argument (0069-REVIEW F1 intact BEFORE the `=`)
delete "a"force                         FAIL@10 a quoted argument ends at its closing quote
beginCommand('set a.b = CONCAT("a", "b")')  OK — the entry point a typed line actually uses
```

**D-071 clause 3 holds:** `set a.b "=x"` writes the string `=x`, and the quoted case is exempted from
the stray-`=` guard explicitly rather than by accident.

**0071-REVIEW F5 is genuinely resolved, not papered over.** The hazard was `tokens[formulaAt]` indexing
a raw token list by a positional index. The new test is `positionalTokens.length === formulaAt` — the
distributed count — which is exactly the fix the hazard note asked for. Traced by hand against a
hypothetical spec declaring a formula position *alongside* `key=value` and a flag: `cmd x k=1 = 2+2`
reaches the `=` with `positionalTokens.length === 1 === formulaAt` and slices correctly, because
named tokens and flags `continue` without incrementing the positional count. Replacing the comment
rather than leaving it standing is D-065 applied correctly and the entry says why.

Everything else in §5.10 is unchanged and still pinned by its own tests.

## 4. Findings

### F1 — the "a token the sequence could not read" branch reproduces 0071-REVIEW F2 verbatim, on the more common path. **NOT fixed; fix list item 1. Ruled as D-074.**

Entry 0072 fixed the overflow branch exactly as instructed:

```
circle 100,100 20 extra   =>  '"circle" does not take the argument "extra" — …'   start: 18   ✅
```

The branch two lines below it was left as 0071-REVIEW ruled it should be, and it does this:

```
circle 100,100 abc   =>  '"circle" does not take the argument "100,100" — …'   start: 7
rect 0,0 junk        =>  '"rect" does not take the argument "0,0" — …'         start: 5
table 0,0 abc        =>  '"table" does not take the argument "0,0" — …'        start: 6
polygon 5 0,0 abc    =>  '"polygon" does not take the argument "5" — …'        start: 8
```

All three of F2's own complaints, intact: **a token that was read correctly**, **the wrong offset**,
**the usage line for a form the operator did not use.** And the message it replaces is right there —
`respond` had already produced `specify radius needs a number or a point as x,y — got "abc"`, naming
the step and the token, and `beginCommand` throws it away.

0071-REVIEW's stated reason for keeping this branch was that "`parseCommand` produces the better
message and writing a second one would be duplication." **That reason is false, and the registry says
why:** all four prompting commands declare `positional: []`, so `parseCommand`, re-reading the line
under the `key=value` grammar, has nothing to match a bare positional against and always emits "does
not take the argument" naming the FIRST one. It cannot produce a better message on this path. It
cannot produce a correct one.

The rarer path got fixed and the common one did not, because the review only probed the rare one —
the same asymmetry that cost 0071-REVIEW F1 and F2 in the first place, one review later. That is
mine, not entry 0072's: the implementer was told this branch was right and left it alone, which is
what §4's "NEVER refactor code you did not write in this batch unless a review verdict instructed it"
asks for.

**Ruled D-074** rather than fixed here for two reasons. It is the third appearance of the same defect
shape (0069-REVIEW F3 named a parameter the usage line did not show; 0071-REVIEW F2 named a token
that was fine; this names a token that was fine, on a different branch) — §8 says a recurring
misunderstanding becomes a ruling, not a third code fix. And the change needs its own tests.

**No test pins the current behaviour** — probed by making the change (`return {status:"failed",
message: session.error, start: token.start}`) and running the suite: **106/106 still passed**, both
typechecks clean. So this is additive and fires no §6.1 trigger 5. Tree restored.

### F2 — `beginCommand`'s D-073 guarantee rests on a registry property nothing enforced. **FIXED (test added).**

`beginCommand` tokenizes the whole rest of the line as soon as it knows the command declares
`prompts`, and that is only safe because no prompting command declares a `literal-or-formula`
position. The function comment says so; the file header says so; the registry is free to contradict
both in one entry, which is exactly the "adding a command is one registry entry" path D-072 clause 2
keeps open.

This is F5's shape again — an assumption true only of today's registry — created one layer up in the
same cycle that resolved F5 one layer down. It is worth a test rather than a hazard note because
`prompt.test.ts` already carries two assertions of precisely this form (every command with `prompts`
has an `EQUIVALENT_FORMS` entry; `prompts` and `buildFromPrompts` are declared together), so the
idiom cost nothing to extend.

Added, in that block. **Mutation-checked, and the checker checked:** giving `table` a
`literal-or-formula` position makes the new test one of 5 failures; without the mutant, 107/107 pass
in `src/command/`. Tree restored.

### F3 — entry 0072 says F4's replay loop "was the only site discarding the [`quoted`] bit". It is not. **NOT fixed; fix list item 3.**

```
parseCommand('"list"')               =>  OK {"kind":"list"}
parseCommand('"delete" a')           =>  OK {"kind":"delete","target":"a","force":false}
parseCommand('"SET" a.b 1')          =>  OK {"kind":"set","target":"a.b","value":1}
beginCommand('"circle" 100,100 20')  =>  OK {"kind":"circle","x":100,"y":100,"radius":20}
```

The command WORD is read as `head.text` with `head.quoted` dropped, in both `parseCommand` and
`beginCommand`. Harmless today — a quoted command word is a typo, not an exploit — but the claim is
not harmless in a cycle whose entire subject was a dropped `quoted` bit, and it is the kind of
sentence a later cycle will trust instead of grepping. Pre-existing behaviour, so it is not a
regression; the overclaim is this cycle's. Either refuse a quoted head word (one line, matching
F4's own resolution: "quoting decides type everywhere on this line") or say in the header why the
command word is the exception.

### F4 — two behaviour changes fell out of the restructure and neither is in the log. **NOT fixed; fix list item 4.**

**(a) A lexical error after an unknown or unbuilt command word is no longer reported.** `parseCommand`
used to tokenize the whole line before the registry lookup; it now reads the head word only.

```
notacommand "a   before: 'unterminated quoted value — add a closing quote'   now: 'unknown command "notacommand"'
polyline "a      before: 'unterminated quoted value'                         now: '"polyline" is a §5.10 command that is not built yet'
```

**(b) The stray-`=` guard moved from a pre-pass over all tokens into the token loop**, so it no longer
pre-empts an earlier problem: `zoom 1 2 =3` now reports `does not take the argument "2"` at offset 7
where it used to report `"zoom" takes no formula` at offset 9.

Both changes are, in my reading, **improvements** — (a) names the thing the operator actually got
wrong, (b) reports problems in line order — and neither should be reverted. They are listed because
§5's honesty audit hunts for silent scope expansion, and a restructuring cycle that changes two
user-visible messages owes them a line in its own log. Owed: a sentence each in the next entry, and a
test for (a), which is the one a future cycle could regress without noticing.

### F5 — the overflow message still cites the `key=value` usage line. **NOT fixed; fix list item 2 (folded into D-074 clause 3).**

```
circle 100,100 20 extra  =>  '… — usage: circle x=<number> y=<number> r=<number>'
```

The operator used the prompt form. This is the third of F2's three complaints; fix-list item 2 named
only the token and the offset, so the fix delivered only those — correctly, against the text it was
given. A prompting command has two forms and one `usage` string, and nothing in the registry spells
the positional one. Same family as the carried 0069-REVIEW F3 debt (usage strings vs. the parameter
names their errors report), and it should land in that same one-pass sweep.

### F6 — `set = x` tells the operator that `set` takes no formula. **NOT fixed; fix list item 5.**

```
set = x  =>  FAIL@4: "set" takes no formula — only "set <address> = <formula>" does (D-071)
```

Self-contradictory, and `set` is the **only** command that can reach this guard with a
`literal-or-formula` position declared — the guard is written for the fifteen commands that are not
`set`. The operator's actual mistake is that the address comes before the `=`. Pre-existing (the old
code reached the same message by a different route, so this is not a regression), one line, no test
pins it.

## 5. Legibility audit

Headers present on both files, both stating layer, allowed imports and brief section, both
present-tense and D-060-clean. No `any` in `src/command/`. No diary comments and no bare "this cycle"
in either file. Vocabulary locked. Every union `switch` still closes with the house `const
exhaustive: never` idiom, including both in `readResponse` after F3's rewrite. Tests are behaviour
sentences naming the finding or clause they defend.

The new comments are the good kind. `nextToken`'s doc says *why* it is called one token at a time —
"reading it to find that out would be the defect D-073 rules against, reached from inside the fix
instead of around it" — which is the reason, not the pointer. `matchArguments`'s D-073 comment
explains the distributed-count fix in place of F5's hazard note. `tokenizeCommandLine`'s `startIndex`
comment says why offsets stay absolute rather than that they do.

**Header budget:** `parser.ts` **76** (was 69), `prompt.ts` **62** (was 52). Both grew by real
invariants, both sit inside the ~60–70 range three consecutive reviews have recommended. I counted
the whole tree this time rather than repeating the claim: **21 of 23 non-test source files are over
§5.2's 40-line ordinary budget**, six are over the 80-line load-bearing allowance, and `mutation.ts`
is at 151. The budget is not being missed by these two files; it is being missed by the codebase,
which is the fourth data point and the one that should settle it. **Still the human's call**, and the
recommendation is unchanged: amend §5.2 to 20–40 ordinary / ~80 first-of-subsystem / ~150
load-bearing, or say which material should be cut.

## 6. Honesty audit — entries 0072 and 0073

Re-run, not read:

```
$ npx tsc --noEmit                          exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json  exit 0, no output
$ npx vitest run                            22 files, 882 passed (882), 0 skipped   [883 after this review's edit]
$ grep -rnE "\.only\(|\.skip\(|it\.todo|describe\.todo" src/    no output
$ git status --short                        clean
```

**Every number in entry 0072 is real**, including the diffstat (447 / 4, to the line).

**The mutation table was re-run, not read — all four rows, ANSI-stripped, against `src/command/`
(106 tests):**

| Neutralised | Log claims | Observed |
| --- | --- | --- |
| `matchArguments`'s formula shortcut → `false && …` | 10 failed | **10 failed** |
| `overflow(spec, token)` → `fromParse(line)` | 1 failed | **1 failed** |
| `token.quoted` guard → `false && …` | 2 failed | **2 failed** |
| `beginCommand`'s head-first read → whole-line pre-tokenize | 1 failed | **1 failed** |

Every count matches. Tree restored and re-verified green after each.

**Scope matches the diff.** Nothing outside `command/` was touched; `DECISIONS.md` was not written to
by the implementer; `entries/` is append-only and no past entry was modified; Phase 3's criterion is
correctly not claimed. The one scope expansion beyond the fix list's literal text — fixing
`beginCommand`'s own D-073 defect — is **disclosed in its own "Decisions I made" paragraph, with the
reasoning**, and was the right call: item 1's fix would otherwise have been unreachable through the
entry point a typed line actually uses. That is the model of how to expand scope.

**Entry 0073 is correct and its reasoning is better than the entry it corrects.** Trigger 5 did fire;
`RECOMMENDED` was hedging; the distinction it draws — a review may authorise the *change* without
exempting the cycle from the *trigger* the change fires — is right, and citing D-021's own
reconciliation note for it is exactly the kind of precedent-finding this log is for. Documentation
only, no code touched, `git diff --numstat` confirms (`STATUS.md` and the entry).

**Two things the log gets wrong**, both small and both above: F3's "only site" claim, and F4's two
undisclosed message changes. Neither is optimistic completion reporting — the "stuck" section is
honest about the header budget getting worse rather than better, which is the section models most
often flatter themselves in.

## 7. Open questions

- **Q-012 (world units vs screen pixels)** — untouched, open, still deferred to the `style`-slots
  cycle, still blocking `pan`'s grammar.
- **Q-008 (`-0`)** — untouched, open, blocking nothing.
- **Q-001/Q-002 (ANSWERED → D-041/D-040)** — still owed reconciliation at `commands.ts`, unchanged.
- **Q-013 → D-071** — reconciled at entry 0070, still clean: `grep PROVISIONAL(Q-013)` over `src/`
  returns nothing. Live `PROVISIONAL` tags are Q-008 (`graph/node.ts`) and Q-012 (`render/renderer.ts`)
  and no others, matching `STATUS.md`.
- **No new question raised by entry 0072, and none was needed.** Correct: F1 is a defect against a
  ruling, not an ambiguity in one. The same is true of everything in §4 above — hence D-074 rather
  than a Q. **Next free: Q-014.**

## 8. Edits made at this review

1. `src/command/prompt.test.ts` — one test in the existing registry-coverage block: no command
   declaring `prompts` may declare a `literal-or-formula` position (F2). Mutation-checked. 883/883,
   both typechecks clean.
2. `claude/DECISIONS.md` — **D-074** (a prompt sequence's own refusal is the message), which
   supersedes the half of 0071-REVIEW F2 that ruled the deferral branch correct.
3. `claude/STATUS.md` — rewritten: this verdict, the new fix list, the header-budget count corrected
   from "ten others over" to 21 of 23, and the carried "thirteen bare 'this cycle' sites" corrected to
   **twelve** (10 in `mutation.test.ts`, 1 each in `ast.test.ts` and `schema.test.ts`).

   On its own length: it stood at **172** lines against §2's "< 150", up from the 156 the last review
   left, and neither cycle that grew it said so. Rewritten here at **169** — three lines, which is
   not a fix. I aimed at 150 and did not get there, and I am not going to round the number or claim
   the pass succeeded: what is left is almost entirely pointers, and the next twenty lines I could
   cut are all things a cold reader needs. That makes it the same standing request as the header
   budget, from the same evidence, and it wants the human's answer rather than a fourth review
   trimming prose off it.

No source behaviour was changed at this review. No test was weakened, skipped or deleted.

## 9. Fix list

**None of it blocks `commands.ts`.** Item 1 is the one with a ruling behind it; the rest may ride
along with whichever cycle next opens these two files.

1. **Report a refused answer with the sequence's own message (F1, D-074).** `beginCommand`'s "a token
   the sequence could not read" branch returns `session.error` at the offending token's offset instead
   of `fromParse(line)`; the quoted-answer branch does the same, saying that quoting is what refused
   it. `usesNamedForm` and the two pre-sequence deferrals stay exactly as they are — D-074 clause 2.
   The two F4 tests' expectations move with it and **strengthen** (they currently assert a message
   written by the wrong grammar that happens to name the right token). Note the payoff: this makes
   `usesNamedForm` load-bearing, so entry 0070's survived mutant becomes a caught one and that known
   problem closes.
2. **Give a prompting command a usage line for the form it was used in (F5, D-074 clause 3).** Fold
   into the carried 0069-REVIEW F3 sweep over all sixteen `usage` strings — one pass, not two.
3. **Decide what a quoted command WORD means (F3), and correct entry 0072's claim in the next entry.**
   Refuse it, or write down why the command word is the one place quoting does not decide.
4. **Disclose F4's two message changes**, and add a test for (a) — a lexical error after an unknown
   command word is now reported as the unknown command.
5. **Fix `set = x`'s message (F6).** The stray-`=` guard should say the address comes before the `=`
   when the spec declares a `literal-or-formula` position.
6. **Carried, unchanged and still owed:** `parser.ts`'s header citing D-069 and dropping the ~10 lines
   that restate it (0069-REVIEW fix 1) · an end-to-end test through a table-creation command · the
   twelve bare "this cycle" sites and two stale claims in test files · `render/slots.ts` at the THIRD
   consumer of `readNumber`/`asPointArray` · `.gitattributes`.

## 10. Where Phase 3 stands, and the next slice

`render/` is complete and reviewed. `command/parser.ts` and `command/prompt.ts` are now reviewed
through their fix-list work, and **D-073 is fully discharged** — the reason item 1 of the last fix
list had to land before `commands.ts` is gone.

**`command/commands.ts` is the next slice**, and its debts are unchanged from 0069- and 0071-REVIEW
§11: D-040/D-041 reconciled not re-decided · D-070's bounds on `sides`/`rows`/`cols` before an
`Operation` is built · D-069's boundary (the only place a `Command` meets a `Document`) · D-071
clause 4's ONE shared slot-writing path, where D-038's four conditions come due · `TABLE_SCHEMA`'s
`origin.x`/`origin.y` pair at the paths `renderer`/`hittest`/`interaction` already read.

Then `main.ts`: ONE clamped camera to `renderDocument`, `hitTest` and `pointerDown`/`pointerMove`
(D-062); reset the canvas transform before screen-space chrome; and D-072's switch — a canvas click
during a live prompt sequence is a `picked` response, not a selection — with screen→world done by
`camera.ts` before it reaches `command/`.

Phase 3's criterion is correctly not claimed and cannot be until both land.

## 11. Verdict

**ACCEPT WITH EDITS.**

Entry 0072 was handed four numbered items and delivered four, each proven by a mutation this review
could reproduce to the count. It found a fifth defect the review had missed — `beginCommand`'s own
whole-line pre-tokenize, without which item 1's fix would have been dead code behind the real entry
point — and disclosed the scope expansion rather than folding it in. It resolved F5's hazard by
restructuring instead of by rewording it, and replaced the comment, which is D-065 applied without
being told to. It reported its own header budget getting worse. Entry 0073 then corrected its own
verdict on evidence it already had, and reasoned about the trigger better than the entry it fixed.

The findings above are real and none of them is that. F1 is my predecessor's ruling failing on a path
it did not probe; the implementer obeyed it, which is what §4 asks. F2 is a latent registry
assumption, now pinned. F3 and F4 are three sentences the next entry owes. F5 and F6 are message
polish with owners.

REVISE would say the work needs redoing. It does not: the tree is green, 883/883, both typechecks
clean, the diff matches the log to the line, and `commands.ts` can start on top of this parser
without waiting for any of it.

One ruling issued (D-074). One edit made (F2's test). D-073 is discharged.
