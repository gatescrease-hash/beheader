# DECISIONS

Binding rulings that extend `PROJECT_BRIEF.md` where it is silent or under-specified.

**Implementers: treat every entry here as part of the brief.** Read it; NEVER write to it. Only
the reviewer or the human adds entries. If a decision here looks wrong, raise a question in
`OPEN_QUESTIONS.md` — do not act against it.

Append only. Never edit or delete a past decision. To change one, add a new decision that
supersedes it and mark the old one `SUPERSEDED BY D-NNN` in place.

> **Revision note (2026-08-22, Manager cleanup):** entries below are compacted to Simplified
> Technical English — shorter rationale, same rulings, same binding force. Full original prose
> (the reviewer's own words, with every worked example and probe transcript) is preserved
> verbatim in the untouched sacred copy — see `MANAGER_CHANGELOG.md`. If a rationale below feels
> too thin to resolve a dispute, that copy is the tie-breaker, not this one.

---

## D-001 — Test runner is Vitest; tests are colocated `*.test.ts` files
Ruled: entry 0000-SEED-reviewer

Use Vitest (dev dependency only). Tests live beside the code they test —
`src/engine/address.test.ts`, not a parallel `test/` tree. `npm test` runs the suite; `npx tsc
--noEmit` typechecks. Both MUST be clean at the end of every cycle.

Rationale: the brief left the runner open; settling it now stops two implementers choosing
differently. Colocation rehearses the future Rust port, which colocates tests by convention.

---

## D-002 — Object IDs come from a counter stored in the document
Ruled: entry 0000-SEED-reviewer

Object IDs are `obj_<n>`, `n` from a monotonically increasing `nextObjectId` **stored in the
document itself**. It only increases, is never reset, and IDs are never reused — including across
save/load and after the owning object is deleted. Loading restores the counter as-is; it is never
recomputed from the object list.

Rationale: `max(existing)+1` on load would let a deleted-then-recreated ID collide with a stale
reference or journal entry — an untraceable bug months later. The counter is document state, like
everything else. `document.ts`'s round-trip test MUST cover the counter, not just the objects.

---

## D-003 — One cycle is one commit; the commit message names the log entry
Ruled: entry 0000-SEED-reviewer

Each cycle produces one commit on `master`, first line `NNNN <slug>` matching the log entry
filename. The commit includes the code, tests, the new log entry, and the rewritten `STATUS.md`.
Reviewer edits are a separate commit, `NNNN-REVIEW <phase>`. No branches; no rebase/amend of past
commits.

Rationale: the log is the project's only continuity, and it's trustworthy only if history and log
line up one-to-one. A single linear branch also matches the single-threaded workflow honestly.

---

## D-004 — `PROVISIONAL` tags are build-visible debt, not a comment style
Ruled: entry 0000-SEED-reviewer

Every provisional choice against an open question MUST be tagged in code as
`// PROVISIONAL(Q-NNN): <one line>`, and every tag MUST also be listed in `STATUS.md`'s *Live
PROVISIONAL tags*. A cycle is not complete if a tag exists for an already-answered question.

Rationale: provisional choices let an implementer move through ambiguity without silently
committing the project to a guess — but only if they're `grep`-findable and `STATUS.md` surfaces
them without anyone having to grep at all.

---

## D-005 — A stored slot path is what the schema declares, not a lexical split of the user's input
Ruled: entry 0002-REVIEW-phase0 (reviewer finding, cycle 0001)

An `Address`'s `path` is the **stored slot path** the schema declares — not, in general,
`input.split(".").slice(1)`. One mandatory exception today: a table cell written `table_x.A1`
MUST store `path: ["cells", "A1"]` (both §5.2's address table and §5.1's slot list say so).

Consequences:
1. `parseAddress` MUST be schema-aware (needs the resolved object's `type`).
2. `formatAddress` MUST be the exact inverse: `["cells","A1"]` on a table prints `table_x.A1`,
   never `table_x.cells.A1`. Round-tripping any user-written address through parse→format MUST
   return the original string.
3. A bare cell ref inside a table cell formula resolves to the same `["cells", <ref>]` shape.
4. Until `primitives/schema.ts` exists, a purely lexical parse is acceptable **only** if named and
   documented as the interim lexical stage, and it must not claim to produce stored addresses.

Rationale: Rule 3 says addressing is load-bearing and expensive to fix late. The surface/stored
distinction is invisible until tables exist in Phase 2, by which point every stored AST would
encode the wrong shape — cheap now, expensive later.

---

## D-006 — Rule 1 is enforced by the compiler, not only by grep
Ruled: entry 0002-REVIEW-phase0 (reviewer finding, cycle 0001)

`src/engine/` MUST typecheck against a DOM-free config (`tsconfig.engine.json`, extends root,
`"lib": ["ES2022"]`, no `"DOM"`, covers `src/engine/**` including colocated tests). `npm run
typecheck` runs both configs; both MUST be clean every cycle. The root config keeps `DOM` for
`main.ts`/`render/`.

Rationale: verified that `document.createElement("canvas").getContext("2d")` inside `src/engine/`
compiled clean under the single original config — Rule 1 was enforced only by reviewer memory. A
DOM-free lib makes the violation impossible to author, for the cost of one config file.

---

## D-007 — `explode` preserves object identity: same ID, same name, mutable `type`
Ruled: entry 0002-REVIEW-phase0 — Answers: Q-003

`explode` mutates the object **in place**: same ID, same name, `type` field changes (preset →
editable path), parameter slots removed, per-vertex literal slots added. NEVER delete-plus-create.
Object `type` is therefore mutable state, and schema lookup MUST read the object's *current*
type, not one bound at creation. State this explicitly in `graph/node.ts`.

Rationale: §5.5 says `vertices` survives explode "re-sourced," which only holds if the ID
survives — delete-plus-create would draw a fresh ID (D-002 forbids reuse) and break every stored
AST pointing at it. It would also need a document-wide reference-rewriting pass that exists
nowhere else in the design. And explode's `force` flag only makes sense if the object survives
and loses just *some* slots.

---

## D-008 — A surface→stored path mapping keys on the slot's FORM, never a structural proxy
Ruled: entry 0004-REVIEW-phase0 (reviewer finding, cycle 0003)

Where a surface segment is shorthand for a longer stored path (D-005), the mapping MUST trigger on
the shorthand's *form* — for table cells, the A1 pattern `/^[A-Z]+[0-9]+$/` — never a structural
proxy like "table object, one segment." The inverse direction is bound the same way:
`toSurfacePath` may only strip a prefix that `toStoredPath` could have added.

Rationale: probed the proxy rule and found `table_x.rows`, `table_x.opacity`, `table_x.typo`, even
`table_x.cells` all resolving to phantom `cells.<name>` slots no schema declares — and lowercase
vs. uppercase cell refs producing two stored slots for one cell. **Test the unspecified cases, not
just the brief's examples** — the lesson, not just the fix.

---

## D-009 — Object type strings are settled in `graph/node.ts`; `address.ts` imports, never duplicates
Ruled: entry 0004-REVIEW-phase0 — Answers: implementer question 3, cycle 0003

The vocabulary of object type strings is a union type defined once (in `graph/node.ts`, or
`primitives/schema.ts` if it later owns it) — never bare `string`. `address.ts`'s `TABLE_TYPE`
references that union rather than keeping its own literal.

Rationale: `string`-typed `type` lets a typo (`"tabel"`) silently disable D-005's mapping with no
compiler error. A union makes that a compile error, at the cheapest possible moment (one
duplicate site today).

---

## D-010 — Slot keys are produced ONLY by `slotKey()`, never hand-built
Ruled: entry 0006-REVIEW-phase0 (reviewer finding, cycle 0005)

A key into `GraphObject.slots` MUST only ever come from `graph/node.ts`'s `slotKey(path)`. No
module builds one by concatenation or a literal like `"cells.A1"` — including `mutation.ts` and
`primitives/schema.ts`. Schema declarations name slots by **path**; the key is always derived.
(Test fixtures may hand-build for readability.)

Rationale: same invariant `address.ts` already carries for address strings. A hand-built `"a.b"`
and the real path `["a","b"]` produce the same key and would silently alias two different slots.

---

## D-011 — `ObjectType` includes the Phase 0 fixture types; command reachability is a command-layer concern
Ruled: entry 0006-REVIEW-phase0 — Answers: implementer question 1, cycle 0005

`value` and `add` stay in `ObjectType` alongside the eight product primitives. `primitives/
schema.ts` MUST give both real schema entries — `add` needs a genuine derived `out.result`, since
§6 designates it as the fixture that exercises the derived-slot mechanism. Whether a type is
reachable from the command line is decided solely by §5.10's command registry (which simply has
no entry for `value`/`add`) — never by excluding a type from `ObjectType`.

Rationale: a separate fixture-only union would force every type-keyed consumer (schema registry
above all) to handle two unions, and would make the Phase 0 fixtures second-class exactly where
§6 wants them load-bearing.

---

## D-012 — `explode` changes a preset's type to `polyline`; there is no separate "path" type
Ruled: entry 0006-REVIEW-phase0 — Answers: implementer question 2, cycle 0005

The editable-path object type is `polyline`. `explode` sets `type` to `polyline` (keeping ID and
name, per D-007). No separate `path`/`editablePath` type exists. Consequence, not a bug: after
`explode polygon_1`, the object is named `polygon_1` with type `polyline` — required by D-007 and
correct; do not rename on explode.

Rationale: §5.5 introduces editable paths as one category ("polyline, or any exploded preset")
with one slot exposure. A separate type would duplicate `polyline`'s schema for no reason.

---

## D-013 — A derived slot's compute function may read ONLY the addresses its own dependency declaration returned
Ruled: entry 0008-REVIEW-phase0 (reviewer finding, cycle 0007)

For every derived slot, everything its `compute` function reads MUST be a subset of what
`derivedSlotDependencyAddresses()` returns for that slot. Two consequences:
1. **`graph/eval.ts` MUST enforce this mechanically.** The `read` callback it hands to `compute`
   resolves only the slot's declared dependencies and returns `#REF` for anything else — a
   set-membership check against edges already built, free per Rule 5.
2. A schema entry SHOULD derive both halves (`dependencies` and the `read` calls) from the same
   constants, as `add` already does — the cheap half; #1 is the half that holds when someone
   forgets.

Rationale: `eval.ts` orders the topological pass from the *declared* edges. A compute reading an
undeclared slot reads one the sort never ordered before it — silently, intermittently stale
output, presenting as flaky reactivity. The same bug §9 already forbids a `recompute()` pass for
causing, reached by a different route. Ruled before `eval.ts` existed, so it's built in rather
than retrofitted.

---

## D-014 — Predicates over the `Value` union are declared once, in `graph/node.ts`
Ruled: entry 0008-REVIEW-phase0 (reviewer finding, cycle 0007)

A type guard narrowing `Value` (`isErrorValue` today; any future sibling like `isPoint`) is
declared once in `graph/node.ts`, beside `Value` itself, and imported everywhere. No local copies.
(`address.ts`'s `isAddressError` is a different, narrower question over `unknown` and stays put —
0006-REVIEW declined to deepen that coupling.)

Rationale: same principle as D-009, applied to the value vocabulary. The predicate was already
byte-identical in two files; every future derived-slot compute function and `formula/eval.ts` need
the same check, so the next copies were guaranteed. The specific trap worth writing once:
`typeof null === "object"`, so a copy that skips the `!== null` guard reports `null` as an error.

---

## D-015 — `addressKey` is an internal Map/Set key and MUST NEVER reach the user; user-facing names come from `formatAddress`
Ruled: entry 0010-REVIEW-phase0 (reviewer finding, cycle 0009)

`graph/edge.ts`'s `addressKey` exists only to key `Map`s/`Set`s inside graph-traversal code
(`cycles.ts`, `eval.ts`). Its output MUST NEVER appear in a user-facing string — rejection
messages, command echoes, an `ErrorValue.message`, the `refs` listing. Every user-facing slot
mention MUST go through `address.ts`'s `formatAddress` instead. The inverse binds too:
`formatAddress`'s output must never be a `Map`/`Set` key (it changes under rename).

Concretely: `mutation.ts`'s acyclicity rejection maps `detectCycle`'s `Address[]` through
`formatAddress`, producing `table_x.A1` — never `obj_3::cells.A1`.

Rationale: `addressKey` leaks the identity layer into the naming layer at the worst moment —
Rule 3's whole point is that users read names, storage holds IDs. It's also the path of least
resistance (already imported, returns a plausible-looking string), which is why it needs a rule
rather than a hope.

---

## D-016 — An acceptance-criterion claim MUST be backed by a mutation check; an ORDER claim needs a fixture whose own order is wrong
Ruled: entry 0012-REVIEW-phase0 (reviewer finding, cycle 0011)

Two parts, both mandatory:
1. **Mutation-check every acceptance-criterion claim.** Before reporting any §6 criterion (or
   sub-clause) as PASSING, neutralise the implementing line(s), re-run the suite, confirm a
   **named** test fails, and paste that output beside the claim. If nothing fails, the criterion
   is **NOT demonstrated**, however much surrounding test coverage exists.
2. **An ORDER criterion needs a fixture written in an order that is not already correct** — objects
   declared after their dependents, slots declared before what they read. A fixture already in
   dependency order can't tell a real topological sort from no sort at all.

Rationale: verified by probe, twice in consecutive cycles — `graph/eval.ts`'s topological sort
replaced with raw declaration order (0011), and `cycles.ts`'s cycle-slicing line replaced with a
different one (0010) — both times the **entire suite still passed** (107/107 and 97/97) because
every fixture happened to be written in an order the bug couldn't distinguish from correct. Two
consecutive cycles losing their single most load-bearing line to a green suite is a process gap,
not a coincidence.

---

## D-017 — Edge derivation is narrower than the object's real slot set; step 4 MUST reject the disagreement
Ruled: entry 0014-REVIEW-phase0 (reviewer finding, cycle 0013) — binding on `mutation.ts` step 4,
`document.ts`, every future schema entry

§5.1 step 3 says re-derive edges "from stored formula ASTs and schema declarations." The actual
`deriveEdges` derives from **schema-declared paths that currently hold a formula** — a strictly
smaller set. `graph/eval.ts` separately builds its slot universe from the object's *actual*
`slots`. The two disagree, and nothing reconciles them: an edge through an undeclared slot goes
missing silently. Verified: a 3-slot cycle through one undeclared slot made `detectCycle` report
`hasCycle: false` — step 5 would accept a genuinely cyclic document, and step 7 would quietly
write `#REF` everywhere and commit.

Ruling, two parts:
1. **`deriveEdges` is NOT required to change.** Its schema-driven approach is a legitimate,
   reasoned answer to a real constraint (there's no sanctioned way to recover a formula slot's own
   path from its `GraphObject.slots` key — D-010 forbids inverting one).
2. **Step 4 (§5.1.1 integrity validation) MUST make the disagreement LOUD.** Before step 5 runs,
   reject any object whose actual `formula`/`derived` slots aren't fully covered by its schema,
   naming every offending slot via `formatAddress` (never `addressKey`, D-015). A type with no
   schema entry at all is the one exception, and only because §6's build order guarantees it
   carries no formula slots yet.

Forward note for Phase 4: `nonDerivedSlotPaths` is a fixed list and cannot express a table's
`cells.A1`…`cells.Z99` slot *family*. That's a known, temporary shape, not a Phase 0 defect —
**do not extend `nonDerivedSlotPaths` to tables**; Phase 4 must revisit the mechanism, and part
2's check is what will announce that need loudly instead of as a table that silently never
recalculates.
