# 0010 — REVIEW (phase 0, mid-phase)
Date: 2026-08-21   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0009-graph-cycles   Reviewing: cycle 0009
Prior review: 0008-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

Scope: cycle 0009 — `graph/cycles.ts` and `graph/cycles.test.ts` (both new), plus an
additive `addressKey` export in the already-reviewed `graph/edge.ts` and 4 tests for it.

---

## 1. Rule audit

| Rule | Verdict |
| --- | --- |
| **Rule 1** — `engine/` is pure, no DOM/window/canvas/`render/` | **UPHELD.** Grepped `document.`/`window.`/`canvas`/`CanvasRenderingContext`/`HTMLElement`/`render/` across all of `src/engine/`: nine hits, every one prose — seven are the file-header "NEVER imports" boilerplate, one references the *filename* `document.ts`, one is §5.1's product phrase "on the canvas". `cycles.ts` imports exactly two things, both `engine/*` (`./edge.ts`, `../address.ts`). `tsc -p tsconfig.engine.json` (DOM-free lib, D-006) exits 0 — that is the real enforcement, and I ran it. |
| **Rule 2** — all state change through `mutation.ts` | **NOT TOUCHED,** and checked rather than assumed. `detectCycle` writes only to four locals (`allNodes`, `outgoing`, `colors`, `stack`), all declared *inside* the function body — I grepped for top-level `const`/`let`/`var` in `cycles.ts` and there are none. No document state is read, let alone written; the module never sees a `GraphObject`. |
| **Rule 3** — addressing is load-bearing | **UPHELD, and the subject of this review's one ruling.** No address string is parsed or formatted anywhere here. `addressKey` produces a *key*, not an address — see §7 and D-015. All 44 address tests still pass untouched. |
| **Rule 4** — one formula engine | **NOT TOUCHED.** Nothing here evaluates or parses; the module walks an `Edge[]` it is handed. |
| **Rule 5** — performance is a non-goal | **UPHELD, and this is the rule the cycle was most exposed on.** Rule 5 names cycle detection specifically: "a full DFS from scratch on every mutation. No incremental bookkeeping." `detectCycle` rebuilds its entire adjacency from `edges` on every call and retains nothing between calls — there is no module-level state to retain it in. Recursive DFS over an explicit-stack version is the correct reading of "dumbest correct implementation," and the entry justifies it rather than apologising for it. Nothing was optimised. |
| **Rule 6** — slot set fixed during evaluation | **NOT TOUCHED.** This module neither evaluates nor changes a slot set. Worth noting it also does not *undermine* Rule 6 for the next cycle: it consumes an already-derived `Edge[]` and never calls `derivedSlotDependencyAddresses`, so it cannot be the thing that resolves a dynamic dependency mid-pass. |
| **Rule 7** — no §8 deferred items | **UPHELD.** Nothing here approaches constraint solving — the module *rejects*, which is §8's explicitly non-negotiable position ("Cycles are rejected, never solved"). |

## 2. Invariant audit

- **No `#CYCLE` value; cycles never enter graph state** — UPHELD, and named as an invariant in
  the header. Grepped `#CYCLE` across `src/`: two hits, both prose forbidding it (here and in
  `node.ts`). `detectCycle` returns plain data and writes nothing anywhere.
- **Graph state plain and serializable** — UPHELD. I checked this one deliberately, because the
  file is full of `Map`s and superficially trips §2's "no `Map`s of live objects" prohibition —
  the same flinch 0008-REVIEW recorded about the schema registry storing functions, and the
  answer has the same shape. The prohibition is on **stored graph state** (`GraphObject`/`Slot`/
  the document). These `Map`s are function-local traversal scratch, keyed by string, discarded on
  return, and they port to Rust as a `HashMap<String, _>` unchanged. Correct as written; a future
  implementer should not "fix" it.
- **Errors never throw** — UPHELD. The docstring claims "Never throws" and it holds: every lookup
  is a `Map.get` with a `??` fallback, and the one indexed access is bounded (below).
- **`gray` ⟺ on the stack** — UPHELD, and verified rather than assumed, because this is the one
  place the file could fail *silently* rather than loudly. `findIndex` returning `-1` would make
  `slice(-1)` yield the last stack element — a single-slot "cycle" that is not a cycle, with no
  error anywhere. It cannot happen: `colors.set(key, "gray")` and `stack.push` are adjacent and
  unconditional, as are `colors.set(key, "black")` and `stack.pop`, and the only path that skips
  the pop returns all the way out of the traversal. That pairing is what makes the `findIndex`
  safe, and it is intact.
- **The reported cycle is genuinely ordered** — UPHELD. `cycle[i]` feeds `cycle[i + 1]` because
  consecutive stack entries are visitor/neighbour pairs, and the wrap-around arc is the very edge
  that closed the cycle. The header states this contract precisely, and the test helper
  `isGenuineCycle` checks it structurally rather than pinning to a literal — the right call, since
  traversal order is an implementation detail.
- **Deterministic output** — UPHELD. Not required by the brief, but load-bearing for testing
  `mutation.ts` later: `allNodes` is a `Map`, so iteration is insertion order, so the same `Edge[]`
  yields the same reported cycle on every run. A rejection message is therefore reproducible.

## 3. Spec conformance

Conformant. Three readings I checked closely, because each is an interpretation rather than a
transcription:

- **Traversal direction `sourceSlot -> dependentSlot`.** The brief never states a graph-direction
  convention in so many words, and the entry flags this honestly as its one interpretive call. It
  is right, and it is over-determined: §5.1 defines an edge as `sourceSlot → dependentSlot`, and a
  topological order must place a prerequisite before its dependent. Both readings agree, and
  `eval.ts` needs the same direction — which STATUS already records.
- **A self-edge is a real one-slot cycle, not special-cased.** §5.3 is explicit (`A6 = SUM(A1:A6)`
  "produces a genuine self-edge and is correctly rejected as a cycle. This is right; do not
  special-case it"). The implementation needs no special case at all — a self-loop is a neighbour
  that is already grey — and there is a test named for the rule it defends. This is exactly the
  kind of "deliberate" brief note PROCESS_BRIEF §8.3 warns gets quietly normalised away, and it
  was not.
- **Reporting one cycle rather than all of them.** §5.1 step 5 says "Reject on cycle, naming every
  slot in the cycle" — one cycle. Finding one is sufficient to reject, and Rule 5 argues for the
  simplest sufficient answer. Correct, and recorded in the header as a deliberate choice so a
  later reader does not read it as an oversight.

The scope split — building `cycles.ts` without `eval.ts`, against a STATUS note that had grouped
them — is correct and well argued (PROCESS_BRIEF §13's smaller-diff tie-break, and D-013's
enforcement deserving its own undiluted review). This is the second consecutive cycle to leave the
obvious next module alone. That discipline is the workflow working.

## 4. Legibility audit

Strong. Headers state layer, allowed imports, and brief section; the "NOT DONE HERE" section draws
the `cycles.ts` / `eval.ts` line precisely ("whether a valid order exists at all" vs. "an order to
evaluate in"), which is genuinely useful to the next implementer. Vocabulary locked — slot, edge,
mutation, address used exactly as the brief defines them, no "node" for object. No `any` (the two
grep hits in `src/` are the English word). Tests are named as behaviour sentences, several naming
the rule they defend.

Items, none blocking:

- **L-10 — `addressKey`'s collision-safety argument rests on an unenforced premise.** The
  docstring's reasoning is sound as far as it goes: object IDs are `obj_<n>` (D-002) and
  `slotKey`'s segments come from `PATH_SEGMENT_PATTERN` (`/^[a-zA-Z0-9_]+$/` — I checked; no `.`,
  no `:`), so no two distinct addresses collide on the `"::"` join. But nothing type-checks that an
  `objectId` is `obj_<n>`; it is a bare `string`. This is D-010's gap one layer up, held closed the
  same way — by discipline — and it stays cheap only while `document.ts` remains the single
  allocator of IDs. Worth a line in `document.ts`'s header when it lands.
- **L-11 — one 149-character line** in `cycles.test.ts`'s `isGenuineCycle`, in a file that
  otherwise wraps near 90. Cosmetic; no formatter is configured, so left alone rather than churned.
- **L-12 — the `next as Address` assertion in that same helper is correct but unexplained.**
  `noUncheckedIndexedAccess` is on, so the cast is required, and `(i + 1) % cycle.length` makes it
  provably in range. A four-word comment would save the next reader the derivation. Fold in
  whenever the file is next open.
- **L-6 / L-8 (carried, unchanged)** — `TABLE_TYPE`'s widening annotation, and `ObjectSchema.type`
  duplicating its registry key. Neither `node.ts` nor `schema.ts` was open this cycle, so neither
  was folded in; correctly so.

## 5. Honesty audit

**Clean, and measurably more precise than last cycle.** Everything below I re-ran or re-counted
rather than reading off the entry:

- `npm run typecheck` → exit 0, both configs. ✓
- `npm test` → **97/97**, 5 files, 0 skipped, matching the pasted output exactly. ✓
- Arithmetic: 83 pre-existing (44 + 20 + 2 + 17) + 4 + 10 = 97. ✓ I counted the `it` blocks by
  hand: `cycles.test.ts` has 10, `edge.test.ts` has 6 (2 pre-existing + 4 new). ✓
- Grepped `.only`/`.skip`/`.todo` across `src/` → none. ✓
- No pre-existing test's expectations changed. `edge.test.ts`'s diff is one import line plus a new
  `describe` block; the two original `Edge` tests are untouched. §6.6 correctly does not fire. ✓
- **§6.9's line count is right this time.** The entry says "383 lines across 4 files";
  `git show --numstat` gives 157 + 171 + 26 + 29 = 383 source insertions across exactly 4 source
  files. That is the source-only convention 0008-REVIEW §5 asked to be held consistent, and it was
  held, to the line. The trigger genuinely does not fire.
- Triggers §6.2 and §6.3 are correctly self-reported, and the entry walks the *non*-firing triggers
  one by one rather than asserting "no others." That is what applying them honestly looks like.

**The entry claims nothing that is not built.** The distinction it draws — cycle **detection** is
done, cycle **rejection** is not, because rejection needs `mutation.ts` — is exactly right, and is
the kind of claim most likely to get rounded up. STATUS carries the same distinction in its first
paragraph. The "Where I got stuck" note (the reported cycle can start at any member) is a real
forward-facing observation, correctly characterised as "correct either way," and it is now
sharpened rather than contradicted by §6 below.

No scope drift. The `edge.ts` edit is genuinely additive — one import, one exported function, one
"NOT DONE HERE" line rewritten to point at it.

## 6. The finding that mattered: the one non-obvious line was untested

`detectCycle` is nine-tenths mechanical. Its single non-obvious line is this one:

```ts
const cycleStart = stack.findIndex((onStack) => addressKey(onStack) === neighborKey);
return stack.slice(cycleStart);
```

That slice is what makes the returned array **the cycle** rather than **the whole path the DFS
walked to find it**. Slicing from `0` instead would report every upstream slot the traversal passed
through on its way in — slots that are in no cycle at all.

**None of the ten tests could tell the difference.** I verified that rather than reasoning about
it: I replaced `stack.slice(cycleStart)` with `stack.slice(0)` and ran the suite. **97/97 passed.**

The cause is a coincidence in the fixtures, not a weakness in the assertions. `isGenuineCycle` is a
good helper and *would* catch this — but every cyclic fixture in the file happens to have its DFS
root inside the cycle, so `cycleStart` is `0` in all five and the two expressions return the same
array. The one test that looks like it covers this (`not.toContain(addressKey(d))`) excludes a
*successor* of the cycle, which the DFS never leaves on the stack; the case that bites is a
*predecessor*, which it does.

Why this is worth a finding rather than a shrug: this is not an internal detail. `detectCycle`'s
output becomes the rejection message, and §5.10 says every rejection message "must name the
specific slots involved" — the entire debugging story for now. Naming an innocent upstream slot
tells the user a slot is in a cycle when it is not, and sends them to unlink the wrong thing. §6's
acceptance criterion is that the **offending** slots are named.

Closed by reviewer edit 1. The new test uses `root -> tail -> a -> b -> a`, where the cycle is
`a ⇄ b` and both `root` and `tail` feed into it without being in it. Post-edit I re-applied the
same mutation to confirm the test actually kills it: **1 failed, 97 passed** — the new test, and
only the new test, catches it.

The lesson generalises, and it is D-008's lesson reached from a different direction: *test the case
the fixtures do not happen to produce.* Five cyclic fixtures all agreeing on `cycleStart === 0` is
the kind of accidental uniformity that makes a suite look thorough while leaving its most delicate
line unpinned.

## 7. The forward hazard: `addressKey` in a user-facing message → **D-015**

Separate from the above, and a hazard rather than a present defect.

`detectCycle` correctly returns bare `Address`es and correctly takes no object list — it has no
business resolving names. So `mutation.ts` receives a `readonly Address[]` and must turn it into
something like "table_x.A1 → table_x.B2 → table_x.A1."

The path of least resistance produces the wrong string. `mutation.ts` will already import from
`graph/edge.ts` for `Edge`; `addressKey` sits right there, takes exactly an `Address`, and returns
`obj_3::cells.A1` — which *looks* like a slot name. Reaching `formatAddress` instead means
threading the document's object list down to the message site, which is strictly more work.

The failure is quiet: `obj_3::cells.A1` is comprehensible enough in a test to pass review, and it
breaks the moment a user renames anything, because the ID is the one string in the system that does
not follow the name. That inverts Rule 3's two-layer scheme at exactly the point §5.10 calls the
whole debugging story.

Ruled as **D-015**: `addressKey` is an internal `Map`/`Set` key and never reaches the user; every
user-facing slot mention goes through `formatAddress`; and the inverse — `formatAddress` output is
never used as a key, since it changes under rename. Ruled now, before `mutation.ts` exists, on the
same timing argument as D-006 and D-013.

## 8. Reviewer edits (2, both small, each explained)

1. **Added 1 test to `graph/cycles.test.ts`** — `"names ONLY the slots in the cycle, never the
   upstream slots the DFS walked through to reach it"`. Closes the §6 gap: a cycle reached through
   a two-slot upstream tail, asserting the reported cycle's membership is exactly `{a, b}`.
   Verified by mutation in both directions (the mutant passes 97/97 before the edit; fails 1/98
   after). The assertion is a set-equality on membership rather than on traversal order, matching
   the file's existing and correct style.
2. **Corrected one overstated invariant in `graph/cycles.ts`'s header.** It claimed the DFS "visits
   every node that appears in at least one edge," stated unconditionally under INVARIANTS UPHELD
   HERE. True in the acyclic case; false the moment a cycle is found, since the traversal returns
   immediately. The intended claim — "does not stop at the first component" — is right and is
   tested; only the wording was too strong. Three lines added noting the early return and why it is
   correct. Header invariants are load-bearing here precisely because `eval.ts` is about to be
   written against this file's stated contract.

Post-edit verification, run by me: `npm run typecheck` → exit 0 (both configs); `npm test` →
**98/98 passed**, 5 files, 0 skipped.

## 9. Open questions

None raised in cycle 0009, and the entry's claim that its one interpretive call (traversal
direction) did not need one is correct — it follows from `Edge`'s already-reviewed field names and
is not observable through any public contract.

Standing questions, all unchanged and none newly answerable by this work:

- **Q-001, Q-002** — Phase 3 command surface. Deferral reaffirmed (third time). Both remain
  reversible single branches; take the recommended option as a `PROVISIONAL` choice if Phase 3
  arrives before the next review.
- **Q-004** — Phase 2, cell-reference case normalisation. Unchanged; current behaviour (a) stays
  pinned by test.
- **Q-005** — Phase 1, `FormulaAst`'s shape. Provisional choice (a) remains approved; the tags come
  out when Phase 1 widens the union.

---

## Verdict: ACCEPT WITH EDITS

The declared slice was delivered exactly, nothing else was touched, and the two constraints most at
risk of being quietly normalised — the self-edge that must not be special-cased (§5.3), and Rule
5's from-scratch-every-call requirement — were both honoured with their reasons attached. The scope
split away from `eval.ts` was the implementer's own call against a STATUS note that grouped them,
and it was the right call for the right reason. Reporting and line-counting were accurate to the
line, which is the second half of what makes a log worth keeping.

The one finding is a test gap rather than a code defect: the implementation is correct, and I
confirmed that by mutation rather than by reading. But the line that was correct is also the line
nothing was holding in place, and it is the line that decides which slots a user gets told to go
fix. It is pinned now.

**`graph/eval.ts` may begin.**

### Constraints carried into the next cycle

1. **D-013 is binding on `eval.ts`** (unchanged, and now the immediate next thing). The `read`
   callback passed to a derived slot's `compute` MUST resolve only that slot's declared dependency
   addresses and MUST return a `#REF` `ErrorValue` for anything else. Test it: a compute reading an
   undeclared address gets `#REF`, not a real value.
2. **Derived slots are evaluated INSIDE the topological pass.** No `recompute()`, no second pass.
   Still the single most important thing the next cycle must get right (§5.1, PROCESS_BRIEF §9).
3. **Call `derivedSlotDependencyAddresses` at edge-derivation time only**, never inside the
   evaluation loop (Rule 6).
4. **`eval.ts`'s topological sort walks `sourceSlot -> dependentSlot`**, the same direction
   `detectCycle` does — same graph, two purposes. Use `addressKey` for its `Map`/`Set` keys; do not
   reimplement it.
5. **`eval.ts` may assume its `Edge[]` is already acyclic.** `mutation.ts` step 5 runs `detectCycle`
   before step 7. Do not re-detect, and do not add a defensive cycle check that duplicates it.
6. **D-015 (new)** — `addressKey` never reaches a user-facing string; slot names in messages come
   from `formatAddress`. Binds `mutation.ts` most directly, but applies to anything that builds a
   message.
7. **D-014** — `Value` predicates live in `graph/node.ts`. Import `isErrorValue`; do not write a
   local copy.
8. **L-9 — the Phase 0 acceptance fixture MUST use formula input slots** (§6's "two formula input
   slots"). Copy `graph/node.test.ts`'s `add` fixture, not `schema.test.ts`'s.
9. **Cycle rejection must name every slot in the cycle, and prior state must be provably unchanged**
   (§6). Both need a test whose name says which property it defends — and per D-015, the message
   test asserts on the object's current **name**.
