# 0056 — RULINGS (human)
Date: 2026-08-24   Phase: 3 (open, unstarted)   Model: Claude Opus 5, acting as Auditor, recording the human's ruling
Previous entry: 0055-AUDIT   Last review: 0054-REVIEW-phase2 (verdict: ACCEPT WITH EDITS, Phase 2 gate PASSED)

No code was written or reviewed in this entry. The human ruled on **Q-011**, the one open question
entry 0055 raised and could not answer itself.

## What was ruled

| Question | Ruling | Decision |
| --- | --- | --- |
| Q-011 — does D-058 still stand, now that entry 0055 removed the practice it regulated? | **No. Comments describe the present; they are not diaries.** One exception: a comment may point back to a ruling. | **D-060** |

**D-058 is SUPERSEDED in its first half.** Its second half survives inside D-060: a comment that
dates something names its entry number, never a bare "this cycle".

## The ruling, in the human's own terms

The operative test is three tiers, and the ranking is the substance:

- **Good** — states the behaviour and the reason.
  `// this function does X, Y, or Z, because A needs to read from X`
- **Okay** — the same, plus a pointer back to the ruling behind it.
  `// this function does X, Y, or Z because A needs to read from X AS PER D-0XX.`
  `// Change approach only if that decision is overruled.`
- **Bad** — a diary.
  `// Cycle X, I did this. Cycle X+1 reporting in, I did this instead. Cycle X+2, I did`
  `// that but reverted this...`

## The part that is easy to skim past

**The citation form is ranked Okay, not Good.** That is not a throwaway distinction — it is a
tightening, and it constrains future comments more than entry 0055 did.

A `(D-047)` is a **supplement** to a stated reason, never a **substitute** for one. A comment that
cites a ruling without saying what the code does and why has offloaded its job onto another file:
the reader now has to go open DECISIONS.md to learn something the comment was supposed to tell
them. Cite the ruling so the reader knows the reason is *binding* and knows *where to argue with
it* — not so the reader has to go find the reason at all.

Practical shape of a compliant comment: reason first, citation second, and the citation earns its
place by telling you the reason is not up for casual revision.

## Was entry 0055 compliant with the ruling that arrived after it?

Checked rather than assumed, because 0055 is the pass this ruling retroactively sanctions.

- **82** `(D-NNN)` citations remain in non-test source.
- A scan for comments that are pointer-ONLY — a citation with no stated reason beside it — found
  **two**, and both are trailing cross-references inside a larger explanation, not substitutes for
  one: [formula/eval.ts:317](../../src/engine/formula/eval.ts#L317) ("...own comment below and
  D-037") and [graph/eval.ts:305](../../src/engine/graph/eval.ts#L305) ("building a `read` callback
  that enforces D-013").
- So the pass lands in D-060's "Okay" band or better throughout. No remediation cycle is needed.

That is a real check, not a self-congratulation: had it come back with thirty bare citations, this
entry would be recording a fix list instead.

## What this changes for the next implementer

1. **Write comments in the present tense, stating the reason.** This is now binding (D-060), not
   merely a convention entry 0055 introduced. PROCESS_BRIEF §5.2's line budget and present-tense
   rule now cite D-060 as their authority rather than standing on the audit's own judgement.
2. **Do not narrate your cycle in a comment.** Your log entry is where that goes, and always was —
   PROCESS_BRIEF §5.4 has said so since the seed. The tension between §5.4 and D-058, which let
   the practice survive in headers for 54 cycles, is now gone.
3. **When you cite a ruling, still say why.** The citation is the second half of the comment, not
   the whole of it.
4. **Your slice is unchanged:** `render/camera.ts`, per STATUS.md. Nothing about this ruling
   touches Phase 3's content.

## Verification

No code changed in this entry. The tree is exactly as entry 0055 left it, re-confirmed:

```
$ npx tsc --noEmit
(clean, no output)

$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test
 Test Files  15 passed (15)
      Tests  653 passed (653)
```

## Open questions raised

None. Q-011 is CLOSED. Q-007 and Q-008 remain OPEN, untouched, tags intact. Next free: **Q-012**.

## Review point

None fired. This entry records a ruling; it writes no code. The implementer batch counter is
unchanged at 0/3, 0 executable lines.

The standing request from entry 0055 still holds and is NOT discharged by this ruling: **the next
review should audit 0055's prose diff for dropped rationale.** D-060 sanctions the *practice* the
audit adopted. It does not certify that every one of the 16 rewritten headers kept everything worth
keeping — that is still an independent reader's call, and the auditor cannot make it about their
own edits.
