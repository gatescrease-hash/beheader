# 0150 — REVIEW (phase 5): entry 0149, text-pointing — D-124 (`text` placed by pointing, editor opens on creation)

Date: 2026-09-02   Phase: 5   Model: Sonnet 5 (reviewer)
Reviewing: 0149-text-pointing (1 cycle, ~90 source + 113 test lines across 7 files)
Previous review: 0148-REVIEW-phase5 (ACCEPT WITH EDITS)

Verdict: **ACCEPT.** No reviewer edits. One new binding ruling — **D-134** — ratifying the
`createdObjectId`-on-`CommandOutcome` seam that D-124 left as "reviewer's call". Two of the
implementer's four flagged decisions (2 and 4) are accepted as built but explicitly routed to the
human for an on-screen verdict; both are one-line reversals. One new fix-list item, **F29** (an
abandoned fresh empty `text` box is stranded), needs the human's eyes and a ruling, not a REVISE.

## Verification (re-run, not read)

```
$ npx tsc --noEmit                          -> clean, exit 0
$ npx tsc -p tsconfig.engine.json --noEmit  -> clean, exit 0
$ npx vitest run                            -> Test Files 31 passed (31)
                                               Tests    1549 passed (1549)
$ grep -rnE "\.(only|skip|todo)\(" src      -> no matches
$ git diff --numstat HEAD~1 -- src
   39/0  commands.test.ts   22/1  commands.ts   25/3  parser.ts
   29/0  prompt.test.ts     45/0  main.test.ts  39/5  main.ts   4/1  render/editor.ts
```

1535 (0148) → **1549** (+14: prompt.test +6, commands.test +3, main.test +5). The entry's arithmetic
is exact. Batch: cycle 1/3, 7 files / ~203 changed lines, well under §6.3's 3 / 10 / 800.

One correction to the entry, not concealment: "~110 source lines" is closer to ~90 added source
lines, most of them comment. The diff is smaller than advertised, which is the harmless direction.

## Rule audit

- **Rule 1 (no DOM in `engine/` or a pure `command`/`render` module)** — upheld, checked
  mechanically. `git diff HEAD~1 -- src/command/ | grep -iE "document\.|window\.|canvas|
  addEventListener|\.focus\("` returns nothing. `parser.ts`'s `buildFromPrompts` deals in world
  points only; `commands.ts`'s new field is a plain `string`. `render/editor.ts`'s change is one
  NOT DONE HERE line, no code.
- **Rule 2 (mutation-only state change)** — upheld. `createObjectFromCommand` still routes through
  `mutate`; `createdObjectId` is `minted.id` read back out, not a write. `main.ts`'s one new DOM-half
  line (`inPlaceEditor = next.openEditor`) sets a `start`-closure variable — the editor's open/closed
  state, which has never been `AppState` (like the GREY paperclip) — not document state. The commit
  seam is untouched.
- **Rule 3 (addressing load-bearing)** — not touched. No address is built or stored in this diff.
- **Rule 4 (one formula engine)** — not touched. `text`'s `content` positional is kind `"text"`,
  not `"literal-or-formula"` (`parser.ts:412`), so `beginCommand` tokenizing the rest of a `text`
  line — which it now does, because `text` declares `prompts` — reads no formula quoting. The
  `usesNamedForm` hazard note stays dormant: `text`'s one step `accepts: "point"`, not a string.
- **Rule 5 (dumbest correct implementation)** — upheld. `buildFromPrompts` is `pointAnswer` + a
  literal `""`, reusing the helper the other four creation commands use. `advance`'s new branch is
  one `if`. No optimisation, no new abstraction.
- **Rule 6 (slot set fixed during evaluation)** — not touched. No schema change; no derived slot
  added, so the D-126 load consequence does not apply and the entry says so.
- **Rule 7 (§8 deferred list)** — upheld. Load-hardening, markdown-lite, `overflow`, the gate, and
  `polyline`/`image`/`script` prompt sequences are all declared out and genuinely absent.

## Invariant audit

- **Rejection leaves prior state bit-for-bit unchanged** — upheld. A refused `text` creation returns
  at `advance`'s `!outcome.ok` guard before `openEditor` is ever built; `createdObjectId` is set only
  on the success arm, after `mutate` succeeded. Test: "a refused text creation asks for no editor".
- **`nextObjectId` advances only on success** — unchanged. `mintObjectId` is still called before
  `mutate`, and a failed `mutate` returns early without threading `minted.nextObjectId` through — no
  counter gap, and no `createdObjectId` leaks from a refusal.
- **Errors propagate, nothing throws** — upheld. `pointAnswer` on a completed `point` step cannot
  fail; every non-`text` command leaves `createdObjectId` `undefined` and every non-creation
  `CommandOutcome` reader ignores an optional field it never set.
- **Graph state plain and serializable** — upheld. `createdObjectId` is a `string` on a transient
  result object, stored nowhere. `AppTransition.openEditor` is an `EditorTarget` — a plain
  `{kind, objectId}` — computed per transition.

## Spec conformance — D-124, clause by clause

- **Clause 1 (a `prompts` sequence like every other creation command)** — met. One step,
  `{ name: "position", message: "specify text position", accepts: "point" }`. `beginCommand` /
  `respond` route it with no change to `prompt.ts`, exactly as the clause predicts.
- **Clause 2 (NO content step; completes on the pick with `content: ""`; hands to D-125's editor)** —
  met. `buildFromPrompts` returns `content: ""`; `advance` returns `openEditor`; `applyTransition`
  sets `inPlaceEditor` before `apply` so the same paint builds and focuses the overlay, which for an
  empty `content` uses D-125 clause 6's fallback box. No `text`-accepting `PromptStep` was added.
- **Clause 3 (both typed forms unchanged)** — met, and tested at three points. `text "hi"` →
  `token.quoted` → `fromParse`; `text x=5 y=6 "hi"` → `usesNamedForm` → `fromParse`; `text hello`
  (unquoted single word) falls through the point step's refusal to `fromParse` as content. All three
  produce the same `Command` they did at 0148.
- **Clause 4 (`PromptValue` / `PromptStep.accepts` not widened)** — met. `accepts` stays `"point"`.
  `prompt.ts`'s `ResponseRead` discriminated shape is untouched; the widening hazard stays dormant.
- **Clause 5 (generalises to every creation command)** — honoured in spirit, not exercised.
  `polyline`/`image`/`script` still have no schema and no registry entry, so there is nothing to
  add a `prompts` block to yet; `COMMANDS_SPECIFIED_BUT_NOT_BUILT` is unchanged. When they land they
  arrive with a `prompts` entry — the entry records this as owed.

## D-125 clause 4 — the one place built behaviour reads wider than the ruling's letter

D-125 clause 4: *"A `text` object placed by D-124 opens its editor immediately on creation."* Entry
0149 (Decision 2) opens it on **every** form of `text` creation, including `text x=0 y=0 "hi"` typed
whole at the bar — which is placed by D-121's typed fallback, not "by D-124". The implementer
followed 0148-REVIEW's own phrasing ("before D-124 opens this editor on every newly-created `text`
object") and routed it in `advance` where all three forms converge, which is one code path instead
of threading the response kind through. **I accept it as built** — it is coherent, the extra open is
a harmless no-op if the operator dismisses it, and narrowing it later is a one-liner (plumb "was
this a pick" into `advance`). But it is a feel question the human should settle on sight: does typing
a complete `text "caption"` line and pressing Enter deserve a focus-stealing editor popping open
over the canvas? See "For the human to test".

## Honesty audit

The log matches the diff. Test results re-run and identical. The four decisions are each flagged in
the entry's "Decisions I made" and again in "Where I got stuck", with the reversal cost stated for
each — this is the disclosure the process wants. "The DOM half is still untested by construction and
STILL has not been seen on screen — and D-124 makes that worse, not better" is exactly the honesty
0148-REVIEW asked the next cycle to carry, stated without softening. The `createdObjectId`-vs-
`CommandEffect` argument in the entry and in `CommandOutcome`'s doc is sound and I have ratified it
(D-134). No test weakened; the +14 are all new.

## New ruling

- **D-134** — a creation command surfaces its new object's id on the `CommandOutcome` success arm
  (`createdObjectId`), not through a `CommandEffect`. Settles the "reviewer's call" D-124 left open.

## Findings

**1. An abandoned fresh empty `text` box is stranded — F29.** `text` + click commits `createText`
*before* the editor opens (the id has to exist for `openEditor` to name it). If the operator then
hits Escape without typing — the conventional "no, not here" gesture — D-128 says Escape cancels the
*edit*, and the *creation* stays. The result is a `text` object with `content: ""`: no ink, no
extent, no hit box (D-066), unselectable and invisible, removable only by typing `delete text_1`.
D-124 makes producing one a single mis-click. This is not a wiring defect — the pure half is correct
— it is a missing product decision: should Escape (or a blur with `content` still empty) on a
box that was *opened on creation* also remove the box? In a drawing tool it usually does. **Ruling
is the human's** (D-125 flags clauses 4–5 as theirs to overrule on sight); logged as **F29** for the
live look. If the answer is "yes, remove it", the cleanest seam is a new `AppTransition` the editor's
cancel path returns when its receiver's `content` is empty and it was opened by `openEditor` — still
through `executeCommand` (a `delete`), no second write path.

**2. `applyTransition` overwrites `inPlaceEditor` without closing an already-open overlay.** If
`openEditor` ever arrives while `inPlaceElement` exists, `updateEditor` will *not* rebuild the
element (it only builds when `inPlaceElement === undefined`), so the stale `<textarea>` would be
reused for the new object with the wrong seed. **Not reachable today** — every path that fires
`openEditor` (a submitted command line, a completing prompt pick) requires the editor not to hold
focus, and a canvas pick commits an open editor before `pointerDownAt` runs. Recorded so it is not
rediscovered as a bug; if a future cycle lets a creation land while the editor is open, the fix is
`closeInPlaceEditor()` (or an explicit rebuild) in `applyTransition`'s `openEditor` branch.

## For the human to test (on screen — this is the owed live look, now unavoidable)

The in-place editor now opens on the commonest gesture in the program and **nothing here or in the
0146/0147/0148 batch has been seen**. Shortest path through all of it:

1. **`text`, click on the canvas.** Does an empty editable box appear *at the click point*, focused,
   caret showing? (D-124 + D-125 clause 6 fallback box.)
2. **Type a word, then keep typing past the box width.** Does a scrollbar appear inside the ~20px
   line and start re-wrapping / jittering the box? This is **F28** — the one thing 0148-REVIEW could
   not settle. If yes: `scrollbar-width: none` + the `::-webkit-scrollbar` twin (inside the ruling,
   no code change needed from you — tell me and I will).
3. **`text`, click, type nothing, press Escape.** Is there now an invisible `text_1` you can't see
   or click? (Finding 1 / F29 — tell me if this bothers you and how you want it to behave.)
4. **`text`, click, then middle-drag to pan.** Does the fresh editor keep focus and track its box?
   (D-130 / D-133.)
5. **`text x=0 y=0 "hello"` typed whole at the bar, Enter.** Editor pops open seeded "hello"? Do you
   *want* that, or should a fully-typed `text` line just place the box and leave the bar focused?
   (D-125 clause 4 — Decision 2.)
6. **`set text_1.width 200`, then double-click it and type a long line.** Do the drawn wrap points
   and the typed wrap points agree? (D-132.)

## Open questions

- **None raised this cycle, none owed.** Next free: **Q-025**.
- **Q-012** — unchanged; `editor.ts` remains its fourth reconciliation site. `buildFromPrompts` adds
  no new site (world points only).
- **Q-016 / Q-017** — unchanged, both the human's, neither blocking.

## Verdict

**ACCEPT.** The pure signal — `createdObjectId` on the outcome, `openEditor` on the transition — is
tested hard and at the right altitude, the routing through `beginCommand` is correct and the Rule 4
hazard it steps near is genuinely dormant, and every judgement call is disclosed with its reversal
cost. D-134 ratifies the seam. What is unverified is the DOM half, in full, and it can no longer
wait behind another cycle: **the live look above is owed before the load-hardening cycle starts** —
not because load-hardening depends on it, but because six weeks of editor work have now stacked on a
surface no one has looked at, and the next cycle touches `document.ts`, where a regression is
expensive.

Phase 5 remains OPEN. Order unchanged: this review closes → **load-hardening cycle** (D-126 + D-127
+ D-108, one `document.ts` diff, `REVIEW: REQUIRED`) → markdown-lite with a markup-aware measurer in
one cycle → `overflow` → the Phase 5 gate.
