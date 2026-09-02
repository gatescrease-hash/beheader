# STATUS — as of entry 0152-editor-cycle

**READ THIS FIRST — the EDITOR CYCLE (D-135 + D-136) is BUILT and AWAITING REVIEW. `REVIEW:
REQUIRED` (§6.1 triggers 3 + 5). STATE GREEN — 1553/1553, 0 skipped, 31 files. Batch 1/3, 3 files
/ ~137 lines.**

**After the review clears, the human re-tests live-look items 2, 3, 5, 6 on screen (0150-REVIEW's
script). The LOAD-HARDENING CYCLE does not start until the editor surface is clean on screen.**

**WHAT ENTRY 0152 DID (D-135 + D-136 — from 0151-RULINGS / the human's 2026-09-02 on-screen test):**
- **D-135** — `index.html`: `.text-editor` gains `scrollbar-width: none` + the
  `::-webkit-scrollbar { display: none }` twin; `overflow: auto` kept. Scrollbars take no layout
  box, so they cannot overlap a one-line overlay's text (item 2) or steal width from a wrapping
  box (item 6's leading cause). **F28 CLOSED in code — unseen on screen.**
- **D-136** — `main.ts`:
  - `advance`'s open-editor-on-create branch now also requires `session.command.content === ""`
    (the pointing / prompt path + explicit `text ""`). A content-bearing typed `text` creates the
    box and leaves the command bar focused. **Overrules entry 0149's Decision 2.**
  - `abandonCreatedTextBox(state, objectId, context)` — new exported pure helper. Deletes a
    just-created empty `text` box through `executeCommand` (a `delete`, Rule 2); a box that got
    content is a no-op. `start`'s `cancelInPlace` (Escape) and `commitInPlace` (empty blur) call
    it when a `start`-local `inPlaceEditorFromCreation` flag is set.
  - `runPanelCommand` / `describePanelCommand` widened to accept `DeleteCommand` (the abandon
    path only; never carries a `CommandEffect`).
  - **F29 CLOSED in code — unseen on screen.**
- **Live-look item 5 (blank seed) reproduced and confirmed gone:** D-136 clause 1 removes the
  editor-open on the content-bearing path entirely, so there is no overlay to seed blank. Test
  "a content-bearing typed form does NOT open the editor" pins it.

**STILL UNSEEN ON SCREEN (the re-test 0150-REVIEW made a gate):** D-135's CSS effect (items 2, 6),
D-136's `start`-half Escape/empty-blur wiring (items 3, 5). `abandonCreatedTextBox` — the
decision — is tested; the DOM half calling it is untested by construction (D-001).

---

## Where the code actually is — as of entry 0152

STATE: **GREEN** (compiles, all tests pass). Both configs compile, **1553/1553** tests pass,
0 skipped, 0 `.only`. **31 test files.** **PHASE 5 IS OPEN.**

Last review point: **0150-REVIEW-phase5** (ACCEPT — entry 0149 / D-124; D-134 issued).
**0151-RULINGS** wrote no code (D-135 + D-136). **0152** (this entry) built the editor cycle.
Cycles since last review: **1/3**. Diff since last review: **~137 lines / 3 files** (cap 800/10).

Entry 0152's diff: `index.html` (D-135, 2 CSS declarations + comment), `src/main.ts` (D-136 —
`advance` conjunct, `abandonCreatedTextBox`, `runPanelCommand`/`describePanelCommand` widened,
`start` flag + two branch additions, header updates), `src/main.test.ts` (one test inverted, +4
tests).

## Read this first — what a cold reader needs

**0. `TEXT_SCHEMA` HAS ELEVEN NON-DERIVED + THREE DERIVED SLOTS.** Non-derived: `origin.x`/`origin.y`
(D-121) + `content` + `width`/`height`/`overflow` + five `style.*`. `content` + `width` +
`style.font`/`fontSize`/`lineHeight` are **effectively-required** (dangling-edge refusal if absent —
0129). Derived: `resolvedContent` (dynamic deps), `measuredHeight` and `measuredWidth` (static deps,
**the SAME list** — one measurement answers both).

**0a. THE TWO MEASURED SLOTS ARE ONE MEASUREMENT (D-123 clause 2).** `measureTextBox`
(`primitives/text.ts`, private) owns the read set, the failure ladder and the single `measure` call.
Failure order: upstream `ErrorValue` → `#MEASURE` (no real measurer, D-118) → `#TYPE` (unusable
style) → `#TYPE` (non-finite width OR height) → the box.

**0b. `extent.ts`'s `text` box, both axes:** the fixed slot when positive-finite → the measurement
when positive-finite → a fixed fallback (240 / 20, reached ONLY for `#MEASURE`). `undefined` for a
`text` object with no `resolvedContent`. `hittest.ts`, the selection highlight, the chrome anchor and
`fit` all read this ONE box (D-066/D-010).

**0c. A HAND-BUILT `text` FIXTURE PUSHED THROUGH `mutate` NEEDS ALL THREE DERIVED PLACEHOLDERS.**
D-018 refuses a missing `measuredWidth: { kind: "derived", value: null }`. A fixture that only goes
through `evaluate`/`objectExtent` does not.

**0d. `DEFAULT_TEXT_*` (`command/commands.ts`)** — `width`/`height` `"auto"`, `overflow` `"visible"`,
font `"sans-serif"`, fontSize `16`, lineHeight `20`, color `"black"`, align `"left"`. §5.6 gives no
defaults. Not `PROVISIONAL`-tagged. **`DEFAULT_TEXT_WIDTH` `"auto"` is why `measuredWidth` is the
normal path.** D-124's pointing path reaches `createText` with `content` `""` and these same eight
defaults.

**0e. THE MEASURER IS BUILT, WIRED, AND REVIEWED (0133).** `main.ts:start` builds `evalContext` from
`createCanvas2dTextMeasurer` over a SECOND offscreen 2D context and threads it through
`executeCommand` / `pointerMove` / `loadDocument` and the pure transitions via an optional trailing
`context` param (default `NULL_EVAL_CONTEXT`).

**0f. `render/measure.ts` — line-breaking lives HERE (D-120), never in `src/engine/`.**

**0g. `content` IS `literal`-ONLY (D-122).** The guard is `isTextContentTarget` in
`command/commands.ts`'s `buildSlot`. A loaded `formula` `content` slot commits with its inner
references untracked — the disclosed loaded-file gap.

**0h. ADDING A DERIVED SLOT BREAKS PREVIOUSLY SAVED DOCUMENTS, TODAY (D-126).** Ruled (loader
reconstructs derived slots from the schema); NOT BUILT — the load-hardening cycle owns it. Any cycle
adding a derived slot states the load consequence. Entries 0149 + 0152 added none.

**0i. D-125's IN-PLACE EDITOR — DOM half in `main.ts`'s `start`, pure half above it.**
`render/editor.ts` is pure geometry. `main.ts`'s pure half: `commitTextContent` (ALWAYS a literal
`set`), `commitTableCell` (Excel-style), `editorSeed`, and **`abandonCreatedTextBox` (D-136 clause 2
— new, entry 0152)**. All commits/deletes run through `runPanelCommand` → `executeCommand` — NO
second write path (Rule 2). DOM half in `start`: it opens on a double-click OR, since D-124 (entry
0149) **and narrowed by D-136 (entry 0152)**, on a newly-created `text` object **whose command
carried no content** (`advance` → `AppTransition.openEditor` → `applyTransition` sets `inPlaceEditor`
and `inPlaceEditorFromCreation`). blur/click-outside commits, Escape cancels, Enter commits in a
cell; a PAN press does NOT commit and does NOT take focus off it (D-130/D-133). An editor opened
on-create that ends empty (Escape, or empty blur) deletes the box via `abandonCreatedTextBox`
(D-136 clause 2). Mounted in `#stage`. The overlay's type style comes from the receiver's own slots
scaled by `camera.zoom / ratio`, and it does not clip (D-132); scrollbars take no layout (D-135).
**Every DOM-half change is untested by construction and the editor surface is owed a live re-test
(items 2/3/5/6).**

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s `describe` "PHASE 4'S ACCEPTANCE CRITERION" (7 tests).**
Do not weaken; do not fold.

**2. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112).** Neither may be "fixed" to match
the other.

**3. THE PANEL IS FULLY BUILT AND FULLY REVIEWED — DO NOT RE-BUILD ANY OF IT.** D-094/D-100/D-101/
D-106/D-102/D-107. **Q-014 is CLOSED in code.** D-125's in-place editor ADDS a surface, replaces none
of the panel (D-125 clause 8).

**4. A panel-typed STRING reaches a FORMULA slot, never a literal one** (D-102 clause 6). **Q-016**
carries the grammar question. **D-125's `commitTextContent` is the opposite rule on purpose** — a
`text` box's whole string is one literal, never a formula.

**5. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** Entry
0152's additions to it: `inPlaceEditorFromCreation` flag, one conjunct in `applyTransition`, an
abandon branch in `cancelInPlace` / `commitInPlace`. The DECISION (`abandonCreatedTextBox`) is in
the exported pure half and is tested.

**6. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101) — D-097/D-098/D-099 are CLOSED.**

**7. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` not
bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable. Fix in `findInvalidTableResizes`.

**8. D-108 NOW HAS AN OWNER (D-127).** All four of D-108 clause 1's AST shapes throw a `TypeError` out
of `loadDocument`, surfacing as an unhandled promise rejection from `openDocument`. **The
load-hardening cycle owns the fix — the NEXT cycle after the human's on-screen re-test.**

**9. D-081 AND D-083 CLAUSE 4 ARE BUILT (0112) AND REVIEWED (0113).**

**10. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, NEVER CACHED (D-114
clause 4).** A broken span becomes an `error`-kind `Block` (D-115); its parsed branches live in
`orphaned`.

**11. THE PAPERCLIP CANNOT REACH A TABLE CELL — but D-125's in-place editor can (entry 0143).**
Double-click a cell. §5.4's formula bar stays unbuilt and is NOT part of D-125.

**12. `evaluateDerivedSlot`'s `read` RUNS THE D-110 COERCION BEFORE THE D-013 MEMBERSHIP CHECK
(D-114 clause 3).** Do not swap them.

**13. `resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR with no
compiler link (D-119).** Change one → change both, same cycle, log names both.

**14. A broken embedded span is marked `!` in place (D-116 parse / D-117 runtime), never blanks the
box; `evaluateBlockTree` always returns a `string`.**

**15. `EvalContext` IS THREADED PER CALL, NOT STORED (0132, reviewed 0133).** Public entry points
default it to `NULL_EVAL_CONTEXT`; internal handlers take it REQUIRED.

**16. `TEXT_TYPE` (`graph/node.ts`) joins `TABLE_TYPE`.** Import it, never a bare `"text"` literal in
an equality check (D-009) — EXCEPT `advance`'s `session.command.kind === "text"` check, which
compares a `Command`'s discriminant, not an `ObjectType` (and now also reads
`session.command.content` on the same narrowed branch — D-136).

## Next slice (recommended)

**Blocked on the human's on-screen re-test of items 2, 3, 5, 6.** 0152 is `REVIEW: REQUIRED` first;
once it clears and the human confirms the editor surface is clean on screen:

**THE LOAD-HARDENING CYCLE — one `document.ts` diff** discharging D-126 (loader reconstructs
declared derived slots), D-127/D-108 (one `FormulaAst` shape validation at the load boundary +
`openDocument`'s promise chain given a rejection path), and D-108 clause 1's owed doc corrections +
`document.test.ts` extension. `document.ts` is §6.2 load-bearing — **`REVIEW: REQUIRED`.** No
load-bearing overlap with 0152 (it touched `main.ts` / `index.html`, not `document.ts`).

Then, in order: **markdown-lite rendering** (§5.6's exact list, in `renderer.ts`'s `drawText`, and
`render/measure.ts` made markup-aware in the SAME cycle so drawn and measured agree). Then
`overflow: "clip"`/`"ellipsis"` (small — read **D-123 clause 5** first). Then the **Phase 5 gate**:
an executable test over one document proving the §6 criterion, `REVIEW: REQUIRED` (§6.1 trigger 1).

Cheap adds while in there: a direct `link text_1.origin.y <cell>` test (0137-REVIEW §honesty).

**The render-only alternative, still needs no ruling:** **D-109 clauses 1–2** (cell decimal precision
+ no cell-text clipping, `render/renderer.ts` only). **Q-017** headers remain the human's.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · table primitive through row/column insert/delete and
`delete <table> force` (0054) · `render/camera.ts` (0058) · `primitives/geometry.ts` (0060) ·
`render/renderer.ts`'s body/table drawing (0062, widened by 0093/0094/0107) · `render/hittest.ts`
(0064) · `render/interaction.ts` (0067) · `command/parser.ts` (0069) · `command/prompt.ts` (0071) ·
`command/commands.ts`'s seam + four creation handlers (0078) · four slot commands +
`engine/formula/format.ts` (0080) · `commands.ts`'s `delete`/`refs`/`list` (0082) · `mutation.ts`'s
`RenameObjectOperation` + `commands.ts`'s `rename` (0084) · `CommandEffect` + five effect handlers
(0086) · two formula depth limits (0088) · `main.ts` rewritten, `render/camera.ts`'s clamps,
`render/extent.ts`, `index.html` (0089, reviewed 0090/0091, widened 0107/0109/0117) · entry 0093's
selection highlight / error badge / formula-driven indicator + D-092 clause 1's name label, 0094's
chrome-anchor fix (0095) · `render/slots.ts` + `render/extent.ts` split, `command/props.ts` + `props`
command (0098, D-096) · `render/panel.ts` + panel DOM (0100) · selection-list widening (0105, D-105)
· N panels, drag, dismiss, panel editing (0110-REVIEW) · F1–F4 + D-107, D-081 + D-083 clause 4
(0113-REVIEW) · Phase 4 gate test (0116-REVIEW) · D-109 clause 3 + D-110 in full (0119-REVIEW; D-112,
D-113) · `primitives/text.ts` block-tree engine (0121-REVIEW; D-114, D-115, Q-019) · D-116 + D-117 ·
`src/engine/eval-context.ts` + `context` threading (0125-REVIEW; D-118) · `!`-marked broken-span
rendering + `text` schema entry, `resolvedContent` (0128-REVIEW; D-119) · `measuredHeight` +
`#MEASURE` + `TextMeasurer.measure`'s `maxWidth` + `hasRealMeasurer` (0130-REVIEW; D-120) ·
`render/measure.ts` + a real `EvalContext` threaded from `main.ts` (0133-REVIEW; F22) · **0135-REVIEW**
D-121 + D-122 issued · **0137-REVIEW** entry 0136's `text` command; Q-022/Q-023 CLOSED · **0139-REVIEW**
entry 0138's text rendering; D-123 issued, Q-024 answered · **0142-REVIEW** entry 0141's
`measuredWidth`; Q-024 CLOSED; D-126 + D-127 issued · **0144-REVIEW** entry 0143's in-place editor
(D-125 — `render/editor.ts` + `main.ts` commit seam); D-128 issued · **0145-RULINGS** the human's
on-screen test; D-129 + D-130 + D-131 issued · **0148-REVIEW** entries 0146 + 0147's editor-polish
work; ACCEPT WITH EDITS; D-132 + D-133 issued · **0150-REVIEW** entry 0149's `text`-by-pointing
(D-124); ACCEPT; D-134 issued · **0151-RULINGS** the human's on-screen test of entry 0149; D-135 +
D-136 issued; no code.

## Built this batch, not yet reviewed

- **Entry 0152 — the editor cycle (D-135 + D-136).** `index.html` (D-135 scrollbar CSS),
  `src/main.ts` (D-136: `advance` conjunct, `abandonCreatedTextBox`, `runPanelCommand` widened,
  `start` flag + branches), `src/main.test.ts` (one test inverted, +4). `REVIEW: REQUIRED`.

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar · **the load-hardening cycle (D-126 + D-127 + D-108) — NEXT,
after the human's on-screen re-test** · D-088 clauses 2–4 · D-089 · D-102 clause 9 · **D-109 clauses
1–2** · markdown-lite text rendering + a markup-aware measurer · `text` `overflow` clip/ellipsis ·
the Phase 5 gate test · Phases 6–7. **D-124 (0149/0150), D-135 + D-136 (0152) are BUILT — not "not
started".**

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–13, 15–21, 23–24 unchanged and open unless noted.

1. **DONE at entry 0112**, reviewed 0113.
2. **Give the missing-slot refusal a remedy.** Message only; narrowed by D-110 to clause 6's cases.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE.**
4. **`zoom`'s refusal names `Infinity`.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged.**
6. **A middle-drag pan started outside the canvas is untested.** Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** (D-091). Owned by the `style`-slots cycle.
8. **The screen-space chrome constants + `PANEL_OBJECT_GAP_CSS` are untuned** (Rule 5). `editor.ts`'s
   `EMPTY_TEXT_EDITOR_*` and its five type-style constants join this list.
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return.** Harmless.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED.**
11. **A display-only panel's `overflow: auto` scroll resets on every paint.**
12. **A right-flipped panel that hits the right clamp overlaps its own object.** Correct per D-094.
13. **`insertTableLine`/`deleteTableLine` are not bounded by `MIN`/`MAX_TABLE_LINES`** — **D-104**.
14. **0110-REVIEW's F1–F4 — BUILT (0111), REVIEWED (0113).** Closed. **Q-016** carries F3's tail.
15. **F5 — `deserializeDocument`'s "never throws" is FALSE for a malformed loaded `ast`.** Ruled
    **D-108**; re-owned by **D-127**. Clause 3 still forbids piecemeal hardening meanwhile.
16. **F6 — a panel row's text can no longer be mouse-selected.** D-095 governs.
17. **F7/F8 — ruled D-109. F8 BUILT (0117), REVIEWED (0119); F7 (clauses 1–2) NOT BUILT.**
18. **F9 — CLOSED in the same review.**
19. **F10 — CLOSED, ruled D-112.**
20. **F11 — open, no owner.** Shrinking a table's extent under a formula reading an empty in-extent
    cell is REFUSED. Correct per D-110 clause 6.
21. **F12 — open, DO NOT RE-LITIGATE.** `MIN(B1, B2)` vs `MIN(B1:B2)` on empty in-extent cells.
22. **F13 — RULED D-122, BUILT (0136), REVIEWED (0137). CLOSED.**
23. **F21 — CLOSED**, WIDENED at 0141 (non-finite guard now covers width too, D-123 clause 2).
24. **F22 — CLOSED in the same review.**
25. **F23 — RULED D-126, NOT BUILT.** Adding a derived slot invalidates every previously saved
    document carrying that object type. Owned by the load-hardening cycle (NEXT).
26. **F24 — RULED D-127, NOT BUILT.** The malformed-AST throw is operator-reachable. Same cycle as F23.
27. **F25 — RULED D-129, BUILT (0146), WIDENED + FIXED (0147), REVIEWED (0148) → D-132. CLOSED in
    code.** Still unseen on screen (DOM half).
28. **F26 — RULED D-130, MIS-BUILT (0146), FIXED (0147), REVIEWED (0148) → D-133. CLOSED in code.**
    Confirmed on screen 2026-09-02 (live-look item 4).
29. **F27 — RULED D-131, BUILT (0146), REVIEWED (0148). CLOSED.**
30. **F28 — RULED D-135 (0151-RULINGS), BUILT (0152). CLOSED in code — UNSEEN on screen.**
    `.text-editor` scrollbars now take no layout box. The human re-tests items 2 + 6.
31. **F29 — RULED D-136 (0151-RULINGS), BUILT (0152). CLOSED in code — UNSEEN on screen.** The editor
    opens on creation only when `content === ""`; an editor opened that way that ends empty deletes
    the box (`abandonCreatedTextBox`). The human re-tests items 3 + 5.

## Known problems (detail lives where the pointer says)

- **THE IN-PLACE EDITOR'S DOM HALF WAS SEEN ON SCREEN 2026-09-02** (human's test of entry 0149).
  Items 1 + 4 (open-at-click, pan-keeps-focus) confirmed good. Items 2/3/5/6 found four defects →
  D-135 + D-136, now BUILT (0152). **Re-test of items 2/3/5/6 owed before load-hardening.**
- **D-136's `start`-half wiring is untested by construction.** `abandonCreatedTextBox` (the
  decision) is tested; "does a real Escape call it with the right id" is not.
- **D-135 is CSS and cannot be unit-tested (D-001).** Only the presence of the two declarations is
  confirmed. Its layout effect is the human's on-screen re-test.
- **`runPanelCommand` / `describePanelCommand` now also accept `DeleteCommand`** (D-136's abandon
  path). The function name still says "panel"; it has been the shared "synthesised command through
  the seam with a log echo" helper since `commitTextContent` reused it (entry 0143). Renaming is
  out of scope until a cycle opens the file for a related reason.
- **A freshly-created `text` object opens its editor UNSELECTED** (entry 0149, Decision 4; D-136
  clause 4 leaves it untouched). Human's call on sight.
- **`text 30,40` (unquoted, comma) places a box at (30,40) with empty content** (entry 0149,
  Decision 3; accepted 0150-REVIEW). Consistent with `circle 30,40`.
- **the in-place editor overlay does not render markdown** — RAW SOURCE, which is also what
  `renderer.ts` draws today, so the two agree; the markdown-lite cycle will make them differ.
- **the cell editor does not reproduce `TABLE_CELL_TEXT_PADDING`'s 4-unit inset, and left-aligns a
  number cell** — deliberate. `editor.ts`'s NOT DONE HERE.
- **vertical alignment inside the overlay's line box is approximate** — ~4 CSS px low at zoom 5.
- **the overlay may still wrap a shade earlier than the canvas** (live-look item 6). D-135 removes
  the scrollbar's width theft (the leading cause); any residual is `measureText`-vs-DOM and must
  NOT be chased from the measurer's side (D-123 clause 5). Re-check on screen after 0152.
- **the properties panel and the in-place editor can overlap** only when a small window forces them
  into the same space. No remedy scheduled.
- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header.
- **A saved document does not survive a derived-slot addition** — **D-126**, fix-list 25.
- **A malformed loaded `ast` throws out of `loadDocument`, swallowed by `openDocument`** — **D-108 +
  D-127**, fix-list 26. NEXT cycle.
- **A loaded document can carry a `formula`/`derived` `content` slot on a `text` object** (D-122
  blocks the command path, not the loader).
- **BOTH measured slots are `#MEASURE` for a `text` object created in a test** (default
  `NULL_EVAL_CONTEXT`), so its extent falls back to 240×20 there. Through the running app `main.ts`
  threads a real measurer.
- **`measure.ts` and `renderer.ts` fall back DIFFERENTLY for an unusable `style.*` slot, and that
  also moves the BOX's width.** Disclosed in both headers; unfixed — one shared set of fallbacks
  needs a ruling on which file owns them. **D-123 clause 5 forbids fixing it from the renderer's
  side.** `render/editor.ts` is a THIRD reader of that set. **D-132 clause 3 makes the pair's
  maintenance binding.**
- **`extent.ts`'s `text` box trusts the stored measurement; `renderer.ts` re-wraps with its own
  `ctx`.** 0139-REVIEW ruled this stays (D-123 clause 5): the box follows the text, never the reverse.
- **An empty-`content` `text` object is invisible AND unselectable** — no ink, no extent, no hit box
  (D-066). **D-124 creates exactly this; D-136 clause 2 removes an abandoned one.** The editor's own
  overlay (`editorPlacement`'s fallback box) is what makes a live one real on screen (D-125 clause 6).
- **`x`/`y` are OPTIONAL for the `text` command (default `0`, per D-121 clause 3)** but REQUIRED for
  `circle`/`polygon`/`rect`/`table`. **D-124 makes the pointing path the normal one**; the typed
  `x`/`y` form is the fallback.
- **`DEFAULT_TEXT_*` style values are the handler's provisional pick** — no ruling, no `PROVISIONAL`
  tag (render config, `set`-changeable).
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **The chrome layout is UNSEEN beyond entry 0094's anchor fix.** **D-095** / D-101 clause 3.
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses 2–4
  not built. **No command history** (**D-089**, queued).
- **Every pointer move repaints the canvas and rewrites the whole log's `textContent`.** Rule 5. The
  in-place editor's `updateEditor` re-places the overlay every paint too.
- **`escape` is bound to the window.** Innermost-first order is STRUCTURAL. The in-place editor's own
  keydown `stopPropagation`s, so a focused editor's Escape never reaches the window handler (it
  reaches `cancelInPlace`, which since 0152 may `abandonCreatedTextBox` — D-136 clause 2).
- **`zoom`'s echoed line names the REQUEST; `main.ts` adds a second line with the RESULT** — D-082 c5.
- **`format.ts`'s elision does not re-parse** — a disclosed round-trip exception.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046) — unreachable
  by command (D-097), reachable via a loaded file.
- **SETTLED at 0118, REVIEWED 0119 — do not re-raise.** A bare reference to an EMPTY in-extent cell
  reads `0`, gets no edge (**D-110**).
- **`text.test.ts`'s `expectError` helper is unused** — kept deliberately.
- **`schema.test.ts`'s derived-slot assertion compares `derivedSlots[2]` to `[1]` by index** — fine
  today.
- **`render/measure.ts` measures markdown markup verbatim AND `renderer.ts` draws it verbatim** —
  deliberately consistent for now. The markdown-lite cycle moves both.
- **Seven §5.10 commands have no registry entry** — `polyline`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. `text`
  is NOT among them (its prompt sequence landed at entry 0149).
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are `describeSlotValue`'s
  `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade (D-077 c3).
- **`renderer.ts`'s `formatCellValue`, `props.ts`'s `describeSlotValue`, and `mutation.ts`'s
  `describeDimensionSlotValue` are three separate `Value`-to-text formatters** — deliberate.
  `main.ts`'s `editorSeed` reuses `describeSlotValue` and `formatFormula` — no fourth formatter.
- **`primitives/text.ts` imports `primitives/table.ts`** and `import type`s `DerivedSlotComputeDeps`
  from `primitives/schema.ts`, plus `hasRealMeasurer` + `TextStyle` from `eval-context.ts`. It
  CANNOT import `mutation.ts` (D-119).
- **`render/editor.ts` imports `render/hittest.ts` + `render/extent.ts` + `render/camera.ts` +
  `render/slots.ts` + engine leaves.** No cycle — nothing imports `editor.ts` except `main.ts`.
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name · comment
  debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`) ·
  dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off ·
  `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-136**) binds without restatement here.

**D-114 / D-115 / D-116 / D-117 ARE BUILT IN FULL AND REVIEWED (0126/0127, cleared 0128).**

**D-118 — BUILT (0129), REVIEWED (0130), WIRED (0132), WIRING REVIEWED (0133).**

**D-119 — RULED, RECONCILED.** The `resolveTextDependencyAddresses` / `deriveEdges` Source 1 pair.

**D-120 — RULED, answers Q-021. BUILT + WIRED + REVIEWED (0133).** Its rationale's claim about the
slot KEY is WRONG — see D-126.

**D-121 / D-122 — RULED (0135-REVIEW), BUILT (0136), REVIEWED (0137).**

**D-123 — RULED (0139-REVIEW), BUILT (0141), REVIEWED AND ACCEPTED (0142).** Clause 5 binds every
render cycle: the box follows the text, the text NEVER follows the box.

**D-124 — RULED BY THE HUMAN (0140-RULINGS). BUILT (entry 0149), REVIEWED AND ACCEPTED (0150-REVIEW);
D-134 issued. Decision 2 later OVERRULED by D-136 (built 0152).** `text` is placed by pointing.

**D-134 — RULED (0150-REVIEW).** A creation command surfaces its new object's id on
`CommandOutcome`'s success arm (`createdObjectId`), NOT via a `CommandEffect`. Reversible.

**D-135 / D-136 — RULED (0151-RULINGS), BUILT (0152), AWAITING REVIEW.** D-135: `.text-editor`
scrollbars take no layout. D-136: editor opens on create only when `content === ""` (overrules
entry 0149's Decision 2); an editor opened that way that ends empty deletes the box
(`abandonCreatedTextBox`). **Unseen on screen — the human re-tests items 2/3/5/6.**

**D-125 — RULED BY THE HUMAN (0140-RULINGS), ABSOLUTE PRIORITY. BUILT (0143), REVIEWED + ACCEPTED
(0144); POLISHED (0146/0147), REVIEWED (0148); triggered on create by D-124 (0149), narrowed by
D-136 (0152).** Clause 3 is the trap (`content` literal ALWAYS; a cell is Excel-style). Clause 5's
contradiction is settled by D-128.

**D-128 — RULED (0144-REVIEW).** Escape cancels, blur/click-outside commits, Enter commits only in a
cell. Binds D-124's / D-136's open-editor-on-create wiring. Reversible.

**D-129 / D-130 / D-131 / D-132 / D-133 — RULED (0145-RULINGS / 0148-REVIEW), BUILT (0146/0147),
REVIEWED (0148).** The human's 2026-09-02 on-screen test confirmed D-130/D-133 (pan keeps focus) and
the zoom-scaled open-at-click. Item-6 wrap residual and the family match still want another
on-screen pass after 0152.

**D-126 — RULED (0142-REVIEW), NOT BUILT.** Loader reconstructs a schema's declared derived slots.
`formatVersion` NOT bumped. **Load-hardening cycle, AFTER the human's on-screen re-test.**

**D-127 — RULED (0142-REVIEW), NOT BUILT.** D-108's deferral condition fired at entry 0089. Owner is
the load-hardening cycle. **AFTER the on-screen re-test.**

**THE HUMAN'S DIRECT INSTRUCTION OUTRANKS `PROJECT_BRIEF.md` (0140).**

**Implemented AND reviewed, do not re-build:** D-097/D-098/D-099 · D-100 · D-101/D-106/D-102 · D-107 ·
D-081 + D-083 c4 · Phase 4's gate test · D-109 clause 3 · D-110 in full · D-114/D-115/D-116/D-117 ·
D-118 · D-120 · D-121 / D-122 + the `text` command · text rendering + the text bounding box · D-123 +
`measuredWidth` · **D-125 + D-128** (in-place text entry) · **D-129 + D-130 + D-131 + D-132 + D-133**
(editor-polish) · **D-124 + D-134** (`text` placed by pointing + open-editor-on-create; entry 0149,
reviewed 0150).

**BUILT, awaiting review:** **D-135 + D-136** (entry 0152 — the editor cycle).

**NOT implemented, each owned by a named future cycle:** **D-126** + **D-127** + **D-108** (one
load-hardening cycle — NEXT, after the on-screen re-test) · **D-104** (§5.10's row/column commands) ·
**D-109 clauses 1–2** (cell decimals + clipping, `render/` only).

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117** — BUILT and REVIEWED (0128).
**Q-021 → D-120** — BUILT + WIRED + REVIEWED (0133). **Q-022 → D-121**, **Q-023 → D-122** — CLOSED.
**Q-024 → D-123 — CLOSED.** **Q-012 has FIVE reconciliation sites** (`renderer.ts` ×3, `slots.ts` ×1,
`editor.ts` ×1). Next free: **Q-025**.

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
`content` inherits the same posture.

**D-094's fourteen clauses stand** · **D-096's four clauses stand** (0129's `TEXT_*_PATH` move is a
named divergence).

**From 0091-REVIEW:** **D-088** (clause 1 built, 2–4 queued) · **D-089** (queued) · **D-090** (queued) ·
**D-091**. **From 0090-REVIEW:** D-084–D-087 implemented. Still owed, unchanged: **D-074**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (×3), **`src/render/slots.ts`** (×1) and
**`src/render/editor.ts`** (×1): world units or screen pixels for stroke width / cell size / font?
Provisional (a) world units. Due with the `style`-slots cycle. Entry 0152 added no new site.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (×2, `-0`): open, deferred, blocking nothing.

**No other `PROVISIONAL` tags exist.** Q-016/Q-017 have none. Entry 0152 owes none.

## Gotchas for the next model

- **0152 IS `REVIEW: REQUIRED` AND BLOCKS THE LOAD-HARDENING CYCLE UNTIL THE HUMAN RE-TESTS ITEMS
  2/3/5/6 ON SCREEN.** D-135 is `index.html` CSS (untestable here); D-136's decision is
  `abandonCreatedTextBox` (tested), its `start`-half wiring is not.
- **`advance` OPENS THE IN-PLACE EDITOR ON `text` CREATION ONLY WHEN `session.command.content === ""`**
  (D-136 clause 1). `text "hi"` / `text x=0 y=0 "hi"` / `text hi` place the box and leave the command
  bar focused. `text` + click, and `text ""`, open it.
- **`inPlaceEditorFromCreation` is a `start`-local flag.** Set in `applyTransition`'s `openEditor`
  branch, cleared in `closeInPlaceEditor`, forced `false` in `dblclick`. `cancelInPlace` /
  `commitInPlace` capture it BEFORE `closeInPlaceEditor` resets it.
- **`abandonCreatedTextBox(state, objectId, context)` is the pure helper** — deletes an empty
  just-created `text` box through `executeCommand` (a `delete`), no-ops on non-empty content or a
  stale id. Escape on a from-creation editor always routes through it (the edit was discarded, so
  content is `""`); an empty blur does too.
- **`runPanelCommand` / `describePanelCommand` now accept `DeleteCommand`** — the abandon path only,
  always `force: false`. `delete` carries no `CommandEffect`, so the "no effect looked for"
  assumption still holds.
- **A RULING NAMES THE OUTCOME, NOT THE LINE (D-133 clause 4).**
- **THE IN-PLACE EDITOR OPENS ON A DOUBLE-CLICK** via `editorTargetAt` — `inPlaceEditorFromCreation`
  is `false` there, so a double-click-then-Escape never deletes anything.
- **`text`'s prompt sequence is ONE `point` step, NO content step** (D-124 clause 2). The typed
  forms route to `parseCommand` whole. `text 30,40` is the point shorthand.
- **`formatFormula` takes an optional third arg `relativeToObjectId` (D-131).** OPT-IN.
- **`editorTextStyle` is a SIBLING of `editorPlacement`, not a field on it.**
- **`readText` lives in `render/slots.ts`** (0147). Empty string counts as ABSENT.
- **A `<textarea>` soft-wraps unless you set `wrap="off"`.** An auto-width `text` object never wraps.
- **`.text-editor` may not set a font, a padding or a border** — `index.html`'s comment says so. It
  now also carries `scrollbar-width: none` + the `::-webkit-scrollbar` twin (D-135).
- **`commitTextContent` NEVER sniffs for `=`** — the whole string is one literal `set`.
- **The in-place editor is mounted in `#stage`**, not `#panels`.
- **`main.ts`'s `pointerDownAt` routes a canvas click to `respondToPrompt` when `state.pending` is
  set** — this is the path a `text` position pick takes; it does NOT select the new object.
- **`measuredHeight` and `measuredWidth` ARE ONE MEASUREMENT (D-123 clause 2).**
- **A hand-built `text` fixture pushed through `mutate` needs THREE derived placeholders.**
- **D-123 clause 5 — the box follows the text; the text never follows the box.**
- **A DERIVED-SLOT ADDITION BREAKS SAVED DOCUMENTS UNTIL D-126 IS BUILT.** Entries 0149 + 0152 added
  none.
- **DO NOT TRUST A RULING'S CLAIM ABOUT REACHABILITY — GREP FOR THE CALLER** (D-127's lesson).
- **`EvalContext` is threaded PER CALL, not on `AppState`.**
- **`#MEASURE` is a real `ErrorCode`** (`graph/node.ts`), sixth after `#SCRIPT`.
- **The operator cannot see what you can see.** Ask for a live look before treating the editor
  surface as done — the re-test of items 2/3/5/6 is the gate on the load-hardening cycle.
