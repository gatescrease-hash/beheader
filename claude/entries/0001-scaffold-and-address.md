# 0001 — scaffold-and-address
Date: 2026-08-21   Phase: 0   Model: Claude (Sonnet 5)
Previous entry: 0000-SEED-reviewer   Last review: 0000-SEED-reviewer (verdict: N/A, baseline)

## Declared scope
Scaffold the project (package.json, strict tsconfig, vite.config.ts, index.html, Vitest) and
build `src/engine/address.ts` (`parseAddress`/`formatAddress`/name↔ID resolution) with tests.
Nothing else — `graph/*`, `schema.ts`, `mutation.ts`, `document.ts` all deferred.

## What I did
- Scaffold: `package.json`, `tsconfig.json` (strict), `vite.config.ts` (Vitest colocated,
  D-001), `index.html`, `.gitignore`, a placeholder `src/main.ts`.
- `src/engine/address.ts` — new. §5.2: `AddressableObject`, `Address`, `AddressError`,
  `isValidName`, `findObjectByName`/`ById`, `isNameTaken`/`checkNameAvailable`,
  `generateDefaultName`, `parseAddress`/`formatAddress`.
- `src/engine/address.test.ts` — new, 28 tests.
- Initialized git; installed Node.js LTS (absent on this machine) with the human's explicit
  go-ahead before touching anything system-level.

## Decisions I made
- Every function takes a plain `readonly AddressableObject[]` parameter rather than owning any
  document state — `graph/node.ts` doesn't exist yet, and nothing here should assume its shape.
- Malformed-address and unknown-name both resolve to `#REF` (PROCESS_BRIEF's own worked example
  says so), not a separate `#PARSE` — that code is for formula-syntax errors, not addresses.
- `checkNameAvailable`/`NameCheckResult` deliberately do NOT reuse `ErrorValue` — a rename
  rejection is a command-level failure, not a graph value.
- Path-segment grammar is looser than name grammar (`vertex.0.x` needs digit-leading segments
  the name pattern would reject).
- Flagged a real deviation for the reviewer: `claude/` is flat, not nested under `claude-log/`
  per PROCESS_BRIEF's diagram — following existing precedent (0000's own layout) rather than
  restructuring it.
- `tsconfig.json` includes `DOM` globally (needed by `main.ts`); Rule 1 purity in `engine/` is
  enforced by the reviewer's grep discipline for now (became D-006 next cycle).

## Verification
`npx tsc --noEmit` — clean. `npm test` — 28/28 passed. `npm run build` — succeeds. Rule 1 grep
(`document.`/`window.`/`canvas`/`render/*` across `src/engine/`) — only doc-comment hits, clean.

## Acceptance criteria status
Phase 0 — NOT YET (this cycle covers only addressing). Demonstrated this cycle: rename leaves a
parsed `Address` byte-identical (`formatAddress > reflects a rename with no change to the stored
address`); case-insensitive lookup, collision rejection, no-reuse default naming; `parseAddress`
never throws on malformed input.

## Where I got stuck
Node.js was entirely absent from the machine — cost time, resolved with explicit human
go-ahead. `allowImportingTsExtensions` had to be added after the first real `tsc` run failed —
exactly the "should pass" assumption PROCESS_BRIEF warns against; glad I actually ran it.
`npm audit` reports vulnerabilities in dev-deps only — logged as a known problem, not acted on.

## Open questions raised
None.

## Review point
Fired: new load-bearing file (`address.ts`); layout deviation raised for the reviewer; diff at
threshold (9 files).
