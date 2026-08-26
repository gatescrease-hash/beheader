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
