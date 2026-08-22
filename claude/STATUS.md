# STATUS — as of entry 0004-REVIEW-phase0

STATE: GREEN (compiles under both tsconfigs, all tests pass)

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial. **Addressing is complete and closed.** Graph model, cycles, eval, mutation,
and document round-trip are not started.

Last review: **0004-REVIEW-phase0, verdict ACCEPT WITH EDITS.** `graph/node.ts` may begin.

## Built and reviewed
- Project scaffold: `package.json`, `tsconfig.json` (strict), `vite.config.ts`, `index.html`,
  Vitest via `npm test`. Accepted at 0002-REVIEW.
- `src/main.ts` — placeholder entry point. Accepted as a labelled placeholder.
- **`src/engine/address.ts` + `src/engine/address.test.ts` (§5.2) — COMPLETE, accepted at
  0004-REVIEW with edits.** 44 tests. Implements the two-layer name/ID scheme, the naming
  rules, and the D-005 surface↔stored path mapping (`table_x.A1` ↔ stored `["cells","A1"]`),
  with `parseAddress`/`formatAddress` exact inverses over the whole domain.
- `tsconfig.engine.json` (D-006) — DOM-free config covering `src/engine/**`. Verified twice
  (0003 and 0004) to catch a DOM call the root config lets through.

## Built, not yet reviewed
Nothing. The tree is fully reviewed as of 0004.

## Not started
In brief §7 order, remaining:
1. `src/engine/graph/node.ts` + `src/engine/graph/edge.ts` (three slot kinds) — **next**
2. `src/engine/primitives/schema.ts` (derived-slot declaration mechanism)
3. `src/engine/graph/cycles.ts` (naive DFS) + `src/engine/graph/eval.ts` (naive full topo
   re-eval over all three slot kinds, derived slots inline, no post-pass)
4. `src/engine/mutation.ts` (clone / validate / commit + journal)
5. `src/engine/document.ts` round-trip test (including `nextObjectId`, D-002)

Then Phase 1 (formula engine). Do not start before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)

`src/engine/graph/node.ts` + `src/engine/graph/edge.ts`: the three slot kinds (`literal`,
`formula`, `derived`) and the Object/Edge data shapes, per PROJECT_BRIEF §5.1. Stop there —
`primitives/schema.ts` is the cycle after, and `eval.ts`/`cycles.ts` need real slot and edge
shapes to test against first.

Four binding constraints from review, all cheap if done now and painful if retrofitted:
- **D-009** — define the object type vocabulary as a **union type**, not bare `string`, and
  replace `address.ts`'s local `TABLE_TYPE` literal with a reference to it. Today a typo
  (`"tabel"`) silently disables the D-005 mapping with no error anywhere.
- **D-007** — object `type` is **mutable** state (explode changes it in place); schema lookup
  must read the object's *current* type. State this explicitly in `node.ts`.
- The object shape must carry `id`, `name`, and `type` so it satisfies `AddressableObject`.
- **D-008's lesson** — test the *unspecified* cases, not just the brief's examples. Both
  addressing defects found so far were rules that were correct on every example the brief
  writes down and wrong on the ones it does not.

## Known problems
- **The table/`cells` mapping in `address.ts` is hardcoded**, not schema-driven — a documented
  stand-in for `primitives/schema.ts`. Reviewed and accepted as correct for now (0004 Q1);
  move it when `schema.ts` lands, per D-009.
- `npm run typecheck` does not cover config files themselves (`vite.config.ts` is outside the
  default `tsc` file set). Verified at 0002-REVIEW to typecheck clean when forced in. Low.
- `npm audit` reports 5 vulnerabilities (3 moderate, 1 high, 1 critical) in the dev-dependency
  tree (transitive deps of Vite/Vitest, not runtime). Not investigated; out of scope.
- **Layout question — SETTLED, do not re-raise.** `claude/` stays flat (not restructured to
  match PROCESS_BRIEF §2's `claude-log/` diagram); ruled at 0002-REVIEW.

## Live PROVISIONAL tags
None. No `PROVISIONAL(Q-NNN)` tags exist in the codebase.

Open questions: **Q-001, Q-002** (Phase 3, deferred — take option (a) provisionally if you
reach Phase 3 first). **Q-004** (Phase 2, raised at 0004 — cell-reference case normalisation;
current uppercase-only behaviour is pinned by test, not by a tag, because it is a deliberate
forward-safe interim rather than a guess). **Q-003** is ANSWERED → D-007.

## Gotchas for the next model

- **`AddressableObject` has three fields: `id`, `name`, `type`.** `type` drives the D-005
  table/`cells` mapping. Your `node.ts` object shape must carry all three, and per D-009 `type`
  should be a union, not `string`.
- **The surface path a user types and the stored slot path can differ** (D-005). Only table
  cells today (`table_x.A1` → stored `["cells","A1"]`); everything else is identity. The
  mapping keys on the **A1 form** (`/^[A-Z]+[0-9]+$/`), not on segment count — see D-008 for
  why that distinction is load-bearing. Round-trip-test any new address form you add.
- Lowercase cell refs (`table_x.a1`) are deliberately **not** mapped, pending Q-004. That is
  intentional and pinned by a test — do not "fix" it without settling Q-004.
- Use `isAddressError(value)` to discriminate `Address | AddressError` and
  `string | AddressError`. It takes `unknown` on purpose so one guard serves both unions —
  do not split it into overloads.
- `npm run typecheck` runs two `tsc` invocations (root + `tsconfig.engine.json`). Both must be
  clean. If a new `src/engine/` file fails **only** under `-p tsconfig.engine.json`, that is
  Rule 1 catching a real DOM dependency, not a config bug.
- Node.js and Git are installed (LTS / 2.55, via winget) but were absent at cycle 0001's start.
  Each PowerShell tool call is a fresh process — re-derive `$env:Path` from the Machine/User
  environment variables if `node`/`npm`/`git` seem missing.
