# 0140 — RULINGS (phase 5): the human on text placement and in-place text entry
Date: 2026-09-01   Phase: 5   Model: Opus 5 (reviewer, relaying and formalising)
Previous entry: 0139-REVIEW-phase5   Last review: 0139-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
No code changed. Two binding rulings issued: **D-124**, **D-125**.

## What happened

The human stepped in after 0139-REVIEW with two observations about how the `text` object behaves in
their hands, and one standing note on precedence. Both observations are product rulings, both are
now `DECISIONS.md` entries, and one is declared **ABSOLUTE PRIORITY**.

Quoted in full in D-124 and D-125 rather than paraphrased here — the exact words are the ruling.

## D-124 — `text` is placed by pointing

`text` is the only creation command with no `prompts` sequence. `circle`, `polygon`, `rect` and
`table` all have one; typing the bare word starts it and the next canvas click answers the point
step. `text` instead takes optional `x`/`y` defaulting to `0` (D-121 clause 3), so an operator who
types `text` and clicks gets nothing, and every text object created without typed coordinates stacks
at the world origin.

**The gap was disclosed, and its reasoning was sound for the wrong sequence.** `parser.ts`'s `text`
registry entry says so in a comment: a prompt step for content would need an `accepts` kind
`PromptStep` does not have. True — but the sequence the operator wants does not ask for content at
all. It ends at the point pick, and the content is typed into the box (D-125). So `text` gains a
one-step `point` sequence, `PromptStep.accepts` does not widen, and `prompt.ts`'s dormant
`ResponseRead` widening hazard stays dormant.

**What makes this small:** the click-to-place path is entirely built and reviewed.
`main.ts`'s `pointerDownAt` already converts a screen click to a world point and routes it to
`respondToPrompt` whenever `state.pending` is set; `prompt.ts`'s `beginCommand` already defers a
quoted or `key=value` line to `parseCommand` whole, so `text "hi"` and `text x=0 y=0 "hi"` keep
working with no new branch. The diff is a registry entry plus `buildFromPrompts`.

## D-125 — text is typed into its receiver (ABSOLUTE PRIORITY)

Two receivers: a `text` object's `content`, and a table cell. Both edited by a DOM input overlaid on
the canvas at the receiver's own position.

**What makes this buildable rather than a rewrite:** the commit seam already exists and is reviewed.
`main.ts`'s `commitPanelEdit` → `runPanelCommand` → `executeCommand` is exactly the shape this
needs — a UI gesture synthesising a `Command`, running it through the one mutation path, echoing it
into the log (D-102 clause 5, D-069, Rule 2). In-place editing is a **new surface over that seam**,
not a new write path, and a cycle that invents a second one has violated Rule 2 regardless of how
convenient it looked.

**The trap, and the reason this entry spells it out.** `buildPanelSetCommand` routes every
non-numeric string to `set-formula`. Reusing it for a `text` box would commit `Hello world` as the
formula `=Hello world` — which D-122 refuses outright, since `content` is permanently `literal`-kind.
So the two receivers need genuinely different commit rules, and this is not a detail to be
normalised away later:

- **`text` `content`** — always literal, never sniffed for a leading `=`. `{= }` and `{? }` are §5.6
  markup inside a literal string; the whole point of D-122 is that the string is raw source.
- **A table cell** — Excel-style: leading `=` is a formula, everything else is a literal (number if
  it parses, else string). §5.4's own model.

**A 0139-REVIEW note just became load-bearing.** Yesterday's review recorded, as a noted problem, that
an empty-`content` `text` object has no extent and is therefore invisible and unselectable. D-124
creates precisely that object and hands it to this editor. D-125 clause 6 resolves it the right way
round: the editor's overlay draws its own box and caret and does not depend on `objectExtent`, and
`extent.ts`'s rule is NOT loosened to compensate. Had these two rulings arrived in the other order,
the tempting fix would have been to give empty text a degenerate extent, which is D-066's exact
prohibition.

## Sequencing — what I changed, and what is the human's call

`STATUS.md`'s recommended order is rewritten. **D-125 is first**, as instructed. Two notes on
ordering that the human should overrule if they disagree:

1. **D-123 (`measuredWidth`) is worth doing first anyway, and it is roughly a day.** The in-place
   editor positions its overlay from `objectExtent`, and for an auto-width `text` object — which is
   every one the `text` command creates — that box is currently a provisional fixed 240 wide. Build
   the editor on the wrong box and the overlay lands in the wrong place, and the fix afterwards
   touches the editor as well as `extent.ts`. It is listed first as a prerequisite, not as a delay.
2. **D-124 is small once D-125 exists** (a registry entry plus the "open the editor on creation"
   wiring), so it is listed immediately after, not before.

Markdown-lite, `overflow`, and the Phase 5 gate all move down the list. The gate criterion itself is
unchanged; Phase 5 now simply carries more work before it can be claimed.

## Clauses ruled by me, not by the human — overrule freely

D-125 clauses 4 and 5 (double-click to open; Enter inserts a newline in a text box but commits in a
table cell; Escape cancels; click-outside commits) are the conventional defaults. They were ruled so
the cycle is not blocked on a round-trip, they are marked as such in `DECISIONS.md`, and they are the
cheapest thing here to change on sight.

## Open questions

None raised. Q-024 → D-123 remains the only recently-answered one; **next free: Q-025.**

## Review point

No code changed, so nothing to review. The next cycle implements D-123 or D-125 and reports
`REVIEW: REQUIRED` on its own triggers — D-123 touches `primitives/schema.ts` (§6.2), and D-125 is
the first file of a new UI subsystem (§6.1 trigger 2) as well as a brief extension (trigger 3).
