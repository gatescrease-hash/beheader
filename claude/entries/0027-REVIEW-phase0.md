# 0027-REVIEW — phase 0 (PHASE GATE)
Date: 2026-08-22   Phase: 0   Model: reviewer (Claude Opus 5)
Reviewing: entry 0026 (`phase0-revise-fix`) — commit `0e46a17`. Hand-back forced by §6.1 trigger 1:
this cycle answers a REVISE verdict on the phase gate.
Previous review: 0025-REVIEW-phase0 (verdict: REVISE, 4 fix-list items + gate re-claim)

**Verdict: ACCEPT WITH EDITS.** All four fix-list items are genuinely closed — re-probed against
the code, not the log — and closed at the right layer. One new finding, the same rule applied to
the two fields nobody had applied it to yet; fixed here (2 conditions, 4 tests) and generalised as
**D-027** so there is no fourth round of it. Q-008's provisional choice approved.

## **PHASE 0 GATE: SIGNED OFF. Phase 1 may begin.**
All four §6 acceptance clauses pass, and clause 4 now survives the probes that falsified it twice:

1. **Topological propagation including derived slots** — closed 0012-REVIEW (`eval.test.ts`'s
   reverse-declared-order fixture). Untouched since.
2. **Cycle rejected, offending slots named, prior state provably unchanged** — closed 0017,
   accepted 0018-REVIEW. Through the real `mutate` entry point, deep-compared against a pre-call
   snapshot.
3. **Deleting a slot with dependents is rejected** — closed 0022, accepted 0025-REVIEW. Uses
   `validateIntegrity`'s pre-existing dangling-reference check; names every dependent (§5.1.1).
4. **A document round-trips to JSON and back identically** — closed **this cycle**, after two
   failed claims. The enumeration is now complete: a `Document`'s numbers live in slot values, in
   journal payloads, in `camera`, and in `nextObjectId`; cycle 0026 closed the first two on both
   the write and read sides, and this review closes the last two. `document.test.ts`'s
   `expect(saveDocument(loaded)).toBe(json)` pins it as text, not shape.

Phase 1 constraints are at the bottom of this entry. Read them before `formula/`'s first file —
which is itself a §6.1 trigger 2 review point.

## Did the fix list close?
Re-probed each through the real public API. All four: yes.

```
1. write side
   mutate([setSlot v=Infinity, setSlot v=5])   -> ok:false  "operation 1 of 2: value_1.value would
                                                  hold an illegal value (Infinity) ... (D-025/Q-008)"
   mutate([createObject {v:NaN}, deleteObject]) -> ok:false  "operation 1 of 2: value_2.value ..."
2. read side
   loadDocument(file whose JOURNAL holds 1e999) -> ok:false  "journal contains an illegal number ..."
3. Q-008
   mutate([setSlot v=-0])                       -> ok:false  "... an illegal value (-0) ..."
4. depth checks I added of my own
   createObject with [{x:0,y:0},{x:1,y:Infinity}] -> ok:false, message renders the whole array
   setSlot of a FORMULA slot whose cached value is NaN -> ok:false
   loadDocument(file with -0 / 1e999 in an OBJECT slot) -> ok:false, via the payload check
```

Three things this got right that were not required:

- **The predicate was widened, not duplicated.** `hasNonFiniteNumber` → `isIllegalNumber` (leaf) +
  `hasIllegalNumber` (over `Value`), one `||`, one place. That is D-020/D-026's own stance applied
  to a predicate, and it is why fix 3 cost one line instead of four call sites.
- **`formatIllegalNumber` special-cases `-0` → `"-0"`.** `String(-0)` is `"0"`, which would have
  made the rejection message for Q-008's defect indistinguishable from legal state — the D-023
  defect one layer further in, caught unprompted.
- **The mutation transcript discloses which of its own tests are NOT unique to fix 1** (those whose
  illegal value also survives to the post-fold graph, so check 4 catches them independently). That
  is an implementer telling the reviewer which of its tests prove less than they appear to. It is
  the opposite of the failure mode this project keeps finding.

`rawContainsIllegalNumber`'s generic untyped walk is the right tool, for the reason given: it does
not need the journal's structure to be trustworthy first, and a well-shaped journal's only numbers
are inside a `Slot.value`. Keeping journal STRUCTURE unvalidated while checking its VALUES is a
coherent line, and the header now states it accurately.

## Finding (D-027) — the rule was applied to slot values, then to the journal, but never to the document
`camera` and `nextObjectId` are the `Document`'s other two numeric surfaces, and neither passes
through `mutate`, so neither had either guard. Probed:

```
file camera zoom 1e999 -> loads as Infinity -> re-saves as "zoom":null   (not identical)
file camera x    -0    -> loads as -0       -> re-saves as "x":0         (not identical)
file nextObjectId -0   -> Number.isInteger(-0) is true, so it loaded -> re-saves as 0
in-memory camera NaN   -> saves as "zoom":null -> that file no longer LOADS at all
```

The first three are §6 clause 4 counterexamples in a field §5.11 names explicitly. The fourth is
the worse one and is not fixable on the read side: `saveDocument` returns a `string` and has no
failure channel, so nothing can reject an in-memory camera. Today that is harmless — `DEFAULT_CAMERA`
is the only thing in the tree that writes a camera — but Phase 3 is where a zoom-to-fit over an
empty selection divides by zero, and the result is a document that cannot be reopened.

Fixed the read side here. Ruled **D-027** for the rest: value legality belongs to the whole
`Document`, a new numeric field extends the same check, and whoever writes a field `mutate` never
sees owns keeping it legal. This is the third round of one defect (slot values → journal → camera);
each individual fix was correct and scoped to what the previous review named, which is exactly why
it wanted a ruling rather than a fourth fix.

For completeness, since the enumeration is what makes the gate claim safe: `formatVersion` must
equal `1` exactly; a subnormal that underflows on parse (`1e-400` → `0`) changes a hand-written
file's text but not the loaded document's round trip, so it is outside clause 4; string values
round-trip because `JSON.stringify` has produced well-formed output since ES2019; and object key
order survives `deepClone` and `evaluate`'s spreads.

## Reviewer edits (all mutation-checked or comment-only)
1. `document.ts` — `reconstructCamera` rejects an illegal `x`/`y`/`zoom`; the `nextObjectId` check
   gains its `isIllegalNumber` arm (`Number.isInteger` already excluded the infinities and `NaN`,
   never `-0`). Four tests. Mutation checks: gating the camera condition off failed exactly the two
   camera tests; removing the `nextObjectId` arm failed exactly the one.
2. `document.ts` — `saveDocument`'s doc comment claimed no document this software produces "can
   hold an illegal number anywhere". True of the object list and the journal, not of `camera`;
   corrected, with the Phase 3 obligation stated where the next reader will be standing.
3. `primitives/schema.ts` — dropped a dead `hasIllegalNumber` import (the file's header points at
   the shared predicate as guidance for future computes; `add` itself deliberately still uses
   `Number.isFinite`, which is correct — see below). `noUnusedLocals` is not enabled, so nothing
   caught it; turning it on is a config change and therefore not mine to make.
Post-edit: **213/213**, typecheck clean under both configs.

## Rule / invariant / spec audit
Rules 1, 3, 4, 6, 7 — not touched; Rule 1 re-checked mechanically, clean under the DOM-free config.
Rule 5 — upheld: the raw-value walk is explicitly the cheaper-and-equivalent choice over
reconstructing typed operations, and argued rather than asserted. **Rule 2 — upheld, and the leak
0025-REVIEW found is closed at its source**: an illegal value can no longer enter committed state
OR the journal, and the journal is append-only history again rather than history JSON quietly
rewrites. Invariants: no dangling edges, rejection leaves prior state unchanged, slot set fixed,
derived-inside-the-pass, no `#CYCLE` — untouched. **Graph state plain and serializable — now
genuinely true of the whole document**, which is the invariant Phase 0 exists to establish.
Spec: §5.1's "errors must never throw" upheld (`rawContainsIllegalNumber` cannot throw on any
JSON-derived value); §5.11 conformant; §5.1's step order unchanged, with the new check sitting
beside D-021's as a precondition rather than inside `validateIntegrity`, which is the right place
for a check about an OPERATION rather than about the graph.

## Legibility
Headers, vocabulary, and comment discipline hold. `describeUndeclaredSlot`'s third call site is
argued from D-022's own bounded claim rather than assumed. No `any`, no `.only`, no `.skip`, no
`MUTATION-TEST` residue. One residue of my own: `mutation.ts` now has three pre-staging checks and
one in-`validateIntegrity` value check, which is a lot of places a rejection can come from — the
file header does enumerate them, and each is in the right place, so I am leaving it. If a fourth
appears, that is the moment to give them one named section rather than four.

## Honesty audit
Re-ran everything before touching anything. `npm run typecheck` clean under both configs.
`npx vitest run` → **209 passed (209), 8 files, 0 skipped, 0 `.only`** — exactly as reported.
`git diff --numstat 4c44172 HEAD -- src/` → 674 added / 124 deleted = **798 changed lines across 7
files**, matching the entry to the line and to the file, measured the way 0014-REVIEW's constraint
6 asks and stated with the reason it does not matter this time (the trigger fires regardless). That
is the drift I flagged at 0025-REVIEW corrected without being told twice.

The four mutation experiments are precise, and experiment 4's note — that only one test asserts the
rendered `-0` because the others assert `ok === false` or a substring — is the kind of thing a
weaker entry would have left as "1 test failed." No scope expansion: Phase 1 untouched, no new
operation kind, journal structure deliberately still unvalidated and said so.

Item 5 ("re-claim the gate in a cycle that does nothing else") was folded into this same cycle
rather than run separately. Accepted: the fix list and the re-claim are one unit of work, the
clauses were cited rather than re-tested as instructed, and splitting them would have produced an
empty cycle. My wording asked for more separation than the situation needed.

## 0026's three questions
1. **Reject the whole batch regardless of what a later operation does — confirmed.** The journal
   records what was asked, not what survived; an operation whose payload never reaches the final
   graph is still history. The alternative you describe (only reject if it would have survived)
   would require simulating the fold to answer a question about a payload, which is both more code
   and the wrong question. Note the second reason it is right: a batch that writes an illegal value
   and then overwrites it is a caller bug, and failing loudly at the source beats being quietly
   correct by accident.
2. **The generic walk's "false positive" is not one.** If the journal ever grows a numeric field
   that is not a `Value`, an illegal number in it must still be rejected — under D-027 every number
   in the document is bound by the same rule, whatever field it sits in. The behaviour you flagged
   as a caveat is the specified behaviour. Keep the walk generic.
3. **Single-site `PROVISIONAL(Q-008)` is correct**, and better than the alternative. §7 asks for a
   tag wherever the choice is *encoded*; after 0026 there is exactly one such site. Tagging
   `hasIllegalNumber` too would tag a consumer, and the next consumer would then want one as well.
   Approved and recorded on the question.

## Answered questions
**Q-008 — provisional (a) APPROVED**, same standing as Q-005/Q-007; stays OPEN for the human's
option to overrule, blocking nothing. Its `add` reasoning is correct and correctly scoped to `+`
(`-1 * 0` is `-0`, so a future multiplying compute must re-derive it — 0026 says so in
`schema.ts`'s header, which is where that reader will be). **Q-007** approved provisional at
0025-REVIEW, unchanged. **Q-005** open by design and now due: Phase 1 is what resolves it.
**Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred. **Q-003 → D-007**, **Q-006 → D-025**.
Next free: **Q-009**.

## Constraints carried into Phase 1
1. **`formula/`'s first real file is a §6.1 trigger 2 review point** — the first file of a new
   subsystem. Stop there; do not batch the grammar behind it.
2. **Q-005 resolves in Phase 1: WIDEN `FormulaAst`, never replace it.** A binding must stay
   representable as a bare reference under the full §5.3 grammar. Grep and clear every
   `PROVISIONAL(Q-005)` tag (`formula/ast.ts`, `graph/eval.ts`, `mutation.ts`) as part of that
   cycle, and mark the question ANSWERED.
3. **`extractDependencies` is eager and TOTAL across both `IF` branches** (§5.3, §9's forbidden
   moves). A cycle in an untaken branch is a real cycle. Do not make it lazy or branch-aware, and
   do not "optimise" it later.
4. **One engine, Rule 4** — text formulas and table cells use the same evaluator. Never a second.
5. **D-027 binds new compute functions**: anything doing arithmetic maps an illegal result to
   `#TYPE` itself; `validateIntegrity` runs BEFORE `evaluate` and never re-checks its output.
   Multiplication and division must re-derive the `-0` argument that `add` correctly skipped.
6. Still standing: no defensive cycle check inside `eval.ts`; do not extend `nonDerivedSlotPaths`
   to slot families; **L-16** (registry-wide disjointness test) is still the cheapest open cleanup;
   count diffs from `git diff --numstat` alone.
