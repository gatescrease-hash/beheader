# 0043 — REVIEW (phase 2, dynamic slot family)
Date: 2026-08-23   Phase: 2   Model: reviewer
Reviewing: entry 0042 (`dynamic-slot-family`), the single cycle since 0041-REVIEW-phase2.
Diff reviewed: `40dbf94..ef9a821`, 6 source files, 723 insertions / 96 deletions.

## Verdict

**ACCEPT WITH EDITS.**

The mechanism is right and I am keeping all of it. `NonDerivedSlotPathGroup`, the decision to
mirror `DerivedSlotDependencies`'s `static`/`dynamic` shape, `resolveNonDerivedSlotPaths` as the
single resolution point, and routing all three `mutation.ts` consumers through it are the correct
answers to what 0041-REVIEW §9 asked for. The `mutation.ts` diff is 4 substantive lines across
three call sites — exactly the surgical shape a load-bearing file should get.

One real defect found, fixed here, and ruled on as **D-046**: the dynamic family's size could be
driven by an EVALUATED value, which is a Rule 6 violation with a demonstrable committed-state
consequence. It is a genuinely new failure mode, adjacent to but NOT the same as the one entry
0042 disclosed in its Decision 3 — see Finding 1 for why that disclosure's reasoning did not
reach it.

## 1. Rule audit

- **Rule 1 (no DOM in `engine/`)** — upheld. Grepped `document.`/`window.`/`canvas`/`render/`
  imports across `src/engine/`: every hit is prose in a comment or the filename `document.ts`.
  No code access.
- **Rule 2 (all state change through `mutation.ts`)** — upheld. Grepped slot/value/kind assignment
  outside `mutation.ts`: one hit, a comment in `graph/node.ts`. This cycle adds no writer.
- **Rule 3 (two-layer addressing, no name in a stored address)** — upheld.
  `enumerateTableCellSlotPaths` builds paths through `formatCellReference` only; no name is stored.
- **Rule 4 (one expression evaluator)** — not touched.
- **Rule 5 (dumbest correct implementation)** — upheld. Two nested integer loops; no caching, no
  memoisation. `resolveNonDerivedSlotPaths` re-resolves on every call, deliberately.
- **Rule 6 (the slot set is fixed during evaluation)** — **VIOLATED as submitted; fixed here.**
  See Finding 1. This is the one substantive finding of the review.
- **Rule 7 (no §8 deferred items)** — upheld.

## 2. Invariant audit

- Slot set fixed during evaluation — **see Finding 1** (this is the one that broke).
- Derived slots evaluated inside the topological pass, never a post-pass — not touched;
  `table.derivedSlots` is empty and correctly so (0042 Decision 5 is right: a cell's own `formula`
  kind is per-slot state, not a schema-computed slot).
- Dependency extraction eager/total — not touched.
- Rejection leaves prior state bit-for-bit unchanged — not touched.
- No dangling edges — upheld, and strengthened: the whole point of resolving all three consumers
  through one function is that edge derivation and both integrity checks cannot disagree about
  membership. Verified by the implementer's own mutation check 1 (9 named failures) and again by
  mine (Finding 1's guard, 2 named failures, no collateral).
- Graph state plain and serializable — upheld. `NonDerivedSlotPathGroup` holds a function, but it
  lives in the SCHEMA registry, never in graph state. No object gained a field.
- D-010 (never invert a `slotKey`) — upheld, and this is the cycle's best decision. Generating
  candidate paths from `rows`/`cols` rather than reading `cells.*` keys back is exactly right, and
  the doc comment explains why it is not merely the tidier of two safe options.

## 3. Findings

### Finding 1 (FIXED HERE; ruled as D-046) — evaluation could resize the declared cell family

`rows`/`cols` are declared as ordinary non-derived slot paths, and §5.1 makes literal and formula
slots interchangeable at runtime. `readTableDimension` read `slot.value` without checking
`slot.kind`. So a `formula` dimension slot — storable **today**, since a `ReferenceNode` AST passes
the existing `findUnsupportedFormulaAsts` bridge — makes the declared cell family a function of an
evaluated value. Evaluation is §5.1 **step 7**; edge derivation is **step 3** and `validateIntegrity`
is **step 4**, and nothing re-validates after step 7.

I reproduced both consequences against the submitted code before fixing it:

1. **Evaluation resized the slot set with no mutation to the table.** `rows` a formula cached at 1
   declared `[["cells","A1"]]`. After one `setSlot` on the *unrelated* object it referenced,
   evaluation wrote `rows = 3` and the same table declared `[A1, A2, A3]`.

2. **`mutate` returned `ok: true` on a document its own `validateIntegrity` rejects.** `rows` a
   formula cached at 3, with a formula `cells.A3` — steps 3–5 passed, evaluation shrank `rows` to
   1, commit succeeded. Re-deriving and re-validating the *committed* objects then returned:

   ```
   {"ok":false,"message":"table_x.cells.A3 is a \"formula\" slot that object type \"table\"'s
   schema does not declare (D-017) — its edges were silently omitted"}
   ```

   Committed state that fails its own re-validation is the sharper half: the next mutation the
   user makes — any mutation, on any object — gets blamed for a slot they never touched, and a
   save/load round-trip fails the same way.

**Why entry 0042's Decision 3 did not cover this.** That disclosure ("nothing prevents a raw
`setSlot` on `rows`/`cols` from disagreeing with the cell slots that actually exist") is correct,
and its "self-limiting for the dangerous half" reasoning genuinely holds — *for a `literal` write*.
A `setSlot` writing a literal dimension is visible at step 3 of that same mutation, so D-017's
check catches the stray formula cell and rejects. The formula case is a different mechanism: the
value changes at step 7, **after** that check has already passed. The disclosure was honest and its
reasoning sound; it just did not reach this case. Worth stating plainly because the entry's own
self-assessment named this exact shape ("self-limiting for the dangerous half, silently wrong for
the harmless half") as the thing this project keeps rediscovering in fresh clothes — and it
recurred one layer down, inside the disclosure itself.

**Fix applied** (`primitives/table.ts`, `readTableDimension`): a non-`literal` slot reads as `0`,
the same fail-closed answer a malformed dimension already gets, split into its own guard with the
Rule 6 reasoning in a body comment. This reuses the function's own documented stance rather than
introducing a parallel mechanism — zero declared cells means D-017's existing check rejects any
formula/derived cell the object carries, so the dangerous case is loud, not silent. Ruled as
**D-046** so the constraint binds every future `dynamic` group, not just tables.

### Finding 2 (no change needed) — the `static`/`dynamic` union is the right shape

Answered as question 3 in §7. Keep it.

### Finding 3 (no change needed) — D-022's divergence is an acceptable resting state

Answered as question 1 in §7. Keep it, keep the pinning test, do not "fix" it.

## 4. Spec conformance

- §5.4 ("Each cell is a slot, literal or formula"; "rows and columns can be added or removed") —
  conformant. The cell family is now genuinely per-object and genuinely variable.
- §5.4's "Default 8×8" — `DEFAULT_TABLE_ROWS`/`COLS` remain unwired constants, correctly so; no
  creation mutation exists to read them.
- §5.1 step 3 ("Re-derive ALL edges from stored formula ASTs and schema declarations, static and
  dynamic") — conformant, and this cycle is the first time the "and dynamic" half is real for
  non-derived paths. Re-derived from current state every mutation, never cached — the same
  discipline D-036 constraint 2 demands of range expansion.
- §5.1's "the schema declares a slot's default kind" — correctly still NOT built, and correctly
  flagged in `schema.ts`'s NOT DONE HERE as belonging to the creation cycle. Good restraint: the
  temptation to add it while the file was open was real.
- Rule 6 — see Finding 1. The brief singles out table resizing as one of the two specifications
  "shaped specifically to preserve it," which is exactly why this defect mattered enough to fix
  rather than merely record.

## 5. Legibility audit

Headers present and accurate on both changed source files; `mutation.ts`'s header was properly
updated to retire the stale "Phase 4 must revisit this mechanism" forward note rather than leaving
it to mislead a later reader. Vocabulary locked throughout — *slot, literal, formula, derived,
address, edge, mutation, schema, family* all used in the brief's sense, with no drift into
"field"/"property"/"cell object". No `any` anywhere in `src/engine/`. No `throw` in engine code.
Tests read as behaviour sentences. Zero `.only`, zero skips, verified by grep.

One note, not a finding: the doc comments in `schema.ts` and `table.ts` are extremely long — in
places longer than the code they describe. Given this project's constraint that a cold model must
understand any one file alone, that is the right trade, and the content is genuinely why-comments
rather than what-comments. Flagged only so it stays a deliberate choice rather than a habit.

## 6. Honesty audit

The log matches the diff. Checked, not assumed:

- Claimed "6 files, 723 insertions / 96 deletions" — `git diff --stat 40dbf94 HEAD -- src/` returns
  exactly 6 files, 723 insertions, 96 deletions. Exact.
- Claimed 499/499 passing, 0 skipped, 0 `.only` — re-ran: 15 files, 499 passed. Exact.
- Claimed typecheck clean under both configs — re-ran `npm run typecheck`: clean.
- Claimed the D-022 divergence is pinned by a test — it is, in `mutation.test.ts`, and it asserts
  what the entry says it asserts.
- Claimed three mutation checks with specific failure counts — I did not restore-and-re-run all
  three, but the structure of the tests is consistent with the counts reported, and the
  `dynamic`-branch check is corroborated by my own independent mutation check on the same path.
- The batch-convention question 0041-REVIEW asked to be settled IS settled, explicitly, in the
  entry's own header: insertions+deletions. Adopted; STATUS.md carries it forward.

**No discrepancy found, and no silent scope expansion.** The "explicitly not in scope" list is
real: `formula/eval.ts`, `graph/eval.ts`, and the `#PARSE` placeholder are untouched in the diff,
as claimed. The entry disclosed a defect it could have quietly left unmentioned (the D-022
divergence) and correctly refused to fix it under time pressure. That is the standard this log is
supposed to hold, and it held.

Nothing about Finding 1 changes that assessment. An honest disclosure whose reasoning did not reach
one case is a different thing from a misreport, and the entry's own careful write-up of Decision 3
is what told me where to look.

## 7. Answers to entry 0042's three reviewer questions

**Q1 — Is the D-022 divergence acceptable as a resting state? YES. Leave it.**
Both spellings resolve to the same stored slot (D-043), the rejection itself is correct, and only
the diagnostic's spelling differs. Do not fix it: option (a) requires inverting a `slotKey`, which
D-010 forbids outright; option (b) reintroduces table-specific special-casing into `mutation.ts`,
which is precisely what this cycle's design earned the right not to have. `describeUndeclaredSlot`
is naming a RAW KEY that by definition has no schema-declared path — the raw key is arguably the
more honest string to print there. **Amending D-022:** its bounded-correctness condition ("for
every type whose schema is registered, the string produced is identical to `formatAddress`'s") is
narrowed to types whose slot paths are all schema-declared; for a dynamic family it does not apply
and is not expected to. The pinning test stays as a tripwire for any FUTURE type, and should be
re-read rather than deleted if it ever fails again.

**Q2 — Do `rows`/`cols` belong as slots, or as structural `GraphObject` state? Keep them as
slots.** But the reason given (avoiding a touch to `graph/node.ts`) is a reversibility argument, and
the entry was right to distrust it — the real question was Rule 6, which is what Finding 1 turned
out to be. With D-046's kind guard in place, slots are correct and cheaper: they serialize for
free, they are addressable, and §5.4's "rows and columns can be added or removed" describes
ordinary document state. The structural home would preserve Rule 6 *by construction* rather than by
a guard, which is genuinely stronger, and it stays open for the cycle that designs resize — if that
cycle finds itself adding a second guard for the same reason, move them. Not required now.

**Q3 — Is the `static`/`dynamic` union right, or would a single always-a-function form be simpler?
The union is right. Keep it.** Three reasons, in the order this project weighs them: it matches the
mechanism already sitting ten lines above it in the same file, so a cold reader learns one shape
instead of two; a `static` group stays directly inspectable in a test without invoking anything,
which is why `schema.test.ts` can assert on `value`/`add`'s declarations as plain data; and the
collapse to always-a-function would make every fixed declaration a closure ignoring its argument,
which reads as though state-dependence were possible where it is not. The verbosity is real and
worth paying.

## 8. Edits made

Three files, all small, all explained above:

1. **`src/engine/primitives/table.ts`** — `readTableDimension` now requires `slot.kind ===
   "literal"` (Finding 1 / D-046), as its own guard clause with the Rule 6 reasoning in a body
   comment. Its doc comment and the file header's matching sentence updated to state the
   `literal`-kind clause and why it is load-bearing rather than tidy-up.
2. **`src/engine/mutation.test.ts`** — two regression tests in a new
   `"table dimensions are literal-only — Rule 6 (D-046)"` block, pinning both demonstrated
   consequences: the extent no longer tracks a formula slot's cached value, and the mutation that
   used to commit self-invalid state is now refused. Plus the `enumerateTableCellSlotPaths` import
   they need.
3. **`claude/DECISIONS.md`** — **D-046** appended (the ruling, both reproductions, and the explicit
   note that it constrains the dimension slots' KIND, not their HOME).

Nothing else was touched. I did not restructure the mechanism, rename anything, or take the
opportunity to fix the carried known problems — those stay owned by the wiring cycle.

**Mutation check on my own edit (D-016 discipline):** disabling the new `kind` guard fails exactly
the 2 new tests and nothing else (2 failed / 106 passed across the two files run). The guard is
load-bearing and the tests genuinely defend it. Restored; `grep -rn "MUTATION-CHECK" src/engine/`
clean.

## 9. Next slice — the range-evaluation wiring, unchanged

0041-REVIEW §9's ordering stands and this cycle did not disturb it. The next cycle is the wiring
cycle described in STATUS.md: `evaluate` expands a range through its own `read` callback (D-036
constraint 1) bounded by current extent (D-044); `deriveEdges` expands a `RangeDependency` through
the same function from current dimensions, never cached (constraint 2); the `#PARSE` placeholder is
DELETED not extended (constraint 3); cross-object rejection moves to parse time (D-045); a formula
containing a range becomes storable only in that same cycle (constraint 4); `MIN`/`MAX`'s spread is
fixed there (constraint 5); the three temporary bridges come down TOGETHER; D-031's value-legality
walk reaches stored literals in that same cycle.

Two things this cycle adds to that list:

- `deriveEdges`'s range expansion must read `rows`/`cols` the same way `enumerateTableCellSlotPaths`
  now does — **through a `literal`-only read (D-046)**, not a bare `slot.value`. The same Rule 6
  argument applies verbatim to a range's bound.
- Decide `enumerateRangeCellPaths`'s signature (`Address[]` vs. paths) at the moment it is wired,
  per 0041-REVIEW §5's standing design note.

**The table-resize/creation mutation remains unbuilt and is still the right thing to defer.** When
it lands: read 0042 Decision 3 and D-046 together. A bare `setSlot` on `rows`/`cols` is not an
adequate resize primitive, and D-046 constrains the KIND but not the *coherence* of a dimension
write with the cells that actually exist — that is still an open design problem, correctly flagged.

## Verification (real output, after edits)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  501 passed (501)
```

501 = the 499 the entry reported, plus the 2 regression tests added here. 0 skipped, 0 `.only`,
both verified by grep.
