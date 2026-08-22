# OPEN QUESTIONS

Unresolved ambiguity in `PROJECT_BRIEF.md`. Raise one here rather than guessing whenever
the brief is silent, ambiguous, or self-contradictory on something load-bearing.

Procedure is in `PROCESS_BRIEF.md` §7. In short: write the question, take a **reversible**
provisional choice if one exists (and tag it `// PROVISIONAL(Q-NNN)` at every affected
site), stop the cycle if the choice is not reversible. Answered questions are marked
`ANSWERED → D-NNN` in place here and are never deleted.

Next free ID: **Q-004**

---

## Q-001 — What does `unlink` store when the last computed value is not a plain scalar?
Raised: entry 0000 (reviewer, pre-identified)   Brief section: §5.10, §5.1
Status: OPEN — **deferral reaffirmed at 0002-REVIEW-phase0**
Blocks: Phase 3 (`unlink` command). Not needed before then.

> Reviewer note (0002-REVIEW-phase0): deliberately NOT ruled on. This is a Phase 3
> command-surface question, it is reversible (one branch in one command handler), and nothing
> in Phase 0 or Phase 1 depends on it. Ruling now would commit the project to a UX behaviour
> before there is a command line to feel it against. **If Phase 3 arrives before the next
> review, take the recommendation below — option (a) — as a PROVISIONAL choice under D-004
> rather than blocking the cycle.**

Ambiguity: `unlink polygon_1.origin.x` is specified as "revert to literal, keeping last
computed value." The brief does not say what happens when that last computed value is an
`ErrorValue` (the formula was broken at the moment of unlinking), or a `Point` / `Point[]`
(structurally possible, since those are in the `Value` union and a slot could hold one).

Options:
  (a) Store whatever the value was, errors included — an unlinked slot can hold a literal
      `#REF`, which the user then overwrites with `set`.
  (b) Store the value if it is a scalar; substitute the schema default if it is an error.
  (c) Reject the unlink when the current value is an error, telling the user to fix or
      delete the formula first.

My recommendation: (a). It is the least surprising and the least clever — the value the
user was looking at is the value they keep. An `ErrorValue` in the graph is legitimate
state per §5.1, so storing one as a literal does not violate anything, and the error badge
keeps it visible. (b) silently changes a value the user can see on screen, and (c) makes
`unlink` fail exactly when the user most wants to use it.

Reversible? Yes — this is a single branch inside one command handler.
Provisional choice taken: not yet (Phase 3 has not begun). Tagged at: —

---

## Q-002 — Does `set` on a formula slot implicitly unlink, or is it rejected?
Raised: entry 0000 (reviewer, pre-identified)   Brief section: §5.10, §5.1
Status: OPEN — **deferral reaffirmed at 0002-REVIEW-phase0**
Blocks: Phase 3 (`set` command). Not needed before then.

> Reviewer note (0002-REVIEW-phase0): deliberately NOT ruled on, same reasoning as Q-001 —
> Phase 3, reversible, nothing upstream depends on it. **If Phase 3 arrives before the next
> review, take the recommendation below — option (a), reject and name what drives the slot —
> as a PROVISIONAL choice under D-004 rather than blocking.** Note it is already consistent
> with §5.9's per-component drag rule, so (a) is the low-risk default.

Ambiguity: `set polygon_1.radius 42` writes a literal. `link` converts a slot from literal
to formula and `unlink` converts it back. The brief does not say what `set` does when the
target is *already* a formula slot. It does say `set` on a **derived** slot is rejected —
that part is settled.

Options:
  (a) Reject: "radius is driven by table_x.A1; unlink first." Consistent with the drag
      behaviour in §5.9, which refuses to write a bound component and says so.
  (b) Implicitly unlink then set. Convenient, one step instead of two.

My recommendation: (a). §5.9 establishes the house behaviour for "you tried to write
something that is driven by something else" — refuse, and say what drives it. `set` should
match, or the system teaches two different lessons about single-source-of-truth depending
on whether the user reached for the mouse or the keyboard. (b) also destroys a formula the
user may have spent effort on, with no undo built (§8).

Reversible? Yes — one branch in one command handler.
Provisional choice taken: not yet (Phase 3 has not begun). Tagged at: —

---

## Q-003 — Does `explode` preserve the object's ID and name?
Raised: entry 0000 (reviewer, pre-identified)   Brief section: §5.5, §5.2
Status: **ANSWERED → D-007** (ruled at entry 0002-REVIEW-phase0)
Blocks: nothing further. **Load-bearing — was correctly escalated rather than guessed.**

> Ruling (D-007): option (a). `explode` mutates the object in place — same ID, same name, the
> `type` field changes. Object `type` is mutable state and schema lookup must read the
> object's *current* type. See D-007 for the full rationale, which adds a third argument the
> analysis below did not make: §5.5's `force` flag on explode is only meaningful if the object
> survives and merely loses *some* slots.

Ambiguity: §5.5 describes `explode` as "an object-type change, so the schema swaps too."
It also states that `vertices` survives explode, "merely re-sourced from the new literal
vertex slots," and that "anything downstream reading `vertices` is therefore unaffected."
That guarantee only holds if the object keeps its identity — if explode were implemented
as delete-plus-create, the new object gets a fresh ID under D-002 and every stored AST
pointing at `obj_7.vertices` would break, contradicting the stated payoff.

Options:
  (a) Explode mutates the object in place: same ID, same name, `type` field changes, the
      parameter slots are removed and per-vertex literal slots are added.
  (b) Explode replaces the object and rewrites inbound references to the new ID.

My recommendation: (a), strongly. It is what §5.5's "vertices survives" language implies,
and (b) requires a whole reference-rewriting pass that exists nowhere else in the design
(the only rewriting pass specified is table reference adjustment, §5.4). Note (a) means
object type is mutable state on the object, which is worth writing down explicitly in
`node.ts` because it is otherwise a surprising thing to discover.

Reversible? **No.** This shapes the object data model and the mutation's structure. Per
PROCESS_BRIEF §7.3, do not take a provisional choice — escalate before implementing
`explode`.
Provisional choice taken: no. Tagged at: —
