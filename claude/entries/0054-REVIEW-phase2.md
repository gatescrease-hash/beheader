# 0054 — REVIEW (phase 2 GATE)
Date: 2026-08-24   Phase: 2   Model: reviewer (Claude Opus 5)
Previous entry: 0053-delete-object-force-flag   Last review: 0051-REVIEW-phase2 (verdict: REVISE)
Reviewing: entries 0052 + 0053 — the diff since `e7793d9`, 602 changed lines across 2 source files
(`mutation.ts`, `mutation.test.ts`), plus `STATUS.md`, `DECISIONS.md`, `OPEN_QUESTIONS.md`.
This is the **Phase 2 gate** (§6.1 trigger 1, PROCESS_BRIEF §12).

## 0. Verdict

**ACCEPT WITH EDITS — the Phase 2 gate PASSES. Phase 3 is OPEN.**

0051-REVIEW's five-item fix list is closed, item for item, and verified against the built code
rather than the log (§2). The `force` slice is the shape D-056/D-057 specified: one repair
function, two callback pairs, one report channel. All five §6 clauses hold, and I re-proved
clause 5 against the brief's own wording — *two tables*, `table_a.B2 = table_b.C3 * 2`, delete the
source table — rather than against the fixture the new tests happen to use (§4).

One real defect found, in the report channel built this cycle: **`brokenSlots` could name a slot
that no longer exists in the committed state**, reachable in any batch that force-deletes an object
whose dependent is itself deleted later in the same batch (§5). Fixed here as a reviewer edit —
one filter, two tests — and ruled **D-059** so the next channel returning an `Address` inherits it.
Two comment-only edits besides (§6).

Nothing on a fix list. The carried known problems (the dimension/cell coherence gap and its
deletion-side contradiction of §5.4, the dangling-reference message naming the dependent, the
duplicated `describeValueType`) stay carried — none is a Phase 3 blocker and none got worse.

## 1. Honesty audit — the log matches the diff

Re-ran everything rather than reading the claims, on the tree as handed to me (before my edits):

```
$ npx tsc --noEmit && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run --reporter=dot
 Test Files  15 passed (15)
      Tests  651 passed (651)
```

651/651 confirmed. `.only`/`.skip`/`.todo`/`xit`/`xdescribe` grepped across `src/`: none. Rule 1
grepped clean — every `document.`/`window.`/`canvas`/`render/` hit under `src/engine/` is a header
prose line, a test local, or `document.ts`'s own parameter named `document`. No `any` in
`src/engine/` (the five hits are the English word in comments). No `throw` in engine source. No
dependency, build step, or config file added — `package.json` untouched.

Two specific claims checked because they are the kind that decay quietly:

- Entry 0053's mutation check reports `-t "force"` matching **8 tests, 3 of them unrelated Q-008
  tests**. Re-ran: `8 passed | 643 skipped (651)`. The arithmetic in that entry (4 of 5 new tests
  killed by the inverted gate; the no-dependents test passing under either branch, disclosed as
  expected rather than hidden) is exactly right.
- Entry 0052's claim that `STATUS.md` came under PROCESS_BRIEF §2's 150-line budget: 124 lines,
  and no known problem was dropped to get there.

The diff is what both entries say it is, file for file. Entry 0053 says it removed the file
header's stale "force flag NOT DONE HERE" bullet: it did. Entry 0052's "the bulk of this cycle's
diff is doc comments and tests, which is the right shape for a fix this narrow" is an accurate
description of its own diff — which is the check §10 exists for, and the one entry 0049 failed.

## 2. 0051-REVIEW's fix list — all five closed, verified against behaviour

1. **D-053, both dimensions (fix 1).** Closed. `findInvalidTableResizes` now reads both
   `rowsResizable` and `colsResizable` and names every offending dimension. The two new tests
   (ROW insert / ROW delete on a table whose `cols` is `formula`-kind) assert rejection, a message
   naming `cols` and D-046, and prior state bit-for-bit unchanged. Entry 0052's own D-016 mutation
   check — reverting the condition to the one-axis form and watching exactly those two tests fail
   — is the right check, and the tests are load-bearing against the exact defect, not merely
   passing. `TrackedTableState` was not restructured, as instructed.
2. **Pin, don't patch (fix 2).** Closed. The KNOWN INCOHERENCE describe block pins the
   out-of-extent deletion-rejection route, names it as an incoherence rather than a desired
   outcome, and states D-053's companion ruling forbidding a one-sided patch. It also asserts the
   pre-state is itself valid, which is what makes the test prove the deletion caused the rejection.
   `repairCellAddressForDelete`/`repairRangeEndpointsForDelete` are still unbounded, correctly.
3. **Disclose D-057 in code (fix 3).** Closed at 0052, then superseded at 0053 by building it —
   the KNOWN GAP paragraph now reads BUILT and points at the shared channel.
4. **`STATUS.md`'s "Next slice" per D-056 (fix 4).** Closed; the `force` cycle was steered to reuse
   `repairObjectFormulaAddresses`, and did.
5. **`STATUS.md` under 150 lines (fix 5).** Closed, 124.

## 3. Rule and invariant audit

- **Rule 1 (engine pure)** — upheld, grepped mechanically. Not otherwise at stake.
- **Rule 2 (all state change through `mutation.ts`)** — upheld, and this is the cycle where it had
  teeth: the `force` branch repairs every object BEFORE the deleted object is filtered out, all
  through pure functions returning new data, with `applyOperation`'s fold the only writer. Prior
  state is provably untouched on rejection — `cloneObjects` runs before the fold, and the new
  reject-by-default test snapshots and compares.
- **Rule 3 (two-layer addressing)** — upheld, and the interesting call is right:
  `resolveSlotPathForKey` recovers a report `Address` by resolving the schema's declared paths
  FORWARD and matching `slotKey`, never by splitting a stored key (D-010). Probed on a table cell
  — the dynamic slot family, the case a key-inversion shortcut would have got wrong — and the
  report came back `{objectId: "obj_1", path: ["cells","B2"]}`, a real address.
- **Rule 5 (dumbest correct implementation)** — upheld. The document-wide repair with no
  "is this object relevant" pre-filter matches the posture the two resize branches already set,
  and the per-slot `broke` closure flag is the smallest thing that works without changing
  `repairAddressesInAst`'s signature.
- **Rule 6 (slot set fixed during evaluation)** — upheld; slots change at mutation time only.
- **Rules 4, 7** — not touched.

Invariants: slot set fixed during evaluation, derived slots inside the topological pass,
eager/total extraction, lazy evaluation, plain serializable state — untouched, all hold.
`brokenSlots` is `Address[]`, plain and serializable, and lives on the RESULT, never in graph
state. **"No dangling edges"** verified directly on the force path rather than inferred:
re-deriving and re-validating the committed result after a forced delete is clean (§4's
transcript), because the reference became a self-contained `ErrorNode` (D-028) rather than being
dropped.

One thing worth naming: `repairReferenceForDeletedObject`/`repairRangeForDeletedObject` are a
single equality check each, and the range one checks BOTH endpoints even though D-045 guarantees
they name the same object. That is the right call — a function that cannot verify a guarantee
should not lean on it — and it is the difference between this pair and the table pair being
honest about what each knows.

## 4. The gate: all five §6 clauses, re-proved

Clauses 1–3 have named end-to-end tests in `mutation.test.ts` ("two separate tables, a cross-table
formula, live update"; "a circular reference between two tables, running through a RANGE"; "SUM
(A1:A5) recomputes correctly AFTER INSERTING A ROW INSIDE THE RANGE"), all re-run green above.
Clause 4 was verified at 0051-REVIEW and now additionally asserts `brokenSlots`.

Clause 5's new tests use a table with a `value`-typed dependent. That is a legitimate shape, but
the brief's sentence is about *that same table* in a two-table document, so I probed the literal
wording against the built code rather than accepting the substitute:

```
table_b.C3 = 5 ; table_a.B2 = table_b.C3 * 2

mutate([delete table_b])             -> ok: false  "table_a.B2 references a slot that does not exist"
mutate([delete table_b force: true]) -> ok: true
   table_a.B2 stored AST: {binaryOp *, left: {error #REF}, right: {literal 2}}
   table_a.B2 value:      {error: "#REF"}
   brokenSlots:           [{objectId: "obj_1", path: ["cells","B2"]}]
   deriveValidateAndEvaluate(committed) -> ok: true      (no dangling edge)
```

Both halves hold on the brief's own fixture, the `#REF` lands at the reference's own position
inside the surviving expression rather than swallowing the formula, and the committed state
re-validates. **Clause 5 PASSES.** I also confirmed the rejection names every dependent, not only
the first: two dependents produce `"value_1.value ...; value_2.value ..."`.

The gate passes on behaviour, not on description. For the record, what it does NOT cover, so
nobody later reads more into it: no test asserts both halves in ONE document as a single
narrative, and §5.4's report is proved per repair site rather than through a command line, which
does not exist yet.

## 5. The defect: `brokenSlots` named slots that were no longer there (D-059)

D-057's channel is right in shape and wrong at one edge. `applyOperation`'s force branch drops
reports about the object *that operation* deletes — "the deleted object itself, and any report
about ITS OWN slots, leave together" — but it cannot see the rest of the batch. Probed against the
built code:

```
[deleteObject obj_1 force, deleteObject obj_2 force]        (obj_2.value read obj_1.cells.A1)
→ ok: true   committed ids: []   brokenSlots: [{"objectId":"obj_2","path":["value"]}]

[deleteTableLine table_x row 2, deleteObject table_x force]  (cells.B1 read cells.A2)
→ ok: true   committed ids: []   brokenSlots: [{"objectId":"obj_1","path":["cells","B1"]}]
```

Both report a slot on an object the same batch removed. This is not cosmetic: the report exists to
send the user to the formulas they must now fix (§5.1.1, §5.4), and these name nothing fixable.
Worse, `formatAddress` — the only sanctioned way to display an `Address` (Rule 3) — resolves no
object for them and returns an `AddressError`, so a Phase 3 command line echoing this report would
print `#REF` where a slot name belongs.

Fixed here (§6, edit 1) and ruled **D-059**: the report is filtered against the committed state
once, in `mutate`, checking the SLOT and not only the object. `mutate` is the only site that knows
what the batch finally committed — the same reason dedup already lives there.

## 6. Reviewer edits (tree re-verified green after)

1. **`mutation.ts` + `mutation.test.ts` — D-059.** `mutate`'s `brokenSlots` now filters
   `dedupeAddresses(...)` against `result.objects`, keeping only addresses whose object AND slot
   still exist. Two tests added to the existing `force` describe block, one per shape probed in §5.
   Mutation-checked: with the filter reverted, both fail (`2 failed | 651 skipped`); restored, the
   full suite is green. Every existing report is unchanged — clause 4's and clause 5's
   `brokenSlots` assertions still pass untouched.
2. **`mutation.ts` (entry 0053's header paragraph) — D-058.** It contained a bare "this cycle's
   whole-object call", the exact form D-058 forbids for new comments. Now "entry 0053's". One
   phrase; no behaviour.
3. **`mutation.ts` file header — a stale NOT DONE HERE bullet.** It still listed **table resize**
   among the operation kinds "beyond" what this file implements, three cycles after
   `InsertTableLineOperation`/`DeleteTableLineOperation` landed (0047/0050) — and the very next
   bullet says reference adjustment is done for both directions, so the header contradicted itself.
   Rewritten to name the five operation kinds that now exist, leaving `explode` and vertex
   add/remove as the genuinely unbuilt ones. §5.2's standard is that a reader who opens one file
   understands it without reading anything else; this bullet actively misled such a reader.

```
$ npx tsc --noEmit && npx tsc --noEmit -p tsconfig.engine.json
(clean, both configs)
$ npx vitest run --reporter=dot
 Test Files  15 passed (15)
      Tests  653 passed (653)
```

## 7. Open questions

`OPEN_QUESTIONS.md` needs no new entries; entries 0052 and 0053 each raised none and each was right
not to — every choice they made was already settled by D-053–D-058. Next free: **Q-011**.

- **Q-007 (`CameraState`'s shape) — stays OPEN, and becomes LIVE with this gate.** Phase 3 builds
  `render/camera.ts`, the consumer that resolves it. 0025-REVIEW's constraints are restated here
  because this is the cycle that meets them: Phase 3 **widens** `document.ts`'s `CameraState`,
  never replaces it with a differently-named concept; it stays plain and serializable;
  `document.ts` does not grow a second reader of it; and `deserializeDocument`'s rejection of a
  malformed camera survives the widening. The Phase 3 implementer MUST reconcile and remove the
  `PROVISIONAL(Q-007)` tag in the same cycle that lands `render/camera.ts` (PROCESS_BRIEF §7
  clause 4) — not later.
- **Q-008 (`-0`) — stays OPEN, deferred, blocks nothing.** The provisional choice is taken and
  tagged. Phase 3 adds no new authoring path for `-0` through the formula engine, but a drag
  writes numbers straight into `origin.x`/`origin.y` (§5.9): if any interaction can author one,
  that cycle raises it rather than assuming this deferral still holds.

## 8. Phase 3 is open — what carries into it

Phase 3 is `render/*`, `command/*`, and `primitives/geometry.ts`: first pixels, and the first code
in this project that is not `engine/`. Four things the gate hands over:

1. **Rule 1 stops being free.** Every prior cycle was pure by construction. Phase 3 is where a
   canvas exists and where the `TextMeasurer` trap is set (Rule 1). `render/` provides the
   Canvas2D measurer, `main.ts` injects it, `engine/` never imports it —
   `tsconfig.engine.json` is the mechanical check that this holds. Keep running both configs.
2. **§6.1 trigger 2 fires repeatedly.** `render/renderer.ts`, `render/camera.ts`,
   `command/parser.ts`, `primitives/geometry.ts` are each the first file of a new subsystem. Each
   is its own stop-and-review, not a batch.
3. **Dragging calls the mutation API, per component (Rule 2, §5.9).** The per-component rule — a
   `formula`/`derived` component is skipped with feedback, never written — is a brief "deliberate"
   note and therefore exactly the kind that gets normalised into all-or-nothing. It is also what
   Phase 4(c) is graded on.
4. **The carried known problems stay carried, and none blocks pixels.** In particular the
   dimension/cell coherence gap and its deletion-side contradiction of §5.4 (0051-REVIEW §5, pinned
   by test at 0052) close on both axes together or not at all — a Phase 3 table-creation command
   must not "fix" one side on its way past.
