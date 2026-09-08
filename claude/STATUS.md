# STATUS — as of entry 0180-REVIEW-phase6-gate

**PHASE 6 IS CLOSED. PHASE 7 IS OPEN.** The gate was claimed and closed at **0180-REVIEW**, on all
four of its conditions: the ✅ line passes (0171, re-proved at 0172-REVIEW §2/§6 — do NOT re-derive
it), the ✅ line is PERFORMABLE by an operator (D-146 clause 1, entry 0178), `image` loads and
renders (D-142 clause 2), and §5.8's node renders and is usable (D-146 clause 5). **The last two
were confirmed by the human ON SCREEN, 2026-09-07** — *"Image changes work perfectly. Steps 1-5
pass. Script half: works in its current state. Ports link and pass results/update geometry."*

**Phase 7 is the road network — the brief's own acceptance test, and the last phase.**

> **THE LESSON PHASE 6 COST, AND PHASE 7 STATES OUT LOUD.** Phase 6's ✅ line was reported PASSING
> at five separate points, honestly and with real tests — and **not one step of it could be
> performed by a person in the running app** until entry 0178. The criterion test reached past the
> command line into `mutate` with hand-built operations; `script x=0 y=0` made a node with
> `ports: undefined`, `link script_1.in.factor …` was refused, and no `addport` command existed.
> 0177-REVIEW found it by typing the criterion out. **Phase 7 says the quiet part explicitly —
> "Build by hand from primitives, VIA THE COMMAND LINE. No new features should be needed — if
> something is impossible here, that is a real gap worth fixing." Walk it by hand EARLY. Anything
> impossible is the phase's deliverable, not an obstacle to it.**

**PHASE 7's criterion, quoted:** *"two circles act as intersections; a polyline's endpoints are
bound to the two circles' centers; two text boxes read traffic volumes from a table and are
positioned relative to their intersection's center; and **dragging either intersection keeps the
road connected and both labels following**, while editing the volumes updates the label text."*

**The first thing Phase 7 will hit:** `polyline` does not exist. It has no schema entry
(`getObjectSchema("polyline")` returns `undefined`, deliberately and tested), no creation command
(`COMMANDS_SPECIFIED_BUT_NOT_BUILT` names it), no extent, no hit test, and no renderer arm.
§5.5's `polyline 0,0 100,0 100,100` form and §5.9's per-vertex drag are both unbuilt. That is the
phase's largest single piece of work and it is a NEW SUBSYSTEM — **§6.1 trigger 2 fires on its
first file.**

STATE: **GREEN**. Both configs compile, **1955/1955** tests pass, 0 skipped, 0 `.only`.
**36 test files.** `npx vite build` clean.

Current phase: **7 — Acceptance test: the road network (OPEN, nothing built)**
Phase 7 acceptance criterion: quoted above — **NOT STARTED.**
Last review point: **0180-REVIEW-phase6-gate** (ACCEPT WITH EDITS; the gate CLOSED, Phase 7 OPENED).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).
**The review gate is CLEAR — the next slice may start.**

**What closed Phase 6, in one list**, so nothing here needs re-deriving:
- §5.7's `image`: loads via a file picker, draws, is bounded and clickable, resizes by grabbers,
  keeps or drops its aspect ratio on a toggle, and can be re-picked from the panel — entries
  0165/0173/0174/0175, reviewed 0166/0172/0176, plus **D-144**'s aspect restore.
- §5.8's `script`: ports declared by `addport`/`removeport`, drawn as a labelled box with inputs
  left and outputs right, selectable and draggable — entries 0167/0169/0178/0179, reviewed
  0168/0170/0180.
- Rulings that came out of it: **D-140** through **D-146**. D-142 clause 3 was OVERTURNED by D-146
  — read 0177-REVIEW §3 before arguing with either.

**0168-REVIEW's finding (settled, kept for history):** the ORIGINAL `isLegalPortName`
(`graph/node.ts`) only checked non-empty/no-dot, LOOSER than `address.ts`'s `PATH_SEGMENT_PATTERN`
(`/^[a-zA-Z0-9_]+$/`) — fixed at 0168-REVIEW to match exactly. `SCRIPT_SCHEMA` (0169) adds no second
naming check anywhere — `addPort`/`removePort` (via `mutation.ts`'s `findInvalidPortOperations`)
stay the ONLY gate a port name passes through; nothing in `engine/script/stub.ts` re-derives or
duplicates it. 0168-REVIEW's OTHER flag — whether `in.*` is genuinely unreadable from outside a
script node's own formulas — is now MOOT rather than answered: nothing in `SCRIPT_SCHEMA` restricts
`in.<port>`'s KIND at all (no D-122-style guard), so an ordinary formula elsewhere CAN name
`script_1.in.factor` as a read address today, exactly as 0168-REVIEW worried. Not treated as a
defect — §5.8 never says this must be prevented, only that `in.<port>` is "written into by a
binding" as the NORMAL usage — but it is a real, live capability now, not a hypothetical one.

**FINDING FROM ENTRY 0169, CONFIRMED BY 0170-REVIEW — worth knowing before touching `SCRIPT_SCHEMA`
or its port mechanics again:** `out.<port>`'s dependencies are literal `Address`es (every current `in.*` plus
the port's own `placeholder.<port>`), not a range — so unlike a table's `cells.*` (D-047's
empty-in-range exception), `validateIntegrity`'s dangling-reference check (§5.1.1) requires EVERY
one of those addresses to be a REAL slot the instant any `out.*` port exists. **Declaring a port's
NAME (`addPort`) and giving it a VALUE (`setSlot`) is not merely a documented convention — it is now
load-bearing**: a batch that adds a port without pairing it with the matching `setSlot` in the SAME
batch (or an earlier one) will be rejected the moment anything depends on it. See entry 0169's
"Decisions I made" #3–#4 for the neutralisation that proved this and the fixture fallout it caused.
**0170-REVIEW traced the mechanism by hand (§5 of that entry) rather than taking the claim on
faith:** D-141 clause 3's "placeholder ↔ port" reconciliation is satisfied by TWO existing generic
checks working together, not by any new script-specific one — `deriveEdges` builds the
`placeholder.<name> → out.<name>` edge from the SCHEMA alone (whether or not either slot is
populated), and the ordinary dangling-reference check then rejects it if `placeholder.<name>` is
missing, while D-018 clause 1 separately requires `out.<name>` itself to exist. Same mechanism
`table`'s `cells.*` already relies on.

---

## D-141 and the script node — SETTLED, kept as the pointer a cold reader needs

§5.8 makes `script.in.*`/`script.out.*` per-OBJECT slot families whose members the operator names,
and this codebase had nowhere to store that list (not a slot value — §5.1's `Value` union has no
list-of-strings arm; not the slot keys — D-010 forbids inverting one; not a count plus positions —
the criterion names `script_1.in.factor`, and the NAME is operator data).

**Q-026 was ANSWERED as D-141 (0166-REVIEW), option (a), and every clause of it is now BUILT AND
REVIEWED**: port names are ordered structural state on `GraphObject` (0167, reviewed 0168);
`ObjectSchema.derivedSlots` widened to `static`/`dynamic` groups resolved per OBJECT (same);
`engine/script/stub.ts` and `SCRIPT_SCHEMA` (0169, reviewed 0170); the `addport`/`removeport`
commands that finally gave clause 6's operations an operator surface (0178, reviewed 0180); and
§5.8's rendering (0179, same review). **Read D-141 and D-146, not this summary, before touching
any of it.** Options (b), (c) and (d) of Q-026 are rejected on the record — do not re-litigate.
## What the last cycles did

**0168-REVIEW** accepted entry 0167 (the data-model slice) with edits, all re-verified green
(1818/1818, both configs clean, `vite build` clean). One real gap fixed: `isLegalPortName`
(`graph/node.ts`) checked only non-empty/no-dot, LOOSER than `address.ts`'s
`PATH_SEGMENT_PATTERN` (`/^[a-zA-Z0-9_]+$/`) — a name like `"my-port"` would have been accepted by
`addPort` yet been
permanently unaddressable. Tightened to match the pattern exactly, with matching doc-comment and
message updates in `mutation.ts` and `document.ts`, plus a `schema.ts` comment correction (a false
"resolved only during edge derivation" claim `DerivedSlotGroup`'s doc comment had copied from
`NonDerivedSlotPathGroup`'s, where it is true, but `resolveDerivedSlots` is genuinely called from
eight sites, not three). Three regression tests added. No new ruling — the fix follows directly
from D-141 clause 2's own stated intent.

**0169** (ACCEPTED, no edits, at 0170-REVIEW) built D-141 clause 7's own next slice. `engine/script/stub.ts` (new
subsystem, §6.1 trigger 2): `ScriptNode`/`evaluateScriptOutput` (§5.8's seam, one disclosed
implementation deviation in `ScriptNode.in`/`.out`'s type — see the entry's own "Decisions I made"
#1), path constants, two dynamic `NonDerivedSlotPathGroup` enumerators (`in.*`, `placeholder.*`, the
LATTER a new family this entry introduces — see "0script" below), one dynamic `DerivedSlotGroup`
enumerator (`out.*`) whose dependency resolver includes each port's own placeholder address (load
bearing — proven by neutralisation). `SCRIPT_SCHEMA` wired into `primitives/schema.ts`'s registry.
§5.10's `script x= y=` command (parser + handler), the identical shape `image`'s takes. A new
integration test in `command/commands.test.ts` reproduces Phase 6's acceptance criterion's EXACT
shape end to end and passes — demonstrated, not gated (see "Acceptance criteria status" in the
entry). Three pre-existing hand-built `script` test fixtures (two in `mutation.test.ts`, three in
`document.test.ts`) needed updating to stay schema-consistent now that `SCRIPT_SCHEMA` exists — every
assertion is unchanged; only the FIXTURES gained the slots the new schema now requires. 1844/1844,
both configs clean, `vite build` clean.

**0170-REVIEW** accepted entry 0169 with **no edits**. Independently re-derived (not merely re-read)
the two claims most worth doubting: why `out.<port>`'s dependency list must include its own
`placeholder.<port>` (traced through `graph/eval.ts`'s D-013 read-gating and re-proved by a hand-run
neutralisation, not just re-reading the entry's own), and how D-141 clause 3's placeholder↔port
reconciliation is actually satisfied (traced to the interaction of `deriveEdges`'s schema-driven edge
generation and the generic dangling-reference check, not a special-cased one). Both held. No new
ruling — D-141 stands exactly as written.

**0171** claimed Phase 6's gate: the ✅ criterion PASSING, backed by its own fresh D-016 mutation
check, plus the scope call that the phase's build-order heading ("script stub + image") is
descriptive rather than part of the ✅ contract. No source changed net (a neutralise-and-restore).

**0172-REVIEW** (verdict **REVISE**) **CONFIRMED the criterion claim and OVERTURNED the scope call.**
Re-ran everything from a clean tree (§1), then ran two D-016 mutation checks rather than reading
0171's — one of them a NEW route through §5.8's seam function itself, which 0171 had not tested —
and read the criterion test line by line rather than trusting its title. All held; the honesty audit
found the log matching the diff exactly. **The human ruled directly at that review that `image` must
load and render before Phase 6 gates — D-142.** No source or test edited; `DECISIONS.md` gained
D-142; this file rewritten. 0172-REVIEW §4 carries one warning worth reading before the `image`
cycle starts: **the decoded-bitmap cache is a `Map` of live DOM objects and may never live in
`src/engine/`** (Rule 1 + §5.5).

**0173 — UNREVIEWED. THIS IS THE WHOLE BATCH.** Built §5.7's unbuilt half in one slice, exactly as
0172-REVIEW §8 item 2 scoped it. New `src/render/images.ts` (the decoded-bitmap cache: one decode
per distinct data URL, failures remembered and never retried, `onDecoded` = `main.ts`'s `paint`);
`extent.ts`'s `imageExtent`; `hittest.ts`'s `image` arm (joins `text` on the existing bounding-box
arm); `renderer.ts`'s `drawImage` (frame ALWAYS, picture fitted inside it preserving aspect ratio,
`opacity` clamped at paint time) plus `renderDocument`'s optional 9th argument, the INJECTED
`ImageBitmaps`; `main.ts`'s `AppTransition.pickImageFor` + `commitImageSource` + `start`'s
`choosePicture`; `props.ts`'s display elision for a very long string. 1887/1887, both configs
clean, `vite build` clean, two D-016 mutation checks both red as predicted and both reverted.
**Q-027 raised** (§5.7's aspect-ratio clause), provisional (a) taken and tagged. **The gate was
deliberately NOT claimed — D-142 clause 2 needs the human's eyes first.** Its `commitImageSource`
was replaced by `commitImagePicture` at 0174.

**0173 WAS SEEN, AND THE HUMAN GAVE FOUR NOTES** (listed at the top of this file with where each
landed). The defect their note 1 named — a square blue box with white bands down each side of a
portrait photograph — is the thing to remember about 0173: **its Q-027 recommendation argued the
question was a choice between two mechanisms, and the operator wanted both.** No test could have
caught that; one look did.

**0174 — UNREVIEWED.** The human's Q-027 ruling, notes 1 and 3. `IMAGE_PRESERVE_ASPECT_PATH` (a
SEVENTH `image` slot) with `slotOptions`, so the panel offers a drop-down; `DEFAULT_IMAGE_EXTENT`
exported as the ONE number behind both the empty frame's size and a chosen picture's long side;
`main.ts`'s `pictureBoxSize` + `commitImagePicture` (three literal `set`s through `executeCommand`,
one echo line); `renderer.ts` fitting or stretching by the flag; `images.ts`'s new one-shot
`decodeBitmap`, which the cache now uses internally. **TWO existing test expectations updated** —
both pinned the `image` slot COUNT at six (§6.1 trigger 5, named in the entry). 1901/1901. One
D-016 mutation check, red as predicted, reverted.

**0175 — UNREVIEWED.** Notes 2 and 4. `IMAGE_TYPE` in `graph/node.ts` (D-009 — two non-switch sites
compare against it now); `hasResizeHandles` widened to `text` OR `image`; `MIN_TEXT_BOX_SIZE`
renamed **`MIN_RESIZE_BOX_SIZE`**; `constrainBoxToRatio` in `handles.ts`; `interaction.ts`'s
`planResize` made per-type through `resizePlanShape`. The panel's `source` row gains
`PanelRow.picker`, a "📁 choose…" control, and `describePictureSource`. **Q-028 raised** (the file
NAME, which would need an eighth slot). 1920/1920. One D-016 mutation check — the ratio constraint
forced to scale 1 — **9 failures**, reverted.

---

## Read this first — what a cold reader needs

**0script. A `script` NODE HAS FOUR FIXED SLOTS PLUS THREE DYNAMIC FAMILIES, ALL BUILT AND REVIEWED
(entry 0169, ACCEPTED at 0170-REVIEW).** `origin.x`/`origin.y` (imported, same identity every positioned object uses),
`language` (literal, closed to `"python"`), `source` (literal, stored, NEVER a dependency of
anything). Three families, each sized by the STRUCTURAL `ports` field (never a slot value — Rule 6
holds by construction, D-141's own rationale): `in.<port>` (non-derived, `literal`-by-default,
`link`-able like any other slot, unrestricted kind), `placeholder.<port>` (non-derived, literal,
"user-editable" per §5.8 — THIS IS WHERE §5.8's `placeholders` VALUE lives, deliberately a
SEPARATE family from `out.*` because `out.*` is `derived` and can never be user-set), `out.<port>`
(derived, computed by `engine/script/stub.ts`'s `evaluateScriptOutput` via a small adapter).
- **`out.<port>`'s DEPENDENCIES ARE EVERY CURRENT `in.*` ADDRESS PLUS ITS OWN `placeholder.<port>`
  ADDRESS.** The placeholder half is not in §5.1's one-sentence description of the dependency but is
  REQUIRED by D-013 (`graph/eval.ts` refuses a compute's `read` of anything outside its declared
  deps) — without it, editing the placeholder would never re-trigger `out.<port>`. Proven by
  neutralisation at entry 0169; do not remove it "for tidiness."
- **THESE ARE LITERAL ADDRESSES, NOT A RANGE** — D-047's "an empty cell in a range is fine" does NOT
  apply. The moment ANY `out.<port>` exists, EVERY name in `ports.in` and that port's own
  `placeholder.<port>` MUST be a real slot, or `validateIntegrity`'s dangling-reference check
  rejects the whole mutation. **Declaring a port's NAME (`addPort`) and giving it a VALUE (`setSlot`)
  MUST happen in the same batch (or an earlier one) once anything depends on it** — this is not a
  style preference, it is load-bearing as of entry 0169. See that entry's fixtures for the pattern.
- **NO `addport`/`removeport` COMMAND EXISTS.** §5.10 names no grammar for one. Every port in entry
  0169's own tests is declared through raw `mutation.ts` `addPort`/`removePort` operations. Inventing
  a command for this is §8's last-bullet gold-plating until a real need names the grammar — not this
  cycle's call to make.
- **A CREATED `script` NODE IS PORTLESS, INVISIBLE, AND UNSELECTABLE**, the identical posture `image`
  had before its own rendering cycle. `render/`, `extent.ts`, `hittest.ts` all have ZERO
  `script`-specific code — D-066 forbids giving it an extent before a drawing pass earns one, and
  none exists yet.
- **`command/props.ts` DOES NOT SUMMARISE `script`'s TWO DYNAMIC NON-DERIVED FAMILIES.** `props
  script_1` (once reachable) would show `origin.*`/`language`/`source`/`out.*` correctly but SILENTLY
  OMIT `in.*`/`placeholder.*` — that file's own D-077 walk only special-cases `TABLE_TYPE`'s dynamic
  group. Disclosed in `props.ts`'s own header now; not fixed. Whoever gives `script` a summary row
  should read that header first.

**0img. AN `image` OBJECT HAS EIGHT SLOTS. IT DRAWS, IS CLICKABLE, RESIZES BY GRABBERS, GETS
ITS PICTURE FROM A FILE PICKER, AND CAN BE PUT BACK TO THAT PICTURE'S PROPORTIONS — ALL OF IT
BUILT (0173/0174/0175) AND REVIEWED (0176-REVIEW).** `origin.x`/`origin.y`
(imported from `primitives/geometry.ts`, NOT re-declared — the same identity D-121 gave `text`,
which is what makes the per-component origin drag reach an image with no image-specific code),
`width`, `height`, `opacity`, `source`, **`preserveAspect`**, **`pictureAspect`** (D-144).
**No derived slots at all.**
- **`image x=<n> y=<n>` OPENS THE FILE PICKER ON THE OBJECT IT JUST CREATED**, and so does the
  panel's `source` row. That is `AppTransition.pickImageFor` — **D-124's shape one type over** (a
  creation hands straight to the gesture that gives the new object its content; there the in-place
  editor, here the picker). The chosen file is decoded, then `source`, `width` and `height` are
  written by `main.ts`'s `commitImagePicture` — with `pictureAspect` (D-144) — as FOUR literal
  `set`s through `executeCommand` (Rule 2), under one echo line, each screened for a
  formula-driven slot by `commitGestureWrites` (0176-REVIEW's finding: a plain `set` REPLACES a
  formula, it does not refuse one).
- **A CHOSEN PICTURE'S SHAPE BECOMES THE BOX'S SHAPE — the human's Q-027 ruling.** `pictureBoxSize`
  scales the decoded natural size so its LONG side is `DEFAULT_IMAGE_EXTENT` (100, the same number
  the empty frame uses, so the object changes SHAPE and not SCALE). **The decoded natural size
  therefore DOES reach a slot**, which is the half 0172-REVIEW §8 called load-bearing — through an
  ordinary `set`, never a second write path.
- **`preserveAspect` DECIDES TWO GESTURES, AND IS READ `?? true` AT EVERY SITE.** On: `renderer.ts`
  FITS the picture inside its box, and a grabber drag keeps the box's proportions
  (`handles.ts`'s `constrainBoxToRatio`). Off: the picture STRETCHES to fill, and a drag distorts
  freely. The `?? true` default is what lets a document saved before 0174 load unchanged (D-126's
  lesson, applied to a non-derived slot) — **do not "tidy" it into a bare read.** Turning it back
  ON through the PANEL also RESTORES the box to the picture's proportions (**D-144**), via
  `main.ts`'s `restorePictureAspect` and `renderer.ts`'s exported `fitBitmapIntoBox` — the restore
  shrinks, never grows, leaves `origin` alone, and is idempotent. A TYPED
  `set image_1.preserveAspect true` writes the slot and moves nothing: a choice is a gesture, a
  command is a command (D-144 clause 5).
- **`pictureAspect` IS THE REMEMBERED RATIO AND ONLY THE PICK GESTURE WRITES IT.** `0`/missing/
  non-finite all mean "no picture whose shape is known" (one screen, `usableAspect`). A `source`
  set by hand records no ratio and therefore offers no restore — disclosed at the constant, not a
  defect (D-144 clause 3).
- **`imageExtent` IS `origin` + `width` x `height` AND DOES NOT READ `source`.** An image's box is
  its size slots whether or not a picture is chosen or decoded, because `drawImage` strokes that box
  as a FRAME either way. That is what keeps drawn extent and clickable extent one extent (D-066) at
  every moment — including the seconds between choosing a file and the decode landing — and it is
  what makes a dismissed picker survivable: you get a visible, deletable empty frame instead of the
  invisible object D-142 refused. **Do not "fix" the frame away without replacing that guarantee.**
- **THE PANEL'S `source` ROW IS THE ONE ROW WITH A PICKER INSTEAD OF A PAPERCLIP** (`PanelRow.picker`,
  `literal` rows only — a formula-driven `source` keeps its BLUE unlink paperclip, D-102 clause 3).
  Its value reads `"JPEG picture · about 194 KB"` (`describePictureSource`), not base64. **`props
  image_1` from the COMMAND LINE still shows the elided base64** — two readings of one slot,
  disclosed in entry 0175's "Where I got stuck" and worth a reviewer's opinion.
- **THERE IS NO FILE PATH AND THERE CANNOT BE ONE.** A browser yields `C:\fakepath\name.jpg` from a
  file input, and §5.7 embeds the picture in the document, so nothing is "pulling from" the drive.
  Storing the NAME would need a further slot — **Q-028, ANSWERED as D-145: no.** The row says what
  the picture IS instead. D-145 is a display preference the human may overrule; it is one slot and
  one small cycle if they want it.
- **THE DECODED-BITMAP CACHE IS `src/render/images.ts` AND MAY NEVER MOVE TO `src/engine/`.** It
  holds a `Map` of live `HTMLImageElement`s — precisely what Rule 1 and §5.5 forbid the engine to
  hold. The document stores the URL STRING; `renderDocument` takes the cache as an INJECTED 9th
  argument (`ImageBitmaps`), so tests hand it a hand-written fake and no DOM is needed. A decode
  that finishes calls `paint` again — that callback is the whole async story.
- **A VERY LONG STRING NOW ELIDES IN EVERY DISPLAY READER** (`describeSlotValue`, `props.ts`): a
  data URL would otherwise print in full in a `props` line, a `set` echo and a panel row.
  `main.ts`'s `editSeed` is the ONE caller that opts out (`{ fullStrings: true }`) — it must stay
  retypeable, which is D-107/F3's whole reason for existing. **Do not remove that opt-out.**
- **`source` IS A SIXTH SLOT §5.7's OWN LIST DOES NOT NAME.** §5.7 enumerates five and then says the
  data URL is "stored in the document"; a `GraphObject` is `{ id, name, type, slots }`, so that can
  only mean a slot, and `Value` admits `string`. Disclosed deviation, entry 0165 decision 1,
  **RATIFIED at D-140** — permanent, not provisional.
- **`source` is NOT `literal`-only.** D-122 narrowed `text.content` because a formula-driven
  `content` hides embedded references from edge derivation. Nothing parses a data URL, so no guard
  is needed and none was added. Do not "fix" this into a D-122 clone.
- **`opacity` is DELIBERATELY UNBOUNDED** as document state. D-070 bounds COUNTS (they size slot
  sets); `opacity` sizes nothing, so the renderer clamps what it paints — `style.align`'s posture.
  **There is a test asserting `set image_1.opacity 4` COMMITS.** It is not a missing check.
- **`image x=0 y=0` takes §5.10's two arguments and NO OTHERS.** No `w=`/`h=` — §8's last bullet
  forbids the gold-plating, and `set image_1.width 200` reaches them. A stray `w=` is a parse
  failure, pinned.
- **`DEFAULT_IMAGE_WIDTH`/`_HEIGHT` both come from the exported `DEFAULT_IMAGE_EXTENT` (100).** One
  number, two readers (`commands.ts`'s empty frame, `main.ts`'s `pictureBoxSize`), never re-spelled
  — D-010. `text`'s `"auto"` has no equivalent here: a measurer answers `"auto"` for text, and
  §5.7's equivalent is a decoded bitmap, which only arrives once a picture is chosen.
- **"A CREATED IMAGE IS INVISIBLE AND UNSELECTABLE" IS NO LONGER TRUE — that line described the tree
  from 0165 to 0172 and is now history.** All three arms are built (`renderer.ts`'s `drawImage`,
  `extent.ts`'s `imageExtent`, `hittest.ts`'s bounding-box arm), and they were shipped TOGETHER
  because D-066 makes drawn extent and clickable extent one extent. D-140 clause 4 said the
  invisible state was correct *as 0165 shipped it*; D-142 said it was not a gate-passing state.

**0. `TEXT_SCHEMA` HAS ELEVEN NON-DERIVED + THREE DERIVED SLOTS.** Non-derived: `origin.x`/`origin.y`
(D-121) + `content` + `width`/`height`/**`autoresize`** + five `style.*`. **NO `overflow`** — the slot
was REMOVED at 0154 on the human's instruction; `autoresize` took its place in the count. Derived:
`resolvedContent` (dynamic deps), `measuredHeight` and `measuredWidth` (static deps, **the SAME
list** — one measurement answers both). `primitives/text.ts` owns NINE of the eleven paths; the two
`origin.*` come from `geometry.ts`.

**0a. `autoresize` IS NOT A DEPENDENCY OF EITHER MEASURED SLOT, AND THAT IS THE POINT.** It sizes the
BOX, not the TEXT. Two consequences, both wanted: toggling it never re-measures, and **a document
saved before it existed still loads**. D-126's trap avoided by construction. There is a test.
**0157-REVIEW flagged this as a call a future cycle must not "fix".**

**0s. THE LOADER IS HARDENED (0156, REVIEWED 0157). TWO FACTS A COLD READER NEEDS.**
- **A loaded formula AST's SHAPE is validated ONCE, at the boundary** —
  `formula/ast.ts`'s `validateFormulaAstShape`, called from `document.ts`'s `reconstructSlot`
  BEFORE the depth check. **D-108 clause 3 still forbids hardening any individual walker** —
  `exceedsMaxFormulaAstDepth`, `collectIllegalAstLiterals`, `deps.ts`, `eval.ts` all stay guard-free,
  and this boundary is what makes that safe.
- **The SCHEMA says which derived slots an object has, never the file** (`withSchemaDerivedSlots`,
  D-126). **Adding a derived slot is no longer a load-compatibility event.**

### The text pipeline, end to end (READ THIS BEFORE TOUCHING ANY OF IT)

**0t. FOUR FILES, ONE DIRECTION, NO CYCLES.**
`markdown.ts` (parse) → `measure.ts` (lay out + measure) → `renderer.ts` (paint) / `editor.ts` +
`main.ts` (the overlay). `markdown.ts` imports NOTHING. `measure.ts` imports `markdown.ts` and the
engine's interface only.

**0u. `render/markdown.ts` OWNS §5.6's MARKDOWN-LITE LIST AND NOTHING ELSE INTERPRETS IT.**
`parseMarkdownLite(text)` → one `MarkdownLine` per hard line (`paragraph`/`heading`/`list`, `level`
1–3), each holding `MarkdownRun`s: **the text with its markers REMOVED** plus `bold`/`italic`/`code`.
`verbatimLines(text)` is the same hard lines with no markup honoured. Both live here so **"what a
hard line is" (`/\r?\n/`) has ONE answer** and a box's line COUNT never depends on whether markup
was read.
- It is in `render/`, not `engine/`, because markup only decides which FONT a stretch is drawn and
  measured in — glyph work, which Rule 1 and D-120 put behind the measurer. The engine still holds
  `content` as "raw source including markup" (§5.6) and never parses it.
- **Consequence, intended:** markup a `{= }` resolved INTO is markup, and D-116/D-117's `!`-marked
  broken span is parsed like any other text — a `*` in a broken formula can open an italic run.
- **An emphasis marker is subject to CommonMark's FLANKING rule, reduced**: it opens only when
  followed by a non-space and closes only when preceded by one. **This is not decoration — without
  it, `2 * 3 and **bold` silently italicises its own middle.** A defect 0159 shipped and 0160's
  renderer test caught. Code spans are deliberately exempt.
- **A `#### ` is NOT a heading** (§5.6 says levels 1–3), a prefix is read **at position 0 only**
  (no indentation — §5.6 forbids nested lists), and there is **no escaping** (`\*` is a backslash
  next to a marker).
- **A WRAPPED list item hangs its continuations under its TEXT** (0161). The indent is the measured
  width of `LIST_BULLET` in the bullet's own font, computed in `measure.ts` because only that file
  can measure it — `markdown.ts` just names the bullet.

**0v. `render/measure.ts` HAS ONE LAYOUT FUNCTION AND TWO MEASURERS.** `layOutText(request)` →
`TextLayout` (`lines`, each with `top`/`width`/`height` and positioned `LaidOutRun`s carrying the
exact `ctx.font` they draw in). **`layOutLines` IS GONE.**
- `request.markup` is the ONLY difference between the two readings. Everything after the parse —
  chunking, the greedy fill, hanging spaces, code-point splitting — is shared, so there is still
  exactly one implementation of the wrap rules (D-010).
- **`createCanvas2dTextMeasurer` = markup-aware = the ENGINE's** (`main.ts`'s `EvalContext`), so
  `measuredWidth`/`measuredHeight` measure the RENDERED text. That is what keeps D-123 clause 5 true.
- **`createSourceTextMeasurer` = verbatim = the OVERLAY's** (Q-025 (a), answered on screen 2026-09-03).
- **A line's measured width is the SUM OF THE SAME RUN MEASUREMENTS the renderer positions those
  runs by**, so a line can never be measured wider or narrower than it draws. Adjacent same-font
  pieces are merged and measured as ONE string — which for a plain line is one `measureText` call on
  the whole line, bit-for-bit what the file did before markdown, and why all 29 pre-existing measure
  tests pass untouched.
- **A word may span two runs (`**bo**ld`) and is NOT broken there** — chunks accumulate across runs.
- **THE HANGING INDENT IS APPLIED WHERE THE LINE IS FITTED, NOT WHERE IT IS DRAWN.** `wrapLine`
  narrows every line after the first by it. Wrapping to the full width and indenting afterwards
  pushes the last word of each continuation out through the side of the box — the exact defect
  0154's `break-word` removed. It is folded into each run's `x` and into the line's `width`, so
  `measuredWidth` covers it and `renderer.ts` needed NO change. There is a test that fails if a
  later cycle moves it back to the renderer.
- **Heading scale is CSS 2.1's sample stylesheet** — `2em`/`1.5em`/`1.17em`, bold — adopted under
  D-138 clause 4 (a *specified* rule, named at its site) rather than tuned. The LINE HEIGHT scales
  by the same factor. `` `code` `` is the generic `monospace`.

**0w. `renderer.ts`'s `drawText` CHOOSES NO FONT.** It sets `ctx.font` to the string each laid-out
run already carries and calls `fillText`. **`ctx.textAlign` IS NOW ALWAYS `left`** and §5.6's
alignment is arithmetic (`alignmentOffset`, against `textbox.ts`'s box width) — a line made of two
fonts has no single anchor a canvas alignment could measure from.

**0g. LINE-BREAKING LIVES IN `render/measure.ts` (D-120), NEVER IN `src/engine/`. IT IMPLEMENTS
CSS'S RULES ON PURPOSE (0154, reviewed 0157):** `white-space: pre-wrap` + `overflow-wrap:
break-word`, because that is what the editor's `<textarea>` uses and the two must not drift. Spaces
are PRESERVED; trailing spaces HANG; a word too wide for its own line is split between CODE POINTS
after first moving to a line of its own.

**0b. `render/textbox.ts` OWNS THE BOX-SIZING RULE. THREE READERS, NO SECOND COPY.**
`extent.ts` (the committed box), `renderer.ts` (the alignment box), `editor.ts`/`main.ts` (the LIVE
box while typing). No set size → the measurement; set size and the text is BIGGER → the measurement
(**a text box never crops**); set size and the text is SMALLER → `autoresize` decides. **WIDTH IS
ASYMMETRIC ON PURPOSE:** a numeric `width` is also the WRAP width, so it is a FLOOR never a ceiling.

**0c. THE TWO MEASURED SLOTS ARE ONE MEASUREMENT (D-123 clause 2).** `measureTextBox`
(`primitives/text.ts`, private) owns the read set, the failure ladder and the single `measure` call.
Failure order: upstream `ErrorValue` → `#MEASURE` (no real measurer, D-118) → `#TYPE` (unusable
style) → `#TYPE` (non-finite width OR height) → the box.

**0d. A HAND-BUILT `text` FIXTURE PUSHED THROUGH `mutate` NEEDS ALL THREE DERIVED PLACEHOLDERS.**
D-018 refuses a missing `measuredWidth: { kind: "derived", value: null }`. `autoresize` may be
omitted (it reads as `true`). **A hand-built `image` fixture needs NO derived placeholder** — that
schema declares none.

**0e. `DEFAULT_TEXT_*` (`command/commands.ts`)** — `width`/`height` `"auto"`, **`autoresize` `true`**,
font `"sans-serif"`, fontSize `16`, lineHeight `20`, color `"black"`, align `"left"`.
**`DEFAULT_IMAGE_*` (same file)** — width `100`, height `100`, opacity `1`, source `""`.

**0f. THE MEASURER IS BUILT, WIRED, AND REVIEWED (0133).** `main.ts:start` builds `evalContext` over
a SECOND offscreen 2D context and threads it through `executeCommand` / `pointerMove` /
`loadDocument`. **As of 0160 it builds a THIRD measurer object over that same context**
(`sourceMeasurer`), used ONLY by the in-place editor's live box.

**0h. `content` IS `literal`-ONLY (D-122).** The guard is `isTextContentTarget` in
`command/commands.ts`'s `buildSlot`. **`image`'s `source` is NOT** — see 0img.

**0i. THE IN-PLACE EDITOR, AS OF 0153 (0160 changed only what it is MEASURED by).**
`render/editor.ts` is pure geometry: `editorTargetAt` picks the receiver via `hitTest`;
`editorPlacement` returns `left`/`top` in **CSS pixels**, `width`/`height` in **WORLD units**, and a
`scale` `main.ts` applies as one `transform: scale(...)`. **That split is what makes the browser
break lines where the canvas does — do not pre-multiply them again.** `editorTextBoxSize` is the
LIVE box from `textbox.ts`'s rule; `CARET_ALLOWANCE` (2 units) is added only for a NON-wrapping box.

`main.ts`'s pure half: `commitTextContent` (ALWAYS a literal `set`), `commitTableCell`, `editorSeed`,
`abandonCreatedTextBox` (D-136 clause 2), `commitPanelChoice`. All go through `runPanelCommand` →
`executeCommand` — NO second write path (Rule 2, re-verified at 0157).

**0j. `render/handles.ts` — the eight resize grabbers.** `hasResizeHandles` is **`text` OR `image`**
(0175) — the two types whose size IS two ordinary literal slots; a shape is parametric and a table
is `rows`/`cols`. `resizeHandleAt` is a SCREEN-space test, so a grabber is one size at every zoom.
`constrainBoxToRatio` is the `preserveAspect` half: one scale, applied to both of the START box's
sides, anchored at the edges the grabber did not move.

**0k. A RESIZE IS ABSOLUTE, NOT INCREMENTAL.** Each step recomputes from `ResizeState.startExtent`
plus the total delta. **A HEIGHT drag on a `text` box also writes `autoresize: false`.**
0157-REVIEW recorded this as a call not to "fix". **WHICH SLOTS a drag writes is now per type** —
`interaction.ts`'s `resizePlanShape`: `text` writes `TEXT_WIDTH/HEIGHT_PATH` and drops
`autoresize`, `image` writes `IMAGE_WIDTH/HEIGHT_PATH` and never touches `autoresize`. **A
ratio-kept drag writes BOTH sides even from a side grabber**, because that is what keeping a ratio
means.

**0l. `InteractionState` HAS THREE FIELDS: `selectedObjectIds`, `drag`, `resize`.**

**0n. `mutation.ts` HAS SEVEN OPERATION KINDS — `clearSlot` JOINED AT 0155.** It REMOVES the slot at
an address (D-047 makes an ABSENT cell slot the empty cell). **Legal ONLY at a table cell.**

**0o. `clear <address>` IS A COMMAND, AND IS NOT IN §5.10.** Added at 0155 under the human's standing
leave. **An already-empty cell SUCCEEDS and mutates nothing.**

**0p. `editorSeed` USES THE AUTHORING FORM, NEVER `describeSlotValue`.** `cellLiteralSeed` is the
deliberate INVERSE of `buildCellCommand`, and **the two must be changed together**.

**0q. `renderDocument` TAKES THE WHOLE `EditorTarget`, NOT AN OBJECT ID.** A `text` receiver is
skipped WHOLE; a `table` keeps everything but the ONE edited cell's value.

**0r. A TABLE'S A1 HEADERS ARE NEVER SUPPRESSED** (`drawTableHeaders`, 0155). Letters come from
`address.ts`'s `indexToColumnLetters` — the SAME function `formatCellReference` uses (D-010).

**0m. A SLOT WITH A CLOSED VALUE SET IS DECLARED ON THE SCHEMA** (`ObjectSchema.slotOptions`) —
`text`'s `style.align` and `autoresize` are the only two today. The option's DOM value is its
**INDEX**. **Only a `literal` row gets a drop-down**; a boolean echoes as `TRUE`/`FALSE`.

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s `describe` "PHASE 4'S ACCEPTANCE CRITERION" (7 tests).**
Do not weaken; do not fold. **PHASE 5'S is `main.test.ts`'s Phase 5 gate `describe` (6 `it`s over one
`gateDocument()`, entry 0163).** Same standing.

**2. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112).** Neither may be "fixed".

**3. THE PANEL IS BUILT AND REVIEWED — DO NOT RE-BUILD IT.** D-094/D-100/D-101/D-106/D-102/D-107.

**4. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** Every
DECISION behind it is in an exported pure function that is tested.

**6. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` not
bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable. Fix in `findInvalidTableResizes`.

**8. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, NEVER CACHED (D-114
clause 4).** A broken span becomes an `error`-kind `Block` (D-115); its parsed branches live in
`orphaned`. **This is a DIFFERENT parse from `markdown.ts`'s and they must not be merged** — one
resolves values, the other chooses fonts.

**9. `evaluateDerivedSlot`'s `read` RUNS THE D-110 COERCION BEFORE THE D-013 MEMBERSHIP CHECK
(D-114 clause 3).** Do not swap them.

**10. `resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR with no
compiler link (D-119).** Change one → change both, same cycle, log names both.

**11. A broken embedded span is marked `!` in place (D-116 parse / D-117 runtime), never blanks the
box; `evaluateBlockTree` always returns a `string`.**

**12. `EvalContext` IS THREADED PER CALL, NOT STORED (0132, reviewed 0133).**

**13. `TABLE_TYPE`, `TEXT_TYPE` and — as of 0175 — `IMAGE_TYPE` live in `graph/node.ts`.** Import
one, never a bare `"table"`/`"text"`/`"image"` literal in an equality check (D-009). `IMAGE_TYPE`
exists because two NON-switch sites compare against it now (`handles.ts`'s `hasResizeHandles`,
`interaction.ts`'s `resizePlanShape`); a `switch` over the whole `ObjectType` union still needs no
constant and uses none.

**14. D-137: A FILE'S HEADER IS PART OF THE DIFF THAT CHANGES ITS BEHAVIOUR.** `NOT DONE HERE` is
the likeliest to be wrong — it goes stale by the file getting BETTER. **NEVER insert a declaration
between a doc comment and what it documents.** 0165 obeyed it at `schema.ts` (two places),
`parser.ts` (two) and `commands.ts` (three, two of which were stale COUNTS — "all four handlers",
"the four types below").

## Next — the phase is open and nothing is built

**Phase 7 is the last phase and it is an ACCEPTANCE TEST, not a feature list.** Its own words:
*"Build by hand from primitives, via the command line. No new features should be needed — if
something is impossible here, that is a real gap worth fixing."*

**Suggested first slice: walk the road network by hand and write down what stops you.** Not code
— a list. Every step of the criterion, typed at the command line, with the refusal message where
there is one. That is one cycle, it produces the phase's actual work plan, and it is exactly the
check whose absence cost Phase 6 five reports (see the head of this file).

**What is already known to be missing**, from reading rather than from trying:
- **`polyline` does not exist at all** — no schema entry, no creation command, no extent, no hit
  test, no renderer arm, and no per-vertex drag (§5.9). Its first file fires **§6.1 trigger 2**
  (first file of a new subsystem), so expect a review point there.
- **`explode`, `addvertex`, `delvertex`** are in `COMMANDS_SPECIFIED_BUT_NOT_BUILT`. The criterion
  does not obviously need them — a polyline whose endpoints are BOUND is not an exploded one —
  but D-090's prompt-sequence work and §5.9's vertex drag sit next to them.
- **Binding a polyline endpoint to a circle's centre** needs `circle`'s `centroid.x`/`centroid.y`
  derived slots (they exist) and a vertex address to bind TO (does not exist). That addressing
  question is load-bearing and is the one most likely to need a ruling rather than a guess.

**Do NOT start by building `polyline`.** Walk the criterion first; the walk decides what shape the
polyline work has to take, and Rule 5 says build the dumbest thing that satisfies it.

Cheap adds, still owed, not blocking: a direct `link text_1.origin.y <cell>` test (0137-REVIEW
§honesty). **D-109 clauses 1–2** (cell decimal precision + no cell-text clipping,
`render/renderer.ts` only) still need no ruling. **Q-017** headers remain the human's.
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
D-121 + D-122 · **0137-REVIEW** the `text` command; Q-022/Q-023 CLOSED · **0139-REVIEW** text
rendering; D-123, Q-024 answered · **0142-REVIEW** `measuredWidth`; Q-024 CLOSED; D-126 + D-127 ·
**0144-REVIEW** the in-place editor (D-125); D-128 · **0145-RULINGS** D-129 + D-130 + D-131 ·
**0148-REVIEW** editor-polish; D-132 + D-133 · **0150-REVIEW** `text`-by-pointing (D-124); D-134 ·
**0151-RULINGS** D-135 + D-136 · **0157-REVIEW** the whole 0152–0156 batch; **D-137** ·
**0158-RULINGS** D-138 (the wrap residual, accepted); Q-025 raised · `src/render/markdown.ts` (0159)
· the wiring — `layOutText` replacing `layOutLines`, `renderer.ts`'s `drawText` painting runs and
aligning by arithmetic, `main.ts`'s `sourceMeasurer` (0160) · hanging indents for wrapped list items
(0161) · **0162-REVIEW** the 0159–0161 batch; **D-139** (Q-025 closed) · Phase 5 gate test (0163) ·
**0164-REVIEW** the Phase 5 gate — CLOSED, ACCEPT WITH EDITS · §5.7's `image`, headless, + Q-026
(0165) · **0166-REVIEW** entry 0165 ACCEPTED WITH EDITS; **D-140** (the `source` slot ratified) and
**D-141** (Q-026 closed, option (a)) · D-141 clause 7's data-model slice — `GraphObject.ports`,
`derivedSlots` widened to `static`/`dynamic` groups, `AddPortOperation`/`RemovePortOperation`,
`ports` serialize/deserialize (0167) · **0168-REVIEW** entry 0167 ACCEPTED WITH EDITS (the
`isLegalPortName` grammar fix; no new ruling) · D-141 clause 7's own next slice —
`engine/script/stub.ts` (`ScriptNode`/`evaluateScriptOutput`, path constants, `in.*`/`placeholder.*`/
`out.*` dynamic-group enumerators, `out.<port>`'s compute), `SCRIPT_SCHEMA` wired into the registry,
§5.10's `script x= y=` command (0169) · **0170-REVIEW** entry 0169 ACCEPTED, no edits, no new ruling
· Phase 6's ✅ criterion claim (0171) · **0172-REVIEW** the Phase 6 gate — **REVISE, gate REFUSED**;
the ✅ line CONFIRMED passing by two independent mutation checks; **D-142** (the human's ruling that
`image` must load and render first).

**PHASES 0–5 ARE DONE.** Do not reopen the text pipeline to "add more" to it — anything new belongs
to a fresh slice with its own scope statement.

## Built this batch, not yet reviewed

**Nothing.** Entries 0178/0179 were reviewed at 0180-REVIEW, which also fixed three stale headers
and strengthened one of their tests. Phase 7 starts a fresh batch at 0/3.

## Reviewed but NOT yet seen on screen

**Nothing.** The human confirmed the whole of Phase 6 on screen on 2026-09-07 — `image` steps 1-5
and the script half, ports linking and driving geometry — and the screenshot is in that turn of the
log. Entry 0169 remains unseeable by construction (pure engine work).

This section exists because "the operator cannot see what you can see" has cost this project two
phase gates. Keep it honest: anything visual built and not yet looked at belongs here.
## Not started

**`polyline` — the whole subsystem, and Phase 7's largest piece.** No schema entry
(`getObjectSchema("polyline")` returns `undefined`, deliberately and tested), no creation command
(`COMMANDS_SPECIFIED_BUT_NOT_BUILT`), no extent, no hit test, no renderer arm, no per-vertex drag
(§5.9). **Its first file fires §6.1 trigger 2.** · `explode`/`addvertex`/`delvertex` ·
D-090's prompt-sequence preview · `style` slots as authorable · point-in-polygon fill hit-testing
(D-067) · §5.4's formula bar · D-088 clauses 2–4 · D-089 · D-102 clause 9 · **D-109 clauses 1–2**.

(§5.8's script node RENDERING and its `addport`/`removeport` mechanism were here until entry 0179.
Both are BUILT — D-146 overturned D-142 clause 3 and pulled them into the Phase 6 gate.)
## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–13, 16–21, 23–24 unchanged and open unless noted.

1. **DONE at entry 0112**, reviewed 0113.
2. **Give the missing-slot refusal a remedy.** Message only; narrowed by D-110 to clause 6's cases.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE.**
4. **`zoom`'s refusal names `Infinity`.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged.**
6. **A middle-drag pan started outside the canvas is untested.** Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** (D-091). Owned by the `style`-slots cycle.
8. **The screen-space chrome constants are untuned** (Rule 5). `handles.ts`'s
   `RESIZE_HANDLE_SIZE_SCREEN` / `_TOLERANCE_SCREEN` / `MIN_TEXT_BOX_SIZE`, `editor.ts`'s
   `CARET_ALLOWANCE`, and `renderer.ts`'s `TABLE_HEADER_*` all join this list. **`measure.ts`'s
   heading scale does NOT** — it is CSS's own, not a tuned number (D-138 clause 4). **0165's
   `DEFAULT_IMAGE_WIDTH`/`_HEIGHT` (100) ARE untuned picks and DO join it.**
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return.** Harmless —
   `drawObjectChrome` sets all three explicitly. **`drawText` now also leaves `ctx.font` on the last
   run it drew**, which is the same harmless shape.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED.**
11. **A display-only panel's `overflow: auto` scroll resets on every paint.**
12. **A right-flipped panel that hits the right clamp overlaps its own object.** Correct per D-094.
13. **`insertTableLine`/`deleteTableLine` are not bounded by `MIN`/`MAX_TABLE_LINES`** — **D-104**.
14. **0110-REVIEW's F1–F4 — BUILT (0111), REVIEWED (0113).** Closed. **Q-016** carries F3's tail.
15. **F5 — CLOSED at 0156, reviewed 0157.**
16. **F6 — a panel row's text can no longer be mouse-selected.** D-095 governs.
17. **F7/F8 — ruled D-109. F8 BUILT (0117), REVIEWED (0119); F7 (clauses 1–2) NOT BUILT.**
18. **F9 — CLOSED in the same review.**
19. **F10 — CLOSED, ruled D-112.**
20. **F11 — open, no owner.** Shrinking a table's extent under a formula reading an empty in-extent
    cell is REFUSED. Correct per D-110 clause 6.
21. **F12 — open, DO NOT RE-LITIGATE.** `MIN(B1, B2)` vs `MIN(B1:B2)` on empty in-extent cells.
22. **F13 — RULED D-122, BUILT (0136), REVIEWED (0137). CLOSED.**
23. **F21 — CLOSED**, WIDENED at 0141 (D-123 clause 2).
24. **F22 — CLOSED in the same review.**
25. **F23 — CLOSED at 0156, reviewed 0157.**
26. **F24 — CLOSED at 0156, reviewed 0157.** **D-127's lesson stands: a ruling deferred work to a
    trigger that had already fired 24 entries earlier.**
27. **F25 — RULED D-129, BUILT (0146/0147), REVIEWED (0148) → D-132. CLOSED.**
28. **F26 — RULED D-130, FIXED (0147), REVIEWED (0148) → D-133. CLOSED**, confirmed on screen.
29. **F27 — RULED D-131, BUILT (0146), REVIEWED (0148). CLOSED.**
30. **F28 — RULED D-135, BUILT (0152). CLOSED, and SUPERSEDED at 0153.**
31. **F29 — RULED D-136, BUILT (0152). CLOSED and CONFIRMED ON SCREEN 2026-09-02.**

## Known problems (detail lives where the pointer says)

- **A LONG PORT NAME OVERFLOWS THE SCRIPT BOX.** `factor`/`result` fit in 140 world units;
  `average_speed` will not. Fixing it properly means measuring, which `extent.ts` cannot do (see
  Gotchas). Cosmetic; disclosed at entry 0179.
- **NOTHING DRAWS A WIRE** between a bound `in` port and the cell driving it. §5.8 asks for a
  labelled box and not for wires, so this is not a defect — but an operator looking at a canvas of
  nodes expects one, and entry 0179 is the first render where the absence is visible.
- **`removeport` HAS NO `force`.** `delete <object> force` exists because §5.1.1 gives whole
  objects a repair path; §5.8 asks for none for a port, so an operator whose out port is
  referenced must `unlink` the dependent first. Deliberate, possibly annoying.
- **A PORT CANNOT BE RENAMED.** `removeport` + `addport` loses any binding on an in port. §5.8
  names no rename and entry 0178 did not invent one.
- **THE PANEL SHOWS PORTS BUT CANNOT DECLARE ONE.** `props` and the properties panel both
  enumerate a script's ports now (entry 0178), but declaring one is keyboard-only — D-146 clause 2
  kept a port-declaring panel control out because it collides with **Q-014**, which is the human's
  alone. That seam is worth their eye.
- **`constrainBoxToRatio` BREAKS THE RATIO AT THE FLOOR.** It clamps width and height to
  `MIN_RESIZE_BOX_SIZE` INDEPENDENTLY, so a very elongated box dragged to its minimum ends up 8x8
  and square rather than 8-by-its-ratio. Reachable (a 200x20 box dragged fully in), harmless, and
  noticed at 0176-REVIEW rather than fixed — the fix is to clamp the SCALE instead of the sides,
  and it belongs to whichever cycle next opens that function. Not worth its own cycle.
- **RE-PICKING IS THE PANEL'S `source` ROW ONLY.** There is no command word for it (§5.10 names
  none, and inventing one is §8's last bullet), so an image whose panel is dismissed or whose
  `source` is formula-driven cannot be re-picked without re-selecting it or unlinking first.
  Deliberate, and much narrower than the hole entry 0173 left.
- **`constrainBoxToRatio` STILL KEEPS THE BOX'S RATIO, NOT THE PICTURE'S — now deliberately
  (D-144 clause 6), no longer an open call.** Entry 0175 flagged it; the human ruled the fix at
  0176-REVIEW and it landed as the TOGGLE's restore rather than as a change to the drag: with
  D-144 in force the box already carries the picture's shape whenever the toggle has just been
  turned on. Pointing the drag itself at `pictureAspect` would make a box JUMP at drag start, which
  is worse than the case it fixes. **The one path that still ends in a distorted box with the flag
  ON is a typed `set image_1.width`** — the operator asked for it, and re-choosing the drop-down
  option straightens it.
- **`props image_1` AND THE PANEL DESCRIBE `source` DIFFERENTLY** — the command line shows the
  elided base64 (`describeSlotValue`), the panel shows `"JPEG picture · about 194 KB"`
  (`main.ts`'s `describePictureSource`). Two readings of one slot, which this codebase usually
  refuses. `describeSlotValue` is generic over `Value` and does not know an object's TYPE, which is
  why the summary lives in `main.ts`; making it type-aware is a bigger change than the note asked
  for. **0176-REVIEW's opinion, since entry 0175 asked for one: LEAVE IT.** The two readers answer
  different questions — `props` prints a slot's VALUE for a reader who may be about to retype it,
  the panel row labels a control the operator is about to CLICK. Making `describeSlotValue`
  type-aware to unify them would push object-type knowledge into a formatter that is deliberately
  generic over `Value`, which is a worse split than the one it closes. Not a defect; do not
  "fix" it.
- **THE PROPERTIES PANEL BUILDS THE WHOLE DATA URL AS A STRING ON EVERY PAINT** — the `source` row's
  `editSeed`, which must stay unelided (D-107/F3). Only while an image is SELECTED, and only a few
  hundred KB per pointer move; Rule 5 says do not optimise, so 0173 did not. Named here so it is
  known rather than discovered.
- **DRAGGING AN IMAGE DEEP-CLONES A MULTI-MEGABYTE DOCUMENT PER POINTER MOVE.** Unmeasured. Strings
  are immutable and `cloneObjects` should share them by reference, but if dragging an image is
  visibly laggy this is the first place to look — and §5.9's own perf note applies: **throttle to
  animation frames, NEVER write outside the mutation API.**
- **AN IMAGE WHOSE FILE WAS NOT A PICTURE, OR WHOSE PICKER WAS DISMISSED, DRAWS AN EMPTY FRAME AND
  SAYS NOTHING.** `images.ts` remembers the failed decode and never retries; there is no error badge
  for it, because no `ErrorValue` is involved — the `source` slot holds a perfectly valid string
  that simply does not decode. Deliberate; a badge would need a render-layer error channel that does
  not exist.
- **A `script` OBJECT IS INVISIBLE, UNSELECTABLE, AND UNREACHABLE FROM THE COMMAND LINE FOR PORTS.**
  `script x= y=` creates a real, schema-conformant, correctly-evaluating node (entry 0169, reviewed
  and ACCEPTED at 0170-REVIEW) — but `render/`/`extent.ts`/`hittest.ts` have zero `script`-specific
  code (same posture `image` had pre-0165), and no command declares a port; every test that wires one does so through
  raw `mutation.ts` operations. `command/props.ts` also does not summarise its two dynamic
  non-derived families (`in.*`/`placeholder.*`) — see that file's own header.
- **A `script` PORT'S NAME AND ITS VALUE MUST BE ESTABLISHED IN THE SAME (OR AN EARLIER) BATCH ONCE
  ANYTHING DEPENDS ON IT.** `out.<port>`'s dependencies are literal addresses over `in.*` plus its
  own `placeholder.<port>` — D-047's range exception does not apply — so `addPort` alone (name only)
  leaves a dangling reference the instant an `out` port exists. Not a defect; `mutation.ts`'s own
  doc comments already said the pairing was required. Entry 0169 is what made it load-bearing.
- **A TEXT BOX THAT USES MARKUP CHANGES SIZE WHEN THE EDITOR CLOSES** — the overlay is measured
  from raw source, the canvas from the rendered text. A box with NO markup is unaffected. **The
  human answered this on screen (Q-025 (a), 2026-09-03): the shrink-on-open is WANTED — "ideal and
  works well as implemented"** (D-139). A PROPERTY, not a problem. Do not try to remove it.
- **A CENTRED OR RIGHT-ALIGNED LIST ITEM'S CONTINUATION IS ALIGNED *INCLUDING* ITS INDENT.** The
  hanging indent (0161) lives inside the line's own width, which is what makes `measuredWidth`
  cover it. Consistent and harmless; §5.6 does not say what a centred list should look like.
- **A CODE SPAN CAN SWALLOW AN EMPHASIS CLOSER** (`` *a `b* ` c* ``), leaving the rest of that ONE
  line italic. Bounded to a line; not chased.
- **THE X-vs-X+1 WRAP RESIDUAL IS CLOSED AS "ACCEPTED" — D-138. DO NOT TRY TO FIX IT.** No epsilon,
  no fudge factor, no rounding step in `layOutText`/`measure`, no `letter-spacing`/`word-spacing`/
  `font-kerning` on `.text-editor`, no per-platform branch. **Adopting a further *specified* CSS rule
  is the one legitimate move** — 0154's CSS wrap rules, 0160's flanking rule and heading scale are
  the three precedents — and it must name the rule at the site. Reopen only on D-138 clause 5.
- **OBJECT NAME LABELS AND TABLE ROW/COLUMN HEADERS READ SMALL BESIDE RENDERED MARKDOWN.** The
  human saw this on 2026-09-03 and **decided against changing it** — *"I wouldn't change that for
  now. Keep as is."* A DECIDED NON-CHANGE, not an open defect: do not "fix" it.
- **THE A1 HEADERS ARE GREY (`#6b7280`), NOT THE TITLE'S NEAR-BLACK.** One constant to revert.
- **THE HEADERS ARE NOT CLICKABLE.** Deliberately not invented.
- **A string cell holding `"42"` seeds `42` and commits back as the NUMBER 42.** Excel's own
  behaviour under D-125 clause 3.
- **A panel with a focused `<select>` stops updating its other rows** until it is blurred.
- **A freshly-created `text` object opens its editor UNSELECTED** (D-136 clause 4 leaves it).
- **`text 30,40` (unquoted, comma) places a box at (30,40) with empty content** (entry 0149).
  **`image 30,40` does the same for an image** — the identical point-shorthand path — and, as of
  0173, also opens the file picker on it.
- **THE EDITOR SHOWS RAW SOURCE; THE CANVAS DRAWS `resolvedContent`, NOW WITH MARKUP RENDERED.**
  Two deliberate differences, not one.
- **The cell editor does not reproduce `TABLE_CELL_TEXT_PADDING`'s 4-unit inset, and left-aligns a
  number cell** — deliberate. `editor.ts`'s NOT DONE HERE.
- **The properties panel and the in-place editor can overlap** at small window sizes. No remedy.
- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header.
- **The JOURNAL's `Operation` payloads are still unvalidated beyond `Array.isArray` + a raw
  illegal-number walk.** Nothing replays the journal. Named in `document.ts`'s own header.
- **A loaded document can carry a `formula`/`derived` `content` slot on a `text` object** (D-122
  blocks the command path, not the loader).
- **BOTH measured slots are `#MEASURE` for a `text` object created in a test** (default
  `NULL_EVAL_CONTEXT`), so its box falls back to `textbox.ts`'s 240×20 there.
- **`measure.ts` and `renderer.ts` fall back DIFFERENTLY for an unusable `style.*` slot.** Disclosed
  in both headers; unfixed — one shared set of fallbacks needs a ruling on which file owns them.
  **D-123 clause 5 forbids fixing it from the renderer's side.** `render/editor.ts` is a THIRD
  reader of that set (mirrors by value: 16 / 20 / "sans-serif" / 14).
- **`extent.ts` trusts the stored measurement; `renderer.ts` re-lays-out with its own `ctx`.**
  D-123 clause 5: the box follows the text, never the reverse.
- **An empty-`content` `text` object is invisible AND unselectable** (D-066). D-136 clause 2 removes
  an abandoned one.
- **`x`/`y` are OPTIONAL for the `text` command (default `0`, D-121 clause 3)** but REQUIRED for
  `circle`/`polygon`/`rect`/`table`/**`image`**.
- **`DEFAULT_TEXT_*` and `DEFAULT_IMAGE_*` style/size values are the handler's provisional pick** —
  no ruling, no tag.
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion.
- **`findIllegalSlotClears`'s doc says "a `createObject` EARLIER in the same batch" while the code
  scans the whole operations array.** Left alone at 0157 on purpose (§4).
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses 2–4
  not built. **No command history** (**D-089**, queued).
- **Every pointer move repaints the canvas, and every EDITOR keystroke does too.** Rule 5's accepted
  trade — it is what grows the box.
- **`measure.ts`'s candidate-width loop is O(line²) measure calls**, as it always was (Rule 5), and
  markdown adds a parse per layout. Nothing is cached (D-114 clause 4's posture).
- **`escape` is bound to the window.** The in-place editor's own keydown `stopPropagation`s.
- **`zoom`'s echoed line names the REQUEST; `main.ts` adds a second line with the RESULT** — D-082 c5.
- **`format.ts`'s elision does not re-parse** — a disclosed round-trip exception.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046).
- **SETTLED at 0118 — do not re-raise.** A bare reference to an EMPTY in-extent cell reads `0`, gets
  no edge (**D-110**).
- **`text.test.ts`'s `expectError` helper is unused** — kept deliberately.
- **SIX §5.10 commands have no registry entry** — `polyline`/`script`/`explode`/`addvertex`/
  `delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. (`image` LEFT this
  list at 0165.)
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are
  `describeSlotValue`'s `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade (D-077 c3).
- **`renderer.ts`'s `formatCellValue`, `props.ts`'s `describeSlotValue`, and `mutation.ts`'s
  `describeDimensionSlotValue` are three separate `Value`-to-text formatters** — deliberate.
  `main.ts`'s `cellLiteralSeed` is a FOURTH, and deliberately so.
- **`primitives/text.ts` CANNOT import `mutation.ts`** (D-119).
- **Render-layer imports:** `markdown.ts` imports NOTHING. `measure.ts` imports `markdown.ts` +
  engine leaves. `textbox.ts` imports NOTHING. `renderer.ts` imports `measure.ts` and `editor.ts`
  TYPE-ONLY, one direction. `editor.ts` imports `hittest.ts` + `extent.ts` + `camera.ts` +
  `slots.ts` + `textbox.ts` + engine leaves. No cycles.
- **Carried unchanged:** `set-formula` is a `kind` not a registry name · comment debt in TEST files ·
  mixed line endings in the WORKING TREE only (`core.autocrlf=true`) · dangling-reference messages
  name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness claim fails for `table` ·
  `describeValueType` duplicated in `functions.ts`/`eval.ts` · `rewrite`/
  `repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated beyond
  `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off ·
  `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-142**) binds **except where entries 0153/0154/0155
overruled one on the human's explicit instruction.** Those, in full:

- **D-123 clause 3 — INVERTED.** A set `width`/`height` no longer crops the text; the box grows.
  Clause 2 (one measurement, two slots) and clause 5 (the box follows the text) both STAND.
- **D-129 clause 2 / D-135 — SUPERSEDED.** `overflow: auto` and zero-layout scrollbars replaced by
  `overflow: hidden` plus a box that grows.
- **D-132's colour clause — REVERSED.** The overlay matches `style.color`. **D-132 clause 2's
  "markdown-lite does not move a glyph, so it stays unmatched" is now the LOAD-BEARING half** — it
  is exactly what 0160 relies on, and Q-025 (a) confirmed it survives.
- **D-129's zoom-scaled type style — MOVED.** `editorTextStyle` reports WORLD lengths; the scaling is
  one CSS transform.
- **§5.6's `TextBox` slot list — DEVIATED, TWICE.** `autoresize` ADDED (0153); **`overflow` REMOVED
  (0154)**. Net: eleven.
- **D-102 clause 6's panel grammar — NARROWED.** A drop-down row writes a literal directly. **Q-016
  stays OPEN** for free-text rows.
- **D-120's "no mid-word breaking" — REVERSED (0154).** `layOutText` implements CSS's `pre-wrap` +
  `break-word`. D-120's actual ruling — line-breaking lives in `render/measure.ts`, never in
  `src/engine/` — STANDS untouched, and 0160 extended it to markup for the same reason.
- **§5.10's command list — EXTENDED (0155).** `clear <address>`. **D-047 itself is RELIED ON.**

**§5.7's slot list — DEVIATED TWICE, NET SEVEN.** `source` ADDED at 0165, **RATIFIED at D-140** —
permanent, not provisional. **`preserveAspect` ADDED at 0174**, on the human's Q-027 ruling given
directly on screen; **that one is UNREVIEWED and is owed a `D-NNN`.** Both are slots §5.7's own
five-name list does not carry, and each has its reasoning at its own constant in
`primitives/image.ts`.

**D-046 STANDS.** A dimension slot is read `literal`-only and fails closed to `0`. `content`
inherits the same posture. **`image.source` does NOT** — nothing parses it, so nothing needs it to.

**D-094's fourteen clauses stand** · **D-096's four clauses stand.**

**From 0091-REVIEW:** **D-088** (clause 1 built, 2–4 queued) · **D-089** (queued) · **D-090**
(queued) · **D-091**. **From 0090-REVIEW:** D-084–D-087 implemented. Still owed: **D-074**.

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117**, **Q-021 → D-120**, **Q-022 →
D-121**, **Q-023 → D-122**, **Q-024 → D-123**, **Q-025 → D-139**, **Q-026 → D-141** — all CLOSED.
**Q-027 → ANSWERED BY THE HUMAN DIRECTLY** (on screen at entry 0173, option (b) plus a toggle;
built at 0174/0175; **a `D-NNN` is owed by the reviewer**). **Q-028 is OPEN** (raised 0175 — the
file NAME, which needs an eighth slot; a file PATH is not obtainable in a browser at all). Next
free: **Q-029**.

## Live PROVISIONAL tags and open questions

**Q-026 HAS NO TAGS AND NEVER WILL — it is ANSWERED (D-141), not deferred.** Nothing to reconcile.
`primitives/schema.ts`'s NOT DONE HERE and `command/parser.ts`'s `COMMANDS_SPECIFIED_BUT_NOT_BUILT`
still name the QUESTION; the cycle that implements D-141 replaces those pointers with the ruling.

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (×3), **`src/render/slots.ts`** (×1) and
**`src/render/editor.ts`** (×1): world units or screen pixels for stroke width / cell size / font?
Provisional (a) world units. Due with the `style`-slots cycle. **`markdown.ts` and `measure.ts`'s
heading scale add NO new site** — a scale is a ratio. **`image`'s `width`/`height` add no new site
either**: they are the same world units `rect`'s already are, and no cycle has questioned those.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (×2, `-0`): open, deferred, blocking nothing.

**Q-027's TAG IS GONE — the question is ANSWERED and RATIFIED as D-143** (the human, directly, on
screen at entry 0173: option (b), plus a toggle). Built at 0174/0175, ruled at 0176-REVIEW.
**D-144 extends it**: the picture's ratio is remembered in `pictureAspect` and the toggle going back
on restores a distorted box.

**Q-029 IS ANSWERED — D-146, option (b), by the human — and BUILT (0178/0179). No tag, and there
never could be one:** it decides what
the phase must DELIVER, not how a line of code behaves. Does the gate require the script node's
ports to be operator-declarable, and does it require §5.8's rendering? Raised at 0177-REVIEW after
walking the ✅ line through `submitLine` and finding every step refused. Read 0177-REVIEW §3 before
arguing with D-142 clause 3 — it is now OVERTURNED, and §3 is the reasoning for why.

**Q-028 IS ANSWERED as D-145 — no `fileName` slot.** It never had a tag and never will: its taken
option is "add no state". **D-145 says plainly that this is a display preference the human may
overrule**, and what it would cost if they do (one `literal` slot at pick time, `?? ""` read,
load-compatible).

**No other `PROVISIONAL` tags exist.** `grep -rn "PROVISIONAL(" src` confirms it.

## Gotchas for the next model

- **A TEST THAT ASSERTS A DIFFERENCE, A FLAG, OR A NEIGHBOURING PROPERTY WILL PASS ITS OWN
  MUTATION.** Three instances in the 0178–0180 batch, all green, all reading as though they
  pinned the claim: (1) §5.8's "outputs on the right" asserted `ctx.textAlign`, which is a
  different property from the x it is applied to; (2) the script box's "longer family, not their
  sum" asserted the DIFFERENCE between two fixtures, and `max(in,out)` and `in+out` give the same
  difference for those two; (3) 0176-REVIEW found `commitImagePicture` documenting a refusal that
  `executeCommand` never performed. **Assert the value the sentence is about.** D-016 checks are
  what caught all three — run them against the CLAIM, not against the code path.
- **A `script` node's box is FIXED geometry** (`render/slots.ts`'s `SCRIPT_BOX_WIDTH`,
  `SCRIPT_HEADER_HEIGHT`, `SCRIPT_PORT_ROW_HEIGHT`, `scriptBoxHeight`), shared by `renderer.ts`,
  `extent.ts` and `hittest.ts` so the drawn box, the click box and the extent are ONE box
  (D-066/D-010). It is NOT measured, deliberately: `extent.ts` has no `ctx` and giving it a
  `TextMeasurer` would thread through every caller. A long port name overflows the box.
- **A CRITERION THAT PASSES IN A FIXTURE IS NOT THE SAME AS ONE AN OPERATOR CAN REACH — 0177-REVIEW.**
  Phase 6's ✅ line was reported PASSING at five separate points (0171, 0172-REVIEW, 0173, 0174,
  0175, 0176-REVIEW) and is genuinely proved by tests. **Nobody had typed it into the app.** Every
  step is refused there, because the criterion test reaches past the command line into `mutate`
  with raw `addPort`/`setSlot` operations. **When a criterion is worded as something an OPERATOR
  does, walk it through `submitLine` before believing it** — that is a five-minute probe and it is
  the difference between a product and a fixture.
- **`addPort`/`removePort` NOW HAVE AN OPERATOR SURFACE: `addport`/`removeport`** (D-146, entry
  0178). The command takes the SLOT ADDRESS the port will occupy (`addport script_1.in.factor`), so
  it and the `link` that follows spell the port identically. **`addport` writes the port's slots in
  the SAME batch as its name** — that is what makes entry 0169's ordering hazard unreachable by any
  sequence of typed lines, and it is the reconciliation `mutation.ts` explicitly deferred to this
  cycle. Do not split those writes back apart.
- **A `placeholder.<port>` DELIBERATELY OUTLIVES ITS PORT** (D-146 clause 4). `removePort` drops
  `out.<name>` and not the placeholder; D-017 part 2 tolerates that on stated grounds, and it is
  what lets `removeport` then `addport` give the operator their stub value back. Entry 0178 tried
  "fixing" it in `mutation.ts` and reverted — an existing test documents this on purpose.
- **`executeCommand` IS A WRITE SEAM, NOT A GUARD — 0176-REVIEW's finding, and the most expensive
  wrong belief in this codebase's recent history.** A plain `set` on a formula-driven slot
  **REPLACES** the formula with a literal and reports `"replaced formula: = table_1.A1"` as an
  ordinary success line. It does NOT refuse. Entries 0173/0174 documented the opposite in a comment
  and in a decision, and `commitImagePicture` was therefore silently unlinking a `width` bound to a
  cell whenever a picture was chosen — with the notice discarded on top. **Any gesture that writes
  several slots must screen `slot.kind !== "literal"` itself**, which is what
  `render/interaction.ts`'s `planResize` has always done and what `main.ts`'s new
  `commitGestureWrites` now does for the non-drag gestures. Route a new multi-write gesture through
  that helper; do not hand-roll the loop again.
- **D-144: AN IMAGE'S PICTURE RATIO IS DOCUMENT STATE, IN `pictureAspect`.** Written ONLY by
  `main.ts`'s pick gesture, from the decoded natural size — so a `source` set by hand records no
  ratio and offers no restore, which is disclosed, not a defect. `0`/missing/non-finite all mean "no
  shape known", through the one `usableAspect` screen. The restore calls `renderer.ts`'s own
  `fitBitmapIntoBox` (exported for exactly this) so the box becomes the rectangle the renderer would
  DRAW — never a second ratio computation. `constrainBoxToRatio` still takes the START BOX's ratio,
  deliberately (D-144 clause 6): pointing it at `pictureAspect` would make a box jump at drag start.
- **D-142 IS THE ONE THAT CHANGES WHAT "DONE" MEANS.** A phase's ✅ line is its TEST, not the whole
  of what it must deliver: where the phase HEADING names a subsystem the brief specifies elsewhere,
  that subsystem is part of the gate. Phase 6 is waiting on `image` load + render, confirmed by the
  human ON SCREEN. Clause 3 bounds it — the heading's own words are the limit, and "Script *stub*"
  keeps §5.8's rendering out. **Where a heading and a §5 section leave scope genuinely ambiguous,
  that is a §6.1 trigger 3 stop, not a call to make alone** — entry 0171 made it alone, carefully
  and honestly, and was still overturned.
- **THE DECODED-BITMAP CACHE MAY NEVER LIVE IN `src/engine/`.** An `HTMLImageElement` is a live DOM
  object; a `Map` of them is precisely what Rule 1 and §5.5 forbid the engine to hold. The document
  stores the data URL STRING. It is `src/render/images.ts` as of 0173, INJECTED into
  `renderDocument` as an optional 9th argument rather than held by it — do not move it, and do not
  let `renderer.ts` construct one.
- **`extent.ts` CANNOT SEE WHETHER A PICTURE HAS DECODED, AND MUST NOT LEARN TO.** It is pure and
  has no cache; threading one through `objectExtent` would touch eight call sites. That is WHY an
  image's extent is its `width`/`height` slots alone and why `drawImage` strokes the box as a frame
  unconditionally — the frame is what keeps D-066 true, not a decoration. Removing the frame without
  replacing that guarantee re-creates the invisible-click-target D-066 forbids.
- **A DISPLAY FORMATTER THAT CAN RECEIVE AN `image.source` MUST NOT PRINT IT WHOLE.**
  `describeSlotValue` elides by default now; the ONE opt-out (`{ fullStrings: true }`) is
  `main.ts`'s `editSeed`, and it needs the string whole for D-107/F3's reason. A new display caller
  gets the safe behaviour for free; a new EDIT-seed caller has to know to ask.
- **`renderer.ts`'s `drawImage` RESTORES `ctx.globalAlpha` rather than setting it to 1.** Every draw
  call in that file assumes it owns nothing about `ctx` beyond what it sets itself.
- **THE OPERATOR SEEING IT IS WHAT FOUND THE DEFECT, AGAIN.** Entry 0173 shipped a square blue box
  with white bands down each side of a portrait photograph, with 1887 green tests and a carefully
  argued open question. The human's first note was that the box should fit the picture. **Its Q-027
  recommendation had framed the question as a choice between two mechanisms; the operator wanted
  both** — the box fits at load time AND a toggle keeps it fitting. When a question is about what
  something LOOKS like, "which of these two" may be the wrong shape of question.
- **`preserveAspect` IS READ `?? true` AT EVERY SITE** (`renderer.ts`, `interaction.ts`), which is
  what lets a document saved before entry 0174 load and behave as §5.7's "by default" says. D-126's
  lesson applied to a NON-derived slot. Do not tidy it into a bare read.
- **`MIN_TEXT_BOX_SIZE` IS NOW `MIN_RESIZE_BOX_SIZE`** — `image` resizes by the same grabbers, so
  the old name was a claim about one type that stopped being true at 0175.
- **A `describeSlotValue` CALLER THAT MIGHT SEE AN `image.source` MUST NOT PRINT IT WHOLE**, and the
  panel's `source` row does not call it at all any more — `main.ts`'s `describePictureSource`
  summarises instead. `props image_1` on the command line still shows the elided base64; the two
  are knowingly different, and the split is disclosed in the known problems above.
- **D-141's DATA MODEL AND ITS OWN NEXT SLICE ARE BOTH BUILT AND REVIEWED (entry 0167 →
  0168-REVIEW ACCEPT WITH EDITS; entry 0169 → 0170-REVIEW ACCEPT, no edits). THE GATE IS OPEN — DO
  NOT REBUILD** `GraphObject.ports`, `DerivedSlotGroup`, `resolveDerivedSlots`,
  `AddPortOperation`/`RemovePortOperation`, `engine/script/stub.ts`,
  `enumerateScriptInPaths`/`enumerateScriptPlaceholderPaths`/`enumerateScriptOutDerivedSlots`, or the
  `script` command — extend, don't re-derive. Options (b) (a two-level slot family) and (c) (a
  `string[]` arm on `Value`) stay REJECTED — reaching for either is re-litigating a closed question.
  `isLegalPortName` was tightened at 0168-REVIEW to match `address.ts`'s `PATH_SEGMENT_PATTERN`
  exactly — use it as-is, do not loosen it back.
- **`ObjectSchema.derivedSlots` IS PER OBJECT, LIKE `nonDerivedSlotPaths`** (entry 0167, D-141 clause
  4) — resolve it with `resolveDerivedSlots(object, schema.derivedSlots)`, never read
  `schema.derivedSlots` raw. `SCRIPT_SCHEMA`'s `out.*` (entry 0169) is now the registry's first REAL
  `dynamic` derived group, resolved against `object.ports.out`.
- **A `DerivedSlotGroup`/`NonDerivedSlotPathGroup` DYNAMIC ENUMERATOR SIZED BY A STRUCTURAL FIELD
  STILL NEEDS ITS DEPENDENCY ADDRESSES TO BE REAL SLOTS.** D-047's "empty cell in a range is fine"
  is a RANGE-only exception; a `dynamic` `DerivedSlotDependencies.resolve` returning a literal
  `Address` (as `SCRIPT_SCHEMA`'s `out.<port>` does, over `in.*` plus its own `placeholder.<port>`)
  gets the ORDINARY reference treatment — `validateIntegrity`'s dangling-reference check requires it
  to resolve, full stop. Learned the hard way at entry 0169: three pre-existing `mutation.test.ts`
  fixtures needed a `setSlot` paired with every `addPort` the moment `ports.out` was non-empty.
- **AN INERT MODULE'S TESTS AGREE WITH ITS AUTHOR.** 0159's parser passed everything and was wrong.
  0165's `image` is inert BY DESIGN, which is why it carries mutation checks it did not owe — if you
  add to it, wire it to a consumer in the same cycle.
- **D-066: DRAWN EXTENT AND CLICKABLE EXTENT ARE ONE EXTENT.** Giving a type an `objectExtent` arm
  without a `renderer.ts` arm creates a click target for an invisible object. Ship them together —
  0173 did, for `image`, and `drawImage` takes its box FROM `objectExtent` so the two cannot drift.
  **`script` is the type this still binds** the next time someone reaches for its extent.
- **THE MARKDOWN PARSER'S FLANKING RULE IS LOAD-BEARING, NOT POLISH.** If you simplify
  `opensEmphasis`/`closesEmphasis`, you reintroduce a shipped bug that 30 green tests missed.
- **`measure.ts` AND `renderer.ts` MUST MOVE TOGETHER, ALWAYS.** One `layOutText`, two readers.
- **D-138 — THE WRAP RESIDUAL IS SETTLED AND ACCEPTED. DO NOT COMPENSATE FOR IT.** Adopting a
  further *specified* rule is the legitimate move and must be named at the site.
- **D-137 IS ABOUT YOU.** When your cycle changes what a file does, its HEADER is part of your diff.
  Check `NOT DONE HERE` hardest — and check stale COUNTS in prose ("all four handlers"), which 0165
  hit twice in one file. Never insert a declaration between a doc comment and what it documents.
- **A REGISTRY-COMPLETENESS TEST GOING RED IS THE SYSTEM WORKING.** Adding one command word turned
  four of them red (parser examples, prompt forms, command sweep, unregistered types). Update them
  and NAME the §6.1 trigger 5 in your entry; do not treat it as noise.
- **THE 2026-09-02 TEXT-BOX WORK (0153 + 0154) OVERRULED EIGHT PRIOR RULINGS ON THE HUMAN'S EXPLICIT
  INSTRUCTION.** Never "correct" the code back toward one. A text box never crops, the measurer
  breaks words, and there is no `overflow` slot.
- **`render/textbox.ts` IS THE ONE BOX-SIZING RULE.** Three readers. Do not add a fourth reading.
- **THE OVERLAY IS LAID OUT IN WORLD UNITS AND SCALED BY ONE TRANSFORM.** Do not pre-multiply
  `camera.zoom / ratio` into its width or its font size again.
- **THERE ARE TWO MEASURERS AND THEY ARE NOT INTERCHANGEABLE.** The engine's honours markup; the
  overlay's does not. Handing the wrong one to `editorTextBoxSize` is a silent size defect.
- **`ctx.textAlign` IS ALWAYS `left` IN `drawText` NOW.** Alignment is arithmetic.
- **A RESIZE IS ABSOLUTE, NOT INCREMENTAL** (from `ResizeState.startExtent`), and a HEIGHT drag
  writes `autoresize: false`.
- **`InteractionState` HAS THREE FIELDS** — a hand-built one in a test needs `resize` too.
- **A DROP-DOWN OPTION CARRIES ITS INDEX, NOT ITS LABEL.** A boolean ECHOES as `TRUE`/`FALSE`.
- **A `formula` ROW NEVER GETS A DROP-DOWN** (D-040).
- **`autoresize` IS NOT A MEASURED-SLOT DEPENDENCY**, which is what keeps old saved documents
  loading. **ADDING A DERIVED SLOT IS SAFE FOR SAVED DOCUMENTS AS OF 0156** (D-126).
- **`cellLiteralSeed` AND `buildCellCommand` ARE INVERSES AND MUST CHANGE TOGETHER.**
- **A `<textarea>` soft-wraps unless you set `wrap="off"`.** **Do NOT add `white-space` to
  `.text-editor`.** `overflow-wrap: break-word` IS set there deliberately, and `measure.ts`
  implements the same rule — **that pair must be changed together or not at all.**
- **`.text-editor` may not set a font, a padding or a border** — `index.html`'s comment says why.
- **`commitTextContent` NEVER sniffs for `=`** — the whole string is one literal `set`.
- **The in-place editor is mounted in `#stage`**, not `#panels`.
- **DO NOT TRUST A RULING'S CLAIM ABOUT REACHABILITY — GREP FOR THE CALLER** (D-127's lesson).
- **`#MEASURE` is a real `ErrorCode`** (`graph/node.ts`), sixth after `#SCRIPT`.
- **The operator cannot see what you can see.** Ask for a live look before treating an authoring
  surface as done — the deciding step in six cycles running (0152–0161), and now the deciding step
  for the Phase 6 gate itself (**D-142 clause 2**: "renders properly" is settled by the human seeing
  it, never by a test asserting a `drawImage` call happened). `image` is unseen today only because it
  is unseeable — and D-142 is the ruling that this stops being acceptable.
