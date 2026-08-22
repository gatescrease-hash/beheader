# 0012 — REVIEW (phase 0, mid-phase)
Date: 2026-08-22   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0011-graph-eval   Reviewing: cycle 0011
Prior review: 0010-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

Scope: cycle 0011 — `src/engine/graph/eval.ts` and `src/engine/graph/eval.test.ts`, both new,
561 source lines. No other source file was touched, and I confirmed that: `git show --numstat
HEAD` lists exactly four files, two of them log artifacts.

---

## 1. Rule audit

| Rule | Verdict |
| --- | --- |
| **Rule 1** — `engine/` is pure, no DOM/window/canvas/`render/` | **UPHELD.** Grepped `document.`/`window.`/`canvas`/`CanvasRenderingContext`/`HTMLElement`/`render/` across all of `src/engine/`: eleven hits, every one prose — file-header "NEVER imports" boilerplate, references to the *filename* `document.ts`, and §5.1's product phrase "on the canvas". `eval.ts` imports from exactly four modules, all `engine/*`. `tsc --noEmit -p tsconfig.engine.json` (DOM-free lib, D-006) exits 0 — the real enforcement, and I ran it. |
| **Rule 2** — all state change through `mutation.ts` | **NOT TOUCHED,** and checked rather than assumed. `evaluate` mutates nothing it is given: it returns `objects.map(...)` over fresh object literals, and its four accumulators are all declared inside the function body. I grepped `eval.ts` for top-level `const`/`let`/`var` — there are none beyond the imports, so there is nowhere for state to be retained between calls. The input `GraphObject[]` is never written to. |
| **Rule 3** — addressing is load-bearing | **UPHELD.** No address string is parsed or formatted here. `addressKey` is used only as a `Map`/`Set` key, which is precisely what D-015 licenses; nothing in the file builds a user-facing string from one. The two `ErrorValue` messages it does build are prose and name no address at all — correct, if slightly unhelpful (see L-14). |
| **Rule 4** — one formula engine | **UPHELD, narrowly and correctly.** `evaluateReference` is not a second evaluator: it is the whole of Phase 0's one-variant AST, explicitly marked `PROVISIONAL(Q-005)` and documented as the thing `formula/eval.ts` replaces wholesale in Phase 1. It does not parse, and it implements no grammar. |
| **Rule 5** — performance is a non-goal | **UPHELD.** Adjacency is rebuilt from `edges` on every call; no dirty tracking, no memoisation, no state between calls (pinned by the "re-propagates from scratch" test). `evaluateDerivedSlot` re-filters the whole `edges` array for every derived slot — O(derived × edges) — and that is the correct choice, not an oversight: it is the dumbest implementation that enforces D-013, and precomputing a dependency index would be exactly the "felt wasteful" optimisation PROCESS_BRIEF §4 names as a rule violation. |
| **Rule 6** — slot set fixed during evaluation | **UPHELD, structurally rather than by care.** The slot universe is read once, up front, from `Object.keys(object.slots)`; `nextSlot` is exhaustive over the three kinds and returns the same kind at the same key every time; `derivedSlotDependencyAddresses` is never called in this file (grepped — zero occurrences), so no dynamic resolver can run mid-pass. |
| **Rule 7** — no §8 deferred items | **UPHELD.** Nothing here approaches scripts, containers, undo UI, or constraint solving. |

## 2. Invariant audit

- **Derived slots evaluated INSIDE the topological pass, never in a post-pass** — **UPHELD**, and
  this is the invariant the cycle most needed to get right. There is no second loop in the file:
  one `for (const nodeKey of topologicalOrder)` handles all three kinds through one `switch`.
  Genuinely tested, too — the two-object chain asserts `add_2.in.a === 7`, which a post-pass
  implementation could only produce as `null`. This one is demonstrated, not merely covered.
- **D-013's read restriction** — **UPHELD and mechanically enforced**, per 0010-REVIEW's carried
  constraint 1. The `read` callback closes over a per-slot `Set` built from `edges` and returns
  `#REF` for anything outside it. Building that set from the *given* `edges` rather than by
  re-calling `derivedSlotDependencyAddresses` is the correct reading of carried constraint 3, and
  the two sets are the same set by construction, since a derived slot's only inbound edges are the
  ones that function produced. The implementer's own mutation check on this test is real — I
  reproduced it.
- **Never throws** — **UPHELD** for every path a real document can reach. Two of the three
  defensive arms are tested; the third is not (L-13).
- **No `#CYCLE` value** — UPHELD. Grepped: no occurrence in `eval.ts`.
- **Graph state plain and serializable** — UPHELD. Same `Map`-flinch as `cycles.ts` and the same
  answer (0010-REVIEW §2): function-local traversal scratch keyed by string, discarded on return.
  The returned `GraphObject[]` is plain data throughout.
- **Rule 6's "same slot keys out as in"** — UPHELD, but note that the test which claims to check
  it is weaker than it reads: `{ ...object.slots, ...slotsFor(object.id) }` spreads the *input*
  slots first, so a slot `evaluate` skipped entirely would still appear in the output with its
  stale value and the key-set assertion would still pass. The property is nonetheless true, and I
  confirmed it by probe rather than by reading: restricting the DFS roots to edge sources only
  (so isolated slots are never visited) fails the malformed-derived-slot test, 106/107. The
  universe-construction line is pinned — by a different test than the one that appears to pin it.

## 3. Spec conformance

Conformant. Three readings I checked closely:

- **Reverse DFS postorder is a correct topological order** for a DAG — standard, and the right
  call for the stated reason (same traversal family and same `sourceSlot -> dependentSlot`
  direction as `cycles.ts`, per carried constraint 4). The entry's rejection of Kahn's algorithm
  is well argued and I agree: two differently-shaped algorithms over one graph is a legibility
  cost with no offsetting benefit under Rule 5.
- **Literals return their stored value; formulas cache their last evaluated result.** Matches
  §5.1's table and `node.ts`'s `FormulaSlot` docstring exactly. Returning the identical literal
  slot *reference* (pinned with `toBe`) is a defensible reading of "nothing computes a literal"
  and costs nothing.
- **Errors propagate rather than roll back** (§5.1: "Evaluation errors produce `ErrorValue`s; they
  do **not** roll back the mutation"). Honoured — `evaluate` has no failure channel at all, which
  is the correct shape.

No deviation from the brief, and no place where the brief was silent and got guessed at.

## 4. Legibility audit

Strong, and the strongest of any cycle so far on one specific axis: the file explains *why* at
every non-obvious line, and the entry's "Decisions I made" section reads like something written
to be useful to the next model rather than to be graded. Headers state layer, allowed imports,
and brief section. Vocabulary locked — "slot", "edge", "derived", "mutation" used exactly as the
brief defines them; "node" appears only for a *graph* node, which is the brief's own usage
("Slots are the nodes of the dependency graph", §5.1), never for an object. No `any` (the one
grep hit is the English word). Tests are behaviour sentences and several name the rule they
defend.

Items, none blocking:

- **L-13 (new) — the stale-edge branch is dead code as far as the suite is concerned.** The
  `node === undefined` `continue` at the top of the evaluation loop is claimed as handled in the
  entry's "What I did." I replaced it with a `throw` and ran the suite: **108/108 passed** — no
  test reaches it. It is genuinely defensive (mutation.ts step 4 rejects dangling edges before
  step 7 ever runs), and I deliberately did not add a test rather than expand this review's edit
  budget past what matters. Fold one in when `mutation.ts` lands and the interaction becomes
  real; until then, do not describe it as covered.
- **L-14 (new) — the two `ErrorValue` messages name no slot.** "formula reference did not resolve
  to a value" tells a user nothing about *which* reference. §5.10 requires every rejection message
  to name the specific slots involved, and while these are evaluation errors rather than
  rejections, they are the same debugging story. This cannot be fixed here — D-015 forbids
  `addressKey` in a user-facing string, and `evaluate` has no object list to give `formatAddress`.
  Record it as a real gap for whoever renders error badges (§5.9), not as a defect in this file.
- **L-15 (new, cosmetic) — `postorder.slice().reverse()`.** The `.slice()` defensively copies a
  local array nothing else reads. Harmless; `.reverse()` alone is equivalent here. Fold in
  whenever the file is next open.
- **L-6 / L-7 / L-8 / L-10 / L-11 / L-12 (carried, unchanged)** — none of the owning files was
  open this cycle, so none was folded in. Correctly so.

## 5. Honesty audit

Mostly clean, and precise on everything mechanical. Everything below I re-ran or re-counted:

- `npm run typecheck` → exit 0, both configs. ✓
- `npm test` → **107/107**, 6 files, 0 skipped, matching the pasted output exactly. ✓
- Arithmetic: 98 pre-existing (44 + 20 + 6 + 17 + 11) + 9 = 107. ✓
- Grepped `.only`/`.skip`/`.todo` across `src/` → none. ✓
- No pre-existing test's expectations changed; no pre-existing file was touched at all. §6.6
  correctly does not fire. ✓
- §6.9's line count is right: `git show --numstat` gives 334 + 227 = 561 source lines across 2
  source files, exactly as reported, and the trigger is self-reported rather than dodged. The
  entry's argument that the number is a documentation artifact rather than scope creep is fair,
  and I checked it — the file is one exported function plus five documented helpers. ✓
- **The D-013 mutation check is real.** I reproduced it: removing the `declaredDependencyKeys`
  guard fails exactly one test, the D-013 one. The pasted output is accurate. ✓
- Triggers 2, 3 and 9 are correctly self-reported, and the entry walks the seven non-firing
  triggers one by one rather than asserting "no others." ✓

**The one thing the entry gets wrong is its acceptance-criterion claim — see §6.** It reports
§6's "propagate in correct topological order *including through derived slots*" as **PASSING**
and cites three tests. The "including through derived slots" half is genuinely demonstrated. The
"in correct topological order" half is not demonstrated by any test in the suite, and I
established that by probe rather than by argument. This is not padding or optimism — the cited
tests are real and they test something real — but it is the exact failure mode PROCESS_BRIEF §5
asks to be hunted for hardest, and it landed on the one clause of the phase gate this module
exists to satisfy.

No other overstatement. No scope drift of any kind: two new files, nothing else touched, the
declared slice delivered exactly.

## 6. The finding that mattered: the topological sort was not pinned by anything

`eval.ts` has one job that `cycles.ts` does not already do — put the slots in an order. That job
is one line:

```ts
const topologicalOrder = postorder.slice().reverse();
```

I replaced the entire DFS result with the raw declaration order — no sort of any kind:

```ts
const topologicalOrder = [...nodesByKey.keys()];
```

**The full suite passed, 107/107.** Not one of the nine new tests, nor any of the ninety-eight
existing ones, could tell a real topological sort from no sort at all.

The cause is a coincidence in the fixtures, not a weakness in the assertions — the same shape as
0010-REVIEW §6, and worth stating plainly because it is now the second consecutive instance.
`eval.test.ts`'s object arrays are written in dependency order (`obj_1`, `obj_2`, then the `add`
that reads them; then `obj_4`, then the `add` that reads *that*), and `addObject` builds its slot
record in dependency order too (`in.a`, `in.b`, then `out.result`). JS object key order is
insertion order, and `evaluate` builds its universe by iterating `Object.keys` — so the input
order *was already* a valid evaluation order in every fixture. Both implementations therefore
return identical results on all of them.

Why this is a finding rather than a shrug, given that the implementation is correct:

1. **It is the phase-gate clause.** §6's Phase 0 criterion says "watch it propagate in correct
   topological **order** *including through derived slots*." The entry claims that clause
   PASSING. A suite that passes with the sort deleted does not demonstrate it, and PROCESS_BRIEF
   §9 forbids claiming a criterion without an executable test demonstrating it.
2. **`mutation.ts` is next, and it is the module that consumes this contract.** Everything
   downstream — cycle rejection, the propagation acceptance test, Phase 4's whole thesis — rests
   on the assumption that `evaluate` orders from the edges. That assumption was being held in
   place by nothing but the fixtures' incidental writing order.
3. **The failure it hides is silent.** A wrong order does not throw; it reads a value that is not
   there yet and yields `#REF`, or worse, a stale one. That presents as flaky reactivity — the
   exact bug D-013 and PROCESS_BRIEF §9 are both written to prevent, reached by a third route.

Closed by reviewer edit 1, verified in both directions: the new test passes against the real
implementation (108/108) and is the **only** test that fails against the mutant (1 failed, 107
passed).

Because this is the second consecutive cycle in which a module's single most load-bearing line
survived a full green suite untouched, I ruled the process fix as **D-016** rather than fixing it
a second time in code: mutation-check every acceptance-criterion claim before making it, and
write order-fixtures in the wrong order. Cycle 0011 already applied exactly that discipline,
voluntarily and well, to its D-013 test — it simply did not apply it to the claim that mattered
most.

## 7. The forward hazard for `mutation.ts`: cyclic input fails quietly here, not loudly

`eval.ts`'s header stated, under INVARIANTS UPHELD HERE:

> If `edges` does describe a cycle, the DFS below recurses forever on the back-edge — which is
> exactly why step 5 must come first.

**That is false, and I checked rather than assumed.** `visit` marks a node visited *before* it
recurses, so a back-edge hits the `visited.has` guard and returns immediately. I fed `evaluate` a
two-slot cycle: it returned in 2 ms with both slots holding `#REF`. No hang, no stack overflow,
no error — a completed evaluation pass and a document full of plausible-looking values.

The right conclusion is the opposite of the one the header drew. The reason step 5 must come
first is not that skipping it would be unmissable; it is that skipping it would be *invisible*.
An implementer writing `mutation.ts` against the header as written could reasonably reason "if I
get the step order wrong my tests will hang, so I'll notice" — and be wrong in the direction that
costs a debugging session. Corrected by reviewer edit 2. This matters more than a normal doc nit
because carried constraint 5 (`eval.ts` may assume acyclicity, do not re-check) is what makes
step 5 load-bearing, and the header is where the next implementer will look for it.

## 8. Reviewer edits (2, both small, each explained)

1. **Added 1 test to `graph/eval.test.ts`** — `"propagates correctly with every object AND every
   slot declared in reverse dependency order (§6: 'in correct topological order')"`, plus one
   fixture helper `addObjectDeclaredBackwards`. Closes the §6 gap: the same two-object chain the
   file already tests, written backwards in both dimensions — most-dependent object first, and
   `out.result` declared before the `in.*` slots it reads — so no prefix of the input order is a
   valid evaluation order. Verified by mutation in both directions (the mutant passes 107/107
   before the edit; fails 1/108 after, and only this test fails). Appended rather than
   interleaved so the diff is a pure addition and no existing test moves.
2. **Corrected the false cycle-behaviour claim in `graph/eval.ts`'s header and the matching
   inline comment.** Replaced "recurses forever on the back-edge" with what actually happens
   (returns early, completes the pass, emits an order that violates an edge, values quietly
   become `#REF`) and why that makes step 5 load-bearing rather than conventional. Same class of
   edit as 0010-REVIEW's edit 2, and for the same reason: `mutation.ts` is about to be written
   against this file's stated contract, and a header invariant that overstates how loudly
   something fails is worse than one that says nothing.

Post-edit verification, run by me: `npm run typecheck` → exit 0 (both configs); `npm test` →
**108/108 passed**, 6 files, 0 skipped.

## 9. Open questions

None raised in cycle 0011, and I agree that none was owed — every design fork the entry records
(key reconstruction, D-013's source set, the traversal family) was settled by an existing ruling
rather than by a judgement call on load-bearing structure. That is the §7 mechanism working as
intended.

Standing questions, all unchanged and none newly answerable by this work:

- **Q-001, Q-002** — Phase 3 command surface. Deferral reaffirmed (fourth time). Both remain
  reversible single branches; take the recommended option as a `PROVISIONAL` choice if Phase 3
  arrives before the next review.
- **Q-004** — Phase 2, cell-reference case normalisation. Unchanged; current behaviour (a) stays
  pinned by test.
- **Q-005** — Phase 1, `FormulaAst`'s shape. Provisional choice (a) remains approved. The tag
  surface grew this cycle as expected and as declared: `eval.ts`'s `evaluateReference` is now a
  second site. Both tags come out together when Phase 1 widens the union.

---

## Verdict: ACCEPT WITH EDITS

The module is correct, the slice was delivered exactly as declared, nothing else was touched, and
the two constraints most at risk of being quietly normalised — derived slots evaluated inside the
pass, and D-013 enforced mechanically rather than by convention — were both honoured with their
reasoning attached and, in D-013's case, with a mutation check the implementer ran unprompted.
That check is the best single thing in this cycle, and D-016 exists to make it standard rather
than optional.

The finding is a test gap and a claim that outran it, not a code defect. But the untested line
was the one line this module exists for, and the claim it supported was a phase-gate clause. Both
are now closed: the sort is pinned by a fixture that cannot pass without it, and the record says
what is demonstrated and what is not.

**`mutation.ts` may begin.**

### Constraints carried into the next cycle

1. **D-016 (new) is binding immediately, and `mutation.ts` is the cycle it bites hardest.** Two
   of Phase 0's four criterion clauses land there — cycle rejection naming the offending slots,
   and prior state provably unchanged. Neutralise the implementation of each and show a named
   test fails, before claiming either. Paste the output.
2. **Phase 0's criterion is a four-part gate and three parts are still open.** Cycle rejection
   with prior state provably unchanged; slot deletion with dependents rejected; document
   round-trip. Only the propagation clause is closed, and only as of this review's edit.
3. **D-015** — the acyclicity rejection message maps every `Address` from `detectCycle` through
   `formatAddress`, never `addressKey`. The test asserts the object's **current name** appears in
   the message.
4. **Step 5 before step 7, and this is not self-enforcing.** `evaluate` assumes acyclicity and
   does not re-check, and — per §7 above — getting the order wrong fails *silently*, not loudly.
   Do not add a defensive cycle check inside `eval.ts` to compensate; call `detectCycle` first.
5. **Edge derivation is real, unwritten scope** (STATUS's own forward constraint, and it is
   correct). Neither `eval.ts` nor `cycles.ts` builds an `Edge[]`; the walk over every formula
   AST's `ReferenceNode` plus every schema's `derivedSlotDependencyAddresses` call is new code in
   `mutation.ts`. Budget for it as a real slice, and consider splitting it out — the last two
   cycles both benefited from leaving the obvious next module alone.
6. **`derivedSlotDependencyAddresses` is called at edge-derivation time and nowhere else** (Rule
   6). `eval.ts` correctly never calls it; `mutation.ts` is the module that must.
7. **D-010 / D-015** — slot keys only from `slotKey()`, document-wide keys only from
   `addressKey()`, and neither ever reaches a user-facing string.
8. **L-13** — `eval.ts`'s stale-edge branch is untested. When `mutation.ts` makes the interaction
   real, pin it; do not describe it as covered before then.
