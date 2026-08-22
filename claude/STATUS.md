# STATUS — as of entry 0003

STATE: GREEN (compiles under both tsconfigs, all tests pass)

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial. Addressing is done and its review findings resolved; graph model, cycles,
eval, mutation, and document round-trip are not started.

Last review: 0002-REVIEW-phase0, verdict REVISE. **Cycle 0003 (this entry) resolved that
fix list in full and reports REVIEW: REQUIRED again** — `address.ts` was modified, which is
always a trigger-2 file, and a test's expectations were changed (§6.6, explicitly instructed
by the review). Not yet re-reviewed.

## Built and reviewed
- Project scaffold: `package.json`, `tsconfig.json` (strict), `vite.config.ts`, `index.html`,
  Vitest via `npm test`. Accepted as-is at 0002-REVIEW.
- `src/main.ts` — placeholder entry point. Accepted as a labelled placeholder.

## Built, not yet reviewed
- `src/engine/address.ts` + `src/engine/address.test.ts` (§5.2) — 36 tests passing. Fixes
  0002-REVIEW-phase0's F-1: `table_x.A1` now correctly resolves to `path: ["cells", "A1"]`
  (D-005), `formatAddress` is its exact inverse, and a round-trip test covers all five address
  forms in PROJECT_BRIEF §5.2's table. Also closes the review's L-1/L-2/L-3/L-4 items (dead
  eslint directive removed, `isAddressError` guard added, tuple cast documented, name-grammar
  pre-check decision documented). **Awaiting re-review before `graph/node.ts` begins.**
- `tsconfig.engine.json` (D-006) — new. DOM-free config covering `src/engine/**`.
  `npm run typecheck` now runs both configs. Verified to actually catch a DOM call in
  `src/engine/` (it didn't before this existed — see entry 0003's Verification).

## Not started
In brief §7 order, remaining:
1. `src/engine/graph/node.ts` + `src/engine/graph/edge.ts` (three slot kinds).
   **D-007 constrains this: object `type` is mutable state; schema lookup reads current type.**
   Note: `address.ts` now also reads `object.type` for the D-005 path mapping, so `node.ts`'s
   object shape must carry `type` for that reason too, not only for D-007.
2. `src/engine/primitives/schema.ts` (derived-slot declaration mechanism). When this lands,
   the hardcoded table/`cells` mapping in `address.ts`'s `toStoredPath`/`toSurfacePath` should
   be driven by the schema's slot declarations instead — see entry 0003's "Where I got stuck."
3. `src/engine/graph/cycles.ts` (naive DFS) + `src/engine/graph/eval.ts` (naive full topo
   re-eval over all three slot kinds, derived slots inline, no post-pass)
4. `src/engine/mutation.ts` (clone / validate / commit + journal)
5. `src/engine/document.ts` round-trip test (including `nextObjectId`, D-002)

Then Phase 1 (formula engine). Do not start before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)

Send cycle 0003 for review (it resolves 0002-REVIEW-phase0's fix list). If accepted:
`src/engine/graph/node.ts` + `src/engine/graph/edge.ts` — the three slot kinds (`literal`,
`formula`, `derived`) and the Object/Edge data shapes, per PROJECT_BRIEF §5.1. The object shape
must carry `id`, `name`, and `type` (both for D-007's mutable-type requirement and to satisfy
`AddressableObject`). Stop there — `primitives/schema.ts` is the cycle after.

## Known problems
- **The table/`cells` path mapping in `address.ts` is hardcoded**, not schema-driven — noted
  explicitly in code and in entry 0003 as a stand-in for `primitives/schema.ts`. Not a defect;
  a known, documented placeholder to revisit when schema.ts exists.
- **Object `type` strings used in tests (`"polygon"`, `"circle"`, `"script"`, ...) are
  illustrative, not a decided vocabulary.** Whoever writes `graph/node.ts` /
  `primitives/schema.ts` picks the real set; nothing currently depends on the specific strings
  beyond `"table"`, which is load-bearing for the D-005 mapping.
- `npm run typecheck` still does not cover config files themselves (`vite.config.ts`,
  `vite.config.ts`'s own `tsconfig.engine.json` is covered since it's a `-p` target, but neither
  is in the default `tsc --noEmit` file set). Verified at 0002-REVIEW that `vite.config.ts`
  typechecks clean if forced into a config; low severity, unchanged from before.
- `npm audit` reports 5 vulnerabilities (3 moderate, 1 high, 1 critical) in the dev-dependency
  tree (transitive deps of Vite/Vitest, not runtime deps). Not investigated; out of scope.
- **Layout question — SETTLED, do not re-raise.** `claude/` stays flat (not restructured to
  match PROCESS_BRIEF §2's `claude-log/` diagram); ruled at 0002-REVIEW.

## Live PROVISIONAL tags
None. Q-003 is ANSWERED (→ D-007). Q-001 and Q-002 remain OPEN, explicitly deferred to Phase 3
— if you reach Phase 3 before the next review, take option (a) in each as a
`PROVISIONAL(Q-NNN)` choice under D-004 rather than blocking.

## Gotchas for the next model

- **`AddressableObject` now has three fields: `id`, `name`, `type`.** `type` drives the D-005
  table/`cells` mapping in `address.ts` — when you build the real object shape in
  `graph/node.ts`, it must carry all three (D-007 additionally requires `type` be mutable).
- **The surface path a user types and the stored slot path can differ** (D-005). Currently the
  only case is table cells (`table_x.A1` → stored `["cells","A1"]`); everything else is
  identity. `parseAddress`/`formatAddress` are exact inverses — round-trip-test any new address
  form you add, per the pattern in `address.test.ts`'s last describe block.
- Use `isAddressError(value)` to discriminate `Address | AddressError` /
  `string | AddressError` — don't reach for `as never` or a hand-rolled `"error" in x` check.
- `npm run typecheck` now runs two `tsc` invocations (root config + `tsconfig.engine.json`).
  Both must be clean. The engine config has no `DOM` lib on purpose (D-006) — if a new
  `src/engine/` file fails only under `-p tsconfig.engine.json`, that is very likely Rule 1
  catching a real DOM dependency, not a config bug.
- Node.js and Git are both installed (LTS / 2.55, via winget) but were absent at cycle 0001's
  start. Each PowerShell tool call is a fresh process — re-derive `$env:Path` from the
  Machine/User environment variables at the top of a command if `node`/`npm`/`git` seem missing.
