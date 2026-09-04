# 0173 — §5.7's `image`: load via file picker, draw, hit-test
Date: 2026-09-04   Phase: 6   Model: implementer (Opus 5)
Previous entry: 0172-REVIEW-phase6-gate   Last review: 0172-REVIEW-phase6-gate (verdict: REVISE)
Batch: cycle 1 of up to 3 since last review; ~1050 lines / 11 files changed so far.

## Declared scope

Build §5.7's unbuilt half — the one thing **D-142** says Phase 6's gate is waiting on: an `image`
object draws, is bounded, is clickable, and gets its picture from a file picker. The renderer arm,
the extent arm and the hit-test arm ship together (D-066), the decoded-bitmap cache lives in
`render/` and never in `engine/` (Rule 1), and the picker follows `load`'s own
pure-half-describes / DOM-half-performs shape.

## Explicitly not in scope

§5.8's `script` rendering (D-142 clause 3 keeps it out of this gate, and it needs an
`addport`/`removeport` mechanism §5.10 names no grammar for). `command/props.ts`'s D-077 walk not
summarising `script`'s `in.*`/`placeholder.*`. Resize grabbers for an `image` (`handles.ts`'s
`hasResizeHandles` stays `text`-only). Re-picking a picture for an image that already exists — see
"Where I got stuck". The Phase 6 gate itself: **this entry does not claim it**, because D-142
clause 2 settles "renders properly" by the human seeing it and they have not yet.

## What I did

**NEW `src/render/images.ts`** (§5.7, Rule 1) — the decoded-bitmap cache.
`createImageBitmapCache(onDecoded, createElement?)` returns an `ImageBitmaps` whose one method,
`bitmapFor(source)`, answers "is there a decoded picture for this data URL yet?" and starts the
decode the first time it is asked. One decode per distinct source for the life of the cache; a
failed decode is remembered and never retried; a decode reporting a zero or non-finite natural size
is treated as a failure rather than handed on. `onDecoded` is `main.ts`'s `paint`, and is called
only from a decode callback — never from `bitmapFor`, so a paint cannot re-enter itself. This file
holds a `Map` of live `HTMLImageElement`s, which is exactly what Rule 1 and PROCESS_BRIEF §5.5
forbid `engine/` to hold; the document keeps the URL string and nothing else. `createElement`
defaults to `() => new Image()` and exists so the file is testable with no DOM (D-001).

**`src/render/extent.ts`** — `imageExtent`: `origin` + `width` x `height`, `undefined` for a
non-positive or non-finite box. It does **not** read `source`: an image's box is its size slots
whether or not a picture has been chosen or decoded, because the renderer strokes that box as a
frame either way, so drawn extent and clickable extent stay one extent (D-066) at every moment of
the object's life — including the seconds between choosing a file and the decode landing.

**`src/render/hittest.ts`** — `image` joins `text` on the existing `hitTestBoundingBox` arm
(§5.9's "bounding box for text/tables/images/scripts"), reading `extent.ts`'s extent, not a second
box. Header's NOT DONE HERE updated: it said `image` was deliberately unhittable (D-137).

**`src/render/renderer.ts`** — `drawImage`. Strokes the object's box (taken from
`objectExtent`, so the drawn box and the click box cannot disagree — structural, not a convention),
then, once `images.bitmapFor` has a picture, draws it fitted inside that box preserving its aspect
ratio and centred. `opacity` is clamped at paint time (D-140 clause 3) and `ctx.globalAlpha` is
restored afterwards; the frame is drawn at full opacity, so `set image_1.opacity 0` hides the
picture without losing the object. `renderDocument` takes an optional 9th argument, the
`ImageBitmaps` — injected rather than held, for the same Rule 1 reason. `image` also joins `text`
on the extent-based selection-highlight arm, and gets a name label for free (`chromeAnchorPoint`
reads the extent).

**`src/command/props.ts`** — `describeSlotValue` gains `options.fullStrings`. A string longer than
80 characters now ELIDES to its first 40 plus its true length, unless the caller asks for it whole.
This is D-099's shape inverted deliberately: a data URL is hundreds of thousands of characters and
every DISPLAY reader of that function (`props`'s log lines, `set`'s echo, a panel row) would
otherwise print all of it. `main.ts`'s `editSeed` is the one opt-in caller, because that string
must stay retypeable (D-107/F3).

**`src/main.ts`** —
- `AppTransition.pickImageFor?: string`, and `advance` sets it after a successful `image` creation.
  This is **D-124's shape one type over**: a creation hands straight to the gesture that gives the
  new object its content — there, the in-place editor; here, the file picker. Unconditional, unlike
  `text`'s, because §5.10's `image x= y=` form carries no picture argument.
- `commitImageSource(state, objectId, dataUrl, context)` — a literal `set` through
  `executeCommand` (Rule 2, D-069), no-op for a stale id or an empty URL.
- `runPanelCommand` gains an optional `echo` argument, overriding the echoed TEXT only.
  `commitImageSource` is its one caller: D-102 clause 7's "echo the synthesised command itself" is
  unmeetable for a data URL, so the log gets `set image_1.source <picture, N characters>`.
- `start`: builds the one cache instance, hands it to `renderDocument`, hands `paint` back to it as
  the decode callback, and performs the picker in `applyTransition`.
- `choosePicture` (DOM half, untested by construction like `openDocument` beside it):
  `accept="image/*"`, `FileReader.readAsDataURL`, every failure path reporting through `onRefused`
  rather than falling silent (D-127 clause 5). A dismissed picker calls nothing.

**Tests** — `src/render/images.test.ts` (new, 11); `renderer.test.ts` +13 (the fake `ctx` gains
`drawImage`/`globalAlpha`); `hittest.test.ts` +6 (including `documentExtent` over an image);
`props.test.ts` +4; `main.test.ts` +8. **No existing test's expectations were changed** — the
1844 that passed before this cycle still pass unmodified.

## Decisions I made

1. **A created `image` draws a FRAME, always, picture or not — and that is what lets `imageExtent`
   ignore `source`.** The alternative readings both break something: an extent that appears only
   once a bitmap decodes cannot be computed by `extent.ts` at all (it is pure and has no cache, and
   threading one through `objectExtent` would touch eight call sites), and an extent with no drawing
   is what D-066 forbids. Drawing the box is also what makes a dismissed picker survivable: the
   operator gets a visible, selectable, deletable empty frame instead of the invisible object D-142
   refused. One constant and one `strokeRect` to remove if the human dislikes the border.
2. **Aspect ratio is honoured at DRAW time, not by writing the natural size into slots** — the box
   bounds the picture and never distorts it. This is **Q-027**, raised rather than settled, exactly
   as 0172-REVIEW §8 item 2 asked; it is reversible (one function, no state) and tagged
   `PROVISIONAL(Q-027)` at `fitBitmapIntoBox`. My reasoning is in the question: under the other
   reading, the first `set image_1.width` destroys the ratio the brief asks to preserve.
3. **The picker opens on CREATION rather than through a new command word.** §5.10 names no
   `pick`/`loadimage` grammar and inventing one is §8's last-bullet gold-plating; D-124 already
   established the "a creation hands straight to its content gesture" shape for `text`. The cost is
   in "Where I got stuck".
4. **`pickImageFor` is its own field on `AppTransition`, not a widened `FileRequest`.** It names an
   OBJECT and `save`/`load` name none; `openEditor` is the existing precedent for exactly this. It
   also keeps five existing `main.test.ts` assertions (`fileRequest === "save"`) untouched, which
   PROCESS_BRIEF §13's "smaller diff" and §4's "never refactor what you did not write" both prefer.
5. **The display elision defaults ON, with an opt-out**, rather than defaulting off with an opt-in
   at five display call sites. The failure mode of a caller forgetting to opt IN is a megabyte in
   the log; the failure mode of forgetting to opt OUT is a visibly truncated edit seed, which is
   loud. `editSeed` is the one caller that needs the string whole, and it says so.

## Verification (real output)

```
$ npx tsc --noEmit
tsc(app) exit=0
$ npx tsc --noEmit -p tsconfig.engine.json
tsc(engine) exit=0
$ npx vitest run
 Test Files  36 passed (36)
      Tests  1887 passed (1887)
$ npx vite build
✓ 42 modules transformed.
dist/assets/index-DUytghHL.js  131.03 kB │ gzip: 38.70 kB
✓ built in 343ms
$ grep -rE "\.(only|skip|todo)\(" src
(no matches)
$ grep -rn "document\.\|window\.\|canvas\|HTMLImageElement" src/engine
(only `document.<field>` reads on the engine's own `Document` parameter — unchanged)
```

**D-016 mutation checks** — two, each reverted before the next, tree confirmed clean afterwards
(`git status --porcelain` shows only this cycle's own files, `npx tsc --noEmit` clean, 1887 pass):

| # | Neutralised | Result |
|---|---|---|
| 1 | `fitBitmapIntoBox`'s `Math.min` → `Math.max` (fit-inside becomes fill-and-crop) | RED: the two aspect-ratio tests and the operator-set-box test, 3 failures |
| 2 | `drawImage`'s `ctx.strokeRect(...)` of the frame removed | RED: 4 failures — the no-picture-yet test, both no-bitmap tests, and the selection-highlight test |

Check 2 is the one worth having: the frame is what makes decision 1 above true, and without it an
image with no picture is invisible again — the exact state D-142 refused, merely moved later.

## Acceptance criteria status

Phase 6 criterion: *"`script_1.in.factor` is bound to a cell, `polygon_1.radius` is bound to
`script_1.out.result`, and changing the placeholder output value moves the polygon — with no
script-specific code in `eval.ts`"* — **PASSING**, unchanged by this cycle and not re-derived here:
0172-REVIEW §2 and §6 proved it with two independent mutation checks and said in terms that the
re-claim entry may cite them rather than re-run them. The criterion test
(`commands.test.ts`'s "Phase 6's acceptance criterion, its exact shape…") still passes; nothing in
this diff touches `engine/`.

**The GATE is NOT claimed by this entry.** D-142 clause 2: "renders properly" is settled by the
human seeing it on screen, not by a test asserting a `drawImage` call happened. The engine-side
consequences are tested (PROCESS_BRIEF §12 clause 1's "test the engine-side consequence and
describe the manual check separately"); **the manual check is: `npm run dev`, type
`image x=0 y=0`, choose a picture, and confirm it appears, in proportion, inside its frame — then
drag it, and select it.** Until that happens the gate stays open.

## Where I got stuck / what is unfinished

- **There is no way to REPLACE the picture in an existing `image` object except by typing
  `set image_1.source "data:…"` by hand, which is not a thing a person can do.** The picker fires
  on creation only. I judged a new command word to be §8's gold-plating and a "re-pick" affordance
  on the properties panel to be D-102 clause 9's explicitly-deferred territory, so I built neither
  — but this is a real hole, not a tidy scope line, and the operator will find it the first time
  they choose the wrong file. The cheapest honest fix is probably the panel's `source` row
  offering the picker instead of a text input; that needs a ruling I did not have.
- **The properties panel builds the full data URL as a string on every paint**, for the `editSeed`
  of the `source` row, whenever an image is selected. Rule 5 says performance is a non-goal and I
  did not optimise it, but this one is a real allocation on every pointer move and I want it
  named rather than discovered.
- **I could not test `choosePicture` or the cache-to-paint wiring**, both being DOM (D-001). The
  cache's own logic IS tested through an injected fake element; what is untested is that `start`
  hands `paint` in as the callback and the `ImageBitmaps` to `renderDocument` — two lines, verified
  by reading, and about to be verified on screen.
- **I did not check what a very large picture does to `mutate`'s per-drag deep clone.** Dragging an
  image fires a mutation per pointer move, each cloning a document containing a multi-megabyte
  string. Strings are immutable and `cloneObjects` should share them by reference, but I did not
  measure it, and if dragging an image is visibly laggy this is the first place to look.
- The frame colour, `DISPLAY_STRING_MAX_LENGTH`/`_HEAD_LENGTH` (80/40) and the elision's wording
  are all untuned picks (Rule 5), like every other constant in these files.

## Open questions raised

**Q-027** — does §5.7's "preserve aspect ratio by default" describe how a picture is DRAWN, or the
size its `width`/`height` slots are first given? Provisional choice: **(a) drawing**, reversible in
one function. Tagged at: `src/render/renderer.ts` (`fitBitmapIntoBox`).

## Review point

**Fired: §6.1 trigger 3** (a brief clause the brief does not settle — §5.7's aspect-ratio sentence,
raised as Q-027 rather than guessed) **and §6.3's cap** (~1050 lines / 11 files in one cycle,
over 800/10). **D-142 additionally makes the human's on-screen look a precondition of the gate**,
which this entry does not claim.

Not fired, and worth stating because it is close: **trigger 2** (first file of a new subsystem).
`render/images.ts` is a new FILE in an already-reviewed subsystem (`render/`), not a new subsystem
— the same reading that let `render/markdown.ts` (0159) and `render/textbox.ts` land without one.
It is the first file in this project to hold live DOM objects outside `main.ts`, which is why I
name the call rather than leave it implied.
