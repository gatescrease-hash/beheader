# 0002 — REVIEW (phase 0, mid-phase)
Date: 2026-08-21   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0001-scaffold-and-address   Reviewing: cycle 0001

Scope: the scaffold and `src/engine/address.ts` from cycle 0001.

## Rule audit
Rule 1 (no DOM in `engine/`) — UPHELD in code, but found **unenforced by tooling** (a DOM call
dropped into `engine/` compiled clean). Ruled **D-006**: DOM-free `tsconfig.engine.json`.
Rule 2/4/6 — not touched. Rule 3 (addressing) — **VIOLATED, see F-1 below.** Rule 5 — upheld
well (`generateDefaultName`'s deliberate linear rescan). Rule 7 — upheld.

## Finding F-1 (blocking) — `table_x.A1` must store `path: ["cells", "A1"]`, not `["A1"]`
PROJECT_BRIEF §5.2/§5.1 both specify the two-segment stored path for table cells; the cycle
returns `["A1"]` and a test locks in the wrong contract. This is structurally impossible to fix
without knowing the object's `type`, which `AddressableObject` didn't carry — not cosmetic; it
gets expensive exactly at Phase 2 once tables and their formulas exist. Ruled **D-005**.

## Legibility
Strong: file headers, cited spec sections, why-comments, locked vocabulary, zero `any`. Minor
items (dead eslint-disable, `as never` casts wanting an `isAddressError` guard, an undocumented
tuple cast) — folded into the fix list below rather than fixed here.

## Honesty audit
Clean — independently re-verified `tsc`/`npm test`, both accurate. Credited disclosures: the
Node.js install stop-and-ask, the `allowImportingTsExtensions` catch, the `claude/` layout
flag, the `npm audit` non-action. No stub claimed done, no scope drift.

## Ruling arising from this review
Probed Rule 1 enforcement directly (a DOM call inside `engine/` compiled clean under the single
tsconfig) — ruled **D-006**.

## Open questions
**Q-003 ANSWERED → D-007** (explode preserves ID/name — adds a third argument the seed didn't
make: `force`'s meaning depends on the object surviving). **Q-001/Q-002** — deferred, Phase 3,
reversible. `claude/` flat layout — kept as-is, not worth a DECISIONS entry.

---

## Verdict: REVISE

Not ACCEPT: F-1 is a real gap in a load-bearing file. Not REVERT: ~90% of the slice stands —
the two-layer scheme, rename-invariance, naming rules, never-throws discipline, and test shape
are all correct and reusable.

### Fix list for cycle 0003
1. Make the surface↔stored mapping correct per D-005 (table cells → `["cells","A1"]"`).
   `AddressableObject` needs `type`.
2. Make `formatAddress` the exact inverse; add a round-trip test over every §5.2 address form.
3. Correct `address.test.ts`'s wrong table-cell assertion (cite this review, not a cleanup).
4. Update `address.ts`'s header/docstrings to state the D-005 contract.
5. Export `isAddressError(v): v is AddressError`; drop the `as never` casts.
6. Drop the dead `eslint-disable` (no ESLint in this project).
7. Implement D-006: `tsconfig.engine.json`, DOM-free, covering `src/engine/**` + tests; wire
   `npm run typecheck` to run both configs.
8. Optional: document the tuple cast; decide whether `parseAddress` pre-validates name grammar.

Items 1–4 are one slice; 5–7 may ride along if the diff stays reasonable. Do not start
`graph/node.ts` this cycle — addressing must be settled first.
