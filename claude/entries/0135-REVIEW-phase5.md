# 0135 — REVIEW (Phase 5): entry 0134 — the `text` command, escalated on Q-022 (position) and Q-023 (F13)
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (reviewer)
Reviews: **0134** (declared the `text` command, hit §6.1 trigger 3, stopped and escalated; no `src/`
change). One cycle since 0133-REVIEW.
Previous review: 0133-REVIEW-phase5
Verdict: **ACCEPT.** No code was written and none needed to be — the stop was correct. Two rulings:
**D-121** answers **Q-022** (a `text` object's position is two ordinary `literal` slots `origin.x` /
`origin.y` on `TEXT_SCHEMA`), **D-122** answers **Q-023 / F13** (`content` is `literal`-only; `link`
and `set =` targeting it are refused, à la D-046). Phase 5 stays open; §6.2's block on a later phase
stays lifted. The `text` command may now proceed against a settled schema.

## 1. What I ran, before reading anything as true

```
$ npm run typecheck            # tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  30 passed (30)
      Tests  1427 passed (1427)

$ git diff 6132d46^..6132d46 --stat -- src/     → nothing
$ grep -rnE "PROVISIONAL\(Q-02[23]\)" src/       → nothing
```

Entry 0134's headline claim is "no `src/` file changed," and the diff confirms it: commit 6132d46
touches `claude/OPEN_QUESTIONS.md`, `claude/STATUS.md`, and `claude/entries/0134-*.md` only. The
1427/1427 it pastes is 0133-REVIEW's number verbatim, which is the honest thing to paste for a
cycle that moved no code — it is stated as such in the entry ("pasted to honour §3 step 5, not
because anything moved"). Re-run here at HEAD: still 1427/1427, 0 skipped, 0 `.only`.

## 2. Was the stop correct?

**Yes, and it is the behaviour the process is built to produce.** Orienting into the `text` command
slice surfaces two brief-conformance problems (§6.1 trigger 3):

1. **A `text` object has no position.** §5.6's `TextBox` struct lists `content` / `width` /
   `height` / `overflow` / `style.*` and no coordinate — yet §5.10's command grammar is literally
   `text x=0 y=0 "…"`, §5.9's drag rule assumes every object has either an `origin` slot or
   per-vertex slots, §5.7 gives the neighbouring `image` primitive an explicit `origin.x` /
   `origin.y`, and Phase 7 needs a text box's position to be a *slot* so
   `link text_1.origin.y intersection_a.centroid.y` resolves. The brief is internally
   inconsistent, not merely silent.
2. **F13 — a `formula`-driven `content` slot's embedded references are untracked.** Owed a ruling
   by this cycle since 0130-REVIEW / 0133-REVIEW and documented in `primitives/text.ts`'s own NOT
   DONE HERE.

Problem 1 is slot-set membership on a load-bearing schema (`primitives/schema.ts`, §6.2) and a
divergence from a brief section's stated shape. §7.3 is explicit: "anything shaping the data model,
addressing, or the mutation sequence — stop the cycle and escalate." The implementer weighed the
asymmetry correctly (entry 0134 "Decisions I made"): a wrong escalation costs one cycle and a
one-line ruling; a wrong guess on which slots a schema declares is D-046's "mutate commits a
document its own validateIntegrity rejects" class of bug plus rework of a load-bearing schema and
its tests. Taking (a) provisionally was *available* in the narrow sense that no saved document can
contain a `text` object today — but §7.3 does not grade "reversible in practice," it grades "shapes
the data model," and this does. The stop was right.

Both questions were named in advance by 0130-REVIEW §7 and 0133-REVIEW §7 as the reason "that cycle
likely escalates rather than completing." This is the predicted outcome, arriving on schedule.

## 3. Rule / invariant / spec audit

Nothing in `src/` changed, so Rules 1–7 and every invariant in §8.2 are **not touched** — verified
by the empty `git diff -- src/`. `computeResolvedContent` / `resolveTextDependencyAddresses` /
`evaluateBlockTree` / `computeMeasuredHeight` / the D-119 pair / `TEXT_SCHEMA` are byte-unchanged
from 0133-REVIEW. The only artefacts to audit are the two questions and the STATUS rewrite:

- **`OPEN_QUESTIONS.md`** — Q-022 and Q-023 are well-formed against the §11.4 template: brief
  sections cited, options laid out with the rejected ones reasoned, a recommendation with a
  reversibility call. Next-free-ID bookkeeping is correct (`Q-024`). No `PROVISIONAL` site claimed
  for either, correctly — nothing is built against either answer, so a tag would have no reader
  (the Q-016 / Q-019 precedent, applied consistently).
- **`STATUS.md`** — accurately reports GREEN, 1427/1427, 0 source lines since 0133, and the block.
  The "5 required / 4 optional / 2 derived" slot inventory (line 94) and the "9 non-derived + 2
  derived" count (line 0c) are correct *as of this entry* and will move with D-121 — see §5.

## 4. Ruling — D-122 (Q-023 / F13): `content` is `literal`-only

Taken first because it is the cleaner call and it is squarely reviewer territory (D-046, its
direct precedent, was a reviewer ruling; there is no operator-visible taste dimension — the
operator cannot reach a `text` object at all yet, and §5.6 already says `content` is "raw source
including markup").

**Option (b) — track the formula's inner references — is not buildable in this architecture.**
`resolveTextDependencyAddresses` runs at §5.1 step 3 (edge derivation). A `formula`-driven
`content` slot's *string value* is not written until step 7 (evaluate). You cannot parse a string
you do not have, and there is no second derive pass (Rule 5: no dirty tracking, one derive per
mutation). This is D-046's exact timing obstacle. **Option (c) — leave the gap — is silent broken
reactivity**, the failure D-116 / D-118 / §5.3's totality rule all exist to prevent. **Option (a) —
refuse the slot kind — is small, reversible, and consistent with the precedent already in the
tree.**

The parallel to D-046 is the *timing*, not Rule 6 specifically: D-046 guards a slot that sizes a
dynamic family; `content` sizes nothing, but it feeds a `dynamic` dependency resolver that reads it
`literal`-only for the same step-3-vs-step-7 reason (`primitives/text.ts` already documents this).
The consequence differs — D-046 without its guard commits an invalid document; `content` without a
guard commits a *valid* document with untracked edges — but "untracked edges" is still a real
correctness defect, and refusing is the conservative fix.

**Issued as a full ruling, not a provisional.** The implementer proposed taking (a) with a
`PROVISIONAL(Q-023)` tag. There is no need: the reasoning is identical to D-046's, there is no
product-taste dimension, and a ruling means the `text` command cycle writes one guard citing
`D-122` and moves on — no reconcile-and-untag step later. See D-122.

## 5. Ruling — D-121 (Q-022): position is `origin.x` / `origin.y` literal slots

**Confirmed: recommendation (a).** Add `origin.x` and `origin.y` as two ordinary `literal` slots to
`TEXT_SCHEMA`'s `nonDerivedSlotPaths`, reusing `ORIGIN_X_PATH` / `ORIGIN_Y_PATH` from
`primitives/geometry.ts` — the identical spelling `circle`, `polygon`, `rect` **and `table`**
already use. This is not a novel design; it is the fifth application of an in-tree pattern:

- `commands.ts` already maps `command.x` → `ORIGIN_X_PATH` in four creation handlers (`circle`
  line 400, `polygon` 415, `rect` 425, `table` 456). A `text` handler does the same.
- `schema.ts` line 492 already puts `ORIGIN_X_PATH` / `ORIGIN_Y_PATH` on `TABLE_SCHEMA`'s
  non-derived paths — and `table`'s brief section (§5.4) enumerates its slots no more than §5.6
  does. The precedent for "a positioned primitive gets `origin.x/y` even though its brief section
  does not spell them out" is already set and already reviewed.
- §5.9's origin-drag path in `render/interaction.ts` then works for a `text` object with no
  change; Phase 7's `link text_1.origin.* …` works because they are ordinary literal slots.

**On the §5.6 deviation.** §5.6's `TextBox` block is illustrative of the content-and-layout slots —
it also omits `resolvedContent` and `measuredHeight`, which are legitimately present as derived
slots. Reading it as an *exhaustive* slot enumeration contradicts §5.10 (`text x=0 y=0`), §5.9
(drag), §5.7 (image has `origin`), and Phase 7 (bindable position) all at once. D-121 reconciles the
inconsistency the way that changes the least and matches every sibling primitive. This is within
reviewer authority for the same reason D-120 was: there is no operator-visible behaviour to choose
between — `text x=0 y=0` is already in the brief — only a storage mechanism, which Rule 6, §9, and
four precedents all point one way. **Reversible if the human overrules**: no saved document can
contain a `text` object (no command builds one), `origin.x/y` carry no derived value, and reverting
is deleting two schema entries.

**`origin.x` / `origin.y` are `literal`-kind and NOT dependency-required.** Like every other
primitive's origin, an absent `origin.x` at the declared path is tolerated
(`findSchemaSlotKindMismatches` — `schema.test.ts:157`); nothing derived reads them
(`measuredHeight` depends on `resolvedContent` / `width` / `style.*` only), so there is no
dangling-edge refusal for a `text` object created without them. The `text` command will always
create them anyway (`x=` / `y=` default to `0`, matching `table`).

### Reconciliation (D-121) — owed by the `text` command cycle, all in one slice

1. `TEXT_SCHEMA.nonDerivedSlotPaths` gains `ORIGIN_X_PATH`, `ORIGIN_Y_PATH` (import from
   `primitives/geometry.ts`, or re-export through `primitives/text.ts` alongside the other
   `TEXT_*_PATH` constants — implementer's call, but keep one spelling).
2. `schema.test.ts`'s `text` slot-path expectation and any slot-count assertion move with it.
3. `STATUS.md`'s "9 non-derived + 2 derived" (§0c) becomes **11 non-derived + 2 derived**; the
   "5 effectively-required" set is unchanged (origin is not required).
4. No `PROVISIONAL` tag — D-121 is a ruling; cite `(D-121)` at the schema site.

## 6. Honesty audit

The log matches the diff exactly: no `src/` change, questions + STATUS + entry only, test numbers
carried forward honestly and labelled as carried. The entry is candid that "the whole declared
slice" is unfinished and why. No scope was expanded — nothing was built. The three "questions for
reviewer" are answered: (1) Q-022 is mine to rule, D-121, and stopping was right; (2) Q-023
confirmed, D-122, and issued as a ruling rather than left provisional; (3) yes — see §7.

## 7. The gate, and what proceeds

- **§6.1** — trigger 3 fired (brief inconsistency, load-bearing, non-reversible). Cleared by D-121
  and D-122. No other trigger.
- **§6.3 batch cap** — 1 cycle / 0 source lines since 0133-REVIEW. Nowhere near. Reset regardless.
- **§6.2** — no load-bearing file has unreviewed changes (none changed). No later-phase block armed.
- **The `text` command may now proceed.** It creates a `text` object with all **11** non-derived
  slots (`content`, `width`, `height`, `overflow`, `origin.x`, `origin.y`, `style.font`,
  `style.fontSize`, `style.lineHeight`, `style.color`, `style.align`) + both derived placeholders,
  with sane `style` defaults chosen by the handler (settles F20 and 0129's five-required
  consequence). It applies the D-122 guard (refuse `link` / `set =` on `content`) citing the
  ruling. `x=` / `y=` default to `0`.
- **The render-only alternative is still available and needs no ruling of its own** if the
  implementer prefers it first: **D-109 clauses 1–2** (cell decimal precision + no cell-text
  clipping, `render/renderer.ts` only). **Q-017** (persistent table headers) remains the human's
  call — low-risk and render-only, but not the reviewer's to green-light; do not fold it into the
  D-109 slice without the human.

## 8. Edits made by this review

**None to code** — nothing was wrong with the tree and nothing was written.

- `DECISIONS.md` — **D-121** (answers Q-022) and **D-122** (answers Q-023) appended.
- `OPEN_QUESTIONS.md` — Q-022 marked `ANSWERED → D-121`, Q-023 marked `ANSWERED → D-122`, in
  place (not deleted, per §2).
- `STATUS.md` — rewritten: block lifted, D-121/D-122 recorded, the `text` command unblocked, the
  slot inventory annotated with the pending D-121 reconciliation.

Verification after the doc edits (no code touched, so unchanged):

```
$ npm run typecheck
(clean, both configs)

$ npx vitest run
 Test Files  30 passed (30)
      Tests  1427 passed (1427)
```
