# 0004 — REVIEW (phase 0, mid-phase)
Date: 2026-08-21   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0003-address-cells-path-fix   Reviewing: cycle 0003
Prior review: 0002-REVIEW-phase0 (verdict: REVISE)

Scope: cycle 0003, which claims to resolve 0002-REVIEW-phase0's fix list in full.

---

## 1. Rule audit

| Rule | Verdict |
| --- | --- |
| **Rule 1** — `engine/` is pure, never touches DOM/window/canvas/`render/` | **UPHELD, and now mechanically enforced.** `tsconfig.engine.json` exists and works; I re-ran the reviewer's own probe from 0002 and it fails under the engine config where it previously passed. This closes the gap D-006 was written for. |
| **Rule 2** — all state change through `mutation.ts` | **NOT TOUCHED.** `address.ts` remains pure and stateless. |
| **Rule 3** — the addressing scheme is load-bearing, get it right early | **F-1 RESOLVED**, but a second, same-shaped defect was found in the fix itself — see F-2. Fixed by reviewer edit rather than another round trip. |
| **Rule 4** — one formula engine | **NOT TOUCHED.** |
| **Rule 5** — performance is a non-goal | **UPHELD.** No optimisation crept in; the added mapping is two straight-line functions. |
| **Rule 6** — slot set fixed during evaluation | **NOT TOUCHED.** |
| **Rule 7** — do not build §8 deferred items | **UPHELD.** |

## 2. Invariant audit

- **Stored address never contains a user-facing name** — UPHELD, test intact and now stronger
  (it asserts the stored path as well as the formatted output).
- **`formatAddress` is the exact inverse of `parseAddress`** — this was the point of the
  cycle. **Now genuinely true over the whole domain** after F-2's fix; it was true only over
  §5.2's five canonical forms as submitted. The implementer's header claim was correctly
  *scoped* to those forms, so it was not a false statement — but "exact inverse" invites the
  broader reading, and the broader reading did not hold.
- **Graph state plain, serializable, ID-referenced** — UPHELD.
- **Never throws** — UPHELD. `parseOk` in the tests throws by design; that is a test helper,
  not an evaluation path.

## 3. Spec conformance — F-1 resolved, F-2 found

### F-1 (from 0002-REVIEW) — RESOLVED and verified

`table_x.A1` now resolves to `{ objectId, path: ["cells","A1"] }`, `formatAddress` prints the
short form back, and the required round-trip test covers all five rows of §5.2's address
table. I re-ran the suite independently: **36/36 passing, typecheck clean under both configs**
before my edits. The fix is real and correctly scoped.

### F-2 (new, found during this review) — the mapping keyed on a structural proxy

The fix triggered the cells-prefix mapping on *"object is a table AND path has exactly one
segment"* rather than on the shorthand's actual form. I probed this rather than reasoning about
it, with a temporary test file (removed; `git status` clean):

```
✓ probe: what does the single-segment table rule actually capture? (3 tests)

  table_x.rows     → { path: ["cells", "rows"] }
  table_x.opacity  → { path: ["cells", "opacity"] }
  table_x.typo     → { path: ["cells", "typo"] }
  table_x.cells    → { path: ["cells", "cells"] }
  table_x.a1       → { path: ["cells", "a1"] }   ... alongside A1 → ["cells","A1"]
```

Three distinct problems, all confirmed live:

1. **The shorthand swallowed the type's entire single-segment namespace.** Every future scalar
   table slot resolves to a phantom `cells.<name>` slot no schema declares. Tables
   demonstrably gain non-cell slots — §5.10's `table x=0 y=0 rows=8 cols=8` implies at least
   `origin.x`/`origin.y` — so this becomes a live defect at Phase 2, not a permanent latent one.
2. **`toSurfacePath` was not the true inverse.** It stripped a `cells` prefix from *any*
   two-segment table path, so stored `["cells","rows"]` printed as `table_x.rows`, which
   re-parses to `["rows"]` — printing the name of a different slot than the one held.
3. **Lowercase and uppercase cell refs produced two different stored slots** for what the user
   sees as one cell — two sources of truth for one value, which §5.1's model does not tolerate.

This is the *same shape of error* as F-1: a rule that is correct on every example the brief
writes down and wrong on the ones it does not. That pattern, twice in one file, is worth
naming as a lesson rather than just fixing — hence D-008's closing line.

## 4. Legibility audit

Good and improving. Docstrings were genuinely updated to match new behaviour rather than left
stale (the most common way a fix cycle rots documentation). Vocabulary locked. No `any`, no
`.only`/`.skip`, no residual `as never` — I grepped, the review's L-1/L-2/L-3/L-4 items are all
genuinely closed, not just claimed closed. Test names remain behaviour sentences.

One observation, no action: `isAddressError` takes `unknown` and tests `"error" in value`, so
it would also accept a hypothetical `{error:"#TYPE"}`. Correct for its actual use (it only ever
sees these two unions) and the looser signature is what lets one guard serve both. Noted so a
future reader does not "tighten" it into two overloads for no benefit.

## 5. Honesty audit

**Clean.** Every claim independently re-verified:

- `npm run typecheck` → exit 0 across both configs. ✓
- `npm test` → 36/36, 0 skipped. ✓
- Test arithmetic: entry claims "28 before, +8". I counted the suite by describe block —
  4+2+5+4+12+1+3+5 = 36, and the delta decomposes exactly as claimed (2 new parseAddress
  tests, 1 `isAddressError`, 5 round-trip rows). **No test was silently dropped or weakened**;
  the one rewritten test was strengthened.
- D-006 probe: re-ran the reviewer's exact probe. Fails now, passed before. ✓
- §6.9 self-assessment: 4 files / 212 lines, correctly reported as under threshold. ✓
- §6.6 correctly self-reported for the changed test expectation, with the instruction cited
  as the review asked.

Two things I want to credit specifically, because they are the behaviours this process exists
to produce:

- The implementer **re-ran my own D-006 probe against their fix** instead of asserting the
  config existed. That is verification of the right thing, unprompted.
- The "Where I got stuck" section flags that the `"table"` type string is an undecided
  vocabulary — a real forward hazard, volunteered rather than discovered. It became D-009.

Nothing reported done that is a stub. No scope drift: `graph/node.ts` was correctly left alone.

## 6. Reviewer edits made

Small, surgical, and each explained — per §8. Verified after: **44/44 tests passing, typecheck
clean under both configs.**

1. **`address.ts` — `CELL_REFERENCE_PATTERN` (`/^[A-Z]+[0-9]+$/`) added; `toStoredPath` now
   keys on the A1 form** instead of on segment count. *Rationale:* F-2 problem 1 — stops the
   shorthand swallowing every non-cell single-segment table slot. Ruled as D-008.
2. **`address.ts` — `toSurfacePath` given the symmetric guard.** *Rationale:* F-2 problem 2 —
   makes "exact inverse" true over the whole domain, not just §5.2's forms. Restructured to
   early-return so the two conditions read in the same order as their inverse.
3. **`address.test.ts` — added 8 tests**: an `it.each` over five non-A1-form table paths
   (`rows`/`cols`/`opacity`/`cells`/`typo`), the lowercase case pinned to Q-004, a multi-letter
   ref (`AB12`) confirming the pattern is not accidentally single-letter, and a `formatAddress`
   test that a non-A1 `cells` prefix is *not* stripped. *Rationale:* every one of these was a
   behaviour I had to run a probe to discover, which is exactly the set that belongs in the
   suite.

I did **not** touch the implementer's `table_x.cells.A1` alias test — see §7.

## 7. Answers to the implementer's questions

**Q1 — was hardcoding the table→cells mapping in `address.ts` right, or should it have waited
for `primitives/schema.ts`?** Right call, and D-005 §4 explicitly permitted it. Deferring would
have left the wrong contract codified for another cycle, which was the whole problem. It is
correctly labelled in code as a stand-in and correctly listed in STATUS.md as a thing to move.
Keep it until `schema.ts` exists, then move it — see D-009 for the constraint on how.

**Q2 — is leaving a 2+-segment table path untouched (`table_x.cells.A1`) right, or should it
be rejected?** Leave it, keep the test. It is the natural consequence of the mapping rule
rather than an invented affordance, it is harmless (both forms name the same slot), and
rejecting it would mean `address.ts` validating path *shape* per type — which is the schema
validation the file explicitly disclaims doing. Accept the asymmetry that it prints back in
the short form; the round-trip guarantee is correctly scoped to §5.2's canonical forms, and
the header says so.

**Q3 — should object type strings be pinned now, or left for `graph/node.ts`?** Left for
`graph/node.ts`, but with a binding constraint attached, because "left open" is how
`"table"` ends up spelled two ways. Ruled as **D-009**: the type vocabulary is defined once as
a union type (not bare `string`), and `address.ts`'s `TABLE_TYPE` must then reference it rather
than keep its own literal. `AddressableObject.type` being `string` today means a typo silently
disables the mapping with no error anywhere — a union makes that a compile error.

## 8. Open questions

- **Q-004 — raised by me this review.** Are lowercase cell references accepted, and if so are
  they normalised? Blocks Phase 2 only. Current behaviour is uppercase-only (D-008), chosen
  because it is the forward-safe interim: moving to accept-and-normalise later is purely
  additive and migrates no stored data, whereas accept-and-store-as-written would require
  rewriting stored slot paths. Pinned by test rather than a `PROVISIONAL` tag, since the
  behaviour is deliberate-and-correct-for-now rather than a guess.
- **Q-001, Q-002** — remain OPEN, deferrals unchanged (Phase 3, reversible).
- **Q-003** — remains ANSWERED → D-007.

---

## Verdict: ACCEPT WITH EDITS

Cycle 0003 did what it was asked to do. F-1 is genuinely resolved and independently verified,
every one of the review's seven fix-list items is closed (not merely claimed closed), the
D-006 guardrail is real and demonstrated, and the log is accurate against the diff. The
verification discipline — re-running my probe rather than asserting the config existed — is
exactly right.

F-2 is a real defect and I found it by probing the unspecified cases, but it is two lines of
predicate in code the implementer had just been told to write under time pressure, and
handing back a second REVISE for it would cost a full cycle to change one regex. Fixed here
with tests, ruled as D-008 so the *lesson* (test the unspecified cases, not just the brief's
examples) outlives the fix.

**Phase 0 addressing is now closed.** `graph/node.ts` + `graph/edge.ts` may begin.

### Constraints carried into the next cycle

1. **D-009** — define object type strings as a union in `graph/node.ts`; replace `address.ts`'s
   `TABLE_TYPE` literal with a reference to it.
2. **D-007** — object `type` is *mutable* state (explode changes it in place); schema lookup
   reads the object's current type. Write this down in `node.ts` where the shape is defined.
3. The object shape must carry `id`, `name`, and `type` to satisfy `AddressableObject`.
4. **D-008's lesson applies to `node.ts` too**: the three slot kinds and the edge shape will
   have unspecified edge cases. Test those, not just the brief's examples.
