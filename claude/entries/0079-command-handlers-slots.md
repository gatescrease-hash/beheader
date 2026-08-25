# 0079 — `command/commands.ts`'s slot commands: `set`, `set-formula`, `link`, `unlink`
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (implementer)
Previous entry: 0078-REVIEW-phase3   Last review: 0078-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; 944 lines / 9 files changed so far.

## Declared scope

The four §5.10 slot commands in one cycle, because D-071 clause 4 makes them one debt: `set` writing
a literal, `set` writing a formula, `link`, and `unlink`, all through a single slot-writing path in
`command/commands.ts`. Building that path needed one thing that did not exist — a way to turn a
stored AST back into readable source, which D-040's "report the formula you replaced" cannot be
satisfied without — so `src/engine/formula/format.ts` is in scope too. Fix-list items 1 and 2 from
0078-REVIEW §9 ride along, as that review said they would.

## Explicitly not in scope

`rename`/`delete`/`refs`/`list`; D-075's `select`/`zoom`/`fit`/`save`/`load` effects; `main.ts`.
0078-REVIEW §9's carried item 3, all six sub-items, is untouched — including 3(5)'s `set = x`
message, which lives in `parser.ts`'s argument matching and not in anything this cycle opened.
Phase 4 is not claimed even though (a) and (b) are now reachable by typed line; see below.

## What I did

**`src/engine/formula/format.ts` (new, 174 lines).** `formatFormula(ast, objects)` — §5.2's
"displaying a formula maps IDs back to current names," which nothing implemented until now.
Precedence-aware parenthesization re-derived from §5.3's chain (the AST carries none), left
associativity throughout including `^` (D-030), every reference through `address.ts`'s
`formatAddress` (D-015, which also strips a cell's stored `cells` prefix). Never throws: a deleted
object's address prints the `AddressError`'s own message.

**`src/engine/formula/format.test.ts` (new, 155 lines).** The load-bearing assertion is a ROUND
TRIP — parse, format, re-parse, require identical ASTs — because a formatter that drops a
parenthesis still produces a plausible string. Three exceptions are disclosed and tested rather
than hidden: a number outside the lexer's `[0-9]+(\.[0-9]+)?` grammar prints as `1e+21` and does
not re-parse; a string value ending in a backslash re-lexes wrong (§5.3 specifies `\"` as the only
escape); and an `ErrorNode` prints `#REF`, for which §5.3 has no syntax at all (D-028 — it is
written by repair, never typed).

**`src/command/commands.ts` (+288/-15).** Four new switch arms and one shared path:

- `resolveWritableSlot` — the identity work D-069 assigns here. Three refusals, most specific
  first: `parseAddress`'s own message; a `derived` slot (§5.1, D-040 bound 3); a path the object's
  type does not declare.
- `writeSlot` — D-071 clause 4's ONE slot-writing path. Resolves, builds, commits one `setSlot`,
  and discharges D-040's "not silent" bound in one place: whatever the write, if the slot it lands
  on holds a formula, the report names that formula.
- `buildSlot` — the three arms. `formula` calls `parseFormula` (the codebase's first call from
  `command/`), passing the target's table id only when the target IS a cell, which is what scopes
  §5.3's bare cell refs. `unlink` freezes the formula slot's cached `value` into a literal, errors
  included (D-041).
- `describeSlotValue` — a §5.10 echo helper. Deliberately NOT a third copy of
  `describeValueType`: that names a TYPE for a `#TYPE` message, this shows the value itself,
  because D-041's report is "here is what was kept."

**`src/command/commands.test.ts` (+256/-11).** 32 new tests across seven blocks. Fix-list item 1:
the registry sweep now iterates every one of the sixteen registry commands, drawn from a list
pinned against `COMMAND_NAMES` so a new entry cannot land outside it. The three "has no handler
yet" entries for `set`/`link`/`unlink` are gone, and so is the `set-formula` test that asserted the
same — those are §6.1 trigger 5, see Review point.

**Fix-list item 2 and D-065's own sweep** (comment-only): `mutation.test.ts`'s "still-deferred
resize/creation cycle" header (resize landed 0047/0050, creation 0075); `schema.test.ts`'s two
"graph/eval.ts does not exist yet" claims; `mutation.ts`'s `SetSlotOperation` doc calling `link`/
`set`/`unlink` "future"; `formula/parser.ts`'s `parseFormula` doc calling its caller "a future
`link`/`set` command"; `graph/node.ts`'s `FormulaSlot.value` doc citing Q-001, which D-041 answered.

## Decisions I made

**1. A formula formatter, rather than storing the source text.** D-040 clause 1 requires reporting
the replaced formula's source, and nothing stores source: §5.2 stores ASTs holding IDs precisely so
renaming rewrites nothing, and a stored source string would go stale on the first `rename`. So the
source is RECONSTRUCTED against current names. The consequence is worth stating plainly: what the
operator gets back is the formula's meaning spelled canonically, not their own keystrokes —
`1+2 * 3` reports as `1 + 2 * 3`. I believe that is the right trade and it is the only one
consistent with §5.2, but it is a visible behaviour and a reviewer may disagree.

**2. `link` is `set … = <source>` with the source constrained to a bare reference.** D-071 clause 4
says they share one path; §5.10 says `link <address> <address>`. So `link` runs the source through
`parseFormula` like any formula and then requires `isReferenceNode`, which is exactly "§5.1's
degenerate formula" as a check rather than as prose. `link polygon_1.radius 42` is refused, naming
the `set` form that would do it.

**3. A path the schema does not declare is REFUSED.** `mutate` accepts an undeclared `literal`
slot — that is settled, tolerated state — so without this check `set polygon_1.radius2 5` would
report success into a slot nothing reads. Refusing it is the same stance every other layer here
takes against a silently-wrong result. It also gives table cells their extent check for free:
`resolveNonDerivedSlotPaths` enumerates cells from the object's own `rows`/`cols`, so
`set table_1.A99 1` on a 4x4 table is refused and `set table_1.D4 1` is not.

**4. The derived-slot refusal is the handler's, not `mutate`'s.** `mutate` would reject it too, via
D-018's reconciliation — but with a message about a schema disagreement rather than about the thing
the operator did. §5.10 wants the message to name what is wrong.

**5. D-038's four conditions.** (1) Validation runs at commit, in the handler, never on a keystroke
path. (2) The `#PARSE`'s own message and `start` are carried through, not flattened — `unknown
function "NOSUCH" (at position 1 of "NOSUCH(1)")`. (3) `FUNCTION_REGISTRY` untouched and still
enumerable. (4) The source is echoed in the rejection rather than discarded. Note the position is
an offset into the FORMULA, not into the line: `commands.ts` never sees the line, only the source
`parser.ts` sliced for it. That is honest but it is less than an editor would want, and the layer
that could do better is `main.ts`, which holds the line.

## Verification (real output)

```
$ npx tsc --noEmit
(no output, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(no output, exit 0)
$ npx vitest run
 Test Files  24 passed (24)
      Tests  976 passed (976)
$ grep -rnE "\.only\(|\.skip\(|it\.todo|describe\.todo" src/
(no output)
$ git diff --cached --numstat  (summed)
files: 9  added: 898  deleted: 46  changed: 944
```

Baseline before this cycle was 926/926 (0078-REVIEW's own number, re-run at the start of this
cycle and confirmed). 976 - 926 = 50 new tests: 18 in `format.test.ts`, 32 in `commands.test.ts`.

**Mutation checks (six), ANSI-stripped, asserted on the `Tests` line.** Each neutralisation was
applied to `commands.ts`, the file restored from a copy afterwards, and the restore confirmed
byte-identical (`diff`) with the suite back at 74/74:

| Neutralised | Observed |
| --- | --- |
| derived-slot refusal always false | 3 failed / 71 passed |
| undeclared-path refusal always false | 2 failed / 72 passed |
| D-040's replaced-formula report suppressed | 2 failed / 72 passed |
| D-041's kept value replaced with `null` | 3 failed / 71 passed |
| `cellHostObjectId` always `undefined` | 2 failed / 72 passed |
| `link`'s reference requirement always false | 1 failed / 73 passed |

**Two more on `format.ts`, which passed 18/18 first try** — the case STATUS's own gotcha says to
distrust: right-operand associativity (`precedence + 1` → `precedence`) failed the two tests named
for it, and the unary-operand rule (`ATOM_PRECEDENCE` → `0`) failed its two. Restored, 18/18.

**Size probe (D-077 clause 2) — it found something, and it is not fixed.** `formatFormula` recurses
over an AST and `parseFormula` recurses over a token stream; AST depth is user data, so both got
probed at increasing nesting rather than reasoned about. Measured, both in the same run:

```
depth  500 / 1000 / 1500 / 2000 / 3000 / 5000   format=ok    parse=ok
depth 6000 / 8000 / 10000 / 15000 / 20000       format=THROW parse=THROW
```

And end to end, through the real command line against a real 2x2 table:

```
set table_1.A1 = 1 + 1 + ...  (1000 terms)   ok
set table_1.A1 = 1 + 1 + ...  (5000 terms)   RangeError: Maximum call stack size exceeded
```

**So `executeCommand` throws, out of one typed line, and its header said it never does.** The
throw comes from `formula/parser.ts`'s recursive descent, which predates this cycle — but the door
is this cycle's: before it, `parseFormula` had no caller reachable from typed input. The exact
depth is stack-sensitive (the same 5,000 chain survives when called with less already on the
stack), which is why the table above reports a band and not a number.

**What I did about it: disclosed it, did not fix it.** `executeCommand`'s doc now states the
exception with the measured band, and the file header points at it, instead of the pair of them
asserting a never-throws property that is false — leaving a false claim in a header of the file I just changed
is exactly what D-065 and 0078-REVIEW F2 are about. The FIX is a depth limit inside the
recursive-descent parser, returning `#PARSE` instead of unwinding; that changes `formula/parser.ts`
and its tests, which is a different slice and not one §4 lets me take on the side. **Flagged for the
reviewer as this cycle's most important finding.**

## Acceptance criteria status

Phase 3 criterion: *"you can create a polygon and a table by command, see both drawn, pan/zoom,
select, and drag the polygon"* — **NOT YET, and not claimed.** `main.ts` still holds no canvas.
Nothing about the visible half moved this cycle.

Phase 4's criterion: *"all three hold simultaneously in one document, with no false cycle."*
**NOT claimed**, and this is the honest part: (a) and (b) are now both reachable from typed lines
and are demonstrated by `commands.test.ts`'s "the loop these four commands close" block — a cell
drives a polygon's `origin.x` through a `link`, and a cell reads `polygon_1.origin.y * 2` back out,
both live. (c) — partial binding under DRAG, with feedback — is `render/interaction.ts`'s and was
built at 0066, but no test puts all three in ONE document, and Phase 4's criterion says
"simultaneously." Phase 3's gate is also unpassed, and §6 forbids starting a phase before its
predecessor's criterion passes. So: the pieces are there, the claim is not made.

## Where I got stuck / what is unfinished

**`executeCommand` can be made to throw by one typed line** — see the size probe above. It is
disclosed in the header and unfixed, and it is the thing I would most want a reviewer to rule on.

**A bare reference to an EMPTY cell is refused, and I did not expect it.**
`set table_1.A1 = table_1.B1` where `B1` has never been written is rejected with "references a slot
that does not exist" — because creation makes no cell slots (D-047) and D-047 clause 4 makes an
absent cell fine inside a RANGE and not fine as a plain reference. That is the ruling working as
written, and I pinned it as a test rather than working around it. It is still going to surprise the
operator: `= SUM(B1:B4)` works on an empty table and `= B1` does not. I am not proposing a change —
D-047 clause 4 gives the reason, and the reason is good — but it belongs in Known problems and a
reviewer may want to look at it with fresh eyes.

**My first two attempts at two of the new tests were wrong, not the code.** The cycle test above
was one. The other asserted a regular pentagon's leftmost vertex sits at `origin.x - radius`, which
is false for a pentagon; rewritten to assert on `centroid.x`, which is the propagation claim I
actually wanted and goes one derived slot deeper.

**`describeSlotValue` renders a `Point` as `x,y` and a `Point[]` as "N points", and neither is
reachable today** — no command can put either in a slot, and `unlink` can only surface one if a
formula produced it, which no built-in does. Two lines of unexercised code, disclosed rather than
deleted because `unlink` must handle every `Value` arm and deleting them would just move the
unreachability to a `default`.

**The `#PARSE` position is an offset into the formula, not into the line** — see Decision 5. A
`main.ts` that wants to put the caret in the right place will need the line offset of the `=`,
which `SetFormulaCommand` does not currently carry.

## Open questions raised

None. Every choice above is either bound by an existing ruling or is a disclosed, reversible
implementation decision. Q-001 and Q-002 needed reconciliation, not re-deciding, and were
reconciled: D-041's value is `FormulaSlot.value`, D-040's report is `formatFormula` of the AST that
was there. No `PROVISIONAL(Q-001)` or `PROVISIONAL(Q-002)` tag existed in the tree; the live tags
are still Q-008 and Q-012 only.

## Review point

**Fired: §6.1 trigger 5** — five test expectations changed. Three `"<word>" has no handler yet`
tests and one `set-formula` test are gone because the words now have handlers, and the registry
sweep was rewritten under fix-list item 1. 0078-REVIEW authorised the sweep change; per entry
0073's lesson that a fix list authorises a CHANGE and never an exemption from the trigger it fires,
the trigger is reported anyway.

**Also over §6.3's cap:** 944 lines / 9 files against 800/10, in cycle 1 of 3. The line count is
what a shared path plus a new engine module plus 50 tests costs; I am not claiming it was
avoidable, only stating it.

REVIEW: **REQUIRED.**
