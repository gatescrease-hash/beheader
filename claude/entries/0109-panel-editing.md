# 0109 — Panel editing: the paperclip (D-102)
Date: 2026-08-31   Phase: 4   Model: Claude Sonnet 5
Previous entry: 0108-review-verdict-correction   Last review: 0105-REVIEW-phase4 (verdict: ACCEPT WITH EDITS)
Batch: cycle 3 of up to 3 since last review — but see "Review point" below: this cycle fires D-103
clause 4 regardless, so the cap is moot here.

## Declared scope

Build **D-102** — the properties panel becomes WRITABLE. Every MODIFIABLE row gets a paperclip
(blue for `formula`, grey for `literal`); a blue click `unlink`s immediately, a grey click opens a
text input seeded with the row's value; every write is the `Command` the command line would have
built, run through `executeCommand` (never `mutate`, never `writeSlot`); the panel is not rebuilt
while a row's input is open. Files: `src/main.ts`, `index.html`, `src/command/props.ts` — exactly
D-102's own binding list.

## Explicitly not in scope

**D-102 clause 9** — slot-to-slot linking by DRAGGING between two panels. Nothing in `command/` or
`engine/` was touched. Fix-list items 11 (superseded — see below) and 12 are otherwise untouched.

## What I did

**`src/command/props.ts`** (D-096 clause 2, now exercised by D-102): `SlotDescriptor` gains
`readonly synthetic?: true`, set only on `tableCellsSummary`'s row. D-102 clause 2 needs it to
refuse the table's `cells` summary row a paperclip — there is no single slot behind it to write.

**`src/main.ts`**:

- `PanelRow` gains `kind` and `synthetic`, carried straight through from `SlotDescriptor` in
  `buildPanelModel` — the one enumeration (D-094 clause 9) now has one more reader of two more of
  its fields, not a second enumeration.
- New pure section, "Writing through the panel": `panelSlotAddress` (one string join — `row.path`
  already IS the address suffix, D-094 clause 4), `buildPanelSetCommand` (D-102 clause 6's
  disambiguation: a bare number is `set <address> <number>`; anything else is
  `set <address> = <text>`, with a leading `=` the operator typed absorbed rather than doubled),
  `describePanelCommand` (renders a synthesised `Command` the way the operator would have typed it —
  clause 7's echo), `runPanelCommand` (echoes it, calls `executeCommand`, echoes the result or the
  refusal), and the two exported entry points, `commitPanelEdit` and `unlinkPanelSlot` — both a
  no-op returning `state` unchanged for a stale object id (D-023's posture, applied to a UI gesture).
- The DOM half: `openEditor` (one closure variable — at most one row, anywhere, is ever open at
  once), `PanelRowEdit`/`PanelEditHandlers` types, `panelEditHandlers` (builds the `onCommit`/
  `onCancel` pair, reading `state` live), `panelClipElement` (the paperclip span, coloured by
  `row.kind`), `panelEditInput` (the row's `<input>`, with the reentrancy guard described below).
  `updatePanels` now computes, per panel, whether it is *already showing exactly the editor it
  should be* and skips the rebuild only then — every other panel, and this one whenever nothing on
  it is being edited, still rebuilds every paint. `panelsContainer`'s delegated `click` listener
  grew a second branch for `.panel-clip`, alongside the existing dismiss branch.
- File header: `IMPLEMENTS`, the new INVARIANTS bullet (D-102 clause 5), and the two now-stale
  "NOT DONE HERE" paragraphs corrected to present tense (D-060) — one deleted (panel body was
  read-only; it isn't), one replaced with D-102 clause 9's actual remaining gap.

**`index.html`**: `.panel`'s `pointer-events: none` → `auto` (D-102 clause 1, disclosed cost: a
panel overlapping its object now blocks clicks on that part of it — D-101 clause 5 is the remedy).
New rules: `.panel-row__right` (the row's right-hand cluster), `.panel-clip`/`--formula`/`--literal`
(bold blue / faded-and-small grey, the human's own words at D-102 clause 3), `.panel-row__input`.
Header comment rewritten to describe the panel as interactive.

## Decisions I made

1. **A bare-text panel edit reaches only `set`/`set-formula` — never a quoted STRING literal, and
   never `TRUE`/`FALSE`.** D-102 clause 6, read literally: "a bare number... anything else...". A
   panel row is a plain text box with no quoting affordance, so a string is only reachable the same
   way a formula reaches one — typing `"hello"`, which the formula grammar accepts as a string
   literal, landing as a **formula** slot holding that string rather than a literal one. This is the
   ruling's own words applied without inventing a second grammar `parser.ts`'s own `set` already has;
   widening it is additive and cheap if the human wants it later.
2. **The gate that skips a panel's rebuild must NEVER fire when nothing on that panel is being
   edited.** My first draft compared `element.dataset.editingPath` to `editing?.path ?? ""`
   directly — which is wrong: once a panel's dataset settles at `""` (not editing) it stays `""`
   forever, so the comparison is always false and the panel would **never rebuild again after its
   first paint**, freezing every live value (a derived `centroid` mid-drag included) the moment any
   panel existed at all. Caught this by re-reading my own draft before running anything, not by a
   failing test — nothing in this file is unit-tested (D-001) — and confirmed the fix live (see
   "Manual verification" item (c)). The correct gate: skip ONLY when `editing !== undefined` AND the
   dataset already matches; every other case rebuilds, exactly as before this cycle.
3. **Escape closing "the input only, not the selection" (D-102 clause 7 / D-100 clause 5's
   innermost-first order) needed NO change to the window-level Escape handler.** The row's own
   `keydown` listener calls `event.stopPropagation()` unconditionally, so the keystroke never
   bubbles to `window` at all while the input has focus — the DOM's own event order already gives
   "innermost first" for free. I considered adding an explicit `openEditor !== undefined` guard at
   the window listener too, as a defensive belt-and-suspenders, and declined: `updatePanels` already
   clears `openEditor` the moment its object leaves `panelledIds` (added for exactly this
   self-healing reason), so even a focus mishap that let Escape reach `window` would be cleaned up
   by the very next paint. Smaller diff, per PROCESS_BRIEF §13.1.
4. **A `settled` flag inside `panelEditInput` guards against calling a handler twice.** Committing
   or cancelling triggers a repaint that removes the input from the DOM (to show the plain row
   again) — and removing a FOCUSED element fires its own `blur`, which would otherwise re-invoke
   `onCancel` a second time, reentrantly, from inside the very repaint the first call already
   started. Found this by tracing the sequence on paper before writing the code, not by a crash.
5. **`panelEditHandlers` is rebuilt on every `updatePanels` call for the editing panel, even the
   paint where the rebuild is skipped.** A harmless throwaway allocation (Rule 5 — performance is a
   non-goal) rather than restructuring the loop to avoid it; the discarded copy and the live one are
   behaviourally identical, since both close over `state` live rather than a snapshot.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test
 Test Files  27 passed (27)
      Tests  1244 passed (1244)

$ npm run build
✓ 32 modules transformed.
✓ built in 326ms
```

Zero skipped, zero `.only`. 1244 = 1238 (entry 0107's count) + 6 new (`commitPanelEdit`/
`unlinkPanelSlot`'s own describe block) — the 3 edits to EXISTING tests (D-096 clause 2's `synthetic`
field appearing in `props.test.ts` and two `main.test.ts` row-shape assertions) widened existing
expectations rather than adding new `it`s, per D-096 clause 1's disclosure duty above.

**Mutation-checked** (D-016), each broken-then-reverted with the affected test confirmed red then
green:

- `buildPanelSetCommand`'s number branch disabled (`if (false)` in place of the real guard) → the
  "a bare number is a LITERAL write" test failed (echoed `=42` instead of `42`), 0 others.
- The leading-`=` absorption removed (`expression = trimmed` unconditionally) → the "absorbs a
  leading '='" test failed (`origin.x` read `0` instead of `7` — the doubled `=` broke the parse in
  a way that surfaced as a wrong VALUE, not a `#PARSE` message, which is itself worth knowing), 0
  others.
- `commitPanelEdit`'s stale-id guard disabled → the "no-op for a stale object id" test failed with a
  real diff (two new log lines it should never have produced), 0 others.

**Manual verification, live, in a real browser** — `main.ts`'s DOM half is untested by construction
(D-001), and this cycle is the first to write DOCUMENT state from a mouse gesture (D-103 clause 4's
own framing), so I drove the actual app in a real Chromium instance via Playwright, installed
transiently outside the project (`npm install --no-save` in the OS scratch directory —
`package.json`/`package-lock.json` are unchanged; `git status` confirms only the five files above):

(a) `select circle_1` shows one panel; `origin.x`'s paperclip is grey (`panel-clip--literal`).
Clicking it opens an input seeded with `0`, focused. Typing `table_1.A1` and Enter commits: log
shows `> set circle_1.origin.x =table_1.A1` then `circle_1.origin.x = table_1.A1` — the row now
reads `= table_1.A1  (7)` and its paperclip is now blue. Clicking the blue paperclip unlinks
immediately, no input opens: log shows `> unlink circle_1.origin.x`, `unlinked circle_1.origin.x —
kept 7`, `removed formula: = table_1.A1`. Opening the input again, typing `99`, and pressing Escape
closes it and writes NOTHING (`origin.x` still reads `7`) — with the panel still shown, confirming
the selection was untouched (D-100 clause 5 / D-102 clause 7's innermost-first order, verified
against real events, not just reasoned about).

(b) Typing a formula containing a SPACE (`1 + 2`) into an open row input is NOT swallowed by the
window-level space-drag listener built for the always-focused command bar — the exact hazard
Decision 3's `stopPropagation()` exists to prevent, confirmed live rather than only reasoned through.

(c) Clicking into the command bar (a blur, not Escape) while a row's input is open closes it and
writes nothing, leaving the panel and selection untouched — the second, independent path to
`onCancel`, confirmed separately from Escape's.

(d) With NO editor open anywhere, `set circle_1.origin.x 55` typed at the command bar updates the
still-visible panel's `origin.x` row from `0` to `55` — this is Decision 2's bug, confirmed FIXED:
a panel with nothing being edited on it keeps rebuilding every paint, exactly as before this cycle.

(e) `select table_1` shows the `cells` row with no paperclip and the `rows` row with one — D-102
clause 2 confirmed against the one type with a `synthetic` row today.

Zero console errors, zero page errors, across both scripts, in both runs.

## Acceptance criteria status

Not a phase-gate cycle. Phase 4's own criterion is unchanged: still owed by a human session binding
two polygons through a table in one document.

## Where I got stuck / what is unfinished

- **Decision 2's bug never reached a test or a browser in its broken form** — I caught it rereading
  my own draft, which is the least reliable way to catch something and I would rather have had a
  test catch it. There is no unit-testable seam for it (it lives entirely in `start`'s DOM half,
  D-001), so "read it again before running it" is what this project has for that class of file, and
  this time it worked. Recording the near-miss because PROCESS_BRIEF §10 asks for the unflattering
  detail, not just the fixed outcome.
- Fix-list items 11 (a panel's scroll position resets on every paint) and 12 (a right-flipped panel
  overlapping its own object) are UNCHANGED. Item 11 was flagged as "superseded for the editing case
  by D-102 clause 8" in `STATUS.md` — that supersession is now DISCHARGED (clause 8 is built), but
  item 11's ORIGINAL scope (a plain display panel's own scroll position on an unrelated repaint) is
  still open and is not this cycle's.
- `main.ts`'s `start` is now larger still and remains outside any automated assertion (D-001's
  standing gap) — this cycle's own additions are the biggest single expansion of it in one entry so
  far (`openEditor`, `panelEditHandlers`, `panelClipElement`, `panelEditInput`, the extended click
  delegate), all verified live (above) but that is several runs, by me, not a re-runnable assertion.

## Open questions raised

None. No `PROVISIONAL(Q-NNN)` tag was added or touched.

## Review point

**Fired: D-103 clause 4 — D-102 gets its own MANDATORY review point regardless of the batch cap.**
This was true before a line of code existed here and does not depend on how the cycle went. Cycle
count/diff for completeness: cycle 3/3 since 0105-REVIEW, this cycle's own diff 469 insertions / 35
deletions across 5 files (well under the 800/10 cap on its own terms — moot, since the trigger fires
regardless).

**REVIEW: REQUIRED.**
Reason: D-103 clause 4 — the first cycle to write DOCUMENT state from a mouse gesture in the DOM.
Questions for reviewer:
  1. Decision 1 (a panel-typed string reaches a FORMULA slot, never a literal one, because the
     input has no quoting affordance) — is that the intended reading of clause 6, or should a
     future cycle widen the panel's own grammar to accept a quoted literal string directly?
  2. Entry 0107 left two open questions for whichever reviewer looked at D-102's own interaction
     pattern (delegated listeners, `window`-level drag continuation) once row inputs existed. This
     cycle answered question 1 in practice — the panel's editing input is a per-row DIRECT listener,
     not delegated, because (unlike drag/dismiss) it is the one element `updatePanels` deliberately
     keeps ALIVE across paints while open (D-102 clause 8), so a direct listener never faces the
     rebuild-mid-gesture hazard delegation exists to avoid. Worth confirming that reasoning is sound
     rather than a coincidence that happened to work.
