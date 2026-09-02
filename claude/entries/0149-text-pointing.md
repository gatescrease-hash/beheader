# 0149 — text-pointing: D-124 (`text` placed by pointing, editor opens on creation)

Date: 2026-09-02   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0148-REVIEW-phase5   Last review: 0148-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~110 source + ~113 test lines / 7 files changed so far
(0148-REVIEW closed the editor-polish batch — this cycle opens a fresh one at 0/3, 0 files).

## Declared scope

Build **D-124**: `text` gains a one-step `point` prompt sequence in `parser.ts` (message "specify
text position", NO content step, `PromptStep.accepts` not widened — clause 4), so typing `text` then
clicking places the box with `content` `""`; and `main.ts` opens D-125's in-place editor on that new
box (D-125 clause 4 — placing and typing are one gesture). The new-object id travels out on a widened
`CommandOutcome` (`createdObjectId`, set by `createObjectFromCommand`) and then on a new
`AppTransition.openEditor` field that `applyTransition` acts on.

## Explicitly not in scope

- The load-hardening cycle (D-126 + D-127 + D-108) — next, after this.
- `polyline`/`image`/`script` prompt sequences (D-124 clause 5 generalises to them, but each waits on
  its own schema / `Operation` kind — `COMMANDS_SPECIFIED_BUT_NOT_BUILT` is unchanged).
- Any change to the in-place editor's overlay internals (F28, the family/wrap/zoom work from
  0146/0147). This cycle only opens the existing editor on a new trigger.
- Selecting the newly-created `text` object. D-124/D-125 do not ask for it; the box opens its editor
  unselected (see Decisions).

## What I did

### `src/command/parser.ts` — the `text` prompt sequence (D-124 clauses 1–4)

- `text`'s registry entry gains `prompts: [{ name: "position", message: "specify text position",
  accepts: "point" }]` and `buildFromPrompts` producing `{ kind: "text", x, y, content: "" }`.
  `accepts` stays `"point"` — an existing kind — so `prompt.ts`'s `ResponseRead` widening hazard
  stays dormant (clause 4; clause 2's "no content step" is what buys it).
- Rewrote the `text` entry's comment (it said "No `prompts`: a text step would need an `accepts`
  kind…") and widened `CreateTextCommand`'s doc to say pointing is now the normal path.
- `CreateTextCommand`'s shape is unchanged (`{ kind, x, y, content }`) — `buildFromPrompts` just
  fills `content` with `""`.

### `src/command/commands.ts` — `createdObjectId` on the outcome (the "reviewer's call" from D-124)

- `CommandOutcome`'s success arm gains `readonly createdObjectId?: string`. `createObjectFromCommand`
  — the one path all five creation handlers share — returns `minted.id` in it. Every non-creation
  command leaves it `undefined`.
- Chose this over a new `CommandEffect` kind: `CommandEffect`'s own doc says it is for commands that
  "change NO document state" and reach the camera/selection/file, none of which `command/` may
  touch. A creation changes document state and returns a document; naming what it made on the
  success arm is the smaller, more honest shape, and `performEffect`'s `never`-guarded switch stays
  about the five view/file effects.

### `src/main.ts` — the wiring (D-124, D-125 clause 4)

- `AppTransition` gains `readonly openEditor?: EditorTarget`, travelling out for the same reason
  `fileRequest` does: the editor's open/closed state lives in `start`'s closure (like the GREY
  paperclip — opening writes no document state), and the pure half cannot touch a DOM element.
- `advance`'s `complete` + `ok` branch: after the document commits and any effect runs, if
  `session.command.kind === "text"` and `outcome.createdObjectId !== undefined`, it returns
  `openEditor: { kind: "text", objectId: outcome.createdObjectId }`. Every form of the command
  reaches this branch — the pointed one via `pointerDownAt` → `respondToPrompt`, and both typed ones
  via `submitLine` → `beginCommand` — so all of them open the editor (STATUS: "on every
  newly-created `text` object").
- `applyTransition` in `start`: `if (next.openEditor !== undefined) { inPlaceEditor = next.openEditor; }`
  set BEFORE `apply(next.state)`, so the `paint` it triggers builds and focuses the overlay in the
  same frame — `updateEditor` finds the just-created object and, for empty `content`, uses D-125
  clause 6's fallback box (`render/editor.ts`'s `textEditorBox`).
- Header binding list, NOT DONE HERE bullets updated.

### `src/render/editor.ts`

- One NOT DONE HERE line updated (D-124's wiring is `main.ts`'s `advance`/`applyTransition` now).
  No code change.

### Tests

- `command/prompt.test.ts`: `text` added to `EQUIVALENT_FORMS` (`typedLine: 'text x=0 y=0 ""'`,
  `responses: [picked(0,0)]`), which satisfies the "an entry for every prompting command" coverage
  assertion and the "both forms produce the identical Command" check. New describe "text is placed
  by pointing" — bare `text` prompts, the pick yields `content: ""`, `text "…"` / `text x= y= "…"`
  still route to `parseCommand` whole, `text hello` still falls through as content, `text 30,40`
  now reads as the point shorthand.
- `command/commands.test.ts`: `createdObjectId` names the created object for every creation command
  and is `undefined` for `list`; the point-placed form creates an empty box at the picked point.
- `main.test.ts`: new describe — bare `text` enters the position prompt; the completing pick creates
  an empty `text_1` at the pick AND returns `openEditor` naming it (and `editorSeed` on it is `""`);
  the typed forms return `openEditor` too; a `circle`/`table` creation and a refused `text` return
  none.

## Decisions I made

1. **`createdObjectId` on `CommandOutcome`, not a `CommandEffect`.** Argued above and in
   `CommandOutcome`'s doc. Reversible — it is an optional field with one reader.

2. **Every form of `text` opens the editor, not only the pointed one.** STATUS says "D-124 opens
   this editor on every newly-created `text` object", and routing it in `advance` (where all forms
   converge) is one code path instead of threading "was this a pick" through. `text x=0 y=0 "hi"`
   typed at the bar therefore opens the editor seeded with "hi", text selected — Escape or a click
   away is a no-op. Coherent with D-125 clause 4; the reviewer may want it narrowed to the pointed
   form only (it would mean plumbing the response kind into `advance`).

3. **`text 30,40` (unquoted, comma) now reads as the point shorthand** — box at (30,40), empty
   content — exactly as `circle 30,40` does. Previously it created a box at the origin containing
   the literal string "30,40". A literal "30,40" is still reachable by quoting: `text "30,40"`.
   D-124 clause 3 names the two forms that must keep working (`text "hi"`, `text x= y= "hi"`) and
   both do; this third case is the pointing path winning, consistent with every other creation
   command. No test asserted the old behaviour.

4. **The new box opens its editor UNSELECTED.** The dblclick path selects first (its two
   `pointerdown`s), but the D-124 completion path is a prompt answer, not a selection press, so it
   does not select. D-124/D-125 do not mention selection and the editor does not need it
   (`updateEditor` works off `inPlaceEditor` + an id lookup). Reversible — `advance` could also
   return an interaction change. Flagging for the reviewer.

5. **`buildFromPrompts` reuses `parser.ts`'s existing `pointAnswer` helper**, like the other four
   `buildFromPrompts`. No new helper.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, exit 0)
$ npx tsc -p tsconfig.engine.json --noEmit
(clean, exit 0)
$ npx vitest run
 Test Files  31 passed (31)
      Tests  1549 passed (1549)
   (0 skipped, 0 todo)
$ grep -rnE "\.(only|skip|todo)\(" src
(no matches)
```

1535 (0148) → **1549** (+14: prompt.test +6, commands.test +3, main.test +5).

## Acceptance criteria status

Phase 5 criterion (a text box's number and branch update, wraps at its set width, re-renders on a
value referenced only in the non-taken branch) — NOT YET; unaffected by this cycle. D-124 is a
placement/authoring affordance, not a Phase 5 gate item. The gate is still owed its own executable
test over one document (§6.1 trigger 1), after markdown-lite and `overflow`.

## Where I got stuck / what is unfinished

- **The DOM half is still untested by construction and STILL has not been seen on screen** — and
  D-124 makes that worse, not better: the in-place editor now opens on *every* `text` creation, so
  every path into it (F28's scrollbar, the family/wrap match, the pan-keeps-focus behaviour) is
  exercised the first time anyone types `text` and clicks. The pure signal (`openEditor` on the
  transition, `createdObjectId` on the outcome) is tested hard; "does the overlay appear correctly
  on a brand-new empty box at the pick point" is not a question any test here answers. **The live
  look 0148-REVIEW called owed is now more urgent, not less.** Shortest path: `text`, click, type
  past the box width (F28); `text`, click, then middle-drag (does the fresh editor keep focus?).
- Decision 2 (typed forms open the editor too) and Decision 4 (opens unselected) are both judgement
  calls the reviewer or human may want to overturn; both are one-liners.

## Open questions raised

None. `PromptStep.accepts` was deliberately not widened (D-124 clause 4). Next free: Q-025.

## Review point

Fired: **§6.1 trigger 3** — the brief is silent on how a creation command surfaces its new object's
id, and D-124 explicitly left "a `CommandEffect`, or a widened `CommandOutcome`" to the reviewer;
plus a small deliberate behaviour change to `parser.ts` (`text 30,40`). `REVIEW: REQUIRED`.
Batch otherwise: cycle 1/3, ~223 lines / 7 files (cap 800/10).
