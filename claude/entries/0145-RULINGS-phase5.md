# 0145 — RULINGS (phase 5): the human's visual test of entry 0143's in-place editor
Date: 2026-09-02   Phase: 5   Model: Sonnet 5 (reviewer)
Previous entry: 0144-REVIEW-phase5   Last review: 0144-REVIEW-phase5 (verdict: ACCEPT)

No code was written this entry. Three binding rulings issued — **D-129**, **D-130**, **D-131** — all
from the human running entry 0143's in-place editor on screen for the first time. They are sequenced
as **one short editor-polish cycle, BEFORE D-124.**

## What the human tested

The full checklist from 0144-REVIEW's "worth a live look" note. Results:

- **The clause-3 trap holds.** `=**SUM(1,2)**` typed into a `text` box committed as the literal
  string `"**=SUM(1,2)**"`, echoed as a plain `set`, never evaluated, never refused. Screenshot
  confirms the log and the properties panel. This was the expensive-to-get-wrong case; it is right.
- **Opening, placement, pre-fill, focus/select** — all correct for both receivers.
- **Escape cancels, writes nothing** — confirmed.
- **Enter inserts a newline in a `text` box, commits in a cell** — confirmed.
- **Cell literal / number / formula commit and re-seed** — correct except the display form (D-131).
- **Zoom keeps the editor open and the overlay tracks; a receiver deleted mid-edit closes it; a
  click on a panel commits cleanly; no console errors** — all confirmed.

Three defects surfaced.

## D-129 — the overlay does not scale with zoom, and it clips

The box is placed through `worldToScreen` so it scales; the font is pinned at 14px and
`overflow: hidden`. Zoomed in: tiny text in a big box. Zoomed out: large text clipped by a box sized
from the *committed* (short) content, with no way to see what is being typed. Entry 0143 called this
"deliberate for v1" and 0144-REVIEW accepted that — the operator's report overrides both
(PROCESS_BRIEF §1). Ruled: the overlay's font tracks `style.fontSize × camera.zoom` (a cell uses a
fixed base × zoom), and it never clips its own content. Box anchoring and initial size are
unchanged. **This is the serious one** — it breaks the core gesture, and D-124 hands this editor a
fresh box on creation.

## D-130 — a pan gesture commits and closes the editor

`pointerdown` calls `commitInPlace()` before it checks for the pan gesture, so middle-drag /
space-drag pan commits; wheel-zoom does not. Inconsistent, and it cancels out the pan-to-see-it
workaround for D-129. Ruled: a pan gesture (`event.button === 1 || spaceHeld`) does not commit;
only a plain canvas press does. One conditional moved.

## D-131 — a cell formula redisplays fully-qualified

Operator typed `=A1 * 2` into a cell of `table_1`; reopening showed `=table_1.A1 * 2`. The commit
side already resolves bare refs against the host table (`cellHostObjectId` → `parseFormula`'s third
arg); only `formatFormula` has no relative mode. The human has asked for Excel-like same-table
referencing here. Ruled: `formatFormula` gains an optional `relativeToObjectId`; `editorSeed` passes
the cell's host table id; same-table refs and ranges print bare (both endpoints or neither),
everything else stays qualified, every other caller unchanged. This is the only ruling of the three
that touches an engine file (`format.ts`) — a new optional parameter, no behaviour change for
existing callers.

## The editor-polish cycle (next slice)

One cycle discharging D-129 + D-130 + D-131, in `render/editor.ts` + `main.ts` + `index.html` +
`format.ts` + tests. Not the first file of a subsystem (the editor was reviewed at 0144), but it
implements three fresh rulings and adds a parameter to `formatFormula`, a widely-called engine
function — **expect `REVIEW: REQUIRED`** (§6.1 trigger 3, and the implementer should apply §6
honestly). Then **D-124** (`text` placed by pointing), which now rides on a polished editor. Then the
load-hardening cycle, markdown-lite, `overflow`, the Phase 5 gate — order otherwise unchanged.

## Open questions

None raised, none answered. Next free: **Q-025**.

## Not a ruling, carried forward

- The overlay still will not match font family, markdown rendering, or text alignment — a noted
  refinement, explicitly out of D-129's scope.
- The properties panel and the editor can still be forced to overlap by a small window (0143's
  header, 0144-REVIEW). No remedy scheduled; the human confirmed they stay clear at normal sizes.
