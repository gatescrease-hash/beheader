# STATUS — as of entry 0002-REVIEW-phase0

STATE: GREEN (compiles, all tests pass) — but cycle 0001 was returned **REVISE**.
The tree is green; it is green around a known-wrong address contract (see F-1 / D-005).

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial and blocked on rework. Addressing exists but is non-conformant on table-cell
paths; graph model, cycles, eval, mutation, and document round-trip are not started.

Last review: **0002-REVIEW-phase0, verdict REVISE.** Fix list is in that entry, §"Fix list for
cycle 0003". Items 1–4 are the required slice.

## Built and reviewed
- Project scaffold: `package.json`, `tsconfig.json` (strict), `vite.config.ts`, `index.html`,
  Vitest via `npm test`. **Accepted as-is** at 0002-REVIEW — no rework needed, except that
  D-006 adds a second engine-only tsconfig on top of it.
- `src/main.ts` — placeholder entry point. Accepted as a labelled placeholder.

## Built, reviewed, REQUIRES REWORK
- `src/engine/address.ts` + `src/engine/address.test.ts` (§5.2) — 28 tests passing, but
  returned REVISE. The naming layer (grammar, uniqueness, case-insensitive lookup, rename
  invariance, default names, never-throws) is **correct and accepted**. The surface→stored
  path mapping is **wrong for table cells** and a test codifies the wrong contract.
  See D-005 and 0002-REVIEW-phase0 F-1.

## Not started
In brief §7 order, remaining:
1. `src/engine/graph/node.ts` + `src/engine/graph/edge.ts` (three slot kinds).
   **D-007 constrains this: object `type` is mutable state; schema lookup reads current type.**
2. `src/engine/primitives/schema.ts` (derived-slot declaration mechanism)
3. `src/engine/graph/cycles.ts` (naive DFS) + `src/engine/graph/eval.ts` (naive full topo
   re-eval over all three slot kinds, derived slots inline, no post-pass)
4. `src/engine/mutation.ts` (clone / validate / commit + journal)
5. `src/engine/document.ts` round-trip test (including `nextObjectId`, D-002)

Then Phase 1 (formula engine). Do not start before Phase 0's criterion passes and is reviewed.

## Next slice (required — not a recommendation)

Work the fix list in `entries/0002-REVIEW-phase0.md`, items 1–4 as one coherent slice: make
`parseAddress` produce the schema-declared stored path (`table_x.A1` → `["cells","A1"]`, D-005),
make `formatAddress` its exact inverse, add a round-trip test covering all five address forms
in PROJECT_BRIEF §5.2's table, correct the test that asserts `["A1"]`, and fix the docstrings
that overclaim. Items 5–7 (an `isAddressError` guard, the dead eslint directive, and D-006's
engine tsconfig) are small and may ride along — split item 7 out if the diff approaches §6.9.

**Do NOT proceed into `graph/node.ts` in that cycle.** Addressing must be right before anything
is built on it; that is why this review happened mid-phase rather than at the Phase 0 gate.

Note for that cycle: item 3 changes a test's expectations, which is normally a §6.6 escalation.
You are instructed to make that change — cite 0002-REVIEW-phase0 in your entry rather than
treating it as cleanup.

## Known problems
- **`npm run typecheck` does not cover config files.** `tsc` sees only `src/main.ts`,
  `src/engine/address.ts`, `src/engine/address.test.ts` (verified at 0002-REVIEW via
  `--listFiles`). `vite.config.ts` does typecheck clean when forced into a config, so this is
  currently latent, not an active bug. Low severity.
- **Rule 1 is not compiler-enforced.** Verified at 0002-REVIEW: `document.createElement("canvas")`
  inside `src/engine/` compiles with zero errors today. D-006 rules the fix (fix-list item 7).
- `npm audit` reports 5 vulnerabilities (3 moderate, 1 high, 1 critical) in the dev-dependency
  tree (transitive deps of Vite/Vitest, not runtime deps). Not investigated; out of scope so far.
- **Layout question — SETTLED, stop re-raising.** PROCESS_BRIEF §2's diagram shows
  `claude-log/` as a sibling of the briefs at `project-root/`; this repo keeps everything flat
  under `claude/`. The reviewer ruled at 0002 to **keep the current layout** (it predates cycle
  0001, restructuring churns every path for zero functional gain, §13.1/§13.3 favour the
  smaller diff). Not a DECISIONS entry — recorded here.

## Live PROVISIONAL tags
None, and none are outstanding. Q-003 is now ANSWERED (→ D-007) and never had tags — it was
correctly escalated rather than guessed. Q-001 and Q-002 remain OPEN but are explicitly
deferred to Phase 3; if you reach Phase 3 before the next review, take option (a) in each as a
`PROVISIONAL(Q-NNN)` choice under D-004 rather than blocking.

## Gotchas for the next model

- **Read D-005 before touching `address.ts`.** The non-obvious thing about the addressing
  scheme: the string the user types and the stored slot path are *not* the same, and the only
  current instance is table cells (`table_x.A1` → `["cells","A1"]`). Every other form is a
  lexical split, which is exactly why this is easy to miss — cycle 0001 missed it while quoting
  `cells.A1` in a comment two lines away.
- Producing that mapping needs the object's **type**, which `AddressableObject` (`{id, name}`)
  does not carry. That is the seam you are changing.
- `address.ts` takes the object list as a plain parameter and owns no state — keep it that way.
  When you build `graph/node.ts`, the object shape needs `id`, `name`, **and now `type`**.
- Both `parseAddress` and `formatAddress` return a `#REF`-shaped `AddressError` and never
  throw. There is currently **no type guard** to discriminate the union, which is why the tests
  use `as never`. Fix-list item 5 adds `isAddressError`; use it rather than `"error" in x`.
- `checkNameAvailable` deliberately does **not** return an `ErrorValue`/`AddressError` — it has
  its own `NameCheckResult`, because a rename rejection is a command-level failure, not a graph
  `Value`. This was reviewed and is correct; don't merge the two error shapes "for consistency."
- Node.js and Git are both installed now (LTS / 2.55, via winget) but were absent at cycle
  0001's start. On a fresh machine, verify `node --version` and `git --version` first.
- Each PowerShell tool invocation is a fresh process, so `$env:Path` edits do not persist
  between calls. Re-derive PATH from the Machine/User environment variables at the top of a
  command if `node`/`npm`/`git` appear to be missing — they are probably fine.
