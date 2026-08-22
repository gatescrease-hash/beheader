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

Ruling: Each work cycle produces exactly one commit, on `master`, whose first line is
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

---

## D-013 — A derived slot's compute function may read ONLY the addresses its own dependency declaration returned
Answers: (reviewer finding, cycle 0007)   Ruled: entry 0008-REVIEW-phase0   Binding on: all future cycles

Ruling: for every derived slot, the set of addresses its `compute` function reads MUST be a
subset of the set `derivedSlotDependencyAddresses()` returns for that same slot. A compute
function MUST NOT read any other slot, on its own object or any other, by any means.

Two binding consequences:

1. **`graph/eval.ts` MUST enforce this mechanically, not by convention.** When it invokes a
   derived slot's `compute`, the `read` callback it passes MUST resolve only that slot's
   declared dependency addresses and MUST return a `#REF` `ErrorValue` — not the real value —
   for anything else. This is a set-membership check over an array the evaluator has already
   computed in order to build the edges, so it costs one comparison per read and no extra
   bookkeeping (Rule 5 is not a licence to skip it).
2. **A schema entry SHOULD derive both from the same constants**, as `add` already does with
   `ADD_IN_A_PATH` / `ADD_IN_B_PATH`. That is the cheap half of the guarantee; consequence 1
   is the half that actually holds when a future entry forgets.

Rationale: `graph/eval.ts` builds its topological order out of the **declared** edges. A
compute function that reads an *undeclared* slot therefore reads a slot the sort was never
asked to order before it — so the value it gets is whichever one happens to be there: this
pass's, or the previous pass's. That is silently, intermittently stale output, and it presents
exactly as "flaky reactivity," the failure mode `PROCESS_BRIEF` §9 already forbids a
`recompute()` pass for causing. The two failures are the same bug reached by different routes,
and only one of the routes was closed.

This is not hypothetical at the point it is being ruled: `DerivedSlotCompute`'s `read`
parameter accepts **any** `Address`, deliberately, because §5.1's dynamic dependency case
(`text.resolvedContent`, `script.out.*`) genuinely needs to read other objects. The parameter
cannot be narrowed by type, so the constraint has to be enforced at the call site or not at
all. Ruled now, before `eval.ts` exists, because ruling after it is written against a looser
contract means rewriting it; ruling now costs nothing.

Reconciliation required: none — `add`'s compute already reads exactly its two declared
dependencies. This binds `graph/eval.ts`, which is the next module to be built.

---

## D-014 — Predicates over the `Value` union are declared once, in `graph/node.ts`
Answers: (reviewer finding, cycle 0007)   Ruled: entry 0008-REVIEW-phase0   Binding on: all future cycles

Ruling: a type guard that narrows a `Value` — `isErrorValue` today, and any sibling a later
phase needs (`isPoint`, `isPointList`, …) — is declared in `graph/node.ts` beside the `Value`
union itself and imported everywhere else. No module may define its own local copy.
`isErrorValue` was moved there by reviewer edit at 0008-REVIEW.

`address.ts`'s `isAddressError` is explicitly **not** covered by this and stays where it is: it
takes `unknown` (not `Value`) and narrows to the `#REF`-only `AddressError`, so it answers a
different question for a different caller. Do not "unify" the two — 0006-REVIEW §6 declined to
deepen the `address.ts` ↔ `graph/node.ts` coupling, and that reasoning is unchanged.

Rationale: this is D-009's principle applied to the value vocabulary rather than the object-type
vocabulary, for the same reason and at the same cheapest moment — the predicate was duplicated
in exactly one place (byte-identical bodies in `address.ts` and `primitives/schema.ts`), and the
next copy was already guaranteed: §5.1 requires errors to propagate, so *every* derived slot's
compute function (geometry's `centroid`, text's `resolvedContent`, script's `out.*`) and
`formula/eval.ts` must all make this exact check. Left alone, the third and fourth copies arrive
in Phase 3 and Phase 5. The `value !== null` guard is the specific thing worth writing once:
`typeof null === "object"` and `null` is a member of `Value`, so a copy that omits it reports
`null` as an error.

---

## D-015 — `addressKey` is an internal Map/Set key and MUST NEVER reach the user; user-facing slot names come from `formatAddress`
Answers: (reviewer finding, cycle 0009)   Ruled: entry 0010-REVIEW-phase0   Binding on: all future cycles

Ruling: `graph/edge.ts`'s `addressKey` exists for exactly one purpose — keying `Map`s and
`Set`s inside graph-traversal code (`graph/cycles.ts`'s DFS, `graph/eval.ts`'s topological
sort). Its output MUST NEVER appear in any string a user reads: rejection messages, command-
line echoes, an `ErrorValue`'s `message` field, or the `refs` listing. Every user-facing
mention of a slot MUST be produced by `address.ts`'s `formatAddress`, which resolves the
object's **current** name against the document's object list.

The inverse binds equally: `formatAddress`'s output MUST NEVER be used as a `Map`/`Set` key
or as a slot-identity comparison, because it is name-based and therefore changes under
`rename`.

Concretely, and this is the case that forced the ruling: `mutation.ts`'s acyclicity rejection
(§5.1 step 5) receives `detectCycle`'s `readonly Address[]` and MUST map every element through
`formatAddress`, producing `table_x.A1` — never `obj_3::cells.A1`. The Phase 0 acceptance test
for cycle rejection MUST assert the object's **current name** appears in the message, not
merely that each slot is mentioned somehow.

Rationale, two independent arguments:

1. **It leaks the identity layer into the naming layer at the worst possible moment.** Rule 3's
   two-layer scheme exists precisely so that users read names and storage holds IDs. §5.10 calls
   the rejection message "the entire debugging story for now." A message naming `obj_3` hands
   the user a token they have never seen on screen and cannot type into a command — and after a
   `rename`, it is the one string in the system that does not follow.
2. **It is the path of least resistance, which is why it needs a rule rather than a hope.**
   `mutation.ts` will already import `Edge` from `graph/edge.ts`; `detectCycle` deliberately
   returns bare `Address`es with no name attached (correctly — it has no object list);
   `addressKey` is therefore one import away and returns a plausible-looking string. Reaching
   `formatAddress` instead requires threading the object list down to the message site, which is
   strictly more work. A cheaper wrong path that produces output nobody notices is wrong until a
   rename happens is the exact shape of defect this log exists to prevent.

Ruled now, before `mutation.ts` exists, for the same timing reason as D-006 and D-013: the
constraint costs nothing to build in and requires rework once a message-formatting path has been
written against the looser habit.

Reconciliation required: none. `addressKey` has exactly two consumers today, both internal —
`graph/cycles.ts`'s adjacency/colour maps and `graph/cycles.test.ts`'s assertions.

---

## D-016 — An acceptance-criterion claim MUST be backed by a mutation check; an ORDER is only demonstrated by a fixture whose own order is wrong
Answers: (reviewer finding, cycle 0011)   Ruled: entry 0012-REVIEW-phase0   Binding on: all future cycles

Ruling, two parts, both mandatory:

1. **Mutation-check every acceptance-criterion claim.** Before reporting any PROJECT_BRIEF §6
   acceptance criterion — or any sub-clause of one — as PASSING, the implementer MUST neutralise
   the line or lines that implement it, re-run the suite, and confirm that a **named** test
   fails. Paste that output into the log entry beside the claim, exactly as cycle 0011 already
   did voluntarily for its D-013 test. If no test fails, the criterion is **NOT demonstrated**
   and MUST be reported `NOT YET` no matter how many tests cover the surrounding area.

2. **A criterion about ORDER needs a fixture whose declared order is not already correct.** Where
   the behaviour under test is an ordering, the demonstrating fixture MUST be written in an order
   that is *not* a valid evaluation order — objects declared after their dependents, slots
   declared before the slots they read. A fixture written in dependency order cannot tell a real
   topological sort apart from no sort at all, because both produce the same answer on it.

Rationale: this is not hypothetical, and it is not a stylistic preference about test coverage.
Verified by probe during this review: `graph/eval.ts`'s topological sort was replaced with
`[...nodesByKey.keys()]` — the raw declaration order, no sort of any kind — and the full suite
passed **107/107**. Every fixture in `eval.test.ts` happened to declare its objects and its slots
in dependency order already, so the module's entire reason for existing was unpinned while nine
tests reported it working. Cycle 0011 nevertheless reported the §6 clause "propagate in correct
topological order *including through derived slots*" as PASSING and cited those tests.

PROCESS_BRIEF §9 already forbids claiming an acceptance criterion passes without an executable
test demonstrating it, and §12.1 already requires criteria be expressed as executable tests. The
gap this closes is narrower and is the one that actually bites: a test can *cover* a behaviour,
*pass*, and still not *demonstrate* it, and reading the test cannot reliably tell you which — the
implementer of 0011 read theirs and concluded, in good faith, that it did. Only running the
mutation distinguishes the two, it costs one command, and it is the same check that found the
identical failure one cycle earlier (0010-REVIEW §6, `cycles.ts`'s `stack.slice(cycleStart)`,
also 97/97 green under mutation). Two consecutive cycles have now had their single most
load-bearing line left unpinned by a suite that looked thorough. That is a process gap, not two
coincidences, so it is ruled rather than fixed twice.

Part 2 exists because part 1 alone is a check the implementer runs *after* writing the fixture,
and the cheapest fixture to write is almost always the one in dependency order — the same
accidental uniformity D-008 and 0010-REVIEW §6 both named. Writing the fixture backwards is the
half of the guarantee that holds when someone forgets to run the mutation.

Reconciliation required: none in code — the gap was closed by reviewer edit 1 at
0012-REVIEW-phase0, which adds the reverse-order fixture. Binding on every future cycle that
claims a criterion, and most immediately on `mutation.ts` (cycle rejection with prior state
provably unchanged) and `document.ts` (round-trips identically).

---

## D-017 — Edge derivation is narrower than the object's real slot set; step 4 MUST reject the disagreement
Answers: (reviewer finding, cycle 0013)   Ruled: entry 0014-REVIEW-phase0   Binding on: `mutation.ts` step 4, `document.ts`, and every future schema entry

PROJECT_BRIEF §5.1 step 3 says: "Re-derive ALL edges from stored formula ASTs and schema
declarations." Cycle 0013's `deriveEdges` derives them from **schema declarations only** — it
walks `ObjectSchema.nonDerivedSlotPaths` and emits a binding edge for each declared path that
currently holds a `formula` slot. `graph/eval.ts`, by contrast, builds its slot universe from
`Object.keys(object.slots)` — the object's ACTUAL slots. There are now two disagreeing answers
to "which slots exist," and nothing reconciles them.

**Where they disagree, edges vanish silently.** Verified by probe at 0014-REVIEW-phase0 on an
`add` object carrying an undeclared fourth slot `in.c`:

- `in.c` reading `obj_1.value` produced **no** `obj_1.value → obj_9.in.c` edge. `evaluate` still
  evaluated `in.c` (it is in `object.slots`), so it got a value — but by declaration-order luck,
  not because anything ordered it.
- Worse, and this is the part that decides the ruling: a genuine three-slot cycle
  `in.c → in.a → out.result → in.c` produced an edge set on which `detectCycle` returns
  `{ hasCycle: false }`. Only one of the three edges runs through the undeclared slot, and
  dropping it is enough to make the whole cycle invisible. **Step 5 would accept that document**,
  and step 7 then quietly wrote `#REF` into all three slots.

That is not a coverage gap. It is a soundness gap in the *input* to the cycle check, and it lands
directly on Phase 0's acceptance clause 2 ("a cycle is rejected with the offending slots named").
A correct `detectCycle` over an incomplete edge set is still a wrong answer, delivered
confidently.

**Ruling — two parts.**

1. **`deriveEdges` is NOT required to change.** Its schema-driven approach is a legitimate answer
   to a real problem (a formula slot's own `path` cannot be recovered from its `GraphObject.slots`
   key — there is no sanctioned inverse of `slotKey`, D-010), and cycle 0013 reasoned that
   trade-off out honestly and in the open. Widening the registry rather than inverting a key was
   the right call at the time it was made.

2. **Step 4 (§5.1.1 integrity validation) MUST make the disagreement LOUD.** Before step 5 runs,
   the mutation loop MUST reject any object whose actual `formula`/`derived` slot set is not
   fully covered by its schema's declarations, with a message naming every offending slot via
   `formatAddress` (never `addressKey`, D-015). An object of a type with **no** schema entry at
   all is the one permitted exception, and only because §6's build order guarantees it carries no
   formula slots yet — when the first such type gains formula slots, this exception dies with it.
   §5.1.1's stated invariant is "an edge must never point at a slot that no longer exists"; this
   is its unstated mirror — **a slot that exists must never be missing its edges** — and the brief
   is silent on it only because it never anticipated the two universes coming apart.

**Why rule it now rather than when it bites.** It is already reachable. `document.ts` — the very
next Phase 0 slice, and acceptance clause 4 — loads `GraphObject[]` from JSON, so an undeclared
formula slot is one hand-edited file away from a document that passes every validation step and
evaluates to nonsense. Ruling after `document.ts` exists means retrofitting a rejection path into
a load path that already "works."

**The Phase 4 half of this, recorded now so it is not rediscovered late.** `nonDerivedSlotPaths`
is typed `readonly (readonly string[])[]` — a fixed list. A table's `cells.A1`…`cells.Z99` is a
slot **FAMILY**, not a fixed list, and cannot be enumerated by it (this is the same limitation
STATUS.md has carried as "the table/`cells` mapping in `address.ts` is still hardcoded", and
D-005/D-009's unfinished business). So the mechanism as typed cannot cover the one object type
the brief spends the most words on. That does not make it wrong for Phase 0 — it makes it a known
temporary shape. **Do not extend `nonDerivedSlotPaths` to tables by adding entries.** Phase 4 must
revisit the mechanism, and part 2's step-4 check is what will make the need announce itself
loudly rather than as a table whose formulas mysteriously never recalculate.

Reconciliation required: none in code this cycle. Two tests pinning the CURRENT behaviour were
added by the reviewer at 0014-REVIEW-phase0 (`mutation.test.ts`, "KNOWN GAP, D-017") so the gap is
executable rather than prose. When part 2 lands, those two tests are **replaced** by a rejection
test, not deleted.
