# 0051 — REVIEW (phase 2)
Date: 2026-08-24   Phase: 2   Model: reviewer
Previous entry: 0050-row-column-deletion   Last review: 0048-REVIEW-phase2 (verdict: REVISE)
Reviewing: entries 0049 + 0050 (~1708 lines / 6 unique source+test files since 0048-REVIEW-phase2)

## 0. Verdict

**REVISE.** Five fixes, §8. The deletion slice is right: `repairAddressesInAst`'s node-level shape,
the `Address | "deleted"` data channel that keeps `primitives/table.ts` blind to `FormulaAst` and
`formula/deps.ts` blind to tables, the value-based range tie-break, one widened simulation covering
insert and delete together, and D-049 applied to `deleteTableLine` by the same three-test parity
pattern — all confirmed as built. All three of entry 0050's reviewer questions are answered in its
favour (**D-054**, **D-055**, **D-056**).

What fails is one thing entry 0049 believed it had built and had not, plus three disclosure gaps:

1. **0048-REVIEW fix 3 landed on only one axis.** A row resize on a table whose `cols` slot is
   `formula`-kind commits `ok: true` and silently converts that slot to `literal 0` — the exact
   defect §4 case 3 of the last review ruled must be rejected, reached from the untouched axis.
   Entry 0049's decision 1 states, in detail, that both axes are checked. The code checks one.
   Live on insertion AND deletion. Verified against the built code (§4).
2. **Row/column deletion CAN still reject**, contrary to §5.4's own "proceeds even when other
   objects depend on the deleted cells" — reachable through the carried out-of-extent coherence
   gap. Verified (§5). Not to be patched on the delete side alone; disclosed and pinned instead.
3. **§5.1.1's and §5.4's "the command reports every slot it broke"** is unbuilt, unmentioned in
   entry 0050 anywhere, and structurally blocked by `applyOperation`'s return type. The `force`
   cycle needs the same channel; ruling it now (**D-057**) is what stops two being built (§6).
4. `STATUS.md` is 226 lines against PROCESS_BRIEF §2's <150 budget.

Six new rulings: **D-053**, **D-054**, **D-055**, **D-056**, **D-057**, and **D-058** (a convention
ruling on cycle attribution in comments — see §7).

Reviewer edits made directly (§7): 8 comment-only cycle-attribution sites.

## 1. Honesty audit — the log matches the diff, with one material exception

Re-ran everything rather than reading the claims:

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  643 passed (643)
```

643/643 confirmed, 0 skipped, 0 `.only`/`.skip`/`.todo` (grepped across `src`). Rule 1 grepped
clean — every `document.`/`window.`/`canvas`/`render/` hit in `src/engine/` is a header prose line
or `document.ts`'s own local parameter. No `any` anywhere in `src/engine/` (the five grep hits are
the English word inside comments). No `throw` in engine source; the hits are comments and test
helpers. No runtime dependency, no build step, no config file added. The diff is what entries 0049
and 0050 say it is, file for file.

Entry 0050's own log is unusually good on the two things this audit hunts hardest for. Its
mutation-test check 4 reports **finding a real coverage hole in its own first draft** (a
`delta`-direction mutation that killed nothing) and fixing it by adding a distinguishing test
rather than by waving the check through; its check 6 grades its own signal as "weaker than the
others." Both are the correct instinct and both are stated where an optimistic entry would have
folded them into a summary line. The Phase 2 clause-4 demonstration test is likewise honest: it
asserts `ok: true` FIRST (the defining property — deletion repairs, it does not reject), then the
stored `ErrorNode`, then the live `#REF` value, then re-derives and re-validates the committed
result for the dangling-edge check. That test earns its claim.

**The exception is entry 0049's decision 1**, and it is not a wording slip. The decision is argued
across seven lines — "`isTableDimensionResizable` checks BOTH `rows` and `cols`, not only the axis
being resized… If the untouched axis were `formula`-kind, an insert on the OTHER axis would
silently convert it to `literal` the same way — the identical defect class, just reached from the
other axis" — and it is correct in every word about what the code *should* do. The code does the
opposite: `isTableDimensionResizable(object, axis)` reads exactly one slot, and
`findInvalidTableResizes` consults exactly the flag for `operation.axis`. Entry 0049's own two
tests for fix 3 both exercise the targeted axis, so nothing caught the gap. This is the failure
mode §10's checklist is aimed at — the entry describes the intent, not the diff — and it is the
reason the honesty audit re-runs behaviour instead of reading claims.

## 2. Rule audit

- **Rule 1 (engine is pure)** — upheld, grepped mechanically. Not otherwise at stake.
- **Rule 2 (all state change through `mutation.ts`)** — upheld. `deleteTableLine`,
  `repairCellAddressForDelete`, `repairRangeEndpointsForDelete`, `repairAddressesInAst` and
  `repairObjectFormulaAddresses` all return new data; every field stays `readonly`; the only writer
  is `applyOperation`'s fold. **With one qualification** — §4's defect is a mutation changing a slot
  its own specification does not name, which is Rule 2's substance even though the write itself
  goes through the sanctioned path.
- **Rule 3 (two-layer addressing)** — upheld. Every repaired address is reconstructed through
  `formatCellReference`, never concatenated; no name enters a stored address.
- **Rule 5 (dumbest correct implementation)** — upheld. The document-wide repair with no relevance
  pre-filter is right for the same reason it was right for insertion, and entry 0050 gives that
  reason rather than re-deriving a new one.
- **Rule 6 (evaluation never creates or destroys slots)** — upheld by the deletion path itself
  (slots change at mutation time only). §4's defect destroys a slot's KIND at mutation time, which
  is D-049's territory, not Rule 6's.
- **Rules 4, 7** — not touched.

## 3. Invariant audit

Slot set fixed during evaluation, derived slots inside the topological pass, eager/total dependency
extraction, lazy evaluation, plain serializable graph state — untouched, all hold.
`repairAddressesInAst` is total over all seven `FormulaAst` shapes with an exhaustiveness `never`
arm; verified against `ast.ts`, and its `literal`/`error` arms return the node identically rather
than rebuilding it.

Two deserve more than a line:

**"No dangling edges" holds, and the repair genuinely produces that outcome.** I probed it directly
rather than trusting the suite: a deletion whose target cell has an external dependent commits, the
dependent's stored AST becomes an `ErrorNode`, and re-deriving over the committed result validates
clean. D-028's "an `ErrorNode` yields no dependency" is what makes the repaired edge disappear
rather than dangle, and that is the correct mechanism.

**"Rejection leaves prior state bit-for-bit unchanged"** — upheld; the delete-side rejection tests
assert it, and every rejection path returns before `cloneObjects` is even reached.

I also checked a hazard neither entry raises: **can clamping ever pull a cell into a range that
excluded it, creating a self-edge or a new cycle?** No. `shiftCoordinatesForDelete`'s map on
surviving lines (`v < index → v`, `v > index → v-1`) is strictly increasing, and
`clampRangeEndpointValue` sends a deleted endpoint to its surviving neighbour's new position, so a
cell strictly outside `[min, max]` before the deletion is strictly outside after it. Worked through
every ordering by hand. The invariant is safe by construction, not by luck.

## 4. Fix 3 of the last review landed on only one axis — and is live on both operations

`isTableDimensionResizable(object, axis)` reads one dimension slot. `findInvalidTableResizes` then
consults one flag:

```ts
const resizable = operation.axis === "row" ? state.rowsResizable : state.colsResizable;
```

But both primitives re-assert `literal` on **both** dimensions on every call — they have to, since
the untouched axis's count still has to be written back — and `getTableDimensions` reads a
non-`literal` dimension as a fail-safe `0` (D-046). Probed against the built code, with a table
carrying `rows: literal 3`, `cols: formula` (reading `value_1.value`), and three populated cells:

```
mutate([value_1, table_x], [insertTableLine table_x row 1])
→ ok: true
   cols slot after: {"kind":"literal","value":0}
   rows slot after: {"kind":"literal","value":4}

mutate([value_1, table_x], [deleteTableLine table_x row 1])
→ ok: true
   cols slot after: {"kind":"literal","value":0}
   rows slot after: {"kind":"literal","value":2}
```

A `formula`-kind slot — its AST, its cached value, and its inbound edge from `value_1.value` — is
destroyed and replaced with `literal 0`, committing `ok: true`, with nothing rejected and nothing
reported. The table is left claiming zero columns while still carrying its cells (which D-049 now
correctly preserves, so they simply become out-of-extent). This is 0048-REVIEW §4 case 3 exactly,
and D-049's own ruling covers it in terms: *a slot may only disappear from an object as the
EXPLICIT, specified effect of the mutation, and when it does, §5.1.1 applies in full.* A row
insertion's specified effect does not include reaching across to the column dimension.

Entry 0049 read fix 3's wording ("whose `rows`/`cols` is not `literal`") the right way and said so.
The implementation did not follow. **D-053** states the rule so the next resize-like operation
inherits it rather than re-deriving it: a resize precondition must find the table's **whole extent**
readable, not just the axis it is about to change.

## 5. Row/column deletion can still reject — §5.4 says it must not

§5.4 is unusually direct: *"Row/column deletion takes the repair path of §5.1.1, not the rejection
path. It proceeds even when other objects depend on the deleted cells."* Entry 0050's demonstration
test asserts this as "never a rejection." Probed:

```
pre-state: 3-row table, cells.A1 populated, cells.A5 populated (out of extent),
           text_1.value = table_x.A5   → deriveValidateAndEvaluate ok: true
mutate([...], [deleteTableLine table_x row 1])
→ ok: false, "text_1.value references a slot that does not exist"
```

The mechanism: the address-repair pass is **unbounded** — `repairCellAddressForDelete` shifts any
cell address on the table — while `deleteTableLine`'s slot walk is **bounded by the current
extent** (`enumerateTableCellSlotPaths`), so an out-of-extent slot correctly stays put per D-049.
The reference moves; the slot does not; the edge dangles; the batch is rejected, blaming the user's
formula for a row deletion.

Three things about this, in order of importance:

- It is the **same divergence on the insert side**, accepted at 0048-REVIEW as case 4 — so it is
  not a regression this cycle introduced, and fixing only the delete side would leave the two
  passes disagreeing about bounds, which is strictly worse than both disagreeing the same way.
- It is only reachable through the carried **dimension/cell coherence gap** (a cell slot outside
  the extent, creatable only by a raw `setSlot`; the eventual command line's address resolution is
  extent-bounded and would refuse to write one).
- But deletion is where it **contradicts the brief outright**, which insertion never did. So it
  stops being "an incoherent document behaves oddly" and becomes a stated-behaviour violation.

Therefore: **not patched now, and explicitly not patchable on one side** (D-053's rationale text in
`DECISIONS.md`, and fix 2 below). It gets a pinning test and a `STATUS.md` known problem, and the
cycle that closes the coherence gap in general closes this with it. That is the smaller diff and
the one that cannot drift.

## 6. The brief requires reporting every slot it broke. Nothing does, and nothing says so.

Twice, in two sections, about this exact mechanism:

- §5.1.1, on the repair path: *"The command must report which slots were broken."*
- §5.4, on row/column deletion: *"The command reports every slot it broke."*

Entry 0050 does not build it, does not defer it, does not list it as unfinished, and does not name
it as a known problem. Its "Explicitly not in scope" covers the `force` flag and the coherence gap;
this clause appears nowhere in the entry, in `STATUS.md`, or in any doc comment. Grepped: no
collector, no report field, nothing.

The Phase 2 acceptance criterion (§6) does not require it, so entry 0050's "clause 4's DELETE half
NOW PASSING" claim stands and I am not disputing it. This is a §5.4 conformance gap, not a false
gate claim — but it is precisely the class the reviewer protocol's §3 calls "a brief 'deliberate'
note quietly normalised away," and it is load-bearing for the *next* cycle: `applyOperation` returns
`readonly GraphObject[]` and has no channel for a report at all. The `force` flag on
`delete <table>` carries the identical §5.1.1 requirement. If it is designed without this, the
project gets two repair mechanisms and then two report channels bolted on afterwards.

Ruling it now, at the moment one repair site exists rather than two: **D-057**.

## 7. Reviewer edits made (comment-only, tree re-verified green after)

`mutation.ts` and `primitives/table.ts` now contained bare **"THIS cycle"** meaning two *different*
cycles within one file — `mutation.ts:129` means entry 0049, `mutation.ts:503/509/900` mean entry
0050. This is the same drift 0048-REVIEW §7 hand-corrected 15 sites of, arriving by a different
route: not a wrong number, but no number at all. I corrected the **8 sites this batch added** to
name their entry explicitly (`mutation.ts` 7 sites, `primitives/table.ts` 1). The older sites
elsewhere in these files are left alone — rewriting them is bulk work, not a reviewer edit.

Fixing this class twice by hand means it needs a rule, not a third fix: **D-058** — a cycle-history
comment names its entry number; never a bare "this cycle." No behaviour touched; `npm run
typecheck` clean and 643/643 after.

## 8. Fix list — REVISE

1. **Complete 0048-REVIEW fix 3: a resize requires BOTH dimensions readable (D-053).**
   `findInvalidTableResizes` must reject an `insertTableLine` or `deleteTableLine` when EITHER
   `rowsResizable` or `colsResizable` is false, naming which dimension and D-046 — not only the
   flag for `operation.axis`. Tests, both of which fail today: a ROW insert on a table whose `cols`
   slot is `formula`-kind is rejected and leaves prior state bit-for-bit unchanged; the same for a
   ROW delete. Name them for the axis asymmetry, so the next reader sees why one-axis checking was
   wrong. While there: `TrackedTableState` already carries both flags, so this is a one-line
   condition change — do not restructure it.

2. **Pin and disclose §5's deletion-rejection route; do NOT patch one side (D-053).**
   Add a test that pins the CURRENT behaviour — a reference to an out-of-extent cell slot makes a
   row deletion reject — with a name that says it is a known incoherence being pinned, not a
   desired outcome, and a comment pointing at this entry §5. Add it to `STATUS.md`'s known problems
   as a *deletion-specific* entry (it contradicts §5.4's own "proceeds even when other objects
   depend on the deleted cells", which is stronger than anything insertion violates). Do not bound
   `repairCellAddressForDelete`/`repairRangeEndpointsForDelete` by extent, and do not add an
   extent filter to `repairObjectFormulaAddresses` — the insert and delete passes must keep
   identical bounds until the coherence gap is closed for both at once.

3. **Record the "reports every slot it broke" requirement (D-057).** Add it to `STATUS.md`'s known
   problems and to `DeleteTableLineOperation`'s own doc comment, naming §5.1.1 and §5.4 and the
   fact that `applyOperation`'s return type is the blocker. Do NOT build it this cycle — it is the
   `force` cycle's, per D-057. One paragraph, no code.

4. **Correct `STATUS.md`'s "Next slice" per D-056.** It currently instructs the `force` cycle to
   write new whole-object repair callbacks and hints at a third near-identical helper function.
   D-056 rules the opposite: reuse `repairObjectFormulaAddresses` unchanged, with different
   callbacks. Rewrite that paragraph so the next model is not steered into the shape this review
   just ruled against.

5. **Cut `STATUS.md` to under 150 lines (PROCESS_BRIEF §2).** It is 226. The "SETTLED, do not
   re-raise" list and "Gotchas" have both grown past the point where a next model reads them; the
   settled list in particular is now a decision index duplicating `DECISIONS.md`. Compress it to a
   pointer plus only the items that are NOT a `D-NNN` (those are binding in `DECISIONS.md` already
   and do not need restating). Do not delete a known problem to make room.

Not on the fix list, deliberately: the `rows`/`cols` upper bound; the dimension/cell coherence gap
in general (fix 2 pins it, closing it is its own slice); `describeValueType`'s duplication; the
`rewriteObjectFormulaAddresses`/`repairObjectFormulaAddresses` near-duplication (see D-056 — the
answer is that it stays a pair, so there is nothing to fix); and the ~25 older bare "this cycle"
comment sites outside this batch's diff (D-058 binds new comments, it is not a licence to sweep).

## 9. Answers to entry 0050's three reviewer questions

1. **Deletion's non-clamping stance — CONFIRMED, ruled D-054.** Insertion's clamp has a meaning
   ("append at the end"); deletion's would have none, and a silent floor would convert a
   precondition bug into a wrong-but-plausible table. Keep `findInvalidTableResizes` as the sole
   guard and keep the asymmetry documented in both doc comments, as entry 0050 already did. Ruled
   so nobody adds a defensive clamp "for symmetry" later.

2. **Value-based tie-break — CONFIRMED, ruled D-055; do NOT normalise ranges to `start <= end`.**
   Three reasons, the third decisive: the stored AST is what the user wrote and §5.2's display path
   maps it back, so normalising would show a formula the user did not type;
   `enumerateRangeCellAddresses` already treats the endpoint pair as an unordered rectangle via
   `Math.min`/`Math.max`, so value-based IS the established convention and a normalising point
   would be a second place range semantics live (D-010); and normalisation could never remove the
   need for value-based handling anyway, because §5.11 loads documents whose stored ASTs predate
   any such rule. It would be added surface, not removed surface.

3. **Do NOT collapse the pair — ruled D-056, and the question's premise about a third function is
   answered too.** Two functions differing only in which walk they call is not duplication worth a
   generic wrapper; the wrapper would be parameterised over the walk and would obscure both.
   More importantly: **whole-object repair needs no third function.** It needs
   `repairObjectFormulaAddresses` *as it stands*, called with different callbacks — "does this
   address name any slot on `objectId`" for a reference, "does either endpoint name it" for a
   range. That is exactly the two-callback shape the function already takes. `STATUS.md`'s "Next
   slice" currently anticipates a third near-identical function; it should not be built (fix 4).

## 10. Phase 2 gate status

Not claimed, correctly. Clauses 1–3 PASS (re-verified). Clause 4's DELETE half PASSES and is
honestly demonstrated. Clause 4's `delete <table>`-until-`force` half remains the only outstanding
one. The gate review happens when that lands — after this fix list, not before: fix 1 is a live
data-loss bug on both existing resize operations, and D-056/D-057 change what the `force` slice
should build.

## 11. Open questions

`OPEN_QUESTIONS.md` needs no new entries. Entries 0049 and 0050 each raised none, and each was
right not to: entry 0050's three questions were design confirmations, not brief ambiguities, and
are now D-054, D-055, D-056. Q-007 and Q-008 remain open and still block nothing. Next free:
**Q-011**.
