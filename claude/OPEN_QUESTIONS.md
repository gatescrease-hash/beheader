# OPEN QUESTIONS

Unresolved ambiguity in `PROJECT_BRIEF.md`. Raise one here rather than guessing whenever
the brief is silent, ambiguous, or self-contradictory on something load-bearing.

Procedure is in `PROCESS_BRIEF.md` §7. In short: write the question, take a **reversible**
provisional choice if one exists (tag it `// PROVISIONAL(Q-NNN)` at every affected site), stop
the cycle if the choice is not reversible. Answered questions are marked `ANSWERED → D-NNN` in
place here and are never deleted.

Next free ID: **Q-007**

> **Revision note (2026-08-22, Manager cleanup):** compacted to STE; every question, option,
> recommendation, reversibility call, and reviewer note is preserved in substance. Full original
> wording is in the untouched sacred copy — see `MANAGER_CHANGELOG.md`.

---

## Q-006 — Is a non-finite number (`NaN`, `Infinity`, `-Infinity`) legal document state?
Raised: entry 0018-REVIEW-phase0 (reviewer)   Brief section: §5.1 (`Value`), §5.11, §6 clause 4
Status: OPEN
Blocks: Phase 0 clause 4 — answer this before `document.ts`'s round-trip test is written.

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
