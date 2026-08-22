# 0004 — REVIEW (phase 0, mid-phase)
Date: 2026-08-21   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0003-address-cells-path-fix   Reviewing: cycle 0003
Prior review: 0002-REVIEW-phase0 (verdict: REVISE)

Scope: cycle 0003, which claims to resolve 0002-REVIEW's fix list in full.

## Rule audit
Rule 1 — UPHELD and now mechanically enforced (re-ran the reviewer's own DOM probe against the
new engine config; it now fails as intended). Rule 3 — **F-1 resolved**, but a second, same-shaped
defect found in the fix itself — see F-2. Rules 2/4/5/6/7 — not touched / upheld, no change.

## Spec conformance
**F-1 resolved and independently verified** — 36/36, both configs clean, before my edits.

**F-2 (new) — the mapping keyed on a structural proxy, not the shorthand's form.** Probed: the
fix triggered on "table object, one segment," so `table_x.rows`, `table_x.opacity`,
`table_x.typo`, even `table_x.cells` all resolved to phantom `cells.<name>` slots no schema
declares — and lowercase/uppercase cell refs produced two different stored slots for one cell.
Same shape of error as F-1: correct on the brief's examples, wrong on the unspecified ones.
Ruled **D-008**.

## Legibility
Genuinely improving — docstrings updated to match new behaviour, not left stale. L-1–L-4 from
0002-REVIEW all closed for real (verified by grep, not by reading the claim).

## Honesty audit
Clean. Independently re-verified typecheck/tests/D-006 probe. Test-count arithmetic checks out
(28 + 8 = 36, delta decomposes exactly as claimed). Credited: re-running my own D-006 probe
against their fix rather than asserting the config existed; the honest "table type strings are
undecided vocabulary" flag (became D-009).

## Reviewer edits (3, small)
1. `address.ts` — added `CELL_REFERENCE_PATTERN` (`/^[A-Z]+[0-9]+$/`); `toStoredPath` now keys
   on the A1 form. Ruled D-008.
2. `address.ts` — `toSurfacePath` given the symmetric guard, making "exact inverse" true over
   the whole domain.
3. `address.test.ts` — 8 tests covering the non-A1-form table paths, the lowercase case (pinned
   to Q-004), a multi-letter ref, and the corresponding `formatAddress` non-stripping case.

Post-edit: 44/44, both configs clean.

## Answers to implementer's questions
1. Hardcoding the table→cells mapping in `address.ts` — right call, D-005 §4 permits it; move
   to `schema.ts` once it exists (D-009 constrains how).
2. Leaving `table_x.cells.A1` untouched — right call, keep the test.
3. Object type strings — left for `graph/node.ts`, but ruled **D-009**: a union type, not bare
   `string`; `address.ts`'s `TABLE_TYPE` must reference it.

## Open questions
**Q-004 raised** (lowercase cell refs — Phase 2, current behaviour uppercase-only per D-008,
pinned by test). Q-001/Q-002 unchanged. Q-003 remains ANSWERED → D-007.

---

## Verdict: ACCEPT WITH EDITS

F-1 genuinely resolved, all seven fix-list items closed, D-006 real and demonstrated, log
accurate. F-2 is a real defect but small enough to fix here rather than cost another full cycle;
ruled as D-008 so the lesson outlives the fix. **Phase 0 addressing is now closed. `graph/node.ts`
+ `graph/edge.ts` may begin.**

### Constraints carried forward
1. D-009 — define object type strings as a union in `graph/node.ts`.
2. D-007 — object `type` is mutable state; schema lookup reads current type.
3. Object shape must carry `id`, `name`, `type` to satisfy `AddressableObject`.
4. D-008's lesson applies to `node.ts` too — test the unspecified cases.
