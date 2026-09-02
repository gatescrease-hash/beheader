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

---

## D-018 — Schema↔slot reconciliation is TWO-WAY; step 4 MUST check both directions
Ruled: entry 0018-REVIEW-phase0 (reviewer finding, cycles 0015-0017) — Answers: implementer
question 2 of cycle 0015 (in part). Binding on `mutation.ts` step 4, `document.ts`, every future
operation kind.

D-017 required step 4 to reject a slot the schema does not declare. That is one direction only.
`validateIntegrity` MUST also reject the other direction:

1. **Every schema-declared derived path MUST carry a `derived`-kind slot on the object.** An
   object missing its own declared derived slot makes `deriveEdges` emit edges whose
   `dependentSlot` names nothing — a dangling edge, which §5.1.1 calls absolutely forbidden.
2. **A slot at a schema-declared derived path MUST be `derived` kind**, and a slot at a
   `nonDerivedSlotPaths` path MUST NOT be `derived` kind. §5.1: "`derived` is fixed by schema and
   can never be converted; attempting to `link` or `set` a derived slot is rejected."

Both messages name the offending slot the same way check 1 already does.

Rationale: verified by probe at 0018-REVIEW. (1) An `add` object with no `out.result` produced two
edges pointing at a nonexistent slot; `validateIntegrity` returned `{ ok: true }` and the whole
mutation was accepted. This is the exact shape a §5.11 load produces, because `DerivedSlot.value`
is never serialized — so `document.ts`, the very next slice, is where it lands. (2) A `setSlot`
writing `{ kind: "literal", value: 999 }` over `add_1.out.result` was accepted; the slot is then
frozen at 999 forever while `deriveEdges` keeps emitting edges into it, and nothing says so. Both
are D-017's own failure class — schema and object disagreeing silently — reached from the other
side. `mutation.ts` is the only legal place for the §5.1 rejection (Rule 2): a check in §5.10's
command layer would be bypassed by dragging and by document loading.

Reconciliation required: replace the two `KNOWN GAPS pinned by 0018-REVIEW` tests naming D-018 in
`mutation.test.ts` with the rejection tests this ruling requires. Pinning `graph/eval.ts`'s L-13
stale-edge branch (0014-REVIEW constraint 8, still open) is the same work: case 1 reaches it.

---

## D-019 — The step-1 clone MUST preserve every member of `Value`; a JSON round-trip does not
Ruled: entry 0018-REVIEW-phase0 (reviewer finding, cycle 0017)   Binding on: `mutation.ts` step 1

`cloneObjects` MUST return state deep-equal to its input for every value `Value` admits. A
`JSON.parse(JSON.stringify(x))` clone does not: `NaN`, `Infinity`, and `-Infinity` are members of
`Value`'s `number` arm and all three come back as `null`. Replace it with an explicit recursive
clone over the plain data PROJECT_BRIEF §2 already guarantees (Rule 5: the dumbest correct
implementation, not the shortest one). `structuredClone` remains unavailable under D-006.

Rationale: verified by probe at 0018-REVIEW, through the real `mutate` entry point only, in two
mutations. `set value_1.value 1e999` commits `Infinity`. A second mutation naming only `value_2`
then commits `value_1.value = null` — a slot that operation never mentioned, a change no journal
entry records. That is Rule 2's central promise ("either fully commits or leaves prior state
bit-for-bit untouched") failing on the ACCEPT path, which is worse than failing on the reject path
0017 tested so carefully. Note that 0017's mutation-testing could not have caught this: it probed
whether the clone was load-bearing, not whether it was faithful.

Whether a non-finite number is legal *document* state at all is a separate, unsettled question —
see Q-006. This ruling binds the clone regardless of how Q-006 lands: a clone must clone.

Reconciliation required: replace the `KNOWN GAPS pinned by 0018-REVIEW` test naming D-019 in
`mutation.test.ts` with a fidelity test over every member of `Value`.

---

## D-020 — The batch form lands before `document.ts`; one committed batch is ONE journal entry
Ruled: entry 0018-REVIEW-phase0   Binding on: `mutation.ts`, `document.ts`

§5.1 states the batch form as **required**, and "Document loading MUST use a batch." It has now
been deferred by three consecutive cycles (0016, 0017, and 0014-REVIEW's carried constraint 7).
It MUST land before `document.ts` begins.

Shape: `mutate` accepts a **list** of operations applied to ONE clone, validated and evaluated
ONCE, committing all-or-nothing. Do not add a second entry point beside the single-operation form
— widen the existing one (the same "widen, never restructure" stance Q-005 set for `FormulaAst`).
A committed batch appends exactly **one** `MutationJournalEntry`, holding the operation LIST: the
journal records committed *mutations*, a batch is one transaction, so one entry is what an
eventual undo must invert.

Rationale: the batch form is not a performance optimisation (Rule 5 would forbid one) — it is the
transactional boundary. Loading a document one operation at a time makes every intermediate state
a separately-validated document, and intermediate states during a load are routinely invalid
(object B not yet created when object A's formula references it). Building `document.ts` on the
single-operation form would therefore either reject legitimate documents or need its own
validation bypass, which Rule 2 forbids.

---

## D-021 — An operation whose target does not exist is REJECTED, never a silent no-op
Ruled: entry 0018-REVIEW-phase0 — Answers: implementer question 2 of cycle 0017

`mutate` MUST reject an `Operation` whose `address.objectId` names no object in `objects`, with a
human-readable message, taking the §5.1 step 6 path. It MUST NOT apply nothing, return `ok: true`,
and append a journal entry.

Rationale: Rule 2 requires the journal to record **committed mutations** so undo can be built on
it. An entry for an operation that changed nothing is a false record of history — and it is
indistinguishable, later, from one that did change something. Rejecting also matches how every
other bad address in this file is already treated (§5.1.1's dangling-reference check) rather than
inventing a second policy for the write side of the same problem. "Trusted input from a future
command layer" is not available as a reason: Rule 2 routes dragging and document loading through
here too, and neither is a command line.

Reconciliation required: `mutation.test.ts`'s "never throws... (a no-op, per applyOperation's own
contract)" test asserts the current behaviour and MUST change. This ruling is the authorisation
for that changed expectation (PROCESS_BRIEF §6.1 trigger 5); say so in the cycle's log entry.

---

## D-022 — `describeUndeclaredSlot`'s raw-key naming is an approved, BOUNDED exception
Ruled: entry 0018-REVIEW-phase0 — Answers: implementer question 1 of cycle 0015

Naming a slot that no schema declares may use `object.name + "." + key` rather than
`formatAddress`, because an undeclared slot has no `Address` to format — D-010's "declare it
schema-side" escape hatch cannot apply by construction. This is the ONLY sanctioned exception to
D-015's "every user-facing slot mention goes through `formatAddress`"; it is confined to
`mutation.ts`'s `describeUndeclaredSlot` and MUST NOT be copied elsewhere.

The exception is bounded by a claim that must stay true: for every type whose schema is
registered, the string produced is identical to `formatAddress`'s. That holds today only because
no registered type uses D-005's surface↔stored mapping. **Pin it with a test** comparing the two
for every registered type, so the day a table gets a schema entry the divergence fails loudly
instead of shipping a wrong name.

Rationale: the implementer identified the tension precisely, took the reversible option, and
disclosed it in full rather than quietly widening D-015 — the right move. The gap was not the
choice but its durability: the correctness argument lives in a doc comment, and doc comments do
not fail a test run.

---

## D-023 — When an address's object cannot be resolved, the failure message names the raw id, LABELLED as an id
Ruled: entry 0021-REVIEW-phase0 (reviewer finding, cycle 0019)   Binding on: `mutation.ts`, and
every future rejection message about an unresolvable object

D-015 forbids leaking the identity layer into a user-facing string **where a name exists**. It does
not apply when the whole content of the rejection is that nothing resolves: there is no name to
print, and suppressing the id leaves a message with no diagnostic content at all. Such a message
MUST name the id, marked as an id (`object id "obj_404"`), never formatted to look like a name
(`obj_404.value`), and — in a batch — MUST identify which operation is being blamed.

D-015 is otherwise unchanged and still binds everywhere a name IS available: `formatAddress` for
every slot mention, never `addressKey`.

Rationale: verified by probe at 0021-REVIEW. `mutate([setSlot obj_404.value, setSlot obj_405.value])`
returned `...target slot "value" names no real object (D-021); ...target slot "value" names no real
object (D-021)` — the same sentence twice, for two different missing objects. Cycle 0020's own
reason for naming every offending operation ("a document load with several bad references benefits
from seeing all of them at once") is defeated by a message that cannot tell them apart, and §5.1
step 6 asks for a **human-readable** failure. `address.ts`'s `formatAddress` already states the raw
id in its own `AddressError` for exactly this case, so this also removes an asymmetry the previous
STATUS recorded as merely "disclosed".

---

## D-024 — Nothing the caller hands `mutate` enters committed state or the journal by reference
Ruled: entry 0021-REVIEW-phase0 (reviewer finding, cycles 0017-0020)   Binding on: `mutation.ts`,
`document.ts`, every future operation kind

`mutate` MUST deep-clone an operation's payload before it becomes committed graph state, and MUST
store the journal's own copy of the operation list. After a call returns, no object reachable from
the committed `objects` or from `journal` may be reachable from anything the caller passed in.

Rationale: verified by probe at 0021-REVIEW. Committed state held the caller's own `Slot` object
(`committed.slots.value === callerPayload` was `true`), two operations sharing one payload produced
two committed slots that were **the same object**, and the journal entry held the caller's live
array. Nothing is broken today — every field is `readonly`, so no caller can legally mutate them —
but that is the same "holds by everyone else's discipline rather than structurally" reasoning this
project has now ruled against twice (0017's own clone argument, upheld; D-019). Rule 2 says nothing
outside `mutation.ts` mutates graph state, and Rule 5's staging exists so committed and prior state
share nothing; a payload injected un-cloned reopens the boundary the clone was added to close, on
the other side. The journal is the sharper half: it is specified append-only, and a caller reusing
its own array could otherwise rewrite what a past call recorded.

Applied by the reviewer at 0021-REVIEW (two lines, both mutation-checked). The general rule binds
future operation kinds, which will carry larger payloads than one `Slot`.

---

## D-025 — Non-finite numbers are NOT legal document state (Q-006 answered: option (b))
Ruled: the human, directly, 2026-08-22 (in response to entry 0022's hand-back) — Answers: **Q-006**

`NaN`, `Infinity`, and `-Infinity` — all three legal members of `Value`'s `number` arm at the type
level — are illegal as committed document state, in the object list AND in the serialized mutation
journal (0021-REVIEW's widening of Q-006's scope; a journal entry's `Operation` payloads carry the
same `Value` union). Two consequences, both required, matching Q-006's own option (b):

1. **`mutation.ts` rejects a slot whose value contains a non-finite number.** Applies uniformly to
   `literal`, `formula`, and `derived` slots (all three carry a `value: Value` field) — not only a
   freshly written literal, but any non-finite value already sitting anywhere in the candidate
   object list, re-checked from scratch on every mutation (Rule 5), the same way D-017/D-018/the
   dangling-reference check already do.
2. **Every derived-slot compute function maps a non-finite result to an `ErrorValue`** — `#TYPE`,
   already a member of `ErrorCode` (§5.1); no new error code needed. `add`'s compute is the first
   and only one that exists (D-011) and is the one this ruling requires fixing.

Rationale: option (b) is the smaller change, keeps the serialized format plain JSON at exactly the
point §5.11 says it is (option (a) would not), and §5.1 already establishes that an `ErrorValue` in
the graph is legitimate state — mapping overflow to `#TYPE` is the SAME move `add`'s compute already
makes for a wrong-shaped input, not a new category of behaviour. This was explicitly the human's
call, not the reviewer's or the implementer's (OPEN_QUESTIONS.md's own recommendation said so), and
was given directly rather than through a numbered review entry.

Consequence for D-019: D-019's clone-fidelity requirement is UNCHANGED and, if anything, more
load-bearing now — the rejection this ruling requires depends on the clone being faithful. A lossy
clone would silently turn a `NaN` literal into `null` before this ruling's check ever saw it, and the
document would then be wrongly ACCEPTED as holding a legal `null` rather than correctly REJECTED for
holding an illegal `NaN` — the same "accept-path corruption" shape D-019's own probe found, now one
layer further downstream. `mutation.test.ts`'s existing D-019 fidelity test (built on a document that
already held several non-finite literals, expecting ACCEPTANCE) is exactly the fixture this ruling
makes illegal, and MUST change — PROCESS_BRIEF §6.1 trigger 5, disclosed in the cycle that applies
this ruling (0023).

---

## D-026 — Object identity inside a batch is tracked by ONE simulation, and every operation kind that changes it extends that simulation
Ruled: entry 0025-REVIEW-phase0 (reviewer, answering cycle 0024's own question 1)   Binding on:
`mutation.ts`, every future `Operation` variant

`mutate` decides whether an operation's target exists by walking the batch in order against a
single `Set<id>` seeded from `objects` (the existence simulation, cycle 0022). That walk is the
ONLY authority on object identity during a batch. Any future operation kind that can ADD, REMOVE,
or RE-KEY an object MUST extend that same walk, and MUST state its own precondition in terms of it:

- `setSlot`, `deleteObject` — the id MUST be in the set at the moment this operation is reached.
- `createObject` — the MIRROR: the id MUST NOT be in the set, and a valid creation ADDS it.

NEVER add a second, parallel pre-check; NEVER check a target against the pre-batch `objects` array;
NEVER decide identity inside `applyOperation`, which is entitled to assume the simulation already
settled it.

Rationale: this is the third time the same hazard has come round. 0021-REVIEW-phase0's carried
constraint 1 predicted it while only `setSlot` existed; cycle 0022 fixed the shrink half
(`deleteObject`); cycle 0024 added the grow half (`createObject`). Each time the fix was correct
BECAUSE it extended one mechanism rather than adding a second — verified by probe at
0025-REVIEW-phase0: `[deleteObject obj_1, createObject obj_1]` in one batch is accepted and yields
a replacement object, a behaviour nobody wrote a branch for. It falls out of both halves feeding
one simulation, and would have needed a special case in any design with two. Recording it as a
ruling so the next variant does not have to rediscover it.

This also answers cycle 0024's question 1: `CreateObjectOperation`'s inverted precondition is the
right generalization of D-021, not a special case needing its own ruling. D-021 says an operation
whose target does not resolve is rejected rather than silently no-op'd; D-002 says ids are unique
and never reused. "Creating an id that already exists" is the same sentence read from the other
side, and belongs in the same check.

---

## D-027 — Value legality is a property of the whole `Document`, not of slot values
Ruled: entry 0027-REVIEW-phase0 (reviewer)   Binding on: `document.ts`, `mutation.ts`, every future
field of `Document`, and Phase 3's camera writer

Every number reachable from a `Document` — in a slot value, in a journal payload, in `camera`, in
`nextObjectId`, and in whatever field is added next — MUST pass `graph/node.ts`'s
`isIllegalNumber` (non-finite, or `-0`). A new numeric field extends the existing check on the load
path; it does NOT get its own separate rule, and it does NOT get an exemption for being "not really
document state."

Where the check lives is decided by where the value can enter:

1. Through `mutate` — the object list and the journal. `mutate` rejects an illegal payload before
   staging and an illegal slot value in `validateIntegrity` (cycle 0026).
2. Never through `mutate` — `camera`, `nextObjectId`, and any future top-level field.
   `deserializeDocument` rejects an illegal one on load (0027-REVIEW). **`saveDocument` cannot:
   it returns a `string` and has no failure channel**, so a field in this class is guarded on the
   read side only, and whoever WRITES it is responsible for never producing an illegal one.
   Phase 3, which is the first code that will write real camera state, is bound by this: a `NaN`
   zoom out of a zoom-to-fit over an empty selection serializes to `null` and makes the document
   unloadable. Guard it where it is computed.

Rationale: this is the third round of one defect. Cycle 0023 enforced D-025 over slot values;
0025-REVIEW found the journal uncovered; cycle 0026 closed the journal; 0027-REVIEW found `camera`
and `nextObjectId` uncovered, verified by probe:

```
file camera zoom 1e999 -> loads as Infinity -> re-saves as "zoom":null   (not identical)
file camera x    -0    -> loads as -0       -> re-saves as "x":0         (not identical)
file nextObjectId -0   -> loads as -0       -> re-saves as 0             (not identical)
in-memory camera NaN   -> saves as null     -> the document no longer LOADS at all
```

Each fix was correct and each was scoped to the field the previous review named. The ruling
generalises it once so the next field does not need a fourth round: the rule belongs to the
document, and PROJECT_BRIEF §6 clause 4 ("round-trips to JSON and back identically") is a claim
about the whole of it.

---

## D-028 — A repaired reference is its OWN AST node (`ErrorNode`), never a widened `LiteralNode`
Answers: nothing open — closes a gap found at 0029-REVIEW-phase1
Ruled: entry 0029-REVIEW-phase1 (reviewer)   Binding on: `formula/*`, and Phase 2's table
reference-adjustment pass

`FormulaAst` has a seventh variant, `ErrorNode` (`{ type: "error"; error: "#REF" }`), and §5.1.1's
repair path and §5.4's reference-adjustment pass MUST write that node in place of the ONE
reference they invalidate. They MUST NOT: widen `LiteralNode.value` to admit an `ErrorValue`;
replace the whole formula's AST with a single error; or store the error only in the slot's `value`
and leave the AST pointing at a slot that no longer exists.

Rationale: the brief states this twice, in its own words, and both times as a NODE.
§5.1.1 — repair "rewrites every inbound reference into a `#REF` **error node** in the referring
AST". §5.4 — "A reference to a deleted row/column becomes a `#REF` error **stored in the AST at
that position**." The distinction is load-bearing, not cosmetic: `= A1 + B1` whose `B1` column was
deleted must keep deriving its edge from `A1`. Repairing at formula level instead of node level
would silently drop that surviving edge — the same class of failure D-017 exists to prevent, and
the one §5.1.1 forbids outright ("NEVER silently drop an edge... Reject or repair; there is no
third option").

`error` is deliberately the one-member literal `"#REF"`, not `graph/node.ts`'s full `ErrorCode`:
`#REF` is the only code the brief ever stores in an AST (`#PARSE` is a parse-time failure — an
unparseable formula is never committed at all, §5.3). Widening that literal later is additive and
sanctioned; adding a second error-shaped node type is not.

Evaluation semantics, binding on Phase 2's `formula/eval.ts`: an `ErrorNode` evaluates to the
`ErrorValue` `{ error: "#REF", message: ... }` — NOT to `#PARSE`. `graph/eval.ts`'s current
`evaluateFormula` returns `#PARSE` for every non-reference shape; that branch is temporary and is
deleted, not extended, when the real evaluator lands (STATUS's own carried note).

`extractDependencies` (`formula/deps.ts`) yields NOTHING for an `ErrorNode` — it is the absence of
a dependency, made explicit. That is what makes the repair path leave a consistent edge set.

Reconciliation required: none today. Nothing constructs an `ErrorNode` yet, and `mutate`'s
temporary `findUnsupportedFormulaAsts` rejects one like any other not-yet-supported shape —
correctly, since the pass that would write one does not exist until Phase 2, the same cycle that
deletes that check.

---

## D-029 — `AND`/`OR`/`NOT` are BOTH operators and functions (Q-009 answered: option (a)) — but `IF`/`AND`/`OR` are never evaluated through the eager registry
Answers: Q-009   Ruled: entry 0029-REVIEW-phase1 (reviewer)   Binding on: `formula/parser.ts`,
`formula/functions.ts`, `formula/eval.ts`, `formula/deps.ts`

Two rulings, and the second is the load-bearing one.

**1. Both forms exist and mean the same thing.** `parser.ts` gives `AND`/`OR` their infix
productions and `NOT` its prefix production per §5.3's precedence chain, AND accepts `AND(a, b,
...)` / `OR(a, b, ...)` / `NOT(a)` as calls per §5.3's built-ins list. `a AND b` and `AND(a, b)`
MUST produce the same value; the call form is the N-ary generalisation. Neither passage of §5.3
has to be explained away, and this is how the spreadsheet model the brief is built on behaves.
`ast.ts` needs no change: `BinaryOpNode`/`UnaryOpNode` and `FunctionCallNode` already represent
both without conflict.

**2. Sameness of VALUE does not mean sameness of EVALUATION MACHINERY.** §5.3 requires
`evaluate` to be lazy: "`IF` evaluates only the taken branch. `AND`/`OR` short-circuit. A runtime
error... in an *untaken* branch therefore never occurs and never surfaces." A table-driven registry
(§5.3: "name → arity → implementation") receives ARGUMENTS THAT HAVE ALREADY BEEN EVALUATED. So:

- `IF`, `AND`, and `OR` MUST be evaluated by `formula/eval.ts` itself, at the `FunctionCallNode`
  site, BEFORE any registry dispatch — in both their operator form and their call form.
  `functions.ts` MUST NOT hold an implementation for them that computes from evaluated arguments.
  Registering their names/arities for arity checking and "is this a known function" is fine;
  computing them from pre-evaluated args is the defect.
- `NOT` is exempt: one argument, no branch to skip, so an ordinary registry entry is correct.
- `deps.ts` treats both forms IDENTICALLY and remains EAGER and TOTAL over both — every argument of
  every `IF`/`AND`/`OR`, in either form, contributes dependencies. §5.3: "A cycle discovered in an
  untaken branch is a REAL cycle and MUST be rejected."

Rationale: this is §5.3's central "getting it backwards breaks reactivity in a way that is very
hard to debug" warning, arriving one cycle before the code that can get it wrong. Wiring `IF`
through the registry is the single most natural way to build it and produces a formula engine that
looks right, passes casual tests, and evaluates the untaken branch of every conditional — which
also detonates §5.3's "an error in an untaken branch never surfaces" guarantee. Recording it now,
while `functions.ts` is unwritten, costs a paragraph; finding it later costs the phase.

Reconciliation required: none yet — no `PROVISIONAL(Q-009)` tag was ever taken (the implementer
correctly declined to commit to an answer). Binding on the cycle that writes `parser.ts` /
`functions.ts` / `eval.ts`, each of which MUST cite this decision in its file header and carry a
test named for the rule it defends.

---

## D-030 — `^` is LEFT-associative; a formula-language semantics gap is settled by Excel, and recorded
Answers: entry 0031's question 2   Ruled: entry 0032-REVIEW-phase1 (reviewer)   Binding on:
`formula/parser.ts`, `formula/eval.ts`, and any future re-parse of formula source

`2^3^2` is `(2^3)^2` = 64, not `2^(3^2)` = 512. `parser.ts`'s inclusion of `^` in the shared
left-associative tier helper is CORRECT and MUST NOT be "fixed" to right-associativity without a
new ruling here.

Rationale, and the general rule it carries: §5.3 gives `^` a precedence tier but is silent on
associativity, and most mathematical notation is right-associative — so a future model will read
this code, recognise the more common convention, and believe it has found a bug. It has not.
PROJECT_BRIEF §1 names **Excel** as this project's model for the formula engine ("a formula engine
with references, math, and conditionals"), and Excel's `^` is left-associative. Where §5.3 is
silent on a formula-language detail, Excel's behaviour is the tie-breaker, because the brief chose
that precedent itself.

The implementer asked whether this should have been a `Q-NNN` instead of an implementation
decision. Taking it as an implementation decision was right — it is reversible (§5.11 stores ASTs,
never re-parseable source, so changing it later affects only newly-typed formulas and migrates
nothing) — but the reasoning belonged somewhere binding rather than in one file's header, which is
what this entry fixes. Same standing for the next such gap: decide it against Excel, implement it,
and say so where the next model will look.

---

## D-031 — A number inside a stored formula AST is document state, and the value-legality check must reach it
Extends: D-025, D-027   Ruled: entry 0032-REVIEW-phase1 (reviewer)   Binding on: whichever cycle
first makes a parsed `FormulaAst` reachable into a slot (Phase 2's "wire the formula engine into
cell slots")

D-027 ruled that "every number reachable from a `Document`" must pass `isIllegalNumber`. A
`LiteralNode`'s `value` inside a formula slot's stored `ast` IS such a number — §5.11 serializes
stored ASTs as part of the document — and NOTHING checks it today:
`validateIntegrity`'s `findIllegalSlotValues` walks each slot's `value` field only, never
`slot.ast`. Verified by probe at 0032-REVIEW-phase1, through the real parser:

```
parseFormula("1" + "0".repeat(400), objects)  -> { type: "literal", value: Infinity }
JSON.stringify({ v: Infinity })               -> {"v":null}
```

Therefore, binding:

1. The cycle that deletes `mutation.ts`'s temporary `findUnsupportedFormulaAsts` MUST, in the SAME
   cycle, extend `validateIntegrity`'s value-legality check to walk every `formula`-kind slot's
   stored AST and reject any `LiteralNode` whose `value` fails `isIllegalNumber`. That temporary
   check is the ONLY thing keeping this unreachable today — removing it without the walk opens the
   hole in the same commit that closes the shield.
2. Widen the EXISTING predicate and the EXISTING check (`hasIllegalNumber`, `findIllegalSlotValues`)
   rather than adding a parallel one — the same "widen, do not duplicate" stance D-020/D-026/D-027
   already established.
3. `lexer.ts` and `parser.ts` are NOT the place to enforce it. A lexer that rejects an overflowing
   digit run is enforcing document-state policy from inside a pure text-scanning stage, and §5.3
   deliberately keeps the four stages separate. They may produce such a literal; `mutate` must
   refuse to commit it.

Rationale: this is the same defect for the fourth time (slot values -> journal payloads ->
`camera`/`nextObjectId` -> stored ASTs), which is exactly what D-027 was generalised to prevent.
The rule was already right; what was missing was anyone noticing that a new producer of numbers had
appeared. `lexer.ts`'s header asserted this was "already built and binding" — it was not, and that
assertion has been corrected in place.

---

## D-032 — An error-shaped type predicate discriminates on the error CODE, never on the presence of an `error` field
Ruled: entry 0032-REVIEW-phase1 (reviewer)   Binding on: `isParseError`, and every future predicate
over a union with an error arm

A predicate that narrows `X | SomeError` MUST test the VALUE of the discriminant
(`value.error === "#PARSE"`), not merely that an `error` field exists. Fixed this cycle in
`parser.ts`'s `isParseError`, which returned `true` for `formula/ast.ts`'s `ErrorNode`
(`{ type: "error"; error: "#REF" }`, D-028) — a member of its own argument union, and a legitimate
AST that can be the ROOT of a repaired formula (a cell holding `= B1` whose column is deleted).
Verified by probe before the fix: `isParseError({ type: "error", error: "#REF" })` returned `true`.

Also binding: a predicate's parameter type is a claim about its domain. `unknown` claims it is
total over every value in the program, and a presence check cannot honour that claim. Prefer the
narrowest parameter type the call sites actually need; where `unknown` is genuinely wanted (so
tests can pass arbitrary shapes), the body must discriminate strongly enough to deserve it.

`address.ts`'s `isAddressError` uses the same presence check and is NOT changed: `AddressError` is
only ever discriminated against `Address` and `string`, neither of which has an `error` field, so
it is correct over its real domain. That is an accident of its call sites, not a property of the
predicate — it is named here so the next person to widen its domain knows to tighten it first.
`graph/node.ts`'s `isErrorValue` is correct by construction: its parameter is `Value`, and
`ErrorValue` is the only arm of `Value` with an `error` field.

---

## D-033 — A computed `-0` is NORMALISED to `+0`; only a genuinely unrepresentable result becomes an error
Ruled: entry 0035-REVIEW-phase1 (reviewer)   Binding on: `formula/functions.ts`,
`formula/eval.ts`, `primitives/schema.ts`'s compute functions, and every future compute path

`isIllegalNumber` (`graph/node.ts`) stays the ONE leaf predicate every value-legality check is
built from (D-014) — but its two halves get different answers on the COMPUTE side:

- **Non-finite (`NaN`, `Infinity`, `-Infinity`) → `#TYPE`.** Unchanged, D-025. The computation has
  no answer this project can represent, so returning a number would be a lie.
- **`-0` → return `+0`.** The computation HAS an answer, and it is zero. Only IEEE 754's sign bit
  on a zero is dropped — a bit §5.11's JSON format cannot carry anyway (`JSON.stringify(-0)` is
  `"0"`), and one no reader of a `Value` can observe (`-0 === 0`).

Rationale: cycle 0034 mapped both halves to `#TYPE`, which made `CEIL(-0.5)` and `ROUND(-0.4, 0)`
— ordinary arithmetic with an exactly representable answer — return an error. That converts a
persistence-format artifact (Q-008, about what may be STORED) into a user-facing arithmetic
failure, and an error is strictly worse than the correct answer: `#TYPE` propagates through every
downstream formula, so one `CEIL` of a small negative number poisons a whole subgraph.

This does NOT reopen Q-008, and it is NOT Q-008's rejected option (c). That rejection is about
`mutate` silently rewriting a value an OPERATION asked to store — the D-019 defect, where an
accepted mutation changes a value the caller stated. Nothing is stated here: a compute function is
choosing which legal `Value` its own arithmetic yields, and there is no user-authored `-0` to
preserve. `mutate` still rejects an authored `-0` literal, in a slot value and in a journal
payload, exactly as before (Q-008 option (a) stands, still provisional).

Binding shape: the normalisation belongs at the ONE guard every compute result already routes
through (`functions.ts`'s `finiteResult`), never sprinkled per function. A future compute path that
can produce `-0` MUST route through a guard of that shape rather than deciding for itself.

Reconciliation required: none — `finiteResult` and its two tests were fixed at this review.
`primitives/schema.ts`'s `add` needs no change (its header's reasoning that `+` over legal operands
cannot produce `-0` remains correct); a compute using `*` or `/` must route through a guard.

---

## D-034 — A registry keyed by user-supplied text is looked up by OWN property, never by a bare index
Ruled: entry 0035-REVIEW-phase1 (reviewer)   Binding on: `formula/functions.ts` and every future
`Record<string, T>` whose key can come from parsed input

`FUNCTION_REGISTRY` is an object literal, so `FUNCTION_REGISTRY[name]` resolves up the prototype
chain: `getFunctionEntry("toString")` returned `Object.prototype.toString`, and
`getFunctionEntry("__proto__")` returned `Object.prototype` — both truthy, both typed
`FunctionEntry`, neither one. The first field read on that value (`entry.arity.kind`, inside
`checkArity`) throws a `TypeError` — the one thing `src/engine/` promises never to do, from a file
whose own header says "No entry here ever throws."

It is reachable from ordinary user text, not theoretical: `parser.ts` validates no function name,
so `toString(1)` parses to `{ type: "functionCall", name: "toString", args: [...] }` today.
Verified by probe at this review, before the fix.

Ruling: every lookup into a `Record<string, T>` whose key originates in parsed or user-supplied
text MUST guard with `Object.hasOwn(record, key)` (or be built on a prototype-less object) before
indexing. Type-level safety is not enough here — `noUncheckedIndexedAccess` types the result
`T | undefined` and the prototype hit satisfies `T`.

Reconciliation required: none beyond this review's own edit to `getFunctionEntry`, plus its
regression test. `LAZY_FUNCTION_NAMES` / `RANGE_ACCEPTING_FUNCTION_NAMES` are `Set`s and were never
exposed to this.

---

## D-035 — `IF` takes exactly three arguments; `AND`/`OR` take at least one
Ruled: entry 0035-REVIEW-phase1 (reviewer)   Binding on: `formula/functions.ts`,
`formula/eval.ts`, `formula/ast.ts`

§5.3 names `IF` in its built-ins list without a signature (unlike `ROUND(n, digits)` and `PI()`),
so this is a gap, settled here rather than left for the evaluator to decide by accident:

- **`IF` is `EXACTLY(3)`.** Excel's optional third argument is deliberately NOT adopted: the
  brief's own prose writes `IF(cond, trueVal, falseVal)` with all three named, and requiring three
  is the additively-widenable direction (a 2-arg form can be legalised later; narrowing after
  formulas exist cannot). This overrides `ast.ts`'s stale "2 or 3 args" header note, corrected at
  this review — that note predates D-029 and was never implemented.
- **`AND`/`OR` are `AT_LEAST(1)`.** Cycle 0034's call, confirmed: it matches Excel (D-030's
  tie-breaker), a one-argument boolean combinator is harmless (`AND(x)` is `x`), and nothing
  depends on the stricter reading. Cheap to narrow later if a real reason appears.

This binds `checkArity`'s inputs only — D-029 still forbids all three from having an eager
implementation, and `eval.ts` MUST check arity itself before evaluating either branch.

---

## D-036 — Range EVALUATION belongs to the table primitive's cycle, not to `formula/eval.ts` standalone; Phase 1's gate passes without it
Ruled: entry 0037-REVIEW-phase1 (reviewer)   Binding on: `formula/eval.ts`, `mutation.ts`,
`primitives/table.ts`, and the Phase 2 cycle that wires the formula engine into cell slots

Cycle 0036 made `evaluate` return a disclosed, temporary `#PARSE` for a `RangeNode` and asked
whether Phase 1 can be claimed complete with that gap. **It can, and the deferral is correct** —
not merely tolerated:

- §5.4 (the brief's own words): "A range whose endpoint was deleted **clamps to the remaining
  extent**; a range deleted entirely becomes `#REF`." Clamping is a function of the table's CURRENT
  dimensions. A table-blind evaluator cannot do it, so a `formula/*`-standalone implementation
  would necessarily be one that has to be replaced, not extended.
- §5.3 puts expansion "at edge-derivation time (step 3 of the mutation loop)", not in the
  evaluator's own walk.
- `address.ts`'s cell form is `/^[A-Z]+[0-9]+$/` — multi-letter columns are already legal, so
  enumerating `A1:AB4` needs real bijective base-26 arithmetic. That helper belongs beside the
  table primitive (§5.4) or in `address.ts`, where its own tests live — never invented inside
  `eval.ts`.
- Phase 2's own acceptance criterion already demands the missing proof: "`SUM(A1:A5)` recomputes
  correctly after inserting a row inside the range."

**Phase 1's "ranges in aggregates" clause is therefore satisfied at the parse level (entry 0031)
and the dependency level (entry 0033), and its EVALUATION half is carried into Phase 2's gate.**
This is a carve-out with a named home, not a waiver: Phase 2 cannot close without it.

Binding on whoever implements it:

1. **`evaluate` expands the range itself, through its `read` callback**, over addresses enumerated
   from the endpoint pair — NOT a pre-flattening pass that rewrites the AST before evaluation. A
   pre-pass would be a second walk that has to know the grammar, which is Rule 4's "do not write a
   second evaluator" reached by a side door.
2. **The enumeration/clamping helper lives with the table primitive or `address.ts`**, is tested
   there, and is imported by `eval.ts` — the same posture `bareCellAddress` already established.
3. **`evaluateRangeNode` is DELETED when that lands, never extended.**
4. **Until it lands, a formula containing a range must not be storable.** The wiring cycle either
   implements range evaluation in the same cycle, or keeps rejecting range-containing formulas at
   authoring time. A cell that accepts `= SUM(A1:A5)` and then displays `#PARSE` forever is the
   one outcome this ruling forbids: it looks like a working feature and is not.
5. The same cycle owns 0035-REVIEW's Finding 4 (`MIN`/`MAX`'s `Math.min(...)` spread), because it
   is the cycle that first makes an aggregate's argument list arbitrarily long.

---

## D-037 — `%` takes the DIVISOR's sign (Excel's `MOD`); comparisons stay same-type-only
Ruled: entry 0037-REVIEW-phase1 (reviewer)   Binding on: `formula/eval.ts` and any later evaluator

Two §5.3 semantic gaps, settled together because both were reached in cycle 0036 and one of them
was taken silently.

**1. `%` is floored modulo, not JavaScript's remainder.** §5.3 lists `%` in the `* / %` precedence
tier and never defines its sign behaviour. Cycle 0036 used the bare JS operator — so `-5 % 3` was
`-2` — without listing it as a decision. **D-030's standing tie-breaker applies: a formula-language
gap §5.3 leaves open is settled by Excel**, and `MOD(-5, 3)` is `1`. It is also the behaviour the
wrapping cases a canvas actually has (an angle, a grid index, a colour cycle) need. Implemented at
this review as `((l % r) + r) % r`, which matches Excel including a negative divisor
(`5 % -3` is `-1`), and still routes through `finiteResult` so an exact zero is `+0` (D-033).

Note for the next gap of this kind: an operator semantic that the brief does not state is a
decision, and belongs in the entry's "Decisions I made" section even when the implementation is
one JavaScript operator. Reaching for the host language's default IS a choice.

**2. Comparisons (`= <> < > <= >=`) require both operands to be the SAME primitive type; a
cross-type comparison is `#TYPE`.** Cycle 0036's Decision 3, disclosed and asked about —
**confirmed**. The alternative (`=`/`<>` returning `false` across types while the orderings stay
strict) was considered and rejected: a silent `false` when a cell holds the string `"5"` and the
formula compares it to `5` hides exactly the type confusion this project surfaces everywhere else,
and Excel's own cross-type ordering (number < text < boolean) is an arbitrary rule nobody
remembers. Strictness is additively widenable — every formula this build accepts stays valid if a
future cycle widens it — while the reverse is not.

---

## D-038 — A formula that cannot be valid is REFUSED when it is entered (Q-010 answered by the human: option (b))
Answers: Q-010   Ruled: entry 0038-RULINGS (human, 2026-08-23)   Binding on: `formula/parser.ts`,
`mutation.ts`, and every future authoring path

Anything decidable from the formula text alone, with no values read, fails at entry rather than
becoming a stored error value. `parseFormula` therefore rejects, alongside the unresolvable
reference and the misplaced range it already rejects:

- an **unknown function name** (`getFunctionEntry` returns `undefined`), and
- a **wrong argument count** for a known one (`checkArity` fails).

**The human's condition, and it is binding: this must not foreclose autocomplete or
did-you-mean matching in the formula/text entry later.** Concretely, on the cycle that implements
this:

1. Validation runs when a formula is **committed**, never per keystroke. Nothing here may end up
   on the typing path.
2. The rejection carries the **offending name and its position** in the `#PARSE` error, not just a
   message — a later suggestion pass needs both, and retrofitting positions is the expensive kind
   of change.
3. `FUNCTION_REGISTRY` stays **enumerable by name** (`Object.keys`). Nothing may make the name set
   private, computed, or scattered — that list is the future autocomplete's source.
4. A rejected formula's **source text is never discarded** by the layer that rejects it; the caller
   keeps it so it can be edited rather than retyped.

`formula/eval.ts`'s own "unknown function" / "wrong arity" branches STAY as written. They stop
being reachable from typed input and become the defensive arms for an AST arriving from a loaded
file (D-031's world) — which is exactly what they should be.

Reconciliation required: `parser.test.ts`'s "parses an unrecognised function name successfully"
inverts, and gains an arity case. Pre-authorised at 0037-REVIEW — it is not a §6.1 trigger 5
escalation. `eval.test.ts`'s two tests stay, re-described as defensive.

---

## D-039 — Lowercase cell references are ACCEPTED and normalised to uppercase (Q-004 answered by the human: option (b))
Answers: Q-004   Ruled: entry 0038-RULINGS (human, 2026-08-23)   Binding on: `address.ts`,
`formula/parser.ts`

`a1`, `A1`, and `a1` written as a bare ref inside a table cell formula all mean the same cell.
Both spellings are accepted; **exactly one form is ever stored, and it is uppercase.**

- The A1 form test widens to `/^[A-Za-z]+[0-9]+$/`. D-008 is unchanged in principle — the mapping
  still keys on the segment's FORM, never a structural proxy; only the form widens.
- **Normalisation happens at exactly ONE point**, where the stored path is built (`toStoredPath` /
  `bareCellAddress`), not at each call site. D-008's own rationale names the bug this prevents:
  accepting both cases without normalising gives two stored slots for one cell — two sources of
  truth, which §5.1 does not tolerate. That is the failure this ruling exists to make impossible,
  so the test that matters is not "lowercase is accepted" but **"both spellings produce the
  identical stored `Address`."**
- The displayed form is uppercase. The tool keeps no memory of which case was typed; there is
  nothing to round-trip.

Reconciliation required: remove the `PROVISIONAL`/pending-Q-004 note on `address.ts`'s
`CELL_REFERENCE_PATTERN`; invert `address.test.ts`'s "does not map a lowercase cell ref, pending
Q-004"; `parser.ts` inherits the widened predicate rather than making a second decision.

---

## D-040 — An explicit write to a formula slot REPLACES the formula (Q-002 answered by the human: option (b))
Answers: Q-002   Ruled: entry 0038-RULINGS (human, 2026-08-23)   Binding on: the `set` command
path, `mutation.ts`

`set polygon_1.radius 42` on a slot currently driven by a formula succeeds: the formula is
discarded and the slot becomes a literal holding what was typed. The reviewer recommended
refusing; **the human overruled, and the reasoning is recorded because it generalises**: this is a
tool with one user, who is the same person who wrote the formula. An explicit typed command is an
explicit statement of intent, and a tool that argues with its operator about their own work is
worse than one that does what it was told.

Bounds, so this does not spread further than it was ruled:

1. **Not silent.** The command reports what it replaced (the formula's source text), so the change
   is visible even though it is allowed. Rule 2's transactional shape is unchanged — it is one
   mutation, and edge re-derivation rebuilds the edge set from scratch as it already does, so the
   formula's inbound edges disappear with it and no special handling exists or is needed.
2. **Dragging is NOT covered.** §5.9's partial-binding behaviour stands exactly as the brief
   specifies it: a drag slides the free axis and reports what drives the other. A drag is a
   continuous gesture, not a statement of intent, and the brief is explicit there — this ruling
   settles the `set` path only.
3. **A DERIVED slot is still rejected.** Derived slots are computed by their object's schema
   (Rule 6); nothing about this ruling reopens that.

---

## D-041 — `unlink` keeps whatever value was last displayed, errors included (Q-001 answered by the human: option (a))
Answers: Q-001   Ruled: entry 0038-RULINGS (human, 2026-08-23)   Binding on: the `unlink` command
path

The value on screen is the value kept. No substitution of a schema default, no rejection when the
formula was currently erroring — an `ErrorValue` in the graph is already legitimate state (§5.1),
so freezing one into a literal is legal, and it is the least surprising outcome: what was there
stays there.

This is safe specifically because of D-040: an unlinked error is a frozen error, and the operator
can now simply type over it. Ruled together, the two make "get me out of this formula" a
one-command operation in every case.

---

## D-042 — This is a TOOL with exactly one user; do not argue from product reasoning
Ruled: entry 0038-RULINGS (human, 2026-08-23)   Binding on: every entry, decision, comment, and
review from here on

There is no product, no user base, no customer. There is one operator, who is also the person the
brief was written by. Justify a design choice by whether it is correct, whether it is the simplest
thing that works (Rule 5), and how cheap it is to change later (§9's tie-breakers) — never by
"users will expect", "this is what users do", or any appeal to a market that does not exist.

The practical effect: an argument that reduces to "a user might be confused" carries no weight. An
argument that reduces to "this silently produces the wrong number" carries all of it. Where the
brief itself uses spreadsheet convention as a tie-breaker (D-030, Excel), that stands — it is a
concrete reference, not a claim about an audience.

Past entries keep their wording; the log is append-only and is not rewritten for style.

---

## D-043 — Exactly ONE spelling of a cell reference exists; the form itself enforces it
Ruled: entry 0041-REVIEW-phase2 (reviewer)   Binding on: `address.ts`, and every consumer of the
A1 form

D-039 settled case. Cycle 0039 implemented it correctly for the shorthand path and left the same
hazard open in two other places, both confirmed by probe before this ruling:

```
table_x.a1        -> path ["cells","A1"]     table_x.cells.a1  -> path ["cells","a1"]
table_x.A7        -> path ["cells","A7"]     table_x.A007      -> path ["cells","A007"]
```

Two stored slots for one cell, twice — D-008's original two-slots-for-one-cell hazard, reached
from the written-out stored form and from leading zeros instead of from case. The ruling is the
general form of D-039, and it is enforced by the FORM, not by callers:

1. **The row part is `[1-9][0-9]*`.** `A007` and `A0` are not cell references at all: no leading
   zeros, and no row `0`, which A1 notation does not have. They resolve as ordinary path segments
   naming no slot, so they fail instead of quietly becoming a phantom second cell. Accepting
   `A007` as a synonym for `A7` later is purely additive; splitting one cell into two is not.
2. **EVERY path that builds a stored cell path normalises** — including the already-written
   `table_x.cells.a1`, which `toStoredPath` previously passed through untouched.
3. **One regex is the definition of the form.** `parseCellReference` `exec`s the same
   `CELL_REFERENCE_PATTERN` that `isCellReferenceForm` tests, rather than keeping a second,
   near-identical copy — the two had already drifted (the copy's row part was `[0-9]+`, so it
   split `A007` into row 7 while the stored path kept `A007`, and an enumerated path would never
   have matched the stored slot).

The general rule, which is the part worth carrying: **when a ruling says "exactly one spelling is
ever stored", the test is not "the new spelling is accepted" — it is that every route into the
stored form lands on the same string.** Enumerate the routes; there were three here, and the
cycle found one.

Fixed at this review, with four regression tests including one asserting `parseCellReference` and
`isCellReferenceForm` agree on every shape.

---

## D-044 — Range expansion is BOUNDED by the table's current dimensions at the moment it expands
Answers: 0040's reviewer question 1   Ruled: entry 0041-REVIEW-phase2 (reviewer)   Binding on:
`primitives/table.ts`, `mutation.ts`'s `deriveEdges`, `formula/eval.ts`

Cycle 0040's `enumerateRangeCellPaths` deliberately does not bounds-check, on the reasoning that a
`read` miss already becomes `#REF` at the consumer. That is right for a single reference and wrong
for a range, for one hard reason and one soft one:

- **Hard: dangling edges.** §5.3 puts expansion in edge derivation, and an unbounded expansion
  makes `deriveEdges` produce edges pointing at slots that do not exist. "No dangling edges" is an
  invariant, not a preference (§5.1.1: reject or repair, there is no third option), and a
  read-miss at evaluation time cannot repair an edge that was already built.
- **Soft, but the brief's own words:** §5.3 — "Expansion is therefore always re-derived from
  **current table dimensions** and can never go stale." The dimensions are named as an input to
  expansion, not as something a later stage compensates for. §5.4's "a range whose endpoint was
  deleted **clamps to the remaining extent**" is the same idea from the deletion side.

Ruling, for the cycle that wires this up:

1. `enumerateRangeCellPaths` takes the table's current extent (a row/column count, or an
   equivalent cell-exists predicate) and emits only cells that exist. It is not wired as it stands.
2. Cells outside the extent are **omitted, not `#REF`** — `SUM(A1:A100)` over an 8-row table sums
   the rows that exist. If the clamped rectangle is empty, the aggregate simply receives zero
   arguments, which `checkArity` and `functions.ts`'s existing zero-argument behaviour already
   decide (D-035). Do not invent a new error path for it.
3. Bounding at the source also removes a resource hazard the current shape has: `A1:ZZ999999`
   enumerates millions of paths before anything downstream can object. This is the same cycle that
   owns `MIN`/`MAX`'s spread (D-036 constraint 5) — the two are one problem seen twice.

Nothing consumes the function today, so this costs a signature change and no migration.

---

## D-045 — A range whose endpoints name different objects is rejected at PARSE time
Answers: 0040's reviewer question 2   Ruled: entry 0041-REVIEW-phase2 (reviewer)   Binding on:
`formula/parser.ts`, `primitives/table.ts`

`SUM(table_x.A1:table_y.B4)` currently parses — cycle 0040 found this while designing the
enumerator and correctly rejected it there rather than silently enumerating a nonsensical
rectangle. The enumeration-layer rejection is right and stays. It is not the right PLACE for the
only check, though: **which objects two endpoints name is decidable from the formula text alone,
with no values read, so it belongs at entry** — D-038's line exactly, and `parser.ts` already
rejects a misplaced range two lines away from where this check goes.

So: `validateRangePlacement` (or its neighbour) also rejects a cross-object range, `#PARSE`, with
the same position-carrying shape D-038 established. `enumerateRangeCellPaths`'s own check stays as
the defensive arm for a hand-built or loaded AST — the same relationship `formula/eval.ts`'s
unknown-function branch now has to `parser.ts`'s (D-038).

Rationale beyond consistency: a range is the one construct where the brief's model (§5.4, "a
self-contained grid... not regions of one giant sheet") makes a cross-object span meaningless
rather than merely unusual, and an error the operator sees while typing is worth more than one
that surfaces as `#REF` in a cell later.

---

## D-046 — A slot that SIZES a dynamic slot family must be `literal`; the slot set may never depend on an evaluated value
Answers: 0042's reviewer question 2 (the sharp half)   Ruled: entry 0043-REVIEW-phase2 (reviewer)
Binding on: `primitives/table.ts`, `primitives/schema.ts`, and every future `dynamic`
`NonDerivedSlotPathGroup`

**Ruling.** Any slot whose value determines the MEMBERSHIP of a dynamic slot family — today
`table`'s `rows`/`cols`, tomorrow whatever sizes `script.in.*` or an editable path's vertex list —
MUST be read as `literal`-kind only. A `formula` or `derived` slot at such a path reads as its
fail-closed empty value (`0` for a dimension), never its cached `value`. A `dynamic`
`enumerate`/`resolve` function MUST NOT let an evaluated value size the set it returns.

**Rationale — this is Rule 6, not a style preference.** Rule 6: "Evaluation never creates or
destroys slots. Only mutations change which slots exist," and the brief names *table resizing* as
one of the two specifications "shaped specifically to preserve it." A `formula` slot's `value` is
written at §5.1 **step 7 (Evaluate)** — after **step 3 (derive edges)** and **step 4 (validate
integrity)** have already run, and nothing re-validates afterwards. So a formula-valued dimension
makes the declared family a function of an evaluated value, with two demonstrated consequences
(both reproduced against cycle 0042's code before the guard landed, both now pinned by tests in
`mutation.test.ts`):

1. **Evaluation resizes the slot set.** A table with a formula `rows` cached at 1 declared
   `[cells.A1]`; one unrelated mutation later, evaluation wrote `rows = 3` and the same table
   declared `[cells.A1, cells.A2, cells.A3]`. No mutation touched the table.
2. **`mutate` committed a document that its own `validateIntegrity` rejects.** With `rows` cached
   at 3 and a formula `cells.A3`, the mutation passed steps 3–5, evaluation shrank `rows` to 1,
   and `mutate` returned `ok: true` — after which re-deriving and re-validating the *committed*
   state failed with `table_x.cells.A3 is a "formula" slot that object type "table"'s schema does
   not declare (D-017)`. Committed state must always be valid on its own terms; a mutation the
   user never made would have been blamed for it.

**Why fail-closed to `0` rather than a new rejection check.** It reuses the answer
`readTableDimension` already gives a malformed dimension, and it lands somewhere loud: zero
declared cells means D-017's existing check rejects any formula/derived cell the object actually
carries. The dangerous half is refused; the harmless half (a stray *literal* cell) is orphaned,
which is the already-disclosed known problem, not a new one.

**Scope — what this does NOT rule.** Dimensions stay ORDINARY SLOTS at
`TABLE_ROWS_PATH`/`TABLE_COLS_PATH` (0042 Decision 1 upheld — see 0043-REVIEW §7 Q2). This ruling
constrains their KIND, not their home. A future `GraphObject`-structural home would preserve Rule 6
by construction and remains open; it is not required, and moving them is not this ruling.

Reconciliation required: none — no `PROVISIONAL` tag. The guard and its two regression tests
landed with this ruling at 0043-REVIEW.

---

## D-047 — An EMPTY cell inside a range is skipped, not an error; a range never makes a document invalid
Answers: the gap found at 0045-REVIEW (no `Q-NNN` was raised)   Ruled: entry 0045-REVIEW-phase2 (reviewer)
Binding on: `mutation.ts`'s `deriveEdges`, `graph/eval.ts`'s `readRange`, and every future range consumer

**Ruling.** A cell address produced by `enumerateRangeCellAddresses` that has **no slot on the
object** is SKIPPED — by edge derivation and by evaluation alike:

1. `deriveEdges` MUST NOT emit an edge for an enumerated range cell that does not exist as a slot.
   A range is bounded by the table's extent (D-044), and within that extent an unpopulated cell is
   ordinary, expected state — not a dangling reference.
2. `readRange` MUST omit a cell with no slot from the `Value[]` it returns, rather than returning
   `#REF` for the whole range.
3. A cell that EXISTS holding `null` is likewise omitted from a range's `Value[]`. Both
   representations of "empty" must behave identically, because which one a table uses is decided
   by the still-unbuilt creation/resize cycle and no aggregate may depend on that choice.
4. This applies to range expansion ONLY. An explicit scalar argument is untouched: `SUM(a, b)`
   where `b` is `null` remains `#TYPE`, and a plain `ReferenceNode` to a non-existent slot remains
   a dangling reference that `validateIntegrity` rejects. The distinction is that a range names a
   REGION, whose membership the system computed, while a reference names ONE slot the user wrote.

**Rationale — the current behaviour makes the phase gate unreachable.** Verified against entry
0044's code at 0045-REVIEW:

- A 5×1 table with `A1`, `A2`, `A5` populated and `B1 = SUM(A1:A5)` is REJECTED outright:
  `deriveEdges` emits edges from the absent `A3`/`A4`, and `validateIntegrity` reports
  `table_x.B1 references a slot that does not exist` — twice. The document cannot be committed at
  all.
- The same table with `A3`/`A4` present holding `null` commits, and `SUM` returns
  `#TYPE: SUM: argument 3 must be a number, got null`.

So no representation of an empty cell works inside an aggregate. Phase 2's acceptance criterion
requires "`SUM(A1:A5)` recomputes correctly **after inserting a row inside the range**" — and
inserting a row inside a range necessarily creates an empty cell inside it. Under the behaviour
above, that insertion makes the document invalid. The criterion cannot be satisfied without this
ruling, which is why it is settled here rather than deferred to the resize cycle that would trip
over it.

Skipping is also the spreadsheet idiom the brief already appeals to elsewhere (§5.4 invokes
"`#REF` is the expected spreadsheet idiom" for the repair path); every mainstream spreadsheet
ignores empty cells in `SUM`/`MIN`/`MAX`, and `AVG` divides by the count of non-empty cells, which
falls out for free once the empties never enter the argument list.

**What this does NOT change.** D-044's bounding stays exactly as built (out-of-extent cells are
omitted before this rule is ever consulted). The fallback-to-one-edge-from-`start` for an
UNRESOLVABLE TABLE (entry 0044 Decision 3) stays — that is a different case, correctly rejected,
and it is what keeps `delete <table>` refused while a range still names the table.

Reconciliation required: no `PROVISIONAL` tag. Fix list at 0045-REVIEW §8, items 1–3.

---

## D-048 — `findIllegalOperationPayloads` walks a payload's stored AST, the same as `findIllegalSlotValues`
Answers: entry 0044's reviewer question 1   Ruled: entry 0045-REVIEW-phase2 (reviewer)
Binding on: `mutation.ts`

**Ruling.** `findIllegalOperationPayloads` MUST walk a `setSlot`/`createObject` payload's
`formula`-kind slot AST for an illegal `LiteralNode`, reusing the same `collectIllegalAstLiterals`
D-031 added to `findIllegalSlotValues`. The two checks answer the same question at two moments and
must not disagree about what is legal.

**Rationale.** Entry 0044 declined this on the reading that D-031's binding text names only the
post-fold check. That reading is correct and the disclosure was the right call — but the
implementer's own stated reason for worrying is the stronger argument: D-025/Q-008's history is
*the same defect found four times* (slot values → journal payloads → camera/`nextObjectId` →
stored ASTs), and the payload-level hole is a real fifth instance now that a range-containing
formula is storable. An illegal literal inside a `setSlot` payload's AST that a LATER operation in
the SAME batch overwrites or deletes never reaches `findIllegalSlotValues` at all, yet the journal
records every operation in the batch — the exact shape 0025-REVIEW-phase0 finding 1 closed for
plain slot values. D-031 did not ask for it only because D-031 was written before stored ASTs
could carry a literal.

Reconciliation required: none. Fix list at 0045-REVIEW §8, item 4.

---

## D-049 — A mutation that REBUILDS an object's `slots` MUST carry through every slot it does not itself own
Answers: entry 0047's reviewer question 2 (in part)   Ruled: entry 0048-REVIEW-phase2 (reviewer)
Binding on: `mutation.ts`, `primitives/*`, every future slot-set-changing mutation

**Ruling.** A mutation that produces a new `slots` record for an object MUST start from that
object's EXISTING slots and change only the slots its own specification names. It MUST NEVER build
a fresh record from the slots it happens to know about — every slot it does not recognise is
carried through untouched. A slot may only disappear from an object as the EXPLICIT, specified
effect of the mutation, and when it does, §5.1.1 applies to it in full (reject, or repair; never
silently).

**Rationale.** `insertTableLine` (entry 0047) rebuilt `slots` from exactly three sources — `rows`,
`cols`, and the cell paths `enumerateTableCellSlotPaths` currently declares — and therefore
silently DELETED everything else on the object. Three reachable instances, all verified against the
built code at review:

- A literal slot at any other path (`table_x.note`, committable today: D-017's check only rejects
  UNDECLARED `formula`/`derived` slots, so an undeclared LITERAL commits `ok: true`) vanishes on the
  next row insert.
- A cell slot OUTSIDE the current extent (`cells.A5` on a 2×2 table — the incoherence STATUS.md has
  carried as a known problem since 0043) vanishes on the next row insert.
- A table whose `rows` is a `formula` slot and which holds literal cells (also committable today)
  loses ALL its cells AND has `rows` reset to `literal 1`, committing `ok: true`.

Where the dropped slot had a dependent, the mutation instead fails with `"value_1.value references
a slot that does not exist"` — state is protected (the §5.1.1 invariant holds), but the user
inserted a row and was told their formula is broken, which is a diagnosis of the wrong event.

The forward hazard is the decisive one: §5.10's own command line is `table x=0 y=0 rows=8 cols=8`,
so Phase 3 gives tables `origin.x`/`origin.y` slots. Under the rebuild-from-scratch shape, the
first row insertion after that lands would silently delete a table's position. A mutation must be
correct against slots that do not exist yet — that is the whole reason this is a rule and not a
bug fix.

Reconciliation required: fix list at 0048-REVIEW-phase2 §8, item 1.

## D-050 — A precondition check that consults document state MUST simulate the batch, left to right
Answers: entry 0047's reviewer question 2   Ruled: entry 0048-REVIEW-phase2 (reviewer)
Binding on: `mutation.ts`

**Ruling.** Any pre-fold check in `mutate` that decides an operation's legality by reading document
state MUST evaluate that operation against the state as of ITS OWN position in the batch — the
pre-batch state plus every earlier operation's effect — exactly as the existence check already does
with its `survivingIds` simulation. Checking every operation against PRE-BATCH state is not
permitted, in either direction: it both misses illegal operations and rejects legal ones.

**Rationale.** `findInvalidTableResizes` (entry 0047) validates every `insertTableLine` against
pre-batch `objects`. The entry disclosed the resulting FALSE-ACCEPT (a table `createObject`d earlier
in the same batch is not validated at all) and argued it was tolerable because `insertTableLine`'s
clamp keeps the document sound. It did not disclose the FALSE-REJECT, verified at review:
`mutate(table_2x2, [insert row at 1, insert row at 4])` fails with *"row insertion index 4 is out of
range for table_x (currently 2 rows; must be an integer from 1 to 3)"* — a message that is wrong on
its own terms, since by the time operation 2 applies the table genuinely has 3 rows. "Insert three
rows at the end" is an ordinary command-line batch (§5.1 requires batching and names multi-step
commands as a caller), so this is normal use, not a corner.

A clamp can rescue a false-accept; nothing rescues a false-reject, because the mutation never runs.
That asymmetry is why the disclosed-gap argument does not carry here, and why one simulation loop —
the pattern `mutate` already established — replaces both halves of the problem at once.

Reconciliation required: fix list at 0048-REVIEW-phase2 §8, item 2.

## D-051 — Row/column INSERTION and DELETION are separate `Operation` kinds; one axis discriminant each
Answers: entry 0047's reviewer question 1   Ruled: entry 0048-REVIEW-phase2 (reviewer)
Binding on: `mutation.ts`, `primitives/table.ts`

**Ruling.** `InsertTableLineOperation`'s shape is CONFIRMED as built: one operation kind carrying
`axis: "row" | "column"`, not two kinds. Deletion gets its OWN operation kind, with its own
precondition check and its own apply branch — NEVER this one with a negative index, a `count`, or a
`remove` flag. The row/column shift arithmetic stays in exactly one function
(`primitives/table.ts`'s `shiftCoordinates`); deletion's own arithmetic joins it in that file, and
neither the cell-slot move nor the formula-reference move may compute a position anywhere else.

**Rationale.** Row and column insertion are the same operation over a transposed grid — the
arithmetic already takes `axis` as a parameter — so splitting them would duplicate every check and
every apply branch to express nothing. Insert versus delete is the opposite case: insertion cannot
orphan a reference and deletion can, which is precisely why §5.1.1 has a REPAIR path at all.
Unifying them would put REPAIR logic behind a flag insertion can never take, and the resulting
single branch would be the one place where "did the user mean to break someone's formula" is
decided by an `if` rather than by which operation they issued.

Reconciliation required: none. Guidance for the deletion cycle, not a change to built code.

## D-052 — Every total walk over `FormulaAst` lives in `formula/deps.ts`, beside the walk that already exists
Answers: entry 0047's reviewer question 3   Ruled: entry 0048-REVIEW-phase2 (reviewer)
Binding on: `formula/deps.ts`, and any future AST-walking code

**Ruling.** `rewriteAddressesInAst` STAYS in `formula/deps.ts`. Any further total walk over
`FormulaAst`'s node shapes — including §5.1.1's `#REF` repair pass for row/column deletion — is
added to this same file, next to `extractDependencies` and `rewriteAddressesInAst`, never to a new
module and never inline at a call site.

**Rationale.** The thing being reused is the exhaustive switch over the seven node shapes, not any
dependency-specific logic. The failure this file exists to prevent is a walk that silently misses a
node type; keeping every walk adjacent means adding an eighth `FormulaAst` variant breaks all of
them in one file, in one compile, rather than one of them somewhere else at runtime. The
implementer's worry — that a MUTATION-time transform is misfiled among pure queries — is real, but
it is answered by the file header naming REWRITING as its own distinct concern, which entry 0047
already did.

**Forward note for the deletion cycle, binding as guidance.** `rewriteAddressesInAst`'s
`(Address) => Address` signature CANNOT express deletion's repair: turning a `ReferenceNode` into an
`ErrorNode` (D-028) is a NODE-level replacement, and clamping a range endpoint needs both endpoints
together, which an address-at-a-time callback never sees. Deletion therefore needs a second,
node-level walk in this file (e.g. one applied at `reference`/`range` nodes returning a
`FormulaAst`), NOT a widened `rewrite` callback bolted onto this one. Discover that at design time,
not after the address-level version has been forced halfway.

Reconciliation required: none.

## D-053 — A resize precondition MUST find the table's WHOLE extent readable, not just the axis it changes
Answers: —   Ruled: entry 0051-REVIEW-phase2 (reviewer)
Binding on: `mutation.ts`, `primitives/table.ts`, every future resize-like operation

**Ruling.** `findInvalidTableResizes` MUST reject an `insertTableLine` or `deleteTableLine` when
EITHER `rows` or `cols` is present and not `literal` — never only the dimension named by
`operation.axis`. A table whose extent cannot be fully read cannot be coherently resized on any
axis. The rejection message names the offending dimension and D-046, the same way every other
rejection in that function names its reason.

**Rationale.** 0048-REVIEW-phase2's fix 3 was written as "an insert into a table whose `rows`/`cols`
is not `literal`" and entry 0049's own decision 1 read it correctly, in detail, and said so. The
code did not follow: `isTableDimensionResizable(object, axis)` reads one slot and the check consults
one flag. Verified against the built code at entry 0051-REVIEW-phase2 §4, on a table with
`rows: literal 3` and `cols: formula`:

```
mutate([value_1, table_x], [insertTableLine table_x row 1]) → ok: true,
    cols slot after: {"kind":"literal","value":0}
mutate([value_1, table_x], [deleteTableLine table_x row 1]) → ok: true,
    cols slot after: {"kind":"literal","value":0}
```

Both primitives re-assert `literal` on BOTH dimensions on every call — they must, since the
untouched axis's count still has to be written back — and `getTableDimensions` reads a non-`literal`
dimension as a fail-safe `0` (D-046). So a ROW resize silently destroys a `formula`-kind `cols`
slot: its AST, its cached value, and its inbound edge, committing `ok: true` with nothing reported.
That is D-049's own prohibition ("a slot may only disappear as the EXPLICIT, specified effect of the
mutation") reached from the axis nobody was looking at.

**Companion ruling — the repair pass and the slot walk MUST keep IDENTICAL bounds.** The address
repair (`repairCellAddressForDelete`, `shiftCellAddressForInsert`) is unbounded; the slot walk
(`insertTableLine`/`deleteTableLine` via `enumerateTableCellSlotPaths`) is bounded by the current
extent. Where a cell slot exists OUTSIDE the extent, the reference moves and the slot does not,
which on the delete side produces a REJECTED row deletion — contradicting §5.4's "it proceeds even
when other objects depend on the deleted cells" (verified, entry 0051-REVIEW-phase2 §5). Neither
side may be bounded or unbounded on its own: insertion and deletion MUST diverge identically until
the dimension/cell coherence gap is closed for both at once, in its own slice. A one-sided fix is
forbidden.

Reconciliation required: fix list at 0051-REVIEW-phase2 §8, items 1 and 2.

## D-054 — Row/column DELETION does not clamp an out-of-range index; the precondition check is its sole guard
Answers: entry 0050's reviewer question 1   Ruled: entry 0051-REVIEW-phase2 (reviewer)
Binding on: `primitives/table.ts`, `mutation.ts`

**Ruling.** `deleteTableLine` MUST NOT clamp, floor, or otherwise repair an out-of-range `index`,
and MUST NOT refuse to take a table below zero lines by silently doing nothing. Its precondition —
`index` is an integer naming an existing line as of this operation's own position in the batch — is
enforced entirely by `findInvalidTableResizes`. The asymmetry with `insertTableLine`'s clamp is
deliberate and stays documented in both functions' doc comments.

**Rationale.** Insertion's clamp has a real interpretation: an index past the end means "append."
Deletion's would have none — there is no nearest line to delete instead of a nonexistent one — so
any defensive floor would turn a precondition bug into a plausible-looking table with the wrong
number of lines, which is strictly harder to notice than a malformed one. D-045 already established
the primary-validation / defensive-arm split for range placement; this ruling records that the
defensive arm is OPTIONAL, and is only worth having where it has a meaning. Ruled so that a future
cycle does not add a "just in case" clamp for symmetry with insertion.

Reconciliation required: none. Confirms entry 0050 as built.

## D-055 — A range endpoint's role is decided by its VALUE against the other endpoint, never by its AST field; ranges are NOT normalised
Answers: entry 0050's reviewer question 2   Ruled: entry 0051-REVIEW-phase2 (reviewer)
Binding on: `primitives/table.ts`, `formula/*`, any future code walking `RangeNode` endpoints

**Ruling.** Any code that must decide which side of a range an endpoint is on MUST compare its
coordinate against the OTHER endpoint's, never assume `RangeNode.start` holds the smaller value.
`parser.ts` accepts a reversed range (`A5:A1`) as legal and stores it as written. A range MUST NOT
be normalised to `start <= end` at parse time, at storage time, or anywhere else.

**Rationale.** Three, the last decisive. (1) Rule 3's two-layer scheme makes the stored AST the
authoritative record and display the derived view — normalising would render a formula the user did
not type. (2) `enumerateRangeCellAddresses` already treats the endpoint pair as an unordered
rectangle via `Math.min`/`Math.max`, so value-based IS the established convention here; a
normalising point would be a SECOND place range semantics live, free to drift from it (D-010).
(3) Normalisation could never remove the need for value-based handling anyway: §5.11 loads
documents whose stored ASTs predate any such rule, so the value-based path would still have to
exist as the defensive arm. It is added surface, not removed surface.

`primitives/table.ts`'s `clampRangeEndpointValue` (entry 0050) is the reference implementation.

Reconciliation required: none. Confirms entry 0050 as built.

## D-056 — `rewriteObjectFormulaAddresses` and `repairObjectFormulaAddresses` stay a PAIR; whole-object repair reuses the repair one unchanged
Answers: entry 0050's reviewer question 3   Ruled: entry 0051-REVIEW-phase2 (reviewer)
Binding on: `mutation.ts`

**Ruling.** The two functions are NOT collapsed behind a shared helper. Neither is a third one
added for whole-object (`delete <table> force`) repair: that slice MUST call
`repairObjectFormulaAddresses` exactly as it stands, passing different callbacks — "does this
address name any slot on `objectId`" for a reference, "does either endpoint name it" for a range.

**Rationale.** Two functions differing only in which total walk they call is not duplication worth
abstracting; a wrapper parameterised over the walk would obscure both and buy nothing. More
importantly the question's premise — that whole-object repair needs a third near-identical function
— is wrong. `repairObjectFormulaAddresses` is already generic over its two callbacks and has no
notion of tables, axes, or indices; "deleted" means whatever the callbacks decide it means. That is
the whole point of the node-level shape D-052 called for. A third copy would be the first real
duplication in this family, arriving precisely because nobody checked whether the second one
already fit.

Reconciliation required: `STATUS.md`'s "Next slice" paragraph, which currently steers the `force`
cycle toward new callbacks in a new home — fix list at 0051-REVIEW-phase2 §8, item 4.

## D-057 — The REPAIR path MUST report every slot it broke, through ONE channel, built once
Answers: —   Ruled: entry 0051-REVIEW-phase2 (reviewer)
Binding on: `mutation.ts`, and the `force`-flag slice in particular

**Ruling.** §5.1.1 ("The command must report which slots were broken") and §5.4 ("The command
reports every slot it broke") are requirements of the repair path, not of the command line, and they
are currently unbuilt for row/column deletion. They MUST be built by the cycle that adds the `force`
flag to `DeleteObjectOperation`, and that cycle MUST build ONE reporting channel serving BOTH repair
sites — never a deletion-specific report plus a whole-object-specific one. Until then the gap is
recorded in `STATUS.md`'s known problems and in `DeleteTableLineOperation`'s own doc comment.

**Rationale.** Entry 0050 does not mention this clause anywhere: not built, not deferred, not listed
as unfinished. It is a §5.4 conformance gap rather than a false gate claim (Phase 2's acceptance
criterion in §6 does not require it, so "clause 4's DELETE half PASSING" stands), but it is exactly
the class of brief requirement that gets quietly normalised away because no test names it.

It is ruled now, rather than left to the cycle that needs it, because the shape is decided by
something that already exists: `applyOperation` returns `readonly GraphObject[]` and has no channel
for a report at all, and `mutate`'s success arm returns `{ objects, journal }`. Adding a report
means widening one of those, which is a load-bearing decision in `mutation.ts` — and the `force`
slice hits the identical requirement from §5.1.1. Deciding it while ONE repair site exists costs a
paragraph; deciding it after two exist costs a refactor of both plus whatever already consumes them.

Reconciliation required: fix list at 0051-REVIEW-phase2 §8, item 3 (record it). Build: the `force`
slice.

## D-058 — A cycle-history comment names its entry number; never a bare "this cycle"
Answers: —   Ruled: entry 0051-REVIEW-phase2 (reviewer)
Binding on: every source and test file
**SUPERSEDED BY D-060** (human, 2026-08-24) — in its FIRST half only. D-058 accepted per-cycle
history paragraphs in source and required them to be dated; D-060 removes the practice entirely.
D-058's SECOND half survives inside D-060: any comment that does date something names its entry,
never a bare "this cycle".

**Ruling.** The per-cycle history paragraphs these file headers carry are accepted practice in this
repo and stay. But every one of them, and every inline comment dating a design decision, MUST name
the entry it refers to ("entry 0050", "as of entry 0047") — NEVER a bare "this cycle" or "THIS
cycle." This binds new and edited comments. It is not a licence to sweep existing sites: leave the
older ones alone until a cycle touches that passage for another reason.

**Rationale.** "This cycle" is only unambiguous on the day it is written. 0048-REVIEW-phase2 §7 had
to hand-correct 15 comment sites attributing entry 0047's work to entry 0046; entry 0051-REVIEW
had to correct 8 more of a different shape — `mutation.ts` had reached the point where bare "THIS
cycle" meant entry 0049 in one paragraph and entry 0050 in another, in the same file. These comments
are how the next model dates a design decision, which is their only reason to exist; a comment that
cannot be dated is worse than no comment, because it reads as precise. Fixing the same class twice
by hand is the signal PROCESS_BRIEF §8 names: it becomes a ruling, not a third round of edits.

Reconciliation required: none. The 8 sites in this batch's diff were corrected at review
(0051-REVIEW-phase2 §7).

## D-059 — A repair report NEVER names a slot that is absent from the committed state
Answers: —   Ruled: entry 0054-REVIEW-phase2 (reviewer)
Binding on: `mutation.ts`'s `brokenSlots`, and every future report channel that names an `Address`

**Ruling.** `MutationResult.brokenSlots` (D-057's channel) reports only slots that still EXIST in
the state the batch actually commits. A slot broken by one operation and then removed by a LATER
operation in the SAME batch — its object force-deleted, or the slot itself deleted — is dropped
from the report, not reported. The filter runs once, in `mutate`, against the committed
`objects`, and checks the SLOT, not just the object. Any future channel that returns an `Address`
to a caller inherits this: an address a caller cannot resolve is not a report.

**Rationale.** The report exists so a user can go and fix the formulas a repair broke (§5.1.1:
"The command must report which slots were broken"; §5.4: "The command reports every slot it
broke"). A slot that no longer exists cannot be fixed, and `formatAddress` — the only sanctioned
way to display an `Address` (Rule 3) — cannot even name it: it resolves no object and returns an
`AddressError`, so the report itself would print as `#REF`.

`applyOperation`'s `deleteObject`-with-`force` branch already drops reports about the object THAT
operation deletes ("the deleted object, and any report about ITS OWN slots, leave together"). That
is right and stays; it simply cannot see the rest of the batch. Verified reachable at review
against the built code: `[deleteObject A force, deleteObject B force]` where B read A reported
`B.value` on a committed state holding no objects at all, and `[deleteTableLine table_x row 2,
deleteObject table_x force]` reported `table_x.cells.B1` the same way.

The correct place is `mutate`, for the same reason dedup lives there: only the whole-batch site
knows what the batch finally committed. Per-operation filtering cannot know it, and would have to
be repeated in every branch that can break a slot.

Reconciliation required: none — landed as a reviewer edit at 0054-REVIEW-phase2, with two tests.

## D-060 — Comments in source describe the PRESENT. They are not diaries
Answers: Q-011   Ruled: by the human directly, 2026-08-24
Binding on: every comment in every source and test file
Supersedes: **D-058**, first half (see that entry)

**Ruling.** A comment states what the code does now and why. It does not narrate how the code got
here. The one sanctioned exception: a comment may lead back to a previous decision or ruling where
that is worthwhile.

The human's own three tiers, which are the operative test:

- **Good** — states the behaviour and the reason:
  `// this function does X, Y, or Z, because A needs to read from X`
- **Okay** — the same, plus a pointer:
  `// this function does X, Y, or Z because A needs to read from X AS PER D-0XX. Change approach`
  `// only if that decision is overruled.`
- **Bad** — a diary:
  `// Cycle X, I did this. Cycle X+1 reporting in, I did this instead and updated it based on`
  `// this. Cycle X+2 reporting in, I did that but reverted this...`

Read the ranking carefully: the citation form is **Okay, not Good**. A `(D-0XX)` is a SUPPLEMENT
to a stated reason, never a SUBSTITUTE for one. A comment that cites a ruling without saying what
the code does and why sends the reader to another file to learn something the comment should have
told them.

D-058's dating requirement survives here unchanged: where a comment does date something, it names
the entry ("entry 0050"), never a bare "this cycle" or "THIS cycle".

**Rationale.** The practice D-058 preserved had been fixed by hand three times and drifted again
each time — 15 sites corrected at 0048-REVIEW, 8 more at 0051-REVIEW, and at 0055 the headers
themselves were found to be internally self-contradicting: `mutation.ts` asserted both that
`extractDependencies` did not exist yet and that the code walked it, forty lines apart. Both
statements were true when written. A header that is only correct when read start-to-finish as a
chronology has failed PROCESS_BRIEF §5's own goal, because every reader who greps or skims lands
on a statement that is false about the current code.

D-058 fixed the DATING of the practice. This removes the practice. The class of defect goes with
it, which dating could only ever slow.

Nothing is lost. The chronology has an authoritative home already, and always did: `entries/` for
what happened when, this file for every ruling, STATUS.md for where things stand. The source was a
second, unversioned, untested copy of it.

This also settles the standing tension with PROCESS_BRIEF §5.4 ("NEVER write changelog comments in
source — log entries are for that"), which had forbidden exactly this practice while D-058
permitted it in headers.

Reconciliation required: **none — already applied.** Entry 0055 rewrote all 16 source headers to
present tense before this ruling existed, and raised Q-011 rather than editing this file, correctly.
That pass is now retroactively sanctioned. The 82 `(D-NNN)` citations it left in source are the
"Okay" form and stay; a spot check found no comment that cites a ruling INSTEAD of stating its
reason.

---

## D-061 — `CameraState` is `{ x, y, zoom }`, and `camera.x`/`camera.y` is the world point at the screen's TOP-LEFT corner
Answers: Q-007   Ruled: entry 0058-REVIEW-phase3   Binding on: `render/*`, `primitives/geometry.ts`,
`command/*`, and anything else that converts between world and screen space

**Ruling.** The camera is exactly three numbers and is not widened without a fresh ruling:

- `camera.x`, `camera.y` — the WORLD-space point displayed at the screen's top-left corner
  (pixel `0,0`), **not** the viewport centre.
- `camera.zoom` — world lengths to screen pixels.
- The transform is `screen = (world - camera) * zoom`, and its inverse
  `world = screen / zoom + camera`. `render/camera.ts` owns both; nothing else re-implements them.

Q-007 asked what shape §5.11's "camera state" has. `render/camera.ts` (entry 0057) is the consumer
0025-REVIEW-phase0 required before closing it, and it needed no widening, because none of
`worldToScreen`/`screenToWorld`/`panByScreenDelta`/`zoomAtScreenPoint` needs a viewport size —
the caller supplies a screen-space point or delta per call. Every constraint 0025-REVIEW-phase0
attached is met: the shape was widened-not-replaced (in fact unchanged), it stays plain and
serializable, `document.ts` grew no second reader, and `deserializeDocument`'s rejection survives.

**Rationale for pinning the CONVENTION, not just the shape.** The shape was never the risk; the
convention is. `{ x, y, zoom }` reads identically under a centre-of-viewport reading, and a
renderer or a hit-tester written against the wrong one is off by half a viewport — a bug that looks
like a drifting camera, not like a wrong constant, and that only appears once something is actually
drawn. Top-left is chosen because it needs no viewport size to define at all, which is the property
that let the shape stay three numbers.

A future "fit to bounding box" helper DOES need a viewport size. That is an argument for passing it
per call, as every other function here does — not for storing it in `CameraState`. Widening this
shape requires a new decision that supersedes this one.

Reconciliation required: none. Q-007's `PROVISIONAL` tags were already removed at entry 0057, on
0054-REVIEW-phase2 §7's explicit instruction; that instruction is confirmed as having been correct
authority. Mark Q-007 `ANSWERED → D-061`.

---

## D-062 — A number that is LEGAL is not therefore VALID for its domain. The zoom range is `render/`'s to enforce, at the point a loaded camera enters the render layer
Ruled: entry 0058-REVIEW-phase3   Binding on: `render/*` (every consumer of a `Document`'s `camera`),
and on any future numeric field with a restricted domain

**Ruling.** `isIllegalNumber` (D-027) answers one question only: *is this a number JSON can
round-trip* — it rejects non-finite values and `-0`. It does NOT answer *is this number meaningful
for the field it sits in*. `deserializeDocument` therefore accepts `camera.zoom` of `0`, of `-5`,
and of `1e-300`; all three are legal numbers and none is a usable zoom.

So:

1. **No `render/` function may assume a `Document`'s camera is inside `[MIN_ZOOM, MAX_ZOOM]`.**
   Only a `CameraState` produced by `render/camera.ts` carries that guarantee.
2. **A loaded camera is clamped once, in `render/`, at the boundary where it enters the render
   layer** — the same shape as `finiteOrFallback`: correct it to something usable, do not throw.
   Whichever cycle first loads a document into a live canvas owns building that boundary.
3. **`document.ts` is NOT to grow a zoom-range check.** `MIN_ZOOM`/`MAX_ZOOM` are `render/`'s
   constants; Rule 1 forbids `engine/` importing `render/`, and duplicating the bounds in `engine/`
   creates two sources of truth for one range — the defect D-014's principle exists to prevent.

**Rationale.** Entry 0057's `screenToWorld` documented the opposite as a guarantee: "`camera.zoom`
is always `>= MIN_ZOOM > 0` (... `deserializeDocument` rejects a malformed camera on load), so this
never divides by zero." Probed at 0058-REVIEW-phase3, that is false — `{ x: 0, y: 0, zoom: 0 }`
loads clean and `screenToWorld` then returns `{ x: Infinity, y: Infinity }` without throwing,
because JS division does not throw. The claim is corrected in place at that review.

The failure this prevents is quiet, which is why it is ruled rather than merely fixed: hit-testing
(§5.9, "screen point → topmost object") that receives `Infinity` selects nothing, and a renderer at
`zoom: 0` collapses every object onto the origin. Both look like a broken document, not like a
camera that needed clamping — and neither raises an error anywhere.

This generalises deliberately. `nextObjectId` is the same class of field: `isIllegalNumber` lets a
non-integer or a negative `nextObjectId` load. Where a field's domain is narrower than "a legal
number," the owner of the domain enforces it, at the boundary where the value is first used.

---

## D-063 — A file header states what the file IS, never that "this cycle" built it
Ruled: entry 0060-REVIEW-phase3 (reviewer)   Binding on: every source and test file, headers and
body comments alike. Extends **D-060** rather than replacing it.

D-060 already bans the diary comment, and its examples are all about REVISION history ("cycle X I
did this; cycle X+1 reverted it"). The gap it left, found twice now, is the CREATION sentence: a
brand-new file whose header opens "This cycle builds X." That is the same defect wearing different
clothes — it is false to every reader who arrives after that cycle, which is all of them.

Ruling: a header describes the file's present contract in the present tense. **Never "this cycle",
"as of this cycle", "the <slug> cycle", or a pointer to "that file's own diff"** — in a header, a
body comment, or a test comment. Where a comment genuinely needs to date something, name the entry
by NUMBER ("entry 0059"), per D-058's surviving half. A cross-file pointer names the FILE, never
the diff that touched it: diffs are git's, entries are the log's, and a comment that points at
either as its own justification has outsourced the reason D-060 requires it to state.

Rationale: the same authoring instinct produces this every cycle — a model writing a file is
thinking about the cycle it is in, and the header is where that leaks. Entry 0059 added eight such
sites (one in NEW non-test source, `geometry.ts`'s own opening sentence) while
0058-REVIEW-phase3 Finding 2's sweep of thirteen older ones was still outstanding, which is what
makes this a recurring misunderstanding worth a ruling rather than a third round of the same code
fix. Fixed at this review in all eight.

Reconciliation required: none beyond 0058-REVIEW-phase3 Finding 2's existing sweep, which this
ruling now also governs.

---

## D-064 — Every geometry PRESET winds counterclockwise, and that is an invariant, not an accident
Ruled: entry 0060-REVIEW-phase3 (reviewer)   Binding on: `primitives/geometry.ts`, the renderer,
hit-testing, and `explode`

`computePolygonVertices` (increasing angle), `computeCircleVertices` (delegating to it), and
`computeRectVertices` (origin → +x → +x+y → +y) all produce a strictly POSITIVE doubled signed
area for every legal parameter set — verified at this review across `rotation` values of
`0, 1, -1, 2.5, π` and a degenerate zero-width rect. Counterclockwise in a y-up frame.

Ruling: this winding is a STATED invariant of the three presets. A cycle that changes a preset's
corner order or angle direction changes it deliberately, says so, and updates every consumer —
it does not get to be a silent refactor. **A pinning test is owed** (fix list item 3, entry
0060-REVIEW-phase3).

Rationale: three later consumers already depend on it without knowing they do. The renderer's fill
rule, any winding-number hit test, and `explode` — which snapshots `vertices` into literal
per-vertex slots in exactly this order, making the winding user-visible and thereafter
user-editable — all inherit it. It also bounds a claim: because no preset can wind clockwise,
`computeCentroid`'s negative-signed-area branch, and therefore `finiteOrTypeError`'s `-0` guard,
are unreachable through any preset TODAY. That guard is still correct and still required —
`verticesDerivedSlots` is explicitly a shared bundle whose contract is an arbitrary `Point[]`, and
`polyline` will hand it one — but the reachability lives in the CONTRACT, not in the current
pipeline. Entry 0059's Decision 4 got the code right and overstated the asymmetry; see
0060-REVIEW-phase3 §5.

---

## D-065 — A cycle owns every comment its own work makes false, not only the comments it writes
Ruled: entry 0062-REVIEW-phase3 (reviewer)   Binding on: every cycle. Extends **D-060**/**D-063**
rather than replacing either.

D-060 bans the diary comment. D-063 requires a header to state its own file's present contract.
Both regulate a file's description of **itself**. The gap, found four times now and twice in entry
0061's own blast radius: a comment's claim about **another** file. `main.ts` said "there is no
renderer or `command/` yet"; `primitives/geometry.ts` said "nothing consumes `style` yet (no
renderer)"; `graph/cycles.test.ts` and `graph/eval.test.ts` both said "`mutation.ts` does not exist
yet." Every one was true when written. Every one was false the moment the named file landed — and
the cycle that landed it is the only cycle in a position to notice.

**Ruling.** Before writing your log entry, grep the tree for the name of every file, subsystem, or
capability you just created, and correct every existing comment that asserts it does not exist.
**A cross-file existence claim is owned by whoever falsifies it, not by whoever wrote it** — it is
part of your slice, not a drive-by refactor, and PROCESS_BRIEF §4's "never refactor code you did
not write" does not shield it (that rule is about CODE; this is about a statement your own work
made untrue). State it in the log entry the same way you state any other file you touched.

Second half, preventive: **prefer a sentence that cannot go stale.** Say what the code here does
and why, not what elsewhere lacks. `graph/eval.test.ts`'s corrected header says these tests build
fixtures by hand "so they exercise the topological pass itself and nothing upstream of it" — a
reason that stays true forever, where "`mutation.ts` does not exist yet" was a fact with a
one-cycle shelf life. Where the absence really is the point (this file's `NOT DONE HERE` blocks),
name the file that will own it rather than asserting the world's current inventory.

**Rationale.** This is the same defect D-060 and D-063 were each ruled for, arriving from the one
direction neither covers, and it is the most harmful tier of the three: not a comment that is
merely dated, but a comment that is FALSE, sitting in a file a reader opens precisely to find out
what exists. A model orienting off `main.ts` in the next cycle would have been told the renderer
it is about to wire does not exist. The reader who skims or greps — PROCESS_BRIEF §5.2's own stated
worry — has no way to catch it.

Reconciliation required: none outstanding. All four sites above are fixed at this review. The
thirteen bare "this cycle" sites in test files (0058-REVIEW Finding 2) are a DIFFERENT class —
D-063's, still open, still blocking nothing.

---

## D-066 — An object that draws nothing is not hittable. Drawn extent and clickable extent are the same extent.
Ruled: entry 0064-REVIEW-phase3 (reviewer)   Binding on: `render/hittest.ts` and every future
per-type hit test — `table` today, `text`/`image`/`script` when their schemas land.

`render/hittest.ts`'s own file header states the principle for the types it declines to test at
all: "a click cannot land on something that is never drawn." Its `table` arm then broke it. The
bounding box is `cols * TABLE_CELL_WIDTH` by `rows * TABLE_CELL_HEIGHT` with inclusive bounds, and
`getTableDimensions` fails safe to `0` for an absent or non-`literal` dimension (D-046). A `0`-row
table therefore collapses to a LINE, not to nothing, and inclusive bounds contain every point on
it — probed at this review: a `rows: 0, cols: 3` table returns a hit at world `(120, 0)`, and an
ordinary table with no `rows`/`cols` slots at all returns a hit at world `(0, 0)`. `drawTable`
draws neither of them: both its loops run zero times.

Ruling: **a per-type hit test MUST return `false` for a degenerate extent** — zero or negative
width, height, or radius — rather than letting a containment test with inclusive bounds answer for
it. The clickable extent of an object is exactly the extent that was drawn, never a boundary case
left over from the arithmetic.

Rationale: an invisible click target is the worst failure mode this subsystem has, because there is
nothing on screen to explain it — the user clicks empty canvas, selects an object they cannot see,
and the next drag moves it. It is also silent: no rejection message, no error value, nothing in the
journal. The inclusive bounds are themselves CORRECT and stay (a real table's boundary is exactly
where its outermost cell rect is stroked); the guard is what separates "the boundary of a real box"
from "a box that is nothing but boundary."

Note the shape of the trap for the cycles that will repeat it: entry 0063's own test suite built
the empty-slots table fixture and probed it at `(9999, 9999)`, one point away from the defect. A
degenerate-extent test belongs at the ORIGIN of the degenerate box, never at a far-away point.

Reconciliation required: none outstanding — `hitTestTable`'s guard and two pinning tests were
added at this review. Binding on `text`/`image`/`script` bounding boxes before they are written.

---

## D-067 — Stroke-only hit-testing is CORRECT while no object can be filled, and the fill cycle owes point-in-polygon and D-064's winding test together.
Ruled: entry 0064-REVIEW-phase3 (reviewer)   Binding on: `render/hittest.ts`, the cycle that
declares `style` slots, and the Phase 3 gate.

§5.9 names three hit-test shapes: "Point-in-polygon for fills, distance-to-segment with pixel
tolerance for strokes and open paths, bounding box for text/tables/images/scripts." Entry 0063
built the second and third and deferred the first, on the ground that nothing can be filled yet —
`primitives/geometry.ts` declares no `style` slots and `renderer.ts` never calls `ctx.fill()`.

Ruling, three parts.

1. **The deferral is correct and is not a partial implementation of §5.9.** The clause is
   conditioned on its own subject: point-in-polygon is what you use FOR A FILL. An unfilled shape's
   interior is not part of its picture, and the behaviour that falls out — an unfilled outline is
   grabbed by its outline — is what every vector editor does. §5.9 is fully implemented for every
   visual property an object can currently hold.
2. **Phase 3's acceptance criterion may be claimed with stroke-only hit-testing.** "Create a
   polygon and a table by command, see both drawn, pan/zoom, select, and drag the polygon" does not
   require interior-click selection, and no polygon in Phase 3 has a fill to click inside of. The
   gate is not blocked on this, and the cycle that reaches it should not re-litigate the question.
3. **Point-in-polygon and D-064's winding invariant land in the same cycle** — the one that
   declares `style` slots and first calls `ctx.fill()`. A winding-number test's sign convention IS
   D-064; splitting them is what has kept the winding test unwritten across 0060, 0062, and 0063.
   (Its pinning test is no longer part of that debt — written at this review, see §6 — so what the
   fill cycle owes is the point-in-polygon test itself, against a winding it can now trust.)

Rationale: this is the third review at which a cycle has correctly declined the same work for the
same reason and has had to argue for it from scratch in its log. The argument is settled here so it
stops costing a section per cycle, and part 2 keeps a defensible deferral from silently becoming a
phase-gate dispute later. Where the human wants interior-click selection BEFORE fills exist, that
is a product change to §5.9 and belongs to them, not to an implementer reading this file — it is
not a defect to be fixed quietly.

Reconciliation required: none. The deferral stands as built.

---

## D-068 — §5.9's visual feedback is ONE cycle's work, it lives with the renderer, and `render/interaction.ts` is not its home
Ruled: entry 0067-REVIEW-phase3 (reviewer)   Binding on: `render/renderer.ts`,
`render/interaction.ts`, `main.ts`, and the cycle that first draws selection chrome

§5.9 names three pieces of visual feedback in one bullet: a **selection highlight**, an **error
badge** on objects holding `ErrorValue`s, and **a subtle indicator on slots that are formula-driven
rather than literal**. Three cycles have now deferred them — 0061 (`renderer.ts` could not read the
state), 0062-REVIEW (reassigned them to a file that did not exist), 0066 (`interaction.ts` holds the
state but draws nothing) — and each re-argued the deferral from scratch. Settled here.

**Ruling, three parts.**

1. **The three land together, in ONE cycle.** They are one implementation shape: each is a draw-time
   pass over the same object list, each needs the camera transform reset that `renderDocument`
   leaves standing, and each is a small variation on "draw chrome next to an object's extent." The
   error badge additionally needs an `ErrorValue` scan and the formula-driven indicator a slot-kind
   scan — two reads that belong beside each other. Doing one of three is how a §5.9 bullet becomes
   permanently two-thirds built.
2. **They live with the drawing, not with the state.** `render/renderer.ts` owns every `ctx` call in
   this codebase and is where they go; the cycle that builds them widens `renderDocument`'s
   arguments to carry the selection rather than moving drawing into `render/interaction.ts`.
   **`render/interaction.ts` is explicitly NOT their home** — 0062-REVIEW named it as such before it
   existed, and entry 0066 built it as a pure state machine testable without a Canvas2D fake, which
   is a property worth keeping. It holds the selection STATE; it hands that state to the renderer.
3. **The transform-reset hazard is that cycle's, or `main.ts`'s — never `interaction.ts`'s.**
   `renderDocument` returns with `ctx` holding the camera transform, so screen-space chrome drawn
   after it comes out camera-warped. Whoever first draws chrome owns the reset.

**Rationale.** This is the third ruling in this project made for the same reason (compare D-067):
a defensible deferral that has to be re-argued every cycle stops being cheap. The specific error
this one prevents is the tempting one — "interaction.ts knows what is selected, so let it draw the
highlight" — which costs that file its no-canvas-fake testability, splits Canvas2D across two
`render/` files, and delivers a third of a bullet. 0064-REVIEW §10 item 4 asserted the opposite
expectation (that the interaction cycle would need `renderer.test.ts`'s context fake); **that
expectation was wrong and is withdrawn at 0067-REVIEW §5**, which is part of why this needs to be
written down rather than left in a review's prose.

Where the human wants a selection highlight before the other two, that is theirs to direct — it is
not a gap for an implementer to close quietly against this ruling.

Reconciliation required: none. `renderer.ts`'s NOT DONE HERE and HAZARD blocks and
`interaction.ts`'s NOT DONE HERE were corrected at entries 0066 and 0067 and already say this.

---

## D-069 — `command/` resolves nothing before `commands.ts`. Grammar failures belong to the parser, identity failures to the handler
Answers: entry 0068 Decision 1 and Decision 2 (implementer asked for this one to be checked)
Ruled: entry 0069-REVIEW-phase3 (reviewer)   Binding on: every file in `command/`

`command/parser.ts` takes a line and returns a `Command`. It **takes no document, no object list,
and no `nextObjectId`**, and a `Command` carries the object names and address strings the operator
typed, **verbatim**. `parseAddress`, `checkNameAvailable`, `parseFormula`, `Operation` building and
`mutate` are all `command/commands.ts`'s.

The line between the two files is which KIND of failure is being reported:

- **Grammar — the parser's.** How many arguments, which `key=value` keys, whether a token is a
  number, whether a quote closes, whether a flag repeats.
- **Identity — the handler's.** No object of that name, a name already taken, a slot the schema
  does not declare, a value the slot may not hold.

**Rationale.** §4's own structure table already draws it: `parser.ts` is "command string -> command
object", `commands.ts` is "command handlers -> mutation API calls". Resolution is part of building
the `Operation`, which is by that table the handler's work.

§5.2's "a resolver maps name → ID **at parse time**" does **not** bind here and must stop being
read as though it does. It is a statement about **stored ASTs** — the sentence it sits in ends
"stored ASTs hold IDs, not names," and its purpose is that renaming rewrites no formulas. A command
object is transient input to resolution: never stored, never journaled, never serialized. Holding a
name in one breaks no invariant, and the moment it becomes graph state it holds an ID.

Resolving in the parser would also **split** resolution rather than centralise it, which is the
opposite of what it looks like: a creation command's fresh id and default name come from
`nextObjectId`, which lives in the document the parser would still not have — so `circle` would
resolve in one file and `link` in another.

The grammar/identity line is `address.ts`'s own (L-4, 0002-REVIEW-phase0), applied one layer out:
**one failure path per problem, owned by the file that owns the form.** A parser that re-checked
`NAME_PATTERN` or the address form would be a second definition of it, free to drift — the drift
D-043 rules against. So `set polygon_1 42` (no dot) and `rename polygon_1 3bad` (ungrammatical
name) both PARSE, and are refused once, by the file that owns that form.

Corollary, binding on `commands.ts`: it is the **only** place a `Command` meets a `Document`. A
later command file that needs resolution calls into it rather than teaching the parser about
documents.

Reconciliation required: none — entry 0068 built it this way. `command/parser.ts`'s header may cite
this ruling and drop the rationale it currently restates in full (see 0069-REVIEW fix 1).

---

## D-070 — A creation command's counts are bounded by the HANDLER, and an out-of-range count is a mutation REJECTION, not an `ErrorValue`
Answers: the carried "`sides` has no upper bound, nor `rows`/`cols`" problem (0060-, 0062-,
0064-REVIEW all deferred it: "one ruling covers all three or none")
Ruled: entry 0069-REVIEW-phase3 (reviewer)   Binding on: the cycle that builds
`command/commands.ts`'s creation handlers — the same cycle, not a later one

Entry 0068 makes `polygon sides=<n>` and `table rows=<n> cols=<n>` typeable, and the reviewer's
probe confirms the parser passes **fractional, zero and negative** counts through unchanged
(`table x=0 y=0 rows=-3 cols=0` and `polygon sides=2.5 …` both parse). That is **correct of the
parser** — D-031 clause 3 keeps document-state policy out of a text-scanning stage, and D-069 makes
it the handler's. It is not correct of the system, and the deferral expires when the handler lands,
because that is the cycle in which a typed line first builds slots.

Binding, all three counts under one rule:

1. **The check lives in the creation handler**, before any `Operation` is built. Not in the parser
   (D-069, D-031 clause 3), and not only in a derived slot.
2. **Out of range REJECTS the mutation.** It does not create the object and then let a derived slot
   hold `#TYPE`. The slot SET is what is at stake, not a slot's value: `rows=1000000` builds a
   million cell slots before anything evaluates, and Rule 6 fixes the slot set during evaluation, so
   an error value cannot stand in for "I already built them." `polygon`'s existing `#TYPE` for
   `sides < 3` (`primitives/geometry.ts`, `MIN_POLYGON_SIDES`) **stays** as the defensive arm for an
   AST arriving from a loaded file — the same shape D-038 left `eval.ts`'s branches in.
3. **The rejection names the argument and the range** (`sides must be a whole number from 3 to
   1000, got 2.5`), per §5.10's "every rejection message must name the specific slots involved."
4. **Each count is a whole number.** `Number.isInteger`, the check `geometry.ts` already applies.

**The bounds themselves are the reviewer's provisional pick and the human may overrule them**
without disturbing clauses 1–4: `sides` ∈ [3, 1000], `rows`/`cols` ∈ [1, 1000]. Declare them as
named constants beside the code that enforces them, the way `render/camera.ts` already declares
`MIN_ZOOM`/`MAX_ZOOM` for a range the brief likewise never states — that precedent is why picking a
number here is not an amendment to the design.

**Rationale.** Three reviews deferred this correctly, on the ground that nothing could reach it.
Something can now. The failure mode is not a wrong value, it is an unbounded slot allocation from
one typed line — which under Rule 5's deliberately un-optimised mutation loop (a deep clone per
mutation) is a hang with no error, the one class of failure this project's error-value idiom cannot
express. A bound picked badly costs an argument; no bound costs a wedged tool with a clean log.

---

## D-071 — A formula is authored with `set <address> = <formula source>` (Q-013 answered by the human: option (a))
Answers: Q-013   Ruled: entry 0070 (human, 2026-08-25)   Binding on: `command/parser.ts`,
`command/commands.ts`, and §5.4's formula bar when it lands

`set` writes a literal when its value is a literal and a **formula** when the value position begins
with `=`. This is the spreadsheet's own gesture and §5.4's formula bar will do the same thing, so
one spelling serves both surfaces. The provisional refusal taken at entry 0068 is lifted.

Binding on the implementation:

1. **The formula source is the RAW SUBSTRING of the line from the `=` character to the end of the
   line, verbatim** — never re-joined from tokens. Re-joining discards the operator's own spacing
   and the character offsets that `CommandParseFailure.start` and `ParseError`'s position are built
   on, and D-038 clause 4 forbids the layer that rejects a formula from discarding its source.
2. **The parser does not parse it (D-069).** `SetCommand` carries the source text; `commands.ts`
   calls `parseFormula`, which is where D-038's four conditions come due.
3. **A quoted value is never a formula.** `set text_1.content "= not a formula"` writes the string.
   Quoting decides type, as it already did.
4. **`link` and a formula-writing `set` build their slot through ONE path in `commands.ts`.**
   `link a.b c.d` is the degenerate case of `set a.b = c.d` (§5.1), and two paths writing a formula
   slot will drift on what D-040 makes them report and what D-041 leaves behind.

Reconciliation required: grep `PROVISIONAL(Q-013)` and resolve — done at entry 0070.

---

## D-072 — A command word typed alone ENTERS an AutoCAD-style prompt sequence. Every prompt accepts a typed value or a picked point
Ruled: entry 0070 (human direction, 2026-08-25)   Binding on: `command/`, `main.ts`, and every
command added from here

**The human's direction, verbatim in substance:** the command line's job is to invoke placement and
creation with minimal typing. AutoCAD's `CIRCLE` is the model — type the word, get prompted for a
centre point (pick it, or type coordinates), then for a radius (pick a point at that distance, or
type a number). That system works; build it.

This extends §5.10, which shows only complete one-line forms. It does not replace them.

### The shape

1. **`command/prompt.ts` holds a pure state machine.** It takes a command word and a stream of
   responses, and yields either the next prompt or a finished `Command`. It is the same layer as
   `parser.ts` and inherits D-069 unchanged: **no document, no canvas, no DOM, no `render/` import.**
   A pick reaches it as a WORLD point `{ x, y }`; screen-to-world is `render/camera.ts`'s and
   `main.ts` does the conversion. This is Rule 1's reasoning applied one layer out — the machine
   must be testable without a canvas fake, the property entry 0066 earned for `render/interaction.ts`
   and D-068 protects.

2. **The prompt sequence is declared in the SAME registry entry.** §5.10's "adding a command is one
   registry entry" survives this: a spec gains an optional `prompts` array, and a command with no
   `prompts` behaves exactly as it does today. There is no second registry and no dispatch switch.

3. **A line is a sequence of prompt responses.** `circle`, `circle 100,100`, and `circle 100,100 20`
   are the same command at three stages of completion — this is AutoCAD's space-is-enter behaviour
   and it makes the partial-input case fall out rather than being special-cased. The `key=value`
   form (`circle x=100 y=100 r=20`) stays as an alternative COMPLETE form, unchanged and still
   pinned by its §5.10 tests. **Both forms MUST produce the identical `Command`.**

4. **The typed point literal is `x,y`** — the brief's own syntax, taken from §5.10's
   `polyline 0,0 100,0 100,100` and `addvertex polyline_1 100,100`. It is not invented here.
   AutoCAD's relative form (`@10,10`) is NOT built: §5.10 shows none, Rule 5 governs, and adding one
   later is additive.

5. **A step may read an earlier step's answer.** `radius` is "distance from the centre you just
   gave", so a picked point at a `distance` step becomes `Math.hypot` from the point a named earlier
   step produced. This is the whole reason the machine holds gathered values rather than converting
   each response in isolation, and it is the gesture the human's direction is actually about.

6. **Empty input takes the default, and the prompt shows it** — `specify rows <8>:`, AutoCAD's own
   convention. A step with no default and no input re-prompts.

7. **Bad input re-prompts the SAME step and does not abort the command.** AutoCAD's behaviour, and
   the correct one: an operator three picks into a command must not lose them to one typo. A command
   is abandoned only by an explicit cancel.

8. **`rect` prompts for two corners**, as AutoCAD's RECTANG does, and derives
   `x = min`, `y = min`, `w = |dx|`, `h = |dy|`. The preset is corner-anchored and `#TYPE`s on a
   negative `width`/`height` (`primitives/geometry.ts`), so normalising here means a pick in any
   direction draws a rectangle instead of an error value.

### Deferred, explicitly

**Object-selection prompts** (`select`, `delete`, `refs` prompting "select an object:") are the same
machine with an `object` accept kind, and they are NOT built here: resolving a pick to an object
needs `render/hittest.ts` and a document, which is `main.ts`'s wiring cycle. Until then those
commands keep their typed-name form only. A `prompts` entry is how they will be added — one
registry entry, per clause 2.

**Rationale.** The alternative — leaving every creation command a full typed line — makes the tool
unusable for the thing it is for. A drawing tool where placing a circle means typing four numbers
you would rather point at is a spreadsheet with a canvas attached. The design cost of this ruling is
one pure module and one optional field on a registry entry; the cost of not making it is paid at
every single object the operator ever creates.

---

## D-073 — A formula's source text is NEVER subject to command-line tokenization. The command lexer stops at the `=`
Answers: 0071-REVIEW F1   Ruled: entry 0071-REVIEW-phase3 (reviewer)
Binding on: `command/parser.ts`, `command/prompt.ts`, §5.4's formula bar, and every future
surface that authors a formula from typed text

D-071 clause 1 says the formula source is "the RAW SUBSTRING of the line from the `=` character to
the end of the line, verbatim." Entry 0070 implements the slice correctly and still fails the
clause's purpose, because `parseCommand` tokenizes the WHOLE line before `matchArguments` discovers
there is a formula in it. The command lexer's quoting rules therefore run over formula text they do
not govern:

```
set a.b = CONCAT("a", "b")              REJECTED — "a quote must open an argument, not sit inside one"
set a.b = CONCAT( "a" , "b" )           ACCEPTED — the same formula, spaced differently
set a.b = IF(t.c > 1, "big", "small")   REJECTED — "a quoted argument ends at its closing quote"
set a.b = ((( not a formula             ACCEPTED — a test pins this, correctly
```

Binding:

1. **Once a `literal-or-formula` position is known to hold a formula, the rest of the line is
   opaque to the command layer.** It is not tokenized, not quote-checked, not scanned. It is
   sliced and carried.
2. **The two lexers stay separate.** §5.3's string escapes and the command line's happen to be
   spelled the same way (`scanQuoted`'s doc comment says so), and that coincidence must not be
   allowed to become a dependency: `formula/lexer.ts` owns what a quote means inside a formula,
   `tokenize` owns what it means inside an argument, and neither validates the other's text.
3. **Whether a formula is well-formed is `parseFormula`'s answer, given at `commands.ts`
   (D-069, D-071 clause 2).** The command layer may reject a formula for arity — "you typed
   nothing after the `=`" — and for nothing else. A `#PARSE` with an offset into the source is the
   only formula rejection the operator should ever see.

**Rationale.** §5.3 gives the formula language string literals and ships `CONCAT` and `LEN` in the
v1 built-ins; a formula containing one must be typeable. The failure this rules out is worse than a
plain rejection, because acceptance depends on incidental spacing around commas and parens — the
operator gets a message about command quoting, pointing into their formula, advising the quoting
that just failed. There is no rule they could learn from it.

Note what this does NOT reverse: 0069-REVIEW's F1 fix — a closing quote must be followed by
whitespace — is correct and stays. It is a rule about command ARGUMENTS. This ruling says only that
formula source is not one.

Reconciliation required: 0071-REVIEW fix-list item 1. Until it lands, a formula containing a string
literal parses only if every quoted run is surrounded by spaces.

---

## D-074 — Once a prompt sequence has begun reading a line, its own refusal IS the message. The command layer never replaces a message it has with one from a re-read
Answers: 0074-REVIEW F1   Ruled: entry 0074-REVIEW-phase3 (reviewer)
Binding on: `command/prompt.ts`, `command/commands.ts`, and every future surface that drives a
prompt sequence from typed text
Supersedes: 0071-REVIEW §4's F2 finding, in the half that ruled the "a token the sequence could
not read" branch correct as written. The overflow half of that finding stands and is implemented.

`beginCommand` walks a typed line through the prompt sequence and, when a token is refused, throws
the sequence's own reason away and re-reads the whole line with `parseCommand` instead. The
message the operator sees is therefore written by a grammar they did not use:

```
circle 100,100 abc
  the sequence said:  specify radius needs a number or a point as x,y — got "abc"
  the operator sees:  "circle" does not take the argument "100,100" — usage: circle x=<number> y=<number> r=<number>   @7

rect 0,0 junk
  the sequence said:  specify opposite corner needs a point as x,y — got "junk"
  the operator sees:  "rect" does not take the argument "0,0" — usage: rect x=<number> y=<number> w=<number> h=<number>   @5
```

Binding:

1. **A refusal raised inside the sequence is reported as the sequence raised it**, at the offset of
   the token that caused it. This covers a token the step could not read and a quoted answer alike.
2. **Deferral to `parseCommand` is only for a line the sequence never began to read**: the command
   word declares no `prompts`, or the line uses §5.10's `key=value` form. Those two checks happen
   before the first answer is applied and they stay.
3. **A message about the prompt form never cites the `key=value` usage string as though it were the
   form in play.** A prompting command has two forms and one `usage`; where the operator used the
   other one, name the step instead of the usage line.

**Rationale.** `parseCommand` cannot write a better message here, and the registry says why: all
four prompting commands declare `positional: []`, so every bare positional token on a prompting
line reads to `parseCommand` as "does not take the argument", always naming the FIRST one. 0071-REVIEW
assumed the deferral produced the better message; the evidence is that it produces, on the more
common path, the exact three faults that review named on the rarer one — a token that was read
correctly, the wrong offset, and the usage line for a form the operator did not use. This is the
third appearance of the same defect shape (0069-REVIEW F3, 0071-REVIEW F2, this), which is what
makes it a ruling rather than a third code fix. §5.10's standard is "every rejection message must
name the specific slots involved"; the layer that knows which step failed is the layer that must
speak.

**Consequence worth stating.** With clause 1 in force, `usesNamedForm` stops being decorative:
`circle x=100 y=100 r=20` currently survives its own deletion only through the fallback this
ruling removes. The mutant that survived at entry 0070 and was ruled KEEP at 0071-REVIEW §5
becomes a caught mutant, and that standing "known problem" closes.

Reconciliation required: 0074-REVIEW fix-list item 1. No test pins the current deferral — probed at
this review by making the change and running the suite: 106/106 still passed — so implementing this
is additive and fires no §6.1 trigger 5.

---

## D-075 — A command that does not change the document returns an EFFECT as plain data; `main.ts` performs it
Answers: entry 0075's question 2   Ruled: entry 0076-RULINGS (human, 2026-08-25)
Binding on: `command/commands.ts`, `main.ts`, and every future command that reaches the camera,
the selection, or a file

Five of §5.10's commands change no document state: `select`, `zoom`, `fit`, `save`, `load`. They
still enter through `executeCommand`, which stays the ONLY place a `Command` meets a `Document`
(D-069).

1. **`commands.ts` does the IDENTITY work and reports the refusal.** `select intersection_a`
   resolves the name against the document and REJECTS an unknown one there. `main.ts` never
   resolves a name.
2. **`CommandOutcome`'s success arm is WIDENED with an optional `effect`** — plain, serializable,
   a discriminated union, the same stance every data shape in this codebase takes. NEVER a
   callback, a closure, or a DOM handle.
3. **`main.ts` performs the effect**, because each one lives on the far side of a seam
   `command/` may not cross: the selection is `render/interaction.ts`'s state; `zoom`/`fit`
   clamping is `render/camera.ts`'s (D-062) and `fit` needs a viewport size `main.ts` supplies per
   call (D-061); `save`/`load` need the DOM, which `command/` never touches.
4. **`list` and `refs` carry NO effect.** They read the document and return `lines`, which the
   existing shape already serves — do not give them one for symmetry.
5. **`zoom`/`fit` write `Document.camera`, and that never goes through `mutate`** (D-027 clause
   2). `main.ts` writes the clamped value `camera.ts` gives it, and owns never producing an
   illegal one.

**Rejected: `main.ts` switching on `command.kind` for those five.** Cheaper today, and it puts a
SECOND name-resolution site in the one file no test reaches — the drift D-069 and D-043 both exist
to prevent.

**Rejected: passing the camera, viewport, selection and a file-IO callback into
`executeCommand`.** `save`/`load` would force either a DOM import into `command/` or a callback
parameter, and the signature would grow with every capability added. The effect field grows by one
arm instead.

Reconciliation required: none — entry 0075 stated this only as an intent in `commands.ts`'s NOT
DONE HERE, which now cites this ruling. The cycle that builds those handlers implements it.

---

## D-076 — A header's PROSE is capped at 15 lines. Every other LENGTH budget in this project is withdrawn, and length is not a finding
Answers: the header-budget request carried by 0058-, 0060-, 0062-, 0064- and 0074-REVIEW, and by
entry 0075; and `STATUS.md`'s own budget, raised at entry 0076
Ruled: entry 0076-RULINGS, widened to `STATUS.md` at entry 0077-RULINGS (human, 2026-08-25)
Binding on: every source and test file, `STATUS.md`, and every review's legibility and honesty audits
Amends: `PROCESS_BRIEF.md` §5.2 and §2

1. **`WHAT THIS IS` — hard cap, 15 lines.** This is the ONE length rule that survives, and the one
   length finding a review may still raise.
2. **`INVARIANTS UPHELD HERE` and `NOT DONE HERE` — no cap.** One line per item, no paragraphs.
3. **There is no whole-header line budget, and no `STATUS.md` line budget.** A header over 40 or
   80 lines is not a finding; neither is a `STATUS.md` over 150. **Do not report the length of
   anything** — not in a review, not in `STATUS.md`'s known problems, not in a log entry's
   self-assessment. §2's "Keep < 150 lines" and §5.2's "20-40 / ~80" are both withdrawn.
4. **Binds NEW and EDITED headers only.** Not a sweep; no verbosity audit is scheduled or wanted.
   `STATUS.md` is rewritten every cycle by construction, so clause 3 simply frees it to be as long
   as the state it describes.

Rationale (the human's, on the evidence below): the old rule contradicted itself. It set 20–40
lines while requiring that hazards, rejected alternatives and invariants be kept "regardless of
budget" — which in a load-bearing file exceeds 40 on its own. Measured across all 24 non-test
source files at entry 0076: **21 exceed 40 lines of header, but only 12 exceed 15 lines of
PROSE**, and the four worst prose blocks (`mutation.ts` 111, `primitives/table.ts` 69,
`formula/parser.ts` 52, `formula/functions.ts` 49) are exactly the files where tightening would
help a reader. So the cap now bites where the padding actually is and stops biting the lists,
which §5.2 already called the expensive knowledge. Five consecutive reviews reporting the same
unmeetable number is the cost this removes; the complexity of the program has outgrown the
number, not the other way round.

Rationale for clause 3's widening to `STATUS.md` (the human, entry 0077): the same argument, and
the same evidence — `STATUS.md` has been over its own budget for three consecutive cycles (156,
169, 192) and every cycle that trimmed it reported that what remained was pointers a cold reader
needs. A file whose ONLY job is to orient the next model must be allowed to be as long as the
state it describes. What §2's number was really measuring is staleness, and D-060/D-063/D-065
already removed the cause of that.

**Note on how this entry was amended.** Clause 3 was widened IN PLACE rather than by a superseding
decision, at the human's explicit direction, and this is the one sanctioned instance: the
widening happened before any cycle had read or built on the original wording, in the same session
that ruled it. The original text is preserved in commit `0df17f0`. This is NOT a precedent —
append-only stands, and a decision any cycle has consumed is changed only by a new one that
supersedes it.

Reconciliation required: `PROCESS_BRIEF.md` §5.2 amended at entry 0076; §2's "Keep < 150 lines"
struck at entry 0077. `STATUS.md`'s header-budget known problem is DELETED, and so is its
own-length one — neither is carried forward.

---

## D-077 — A dynamic slot family's size is DOCUMENT STATE. Never spread one into a call, and probe every "never throws" claim at the size the bounds allow
Answers: the defect found by probe at 0078-REVIEW (no `Q-NNN` was raised; this is a defect against
D-070's purpose, not an ambiguity in it)
Ruled: entry 0078-REVIEW-phase3 (reviewer)   Binding on: `primitives/schema.ts`,
`primitives/table.ts`, `graph/eval.ts`, and every future `dynamic` slot family — script `in.*`/
`out.*` ports (§5.8), per-vertex slots on an editable path (§5.5), a range's enumerated cells

**Ruling.**

1. **A collection whose length is decided by document state is appended ONE ELEMENT AT A TIME.**
   NEVER `push(...family)`, `Math.max(...family)`, `fn.apply(null, family)`, or any other form
   that passes the whole collection as ARGUMENTS. A spread reads as concatenation and is compiled
   as a call with N arguments; every JS engine caps N, and a `dynamic` family's N is whatever the
   user typed. This binds the family itself and anything derived from it one-to-one.
2. **A "never throws" claim about such a collection MUST be probed at the largest size the ruled
   bounds permit**, and the size probed named in the log entry. Reasoning about what the code
   "does" is what failed here: `resolveNonDerivedSlotPaths`'s own doc said it "does nothing beyond
   concatenating its results," which was true and still throws.
3. **D-070's numbers stand unchanged** — `sides` ∈ [3, 1000], `rows`/`cols` ∈ [1, 1000]. Do NOT
   "fix" a defect of this class by tightening a bound: the bound is not what was wrong, and a
   tighter one would hide the same hazard behind a smaller number. Measured at this review with
   clause 1 applied, `table x=0 y=0 rows=1000 cols=1000` — the worst corner the bounds allow —
   commits in ~1.2 s and round-trips, which is Rule 5's accepted trade, not a wedge.

**Rationale.** `table x=0 y=0 rows=1000 cols=200` — both counts inside the range D-070 ruled, one
typed line — threw `RangeError: Maximum call stack size exceeded` out of `executeCommand`, past
three separate "never throws" guarantees: `command/commands.ts`'s header and `executeCommand`'s own
doc, `mutate`'s, and `document.ts`'s (a foreign or hand-edited file with the same dimensions killed
`loadDocument` the same way — pre-existing, and the half of this that was reachable before a
creation command existed). The single site was `paths.push(...group.enumerate(object))`. The break
sits between 90,000 paths (fine) and 130,000 (throws), so every test in the tree was three orders
of magnitude below it and none of the six mutation checks at entry 0075 could have found it.

This is the exact failure class D-070 was ruled to prevent — "a hang with no error, the one class
of failure this project's error-value idiom cannot express" — arriving through the door D-070 did
not think to close, because the ruling bounded the COUNTS while the hazard lives in the SIZE OF THE
FAMILY THE COUNTS DECLARE. The counts were the reviewer's provisional pick and they were fine; the
defect is in what was assumed about what a bounded count could still produce. Entry 0075
implemented D-070 exactly as written, including its example message verbatim, and is not at fault
for this.

**This is the SECOND occurrence, which is why it is a ruling and not just a code fix.**
0035-REVIEW Finding 4 found `Math.min(...numbers)` in `formula/functions.ts` and D-036 clause 5
assigned its fix to the range-wiring cycle, which replaced it with `.reduce` and left a comment
naming `RangeError` by name. That fix was correct and is still there. What did not happen is the
generalisation: the same shape sat two directories away in the one function every mutation calls,
over the one collection the user can size directly, and nothing pointed at it. A finding fixes one
site; a ruling is what reaches the second.

Second half (clause 2) is the transferable lesson: this project asserts "never throws" in a dozen
headers, and every one of those assertions is about a collection or a recursion whose size is user
data. D-016 already requires a mutation check for an acceptance claim; this requires a SIZE probe
for a no-throw claim, for the same reason — the claim is cheap to write and its counterexample is
never in the range anyone tests by hand.

Reconciliation required: none outstanding. The one live site was fixed at 0078-REVIEW
(`primitives/schema.ts`, with the reason in place) and pinned by a `schema.test.ts` test at 200,004
paths. `enumerateRangeCellAddresses` and `graph/eval.ts` were checked at the same review and
already loop; a tree-wide `grep 'push(\.\.\.'` returns the one static-group site, which is a
literal in `schema.ts` and bounded by construction.

---

## D-078 — A probe that falsifies a property falsifies EVERY claim of it on that call path. Correct all of them, or the finding is not discharged

Ruled at 0080-REVIEW-phase3 (reviewer), from entry 0079's own measurement.

1. When a probe shows that a stated property (never throws, always terminates, never allocates
   unboundedly, always returns a value) is FALSE, the finding is not discharged by correcting the
   one claim you happened to be reading. Grep the call path for every statement of the same
   property — file headers, function docs, test names — and correct or qualify each one.
2. "Call path" means what the probe actually ran through, in both directions: the function that
   throws, every function whose doc asserts the property while calling it, and every function that
   asserts it while being called by it. In entry 0079's case that is `formula/parser.ts`,
   `formula/format.ts`, `command/commands.ts`'s `writeSlot`, and `executeCommand` — four files'
   worth of claims, one of which was corrected.
3. A claim that is TRUE for every document state and false only past a size bound is qualified, not
   deleted: state the bound and the measurement, and point at the entry that measured it. A reader
   needs to know the property holds for everything they will type, and exactly where it stops.
4. This does not authorise a sweep. It binds the call path the probe ran, at the cycle that ran it —
   nothing wider, and no scheduled audit of claims nobody has probed.

**Rationale.** D-077 clause 2 made the probe mandatory and it worked: entry 0079 pushed its own
"never throws" to the bound, found a `RangeError` at ~5,000 formula nesting levels, and disclosed it
rather than burying it. Then it corrected `commands.ts`'s header and `executeCommand`'s doc and
stopped — leaving `format.ts`'s header asserting "Never throws" in a file created by the same cycle,
by the model that had just watched `formatFormula` throw, plus two more sites saying the same thing.

The reason this is a ruling and not a finding is that the omission is structural, not careless. A
probe is written against one claim, so the fix lands where the reader's attention was, while the
identical claim two files away is exactly as load-bearing and exactly as false. D-065 already says a
comment is YOURS once you falsify it; what was missing is that a MEASUREMENT falsifies comments you
never opened. This is the third review running to find the never-throws shape (0074-REVIEW F1,
D-077's own rationale, and now 0080-REVIEW F2), and each time the previous fix was correct and did
not generalise.

Reconciliation required: none outstanding. The three live sites were corrected at 0080-REVIEW;
`formula/parser.ts`'s two carry the exception until 0080-REVIEW fix-list item 1 puts the depth limit
in, which makes the original claim true again rather than merely qualified.

---

## D-079 — A stack-depth measurement is an OBSERVATION, not a bound. Set a recursion limit from a constant, never from a probe
Answers: the finding at 0082-REVIEW (no `Q-NNN` was raised; this is a defect in what two entries
concluded from a real measurement, not an ambiguity in the brief)
Ruled: entry 0082-REVIEW-phase3 (reviewer)   Binding on: `formula/parser.ts`, `formula/format.ts`,
and every future recursive walk over user-authored data

**Ruling.**

1. **A measured recursion depth records that a throw was SEEN at that size, in that process,
   after whatever else had already run.** It never licenses "below N is safe" and is never quoted
   as a bound. State it as what it is: a size at which the throw was observed.
2. **Every depth limit is a FIXED CONSTANT, chosen well below the smallest depth ever observed to
   fail, and pinned by a test on the constant itself.** It is NOT derived from a measurement and
   NOT raised because a probe got further once. For `formula/parser.ts` and `format.ts` today that
   constant is at or below **1,000** nesting levels.
3. **D-078 clause 3 is satisfied for a stack-depth property by saying the depth is not fixed** and
   naming the smallest observed failure. A qualified claim that names one number as THE bound
   ("never throws below ~5,000 levels") is still a false claim, and is the form both live sites
   currently carry — fix-list item 1 replaces them with the constant.
4. **The limit is the fix.** A bigger interpreter stack is not (this project ships no runtime
   flags), and converting a recursive descent into an explicit loop is a separate change needing
   its own review — Rule 5 does not ask for it and nothing in the brief does.

**Rationale.** Entry 0079 measured a `RangeError` at ~5,000 terms of `1 + 1 + …`; entry 0081
measured one at ~3,000 terms of `table_1.B1 + table_1.B1 + …` and concluded that the depth
"depends on what the terms are, not just how many" — reasonable, and it became STATUS's standing
instruction to *set the limit from the worst term*. Both measurements reproduce exactly. The
conclusion does not survive one more probe:

```
ladder 1000 -> 3000:                 3000 x "table_1.B1"   THREW
ladder 1000 -> 2000 -> 2500 -> 3000: 3000 x "table_1.B1"   COMMITTED,  4000 THREW
ladder 1000 -> ... -> 5000:          6000 x "table_1.B1"   COMMITTED
cold, same size, next process:       6000 x "table_1.B1"   THREW
```

The same formula both commits and throws in the same process depending only on what parsed before
it: the stack depth a V8 frame costs moves with how the function was compiled at the moment of the
call, so the failure point is a property of the runtime's state, not of the input. A limit set at
"3,000, from the worst term" is a limit that still throws.

**Why a ruling and not a finding.** This is the fourth cycle in a row on the never-throws shape
(0074-REVIEW F1, D-077, D-078, and now this), and each previous ruling made the NEXT step right:
D-077 clause 2 made the probe mandatory, and the probe found the throw; D-078 made one probe
correct every claim on its call path. What neither says is what a measurement may be USED for
afterwards. A number that was expensively earned is the most tempting thing in the log to build
on, and the next cycle is about to build a depth limit. 1,000 terms committed in every run at
0082-REVIEW, of both term shapes, cold and warm; that is the kind of number a constant may be set
from — the floor everything survived, not the ceiling something died at.

Reconciliation required: none outstanding, and no `PROVISIONAL` tag. `formula/parser.ts` and
`formula/format.ts` carry qualified never-throws claims naming a measured band (D-078 clause 3);
0080-REVIEW fix-list item 1, as restated at 0082-REVIEW §9, replaces both with the constant this
ruling requires.

---

## D-080 — A word §5.3 lexes as a formula keyword is NOT an available object name, in any case
Answers: the finding at 0084-REVIEW (no `Q-NNN` was raised — the brief is silent where two of its
own sections meet, which entry 0083 had no reason to look for)
Ruled: entry 0084-REVIEW-phase3 (reviewer)   Binding on: `address.ts`'s `checkNameAvailable` and
every future caller of it, including §5.11's load path

**Ruling.**

1. **`checkNameAvailable` refuses `AND`, `OR`, `NOT`, `TRUE` and `FALSE` as object names, matched
   case-INSENSITIVELY**, alongside §5.2's grammar and uniqueness. It is a third clause of the same
   gate, not a second gate somewhere else.
2. **The set is read from `formula/lexer.ts`'s exported `RESERVED_WORDS`, never re-spelled.**
   D-010's "declare vocabulary once" applies: five string literals copied into `address.ts` are
   five literals free to drift from the table the lexer actually matches against. A sixth keyword
   added to that table is reserved automatically, and the test pinning the set's contents makes
   that a visible diff rather than a silent widening.
3. **Case-insensitively, even though the lexer matches keywords case-SENSITIVELY today.** `and`
   lexes as an identifier and would work; refusing it anyway costs a user nothing and keeps
   `lexer.ts`'s standing promise — "lowercase acceptance is purely additive later" — actually
   additive. If that promise is ever cashed, no name already saved in a document breaks.
4. **The reservation is on the WHOLE name, never a substring.** `android` and `not_1` are ordinary
   names.
5. **This does not extend to function names.** `SUM`, `IF`, `PI` and every other entry in
   `functions.ts`'s registry lex as identifiers, and `SUM.A1` parses and resolves exactly like any
   other reference — probed, not assumed. Do not widen the reserved set to them.

**Rationale.** §5.2 says an object name matches `[a-zA-Z_][a-zA-Z0-9_]*`. §5.3 says `TRUE`,
`FALSE`, `AND`, `OR` and `NOT` are literals and operators. Five words satisfy both, and neither
section mentions the other. Before entry 0083 nothing could reach the overlap: `commands.ts` mints
every name through `generateDefaultName`, so no user-chosen name existed. `rename` is the first
command that lets a user name an object, which makes the overlap reachable by one typed line:

```
rename table_1 TRUE                          committed
link polygon_1.origin.x TRUE.A1              unexpected trailing input starting at "."
set  polygon_1.origin.y = TRUE.A1 + 1        unexpected trailing input starting at "."
refs TRUE                                    TRUE.A1 → polygon_1.origin.x
```

The object is still listed, still renamed, still deleted, and every formula that ALREADY read it
keeps evaluating — §5.3's stored-ID scheme sees to that. What is gone is the ability to write a NEW
reference to it: the name never survives the lexer, so it never reaches `parseAddress`. `refs`
happily prints an address no one can type back in. That is a §5.10 rejection story failing in the
worst available way — the operator is shown the right answer and cannot use it.

The alternative — teaching `formula/parser.ts` to accept a keyword token in leading-reference
position — is a real grammar change to a reviewed subsystem, for the benefit of five names nobody
wants. Rule 5 asks for the dumbest correct fix, and refusing the name at the one gate that already
exists is it.

Reconciliation required: none, and no `PROVISIONAL` tag. Implemented at 0084-REVIEW in
`address.ts` and `formula/lexer.ts`, with tests at all three layers (`address.test.ts`,
`mutation.test.ts`, `commands.test.ts`).

---

## D-081 — `createObject`'s own name is gated by `checkNameAvailable` too, and the cycle that builds §5.11's load path owns closing it
Answers: entry 0083's reviewer question 1 ("is pinning the gap the right call, and whose is it?")
Ruled: entry 0084-REVIEW-phase3 (reviewer)   Binding on: `mutation.ts`, and on the cycle that
builds §5.11's load

**Ruling.**

1. **Entry 0083 was right not to close it.** A rename slice may not decide what a load does with a
   corrupted saved document. Disclosing the gap in the log, in `findInvalidRenames`'s own doc, in
   STATUS's known problems, and in a test that asserts the duplicate DOES commit is the correct
   handling of a gap you are deliberately leaving open — it is the shape D-053's "KNOWN
   INCOHERENCE" pin already established, and closing it will now be a diff against a named test
   rather than a silent behaviour change.
2. **The direction is settled, so the load cycle does not re-litigate it.** `createObject`'s
   `object.name` MUST pass the same `checkNameAvailable` gate every rename passes — grammar,
   D-080's reserved words, and uniqueness — evaluated at that operation's own position in the
   left-to-right simulation `findInvalidRenames` already runs. It extends that function; it does
   not get a fifth pre-staging check of its own (D-050's "every future operation kind that changes
   [what is being simulated] MUST extend that same simulation," applied to names).
3. **A colliding or ungrammatical name REJECTS the whole batch, naming every offender.** It is not
   repaired by auto-renaming. §5.1 commits all-or-nothing, D-021 already rejects a load whose
   references do not resolve, and a silent rename would change a name the user wrote formulas
   against without saying so. A load of a corrupt file fails loudly, the same way every other
   corrupt-document check in this file fails.
4. **Until then, do not read `checkNameAvailable`'s existence as proof that no document holds a bad
   name.** Two comments in `address.ts` claimed exactly that and were corrected at 0084-REVIEW.

**Rationale.** The gap is pre-existing and, today, unreachable from any code that ships: every
`createObject` in `src/` is built by `commands.ts` from `generateDefaultName`, and §5.11's loader
does not exist yet. The reachable route arrives with the loader, which is precisely the cycle that
has to weigh what rejecting a name does to a user's saved file — so that cycle owns it, and it
inherits a decided direction rather than an open question. Ruling it now costs nothing and stops
the third cycle in a row from re-deciding whose problem it is.

Reconciliation required: none outstanding. The pinned test in `mutation.test.ts` ("KNOWN GAP,
pinned not fixed") must FLIP when the load cycle implements this — that is the intended visible
diff, not a test being weakened.

---

## D-082 — `command/` refuses a camera command's DOMAIN; `render/` clamps its RANGE; `main.ts` switches over `CommandEffect` exhaustively and resolves no name
Answers: entry 0085's decisions 2, 3 and 5, ruled rather than left as implementation choices
Ruled: entry 0086-REVIEW-phase3   Binding on: `command/commands.ts`, `render/camera.ts`, `main.ts`,
and every future command that returns a `CommandEffect`

1. **DOMAIN is `command/`'s, RANGE is `render/`'s.** A value that is not the KIND of thing the
   command takes is refused in `commands.ts` and never becomes an effect: a `zoom` factor that is
   not a positive finite multiplier, a `select` naming nothing, a `fit` over an empty document.
   A value that is legal but must be bounded against the CURRENT camera — `[MIN_ZOOM, MAX_ZOOM]` —
   is clamped in `render/camera.ts` (D-062) and NEVER re-checked in `command/`, which cannot see
   the camera to check it against.
2. **A refusal that `camera.ts` would silently absorb belongs in clause 1's half.** `clampZoom`
   turns `0` and `-2` into `MIN_ZOOM` and keeps the current zoom for a non-finite request — each
   is a line that would report success and do something the operator did not ask for. Where the
   two layers could both "handle" a value, the one that can still say NO takes it.
3. **`main.ts` performs an effect through a `switch` on `kind` with the `never` default**, the
   idiom every discriminated-union switch in this codebase carries. `effect` is OPTIONAL on the
   success arm (entry 0085's decision 1), so a missing arm is not a compile error at the seam —
   the exhaustive switch is what restores that, and it is required, not suggested.
4. **`main.ts` resolves no name and re-derives no identity** (D-075 clause 1, restated because
   this is the cycle that will be tempted): an effect names an object by ID, and `main.ts` uses
   the ID it was handed.
5. **An effect carries the REQUEST, and the echoed line is worded for what has actually happened.**
   `selected polygon_1` is past tense because nothing after it can fail; `zoom by 2`, `fit to the
   document extent`, `saving document` and `loading document` are not. A clamped or degenerate
   result is `main.ts`'s to report, not `commands.ts`'s to predict.

**Rationale.** Two layers can both plausibly own "is this zoom sane", which is exactly the split
that produces either a double check that drifts or a gap neither side covers. The line that makes
it decidable is not "which is closer to the camera" but "which layer can still refuse" — a clamp
cannot refuse, it can only absorb. Clause 3 exists because widening rather than restructuring
(the right call) costs the seam its compile-time exhaustiveness, and that cost has to be paid
back explicitly in the one file no test reaches.

Reconciliation required: none. `commands.ts` already implements clauses 1, 2 and 5 as of entry
0085; clauses 3 and 4 bind the `main.ts` cycle.

---

## D-083 — D-079's 1,000 is a CEILING, per recursion, in that recursion's own unit. A loaded AST's depth is validated ONCE, at the load boundary
Answers: entry 0087's self-reported §6.1 trigger 3 ("D-079 clause 2's number is unsafe for the
descent and I deviated from it"), and the asymmetry its decisions 4 and 5 leave behind
Ruled: entry 0088-REVIEW-phase3 (reviewer)   Binding on: `formula/parser.ts`, `formula/ast.ts`,
`formula/format.ts`, `formula/deps.ts`, `formula/eval.ts`, and §5.11's loader when it is written

**Ruling.**

1. **"At or below 1,000 nesting levels" is a CEILING, not a target.** A constant *below* it is
   compliance, not deviation. Entry 0087 set 256 nesting steps for the recursive descent and 1,000
   levels for the stored AST; both are at or below the ceiling and **no clause of D-079 was
   deviated from.** The entry's trigger-3 self-report was honest over-reporting and is recorded as
   such — the log does not carry a violated ruling.
2. **The ceiling is applied PER RECURSION, in the unit that recursion counts in.** Two independent
   recursions over user-authored data get two constants when their frame costs and their observed
   failure points differ, each declared beside the shape it bounds (D-010) and each pinned by a
   test on the number itself. A single shared constant is not required and is wrong where it would
   have to be the smaller of the two.
3. **A recursion's limit lives at the recursion, not at its callers.** `command/commands.ts` adds
   no depth check; that is now stated in its own doc and is binding.
4. **Depth of a LOADED `FormulaAst` is checked ONCE, at §5.11's load boundary, against
   `MAX_FORMULA_AST_DEPTH`** — not by a guard in every walk. `deps.ts` and `eval.ts` must NOT grow
   depth parameters, and `format.ts`'s existing guard stands as written (it is a display fallback,
   it stores nothing and refuses nothing, and it is already built and tested). The loader refuses
   a document whose formula slot nests deeper than the constant, with the same vocabulary
   `parser.ts` uses; nothing downstream of the loader may then receive one.

**Rationale.** Clause 1 is the smaller half and matters because the alternative is a log that says
a binding ruling was broken when it was not. What entry 0087 actually found is that clause 2's
number reads as a *safe* value ("set it at 1,000") when it was written as a *bound* ("no higher
than 1,000"); measured at 1,000 parenthesis levels the descent still throws, so the reading
matters. Clause 2 records why that is not a contradiction: 1,000 paren levels is ~2,000 steps in
the unit the descent counts, and the two recursions were never commensurable.

Clause 4 is the load-bearing half. Entry 0087's decision 4 guards `format.ts` because "§5.11's
load path casts a saved AST unchecked", and its decision 5 declines to guard `deps.ts`/`eval.ts`
because "a path that does not exist yet" is speculative. Both cannot be right about the same path.
Probed at review: a hand-built 40,000-level AST formats fine and throws a `RangeError` out of
`extractDependencies`, `rewriteAddressesInAst` and `evaluate`. So the exposure is real and it is
in three more places than the cycle guarded. The answer is not three more depth parameters — it is
that a document is validated when it is read, once, the way every other unchecked-cast field in a
loaded document will have to be. Until that loader exists no user-reachable path can produce such
an AST (`parser.ts` refuses it), so nothing is broken today and nothing speculative gets built.

---

## D-084 — Phase 3's gate is cleared CONDITIONALLY: Phase 4 may not begin until a human has run the app once and reported what they saw
Answers: entry 0089's acceptance-criteria qualification 1 ("I have not run the app in a browser")
Ruled: entry 0090-REVIEW-phase3 (reviewer)   Binding on: the Phase 3 → Phase 4 transition, and
every later phase gate whose criterion is stated in the operator's own verbs

**Ruling.**

1. **Phase 3's criterion is ACCEPTED as engineering** — `main.test.ts`'s end-to-end block runs
   the criterion's own order (create, draw, pan, zoom, select, drag) against one state and asserts
   the draw calls, the camera, the selection and the moved slot. That is the strongest form
   PROCESS_BRIEF §12.1 asks for where a criterion is visual: "test the engine-side consequence and
   describe the manual check separately and honestly." Entry 0089 did both.
2. **It is NOT cleared as a gate until the manual check is performed by the human and its result
   recorded in a numbered entry.** The check is entry 0089's own wording: open the dev server,
   type `polygon sides=5 x=100 y=100 r=50` and `table x=300 y=100 rows=3 cols=3`, wheel, middle-drag,
   click the polygon's outline, drag it. Whoever runs it writes down what they saw, including
   nothing.
3. **No implementer cycle can discharge clause 2.** An implementer with no browser MUST NOT claim
   it, simulate it, or add a headless-browser dependency to reach it (§4: never add a dependency).
   Until it is recorded, `STATUS.md` says the gate is conditional and Phase 4 does not start.
4. **The next slice, meanwhile, is D-068's feedback trio** — it is inside Phase 3, it is what makes
   `select` mean something on screen, and it is the one piece that changes what the manual check
   will show. Doing it first makes clause 2 worth performing once instead of twice.

**Rationale.** Three of this review's four findings are in the half of `main.ts` no test reaches,
and all three would have been caught in ten seconds by a human clicking once: a canvas whose
backing size never matched its CSS size (every click landing off the picture), a space-drag pan
that could not fire, and a save that some browsers drop. That is the measurement. A criterion
written in the operator's verbs — "see both drawn", "select", "drag" — is a claim about what a
person perceives, and this project has now demonstrated that a green suite over the testable half
does not cover the claim. The gate is not the tests' to close.

This does not weaken §12: the criterion still MUST be expressed as executable tests before it is
claimed, and it was. Clause 2 adds the one check tests structurally cannot make, and names who
owes it.

---

## D-085 — §5.9's space-drag pan is armed by a space key while the input bar is EMPTY
Answers: the collision between §5.9 ("pan: middle-drag or space-drag") and §5.10 ("the input bar
is always focused when the user is not editing text or a cell"), found at 0090-REVIEW F3
Ruled: entry 0090-REVIEW-phase3 (reviewer)   Binding on: `main.ts`'s key handling, and any later
file that reads a key the input bar could also have consumed

**Ruling.** The space key arms the pan gesture when `input.value` is `""`, and is consumed
(`preventDefault`) when it does; otherwise it is an ordinary character and reaches the input.
A `event.target !== input` test is NOT an acceptable guard for this or any other global key,
because §5.10 makes the input the target of essentially every keystroke.

**Rationale.** Entry 0089's guard was written to keep a space typed mid-command from yanking the
canvas, which is right, but it made the gesture unreachable rather than conditional: the input is
focused at startup and re-focused after every canvas press, so `target` is the input every time.
An empty input is the exact state in which a space carries no meaning as text — no command word
begins with one — so it is free to carry the gesture, and the operator's mental model ("nothing
typed yet, so the canvas has the keyboard") matches. Middle-drag was unaffected and is why §5.9's
pan was still satisfiable; that does not make a specified gesture optional.

**Reconciliation required:** none — applied at 0090-REVIEW.

---

## D-086 — A canvas's BACKING size is re-read from its CSS size before every paint, in `main.ts`, and nowhere else
Answers: 0090-REVIEW F1
Ruled: entry 0090-REVIEW-phase3 (reviewer)   Binding on: `main.ts`; constrains any future
`render/` work that would rather scale the context

**Ruling.**

1. `canvas.width`/`canvas.height` are set from `canvas.clientWidth`/`clientHeight` immediately
   before each `renderDocument` call, whenever they differ. Not only on `window`'s `resize`.
2. **The invariant it buys is stated once and relied on everywhere downstream: one backing pixel
   is one CSS pixel.** `screenPointOf` reports CSS pixels off `getBoundingClientRect`, `hitTest`
   and `renderDocument` consume backing pixels, and nothing between them converts. So the two
   MUST be the same number, and `main.ts` is the only file that can make them so.
3. A future device-pixel-ratio or GPU cycle that wants a backing store bigger than the CSS box
   MUST introduce the conversion at `screenPointOf` in the same change. It may not break clause 2
   and leave the conversion for later.

**Rationale.** The canvas is a flex child above a log that GROWS as commands are echoed, so its
CSS height changes with no window `resize` behind it. Entry 0089 sized the backing store once at
startup, before the first log line was drawn — so the mismatch existed from the first frame and
widened for the first nine lines. The browser scales the backing store to fit the box, which means
the picture stays plausible while every click is displaced by the ratio: the failure looks like
bad hit-testing, and `hittest.ts` is where the next reader would go looking. Re-reading the size
per paint costs one layout read per frame, which Rule 5 does not trade correctness for.

---

## D-087 — A degenerate extent (D-066) is one with BOTH axes zero. A FLAT extent is fitted to its one real axis
Answers: 0090-REVIEW F2
Ruled: entry 0090-REVIEW-phase3 (reviewer)   Binding on: `main.ts`'s `fit`, and any later reader
of `render/hittest.ts`'s `documentExtent`

**Ruling.** `fit` treats an extent as degenerate only when its width AND its height are zero — one
point. An extent with one zero axis (a `rect` of zero height, a run of collinear vertices, a single
row of a future polyline) is FITTED, to the axis it has, and is never described as a point.

**Rationale.** D-066 asked for a guard against dividing the viewport by a zero extent, and entry
0089 built one that fired on either axis. The arithmetic did not need it to: dividing by a zero
axis yields `Infinity`, and the `Math.min` against the other axis discards it, so a flat extent
already fits correctly. The over-broad guard cost a real behaviour and produced a false message —
verified at review, `rect x=0 y=0 w=200 h=0` then `fit` reported "the document's extent is a single
point" about a rect two hundred units wide. A message that names the wrong shape is worse than no
message; §5.10's whole debugging story is that every line names what it is talking about.

**Reconciliation required:** none — applied and pinned by a test at 0090-REVIEW.

---

## D-088 — Every printable keystroke reaches the command input, wherever focus happens to be. Modifier combinations never do
Answers: entry 0091's manual check, note 2 ("the command line currently requires the user to click
on it to activate it")
Ruled: entry 0091-REVIEW-phase3 (reviewer)   Binding on: `main.ts`'s key and pointer handling

**Ruling.**

1. **A press on the canvas must not cost the command input its focus.** The browser moves focus to
   the body as the DEFAULT action of a press, which runs after the listener, so an `input.focus()`
   inside the handler is undone a moment later. The canvas's `pointerdown` listener calls
   `event.preventDefault()`, and keeps the `focus()` call for the case where something else already
   took the keyboard. Applied at 0091-REVIEW.
2. **A printable keystroke arriving anywhere else routes to the command input and is not lost.**
   The window-level handler focuses the input and lets the character through, so the operator can
   pan, drag, and then type `circle` without a click in between. This is §5.10's "always focused
   when the user is not editing text or a cell" implemented rather than asserted — the sentence has
   been in the brief since the first commit and entry 0089 read it as "call `focus()` twice".
3. **A keystroke with `ctrl`, `alt` or `meta` held is NOT printable and is never routed.** AutoCAD's
   own rule, and the reason it is a rule rather than a preference: browser and OS shortcuts
   (`ctrl+r`, `ctrl+shift+i`, `alt+tab`) must keep working, and a routed `ctrl+c` would silently
   turn a copy into a character. `shift` alone IS printable and routes.
4. **The keys that already mean something keep meaning it.** `Escape` cancels (D-072 clause 7) and
   deselects. `Space` on an EMPTY input arms the pan gesture and is consumed (D-085, unchanged and
   unaffected — an empty input is still an empty input when the keystroke was routed to it).
   `Enter` submits.

**Rationale.** Note 2 of the manual check is the clearest possible statement of why D-084 exists:
the sentence in §5.10 is unambiguous, the code called `focus()` in two places, the suite was
unanimous, and the application still could not be typed into after a click. Nothing short of a
person pressing a key was going to find that.

Clause 3 is the part most likely to be got wrong later by someone implementing clause 2 in a hurry.
Routing on `event.key.length === 1` alone catches `ctrl+v` — whose `key` is `"v"`.

---

## D-089 — The command input keeps a history, walked with the up and down arrows, and it lives in `AppState`
Answers: entry 0091's manual check, note 3
Ruled: entry 0091-REVIEW-phase3 (reviewer)   Binding on: `main.ts`

**Ruling.**

1. **`AppState` gains `history` (the lines submitted, oldest first) and `historyCursor`.** Both are
   plain data, both are part of the pure half, and the transitions over them (`recallPrevious`,
   `recallNext`) are tested like every other transition in that file. Only the arrow-key listener
   lives in the untested half, which is the same split entry 0089 chose and the reason 0090-REVIEW's
   findings were survivable.
2. **What is recorded is what the operator SUBMITTED**, including a line that was refused — a
   rejected command is the one you most want back to correct a typo in. A prompt-sequence ANSWER is
   not a command and is not recorded.
3. **Up walks toward older, down toward newer, and down past the newest restores the empty input.**
   Walking off the oldest end stays on the oldest.
4. **History is not serialized.** It is not part of §5.11's document, it is not journal state, and
   `replaceDocument` keeps it for the same reason it keeps the log: it is a record of what the
   operator did, and loading a file does not undo that.

**Rationale.** Not in the brief, and it does not need to be: §1 names AutoCAD as the interaction
model and §8's deferred "command-language gold-plating" is about the command LANGUAGE (adding
commands), not about the input's ergonomics. The human asked for it directly, which under §1 settles
whether it is in scope.

Clause 1 is the ruling that matters. The obvious implementation keeps two mutable variables inside
`start` next to `pan` and `spaceHeld`, and would be entirely untested. Putting them in `AppState`
costs nothing and moves the whole behaviour into the half that has assertions.

---

## D-090 — A prompt sequence that has gathered a point DRAWS that point, and the geometry it would produce
Answers: entry 0091's manual check, note 4 ("no reference point for the centre of the circle")
Ruled: entry 0091-REVIEW-phase3 (reviewer)   Binding on: `render/renderer.ts`, `main.ts`; runs with
D-068 in one cycle

**Ruling.**

1. **The pending command's gathered answers are drawn.** A picked world point draws as a small
   marker, and where the remaining steps are enough to determine a shape, the shape it WOULD create
   draws in the same preview treatment, updated as the pointer moves. `circle` with an origin picked
   shows the centre marker and the circle the current pointer position would make.
2. **A preview is not an object and never enters the document.** It is drawn from `state.pending`,
   which already holds the gathered answers (D-072), plus the live pointer position. No `mutate`
   call, no ID minted, nothing serialized, nothing hit-testable. Rule 2 is untouched because nothing
   is written.
3. **`renderDocument` takes the preview the same way it takes the selection** — as an explicit
   parameter, not as a field on `Document`. `render/` may read the pending command's shape; the
   document may not learn about it.
4. **This runs in D-068's cycle**, because both need the same thing: the ability to draw something
   that is not an object, and the transform reset before screen-space chrome that D-068 already
   owns.

**Rationale.** The manual check's note 4 is a real gap and it is not covered by anything already
ruled. D-072 made a canvas pick a prompt answer and tested that the right world point arrives at the
right step, which is the whole of what a headless test can check. What it cannot check is that the
operator can see where the first click landed — and without that, every multi-point command is a
guess. This is the same class of defect as 0090-REVIEW's F1 through F4 and it was found the same way.

Clause 2 is the clause to defend. The tempting implementation creates the object on the first pick
and moves it on each subsequent one, which would put a half-built object in the document, in the
journal, and in front of `evaluate`. The pending command already holds everything needed and holds
it in the pure half.

---

## D-091 — A table's grid is drawn lighter than an object's outline, deliberately, and both stay untuned until the `style` cycle
Answers: entry 0091's manual check, note 5 ("the circles and rectangles are a darker black while the
table is grey. Is that intentional?")
Ruled: entry 0091-REVIEW-phase3 (reviewer)   Binding on: `render/renderer.ts`

**Ruling.** The difference is intended and stands. A table's grid is chrome that contains content,
an outline is the object itself, and drawing them at one weight makes a table read as a drawn shape.
Both constants remain untuned under Rule 5 and both are absorbed by the cycle that declares real
`style` slots (§5.5, Q-012), which is where a per-object colour becomes a slot and these two become
defaults.

**Rationale.** Recorded because the honest answer to "is that intentional?" was *half*. The two
constants were chosen deliberately and differ on purpose, but `DEFAULT_SHAPE_STROKE_STYLE` carries a
paragraph of reasoning and `TABLE_GRID_STROKE_STYLE` was typed with no comment at all, so nothing in
the repo said which. It does now.

---

## D-092 — The addressing vocabulary MUST be visible in the running application. A name is drawn on the canvas, and an object's slots are readable by command
Answers: the human's argument at entry 0092 — *"How can I actually tell which object is which? Which
circle is circle_1 or circle_2 to me, the user, who only sees a canvas and the history of commands?"*
Ruled: entry 0092-REVIEW-phase3 (reviewer)   Binding on: `render/renderer.ts`, `command/commands.ts`,
and every later surface that shows an object

**The gap, stated first, because it is larger than the question that found it.** Rule 3 makes the
addressing scheme load-bearing and §5.2 gives the operator a mutable name as their half of it. Every
authoring act in §5.10 — `link`, `set`, `refs`, `delete`, `rename` — is spelled in names and slot
paths. **Nothing in the running application displays either.** Three separate holes:

1. **Object to name.** Click a circle and there is no way to learn it is `circle_2`. Nothing in the
   brief addresses this at all.
2. **Name to object.** `select circle_2` exists and is specified, and it draws nothing until D-068
   lands. Specified, unbuilt.
3. **Object to its slots.** `list` prints names and types (`circle_1 — circle`). No command prints
   what slots an object HAS, what kind each is, or what drives it. An operator cannot discover that
   `origin.x` or `radius` exists without reading `primitives/schema.ts`.

Hole 3 is the one that blocks Phase 4 for a human. `link polygon_1.origin.x table_x.A1` requires
knowing in advance that both paths exist and that the target is not `derived`. The brief assumes the
operator knows the schema, which is true of the brief's author and false of its user.

**Ruling.**

1. **An object's name is drawn on the canvas, next to the object.** This is object rendering in the
   family of §5.9's "visual feedback", NOT §5.10's forbidden "panels, toolbars". Runs in D-068's
   cycle, which already owns drawing things that are not geometry.
2. **The label is SCREEN-space: constant size and constant offset regardless of zoom.** A name is
   not a property of the drawing, so it does not scale with it. This is the first thing in
   `renderer.ts` that is unambiguously screen-space, and it is evidence toward **Q-012** rather than
   a taking of it: Q-012 asks about a stroke WIDTH and a cell SIZE, which are properties of the
   object. A label is not.
3. **Always drawn, at first.** Rule 5's dumbest correct implementation, and it is what makes the
   vocabulary visible without inventing a hover or toggle mechanism nobody has asked for. If a
   crowded canvas makes this noise, the next human session will say so and a toggle is one cycle.
   Do NOT pre-emptively build the toggle.
4. **A command prints an object's slots, their kinds, and their current values.** Registry name
   `props <object>`, one entry, which is §5.10's own extension mechanism ("adding a command is one
   registry entry") and therefore needs no amendment. It reports every slot on the object: the path,
   the kind (`literal` / `formula` / `derived`), the current value, and for a formula slot the source
   reconstructed by `formula/format.ts` against current names.
5. **`props` must make the three slot kinds legible, because they are what the operator is allowed
   to do.** A `derived` slot cannot be `set` or `link`ed (§5.1) and the operator has no other way to
   learn which ones those are. Marking the kind IS the point of the command.
6. **`props` reads and refuses to write.** No `effect`, no mutation, like `list` and `refs`
   (D-075 clause 4).

**Rationale.** The project's thesis is wiring objects together parametrically. The wiring is done in
a vocabulary — names and slot paths — that the engine treats as load-bearing and the interface does
not show at all. An engine that resolves addresses perfectly is unusable by someone who cannot see
the addresses. That is not a UI nicety, and it is not the properties-panel question (**Q-014**),
which is about EDITING slots by mouse. Clauses 1 and 4 make the vocabulary READABLE, cost about one
cycle between them, and conflict with nothing in the brief.

Clause 4 is deliberately a command rather than a panel, so that it lands whatever the human rules on
Q-014. If the panel is approved, `props` is what the panel displays and the work is not wasted. If
the panel is declined, `props` is the whole answer to hole 3.

---

## D-093 — `render/` splits into `slots.ts` and `extent.ts`. The `renderer.ts` ↔ `hittest.ts` import cycle is removed BEFORE anything else is built on top of it
Answers: entry 0094's escalation, question 1   Ruled: entry 0095-REVIEW-phase4 (reviewer)
Binding on: `render/*`, and every future consumer of a slot read or an object's extent

**Ruling.** Take the split entry 0094 itself described. Four moves, one cycle, no behaviour change:

1. **`src/render/slots.ts`** — `readNumber`, `asPointArray`, `TABLE_CELL_WIDTH`, `TABLE_CELL_HEIGHT`,
   `TABLE_CELL_TEXT_PADDING`. These are the reads more than one file in `render/` makes of a
   `GraphObject`. 0064-REVIEW §5 already named this file and set its trigger at "the THIRD consumer";
   `renderer.ts`, `hittest.ts` and (next cycle, D-094) the properties panel's placement are three.
2. **`src/render/extent.ts`** — `WorldExtent`, `objectExtent`, `documentExtent`, importing `slots.ts`.
   0090-REVIEW accepted 0089's reasoning for `documentExtent` living beside `objectExtent`; that
   reasoning is preserved exactly — the two still live together, in a file that is now about extents
   rather than about hit-testing.
3. **`renderer.ts` and `hittest.ts` both import those two.** The `render/` graph becomes a DAG and
   both HAZARD notes entry 0094 wrote are deleted, not amended — a comment describing a hazard that
   no longer exists is D-065 debt the moment it is falsified.
4. **Re-export nothing for compatibility.** `renderer.ts` stops exporting `readNumber`/`asPointArray`/
   `TABLE_CELL_*`; every importer moves. There are few and the compiler finds them all.

**Rationale.** The cycle resolves today only because every cross-file reference happens to sit inside
a function body. That is not an invariant anyone stated, no test can see it, and the failure mode is
a TDZ error at module evaluation — the whole application blank, from a one-line edit that looks
harmless. Rule 9's "whatever is easiest to delete later" does not license leaving a trap in a file
two more cycles are about to be written against. The split is mechanical, the destination was already
designed by an earlier review, and D-094's panel is the third consumer that earlier review was
waiting for.

**This ruling is the authorisation §4 requires** to restructure `renderer.ts` and `hittest.ts`, which
entry 0094 correctly declined to do without one. Scope is the move itself: no logic change, no
renamed function, no new behaviour, and every existing test passes unedited except for its import
lines. If a test needs its *assertions* changed, the move has stopped being a move — stop and say so.

**Sequencing: this cycle runs FIRST**, before `props` and before the panel. Both of those add
consumers, and adding them to a cyclic graph makes the split bigger every cycle it is deferred.

---

## D-094 — A selected object's slots are displayed in a floating, READ-ONLY properties panel beside the object. §5.10's "no panels" is amended by the human, for display only
Answers: the human's directive and sketch at entry 0095; the DISPLAY half of Q-014
Ruled: entry 0095-REVIEW-phase4 (reviewer, recording the human's decision)
Binding on: `index.html`, `src/main.ts`, `src/render/*`, `src/command/*`

**Status of the brief.** §5.10 says "Minimal UI chrome elsewhere — no panels, no toolbars." The human
has amended that sentence for this one surface and no other. `PROJECT_BRIEF.md` §5.10 now carries a
pointer to this ruling. **No other panel, palette, toolbar, menu, ribbon, or inspector is thereby
permitted** — §8's forbidden list and §5.10's sentence stand for everything except what is specified
below. The command line remains the authoring surface.

**The problem, in the human's own words:** there must be a way to SEE the slots an object exposes,
"not just knowing they exist or what they would be called — too much remembering." D-092 clause 4's
`props <object>` command answers that for an operator who already knows the object's name and thinks
to ask. The panel answers it for one who has just clicked a shape, which is the actual moment of not
knowing.

**Ruling — the panel.**

1. **It is a GUI element, not a document object.** A DOM node over the canvas. It is never a `table`
   object, never enters `state.document`, never goes through `mutate`, is never saved, and does not
   appear in `list`. Vocabulary: **"the properties panel"**; its two groups are **"modifiable slots"**
   and **"derived slots"**. Do not call it a table anywhere in code, comment, or log line.
2. **It is shown exactly when `state.interaction.selectedObjectId` resolves to an object**, and
   hidden otherwise — including for a stale id (D-023-shaped), which draws no highlight either.
   One selection, therefore one panel. Two panels is a linking gesture and belongs to Q-014's
   remaining half.
3. **The object's NAME is the panel's header, and the canvas name label for the SELECTED object is
   suppressed while the panel is open.** The human's word is "move": the name is in one place at a
   time, not two. `renderDocument` already receives `selectedObjectId`, so skipping that one object's
   chrome name is a one-line condition. The error badge and the formula-driven ticks are NOT
   suppressed — they mark the shape, and the panel says the same thing in words.
4. **Two columns, one row per slot: the slot PATH and its VALUE.** The path is written exactly as the
   operator would type it after the object's name — `origin.x`, `radius`, `vertices` — because the
   header carries the name and `<name>.<path>` is the address (§5.2/§5.3). Do not invent a display
   spelling.
5. **Two groups, separated by a THICK rule, in this order: modifiable above, derived below.**
   Modifiable = every slot whose kind is `literal` or `formula` (the two an operator may `set`,
   `link`, or `unlink`). Derived = kind `derived`. **Derived rows are rendered in italics; modifiable
   rows are not.** This is D-092 clause 5's point carried into pixels: the kind IS what the operator
   is allowed to do, and a slot they cannot write must be unmistakable before they try.
6. **A `formula` slot is a modifiable row and shows BOTH its source and its value** — the source
   reconstructed by `formula/format.ts` against current names, prefixed `=`, and the last evaluated
   value. A formula slot is writable (that is what `set`/`unlink` do to it), so it does not go below
   the rule; the `=` is what distinguishes it from a literal.
7. **Row order is SCHEMA declaration order** — `resolveNonDerivedSlotPaths`'s order, then
   `derivedSlots`' order — never `Object.keys(object.slots)` insertion order. The panel must not
   reshuffle itself when a slot is written.
8. **A table's cells are NOT enumerated.** `resolveNonDerivedSlotPaths` for a large table returns tens
   of thousands of paths (0078-REVIEW measured 90,000–130,000) and D-077 forbids spreading a
   collection the user can size. A table gets ONE modifiable row for `cells`, whose value names the
   grid and how many cells are written. Per-cell editing is §5.4's formula bar, not this panel.
9. **ONE enumeration serves both `props` and the panel.** A new pure module **`src/command/props.ts`**
   exports the descriptor type and the function that builds it from a `GraphObject` plus the object
   list (it needs the list only to format formula sources against current names). `commands.ts`'s
   `props` handler formats its log lines from that function's output; the panel renders rows from the
   same output. **A second enumeration of an object's slots is forbidden** (D-010's shape): the
   command and the panel must never be able to disagree about what an object has.
   `describeSlotValue` moves or is exported so one formatter serves both.
10. **The panel is READ-ONLY this cycle.** No inputs, no click handlers, no `mutate`, no `Command`
    built anywhere near it. Give it `pointer-events: none` so every click passes through to the
    canvas beneath — that keeps D-085/D-088's focus discipline untouched by construction, and there
    is nothing to click yet. Editing and linking by mouse remain **Q-014**, the human's alone.
11. **Placement is a PURE function, and only element writing lives in `start`.** Export from
    `render/` a function taking the object's extent, the camera, the viewport size and the panel's
    measured size, returning the panel's CSS-pixel top-left. It anchors to the LEFT of the object's
    extent with its top edge at the extent's top (the human's sketch), flipping to the RIGHT when it
    would overflow the left edge, and clamped to stay inside the canvas. Test that function. Entry
    0090 found four defects and all four were in untested `start` code; this arithmetic does not have
    to join them.
12. **The panel is positioned in CSS pixels, and `worldToScreen` returns BACKING pixels.** D-086
    clause 3's conversion runs here too, in the other direction — divide by the ratio the canvas
    actually has (`canvas.width / bounds.width`), read off the canvas the way `screenPointOf` reads
    it, never `devicePixelRatio` multiplied by assumption. A panel that drifts from its object on a
    125%-scaled display is this conversion, missed.
13. **Re-placed every paint.** The camera pans and zooms under it; the panel is screen-space furniture
    hanging off a world-space anchor, exactly like the chrome in pass 3.
14. **Names and values are user text: build rows with `textContent`,** never `innerHTML`. An object
    named `<b>` is legal under §5.2's grammar.

**Explicitly NOT ruled in, and not to be invented (Rule 5):** the sketch's dashed leader line between
panel and object (it would need the panel's screen rect back inside the renderer — a real coupling,
deferred, and the human may ask for it); a close button, a drag handle, a collapse, a resize, a
scrollbar policy beyond the browser's default; any hover behaviour; a second panel; per-cell rows.

**Rationale.** The project's thesis is wiring objects together in a vocabulary of names and slot
paths. D-092 made that vocabulary readable to an operator who asks in words. The human's argument is
that asking in words is still remembering, and the moment they need it is the moment they have
clicked a shape. The panel is display only, so it does not become a second authoring path (D-069
stays true, Rule 2 is untouched), and every hard question about editing stays exactly where it was.
What it costs is one DOM node, one pure placement function, and the enumeration `props` was going to
write anyway.

---

## D-095 — Object chrome hangs from the TOP-CENTRE of the drawn extent, and there is no inter-object label collision avoidance
Answers: entry 0094's escalation, questions 2 and 3   Ruled: entry 0095-REVIEW-phase4 (reviewer)
Binding on: `render/renderer.ts`

**Ruling.** The anchor entry 0094 built is correct and stands: chrome hangs from `objectExtent`'s
top-centre, on one measured line, in screen pixels. Do not move it to the top-left; a corner title
reads as belonging to a corner, and a circle has no corner. **No collision avoidance between the
labels of two adjacent objects is to be built** until a human has looked at a crowded canvas and said
it is a problem. Overlapping labels are noise, not a defect; a layout solver invented on suspicion is
Rule 5's exact failure mode, and D-094's panel takes the selected — that is, the currently
interesting — object's label off the canvas anyway.

**Rationale.** Both questions ask the reviewer to prefer a guess over what the one human who has
actually seen the screen said. The human saw entry 0093's output, objected to labels inside circles,
and objected to nothing else. Settle the anchor so the next three cycles stop re-opening it.

---

## D-096 — A ruling's file list states intent, not a quota; and the table `cells` summary keeps `kind: "literal"`
Answers: entry 0097's three questions to the reviewer, and the one undisclosed departure found in
entry 0096   Ruled: entry 0098-REVIEW-phase4 (reviewer)
Binding on: `src/command/props.ts`, `src/render/slots.ts`, and every future cycle executing a
ruling that enumerates files or moves

**1. A ruling's enumerated list is a ceiling, and a departure from it must be NAMED.**
D-093 clause 1 listed five declarations to move into `render/slots.ts`. Entry 0096 moved four:
`TABLE_CELL_TEXT_PADDING` stayed in `renderer.ts`. **That was the right call and it is ratified** —
the constant is module-private with exactly one consumer, and moving it would have widened a private
constant into an export for no second reader, against `slots.ts`'s own stated purpose ("the reads
more than one file in `render/` makes", D-093 clause 1's own words). What was wrong is that entry
0096 did not say so: it described the slice as D-093's split and listed four moves without noting
that the ruling named five.

The rule, general: **when a ruling's literal text and its stated rationale diverge, follow the
rationale and NAME the divergence in the log entry.** A reviewer reading a ruling against a diff
counts what the ruling listed; an unexplained shortfall reads as an oversight and costs a round-trip
to distinguish from one. This is not a §6.1 trigger 3 escalation (the brief is not ambiguous and
nothing load-bearing moved) — it is a disclosure duty, discharged by one sentence in "Decisions I
made."

**2. The table's synthetic `cells` row keeps `kind: "literal"`. `SlotDescriptor` does NOT grow a
fourth kind.** (Entry 0097's question 2.) `kind` means "what the operator may do with this slot"
(D-092 clause 5, carried into pixels by D-094 clause 5), and `"literal"` puts the row in the
modifiable group, which is where D-094 clause 8 puts it. A `"summary"` kind would have to be handled
by every reader of `kind` — including the two grouping branches D-094 clause 5 specifies — to say
one thing the panel does not yet need to know, and the panel is READ-ONLY (D-094 clause 10): it
offers no editing to be mistaken about. **When editing arrives** (Q-014's remaining half, unruled),
that cycle adds `readonly synthetic?: true` to `SlotDescriptor` and refuses to open an editor on a
row carrying it — an additive optional field, not a widened union. Do not add it before there is a
reader.

The summary's value stays a plain string, quoted by `describeSlotValue` like any other string
(`cells = "4×4 grid — 2 of 16 cells written" (literal)`). A bypass field in the shared formatter for
one synthetic row is more machinery than the cosmetic gain is worth (Rule 5), and entry 0097's own
reasoning for declining it is adopted here rather than re-argued.

**3. The dynamic-group summary may be reached by an explicit `object.type === TABLE_TYPE` check.**
(Entry 0097's question 1.) D-094 clause 8 is written about tables, `TABLE_SCHEMA`'s `cells.*` is the
only `dynamic` `NonDerivedSlotPathGroup` in the registry, and a generic "summarise any dynamic group"
mechanism would be a second abstraction invented for a second case that does not exist (Rule 5).
**The silent DROP of a future, non-table dynamic group is the required failure direction** — a group
that vanishes from `props` is a visible gap someone reports; one that spreads path-by-path is a
D-077 violation that can hang the application on a large table. **A new `dynamic` group anywhere in
`primitives/schema.ts` MUST add its own summary branch in `props.ts` in the same cycle**, and the
disclosure already in `props.ts`'s header is what tells that cycle so.

**4. `props`'s registry position and its unknown-name message stand.** (Entry 0097's question 3.)
Between `refs` and `list`, and `no object named "..."` verbatim as `refs`/`select`/`delete` say it.
Identical refusals for identical failures is D-069's shape; nothing to change.

---

## D-097 — A slot that SIZES a dynamic slot family is bounded at EVERY write, not only at creation
Answers: the human's manual-test report at entry 0100 ("setting a table's rows or cols makes it
disappear from view... still appears with `list`... isn't visible with `fit`"), reproduced by the
reviewer   Ruled: entry 0100-REVIEW-phase4 (reviewer)
Binding on: `src/engine/mutation.ts`, `src/engine/primitives/table.ts`, and every future `dynamic`
`NonDerivedSlotPathGroup`

**The defect, reproduced four ways, every one of them reporting SUCCESS.** Against `table x=0 y=0
rows=3 cols=3`:

| typed | log line | `rows` slot after | `objectExtent` |
|---|---|---|---|
| `set table_1.rows = 5` | `table_1.rows = 5` | `{kind:"formula", value:5}` | `undefined` |
| `set table_1.rows 0` | `table_1.rows = 0` | `{kind:"literal", value:0}` | `undefined` |
| `set table_1.rows -2` | `table_1.rows = -2` | `{kind:"literal", value:-2}` | `undefined` |
| `set table_1.rows 2.5` | `table_1.rows = 2.5` | `{kind:"literal", value:2.5}` | `undefined` |

In each case the table stops drawing, `fit` answers *"nothing on the canvas has an extent to fit
to"*, `props` reports `cells = "0×3 grid — 0 of 0 cells written"`, and `list` still shows
`table_1 — table`. The operator is told the write succeeded and the object silently leaves the
visible world.

**Why it happens, and why D-046 is NOT the bug.** `readTableDimension` fails safe to `0` for a
dimension that is not `literal`, not an integer, or negative (D-046, Rule 6). That read is correct
and stays. What is missing is the other half: **nothing refuses to CREATE such a dimension.**
`commands.ts` bounds `rows`/`cols` at CREATION only (`MIN_TABLE_LINES`/`MAX_TABLE_LINES`, D-070);
`set` writes through the generic `writeSlot` → `setSlot` path, which knows nothing about
dimensions. So the guard fires, correctly, against a state the system itself let the operator
build. A fail-closed read is a backstop against a malformed LOADED document; it was never meant to
be the only thing standing between a typed command and an invisible object.

**Ruling.**

1. **`mutation.ts` REJECTS any batch that would leave a dynamic-family sizing slot in a state
   `readTableDimension` cannot read.** A new `findInvalidDimensionWrites` check, simulated
   left-to-right over the batch exactly as `findInvalidTableResizes` and `findInvalidRenames`
   already are. The rejected states are precisely the four above: a non-`literal` kind, a
   non-number, a non-integer, and a value outside `MIN_TABLE_LINES..MAX_TABLE_LINES`.
2. **The check lives in `mutation.ts`, not in the `set` handler.** Rule 2: every write path —
   `set`, a future panel edit (D-102), a raw `Operation` — must hit the same gate. A command-layer
   check would leave the other paths open, and D-102 is about to add one.
3. **The bounds are D-070's, imported, not re-spelled.** `MIN_TABLE_LINES`/`MAX_TABLE_LINES`
   currently live in `command/commands.ts`; `engine/` may not import `command/`, so they move to
   `engine/primitives/table.ts` beside the primitive they describe and `commands.ts` imports them
   from there. One declaration, two readers (D-010). This move is authorised by this clause and
   must be named in the log entry per D-096 clause 1.
4. **The refusal names the path, the value, and the remedy** — the same shape every other refusal
   here takes. It must not merely say "invalid": the operator's mental model is that they set a
   number, so the message says which rule the number broke. Suggested:
   `table_1.rows must be a whole number from 1 to 1000 held as a literal — a formula there would
   let evaluation resize the table (Rule 6). Got: 2.5`
5. **`unlink` on a dimension remains legal and is the escape hatch** — it turns a formula slot back
   into a literal holding its last value, which clause 1 then accepts or refuses on its merits.
6. **The general rule, for the `dynamic` group that does not exist yet:** a slot that sizes a
   dynamic family is (i) read `literal`-only and fail-closed (D-046), AND (ii) refused at write
   time by this check. Adding a `dynamic` group without adding its sizing slot to clause 1's check
   is the same defect this ruling closes, and D-096 clause 3's "same cycle" duty extends to it.

**What this ruling does NOT do.** It does not make `objectExtent` invent a box for a zero-row table
(D-066 stands — an object that draws nothing has no extent), and it does not touch the read. It
closes the door the operator was walking through, and leaves the fail-safe behind it.

**Pinning required.** One test per row of the table above, each asserting the refusal AND that the
document is bit-for-bit unchanged (Rule 2's rejection invariant). Plus one asserting that a legal
`set table_1.rows 5` still commits and grows the extent.

---

## D-098 — A drag notice is emitted ONCE PER DRAG GESTURE, not once per pointer-move
Answers: the human's manual-test report at entry 0100 ("the message does not need to be sent so
often — dragging a slider spams the chat log with repeat messages")   Ruled: entry
0100-REVIEW-phase4 (reviewer)
Binding on: `src/render/interaction.ts`

**The defect.** §5.9's non-blocking feedback (`planComponent`'s `... did not move: it is driven by
a formula`) is produced by `pointerMove`, which runs on every pointer event. Dragging an object
with one driven component — the human's slider, a circle with a fixed `origin.x` and a free
`origin.y` — emits one identical line per mouse sample and buries the log.

**Ruling.** `DragState` carries the set of notices already emitted during THIS gesture.
`pointerMove` filters a notice it has already emitted from `PointerMoveOutcome.notices` and returns
the widened set in the advanced state. `pointerDown` starts every gesture with an empty set;
`pointerUp` discards it with the drag. A notice whose TEXT differs (a different component, a
different driver after the formula changed mid-drag) is a new notice and is emitted.

**Why not the human's suggested three-second throttle.** A wall clock would put `Date.now()` inside
a pure transition that today is fully deterministic and fully tested — `interaction.ts`'s outcome
would stop being a function of its inputs, every test would need a clock injected, and the injection
is a new seam for a cosmetic problem (Rule 5). Once-per-gesture is *stricter* than three seconds
(a 30-second drag says it once, not ten times), needs no new input, and is pinned by an ordinary
test: two `pointerMove` calls, one notice. **The human may overrule toward a timer** — the state
this ruling adds is where a timestamp would go, so that change stays cheap.

**Scope.** Notices only. `rejection` (the whole step failing) is not deduplicated: it is rare, and
a repeated rejection is information.

---

## D-099 — The properties panel rounds a displayed number to at most 4 decimal places; `props` does not
Answers: the human's manual-test report at entry 0100 ("too many sig figs... keep it to four
decimals past the decimal point displayed"), and their explicit scope choice of panel-only   Ruled:
entry 0100-REVIEW-phase4 (reviewer)
Binding on: `src/command/props.ts`, `src/main.ts`

**What the panel shows today** for `circle x=10 y=20 r=7`: `centroid.x = 10.000000000000002`,
`area = 152.95081246064453`, `length = 43.91167886764314`. Float noise, presented as precision.

**Ruling.**

1. **`describeSlotValue` gains an optional display-precision argument. It does NOT gain a second
   copy.** `describeSlotValue(value, options?: { readonly maxDecimals?: number })` — one switch, two
   callers. `main.ts`'s `buildPanelModel` passes `{ maxDecimals: 4 }`; `commands.ts`'s `props`
   handler passes nothing and its output is byte-identical to today's. This is what keeps the
   human's panel-only choice from producing a third `Value`-to-text formatter, which
   `props.ts`'s header and `STATUS.md` both already forbid.
2. **The rule, applied to every number the option reaches** — including each component of a
   `Point`: round to at most `maxDecimals` decimal places and TRIM trailing zeros, so an integer
   stays bare (`10`, never `10.0000`) and `152.95081246064453` becomes `152.9508`.
3. **A non-zero value that would round to `0` is shown in exponential form instead** (`1.2246e-16`,
   not `0`). Printing `0` for a number that is not zero is a lie the operator cannot detect, and
   these values are exactly where it would happen — a circle centred on the origin has a
   `centroid.y` of float dust. This clause is the reason this is a ruling and not a one-liner.
4. **Untouched:** a non-finite number (unreachable as a `Value` — `finiteOrTypeError` maps it to
   `#TYPE` — so it falls through to `String()` as today), the `n points` summary, the table `cells`
   summary string, the error-value text, and the quoting of strings.
5. **`renderer.ts`'s `formatCellValue` is explicitly OUT OF SCOPE.** On-canvas table cell text keeps
   full precision this cycle. It is the second, disclosed, unreconciled formatter (`STATUS.md`'s
   known problems); the human was asked and chose panel-only. Reconciling the two is its own slice
   and needs its own ask.

---

## D-100 — The selection is a LIST; a plain click replaces it, shift-click adds, escape releases it
Answers: the human's new interaction rules at entry 0100, and their explicit choice of click model
Ruled: entry 0100-REVIEW-phase4 (reviewer)
Binding on: `src/render/interaction.ts`, `src/render/renderer.ts`, `src/main.ts`,
`src/command/commands.ts`

The panel stops being ephemeral. That is a selection-model change before it is a panel change, and
it must land first.

1. **`InteractionState.selectedObjectId: string | undefined` becomes
   `selectedObjectIds: readonly string[]`**, in click order. Plain, serializable, IDs not
   references (Rule 3's posture). `deselect()` returns the empty list.
2. **A plain click REPLACES the selection** with the object hit, or with nothing when the click
   lands on empty canvas. This is today's behaviour, unchanged, and it is the human's choice.
3. **A shift-click ADDS the object hit to the selection.** A shift-click on empty canvas changes
   nothing (it neither clears nor adds) — clearing on a modified click would make an accidental
   miss destroy a multi-selection the operator built deliberately.
4. **Shift-clicking an ALREADY-SELECTED object removes it from the selection** — the reviewer's
   reading, not the human's words. Without it there is no way to drop one object short of clearing
   everything. **PROVISIONAL(Q-015)**, tagged at the site; reversible in one branch.
5. **Escape clears the whole selection and hides every panel.** Escape keeps its existing first
   duty — cancelling a live prompt sequence — and D-102 clause 7 adds a third, innermost one. The
   order is innermost-first: an open panel input, then a live prompt, then the selection.
6. **A drag still targets exactly the object under the press**, whatever else is selected. Dragging
   the whole selection is NOT ruled here and must not be built on suspicion (Rule 5, §4).
7. **`select <name>` REPLACES the selection with that one object.** No multi-select command syntax
   is added; `CommandEffect`'s `{kind: "select", objectId}` is unchanged. The mouse is where
   multi-selection lives, because linking-by-mouse is what it exists for (Q-014's own argument).
8. **`renderDocument`'s `selectedObjectId?: string` becomes `selectedObjectIds: readonly string[]`.**
   Every selected object gets the highlight, and **D-094 clause 3 generalises: every selected
   object's canvas name label is suppressed**, because every selected object now has a panel
   carrying its name. A stale id in the list still draws nothing and suppresses nothing (D-023).
9. **This is a review point.** It changes a shared state shape across three files and every test
   that constructs an `InteractionState`. Stop at the end of it (§6.1 trigger 3 — a deviation from
   the shape every prior cycle was written against).

---

## D-101 — One panel per selected object; a panel may be dragged off its anchor, and re-attaches when reselected
Answers: the human's new panel rules at entry 0100   Ruled: entry 0100-REVIEW-phase4 (reviewer)
Binding on: `src/main.ts`, `src/render/panel.ts`, `index.html`

1. **One panel element per selected object**, each built by `buildPanelModel` from the same
   `buildSlotDescriptors` enumeration (D-094 clause 9 is unchanged and now has N readers of one
   list, not two of one).
2. **Each panel is placed by `placePropertiesPanel` against its OWN object's extent.** The function
   is unchanged — it already takes the extent as an argument, which is why it survives this ruling
   untouched. D-094 clauses 11–13 apply per panel.
3. **No inter-panel collision avoidance is to be built.** D-095 ruled exactly this for canvas
   labels, for the same reason: it is a layout engine, the human has a mouse, and clause 4 is the
   answer. Two panels may overlap.
4. **A panel is dragged by its HEADER**, not by its body — the body is about to hold click targets
   (D-102) and a drag started anywhere would swallow them.
5. **Dragging DETACHES the panel**: its position becomes a manual CSS point held in `AppState`,
   keyed by object id, and `placePropertiesPanel` is no longer consulted for that panel while it is
   detached. A detached panel does not follow pan or zoom — detaching is the operator saying "stop
   moving."
6. **A manual position is discarded when its object leaves the selection.** Re-selecting the object
   re-attaches its panel to the object (the human's rule verbatim). Escape therefore resets every
   panel's position, which is a second reason escape is the release.
7. **A panel position is APPLICATION state, never DOCUMENT state.** It never enters
   `state.document`, never goes through `mutate`, is never saved, never appears in `list` (D-094
   clause 1, restated because N panels make it tempting to store them on the object).
8. **A panel drag must not reach the canvas** — it changes no selection, starts no object drag, and
   pans nothing.

---

## D-102 — The properties panel becomes WRITABLE: the paperclip, and one path to every write
Answers: **Q-014's remaining half**, ruled by the human at entry 0100 (design), and by the reviewer
for mechanism   Ruled: entry 0100-REVIEW-phase4 (reviewer)
Binding on: `src/main.ts`, `index.html`, `src/command/props.ts`
**Amends D-094 clause 10** (`pointer-events: none`) and **closes Q-014**.

The human has ruled the half that was theirs: a slot may be edited from the panel, and two panels
exist so slots can be linked by mouse. What follows is that decision plus the mechanism it needs.

1. **`pointer-events: none` is lifted** — the panel becomes interactive. Disclosed consequence: a
   click landing on a panel no longer passes through to the canvas, so a panel overlapping its own
   object hides part of it from the mouse. This is the cost of the feature and is accepted;
   D-101 clause 5 (drag it away) is the remedy.
2. **Every MODIFIABLE row carries a paperclip affordance.** Derived rows carry none — they are not
   writable and an affordance that refuses is worse than none. A row whose descriptor carries
   `synthetic?: true` (the table `cells` summary — D-096 clause 2's field, which this cycle is the
   one that adds and reads) carries none either.
3. **Bold blue when the slot's kind is `formula`; faded grey when `literal`.** The human's choice:
   the icon reports the slot KIND, not whether the formula happens to reference anything, so a row's
   icon and its `= ...` text can never disagree. Small and low-contrast when grey — the human's
   words are "faded and small, doesn't want to be that apparent."
4. **Clicking a BLUE paperclip performs `unlink <address>`.** Clicking a GREY one opens a text input
   on that row, seeded with the current value.
5. **Every panel write goes through `executeCommand` (D-069), as the Command the command line would
   have built.** The panel constructs an `UnlinkCommand` / `SetLiteralCommand` / `SetFormulaCommand`
   and hands it to the same `apply(...)` path a typed line uses. **The panel MUST NOT call `mutate`,
   and MUST NOT reach into `writeSlot`.** This is the whole reason the feature is affordable: D-069
   already guarantees one place where a `Command` meets a `Document`, so the panel adds an input
   surface and zero new write semantics — including D-097's new refusal, which it inherits for free.
6. **What the operator types is disambiguated ONCE, at commit:** text that parses as a bare number
   becomes `set <address> <number>`; anything else becomes `set <address> = <text>`, with a leading
   `=` the operator typed absorbed rather than doubled. Enter commits; escape or blur cancels and
   writes nothing.
7. **The echoed line and any refusal go to the LOG**, exactly as if typed — including the echo of
   the synthesised command itself, so the log remains a complete record of every write. The panel
   grows no error channel of its own. **Escape with an input open closes the input only** and does
   not clear the selection (D-100 clause 5's innermost-first order).
8. **The panel may no longer be rebuilt from scratch while an input is open.** `updatePanel` today
   calls `writePanel`, which calls `replaceChildren`, on EVERY paint — and paint runs on every
   pointer move. An open input would lose focus, caret, and typed text on the first mouse twitch,
   which makes the feature unusable rather than slow. **This is a correctness requirement, not an
   optimisation, and Rule 5 does not excuse it.** The narrowest fix that satisfies it is the one to
   take: while a row's input is open, that panel is not rebuilt.
9. **Nothing here builds slot-to-slot linking BY DRAGGING between two panels.** Q-014's (ii) is
   reachable now that two panels can be open and a row can be typed into, and the human named
   typing as the mechanism. A drag-a-slot-onto-a-slot gesture is a further feature and needs its
   own ask (§4).

**Q-014 is CLOSED** by this ruling together with D-094 (display), D-100 (selection), and D-101
(panels). §5.10's "no panels, no toolbars" now carries one amendment, made twice by the same human:
a display panel (D-094) that is also an authoring surface (this ruling).

---

## D-103 — The order this batch is built in
Ruled: entry 0100-REVIEW-phase4 (reviewer)   Binding on: the next four cycles

Not a preference — three of these have a dependency and one is a live defect.

1. **D-097** (the vanishing table). A correctness bug the human hit in five minutes of use, in
   `mutation.ts`, independent of everything else. It goes first.
2. **D-098 + D-099** (the notice spam and the four-decimal cap). Small, independent, unrelated to
   each other; one cycle, two files, no shared state.
3. **D-100** (the selection becomes a list). Must precede D-101 and D-102 — both are written
   against a selection that holds more than one object. Review point at its end.
4. **D-101 then D-102** (N panels and dragging; then the paperclip and editing). D-102 clause 8's
   no-rebuild-while-editing requirement is easier against the per-panel structure D-101 builds, and
   D-102 is the first code in this project that writes state from a mouse gesture in the DOM —
   it gets its own review point regardless of the batch cap.

**Phase 4's own gate is still owed and is not any of these.** It needs a human to bind two polygons
through a table in one document. Every item above makes that session easier; none of them is it.

---

## D-104 — D-097's floor binds the row/column DELETE path too, and the check that owns it is `findInvalidTableResizes`
Answers: a gap found while reviewing entry 0101   Ruled: entry 0103-REVIEW-phase4 (reviewer)
Binding on: `src/engine/mutation.ts`, and the cycle that builds §5.10's row/column commands

**The gap.** D-097 clause 1 states the invariant as "`mutation.ts` REJECTS any batch that would
leave a dynamic-family sizing slot in a state `readTableDimension` cannot read." Entry 0101 built
that for `setSlot` and only for `setSlot`. Two other operations write the same two slots:
`insertTableLine` and `deleteTableLine` (`primitives/table.ts` re-asserts BOTH counts as literals on
every call). `findInvalidTableResizes` bounds their INDEX against the current extent, not the
resulting COUNT — so `deleteTableLine` on a one-row table is accepted and lands `rows` on `0`, which
is exactly the vanishing state D-097 closes for a write. Symmetrically, repeated `insertTableLine`
carries a count past `MAX_TABLE_LINES`, which `setSlot` would refuse.

**This is not entry 0101's defect and it is not reachable today.** The gap predates D-097 (the
bounds were creation-only before it), and no `Command` reaches `insertTableLine`/`deleteTableLine` —
§5.10's row/column commands are unbuilt. Entry 0101 built its ruling exactly as written; what it did
not do is notice that the ruling's *stated invariant* is wider than the clause that implements it.
That is a reviewer's finding, not an implementer's miss.

**Ruling.**

1. **The floor is `MIN_TABLE_LINES`: a `deleteTableLine` that would leave `0` lines on either axis
   is REFUSED**, with a message naming the axis and the floor. `insertTableLine` is bounded above by
   `MAX_TABLE_LINES` the same way.
2. **The check that owns it is `findInvalidTableResizes`, not a second pass.** It already simulates
   the batch left-to-right and already carries the running row/column count — the count the bound is
   about. A parallel `findInvalidDimensionResizeBounds` would be a second source of truth for one
   number (D-010).
3. **`findInvalidDimensionWrites` is not widened.** It judges one `setSlot`'s own payload and has
   nothing cumulative to track; that is why entry 0101 gave it a `{name, type}` map rather than
   `TrackedTableState`, and that reading is correct.
4. **Owed by the cycle that builds §5.10's row/column commands**, which is the first cycle that can
   reach these operations from a typed line — and it is that cycle's duty regardless of what its own
   declared slice was, because shipping the command without the bound makes the defect operator-
   reachable in the same breath. Pinned by two tests: deleting the last row of a 1×N table is
   refused with the document bit-for-bit unchanged, and inserting past `MAX_TABLE_LINES` likewise.
5. **Until then it is disclosed, not silently carried** — `primitives/table.ts`'s `NOT DONE HERE`
   and `findInvalidDimensionWrites`'s own doc comment both name it (reviewer edits at this entry),
   and `STATUS.md` carries it under known problems.

**The general form, restated for the next `dynamic` group** (D-097 clause 6, widened): a sizing
slot's bound must hold at EVERY path that writes it — creation, direct write, and any structural
operation that recomputes it. Enumerate the writers, not the commands.

---

## D-105 — A press never inherits a drag; and name suppression may not outlive the panel that replaces the name
Answers: two findings against entry 0104   Ruled: entry 0105-REVIEW-phase4 (reviewer)
Binding on: `src/render/interaction.ts`, `src/render/renderer.ts`, `src/main.ts`

**1. Every `pointerDown` ends whatever drag was armed before it, on every branch.** Entry 0104's
additive/empty-canvas branch returned prior `state` verbatim, drag included, while the plain-click
branch cleared it. D-100 clause 3's "changes nothing" is about the SELECTION — it says nothing about
a gesture. This matters because `main.ts` binds `pointerup`/`pointercancel` to the CANVAS: a release
outside the canvas leaves a drag armed, and the next shift-click on empty canvas would have kept it,
so the following `pointerMove` moves an object nobody is holding. Fixed by reviewer edit at this
entry, with two tests. **The general form: a press is the start of a gesture, so no branch of
`pointerDown` may hand one forward.**

**2. A name is suppressed only where something else is showing it.** D-094 clause 3's rationale is
that the name MOVES into the panel header; D-100 clause 8 generalised the suppression to every
selected object on the strength of D-101's panels, which are not built. Entry 0104 correctly declined
to invent interim multi-panel behaviour (its "Decisions I made" item 3, ratified), and the resulting
gap — two objects selected, both names off the canvas, no panel showing either — is ACCEPTED for
exactly one cycle. **It is bounded, not open-ended:** if D-101 does not land in the next cycle, the
cycle after it narrows suppression to the objects that actually have a panel. Until then the gap is
disclosed in `STATUS.md`'s known problems (reviewer edit at this entry), not silently carried.
Building a throwaway interim would have been the Rule 5 failure; leaving the gap unnamed is the
D-096 clause 1 failure. Neither is on offer.

---

## D-106 — Every selected object's panel is shown BY DEFAULT; a panel is dismissed one at a time, and dismissing it gives the object its canvas name back
Answers: the human's ruling at entry 0105-REVIEW, points 1 and 2   Ruled: entry 0106-RULINGS
(reviewer, recording the human's decision)   Binding on: `src/main.ts`, `src/render/renderer.ts`,
`index.html`
**Confirms D-100 clause 4 as final (closes Q-015). Extends D-101. Discharges D-105 clause 2.**

**The human's words: "multi-select should default to showing panels for each selected object. There
should be a way to 'hide' panels, but the default behavior should be to show them all."**

1. **The default is SHOW ALL.** D-101 clause 1 is confirmed, not amended: selecting N objects shows
   N panels, with no cap, no "too many panels" heuristic, and no collapse-to-one fallback (D-101
   clause 3's stance — the operator has a mouse). Entry 0104's interim "hide the panel when two or
   more are selected" is a placeholder and **must be gone at the end of the next cycle.**
2. **A panel carries a DISMISS control in its header** — one per panel, hiding that panel alone.
   The header is where it goes because D-101 clause 4 already makes the header the panel's own
   chrome, and D-102 clause 2 makes the body rows' affordances mean something else entirely.
3. **Dismissing a panel does NOT deselect its object.** The object stays selected and stays
   highlighted. Hiding is about screen space, not about what the operator is working on — the two
   were deliberately separated the moment the selection stopped being ephemeral (D-100).
4. **A DISMISSED PANEL'S OBJECT GETS ITS CANVAS NAME LABEL BACK.** This is the general rule D-105
   clause 2 was holding open, now settled: **a name is suppressed only where something else is
   showing it.** D-094 clause 3's rationale is that the name MOVES into the panel header; with no
   panel there is nothing to move it into, and an object with neither a label nor a panel is
   unnameable on screen.
5. **Therefore `renderDocument` takes the panelled ids as well**, and suppression reads THEM while
   the highlight keeps reading the selection:
   `renderDocument(ctx, w, h, objects, camera, selectedObjectIds, panelledObjectIds = selectedObjectIds)`.
   The default is what keeps every existing call site and test meaning "the panel follows the
   selection" without an edit, and it states the normal case in the signature. Two lists, because
   the two passes now genuinely answer different questions — do NOT collapse them back into one.
6. **Dismissal is APPLICATION state, keyed by object id, and is DISCARDED when the object leaves
   the selection** — the same lifetime, the same place, and the same reasoning as D-101 clause 5's
   manual positions. **Re-selecting a dismissed object shows its panel again**, which is also the
   whole re-show gesture: shift-click it out and back in, or escape and reselect.
7. **No panel manager, no "restore hidden panels" list, no count badge.** Clause 6 is the way back;
   a second UI for managing a UI is Rule 5's failure mode, and nobody has asked for one.
8. **Escape's duty list is unchanged** (D-100 clause 5, D-102 clause 7). Dismissal is a click on a
   control, never a key — escape releases the whole selection, which already hides every panel.

---

## D-107 — A panel gesture never leaves the keyboard homeless, and a handler on DOM a repaint will destroy must own its identity
Answers: findings F1 and F2 against entries 0107 and 0109   Ruled: entry 0110-REVIEW-phase4
(reviewer)   Binding on: `src/main.ts`, and every control the properties panel grows hereafter

Two rules, from one cause: the panel is interactive DOM (D-102 clause 1) that `updatePanels`
rebuilds whole on every paint, and paint runs on every pointer move.

1. **After any panel gesture that is not itself an open text editor, the command input holds the
   keyboard.** §5.10's "always focused when the user is not editing text or a cell" is a rule about
   the whole application, not about the canvas — and `canvas`'s own `pointerdown` has called
   `preventDefault()` + `input.focus()` since entry 0091 for exactly this reason. A press on a
   panel, and the end of a panel edit, owe the same. Concretely: prevent the press's default so the
   DOM never moves focus on its own, then place focus deliberately — the command bar when no row
   editor is open, the row's input when one is.
2. **A listener bound to an element a repaint will destroy must check that it still owns what it is
   about to change.** A blur fired *by* the repaint that removed the element is indistinguishable
   from a blur the operator caused; `panelEditInput`'s `settled` flag (entry 0109) is half of the
   answer and covers one input's own double-fire. The other half is that `onCancel` must act only
   while the editor it names is still the open one. The general form: **an event handler for
   transient DOM is idempotent AND identity-checked, or it will eventually cancel someone else's
   gesture.**

Rationale: F2's swallowed click is what happens when neither holds — the press's own default blurs
an open input, the resulting cancel repaints, and the node the click was destined for is gone before
the click is dispatched. Both halves are cheap, and both get more load-bearing with every control
D-102 clause 9 and its successors add.

**This does not license a retained-mode panel.** Rebuild-every-paint stays the default (D-101,
D-102 clause 8's exception is the only one); these rules are what make that default safe to keep.

---

## D-108 — A loaded `FormulaAst`'s SHAPE is validated once, at the load boundary, by the cycle that builds §5.11's load path — and no walker is hardened piecemeal in the meantime
Answers: finding F5 at 0113-REVIEW-phase4 (the loader's "never throws" invariant is false for a
malformed loaded AST)   Ruled: entry 0113-REVIEW-phase4 (reviewer)   Binding on: `document.ts`,
`mutation.ts`, `formula/ast.ts`, and the cycle that builds §5.11's file-input load path

**Ruling.**

1. **The claim is corrected now; the code is fixed by the load cycle.** `document.ts`'s header and
   `deserializeDocument`'s doc comment both state "never throws" without qualification, and that is
   false today: `reconstructSlot` casts `raw.ast as FormulaAst` unchecked, and a loaded `ast` of
   `null`, a `binaryOp` with absent or `null` children, or a `functionCall` whose `args` is not an
   array throws a `TypeError` out of the loader. Any cycle that opens either doc comment for another
   reason MUST correct the claim to name the exception. A false invariant in a header is worse than
   a missing one — it is what stops the next reader from probing.
2. **The fix is ONE shape validation at the boundary, not a guard in each walker.** The loaded AST
   is validated once, where it enters the program, against `FormulaAst`'s own variants — the same
   posture D-083 clause 4 established for its DEPTH and for the same reason. This is the shape
   D-083's rationale already anticipated: "a document is validated when it is read, once, the way
   every other unchecked-cast field in a loaded document will have to be."
3. **Until that cycle runs, NO walker over a loaded AST is individually hardened.** Guarding
   `exceedsMaxFormulaAstDepth` against a non-node would not restore the invariant — it would only
   move the throw back to `mutation.ts`'s `collectIllegalAstLiterals`, which threw on the identical
   four inputs before entry 0112 existed. A local guard here buys nothing and costs a reader the
   evidence that the real defect is one level up. The same applies to `collectIllegalAstLiterals`,
   and to `deps.ts`/`eval.ts` if they ever become reachable with an unvalidated AST.
4. **`parser.ts`'s `default:` branch is the model for a walker's own posture, and it stands.** A
   walk that meets a variant the compiler believes impossible returns a value rather than throwing
   (0032-REVIEW). `exceedsMaxFormulaAstDepth`'s `default: return false` is correct as written and is
   not what this ruling asks anyone to change.

**Rationale.** This is the third sighting of one hazard: 0032-REVIEW reasoned about it for
`parser.ts`, D-083's rationale probed it and found `RangeError`s in three functions, and 0113-REVIEW
found it throwing out of the loader itself. Each time it surfaced, the cycle in front of it could
only have patched its own walker, which is why it keeps coming back. It is not reachable by any
operator today — §5.11's file input is unbuilt, so `loadDocument` has no caller outside tests — and
the cycle that builds that input is the one that has to weigh what refusing a user's saved file
costs. That cycle therefore owns it, and inherits a decided direction rather than an open question,
exactly as **D-081** handed the name gate to the cycle that could actually reach it.

Reconciliation required: none outstanding. `document.test.ts`'s "never throws for any of the
malformed inputs above" test does not currently cover a formula slot at all; the load cycle MUST
extend it to the four shapes named in clause 1, and that extension is the intended visible diff.

---

## D-109 — A table cell's text is bounded by its cell; and a REFUSED command keeps what the operator typed
Answers: findings F7 and F8 at 0114-REVIEW-phase4-gate, both found by the human's own gate session
Ruled: entry 0114-REVIEW-phase4-gate (reviewer)   Binding on: `render/renderer.ts`'s `drawCellText`
and `formatCellValue`, and `main.ts`'s command input listener

**Ruling.**

1. **A cell's NUMBER is drawn with a decimal bound, the same way the properties panel's is.**
   `formatCellValue` gets the treatment D-099 already gave `describeSlotValue`: round to at most
   four decimals, trim trailing zeros so an integer stays bare. This is NOT a reconciliation of the
   two formatters — D-099 clause 5 keeps them deliberately separate and that stands; it is the same
   *rule* applied in the second place it was always needed. `146.8212157315694` drawing across its
   neighbour is the defect; `146.8212` is the fix.
2. **A cell's TEXT is clipped to its cell, whatever its type.** Rounding is not sufficient and must
   not be mistaken for the whole fix: a long string ("Circle Radius Below") overruns identically,
   and so would a large enough integer. `drawCellText` constrains what it draws to
   `TABLE_CELL_WIDTH` minus its padding. **Rule 5 governs the mechanism** — the dumbest correct
   thing (a `ctx.save()`/`clip()`/`restore()` around the cell rect, or a measured truncation with an
   ellipsis) is the specified one; do not build column auto-sizing, wrapping, or a tooltip. Whether
   an elided cell gets a visual marker is a display question for whoever builds it, and either
   answer is compliant.
3. **A refused command leaves the typed line in the input; only a SUCCESSFUL one clears it.**
   `main.ts` currently clears unconditionally before submitting, so every refusal in the system —
   a mistyped address, a cyclic formula, a D-097 dimension refusal, a `#PARSE` — costs the operator
   the whole line, and costs most exactly where lines are longest. The refusal already reaches the
   log; the text stays put so it can be corrected in place. Select-all-on-refusal is permitted (so
   retyping over it still works); silently re-running anything is not.
4. **This is not D-089 and does not discharge it.** Command HISTORY (recall a previous line) stays
   queued and unbuilt. Clause 3 is the narrower thing: do not throw away the line the operator is
   still holding. A cycle that builds D-089 must not treat clause 3 as already covered by it.

**Rationale.** Both halves were found by a human using the application for ten minutes, and neither
is reachable by any test the project would plausibly have written — `formatCellValue` has returned
`String(value)` since entry 0062 and the input has cleared unconditionally since entry 0089, both
reviewed and both green the whole time. That is the argument for **D-084**'s insistence on a human
session at a gate, restated with evidence: `renderer.test.ts` pins the exact `fillText` calls for a
cell and still could not see that the text was too wide for the box it was in, because no assertion
compares the two.

Clause 3 is separated from **Q-018** deliberately. The human raised losing a typed formula and the
empty-cell refusal as one complaint; they are two defects, and this one is fixable now, is
independent of how Q-018 is ruled, and removes most of the pain either way.

Reconciliation required: none. No `PROVISIONAL` tag; no existing behaviour depends on a cell
overrunning its border or on a refusal clearing the input.

---

## D-110 — A bare reference to an EMPTY in-extent cell reads as `0`. D-047 clause 4 is REVERSED for cells, and for cells only
Answers: Q-018   Ruled: the human, at entry 0114-REVIEW-phase4-gate   Binding on: `mutation.ts`'s
`deriveEdges` and `validateIntegrity`, `graph/eval.ts`, and every future reference consumer

**Ruling.**

1. **A `ReferenceNode` naming a cell of an EXISTING table, INSIDE that table's extent, evaluates to
   `0` when that cell has no slot** — instead of being a dangling reference that `validateIntegrity`
   rejects. This REVERSES D-047 clause 4's bare-reference half and supersedes 0080-REVIEW's F4.
   Everything D-047 says about RANGES is untouched and still stands.
2. **A cell holding `null` reads `0` under a bare reference too.** D-047 clause 3's principle is
   preserved verbatim and is the reason: "Both representations of 'empty' must behave identically,
   because which one a table uses is decided by the still-unbuilt creation/resize cycle and no
   aggregate may depend on that choice." That principle now binds bare references as well as ranges.
   A cycle that makes the two diverge has broken this ruling, not merely styled it differently.
3. **The reference evaluates to the NUMBER `0`, before anything downstream sees it.** No function,
   operator or aggregate gets a special case: `= A1 + 1` is `1`, and `SUM(A1, 1)` is `1`, on an empty
   `A1`. This is the half of D-047 clause 4 that also moves — "an explicit scalar argument is
   untouched" no longer holds when that argument is a reference to an empty CELL, because clause 1
   has already turned it into `0` by the time arity and type checking run. An explicit `null`
   LITERAL is not a reference and is not covered here; it stays `#TYPE`.
4. **NO EDGE is emitted for a reference to an empty cell**, exactly as D-047 clause 1 already
   requires for range members. Nothing needs to remember to add it later: the edge set is
   re-derived from stored ASTs on every mutation and is never hand-maintained (Rule 6, §9's
   standing prohibition), so populating the cell makes the edge appear on its own, at that
   mutation, and the dependent recomputes in that same topological pass.
5. **A cycle that only exists once the cell is populated is caught at THAT mutation**, and is
   rejected there in the ordinary way. `[A2 = D1]` with `D1` empty is legal and acyclic; a later
   `set D1 = A2` is rejected as cyclic when it is attempted. Cycles remain rejected at mutation
   time and never become state (§9).
6. **The narrowness is the ruling.** Each of these still REFUSES, unchanged: a cell OUTSIDE the
   table's extent (there is no bound to make it legal — D-044); a reference to an unknown object; a
   slot path the object's schema does not declare; any non-cell slot that does not exist. Q-018's
   option (b), "any unset slot reads 0", was rejected on sight and stays rejected — outside a table
   there is no extent, so it would make every mistyped address silent.

**Rationale.** The human ruled this after meeting it live in the Phase 4 gate session, which is the
context D-042 reserves product behaviour to them for. It is the spreadsheet idiom the brief already
appeals to elsewhere, and §5.4 leans on that idiom explicitly ("`#REF` is the expected spreadsheet
idiom"). It also does NOT weaken §5.1.1: an in-extent cell address is a legal, bounded address
already (D-044 bounds ranges by extent for this exact reason), so "legal address, unpopulated" is
expressible without any edge pointing at nothing. Clause 4 is what makes that true rather than
merely claimed.

**The cost, accepted with eyes open:** a typo inside the extent now goes silent. `= table_1.Q9` on
an empty `Q9` computes `0` rather than saying `Q9` is empty. This was put to the human as the whole
trade and they took it; a later cycle may NOT re-litigate it on the grounds that it is surprising.

**Not an inconsistency, though it looks like one at a glance:** a RANGE still OMITS empty cells
(D-047 clauses 1-3) while a BARE REFERENCE now reads them as `0`. Both match the idiom — every
mainstream spreadsheet ignores blanks in `AVERAGE(A1:A5)` and yields `0` for `=A1` — and the
distinction is D-047's own: a range names a REGION whose membership the system computed, a
reference names ONE slot the user wrote. That distinction survives; what changed is only what the
second one MEANS when the named cell is empty.

**Consequence to disclose when built:** `refs` will not report a formula that references an empty
cell as a dependent of it, because there is no edge (clause 4). That is correct and follows from
the ruling, but it is surprising enough that the implementing cycle must state it in its log and
in `STATUS.md`'s known problems.

Reconciliation required: this is a `REVIEW: REQUIRED` slice — it touches `deriveEdges`,
`validateIntegrity` and evaluation, all load-bearing (§6.2). It MUST NOT be taken as a provisional
guess or folded into an unrelated cycle. `mutation.test.ts`'s and `commands.test.ts`'s existing
tests asserting the REFUSAL (`"references a slot that does not exist"` for an in-extent empty cell)
will FLIP — that is the intended visible diff, not a test being weakened, and it fires §6.1 trigger
5 for the cycle that does it. Fix-list item 2 ("give the missing-slot refusal a remedy") narrows to
the cases clause 6 keeps refusing.

---

## D-111 — Phase 4's gate does NOT owe an empty-cell cycle case; D-110's own cycle owes it, and must pin clause 5 executably
Answers: entry 0115's question for the reviewer   Ruled: entry 0116-REVIEW-phase4-gate   Binding on:
the cycle that builds **D-110**, and on any later reading of what Phase 4's gate covers

**Ruling.**

1. **Phase 4's gate is not widened for it.** Entry 0115 asked whether "no false cycle" wants a third
   case — a cycle that closes only once an empty cell is populated. It does not, because that case
   is UNREACHABLE today: an in-extent empty cell is still a refused dangling reference until D-110
   is built. A test written now would pin the CURRENT refusal, not the future cycle, and D-110's own
   cycle would have to rewrite it. **A gate test pins its criterion; it does not anticipate a
   ruling.**
2. **The third case the gate DID owe is a different one, and it is now built** (0116-REVIEW's edit
   to `main.test.ts`): the round trip through ONE object — `table_1.A1 → polygon_1.origin.x →
   polygon_1.centroid.x → table_1.C1`. Rationale: the gate document binds through TWO polygons, so
   its object-level graph (`polygon_2 → table_1 → polygon_1`) is acyclic even for an implementation
   whose graph is object-granular rather than slot-granular. `not.toContain("cyclic")` over that
   document therefore could not fail, whatever the graph's granularity. §5.1's own motivating
   example is the shape where it CAN fail, and "no false cycle" is the clause that exists to catch
   it. **A negative assertion is only worth what the positive case behind it costs.**
3. **D-110's implementing cycle MUST pin clause 5 executably**, in the same cycle, and its log must
   name the test: `A2 = D1` with `D1` empty is ACCEPTED and reads `0`; the later `set D1 = A2` is
   REFUSED as cyclic, naming both slots; and the refused mutation leaves prior state bit-for-bit
   unchanged (§5.1). Clause 5 is the half of D-110 that is easiest to believe without checking —
   "the cycle appears on its own at the populating mutation" is a claim about edge re-derivation
   (clause 4), not a claim about a message, and nothing else in the suite reaches it.

**Rationale.** This is the answer to a question the gate's author put to their reviewer, and both
halves matter: what the gate must NOT grow (an anticipation of an unbuilt ruling, which dates the
moment the ruling lands) and what it was actually missing (the only shape in which its own
"no false cycle" clause could ever have gone red). It protects §5.1's slot-granularity decision,
which is the most expensive structural choice in the project and until now was pinned nowhere as a
composite — `geometry.test.ts:418` pins a table driving a polygon's derived slot, which is the
one-directional half.

Reconciliation required: none now. No `PROVISIONAL` tag. Clause 3 binds the D-110 cycle at the
moment it is scheduled.

---

## D-112 — `refs <object>` and `refs <cell>` answer DIFFERENT questions under D-110, and must not be harmonised
Answers: a finding at 0119-REVIEW (no `Q-NNN` was raised)   Ruled: entry 0119-REVIEW-phase5 (reviewer)
Binding on: `command/commands.ts`'s `refs`, and on any future reading of D-110's disclosed consequence

**Ruling.**

1. **`refs <cell>` reports the CURRENT edge set, so it does NOT name a formula reading that cell
   while the cell is empty.** This is D-110 clause 4 working as ruled — there is no edge — and it
   is the disclosed consequence D-110 required the implementing cycle to state.
2. **`refs <object>` DOES name that same formula, and is CORRECT to.** It derives its blocking half
   over the document **without** the target object (`commands.ts`'s `refs`, unchanged since
   0082-REVIEW). With the table gone from that candidate list the reference is no longer in any
   extent, so `isInExtentTableCellAddress` returns `false`, the edge reappears, and the report
   matches what `delete <object>` will actually refuse.
3. **The two are therefore not in conflict and NEITHER may be "fixed" to match the other.** Making
   `refs <cell>` report the dependent would reintroduce the edge D-110 clause 4 removes. Making
   `refs <object>` stop reporting it would let `refs table_1` say "nothing references table_1"
   about a document whose `delete table_1` is refused — the precise failure §5.1.1 provides the
   command to prevent ("Without that, rule (1) is merely annoying; with it, it is workable").
4. **D-110's own "Consequence to disclose when built" is therefore NARROWER than its wording**, and
   any restatement of it must say which form it is about. The unqualified sentence "`refs` will not
   report a formula that references an empty cell" is false for the object form.

**Rationale.** The mechanism is not new and is not D-110's: `refs`'s own header has documented it
since 0082-REVIEW for the D-047 range case (`table_2.A1 = SUM(table_1.A1:table_1.A4)` over unwritten
cells expands to no edges at all, and becomes one fallback edge only once the table is gone).
D-110's single-cell case rides on that existing design for free, which is why entry 0118 correctly
needed no change in `command/commands.ts` — but the reason it needed none is stronger than the one
that entry gives ("nothing there duplicates the dangling-reference check"), and worth pinning
before a later cycle reads the asymmetry as a bug and closes it.

Pinned by a test at 0119-REVIEW (`commands.test.ts`, the `refs` block): both forms over one
document, plus the refused `delete` they must agree with. Mutation-checked — collapsing
`afterRemoval` onto the current edge set turns it red with `refs table_1` reporting nothing.

Reconciliation required: none. No `PROVISIONAL` tag. `STATUS.md`'s statement of D-110's disclosed
consequence is corrected by this review.

---

## D-113 — D-109 clause 3 covers a refused PROMPT STEP answer, not only a refused complete command
Answers: entry 0117's Decision 2, which declared the reading rather than assuming it
Ruled: entry 0119-REVIEW-phase5 (reviewer)   Binding on: `main.ts`'s `advance`

**Ruling.** A prompt sequence's step answer that is REFUSED keeps the operator's typed text in the
command input, exactly as a refused complete command does. `advance`'s `"prompting"` arm reports
`refused` as `session.error !== undefined`, which is set precisely when this answer was rejected
and the SAME step is being asked again (D-072 clause 7); an accepted answer moves the sequence on
and clears the input like any other accepted line. **This is not an extension of D-109 clause 3;
it is that clause read at its own sentence** — "a refused command leaves the typed line in the
input; only a SUCCESSFUL one clears it" — rather than at its list of worked examples, which happen
all to be single-line commands because those are what the human met in the gate session.

**Rationale.** Losing a mistyped radius mid-`circle` is the identical injury D-109 was ruled
against, and it lands on a longer, harder-to-retype answer more often than the single-line case
does. Entry 0117 flagged this as the one place it went beyond the ruling's literal examples and
called it reversible in one line; it is affirmed here so that reversibility does not read as an
invitation. The `"failed"`/`"cancelled"` arm's `true` stays as written, including its comment
saying `"cancelled"` is unreachable through `advance` — a conservative default, honestly labelled
as unexercised rather than presented as tested behaviour.

Reconciliation required: none. No `PROVISIONAL` tag. Pinned by two of entry 0117's seven tests, both
mutation-checked in that entry and re-run at 0119-REVIEW.

---

## D-114 — An embedded `{= }` AST is evaluated through the SAME read/readRange contract a formula slot's AST gets; `graph/eval.ts` is widened for it, and text never grows its own
Answers: entry 0120's own question for the reviewer ("does `resolvedContent`'s `read` closure need
D-110's treatment?"), plus finding F15 at 0121-REVIEW   Ruled: entry 0121-REVIEW-phase5 (reviewer)
Binding on: `graph/eval.ts`, `primitives/schema.ts`'s future `text` entry, `primitives/text.ts`, and
every future derived slot whose dependencies come from an embedded formula AST

**Ruling.**

1. **Same contract, not a parallel one.** An AST embedded in text (`{= expr }`, and a `{? cond }`'s
   condition) is evaluated with a `read` that applies **D-110**'s in-extent-empty-cell coercion and
   with a REAL `readRange` built on `primitives/table.ts`'s `enumerateRangeCellAddresses` — the same
   function `graph/eval.ts`'s `evaluateFormula` and `mutation.ts`'s `deriveEdges` already share. A
   reference means the same thing in a cell and in a text box, or the ordering argument that put
   D-110 before Phase 5 (0116-REVIEW §10) bought nothing.
2. **The fix goes in `graph/eval.ts`'s `evaluateDerivedSlot`, by WIDENING it** — never a second
   evaluation path beside it, and never by handing `resolvedContent`'s compute the formula-style
   closures and quietly abandoning D-013's membership check. `formula/eval.ts`'s own header states
   why the range half must not be re-derived independently ("STRUCTURALLY impossible for evaluation
   and edge derivation to disagree"), and that reasoning binds a third consumer exactly as it bound
   the first two.
3. **The ORDER is the load-bearing half, and it is not obvious.** D-110 clause 4 means an empty
   in-extent cell deliberately has NO edge, so its address is NOT in the declared-dependency set
   `evaluateDerivedSlot` builds. A D-013 membership check applied first therefore returns `#REF` and
   D-110 never gets the chance to return `0` — the two rules collide, and the collision is silent.
   So: for an address `isInExtentTableCellAddress` accepts, the D-110 coercion is consulted BEFORE
   the membership rejection; every other address keeps failing that check exactly as it does today.
   D-013 is not weakened — it still rejects an undeclared read — it simply stops firing on the one
   address class D-110 defines as legitimately edge-less.
4. **The block tree is DERIVED state and is never stored.** It is re-parsed from `content` (a
   literal slot) on demand, the same way the edge set is re-derived every mutation. Do NOT cache a
   `Block[]` into a slot, a document field, or a module-level map: `content` is the single source of
   truth, and a cached tree is a second one that can disagree with it (Rule 5's own posture, and the
   reason nothing here needs to be serializable).

**Rationale.** 0119-REVIEW §3 audited "does this edge exist" against "what does this address read
as" and found the two could not drift, *because both consumers read the same staged object list*.
Text is the THIRD consumer and the first whose `read` comes from a different closure — so that
audit does not carry over on its own, and the gap is measurable today: an embedded
`SUM(table_1.A1:table_1.A4)` extracts a correct `RangeDependency` (so its edges are right) while
`evaluateBlockTree` with the derived-slot `read` returns `#PARSE`, because `evaluateDerivedSlot`
supplies no `readRange` at all (measured at 0121-REVIEW). That is an edge/value disagreement of
exactly the class this project has now ruled against three times (D-017, D-047 clause 1, D-110
clause 4). Entry 0120's Decision 4 — that `evaluateBlockTree` "can pass through with no adapter" —
is the optimistic half of this and is corrected here: the return TYPE composes, the callback
contract does not.

Reconciliation required: none in `primitives/text.ts`, which already takes both callbacks as
parameters and has no opinion on their origin. Binding on the cycle that writes the `text` schema
entry, which MUST land clause 3's ordering with a test that fails if the two are swapped.

---

## D-115 — The block tree's `error` variant is sanctioned, MUST carry the offending span's source and offset, and MUST NOT narrow dependency extraction
Answers: findings F13 and F14 at 0121-REVIEW   Ruled: entry 0121-REVIEW-phase5 (reviewer)
Binding on: `primitives/text.ts` and every consumer of a `Block[]`

**Ruling.**

1. **The fourth variant stays.** PROJECT_BRIEF §5.6 lists three `Block` shapes; a parser over text
   that is a LITERAL slot needs a fourth, because `content` is never rejected at commit time the way
   a cell formula is at parse time — any string is legal document state, broken markup included.
   This is D-028's move (`ErrorNode` is not in §5.3's grammar either) for the same reason, and a
   later cycle MUST NOT "restore" the union to three.
2. **An `error` block carries `source` and `start`.** `source` is the raw expression text it
   replaced; `start` is that text's offset INTO `content` — content-space, so a consumer can
   underline the operator's own text without rescanning. This is **D-038** clause 4 ("a rejected
   formula's source text is never discarded by the layer that rejects it") and clause 2 ("carries
   the offending name and its position... retrofitting positions is the expensive kind of change")
   applied at a boundary D-038 predates. Entry 0120 kept the message only; both fields were added by
   this review while the shape had zero consumers, which is the cheapest moment that will ever exist.
3. **A broken conditional keeps BOTH branches inline after its `error` block**, never just the true
   one. Keeping one made `extractTextDependencies` silently NON-TOTAL for precisely the case §5.3's
   totality rule exists for: measured at 0121-REVIEW, `{? 1 + }x{:}{= poly_1.radius }{?}` extracted
   `[]` — a text object subscribing to strictly fewer slots than its own `content` names. Rendering
   is unaffected either way (the `error` block short-circuits evaluation before either branch is
   reached), so this is a restoration of totality, not a display decision.
4. **What a broken span DISPLAYS is not ruled here — it is Q-019, the human's.** Clause 2 is what
   keeps both answers reachable: rendering the raw span literally instead of erroring the whole
   object is a one-line change in the consumer *given* `source`, and impossible without it.

**Rationale.** Three flavours of malformed markup currently get three different recoveries — a
stray `{?}` and an unterminated `{=` both degrade to literal text, while a `{= 1 + }` that closes
correctly poisons the entire object with `#PARSE`. That inconsistency is real, is operator-visible,
and is D-042's kind of question rather than a reviewer's; raising it as Q-019 rather than ruling it
is deliberate. What IS the reviewer's is making sure the data shape can express whichever answer
comes back, and that the dependency half is not quietly wrong in the meantime.

Reconciliation required: none outstanding — both halves were applied and mutation-checked at
0121-REVIEW. No `PROVISIONAL` tag; Q-019 governs display only and nothing is built against it.

---

## D-116 — A broken embedded span RENDERS ITSELF, verbatim and delimiters included, prefixed with `!` — it does not blank the text object (Q-019 answered by the human: a hybrid of options (b) and (c))
Answers: **Q-019**   Ruled: the human, directly, 2026-09-01 (in response to 0121-REVIEW's raise)
Recorded: entry 0122-RULINGS (reviewer, recording the human's decision)
Binding on: `primitives/text.ts`'s `evaluateBlockTree`, the `text` schema entry's `resolvedContent`,
and `render/`'s eventual text pass

**The human's words:** "Let's try and do a hybrid of B and C. If a broken span is written, it should
render literally, but with some signifyier in the text itself to add an indication that it's broken
beyond just writing out the literal. Could we do something where a broken span renders literally but
just has an exclamation mark added at the beginning: `{= 1 + }` renders as `!{= 1 + }`"

**Ruling.**

1. **A broken span renders as `!` + the span exactly as written.** `{= 1 + }` resolves to the eight
   characters `!{= 1 + }` — nine with the mark. Delimiters are part of it: the operator sees what
   they typed, where they typed it, so the diagnostic and the thing to fix are the same characters.
2. **The rest of the text object renders normally.** One broken span no longer costs the whole box.
   This REVERSES what entry 0120 built and 0121-REVIEW accepted (an `error` block returned `#PARSE`
   for the entire tree); that behaviour was a default by omission, never a decision, and it is now
   overruled. `evaluateBlockTree` therefore keeps going past an `error` block.
3. **`resolvedContent` holds a `string`, not an `ErrorValue`, for a broken span.** Consequences,
   both intended: `= text_1.resolvedContent` reads ordinary text, and §5.9's error badge — which
   fires on objects holding `ErrorValue`s — does NOT light up for a parse-broken span. **The `!` IS
   the signifier; do not also add a badge for this case.** That is the whole content of "a hybrid of
   B and C": the marker (C's half) without the whole-object failure (B's half).
4. **The `!` is emitted by the ENGINE, into `resolvedContent` — never added by `render/`.** §5.6
   makes `measuredHeight` a function of `resolvedContent`, so a mark added at draw time would be
   measured out of one string and drawn into another. One string, one source of truth. This is
   content resolution, not glyph styling, so Rule 1 is untouched.
5. **A broken CONSTRUCT renders whole.** For a conditional the span runs from `{?` through its
   matching `{?}`, branches included: `{? 1 + }yes{:}no{?}` renders as `!{? 1 + }yes{:}no{?}`, NOT
   as `!{? 1 + }` followed by `yesno`. Its already-parsed branches live in the error block's
   `orphaned` field — walked for dependencies (D-115 clause 3's totality survives), never rendered.
   Applied at entry 0122; see its own note on why inline siblings stopped being safe.
6. **Scope: this covers a PARSE-broken span only.** A well-formed formula that evaluates to an
   `ErrorValue` (`{= 1 / 0 }` -> `#DIV0`, or a reference reading an error slot) is a different
   question and is NOT decided here — see **Q-020**, raised alongside this ruling. Do not extend
   this ruling to runtime errors by analogy, and do not narrow it away from parse errors either.

**Rationale (the human's, plus what recording it surfaced).** The failure this replaces was
disproportionate: a paragraph with five embeddings went blank because the fifth had a typo, which is
the same injury **D-109** clause 3 was ruled against — losing work to one refusal — arriving in a
different surface. It also removes an inconsistency nobody chose: a stray `{?}` and an unterminated
`{=` already degraded to literal text, while a `{= 1 + }` that closed correctly poisoned everything;
all three now behave the same way, with the broken one marked.

Recording the ruling surfaced two things the question had not: clause 4 (the mark must be engine-side
or `measuredHeight` measures a different string than gets drawn) and clause 5 (once an `error` block
stops poisoning the tree, D-115 clause 3's inlined branches would start RENDERING — `yesno` — so
they had to move inside the block). Both are consequences of the ruling rather than amendments to
it.

Reconciliation required: **entry 0122 applied clause 5's data shape only** (the span now covers the
whole construct, delimiters included; `orphaned` added; five test expectations updated — authorised
here, so not a §6.1 trigger 5 escalation for that cycle). **Clauses 1-4 are NOT built**: the `!`
prefix and the removal of `#PARSE` propagation are owed by the Phase 5 wiring cycle, which MUST land
them with tests, and MUST have Q-020 answered first or state which way it assumed.

---

## D-117 — A span that PARSES but EVALUATES to an error renders its error CODE, marked, in place; it does not propagate to the whole object (Q-020 answered by the human: option (b))
Answers: **Q-020**   Ruled: the human, directly, 2026-09-01 ("Rule Q-020 with option b")
Recorded: entry 0123-RULINGS (reviewer, recording the human's decision)
Binding on: `primitives/text.ts`'s `evaluateBlockTree`, the `text` schema entry's `resolvedContent`

**Ruling.**

1. **A `{= }`/`{? }` that parses but evaluates to an `ErrorValue` renders `!` + the error CODE, in
   place** — `{= 1 / 0 }` resolves to `!#DIV0`, not `!{= 1 / 0 }` and not the error's `message`. The
   code alone: short, matches the vocabulary the operator already sees in a table cell, and does not
   require deciding how much of a (possibly long) `message` string fits inline.
2. **The rest of the text object renders normally.** Same promise **D-116** made for a parse-broken
   span, extended to a runtime-broken one: one bad embedding never costs the paragraph.
3. **This is a DIFFERENT case from D-116's, sharing only the `!` convention.** D-116's span is the
   operator's own SOURCE TEXT, verbatim, because there is no computed value to show — the thing is
   unparseable. This ruling's span is a COMPUTED VALUE's error code, because there IS a value, it is
   simply an `ErrorValue` — showing the source back here would tell the operator less, not more
   (they already see `{= 1 / 0 }` in their own text; what they don't see is which error it produced).
   Do not merge the two mechanisms or read D-116's "render the span verbatim" as governing here too.
4. **`resolvedContent` holds a `string` for this case, exactly as D-116 clause 3 already ruled for
   the parse-broken one.** The same consequences follow, restated because clause 3 there was
   explicit about them and they must not be quietly narrowed to "only the parse case": `=
   text_1.resolvedContent` reads ordinary text (the string containing `!#DIV0`), and §5.9's error
   badge does not fire for this case either — **the marked code IS the signifier**, matching D-116's
   own "the `!` IS the signifier; do not also add a badge."
5. **The mark and the code are emitted by the ENGINE**, for the identical reason D-116 clause 4
   gives: `measuredHeight` is computed FROM `resolvedContent`, so anything `render/` added at draw
   time would be invisible to layout.
6. **Scope stays exactly as wide as the question and no wider.** This covers a `formula` block (an
   embedded `{= }`) and a `conditional` block's CONDITION evaluating to an `ErrorValue` or a
   non-boolean. It does **not** decide what a `conditional`'s branch containing a broken embedding
   does — that is already covered, recursively, by this same ruling applied to the branch's own
   blocks; no new case exists there.

**Rationale.** The human's own reasoning for D-116 — one broken embedding should not cost a whole
paragraph of otherwise-good prose — applies with equal force to a formula that is syntactically
fine but semantically broken; there is no principled reason typos would be forgiven while division
by zero is not. Option (b) over (a) is the one that keeps the operator informed of WHICH failure
occurred, matching how a table cell already shows `#DIV0` rather than the source formula on error
(`render/renderer.ts`'s cell drawing, unchanged by this ruling) — text inherits the same vocabulary
rather than inventing a second one. Option (c) was the more "correct" reading of §5.1's propagation
rule, and the reviewer said so; the human weighted the paragraph-survival property higher, which is
theirs to weigh (D-042).

Reconciliation required: **nothing built yet.** Like D-116, this ruling is unbuilt until the Phase 5
wiring cycle lands `resolvedContent`'s real compute function — that cycle now owes BOTH D-116
clauses 1-4 and D-117 in the same slice, with a test for each of: a parse-broken span, a
runtime-broken formula block, and a runtime-broken conditional condition. `Q-020`'s own "state which
way you assumed if still open" escape clause is now moot — nothing is open.

---

## D-118 — A derived-slot compute that needs a real text measurement MUST surface an `ErrorValue` when it can see only the null measurer — never a height it did not earn
Answers: entry 0124's flagged risk (its Decision 3)   Ruled: entry 0125-REVIEW-phase5 (reviewer)
Binding on: `primitives/schema.ts`'s future `text` entry (`measuredHeight`, and any later
compute whose result depends on `context.measurer`)

**Ruling.**

1. `NULL_EVAL_CONTEXT`'s measurer reports `{ width: 0, height: 0 }` for every string. That is the
   correct inert answer for the many evaluation passes that touch no `text` object — and it is kept
   for exactly that reason. But for a compute that genuinely needs a measurement — `measuredHeight`
   of a real `text` object whose `content` is non-empty — a zero it did not earn is a silent wrong
   value, the class §5.1 ("a broken input is legitimate graph state and must come back as an
   `ErrorValue`") and this project's whole posture rule against.

2. Such a compute MUST detect that it is running without a real measurer and return an `ErrorValue`
   (suggested code `#MEASURE`, message naming the object) instead of a height. It MUST NOT return
   `0`, and MUST NOT return a real height computed from the zero-measurement (which would be `0` or
   near it anyway).

3. **The detection mechanism is the implementer's to choose.** An identity check against the
   exported `NULL_EVAL_CONTEXT`; a `context === undefined` guard for the isolated-unit-test path
   (the two are equivalent for this purpose); or, if a cleaner shape emerges, a capability marker on
   `EvalContext`. What is ruled is the outcome — "measured non-empty text, got `0`, returned `0`" is
   not acceptable — not the check.

4. `evaluate` / `deriveValidateAndEvaluate` / `mutate` are unchanged by this ruling: they still
   forward `context` untouched and never inspect it (0124's shape stands). The guard lives in the
   compute function, where §5.1 already places the "turn a broken input into an `ErrorValue`"
   obligation. Nothing throws, rejects, or couples evaluation to schema types.

5. The wiring cycle's `measuredHeight` test MUST cover this: a real `text` object evaluated with
   `NULL_EVAL_CONTEXT` yields an `ErrorValue`, not height `0`. This is also the test 0124 identified
   as the end-to-end proof that `context` is threaded at all — one test discharges both.

**Rationale.** Entry 0124 built the seam correctly and flagged this gap rather than papering over
it. A flag deserves an answer before the consuming cycle starts, so that cycle implements a decided
contract instead of discovering the hole at the keyboard and guessing (or worse, not noticing). The
zero-default is retained because it is right for the common case; the compute-side guard is what
makes it safe. The `render/interaction.ts` drag path and the four `command/commands.ts` `mutate`
calls all pass no context today — D-118 is what turns a missed wiring site there into a loud
`ErrorValue` rather than a text box that silently collapses to zero height.

This is reversible implementer-adjacent territory and the human may overrule the "must error"
stance if a silent zero is genuinely wanted for some case; the default the wiring cycle should
build to is loud.

Reconciliation required: none yet — nothing consumes the measurer. Binding on the cycle that writes
`measuredHeight`.

---

## D-119 — `resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a sanctioned hand-maintained PAIR; a change to one is a change to both, and a third consumer forces extraction
Answers: entry 0127's Decision 3 / its reviewer question 2   Ruled: entry 0128-REVIEW-phase5 (reviewer)
Binding on: `mutation.ts`'s `deriveEdges` Source 1, `primitives/text.ts`'s `resolveTextDependencyAddresses`,
and any future third consumer of reference/range edge derivation

**Ruling.**

1. **The duplication stands for now.** `resolveTextDependencyAddresses` re-implements, by hand,
   `deriveEdges` Source 1's `ReferenceDependency` / `RangeDependency` → `Address[]` logic, including
   **D-110** clause 4's empty-in-extent skip and **D-047** clause 1's absent-cell skip. It cannot
   share the code: `primitives/text.ts` importing `mutation.ts` closes the cycle
   `mutation → schema → text → mutation`. Extracting a shared helper into a neutral module now is
   real design work and touches code not written in the 0127 batch (§4) — it is not ordered.

2. **The two are a PAIR with no compiler link.** A verification at 0128-REVIEW confirmed they are
   currently byte-equivalent in behaviour (`getSlot(o,p)` ≡ `o.slots[slotKey(p)]`; same `resolveSlot`
   / `isInExtentTableCellAddress` / `enumerateRangeCellAddresses` / `isRangeEnumerationError` calls,
   same order, same fallbacks). Nothing but this ruling and two cross-referencing comments keeps them
   so. **Any change to bare-reference handling, range expansion, the D-110 clause 4 skip, or the
   D-047 clause 1 skip in EITHER site MUST be made in the other in the same cycle**, and that cycle's
   log MUST name both files. A test passing after a one-sided change is not evidence of correctness —
   each site has its own tests, and neither suite exercises the other's code.

3. **A third consumer forces extraction.** If any later cycle needs this same
   `Dependency → Address[]` expansion a third time (a plausible candidate: `script.out.*`'s dynamic
   resolver, or a loader-side check), it MUST NOT add a third hand-maintained copy. It extracts the
   shared logic into a module `mutation.ts`, `primitives/text.ts`, and the new consumer can all
   import without a cycle (`primitives/table.ts` is the natural home — it already owns
   `enumerateRangeCellAddresses` and both sites import it), and collapses all copies onto it in that
   cycle.

**Rationale.** This is the hazard STATUS.md's gotcha names but a rewritten STATUS cannot bind: a
future cycle changes D-110/D-047 edge derivation in `deriveEdges`, every suite stays green because
the text resolver has separate tests the author never thought to touch, and text-embedded references
silently stop meaning the same thing a cell reference means — violating **D-114** clause 1 ("a
reference means the same thing in a cell and in a text box"), which is the whole point of routing
embedded ASTs through `evaluateDerivedSlot` rather than a parallel path. A binding decision converts
"someone should remember" into "the process caught it."

Reconciliation required: none — the pair is already in sync (verified 0128). No `PROVISIONAL` tag.
Cross-referencing comments were added to both sites by this review.

---

## D-120 — `measuredHeight` becomes width-aware by WIDENING `TextMeasurer.measure` with an optional `maxWidth`; line-breaking lives in the measurer implementation, never in `src/engine/` (Q-021 answered)
Answers: **Q-021**   Ruled: entry 0130-REVIEW-phase5 (reviewer)   Binding on: `src/engine/eval-context.ts`,
`src/engine/primitives/text.ts` (`computeMeasuredHeight`), `src/render/measure.ts` (unbuilt), and any
future compute that needs a wrap-aware measurement

**Ruling — the implementer's provisional choice (a), entry 0129, is confirmed.**

1. **`TextMeasurer.measure(text, style, maxWidth?)` is the interface.** `maxWidth` is optional and
   trailing, so every `measure(text, style)` call still type-checks and behaves identically; an
   implementation free to ignore it (`NULL_TEXT_MEASURER`, an early fake) simply does not wrap.

2. **Line-breaking is the measurer implementation's job, not the engine's.** `computeMeasuredHeight`
   stays a pass-through: it reads the declared slots, hands `width` (when numeric) to `measure` as
   `maxWidth`, and returns `.height`. It runs no word-wrap loop, no whitespace collapsing, no
   markdown-aware line-fitting — those are `render/measure.ts`'s, with `ctx.measureText`.

3. **`maxWidth` is the `width` slot iff it holds a number; `"auto"` (or any non-number) is
   `undefined` = no wrapping** (§5.6: "Auto width + auto height means no wrapping").

4. **Not the human's to weigh, because the operator sees identical wrapped text either way.** This
   is an internal seam-shape question, and Rule 1 settles it: measuring text requires glyph metrics
   and Rule 1 puts glyph-metric work behind the `TextMeasurer` interface; line-breaking *is*
   glyph-metric work, so it belongs there too. Option (c) — an engine-side wrap loop — would put a
   text-layout algorithm in `src/engine/`, the exact concern Rule 1 and §9 push out, for a larger
   and fiddlier diff. Option (b) — no wrap-awareness — trades away the Phase 5 gate's "wraps at its
   set width".

**Rationale.** §5.6 makes `measuredHeight` a function of `width` and the Phase 5 gate requires
wrapping, but Rule 1's `TextMeasurer` interface as built at entry 0124 had no width parameter —
a genuine brief inconsistency (§6.1 trigger 3), correctly raised rather than guessed. The widening
is the smallest change that honours both passages, keeps `computeMeasuredHeight` the dumb
pass-through every other compute is, and does not couple `src/engine/` to a layout algorithm. It is
reversible if the human overrules: `eval-context.ts` is not on §6.2's load-bearing list, the
parameter is optional, and `measuredHeight` is a `derived` slot whose value never serializes, so no
stored document can depend on the answer.

Reconciliation required: grep `PROVISIONAL(Q-021)` and resolve every site (`src/engine/eval-context.ts`,
`src/engine/primitives/text.ts`) — replace the tag with a `(D-120)` citation; the surrounding prose
explaining why `maxWidth` exists stays. Owed by the next cycle, which is the `render/measure.ts` /
`text` command cycle — the first to build the real measurer against this.

## D-121 — A `text` object's position is two ordinary `literal` slots, `origin.x` / `origin.y`, on `TEXT_SCHEMA` — same spelling as every other positioned object
Answers: **Q-022**   Ruled: entry 0135-REVIEW-phase5 (reviewer)   Binding on:
`src/engine/primitives/schema.ts` (`TEXT_SCHEMA`), `src/engine/primitives/text.ts` (the
`TEXT_*_PATH` vocabulary), the `text` command handler in `src/command/commands.ts`, and
`render/interaction.ts`'s drag path as it applies to a `text` object

**Ruling — the implementer's recommendation (a), entry 0134, is confirmed.**

1. **`TEXT_SCHEMA.nonDerivedSlotPaths` gains `origin.x` and `origin.y`**, reusing
   `ORIGIN_X_PATH` / `ORIGIN_Y_PATH` from `primitives/geometry.ts` — the identical path spelling
   `circle`, `polygon`, `rect`, and `table` already use. One spelling across the document; no new
   constant.

2. **Both are `literal`-kind and are NOT dependency-required.** An absent `origin.x` at the declared
   path is tolerated exactly as it is for every other primitive (`findSchemaSlotKindMismatches`);
   nothing derived reads them, so no `text` object is refused for lacking one. A `formula` may drive
   either (Phase 7: `link text_1.origin.y intersection_a.centroid.y`), and a drag writes either as a
   literal, both under §5.9's per-component rule — no `text`-specific interaction code.

3. **The `text` command creates both**, `x=` / `y=` defaulting to `0` (matching `table`).

4. **§5.6's `TextBox` block is illustrative of the content-and-layout slots, not an exhaustive slot
   enumeration.** It also omits `resolvedContent` and `measuredHeight`, which are legitimately
   present as derived slots. Reading it as exhaustive contradicts §5.10 (`text x=0 y=0`), §5.9 (the
   drag rule assumes an `origin` slot or per-vertex slots), §5.7 (the neighbouring `image` primitive
   lists `origin.x` / `origin.y` explicitly), and Phase 7 (a text box "positioned relative to their
   intersection's center", needing the position to be a *slot*) — all at once.

**Rationale.** The brief is internally inconsistent here, a §6.1 trigger 3, correctly raised rather
than guessed (§7.3 — slot-set membership on a load-bearing schema is "shaping the data model"). (a)
reconciles it with the smallest change and makes a `text` object consistent with every sibling
primitive: one path spelling, one drag path, one `link` mechanism. (b) — a `position` field on
`GraphObject` outside the slot system — cannot be formula-driven, so Phase 7 fails, and it is a
much larger data-model change. (c) — text keeps no position — contradicts §5.10's own command
grammar and leaves Phase 7 unreachable.

**Ruled by the reviewer, not escalated to the human, for the same reason as D-120: there is no
operator-visible behaviour to choose between.** `text x=0 y=0` is already in the brief; the only
question is the storage mechanism, which Rule 6, §9's tie-breakers, and four in-tree precedents all
answer the same way. **Reversible if the human overrules**: no command builds a `text` object yet,
so no saved document can depend on the answer; `origin.x` / `origin.y` carry no derived value;
reverting is deleting two schema entries.

Reconciliation required: owed by the `text` command cycle, in one slice — (1) add the two paths to
`TEXT_SCHEMA`; (2) move `schema.test.ts`'s `text` slot-path / slot-count expectations with it; (3)
`STATUS.md`'s non-derived count goes 9 → 11 (the "effectively-required" set is unchanged — origin is
not required); (4) no `PROVISIONAL` tag — cite `(D-121)` at the schema site.

## D-122 — A `text` object's `content` slot is `literal`-only: `link` and `set =` targeting it are refused, à la D-046
Answers: **Q-023** (formalising fix-list item 22 / F13)   Ruled: entry 0135-REVIEW-phase5 (reviewer)
Binding on: `src/engine/mutation.ts` (or `resolveWritableSlot` — wherever the `text` command cycle
places the guard), `src/engine/primitives/text.ts`, and any future consumer of `content`

**Ruling — the implementer's recommendation (a), Q-023, is confirmed and issued as a binding
ruling, not a provisional.**

1. **A mutation that would make `text_1.content` a `formula` or `derived` slot is refused** — both
   `link text_1.content <address>` and `set text_1.content = <formula source>`. The refusal message
   says `content` is read as raw source only. `content` is permanently `literal`-kind, the way a
   table dimension slot is (D-046).

2. **A plain `set text_1.content "…"` (a literal write) is unaffected** — that is how `content` is
   authored, exactly as a table cell's formula *source* is typed as a literal string and parsed by
   the primitive, never by the command line.

**Rationale.** `content` is read `literal`-only at edge-derivation time (§5.1 step 3), because a
`formula` slot's value is not written until step 7 (evaluate) — D-046's exact timing obstacle,
already documented in `primitives/text.ts`'s NOT DONE HERE. So option (b) — evaluate `content`
first, then parse the resulting string for embedded `{= }` / `{? }` references — is not buildable:
there is no second derive pass (Rule 5: no dirty tracking, one derive per mutation), and you cannot
parse a string that does not exist yet. Option (c) — leave the gap — commits an object whose
embedded references are silently untracked, so the box does not re-resolve when those cells change:
silent broken reactivity, the failure D-116 / D-118 and §5.3's totality rule all exist to prevent.
Option (a) is small (one guard plus its test), reversible, and consistent with D-046, which is the
established precedent for "a slot whose kind must be constrained because step-3 edge derivation
cannot see a step-7 value."

**Issued as a ruling rather than a takeable provisional** (which the question offered) because the
reasoning is identical to D-046's, there is no product-taste dimension (§5.6 already calls `content`
"raw source including markup", and no operator can reach a `text` object today), and a ruling means
the `text` command cycle writes the guard once with a `(D-122)` citation and needs no
reconcile-and-untag step.

Reconciliation required: owed by the `text` command cycle — add the guard citing `D-122`; update
`primitives/text.ts`'s NOT DONE HERE note (the F13 gap is now closed by a refusal, not open); no
`PROVISIONAL` tag.

## D-123 — A `text` object's bounding box gets a real measured width: `TEXT_SCHEMA` grows a third derived slot, `measuredWidth`
Answers: **Q-024**   Ruled: entry 0139-REVIEW-phase5 (reviewer)
Binding on: `src/engine/primitives/schema.ts`, `src/engine/primitives/text.ts`,
`src/render/extent.ts`, and any future reader of a `text` object's extent

**Ruling — the implementer's option (b), Q-024, is issued as binding. Provisional (a) stands as the
interim and is REVERSED when (b) lands, which MUST be before the Phase 5 gate is claimed.**

1. **`TEXT_SCHEMA` gains a third derived slot, `measuredWidth`**, alongside `resolvedContent` and
   `measuredHeight`. Its static dependency set is `measuredHeight`'s, unchanged (`resolvedContent`,
   `width`, `style.*`), and it is computed from the SAME `TextMeasurer.measure` call — that call
   already returns `{ width, height }` (`engine/eval-context.ts`) and today discards the width.

2. **Its failure order MIRRORS `computeMeasuredHeight`'s exactly** — upstream `ErrorValue` →
   `#MEASURE` (no real measurer, D-118) → `#TYPE` (unusable style) → `#TYPE` (non-finite) → the
   width. Do not invent a second order, and do not let one of the pair succeed while the other
   fails: they answer one question and are computed from one measurement.

3. **`render/extent.ts`'s `textExtent` reads, in order:** the `width` slot when it holds a positive
   finite number (the box the operator SET — that is the box, whatever the ink does inside it), else
   `measuredWidth` when it holds one, else the fixed fallback. The fallback survives ONLY for the
   `#MEASURE` / no-measurer case (a test, or `main.ts` failing to get an offscreen context), where
   nothing better is knowable; at that point it is an ordinary documented constant, NOT a
   `PROVISIONAL` — every `PROVISIONAL(Q-024)` tag comes out in the same cycle.

4. **This is a deliberate extension of §5.6's derived-slot list, on the same footing as D-121's
   extension of its `TextBox` shape.** §5.6 names two derived slots; §5.9 separately promises "a
   bounding box for text", and D-066 rules that the drawn extent and the clickable extent are ONE
   extent. Those three cannot all hold for an auto-width `text` object without a measured width. The
   brief is silent, not contradicted — this fills the silence the same way D-121 filled §5.6's
   missing position. A bonus that confirms the shape: `= text_1.measuredWidth` becomes legal and
   correctly ordered in a formula, exactly as `measuredHeight` already is, which is what Phase 7's
   relative label layout will want.

5. **The box follows the text; the text NEVER follows the box.** `renderer.ts` draws every line
   `layOutLines` produced. It MUST NOT clip, pad, or truncate its line count to match a stored
   `measuredHeight`/`measuredWidth`, and no cycle may "fix" a drawn-vs-measured disagreement that
   way. §5.6's `overflow: "clip"` / `"ellipsis"` is the ONE mechanism permitted to reduce what is
   drawn, and it does so on the `overflow` slot's instruction, never to make a measurement true.
   (Answers the implementer's question 2 at entry 0138 with a rule, so it stays answered.)

**Rationale.** Provisional (a) — a fixed 240x20 fallback — was taken and tagged correctly under §7,
but its cost was mis-estimated in both entry 0138 and Q-024, which call it an edge affordance on the
grounds that "most `text` objects carry a numeric `width`." They do not: `command/commands.ts`'s
`DEFAULT_TEXT_WIDTH` is `"auto"`, so EVERY object `text x=… y=… "…"` creates is auto-width and lands
on the fallback. It is the default path, not the edge. The consequences are all operator-visible: a
short label carries a 240-wide click box that swallows clicks meant for whatever is beside it and
draws a selection highlight around empty canvas; a long one is unclickable past its first 240 units
and draws outside its own highlight; and `fit` (§5.10, via `documentExtent`) frames a box that is
not the text. Option (c) — threading a `MeasurementContext` into `objectExtent` — is rejected as the
question recommends: it changes a pure function's signature and ripples to six call sites to answer
a question a derived slot already almost answers.

Reconciliation required: its own cycle, BEFORE the Phase 5 gate (§6.1 trigger 1 will review the gate
anyway, but the gate must not be claimed over a knowingly-wrong bounding box). `primitives/schema.ts`
is §6.2 load-bearing, so that cycle reports `REVIEW: REQUIRED`. Then `grep PROVISIONAL(Q-024)` and
remove every tag; `schema.test.ts`'s `text` expectation moves from two derived slots to three.

## D-124 — `text` is placed by POINTING, like every other creation command
Ruled: entry 0140-RULINGS-phase5 — **the human, directly**   Binding on: `src/command/parser.ts`,
`src/main.ts`, and every future creation command

**The human's words:** *"text doesn't follow the same instant-place logic that circle, table etc.
do. Remember that my primary way of placing things is using the mouse — I need to be able to type
'text' and then click with my mouse to put the text box in a specific location."*

1. **`text` gains a `prompts` sequence in its `parser.ts` registry entry**, exactly as `circle`,
   `polygon`, `rect` and `table` have one (D-072). One step: a `point`, message `specify text
   position`. Typing `text` and pressing Enter starts the sequence; the next canvas click places the
   box. `main.ts` already routes a click to `respondToPrompt` whenever `state.pending` is set — that
   path is built, reviewed, and needs no change.

2. **The sequence has NO content step.** It completes on the point pick, creating the object with
   `content` `""`, and hands straight to D-125's in-place editor so the operator types into the box
   on the canvas. Asking for the content at the command line is the clunkiness the human is naming;
   do not add a `text`-accepting `PromptStep` to satisfy this ruling.

3. **Both existing typed forms keep working, unchanged and untouched.** This falls out of
   `prompt.ts` as already written: `text "hi"` hits `beginCommand`'s `token.quoted` branch and
   `text x=0 y=0 "hi"` hits `usesNamedForm`, and both defer to `parseCommand` whole. The hazard note
   on `usesNamedForm` is what makes this safe — read it before touching either file.

4. **`PromptValue` and `PromptStep.accepts` do NOT widen.** No string-accepting step is added, so
   `prompt.ts`'s `ResponseRead` widening hazard stays dormant. Clause 2 is what buys this.

5. **This generalises: every command that CREATES an object is placed by pointing.** `polyline`,
   `image`, `script` each arrive with a `prompts` entry on the day they arrive. Placement is a mouse
   gesture in this program; a creation command that can only be typed is an unfinished command.

**Rationale.** Entry 0136 gave `text` optional `x`/`y` defaulting to `0` (D-121 clause 3) and no
prompt sequence, on the reasoning recorded in its registry comment: a text prompt step would need an
`accepts` kind that does not exist. That reasoning was sound for the sequence it imagined (point,
then content) and wrong about the gesture the operator actually wants, which ends at the point. What
shipped is a creation command that silently stacks every text object at the world origin unless the
operator types coordinates — the one creation command that cannot be placed by pointing, in a
program whose author places by pointing. D-121 clause 3's default of `0` survives as the fallback
for the typed form; it stops being the normal path.

## D-125 — Text is typed INTO its receiver: in-place editing for `text` objects and table cells
Ruled: entry 0140-RULINGS-phase5 — **the human, directly. Declared ABSOLUTE PRIORITY.**
Binding on: `src/main.ts` (pure half + DOM half), a new `render/` editor surface, §5.4, §5.6

**The human's words:** *"I need to be able to edit text visually — that goes for text boxes as well
as table cells. The pattern of `set text_1.content = "something"` is perfectly fine for an LLM to
understand, but horribly unintuitive to a human seeing it visually. Likewise for tables. ABSOLUTE
PRIORITY — INPUT OF TEXT DIRECTLY INTO TEXT BOX RECEIVERS. Otherwise the whole thing feels clunky."*

1. **Two receivers, one mechanism.** A `text` object's `content` slot, and a table cell. Both are
   edited by a real DOM text input overlaid on the canvas at the receiver's own position — world
   position converted through `render/camera.ts`'s `worldToScreen`, the same way `main.ts` already
   places a properties panel. One editor at a time, document-wide.

2. **It commits through `executeCommand`, like every other authoring surface (Rule 2, D-069,
   D-102 clause 5).** Build a `Command`, run it, echo it into the log exactly as a typed line. There
   is no second write path, no "just this once" direct slot write, and no new mutation kind. The
   seam to copy is `main.ts`'s `commitPanelEdit` / `runPanelCommand`, which is built and reviewed.

3. **The commit rule DIFFERS BY RECEIVER, and this is the trap in this ruling.**
   - **A `text` object's `content` commits as a LITERAL, ALWAYS.** It is never sniffed for a leading
     `=`. §5.6's `{= }` / `{? }` are markup INSIDE a literal string, and D-122 makes `content`
     permanently `literal`-kind. **`buildPanelSetCommand` MUST NOT be reused here** — it routes every
     non-numeric string to `set-formula`, so `Hello world` would be committed as `=Hello world` and
     refused. Typing a whole markdown-and-formula paragraph into the box must produce exactly one
     literal `set`.
   - **A table cell commits Excel-style:** a leading `=` makes it a formula (`set-formula`),
     anything else is a literal — a number when it parses as one (`parseCommandNumber`), otherwise a
     string. That is §5.4's own model and the one every operator already has in their fingers.
   - The cell's address is built through `engine/address.ts`'s formatter, never string-concatenated
     (`address.ts`'s standing invariant).

4. **Opening it.** Double-click a `text` object, or double-click a table cell, opens the editor on
   that receiver. A `text` object placed by D-124 opens its editor immediately on creation — placing
   and typing are one gesture. Single-click keeps meaning select-and-drag, unchanged.

5. **Escape cancels, and cancelling writes nothing.** Nothing is committed until commit, so a
   cancelled edit leaves state bit-for-bit untouched for free — do not "restore" anything. In a
   `text` box **Enter inserts a newline** (§5.6 has hard line breaks and the measurer already splits
   on them); commit is Escape or a click outside. In a **table cell Enter commits**, Excel-style.
   Clauses 4 and 5 are the conventional defaults, ruled so work can proceed, and are the cheapest
   thing in this ruling for the human to overrule on sight.

6. **An empty `text` object must be visible and clickable WHILE its editor is open.** Today an empty
   `content` means no `resolvedContent`, so no extent — no ink, no hit box, no chrome (0139-REVIEW's
   noted problem). D-124 creates exactly that object and hands it to this editor, so the editor's own
   overlay is what makes it real on screen: it draws its own box and caret and does not depend on
   `objectExtent` being defined. `extent.ts`'s rule is unchanged and must not be loosened to paper
   over this.

7. **The commit logic lives in `main.ts`'s EXPORTED PURE HALF, not inside `start`'s closure** —
   `commitPanelEdit`'s shape, for `commitPanelEdit`'s reason: `start` is untested by construction
   (D-001) and this is the highest-traffic authoring path in the program. A cycle that buries this
   in a DOM listener has shipped it untested.

8. **§5.4's formula bar remains unbuilt and is NOT part of this.** In-place is what was asked for.
   D-094's properties panel and its paperclip editing are unchanged and remain the way every
   non-`content` slot is edited by mouse; this adds a surface, it replaces none.

**Rationale.** The human is the operator and reports the program feels clunky at exactly this point;
under PROCESS_BRIEF §1 that is dispositive and needs no further argument. Worth recording anyway:
§5.4 has always listed "in-place cell editing" as core scope, it has simply never been built, and
Q-014's remaining half was always the human's alone to settle. The `text` half is newly reachable —
before entry 0138 a text object could not be seen and before 0136 it could not be created, so there
was nothing to click into. Nothing here contradicts the brief; it builds two things the brief
already asked for and never scheduled.

**Standing note on precedence, stated by the human at this entry:** *"If the brief conflicts with
what I say, ignore the brief. I wrote it."* PROCESS_BRIEF §1 already makes the human the final
arbiter on product questions; this is the operative form of it. A `DECISIONS.md` ruling that
transcribes a direct human instruction outranks the brief's own text, and no future cycle may
"correct" one back toward `PROJECT_BRIEF.md`.
