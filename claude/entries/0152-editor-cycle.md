# 0152 — editor cycle: D-135 (scrollbars take no layout) + D-136 (open-on-create only when empty; abandon removes the box)

Date: 2026-09-02   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0151-RULINGS-phase5   Last review: 0150-REVIEW-phase5 (verdict: ACCEPT)
Batch: cycle 1 of up to 3 since last review; ~137 lines / 3 files changed so far
(0151-RULINGS wrote no code; this cycle opens a fresh batch at 0/3, then 1/3 here).

## Declared scope

Discharge the two rulings from the human's on-screen test of entry 0149: **D-135** —
`.text-editor` gets `scrollbar-width: none` + the `::-webkit-scrollbar` twin, `overflow: auto`
kept (`index.html`); **D-136** — `advance`'s open-editor-on-create branch narrows to
`session.command.content === ""` (overrules entry 0149's Decision 2), and an editor opened by
that path that ends with the box still empty deletes the object through `executeCommand`
(`main.ts`, plus a pure helper and a `start`-local flag). Reproduce live-look item 5 and confirm
the blank-seed defect is gone.

## Explicitly not in scope

- Item 6's wrap residual beyond the scrollbar's width theft (0151-RULINGS "Carried forward" —
  do NOT bodge `render/measure.ts`; the human sees the residual first after D-135).
- The load-hardening cycle (D-126 + D-127 + D-108) — next, after the human re-tests on screen.
- Any change to the editor's overlay type-style / placement internals (D-129/D-132 territory).
- A visible scrollbar strip (D-135 clause 3 explicitly does not take the human's sketch).

## What I did

### `index.html` — D-135

- `.text-editor` gains `scrollbar-width: none` (Firefox/standards) and a
  `.text-editor::-webkit-scrollbar { display: none }` rule (WebKit/Blink). `overflow: auto`
  stays — the caret still scrolls into view (D-129 clause 2), the bar just never takes a layout
  box, so it cannot land on a one-line overlay's text (item 2) or steal width from a wrapping
  box and force the re-wrap cascade (item 6's leading cause). Updated the block comment.

### `src/main.ts` — D-136

- **`advance`'s open-editor-on-create branch** now also requires
  `session.command.content === ""`. That is exactly the pointing / prompt path
  (`buildFromPrompts` always yields `content: ""`) plus an explicit `text ""`. A content-bearing
  typed command (`text "hi"`, `text x=0 y=0 "hi"`, `text hi`) creates the box and returns a
  plain `transition` — command bar stays focused, same ending `circle`/`rect`/`table` have.
  The discriminant is the command's own `content` field; nothing about "was this a pick" is
  threaded through `advance` (D-136 clause 1's own note).
- **`abandonCreatedTextBox(state, objectId, context)`** — new exported pure helper, same shape
  as `commitTextContent`. Finds the object; if its `content` slot holds a non-empty string it is
  a no-op (a box that got text before the edit ended is KEPT); otherwise it runs a
  `{ kind: "delete", target: object.name, force: false }` through `runPanelCommand` →
  `executeCommand` (Rule 2, D-069 — no second write path), echoed `> delete text_1` /
  `deleted text_1` like any command. A stale id is a no-op (D-023's posture).
- **`runPanelCommand` / `describePanelCommand`** widened from
  `Set*/Unlink` to also accept `DeleteCommand` (imported from `parser.ts`). `describePanelCommand`
  gains a `case "delete"` returning `delete <target>` (only ever `force: false` here, so no
  ` force` suffix). Updated `runPanelCommand`'s doc to say the synthesised command is a
  panel/in-place write OR D-136's abandon `delete`, none of which carries a `CommandEffect`.
- **`start`** gains `let inPlaceEditorFromCreation = false`. Set `true` in `applyTransition`'s
  `openEditor` branch (alongside `inPlaceEditor = next.openEditor`); cleared in
  `closeInPlaceEditor` (the one choke point); explicitly set `false` in the `dblclick` handler
  (a double-click is never a creation). `commitInPlace` and `cancelInPlace` each capture the
  flag BEFORE `closeInPlaceEditor` resets it:
  - `cancelInPlace` (Escape): if the flag is set and the receiver is a `text`, call
    `abandonCreatedTextBox` (the edit was discarded, so `content` is still `""` — the helper
    confirms and deletes). Otherwise unchanged (`paint()`).
  - `commitInPlace` (blur / click-outside): if the flag is set, the receiver is a `text`, and
    `raw === ""`, call `abandonCreatedTextBox` instead of committing. Otherwise commit as before.
- Header updates: the top doc's D-124 line now cites D-136; the "opens the editor on … every
  newly-created `text` object" bullet is narrowed to "given no content"; `AppTransition.openEditor`'s
  doc says `advance` only sets it when the command carried no content.

### `src/main.test.ts`

- **Changed** the "typed forms also open the editor" test → "a content-bearing typed form does
  NOT open the editor (D-136 clause 1, overrules entry 0149 Decision 2)": `openEditor` is now
  `undefined` for `text x=5 y=6 "hi"`. This is the §6.1 trigger-5 test-expectation change the
  ruling requires.
- **Added** "an explicit `text \"\"` … DOES open the editor" — the `content === ""` discriminant
  covers the typed empty-string form too.
- **Added** describe "abandonCreatedTextBox …" (3 tests): deletes an empty just-created box and
  echoes `> delete text_1` / `deleted text_1`; keeps a box that received content (no-op, returns
  the same state reference); no-op for a stale id.

## Decisions I made

1. **Reuse `runPanelCommand` for the abandon `delete` rather than a new echo path.**
   `commitTextContent` already routes the in-place editor through it; D-136 clause 2 says
   "through `executeCommand` as a `delete` … echoed in the log like any other". Widening its
   type union by one member and adding one `switch` arm is a smaller, more consistent diff than
   a parallel helper. Its name is pre-existing ("panel"); renaming is out of scope (§4).
2. **`commitInPlace`'s abandon test is `raw === ""`, strict — not `raw.trim() === ""`.** D-136
   clause 1's discriminant is `content === ""` exactly; a whitespace-only field is a deliberate
   keystroke nobody reported. `abandonCreatedTextBox`'s own guard is likewise `content !== ""`.
3. **`cancelInPlace` (Escape) always routes a from-creation `text` through
   `abandonCreatedTextBox`, whatever is in the field.** D-136 clause 2's parenthetical:
   "Escape (the edit is discarded, so `content` is still `""`)". The helper's content check does
   the actual work — on Escape it always finds `""`, because nothing was committed.
4. **`abandonCreatedTextBox` keeps a defensive non-empty-content no-op even though the two
   callers already gate on emptiness.** It makes the helper self-contained and independently
   testable ("keeps a box that received text"), which is the shape 0151-RULINGS asked for.

## Live-look item 5 — reproduced, confirmed gone

`text x=0 y=0 "hello"` typed whole: with D-136 clause 1 the editor no longer opens on this path
at all (`content !== ""`), so there is no overlay to seed blank and no zombie on Escape. The new
test "a content-bearing typed form does NOT open the editor" pins `openEditor === undefined` for
it. The blank-seed bug was specific to the on-creation-with-content path this clause removes; the
double-click path seeds via `editorSeed`, which returns a `text` object's raw content verbatim
(existing test "a `text` object's raw content, verbatim", `editorSeed` describe) and was recorded
clean at 0148-REVIEW. No blank seed survives.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, exit 0)
$ npx tsc -p tsconfig.engine.json --noEmit
(clean, exit 0)
$ npx vitest run
 Test Files  31 passed (31)
      Tests  1553 passed (1553)
   (0 skipped, 0 todo)
$ grep -rnE "\.(only|skip|todo)\(" src
(no matches)
```

1549 (0149) → **1553** (+4: one test changed in place; +1 `text ""`, +3 `abandonCreatedTextBox`).

## Acceptance criteria status

Phase 5 criterion — NOT YET; untouched by this cycle. D-135/D-136 are editor-surface fixes, not
a gate item. The gate is still owed its own executable test over one document, after
markdown-lite and `overflow`.

## Where I got stuck / what is unfinished

- **D-135 is CSS and cannot be unit-tested here** (no DOM — D-001). Its effect is a browser
  layout behaviour; the human re-tests items 2 and 6 on screen. I have only confirmed the two
  declarations are present and syntactically correct and that the rest of `.text-editor` is
  unchanged.
- **The `start`-half wiring (the flag, the two branch additions) is untested by construction.**
  `abandonCreatedTextBox` — the decision — is tested hard; "does `cancelInPlace` actually call it
  with the right id on a real Escape" is not a question any test here answers. The human re-tests
  items 3 and 5 on screen.
- **`text ""` reaching `advance` with `content: ""`** works (new test passes), but I did not
  trace exactly which `beginCommand` branch an empty quoted token takes — the observable
  behaviour is right and that is what the test pins.

## Open questions raised

None. Next free: Q-025.

## Review point

Fired: **§6.1 trigger 3** (two fresh binding rulings, D-136 overruling entry 0149's Decision 2
which 0150-REVIEW accepted-as-built) and **§6.1 trigger 5** (a changed test expectation — the
"typed forms open the editor" assertion is inverted). `REVIEW: REQUIRED`.
Batch otherwise: cycle 1/3, ~137 lines / 3 files (cap 800/10).
