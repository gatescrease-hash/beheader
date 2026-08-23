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
