# 0001 — scaffold-and-address
Date: 2026-08-21   Phase: 0   Model: Claude (Sonnet 5)
Previous entry: 0000-SEED-reviewer   Last review: 0000-SEED-reviewer (verdict: N/A, baseline)

## Declared scope

Scaffold the project (package.json, strict tsconfig, vite.config.ts, index.html, Vitest)
and build `src/engine/address.ts` — `parseAddress` / `formatAddress` / name↔ID resolution —
with tests, per `STATUS.md`'s recommended next slice. Nothing else.

## Explicitly not in scope

`graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`, `graph/eval.ts`,
`mutation.ts`, `document.ts` — all deferred to later Phase-0 cycles, per `STATUS.md`. `main.ts`
is a placeholder only, not real wiring (nothing exists yet to wire). Q-001/Q-002/Q-003 are all
Phase 3 concerns and were not touched.

## What I did

- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` — new. Scaffold per
  PROJECT_BRIEF §4/§2 (TypeScript strict, Vite, Vitest as dev-only deps, no runtime deps).
  Vitest config is colocated inside `vite.config.ts` (D-001) rather than a separate file.
- `src/main.ts` — new. Trivial placeholder so the Vite entry point resolves; wires nothing,
  claims nothing. Real wiring begins in Phase 3 (PROJECT_BRIEF §6).
- `src/engine/address.ts` — new. Implements PROJECT_BRIEF §5.2: `AddressableObject`,
  `Address`, `AddressError`, `isValidName`, `findObjectByName`, `findObjectById`,
  `isNameTaken`, `checkNameAvailable`, `generateDefaultName`, `parseAddress`, `formatAddress`.
- `src/engine/address.test.ts` — new. 28 tests (see Verification below).
- `.gitignore` — new (`node_modules/`, `dist/`).
- Initialized git (`is a git repository: false` at cycle start) and made this cycle's commit
  per D-003.

## Decisions I made

- **`graph/node.ts` doesn't exist yet, so what does address.ts resolve against?** I gave every
  function a plain `readonly AddressableObject[]` parameter (`{ id, name }`) instead of reading
  a document object this module doesn't own. This is exactly the STATUS.md gotcha from cycle
  0000 ("the resolver reads document state, it does not own it") taken literally: no
  module-level state, no stored resolver object, just a pure function of whatever object list
  the caller has. `graph/node.ts`'s future object shape should structurally satisfy this
  interface without address.ts needing to change.
- **Malformed-address vs. unknown-name errors both use `#REF`.** PROCESS_BRIEF §5.3's own
  worked example of `address.ts` documentation says `parseAddress` "Returns a #REF-shaped
  failure" for both "unknown object name" and "malformed path" — I followed that verbatim
  rather than inventing a `#PARSE` distinction PROJECT_BRIEF never draws for addresses
  specifically (`#PARSE` is used for formula-syntax errors, §5.1's Value union).
- **`checkNameAvailable` / `NameCheckResult` do NOT reuse `ErrorValue`.** A name-grammar or
  name-collision failure is a command-level rejection (§5.10: "every rejection message must
  name the specific slots/things involved"), not a graph `Value`. Reusing `ErrorValue` would
  conflate "this formula's cell is broken" with "this rename request is invalid" — two
  different failure domains. Kept them as separate types; only `parseAddress`/`formatAddress`
  (genuine address resolution, feeding into what could become a `#REF` in the graph) use
  `AddressError`.
- **Path-segment grammar is looser than the name grammar.** `vertex.0.x` (§5.5) has a
  path segment, `"0"`, that starts with a digit and would fail `NAME_PATTERN`. Object *names*
  must satisfy the strict `[a-zA-Z_][a-zA-Z0-9_]*` grammar; *path segments* only need to be a
  non-empty run of letters/digits/underscores. Tested explicitly.
- **`generateDefaultName` recomputes from `_1` every call rather than counting existing
  objects of the prefix.** Explained in the code comment: counting can suggest an already-taken
  name after a delete/rename shuffles things, or skip a name that's actually free. Checking each
  candidate against the live set is the "dumbest correct implementation" Rule 5 asks for.
- **File-layout deviation from PROCESS_BRIEF §2's diagram.** The diagram shows
  `project-root/{PROJECT_BRIEF.md,PROCESS_BRIEF.md}` and `project-root/claude-log/{STATUS.md,
  DECISIONS.md,OPEN_QUESTIONS.md,entries/}`. In this repository both brief documents *and*
  STATUS/DECISIONS/OPEN_QUESTIONS already live flatly under `claude/` (established by the seed
  commit, 0000-SEED-reviewer.md, not by me). I followed that existing precedent rather than
  restructuring it: this entry lives at `claude/entries/0001-...md`, and `src/`,
  `package.json`, etc. live at the repository root (treating the repository root, not
  `claude/`, as PROJECT_BRIEF's `project-root/`). I did not raise this as an OPEN_QUESTIONS
  item because it is a process/tooling layout question already settled by precedent, not an
  ambiguity in PROJECT_BRIEF's product/architecture content — but flagging it here since it is
  a real deviation from the literal diagram and the reviewer may want it made explicit or
  corrected.
- **Node.js was not installed anywhere on this machine at cycle start.** PROCESS_BRIEF §3 Step
  5 requires actually running `tsc`/tests, not assuming. I stopped and asked the human before
  installing anything; with explicit approval I installed Node.js LTS via `winget install
  OpenJS.NodeJS.LTS`, then proceeded. Flagging this because it's an environment fact worth the
  human/reviewer knowing, not a code decision — nothing about it affects the engine.
- **`tsconfig.json` includes the `DOM` lib globally** (needed by `main.ts`'s
  `document.querySelector`) rather than trying to scope DOM types out of `engine/` at the
  type-checker level. PROCESS_BRIEF §8's reviewer protocol says Rule 1 is checked "mechanically
  — grep for `document.`, `window.`, `canvas`," implying the project relies on that mechanical
  check rather than a lib-exclusion trick, which is fragile in a single shared tsconfig anyway.
  Ran that grep against `src/engine/` before writing this entry (see Verification).

## Verification (real output)

$ npx tsc --noEmit
(no output — zero errors)

$ npm test
```
 RUN  v2.1.9 C:/Users/William/Documents/Code Projects/beheader

 ✓ src/engine/address.test.ts (28 tests) 6ms

 Test Files  1 passed (1)
      Tests  28 passed (28)
   Start at  21:36:35
   Duration  848ms (transform 30ms, setup 0ms, collect 40ms, tests 6ms, environment 0ms, prepare 466ms)
```

$ npm run build   (extra check: confirms the scaffold itself is real, not just source that
happens to typecheck)
```
vite v5.4.21 building for production...
transforming...
✓ 3 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                0.32 kB │ gzip: 0.23 kB
dist/assets/index-ChbaTYFh.js  0.82 kB │ gzip: 0.47 kB
✓ built in 113ms
```

Rule 1 hygiene check — grepped `src/engine/` for `document.`, `window.`, `canvas`, and any
`render/*` import:
```
$ rg "document\.|window\.|canvas|from [\"']\.\./render|from [\"']\.\./\.\./render" src/engine
src\engine\address.ts:6:  *        NEVER imports: DOM, window, document, canvas, render/*.
src\engine\address.ts:10: *   D-002 — the counter itself lives in document.ts, not here)...
```
Both hits are inside doc comments describing the rule, not code. Clean.

## Acceptance criteria status

Phase 0 criterion (PROJECT_BRIEF §6) — NOT YET. This cycle covers only the addressing piece of
Phase 0; graph model, cycle detection, evaluation, mutation, and document round-trip remain.
Not claiming any part of the phase gate passes yet.

Demonstrated this cycle instead (narrower, address-scoped claims, all in
`src/engine/address.test.ts`):
- Renaming an object leaves a previously-parsed `Address` byte-identical, and the same stored
  Address formats under the old and new name depending only on which name table it's given —
  `formatAddress > reflects a rename with no change to the stored address`.
- Case-insensitive name lookup, rename-collision rejection, and default-name generation that
  doesn't reuse a name freed by deletion — see the `isNameTaken / checkNameAvailable` and
  `generateDefaultName` describe blocks.
- `parseAddress` never throws on malformed input and returns a `#REF`-shaped error instead —
  `parseAddress > never throws on malformed input`.

## Where I got stuck / what is unfinished

- Node.js was entirely absent from this machine at cycle start (not in PATH, not in any common
  install directory) — see Decisions above. Cost time up front; resolved with the human's
  explicit go-ahead before I touched anything system-level.
- `allowImportingTsExtensions` had to be added to `tsconfig.json` after the first `tsc` run
  failed on the `.ts` extension in `address.test.ts`'s import. Vite/Vitest resolve `.ts`
  imports fine at runtime; the TypeScript compiler needed the explicit opt-in since
  `noEmit: true` alone doesn't imply it. Small, but worth naming since it's exactly the kind of
  "should pass" assumption PROCESS_BRIEF §3 Step 5 warns against — I would have shipped a
  broken typecheck config if I hadn't actually run it.
- `npm audit` reports 5 vulnerabilities (3 moderate, 1 high, 1 critical) in the dev-dependency
  tree (Vite/Vitest's own transitive deps, not runtime deps of the shipped app). Did not
  investigate further or run `npm audit fix --force` — that's a dependency-version change
  outside this cycle's declared scope and outside "add tests/docs or stop" per PROCESS_BRIEF
  §4. Logged here as a known problem for STATUS.md instead of acting on it unreviewed.

## Open questions raised

None. Q-001, Q-002, Q-003 remain open from the seed and are unaffected by this cycle.

## Escalation triggers fired

- §6.2 — created `src/engine/address.ts`, a listed load-bearing file.
- §6.3 — created new files under `src/engine/` (`address.ts`, `address.test.ts`).
- §6.4 — deviated from PROCESS_BRIEF §2's literal file-layout diagram (see Decisions); made
  interpretive calls PROJECT_BRIEF/PROCESS_BRIEF don't fully settle (`#REF`-for-malformed-path,
  `NameCheckResult` vs. `ErrorValue` split, path-segment grammar).
- §6.9 — diff is 9 new/changed files (`package.json`, `package-lock.json`, `tsconfig.json`,
  `vite.config.ts`, `index.html`, `.gitignore`, `src/main.ts`, `src/engine/address.ts`,
  `src/engine/address.test.ts`), at the trigger's file-count threshold.
