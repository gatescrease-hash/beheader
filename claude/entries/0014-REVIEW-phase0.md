# 0014-REVIEW — phase 0
Date: 2026-08-22   Phase: 0   Model: reviewer (Claude Opus 5)
Reviewing: entry 0013 (`edge-derivation`), commit `4aa7571`
Previous review: 0012-REVIEW-phase0

**Verdict: ACCEPT WITH EDITS.** Three surgical edits (§8), one new ruling (**D-017**). The next
slice may begin.

---

## 1. Rule audit

| Rule | Verdict | Evidence |
|---|---|---|
| 1 — `engine/` never touches DOM | **Upheld** | `grep -rn "document\.\|window\.\|canvas\|HTMLElement\|getElementById" src/engine/` → every hit is inside a comment (the `NEVER imports:` header line, prose about `document.ts`). `tsc --noEmit -p tsconfig.engine.json` (DOM-free `lib`, D-006) clean. |
| 2 — all state change through `mutation.ts` | **Upheld, and advanced** | This cycle *is* the beginning of `mutation.ts`. `deriveEdges` mutates nothing: it takes `readonly GraphObject[]` and returns a fresh `readonly Edge[]`. No caller of it exists yet. |
| 3 — two-layer addressing | **Upheld** | Every edge endpoint is an `Address` (`objectId` + `path`). No `name` is read anywhere in `mutation.ts`. `nonDerivedSlotPaths` holds paths, never keys — D-010's rule kept. |
| 4 — engine/render separation | **Not touched** | No render layer exists. |
| 5 — performance is a non-goal | **Upheld** | Full rebuild from scratch every call, no memoization, no incremental tracking. Matches `cycles.ts`/`eval.ts`'s established discipline and step 3's own wording ("rebuild the whole edge set rather than tracking which slots were affected"). |
| 6 — slot set fixed during evaluation | **Upheld** | `derivedSlotDependencyAddresses` is called at edge-derivation time and nowhere else — which is exactly what that resolver's own header reserves. Confirmed by grep: one call site, `mutation.ts:135`. |
| 7 — plain serializable state | **Upheld, one note** | `Edge` is two plain `Address`es. See L-17 (§4) on the shared path-array references — a legibility note, not a violation. |

## 2. Invariant audit

- **Slot set fixed during evaluation** — upheld; nothing here runs during evaluation.
- **Derived slots evaluated inside the topological pass, never a post-pass** — untouched;
  `eval.ts` unchanged this cycle.
- **Dependency extraction eager and total** — **this is the finding.** Eager, yes. Total, *no*:
  total over the schema's declarations, not over the object's slots. See §6 and **D-017**.
- **Evaluation lazy** — untouched.
- **Rejection leaves prior state unchanged** — no rejection path exists yet (step 4/5/6 unbuilt).
- **No dangling edges** — correctly *not* this function's job; `deriveEdges` emits an edge for a
  reference to a nonexistent object verbatim, and the test says so in its name. §5.1.1 assigns
  that check to step 4. Right call, and documented as such.
- **Graph state plain and serializable** — upheld.

## 3. Spec conformance

§5.1 step 3 reads: *"Re-derive ALL edges from stored formula ASTs and schema declarations
(static and dynamic). Per Rule 5, rebuild the whole edge set rather than tracking which slots
were affected."*

- "Rebuild the whole edge set" — conformant, literally and in spirit.
- "schema declarations (static and dynamic)" — conformant. Both dependency kinds route through
  `derivedSlotDependencyAddresses`, which already handles both.
- "**from stored formula ASTs**" — **not conformant, and this is the substantive finding of the
  review.** The implementation derives from schema-declared paths that happen to hold a formula,
  which is a strictly smaller set than "stored formula ASTs." §6 covers what that costs.

Everything else the brief specifies for this step is met. The narrowing was not a shortcut — it
was forced by a real constraint (§6), and the cycle reasoned about that constraint carefully. It
just did not notice that its solution changed the function's domain.

## 4. Legibility audit

Strong, and above the bar this project has been holding. Headers present and structured
(`IMPLEMENTS` / `LAYER` / `WHAT THIS IS` / `INVARIANTS UPHELD HERE` / `NOT DONE HERE`), vocabulary
locked, no `any`, `PROVISIONAL(Q-005)` tagged at both affected sites (`mutation.ts:21`, `:113`) as
STATUS requires rather than only in prose. Tests are named as behaviour, and several name the
*reason* as well ("an address's VALIDITY is step 4's job (§5.1.1), not edge derivation's") — that
is the right habit.

Two things worth singling out as good:

- `expectSameEdges` compares edge **sets** and then separately asserts length. The length
  assertion is doing real work: a set comparison alone would hide accidental duplicates, and the
  inline comment says exactly that. This is the kind of test helper that fails for the right
  reason.
- The integration test feeding `deriveEdges`'s own output into `evaluate` is a genuine
  end-to-end check, not a shape check, and it is the test that would catch a wrong edge direction
  even if the unit assertions were sloppy. Confirmed load-bearing in §5.

New items:

- **L-17** — `deriveEdges` puts the module-level path constants (`ADD_IN_A_PATH`, …) directly into
  returned edges, so many edges share array references with the schema registry. Harmless today
  (`readonly string[]` end to end, and step 1's deep clone will break the sharing anyway), but
  worth a sentence in the header if `document.ts` ever round-trips edges rather than re-deriving
  them. Cosmetic; not fixed.
- **L-18** — `deriveEdges` does not deduplicate. A derived slot declaring the same dependency path
  twice would emit two identical edges. Both consumers tolerate it (`eval.ts` guards on `visited`,
  `cycles.ts` on its colour map), so this is a note, not a defect. Do not add a dedupe pass to
  "fix" it without a case that needs one.
- **L-19** — `STATUS.md` came out of 0013 at **200 lines** against PROCESS_BRIEF §2's "keep
  < 150." It is 200 good lines, which is the problem: the cap exists so the next implementer
  actually reads it, and this one is now long enough to skim. Fixed by this review's rewrite;
  flagged so it is not re-grown. The material that keeps getting re-explained in full each
  cycle (the `slotKey`-inverse pattern, the schema-registry-stores-functions answer) belongs in
  DECISIONS, which is where it already is — STATUS should point, not restate.

## 5. Honesty audit

The entry matches the diff, and the D-016 compliance is real rather than performed. I re-ran the
numbers and did an independent probe of my own rather than taking the pasted output on trust:

- **Test counts are real.** `npm test` → 117/117, 7 files, 0 skipped. Grepped `.only(`/`.skip(`
  across `src/` — no hits, as claimed.
- **Both typecheck configs are clean**, as claimed.
- **The D-016 mutation checks are genuine.** I did not merely re-run theirs; I ran a *different*
  one they had not: I flipped `sourceSlot`/`dependentSlot` in the binding-edge push, so the edges
  exist but point backwards. Result: **5 failed, 112 passed**, all five in `mutation.test.ts`,
  including the integration test. Edge *direction* — not just edge presence — is genuinely
  pinned. That is a stronger result than the entry claimed for itself.
- **Scope is honest.** "Explicitly not in scope" is accurate and unusually specific, and the entry
  volunteers that no §6 acceptance clause is claimed this cycle. Under D-016 that is the correct
  report, and it was made without being asked.
- **The `nonDerivedSlotPaths` decision was disclosed, argued, and had its rejected alternative
  named.** This is the standard the process wants.

Two items go the other way:

- **Line counts in the trigger-9 report are understated.** The entry says `mutation.ts` (137
  lines) + `mutation.test.ts` (169) + schema changes (~35 net) ≈ 354 source lines. Actual, by
  `git diff --numstat f4f1663 HEAD`: 146 + 183 + 15 + 59 added / 28 removed = **403 added source
  lines across 4 files** — *over* the ~400 guideline the entry concluded it was under. The
  conclusion was right anyway (trigger 9 reported as fired, on trigger-2 grounds), so nothing
  followed from the error. But 0012-REVIEW made a point of re-counting every number in an entry,
  and these are the first ones since that did not survive it. Count from `numstat`, not from
  memory of what you wrote.
- **The second item is the finding itself, and the implementer got closer to it than the entry
  suggests.** `STATUS.md`'s last gotcha, written this cycle, says: *"Any future `ObjectSchema`
  entry must populate BOTH `nonDerivedSlotPaths` and `derivedSlots` — `deriveEdges` silently
  derives zero binding edges for a type that forgot the former, which would present as 'formulas
  on this type never seem to propagate,' not a compile error."* That is the right hazard,
  correctly described, and spotting it unprompted deserves saying plainly.

  What was mis-scoped is its severity, in three ways. (a) It is written as a **per-type**
  authoring mistake, but the divergence is **per-slot** — an object can carry a formula slot its
  otherwise-correct schema simply does not list. (b) The consequence is given as "formulas never
  propagate," a visibly broken thing a user would report. The real consequence is worse and
  quieter: a **cycle becomes invisible to `detectCycle`** and the mutation loop *accepts* the
  document (§6). (c) It is filed as a note to future schema authors, which places it out of
  reach of the two people who need it — whoever writes step 4, and whoever writes `document.ts`
  and can load an undeclared slot straight out of a file.

  Compounding it: the header, the function doc, and the entry all still say `deriveEdges` walks
  "every stored formula AST," describing the wider domain the code does not have. A hazard noted
  in STATUS while the module's own header denies it exists will lose to the header. Fixed by
  reviewer edits 1 and 2 — the hazard is now stated where the code is and pinned by two tests.

## 6. The finding: edge derivation is narrower than the graph, and the gap is silent

`deriveEdges` walks `ObjectSchema.nonDerivedSlotPaths`. `evaluate` walks
`Object.keys(object.slots)`. There are now **two disagreeing answers to "which slots exist,"** and
nothing reconciles them.

I probed an `add` object carrying an undeclared fourth slot `in.c`:

```
EDGES: [ in.a -> out.result , in.b -> out.result ]
in.c AFTER EVAL: {"kind":"formula", ..., "value":42}
```

`in.c` reads `obj_1.value`; no `obj_1.value → obj_9.in.c` edge was derived. It still evaluated,
and it still got the right answer — by declaration-order luck, because nothing ordered it.

Then the case that decides the verdict. A genuine three-slot cycle,
`in.c → in.a → out.result → in.c`:

```
CYCLE EDGES: [ in.c -> in.a , in.a -> out.result , in.b -> out.result ]
detectCycle: {"hasCycle":false}
EVALUATED: in.a #REF , out.result #REF , in.c #REF
```

Only one of the three cycle edges runs through the undeclared slot, and dropping it makes the
**entire cycle invisible**. `detectCycle` is not wrong — it is correct over the edge set it was
handed, and the edge set is incomplete. So step 5 would **accept** this document, and step 7 then
quietly writes `#REF` into all three slots and commits.

This is Phase 0 acceptance clause 2 ("a cycle is rejected with the offending slots named") failing
without anything reporting a failure. It is the same silent-failure class as 0012-REVIEW §7, one
layer earlier: that review established that `evaluate` does not fail loudly on cyclic input and
that step 5 is therefore load-bearing. This cycle shows that step 5 can run, be correct, and still
pass a cyclic document through — because step 3 did not give it the whole graph.

**Reachability is not theoretical.** `document.ts` is the next slice and Phase 0's clause 4. It
loads `GraphObject[]` from JSON. An undeclared formula slot is one hand-edited file away.

**And the mechanism does not generalise.** `nonDerivedSlotPaths` is a fixed
`readonly (readonly string[])[]`. A table's `cells.A1`…`cells.Z99` is a slot *family*, not a fixed
list — the same limitation STATUS already carries for `address.ts`'s hardcoded cells mapping
(D-005/D-009). The chosen extension point cannot cover the one object type the brief spends the
most words on. That does not make it wrong for Phase 0; it makes it a known temporary shape, and
it needs to be on the record now rather than discovered at Phase 4.

Cycle 0013 saw a narrower form of this — see §5 — and recorded it as advice to future schema
authors. It is the right instinct aimed one level too low.

**What I did not do:** redesign it. `deriveEdges`'s schema-driven approach is a legitimate answer
to a real constraint, taken for stated reasons, and choosing its replacement is not a review's
call to make unilaterally. D-017 therefore leaves `deriveEdges` alone and puts the obligation on
step 4: **reject any object whose slot set disagrees with its schema, naming the offending slots.**
That converts a silent wrong answer into a loud rejection, costs nothing to build in now, and
commits to nothing about how slot families are eventually expressed.

## 7. Reviewer edits

1. **`src/engine/mutation.ts`** — corrected the header's `WHAT THIS IS` item 1 and the
   `deriveEdges` doc comment, which both claimed the function walks "every stored formula AST."
   Replaced with what it actually walks, plus a hazard block naming the schema/object divergence,
   the probe result, and the slot-family limit. *Rationale: the overstatement is what hid the
   finding; a header that describes a wider domain than the code has is worse than no header.*
2. **`src/engine/mutation.test.ts`** — added two tests under "KNOWN GAP, D-017" pinning the
   **current** behaviour: an undeclared formula slot yields no edge, and a real cycle through one
   is invisible to `detectCycle`. *Rationale: makes the gap executable rather than prose, and
   stops it being closed by accident. The block's comment says explicitly that these are replaced
   by a rejection test when D-017 part 2 lands — not deleted.*
3. **`src/engine/primitives/schema.ts`** — six lines on `ObjectSchema.nonDerivedSlotPaths`'s doc
   comment recording the two limits and pointing at D-017. *Rationale: this is where a future
   implementer will be tempted to add table entries, so it is where the warning has to be.*

After all three: `npm run typecheck` clean on both configs; `npm test` → **119/119**, 7 files,
0 skipped.

## 8. Open questions

None raised this cycle, correctly — the `nonDerivedSlotPaths` fork was resolved against
`primitives/schema.ts`'s own written forward guidance, which is following existing direction
rather than making a new judgement call. Next free ID remains **Q-006**.

Standing: **Q-001, Q-002** (Phase 3, deferred — fifth reaffirmation). **Q-004** (Phase 2, deferred).
**Q-005** (Phase 1, provisional choice approved at 0006-REVIEW; both `mutation.ts` sites correctly
tagged this cycle). **Q-003** ANSWERED → D-007.

## 9. Constraints carried into the next cycle

1. **D-017 part 2 is the first thing step 4 must do.** Before `detectCycle` is ever called from
   the mutation loop, reject any object whose actual formula/derived slot set is not covered by
   its schema. Message via `formatAddress`, never `addressKey` (D-015).
2. **D-016 still binds hardest here.** Two Phase 0 clauses land in `mutation.ts` — cycle rejection
   naming the offending slots, and prior state provably unchanged. Neutralise each implementation
   and show a *named* test fails before claiming either. Paste the output.
3. **"Prior state provably unchanged" means bit-for-bit, and needs a fixture that would notice.**
   A rejection test that only asserts the call returned a failure proves nothing about state. Deep
   compare the pre-mutation document against itself after the rejected call.
4. **Do not add a defensive cycle check inside `eval.ts`.** Carried from 0012-REVIEW and still
   correct. The fix for §6's finding is in step 4, not in `evaluate`.
5. **Do not extend `nonDerivedSlotPaths` to slot families.** D-017's Phase 4 note. If tables come
   up, that is a new mechanism and a new review.
6. **Count the diff from `git diff --numstat`, not from recollection** (§5).
7. **Batch is required from day one** (§5.1's own "Batch mutations (required)"), not a follow-up
   slice. Document loading MUST use it.
8. **L-13 is still unpinned** and becomes pinnable the moment step 4 exists — `eval.ts`'s
   stale-edge `continue` branch. Pin it then; until then do not describe it as covered.
