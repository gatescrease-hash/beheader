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
