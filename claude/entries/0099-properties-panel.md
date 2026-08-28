# 0099 — D-094's read-only properties panel
Date: 2026-08-27   Phase: 4   Model: Claude Sonnet 5 (implementer)
Previous entry: 0098-REVIEW-phase4   Last review: 0098-REVIEW-phase4 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; 7 files (`render/panel.ts` + its test new,
`index.html` / `main.ts` / `main.test.ts` / `renderer.ts` / `renderer.test.ts` edited),
~460 changed lines. §6.1 trigger 2 fired — stopping here regardless (see "Review point").

## Declared scope

STATUS.md's queue item 1: D-094's read-only floating properties panel — the pure placement
arithmetic in a new `render/panel.ts` (clause 11), the panel DOM built in `main.ts` from
`command/props.ts`'s descriptors (clause 9), shown when the selection resolves to an object with
a drawn extent (clause 2), and the selected object's canvas name label suppressed (clause 3).
Not in scope: D-090's prompt preview, D-088/D-089, §5.11's load boundary, or any WRITING/linking
in the panel (Q-014's remaining half — the panel is `pointer-events: none`, clause 10).

## Explicitly not in scope

- **Anything a click on a panel row would do** (Q-014, the human's alone). No inputs, no
  listeners, no `mutate` reachable from the panel — `pointer-events: none` makes every click pass
  through to the canvas (D-094 clause 10).
- The sketch's dashed leader line between panel and object (D-094 explicitly defers it — it would
  need the panel's screen rect back inside the renderer).
- Fix-list item 9 (`drawObjectChrome` leaves `ctx.font`/`textAlign`/`textBaseline` set): I opened
  that function for clause 3's one-line suppression and did not otherwise touch it (§4).
- The formula-driven indicator's narrowness (fix-list item 10) — `renderer.ts` was open for
  clause 3, not for a widening D-068 did not ask for.

## What I did

- **`src/render/panel.ts`** (new) — `placePropertiesPanel(extent, camera, ratioBackingPerCss,
  viewport, panel)` → the panel's top-left in CSS pixels (D-094 clauses 11-12). Anchors the
  panel's right edge one `PANEL_OBJECT_GAP_CSS` to the LEFT of the extent with top edges aligned
  (the human's sketch); flips to the RIGHT of the extent when the left placement would cross the
  canvas's left edge; clamps the result so the whole panel stays on the canvas. `worldToScreen`
  (from `./camera.ts`, never a second copy — D-010) returns BACKING pixels, so every screen
  coordinate is divided by the canvas's own backing/CSS ratio (D-094 clause 12 / D-086 clause 3);
  a non-finite or non-positive ratio falls back to 1. Imports `./camera.ts` and `./extent.ts`
  only — no `command/*`, no cycle (neither imports `panel.ts`).
- **`src/render/panel.test.ts`** (new) — 9 tests: left anchor with room, flip when no room, the
  gap constant on both sides, top/bottom/right clamps, the CSS↔backing ratio conversion, the
  ratio fallback for `0`/`NaN`/negative, and that a camera pan+zoom moves the panel (the anchor
  is a world point).
- **`src/main.ts`** —
  - `buildPanelModel(object, objects)` (new, exported, pure): builds the panel's row model from
    `command/props.ts`'s `buildSlotDescriptors` and **no other reading of the schema** (D-094
    clause 9). Splits the descriptors into `modifiable` (kind `literal`/`formula`) and `derived`,
    preserving schema declaration order (clause 7); each row carries the `slotKey` path exactly as
    the operator would type it after the name (clause 4), the value via `describeSlotValue`, and a
    formula slot's reconstructed source (clause 6).
  - `writePanel` / `panelRowElement` (new, module-level, next to `drawLog`): the DOM writer —
    header, the modifiable rows, then (only if there are derived rows) the thick rule and the
    derived rows. All text via `textContent` (clause 14). This is the only new code that touches
    the DOM.
  - `start` gains a `panel: HTMLElement` parameter; its `paint()` now calls a new `updatePanel`
    closure that shows the panel exactly when `state.interaction.selectedObjectId` resolves to an
    object with an `objectExtent` (clause 2 — a stale id hides it, D-023-shaped), writes its rows,
    then measures it and positions it via `placePropertiesPanel` every paint (clauses 12-13). The
    bootstrap queries `#panel` and passes it in.
- **`index.html`** — the canvas moves inside a new `position: relative` `#stage` (a flex child
  with `min-height: 0`), because a flex child cannot have anything float over it (the gotcha
  `main.ts`/`index.html` both recorded). `#panel` is `position: absolute`, `pointer-events: none`
  (clause 10), `hidden` by default, `overflow: auto` (browser-default scrollbar, clause's
  "nothing beyond that"). CSS for the header, the 3px `.panel-rule` (clause 5), and
  `.panel-row--derived { font-style: italic }` (clause 5). The file header comment is rewritten —
  it claimed "no panels" and "three elements are the whole interface", which D-094 falsifies and
  D-065 makes mine to fix.
- **`src/render/renderer.ts`** — `drawObjectChrome` gains a `suppressName: boolean`; when set it
  omits ONLY the name label (`halfName` becomes 0, so the badge and ticks still draw a gap either
  side of the anchor). `renderDocument`'s pass-3 loop passes `object.id === selectedObjectId`
  (D-094 clause 3). Header's pass-3 description and `renderDocument`'s doc updated.
- **`src/render/renderer.test.ts`** — 4 tests: the selected object's name is not drawn; its badge
  and ticks still are; a non-selected object is still labelled while another is selected; a stale
  selection id suppresses nothing.
- **`src/main.test.ts`** — 4 tests on `buildPanelModel`: modifiable/derived split in schema
  order, a literal row's plain value, a formula row's source kept in the modifiable group
  (clause 6), and a table's cells as ONE `cells` row (D-077 / clause 8).

## Decisions I made

- **`placePropertiesPanel` takes a fifth argument, the backing/CSS ratio, beyond D-094 clause
  11's literal list of four.** Clause 12 requires the conversion "here", and it needs the ratio
  the canvas actually has (`canvas.width / bounds.width`) — which is not derivable from the
  extent, camera, viewport size, or panel size. Named here per D-096 clause 1 (a ruling's list is
  a ceiling; a divergence must be disclosed). The rationale — the panel is CSS-pixel DOM,
  `worldToScreen` is backing pixels — is clause 12's own.
- **The descriptor→row mapping (`buildPanelModel`) lives in `main.ts`, not `render/panel.ts`.**
  `render/*` imports `engine/*` only today; `buildSlotDescriptors` is `command/`. `main.ts`
  legitimately imports both layers and is where the wiring belongs. `render/panel.ts` stays pure
  coordinate math. This mirrors `commands.ts` keeping its own `formatSlotDescriptorLine` rather
  than pushing it into `props.ts` — each reader formats `SlotDescriptor[]` its own way; the
  shared thing is the descriptor list (D-094 clause 9).
- **The thick rule renders only when there is at least one derived row.** A trailing 3px rule
  with nothing below it is a visual artefact; the rule *separates* two groups and with no derived
  group there is nothing to separate. Every schema today has ≥1 non-derived path, so the
  modifiable group is never empty. (A `value` object: one `value` row, no rule. A `circle`: three
  modifiable rows, the rule, then `vertices` + the eight `verticesDerivedSlots`.)
- **Name suppression is derived inside `renderDocument` from the existing `selectedObjectId`
  parameter — no signature change.** `main.ts`'s `paint` call is untouched; `renderer.test.ts`'s
  and `main.test.ts`'s fake contexts need nothing added. The badge/tick horizontal offsets with a
  suppressed (zero-width) name put them a `CHROME_GAP_SCREEN` either side of the anchor centre,
  which is correct — nothing to collide with.
- **The panel is measured after its rows are written and while it is visible** (`hidden = false`
  before `getBoundingClientRect`), so `placePropertiesPanel` gets a real size. Immediate-mode:
  the panel is rebuilt whole every paint, like the log and the canvas.

## Verification (real output)

$ npx tsc --noEmit
(exit 0, no output)

$ npx tsc --noEmit -p tsconfig.engine.json
(exit 0, no output)

$ npx vitest run
 Test Files  27 passed (27)
      Tests  1191 passed (1191)

$ npm run build
✓ 32 modules transformed.
✓ built in 308ms

Zero skipped, zero `.only` (grepped and confirmed by the runner). 1191 = 1174 (entry 0098) + 17
new (9 in `panel.test.ts`, 4 in `renderer.test.ts`, 4 in `main.test.ts`).

**Mutation check, each mutant seeded alone and the file `diff`-confirmed restored afterward:**
1. `panel.ts` — `if (left < 0)` → `if (false)` (never flip): **killed 4** (both flip tests, the
   gap-constant test, the camera-follows test).
2. `panel.ts` — `extentLeftCss` given a `+ 999` offset: **killed 8** of 9. The 1 survivor is
   "clamps a right-flipped panel that would overflow the right edge": that case clamps to the
   right bound (`800 - 120 = 680`) under both the real code and the mutant, so it cannot see the
   offset — which is why the other clamp/anchor tests exist to pin the un-clamped path.
3. `panel.ts` — ratio guard `... > 0 ? ratioBackingPerCss : 1` → bare `ratioBackingPerCss`
   (`/0` → `Infinity`): **killed 1** (the ratio-fallback test — the only one that passes a bad
   ratio).
4. `renderer.ts` — `if (!suppressName)` → `if (true)` (always draw the name): **killed 3** (the
   three suppression tests; the stale-id test still passes, correctly — nothing is suppressed
   there anyway).

## Acceptance criteria status

Not a phase criterion — D-094, ruled at 0095-REVIEW. "Done when" (from the queue): a pure tested
placement function in `render/`, the panel positioned in CSS pixels, the selected object's canvas
label suppressed, `pointer-events: none`, rows from `props.ts`'s single enumeration. All five
hold, verified above. Phase 4's own gate (all three cross-object bindings in one document,
human-authored) is still owed and still needs a human session.

## Where I got stuck / what is unfinished

- **The panel DOM (`writePanel`, `updatePanel`, the `start` wiring) is untested**, like the rest
  of `start` — it needs a DOM this project adds no test dependency for. The *arithmetic*
  (`placePropertiesPanel`) and the *model* (`buildPanelModel`) are pure and covered; what is not
  covered is that `paint` calls `updatePanel`, that `updatePanel` reads the panel's measured
  size correctly, and that the `#stage` wrapper lets the panel overlay rather than shove the
  layout. **Those need a human to open the app and click a shape.** Manual check to run: create a
  circle and a table, click each, confirm the panel appears beside it (left, or right near the
  canvas edge), tracks it on pan/zoom, shows the slots with the thick rule and italic derived
  rows, the clicked object's on-canvas name disappears, and a click "through" the panel still
  selects what is behind it.
- **An off-screen selected object still gets a panel, clamped to a canvas edge.** D-094 does not
  ask for hiding it, and the selection highlight is equally off-screen, so this is consistent —
  noted as a known limitation, not fixed on suspicion (Rule 5).
- `describeSlotValue` quotes the table `cells` summary string (`"3×3 grid — 0 of 9 cells
  written"`) because it is a string `Value` — D-096 clause 2 ruled this stands, so the panel row
  shows it quoted too. Consistent with `props`'s log line.

## Open questions raised

None. D-094's fourteen clauses and D-096 answer everything this cycle touched. Q-014's remaining
half (editing/linking by mouse) stays open and untouched — `pointer-events: none` is what keeps
approving it later an addition rather than an unwinding.

## Review point

**Fired: §6.1 trigger 2 — first file of a new subsystem** (`render/panel.ts`; STATUS.md and
0098-REVIEW §9 both anticipated this stop). `renderer.ts`'s one-line clause-3 change is inside an
already-reviewed file and authorised by D-094's "Binding on: `src/render/*`". No test expectation
changed (the 17 new tests are additions; every prior test passes untouched — confirmed by the
1174 → 1191 count and a clean run). No dependency, build step, or config added.

Cycles since last review: 1/3. Diff since last review: ~460 lines / 7 files — under the §6.3 cap,
but the §6.1 trigger forces the stop regardless.

`REVIEW: REQUIRED.`
Reason: first file of a new subsystem (§6.1 trigger 2).

Questions for reviewer:
1. Is the fifth `placePropertiesPanel` argument (the backing/CSS ratio) an acceptable reading of
   D-094 clauses 11-12 together, disclosed per D-096 clause 1?
2. `buildPanelModel` in `main.ts` rather than `render/panel.ts` or `command/props.ts` — is the
   layering call right (render stays `engine/`-only; main wires both layers)?
3. The thick rule rendering only when a derived group exists — acceptable, or should it always
   render for a consistent two-group shape?
4. Anything wanted for the untested DOM half beyond the manual-check list above, given the
   project's standing "no test DOM" position?
