# DECISIONS

Binding rulings that extend `PROJECT_BRIEF.md` where it is silent or under-specified.

**Implementers: treat every entry here as part of the brief.** You may read it; you may
NEVER write to it. Only the reviewer or the human adds entries. If you believe a decision
here is wrong, raise a question in `OPEN_QUESTIONS.md` — do not act against it.

Append only. Never edit or delete a past decision. To change one, add a new decision that
supersedes it and mark the old one `SUPERSEDED BY D-NNN` in place.

---

## D-001 — Test runner is Vitest; tests are colocated `*.test.ts` files
Answers: (seed)   Ruled: entry 0000-SEED-reviewer   Binding on: all future cycles

Ruling: Use Vitest as the test runner (dev dependency only). Test files live next to the
code they test as `<module>.test.ts` — `src/engine/address.test.ts`, not a parallel
`test/` tree. Run the full suite with `npm test`; typecheck with `npx tsc --noEmit`. Both
MUST be runnable independently and both MUST be clean at the end of every cycle.

Rationale: The brief says "a test runner such as Vitest" and leaves it open. Settling it
now prevents two implementers from choosing differently. Colocation is chosen because the
engine is a 1:1 Rust port target and Rust colocates tests with modules — the file layout
should rehearse the destination. Note that colocated tests do not violate Rule 1: test
files may import a fake `TextMeasurer`, but the module under test still may not touch DOM.

---

## D-002 — Object IDs come from a counter stored in the document
Answers: (seed)   Ruled: entry 0000-SEED-reviewer   Binding on: all future cycles

Ruling: Object IDs are `obj_<n>` where `n` comes from a monotonically increasing integer
`nextObjectId` stored **in the document itself** and serialized with it. It increments on
every object creation and NEVER decrements, is NEVER reset, and IDs are NEVER reused —
including across a save/load round trip and including after the object holding an ID is
deleted. Loading a document restores the counter as-is; it is not recomputed from the
object list.

Rationale: §5.2 requires IDs be "opaque, stable, never-reused" but does not say where the
allocator lives. If the counter is module-level state, or is rederived on load as
`max(existing) + 1`, then save → delete an object → load → create reuses a dead ID. Any
mutation-journal entry or stale reference naming the old ID would then silently bind to a
different object. This is exactly the class of bug that surfaces months later and is
untraceable, so the counter is document state, like everything else (Rule: graph state is
plain and serializable).

Consequence for `document.ts`: `nextObjectId` is part of the round-trip test. A document
that round-trips its objects but not its counter fails Phase 0.

---

## D-003 — One cycle is one commit; the commit message names the log entry
Answers: (seed)   Ruled: entry 0000-SEED-reviewer   Binding on: all future cycles

Ruling: Each work cycle produces exactly one commit, on `main`, whose first line is
`NNNN <slug>` matching the log entry filename (`0004 formula-lexer` ↔
`claude-log/entries/0004-formula-lexer.md`). The commit includes the code, the tests, the
new log entry, and the rewritten `STATUS.md`. Reviewer edits are a separate commit,
`NNNN-REVIEW <phase>`. Do not create branches; do not amend or rebase past commits.

Rationale: The log is the project's only continuity, and it is only trustworthy if the
history and the log line up one-to-one. Rewriting history breaks that mapping. A single
linear branch is also the honest representation of a single-threaded workflow — there is
no parallel work to merge.

---

## D-004 — `PROVISIONAL` tags are a build-visible debt, not a comment style
Answers: (seed)   Ruled: entry 0000-SEED-reviewer   Binding on: all future cycles

Ruling: Every provisional choice taken against an open question MUST be tagged in code as
`// PROVISIONAL(Q-NNN): <one line>`. Every such tag MUST also be listed in `STATUS.md`
under *Live PROVISIONAL tags* with its file paths. A cycle is not complete if a tag exists
for a question that has already been answered in this file.

Rationale: Provisional choices are the mechanism that lets an implementer keep moving
through ambiguity without silently committing the project to a guess. They only work if
they are findable later by `grep`, and if `STATUS.md` surfaces them without anyone having
to grep at all.

---

## D-005 — A stored slot path is what the schema declares, not a lexical split of what the user typed
Answers: (reviewer finding, cycle 0001)   Ruled: entry 0002-REVIEW-phase0   Binding on: all future cycles

Ruling: An `Address`'s `path` is the **stored slot path** — the path the object's schema
declares for that slot. It is NOT, in general, `input.split(".").slice(1)`. For every object
type specified so far the two coincide, with exactly one exception, which is mandatory:

> A table cell written by the user as `table_x.A1` MUST store `path: ["cells", "A1"]`.

This is stated twice in `PROJECT_BRIEF.md`: §5.2's address table (`table_x.A1` →
`{ objectId: "obj_3", path: ["cells", "A1"] }`) and §5.1's slot list, which names the slot
`cells.A1` alongside `origin.x` and `out.result`.

Consequences, all binding:

1. `parseAddress` MUST be schema-aware. It needs the resolved object's **type**, so the
   object shape it resolves against carries `type` in addition to `id` and `name`.
2. `formatAddress` MUST be the exact inverse of `parseAddress`. `formatAddress` of a stored
   `["cells", "A1"]` on a table yields `table_x.A1` — NEVER `table_x.cells.A1`. Round-tripping
   any user-written address through parse→format MUST return the original string.
3. Bare cell references inside a table cell formula (§5.3) resolve to the same
   `["cells", <ref>]` shape on the containing table. There is one mapping, not two.
4. Until `primitives/schema.ts` exists, a purely lexical parse is acceptable as an **interim**
   implementation only if it is named and documented as the lexical stage and does NOT claim
   to produce stored addresses. No test or docstring may assert that `table_x.A1` yields
   `path: ["A1"]` — that is the wrong contract and must not be codified anywhere.

Rationale: Rule 3 says the addressing scheme is load-bearing and that changing it later
touches formulas, bindings, script ports, serialization, and the command line. The
surface-syntax/stored-path distinction is the single non-obvious thing about the scheme, and
it is invisible until tables exist in Phase 2 — by which point every stored AST in every test
fixture would encode the wrong shape. This is precisely the class of error that is cheap now
and expensive at Phase 2. It also protects the §5.1 invariant that slots are the graph's
nodes: if the stored path is not the schema's slot path, edges point at slots that the schema
never declared.

---

## D-006 — Rule 1 is enforced by the compiler, not only by grep
Answers: (reviewer finding, cycle 0001)   Ruled: entry 0002-REVIEW-phase0   Binding on: all future cycles

Ruling: `src/engine/` MUST typecheck against a configuration that does not include the `DOM`
lib. Add a second config (suggested: `tsconfig.engine.json`) that extends the root config,
sets `"lib": ["ES2022"]` with no `"DOM"`, and covers `src/engine/**` including its colocated
`*.test.ts` files. `npm run typecheck` MUST run both configs; both MUST be clean at the end of
every cycle. The root config keeps `DOM` for `main.ts` and the future `src/render/`.

Verified during this review: a file containing
`document.createElement("canvas").getContext("2d")`, placed inside `src/engine/`, compiles
with zero errors under the current single config. Rule 1 is therefore currently unenforced by
any tool.

Rationale: Rule 1 is the first hard rule in the brief and the one with an explicitly
documented trap (text measurement, §5.2 of PROCESS_BRIEF / Rule 1's own note). `PROCESS_BRIEF`
§8.1 has the reviewer grep for `document.`/`window.`/`canvas`, but that is a *review-time*
check that runs after the code is written and only if the reviewer is thorough. A DOM-free lib
makes the violation impossible to author in the first place, which is strictly better and
costs one config file. Doing it now is also cheaper than retrofitting once `engine/` is large
— the same reasoning `STATUS.md` (cycle 0000) applied to strict mode.

---

## D-007 — `explode` preserves object identity: same ID, same name, mutable `type`
Answers: Q-003   Ruled: entry 0002-REVIEW-phase0   Binding on: all future cycles

Ruling: `explode` mutates the object **in place**. The object keeps its ID and its name; its
`type` field changes (preset → editable path); its parameter slots (`sides`, `radius`,
`rotation`) are removed and per-vertex literal slots are added. `explode` is NEVER implemented
as delete-plus-create. Object `type` is therefore **mutable state on the object**, and schema
lookup MUST read the object's *current* `type` rather than binding a schema at creation time.
This must be stated explicitly in `graph/node.ts` where the object shape is defined, because a
reader will otherwise assume type is immutable.

Rationale: three independent arguments, all pointing the same way.

1. §5.5 states that `vertices` survives explode, "merely re-sourced from the new literal vertex
   slots," and that "anything downstream reading `vertices` is therefore unaffected." That
   guarantee is only true if the object keeps its ID — under delete-plus-create the new object
   draws a fresh ID (D-002 forbids reuse) and every stored AST holding `obj_7.vertices` breaks,
   contradicting the stated payoff.
2. Delete-plus-create would require a document-wide reference-rewriting pass. The only such
   pass in the entire design is table reference adjustment (§5.4), which is explicitly scoped
   to row/column insert and delete. Inventing a second one contradicts §5.1.1's "never a third
   option" framing and adds a mechanism the brief never asks for.
3. §5.5 says explode deletes the parameter slots and that "§5.1.1 rejection applies unless
   `force` is passed" — i.e. explode is rejected if something still reads `polygon_1.radius`.
   That distinction is only meaningful if the object survives and only *some* of its slots are
   removed. Under delete-plus-create every slot disappears, every dependent breaks, and the
   `force` flag would have nothing to distinguish.

Reconciliation required: none — Q-003 was correctly escalated rather than guessed, and no
`PROVISIONAL(Q-003)` tags exist.
