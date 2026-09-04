# 0174 — Q-027 answered by the human: the box takes the picture's shape, and a toggle says so
Date: 2026-09-04   Phase: 6   Model: implementer (Opus 5)
Previous entry: 0173-image-load-and-render   Last review: 0172-REVIEW-phase6-gate (verdict: REVISE)
Batch: cycle 2 of up to 3 since last review; ~1350 lines / 15 files changed so far — **already over
§6.3's 800/10 cap since cycle 1**, and continuing on the human's instruction (see "Review point").

## Declared scope

Implement the human's **Q-027 ruling**, given on screen after seeing entry 0173: an image's box
takes the picture's own proportions instead of hanging over it, and a `preserveAspect` slot lets
the operator turn that off. Their notes 1 and 3, which are one thing — the box, and who decides it.
Not in scope: their notes 2 (grabbers) and 4 (re-picking), which are entry 0175.

## Explicitly not in scope

Resize grabbers on an image; re-picking from the properties panel; storing the chosen file's name.
`script` rendering (D-142 clause 3). The Phase 6 gate, still unclaimed.

## What I did

**The ruling.** Entry 0173 raised Q-027 as a choice between reading §5.7's "preserve aspect ratio
by default" as a DRAWING rule (option a, taken provisionally) or as the SIZE A PICTURE IS FIRST
GIVEN (option b, which needs the natural size to reach a slot). The human answered on screen:
*"Box should fit to aspect ratio of image, not hang over it"* — option (b) — plus a clause the
question had not anticipated: *"There should be a property toggle for 'preserve aspect ratio'. When
toggled, resizing preserves ratio. When untoggled, resizing distorts aspect ratio."* So the answer
is BOTH mechanisms, with the toggle deciding which is in force. `OPEN_QUESTIONS.md`'s Q-027 now
records the ruling and what my recommendation got wrong.

**`engine/primitives/image.ts`** — `IMAGE_PRESERVE_ASPECT_PATH`, a SEVENTH slot. Its doc states why
it is document state rather than a render constant (it is the operator's choice about one object,
like `text`'s `autoresize`) and that every reader defaults a MISSING slot to `true`, which is what
lets a document saved before this cycle load unchanged — D-126's lesson applied to a non-derived
slot.

**`engine/primitives/schema.ts`** — the path joins `IMAGE_SCHEMA`'s one static group, and
`slotOptions` closes it to `true`/`false` with the labels "keep the picture's proportions" /
"stretch to fill the box", so the properties panel offers a drop-down rather than a text box. The
identical mechanism `TEXT_SCHEMA`'s `autoresize` already uses.

**`command/commands.ts`** — `DEFAULT_IMAGE_PRESERVE_ASPECT = true` (§5.7's "by default", read
literally), supplied by `createImage`. `DEFAULT_IMAGE_EXTENT` is now EXPORTED and is the single
source of both the empty frame's size and the long side a chosen picture is scaled to, so choosing
a picture never makes the object jump in size — it only makes it the right shape.

**`render/renderer.ts`** — `drawImage` reads the flag: fit-inside while on, fill-the-box when off.
`fitBitmapIntoBox` loses its `PROVISIONAL(Q-027)` tag and its doc now explains that it is the
mechanism that KEEPS the promise once the operator has made the box disagree with the picture,
rather than the answer to the question.

**`render/images.ts`** — `decodeBitmap(source, onDecoded, createElement?)` exported: a one-shot
decode, because the picker needs a natural size at the moment a file is chosen. The cache now uses
it internally, so there is exactly one place that wires an element's handlers (D-010).

**`src/main.ts`** — `pictureBoxSize(naturalWidth, naturalHeight)` (pure, exported, tested), and
`commitImagePicture` replacing 0173's `commitImageSource`: it decodes first, then writes `source`,
`width` and `height` as three ordinary literal `set`s through `executeCommand` (Rule 2), under ONE
echo line. A file that does not decode still writes its `source` and leaves the box alone.

**Tests** — `main.test.ts` +9 (a new describe for the ruling), `renderer.test.ts` +2,
`images.test.ts` +4, and two EXISTING expectations updated (see below).

## Decisions I made

1. **A chosen picture's natural size is SCALED to `DEFAULT_IMAGE_EXTENT`, not written raw.** A
   4000x3000 photograph would otherwise become a 4000-unit object beside a 100-unit polygon and
   `fit` would be the only way to find it again. The long side becomes 100 — the same number the
   empty frame uses — so the object changes SHAPE and not SCALE when its picture arrives.
2. **Three `set`s, one echo.** `executeCommand` takes one `Command` and §5.10 has no multi-slot
   form, so the write is three mutations (Rule 5 says that is fine). They are one gesture to the
   operator, so `runPanelCommand`'s per-command echo would say three things about one action;
   `commitImagePicture` logs one summary line instead and still reports any refusal.
3. **A refused `width` does not cost the operator the picture.** The three writes run
   independently: if `width` is formula-driven, that one write is refused and reported and `source`
   still lands. §5.9's per-component posture, applied to a gesture rather than a drag.
4. **`preserveAspect` defaults to `true` at every READ site**, not just at creation. A slot the
   schema gained today is missing from every document saved before today, and `?? true` is what
   makes those load and behave as §5.7's "by default" says.

## Verification (real output)

```
$ npx tsc --noEmit
tsc app=0
$ npx tsc --noEmit -p tsconfig.engine.json
tsc engine=0
$ npx vitest run
 Test Files  36 passed (36)
      Tests  1901 passed (1901)     [at the end of this cycle]
```

**D-016 mutation check** — `pictureBoxSize`'s `Math.max(naturalWidth, naturalHeight)` neutralised
to `Math.max(naturalWidth, naturalWidth)`, so the long side is always the width: RED, *"gives a
TALL picture a tall box"*, `{ width: 50, height: 100 }` vs `{ width: 100, height: 200 }`. Reverted;
tree re-verified clean.

## Acceptance criteria status

Phase 6 criterion: PASSING, untouched by this cycle (0172-REVIEW §2 and §6; not re-derived).
**The gate is still NOT claimed** — D-142 clause 2 needs the human to see this working, and this
cycle changed what they will see.

## Where I got stuck / what is unfinished

- **Two existing test expectations changed — §6.1 trigger 5.** `schema.test.ts`'s "six static
  non-derived paths" and `commands.test.ts`'s "all six non-derived slots" both pinned a slot COUNT
  that the ruling makes seven. Both were updated to seven, with a comment naming why. This is the
  "a registry-completeness test going red is the system working" case, and I am naming it rather
  than letting it pass as noise.
- **The picture is decoded TWICE** — once by the picker (for the natural size) and again by the
  cache (for painting). The browser's own cache makes the second cheap. Rule 5's accepted cost, and
  disclosed at `decodeBitmap`'s own doc.
- **`commitImagePicture`'s echo rounds the box to 2 decimals with its own tiny helper** rather than
  going through `describeSlotValue` — that formatter is for a slot's VALUE and this is a log
  sentence. STATUS already carries "there are four Value-to-text formatters, deliberately"; this is
  not a fifth, it is one `Math.round` in a template.
- I did not check what happens when a picture's natural size is enormous enough that
  `naturalWidth * scale` loses precision. Not reachable with any real image.

## Open questions raised

None. **Q-027 is ANSWERED** (by the human, directly) and its `PROVISIONAL` tag is removed.
`OPEN_QUESTIONS.md` records the ruling; it is owed a `D-NNN` from the reviewer, which an
implementer may not write (PROCESS_BRIEF §2).

## Review point

**Fired: §6.1 trigger 5** (changed test expectations, twice) **and §6.3's cap, which cycle 1
already exceeded.** Continuing past it is the human's routing decision, not mine to make silently:
they saw entry 0173's work, gave four notes, and expects them addressed. Stated here so the debt is
visible rather than absorbed. Cycles since last review: **2/3**.
