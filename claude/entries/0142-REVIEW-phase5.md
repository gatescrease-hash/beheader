# 0142 — REVIEW (phase 5): entry 0141's `measuredWidth` — D-123 built, Q-024 reconciled
Date: 2026-09-02   Phase: 5   Model: Opus 5 (reviewer)
Reviewing: entry 0141-measured-width (1 cycle, 429 added / 118 removed across 14 source+test files)
Previous review: 0139-REVIEW-phase5 (ACCEPT WITH EDITS)

Verdict: **ACCEPT.** No reviewer edits to source. Two new binding rulings, both from probes, both
about the LOAD boundary and neither a defect in this cycle's code: **D-126** and **D-127**.

## Verification (re-run, not read)

```
$ npx tsc --noEmit                          -> clean, exit 0
$ npx tsc -p tsconfig.engine.json --noEmit  -> clean, exit 0
$ npm test                                  -> Test Files 30 passed (30)
                                               Tests    1482 passed (1482)
$ grep -rnE "\.(only|skip|todo)\(" src      -> no matches
$ git status --porcelain                    -> clean
$ git diff --numstat 4c0f330 HEAD -- src    -> 14 files, 429 added, 118 removed
```

The pasted output is real. `1482/1482`, 30 files, zero skipped, zero `.only`, both configs clean —
all confirmed independently. The diff accounting (429 / 118 / 14 files) is exact to the line, and
the §6.3 file cap is correctly reported as exceeded.

**One number in the log does not survive checking.** Entry 0141 writes "1469 → 1482 tests (+13)".
The baseline is **1466**, pasted in entry 0138 and re-verified in 0139-REVIEW; I re-ran the suite at
`4c0f330` in a throwaway worktree to be sure, and got 1466. So this cycle added **16** tests, not
13, and the per-file breakdown is off too (`text.test.ts` gained 7, not the 8 claimed; hittest's
"4+1" is right at 5; mutation 3; commands 1 — 16 total). Every one of those 16 is real and passing;
nothing was lost or renamed away (19 added `it(` lines, 3 of which are retitles of surviving tests).

This is an **under-claim, not an over-claim**, and it changes nothing about the work. It is still a
finding, because it is the one place in the entry where a number sits beside a pasted transcript
without having been derived from it — the pasted `npm test` block is trustworthy, the arithmetic
beside it was written from memory of a figure that never existed. The honesty audit exists to catch
exactly this asymmetry, in whichever direction it points.

## Rule audit

- **Rule 1 (no DOM/canvas in `engine/`)** — upheld, checked mechanically.
  `grep -rE "document\.|window\.|canvas|CanvasRenderingContext|from \"\.\./render"` over
  `src/engine` (non-test) returns six hits, all of them `document.formatVersion` /
  `document.nextObjectId` / `document.objects` — the local `Document` parameter, not the DOM global.
  `primitives/text.ts` imports `graph/node.ts`, `eval-context.ts`, `primitives/table.ts` and a type
  from `primitives/schema.ts`; no render import. The measurement still arrives through the injected
  `TextMeasurer`, which is the whole point of the rule and the reason `measuredWidth` could be built
  at all.
- **Rule 2 (mutation-only state change)** — upheld. No slot assignment anywhere in the diff
  (`grep "^\+.*\.slots\[.*\] *=|^\+.*\.value *="` over the diff: nothing). Both new computes are
  pure functions of `(object, read, context)` called from the topological pass.
- **Rule 3 (addressing)** — not touched. `TEXT_MEASURED_WIDTH_PATH` is a path constant of the same
  shape as its two siblings; no address string is built by concatenation.
- **Rule 4 (one formula engine)** — not touched. Neither compute parses anything.
- **Rule 5 (dumbest correct implementation)** — upheld, and this is where the cycle made its best
  call. Two parallel five-step failure ladders would have been the "obvious" diff; one shared
  `measureTextBox` is smaller, and it makes D-123 clause 2 hold by construction rather than by two
  lists staying in step. That is the D-119 hazard declined rather than re-accepted, correctly
  reasoned in the entry's own Decisions section.
- **Rule 6 (slot set fixed during evaluation)** — upheld. The new slot is added at schema level and
  filled at creation; evaluation creates nothing. Its dependencies are `static`, so nothing is
  resolved during the pass.
- **Rule 7 (§8 deferred list)** — upheld. Markdown-lite, `overflow`, D-125 and D-124 all declared
  out of scope and genuinely absent from the diff.

## Invariant audit

- **Derived slots evaluated INSIDE the topological pass** — upheld and now pinned end-to-end.
  `mutation.test.ts`'s new edge test asserts `measuredWidth` subscribes to the same five sources as
  `measuredHeight`, computed as set equality against `measuredHeight`'s edges rather than against a
  second hand-written list. That is the right way to write that assertion: it cannot drift.
- **D-018 two-way reconciliation** — upheld, and deliberately exercised: a `text` object missing the
  `measuredWidth` placeholder is refused, with a test naming the rule. Six test fixtures were
  updated rather than the check being softened.
- **Graph state plain and serializable** — upheld. `measuredWidth` holds a `number` or an
  `ErrorValue`. `TextBoxMeasurement` is a local return type on a private helper, never stored.
- **Errors propagate, nothing throws** — upheld. `extent.ts` reads through `readNumber`, which
  narrows to `number` and returns `undefined` for an `ErrorValue`, so a `#MEASURE` width lands on
  the fallback rather than poisoning the box. Pinned by a new `hittest.test.ts` case.

## Spec conformance

- **D-123 clause 1** — same static dependency list, verified in `schema.ts` and asserted in
  `schema.test.ts` as equality between the two entries, not as a second literal.
- **D-123 clause 2** — the strongest part of the cycle. One measurement, one failure ladder, each
  compute a three-line pass-through. The pair genuinely cannot split.
- **D-123 clause 3** — `textExtent` reads `width` slot → `measuredWidth` → fallback, and both axes
  now have the identical three-source shape. The operator's set `width` still wins over a wider
  measurement, with a test that says so in those words.
- **D-123 clause 4** — the extension is documented where a reader will meet it (`schema.ts`'s
  `TEXT_SCHEMA` doc, `text.ts`'s path constants, `computeMeasuredWidth`'s own doc), each naming why
  §5.6's two-slot list is being extended rather than quietly exceeded.
- **D-123 clause 5** — respected by omission: nothing in the diff makes the renderer follow a stored
  measurement. `renderer.ts` is untouched.
- **§5.6 / §5.9 / D-066** — the payoff lands. One `objectExtent` still feeds the hit box, the
  selection highlight, the chrome anchor and `fit`, and it is now the right size for the default
  (`width: "auto"`) path.

**The one non-additive change is correct and was correctly flagged.** `computeMeasuredHeight` now
`#TYPE`s when the measurer returns a non-finite WIDTH, where it previously returned the height. The
entry declares this in its own Decisions section, in STATUS, and in a test that names the rule. It
is what clause 2 requires — the alternative is `measuredHeight` reporting a good number off a
measurement `measuredWidth` has already called broken. I checked that no existing test changed
expectation to accommodate it: the two pre-existing non-finite tests use a finite `width: 0`, and
`text.test.ts`'s diff is additions only.

## Legibility audit

Headers rewritten in the present tense, all three derived slots named, no chronology. Vocabulary
locked — slot, derived, measurement, object, extent throughout. Comments explain why and cite the
ruling as a supplement to a stated reason, not as a substitute (D-060's "Okay" tier or better
everywhere I looked). No `any`. Test names are behaviour sentences, several naming the operator
injury they defend ("a short label no longer swallows its neighbours' clicks"). `slotLabel` as a
plain string reaching only a message is the right call and is explained.

## Honesty audit

The log matches the diff everywhere except the test arithmetic above. Both §6.1 triggers and §6.2
are called correctly and none is soft-pedalled; trigger 5 is claimed in its narrow sense and is
accurate — `schema.test.ts`'s expectation moved 2 → 3 derived slots because the schema did, and six
fixtures gained a placeholder because D-018 requires one. No test was weakened. The renamed
`hittest.test.ts` case ("still hits an auto-width text object via the provisional fallback box") is
a retitle with byte-identical assertions.

The "Where I got stuck" section is the honest kind: it volunteers that nobody has looked at the new
box on screen, and that the `measure.ts` / `renderer.ts` fallback divergence is now slightly more
visible and still unfixed. Both are true and both are correctly left alone.

Minor: the entry says "Test fixtures (six files)" and then names five — `hittest.test.ts` is the
sixth. Cosmetic.

## Findings

**F23 — a derived-slot addition invalidates every previously saved document, and nobody knew.**
Probed. A document saved at entry 0140 containing a `text` object is refused on load:

```
text_1.measuredWidth is missing — deriveEdges still emits an edge into it,
pointing at a slot that does not exist (D-018)
```

`serializeSlot` writes `{ kind: "derived" }` — the value does not serialize, but the KEY does, and
the loader treats the file's key set as authoritative. **D-120**'s rationale and **D-123**'s
reversibility argument both assert the opposite ("no stored document can depend on the answer"). The
reading is half right and has now been acted on twice without a probe. This is not entry 0141's bug
— the refusal is D-018 working as designed, and a named refusal is much better than a dangling edge
— but it is entry 0141's undisclosed consequence, and `save`/`load` are both operator-reachable.
Ruled **D-126**: the loader reconstructs the schema's declared derived slots instead of trusting the
file, `formatVersion` is not bumped, D-018's check is untouched, and every future derived-slot cycle
states the load consequence in one line.

**F24 — D-108 is parked behind a trigger that already fired, twenty-four entries before it was
written.** D-108 clause 3 defers the loader's malformed-AST throw to "the cycle that builds §5.11's
file input," on the stated grounds that "`loadDocument` has no caller outside tests." `main.ts`'s
`openDocument` — a real file picker calling `loadDocument` — has existed since **entry 0089**, and
`save`/`load` are live registry entries. I probed all four shapes D-108 clause 1 names:

```
ast-null                    -> THREW TypeError: Cannot read properties of null (reading 'type')
binaryOp-null-children      -> THREW TypeError: Cannot read properties of null (reading 'type')
binaryOp-absent-children    -> THREW TypeError: Cannot read properties of undefined (reading 'type')
functionCall-args-not-array -> THREW TypeError: ast.args.some is not a function
```

Worse than documented: `openDocument` calls `loadDocument` inside `file.text().then(...)`, so the
throw is an unhandled promise rejection — no refusal, no log line, no feedback. The operator picks a
file and the program does nothing. Meanwhile clause 3 forbids anyone from hardening it piecemeal.
Ruled **D-127**: the premise is corrected, D-108's clauses 1/2/4 stand unchanged, and both this and
D-126 are assigned to one named load-hardening cycle in `document.ts` — **after** D-125 and D-124,
which the human ruled ABSOLUTE PRIORITY and which nothing here reorders.

Both findings are pre-existing or systemic. Neither changes this cycle's verdict.

## Open questions

- **Q-024 → D-123. CLOSED.** Reconciliation verified, not just claimed: `grep -rn "PROVISIONAL" src`
  returns only Q-008 (`graph/node.ts` ×2) and Q-012 (`renderer.ts` ×3, `slots.ts` ×1). All three
  Q-024 tags are gone, including the one in `hittest.ts`'s header that a narrow grep of `extent.ts`
  would have missed. `TEXT_AUTO_BOX_WIDTH`/`_HEIGHT` survive as ordinary documented constants, which
  is what clause 3 permits.
- **Q-008** (`-0`) and **Q-012** (world units vs screen pixels) — unchanged, still deferred, still
  blocking nothing.
- **Q-016**, **Q-017** — unchanged, both the human's, neither blocking.
- **No new question raised, and none was owed.** Next free: **Q-025**.

## Noted, not findings

- **`measuredWidth` of `0` falls through to the 240 fallback**, because the guard is `> 0`. Reachable
  only for a `text` object with non-empty `resolvedContent` whose style is `#TYPE`, where
  `measure.ts` returns a zero box — the divergence 0139-REVIEW already disclosed and D-123 clause 5
  forbids fixing from the renderer's side. Unchanged by this cycle; still needs a ruling on which
  file owns the style fallbacks, and still nobody's this week.
- **Nobody has looked at the new box on screen.** The entry says so itself. Everything here is
  engine-side or through `objectExtent`. A human clicking beside a short text label is the check
  neither the implementer nor I can perform, and it is worth doing before the Phase 5 gate.
- **`schema.test.ts`'s new assertion compares `derivedSlots[2]` to `derivedSlots[1]` by index.** It
  would keep passing if a fourth derived slot were inserted between them. Fine today, and the
  adjacent literal-path assertion pins the order; worth a note only if that list grows again.

## Verdict

**ACCEPT.**

A small, exactly-scoped cycle that did what D-123 ordered and made one design call better than the
ruling required: the shared `measureTextBox` turns clause 2 from a rule someone has to remember into
a property the compiler enforces. The one non-additive behaviour change was found, reasoned about,
disclosed in three places and pinned by a test, which is the standard this process is trying to
produce. The test-count arithmetic is wrong in the cycle's own disfavour and worth correcting, not
worth an edit list.

Phase 5 remains OPEN, and the human's order stands: **D-125** (in-place text entry) next, then
**D-124**, then markdown-lite + a markup-aware measurer in one cycle, then `overflow`, then the gate
test. The load-hardening cycle (**D-126** + **D-127** + D-108's owed reconciliation) slots in after
D-124 and before the gate — it is `document.ts`, so it reports `REVIEW: REQUIRED`.
