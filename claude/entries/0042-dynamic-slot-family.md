# 0042 — the dynamic slot family: table's cells register in `SCHEMAS`
Date: 2026-08-23   Phase: 2   Model: implementer (Claude Sonnet 5)
Previous entry: 0041-REVIEW-phase2 (verdict: ACCEPT WITH EDITS, cycles 0039/0040 cleared)
Last review: 0041-REVIEW-phase2
Batch: cycle 1 of up to 3 since last review. Diff since last review (commit `40dbf94`):
6 files, 723 insertions / 96 deletions (819 combined). 0041-REVIEW asked this entry to state
which convention it uses, since earlier batches used insertions-only and 0041-REVIEW itself
used insertions+deletions without saying so explicitly — **this entry uses insertions+deletions**
(819) going forward; by that count this single cycle is already at the §6.3 cap on its own. Moot
here: multiple §6.1 triggers fired independently (see Review point below), so REVIEW: REQUIRED
regardless of the cap.

## Declared scope
Solve the `ObjectSchema` dynamic-slot-family mechanism 0041-REVIEW-phase2 §9 named as Phase 2's
critical path (D-017's own forward note), and register a real `table` schema entry through it —
`rows`/`cols` as two fixed slots, `cells.*` as the first dynamic slot family — proving the
mechanism concretely rather than leaving it an untested abstraction. This is a design decision on
two load-bearing files (`primitives/schema.ts`, `mutation.ts`), written down here and in the code's
own doc comments before being called done.

## Explicitly not in scope
- Wiring `enumerateRangeCellPaths` into `formula/eval.ts` (D-036 constraint 1) or into
  `mutation.ts`'s edge derivation for a `RangeNode` dependency (constraint 2's other half) — both
  are the wiring cycle's job, per 0041-REVIEW §9's own ordering. Nothing here touches
  `formula/eval.ts`, `graph/eval.ts`, or the `#PARSE` range placeholder.
- Any table-creation mutation/command (§5.10) that would actually populate `rows`/`cols` and a
  fresh set of `cells.*` literal slots on a newly created object. Every table fixture below is
  hand-built, the same convention Phase 0's `value`/`add` fixtures used before any create-command
  existed.
- Row/column insert/delete and §5.4's reference-adjustment/clamping pass — needs concrete
  delete-mutation machinery that does not exist yet; nothing about the schema mechanism alone
  determines it.
- `MIN`/`MAX`'s `Math.min(...)` spread risk (0035-REVIEW Finding 4, D-036 constraint 5) — unreached
  until ranges flatten into arguments.
- The three temporary bridges (`findUnsupportedFormulaAsts`, `graph/eval.ts`'s `#PARSE` branch,
  `deriveEdges`'s `ReferenceNode`-only narrowing) — explicitly meant to come down TOGETHER in the
  wiring cycle, not piecemeal here. A table cell holding a non-reference formula AST is still
  correctly rejected today by the existing (unmodified) `findUnsupportedFormulaAsts` check.

## What I did
- **`src/engine/primitives/schema.ts`** — widened `ObjectSchema.nonDerivedSlotPaths` from a bare
  `readonly (readonly string[])[]` to `readonly NonDerivedSlotPathGroup[]`, a `static | dynamic`
  union deliberately shaped like the existing `DerivedSlotDependencies` union (same underlying
  need: a fixed list is not expressive enough for a family whose membership depends on the
  object's own current state). Added `resolveNonDerivedSlotPaths(object, groups)`, the ONE place
  that concatenates `static` groups' fixed paths with `dynamic` groups' `enumerate(object)`
  results — used by `mutation.ts`'s three consumers so they can never disagree about which paths
  a given object currently declares. Updated `VALUE_SCHEMA`/`ADD_SCHEMA` to the new shape (one
  `static` group each — same paths, same order, no behavioural change). Added `TABLE_SCHEMA`:
  `nonDerivedSlotPaths: [{ kind: "static", paths: [rows, cols] }, { kind: "dynamic", enumerate:
  enumerateTableCellSlotPaths }]`, `derivedSlots: []`. Registered `table: TABLE_SCHEMA` in
  `SCHEMAS` — `getObjectSchema("table")` no longer returns `undefined`.
- **`src/engine/primitives/table.ts`** (extending the already-reviewed file from cycle 0040, not a
  new subsystem file) — added `TABLE_ROWS_PATH`/`TABLE_COLS_PATH` (`["rows"]`/`["cols"]`, §5.10's
  own command-line words), `readTableDimension` (private, defensive — reads a dimension slot,
  `0` for anything not a non-negative integer), and `enumerateTableCellSlotPaths(object)` — the
  `dynamic` group's `enumerate` function: generates every `["cells", ref]` path for the object's
  current `1..rows × 1..cols` extent, row-major, via the same `formatCellReference` helper
  `enumerateRangeCellPaths` already uses. Deliberately generates candidates from known dimensions
  rather than ever reading `object.slots`' actual keys back into a path — D-010 forbids inverting
  a `slotKey`, even where it happens to be safe.
- **`src/engine/mutation.ts`** — `deriveEdges`'s source-1 loop, `findUndeclaredFormulaOrDerivedSlots`
  (D-017), and `findSchemaSlotKindMismatches`'s second loop (D-018) all now call
  `resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths)` instead of walking
  `schema.nonDerivedSlotPaths` as a flat array directly. Updated the file's own header/doc
  comments to describe the widened mechanism and mark the old "Phase 4 must revisit this
  mechanism" forward note as resolved.
- **Tests** — `schema.test.ts`: fixed the three assertions the type widening broke (now asserting
  the `{ kind: "static", paths: [...] }` shape), added `resolveNonDerivedSlotPaths` coverage
  (static-only, a synthetic static+dynamic combination, table's real schema at 2×3, missing
  dimensions, malformed dimensions — string/negative/fractional). `table.test.ts`: added
  `enumerateTableCellSlotPaths` coverage (2×3 row-major, the default 8×8 extent's corners, a
  multi-letter column boundary, no dimension slots at all, malformed dimensions, degenerate
  0-row/0-col extents). `mutation.test.ts`: built a `tableObject` fixture and added tests proving
  `deriveEdges` derives edges for in-bounds formula cells and none for out-of-bounds ones (the
  dynamic-family analogue of D-017's original fixed-list gap), `validateIntegrity` rejects an
  out-of-bounds formula cell and a within-bounds `derived`-kind cell (D-018's other direction),
  cross-table cell references work, and a full `mutate` end-to-end pass (`createObject` for a table
  + a value, a formula cell reads the value, evaluation propagates it) plus a genuine cycle running
  entirely through two tables' cells is rejected.

## Decisions I made
1. **`rows`/`cols` are ordinary literal number slots at fixed schema-declared paths, not a new
   GraphObject-level field.** This keeps `graph/node.ts` untouched (not one of the two files
   0041-REVIEW's §9 named) and reuses the EXISTING `static` mechanism verbatim for them — no
   widening needed beyond the `dynamic` case `cells.*` actually requires. Reversible: nothing
   depends on this shape yet (no create-command exists).
2. **`enumerateTableCellSlotPaths` generates candidate paths from `rows`/`cols` rather than ever
   reading `object.slots`' actual keys back into a path array.** This is the load-bearing move
   that keeps D-010 intact (never invert a `slotKey`) while still solving the family-membership
   problem — the same shape `DerivedSlotDependencies`'s existing `dynamic` case already
   established for `text.resolvedContent`/`script.out.*`, applied here to non-derived paths instead
   of derived-slot dependencies.
3. **Nothing prevents a raw `setSlot` on `rows`/`cols` from disagreeing with the cell slots that
   actually exist on the object.** Disclosed, not fixed: this is self-limiting for the DANGEROUS
   half (a formula/derived cell outside the new declared extent is caught by D-017's own check,
   proven by this cycle's own tests) but not for the harmless half (a literal cell beyond the
   declared extent becomes invisible to the graph — orphaned, not wrong). A real row/col
   insert/delete mutation (future work) must not be built as a bare `setSlot` on these two paths;
   it needs its own operation kind with repair semantics per §5.4.
4. **No bound on how large `rows`/`cols` may be set to.** Nothing today can actually write to them
   (no create/resize mutation exists), so — same reasoning D-044 used for
   `enumerateRangeCellPaths`'s own unbounded shape — this costs nothing to leave unbounded right
   now. Flagged for whichever future cycle designs table creation/resize, not solved here.
5. **`table`'s `derivedSlots` is empty, not a placeholder.** Nothing in §5.4 gives a table object
   itself a schema-computed slot in v1; a cell's own `formula` kind is a different mechanism
   (ordinary per-slot state, not something the SCHEMA computes).

## A genuinely new finding (disclosed, not fixed): D-022's bounded-correctness claim breaks for `table`
D-022 (0018-REVIEW-phase0) approved `describeUndeclaredSlot`'s raw-key naming (`object.name + "." +
key`) as a bounded exception to D-015, on the explicit condition that "for every type whose schema
is registered, the string produced is identical to `formatAddress`'s" — and asked for this to be
pinned with a test "so the day a table gets a schema entry the divergence fails loudly instead of
shipping a wrong name." That day is this cycle.

Verified by probe (now a test, `mutation.test.ts`): D-017's check names a stray out-of-extent
formula cell as `table_x.cells.C5` (the raw key) — but `formatAddress` on the identical `Address`
prints the surface shorthand `table_x.C5` (D-005/D-008). Both spellings resolve to the SAME stored
slot (D-043), so nothing is factually wrong and D-017's rejection is still correct — but the two
strings are no longer identical, and D-022's own bounded claim is now false for `table`.

I did not fix this. Closing it cleanly needs either (a) inverting a `slotKey` back into a path
(D-010 forbids it — `findUndeclaredFormulaOrDerivedSlots` has only the string key, never an
`Address`, for a slot with no schema-declared path), or (b) teaching `mutation.ts` itself which
raw keys are table-cell-shaped so it can strip the `cells.` prefix before naming — which
reintroduces exactly the kind of table-specific special-casing this cycle's whole design was
written to avoid. Both are real design decisions, not obvious fixes, so I disclosed it and pinned
it with a test rather than picking one under time pressure. See the questions below.

## Verification (real output)
```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  499 passed (499)
```
499 = the 474 at 0041-REVIEW's HEAD, plus 25 new (7 in `schema.test.ts`, 7 in `table.test.ts`, 11
in `mutation.test.ts`). 0 skipped, 0 `.only`. `grep -rn "MUTATION-TEST" src/engine/` clean before
and after every check below.

### Mutation checks (D-016 discipline)
1. **Disabled `resolveNonDerivedSlotPaths`'s `dynamic` branch** (commented out
   `paths.push(...group.enumerate(object))`): exactly 9 tests failed, all named and all
   table-related — 2 in `schema.test.ts` (the synthetic dynamic-group test, table's 2×3
   resolution), 7 in `mutation.test.ts` (every table `deriveEdges`/`validateIntegrity`/`mutate`
   test that needs a cell edge or rejection to fire). Every `value`/`add`-only test (490 of them)
   stayed green — proving the two existing types are genuinely unaffected by this cycle's
   widening. Restored.
2. **Loosened `readTableDimension`'s guard** (dropped `Number.isInteger`/`>= 0`, kept only the
   `typeof === "number"` check): exactly 1 test failed — the fractional-dimension case (`2.5`
   rows produced 16 cell paths instead of 0) — confirming the integer guard is load-bearing for
   that case specifically. Restored.
3. **Unregistered `table` from `SCHEMAS`** (commented out `table: TABLE_SCHEMA`): exactly 12 tests
   failed — 1 in `schema.test.ts`'s own "returns a real entry for 'table'" test, 3 more in
   `schema.test.ts`'s `resolveNonDerivedSlotPaths` describe block (each throws its own
   "test setup: expected table's schema to exist" per their guard clauses), and 8 in
   `mutation.test.ts`'s table-specific describe blocks. Restored.

## Acceptance criteria status
No Phase 2 (or other) acceptance-criterion clause is claimed this cycle. `table` entering
`SCHEMAS` is infrastructure the wiring cycle needs, not itself a demonstration of "two separate
tables... `SUM(A1:A5)` recomputes... deleting a row rewrites references to `#REF`" — none of
that is reachable yet (no range evaluation, no row/col mutations).

## Where I got stuck / what is unfinished
The D-022 divergence above is the main one — I judged it a legibility wart rather than a
correctness defect (the rejection is still right; only the offending slot's SPELLING in the
message differs from the canonical surface form), and chose to disclose and pin it with a
regression test rather than guess at a fix that trades one design principle (never invert a
`slotKey`) against another (`mutation.ts` stays schema/table-agnostic).

Also worth naming plainly: `rows`/`cols` as ordinary, unprotected literal slots is exactly the
kind of "self-limiting for the dangerous half, silently wrong for the harmless half" shape this
project's history (D-017, D-018, D-019, D-025) keeps finding in fresh clothes. I believe it is
SAFE for now because nothing can write to these paths yet — but the next cycle that adds a
table-creation or resize command must read Decision 3 above before assuming a bare `setSlot` is
an adequate primitive for either.

## Open questions raised
None in `OPEN_QUESTIONS.md` — nothing here is a brief ambiguity; both the mechanism design and the
D-022 finding are implementer-level judgement calls, recorded as such for the reviewer instead.

## Review point
Fired: **§6.1 trigger 3** (a genuine design decision on two load-bearing files,
`primitives/schema.ts` and `mutation.ts`, not dictated by the brief) and **trigger 5** (three
`schema.test.ts` expectations changed — an intentional, disclosed consequence of the type
widening, not a discovered defect, but honestly a changed expectation regardless). Also
independently within §6.2's scope (both touched files are load-bearing; no later phase may begin
with them unreviewed) and effectively at the §6.3 cap by the insertions+deletions convention this
entry adopts (819/800).

**REVIEW: REQUIRED.**
Reason: this is exactly the "write the design down before the code" cycle 0041-REVIEW-phase2 §9
asked for, on two load-bearing files, deciding a mechanism nothing in the brief specifies by name.

Questions for the reviewer:
1. Is the D-022 divergence (`describeUndeclaredSlot`'s raw-key naming vs. `formatAddress`'s
   surface form, for a table's stray out-of-extent cell) something that needs closing now, or is
   "still correct, non-canonical spelling, pinned by a test" an acceptable resting state until a
   cycle that touches `mutation.ts` for another reason anyway?
2. Is `rows`/`cols` as ordinary literal slots (Decision 1) the right home, or should a table's
   dimensions live outside the slot system entirely (e.g., structural `GraphObject` state,
   alongside `type`'s own D-007 precedent for mutable-but-not-slot state)? I kept them as slots to
   avoid touching `graph/node.ts`, but that is a reversibility argument, not necessarily the
   strongest design argument.
3. Is the `NonDerivedSlotPathGroup` union (mirroring `DerivedSlotDependencies`) the right shape, or
   would a single always-a-function form (no `static`/`dynamic` split, `value`/`add` just ignoring
   their `object` parameter) have been simpler? I chose the union for consistency with the
   existing derived-slot mechanism and because a `static` group stays directly inspectable in
   tests without invoking a function — a bit more verbose for `value`/`add`, but no behavioural
   cost.
