# 0014-REVIEW — phase 0
Date: 2026-08-22   Phase: 0   Model: reviewer (Claude Opus 5)
Reviewing: entry 0013 (`edge-derivation`), commit `4aa7571`
Previous review: 0012-REVIEW-phase0

**Verdict: ACCEPT WITH EDITS.** Three surgical edits, one new ruling (D-017).

## Rule audit
Rule 1 — UPHELD (DOM-free config clean). Rule 2 — UPHELD; this cycle IS the start of
`mutation.ts`, and `deriveEdges` mutates nothing it's given. Rule 3 — UPHELD (edges are always
`Address`es; D-010 kept). Rule 5 — UPHELD (full rebuild every call, matches §5.1 step 3's own
wording). Rule 6 — UPHELD, one call site for `derivedSlotDependencyAddresses`, confirmed by grep.

## Invariant audit — the finding
Dependency extraction eager: yes. **Total: no** — total over the schema's declarations, not over
the object's actual slots. See the finding below (D-017). "No dangling edges" is correctly *not*
this function's job — `deriveEdges` emits an edge for a reference to a nonexistent object
verbatim, by design; §5.1.1 assigns that check to step 4.

## Spec conformance
§5.1 step 3 says re-derive edges "from stored formula ASTs and schema declarations." "Rebuild the
whole set" and "schema declarations (static and dynamic)" are both conformant. **"From stored
formula ASTs" is not** — the implementation derives from schema-declared paths that happen to
hold a formula, a strictly smaller set. The narrowing wasn't a shortcut; it was forced by a real
constraint (no sanctioned way to recover a formula slot's path from its object key) and reasoned
about carefully — it just didn't notice its solution changed the function's domain.

## Legibility
Strong, structured headers, `PROVISIONAL(Q-005)` correctly tagged at both sites. Two good habits
worth naming: `expectSameEdges` asserts set equality *and* length separately (catches duplicates
a set comparison alone would hide); the integration test feeding `deriveEdges`'s own output into
`evaluate` is a genuine end-to-end check. **L-17/L-18 (new, cosmetic)** — edges share array
references with the schema registry (harmless; step 1's future clone breaks the sharing anyway);
no deduplication (both consumers already tolerate it). **L-19** — `STATUS.md` reached 200 lines
against the <150 guideline; fixed by this review's rewrite.

## Honesty audit
Test counts and both typecheck configs verified independently. **The D-016 mutation check is
genuinely stronger than claimed** — I ran a different mutation (flipped edge direction) and it
also failed exactly the right 5 tests. Two items go the other way: the trigger-9 line count was
understated (403 added lines, not 354 — count from `git diff --numstat`, not memory); and the
`STATUS.md` gotcha this cycle wrote about the schema/object divergence was real but **scoped too
narrowly** — filed as "per-type," when it's per-slot; described as "formulas never propagate,"
when the real consequence is a cycle becoming invisible to `detectCycle`; filed as advice to
future schema authors, when it needed to reach whoever writes step 4. Right instinct, aimed one
level too low.

## The finding — edge derivation is narrower than the graph, and the gap is silent
`deriveEdges` walks `nonDerivedSlotPaths`; `evaluate` walks the object's actual `slots`. Probed:
an `add` object with an undeclared `in.c` reading another object's value evaluated fine — by
declaration-order luck, unordered by any edge. Then the decisive case: a genuine 3-slot cycle
routed through that undeclared slot made `detectCycle` report **`hasCycle: false`** — step 5
would accept a cyclic document, step 7 would quietly commit `#REF` everywhere. This is Phase 0
acceptance clause 2 failing without anything reporting a failure — the same silent-failure class
0012-REVIEW found one layer earlier in `evaluate`'s cyclic-input behaviour.

**What I did not do: redesign `deriveEdges`.** Its schema-driven approach is a legitimate,
reasoned answer to a real constraint; choosing its replacement isn't a review's call. Ruled
**D-017**: `deriveEdges` stays as-is; step 4 MUST reject any object whose slot set disagrees with
its schema, naming the offending slots.

Forward note: `nonDerivedSlotPaths` is a fixed list and can't express a table's `cells.A1`…
`cells.Z99` family — a known temporary shape, not a defect. Do not extend it to tables; Phase 4
must revisit the mechanism.

## Reviewer edits (3, small)
1. `mutation.ts` — corrected the header/docstring's "walks every stored formula AST" overstatement
   and added a hazard block naming the divergence.
2. `mutation.test.ts` — added two tests under "KNOWN GAP, D-017" pinning the *current* behaviour
   (undeclared slot yields no edge; the cycle through one is invisible) — executable, not prose,
   and explicitly replaced (not deleted) once D-017 part 2 lands.
3. `primitives/schema.ts` — six lines on `nonDerivedSlotPaths`'s doc comment recording the limit
   and pointing at D-017, where a future implementer will be tempted to add table entries.

Post-edit: 119/119, both configs clean.

## Open questions
None raised this cycle, correctly. Next free ID remains Q-006. Standing: Q-001/Q-002 (Phase 3),
Q-004 (Phase 2), Q-005 (approved, both `mutation.ts` sites correctly tagged), Q-003 ANSWERED →
D-007.

## Constraints carried forward
1. D-017 part 2 is the first thing step 4 must do — reject before `detectCycle` ever runs.
2. D-016 still binds hardest here — mutation-check both remaining Phase 0 clauses before claiming
   them.
3. "Prior state provably unchanged" needs a fixture that would actually notice — a deep compare
   against a pre-mutation snapshot, not a return-shape check.
4. Do not add a defensive cycle check inside `eval.ts` — the fix is in step 4.
5. Do not extend `nonDerivedSlotPaths` to slot families — that's a new mechanism and a new review.
6. Count diffs from `git diff --numstat`, not recollection.
7. Batch mutations are required from day one, not a follow-up slice.
8. L-13 is still unpinned; pin it once step 4 exists.
