# 0069 — REVIEW (phase 3)
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0068-command-parser   Reviewing: entry 0068 (`command/parser.ts`)
Trigger: §6.1 item 2 — first file of the `command/` subsystem — **and** §6.3's diff cap
(~1103 lines in one cycle against ~800). Both fired; the log declared both.

Diff reviewed: `32f88b5` — `src/command/parser.ts` (new, 801 lines), `src/command/parser.test.ts`
(new, 284, 59 tests), comment-only edits to `src/main.ts` (+11/-8) and
`src/engine/primitives/table.ts` (+7/-6). 4 source files, ~1103 lines. **Matches the log exactly.**

Verdict: **ACCEPT WITH EDITS.** One real defect found and fixed (a silent misparse of
`delete "a"force`), one stale header line fixed, two rulings issued (D-069, D-070), Q-013 escalated
to the human with the reviewer's position recorded.

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld, checked mechanically. A grep for `document.`, `window.`,
  `canvas`, and `render/` imports across `src/engine/` returns comments and `Document`-object
  property reads only. `command/parser.ts` imports exactly one thing, `DEFAULT_TABLE_COLS`/
  `DEFAULT_TABLE_ROWS` from `engine/primitives/table.ts`, and nothing in `src/engine/` imports
  `command/`. The new layer sits on the correct side of every seam.
- **Rule 2 (mutation-only state change)** — not touched. The parser holds no state and writes none;
  it returns a fresh plain object per call.
- **Rule 3 (addressing is load-bearing)** — upheld, and the interesting one. See §3 and D-069.
- **Rule 4 (one formula engine)** — upheld by not being exercised: no second expression evaluator
  appears here, and the number/boolean/string forms are §5.3's own, deliberately (Decisions 4, 5).
- **Rule 5 (performance is a non-goal)** — upheld. `COMMAND_SPECS.find` is a linear scan over
  sixteen entries and should stay one.
- **Rule 6 (slot set fixed during evaluation)** — not touched here, but this cycle is what makes it
  reachable to break. See D-070.
- **Rule 7 (nothing from §8)** — upheld. Eight §5.10 commands are listed as unbuilt rather than
  invented, and no §8 item is approached. §8's "command-language gold-plating" bullet is discussed
  under Q-013 in §6; it does not bite here.

## 2. Invariant audit

The graph invariants (slot set fixed, derived slots inside the topological pass, eager/total
extraction, lazy evaluation, rollback bit-for-bit, no dangling edges) are **not touched** — nothing
in this diff reaches graph state, and that is the design (D-069).

Two file-local invariants were checked by probe rather than by reading:

- **"Never throws"** — held across every malformed line probed, including unterminated quotes, a
  trailing backslash inside a quoted run, an empty line, whitespace-only, and a 400-digit number.
- **"Graph state stays plain and serializable"** — `Command` objects are plain, `readonly`, and
  hold only `string`/`number`/`boolean`. The `build` closures in `COMMAND_SPECS` are **code, not
  state** — the same shape §5.3 explicitly asks of `functions.ts`'s registry — and no closure
  reaches a command object.

## 3. Spec conformance (§5.10), and the design question the log asked to have checked

**Decision 1 (the parser resolves nothing and takes no document) is CORRECT.** Ruled binding as
**D-069** so it stops being re-argued. The short form: §4's own structure table already says
`parser.ts` is "command string -> command object" and `commands.ts` is "command handlers ->
mutation API calls"; resolution is part of building the `Operation`, which is by that table the
handler's. §5.2's "resolve at parse time" is a statement about **stored ASTs** — its sentence ends
"stored ASTs hold IDs, not names" — and a command object is never stored. The implementer's own
sharpest argument is the one that settles it: resolving here would *split* resolution rather than
centralise it, because a creation command's fresh id comes from `nextObjectId`, in the document the
parser would still not have.

**Decision 2 (grammar here, identity there) is CORRECT** and folded into D-069. `set polygon_1 42`
and `rename polygon_1 3bad` parsing is the right behaviour, and the `address.ts` L-4 precedent is
cited accurately.

Registry checked against §5.10 line by line: all sixteen registered commands match the brief's own
example lines, argument for argument, and `parser.test.ts` pins each one against §5.10's literal
text. The eight absent commands are each blocked on a real missing thing. **`pan`'s absence is a
correct §6.1 trigger-3 disclosure**, not a gap: §5.10 writes `pan / zoom <factor> / fit` and gives
`pan` no argument grammar at all, so `pan <dx> <dy>` would have had to invent
world-units-vs-pixels, which is Q-012's. Leaving it out and saying why beats guessing.

Table-driven-ness is real, not claimed: there is no dispatch switch in the file, and adding a
command is one `CommandSpec` plus one `Command` arm, exactly as §5.10 asks.

## 4. Findings

### F1 — `delete "a"force` silently parses as `force: true`. **FIXED.**

The file states its own rule twice — a token is either a bare word or a WHOLE quoted string, and a
quote inside a bare word is rejected "rather than given shell-like concatenation semantics" — and
implemented it in one direction only. `a"b` was rejected. `"a"b` was not: `scanQuoted` returned and
the loop simply started a new token at the character after the closing quote.

For fifteen of the sixteen commands the extra token then produced a confusing but harmless
"does not take the argument" error. For `delete` it did not, because `delete` has a flag:

```
delete "a"force   =>  OK {"kind":"delete","target":"a","force":true}
delete "a"FORCE   =>  OK {"kind":"delete","target":"a","force":true}
```

That is §5.1.1's **repair path** — the one that rewrites other objects' references to `#REF` and is
not undoable through any UI this project will build — selected by a line the operator never wrote
as two words. The same concatenation the file refuses from one side, accepted and acted on from the
other, landing on the single most destructive flag in the system.

Fixed in `tokenize`: a closing quote must be followed by whitespace or the end of the line.

```ts
if (scanned.next < line.length && !isWhitespace(line[scanned.next])) {
  return failure("a quoted argument ends at its closing quote — separate arguments with a space", scanned.next);
}
```

Two tests added, named for the hazard rather than the mechanism, and the guard was mutation-checked
(neutralised to `if (false)`, both tests failed, restored, 61/61 green).

### F2 — `primitives/table.ts`'s header still said "a future table-creation command will read". **FIXED.**

D-065 makes a cycle own every comment its own work falsifies. Entry 0068 discharged this in the
same file at line 106 — the constants' doc comment now names `command/parser.ts` — but left the
FILE HEADER, 92 lines above, saying the constants are read by "a future table-creation command."
`command/parser.ts` imports them; it is not future. Two contradictory statements about the same two
constants in one file, with the false one in the position every reader lands on first, which is
exactly what D-060's present-tense rule exists to prevent. One line, corrected in place.

The log's claim to have swept for this is otherwise accurate: `document.ts:87`, `mutation.ts:147`,
`schema.ts:78`, `renderer.ts:33` and `graph/node.ts:185` were each re-checked here and are each
still true. `table.ts:370` ("no table-creation command exists yet to have written one") is also
still true as written — nothing has *written* a dimension slot — and should be left alone rather
than churned.

### F3 — an arity error names a parameter the usage line never shows. **NOT fixed; fix list item 2.**

```
link polygon_1.origin.x  =>  '"link" needs <source> — usage: link <address> <address>'
refs                     =>  '"refs" needs <target> — usage: refs <object|address>'
```

`<source>` and `<target>` are internal `PositionalParameter.name`s. Neither appears in the usage
line the same message prints, so the operator is told to supply a thing and then shown a grammar
that does not contain it. §5.10's "every rejection message must name the specific slots involved"
is the standard being missed at the one layer that has no slots to name, so naming the *position*
is what stands in for it — and the two halves must agree. The implementer noticed the adjacent
issue (log, "stuck" #4: usage strings are "doing documentation work the types are not") without
noticing that this makes the messages self-inconsistent. Left for the implementer: it is a pass
over sixteen `usage` strings, it is a judgement call how to spell them (`link <target> <source>`
vs `link <target-address> <source-address>`), and F1 was the only thing in this diff that could
misparse a line.

### F4 — the log miscites D-010. **Correction of record; no code affected.**

Log Decision 8 attributes "declare vocabulary once" to D-010. D-010 is "Slot keys are produced ONLY
by `slotKey()`, never hand-built", and its rationale is about a hand-built `"a.b"` silently
aliasing two different slots — it says nothing about duplicating a constant. Importing
`DEFAULT_TABLE_ROWS` rather than re-spelling `8` is obviously right; the pointer sent at it is
wrong, and in a codebase where `(D-0XX)` is the mechanism by which a reader finds the binding
reason (D-060), a pointer into the wrong ruling is a small but real cost. **The source is clean** —
`parser.ts` cites D-020, D-025, D-031, D-032, D-038, D-039, D-040, D-041, D-043 and D-061, and
every one of those checks out. `entries/` is append-only, so this is noted here rather than
corrected there.

### F5 — fractional, zero and negative counts now parse. **Correct of the parser; ruled as D-070.**

```
table x=0 y=0 rows=-3 cols=0    =>  OK {"rows":-3,"cols":0}
polygon sides=2.5 x=0 y=0 r=5   =>  OK {"sides":2.5}
```

The parser is right to pass these through — D-031 clause 3 keeps document-state policy out of a
text-scanning stage, and D-069 makes it the handler's. But 0060-, 0062- and 0064-REVIEW each
deferred the counts problem on the ground that nothing could reach it, and each said "one ruling
covers all three or none." Something can reach it now, and the handler that makes it reachable
end-to-end is the *next* slice. **D-070 issues that one ruling**: the check is the creation
handler's, out-of-range REJECTS rather than producing an `ErrorValue` (the slot SET is what is at
stake, not a slot's value — `rows=1000000` allocates a million cell slots before anything
evaluates), counts are whole numbers, and the message names the argument and the range. Bounds are
the reviewer's provisional pick — `sides` in [3, 1000], `rows`/`cols` in [1, 1000] — declared the
way `render/camera.ts` already declares `MIN_ZOOM`/`MAX_ZOOM`, and **the human may overrule the
numbers without disturbing the structure.**

`geometry.ts`'s existing `#TYPE` for `sides < MIN_POLYGON_SIDES` stays, as the defensive arm for an
AST arriving from a loaded file — the same shape D-038 left `eval.ts`'s branches in.

## 5. The log's disclosed contradiction of 0067-REVIEW §10 item 4

0067-REVIEW (mine) said "`command/parser.ts` is the first consumer of `parseFormula` from a user
surface" and told this cycle to read D-038 first. The implementer read D-038, then did not call
`parseFormula` at all, and said so at the top of "Where I got stuck", offering to take a REVISE.

**The implementer is right and 0067-REVIEW §10 item 4 was wrong. It is withdrawn.** No §5.10
command takes a formula expression: `link` takes two addresses and builds §5.1's degenerate formula
from a resolved one, `set` is shown writing a literal, and `text`'s `{= }` is a literal `content`
slot parsed later by the text primitive (§5.6, Phase 5). D-038 binds "every future authoring path"
and comes due at whichever file first calls `parseFormula` — `commands.ts` if Q-013 lands as (a),
otherwise the formula-bar cycle.

Worth saying plainly, because the honest version of this is rarer than it should be: the carry-in
was wrong, the implementer checked it against the brief instead of complying with it, and disclosed
the disagreement in the section reserved for what went wrong rather than burying it in a decision
list. That is the behaviour this process is for. It also produced Q-013, which is the most useful
thing in the cycle.

Note that the parser already satisfies D-038's spirit where it can: every failure carries a
character offset (clause 2's habit), and `COMMAND_NAMES` is exported and enumerable for a future
autocomplete (clause 3's analogue), which the header cites correctly.

## 6. Open questions

- **Q-013 (how a general formula is authored) — ESCALATED TO THE HUMAN, not ruled.** The full
  reviewer position is written into `OPEN_QUESTIONS.md` under the question. Summary: the reviewer
  **endorses (a)**, `set <address> = <formula source>` — it is the spreadsheet's own gesture, §5.4's
  formula bar will do the same thing so one spelling serves both surfaces, and D-040 has already
  settled what happens when `set` writes over a formula slot, so (a) needs no new semantics. §8's
  "command-language gold-plating" does not forbid it; that bullet's own sentence is "Add commands as
  needed, one registry entry each," and a surface Phase 4's gate cannot be reached without is
  needed. But **what the command line should be able to SAY is the operator's call under D-042** —
  every comparable question here (Q-001, Q-002, Q-004, Q-010) was ruled by the human — so the
  reviewer declines to rule it and hands it over ready to decide.

  Three constraints ARE ruled, because they hold whichever way it goes: the formula source must be
  the **raw substring** from the `=` to end-of-line (never re-joined tokens — that discards offsets
  and D-038 clause 4's source text); the parser stays document-free (D-069); and `link` and a
  formula-writing `set` must build their slot through **one** shared path in `commands.ts`, or
  D-040's reporting and D-041's kept value will drift across two command words.

  The `PROVISIONAL(Q-013)` tag **stays live and unchanged** — a reversible choice taken at exactly
  one site is what §7 asks for, and reconciling it early would force the formula path into the
  `commands.ts` slice, which is not that slice's job.
- **Q-012 (world units vs screen pixels)** — stays open, unchanged, still deferred to the `style`
  slots cycle. Entry 0068 correctly declined to settle it by inventing `pan`'s grammar.
- **Q-008** — stays open, deferred, blocking nothing. 0068 did not reopen it: a `-0` typed into
  `set` reaches the command object and `mutate` refuses it, which is option (a) working as written.
- **Q-001/Q-002 (ANSWERED → D-041/D-040)** — still owed reconciliation at `commands.ts`, unchanged.

## 7. Legibility audit

Vocabulary is locked and clean throughout — *slot*, *literal*, *formula*, *derived*, *address*,
*object*, *mutation*, *preset* all used in the brief's senses, no "property", no "field", no "node"
for object. Tests are behaviour sentences and several name the rule they defend. No `any` anywhere
in the diff. Every `switch` on a union closes with the house `const exhaustive: never` idiom.
Comments are present-tense and D-060-clean; F2 was the one exception and it was in a file the cycle
edited, not in the new one.

**The 65-line header (log "stuck" #3).** Reviewed line by line against §5.2's keep-always list, and
the implementer's judgement is sound: two rejected alternatives, five invariants, five deferrals
each naming an owner, one hazard about quoting. Trimming it would delete the expensive knowledge
and keep the cheap. This is the **second** data point after entry 0065 that a subsystem's first
file cannot state its own contract in 40 lines here, and the recommendation stands where 0065 left
it: **the budget wants amending to ~60-70 for a first-of-subsystem file, and that amendment is the
human's.** D-069 does create one honest reduction — the header currently restates Decision 1's
rationale in full because no ruling existed to point at, and it may now cite D-069 and drop roughly
ten lines without losing anything (fix list item 1). That is a citation replacing a retelling,
which is §5.2's own prescription, not a trim.

**`STATUS.md` at 162 lines against §2's "< 150" (log "stuck" #6).** Confirmed, disclosed, and the
compression already applied was the right kind. Not treated as a defect this cycle: it is the same
budget question as the header, and the file is still doing its job — it oriented this review
without a single trip into `entries/`, which is the only test §2 sets it.

## 8. Honesty audit

Re-run, not read:

```
$ npx tsc --noEmit                          exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json  exit 0, no output
$ npx vitest run                            21 files, 835 passed (835), 0 skipped
$ grep -rn "\.only|\.skip|it\.todo" src/    no output
```

**Every number in the log is real.** 835 = 776 + 59 reconciles. The diffstat matches the claimed
~1103 lines / 4 files. The mutation-check table in the log was spot-checked and its claim holds:
the guard neutralisations it lists are caught by the named tests it names.

No silent scope expansion: the two comment edits are genuinely owed under D-065 and are genuinely
comment-only (`git show` confirms no executable line changed in either file). No optimistic
completion claim — Phase 3's criterion is explicitly NOT claimed, correctly, since nothing executes
a command and no pixel has come from a typed line.

The cycle self-reported both review triggers, reported being **over** the §6.3 line cap in its own
cycle rather than rounding down to fit, and put its own most-contestable design choice at the top
of "Decisions I made" with an explicit request to have it checked. The split-it-in-two argument in
"stuck" #2 is also right: two thirds of the file is declaration, and splitting would have produced
a second cycle of nothing but registry entries while settling the design question in the first
either way.

After this review's edits: **837 passed (837)**, both typecheck configs clean, 0 skipped, 0 `.only`.

## 9. Edits made at this review

1. `src/command/parser.ts` — `tokenize` rejects a bare word or a second quoted run touching a
   closing quote (F1). Four lines plus a why-comment; `tokenize`'s doc comment updated to state the
   rule in both directions, since it previously claimed a symmetry the code did not have.
2. `src/command/parser.test.ts` — two tests for F1, named for the hazard.
3. `src/engine/primitives/table.ts` — one header line, present-tensed (F2).
4. `claude/DECISIONS.md` — **D-069** (the `command/` layer boundary) and **D-070** (creation counts
   bounded at the handler).
5. `claude/OPEN_QUESTIONS.md` — Q-013's status and the reviewer's position, endorsement, and three
   binding constraints.

Nothing was rewritten. No test was weakened, skipped, or deleted; the two added tests pin behaviour
the file already claimed to have.

## 10. Fix list (none blocking — take these in the `commands.ts` cycle or later)

1. **`command/parser.ts`'s header may now cite D-069** and drop the ~10 lines that restate its
   rationale in full. §5.2's own instruction: cite the stable pointer, do not retell the story.
2. **Make each `usage` string spell the same parameter names the arity errors report** (F3).
   Sixteen strings, one pass.
3. **The leading-`=` guard's message is wrong for a mistyped key** — `circle =1 y=0 r=1` gets the
   formula-and-`link` message when the operator dropped an `x`. Worth revisiting when Q-013 lands,
   since (a) narrows the guard to non-value positions anyway. Not worth a cycle of its own.
4. **Carried, unchanged:** an end-to-end test through a table-creation command, owed by `renderer`,
   `hittest` and `interaction` (0062-, 0067-REVIEW) — still needs the handler. The thirteen bare
   "this cycle" sites and two stale claims in test files. `render/slots.ts` at the THIRD consumer of
   `readNumber`/`asPointArray`, still at two. `.gitattributes`.

## 11. Where Phase 3 stands, and the next slice

`render/` is complete and reviewed. `command/parser.ts` is now reviewed. **`command/commands.ts` is
the next slice**, and it is the one that owes the most:

1. **D-040 and D-041 come due** — reconcile Q-001/Q-002, do not re-decide them. `set` over a
   formula slot REPLACES it and must report what it replaced; `unlink` keeps the value last
   displayed, errors included.
2. **D-070 lands in that same cycle** — the creation handlers bound `sides`/`rows`/`cols` before
   building an `Operation`, or a typed line allocates a million slots.
3. **D-069 governs the file** — it is the only place a `Command` meets a `Document`.
4. **The table-creation handler owes `TABLE_SCHEMA` an `origin.x`/`origin.y` pair** at the paths
   `renderer.ts`, `hittest.ts` and `interaction.ts` already read (carried from 0067-REVIEW §10.3).
5. **§5.10's echo log** — "every rejection message must name the specific slots involved" gets its
   first real slots to name here. The parser's half of that contract is met; the handler's is not.

Then `main.ts`: ONE clamped camera to all three of `renderDocument`, `hitTest` and
`pointerDown`/`pointerMove` (D-062); reset the canvas transform before screen-space chrome.

Phase 3's criterion is correctly not claimed and cannot be until both land.

## 12. Verdict

**ACCEPT WITH EDITS.**

This is a good cycle. The one defect it shipped (F1) is a real one and would have been genuinely
unpleasant to find later — a destructive flag set by a line nobody wrote — but it hid behind a rule
the file stated correctly and implemented in one direction, which is the hardest kind of gap to see
from inside. Everything the cycle claimed about itself is true, the numbers reconcile, the design
question it flagged for checking was the right one to flag, and it contradicted a reviewer carry-in
on the merits and said so in the open. The header and `STATUS.md` overruns are both real and both
disclosed; neither is a defect of this cycle so much as evidence that a budget wants amending, and
that call is the human's.

Two rulings issued (D-069, D-070). Q-013 escalated with a recommendation. Proceed to
`command/commands.ts`.
