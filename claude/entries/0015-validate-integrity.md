# 0015 — validate-integrity
Date: 2026-08-22   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0014-REVIEW-phase0   Last review: 0014-REVIEW-phase0 (verdict: ACCEPT WITH EDITS — "the next slice may begin.")

## Declared scope
Per STATUS.md and 0014-REVIEW's carried constraint 1: build `mutation.ts`'s integrity validation
(§5.1 step 4 / §5.1.1) — `validateIntegrity(objects, edges)`, covering D-017 part 2 (reject an
object whose actual formula/derived slots disagree with its schema) and §5.1.1's dangling-
reference rejection.

## What I did
- `mutation.ts` — added `validateIntegrity(objects, edges) => IntegrityCheckResult`, plus two
  private helpers, run in order, short-circuiting on the first with problems:
  1. **D-017 part 2** — re-derives the declared key set from `nonDerivedSlotPaths` ∪
     `derivedSlots` via `slotKey` (never the reverse), flags any `formula`/`derived` slot whose
     key isn't in it. No-schema types are skipped (D-017's one exception).
  2. **§5.1.1 dangling references** — for every edge, checks `resolveSlot(sourceSlot, objects)`;
     a miss names the DEPENDENT (never the missing source — nothing to `formatAddress` there,
     and D-015 forbids leaking the raw ID anyway).
  Both helpers collect ALL problems of their kind before returning.
- `describeUndeclaredSlot(object, key)` — a small isolated helper for check 1's message. See
  Decisions below for why it isn't `formatAddress`.
- `mutation.test.ts` — 9 tests added, 2 removed (0014-REVIEW's "KNOWN GAP" tests, replaced with
  real rejection tests per that review's own instruction): undeclared-slot rejection naming the
  slot; the exact 0014-REVIEW cyclic probe now rejected here, before `detectCycle` ever sees it;
  a no-schema type passing cleanly; two dangling-reference cases; the §6 fixture passing cleanly;
  a check-ordering test (both problem kinds present, only D-017's reported); a never-throws test.

## Decisions I made
- **`describeUndeclaredSlot` deliberately does NOT use `formatAddress`**, despite D-017's ruling
  text saying "via formatAddress." The tension: `formatAddress` needs an `Address` with a
  schema-declared path, and an *undeclared* slot has none by definition — there's nothing to look
  up. D-010's "declare it schema-side, never invert a key" escape hatch categorically can't apply
  here, since the whole point is a slot the schema doesn't know about. Chose to concatenate the
  object's current name with the raw key instead — rename-safe (D-015's actual concern), and
  produces the identical string `formatAddress` would for every schema-registered type today
  (`value`/`add`, neither a table). Stops being exact only for a table with an undeclared slot,
  which D-017 already forbids reaching. **Flagged explicitly for the reviewer** rather than
  treated as settled — see Questions below.
- One check, not two, for §5.1.1's two stated clauses ("references a slot that doesn't exist" /
  "would delete a slot with dependents") — a deleted slot and a never-existing one both fail the
  identical `resolveSlot` check on the post-apply state, so a single check covers both for free,
  matching Rule 5's "full recheck, no incremental bookkeeping."
- `validateIntegrity` takes `edges` as an already-derived parameter, matching `detectCycle`/
  `evaluate`'s existing `(objects, edges)` shape rather than a third convention.
- Both problem lists are fully collected before returning — one message naming three problems,
  not three rejections one retry apart.

## Verification
`npm run typecheck` — clean, both configs. `npm test` — 126/126 (119 − 2 + 9). D-016 mutation
checks on both checks: disabling check 1 failed exactly the 2 tests asserting it plus the
ordering test (3/126); disabling check 2 failed exactly the 2 dangling-reference tests (2/126);
both reverted, back to 126/126.

## Acceptance criteria status
No §6 clause claimed this cycle. Integrity validation is one internal step inside a loop with no
stage/apply/commit around it yet — clause 2 needs steps 1, 2, 5, 6 wired together and a real
pre-mutation snapshot before it's even attemptable.

## Where I got stuck
The `describeUndeclaredSlot`/`formatAddress` tension above — resolved with a disclosed judgment
call rather than a clean application of existing guidance.

## Open questions raised
None formally opened — the tension above is reversible (message wording only, nothing about the
data model or mutation sequence) and disclosed in full rather than blocking the cycle.

## Review point
Fired: modified `mutation.ts` (load-bearing).

## Questions for reviewer
1. Is `describeUndeclaredSlot`'s raw-key message an acceptable disclosed exception to D-017's
   "via formatAddress" wording, or should this have been a formal open question first?
2. Is collapsing §5.1.1's two stated clauses into one `resolveSlot`-based check the right reading,
   or does the brief intend a structurally separate deletion check even though this one subsumes
   it in every case constructed so far?
