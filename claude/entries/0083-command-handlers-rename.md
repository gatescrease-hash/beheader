# 0083 — `rename`: a new `Operation` kind, and the handler behind it
Date: 2026-08-26   Phase: 3   Model: Claude Opus 5 (implementer)
Previous entry: 0082-REVIEW-phase3   Last review: 0082-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; 425 lines / 4 files changed so far.

## Declared scope

`rename <object> <new-name>` (§5.10) — the one §5.10 object command STATUS named as needing a new
`Operation` kind. Two files: `RenameObjectOperation` plus its pre-staging name check in
`engine/mutation.ts` (**load-bearing, §6.2**), and the handler in `command/commands.ts` behind the
existing `executeCommand` seam.

## Explicitly not in scope

- **Fix-list item 1**, the `formula/parser.ts` depth limit from D-079's constant. Still its own
  slice, still blocks nothing, still owed before `main.ts`.
- **D-075's `effect` field** and the five commands that need it (`select`/`zoom`/`fit`/`save`/`load`).
  They still report "has no handler yet" — five arms now, not six.
- `main.ts`. No pixel came out of this project this cycle either.

## What I did

### `src/engine/mutation.ts` — a sixth `Operation` kind, +126/-6

**`RenameObjectOperation { kind, objectId, name }`.** Its whole effect is one field:
`applyOperation`'s branch maps the object list and replaces `name`. There is no second pass and no
`brokenSlots`, and the doc comment says why in the brief's own terms — §5.3's two-layer scheme
stores an object **ID** in every AST, so a rename cannot break a reference. That is the property
§5.3 was designed to buy ("this is what lets a user rename an object without breaking every formula
pointing at it"); this operation is the first thing in the codebase to spend it.

Not a `setSlot` with a special path: a name is not in `GraphObject.slots`, has no `Slot` kind,
carries no `Value`, and takes no formula, so writing one that way would mean inventing a path no
schema declares — which D-017's check would then have to be taught to ignore.

**`findInvalidRenames(operations, objects)`, a fourth pre-staging check.** §5.2's grammar and
case-insensitive uniqueness, checked over the batch **as simulated left-to-right** — the same
posture `findInvalidTableResizes` takes and for D-050's reason: a batch can free a name before a
later operation claims it. `[rename a → b, rename c → a]` commits; `[rename a → z, rename c → z]`
does not. The simulation tracks `{id, name, type}` only (no slot data), mirroring the existence
check's own shape, and folds `createObject` (adds a name) and `deleteObject` (frees one) so a mixed
batch is judged against what it would really see.

**The rule itself is not re-spelled here.** `address.ts`'s `checkNameAvailable` owns both halves and
its `excludeId` parameter exists for exactly this call — it had no caller in `src/` before this
cycle. So `rename polygon_1 POLYGON_1` is accepted (uniqueness excludes the object being renamed,
and §5.2 gives no reason to refuse a case change), and both refusal messages are `address.ts`'s
words, prefixed with the operation's position the way every other pre-staging check prefixes its own.

Also widened, mechanically: the `Operation` union, `operationTargetId`, and D-021's existence-check
message (`attempts to rename object id "obj_99" to "whatever"`).

**KNOWN GAP, disclosed not fixed and pinned by a test: `createObject`'s OWN name is still
unchecked.** `findInvalidRenames` reads a created object's name only to keep the simulation honest
for a later rename. A loader or a handler can still commit a duplicate or ungrammatical name through
`createObject`, exactly as it could before this cycle — `commands.ts` avoids it by minting names
through `generateDefaultName`. I did not close it: it decides what §5.11's load path does with a
saved document whose names collide, which is a bigger question than this slice, and closing it
silently inside a rename cycle would bury that.

### `src/command/commands.ts` — the handler, +54/-11

Two names, resolved at two layers, and the split is the design: the **old** name is an identity
question this file answers (`findGraphObjectByName`, the same resolver `delete` uses), the **new**
name is a rule question `mutate` answers. Re-checking the new name here would be a second copy of a
rule that already has a single gate — the same reason `parser.ts` declines it, which is why
`rename polygon_1 3bad` parses and fails later.

Nothing else moves: no `brokenSlots` report to make, no id minted, `nextObjectId` untouched. Header
updated — `NOT DONE HERE` no longer claims `rename` is unbuilt, one invariant added,
`COMMANDS_WITH_HANDLERS` gained `rename`, and `executeCommand`'s doc says five unhandled arms, not
six.

### Tests — +245, one stub expectation removed

`mutation.test.ts` (+158, 15 tests, two blocks): the operation's own behaviour — the name written
and *nothing else* (same id, same slots, same array position), the same edge set derived after the
rename, the dependent still evaluating, `brokenSlots` empty, the stored AST still naming the id,
one journal entry, prior state bit-for-bit unchanged on rejection, and each refusal's exact message.
Then `findInvalidRenames`'s left-to-right simulation: a name freed by an earlier rename, a name
freed by an earlier delete, two renames claiming one name, a rename colliding with an earlier
`createObject`, every offence named in one pass, a refused rename freeing nothing — and the
`createObject` gap above, pinned as a test that asserts the duplicate *does* commit, so closing it
is a visible diff against a named test.

`commands.test.ts` (+87, 13 tests): the typed line end to end, the old name resolved
case-insensitively, **a formula surviving the rename of the object it reads** (`set grid.A1 42`
still drives `polygon_1.origin.x` after `rename table_1 grid`), `refs` printing the new name because
`formatAddress` resolves it from the id, the old name going unresolvable to `refs`/`delete`/`set`
at once, the freed name reused by a new object, and every refusal.

**One expectation removed:** `rename` left `UNHANDLED_EXAMPLES` (the `"rename" has no handler yet`
test), and gained a line in `EVERY_REGISTRY_EXAMPLE` so the registry sweep still covers every word.
Same shape as entry 0081's three removals, which 0082-REVIEW accepted: a stub assertion deleted
because the stub is now a handler, not a test weakened to reach green.

## Verification

`npx tsc --noEmit` and `npx tsc --noEmit -p tsconfig.engine.json` — both clean.
`npm test` — **1032/1032 pass, 0 skipped, 0 `.only`** (1005 before; 28 new, 1 removed).

Mutation checks (five, each applied to the source and reverted, all caught): stubbing
`findInvalidRenames`' result to `[]` — 9 tests fail; dropping `excludeId` from the
`checkNameAvailable` call — 2 fail (the case-change test at both layers); returning `objects`
unchanged from the rename branch — 11 fail; applying a *refused* rename to the simulation anyway —
1 fails (the "frees nothing" test); not folding `deleteObject` into the simulation — 1 fails (the
freed-by-delete test). Full suite green again after each revert.

## Self-assessment

- §5.10's `rename` is built and tested end to end. §5.2's two rules have exactly one gate, and it
  now has a caller.
- **`mutation.ts` is load-bearing (§6.2): Phase 4 cannot start until this cycle is reviewed.**
- The `createObject` name gap is real, pre-existing, and now adjacent to code that checks the same
  rule for renames. It is disclosed above, pinned by a test, and in STATUS's known problems.
- Phase 3's criterion is NOT claimed. The engine half of the command line keeps getting wider; the
  visible half is still unbuilt.

```
CYCLE 0083 COMPLETE
Slice: `rename` — RenameObjectOperation + findInvalidRenames in mutation.ts, and the handler in commands.ts
Files: 4 changed (engine/mutation.ts, engine/mutation.test.ts, command/commands.ts, command/commands.test.ts)
Tests: 1032/1032, 0 skipped   Typecheck: clean (both configs)
Phase 3 criterion: NOT claimed — no canvas, no main.ts wiring
Review point: §6.1 trigger 5 (one stub test expectation removed — see above), plus §6.2 (mutation.ts touched) — batch 1/3, diff 425/800
Open questions: none raised
REVIEW: REQUIRED
Reason: trigger 5 read honestly — I removed a test expectation (the `rename` stub assertion) — and a new Operation kind plus a new pre-staging rejection path landed in a load-bearing file that §6.2 already shuts Phase 4 behind.
Questions for reviewer:
  1. `findInvalidRenames` leaves `createObject`'s own name unchecked, and I pinned that gap rather
     than closing it — the fix changes what a §5.11 load does with a colliding saved name. Is that
     the right call, and does it belong to the load cycle or to a cycle of its own?
  2. A refused rename is not applied to the simulation, so a later operation still sees the old name
     taken. That yields two messages for one root cause. Correct, or should the first refusal stop
     the walk?
```
