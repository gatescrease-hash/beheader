# 0179 — §5.8's script node on screen: a labelled box, inputs left, outputs right
Date: 2026-09-07   Phase: 6   Model: reviewer acting as implementer (Opus 5)
Previous entry: 0178-port-commands   Last review: 0177-REVIEW-phase6-scope
Batch: cycle 2 of 2 in D-146's build; ~600 lines / 12 files changed so far.

## Declared scope

Build D-146 clauses 5–6: §5.8's *"Render as a labelled box with input ports on the left and output
ports on the right"*, with its `extent.ts` and `hittest.ts` arms shipped together (D-066 makes
drawn extent and clickable extent one extent, so shipping one alone is forbidden).

## Explicitly not in scope

Drawing a port's VALUE, or a wire between a port and what it is bound to — §5.8 asks for a
labelled box and neither of those, and inventing a display the brief does not name is §8's last
bullet. Resize grabbers for a script node: its box is sized by its ports, not by slots, so there
is nothing for a grabber to write. Measuring the label (see decision 1).

## What I did

**`render/slots.ts`** — `SCRIPT_BOX_WIDTH` (140), `SCRIPT_HEADER_HEIGHT` (24),
`SCRIPT_PORT_ROW_HEIGHT` (18) and `scriptBoxHeight(inCount, outCount)`. Here rather than in
`renderer.ts` for the reason `TABLE_CELL_WIDTH`/`_HEIGHT` are here: the drawn box, the click box
and the extent must be ONE box (D-066), so its geometry is declared once (D-010). The height takes
the LONGER family, never the sum — the two sit side by side — and a portless node still gets one
row.

**`render/extent.ts`** — `scriptExtent`: `origin` + the constants above. **Every script node has
an extent, a portless one included**, so `script x=0 y=0` lands as something visible, selectable
and draggable rather than an invisible object only `list` can find. `undefined` only for a
non-finite `origin`, which would poison `documentExtent` and every `fit` after it.

**`render/hittest.ts`** — `script` joins `text`/`image` on the existing `hitTestBoundingBox` arm,
reading `extent.ts`'s extent, not a second box. §5.9's own list — *"bounding box for
text/tables/images/scripts"* — is now complete.

**`render/renderer.ts`** — `drawScript`. A filled box (a node is opaque, unlike the outline
shapes), a header band carrying `language` read from the slot, then one row per port: its name,
and a small square stub on the edge it belongs to. Port order is `ports.in`/`ports.out`'s own
order, which D-141 clause 2 makes ordered state — nothing sorts. `script` also joins the
extent-based selection-highlight arm, and gets its name label for free (`chromeAnchorPoint` reads
the extent).

**Tests** — `renderer.test.ts` +8. Two "no visual definition yet" lists dropped `script`
(`renderer.test.ts`, `hittest.test.ts`) — the same change `image` made to those lists at 0173.

## Decisions I made

1. **The box is a FIXED width by a port-count height, not measured.** A script node has no
   `width`/`height` slots and no `measuredWidth`/`measuredHeight` pair — `text` has those because
   §5.6 asks for wrapping, and §5.8 asks for nothing of the sort. Measuring the label would mean
   `extent.ts` taking a `TextMeasurer`, which it has never taken and which would thread through
   every caller (`imageExtent`'s own note makes the same argument about the bitmap cache). Rule 5.
   **A long port name overflows the box**, and that is the disclosed cost, not an oversight.
2. **The body is FILLED**, unlike every shape above it in that file. A script node is a node — an
   opaque box you read labels off — rather than an outline whose interior belongs to whatever is
   behind it. One constant to change if the human dislikes it.
3. **No port VALUE on the canvas.** §5.8 says "labelled box with ports". A value is one `props` or
   one properties-panel row away, and putting it on the canvas is a display the brief does not
   specify.

## Verification (real output)

```
$ npx tsc --noEmit                            -> 0
$ npx tsc --noEmit -p tsconfig.engine.json    -> 0
$ npx vitest run
 Test Files  36 passed (36)
      Tests  1955 passed (1955)
$ npx vite build
dist/assets/index-DglJNPMO.js  138.32 kB │ gzip: 40.83 kB   ✓ built in 411ms
$ grep -rE "\.(only|skip|todo)\(" src        -> none
```

A script node, as an operator meets it (driven through `submitLine`/`pointerDownAt`):

```
script x=100 y=100 ; addport script_1.in.factor ; addport script_1.out.result
  EXTENT: { minX: 100, minY: 100, maxX: 240, maxY: 142 }
  click at (110, 110)  -> SELECTED: ["obj_1"]
  drag by (20, 30)     -> origin now 120, 130
```

**D-016 mutation check, and it FAILED FIRST — the useful kind.** I moved every output label to the
box's LEFT edge, neutralising §5.8's central sentence. **All 1955 tests passed.** My own test had
asserted `ctx.textAlign`, which is a separate property from the x it is applied to, so the claim
"outputs on the right" was never actually pinned. Test rewritten to assert the POSITION; the same
mutation is now RED (1 failure). The comment in that test says why it is written that way.

## Acceptance criteria status

Phase 6 criterion: PASSING and performable (entry 0178). **The GATE is NOT claimed.** D-146
clause 5 is now built, so every clause of D-146 is — but **D-142 clause 2 still stands: "renders
properly" is settled by the human seeing it**, and they have seen neither this nor the `image`
work since their four notes at 0173.

## Where I got stuck / what is unfinished

- **A long port name overflows the box** (decision 1). `factor` and `result` fit; `average_speed`
  will not. Fixing it properly means measuring, which is decision 1's rejected path.
- **The port stub squares are drawn on the box's edge, half in and half out.** With two ports on
  the same row, one in and one out, the labels can collide in a 140-unit box. Untested visually.
- **Nothing draws the CONNECTION** between a bound `in` port and the cell driving it. §5.8 does not
  ask for it, but an operator looking at a canvas of nodes will expect a wire, and this is the
  first render where that absence is visible rather than theoretical.
- **All five constants are untuned picks** (Rule 5), like every other constant in this file, and
  the colours were chosen without seeing them.

## Open questions raised

None.

## Review point

**Fired: §6.1 trigger 5** (two "no visual definition yet" lists dropped `script` — the same
disclosure `image` made at 0173) and **D-142 clause 2 / D-146 clause 5**, which make the human's
on-screen confirmation a precondition of the gate this entry does not claim. Cycles since last
review: **2/3**; ~600 lines / 12 files against §6.3's 800/10 — under the cap, and this closes
D-146's build.
