# STATUS — as of entry 0001

STATE: GREEN (compiles, all tests pass)

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial. Addressing is done; graph model, cycles, eval, mutation, and document
round-trip are not started.

Last review: 0000-SEED-reviewer, verdict N/A (baseline). **Cycle 0001 below reports
REVIEW: REQUIRED — has not yet been reviewed.**

## Built and reviewed
Nothing yet reviewed.

## Built, not yet reviewed
- Project scaffold: `package.json`, `tsconfig.json` (strict), `vite.config.ts`, `index.html`,
  Vitest wired via `npm test`. `npm run build` verified working. (entry 0001)
- `src/engine/address.ts` (§5.2) — `AddressableObject`, `Address`, `AddressError`,
  `isValidName`, `findObjectByName`, `findObjectById`, `isNameTaken`, `checkNameAvailable`,
  `generateDefaultName`, `parseAddress`, `formatAddress`. 28 tests, all passing. (entry 0001)
- `src/main.ts` — placeholder entry point only, no real wiring. (entry 0001)

## Not started
In brief §7 order, remaining:
1. `src/engine/graph/node.ts` + `src/engine/graph/edge.ts` (three slot kinds)
2. `src/engine/primitives/schema.ts` (derived-slot declaration mechanism)
3. `src/engine/graph/cycles.ts` (naive DFS) + `src/engine/graph/eval.ts` (naive full topo
   re-eval over all three slot kinds, including derived slots inline, no post-pass)
4. `src/engine/mutation.ts` (clone / validate / commit + journal)
5. `src/engine/document.ts` round-trip test (including the `nextObjectId` counter, D-002)

Then Phase 1 (formula engine), per PROJECT_BRIEF §6 — do not start before Phase 0's
acceptance criterion passes and is reviewed.

## Next slice (recommended)

`src/engine/graph/node.ts` + `src/engine/graph/edge.ts`: the three slot kinds (`literal`,
`formula`, `derived`) and the Object/Edge data shapes, per PROJECT_BRIEF §5.1. Make sure the
object shape you land on structurally satisfies `AddressableObject` (`{ id, name }`) from
`address.ts` — that's the seam this cycle deliberately left open. Stop there; `primitives/
schema.ts` (the derived-slot declaration mechanism) is naturally the cycle after, since
`eval.ts` and `cycles.ts` both need real slot/edge shapes to test against first.

This cycle (0001) is itself unreviewed — per PROCESS_BRIEF §3 Step 3, check whether review
has cleared before starting graph/node.ts if a review gate is expected to land first.

## Known problems
- `npm audit` reports 5 vulnerabilities (3 moderate, 1 high, 1 critical) in the dev-dependency
  tree (transitive deps of Vite/Vitest, not runtime deps). Not investigated or fixed — out of
  cycle 0001's declared scope. (entry 0001)
- PROCESS_BRIEF §2's file-layout diagram shows `PROJECT_BRIEF.md`/`PROCESS_BRIEF.md` and the
  `claude-log/` folder as siblings at `project-root/`. In this repository both brief documents
  and the STATUS/DECISIONS/OPEN_QUESTIONS files instead live flatly under `claude/` (this was
  already true at the seed commit, not introduced in 0001). Cycle 0001 followed that existing
  layout rather than restructuring it, treating the repository root (sibling to `claude/`) as
  PROJECT_BRIEF's `project-root/` for `src/`, `package.json`, etc. Flagging for the reviewer to
  confirm or correct — see entry 0001's Decisions section for the full reasoning.

## Live PROVISIONAL tags
None. Three questions are open (Q-001, Q-002, Q-003) but none blocks the next slice; all
three land in Phase 3 or later.

## Gotchas for the next model
- `address.ts` takes the object list it resolves against as a plain `readonly
  AddressableObject[]` parameter — it does not read or own document state (STATUS.md gotcha
  from 0000, taken literally since `graph/node.ts` didn't exist yet when address.ts was
  written). When you build the real object shape in `graph/node.ts`, it needs an `id: string`
  and a `name: string` field (at minimum) so it structurally satisfies `AddressableObject`
  without `address.ts` needing to change.
- Both `parseAddress` and `formatAddress` return a `#REF`-shaped `AddressError` on failure and
  never throw — this was a deliberate choice to match `ErrorValue`'s `#REF` arm and the "must
  never throw across the evaluation loop" rule (§5.1), even though nothing calls these from
  inside evaluation yet.
- `checkNameAvailable` (grammar + collision check for create/rename) deliberately does **not**
  return an `ErrorValue`/`AddressError` — it has its own small `NameCheckResult` type, because
  a rename rejection is a command-level thing, not a graph `Value`. Don't merge these two error
  shapes later "for consistency"; they're different failure domains on purpose (see entry
  0001's Decisions).
- Node.js was not installed on this machine at cycle 0001's start; it now is (LTS, via
  winget). If you're picking this up on a *different* machine, verify `node --version` /
  `npm --version` before assuming the toolchain is there — cycle 0001 lost real time to this.
- PowerShell in this environment does not persist `$env:Path` updates to newly-installed tools
  across separate tool invocations within a session in every case observed — if `node`/`npm`
  suddenly "disappear," re-derive PATH from the Machine/User environment variables rather than
  assuming the install failed.
