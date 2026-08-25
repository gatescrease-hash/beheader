# 0080 — REVIEW (phase 3)
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0079-command-handlers-slots   Reviewing: entry 0079 (`command/commands.ts`'s four
slot commands, `engine/formula/format.ts`, and fix-list items 1–2 of 0078-REVIEW §9).
Trigger: §6.1 item 5 (five test expectations changed), plus §6.3's cap (944 lines / 9 files against
800/10), self-reported by the entry.

Diff reviewed: `abab7af` — `src/command/commands.ts` (+288/-15), `src/command/commands.test.ts`
(+256/-11), `src/engine/formula/format.ts` (+174, new), `src/engine/formula/format.test.ts` (+155,
new), and five comment-only files. Re-measured: **9 source files, 913 added / 50 deleted = 963
changed**, against the entry's 944 — the entry measured `--cached` mid-cycle and the number drifted
by 19 lines. Immaterial: over the cap either way, and reported as over.

Verdict: **ACCEPT WITH EDITS.** Two findings fixed here, two on the fix list, one ruling (**D-078**).

The cycle is good work. `writeSlot` is genuinely ONE path — I probed it by neutralising the shared
report and watching all three commands fail together — the D-040/D-041 reconciliation lands where
it cannot drift, `format.ts` earns its existence rather than being invented, and the headline
finding (`executeCommand` throws on a deep formula) was found by the implementer, by probe, on
itself, and reported instead of buried. That is D-077 clause 2 working exactly as ruled.

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld, checked mechanically. A grep for `window.`, `document.`,
  `globalThis.` and `canvas.` over `src/engine` returns prose and identifier names only; no
  `render/` import exists in `src/engine` or `src/command`.
- **Rule 2 (state changes only through `mutation.ts`)** — upheld. `writeSlot` builds one `setSlot`
  and calls `mutate`; there is no assignment to `objects` anywhere in `commands.ts`. The
  "one journal entry per slot command" test pins it from the other side.
- **Rule 3 (two-layer naming)** — upheld and, for the first time, exercised in the display
  direction: `format.ts` resolves stored IDs against CURRENT names and stores nothing. Decision 1
  of the entry (reconstruct, never store source) is the only choice consistent with §5.2 and is
  **endorsed** — do not revisit it.
- **Rule 5 (dumbest correct implementation)** — upheld. `resolveWritableSlot` re-enumerates the
  declared paths per command; on a 1000x1000 table that is the same accepted cost D-070/D-077
  already ruled is not a defect. **Do not "fix" it** (D-077 clause 3).
- **Rules 4, 6, 7** — not touched.

## 2. Invariant audit

Slot set fixed during evaluation, derived slots inside the topological pass, eager/total dependency
extraction, no dangling edges, plain serializable state: all not touched by this diff, and the two
new `Slot`s built here are plain objects with `value: null` left for step 7. **Rejection leaves
prior state unchanged** — verified live, not read: the `mutate`-rejection and cycle tests assert the
pre-mutation document is unchanged, and I re-ran them.

## 3. Spec conformance

§5.10's three slot commands, D-071 clause 4's one path, D-038's four conditions, D-040's three
bounds and D-041's kept value are all implemented as written, with one exception (F1 below), and
each is pinned by a test named for the clause it defends. Two spec readings worth confirming:

- **`link` as `set … = <reference>` is right.** §5.1 calls a link a degenerate formula; encoding
  that as `parseFormula` plus `isReferenceNode` makes the prose executable, and the two paths
  storing an identical node is tested. Endorsed.
- **Refusing an undeclared path is right** (the entry's Decision 3). `mutate` tolerates an extra
  `literal` slot, so without this check `set polygon_1.radius2 5` reports success into a slot
  nothing reads. Endorsed, and the free extent check on cells is a real benefit.

## 4. Findings

### F1 — every `#PARSE` position is off by the space after the `=`. FIXED at this review.

`buildSlot` handed `parseFormula` the raw source (which begins with the whitespace between the `=`
and the formula, because D-071 clause 1 keeps the `=` on the captured substring) and then printed
the position beside the *trimmed* source. Probed, not reasoned about:

```
set table_1.A1 = NOSUCH(1)          ->  at position 1 of "NOSUCH(1)"       (should be 0)
set table_1.A1 =NOSUCH(1)           ->  at position 0 of "NOSUCH(1)"       (correct by accident)
set table_1.A1 =    1 + NOSUCH(1)   ->  at position 8 of "1 + NOSUCH(1)"   (should be 4)
```

A position measured against a different string than the one quoted beside it is worse than no
position: an editor that trusts it puts the caret past the offending name, and an operator counting
characters by hand lands on the wrong one. D-038 clause 2 asks for the offending name AND its
position; the name arrived, the position did not. **The entry quotes the middle case as evidence
the clause was discharged, and `commands.test.ts` pinned `at position 1` as correct** — the test was
written from the output rather than from the claim, which is the one way a passing test hides a
defect.

Fixed: `buildSlot` trims the source once, parses the trimmed text, and reports against that same
text. The test now expects `position 0` with the reason in place, and a second test covers the
wide-whitespace form. Mutation-checked: reverting the trim fails 3 tests; restoring passes 75/75.

### F2 — the probe falsified four "never throws" claims; one was corrected. FIXED at this review. Ruled **D-078**.

Entry 0079 measured format and parse both throwing past ~5,000 levels, then corrected
`commands.ts`'s file header and `executeCommand`'s doc. Left standing, in the same tree, about the
same call path:

1. `format.ts`'s header invariant — "Never throws." — in a file created this cycle, by the model
   that measured the throw.
2. `formatFormula`'s own doc — "Never throws, including for an address whose object has been
   deleted."
3. `writeSlot`'s doc — "nothing here throws" — on the function making the `parseFormula` call that
   unwinds.
4. `parser.ts`'s header and `parseFormulaTokens`'s doc (pre-existing; fix list item 1, with the
   depth limit that makes them true again).

I confirmed 1–3 by probe rather than by reading: at 5,000 terms both `executeCommand` and
`formatFormula` throw `RangeError`; at 1,000 both are fine. Fixed 1–3 by stating the exception where
the claim lives. This is the shape **D-078** rules on: a probe that falsifies a property falsifies
every claim of it on the same call path, not only the one the prober happened to be reading.

### F3 — the parser depth limit is the next small slice, and it now blocks a header. NOT fixed.

The fix entry 0079 names is right: a depth counter in the recursive descent returning `#PARSE`, not
a check bolted onto `commands.ts`. `format.ts` needs the same guard on the way back out — a `#PARSE`
at authoring time does not help an AST that arrived from a loaded file (`document.ts` casts a loaded
`ast` unchecked, `parser.ts:549`). Fix list item 1. It blocks nothing else and can be taken at any
point; take it **before** `main.ts`, because a `RangeError` out of a canvas repaint is much harder
to attribute than one out of a command line.

### F4 — the empty-cell bare reference, ruled on as asked. NO behaviour change.

The entry raised `set table_1.A1 = table_1.B1` on an unwritten `B1` for fresh eyes. **D-047 clause 4
stands and the implementer was right not to work around it**: a range names a REGION and tolerates
absence, a bare reference names ONE slot the operator wrote, and making the second silently mean
"empty" would put a dangling reference into the very mechanism §5.1.1 exists to forbid. What is
weak is only the message: "references a slot that does not exist" is true and gives the operator
nothing to do. Fix list item 2 — name the remedy, do not change the rule.

## 5. Legibility audit

Headers present on both new files, present tense, `WHAT THIS IS` inside D-076's cap. Vocabulary
locked — I grepped the diff for *property*, *field*, *node* and *computed*: `field` appears once,
about a TypeScript interface field, which is correct usage and not slot drift. No `any`. Comments
are why-comments with rulings cited as supplements to a stated reason rather than substitutes for
one (D-060). Test names are behaviour sentences, several naming the clause they defend.
`describeSlotValue`'s comment correctly explains why it is NOT a third `describeValueType` — that
is the kind of rejected alternative §5.2 asks to keep. One nit, no action: `describeSlotValue`
re-quotes a string without escaping an embedded quote, which is an echo line only and re-parses
nowhere.

## 6. Honesty audit — entry 0079

**The log matches the diff, and the claimed results are real — re-run, not read.** Both
`npx tsc --noEmit` and `-p tsconfig.engine.json` exit 0; `npx vitest run` gives 24 files / 976 tests
passing, exactly as logged; no `.only`/`.skip` anywhere. The 50-new-test arithmetic checks out
(18 + 32).

The size probe is real and I reproduced it independently: 1,000 terms ok, 5,000 and 10,000 throwing
`RangeError` from both `executeCommand` and `formatFormula`. The band and the stack-sensitivity
caveat are stated honestly.

Scope: no expansion found. `format.ts` is in scope and argued for; the five comment corrections are
D-065's own requirement; carried fix-list item 3(5) was correctly left alone as belonging to a file
this cycle did not open. Phase 3 and Phase 4 are both explicitly NOT claimed, with reasons, and the
Phase 4 paragraph names the missing piece — (c) in the same document — rather than rounding up. The
"where I got stuck" section discloses two wrong tests of the implementer's own, both real.

**The one honesty gap is F1's**: D-038's four conditions are reported as discharged with the
defective output pasted as the evidence. Not a misreport of what was run — a claim checked against
what the code printed instead of against what the clause required. The 963-vs-944 line count is the
other, and is noise.

## 7. Open questions

- **Q-008** (`-0` legal document state) — deferred again, deliberately. Untouched by this diff;
  `format.ts` prints `-0` as `0`, a display-only consequence that cannot create the state. Blocks
  nothing.
- **Q-012** (world units vs screen pixels) — deferred, unchanged. Still due with the `style`-slots
  cycle and still blocking `pan`'s argument grammar.
- **No new questions.** The entry raised none and needed none: every choice in it is bound by an
  existing ruling or is disclosed and reversible.

## 8. Edits made at this review

1. `src/command/commands.ts` — `buildSlot` trims the formula source before parsing, so a `#PARSE`
   position is an offset into the source the message quotes (F1). Both message sites read that one
   `source` constant.
2. `src/command/commands.test.ts` — the D-038 position expectation corrected to `position 0` with
   the reason in place, plus a new test on `set table_1.A1 =    1 + NOSUCH(1)` (F1).
3. `src/engine/formula/format.ts` — the header invariant and `formatFormula`'s doc state the
   ~5,000-level `RangeError` instead of claiming it away (F2).
4. `src/command/commands.ts` — `writeSlot`'s doc likewise, pointing at `executeCommand`'s (F2).

Nothing else was touched. After the edits: both configs compile, **977/977 tests pass**, and the new
expectation is mutation-checked (reverting the trim fails 3, restoring passes 75/75).

## 9. Fix list

**None of it blocks the next slice.**

1. **Depth-limit the recursive descent (F3).** `formula/parser.ts` returns `#PARSE` past a fixed
   depth instead of unwinding, and `format.ts` guards its own recursion for the loaded-file path.
   Then remove the exception sentences the four sites now carry, and pin the bound with a test.
2. **Give the missing-slot refusal a remedy (F4).** Message only; D-047 clause 4 does not move.
3. **Carried from 0078-REVIEW §9 item 3, all six, unchanged and none blocking:** (1) D-074's
   refused prompt answer · (2) the usage line for the form a prompting command was used in · (3)
   what a quoted command WORD means, and entry 0072's "only site" claim · (4) disclose 0074-REVIEW
   F4's two message changes and test (a) · (5) `set = x`'s self-contradictory message · (6)
   `parser.ts`'s header restating D-069 · the twelve bare "this cycle" sites in test files ·
   `render/slots.ts` at the THIRD consumer of `readNumber`/`asPointArray` · `.gitattributes`.
   Items 1 and 2 of that list are **DONE** at 0079 and I confirmed both.

## 10. Where Phase 3 stands, and the next slice

`render/` is complete and reviewed. `command/parser.ts`, `command/prompt.ts`, and now all of
`command/commands.ts` except `rename`/`delete`/`refs`/`list` and D-075's effects are reviewed.
`engine/formula/format.ts` is reviewed as of this entry. No load-bearing file has unreviewed
changes, so §6.2 holds nothing back.

`STATUS.md`'s proposed order is right and unchanged: `rename`/`delete`/`refs`/`list`, then D-075's
effects, then `main.ts`. Take the depth limit (item 1) as its own small slice before `main.ts`.

**Phase 3's criterion is correctly not claimed** and cannot be until `main.ts` holds a canvas.
Phase 4's is correctly not claimed for a second reason on top of that.

## 11. Verdict

**ACCEPT WITH EDITS.**

Four commands, one path, and the path is the one the ruling asked for. The two findings I fixed are
the same species — a claim checked against what the code printed rather than against what the clause
required — and one of them is the third appearance of the never-throws shape in three reviews, which
is why **D-078** exists now. Nothing here is structural; the seam holds.
