# 0136 — The `text` command: §5.10 registry entry + handler, D-121 and D-122 reconciled
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0135-REVIEW-phase5   Last review: 0135-REVIEW-phase5 (verdict: ACCEPT — D-121, D-122 issued)
Batch: cycle 1 of up to 3 since last review; ~277 source lines / 8 files changed so far.

## Declared scope

Build the `text` command (§5.10): a `command/parser.ts` registry entry (positional quoted
`content`, optional `x=`/`y=`) and a `command/commands.ts` handler creating a `text` object with
all eleven non-derived slots + both derived placeholders, moving `text` out of
`COMMANDS_SPECIFIED_BUT_NOT_BUILT`. In the same slice, reconcile **D-121** (add `origin.x`/`origin.y`
to `TEXT_SCHEMA`, move `schema.test.ts`'s expectation) and **D-122** (a guard refusing `link` /
`set =` on a `text` object's `content`).

## Explicitly not in scope

`render/renderer.ts`'s text-drawing pass, markdown-lite rendering, layout — a `text` object still
draws as nothing (`render/extent.ts` returns `undefined` for it, unchanged). The Phase 5 acceptance
criterion is NOT claimed. D-109 clauses 1–2 and Q-017 (the render-only alternative). A prompt
sequence for `text` (see "Decisions I made"). Any change to `primitives/text.ts`'s block-tree engine.

## What I did

**`src/engine/graph/node.ts`** — added `TEXT_TYPE: ObjectType = "text"`, mirroring `TABLE_TYPE`, so
`commands.ts`'s D-122 guard tests `object.type` against a definition rather than a bare literal
(D-009).

**`src/engine/primitives/schema.ts`** (§5.1, load-bearing per §6.2) — **D-121**: `TEXT_SCHEMA`'s
single `static` non-derived group gains `ORIGIN_X_PATH`, `ORIGIN_Y_PATH` at the front, imported from
`primitives/geometry.ts` (already in this file's imports for `table`/`circle`/etc.) — one spelling
across the document, no new constant, exactly D-121 clause 1. Both are ordinary `literal` slots and
NOT dependency-required: nothing derived reads them, so `findSchemaSlotKindMismatches` tolerates an
absent one the way it does for every other primitive's origin (D-121 clause 2). Updated the
`TEXT_SCHEMA` doc comment and the file header ("nine" → "eleven" non-derived).

**`src/engine/primitives/text.ts`** — doc only. The `TEXT_*_PATH` block, the NOT DONE HERE note on a
`formula`/`derived` `content` slot, and `resolveTextDependencyAddresses`'s doc all said the F13
untracked-reference gap was "owed a ruling by the `text` command cycle". Rewrote each to state the
present: **D-122** closes it — the command refuses `link` / `set =` on `content`, so `content` is
permanently `literal`-kind and no untracked-reference state is reachable by command; a loaded
document could still carry one, exactly as a loaded `formula` `rows` slot can under D-046. No code
in this file changed — the guard lives in `commands.ts` (D-122's stated placement option, and the
implementer recommendation 0135-REVIEW confirmed).

**`src/command/parser.ts`** — `CreateTextCommand` interface (`kind`, `x`, `y`, `content`), added to
the `Command` union between `CreateRectCommand` and `CreateTableCommand` (§5.10 listing order). New
registry entry `text`, `usage: text [x=<number>] [y=<number>] "<content>"`: one positional `text`
`content`, two `optionalNumber` named args defaulting to `0` (**D-121** clause 3 — unlike the
geometry presets, whose position §5.10 always writes out). Removed `"text"` from
`COMMANDS_SPECIFIED_BUT_NOT_BUILT`; updated that list's doc comment and the file header's NOT DONE
HERE.

**`src/command/commands.ts`** (§5.10 handler half) — imports for `TEXT_TYPE` and the nine
`TEXT_*_PATH` constants; `CreateTextCommand` in the parser-type import. `case "text"` in
`executeCommand`'s switch; `"text"` in `COMMANDS_WITH_HANDLERS` (before `"table"`). `createText`
handler: `createObjectFromCommand(document, "text", [...eleven literal declarations...])` — `origin.x`/
`origin.y` from the command, `content` verbatim, and eight `DEFAULT_TEXT_*` constants for
`width`/`height`/`overflow`/`style.*`. `createObjectFromCommand` fills both derived placeholders
mechanically (D-018), and `mutate` step 7 evaluates them. **D-122 guard**: `isTextContentTarget`
(type + path) plus a refusal at the top of `buildSlot`'s `case "formula"` — before `parseFormula`
runs, so both `link` and `set =` on `text_1.content` are refused with a message naming D-122 and how
to author `content` (a plain literal `set`). A literal `set text_1.content "…"` is untouched.
Updated the file header.

**Tests.**
- `command/parser.test.ts` — `text` example in `DOCUMENTED_EXAMPLES` (pins the registry-has-an-example
  test); three new: optional `x`/`y` defaulting to `0`, required `content`, markup kept verbatim.
- `engine/primitives/schema.test.ts` — the `text` slot-path expectation gains `["origin","x"]` /
  `["origin","y"]` at the front; test name "nine" → "eleven" (D-121 clause 2 reconciliation).
- `command/commands.test.ts` — `text` line in `EVERY_REGISTRY_EXAMPLE` (pins the every-word sweep);
  six creation tests (all eleven slots + defaults, `x`/`y` default, verbatim content, `resolvedContent`
  resolves in the creating mutation, `measuredHeight` is `#MEASURE` under the null context, per-type
  naming); a new `describe` for D-122 (refuses `link`, refuses `set =`, fires before the parse,
  accepts a literal `set`, a formula-looking quoted string stays literal, other `text` slots
  unaffected). Fixed a now-stale comment ("no `text` command yet").

## Decisions I made

- **`x`/`y` optional, defaulting to `0`.** D-121 clause 3 and 0135-REVIEW §7 both say so explicitly
  ("`x=` / `y=` default to `0`"). This diverges from `circle`/`polygon`/`rect`/`table`, whose `x`/`y`
  are `requiredNumber` — but a text box you type first and place later is a reasonable default, and
  the ruling is unambiguous. Recorded here because it is a visible inconsistency across the creation
  commands.
- **No prompt sequence for `text`.** `PromptStep.accepts` is `"point" | "distance" | "number"` — a
  text step would need a new `accepts` kind, a separate mechanism, not this slice. A command with no
  `prompts` is typed-form only (`parser.ts`'s `CommandSpec` doc), like every non-creation command.
  Noted in the registry entry's comment.
- **`content` positional is `text`-kind, so a bare unquoted word is accepted** (`text x=0 y=0 hi`).
  Same as `link`/`rename`'s text args. §5.10's example quotes it because it has spaces; a
  single-word content needs no quotes.
- **Guard placement: `buildSlot`'s `formula` arm, not `resolveWritableSlot`.** `resolveWritableSlot`
  is the kind-independent identity gate (unknown object, derived path, undeclared path); the D-122
  refusal is kind-dependent ("this slot may not become a formula"), so it belongs where the write
  kind is known. Both `link` and `set =` land in that one arm. This is the "one guard plus its test"
  D-122's rationale describes.
- **`DEFAULT_TEXT_*` values** (`width`/`height` `"auto"`, `overflow` `"visible"`, font `"sans-serif"`,
  fontSize `16`, lineHeight `20`, color `"black"`, align `"left"`) are the handler's provisional pick
  — §5.6 gives the `style` shape and the `overflow` enum but no defaults, and §5.10's grammar has no
  argument for any of them. `"auto"`/`"auto"` is §5.6's "no wrapping" layout, the safe default for a
  command that cannot specify a width. `lineHeight` is an absolute length, not a ratio
  (`render/measure.ts`), hence `20` beside `fontSize` `16`. No `PROVISIONAL` tag: these are
  `set text_1.<slot> …`-changeable render config, not a data-model commitment, and no open question
  covers them (the Q-016/Q-019 "no reader for a tag" reasoning).

## Verification (real output)

```
$ npx tsc --noEmit
(clean, no output)

$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npx vitest run
 Test Files  30 passed (30)
      Tests  1443 passed (1443)
   Duration  1.52s
```

0 skipped, 0 `.only`. 1427 → 1443 (+16 new tests; the 3 reconciliation-owed expectations —
`schema.test.ts`'s path list, `parser.test.ts`'s example count, `commands.test.ts`'s registry sweep
— were updated, not weakened).

## Acceptance criteria status

Phase 5 criterion ("a text box reading `Radius: {= table_x.A1 }{? … }` updates … wraps at its set
width … re-renders when a value referenced only inside the currently non-taken branch changes") —
**NOT YET.** A `text` object can now be created, carries a position, resolves its `content`, and
measures (given a real `EvalContext`) — but nothing DRAWS it. `render/renderer.ts`'s text pass,
markdown-lite, and layout are the remaining Phase 5 work.

## Where I got stuck / what is unfinished

Nothing stuck. Unfinished, and deliberately: the whole render side of Phase 5. Also — a created
`text` object is not yet hit-testable or draggable (`render/extent.ts` returns `undefined` for
`text`), so D-121's payoff (§5.9 origin-drag "works unchanged") is real in principle but untestable
until the extent/draw code lands. The `link text_1.origin.y intersection_a.centroid.y` path (Phase 7)
IS reachable now and is covered by the "other `text` slots unaffected" style test pattern, though I
tested it on `style.fontSize` rather than `origin.y` — same mechanism, and origin is the less
interesting case.

## Open questions raised

None. Q-022 → D-121 and Q-023 → D-122 were both ruled at 0135-REVIEW and are reconciled here; no
`PROVISIONAL` tags were owed (0135-REVIEW §5 clause 4, §4).

## Review point

Fired: **§6.1 trigger 5** — a test's expectations changed (`schema.test.ts`'s `text` slot-path
list gained two entries; two other pinning tests updated their counts). All three are reconciliation
D-121 explicitly ordered, not a weakening — but the trigger is objective. Also **§6.2**: `schema.ts`
and `graph/node.ts` are load-bearing and now carry unreviewed changes.

Batch: cycle 1/3, diff ~277 source lines / 8 files (cap 800/10).

REVIEW: REQUIRED
Reason: §6.1 trigger 5 (changed test expectations) + §6.2 load-bearing `schema.ts` / `graph/node.ts`
changes; D-121 slot-set membership on a load-bearing schema wants a rule-audit before Phase 5's
render work builds on it.
Questions for reviewer:
  1. `TEXT_SCHEMA` puts `origin.x`/`origin.y` FIRST in its non-derived path list (matching
     `TABLE_SCHEMA`). D-121 clause 1 does not fix an order — is front-of-list right, or should it
     trail the §5.6 slots?
  2. `x`/`y` optional-defaulting-to-`0` for `text` (per D-121 clause 3) is a visible inconsistency
     with the four other creation commands. Confirm that is the intended reading of the ruling and
     not something to revisit.
  3. The `DEFAULT_TEXT_*` style values are the handler's pick with no ruling and no `PROVISIONAL`
     tag. Is that the right call, or does one of them (the font, particularly) want to be flagged?
