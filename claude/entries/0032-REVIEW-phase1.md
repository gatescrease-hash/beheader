# 0032-REVIEW — phase 1 (`lexer.ts` + `parser.ts`)
Date: 2026-08-23   Phase: 1   Model: reviewer (Claude Opus 5)
Reviewing: entries 0030 (`formula-lexer`, commit `f8e4b54`) and 0031 (`formula-parser`, commit
`e61c967`) — two batched cycles. Forced by §6.3's batch cap: 1768 lines / 5 files against 800/10.
Previous review: 0029-REVIEW-phase1 (verdict: ACCEPT WITH EDITS)

**Verdict: ACCEPT WITH EDITS.** Both files are good work — the stage separation is real, the
precedence chain matches §5.3 tier for tier, and every judgment call I checked was disclosed
rather than buried. Three defects found, all latent rather than live, all fixed here; all three
share a shape worth naming: **each one is a place where last review's `ErrorNode` (D-028), or this
cycle's new ability to PRODUCE literal values, invalidated an assumption written before either
existed.** New code did not break old code; new code inherited an assumption that had quietly
stopped being true.

**`deps.ts` is unblocked.**

---

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld. Both new files import only from `engine/*`; grep for
  `window`/`document.`/`canvas`/`render/` across `src/engine/` returns only file-header prose.
- **Rule 2 (state change only via `mutation.ts`)** — not touched. Neither file writes state;
  `ParserState` is transient per-call working data, correctly argued as such in its own comment.
- **Rule 3 (addressing load-bearing)** — upheld, with one edit. See finding 2: `address.ts` gained
  one 9-line export, which is the right call, but `parser.ts` then hand-built the OTHER half of the
  same mapping.
- **Rule 4 (ONE formula engine)** — upheld. `parser.ts` correctly notes that text's `{= }`/`{? }`
  embedding layers ON TOP of this parser rather than getting its own grammar.
- **Rule 5 (dumbest correct implementation)** — upheld, and well applied: one shared
  `parseLeftAssociativeExpr` behind six tiers instead of six near-identical loops; four token
  shapes instead of one per punctuation mark; range placement as one post-parse walk instead of a
  flag threaded through every tier.
- **Rule 6 (slot set fixed during evaluation)** — not touched.
- **Rule 7 (no §8 deferred work)** — upheld.

## 2. Invariant audit

Nothing in this batch touches the graph, the mutation loop, or edge derivation. The invariants at
stake are the two these files claim for themselves:

- **"NEVER throws"** — violated, narrowly, and fixed. See finding 3.
- **"Every `ReferenceNode` holds a resolved `Address` — an ID, not a name (§5.2)"** — upheld;
  verified by probe that a bare `A1` and a dotted `table_1.A1` resolve to the identical stored
  address today. See finding 2 for why "today" is doing work in that sentence.

## 3. Findings

### Finding 1 (fixed here) — `isParseError` reports a valid AST as a parse failure

```ts
export function isParseError(value: unknown): value is ParseError {
  return typeof value === "object" && value !== null && "error" in value;  // before
}
```

`ast.ts`'s `ErrorNode` — `{ type: "error"; error: "#REF" }`, added by D-028 at the last review — is
a `FormulaAst`, i.e. a member of this predicate's own argument union, and it has an `error` field.
Probed before the fix:

```
isParseError({ type: "error", error: "#REF" })  ->  true
```

Not live today (nothing constructs an `ErrorNode` yet, by D-028's own instruction), but it becomes
live the moment §5.4's reference-adjustment pass writes one — and the case that bites is not
exotic: a cell holding `= B1` whose column is deleted repairs to an `ErrorNode` **at the root**, so
the first caller to ask "did this parse?" about a repaired formula gets `#PARSE` for an AST that is
perfectly well-formed. Because the predicate is `value is ParseError` over `unknown`, the compiler
would have endorsed the answer.

Fixed by discriminating on the value (`value.error === "#PARSE"`). Ruled as **D-032**, which also
records why `isAddressError`'s identical presence check is left alone (correct over its real domain
— `Address`/`string`, neither of which has an `error` field) and why `isErrorValue`'s is correct by
construction (its parameter is `Value`, not `unknown`). The general rule: discriminate on the code,
and treat a predicate's parameter type as a claim about its domain.

Mutation-checked: reverting the fix fails exactly the one new test that names it (320/321).

### Finding 2 (fixed here) — the anti-drift argument was applied to half the mapping

Exporting `isCellReferenceForm` from `address.ts` is the right call, for exactly the reason given
(D-008: one pattern, never a second copy that could drift). But the call site then did this:

```ts
if (state.tableObjectId !== undefined && isCellReferenceForm(only)) {
  return { objectId: state.tableObjectId, path: ["cells", only] };   // before
}
```

`"cells"` is `address.ts`'s private `TABLE_CELL_PATH_PREFIX`, which is how `toStoredPath` maps
`table_x.A1` (D-005). So the regex is shared and the path shape is copied — and it is the path
shape that decides which slot a reference lands on. If Phase 2/4 ever changes that mapping, a bare
`A1` and a dotted `table_x.A1` resolve to two different slots for one cell: Q-004's hazard, reached
through a door Q-004 does not watch.

Probed: the two agree today, so this is drift risk, not a live bug. Fixed by giving `address.ts`
the other half too (`bareCellAddress(tableObjectId, cellReference)`), with a test pinning it
against `parseAddress`'s own result for the same cell. That test passes before and after — it
exists to fail later, if the two halves ever diverge.

### Finding 3 (fixed here) — the only `throw` in `src/engine/`, in a file that promises it never throws

`walkForRangePlacement`'s `default:` arm threw an `Error`. `grep -rn "throw new Error" src/engine`
returned exactly one hit, this one — against a file header stating "`parseFormulaTokens`/
`parseFormula` NEVER throw," §5.1's "errors must never throw across the evaluation loop," and
Phase 1's own acceptance wording ("malformed input yields `#PARSE` rather than throwing").

The `const exhaustive: never = node` assignment is the part doing real work: it is a compile error
the moment `FormulaAst` grows a variant, which is a stronger guarantee than the throw adds. The
throw is only reachable if a value the compiler believes impossible arrives at runtime — and there
IS such a path: `document.ts`'s `reconstructSlot` casts a loaded formula slot's `ast` unchecked
(its own comment says so, and it is why `findUnsupportedFormulaAsts` exists). Fixed by keeping the
`never` assignment and returning a `#PARSE` instead of throwing.

### Finding 4 (comment corrected here; fix ruled as D-031) — a producer of illegal numbers now exists, and nothing checks it

`lexer.ts`'s header says an overflowing digit run is fine because "that is `mutate`'s check to make
(D-025/D-027, **already built** and binding on whichever cycle first writes a parsed formula AST
into a slot)." It is not built. `validateIntegrity`'s `findIllegalSlotValues` walks each slot's
`value` field only — never `slot.ast`. Probed through the real parser:

```
parseFormula("1" + "0".repeat(400), objects)  ->  { type: "literal", value: Infinity }
JSON.stringify({ v: Infinity })               ->  {"v":null}
```

That is D-025's own defect ("a number that does not survive the format is not document state") and
§6 clause 4's round-trip-identically claim, for the fourth time — after slot values, journal
payloads, and `camera`/`nextObjectId`. D-027 already rules that every number reachable from a
`Document` must pass `isIllegalNumber`, and §5.11 serializes stored ASTs, so the RULE is already
right; what was missing is that nobody noticed a new producer of numbers had appeared this cycle.

Not fixed in code, deliberately: it is unreachable today, and only because `findUnsupportedFormulaAsts`
rejects every non-reference AST shape outright. A check added now would be dead twice over.
**D-031** instead binds the fix to the exact cycle that removes the shield: whichever cycle deletes
`findUnsupportedFormulaAsts` must, in the same cycle, extend the existing value-legality walk to
formula ASTs. The false claim in `lexer.ts`'s header is corrected in place — it is the kind of
sentence a later model relies on rather than re-derives.

## 4. Spec conformance — checked, no change needed

- **The precedence chain matches §5.3 tier for tier**, loosest to tightest, including the one that
  is easy to get backwards: unary binds TIGHTER than `^` (the brief lists `^` before `unary -/NOT`
  in its loosest-to-tightest ordering), so `-2^2` is `(-2)^2`. `parsePowerExpr` delegating its
  operands to `parseUnaryExpr` gets this right, and `2^-3` parses as well.
- **`^` left-associativity** (implementer question 2) — correct, and ruled as **D-030** so it is
  not "corrected" later by someone who knows the mathematical convention and not the brief's. §1
  names Excel as this project's formula-engine model and Excel's `^` is left-associative. Taking it
  as an implementation decision rather than a `Q-NNN` was right — it is reversible, since §5.11
  stores ASTs and never re-parseable source — but the reasoning belonged somewhere binding.
- **`SUM((A1:B4))` accepted** (implementer question 1) — correct, and the right trade. §5.3's rule
  is about semantic placement, and a redundant paren is transparent in a grammar with no
  `ParenNode`. I checked the cases where a post-parse walk could plausibly be too permissive and it
  is not: `SUM(A1:B4 + 1)` is rejected (the range's parent is `+`), `SUM((A1:B4) + 1)` is rejected,
  `SUM(IF(x, A1:B4, y))` is rejected (`IF` is not an aggregate, so it does not pass the flag down),
  and `SUM(A1:B4) + 1` is accepted. The walk keys on the range's actual parent, which is the right
  structural question.
- **D-029 implemented correctly in both directions** — `AND(a, b)` parses to a `FunctionCallNode`,
  `a AND b` to a `BinaryOpNode`, via keyword tokens plus one-token `(` lookahead. `parser.ts`
  cannot enforce D-029's evaluation half and correctly says so; that still binds `functions.ts`.
- **`isCellReferenceForm` on a load-bearing file** (implementer question 3) — proportionate as
  handled. It is additive, changes no existing export's behaviour, reuses rather than duplicates,
  and was flagged in the entry, in STATUS, and in the file's own "NOT DONE HERE" section. One
  bullet was enough; §6.2 does not demand more, and the phase gate will re-audit `address.ts`
  anyway. The thing that needed flagging harder was not the export — it was the hand-built path at
  the call site (finding 2).
- **`Q-004` inherited, not re-litigated** — correct, and pinned by a test naming it.
- **Function name/arity deferred to `functions.ts`** — correct. The one narrow aggregate-name set
  is genuinely needed for range placement and is disclosed as folding into the registry later.

## 5. Legibility audit

Headers present, layered, and unusually good at recording *why*. Vocabulary locked. No `any`
anywhere in `src/engine/`. Test names are behaviour sentences that name the rule they defend.

Two notes, no action: the file headers are getting long enough that the signal-to-length ratio is
starting to fall (`parser.ts`'s is ~145 lines before the first import), and a claim in a header is
load-bearing documentation — finding 4 is exactly the failure mode of a header sentence that was
true when written, then quietly stopped being. When a header asserts that another module checks
something, check it.

## 6. Honesty audit

Re-ran rather than read: both tsconfigs clean; `npm test -- --run` gives 317/317 across 11 files;
`grep` for `.only`/`.skip`/`it.todo` across `src/` returns nothing. The +36 and +46 test counts, the
"none changed or removed" claims, and both entries' mutation-check transcripts match the tree. The
D-016 experiments are well chosen — cycle 0031 picked the three places genuinely least obvious on
inspection, and reported blast radius honestly (including that the bare-cell-ref mutation takes out
all 8 range tests, because every range fixture is built from bare cell refs).

Both entries disclose their own weak points without being asked, including two that a less honest
log would have omitted entirely (`SUM((A1:B4))`, `^` associativity). That is the standard.

**One process finding.** §6.3's cap was exceeded by 2.2× — 1768 lines against 800. Entry 0031 says
so plainly and stops, which is the right ending. But the cap was foreseeable one cycle earlier:
entry 0030 closed at **707 lines / 800**, described in that entry as "well under the 800/10 cap."
707/800 is 88% of it, with `parser.ts` — the file both 0029-REVIEW and 0030 itself predicted would
be the densest of the phase — declared as the next slice. §3 step 7 asks for that judgment at the
END of a cycle, when the next slice's size is already foreseeable. The right move at 707 was to
stop. Concretely, for the next batch: **a cycle that would start with less than ~200 lines of
headroom under the cap should end the batch instead.** A reviewer auditing 1768 lines in one pass
is a worse reviewer than one auditing two batches of 900, and that is the whole point of the cap.

## 7. Open questions

- **Q-004** — still OPEN, still Phase 2, correctly inherited rather than re-decided. Now has a
  second consumer (`parser.ts`) and a second door onto its hazard (finding 2), which the new
  `bareCellAddress` test guards.
- **Q-007, Q-008** — unchanged, still provisional, one tagged site each.
- **Q-001/Q-002** (Phase 3) — deferral reaffirmed.
- No new question was raised this batch, and none should have been: every judgment call in these
  two cycles was reversible and correctly taken as an implementation decision, with the one
  qualification that `^`'s associativity is now ruled (D-030) rather than left as a file comment.
- Next free question id: **Q-010**.

## 8. Edits made (all verified: both configs clean, 321/321 tests pass, 0 skipped)

1. `formula/parser.ts` — `isParseError` discriminates on `error === "#PARSE"` (finding 1, D-032),
   with the reason in its doc comment.
2. `formula/parser.ts` — `walkForRangePlacement`'s `default:` returns a `#PARSE` instead of
   throwing, keeping the `never` assignment for compile-time exhaustiveness (finding 3).
3. `address.ts` — added `bareCellAddress(tableObjectId, cellReference)`, the other half of
   `isCellReferenceForm`; `formula/parser.ts` calls it instead of hand-building `["cells", only]`
   (finding 2).
4. `formula/lexer.ts` — corrected the header's false claim that `mutate` already checks numbers
   inside stored ASTs (finding 4).
5. Tests: `parser.test.ts` +3 (`isParseError` against a real `ParseError`, against an `ErrorNode`,
   against other AST variants and a plain `Address`); `address.test.ts` +1 (`bareCellAddress`
   agrees with `parseAddress` for the same cell). 317 -> 321.
6. `DECISIONS.md` — **D-030** (`^` left-associative; Excel breaks §5.3's ties), **D-031** (numbers
   inside stored ASTs are document state; the fix is bound to the cycle that deletes
   `findUnsupportedFormulaAsts`), **D-032** (error predicates discriminate on the code).
   `STATUS.md` — verdict, cadence line reset, findings folded into Known problems and Gotchas.

## 9. Carried constraints for the next cycle

1. **`deps.ts` is unblocked** — `extractDependencies`, eager and TOTAL across both `IF` branches
   and both syntactic forms of `AND`/`OR`/`NOT` (§5.3, D-029). It must yield nothing for an
   `ErrorNode` (D-028) and every endpoint of a `RangeNode` is Phase 2's expansion problem, not
   `deps.ts`'s — say which you chose in the file header.
2. **Reset the batch counter and respect it.** Cycles since review: 0/3, 0 lines. End the batch
   before starting any cycle that cannot fit in the remaining headroom (see §6).
3. **D-031 is a tripwire on a specific future commit.** Do not delete
   `findUnsupportedFormulaAsts` without extending the value-legality walk to formula ASTs in the
   same cycle.
4. **D-029 remains unimplemented and still binding** — it constrains `functions.ts`/`eval.ts`, not
   `parser.ts`, which has done its half correctly.
5. **When a file header claims another module checks something, verify it before relying on it.**
   Finding 4 cost nothing this time only because a temporary check happened to be in the way.

## Verification (real output, after edits)

```
$ npx tsc --noEmit                                -> clean
$ npx tsc --noEmit -p tsconfig.engine.json        -> clean
$ npm test -- --run
 Test Files  11 passed (11)
      Tests  321 passed (321)
```

317 -> 321 (+4, all new; none changed or removed). 0 skipped, 0 `.only`.
`grep -rn "MUTATION-TEST" src/engine/` clean.
