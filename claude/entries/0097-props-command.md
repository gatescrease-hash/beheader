# 0097 — `command/props.ts` + the `props` command
Date: 2026-08-27   Phase: 4   Model: Claude Sonnet 5 (implementer)
Previous entry: 0096-render-slots-extent-split   Last review: 0095-REVIEW-phase4 (verdict: ACCEPT)
Batch: cycle 2 of up to 3 since last review; ~941 changed lines / 13 files cumulative since
0095-REVIEW (0096's 427/7 + this cycle's 514/6) — **over both §6.3 caps (800 lines, 10 files)**,
on top of this cycle's own §6.1 trigger. Stopping here either way; see "Review point" below.

## Declared scope

STATUS.md's queue item 1 (post-0096 renumbering): D-092 clause 4's `props <object>` command, built
on a new pure `src/command/props.ts` per D-094 clause 9's ruling that ONE enumeration must serve
both `props` and the (not-yet-built) properties panel. Not in scope: the panel itself (D-094's
remaining thirteen clauses), D-090's prompt preview, or anything else in the queue.

## Explicitly not in scope

The properties panel (`index.html`/`main.ts`/`render/*`), which is next in the queue and needs its
own cycle per STATUS.md's own note that this pair "are both load-bearing enough to want reviews."
I did not touch `render/*`, `main.ts`, or `index.html` at all this cycle.

## What I did

- **`src/command/props.ts`** (new) — `buildSlotDescriptors(object, objects)`: every slot an
  object's schema declares, in schema order (D-094 clause 7) — non-derived paths first, then
  `derivedSlots`. Walks `schema.nonDerivedSlotPaths` directly rather than calling
  `resolveNonDerivedSlotPaths` (which a table's `cells.*` group would expand to tens of thousands of
  entries — D-077): a `dynamic` group is never enumerated path-by-path, and for `table` specifically
  becomes ONE summary descriptor (`tableCellsSummary`) naming the grid shape and how many cells are
  WRITTEN (counted from `object.slots`' own keys, not from `enumerateTableCellSlotPaths`, so the
  count is cheap and matches D-047's "absent is ordinary empty"). `describeSlotValue` moved here from
  `commands.ts`, exported, per D-094 clause 9's explicit instruction that the value formatter is
  shared too, not only the descriptor list.
- **`src/command/props.test.ts`** (new) — 15 tests against hand-built `GraphObject` fixtures: literal/
  formula/derived descriptor shape, schema declaration order (`add`'s two ins then its one out), a
  formula's source reconstructed against current names (and re-reconstructed correctly after a
  rename, since a stored AST holds an ID), the table summary's exact text and its "one row, never one
  per cell" guarantee, an unknown-schema type returning `[]`, and `describeSlotValue` over every
  `Value` variant (§5.1).
- **`src/command/parser.ts`** — `PropsCommand` interface (mirrors `RefsCommand`), added to the
  `Command` union and the registry (`props <object>`, one positional `target`, no flags) — right
  after `refs`. Not a §5.10 command; D-092 clause 4 adds it through §5.10's own extension mechanism
  ("adding a command is one registry entry"), so `PROJECT_BRIEF.md` is untouched.
- **`src/command/parser.test.ts`** — one `DOCUMENTED_EXAMPLES` entry (`props intersection_a`), plus a
  sentence in the file's own header disclosing that this one entry is not verbatim from §5.10.
- **`src/command/commands.ts`** — `case "props"` in `executeCommand`'s switch, `"props"` in
  `COMMANDS_WITH_HANDLERS`, and the `props` handler: resolves the name (refusing an unknown one, the
  same as `refs`/`select`/`delete`), calls `buildSlotDescriptors`, and formats each descriptor into
  one log line (`<path> = <value> (<kind>)`, or `(formula, = <source>)` for a formula slot). No
  `effect` (D-075 clause 4, D-092 clause 6) — like `refs` and `list`, it reads and refuses to write.
  The local `describeSlotValue` is deleted; its two remaining call sites (`buildSlot`'s literal
  message, `unlink`'s message) now import it from `props.ts` — same function, same behaviour, one
  fewer copy. `Point` and `isErrorValue` dropped from this file's own imports (unused once
  `describeSlotValue` left).
- **`src/command/commands.test.ts`** — one `EVERY_REGISTRY_EXAMPLE` entry, the outer describe's title
  widened to name `props`, and a new `describe("props — ...")` block (10 tests) end to end through
  `parseCommand`/`executeCommand`: header line, schema-order listing for a polygon (all 14 slots, by
  path only — no derived VALUE is pinned, since those are floats this test has no business asserting
  exactly), a literal line, a derived line, a formula line (via a real `link`), the table summary line
  before and after two cells are written, table slot order, an unknown-name refusal, and the
  no-document-mutation guarantee.

## Decisions I made

- **The dynamic-group summary is reached by an explicit `object.type === TABLE_TYPE` check, not a
  generic "summarise any dynamic group" abstraction.** `TABLE_SCHEMA`'s `cells.*` is the only dynamic
  `NonDerivedSlotPathGroup` in the whole registry today (confirmed by reading `primitives/schema.ts`
  in full), and D-094 clause 8's own wording is specific to tables ("A table gets ONE modifiable row
  for `cells`"), not phrased as a general rule. Disclosed in `props.ts`'s own header: a future
  `dynamic` group on a different type is silently DROPPED, not enumerated, until this file is
  revisited — the safe failure direction (never a D-077 violation), but a real gap, not a hidden one.
- **"Written" is counted from `object.slots`' own keys**, filtered by the `cells.` prefix, rather
  than intersecting `enumerateTableCellSlotPaths`'s declared set against what exists. Cheaper (no
  `rows × cols` walk) and the more honest reading of "written": a slot the operator actually set,
  never a declared-but-absent one (D-047).
- **The summary row's `kind` is `"literal"`.** Not `derived` (it must render in the panel's
  modifiable group, D-094 clause 5), and no single kind honestly describes a family whose cells are
  independently `literal` or `formula` — `"literal"` was the least wrong of the three, and the row is
  disclosed as synthetic in `props.ts`'s own doc comment rather than pretending to be a real slot.
- **The summary's VALUE is a plain descriptive string**, which `describeSlotValue` therefore quotes
  like any other string value (`cells = "4×4 grid — ..." (literal)`). Considered a bypass field to
  skip quoting; declined — a second code path in the shared formatter for one synthetic row is more
  machinery than the cosmetic gain is worth (Rule 5), and the quoting is not actually misleading once
  the row is understood as a value like any other.
- **Registry placement:** `props` sits between `refs` and `list` in both `parser.ts`'s `COMMAND_SPECS`
  and `commands.test.ts`'s "delete, refs, props and list" block — it answers the same kind of question
  `refs` does ("what do I not yet know about this object"), just about slots instead of dependents.

## Verification (real output)

$ npx tsc --noEmit
(exit 0, no output)

$ npx tsc --noEmit -p tsconfig.engine.json
(exit 0, no output)

$ npx vitest run
 Test Files  26 passed (26)
      Tests  1174 passed (1174)

$ npm run build
✓ 31 modules transformed.
✓ built in 302ms

Zero skipped, zero `.only`. 1174 = 1148 (entry 0096's count) + 26 new (15 in `props.test.ts`, 10 in
`commands.test.ts`'s new `props` block, 1 in `parser.test.ts`).

**Mutation check on `props.ts`, three mutants, each seeded alone and `diff`-confirmed reverted to the
pre-mutation file afterward:**
1. `rows * cols` → `rows + cols` in the table summary's total — **killed 4** (the two exact-text
   summary tests in each of `props.test.ts` and `commands.test.ts`).
2. A literal slot's descriptor mis-tagged as `formula` with a fake source — **killed 3** (the `add`
   fixture's schema-order test, whose `toEqual` pins the whole descriptor shape).
3. The table's dynamic-group summary replaced with a full per-cell enumeration (what D-077 forbids)
   — **killed 7**, including the two tests written specifically to defend "one row, never one per
   cell."

## Acceptance criteria status

Not a phase criterion — this is D-092 clause 4 and D-094 clause 9, both already ruled at
0095-REVIEW. "Done when" (from the queue): a pure module exports the slot-descriptor type and the
building function, one registry entry formats log lines from it, it is read-only (no `effect`), and
a table's non-derived paths are summarised rather than spread. All four hold, verified above.

## Where I got stuck / what is unfinished

Nothing unfinished within the declared scope. The one thing I went back and forth on is recorded
above (the dynamic-group summary's table-specific branch) — I chose the narrower, more literal
reading of D-094 clause 8 over inventing a generalised mechanism the ruling does not ask for, and
disclosed the resulting limitation rather than papering over it.

## Open questions raised

None. D-092 and D-094 already answer everything this cycle touched.

## Review point

**Fired: §6.1 trigger 2 — "you created the first file of a new subsystem."** `command/props.ts` is
a new file with no prior reviewed code to extend, exactly as STATUS.md's queue already anticipated
("cycles 2 and 3 both create a new subsystem file, which is a §6.1 trigger on its own"). Also, for
the record: the batch cap (§6.3) is independently exceeded — ~941 lines / 13 files cumulative since
0095-REVIEW — though the §6.1 trigger already forces the same stop on its own.

`REVIEW: REQUIRED.`
Reason: new subsystem file (§6.1 trigger 2); also over both §6.3 caps.

Questions for reviewer:
1. Is the table-specific `object.type === TABLE_TYPE` branch (rather than a generic "summarise any
   dynamic group") an acceptable reading of D-094 clause 8, given it is the only dynamic group that
   exists today and the limitation is disclosed?
2. Is `"literal"` the right `kind` for the table's synthetic `cells` summary row, or should
   `SlotDescriptor` grow a fourth kind (e.g. `"summary"`) so the panel (next cycle) cannot mistake it
   for a real modifiable slot it could offer to edit later?
3. `props`'s registry position (between `refs` and `list`) and its message text on an unknown name
   (`no object named "..."`, identical to `refs`/`select`/`delete`) — any objection before the panel
   cycle starts consuming this same module?
