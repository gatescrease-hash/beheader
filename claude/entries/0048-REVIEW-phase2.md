# 0048 — REVIEW (phase 2)
Date: 2026-08-24   Phase: 2   Model: reviewer
Previous entry: 0047-row-column-insertion   Last review: 0045-REVIEW-phase2 (verdict: REVISE)
Reviewing: entries 0046 + 0047 (~1147 lines / 9 files since 0045-REVIEW-phase2)

## 0. Verdict

**REVISE.** Three fixes, §8. The design is right and the shape of the insertion slice is right —
`InsertTableLineOperation`, the single-source shift arithmetic, the whole-document
reference-adjustment pass, and the empty-new-line-relies-on-D-047 move are all confirmed and all
three of entry 0047's reviewer questions are answered in its favour (D-051, D-052, and D-050's
split half). What fails is narrower and entirely in `insertTableLine`'s **slot bookkeeping**: it
rebuilds an object's `slots` from scratch and silently destroys every slot it does not know about,
which is reachable through the sanctioned API today and becomes a data-loss bug the moment Phase 3
gives a table `origin.x`/`origin.y`. Plus one undisclosed false-rejection in the batch precondition
check.

Four new rulings: **D-049**, **D-050**, **D-051**, **D-052**.

Reviewer edits made directly (§7): 15 misattributed cycle numbers in source comments.

## 1. Honesty audit — the log matches the diff

Re-ran everything rather than reading the claims:

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  575 passed (575)
```

575/575 confirmed, 0 skipped, 0 `.only` (grepped). The diff is what entry 0047 says it is: three
source files, three test files, no undeclared scope expansion, no runtime dependency, no `any`, no
`throw` in `src/engine/`. Rule 1 grepped clean (`document.`/`window.`/`canvas`/`render/` — the only
hits are `document.ts`'s own local parameter named `document` and two prose mentions in comments).

The **Phase 2 clause 3 claim is honest and better than it needed to be**: the acceptance test
asserts the STORED AST widened from `A1:A5` to `A1:A6` before it asserts any number, then proves the
widening is real by setting the new row's cell and watching the sum move 15 → 115. That is the
right way to demonstrate that clause and it genuinely demonstrates it.

One honesty defect, corrected by me rather than listed as a fix (§7): **fifteen comment sites in
source attributed this cycle's work to "entry 0046,"** and `table.ts`'s header stated that entry
0046 closed the D-047 fix list "and then, in the SAME cycle, built row/column INSERTION." Insertion
is entry 0047, a separate cycle. `STATUS.md` and the log entry both had it right; only the source
comments were wrong. It matters because those comments are how the next model dates a design
decision, and it is exactly the kind of drift §5.4's "no changelog comments in source" is meant to
avoid — the per-cycle history paragraphs in these headers are accepted practice in this repo, so
they have to stay accurate.

## 2. Rule audit

- **Rule 1 (engine is pure)** — upheld, grepped mechanically. Not otherwise at stake in this diff.
- **Rule 2 (all state change through `mutation.ts`)** — upheld. `insertTableLine` and
  `rewriteObjectFormulaAddresses` both RETURN new objects; nothing mutates in place, every field
  stays `readonly`, and the only writer is `applyOperation`'s fold.
- **Rule 3 (two-layer addressing)** — upheld and load-bearing here. The reference-adjustment pass
  rewrites stored `Address`es (IDs), never names; `shiftCellAddressForInsert` reconstructs a cell
  reference through `formatCellReference`, never by string concatenation.
- **Rule 5 (dumbest correct implementation)** — upheld, and correctly argued. Rewriting EVERY
  object's ASTs with no relevance pre-filter (entry 0047 decision 5) is the right call for exactly
  the reason given: a pre-filter would be a second place the "is this address relevant" decision
  lives, free to drift from `shiftCellAddressForInsert`.
- **Rule 6 (evaluation never creates or destroys slots)** — upheld, and strengthened.
  `insertTableLine` re-asserting `literal` on both dimension slots is the right instinct (a resize
  is the moment to re-establish D-046, not to preserve whatever kind was there). But see §4: doing
  it by REWRITING a `formula` dimension into `literal 1` while deleting the cells is not the same
  thing as refusing to resize a table it cannot read.
- **Rules 4, 7** — not touched.

## 3. Invariant audit

Slot set fixed during evaluation, derived slots inside the topological pass, eager/total dependency
extraction, lazy evaluation, rejection leaving prior state bit-for-bit unchanged, plain serializable
graph state — all untouched by this diff and all still hold. `rewriteAddressesInAst` is total over
all seven `FormulaAst` shapes with an exhaustiveness `never` arm; verified against `ast.ts`.

"**No dangling edges**" deserves more than a line, because it is where this diff's defect surfaces:
the invariant HOLDS in every case I could construct. When `insertTableLine` drops a slot that had a
dependent, edge re-derivation and `validateIntegrity` catch it and the whole mutation is rejected —
state is protected. The bug is not a corrupted graph; it is silent slot loss when nothing happened
to depend on the slot, and a misleading rejection message when something did.

## 4. What is actually wrong — `insertTableLine` rebuilds `slots` from scratch

```ts
const newSlots: Record<string, Slot> = {
  [slotKey(TABLE_ROWS_PATH)]: { kind: "literal", value: ... },
  [slotKey(TABLE_COLS_PATH)]: { kind: "literal", value: ... },
};
for (const path of enumerateTableCellSlotPaths(object)) { ... }
return { ...object, slots: newSlots };
```

Every slot that is not `rows`, `cols`, or a cell path within the CURRENT extent is gone. Verified
against the built code, all four committing `ok: true` unless noted:

1. `table_x.note` (a literal slot at an unrecognised path) — **deleted** by the next row insert.
   Reachable: D-017's check rejects UNDECLARED `formula`/`derived` slots only, so an undeclared
   LITERAL commits normally. I confirmed the `setSlot` that creates it commits.
2. `cells.A5` on a 2×2 table (a cell outside the extent — the coherence gap `STATUS.md` has carried
   as a known problem since 0043) — **deleted** by the next row insert.
3. A table whose `rows` is a `formula` slot holding literal cells — the insert commits `ok: true`,
   **deletes every cell**, and rewrites `rows` to `literal 1`. `readTableDimension` correctly
   returns `0` for a non-literal dimension (D-046), so `bound + 1` becomes `1` and
   `enumerateTableCellSlotPaths` yields nothing to carry over. The D-046 guard is doing its job;
   `insertTableLine` is drawing the wrong conclusion from it.
4. The same as (1) or (2) with a dependent reading the dropped slot — the mutation is REJECTED with
   `"value_1.value references a slot that does not exist"`. Safe, but it blames the user's formula
   for a row insertion.

None of this is hypothetical and none of it is a corner the brief left ambiguous — a mutation may
only remove a slot as its specified effect (§5.1.1). The decisive argument is forward-looking:
§5.10's command line is `table x=0 y=0 rows=8 cols=8`, so Phase 3 gives tables position slots. On
the day that lands, under this shape, inserting a row silently deletes a table's position — and
nothing in this file would fail a test to say so. That is why the ruling (**D-049**) is "carry
through every slot you do not own," not "also copy `origin`."

The fix is small and it is the smaller diff: start from `object.slots`, remove the cell keys being
moved, write the shifted ones.

## 5. The batch precondition check rejects legal batches

`findInvalidTableResizes` validates every operation against PRE-BATCH `objects`. Entry 0047
disclosed the resulting false-ACCEPT (a same-batch `createObject`d table is not validated) and
argued the clamp makes it tolerable. That argument is fine as far as it goes, but it misses the
other direction, which the entry did not disclose because it was not looked for:

```
mutate(table_2x2, [insert row at index 1, insert row at index 4])
→ ok: false, "operation 2 of 2: row insertion index 4 is out of range for
   \"table_x\" (currently 2 rows; must be an integer from 1 to 3)"
```

By the time operation 2 applies, the table has 3 rows and index 4 is legal. "Insert three rows at
the end" is an ordinary batch, and §5.1 both requires batching and names multi-step commands as its
caller. A clamp can rescue a false-accept; nothing rescues a false-reject, because the mutation
never runs at all.

`mutate` already has the pattern this needs — the existence check simulates the batch left-to-right
in `survivingIds`. Tracking a per-object `{rows, cols}` through the same `forEach` closes BOTH the
false-reject and the disclosed same-batch-creation false-accept in one loop. **D-050.**

## 6. Answers to entry 0047's three reviewer questions

1. **Unified `axis` shape vs. two operation kinds** — the unified shape is right, CONFIRMED as
   built. Deletion still gets its own kind. Ruled **D-051** so the next cycle cannot relitigate it
   in either direction (no "insert with a negative index," no splitting row/column apart).
2. **Clamp-in-the-primitive / reject-in-the-pre-check** — the SPLIT is right and matches D-045; keep
   it. The pre-check's use of pre-batch state is not, for the reason in §5 — that is the half that
   changes (**D-050**). The disclosed same-batch gap does not need a separate ruling; the same
   simulation loop closes it.
3. **`rewriteAddressesInAst` in `deps.ts` vs. its own file** — stays in `deps.ts`, ruled **D-052**.
   Keeping every total `FormulaAst` walk adjacent means an eighth node type breaks all of them in
   one compile. **Read D-052's forward note before designing deletion**: the `(Address) => Address`
   signature cannot express `#REF` repair (a NODE-level replacement) or range-endpoint clamping
   (needs both endpoints at once). Deletion needs a second, node-level walk in that file — not a
   widened callback on this one. Finding that out now is worth a cycle.

## 7. Reviewer edits made (comment-only, tree re-verified green after)

Corrected 15 sites attributing entry 0047's insertion work to "entry 0046," and reworded
`table.ts`'s header sentence claiming entry 0046 built insertion in the same cycle as the D-047 fix
list. Files: `formula/deps.ts`, `formula/deps.test.ts`, `mutation.ts` (5 sites; `mutation.ts:119`'s
"fixed THIS cycle (0046)" is CORRECT and was left alone), `mutation.test.ts`,
`primitives/table.ts` (5 sites + the header sentence), `primitives/table.test.ts` (3 sites). No
behaviour touched; `npm run typecheck` clean and 575/575 after.

## 8. Fix list — REVISE

1. **`insertTableLine` must preserve every slot it does not own (D-049).** Build the new `slots`
   from `object.slots`, removing only the cell keys it is about to move and writing their shifted
   replacements; leave every other key untouched. Tests: a non-cell literal slot survives an insert;
   an out-of-extent cell slot survives an insert; and — the one that would have caught this — a test
   whose name says a table's UNRECOGNISED slots survive a resize, so the Phase 3 `origin.x` case is
   defended before it exists.
2. **`findInvalidTableResizes` must simulate the batch (D-050).** Track each target object's
   `{rows, cols}` as the check walks the operation list, seeding from `objects` OR from a same-batch
   `createObject`'s payload, and validate each `insertTableLine` against the state as of its own
   position. Tests: two inserts on the same table in one batch both commit (the §5 false-reject);
   an out-of-range index in a LATER operation is still rejected; and an `insertTableLine` on a table
   created earlier in the same batch is now validated rather than skipped. Delete the
   now-obsolete "disclosed gap" paragraphs from both doc comments — do not leave a disclosure
   describing behaviour that no longer exists.
3. **Reject an insert into a table whose `rows`/`cols` is not `literal`, rather than silently
   resetting it.** §4 case 3: `readTableDimension` correctly reads a non-literal dimension as `0`
   (D-046), and `insertTableLine` currently turns that into "this table has no cells and one row."
   A table whose extent cannot be read cannot be coherently resized — say so in
   `findInvalidTableResizes` with a message naming D-046, the same way the other rejections name
   their reason. Test: the insert is rejected and the table is left bit-for-bit unchanged.

Not on the fix list, deliberately: the `rows`/`cols` upper bound and the dimension/cell coherence
gap (both still `STATUS.md` known problems), and `describeValueType`'s duplication. Fix 3 narrows
the coherence gap where it is now reachable; closing it in general is the deletion cycle's business.

## 9. Note for the deletion cycle (not a fix — record it, don't build it)

`rewriteObjectFormulaAddresses` walks `formula`-kind slots only. That is complete TODAY, because a
`formula` slot's `ast` is the only place a stored AST lives. §5.4 is explicit that the adjustment
pass covers "other tables and **text boxes**," and Phase 4's text stores its content as a parsed
block tree in a different shape — so the day text lands, this pass silently stops being total unless
someone extends it. Added to `STATUS.md`'s known problems. Do not build for it now.

## 10. Phase 2 gate status

Not claimed, correctly. Clauses 1–3 PASS (verified). Clause 4 — row/column delete with `#REF`
repair, `delete <table>` rejected-until-`force` — remains the only outstanding one, and it is the
next slice. The gate review happens when that lands, not before.

## 11. Open questions

`OPEN_QUESTIONS.md` needs no new entries — entry 0047 raised none, and it was right not to: its
three questions were design confirmations, not brief ambiguities, and they are now D-051, D-052,
and D-050. Q-007 and Q-008 remain open and still block nothing.
