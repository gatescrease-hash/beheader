# 0072 — 0071-REVIEW's fix list, items 1–4
Date: 2026-08-25   Phase: 3   Model: Claude Sonnet 5 (implementer)
Previous entry: 0071-REVIEW-phase3   Last review: 0071-REVIEW-phase3 (verdict: REVISE)
Batch: cycle 1 of up to 3 since last review; ~447 lines / 4 files changed so far.

## Declared scope

Close out 0071-REVIEW-phase3 §10's fix list, items 1–4, confined to `command/parser.ts` and
`command/prompt.ts`: stop the command lexer at a formula's `=` (D-073, item 1); name the surplus
token on prompt-sequence overflow instead of the first one (F2, item 2); make `readResponse`'s
refusal channel a discriminated result (F3, item 3); refuse a quoted prompt answer instead of
silently reinterpreting it (F4, item 4).

## Explicitly not in scope

`command/commands.ts` (the next slice — item 1 was due before or beside it, and now has). Item 5's
carried debt (`usage` strings vs arity-error parameter names, `parser.ts`'s header restating D-069,
an end-to-end table-creation test, the thirteen bare "this cycle" test comments, `.gitattributes`) —
untouched, still listed in `STATUS.md`. `TABLE_SCHEMA`'s `origin.x`/`origin.y`, D-070's bounds,
D-040/D-041's reconciliation, D-071 clause 4's shared slot-writing path — all `commands.ts`'s.

## What I did

**`src/command/parser.ts`** (§5.10's parsing half; D-073).

- Replaced `tokenize(line)` — which tokenized the WHOLE line before `matchArguments` ever learned
  there was a formula in it — with `nextToken(line, index)`, reading exactly one token (skipping
  leading whitespace) per call. `parseCommand` calls it once for the command word;
  `matchArguments` calls it in a loop, one token at a time, from `line` and a start offset rather
  than from a pre-built array.
- `matchArguments` now decides "the rest of the line is a formula" from a single PEEKED character
  — before `nextToken` ever runs on that token — the moment the position about to be filled is the
  spec's `literal-or-formula` one and the character there is an unquoted `=`. Everything from that
  character to end of line is sliced and carried as the formula source, and NOTHING past it is
  tokenized, quote-checked, or scanned (D-073's binding text, verbatim). `CONCAT("a", "b")`,
  `IF(t.c > 1, "big", "small")` and `LEN("hello") > 3` all now reach `commands.ts` as source; the
  0069-REVIEW F1 guard (a closing quote must be followed by whitespace) is untouched and still
  applies to everything BEFORE the `=`.
- `tokenizeCommandLine` gained an optional `startIndex` parameter (default 0), built on `nextToken`
  in a loop, so a caller tokenizing "the rest of a line" gets tokens with ABSOLUTE offsets rather
  than having to re-slice the string and get offsets relative to the slice. A new export,
  `readCommandHead`, reads only the first token — see `prompt.ts` below.
- The header gained one INVARIANTS bullet stating D-073 in the file's own words.

**`src/command/prompt.ts`** (D-072's prompt sequences).

- `beginCommand` had the IDENTICAL D-073 defect one layer up, unreached by 0071-REVIEW's probes
  because they exercised `parseCommand` directly: it called `tokenizeCommandLine(line)` on the
  WHOLE line before ever checking whether the command has a `prompts` entry. `set` — the one
  command with a `literal-or-formula` position — declares no `prompts` and always falls through to
  `parseCommand`, but `beginCommand`'s own pre-tokenize ran FIRST and choked on the formula's
  embedded quotes before ever reaching that fallback. Fixed by reading only the head word
  (`readCommandHead`) before deciding routing, and tokenizing the remainder (via
  `tokenizeCommandLine(line, headScan.next)`, keeping offsets absolute) only for commands that
  declare `prompts` — none of which have a formula position, so there is nothing to protect there.
- **F2**: the "more tokens than the sequence takes" branch now calls a new `overflow(spec, token)`
  naming the token directly at its own offset, rather than deferring to `parseCommand` — whose own
  grammar for a prompting command has no positionals to compare against, so it blamed the first
  token the sequence had already read CORRECTLY. The "a token the sequence could not read" branch
  is untouched and still defers, which the review confirmed is the right call for that case.
- **F3**: `readResponse` now returns `ResponseRead = {ok:true, value} | {ok:false, reason}` instead
  of `PromptValue | string`. `respond` reads `read.ok`/`read.reason`/`read.value` instead of
  `typeof read === "string"`. No behaviour changed; `distanceFrom` (a private helper only
  `readResponse` calls) still returns `number | string` internally and is lifted through a small
  `asRead` wrapper at both its call sites, since its own return type is narrow enough (always a
  `number` on success) not to carry the ambiguity a wider `PromptValue` would introduce.
- **F4**: a QUOTED token in `beginCommand`'s replay loop is now refused — deferred to `parseCommand`
  the same way an unreadable token is — rather than having `token.quoted` silently dropped when
  building the `{kind:"typed", text}` response. `PromptResponse` itself is unchanged: the only site
  discarding the bit was this loop, and a live single-answer prompt (driven by `main.ts`'s
  still-unbuilt input bar) doesn't exist yet to need it plumbed further.
- The header gained one INVARIANTS bullet for D-073 (one layer up) and one for F2/F4.

**`src/command/parser.test.ts`** — five new tests: the three F1 examples verbatim (`CONCAT`, `IF`,
`LEN`), a no-space-after-`=` case, and confirmation that quoting rules still apply to everything
BEFORE a formula's `=`.

**`src/command/prompt.test.ts`** — one new test pinning `beginCommand`'s own D-073 fix; the existing
"reports too many arguments" test replaced with one asserting the message names "extra" at its own
offset (F2, strengthened per the review's own instruction); two new tests pinning F4 (a quoted point,
a quoted number).

## Decisions I made

- **Fixed `beginCommand`'s own pre-tokenize even though 0071-REVIEW's fix list only names
  `parser.ts`.** The review's probes ran through `parseCommand` directly and never noticed
  `prompt.ts` carries the identical defect one layer up. Left unfixed, item 1's own fix would have
  been unreachable through the only real entry point a typed line has — D-072's own header says
  `beginCommand` "is the entry point for a typed line, not `parseCommand`." Squarely inside D-073's
  stated purpose; disclosed here as scope beyond the review's literal text rather than folded in
  silently.
- **Resolved 0071-REVIEW F5's hazard note rather than leaving it standing.** The restructuring that
  fixes D-073 — reading tokens one at a time and classifying as it goes — necessarily counts by
  `positionalTokens.length` (the DISTRIBUTED count), not a raw token index, which is exactly the
  fix the hazard comment asked for ("distribute first, locate the formula in `positionalTokens`").
  Replaced the six-line hazard comment with one describing the now-correct behaviour (D-065: a
  cycle owns every comment its own work makes false, including one describing a bug that no longer
  exists).
- **F4: refuse, don't document an exception.** D-071 clause 3 already makes "quoting decides type"
  a whole-line convention, and none of `point`/`distance`/`number` have any legitimate reading of a
  quoted value — silent acceptance read as an accidental hole once named, not a feature worth a
  hazard note.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, exit 0)
$ npx vitest run
 Test Files  22 passed (22)
      Tests  882 passed (882)
$ grep -rnE "\.only\(|\.skip\(|it\.todo|describe\.todo" src/
(no output)
```

**Mutation-checked, not just written**, each guard restored to green after:

| Neutralised | Expected | Observed |
| --- | --- | --- |
| `matchArguments`'s formula-shortcut (`&& false`) | 6 new/moved formula tests fail | **10 failed** (6 new + 4 pre-existing formula tests that depend on the same guard) |
| `beginCommand`'s own head-first read, reverted to whole-line `tokenizeCommandLine(line)` | the new `beginCommand`-formula test fails | **1 failed**, with the exact old symptom message |
| `overflow(spec, token)` reverted to `fromParse(line)` | the strengthened F2 test fails | **1 failed** — old message, naming "100,100" instead of "extra" |
| `token.quoted` check (`&& false`) | both F4 tests fail | **2 failed** — one silently accepted, one silently completed |

Tree restored and re-verified green (882/882) after each.

## Acceptance criteria status

Phase 3 criterion ("create a polygon and a table by command, see both drawn, pan/zoom, select, and
drag the polygon") — unchanged, NOT YET. Nothing in this cycle touches rendering, mutation, or
`commands.ts`; this is a parsing-layer fix list only. N/A to this cycle's own claim.

## Where I got stuck / what is unfinished

Nothing got stuck. Both typechecks clean, suite green, every new guard mutation-checked. Item 5's
carried debt is untouched, as declared. The header-line-budget question (§5.2's 20-40, still under
dispute per entries 0065/0069-REVIEW/0070/0071-REVIEW) is slightly worse, not better:
`parser.ts`'s header is now 76 lines (was 69), `prompt.ts`'s is now 62 (was 52) — both grew by
genuine new invariants (D-073's binding text, F2/F4's behaviour), not padding, and both stay inside
the ~60–70 range three consecutive reviews have recommended as the amended budget. I did not try to
cut elsewhere to compensate; that would mean deleting hazard notes or hard-earned invariants to hit
a number nobody has ratified yet.

## Open questions raised

None.

## Review point

Fired: none — no §6.1 trigger. Batch 1/3 since last review, diff ~447 lines / 4 files (cap 800/10).

**REVIEW: RECOMMENDED.** Reason: this restructures how the command lexer decides when to stop
tokenizing — not a small patch — and `command/commands.ts`, the very next slice, is where
`source` first reaches `parseFormula` for real (D-038's four conditions coming due). A second pair
of eyes on the restructuring before building on it matches the reasoning 0071-REVIEW itself gave
for why entry 0070 needed the review that produced this fix list.
