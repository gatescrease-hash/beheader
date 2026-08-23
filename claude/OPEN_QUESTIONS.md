# OPEN QUESTIONS

Unresolved ambiguity in `PROJECT_BRIEF.md`. Raise one here rather than guessing whenever
the brief is silent, ambiguous, or self-contradictory on something load-bearing.

Procedure is in `PROCESS_BRIEF.md` §7. In short: write the question, take a **reversible**
provisional choice if one exists (tag it `// PROVISIONAL(Q-NNN)` at every affected site), stop
the cycle if the choice is not reversible. Answered questions are marked `ANSWERED → D-NNN` in
place here and are never deleted.

Next free ID: **Q-009**

> **Revision note (2026-08-22, Manager cleanup):** compacted to STE; every question, option,
> recommendation, reversibility call, and reviewer note is preserved in substance. Full original
> wording is in the untouched sacred copy — see `MANAGER_CHANGELOG.md`.

---

## Q-008 — Is negative zero (`-0`) legal document state?
Raised: entry 0025-REVIEW-phase0 (reviewer)   Brief section: §5.1 (`Value`), §5.11, §6 clause 4
Status: OPEN (provisional choice taken, reversible — same standing as Q-005/Q-007)
Blocks: nothing outright — it WAS a live counterexample to §6 clause 4 ("round-trips to JSON and
back **identically**"); closed at entry 0026-phase0-revise-fix, same cycle that closed
0025-REVIEW-phase0's REVISE item 1, which touches the same predicate.

Ambiguity: D-025 settled the three non-finite numbers because JSON cannot represent them. `-0` is
the remaining member of `Value`'s `number` arm with the same defect, and D-025 does not cover it
(`Number.isFinite(-0)` is `true`). Verified by probe at 0025-REVIEW-phase0, through the real
public API:

```
mutate([setSlot value_1.value = -0])          -> ok: true, committed value Object.is(-0) -> true
saveDocument(...)                             -> ..."value":{"kind":"literal","value":0}...
loadDocument(...)                             -> reloaded Object.is(-0) -> false
```

So a document that `mutate` accepts does not round-trip identically. Nothing in Phase 0 can author
a `-0` except a hand-written literal (there is no parser until Phase 1, and `add` reaches `-0`
only from `-0` inputs), so the practical exposure today is nil — but the acceptance clause is a
bit-identity claim, and this is the exact reasoning that produced D-025.

Options: (a) illegal, rejected the same way and in the same place as a non-finite number — one
more arm on the same predicate, one more sentence in the same message. (b) legal, and
`document.ts` encodes the sign explicitly on save — rejected for the same reason Q-006 rejected
its own option (a): the on-disk format stops being plain JSON at exactly the point §5.11 says it
is. (c) legal and silently normalised to `0` on the way in — rejected: an accepted mutation that
changes a value the operation did not ask to change is the D-019 defect again, and clause 4 would
be true only because state was quietly rewritten.

Recommendation: (a). It is one branch, it is consistent with D-025's own rationale (a number that
does not survive the format is not document state), and it is forward-safe: no saved document can
contain `-0` today, so nothing existing becomes unloadable.

Reversible? Yes — one branch and one message; no stored data can depend on it.
Provisional choice taken: **(a)**, at entry 0026-phase0-revise-fix — the human had not ruled by
then. Tagged at exactly one site: `graph/node.ts`'s `isIllegalNumber`, the single leaf predicate
D-025 (non-finite) and Q-008 (`-0`) now share (widened, not duplicated — same "widen the existing
mechanism" stance D-020/D-026 already established). `mutate` rejects `-0` as a slot value (both a
freshly-written literal and one already sitting in the document, same as D-025) and as an
operation payload before staging; `document.ts`'s journal read-side check rejects it there too.
`add`'s compute needs no separate `-0` guard: its inputs are already-legal by the time it runs, and
IEEE 754 `+` of two finite, non-`-0` operands cannot itself produce `-0` — see 0026's own entry.

---

## Q-007 — What shape does the document's serialized "camera state" (§5.11) have in Phase 0?
Raised: entry 0024-document (implementer)   Brief section: §5.11, §5.9
Status: OPEN (provisional choice taken, reversible)
Blocks: nothing — `render/camera.ts` (Phase 3) is the real consumer; Phase 0 only needs SOMETHING
plain and serializable to round-trip.

Ambiguity: §5.11 lists "camera state" as one of the document's top-level fields, but `render/
camera.ts` (§5.9: "world → screen and screen → world," pan/zoom) is Phase 3 work and does not exist
yet. The brief never states the camera's own data shape (a pan offset plus a zoom factor is the
obvious reading of §5.9's own description, but that's an inference, not a stated shape).

Options: (a) a minimal placeholder shape (`{ x, y, zoom }` — world-space pan offset plus zoom
factor) defined in `document.ts` itself, which Phase 3's `render/camera.ts` either adopts as-is or
widens. (b) skip serializing camera state entirely until Phase 3 needs it — **rejected**, §5.11
states it as part of the format from the first commit, same as `formatVersion`. (c) block this
cycle on a human ruling — rejected as disproportionate for a field nothing reads yet.

Recommendation: (a). Cheap, plain, serializable, and matches §5.9's own vocabulary closely enough
that Phase 3 is unlikely to need more than a widen.

Reversible? Yes — nothing outside `document.ts` reads or writes this shape yet; Phase 3 can freely
replace it. Provisional choice taken: (a). Tagged at: `document.ts`'s `CameraState` interface.

> Reviewer note (0025-REVIEW-phase0): **(a) APPROVED as provisional**, same standing as Q-005 —
> stays OPEN because it fully resolves only when Phase 3 builds `render/camera.ts`, which owns this
> shape. Binding constraints until then: Phase 3 **widens** `CameraState`, never replaces it with a
> differently-named concept; the field stays plain and serializable (Rule 5); and `document.ts` is
> not permitted to grow a second reader of it. `deserializeDocument` rejecting a malformed camera
> is right and should survive the widening — a document whose camera is garbage is a document that
> cannot be opened at the right place, which is a real failure, not a field to default away.

---

## Q-006 — Is a non-finite number (`NaN`, `Infinity`, `-Infinity`) legal document state?
Raised: entry 0018-REVIEW-phase0 (reviewer)   Brief section: §5.1 (`Value`), §5.11, §6 clause 4
Status: **ANSWERED → D-025** (ruled by the human directly, 2026-08-22, option (b))
Blocked: Phase 0 clause 4 — was blocking `document.ts`'s round-trip test; unblocked now.

Ambiguity: `Value`'s `number` arm admits all three, and they are reachable today with nothing but
literals — `add`'s compute over two `1e308` literals yields `Infinity`, and `set x 1e999` parses
to one directly. But §6 clause 4 requires a document to "round-trip to JSON and back
**identically**", and JSON has no representation for any of them. The brief never says which side
gives.

Options: (a) legal state — `document.ts` encodes them explicitly on save and decodes on load,
keeping `Value` as written. (b) illegal — `mutation.ts` rejects a literal that is not finite, and
every compute maps a non-finite result to an `ErrorValue` (`#TYPE`; §5.1 fixes the `ErrorCode`
union, so no new code). (c) legal but not persisted — **rejected outright**, it makes clause 4
false by construction.

Recommendation: (b). It is the smaller change, it keeps the serialized format plain JSON (§5.11,
Rule 5), and §5.1 already establishes that an `ErrorValue` in the graph is legitimate state rather
than a reason to reject. (a) means the on-disk format stops being plain JSON at exactly the point
§5.11 says it is. But this touches the value vocabulary and the visible behaviour of overflow, so
it wants the human's product call, not an implementer's.

Reversible? Yes at present — D-019 binds the step-1 clone to be faithful either way, and nothing
in the tree produces a non-finite value except a hand-written literal. Provisional choice taken:
no. Tagged at: `mutation.ts`'s `cloneObjects` doc comment, which points here (added when D-019 was
implemented at cycle 0019).

> Reviewer note (0021-REVIEW-phase0): the scope is wider than slot values. §5.11 puts **the
> mutation journal in the serialized document**, and a `MutationJournalEntry` holds `Operation`s
> whose `Slot` payloads carry the same `Value` union. So whatever this question settles applies to
> the journal too, not only to the object list — answer it once, for both.

> Reviewer note 2 (0025-REVIEW-phase0): that widening WAS carried into D-025's own ruling text
> ("in the object list AND in the serialized mutation journal") and then implemented over the
> object list only. See 0025-REVIEW-phase0 finding 1: a journal payload holding `Infinity` is
> saved as `null`, so the answer to this question is currently enforced on one of the two halves
> it was written for. Q-006 stays ANSWERED — the ruling is not in doubt, its implementation is.

> Implementer note (entry 0026-phase0-revise-fix): the journal half closed. `mutate` now rejects an
> illegal operation payload before it can reach the journal (write side); `document.ts` rejects a
> loaded file whose journal already holds one (read side, since a loaded journal never passes
> through `mutate`). Both halves of D-025 — object list and journal — are enforced now.

---

## Q-005 — What does `formula/ast.ts` contain before Phase 1 builds the real grammar?
Raised: entry 0005   Brief section: §5.1, §5.3, §6 (Phase 0)   Status: OPEN (approved provisional)
Blocks: nothing this cycle — revisit when Phase 1 (formula engine) begins.

Ambiguity: Phase 0's `graph/*` needs a `FormulaSlot` to hold *something*, but `formula/ast.ts` is
explicitly Phase 1 work. What Phase 0's own fixture needs is narrow: the `add` object's two
formula input slots are **bindings** — §5.1 defines a binding as "the degenerate formula `=
other.slot`" — not arbitrary arithmetic.

Options: (a) a one-variant `FormulaAst` (`{ type: "reference", address: Address }`), documented as
a Phase 0 stand-in Phase 1 *widens*, never replaces. (b) leave `FormulaSlot.ast` opaque until
Phase 1. (c) skip formula slots in Phase 0 entirely.

Recommendation: (a). (b) makes `FormulaSlot` useless for Phase 0's own eval/mutation work. (c)
contradicts §5.1's three slot kinds and §6's fixture, which needs formula slots. (a) composes
forward — a union gains variants, it isn't restructured.

Reversible? Yes. Provisional choice taken: (a). Tagged at `src/engine/formula/ast.ts`.

> Reviewer note (0006-REVIEW-phase0): **(a) APPROVED.** Stays OPEN only because it fully resolves
> once Phase 1 builds the real grammar. Binding constraint: **Phase 1 widens this union, never
> replaces it** — a binding must stay representable as a bare reference under the full §5.3
> grammar. Remove `PROVISIONAL(Q-005)` tags and mark ANSWERED when Phase 1 lands.

---

## Q-004 — Are lowercase cell references accepted, and if so are they normalised?
Raised: entry 0004-REVIEW-phase0 (reviewer)   Brief section: §5.4, §5.2   Status: OPEN
Blocks: Phase 2 (table primitive). Not needed before then.

Ambiguity: §5.4 says "A1-style addressing"; every cell ref the brief writes is uppercase. It
doesn't say whether `table_x.a1` is legal, and §5.2's case-insensitivity rule is stated for
*object names*, not path segments. Accepting lowercase *without* normalising would store
`cells.a1` and `cells.A1` as two distinct slots for one cell — two sources of truth, which §5.1
doesn't tolerate.

Options: (a) uppercase only — a lowercase ref simply isn't a cell reference. (b) accept both,
normalise to uppercase at parse time. (c) accept both, store as written — **rejected outright**,
this is the two-slots bug.

Recommendation: (b) eventually — it's what a user expects — but it's a table-primitive decision
(belongs with range parsing generally), so Phase 2 should settle it holistically.

Reversible? Yes, deliberately. **Current behaviour is (a)** (D-008) — the forward-safe interim,
since moving to (b) later is purely additive. Pinned by test rather than a `PROVISIONAL` tag:
`address.test.ts::does not map a lowercase cell ref, pending Q-004`. Tagged at
`src/engine/address.ts` (`CELL_REFERENCE_PATTERN` doc comment).

---

## Q-001 — What does `unlink` store when the last computed value is not a plain scalar?
Raised: entry 0000 (reviewer)   Brief section: §5.10, §5.1
Status: OPEN — deferral reaffirmed at 0002-REVIEW-phase0
Blocks: Phase 3 (`unlink` command). Not needed before then.

> Reviewer note (0002-REVIEW-phase0): deliberately not ruled — Phase 3 command-surface question,
> reversible, nothing in Phase 0/1 depends on it. If Phase 3 arrives before the next review, take
> the recommendation below as a `PROVISIONAL` choice under D-004 rather than blocking.

Ambiguity: `unlink polygon_1.origin.x` is specified as "revert to literal, keeping last computed
value." Undefined for an `ErrorValue` (formula was broken at unlink time) or a `Point`/`Point[]`.

Options: (a) store whatever the value was, errors included. (b) substitute the schema default if
it's an error. (c) reject the unlink when the value is currently an error.

Recommendation: (a) — least surprising: the value the user was looking at is the value they keep.
An `ErrorValue` in the graph is already legitimate state (§5.1). (b) silently changes a visible
value; (c) fails exactly when the user most wants `unlink`.

Reversible? Yes — one branch in one command handler. Provisional choice taken: not yet (Phase 3
hasn't begun).

---

## Q-002 — Does `set` on a formula slot implicitly unlink, or is it rejected?
Raised: entry 0000 (reviewer)   Brief section: §5.10, §5.1
Status: OPEN — deferral reaffirmed at 0002-REVIEW-phase0
Blocks: Phase 3 (`set` command). Not needed before then.

> Reviewer note (0002-REVIEW-phase0): same reasoning as Q-001. If Phase 3 arrives first, take
> option (a) below as `PROVISIONAL` rather than blocking — already consistent with §5.9's
> per-component drag rule, so it's the low-risk default.

Ambiguity: `set polygon_1.radius 42` writes a literal; `set` on a **derived** slot is rejected
(settled). Undefined: what `set` does when the target is already a **formula** slot.

Options: (a) reject — "radius is driven by table_x.A1; unlink first," matching §5.9's drag
behaviour. (b) implicitly unlink then set.

Recommendation: (a) — §5.9 already establishes "refuse, and say what drives it" for writes to a
driven slot; `set` should teach the same lesson the mouse does. (b) also destroys a formula with
no undo built.

Reversible? Yes — one branch in one command handler. Provisional choice taken: not yet (Phase 3
hasn't begun).

---

## Q-003 — Does `explode` preserve the object's ID and name?
Raised: entry 0000 (reviewer)   Brief section: §5.5, §5.2
Status: **ANSWERED → D-007** (ruled at entry 0002-REVIEW-phase0)

Ambiguity: §5.5 says `vertices` survives explode "re-sourced," and that "anything downstream
reading `vertices` is unaffected" — which only holds if the object keeps its identity.
Non-reversible: shapes the data model, so this was correctly escalated rather than guessed.
See D-007 for the full ruling and rationale.
