# 0128 — REVIEW (Phase 5): the batch since 0125-REVIEW — 0126's `!`-marked broken span and 0127's `text` schema entry + `resolvedContent` (D-114)
Date: 2026-09-01   Phase: 5   Model: reviewer
Reviews: **0126** (D-116 + D-117 built in `evaluateBlockTree`), **0127** (the `text` schema entry,
`resolvedContent`, and D-114's widening of `graph/eval.ts`). Source diff since 0125-REVIEW: **10
files, +923 / −184** (0126: `text.ts` +102/−69, `text.test.ts` +44/−14; 0127: the eight files in its
own entry).
Previous review: 0125-REVIEW-phase5
Verdict: **ACCEPT WITH EDITS.** Two comment-only edits across 2 files; one ruling, **D-119**. No new
open question — Q-021 is still owed by the `measuredHeight` cycle, not this batch.
**0126's unreviewed `text.ts` changes are cleared as part of this batch. The §6.3 batch cap is
reset. §6.2's block on Phase 6 stays lifted (it was already lifted at 0125). The next slice —
`measuredHeight` + D-118 + Q-021 — may proceed; it is a §6.1 trigger of its own.**

## 1. What I ran, before reading anything as true

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  29 passed (29)
      Tests  1375 passed (1375)          # at HEAD, before my edits

$ grep -rnE "\.(only|skip|todo)\(" src/     → nothing
```

**Every countable claim in the batch survives measurement.**

| Claim | Source | Measured |
| --- | --- | --- |
| 0127 source diff `+777 / −101`, 10 files | entry 0127 | `git show df1797f --numstat`: ins 158+152+145+91+90+82+40+12+4+3 = **777**, del 17+1+28+1+42+0+6+3+2+1 = **101**, **10** files ✓ |
| 0126 source diff `+146 / −83`, 2 files | entry 0126 | `git show 433d894 --numstat`: `text.ts` 102/69, `text.test.ts` 44/14 ✓ |
| batch `~923 additions / 10 unique files` — over the 800/10 cap | entry 0127 | 777 + 146 = **923**; 0126's 2 files ⊂ 0127's 10 ✓ — cap correctly HIT, review correctly forced |
| test count 1329→1342→1375 | entries 0126/0127 | 1342 at `433d894`, **1375** at HEAD ✓ (`text.test.ts` 47→64, `schema.test.ts` 32→34, `eval.test.ts` 20→28, `mutation.test.ts` 197→203) |
| 0127 mutation-check: swap D-013 membership before `isEmptyInExtentCell` → exactly **1 red** | entry 0127 | reproduced: **1 red**, `eval.test.ts` "D-114 clause 3: an EMPTY in-extent cell reads as 0 — coercion BEFORE the D-013 membership check" — the one named. D-013 test + non-taken-branch test stay green ✓ |
| 0127 mutation-check: disable the resolver's empty-in-extent skip → exactly **2 red** | entry 0127 | reproduced: **2 red**, `text.test.ts` "gives an EMPTY in-extent cell NO edge" + `mutation.test.ts` "…no edge for an empty in-extent cell" — both named; out-of-extent test stays green ✓ |
| 0126 mutation-check: break the `!` mark → "exactly 3 red"; render `.message` not `.error` → "exactly 6 red" | entry 0126 | now **5** and **8** red respectively — NOT a discrepancy: 0126's counts were measured at 1342 tests, and 0127 added coverage that also pins both behaviours (`eval.test.ts`'s "reads !#REF" / "broken span marked in place", `text.test.ts`'s `computeResolvedContent` cases). Every extra red is a new 0127 test asserting the same rule. The behaviour 0126 built is now pinned *harder* than it claimed. ✓ |

Third consecutive batch (after 0121, 0125) whose numbers all hold. The "paste the runner's tail"
discipline held again.

## 2. Rule audit

- **Rule 1 (engine purity / no canvas for text measurement)** — **upheld.**
  `grep -nE "document\.|window\.|canvas|CanvasRenderingContext2D|from \"\.\./render"` over the four
  changed engine files: every hit is a header "NEVER imports" line or prose. `text.ts`'s new imports
  are `address` (type), `eval-context` (type only — `EvalContext` for `computeResolvedContent`'s
  unused 3rd param), `graph/node`, `schema` (type only — `DerivedSlotComputeDeps`), `table`. All
  engine. `computeResolvedContent` takes `context` and never touches it — content resolution needs
  no measurement; `measuredHeight` (next cycle) is where the measurer lands.
- **Rule 2 (mutation-only state change)** — **not touched.** `deriveEdges` Source 2 gained a
  forwarded `objects` argument; `evaluateDerivedSlot` gained an `objects` parameter and a `readRange`
  it builds and hands down. No new state assignment anywhere. `grep` for slot writes outside
  `mutation.ts`: none introduced.
- **Rule 3 (addressing)** — not touched. Every address in the new code is built as
  `{ objectId, path }` and compared through `addressKey` / `resolveSlot`, never string-concatenated.
- **Rule 4 (one formula engine, no second for text)** — **upheld, and this is the rule D-114
  exists to serve.** `computeResolvedContent` has no evaluation logic: it re-parses `content` and
  calls `evaluateBlockTree(blocks, read, deps.readRange)`, which calls `formula/eval.ts`'s `evaluate`
  for every embedded AST — the *same* `read`/`readRange` a `formula` slot's AST gets, now built by
  the *same* `graph/eval.ts` helpers (`isEmptyInExtentCell`, `buildRangeReader`) that
  `evaluateFormula` uses. D-114 clause 2 ("never a second evaluation path") is satisfied structurally.
- **Rule 5 (dumbest correct implementation)** — upheld. `buildRangeReader` / `isEmptyInExtentCell`
  are a plain extract-and-share of code that was already inline; no caching of the block tree
  (D-114 clause 4 — re-parsed in `resolveTextDependencyAddresses` AND `computeResolvedContent`, every
  mutation, over the same staged object list); no dirty-flag machinery.
- **Rule 6 (slot set fixed during evaluation)** — **upheld, and it was the load-bearing risk here.**
  `resolveTextDependencyAddresses` is a `dynamic` dependency resolver; it runs ONLY from
  `deriveEdges` Source 2 (verified: `derivedSlotDependencyAddresses`'s sole non-test caller is
  `deriveEdges`; `graph/eval.ts`'s header still states it never calls that function). It reads
  `content` `literal`-only. `computeResolvedContent` re-parses `content` during evaluation but only
  to READ — it adds and removes no slots. The block tree is derived state, not slots.
- **Rule 7** — not touched.

Vocabulary lock: `grep -iE "\b(property|properties|field|computed)\b"` over the new lines — "style
field" quotes §5.6 verbatim; "computed value" is D-117's own phrase used correctly; "Phase 5 gate
property" means a property *of the gate*. No *slot* synonym drift.

## 3. Invariant and spec audit — D-114, D-116, D-117 against the code

**D-114 — all four clauses built.**

| Clause | Requirement | Built |
| --- | --- | --- |
| 1 | Same `read`/`readRange` contract; range on the SAME `enumerateRangeCellAddresses` | `buildRangeReader` extracted from `evaluateFormula`, shared with `evaluateDerivedSlot`; the resolver expands ranges with the same `enumerateRangeCellAddresses` `deriveEdges` Source 1 uses |
| 2 | Widen `evaluateDerivedSlot`, never a parallel path | `evaluateDerivedSlot` gained `objects` + a `readRange`; `computeResolvedContent` delegates, no evaluator of its own |
| 3 | D-110 coercion BEFORE the D-013 membership check, with a test that fails if swapped | `read` runs `isEmptyInExtentCell` first, then `declaredDependencyKeys.has`; `eval.test.ts` "D-114 clause 3…" goes red iff swapped (mutation-checked, §1). D-013 still bites for a non-cell undeclared read (`eval.test.ts` "D-013 still bites…", green) |
| 4 | Block tree never cached | `parseTextContent` called fresh in both halves; no `Block[]` stored in a slot, field, or module |

**D-116 (parse-broken span) — clauses 1–6.** `case "error"` → `result += "!" + block.source` and
`break` (was `return { error:"#PARSE" }`). The rest of the tree renders (clause 2). `resolvedContent`
holds a `string` — `evaluateBlocks`/`evaluateBlockTree` return type narrowed `string | ErrorValue` /
`Value` → `string`, so clause 3 is in the type, not merely asserted. Mark is engine-side, in the
resolved string (clause 4). A broken CONDITIONAL renders its whole-construct `source`;
`orphaned` is walked for dependencies, never rendered (clause 5) — pinned by `text.test.ts` "a
PARSE-broken conditional renders its WHOLE construct source verbatim behind `!`, never its branches".

**D-117 (parsed-but-errored span) — clauses 1–6.** `renderRuntimeError(value)` → `"!" + value.error`
(the CODE — mutation-checked: rendering `.message` reddens every D-117 test). Applied to: an
`ErrorValue` from a `{= }` AST; a `Point`/`Point[]` that has no flat text form; an `ErrorValue`
condition; a non-boolean condition (both take NEITHER branch — clause 6). A broken span inside the
taken branch is marked by the same recursion (clause 6, "no new case"). Kept distinct from D-116 —
two functions, two doc comments stating why they must not merge (clause 3).

**One judgment call, disclosed and sound:** a `Point` embedding is neither "parse-broken" (D-116) nor
strictly "evaluates to an `ErrorValue`" (D-117) — it evaluates fine and is simply unembeddable. 0126
routes it through D-117's `!#TYPE` marking rather than propagating `#TYPE` for the whole tree.
Propagating it while marking `#DIV0` in place would be incoherent; the marking choice is the one
consistent with both rulings' governing principle (one bad embedding never costs the paragraph).
Within bounds. Not a finding.

**§5.6 conformance.** `resolvedContent` is "from `content` plus every referenced slot" — the resolver
returns `content` first, then every address `extractTextDependencies` reports (both conditional
branches, and a broken conditional's `orphaned` — eager/total per §5.3). `measuredHeight` is
deliberately absent (STATUS "half-built on purpose"); the schema's `derivedSlots` has exactly one
entry. This is a legitimate §6-build-order split, not a silent omission — it is stated in the entry,
the header, and STATUS, and the Phase 5 gate is correctly reported NOT YET (it needs `measuredHeight`
+ a real measurer + `render/` wrapping).

**The double-parse name-resolution argument holds.** `deriveValidateAndEvaluate(objects, …)` passes
the *same* `objects` list to `deriveEdges` (→ `resolveTextDependencyAddresses`) and to `evaluate`
(→ `computeResolvedContent`). Both re-parse `content` against that identical staged list, so name→id
resolution cannot drift — 0119-REVIEW §3's structural argument, now with a third consumer, verified
by reading `mutation.ts` line 45–57 rather than trusting the entry.

**D-111 clause 3** (D-110's cycle owes an executable clause-5 pin) — discharged at 0118, not this
batch's concern; `mutation.test.ts` "a cycle through resolvedContent is rejected, naming the slots"
adds a text-flavoured slot-granularity cycle case on top.

## 4. Honesty audit — the logs match the diffs

- **0127 Decision 1 (continuing past 0126's `REVIEW: REQUIRED`) was correct.** 0126's only §6.1
  trigger was #5 (four flipped `text.test.ts` expectations), and those flips were pre-authorised in
  as many words by **D-116** clause 2 ("that behaviour was a default by omission… now overruled") and
  D-116/D-117's reconciliation notes ("owed by the Phase 5 wiring cycle, which MUST land them with
  tests"). Under the entry-0039 precedent and **Q-010**'s stated principle, a pre-authorised
  expectation change does not fire trigger 5 as an escalation. `text.ts` is not a §6.2 load-bearing
  file. So 0126 could have reported `REVIEW: NOT NEEDED` and batched; it over-called its own trigger,
  but *conservatively* (asking for more scrutiny, not less) and at zero cost — both cycles are in
  this one review regardless. **The verdict a mechanical read of §6.1 produces for 0126 is `NOT
  NEEDED`; nothing turned on the difference.** No correction owed.
- **0127 is candid about the three things it did not close:** the `formula`/`derived`-`content` gap
  (F13 — references untracked; owed to the `text` command cycle), the `measuredHeight` /
  width-vs-`measure(text,style)` inconsistency (Q-021, owed to the next cycle), and the
  resolver/`deriveEdges` duplication (its reviewer question 2 — ruled here as D-119). All three are
  in the entry, the header, and STATUS.
- **Scope was not expanded silently.** `props.test.ts` (fixture swap `text`→`script`, assertion
  byte-identical — verified) and `main.test.ts` (comment only) are the two collateral touches, both
  from `text` gaining a schema; both disclosed as §6.1-trigger-5 material and neither weakens
  anything. `schema.test.ts`'s "no schema entry" list widened to name `image` too — a *stricter*
  assertion, correctly called not-a-weakening.
- **The mutation-checks are real.** I reproduced all three of the batch's own numbered ones (§1);
  the two 0127 claims land exactly, and the 0126 pair land higher only because 0127 added tests that
  pin the same rules.

## 5. Findings

**F19 — `resolveTextDependencyAddresses` and `deriveEdges` Source 1 are byte-equivalent by hand,
with no compiler link.** The resolver re-implements the reference/range/D-110-clause-4/D-047-clause-1
edge logic because `primitives/text.ts` cannot import `mutation.ts` (cycle). I verified they are
currently equivalent (`getSlot(o,p)` ≡ `o.slots[slotKey(p)]`; identical `resolveSlot` /
`isInExtentTableCellAddress` / `enumerateRangeCellAddresses` calls and fallbacks, same order). The
hazard is drift: a future change to D-110/D-047 edge handling in one site passes both suites while
silently making a text-embedded reference mean something different from a cell reference — the exact
thing D-114 clause 1 forbids. STATUS.md's gotcha names it, but a rewritten STATUS cannot bind a
cycle six months out. **Ruled as D-119**: the two are a sanctioned pair, a change to one is a change
to both in the same cycle, and a third consumer forces extraction to a shared module
(`primitives/table.ts` is the natural home). Cross-referencing comments added to both sites (Edit 1,
Edit 2).

**F20 — the resolver's "a missing `content` slot yields `[content]` alone" doc comment obscured that
the missing case REFUSES the object.** Probed through `mutate`: a `text` object with no `content`
slot is rejected ("text_1.resolvedContent references a slot that does not exist") because the
resolver unconditionally emits the `content → resolvedContent` self-edge and `validateIntegrity`
finds it dangling. That is *correct* — a `text` with no `content` is malformed (§5.6) — but the
comment lumped it with the `formula`/`derived`-`content` case, which COMMITS (with inner references
untracked — the F13 gap). Two cases, opposite outcomes, one sentence. Not operator-reachable today
(no `text` command; loader would need a hand-broken file). Fixed by Edit 1 (doc only). Recorded in
STATUS Known problems next to F13, for the `text` command cycle to settle both together.

**Not a finding, recorded:** `computeResolvedContent`'s `""` fallback for a non-string, non-error
`content` value (0127 reviewer question 4) is a reasonable fail-safe for a state no operator can
author yet; the real answer is the F13 ruling. Leave it.

**Not a finding, recorded:** `expectError` in `text.test.ts` is now unused (0126 Decision 4). D-118's
`measuredHeight` → `#MEASURE` test in the next cycle is expected to use it; leaving it avoids
delete-then-re-add churn. Flagged so it is not read as dead code.

## 6. Answered questions

None raised by this batch. Standing:

- **Q-019 → D-116**, **Q-020 → D-117** — closed (the human, 0122/0123); D-116 clauses 1–4 and D-117
  are now BUILT and reviewed here, so both rulings are fully discharged bar the `render/` text pass.
- **Q-016** (panel row literal string/boolean), **Q-017** (persistent table headers) — the human's,
  unchanged, non-blocking, untouched.
- **Q-012** (world vs screen units), **Q-008** (`-0` as state) — deferred, blocking nothing.
- **Q-021** — still unraised. It is the `measuredHeight` width/wrapping inconsistency (§5.6 lists
  `width` as an input; 0124's `measure(text, style)` has no `width`). Owed by the NEXT cycle, which
  is the first to build against it — 0127 correctly did not raise it against work it was not doing.

Next free ID is **Q-021**.

## 7. The gate

- **§6.3 batch cap** — hit (~923 lines / 10 files). Reset by this review.
- **§6.1 trigger 5** — the `props.test.ts` fixture swap. Adapted, not weakened. Cleared.
- **§6.2** — `graph/eval.ts`, `primitives/schema.ts`, `mutation.ts` had unreviewed load-bearing
  changes. Reviewed here. Phase 5 was already open; the only block was on Phase 6 and that was
  lifted at 0125 and is not re-armed.
- **0126's `text.ts` changes** (not §6.2, but unreviewed) are cleared as part of this batch.
- The **`measuredHeight` + D-118 + Q-021** slice may proceed. It is a §6.1 trigger of its own
  (`primitives/schema.ts` load-bearing; likely `graph/node.ts` for a `#MEASURE` `ErrorCode`) and
  inherits **D-118** (null-measurer guard, its own test doubling as the "is `context` threaded"
  proof) and the standing obligation to raise **Q-021** before building against the width question.

## 8. Edits made by this review

1. **`src/engine/primitives/text.ts`** — `resolveTextDependencyAddresses`'s doc comment: split the
   "non-literal or missing `content`" sentence into its two distinct outcomes (F20), and added the
   D-119 pair note replacing the looser "mirrors `deriveEdges`" phrasing. Comment-only.
2. **`src/engine/mutation.ts`** — `deriveEdges` Source 1: added a D-119 cross-reference comment
   naming `resolveTextDependencyAddresses` as the hand-maintained mirror. Comment-only.

Verification after edits: both `tsc` configs clean; `npx vitest run` → **29 files, 1375 passed**, 0
skipped, 0 `.only` (test count unchanged — comment-only edits). Review diff, `git diff --numstat`:
**+19 / −8 across 2 files** (`text.ts` +13/−8, `mutation.ts` +6/−0).

`DECISIONS.md` gains **D-119**. `OPEN_QUESTIONS.md` unchanged. `STATUS.md` rewritten.
