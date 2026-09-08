# 0176 — REVIEW (Phase 6): entries 0173, 0174, 0175 — the `image` batch
Date: 2026-09-07   Phase: 6   Model: reviewer (Opus 5)
Reviews: the whole diff since 0172-REVIEW — entries **0173** (load, draw, hit-test), **0174**
(Q-027's ruling: the box takes the picture's shape, plus the `preserveAspect` toggle) and **0175**
(grabbers, panel re-pick). 21 source/test files, ~2500 lines.
Previous review: 0172-REVIEW-phase6-gate (REVISE)
Verdict: **ACCEPT WITH EDITS.** D-142's fix list is built, in full and honestly. One real defect
found and fixed (§4), two stale doc statements fixed, one dead parameter removed. The human gave a
further instruction at this review, built here and ruled as **D-144** (§5). **The Phase 6 gate stays
OPEN** — not for anything wrong in this batch, but because D-142 clause 2 makes the human's own look
the precondition and the current state has never been on screen.

## 1. What I ran, before reading anything as true

```
$ git status --porcelain
(empty, at 152a891)
$ npx tsc --noEmit                              -> exit 0
$ npx tsc --noEmit -p tsconfig.engine.json      -> exit 0
$ npx vitest run
 Test Files  36 passed (36)
      Tests  1920 passed (1920)
$ npx vite build
dist/assets/index-TwiroDzR.js  133.59 kB | gzip: 39.58 kB   ✓ built in 425ms
$ grep -rE "\.(only|skip|todo)\(" src           -> no matches
$ grep -rn "PROVISIONAL(" src                   -> Q-008 x2, Q-012 x5. Q-027's tag is GONE.
$ git diff 010c067 HEAD --stat                  -> 27 files, +2717 -229
```

Every number entries 0173/0174/0175 report is real, down to the build's own asset hash
(`index-TwiroDzR.js`, 133.59 kB) — which entry 0175 pasted and which reproduced exactly. Three
cycles, three honest logs. **The honesty audit is a match with one exception, and it is a
substantive one — §4.**

## 2. The D-016 mutation checks, mine rather than the entries'

Two, each chosen to be different from the checks the entries ran, each reverted before the next.

| # | Neutralised | Result |
|---|---|---|
| 1 | `hasResizeHandles` back to `text`-only (`handles.ts:90`) | RED: **8 failures** across `handles.test.ts` and `interaction.test.ts` |
| 2 | `isPictureSourceRow`'s `descriptor.kind === "literal"` screen dropped (`main.ts`) | RED: 1 failure — the formula-driven `source` keeps its paperclip test |

Both bite. The batch's own claims are backed by tests that fail when the claim is falsified, which
is what D-016 asks for.

**A process note against myself:** after check 1 I reverted with `git checkout src/main.ts` while
that file held this review's own uncommitted edits, and lost them. They were redone from scratch and
the tree re-verified green; no content was silently dropped. The correct move in a dirty tree is a
file copy, not a checkout, and later checks in this review used one.

## 3. Rule audit

- **Rule 1 (no DOM in `engine/`)** — **UPHELD, and this batch is the first real test of it.**
  `grep -rn "document\.\|window\.\|canvas\|HTMLImage" src/engine` returns only `document.<field>`
  reads on the engine's own `Document` parameter. The decoded-bitmap cache — a `Map` of live
  `HTMLImageElement`s, exactly what Rule 1 and §5.5 forbid the engine to hold — is
  `src/render/images.ts`, which imports **nothing at all**, and reaches the renderer as an injected
  argument rather than a held field. `main.ts` owns the one instance. This is precisely the shape
  0172-REVIEW §4 asked for, and it was got right first time.
- **Rule 2 (mutation-only state change)** — **UPHELD.** Every write in the batch is a `Command`
  through `executeCommand`: `commitImagePicture`'s several `set`s, the panel's re-pick, the resize
  drag's `planResize` operations. Nothing hand-builds a `Document`. The one place this needed
  sharpening was the per-component rule, not the seam — §4.
- **Rule 6 (fixed slot set)** — UPHELD. `IMAGE_SCHEMA` stays one `static` group; the slot set is
  fixed per type, and `preserveAspect` widened the type rather than making a family.
- **Rules 3, 4, 5, 7** — not touched. No addressing change, no second text evaluator, nothing
  optimised (`images.ts` explicitly declines eviction under Rule 5, and says so).
- **D-066 (drawn extent = clickable extent)** — UPHELD and structurally so: `drawImage`,
  `drawSelectionHighlight` and `hitTestBoundingBox` all read `extent.ts`'s `objectExtent`, and the
  frame is what makes `imageExtent`'s "the box is the extent regardless of `source`" honest. Entry
  0173's decision 1 is the right call and is the load-bearing one in the batch.

## 4. The finding — §5.9's per-component posture was documented but not implemented

`commitImagePicture`'s loop carried this comment:

> *"A refusal reports itself and the rest still run: `source` is the write that matters, and a
> `width` refused because it is formula-driven (§5.9's per-component posture) must not cost the
> operator the picture."*

and entry 0174's "Decisions I made" #3 says the same in prose. **`executeCommand` does not refuse
such a write.** I probed it directly rather than reasoning about it:

```
BEFORE {"kind":"formula","ast":{...table_1.A1...},"value":100}
$ set image_1.width 55
LINES ["> set image_1.width 55","image_1.width = 55","replaced formula: = table_1.A1"]
AFTER  {"kind":"literal","value":55}
```

A plain `set` REPLACES a formula with a literal — correct for a line the operator typed, and wrong
for a gesture performed on something else. So choosing a picture for an image whose `width` is
linked to a cell **silently unlinked it** — and because `commitImagePicture` discards
`outcome.lines` on success, even the `"replaced formula"` notice was dropped. The operator lost a
binding with no message at all.

`render/interaction.ts`'s `planResize` gets this right and always has (`slot.kind !== "literal"` →
skip and notice). The gesture path simply never inherited it, because the entry believed the seam
below was doing the work.

**Fixed at this review** (§8 item 1): a shared `commitGestureWrites` in `main.ts` applies
`planResize`'s exact rule to every multi-write gesture, skipping a formula- or schema-driven slot
and saying so. Two tests pin it, and neutralising the guard turns both red.

This is a REVISE-grade defect found in an ACCEPT-grade batch, and the distinction matters: the
entries' reasoning was sound, their intent was right, and what failed was an unverified belief about
a neighbouring function's behaviour. That is what a review is for.

## 5. The human's instruction at this review — ruled as D-144

> *"Make a revision to the image resizing system so that image resizing and distortion can always be
> put back to the original aspect ratio — so that needs to be saved somewhere so it can be regained
> if 'preserve aspect ratio' is toggled back on."*

This lands on the exact hole entry 0175 flagged in its own "Where I got stuck": `constrainBoxToRatio`
takes the START BOX's ratio, so turning `preserveAspect` back on preserved the DISTORTED shape and
the picture's real proportions were gone from the document with nothing left that knew them. The
entry called it "defensible but a call". The human has now made the call.

Ruled as **D-144** and built here:

- **`pictureAspect`, an eighth `image` slot** — the chosen picture's `naturalWidth / naturalHeight`,
  written by the pick gesture beside the `width`/`height` the same decode produces. `0`/missing/
  non-finite all mean "no picture whose shape is known", through one shared `usableAspect` screen.
- **Stored, not re-derived**, which is the whole of what "saved somewhere" required. The decoded
  bitmap lives in a render-layer cache rebuilt on every load, so a restore that consulted it would
  silently do nothing in the seconds after a document opens — D-127 clause 5's failure. It could not
  be a derived slot either: a compute function is engine code and Rule 1 forbids it to decode.
- **The restore is `fitBitmapIntoBox`** — `renderer.ts`'s own function, now exported, called with
  the remembered ratio. The box becomes exactly the rectangle the renderer would have DRAWN inside
  it, so the frame hugs the picture by construction rather than by two files agreeing (D-010). It
  never grows the object, leaves `origin` alone, and is idempotent.
- **It fires on the panel drop-down, not on a typed `set`.** A choice is a gesture; a command is a
  command. D-144 clause 5 states the line and clause 6 explains why `constrainBoxToRatio` is left
  alone rather than also being pointed at `pictureAspect` (it would make a box jump at drag start).

## 6. Invariant audit

Not much at stake — nothing in this batch touches evaluation. Checked anyway: no `recompute()` pass,
no lazy dependency extraction, no hand-maintained edges, no `#CYCLE`. The one new engine-visible
thing is a `literal` number slot, and graph state stays plain and serializable — `pictureAspect` is a
number, and the decoded pixels it describes stay outside the document, which is the whole point of
storing a ratio rather than a bitmap.

## 7. Legibility audit

Headers present and in the locked vocabulary throughout; `images.ts`'s in particular earns its
length by saying why the file can never move. Three fixes made (§8 items 2–4):

1. `primitives/image.ts` said "SEVEN slots" in its prose and "fixed at six for every image, forever"
   in its invariants — a header only correct read as chronology, which §5.2 forbids.
   `primitives/schema.ts`'s own file header still said "six" too.
2. `main.ts`'s `runPanelCommand` carried an `echo` parameter whose doc named `commitImageSource` as
   its one caller. Entry 0174 replaced that function; **no caller passed `echo` at all.** Dead
   parameter, stale doc.
3. `panelPickElement`'s doc said the delegated listener reads the row's `dataset.path`; the listener
   says, correctly, that it does not need it.

No unjustified `any` anywhere (`grep` clean). Test names are behaviour sentences and name the rule
they defend.

## 8. Edits made by this review

Small and explained, per §8's obligation. Nothing was rewritten wholesale.

1. **`main.ts` — `commitGestureWrites`** (§4's fix). Applies §5.9's per-component rule to
   `commitImagePicture` and to the new restore: a formula- or schema-driven slot is left alone and
   reported, never silently replaced.
2. **`primitives/image.ts`, `primitives/schema.ts`** — the stale slot counts, and the new
   `IMAGE_PICTURE_ASPECT_PATH` with its reasoning.
3. **`main.ts` — `runPanelCommand`'s dead `echo` parameter removed**, its doc rewritten to say where
   multi-write gestures actually go.
4. **`main.ts` — `panelPickElement`'s doc corrected.**
5. **D-144's build**: `pictureAspect` in the schema and in `createImage`; `commitImagePicture` writes
   it; `restorePictureAspect` + `usableAspect`; `commitPanelChoice` calls the restore;
   `fitBitmapIntoBox` exported from `renderer.ts` with its reason.
6. **Tests**: 12 added (`main.test.ts`), 2 registry-completeness expectations updated to eight slots
   (`schema.test.ts`, `commands.test.ts`) — the same §6.1 trigger 5 entry 0174 named for the same
   reason, and the system working rather than noise.

Verified after every edit:

```
$ npx tsc --noEmit                              -> exit 0
$ npx tsc --noEmit -p tsconfig.engine.json      -> exit 0
$ npx vitest run
 Test Files  36 passed (36)
      Tests  1932 passed (1932)
$ npx vite build
dist/assets/index-dcT4s5hZ.js  134.51 kB | gzip: 39.93 kB   ✓ built in 407ms
```

**My own D-016 checks on D-144's build**, each reverted from a file copy:

| # | Neutralised | Result |
|---|---|---|
| A | `restorePictureAspect`'s `fitBitmapIntoBox(...)` → the box unchanged | RED: 5 failures across the D-144 describe |
| B | `commitGestureWrites`' `slot.kind !== "literal"` guard disabled | RED: 2 failures — both the pick and the restore stop protecting a linked `width` |

## 9. Open questions

- **Q-027 — ANSWERED, ratified as D-143.** The human ruled it directly on screen at entry 0173;
  entries 0174/0175 built it; an implementer may not write `DECISIONS.md`, so the ruling was owed a
  number and now has one. Its `PROVISIONAL` tag is gone, confirmed by grep.
- **Q-028 — ANSWERED as D-145.** Option (b) stands: no `fileName` slot. Neither half of the human's
  *"link to the image on the drive"* is buildable — a browser discloses no path, and §5.7 embeds the
  picture so nothing is pulling from the drive. What remains is a NAME, which would be a label
  rather than a link. **This is a display preference the human may simply overrule**, and D-145 says
  what it would cost if they do (one slot, one cycle).
- **Q-008, Q-012, Q-016, Q-017** — untouched by this diff, unchanged, not re-litigated. Q-012's five
  `PROVISIONAL` tags now include the image frame's stroke width, which is the same world-unit
  question and needs no new tag.
- **Q-029 is the next free number.**

## 10. The gate — still open, and what closes it

Everything D-142's fix list asked for is built and now reviewed. What remains is D-142 clause 2, and
only the human can do it:

**`npm run dev`, then:**
1. `image x=0 y=0` — a file dialog opens. Choose a picture. It should appear **in proportion**,
   inside a frame that hugs it rather than hanging over it.
2. Drag it. Select it — eight grabbers. Drag a corner: it should scale, not distort.
3. Panel → `preserveAspect` → "stretch to fill the box". Drag a side grabber: it should now distort.
4. **Panel → `preserveAspect` → "keep the picture's proportions". The box should snap back to the
   picture's real shape** — this review's own addition, and the thing to look hardest at.
5. Panel → `source` row → "📁 choose…" — re-picking should work, and the row should read
   "JPEG picture · about N KB" rather than base64.

If all five hold, the next entry claims the gate, citing 0172-REVIEW §2/§6 for the ✅ line rather
than re-deriving it. **Phase 7 may not begin before that.**
