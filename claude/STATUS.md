# STATUS — as of entry 0172-REVIEW-phase6-gate

**PHASE 6'S GATE WAS CLAIMED (entry 0171) AND REFUSED (0172-REVIEW, verdict REVISE). PHASE 6 IS
OPEN. PHASE 7 MAY NOT BEGIN.** The ✅ line itself **PASSES** — 0172-REVIEW re-proved it with two
independent D-016 mutation checks (§2 of that entry) and read the criterion test line by line (§6).
Nothing about the `script` half is in doubt. **What refused the gate is `image`**, on a ruling the
human made directly at that review:

> **D-142 — a phase's ✅ line is its TEST, not the whole of what the phase must deliver. Where the
> phase heading names a subsystem the brief specifies elsewhere, that subsystem is part of the
> gate. Applied to Phase 6: `image` MUST be loadable and MUST render properly — confirmed by the
> human ON SCREEN — before this gate may be claimed.**

Entry 0171's scope call (that Phase 6's heading is descriptive and `image` rendering is therefore
not a precondition) is **OVERTURNED** by D-142. The entry stays in the log unedited and is not
otherwise criticised — it flagged this exact call as overturnable, in three places, and its ✅-line
proof stands and **need not be re-derived** by whoever re-claims the gate.

**D-142 does NOT pull `script` rendering into this gate** (clause 3): §5.8 is titled **STUB ONLY**,
the heading's own word is "Script *stub*", and its gate clause is engine-side and passes. `image`'s
heading word carries no such narrowing and §5.7's four sentences are almost entirely about loading
and drawing. Do not fold the two together.

STATE: **GREEN**. Both configs compile, **1844/1844** tests pass, 0 skipped, 0 `.only`.
**35 test files.** `npx vite build` clean. (Re-verified independently at 0172-REVIEW §1.)

Current phase: 6 — script stub + image (**OPEN — gate refused at 0172-REVIEW; `image` load+render
is what it is waiting on**)
Phase 6 acceptance criterion: *"`script_1.in.factor` is bound to a cell, `polygon_1.radius` is bound
to `script_1.out.result`, and changing the placeholder output value moves the polygon — with no
script-specific code in `eval.ts`"* — **PASSING, CONFIRMED BY THE REVIEWER** (0172-REVIEW §2 and §6).
Two mutation checks, both red as predicted and both reverted: (1) `evaluateScriptOutput`'s body
forced to `return null` → `expected null to be 10`; (2) the `placeholder.<port>` address dropped from
`scriptOutDependencies` → the predicted D-013 `#REF`. Check (1) is the reviewer's own and is the
stronger of the two — it neutralises §5.8's SEAM rather than its dependency plumbing. The "no
script-specific code in `eval.ts`" clause is grep-clean for the fourth independent time (0169,
0170-REVIEW, 0171, 0172-REVIEW). **The criterion passing is NOT sufficient for the gate — see D-142.**
Last review point: **0172-REVIEW-phase6-gate** (**REVISE** — the gate is refused; the ✅ line is
confirmed).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files**

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

## THE ONE THING TO READ FIRST — D-141 clause 7 IS FULLY BUILT AND REVIEWED

§5.8 makes `script.in.*` and `script.out.*` per-OBJECT slot families whose members are named by the
operator. **This codebase has nowhere to store that list of names**, and the gap is structural, not
an oversight of any past cycle:

- **Not a slot value.** §5.1's `Value` union is `number | string | boolean | Point | Point[] | null |
  ErrorValue`. No list-of-strings arm. So no `literal` slot can hold `["factor", "speed"]` the way
  `table`'s `rows` holds `8`.
- **Not the slot keys.** `graph/node.ts`'s header and `mutation.ts`'s both state D-010's consequence:
  "There is no sanctioned inverse — never `key.split('.')`". A `dynamic` `enumerate(object)` may not
  scan `Object.keys(object.slots)` for `in.*`.
- **Not a count plus positions.** The criterion names `script_1.in.factor`. The NAME is operator data.

And a second gap the same ruling must close: **`ObjectSchema.derivedSlots` is a fixed list per TYPE**,
read at **seven** non-test sites (`mutation.ts` ×3, `document.ts` ×2, `graph/eval.ts`,
`command/commands.ts`, `command/props.ts`), while `out.*` is per OBJECT. D-018 requires a
`derived`-kind slot at every declared derived path, so today a per-object `out.*` cannot be expressed
in either direction.

**Q-026 IS ANSWERED — D-141 (0166-REVIEW), option (a). Read the ruling, not this summary, before
building.** Its seven clauses in one breath: port NAMES are structural, ORDERED, name-only state on
`GraphObject` (D-046's scope note already left that door open); a name with a `.`, an empty name or a
duplicate is REJECTED at mutation time; `ports.out` is the SINGLE authority for the out-port name set
and §5.8's `placeholders` holds VALUES only, reconciled two-way in D-018's shape;
`ObjectSchema.derivedSlots` widens to `static`/`dynamic` groups resolved against the OBJECT, never
against `Object.keys(object.slots)` (D-010); a port set changes only through a new `Operation` kind,
and removing an out port something references is REJECTED, never silently dropped. Options (b), (c)
and (d) are rejected on the record — do not re-litigate them.

**D-141 clause 7's data-model slice IS BUILT AND REVIEWED — entry 0167, ACCEPTED WITH EDITS at
0168-REVIEW** (`graph/node.ts`'s `ports` field, `document.ts`'s serialize/deserialize,
`mutation.ts`'s two new operation kinds, `primitives/schema.ts`'s `static`/`dynamic` widening,
every existing `derivedSlots` read site migrated and green).

**D-141 clause 7's OWN NEXT SLICE — `engine/script/stub.ts`, `SCRIPT_SCHEMA`, §5.10's `script`
command — IS NOW BUILT AND REVIEWED TOO, entry 0169 ACCEPTED (no edits) at 0170-REVIEW.**
`engine/script/`'s first file fired its own §6.1 trigger 2 review point; it has cleared. **The gate
is open** — build further on `script/`/`SCRIPT_SCHEMA` freely. Read entry 0169's own log for the
full account, especially "Decisions I made" (the `placeholder.<port>` family and why `out.<port>`'s
dependencies had to include it, both independently re-derived and confirmed at 0170-REVIEW §4) and
the finding above (the in.*/placeholder.* real-slot requirement, traced to its actual mechanism at
0170-REVIEW §5).

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

**0img. AN `image` OBJECT HAS SIX SLOTS AND DRAWS NOTHING.** `origin.x`/`origin.y` (imported from
`primitives/geometry.ts`, NOT re-declared — the same identity D-121 gave `text`, which is what makes
the per-component origin drag reach an image with no image-specific code), `width`, `height`,
`opacity`, `source`. **No derived slots at all.**
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
- **`DEFAULT_IMAGE_WIDTH`/`_HEIGHT` are `100`, not `"auto"`.** `text`'s `"auto"` works because a
  measurer answers it; §5.7's equivalent is the decoded bitmap's NATURAL size, which no engine slot
  can see. The file-picker cycle is free to write the natural size over these.
- **A CREATED IMAGE IS INVISIBLE AND UNSELECTABLE, and D-140 clause 4 says that is CORRECT as
  shipped.** `extent.ts`, `hittest.ts` and `renderer.ts` all return "draws nothing" for `image`.
  **Do not give `image` an extent before the renderer draws it** — D-066 makes drawn extent and
  clickable extent ONE extent. (0166-REVIEW corrected the comments in those three files that still
  said `image` has no schema; the arms themselves are unchanged.)

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

**0j. `render/handles.ts` — the eight resize grabbers.** `hasResizeHandles` is `text`-ONLY.
`resizeHandleAt` is a SCREEN-space test, so a grabber is one size at every zoom.

**0k. A RESIZE IS ABSOLUTE, NOT INCREMENTAL.** Each step recomputes from `ResizeState.startExtent`
plus the total delta. **A HEIGHT drag also writes `autoresize: false`.** 0157-REVIEW recorded this
as a call not to "fix".

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

**13. `TEXT_TYPE` (`graph/node.ts`) joins `TABLE_TYPE`.** Import it, never a bare `"text"` literal in
an equality check (D-009). **`image` needed no such constant** — nothing compares an object's type to
`"image"` outside the render switches that already existed.

**14. D-137: A FILE'S HEADER IS PART OF THE DIFF THAT CHANGES ITS BEHAVIOUR.** `NOT DONE HERE` is
the likeliest to be wrong — it goes stale by the file getting BETTER. **NEVER insert a declaration
between a doc comment and what it documents.** 0165 obeyed it at `schema.ts` (two places),
`parser.ts` (two) and `commands.ts` (three, two of which were stale COUNTS — "all four handlers",
"the four types below").

## Next slice — NOT a recommendation. This is what D-142 requires

**`image` LOAD + RENDER. It is the only thing standing between here and the Phase 6 gate.** Phase 7
may not begin until it lands and the human has seen it work. 0172-REVIEW §8 is the fix list; in
short, and all of it ONE slice with its own scope statement:

1. A **`renderer.ts` arm, an `extent.ts` arm and a `hittest.ts` arm, shipped TOGETHER** — D-066
   makes drawn extent and clickable extent one extent, so shipping the extent without the drawing is
   forbidden. All three sit in the "no visual definition yet" arms today
   (`renderer.ts:424`, `extent.ts:92`, `hittest.ts:204`).
2. A **decoded-`HTMLImageElement` cache with a repaint when a decode completes.** **THIS LIVES IN
   `render/`/`main.ts` AND NEVER IN `src/engine/`** — an `HTMLImageElement` is a live DOM object and
   a `Map` of them is exactly what Rule 1 and §5.5 forbid the engine to hold. The document stores
   the data URL STRING and nothing else. **The cache and the async repaint are the real design
   question here** — where live render state lives, and what re-triggers a paint.
3. **§5.7's file picker, as a `CommandEffect`** — follow `load`'s own precedent exactly:
   `commands.ts` returns the effect (`CommandEffect` at `commands.ts:212-217`), `main.ts`'s
   `performEffect` owns the DOM half.
4. **§5.7's "preserve aspect ratio by default"** — a real specified clause, not decoration, and the
   one part with no ruling behind it. `DEFAULT_IMAGE_WIDTH`/`_HEIGHT` are `100`/`100` and the
   natural size of a decoded bitmap is what that clause actually needs. If honouring it requires the
   decoded natural size to reach a SLOT, that is load-bearing — **raise Q-027, do not guess** (§7).
5. **Then get it on screen and have the human confirm it** (D-142 clause 2 — "renders properly" is
   settled by the human seeing it, not by a test asserting a `drawImage` call happened), **and only
   then re-claim the gate** in a new entry, citing 0172-REVIEW §2 and §6 for the ✅ line rather than
   re-deriving it.

**NOT in that slice, explicitly:** `script` rendering (a labelled box with ports) is its OWN
unscoped future slice — D-142 clause 3 keeps it out of this gate, and nothing in 0169 touches
`render/`. It needs a real `addport`/`removeport` UI mechanism too, or ports stay reachable only via
raw `mutation.ts` operations (§5.10 names no grammar for either command; do not invent one under
§8's last bullet without a real need naming it). `command/props.ts`'s D-077 walk not summarising
`script`'s two dynamic non-derived families (`in.*`/`placeholder.*`) is disclosed in that file's
header and is also not this slice's to fix.

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

**Nothing.** Entry 0171 has been reviewed (0172-REVIEW). The tree is byte-identical to `21066c7`
plus this review's documentation changes; 0172-REVIEW's own two mutation checks were both reverted
and the tree re-verified clean afterwards. 0/3 cycles, 0 lines / 0 files since the last review.

## Reviewed but NOT yet seen on screen

Nothing REVIEWED is unseen. Entry 0169 (reviewed at 0170-REVIEW) is unseeable by construction —
pure engine work, no render file touched, a `script` object draws nothing (the same posture `image`
still has). Entry 0161's hanging indent, the last visual item, was confirmed on screen 2026-09-03.

**The next thing to reach this section will be `image` itself, and D-142 makes the human's look at
it a precondition of the Phase 6 gate rather than a courtesy.**

## Not started

**`image` RENDERING, HIT-TESTING AND §5.7's FILE PICKER — THE PHASE 6 GATE IS WAITING ON THIS**
(D-142). See "Next slice" above; it is no longer an optional adjacent item. ·
§5.8's script node's RENDERING (a labelled box with input ports left, output ports right — §5.8's own
words). The schema/stub/command are BUILT AND REVIEWED as of entry 0169/0170-REVIEW — this item is
specifically the `render/`/`extent.ts`/`hittest.ts` work, plus a real `addport`/`removeport` UI
mechanism (§5.10 names no command-line grammar for one, so this may not be "just add a command").
**D-142 clause 3 keeps this OUT of the Phase 6 gate** — §5.8 is a STUB ONLY section. ·
D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar · D-088 clauses 2–4 · D-089 · D-102 clause 9 ·
**D-109 clauses 1–2** · Phase 7.

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

- **AN `image` OBJECT IS INVISIBLE AND UNSELECTABLE — AND AS OF D-142 THIS IS WHAT IS BLOCKING THE
  PHASE 6 GATE.** Six correct slots, round-trips, renameable, `props`-able, `link`-able,
  `delete`-able — and it draws nothing, and nothing can load a picture into it. Deliberate and
  disclosed at 0165, and D-140 clause 4 still says that was correct AS THAT CYCLE SHIPPED IT; D-142
  says it is not a gate-passing state. The render arm, the extent, the cache and the picker are one
  cycle, not four footnotes. **Do not add the extent alone** (D-066).
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
  **`image 30,40` does the same for an image** — the identical point-shorthand path.
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

**§5.7's slot list — DEVIATED (0165), AND THE VERDICT IS IN: RATIFIED at D-140.** `source` ADDED, a
sixth slot §5.7 does not name — permanent, not provisional. (This line read "AWAITING A VERDICT, NOT
SETTLED" for six entries after D-140 had already settled it, contradicting 0img's own correct note
above; corrected in passing at 0172-REVIEW.)

**D-046 STANDS.** A dimension slot is read `literal`-only and fails closed to `0`. `content`
inherits the same posture. **`image.source` does NOT** — nothing parses it, so nothing needs it to.

**D-094's fourteen clauses stand** · **D-096's four clauses stand.**

**From 0091-REVIEW:** **D-088** (clause 1 built, 2–4 queued) · **D-089** (queued) · **D-090**
(queued) · **D-091**. **From 0090-REVIEW:** D-084–D-087 implemented. Still owed: **D-074**.

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117**, **Q-021 → D-120**, **Q-022 →
D-121**, **Q-023 → D-122**, **Q-024 → D-123**, **Q-025 → D-139**, **Q-026 → D-141** — all CLOSED.
Next free: **Q-027**, and the `image` slice above names the one thing likely to need it (whether a
decoded bitmap's NATURAL size must reach a slot for §5.7's "preserve aspect ratio by default").

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

**No other `PROVISIONAL` tags exist.** `grep -rn "PROVISIONAL(" src` confirms it.

## Gotchas for the next model

- **D-142 IS THE ONE THAT CHANGES WHAT "DONE" MEANS.** A phase's ✅ line is its TEST, not the whole
  of what it must deliver: where the phase HEADING names a subsystem the brief specifies elsewhere,
  that subsystem is part of the gate. Phase 6 is waiting on `image` load + render, confirmed by the
  human ON SCREEN. Clause 3 bounds it — the heading's own words are the limit, and "Script *stub*"
  keeps §5.8's rendering out. **Where a heading and a §5 section leave scope genuinely ambiguous,
  that is a §6.1 trigger 3 stop, not a call to make alone** — entry 0171 made it alone, carefully
  and honestly, and was still overturned.
- **THE DECODED-BITMAP CACHE MAY NEVER LIVE IN `src/engine/`.** An `HTMLImageElement` is a live DOM
  object; a `Map` of them is precisely what Rule 1 and §5.5 forbid the engine to hold. The document
  stores the data URL STRING. This is the single easiest way to fail Rule 1 in the `image` cycle.
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
- **D-066: DRAWN EXTENT AND CLICKABLE EXTENT ARE ONE EXTENT.** Giving `image` an `objectExtent` arm
  without a `renderer.ts` arm creates a click target for an invisible object. Ship them together.
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
