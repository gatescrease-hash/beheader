# 0003 — address-cells-path-fix
Date: 2026-08-21   Phase: 0   Model: Claude (Sonnet 5)
Previous entry: 0002-REVIEW-phase0   Last review: 0002-REVIEW-phase0 (verdict: REVISE)

## Declared scope

Work the fix list in `entries/0002-REVIEW-phase0.md` in full: items 1–4 (make `address.ts`
produce the D-005 stored-path contract for table cells, make `formatAddress` its exact
inverse, add the §5.2 round-trip test, correct the wrong test, fix overclaiming docstrings)
plus items 5–7 (an `isAddressError` type guard, drop the dead eslint directive, add D-006's
DOM-free engine tsconfig). Not starting `graph/node.ts` — the review was explicit that
addressing must be settled first.

## Explicitly not in scope

`graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, and everything else still listed
under "Not started" in `STATUS.md`. D-005 §4's escape hatch (an interim lexical stage) was not
needed — item 1 was implemented for real rather than deferred, since the fix list asked for it
directly and the scope (one object type, one mapping) is small.

## What I did

- `src/engine/address.ts`:
  - `AddressableObject` gains a `type: string` field (D-005) — resolving a table's bare cell
    reference to its stored `cells.*` path needs to know the object is a table.
  - Added `toStoredPath` / `toSurfacePath`: the D-005 mapping, hardcoded to the one case the
    brief specifies (table cells) and documented as a stand-in for `primitives/schema.ts`,
    which does not exist yet.
  - `parseAddress` now returns `path: toStoredPath(object.type, pathParts)` instead of the raw
    split. `formatAddress` now formats `toSurfacePath(object.type, address.path)` instead of
    the raw stored path — this is the fix for F-1 in both directions.
  - Added `isAddressError(value): value is AddressError` (fix-list item 5) so callers
    discriminate the result unions without an `as` cast.
  - Dropped the dead `// eslint-disable-next-line` (item 6) — there is no ESLint in this
    project; kept the termination rationale as a plain comment.
  - Documented the L-3 tuple cast and the L-4 "why `parseAddress` doesn't pre-validate the name
    grammar" decision, both flagged optional in the review.
  - Updated the file header and both functions' docstrings to state the D-005 contract
    (previously they claimed a pure lexical translation, which F-1 showed was wrong).
- `src/engine/address.test.ts`:
  - `objects()` test helper now takes an optional `type` (default `"polygon"`, an arbitrary
    non-table type) per entry.
  - Added `parseOk()`, a small helper that asserts success and narrows away `AddressError`,
    replacing the three `as never` casts the review flagged (L-2).
  - **Corrected `address.test.ts`'s wrong assertion**: the table-cell test now expects
    `path: ["cells", "A1"]`, not `["A1"]`. This changes a previously-passing test's
    expectations — that is normally a §6.6 escalation trigger on its own, but
    0002-REVIEW-phase0 explicitly instructed the change (fix-list item 3) and said to cite the
    review rather than treat it as cleanup. Doing so here.
  - Added a test that a table path already 2+ segments long (`table_x.cells.A1`) is left
    alone, and one that a non-table object's path is never prefixed.
  - Added the required round-trip test: `parseAddress`/`formatAddress` round-trip all five
    address forms from PROJECT_BRIEF §5.2's table, including the table-cell row that used to
    be wrong (fix-list item 2).
  - Replaced the `as { message: string }` cast in the "unknown object name" test with the new
    `isAddressError` guard for consistency, though the review only flagged the `as never` sites
    specifically — small additional cleanup within the file already being touched.
- `tsconfig.engine.json` — new (fix-list item 7 / D-006). Extends the root config,
  `"lib": ["ES2022"]` with no `"DOM"`, `"include": ["src/engine"]`.
- `package.json` — `typecheck` script now runs both configs:
  `tsc --noEmit && tsc --noEmit -p tsconfig.engine.json`.

## Decisions I made

- **Item 1 implemented directly, not via D-005 §4's interim/lexical escape hatch.** The escape
  hatch exists for when schema-awareness would be a large undertaking; here it's one type,
  one mapping, and the fix list asked for correctness now. Recorded as a plain hardcoded
  mapping (`TABLE_TYPE`/`TABLE_CELL_PATH_PREFIX`) with an explicit comment that it's a
  stand-in for `primitives/schema.ts` and should move there once that module exists.
- **A table path with 2+ segments is left untouched rather than rejected or double-prefixed.**
  Not specified by the brief (users are only ever shown the short form, `table_x.A1`), but it
  falls out for free from checking `surfacePath.length === 1` before prefixing, and it means a
  user typing the literal stored form (`table_x.cells.A1`) doesn't get a confusing rejection.
  Added a test pinning this behaviour so it doesn't drift silently later.
- **`isAddressError` takes `unknown`, not `Address | AddressError`.** It needs to discriminate
  both `parseAddress`'s return type (`Address | AddressError`) and `formatAddress`'s
  (`string | AddressError`) without two overloads; `unknown` with a runtime `"error" in value`
  check does that safely without `any`.
- **Extended the `isAddressError` cleanup to the "unknown object name" test's `as { message:
  string }` cast**, not just the three `as never` sites the review named. Same file, same
  pattern, and leaving one hand-rolled cast next to the new guard would read as an
  inconsistency for the next reader.

## Verification (real output)

$ npm run typecheck
```
> graphpaper@0.0.0 typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json

exit=0
```

$ npm test
```
 RUN  v2.1.9 C:/Users/William/Documents/Code Projects/beheader

 ✓ src/engine/address.test.ts (36 tests) 8ms

 Test Files  1 passed (1)
      Tests  36 passed (36)
```
(28 tests before this cycle, +8: the 2+-segment table test, the non-table-no-mapping test, the
`isAddressError` describe block, and 5 rows of the new round-trip `it.each`.)

D-006 re-verification — the exact probe the reviewer used, re-run against the new engine
config to confirm it now catches what it didn't before:
```
$ npx tsc --noEmit -p tsconfig.engine.json    (with document.createElement("canvas") dropped
                                                into src/engine/__rule1probe.ts)
src/engine/__rule1probe.ts(1,27): error TS2584: Cannot find name 'document'. Do you need to
change your target library? Try changing the 'lib' compiler option to include 'dom'.
exit=2
```
Probe file removed immediately after; `git status --short` confirms no residue.

## Acceptance criteria status

Phase 0 criterion (PROJECT_BRIEF §6) — NOT YET, unchanged from entry 0001. This cycle is a
correctness fix to the addressing piece, not new phase coverage.

F-1 (0002-REVIEW-phase0) is resolved. Demonstrated by
`src/engine/address.test.ts::parseAddress / formatAddress round-trip every address form in
§5.2's table`, which covers all five rows of PROJECT_BRIEF §5.2's address table, including the
table-cell row that was previously wrong.

## Where I got stuck / what is unfinished

Nothing significant. The change was contained to the seam the review identified; no new
ambiguity was hit while making it.

One thing worth flagging rather than fixing here: `toStoredPath`/`toSurfacePath` special-case
the string `"table"` for `AddressableObject.type`. Nothing currently defines what the type
strings for other object kinds will be (`"polygon"`, `"circle"`, `"polyline"`, `"text"`, ...) —
I used plausible-sounding ones in tests but they are not yet a decided vocabulary. Whoever
builds `graph/node.ts` / `primitives/schema.ts` should treat those strings as illustrative, not
binding.

## Open questions raised

None. This cycle resolves review findings; it does not raise new ambiguity.

## Escalation triggers fired

- §6.2 — modified `src/engine/address.ts`, a listed load-bearing file.
- §6.6 — changed a previously-passing test's expectations
  (`address.test.ts`'s table-cell-address test). **Explicitly instructed** by
  0002-REVIEW-phase0's fix-list item 3, which said to cite the review rather than treat it as
  cleanup — doing so here per that instruction.
- §6.3 — does NOT fire: no new file was created under `src/engine/` (`tsconfig.engine.json` is
  at the repo root, not under `src/engine/`).
- §6.9 — does NOT fire: 4 files changed, 180 insertions / 32 deletions (212 changed lines),
  under both thresholds.
