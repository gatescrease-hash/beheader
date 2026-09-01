# 0116 — REVIEW (phase 4 gate): entry 0115's gate test. The gate is CLOSED
Date: 2026-09-01   Phase: 4 → 5   Model: reviewer (a session other than entry 0115's, as that entry
and `STATUS.md` both required)
Reviews: entry **0115** — the whole code diff since 0113-REVIEW, which is one file:
`src/main.test.ts`, +142 / −0.
Previous review: 0114-REVIEW-phase4-gate
Verdict: **ACCEPT WITH EDITS.** Two edits, both in the block under review, both explained below.
**Phase 4's acceptance criterion is PASSED and its gate is CLOSED. Phase 5 may begin.**
One ruling: **D-111**, answering the question entry 0115 put to its reviewer.

## 1. What I actually ran, before reading anything as true

Re-run here, not read off the entry:

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npx vitest run
 Test Files  27 passed (27)
      Tests  1268 passed (1268)          # at HEAD, before my edits
```

`grep -rnE "\.(only|skip|todo)\("` over `src/` → nothing. Zero skipped, zero `.only`, as claimed.

**All three of entry 0115's mutation checks reproduced, individually, with its own reported
outcomes:**

| Mutation | Entry 0115 claimed | I observed |
| --- | --- | --- |
| Drop the `link` line from `gateDocument()` | 5 of 6 fail; **(b) survives** | 5 failed; (b) passed |
| Replace `set table_1.B1 = polygon_2.origin.x * 2` with the literal `600` | 3 fail *after* the strengthening, including "builds the whole document" | 3 failed, "builds" among them |
| Point the cyclic command at a non-cyclic cell | the cycle test fails on the missing word `cyclic` | failed: `expected '> set table_1.D4 = …' to contain 'cyclic'` |

That third one is the check that matters most and it is the one most people skip: it establishes
that the test passes because a cycle is genuinely detected, not because some other refusal happens
to carry the word. Entry 0115's account of its own weak first draft — a value-only assertion that a
coincidentally-equal literal satisfied — is accurate, and the strengthening it describes is the
reason the second mutation now fails three tests instead of two.

## 2. Rule audit

**No production code changed.** The diff is one test file, so Rules 1–7 are not at stake in the
ordinary way; audited anyway against the tree as it stands:

- **Rule 1 (engine purity)** — upheld, mechanically: `grep` for `document.`/`window.`/`canvas`/
  `CanvasRenderingContext2D` under `src/engine/` returns only `document.<field>` accesses on the
  ENGINE's own `Document` parameter in `document.ts`. No DOM, no `render/` import.
- **Rule 2 (all state change through `mutation.ts`)** — upheld and, unusually, *exercised* by this
  diff: every state change in the six tests arrives through `submitLine` or the pointer transitions,
  never by assembling a `Document` by hand. That is the right shape for a gate test — a fixture that
  hand-built the document would prove the graph works and not that the operator can reach it.
- **Rules 3, 4, 5, 6, 7** — not touched.

## 3. Invariant audit

Two invariants are asserted by the new tests rather than merely surviving them, which is worth
recording because both are ones the log has watched for since Phase 0:

- **Rejection leaves prior state bit-for-bit unchanged** — `expect(outcome.state.document).toBe(state.document)`
  after the refused cyclic `set`. Identity, not deep equality: the strongest available form.
- **Derived slots evaluate INSIDE the topological pass** — (b) asserts `table_1.B1` holds twice
  polygon_2's *new* `origin.x` in the same mutation as the drag, and (a) asserts `centroid.x`
  followed `origin.x`. A post-pass `recompute()` — §9's standing prohibition — would show up here as
  a one-step-stale cell.

Slot set fixed during evaluation, eager/total extraction, lazy evaluation, no dangling edges, plain
serializable state: not touched by this diff.

## 4. Spec conformance — the criterion, clause by clause

The brief's §6 Phase 4, checked against the tests rather than against the entry's summary of them:

- **"two separate polygons"** — `gateDocument()` builds `polygon_1` (driven) and `polygon_2`
  (driving). ✓
- **"(a) `polygon_a.origin.x` is a formula slot reading `table_x.A1`. Typing a new number in that
  cell visibly moves `polygon_a`."** — kind asserted `formula`; `set table_1.A1 650` moves both
  `origin.x` and the derived `centroid.x`. ✓
- **"(b) `polygon_b.origin.x` is a literal slot. `table_x.B1` holds `= polygon_b.origin.x * 2`.
  Dragging `polygon_b` on canvas updates that cell live."** — the formula and the drag were pinned;
  **the literal half was not asserted**, which is my second edit (§6 below). ✓ after the edit.
- **"(c) Dragging `polygon_a` slides it in Y only, with feedback that X is driven."** — Y moves by
  the camera-converted delta, X holds at 650, and the log names `table_1.A1`. ✓
- **"all three hold simultaneously in one document"** — the composite test performs (a), (b), (c) in
  sequence and then asserts all three over the SAME final state. ✓
- **"with no false cycle"** — this is the clause the edit in §5 is about.

## 5. The one real gap, and the edit that closes it — §5.1's own shape

**Finding F9 — the gate document cannot fail the "no false cycle" clause, whatever the graph's
granularity.** The document binds through two polygons, so its object-level graph is
`polygon_2 → table_1 → polygon_1`: a DAG. An implementation whose dependency graph was
object-granular — the exact mistake §5.1 exists to prevent — would accept this document too, and
every `not.toContain("cyclic")` in the block would stay green. The negative assertion is therefore
nearly free.

§5.1 names the discriminating shape itself, and names it as the whole reason for slot granularity:

> if the graph were object-granular, a chain like `table_x.A1 → polygon_1.origin.x → table_x.B1`
> would register as `table → polygon → table` and be falsely rejected as a cycle. That would be
> maddening in normal use.

**One object, driven BY the table and driving it back.** I probed the real system for it before
touching the tests, in a throwaway file, deleted after: `link polygon_1.origin.x table_1.A1` +
`set table_1.C1 = polygon_1.centroid.x` is **accepted**, `C1` reads 500, and `set table_1.A1 650`
drives `origin.x` to 650 and `C1` to 650 in the same pass. **The behaviour is right. Nothing was
pinning it.** `geometry.test.ts:418` is the closest thing in the suite and it is the one-directional
half — a table driving a polygon's derived slot, with nothing reading back out.

**Edit 1 — one test added to entry 0115's own describe block**, building the round trip on top of
`gateDocument()` so it lands inside the gate document rather than beside it:

```
it("no false cycle in §5.1's OWN shape either — ONE object driven BY the table and driving it back")
```

Mutation-checked twice, per the standing rule that a test passing on its first run is not yet
trusted: dropping the `(a)` link turns it red (`C1` reads 100, not 500), and pointing the round trip
at `polygon_2` instead — the same assertion, no longer a round trip — turns it red with
`expected 300 to be close to 500`. Both reverted; suite green after each.

This is why entry 0115's question is answered "yes, a third case — but not the one you proposed"
(§8, **D-111**).

## 6. Edit 2 — (b)'s polygon is asserted LITERAL in X

One line plus its reason, in "builds the whole document": `polygon_2.origin.x`'s kind is `literal`.
The brief's (b) says so explicitly, and it is the property that makes (b) and (c) *different* tests
— a driven X is not draggable, which is the brief's own stated reason for requiring two polygons.
The block asserted both bindings' kinds and left the literal implied by the drag succeeding.

**Verification after both edits:** both tsc configs clean; `npx vitest run` → **27 files, 1269
passed**, 0 skipped, 0 `.only`. Diff added by this review: +28 / −0 in `src/main.test.ts`.

## 7. Honesty audit

The log matches the diff: no production code, six tests, one helper, the fixture as described, and
every decision the entry claims to have made is visible in the code. The self-assessment is
unusually good — it leads with the weak assertion it shipped and caught, which is the section
§11.1 says is the most valuable and the one most entries under-write.

**One discrepancy, immaterial to the verdict, recorded because accuracy is the point:** the entry's
`Batch:` line and its "Review point" section both say **"132 insertions, 2 deletions"**. The actual
commit is **142 insertions, 0 deletions** — a pure append; nothing was deleted. Well under the
§6.3 cap either way, and nothing follows from it, but a diff total is one of the few numbers the
process asks to be stated so it can be checked without re-deriving it, and this one does not
survive checking. No further action; noted so the next reader trusts the number they measure over
the number they read.

The role deviation (the reviewer writing the gate test at the human's direction) was declared in the
entry, in the commit message, and in `STATUS.md`, together with the consequence — that its author
must not clear it. That is exactly right, and it is why this entry exists.

## 8. Entry 0115's question for the reviewer — answered, and ruled

> Is "no false cycle" adequately pinned by the pair, or does the criterion want a third case — e.g.
> a cycle that only closes once an empty cell is populated, which **D-110** will make reachable and
> which nothing tests today?

**No to that case; yes to a different one. Ruled D-111.** In short: the empty-cell cycle is
unreachable until D-110 is built, so a test written today would pin the current *refusal* and would
have to be rewritten by D-110's own cycle — a gate test pins its criterion, it does not anticipate a
ruling. **D-111 clause 3 binds D-110's implementing cycle to pin that case then**, because clause 5
of D-110 ("the cycle appears on its own at the populating mutation") is a claim about edge
re-derivation, not about a message, and nothing else in the suite reaches it. The third case the
gate *did* owe is §5.1's round trip, and it is built (§5).

## 9. Open questions

- **Q-017** (persistent A1-style table headers) — **deferred, still open, still recommended.** It is
  display-only and it is the cheapest thing on the board that makes the next human session less
  error-prone; the gate no longer depends on it, so it stays the human's call on timing.
- **Q-016** (may a panel row write a literal string/boolean) — **deferred, unchanged.** Nothing
  tagged, no operator can reach the site in today's schemas.
- **Q-012** (world units or screen pixels for stroke width / cell size) — **deferred**, due with the
  `style`-slots cycle, provisional (a) still tagged.
- **Q-008** (`-0` as document state) — **deferred**, blocking nothing.
- **Q-018** — ANSWERED by the human at entry 0114 → **D-110**. Not built; see below.

## 10. The gate, and what Phase 5 should wait for

**Phase 4's criterion — "(a) data drives geometry · (b) geometry drives data · (c) partial binding —
all three hold simultaneously in one document, with no false cycle" — is PASSED.** Both halves of
§12.1 are now satisfied: **witnessed** by the human's own session (entry 0114) and **pinned
executably** by entry 0115's six tests plus this review's seventh. **The gate is CLOSED and Phase 5
is OPEN** (§12.3).

**Recommended order for what comes next — this is routing advice, not a ruling:**

1. **D-109 clause 3 (F8) — a refused command keeps the typed line.** Smallest change on the board,
   `main.ts` only, and it taxes every refusal in the system until it lands.
2. **D-110 — the empty-cell reversal — BEFORE Phase 5's text primitive**, and this is the one
   ordering I would argue for. D-110 changes what a *reference* means and what edges a reference
   emits; Phase 5 adds a second consumer of exactly that (the text block-tree walker calling
   `deps.ts` over embedded ASTs, including untaken branches). Landing D-110 first means one flip
   surface. Landing it after means reconciling the text walker too, in a cycle that is already
   §6.1-triggered on its own. D-111 clause 3 binds that cycle to pin D-110 clause 5.
3. **D-109 clauses 1–2 (F7)** — cell decimals and clipping, `render/` only.
4. **Q-017's headers**, if the human wants the next hand session to be pleasant.
5. **Phase 5** — the text primitive.

Nothing here blocks Phase 5 procedurally. Item 2 is a cost argument, not a gate.

## 11. Edits made by this review

1. `src/main.test.ts` — one test added to the Phase 4 describe block: §5.1's one-object round trip
   (§5 above). +24 lines.
2. `src/main.test.ts` — one assertion added to "builds the whole document": `polygon_2.origin.x`'s
   kind is `literal` (§6 above). +4 lines including its comment.

No other file's code was touched. `DECISIONS.md` gains **D-111**; `STATUS.md` is rewritten.
