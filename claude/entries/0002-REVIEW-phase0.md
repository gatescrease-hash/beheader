# 0002 — REVIEW (phase 0, mid-phase)
Date: 2026-08-21   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0001-scaffold-and-address   Reviewing: cycle 0001

Scope of this review: the scaffold and `src/engine/address.ts` from cycle 0001. This is a
mid-phase review triggered by §6.2 (a load-bearing file), §6.3 (new `engine/` file), §6.4
(deviation) and §6.9 (diff size), not a Phase 0 gate review — Phase 0's acceptance criterion
is not yet claimed and remains unmet.

---

## 1. Rule audit

| Rule | Verdict |
| --- | --- |
| **Rule 1** — `engine/` is pure, never touches DOM/window/canvas/`render/` | **UPHELD** in the code as written. Grepped `src/engine/` for `document.`, `window.`, `canvas`, `CanvasRenderingContext`, and `render` imports: the only two hits are inside doc comments *describing* the rule. See §6 for a hardening ruling (D-006) — the rule is upheld but currently unenforceable by any tool. |
| **Rule 2** — all state change through `mutation.ts` | **NOT TOUCHED.** `mutation.ts` does not exist. Correctly, `address.ts` holds and mutates no state: every function is pure and takes the object list as a parameter. This is the right shape and the implementer's reasoning for it (recorded in 0001's Decisions) is sound. |
| **Rule 3** — the addressing scheme is load-bearing, get it right early | **VIOLATED.** See finding F-1 below. The surface-syntax → stored-path mapping is wrong for table cells, and a test codifies the wrong contract. This is the reason for the verdict. |
| **Rule 4** — one formula engine for cells and text | **NOT TOUCHED.** No evaluator exists. |
| **Rule 5** — performance is a non-goal; dumbest correct implementation | **UPHELD, and well.** `generateDefaultName` re-scans the whole name set per candidate (quadratic) by explicit choice, with the rationale written down. `findObjectByName`/`findObjectById` are linear scans with no index. This is exactly the instruction, and the implementer resisted the obvious temptation to memoise. |
| **Rule 6** — slot set is fixed during evaluation | **NOT TOUCHED.** No evaluation exists. |
| **Rule 7** — do not build §8 deferred items | **UPHELD.** Nothing from §8 is present. |

## 2. Invariant audit

- **A stored address never contains a user-facing name** — **UPHELD and explicitly tested.**
  `formatAddress > reflects a rename with no change to the stored address` asserts the stored
  keys are exactly `["objectId","path"]` and that `JSON.stringify(stored)` does not contain the
  old name, then formats the *same* stored value against two different name tables. This was
  the seed reviewer's #1 requirement for this cycle and it is properly discharged.
- **Address strings only ever produced by `formatAddress`** — UPHELD. The single `.join(".")`
  lives inside `formatAddress` itself, which is the legitimate site.
- **Graph state plain, serializable, ID-referenced** — UPHELD. `Address` is a plain
  `{ objectId, path }`. No closures, class instances, `Map`s, or object-identity relationships
  anywhere. `AddressableObject` is a parameter type, not stored state.
- **Never throws across the evaluation loop** — UPHELD and tested
  (`parseAddress > never throws on malformed input`).
- **D-002 (document-stored ID counter)** — NOT EXERCISED. Correctly deferred to `document.ts`;
  `address.ts` consumes IDs and never allocates them.

## 3. Spec conformance

Conformant: the naming grammar `[a-zA-Z_][a-zA-Z0-9_]*`, case-insensitive lookup, uniqueness
enforcement, rename-collision rejection, auto-generated default names, name→ID resolution at
parse time, and `#REF`-shaped non-throwing failures. All of §5.2's *naming layer* is right.

Non-conformant on one row of §5.2's own address table — finding F-1.

### F-1 (blocking) — `table_x.A1` must store `path: ["cells", "A1"]`, not `["A1"]`

`PROJECT_BRIEF.md` specifies this twice:

- §5.2, line 264 — `| table_x.A1 | { objectId: "obj_3", path: ["cells", "A1"] } |`
- §5.1, line 176 — "A **Slot** is a single addressable value belonging to an object:
  `origin.x`, `radius`, `fillColor`, **`cells.A1`**, `in.speed`, `out.result`."

The user writes one path segment (`A1`); the stored path has two (`cells`, `A1`). Every other
row in that table is a pure lexical split, which is why this is easy to miss — and the
implementer did miss it. `parseAddress` currently returns `path: ["A1"]`, and
`address.test.ts:135` locks that in:

```ts
expect(result).toEqual({ objectId: "obj_3", path: ["A1"] });
```

Three things make this blocking rather than cosmetic:

1. **It is structurally impossible in the current design.** Producing `["cells","A1"]` requires
   knowing the object is a table. `AddressableObject` is `{ id, name }` — there is no `type`.
   So this is not a one-line fix; it is a change to the seam this cycle established.
2. **`formatAddress` is not the inverse.** Given the correct stored path, it would render
   `table_x.cells.A1` — a string the user never typed and cannot type back. The round-trip is
   broken in both directions.
3. **It gets expensive at exactly Phase 2.** Tables are where this first becomes visible. By
   then every stored AST and every test fixture would encode the wrong slot path, and edges
   would point at slots the schema never declared — which quietly breaks §5.1's "slots are the
   nodes of the graph."

Ruled as **D-005**. Note the irony that the implementer wrote `cells.A1` in the
`PATH_SEGMENT_PATTERN` doc comment (`address.ts:74`) while returning `["A1"]` — the two-segment
form was seen and not connected. That is the misunderstanding D-005 exists to prevent recurring.

## 4. Legibility audit

Genuinely good, and above the standard I expected at this stage: file headers on all three
source files in the §5.2 format, spec sections cited throughout, comments that explain *why*
(the `generateDefaultName` rationale and the `PATH_SEGMENT_PATTERN` note are both exemplary),
vocabulary locked with no *property*/*field*/*computed* drift, tests named as behaviour
sentences. Zero `any` in `src/`. Zero `.only`, `.skip`, or `.todo`.

Minor items, none blocking:

- **L-1** — `address.ts:161` carries `// eslint-disable-next-line no-constant-condition`.
  There is no ESLint in this project. A disable directive for a linter that does not exist is
  noise; PROCESS_BRIEF §5.4 bans exactly this kind of non-explanatory comment. Restructure the
  loop or drop the directive and keep the termination note.
- **L-2** — the module offers no way to discriminate `Address | AddressError`, so the tests
  resort to `as never` three times (`address.test.ts:172,206,207`). `as never` is a worse
  assertion than `as Address` and would mask a genuine type error. Export an
  `isAddressError(v): v is AddressError` guard; every downstream caller will otherwise
  hand-roll `"error" in result`.
- **L-3** — `address.ts:203`'s `segments as [string, ...string[]]` is correct (guarded by the
  preceding length and emptiness checks) but undocumented. One line saying *why* it is safe
  would match the standard the rest of the file sets.
- **L-4** — `parseAddress` never checks the name part against `NAME_PATTERN`. Harmless today
  (an invalid name cannot exist, so lookup fails and yields `#REF`), but the message says
  "no object named 1bad" where "not a valid name" is truer. Decide and document; not a defect.
- **L-5** — `vite.config.ts` has an explanatory comment but not the §5.2 file-header format.

## 5. Honesty audit

**Clean, and better than clean — this section is the strongest part of the cycle.**

I re-ran the verification rather than trusting it:

```
$ npx tsc --noEmit
exit=0

$ npm test
 ✓ src/engine/address.test.ts (28 tests) 6ms
 Test Files  1 passed (1)
      Tests  28 passed (28)
```

Both claims in entry 0001 are accurate. The file list in the entry matches the commit. The
self-reported §6 triggers (2, 3, 4, 9) are correctly applied — the implementer did not talk
itself out of any of them, including §6.9 which it could plausibly have argued was under
threshold.

Actively creditable disclosures, all volunteered rather than discovered by me:

- Node.js absent from the machine; stopped and asked the human before installing anything
  system-level, rather than proceeding or silently working around it.
- `allowImportingTsExtensions` had to be added *after* the first `tsc` run failed — reported as
  "I would have shipped a broken typecheck config if I hadn't actually run it," which is
  precisely the §3-Step-5 discipline working as intended.
- `npm audit` vulnerabilities reported and deliberately not acted on as out-of-scope.
- The `claude/` vs `claude-log/` layout deviation raised for a ruling instead of silently
  normalised.

Nothing was reported done that is a stub. `main.ts` is explicitly labelled a placeholder in
both the file header and the entry. No scope expansion: the implementer stopped at the declared
slice and did not drift into `graph/node.ts`.

One correction to the record, not a dishonesty: entry 0001 says "Implements PROJECT_BRIEF §5.2"
without qualification. Given F-1, that overstates conformance. The next entry should note the
correction rather than editing 0001 (entries are append-only, §2).

**One claim I could not reproduce, in the implementer's favour:** entry 0001 and STATUS.md both
assert that `vite.config.ts`'s Vitest `test` key is fine. I suspected it was a latent type
error hidden by `"include": ["src"]` (config files are genuinely outside the typecheck — I
confirmed `tsc` sees only `main.ts`, `address.ts`, `address.test.ts`). I forced `vite.config.ts`
into a scratch config and it typechecks clean at exit 0. The suspicion was mine and it was
wrong; recording it so nobody re-investigates. The narrower true observation stands: config
files are not covered by `npm run typecheck`. Low severity, not a fix item.

## 6. Additional ruling arising from this review

Not a defect in cycle 0001 — a gap in the project's guardrails that this cycle's code made
visible, and cheaper to close now than later.

I probed whether Rule 1 is mechanically enforceable by dropping
`document.createElement("canvas").getContext("2d")` into a file under `src/engine/` and running
the typecheck. **It compiled with zero errors.** The project's first hard rule — the one with
an explicitly documented trap in the brief — is currently protected only by reviewer grep
discipline, i.e. by me remembering. Ruled as **D-006**: `src/engine/` gets a DOM-free tsconfig
and `npm run typecheck` runs both. The probe file was removed; the tree is unchanged by it.

## 7. Open questions

- **Q-003** (does `explode` preserve object ID and name) — **ANSWERED → D-007.** Option (a),
  mutate in place. The seed's analysis was correct; D-007 adds a third supporting argument it
  did not make (§5.5's `force` flag on explode is only meaningful if the object survives and
  loses only *some* slots). Consequence to write down in `graph/node.ts` when it is built:
  object `type` is mutable state, and schema lookup must read the object's current type.
  This was correctly escalated rather than guessed — the process working as designed.
- **Q-001** (what `unlink` stores for a non-scalar / error value) — **explicitly deferred.**
  Phase 3, reversible, nothing upstream depends on it. Ruling now would fix a UX behaviour
  before there is a command line to feel it against. If Phase 3 arrives first, take the seed's
  option (a) as a `PROVISIONAL(Q-001)` choice under D-004 rather than blocking.
- **Q-002** (does `set` on a formula slot implicitly unlink) — **explicitly deferred**, same
  reasoning. Option (a) is the low-risk default since it already matches §5.9's per-component
  drag rule.

On the `claude/` vs `claude-log/` layout question raised in 0001: **keep the current layout.**
It predates cycle 0001, restructuring it would churn every path in every document for zero
functional gain, and PROCESS_BRIEF §13.1/§13.3 both favour the smaller diff. Not worth a
DECISIONS entry — noted here and in STATUS.md so it stops being re-raised.

---

## Verdict: REVISE

Not `ACCEPT`: F-1 is a real conformance gap in the file the brief singles out as load-bearing
(Rule 3), and a test currently codifies the wrong contract. Everything built next — the graph
model, edges, schema, and every Phase 2 table fixture — consumes that contract.

Not `REVERT`: the slice is structurally sound and roughly 90% of it stands unchanged. The
lexical core, the two-layer name/ID split, rename-invariance, the naming rules, the
never-throws discipline, and the test suite's shape are all correct and reusable. F-1 is an
additive change to one seam, not a re-approach.

The scaffold, the honesty of the log, and the discipline of stopping at the declared slice are
all accepted as-is and need no rework.

### Reviewer edits made

**None to `src/`.** Per §8, the reviewer does not do bulk implementation, and F-1 is real
implementation work touching the seam this cycle established rather than a surgical fix. The
code is returned as-is with the fix list below.

Edits made to process artifacts only:
- `DECISIONS.md` — appended D-005, D-006, D-007.
- `OPEN_QUESTIONS.md` — Q-003 marked `ANSWERED → D-007` in place; Q-001 and Q-002 annotated
  with explicit deferrals and unblocking instructions.
- `STATUS.md` — rewritten to reflect this verdict. Normally the implementer's artifact (§2),
  but leaving it saying "cycle 0001 is unreviewed" would make the project's single source of
  truth actively wrong. Flagging the intrusion here rather than doing it silently.

### Fix list for cycle 0003 (numbered, specific)

1. **Make the surface↔stored address mapping correct per D-005.** `table_x.A1` must yield
   `path: ["cells", "A1"]`. This requires the resolved object's `type`, so extend the object
   shape `address.ts` resolves against (`AddressableObject` gains `type`, or resolution takes
   the schema registry). If `primitives/schema.ts` does not exist yet when you do this, D-005
   §4 permits an interim lexical stage — but it must be *named* as the lexical stage, must not
   claim to produce stored addresses, and must not assert `["A1"]` anywhere.
2. **Make `formatAddress` the exact inverse of `parseAddress`**, and add a round-trip test:
   for every address form in §5.2's table, `format(parse(s)) === s`. The table-cell row is the
   one that currently fails; write the test so it covers all five rows, not just that one.
3. **Correct `address.test.ts:135`** to assert the D-005 contract. This is a change to a test's
   expectations, which is normally §6.6 escalation territory — you are instructed to make it,
   so cite this entry in your log rather than treating it as a cleanup.
4. **Update `address.ts`'s file header and `parseAddress`'s docstring**, which currently claim
   it "parses ... into a stored Address" and that it is "the only place a name is ever turned
   into an Address." Under D-005 both are true only once it is schema-aware.
5. **Export `isAddressError(v): v is AddressError`** (L-2) and remove the three `as never`
   assertions from the tests.
6. **Drop the dead `eslint-disable` directive** at `address.ts:161` (L-1), keeping the
   termination rationale as a plain comment.
7. **Implement D-006**: `tsconfig.engine.json` with `"lib": ["ES2022"]` covering
   `src/engine/**` including colocated tests, and make `npm run typecheck` run both configs.
   Confirm it works by re-running the probe (a DOM call in an engine file must now fail).
8. *(optional, your call)* L-3 and L-4 — one line justifying the tuple cast, and a decision on
   whether `parseAddress` validates the name part against `NAME_PATTERN`.

Items 1–4 are one coherent slice. Items 5–7 are small and mechanical and may ride along in the
same cycle; if that pushes the diff past §6.9, split 7 out rather than rushing 1–4.

Note for cycle 0003: do **not** proceed into `graph/node.ts` in the same cycle. Addressing
needs to be right before anything is built on it, which is the entire reason this review
happened at a mid-phase point rather than at the Phase 0 gate. When you do reach `node.ts`,
D-007 constrains it: object `type` is mutable.
