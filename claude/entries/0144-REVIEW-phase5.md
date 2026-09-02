# 0144 — REVIEW (phase 5): entry 0143's in-place editor — D-125 built, clause 5 confirmed
Date: 2026-09-02   Phase: 5   Model: Sonnet 5 (reviewer)
Reviewing: entry 0143-in-place-editing (1 cycle, 481 added / 12 removed source + 284 test across 5 files)
Previous review: 0142-REVIEW-phase5 (ACCEPT)

Verdict: **ACCEPT.** No reviewer edits to source. One new binding ruling, confirming the
implementer's provisional reading of an admittedly-throwaway clause: **D-128**.

## Verification (re-run, not read)

```
$ npx tsc --noEmit                          -> clean, exit 0
$ npx tsc -p tsconfig.engine.json --noEmit  -> clean, exit 0
$ npx vitest run                            -> Test Files 31 passed (31)
                                               Tests    1510 passed (1510)
$ grep -rnE "\.(only|skip|todo)\(" src      -> no matches
$ git status --porcelain                    -> clean
$ git diff --numstat 4bcee5b HEAD -- src    -> 4 files, 481 added, 12 removed
```

The pasted output is real. `1510/1510`, 31 files, zero skipped, zero `.only`, both configs clean —
confirmed independently. The test arithmetic is **exact** this time: baseline 1482 (0142-REVIEW) +28
= 1510; `editor.test.ts` +13, `main.test.ts` +15 (5 `commitTextContent`, 5 `commitTableCell`, 5
`editorSeed` — I counted the `it(` lines). Last cycle's finding did not recur.

**One number in the entry is soft.** The header says "~350 source + ~284 test lines". Test is exact;
source is **481 added / 12 removed** — `main.ts` +298, `editor.ts` +183. The gap is the `main.ts`
header rewrite (~30 lines) plus the pure section being larger than eyeballed, not concealed scope:
every added line is the editor surface the cycle declared, and the §6.3 cap (800) is nowhere near.
An under-estimate written from memory beside an exact test count — worth one line, not an edit.

## Rule audit

- **Rule 1 (no DOM/canvas in `engine/`, or in a pure render module)** — upheld, checked mechanically.
  `grep -nE "document\.|window\.|canvas|CanvasRenderingContext|addEventListener|HTML"` over
  `render/editor.ts` returns only header prose and doc comments — no DOM in code. Its imports are
  `engine/*` (read-only: `document` types, `address`, `graph/node`, `primitives/geometry`,
  `primitives/table`) and own-layer (`camera`, `extent`, `hittest`, `slots`). No `command/*` import —
  the geometry half stays geometry (D-125 clause 1). Nothing imports `editor.ts` but `main.ts`, so no
  cycle.
- **Rule 2 (mutation-only state change)** — upheld, and this is the load-bearing check for this
  cycle. `grep "^\+.*(\.slots\[|\.value =|mutate\(|writeSlot)"` over the diff returns only
  `area.value = editorSeed(...)` / `field.value = editorSeed(...)` — DOM element `.value`, in
  `start`'s DOM half, not a slot write. Both commits route `commitTextContent` / `commitTableCell` →
  `runPanelCommand` → `executeCommand`, the exact seam `commitPanelEdit` uses (D-125 clause 2, D-069,
  D-102 clause 5). No second write path, no new `Operation` kind. I traced both: a `text` commit is
  `{ kind: "set", target: "<name>.content", value: raw }`; a cell commit is `buildCellCommand`'s
  `set` / `set-formula`. Neither carries a `CommandEffect`, and `runPanelCommand` already documents
  that it looks for none.
- **Rule 3 (addressing)** — upheld. The cell reference is `address.ts`'s `formatCellReference` in
  `editor.ts` and `parseCellReference` back again; `main.ts` builds the slot address through the
  existing `panelSlotAddress` join, never a fresh concat idiom. `TABLE_CELL_PREFIX = "cells"` is a
  local constant with one reader (`editorSeed`), documented as such.
- **Rule 4 (one formula engine)** — not touched. `buildCellCommand`'s `=` test is a one-character
  string check that hands the whole source to `set-formula`; no parsing here.
- **Rule 5 (dumbest correct implementation)** — upheld. `editorPlacement` is `worldToScreen` on two
  corners and a divide; no caching, no incremental placement. `EMPTY_TEXT_EDITOR_WIDTH/HEIGHT` (240 /
  20) are round, untuned, and match `extent.ts`'s own no-measurer fallback — correctly added to the
  open constant-tuning list in STATUS rather than presented as chosen.
- **Rule 6 (slot set fixed during evaluation)** — not touched. No schema change; no derived slot
  added (the entry's D-126 line correctly reads "none").
- **Rule 7 (§8 deferred list)** — upheld. D-124, markdown-lite, `overflow`, the load-hardening cycle
  and the gate are all declared out of scope and genuinely absent.

## Invariant audit

- **Rejection leaves prior state bit-for-bit unchanged** — upheld. A refused cell commit (`=1 +`) is
  probed in the tests: the slot stays `undefined`, only the log grows. Through `runPanelCommand` the
  refusal path is `withLog(echoed, [outcome.message])` — the document object is never replaced.
- **Errors propagate, nothing throws** — upheld. `editor.ts` reads through `readNumber` /
  `objectExtent`, both of which narrow away `ErrorValue` / return `undefined`; a `text` object with a
  `#MEASURE` extent lands on the fallback box, not a throw. `editorTargetAt` / `editorPlacement` have
  no throw path.
- **Graph state plain and serializable** — upheld. `EditorTarget` is a plain tagged union of strings.
  The DOM handles (`inPlaceEditor`, `inPlaceElement`) are `start`-closure `let`s, explicitly NOT on
  `AppState` (D-101 clause 7's reasoning, correctly cited) — opening the editor writes no document
  state, same posture as the grey paperclip.
- **Derived slots inside the topological pass** — not touched.

## Spec conformance — D-125, clause by clause

- **Clause 1 (two receivers, one mechanism, one at a time, at the receiver's world position)** —
  met. `editorTargetAt` picks `text` whole or one cell; `editorPlacement` puts the overlay on the
  receiver's world box through `worldToScreen`, divided by the backing/CSS ratio the way `panel.ts`
  does (D-086 clause 3), asserted in `editor.test.ts` with a pan+zoom case and a ratio-2 case. One
  editor: a single `inPlaceEditor` handle.
- **Clause 2 (commits through `executeCommand`, echoed as a typed line)** — met, see Rule 2. The
  echo is `runPanelCommand`'s existing `> set …` line plus `executeCommand`'s own result line,
  pinned by `commitTextContent`'s "echoes the synthesised command into the log" test.
- **Clause 3 (the trap: `content` literal ALWAYS, cell Excel-style)** — **met, and this is the part
  most likely to have been gotten wrong.** `commitTextContent` builds `{ kind: "set" }` directly and
  never calls `buildPanelSetCommand`; the test `=Hello world -> literal "=Hello world"` proves the
  sniff does not happen. `buildCellCommand` is a *separate* helper from `buildPanelSetCommand` — it
  adds the `=`-means-formula rule that a panel row deliberately lacks — and its doc says why. A cell:
  `=` → `set-formula` (source kept verbatim, `setFormula` slices the `=`), `parseCommandNumber` →
  literal number, else literal string. All three arms tested. The cell address goes through
  `address.ts`'s formatter.
- **Clause 4 (double-click opens; single-click unchanged)** — met. New `dblclick` listener; the
  `pointerdown` selection path is untouched except for the commit-first guard. The two `pointerdown`s
  of the double-click land first and select, then `dblclick` opens on the selected object — the
  comment says exactly this and it is correct.
- **Clause 5 (Escape cancels / Enter behaviour / commit on click-outside)** — the clause is
  self-contradictory ("commit is Escape or a click outside" against "Escape cancels, writes
  nothing"). The implementer read it as the coherent version: **Escape cancels, blur/click-outside
  commits, Enter commits in a cell only** (a `<textarea>` lets Enter through as a newline, per the
  clause's own text). That reading is correct and I am confirming it as **D-128** so D-124's cycle
  inherits a settled rule. The human may still overrule on sight — the clause invited it.
- **Clause 6 (an empty `text` object is editable anyway; `extent.ts` not loosened)** — met in the
  geometry, correctly deferred in the wiring. `textEditorBox` falls back to an `origin`-anchored box
  when `objectExtent` is `undefined`; `extent.ts` is untouched. `editorTargetAt` still returns
  `undefined` for an unhittable empty box — reachable only through D-124's creation path, which hands
  the target in directly. The entry is honest that this path has no exercise yet.
- **Clause 7 (commit logic in the exported pure half, not `start`)** — met. `commitTextContent`,
  `commitTableCell`, `editorSeed`, `buildCellCommand` are all module-level; only element lifecycle
  and listeners are in `start`. This is what makes the trap testable at all, and it is tested.
- **Clause 8 (adds a surface, replaces nothing)** — met. The properties panel, the paperclip and
  every command path are untouched.

## Probes I ran

- **Empty-string commit to `content`** (the state D-124 will hand this editor). Accepted, not
  refused: slot becomes `{ kind: "literal", value: "" }`, `resolvedContent` derives to `""`,
  `editorSeed` reopens showing `""`. The effectively-required / dangling-edge refusal (0129) keys on
  *absent*, not empty, so the create-then-edit gesture will work. The box is invisible while empty —
  already a disclosed known problem (D-066), and D-125 clause 6 is the answer to it while the editor
  is open.
- **`editorSeed` for a formula-driven `content`** (loadable illegal state, D-122). Returns the last
  string value; committing replaces it with a literal, repairing the state (D-040). Implementer
  decision 5 — arguably good, and I agree.
- **Re-run of both `tsc` configs and the full suite in a clean tree** — matches the entry.

## Legibility audit

`editor.ts`'s header is present-tense, states layer and allowed imports, cites D-125 / D-066 / D-010
/ D-086 as supplements to stated reasons (D-060's "Okay" tier or better). `main.ts`'s header was
reopened and the stale "nothing paints it / no `text` command" NOT DONE note corrected — a real
present-tense fix, not a changelog. Vocabulary locked: object, slot, literal, formula, derived,
address, extent throughout; "receiver" is the human's own word from the ruling. No `any` in source
(the tests use it in helpers, as they always have). Test names are behaviour sentences, several
naming the trap they defend ("does NOT sniff a leading `=`").

## Honesty audit

The log matches the diff. Both §6.1 triggers (2: first file of the in-place-editor subsystem; 3: a
new authoring surface) are claimed correctly and neither is soft-pedalled. No test was weakened —
the suite is additions only, `git diff` on the two test files is `+` lines exclusively. "Where I got
stuck" is the honest kind: it leads with "nobody has seen the overlay on screen", names the
multi-line log-echo wart as pre-existing, and flags the clause-5 contradiction as needing
confirmation rather than quietly resolving it. The source-line estimate is the one soft number (see
Verification).

## Findings

**None that change the verdict.** The cycle is additive, exactly scoped, mechanically clean on Rules
1 and 2, and routes every write through the sanctioned seam. The one ruling below is a confirmation,
not a defect.

## New ruling

**D-128 — the coherent reading of D-125 clause 5.** Escape cancels and writes nothing; a blur / click
outside commits; Enter commits **only** in a table cell (in a `text` `<textarea>` it inserts a
newline). This is what entry 0143 built and it is confirmed as binding for D-124 and every later
cycle, subject to the human's standing right to overrule clauses 4–5 of D-125 on sight.

## Open questions

- **No new question raised, and none was owed.** Next free: **Q-025**.
- **Q-016, Q-017** — unchanged, both the human's, neither blocking.
- **Q-008, Q-012** — unchanged, still deferred, still blocking nothing.

## Noted, not findings

- **The overlay is a plain 14px input**, not scaled to `style.fontSize` or zoom, so it can sit at a
  different size than the text it edits even though its *box* is placed from the real measured
  extent. Deliberate for v1, disclosed in three places. A font match is a refinement, not a bug.
- **The properties panel and the editor can overlap** when a selected object is double-clicked. No
  remedy this cycle; noted in `main.ts`'s header and STATUS. Worth a ruling only if it proves
  annoying in practice.
- **The multi-line `content` commit echoes as one unquoted, non-re-typeable log line** — this is
  `describePanelCommand`'s existing behaviour for any string `set`, not new here.
- **`EMPTY_TEXT_EDITOR_WIDTH/HEIGHT` and the screen-space chrome constants** remain an untuned set
  (open-fix item 8). Correctly not touched.
- **Nobody has looked at the editor on screen.** The entry says so. A human double-clicking a label
  and typing into it is the check neither model can perform, and it matters more now because D-124
  hands this editor a freshly-created empty box. Worth doing before D-124.

## Verdict

**ACCEPT.**

D-125 built as ruled: the trap in clause 3 is handled by a genuinely separate `buildCellCommand`
rather than a flag on the panel helper, and the `=Hello world -> literal` test proves it. Clause 7
was honoured, so the highest-traffic authoring path in the program is tested at its pure boundary
instead of buried in an untested listener. The geometry half is a clean pure render module with the
right imports and no cycle. What is left undone — the on-screen look, the font match, the empty-box
creation path — is D-124's or a refinement, and all of it is disclosed.

Phase 5 remains OPEN. The human's order stands: **D-124** (`text` placed by pointing, opening this
editor on creation) next, then the **load-hardening cycle** (D-126 + D-127 + D-108, one `document.ts`
diff, `REVIEW: REQUIRED`), then markdown-lite + a markup-aware measurer in one cycle, then
`overflow`, then the Phase 5 gate test.
