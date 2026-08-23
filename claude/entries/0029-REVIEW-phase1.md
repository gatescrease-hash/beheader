# 0029-REVIEW — phase 1 (`formula/` first file)
Date: 2026-08-23   Phase: 1   Model: reviewer (Claude Opus 5)
Reviewing: entry 0028 (`formula-ast`) — commit `e06896b`. Forced by §6.1 trigger 2: the first real
file of the `formula/` subsystem.
Previous review: 0027-REVIEW-phase0 (verdict: ACCEPT WITH EDITS — Phase 0 gate signed off)

**Verdict: ACCEPT WITH EDITS.** The six node shapes are right, the two consequential changes to
`mutation.ts`/`graph/eval.ts` were mandatory rather than scope creep, and the log matches the diff
everywhere it could be re-run. One real gap: the union was missing a node the brief names twice,
in its own words, as a node — added here as `ErrorNode` and generalised as **D-028** so Phase 2's
repair path cannot reach for the wrong shape. Q-009 answered (**D-029**), with a rider the question
did not anticipate and `functions.ts` cannot be written without.

**`lexer.ts` is unblocked.** 0027-REVIEW's carried constraint 1 is discharged.

---

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld. Grepped `window`/`document.`/`canvas`/`render/` across
  `src/engine/`: every hit is the words "NEVER imports: DOM, window, document, canvas" inside a
  file header, plus one prose use of "canvas" in `graph/node.ts`'s description of an object. The
  new file imports `../address.ts` only.
- **Rule 2 (state change only via `mutation.ts`)** — upheld, and strengthened: the cycle's whole
  substance on the write side is one more rejection inside `validateIntegrity`.
- **Rule 3 (addressing load-bearing)** — not touched. `ReferenceNode` is byte-identical to Phase
  0's, pinned by an `Object.keys` assertion, and `RangeNode` reuses `Address` rather than inventing
  a cell-coordinate shape.
- **Rule 4 (ONE formula engine)** — upheld and, more to the point, protected: `ast.ts`'s header
  correctly rules that §5.6's `{? }{:}{?}` text conditional is a BLOCK-TREE node, not a formula AST
  node, so no second expression grammar is being grown for text.
- **Rule 5 (dumbest correct implementation)** — upheld. One `LiteralNode` for three literal types,
  one `BinaryOpNode` across the whole precedence chain, `name: string` rather than a closed union.
  All three are the smaller shape and all three are correct; see §3.
- **Rule 6 (slot set fixed during evaluation)** — not touched.
- **Rule 7 (no §8 deferred work)** — upheld.

## 2. Invariant audit

Derived slots still evaluate inside the topological pass (untouched); rejection still leaves prior
state bit-for-bit unchanged (re-proved by the new `mutate()`-entry-point test's deep snapshot
compare); no dangling edges; graph state plain and serializable — every new type is a `readonly`
interface of plain data, and `isReferenceNode` is a free function, not a method on a node.

One invariant genuinely moved this cycle, in the right direction: **`deriveEdges`'s narrowing is
enforced by the compiler, not by a test.** I reproduced the claim — removing `!isReferenceNode(...)`
from line 453 yields, exactly as logged:

```
src/engine/mutation.ts(463,30): error TS2339: Property 'address' does not exist on type 'FormulaAst'.
  Property 'address' does not exist on type 'LiteralNode'.
```

The entry is right to name that as a different, stronger kind of proof than a red test, and right
not to quietly file it under "well covered."

## 3. Spec conformance

**FINDING 1 (fixed here) — the union was missing `ErrorNode`, a node the brief names twice.**

§5.1.1: repair "rewrites every inbound reference into a `#REF` **error node** in the referring
AST." §5.4: "A reference to a deleted row/column becomes a `#REF` error **stored in the AST at that
position**." Both sentences describe a NODE at ONE position, not a formula-level failure. Nothing
in the widened `FormulaAst` could hold one: `LiteralNode.value` is `number | string | boolean`, and
no other variant admits an error.

Why this is a real defect and not a Phase 2 detail. The next model to need this is writing §5.4's
adjustment pass with no node available, and the two shapes within reach are both wrong:

1. Widen `LiteralNode.value` to include `ErrorValue` — makes every literal potentially an error and
   quietly falsifies §5.3's "Literals: numbers, strings, booleans."
2. Replace the whole slot's AST with a single error — for `= A1 + B1` with `B1`'s column deleted,
   this **drops the surviving edge from `A1`**. That is D-017's failure class, and §5.1.1's explicit
   prohibition ("NEVER silently drop an edge... Reject or repair; there is no third option")
   reached through the repair path itself.

Fixed here rather than handed back: it is a type declaration with no behaviour, additive, and
`RangeNode` in this same diff already sets the standard that a node the grammar needs is declared
before anything produces one. Ruled as **D-028**, which also fixes the two things a type cannot:
an `ErrorNode` evaluates to `#REF` (never `#PARSE`), and `extractDependencies` yields nothing for
it — the absence of a dependency, made explicit, which is what keeps the repaired edge set
consistent.

**Confirmed, no change needed:**

- **`IF` as an ordinary `FunctionCallNode`** — correct (implementer question 2). §5.3 lists `IF`
  among the built-in FUNCTIONS; a call whose args are `FormulaAst` nests for free, which is all
  "nested `IF`" in the Phase 1 criterion asks for. A `ConditionalNode` would also have needed arity
  rules the function registry already owns. But see D-029: this is a ruling about the AST's SHAPE
  only, and it makes the evaluation-machinery question below sharper, not softer.
- **One `LiteralNode`, not three** — correct. §5.3 groups them as one grammar category.
- **`RangeNode` as an endpoint pair, placement unenforced at type level** — correct, and correctly
  disclosed. §5.3's "only as an argument to an aggregate function" is a parser-time placement rule;
  encoding it in the type would need a second, narrower union for one caller's benefit.
- **`BinaryOpNode` flat across the precedence chain** — correct. Precedence is what the parser
  RESOLVES; an AST that re-encoded it would have to be kept in sync with the grammar twice.
- **Bare cell refs (`A1`) get no node of their own** — correct, and the header's reasoning is the
  right one (§5.2 resolves names to IDs at parse time, so `A1` and `table_x.A1` arrive at the same
  `{ objectId, path }`). This is also what makes §5.4's adjustment pass tractable: one node shape
  to walk, not two.

## 4. Legibility audit

Headers present and correct on the new file; layer and allowed imports stated; vocabulary locked
(object/slot/formula/derived/address/edge/mutation used exactly, no "property"/"field"/"computed"
drift); no `any` anywhere in `src/engine/`; comments explain why, and cite sections.

Two notes, neither requiring action:

- **"Node" now means two things in this codebase** — a graph node (a SLOT, per §5.1's own title)
  and an AST node. Both are the brief's own usage, and every AST type is suffixed `Node` inside
  `formula/ast.ts`, so the overload stays legible in context. Do not "fix" it by renaming either
  one; do keep the two files' vocabulary from bleeding together in prose.
- **`ast.test.ts` is mostly a compile-time test suite wearing runtime clothes.**
  `expect(node.operator).toBe(operator)` after assigning `operator` cannot fail at runtime; the
  assertion that matters is that `tsc` accepted the literal. That is the right kind of test for a
  types-only file, and the header says so outright, so it stands. It must not become the house
  style for files that have behaviour — the parts of this file with genuine runtime weight are
  `isReferenceNode`'s truth table and the `Object.keys` shape pins, and both are there.

## 5. Honesty audit

The log matches the diff. Re-ran, not read:

- `npx tsc --noEmit` and `npx tsc --noEmit -p tsconfig.engine.json` — both clean.
- `npm test -- --run` — 233 passed / 233, 9 files, 0 skipped. `grep` for `.only`/`.skip`/`it.todo`
  across `src/`: no matches.
- **Mutation-check 3 reproduced exactly** (see §2) — same error, same line, same column.
- **Mutation-check 2 reproduced exactly** — neutralising `findUnsupportedFormulaAsts` fails 5
  tests: the 4 named in `mutation.test.ts` plus the `document.test.ts` load-path test, and the
  "does not flag a ReferenceNode" and "never throws" tests in the same block correctly keep
  passing. The entry's account of which tests survive is as precise as its account of which fail.

**One discrepancy — the diff arithmetic.** The entry states "**557 changed lines across 6 tracked
files**" and explicitly claims the new test file was "already counted in the 557 via `git add`, not
double-counted." It was not counted. The real figure is **722 changed lines across 7 files**
(`git diff --numstat d10173c HEAD -- src/`: 642 insertions, 80 deletions); 722 − 165 = 557 and
7 − 1 = 6, i.e. `formula/ast.test.ts` is exactly what is missing from both numbers.

Nothing downstream changes — review was mandatory under §6.1 trigger 2 regardless, and 722 is still
under the §6.3 cap — but two things make it worth naming rather than waving through. First, the
entry cites 0025-REVIEW's own correction of this project's past arithmetic while repeating the
error, which is how a number that is supposed to be "checkable without re-deriving it" stops being
checkable. Second, 722/800 is not far from the cap: the NEXT cycle to touch `mutation.ts` or
`graph/eval.ts` should assume it starts near it. `STATUS.md` also dropped §11.2's
`Cycles since last review: k/3 · diff since last review` line entirely — the one place that number
is meant to be visible without opening an entry. Restored below.

## 6. Open questions

- **Q-009 — ANSWERED → D-029.** Option (a): both forms exist and mean the same thing. Approved as
  recommended, and the question was right that `ast.ts` needed no answer. The rider it did not
  anticipate is the important half: §5.3 specifies the built-in registry as table-driven over
  **already-evaluated** arguments AND requires `IF`/`AND`/`OR` to short-circuit. Both cannot hold
  of one dispatch path. D-029 rules that `IF`/`AND`/`OR` are evaluated lazily by `formula/eval.ts`
  at the call site, in BOTH syntactic forms, and never computed by a `functions.ts` implementation;
  `NOT` is an ordinary registry entry; `deps.ts` stays eager and total across both forms. This is
  §5.3's own "getting it backwards breaks reactivity in a way that is very hard to debug" warning,
  ruled one cycle before the code that can get it wrong.
- **Q-005 — execution confirmed.** The union was widened, not restructured; `ReferenceNode` is
  byte-identical and pinned; every `PROVISIONAL(Q-005)` tag is gone (grepped). Correctly recorded
  as executing 0006-REVIEW's ruling rather than as a new decision.
- **Q-007, Q-008** — unchanged, still provisional, still correctly tagged at one site each.
- **Q-001/Q-002 (Phase 3), Q-004 (Phase 2)** — deferral reaffirmed; nothing this cycle touches them.
- Next free question id: **Q-010**.

## 7. Answers to the implementer's questions

1. **Was `findUnsupportedFormulaAsts` the right scope?** Yes — and the reasoning given for it is
   the reason, not a rationalisation. The narrowing itself was compiler-forced, so the only real
   choice was between failing closed and leaving a disclosed silent gap; a formula slot that
   derives no edge is D-017's exact failure shape, and this project has now paid for that lesson
   three times. Two boundary markers, so this does not become a licence: (a) it is in scope because
   THIS cycle created the gap — a pre-existing problem still goes to *Known problems*, not into a
   silent fix (§4); (b) it is acceptable partly because it is built to be deleted, and it is
   documented as such in four places. Keep that discipline: a temporary check that outlives its
   reason becomes dead defensive code with a stale justification, which is worse than the gap.
2. **`IF` as `FunctionCallNode`?** Yes — see §3, and now read D-029 alongside it.
3. **Q-009?** Answered above as D-029.

## 8. Edits made (all verified: both configs clean, 235/235 tests pass, 0 skipped)

1. `formula/ast.ts` — added `ErrorNode` (`{ type: "error"; error: "#REF" }`) to the `FormulaAst`
   union, with a doc comment stating why it is not part of §5.3's grammar, why `error` is a
   one-member literal rather than `ErrorCode`, and that it carries no `message`. The header's "WHAT
   THIS IS" opening and bullet list were updated to match. (D-028.)
2. `formula/ast.test.ts` — two tests: an `ErrorNode` in the right operand of a surviving
   `BinaryOpNode` (the `= A1 + B1` repair shape, named for the rule it defends), and a shape pin
   that it carries the code alone. Extended `isReferenceNode`'s truth table to the seventh variant
   — an exhaustiveness test that is not exhaustive is worse than no test.
3. `mutation.test.ts` — added `{ type: "error", error: "#REF" }` to "rejects every non-reference
   AST shape in turn", with an inline note that the list must stay exhaustive over `FormulaAst`.
4. `mutation.ts` — doc comments only: "six variants" → "seven variants with D-028's" in the two
   places that count them. No behaviour change; `findUnsupportedFormulaAsts` already rejects an
   `ErrorNode` correctly, since it is not a `ReferenceNode`.
5. `DECISIONS.md` — **D-028** and **D-029**. `OPEN_QUESTIONS.md` — Q-009 marked ANSWERED → D-029
   with the reviewer note. `STATUS.md` — verdict recorded, §11.2's cadence line restored with the
   corrected 722/7 figure, and `ErrorNode`/D-028/D-029 added to Built and to the gotchas.

## 9. Carried constraints for the next cycle

1. **`lexer.ts` is unblocked** — the ordinary next slice, standalone and heavily unit-tested per
   §6's Phase 1 build order. Do not batch `parser.ts` behind it in the same cycle: `lexer.ts` is
   ordinary work inside a now-reviewed subsystem (§6.4's `REVIEW: NOT NEEDED` is the expected
   verdict there), but `parser.ts` is where D-029, Q-004, and range placement all land at once.
2. **Cite D-029 in `parser.ts`, `functions.ts`, and `formula/eval.ts` headers**, and carry tests
   named for it: an `IF` (and an `AND`) whose untaken branch would error, asserting no error
   surfaces, alongside a `deps.ts` test asserting both branches still yield dependencies. Those two
   tests are the Phase 1 criterion's own wording; write them with the code, not after it.
3. **Do not extend `findUnsupportedFormulaAsts` or `evaluateFormula`'s `#PARSE` branch.** Both are
   deleted whole-cloth at Phase 2 — along with `deriveEdges`'s narrowing — the moment the real
   engine is wired in. Widening either one is the wrong move and would make the temporary permanent.
4. **`ErrorNode` is not to be constructed yet.** Nothing writes one until §5.4's adjustment pass
   (Phase 2, D-028's binding site). It exists so that pass has the right shape to reach for.
5. **State the running diff total honestly** — it starts near the §6.3 cap for anything touching
   `mutation.ts`/`graph/eval.ts`, and §11.2's cadence line is not optional.

## Verification (real output, after edits)

```
$ npx tsc --noEmit                                -> clean
$ npx tsc --noEmit -p tsconfig.engine.json        -> clean
$ npm test -- --run
 Test Files  9 passed (9)
      Tests  235 passed (235)
```

233 → 235 (+2, both new; none changed or removed). 0 skipped, 0 `.only`.
