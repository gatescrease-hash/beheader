# 0081 — `delete`, `refs` and `list` handlers
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (implementer)
Previous entry: 0080-REVIEW-phase3   Last review: 0080-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~522 lines / 2 files changed so far.

## Declared scope

The three of §5.10's object commands that need no new `Operation` kind: `delete <object> [force]`,
`refs <object|address>`, and `list`. All three land in `command/commands.ts` behind the existing
`executeCommand` seam, with no change to any engine file.

## Explicitly not in scope

- **`rename`.** It is the fourth command STATUS named for this slice and it is the one that needs a
  `renameObject` `Operation` in `mutation.ts` — a load-bearing file. Left for its own cycle so the
  engine change is reviewed as an engine change.
- **D-075's `effect` field** and the five commands that need it (`select`/`zoom`/`fit`/`save`/`load`).
  They still report "has no handler yet".
- **0080-REVIEW fix-list item 1** (the parser depth limit) and **item 2** (the missing-slot refusal's
  remedy). Item 1 is its own slice and still blocks nothing; item 2 lives in `resolveWritableSlot`,
  which this cycle did not open.
- `main.ts`. No pixel came out of this project this cycle either.

## What I did

### `src/command/commands.ts` — three handlers, +295/-11

**`delete`** (§5.10, §5.1.1). Resolves the name, builds one `DeleteObjectOperation` carrying the
operator's `force` flag, and calls `mutate`. **It chooses neither of §5.1.1's two paths** — the flag
selects them inside `mutate`, and re-deciding here would be a second definition of the rule that
actually executes. It owns the two things `mutate` cannot say:

- the **remedy**: `mutate`'s rejection names every dependent (§5.1.1 clause 1) and cannot name the
  `force` flag, because an `Operation` carries no command syntax. The handler appends it. That
  sentence is unconditional on the rejection path, and the doc argues why it cannot be wrong there:
  over a document `mutate` already committed, a non-forced `deleteObject` has exactly one reachable
  rejection — removing an object cannot make a schema disagree (D-017/D-018 are per-surviving-object),
  cannot make a value illegal (D-025), and cannot build a cycle out of fewer edges.
- the **report**: D-057's `brokenSlots` gets its **first reader** here, which is §5.1.1's "the command
  must report which slots were broken". Formatted against `result.objects` per D-059.

**`refs`** (§5.10, §5.1.1). Reports every slot that reads the target, `source → dependent`, split into
the dependents on other objects and the ones on the target's own object, with a summary line counting
the two apart. Both forms of §5.1.1's `refs <object|slot>` are accepted; they are told apart by
`isValidName`, address.ts's own §5.2 name grammar, rather than by a dot rule spelled out here.
A `derived` path is an accepted target (unlike `resolveWritableSlot`'s refusal — reading who depends
on a computed value is not an attempt to write it). A path the schema does not declare is refused.

**`list`** (§5.10). `<name> — <type>` per object in creation order; `no objects` on an empty document.
No object id: §5.2 makes the id the layer the operator never writes.

Both read-only commands return the document they were given, by identity, and journal nothing — which
is D-075 clause 4's reason for giving them no `effect`.

Header updated: `NOT DONE HERE` no longer claims these three are unbuilt, `executeCommand`'s doc no
longer says "twelve arms with no handler yet" (it was already wrong at nine before this cycle; it is
six now), and three invariants were added.

### `src/command/commands.test.ts` — +213/-3, 29 new tests, 3 removed

Three `"<word>" has no handler yet` tests are gone because the words now have handlers, and
`EVERY_REGISTRY_EXAMPLE` carries their lines explicitly instead of through `UNHANDLED_EXAMPLES`.
See **Review point** — this is §6.1 trigger 5 and I am not treating it as exempt.

## Decisions I made

**1. `refs` reports the target's own dependents rather than filtering them out.** A fresh polygon has
thirteen internal edges and hiding them would answer a question the operator did not ask. The summary
line is what makes the report useful for §5.1.1's purpose: it counts the blocking dependents apart
from the ones that leave with the object.

**2. `refs <object>`'s blocking half is derived from the document WITHOUT the target.** This is the
cycle's one real finding and it is in "Where I got stuck" below. It is the same edge set `mutate`
hands `validateIntegrity` when `delete <object>` runs, so `refs` and a refused `delete` cannot name
different dependents. An address target keeps the current edge set for both halves: no command
removes a single slot, so there is no removal to simulate.

**3. `delete` runs `mutate` and never pre-checks.** I drafted a pre-check that gathered dependents
first and refused before mutating, for a better message. I dropped it: it would have been a second,
weaker definition of §5.1.1 living beside the real one, and it would have missed exactly the range
case decision 2 is about. Appending the remedy to `mutate`'s own message is smaller and cannot drift.

**4. Duplicate lookups disclosed, not refactored.** `declaresSlotPath` asks the schema the same
question `resolveWritableSlot` asks inline. §4 forbids refactoring code I did not write in this batch,
so the two stand and `declaresSlotPath`'s doc says so, names the condition for merging them, and
forbids a third site.

**5. `countedNoun` exists because two messages here count something** and a per-site `+ "s"` is two
chances to disagree.

## Verification (real output)

```
$ npx tsc --noEmit
TSC_DEFAULT=0
$ npx tsc --noEmit -p tsconfig.engine.json
TSC_ENGINE=0
$ npx vitest run
 Test Files  24 passed (24)
      Tests  1003 passed (1003)
```

Zero skipped, zero `.only` (a tree-wide grep for `.only`/`.skip` in test files returns nothing).
977 → 1003 is 29 new tests less the 3 removed below; `commands.test.ts` itself goes 75 → 101.

### Mutation checks — twelve, all caught

The suite passed on the first run, which STATUS says to distrust. Neutralised, one at a time,
restoring between each:

| # | neutralisation | tests failed |
| --- | --- | --- |
| M1 | `refs` dedup removed | 1 |
| M2 | `own`/`others` swapped | 5 |
| M3 | `delete`'s force remedy dropped | 1 |
| M4 | `brokenSlots` report dropped | 1 |
| M5 | `declaresSlotPath` always `true` | 1 |
| M6 | `refs` line direction flipped | 5 |
| M7 | `list` returns a copied document | 2 |
| M8 | `delete` ignores the `force` flag | 2 |
| N1 | blocking half read from the CURRENT edge set | 2 |
| N2 | own half read from the after-removal set | 1 |
| N3 | addresses formatted against the reduced list | 3 |
| N4 | slot form also simulates removal | 1 |

### Size probe (D-077 clause 2, D-078 clause 2)

The new handlers sit on `executeCommand`'s call path, whose doc states one measured throw. Probed
rather than reasoned about, at the largest sizes the ruled bounds allow.

`table x=0 y=0 rows=1000 cols=1000` — D-070's worst corner — then every new command over it:

```
create ms 1547
list -> 0 ms [ 'table_1 — table' ]
refs table_1 -> 326 ms [ 'nothing references table_1' ]
refs table_1.ALL1000 -> 681 ms [ 'nothing references table_1.ALL1000' ]
delete table_1 -> 0 ms [ 'deleted table_1' ]
delete table_1 force -> 0 ms [ 'deleted table_1' ]
```

No throw. `refs <address>`'s 681 ms is `declaresSlotPath` walking the million declared cell paths
one at a time — never spread into a call (D-077 clause 1).

Deep formulas, the other half of the same claim. `refs`/`delete` both walk stored ASTs through
`deriveEdges` → `extractDependencies`, so I looked for the depth at which they unwind:

```
1000 committed; list/refs/delete all fine
2000 committed; list/refs/delete all fine
3000 commit failed: RangeError: Maximum call stack size exceeded
4000 commit failed: RangeError: Maximum call stack size exceeded
```

**A formula deep enough to break these three cannot be committed in the first place** — the parse
throws first — so no reachable document state makes them throw. Worth recording: this band is
**3,000 terms of `table_1.B1 + table_1.B1 + …`**, against entry 0079's 5,000 terms of `1 + 1 + …`.
The depth at which the recursive descent dies **depends on what the terms are**, not just how many;
entry 0079's band is not a constant and fix-list item 1's depth limit should be set from the
worst term, not from that measurement.

## Acceptance criteria status

Phase 3 criterion: *"you can create a polygon and a table by command, see both drawn, pan/zoom,
select, and drag the polygon"* — **NOT YET, and not claimed.** `main.ts` still holds no canvas.

Phase 4 criterion — **not claimed**, and Phase 3's gate is still unpassed, which §6 makes prior.

## Where I got stuck / what is unfinished

**`refs` was wrong when I first wrote it, and the tests I wrote for it all passed.** The first
version read `deriveEdges` over the CURRENT document for both halves. That looks obviously right and
is not. A range over cells nobody has written expands to **no edges at all** (D-047 item 1), and only
becomes the one dangling edge `deriveEdges` falls back to once the table it names is gone. So:

```
table x=0 y=0 rows=4 cols=4
table x=100 y=0 rows=4 cols=4
set table_2.A1 = SUM(table_1.A1:table_1.A4)

refs table_1     ->  nothing references table_1
delete table_1   ->  table_2.A1 references a slot that does not exist
```

That is the exact failure §5.1.1 provides this command to prevent — check before deleting, see
nothing, get refused. **Twelve tests passed over that version**, including one asserting `refs` and
`delete` agree, because every fixture I had written used a plain reference. I found it by probing the
range case on the way to writing a test for `delete`, not by reading the code. Fixed as decision 2,
with three tests in a block naming the case, and mutation check N1 pins it.

**The blocking half names the range's START cell as the source**, because that is the address
`deriveEdges` falls back to for a range whose table is gone — so the line reads
`table_1.A1 → table_2.A1` for a formula that actually reads `A1:A4`. The DEPENDENT is right, which is
what §5.1.1 asks to be named, and the source is a real address rather than an invented one. It is
still less than the whole truth and I am flagging it rather than papering over it.

**`refs <object>` derives edges twice** — once over the document, once over the document without the
target. Rule 5 makes that the correct trade and the probe above says the worst case is 326 ms, but it
is a thing a reviewer should see stated rather than discover.

**Two duplicate schema lookups now exist** (decision 4). Disclosed, not fixed, per §4.

**`refs` on a `derived` slot of an object whose own derived slots read it** reports them, which is
right, but there is no case anywhere in the tree of an EXTERNAL formula reading a derived slot and
then the object being deleted. The repair path handles it the same way — the edge is a plain
reference — but I did not add a test for that combination and it is the cheapest gap I am leaving.

## Open questions raised

None. Every choice above is bound by an existing ruling or is a disclosed, reversible implementation
decision. The live tags are still **Q-008** and **Q-012** only; neither was touched.

## Review point

**Fired: §6.1 trigger 5** — three `"<word>" has no handler yet` tests are gone because `delete`, `refs`
and `list` now have handlers, and `EVERY_REGISTRY_EXAMPLE`/`UNHANDLED_EXAMPLES` were re-split around
them. That is the same shape entry 0079 reported and it is reported here for the same reason: a
change being obviously required does not exempt it from the trigger it fires.

**Under §6.3's cap:** 522 lines / 2 files against 800/10, cycle 1 of 3.

REVIEW: **REQUIRED.**
