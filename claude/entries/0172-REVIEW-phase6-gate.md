# 0172 — REVIEW (Phase 6 gate): entry 0171. The gate is NOT closed
Date: 2026-09-04   Phase: 6   Model: reviewer (Opus 5)
Reviews: entry **0171** — the whole diff since 0170-REVIEW: `claude/STATUS.md` and
`claude/entries/0171-phase6-gate.md`, no source file.
Previous review: 0170-REVIEW-phase6
Verdict: **REVISE.** The engine-side criterion claim is sound and I re-proved it independently
(§2). The scope call it rests on — that §5.7's `image` half is not a precondition of Phase 6's
gate — is **OVERTURNED by the human** (§3), ruled into `DECISIONS.md` as **D-142**. **Phase 6
stays OPEN. Phase 7 may not begin.** Fix list at §8.

## 1. What I actually ran, before reading anything as true

```
$ git status --porcelain
(empty)
$ npx tsc --noEmit
(clean, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, exit 0)
$ npm test -- --run
 Test Files  35 passed (35)
      Tests  1844 passed (1844)
$ npx vite build
✓ 41 modules transformed, built in 399ms
$ grep -rnE "\.(only|skip|todo)\(" src
(no matches)
$ grep -n "script" src/engine/graph/eval.ts
(no matches)
$ git diff fa3e2f1 21066c7 --stat
 claude/STATUS.md                   |  99 +++++++++++++++---------
 claude/entries/0171-phase6-gate.md | 150 +++++++++++++++++++++++++++++++++++++
 2 files changed, 212 insertions(+), 37 deletions(-)
```

Every number entry 0171 reported is real: 35 files / 1844 tests, both configs clean, zero source
lines in the diff, and the criterion's fourth clause ("no script-specific code in `eval.ts`")
confirmed by direct grep for the fourth independent time.

## 2. Honesty audit — the D-016 check, re-run twice and by a different route

D-016 asks the *claim* to be backed by neutralisation, and §8 asks me not to take the entry's word
for it. I ran two checks, each reverted before the next, both against
`src/command/commands.test.ts`'s `"Phase 6's acceptance criterion, its exact shape..."`.

| # | Neutralised | File | Result |
|---|---|---|---|
| 1 | `evaluateScriptOutput`'s body forced to `return null` — §5.8's seam itself | `src/engine/script/stub.ts:131-134` | RED: `expected null to be 10`, at the `polygon_1.radius` assertion |
| 2 | the `placeholder.<port>` address dropped from `scriptOutDependencies` | `src/engine/script/stub.ts:201` | RED: `{ error: "#REF", message: "derived slot's compute function read an address outside its declared dependencies (D-013)" }` |

Check 2 is entry 0171's own, reproduced exactly as reported — same failure, same code, same
assertion line. **Check 1 is mine and is the stronger one**: it neutralises §5.8's *seam function*
rather than its dependency plumbing, and proves the criterion's value genuinely flows through
`evaluateScriptOutput` rather than arriving by some other route that a dependency-level mutation
would also have broken. Both directions hold.

**Tree confirmed byte-identical to HEAD after both reverts** — `git status --porcelain` empty,
`npx tsc --noEmit` clean. No source file carries any trace of this review.

I also read the criterion test itself rather than trusting its title
(`src/command/commands.test.ts:397-432`). It is the criterion's shape and not a paraphrase: a real
`table_1.A1` drives `script_1.in.factor` through an ordinary `link`; `polygon_1.radius` is bound to
`script_1.out.result` through another; `set script_1.placeholder.result 25` moves the radius from 10
to 25; and the last two lines re-drive `table_1.A1` to prove the *upstream* binding still holds at
the same time, which the criterion implies and a weaker test would have skipped.

**Entry 0171's log matches its diff with nothing left out, and it flagged the one call it was not
sure of, in the entry, in STATUS, and in its own "Where I got stuck" section.** That is the
behaviour §6.1 trigger 3 exists to produce. The verdict below is not a criticism of the entry.

## 3. The finding — the scope call is overturned

Entry 0171 "Decisions I made" #1 reads Phase 6's ✅ line as the whole contract and the section
heading ("Phase 6 — Script stub + image", "Both small.") as descriptive, concluding that `image`
rendering is not a precondition of the gate. The reasoning is careful and the textual argument is
real — PROCESS_BRIEF §12 and PROJECT_BRIEF §6 do both say the ✅ line is the contract.

**The human has ruled otherwise, directly, at this review: images must be loadable and must render
properly before the Phase 6 gate may be claimed.** §1 of PROCESS_BRIEF makes the human final
arbiter on product questions, and "is this phase done" is one. Ruled into `DECISIONS.md` as
**D-142**, in general form — the ✅ line is the *test*, not the *whole* of what a phase must deliver,
and where a phase's heading names a subsystem the brief specifies elsewhere, that subsystem is part
of the gate.

What that means concretely, against the tree as it stands:

- `renderer.ts:424` — `image` falls in the "no visual definition yet" arm and returns. **An image
  draws nothing.**
- `extent.ts:92` — `image` returns `undefined`. **No extent.**
- `hittest.ts:204` — `image` returns `false`. **Unselectable.**
- **No file picker exists.** §5.7's "load via file picker, store as a data URL" is unbuilt;
  `DEFAULT_IMAGE_SOURCE` is `""` and only a hand-typed `set image_1.source "data:..."` reaches it.
- §5.7's **"preserve aspect ratio by default"** has no implementation and no ruling, and
  `DEFAULT_IMAGE_WIDTH`/`_HEIGHT` are `100`/`100` — a decoded bitmap's natural size is exactly what
  that clause needs and what no engine slot can see today (STATUS's own 0img note).

So on the human's reading, three of §5.7's four sentences are unbuilt. The gate cannot stand.

**Entry 0165's `image` work is not being reopened or criticised** — it was scoped headless
deliberately, disclosed that plainly, and was accepted as such at 0166-REVIEW (D-140 clause 4 says
an invisible `image` is correct *as shipped by that cycle*). D-142 does not overturn D-140 clause 4;
it says that state is not a *phase-gate-passing* state.

## 4. Rule audit

No source file changed since 0170-REVIEW, so Rules 1–7 are not at stake in the ordinary way. Checked
anyway, mechanically:

- **Rule 1 (engine purity)** — `grep -rn "document\.\|window\.\|canvas\|CanvasRenderingContext2D" src/engine` returns only `document.<field>` reads on the engine's own `Document` parameter. Unchanged.
- **Rule 2 (mutation-only state change)** — untouched; the criterion test drives every state change through `submitLine`/`mutate`, never a hand-built `Document`, which is the right shape for a gate test.
- **Rules 3, 4, 5, 6, 7** — not touched.

**A note for the cycle D-142 unblocks, since it will be the first to put `image` on screen:** Rule 1
binds the decoded-bitmap cache. An `HTMLImageElement` is a live DOM object and a `Map` of them is a
`Map` of live objects — §5.5's "no `Map`s of live objects" and Rule 1 together mean that cache lives
in `render/`/`main.ts` and **never** in `src/engine/`, and the document stores the data URL string
only. This is the design question STATUS already flagged as the real one; it is also the one most
likely to be got wrong by accident.

## 5. Invariant audit

Not at stake — zero source lines. `out.<port>`'s dependency mechanism, the one invariant this gate
actually rests on, was traced by hand at 0170-REVIEW §5 and is re-confirmed here by mutation check 2
(§2) rather than by re-reading that trace.

## 6. Spec conformance — the criterion, clause by clause

Phase 6's ✅ line, checked against the test rather than the entry's summary:

- **"`script_1.in.factor` is bound to a cell"** — `commands.test.ts:406-408`, an ordinary `link`, value 3 flowing from `table_1.A1`. ✓
- **"`polygon_1.radius` is bound to `script_1.out.result`"** — `:419-420`, ordinary `link`, reads 10. ✓
- **"changing the placeholder output value moves the polygon"** — `:424-426`, 10 → 25, and both mutation checks in §2 prove it is not vacuous. ✓
- **"with no script-specific code in `eval.ts`"** — grep, clean, fourth independent confirmation. ✓

**The ✅ line passes in full.** That result survives this verdict and does not need re-proving — the
re-claim entry may cite this section and §2 rather than re-running the neutralisations. What is
missing is the other half of the phase (§3).

## 7. Legibility audit

No source or test file touched. Entry 0171 uses locked vocabulary throughout and cites rulings
rather than restating them. Nothing to flag.

## 8. REVISE — the fix list

1. **Un-claim the Phase 6 gate.** STATUS.md is rewritten by this review to say so (§10); no entry is
   owed just for the un-claiming, and entry 0171 stays in the log exactly as written — it is not
   wrong, it is superseded on one point by D-142.
2. **Build §5.7's `image` half: load and draw.** One slice, scoped and declared in the ordinary way
   (this review does not design it):
   - a `renderer.ts` arm, an `extent.ts` arm and a `hittest.ts` arm, **shipped together** — D-066
     makes drawn extent and clickable extent one extent, and shipping the extent alone is forbidden;
   - a decoded-bitmap cache with a repaint when a decode completes — **in `render/`/`main.ts`, never
     in `src/engine/`** (see §4's note); the document keeps the data URL string and nothing else;
   - §5.7's file picker as a `CommandEffect`, following `load`'s own precedent
     (`commands.ts:212-217` returns the effect, `main.ts`'s `performEffect` owns the DOM half);
   - §5.7's **"preserve aspect ratio by default"**, which is a real specified clause and not
     decoration. If honouring it needs the decoded natural size to reach a slot, that is a load-
     bearing question — raise **Q-027** rather than guessing, per §7.
3. **Get it on screen and have the human confirm it.** STATUS's own standing note — "the operator
   cannot see what you can see" — plus D-142 clause 2: *renders properly* is a claim only the human
   can settle, and this is the first `image` cycle where there is finally something to look at.
4. **Then re-claim the gate in a new entry**, citing §6 and §2 above for the ✅ line rather than
   re-deriving them, and adding whatever mutation check the new `image` work's own claims need.

`script` rendering (§5.8's labelled box with ports) is **NOT** on this list. D-142 clause 3 draws
the line: §5.8 is explicitly a **STUB ONLY** section whose gate clause is engine-side and passes, and
the phase heading's word is "Script *stub*". `image`'s heading word carries no such narrowing, and
§5.7's four sentences are all about loading and drawing. Do not fold `script` rendering into the
D-142 slice.

## 9. Open questions

None raised by entry 0171. **Q-008, Q-012, Q-016, Q-017** are untouched by this diff and unchanged —
not re-litigated here. **Q-027 is the next free number** and §8 item 2 names the one thing likely to
need it.

## 10. Edits made by this review

None to source or tests — the tree is byte-identical to `21066c7`, confirmed after both mutation
checks were reverted. `claude/DECISIONS.md` gains **D-142**. `claude/STATUS.md` is rewritten by this
review (0164-REVIEW's own precedent — the reviewer rewrites it when a gate's disposition changes,
rather than leaving a claimed-but-refused gate for the next cold reader).
