# 0165 — The `image` primitive, headless; and Q-026, which blocks the script node
Date: 2026-09-03   Phase: 6   Model: claude-opus-5
Previous entry: 0164-REVIEW-phase5-gate   Last review: 0164-REVIEW-phase5-gate (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~320 lines / 9 files changed so far (src only: 235 added / 20 removed across 8 files, plus one new 85-line file).

## Declared scope

Build §5.7's `image` primitive through the engine and command layers only: `primitives/image.ts`,
`IMAGE_SCHEMA`, and §5.10's `image x=0 y=0` command with D-072's one-step prompt sequence. Raise the
load-bearing question §5.8 leaves open about where a script node's port list lives, since it cannot
be answered without a ruling. Nothing else.

## Explicitly not in scope

- **Drawing an image, hit-testing it, or the §5.7 file picker.** `render/extent.ts`,
  `render/hittest.ts` and `render/renderer.ts` all already carry an `image` arm that returns "draws
  nothing"; all three are untouched, so a created image is invisible and unselectable. Deliberate,
  and disclosed at `createImage`'s own doc comment: D-066 makes drawn extent and clickable extent
  ONE extent, so giving `image` an extent before the renderer draws it would break that rule to
  produce a click target for something nobody can see. The decoded-bitmap cache and the async
  repaint it needs are a design question of their own and deserve their own scope statement.
- **Anything script-shaped.** Q-026 is raised, not answered, and no `PROVISIONAL(Q-026)` tag exists
  anywhere. `script` stays in `COMMANDS_SPECIFIED_BUT_NOT_BUILT`.
- **Aspect-ratio preservation (§5.7).** It needs the decoded bitmap's natural size, which is
  `render/`'s and is not graph state. Named in `primitives/image.ts`'s NOT DONE HERE.
- **The still-owed cheap adds** STATUS lists (the direct `link text_1.origin.y <cell>` test, D-104,
  D-109 clauses 1–2). Untouched — §4's scope discipline.

## What I did

**NEW `src/engine/primitives/image.ts` (85 lines)** — §5.7's slot paths and nothing else.
`IMAGE_WIDTH_PATH`, `IMAGE_HEIGHT_PATH`, `IMAGE_OPACITY_PATH`, `IMAGE_SOURCE_PATH`. No compute
function, because §5.7 asks for no computed value. `origin.x`/`origin.y` are deliberately NOT
declared here — they are `primitives/geometry.ts`'s `ORIGIN_X_PATH`/`ORIGIN_Y_PATH`, D-121's
reasoning for `text` applied unchanged, which is what makes `render/interaction.ts`'s per-component
origin drag and `link image_1.origin.x <cell>` work with no image-specific code anywhere. The
`width`/`height` constants ARE declared here rather than imported from `RECT_WIDTH_PATH`, following
`primitives/text.ts`'s own precedent: the path STRING is the same word across types on purpose, but
a constant named for `rect` has no business being read as an image's.

**`src/engine/primitives/schema.ts`** — `IMAGE_SCHEMA`: one `static` non-derived group of six paths,
`derivedSlots: []`. Registered in `SCHEMAS`. Header updated at two places (D-137): the scope
paragraph now says `image` has an entry, and NOT DONE HERE names Q-026 as what `script`'s entry
waits on rather than saying "Phase 6" as though the work were merely unstarted.

**`src/command/parser.ts`** — `CreateImageCommand` (`kind`, `x`, `y`), its `Command` union arm, and a
registry entry: `image x=<number> y=<number>`, two required named numbers, no positional, no flags.
D-072's prompt sequence is one `point` step, the same shape `text`'s takes. `image` LEAVES
`COMMANDS_SPECIFIED_BUT_NOT_BUILT` in this same cycle, as that list's own doc comment requires; the
comment and the file header both now say so.

**`src/command/commands.ts`** — `DEFAULT_IMAGE_WIDTH`/`_HEIGHT`/`_OPACITY`/`_SOURCE`, `createImage`,
its `executeCommand` arm and its `COMMANDS_WITH_HANDLERS` entry. Header IMPLEMENTS line gains §5.7.
Two comments this cycle's work made false were corrected (D-065): `createObjectFromCommand`'s "all
four handlers share" and its "unreachable for the four types below".

**Tests (5 files).** `schema.test.ts`: `image` leaves the not-yet-registered list and gains a real
entry test (six static paths, in order, no derived slots, every group `static`). `parser.test.ts`:
§5.10's own `image x=0 y=0` in `DOCUMENTED_EXAMPLES`. `prompt.test.ts`: the pointed form in
`EQUIVALENT_FORMS`, so D-072 clause 3's both-forms-agree claim covers it. `commands.test.ts`: the
line in `EVERY_REGISTRY_EXAMPLE` and in the `createdObjectId` sweep, plus four behaviour tests —
all six slots at their values, `link image_1.origin.x table_1.A1` committing (which is the SCHEMA
entry's proof, since only a declared path may hold a formula slot under D-017), an out-of-range
`opacity` accepted, and `image x=0 y=0 w=50` refused by the parser. `document.test.ts`: an `image`
round-trips — which now means satisfying D-018's two-way reconciliation, because before this cycle
an `image` object had no schema and `validateIntegrity` skipped it entirely.

## Decisions I made

1. **`source` is a sixth slot §5.7's own list does not name.** §5.7 enumerates five slots and then
   says the data URL is "stored in the document". A `GraphObject` is `{ id, name, type, slots }`, so
   "in the document" can only mean "in a slot"; §5.1's `Value` admits `string`; and §5.6's `content`
   is already exactly this shape. This is a **brief deviation (§6.1 trigger 3)** and is why the
   review verdict below is REQUIRED. Reasoned at length at `IMAGE_SOURCE_PATH`'s doc comment and
   again on `IMAGE_SCHEMA`.
2. **`source` is NOT narrowed to `literal` the way D-122 narrows `text.content`.** D-122's reason was
   that a formula-driven `content` hides embedded references from edge derivation. Nothing parses a
   data URL, so a formula-driven `source` reading a URL out of a cell tracks its dependencies through
   the ordinary edge set and needs no guard. Fewer mechanisms, not more.
3. **`opacity` is unbounded as document state.** D-070 bounds COUNTS because a count decides how many
   slots get allocated and Rule 6 leaves no later moment for an `ErrorValue` to stand in. `opacity`
   sizes nothing. The renderer clamps what it paints, the posture `style.align` already takes. Pinned
   by a test so a later cycle does not "fix" it into a refusal.
4. **The command takes §5.10's two arguments and no more.** No `w=`/`h=`; `set image_1.width 200`
   reaches them. §8's last bullet forbids command-language gold-plating, and a stray `w=` is now a
   parse failure rather than a silently ignored token.
5. **`DEFAULT_IMAGE_WIDTH`/`_HEIGHT` are 100, not `"auto"`.** `text`'s `"auto"` works because a
   measurer answers it; §5.7's equivalent answer is the decoded bitmap's natural size, which no
   engine slot can see. A plain number the operator can immediately change is Rule 5's dumbest
   correct answer, and §5.7's file-picker cycle is free to write the natural size over it.
6. **Q-026 gets no provisional choice.** Every option shapes the data model, the mutation sequence,
   or the schema registry, which PROCESS_BRIEF §7 clause 3 puts out of reach of a tagged guess.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(no output — clean, both configs, D-006)

$ npm test
 Test Files  34 passed (34)
      Tests  1789 passed (1789)
   Duration  1.62s
(0 failed, 0 skipped; `grep -rn "\.only|\.skip" src --include=*.test.ts` returns nothing)

$ npx vite build
✓ 40 modules transformed.
dist/index.html                 10.56 kB │ gzip:  3.89 kB
dist/assets/index-04sjQQ5h.js  123.67 kB │ gzip: 36.77 kB
✓ built in 412ms
```

**Mutation checks (not owed — no acceptance criterion is claimed this cycle — run anyway, because
STATUS's own gotcha says an inert module's tests agree with its author).** Two neutralisations, one
at a time, each reverted before the next, tree confirmed identical after:

| neutralised | tests turned red | anything else red |
|---|---|---|
| `image: IMAGE_SCHEMA` commented out of `SCHEMAS` | 5, named: the `image` schema entry test, the six-slot creation test, the `link image_1.origin.x` test, the opacity test, and the `createdObjectId` sweep | no |
| `ORIGIN_X_PATH` dropped from `IMAGE_SCHEMA`'s path list | 2, named: the `image` schema entry test and the `link image_1.origin.x` test | no |

The second is the sharper one: creation still succeeds without the declaration (an undeclared
LITERAL slot is legal state — D-049's own note), and it is the `link` that fails, which is exactly
what D-017 says the schema entry buys.

## Acceptance criteria status

**Phase 6 criterion: "`script_1.in.factor` is bound to a cell, `polygon_1.radius` is bound to
`script_1.out.result`, and changing the placeholder output value moves the polygon — with no
script-specific code in `eval.ts`" — NOT YET, and BLOCKED on Q-026.** No part of it is claimed. §5.7's
`image` is the phase's other half and has no acceptance criterion of its own; it is built headless.

## Where I got stuck / what is unfinished

**I could not start the script node at all, and the reason took most of the cycle to find.** §5.8's
`in.*`/`out.*` are per-object slot families, and this codebase has nowhere to store the list of port
NAMES: `Value` has no list-of-strings arm, and D-010's "no sanctioned inverse" forbids reading them
back out of `GraphObject.slots`' keys. Separately, `ObjectSchema.derivedSlots` is a fixed list per
TYPE read at seven non-test sites, so a per-object `out.*` set cannot be expressed in either
direction. Both are in Q-026. I stopped rather than guessing, per §7 clause 3.

**The `image` object I built is invisible.** It has six correct slots, round-trips, is renameable,
`props`-able, `link`-able and `delete`-able, and draws nothing at all. That is honest and disclosed
in three places, but it is also exactly the shape STATUS warns about ("an inert module's tests agree
with its author"), which is why I ran the mutation checks above unprompted. The wiring that would
make it non-inert — a renderer arm, an extent, a file picker — is a cycle, not a footnote, and
splitting it here was the alternative to shipping a half-drawn image.

**Four registry-completeness tests went red before I updated them** (`parser.test.ts`'s
example-per-command, `prompt.test.ts`'s form-per-sequence, `commands.test.ts`'s registry sweep,
`schema.test.ts`'s not-yet-registered list). Their expectations CHANGED — **PROCESS_BRIEF §6.1
trigger 5** — and I am naming that rather than letting it pass as routine. Each changed only because
the registry it mirrors grew by one entry, which is the single thing each was written to force.

**I did not verify anything on screen**, and cannot: nothing this cycle draws a pixel.

## Open questions raised

**Q-026** — where a script node's port list lives, given `Value` cannot hold a name list and a slot
key has no sanctioned inverse; and, in the same ruling, whether `ObjectSchema.derivedSlots` becomes
per-object. Provisional choice: **none — not reversible (§7 clause 3)**. Tagged at: **nowhere**;
`primitives/schema.ts`'s NOT DONE HERE and `command/parser.ts`'s not-built list name it instead.
Recommendation in the question: option (a), a structural `GraphObject` field, with `derivedSlots`
widened to the same `static`/`dynamic` group shape `nonDerivedSlotPaths` already carries.

## Review point

**Fired: §6.1 trigger 3 (twice) and §6.1 trigger 5.**
- Trigger 3, deviation: `source` is a slot §5.7's own list does not name (decision 1).
- Trigger 3, ambiguity: §5.8 is silent on something load-bearing — Q-026.
- Trigger 5: four registry-completeness tests changed their expectations.

Batch position, for the record: cycle 1/3, ~320 lines / 9 files (cap 800/10). §6.2's load-bearing
list IS touched — `primitives/schema.ts` — so under §6.2 no later phase may begin until this is
reviewed regardless.
