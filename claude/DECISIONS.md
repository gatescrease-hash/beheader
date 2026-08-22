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

---

## D-008 — A surface→stored path mapping keys on the slot's FORM, never on "this type plus one segment"
Answers: (reviewer finding, cycle 0003)   Ruled: entry 0004-REVIEW-phase0   Binding on: all future cycles

Ruling: where a surface path segment is shorthand for a longer stored path (D-005), the
mapping MUST be triggered by matching the *form* of the shorthand, never by a structural
proxy such as "the object is a table and the path has exactly one segment." Concretely, the
table cell mapping fires only when the single segment matches the A1 form
(`/^[A-Z]+[0-9]+$/`, §5.4's "A1-style addressing"), not for any single segment.

The inverse direction is bound by the same rule: `toSurfacePath` may strip a prefix only when
`toStoredPath` could have added it. Stripping `["cells","rows"]` to print `table_x.rows` would
name a *different* slot than the one being printed, which silently breaks the round-trip
guarantee D-005 §2 requires.

Rationale: keying on the structural proxy makes the shorthand swallow the type's entire
single-segment namespace. Verified by probe during this review: under the proxy rule,
`table_x.rows`, `table_x.opacity`, `table_x.typo` and even `table_x.cells` all resolved to
phantom `cells.<name>` slots that no schema declares. Tables demonstrably gain non-cell slots
(`table x=0 y=0 rows=8 cols=8` in §5.10 implies at least `origin.x`/`origin.y`), so this would
have become a live defect at Phase 2 rather than staying latent. Rule 3 says get addressing
right early; this is the second subtle addressing error found in the same file, and both were
of the same kind — a rule that looked right on the specified examples and was wrong on the
unspecified ones. **Test the unspecified cases, not just the brief's examples.**

---

## D-009 — Object type strings are settled in `graph/node.ts`; `address.ts` imports, never duplicates
Answers: implementer question 3, cycle 0003   Ruled: entry 0004-REVIEW-phase0   Binding on: all future cycles

Ruling: the vocabulary of object type strings (`"table"`, `"polygon"`, `"circle"`,
`"polyline"`, `"rect"`, `"text"`, `"image"`, `"script"`, …) is defined once, in
`graph/node.ts` (or `primitives/schema.ts` if the schema registry ends up owning it), as a
union type — not as bare `string`. `address.ts`'s `TABLE_TYPE` constant MUST then be replaced
by a reference to that shared definition rather than keeping its own string literal. Until
that module exists, `address.ts`'s local constant stands and the type strings appearing in
tests are illustrative only.

Rationale: `AddressableObject.type` is currently `string`, so a typo (`"tabel"`) silently
disables the D-005 mapping with no error anywhere. A union type makes that a compile error.
The constant is duplicated in exactly one place today, which is the cheapest possible moment
to rule that it must not be duplicated in two.

---

## D-010 — Slot keys are produced ONLY by `slotKey()`, never hand-built
Answers: (reviewer finding, cycle 0005)   Ruled: entry 0006-REVIEW-phase0   Binding on: all future cycles

Ruling: a key into `GraphObject.slots` MUST only ever be produced by `graph/node.ts`'s
`slotKey(path)`. No module may build one by string concatenation, template literal, or a
literal like `"cells.A1"` written inline — including in mutation.ts when it constructs an
object's initial slot set, and including in `primitives/schema.ts` when it declares which
slots a type has. Schema declarations name slots by **path** (`["cells","A1"]`), and the key
is derived. Test fixtures are the one tolerated exception, and only for readability.

Rationale: this is the exact same invariant `address.ts` already carries for address strings
("Address strings are only ever produced by formatAddress(); never concatenated ad hoc"), and
it protects the same thing. `slotKey`'s collision-freedom argument depends on path segments
never containing `.` — which `address.ts`'s `PATH_SEGMENT_PATTERN` guarantees for paths that
came through `parseAddress`, but nothing guarantees for a hand-built key. A hand-built
`"a.b"` and a real path `["a","b"]` produce the same key and would silently alias two
different slots into one. Cycle 0005 asserts this invariant in `node.ts`'s header but nothing
enforces it; this ruling closes the gap by discipline, which is the cheap half of the fix.

---

## D-011 — `ObjectType` includes the Phase 0 fixture types; command reachability is a command-layer concern
Answers: implementer question 1, cycle 0005   Ruled: entry 0006-REVIEW-phase0   Binding on: all future cycles

Ruling: `value` and `add` stay in `ObjectType` alongside the eight product primitives.
`primitives/schema.ts` MUST provide real schema entries for both — `add` in particular needs
a genuine derived `out.result` slot, because PROJECT_BRIEF §6 designates it as *the* fixture
that exercises the derived-slot mechanism before geometry exists. Whether a type can be
created from the command line is decided solely by §5.10's command registry, which simply has
no entry for `value` or `add`; it is not a property of the data model and MUST NOT be
expressed by excluding them from `ObjectType`.

Rationale: the alternative (a separate fixture-only union) forces every consumer keyed on
object type — the schema registry above all — to handle two unions and to convert between
them, which is more machinery than the problem deserves. It would also make the Phase 0
fixtures second-class exactly where the brief wants them load-bearing: §6's acceptance
criterion is demonstrated *through* them. Keeping one union means the `add` node's derived
slot is evaluated by the same code path as `polygon_1.centroid.x` will be, which is the whole
point of the fixture.

---

## D-012 — `explode` changes a preset's type to `polyline`; there is no separate "path" type
Answers: implementer question 2, cycle 0005   Ruled: entry 0006-REVIEW-phase0   Binding on: all future cycles

Ruling: the editable-path object type is `polyline`. `explode` sets the object's `type` to
`polyline` (keeping its id and name, per D-007). No separate `path` / `editablePath` type is
introduced.

Note the consequence and do NOT "fix" it: after `explode polygon_1`, the document holds an
object still **named** `polygon_1` whose **type** is `polyline`. That is correct and required
— D-007 preserves the name precisely so that stored addresses keep displaying the name the
user chose. Renaming on explode would surprise the user and buy nothing (stored addresses are
ID-based and would not break either way).

Rationale: §5.5 introduces editable paths as "**Editable paths** (polyline, or any exploded
preset)" — one category, one slot exposure (per-vertex literal slots plus a derived
`vertices`). A separate type would be a second entry in the schema registry with a schema
identical to `polyline`'s, which is duplication the brief never asks for and which Rule 5's
"dumbest correct implementation" argues against.
