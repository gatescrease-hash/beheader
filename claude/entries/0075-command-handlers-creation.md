# 0075 — command handlers: the execution seam and the four creation commands
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (implementer)
Previous entry: 0074-REVIEW-phase3   Last review: 0074-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~835 lines / 13 files changed so far — **over
§6.3's cap**, and §6.1 trigger 5 fired independently. See "Review point" below.

## Declared scope

Build `command/commands.ts` — the seam where a `Command` meets a `Document` (D-069) — and its
four CREATION handlers (`circle`, `polygon`, `rect`, `table`), with D-070's count bounds and the
`origin.x`/`origin.y` pair `TABLE_SCHEMA` owes the render layer. Every other `Command` arm is
routed and reports itself unbuilt by name, so the switch is exhaustive from the first commit.
Nothing is wired into `main.ts`.

## Explicitly not in scope

- `set`/`set-formula`/`link`/`unlink`. D-040/D-041's reconciliation and D-071 clause 4's ONE
  shared slot-writing path are one coherent slice and belong together, in the next cycle. This
  cycle calls `parseFormula` nowhere, so **D-038's four conditions are still not due.**
- `rename`/`delete`/`refs`/`list`, and `select`/`zoom`/`fit`/`save`/`load`.
- `main.ts` wiring, §5.9's visual-feedback trio (D-068), `pan` and Q-012.
- The 0074-REVIEW fix list, items 1–6. None of it touches the files I opened, and item 1's own
  ruling (D-074) is about `prompt.ts`. Deliberately left for whichever cycle next opens
  `parser.ts`/`prompt.ts`, as that fix list itself says.
- The two stale claims in `mutation.test.ts`/`schema.test.ts` that STATUS carries. I did not
  falsify them (`mutation.test.ts:2038`'s "still-deferred resize/creation cycle" means row/column
  resize, which landed at 0047/0050 — pre-existing debt, not mine under D-065).

## What I did

### New — `src/command/commands.ts` (332 lines)

`executeCommand(command, document): CommandOutcome`. §5.10's handler half, §4's own
"command handlers -> mutation API calls".

- **`CommandOutcome`** is `{ ok: true; document; lines } | { ok: false; message }`. The success
  arm always carries a document — a command that changes nothing hands back the one it was given
  — so a caller stores one thing either way with no branch. `lines` is §5.10's echo, one entry
  per line so a multi-line answer (`list`, `refs`) needs no agreed separator later.
- **The switch names every one of the seventeen `Command` arms** and closes with the house
  `const exhaustive: never`. The twelve with no handler report `"<word>" has no handler yet —
  nothing was changed`. `set`/`set-formula` share one arm and report under `set`, because
  `set-formula` is a `Command` kind and not a command word (STATUS's own carried note).
- **`createObjectFromCommand`** is the one creation path all four handlers share: `mintObjectId`,
  `generateDefaultName(type, objects)`, build slots, `mutate([createObject])`, and on success
  return a new `Document` with the advanced counter. **The derived slots come from the SCHEMA**
  (`schema.derivedSlots` → `{ kind: "derived", value: null }`), never a hand-written path list —
  D-018 requires a `derived`-kind slot at every declared derived path, and there is nothing
  type-specific about satisfying it. The `null` never escapes: step 7 of the same mutation
  overwrites it before anything commits (proved by a test asserting a fresh circle already holds
  32 vertices and a real `area`).
- **D-070, all four clauses.** `MAX_POLYGON_SIDES = 1000`, `MIN_TABLE_LINES = 1`,
  `MAX_TABLE_LINES = 1000` declared beside the code that enforces them, the lower bound on
  `sides` imported from `geometry.ts`'s existing `MIN_POLYGON_SIDES` rather than re-spelled. The
  check runs BEFORE any `Operation` is built and REJECTS; `geometry.ts`'s `#TYPE` for `sides < 3`
  is untouched and stays the defensive arm for a loaded file. `createTable` reports BOTH
  dimensions when both are out of range.
- A COORDINATE is deliberately unbounded — only a count decides how many slots exist. An
  unrepresentable one is `mutate`'s to refuse (D-025), and the message it produces is good; see
  the real output below.

### New — `src/command/commands.test.ts` (369 lines, 42 tests)

Lines are pushed through `parseCommand`/`beginCommand` rather than hand-built `Command` objects
wherever the point is end to end. The last block reaches across the seam into `render/hittest.ts`
and `render/interaction.ts` on purpose — see "carried debt discharged" below.

### `src/engine/document.ts` (+25)

`mintObjectId(document): { id, nextObjectId }`. The id format `obj_<n>` (D-002) now exists in
code exactly once, beside the counter it comes from, rather than being invented in `command/`.
It returns the PAIR so the advance cannot be forgotten: storing the object at all means writing
`nextObjectId` back.

### `src/engine/primitives/schema.ts` (+21/-9) — load-bearing (§6.2)

`TABLE_SCHEMA` now declares `origin.x`/`origin.y` alongside `rows`/`cols`, using the same two
path constants every geometry preset uses. This is the pair STATUS has recorded as owed since
0069-REVIEW. What it buys is not the drawing — an undeclared literal already drew — but that
**only a DECLARED path may hold a `formula` slot (D-017)**, so without it `link table_x.origin.x
<address>` could never commit. Pinned by a behavioural test that writes a formula slot at
`table_1.origin.x` through `mutate` and reads the propagated value back.

### `src/engine/primitives/schema.test.ts` (+8/-6) — **§6.1 trigger 5**

Three `resolveNonDerivedSlotPaths` expectations for `table` now include the two origin paths, and
two test names and the `tableObject` helper's doc comment were reworded to match. **This is a
changed test expectation and it fires trigger 5.** It is the direct, unavoidable consequence of
the schema change above — those tests assert the schema's resolved path list with `toEqual`, so
any addition changes them regardless of ordering. Nothing was weakened: the tests still assert an
exact list, two paths longer.

### Comment corrections owed under D-065 (8 files, comment-only, 1–4 lines each)

My work falsified these; D-065 makes them mine, not drive-by refactors:

- `src/main.ts` — said "no command HANDLER exists to turn a command object into a mutation — so
  nothing can create an object." Now false. Rewritten to say what is missing is only on `main.ts`'s
  own side.
- `src/render/renderer.ts` — a whole NOT DONE HERE bullet said `TABLE_SCHEMA` declares no origin.
  Removed; `drawTable`'s own doc now states why it reads those two paths and what the `(0, 0)`
  fallback means.
- `src/render/interaction.ts` — said a `table` cannot be dragged because it has no origin. It can
  now, down the same per-component path every preset uses.
- `src/render/hittest.ts`, `src/render/hittest.test.ts`, `src/engine/primitives/table.ts` (×2),
  `src/engine/primitives/table.test.ts` — five sites calling a dimensionless table "the ordinary
  not-yet-populated table" / "no table-creation command exists yet". A creation command exists;
  such a table now comes only from a load or a raw `setSlot`. Reworded to say that, which is a
  sentence that cannot go stale.
- `src/engine/mutation.ts` — `CreateObjectOperation`'s doc called a user-facing creation command
  "a different, NOT-YET-BUILT concern... layered on top of this same primitive later." Now built;
  it names `command/commands.ts` and says the primitive is what both routes commit through.

### Carried debt discharged

**"An end-to-end test through a table-creation command"** (0074-REVIEW fix-list item 6, owed since
0062-REVIEW). Two tests: a `beginCommand("table x=40 y=20 rows=2 cols=3")` line whose committed
document `hitTest` finds at `(41,21)` and misses at `(39,19)`, and a `pointerDown`/`pointerMove`
that drags the same table by (+10,+5) with no notices and no rejection. `renderer.test.ts`,
`hittest.test.ts` and `interaction.test.ts` still pin their own table paths against fixtures; what
was missing was any test that a REAL table matches those fixtures, and that is what these are.

## Decisions I made

1. **A created table gets NO cell slots.** D-047 clause 3 left "which representation of an empty
   cell a table uses" to "the still-unbuilt creation/resize cycle" and pre-cleared both, requiring
   only that they behave identically inside an aggregate. Absent wins: four slots instead of
   sixty-eight for the default 8×8, and every consumer already handles it (`insertTableLine` skips
   an absent cell, `readRange` omits it, the renderer draws nothing). `set table_x.A1 5` creates
   the slot when there is something to put in it. Reversible — D-047 is what makes the two
   spellings interchangeable, so no saved document depends on the choice.
2. **`CommandOutcome`'s success arm always carries a document**, even for a command that changes
   nothing. One shape, no caller-side branch.
3. **`select`/`zoom`/`fit`/`save`/`load` are routed but unbuilt here**, and the file's NOT DONE
   HERE states the intent that `main.ts`'s cycle WIDENS `CommandOutcome` with an effect field
   rather than teaching this file about a canvas or a file input. That is an intent, not code —
   flagged for the reviewer below rather than committed to.
4. **`polygon`'s `rotation` defaults to `0`.** §5.5 gives it a slot, §5.10's form gives it no
   argument, and `parser.ts`'s own comment already says `set polygon_1.rotation` is how it is
   reached.
5. **The id format lives in `document.ts`, not here.** D-002's counter is document state and the
   format is its vocabulary; `command/` inventing `obj_<n>` would put it in a second place the
   first time anything else mints one.

## Verification (real output)

```
$ npx tsc --noEmit
exit 0                                  (no output)
$ npx tsc --noEmit -p tsconfig.engine.json      (D-006's DOM-free config)
exit 0                                  (no output)
$ npx vitest run
 Test Files  23 passed (23)
      Tests  925 passed (925)
$ grep -rnE "\.only\(|\.skip\(|it\.todo|describe\.todo" src/
(no output)
```

Baseline at the start of this cycle was 883/883, 22 files. 42 new tests.

### Mutation checks (D-016 part 1) — six, all re-run, ANSI-stripped, asserted on the `Tests` line

**The checker was checked first**: with the tree green it printed `Tests  924 passed (924)`; with
one assertion deliberately broken it printed `Tests  1 failed | 923 passed (924)` and named the
test. It does not silently always pass.

| Neutralised | Observed | Named failures |
| --- | --- | --- |
| `refuseCountOutOfRange` → always `undefined` | **6 failed** | all five D-070 tests + "does NOT advance the counter when the creation is refused" |
| `mintObjectId` → counter does not advance | **3 failed** | the id test and both default-name tests |
| `createObjectFromCommand` → skip `schema.derivedSlots` | **15 failed** | every creation and identity test (D-018 rejects the object outright) |
| `TABLE_SCHEMA` → origin paths removed | **4 failed** | the behavioural "origin its SCHEMA declares" test + the three `schema.test.ts` ones |
| `createTable` → write no origin literals | **2 failed** | the table-creation test and the end-to-end `hitTest` one |
| `noHandlerYet` → drop the command word from the message | **13 failed** | all twelve unhandled arms + the `set-formula` one |

Tree restored and re-verified green after each.

### Real behaviour, through `parseCommand` → `executeCommand`

```
polygon sides=5 x=0 y=0 r=50
   OK   created polygon_1   [objects: polygon_1; nextObjectId 2]
table x=200 y=0 rows=3 cols=4
   OK   created table_1   [objects: polygon_1, table_1; nextObjectId 3]
polygon sides=2.5 x=0 y=0 r=1
   REFUSED   sides must be a whole number from 3 to 1000, got 2.5
table x=0 y=0 rows=0 cols=1000001
   REFUSED   rows must be a whole number from 1 to 1000, got 0; cols must be a whole number from 1 to 1000, got 1000001
circle x=<400 digits> y=0 r=1
   REFUSED   operation 1 of 1: circle_1.origin.x would hold an illegal value (Infinity), which is not legal document state (D-025/Q-008)
list
   REFUSED   "list" has no handler yet — nothing was changed
```

(`circle` alone is not shown because that probe called `parseCommand` directly; `beginCommand`
starts its prompt sequence, which the end-to-end test drives.)

## Acceptance criteria status

**Phase 3 criterion (§6):** *"you can create a polygon and a table by command, see both drawn,
pan/zoom, select, and drag the polygon."* — **NOT YET.** Creation by command now works and is
tested; drawing, pan/zoom and select still require `main.ts`, which holds no canvas and listens
for nothing. **No pixel has ever come out of this project.** The engine-side consequence of
"create a polygon and a table by command" is demonstrated by
`commands.test.ts`'s creation block and by the two end-to-end tests; the *visible* half of the
criterion is untested and unclaimed.

## Where I got stuck / what is unfinished

- **This cycle is over the §6.3 diff cap** (~835 lines / 13 files against 800/10) and I did not
  see that coming when I declared the slice. Eight of the thirteen files are 1–4 line comment
  corrections D-065 makes mandatory, and `commands.test.ts` is 369 of the lines — but that is an
  explanation, not a defence. A tighter slice would have been the seam plus `circle` alone, with
  the other three presets following; I judged that splitting four handlers that share one function
  would produce three cycles of one line each and a worse log.
- **`STATUS.md` got LONGER, not shorter.** 0074-REVIEW left it at 169 against §2's "< 150" and
  said so. My first rewrite came out at **197**; I trimmed it to **181**, which is still 12 lines
  worse than I found it. What grew is the "built this batch, not yet reviewed" block and the
  gotchas a cold reader needs about a seam that did not exist yesterday. I am not going to claim
  the trim pass succeeded — this is now the second consecutive cycle to hand the same request to
  the human, from the same evidence.
- **`commands.ts`'s header is 54 lines**, over §5.2's 20–40 "ordinary" budget. It is the sixth
  consecutive cycle to report this and I have nothing new to add beyond four reviews' standing
  recommendation. I did not cut it to 40; what is there is the D-069/D-070/D-018 reasoning a cold
  reader needs, and trimming it to fit a number the whole codebase misses would be theatre.
- **The `origin.x`/`origin.y` path constants for a table are imported from `geometry.ts`.** That
  reads oddly — a table is not geometry — but `renderer.ts`, `hittest.ts` and `interaction.ts`
  already import them for exactly this, and a second constant would be D-010's own hazard. Worth a
  reviewer's opinion on whether the pair should move somewhere neutral.
- **Nothing exercises `createObjectFromCommand`'s "type has no schema" branch**, because all four
  types have schemas. It is a returned failure rather than an assumption, disclosed here rather
  than covered.
- **`refs`, `list` and the rest report failure**, which is honest but means the operator's log
  fills with refusals for commands §5.10 documents. That is the correct intermediate state and it
  closes next cycle.

## Open questions raised

**None, and no `PROVISIONAL` tag taken.** Everything I decided was either pre-cleared by an
existing ruling (D-047 on empty cells, D-070 on the bounds, D-002 on ids) or is a reversible
implementation choice fully disclosed above. Three things want a reviewer's *opinion* rather than
a ruling, and they are in the summary block below. Next free question number is still **Q-014**.

## Review point

**Fired: §6.1 trigger 5** — `schema.test.ts`'s three `resolveNonDerivedSlotPaths` expectations for
`table` changed, as the direct consequence of adding the origin pair to `TABLE_SCHEMA`. Entry
0073's ruling applies and I am applying it the way it reads: STATUS and two reviews *authorised
the change*, and that authorisation is not an exemption from the trigger the change fires.

**Also over §6.3's cap**: 1 cycle, but ~835 changed lines across 13 files (cap 800/10).

**Also §6.2**: `document.ts` and `primitives/schema.ts` are load-bearing files with unreviewed
changes, so no later phase may begin until this is reviewed regardless.

**REVIEW: REQUIRED.**
