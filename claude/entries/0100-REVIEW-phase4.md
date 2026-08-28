# 0100 — REVIEW (phase 4): entry 0099 ACCEPTED, and the human's first real session with the tool
Date: 2026-08-28   Phase: 4   Model: Claude Opus 5 (reviewer)
Reviewing: entry **0099** (D-094's read-only properties panel), the diff `0bd7964..0089ed3`
Previous review: 0098-REVIEW-phase4 (ACCEPT WITH EDITS)
Verdict: **ACCEPT.** No edits made to entry 0099's code.

**This review has two halves and the second one is bigger.** The first is the ordinary audit of
entry 0099. The second is the human's report from actually driving the application — four notes and
one bug — which becomes **D-097 through D-103** and sets the next four cycles. The bug is a real
one, reproduced here four different ways, and it is not in the panel.

---

## 1. Rule audit

| Rule | Status |
|---|---|
| 1 — no DOM/window/canvas/`render/` in `engine/` | **Upheld.** Grepped the whole of `src/engine/`: every hit for `document.`/`window.`/`canvas`/`render/` is inside a comment or is `document.ts`'s own `document` PARAMETER. No import crosses the line. |
| 2 — all state change through `mutation.ts` | **Not touched.** Entry 0099 writes nothing. `updatePanel` is a read and a DOM write; `render/panel.ts` is arithmetic. |
| 3 — two-layer addressing | **Not touched.** The panel displays `slotKey(descriptor.path)`, a path from the schema, never a parsed name. |
| 4 — one expression evaluator | **Not touched.** |
| 5 — dumbest correct implementation | **Upheld**, and disclosed where it costs something: `PANEL_OBJECT_GAP_CSS` is declared untuned and added to the fix list's item 8 by the entry itself. The panel is rebuilt whole every paint rather than diffed — immediate-mode, like the log. |
| 6 — evaluation never changes the slot set | **Not touched by 0099** — but see §4. The human found the hole in the OTHER half of D-046's guard, and it is the most serious thing in this review. |
| 7 — errors never throw | **Upheld.** `placePropertiesPanel` returns a finite placement for a non-finite ratio; `updatePanel` hides the panel for a stale id rather than resolving it. |

**Layer discipline, checked mechanically.** `render/` imports no `command/*` — grep is empty.
`renderer.ts` and `hittest.ts` still do not import each other: D-093's DAG is intact and
`panel.ts` sits inside it (`./camera.ts`, `./extent.ts`, and an `engine/` type). No `any`
anywhere in non-test source. No `.only`, no `.skip`, no `it.todo`.

## 2. Invariant audit

Nothing in this diff evaluates, mutates, derives an edge, or touches the graph. The one invariant
entry 0099 could have broken is D-010 ("one reading of a question"), and it does not: the panel's
placement goes through `camera.ts`'s own `worldToScreen` rather than a second copy of the
transform, and its rows come from `command/props.ts`'s `buildSlotDescriptors` rather than a second
schema walk. **D-094 clause 9 holds: there are exactly two readers of that enumeration.**

## 3. Spec conformance and legibility

D-094's fourteen clauses are all present and all correctly read. The two I checked hardest:

- **Clause 12 (CSS vs backing pixels)** is right, and it is right for the right reason — the ratio
  is read off the canvas (`canvas.width / bounds.width`) rather than assumed from
  `devicePixelRatio`. This project has shipped that exact bug once already, in the other direction
  (entry 0091's pan speed). `panel.test.ts` pins the conversion and the fallback for `0`/`NaN`/
  negative.
- **Clause 3 (suppress the selected object's name)** is derived inside `renderDocument` from the
  parameter it already had — no signature change, no new plumbing, and the badge and ticks
  correctly still draw with `halfName` at 0.

Headers are present, present-tense, and vocabulary-locked (slot, derived, literal, formula,
extent — no "property", no "field"). `index.html`'s comment was falsified by this cycle's own work
and was rewritten by it, which is D-065 discharged rather than deferred. Tests are named as
behaviour sentences.

**Three small observations, none of them findings, none requiring action:**

1. `updatePanel` measures the panel while it still carries its PREVIOUS `left`/`top`. Harmless as
   written — `max-width: 320px` and `max-height: 100%` make the measured size position-independent
   — but it stops being harmless if the panel ever gets a size that depends on where it sits.
2. The panel's `overflow: auto` scroll position resets on every paint, because `replaceChildren`
   rebuilds the rows. A polygon's panel is long enough to scroll. Recorded as a known problem.
3. A right-flipped panel that then hits the right clamp overlaps its own object (pinned by
   `panel.test.ts`'s own clamp test). Correct per clause 11 as written; worth the human seeing once.

## 4. Honesty audit — re-run, not read

```
$ npx tsc --noEmit                              -> exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json      -> exit 0, no output
$ npx vitest run                                -> Test Files 27 passed (27)
                                                   Tests     1191 passed (1191)
```

**Matches entry 0099 exactly**: 1191, 27 files, both configs clean, zero skipped, zero `.only`.
The four seeded mutants and their kill counts (4 / 8 / 1 / 3) are consistent with the tests as
written, including the honestly-reported single survivor on mutant 2 and the correct explanation
for it. The log matches the diff file-for-file; no silent scope expansion. Entry 0099 disclosed its
one departure from D-094 clause 11's literal argument list before being asked — **D-096 clause 1
worked on its first cycle in force.**

## 5. Entry 0099's four questions, answered

1. **The fifth `placePropertiesPanel` argument (the backing/CSS ratio) — acceptable?** **Yes.**
   Clause 12 requires the conversion in that function and the ratio is not derivable from the other
   four arguments; a ruling's list is a ceiling and its rationale governs (D-096 clause 1). The
   disclosure in "Decisions I made" is exactly the discharge that ruling asks for.
2. **`buildPanelModel` in `main.ts` rather than `render/panel.ts` or `command/props.ts` — right
   layering?** **Yes, and it stays right under D-101.** `render/*` imports `engine/*` only;
   `buildSlotDescriptors` is `command/`. `main.ts` is the one file that legitimately sees both.
   Pushing the mapping into `props.ts` would have made the enumeration know about panel rows, which
   is the coupling D-094 clause 9 was written to avoid.
3. **The thick rule rendering only when a derived group exists?** **Stands.** A rule separates two
   things; with one group there is nothing to separate. The reasoning in the entry is the right
   reasoning and needs no ruling.
4. **Anything wanted for the untested DOM half?** **The human ran the manual check, and that is the
   rest of this document.** The panel itself works — their words are "the properties tab is good."
   What the session found instead was one defect nowhere near the panel (§6) and three product
   changes (§7). The standing answer to the general question is unchanged: this project adds no test
   DOM, and `start` stays the place where a human is the test.

---

## 6. THE DEFECT — a table vanishes when its `rows` or `cols` is set, and the write reports success

The human: *"setting a table's rows or cols makes it disappear from view. I don't know where it's
getting sent to, but it's not deleted — still appears with `list` — but also isn't visible with
`fit`."*

**Reproduced, and it is worse than one path.** Against `table x=0 y=0 rows=3 cols=3`, all four of
these are ACCEPTED, all four echo a success line, and all four leave `objectExtent` returning
`undefined` — the table stops drawing, `fit` answers *"nothing on the canvas has an extent to fit
to"*, and `list` still lists it:

```
> set table_1.rows = 5     ->  "table_1.rows = 5"     rows = {kind:"formula", value:5}   extent: undefined
> set table_1.rows 0       ->  "table_1.rows = 0"     rows = {kind:"literal", value:0}   extent: undefined
> set table_1.rows -2      ->  "table_1.rows = -2"    rows = {kind:"literal", value:-2}  extent: undefined
> set table_1.rows 2.5     ->  "table_1.rows = 2.5"   rows = {kind:"literal", value:2.5} extent: undefined
> props table_1            ->  cells = "0x3 grid - 0 of 0 cells written" (literal)
```

**The cause is a half-built guard, and the half that exists is the correct half.**
`readTableDimension` fails closed to `0` for a dimension that is not `literal`, not an integer, or
negative — D-046, which is Rule 6 and is not negotiable. What is missing is a refusal at the WRITE.
`commands.ts` bounds `rows`/`cols` at CREATION only (D-070); `set` goes through the generic
`writeSlot` → `setSlot` path, which knows nothing about dimensions. The guard is therefore firing,
correctly, against a state the application itself invited the operator to build.

**Ruled as D-097**: `mutation.ts` gains `findInvalidDimensionWrites`, simulated left-to-right over
the batch like `findInvalidTableResizes` and `findInvalidRenames` already are, refusing all four
states above with a message that names the path, the value, and the rule. The check goes in
`mutation.ts` rather than in the `set` handler because D-102 is about to add a second write path
(the panel), and Rule 2 says both must hit the same gate. `MIN_TABLE_LINES`/`MAX_TABLE_LINES` move
from `command/commands.ts` to `engine/primitives/table.ts` so `engine/` can read them without
importing `command/`.

**This is the lesson entry 0099's own STATUS.md wrote down, arriving on schedule:** *"it is not
only untested code that is at risk, it is code whose tests can only check what their author was
already thinking about."* `readTableDimension`'s fail-closed `0` has a test. The path that produces
the `0` was never asked about, because everyone who looked at that function was thinking about
LOADING a malformed document, not about typing a command.

---

## 7. The human's other three notes, and what each becomes

**7.1 The drag notice spams the log → D-098.** `pointerMove` runs per pointer event and
`planComponent` emits its notice every time, so dragging a slider (a renamed circle with a fixed
`origin.x`) repeats one line per mouse sample. Ruled: **once per drag gesture**, deduplicated in
`DragState`, cleared on pointer-up. Deliberately NOT the human's suggested three-second timer — a
wall clock inside `interaction.ts` would end its determinism and force a clock into every test, and
once-per-gesture is the stricter behaviour anyway. The state D-098 adds is where a timestamp would
go if the human wants the timer after all.

**7.2 Too many significant figures in the panel → D-099.** Today a `circle x=10 y=20 r=7` shows
`centroid.x = 10.000000000000002`, `area = 152.95081246064453`, `length = 43.91167886764314`.
Ruled: at most four decimal places, trailing zeros trimmed. **The human chose panel-only**, so
`describeSlotValue` gains an optional `maxDecimals` rather than a second formatter — one switch,
two callers, `props`'s output byte-identical to today's. The clause that matters most is clause 3:
a value that is not zero but rounds to zero shows in exponential form, never as `0`. A circle
centred on the origin has a `centroid.y` of float dust, and printing `0` for it would be a lie the
operator cannot detect.

**7.3 The panel becomes an authoring surface → D-100, D-101, D-102, and Q-014 CLOSES.** The human
has now ruled the half that was always theirs. Three rulings, in dependency order, because this is
a selection-model change before it is a panel change:

- **D-100 — the selection is a list.** `selectedObjectId: string | undefined` becomes
  `selectedObjectIds: readonly string[]`. The human chose: **plain click replaces, shift-click
  adds, escape clears everything.** A click on empty canvas clears; a shift-click on empty canvas
  does not. Every selected object gets a highlight, and D-094 clause 3 generalises — every selected
  object's canvas name is suppressed, because every one of them now has a panel carrying it.
  Shift-clicking an already-selected object to REMOVE it is the reviewer's reading, not the
  human's words: raised as **Q-015**, provisionally taken, tagged.
- **D-101 — one panel per selected object, draggable by its header.** Dragging detaches the panel
  from its anchor; the manual position is application state keyed by object id, and it is
  DISCARDED when the object leaves the selection, so re-selecting re-attaches — the human's rule
  verbatim. No inter-panel collision avoidance is to be built (D-095's stance, same reasoning).
  `placePropertiesPanel` needs no change at all: it already takes the extent as an argument, which
  is exactly why clause 11 put it in `render/`.
- **D-102 — the paperclip, and one path to every write.** `pointer-events: none` is lifted (this
  amends D-094 clause 10). Every modifiable row carries the affordance; derived rows and the
  table's synthetic `cells` summary carry none. **Bold blue when the slot's kind is `formula`,
  faded grey when `literal`** — the human's choice, and the one that can never disagree with the
  `= ...` text beside it. Blue click performs `unlink`; grey click opens an input on the row.

  **The mechanism clause is the load-bearing one: every panel write is built as a `Command` and
  handed to `executeCommand`, never to `mutate` and never to `writeSlot`.** D-069 already
  guarantees one place where a `Command` meets a `Document`; honouring it means the panel adds an
  input surface and *zero* new write semantics — it inherits every refusal, including D-097's new
  one, for free, and every panel edit lands in the log exactly as if typed.

  **And clause 8, which will bite whoever builds this if it is not said now:** `updatePanel` calls
  `writePanel`, which calls `replaceChildren`, on EVERY paint — and paint runs on every pointer
  move. An open text input would lose focus, caret, and typed text on the first mouse twitch. That
  is a correctness requirement, not a performance one, and Rule 5 does not excuse it.

**7.4 Order → D-103.** D-097 first (a live defect). Then D-098 + D-099 together (small,
independent). Then D-100 (must precede the other two, review point at its end). Then D-101, then
D-102 (its own review point regardless of the batch cap — it is the first code in this project that
writes state from a mouse gesture in the DOM).

---

## 8. To the human, on "does this explode things"

**No.** The reason it does not is the thing that has been paid for over the last ten cycles and is
easy to miss from outside:

- `placePropertiesPanel` takes an extent, so N panels cost no new arithmetic.
- `buildSlotDescriptors` is the single enumeration, so N panels cost no new schema walk.
- `executeCommand` is the single write path, so an editable panel costs no new write semantics,
  no new refusals, and no new way to corrupt a document.

What the panel actually costs is the selection model (a real change, one cycle, D-100) and DOM
plumbing (two cycles, D-101/D-102). The paperclip itself is small. The one genuinely new hazard is
D-102 clause 8 — the immediate-mode rebuild that is fine for a read-only panel and fatal for an
editable one.

Your closing observation is worth recording as a finding in its own right: **the brief was written
for technical correctness and is nearly silent on use.** That is not a defect in the work; it is
the reason this session was worth more than the four reviews before it. The vanishing table had a
passing test suite of 1191 sitting on top of it.

---

## 9. Open fix list — carried forward

Numbering continues 0090-REVIEW §9. Items 1–8 unchanged and still open. Items 9 and 10 unchanged.
Added this review:

11. **The panel's `overflow: auto` scroll position resets on every paint** (§3 observation 2).
    Superseded for the editing case by D-102 clause 8, which will have to solve the general form
    of it; not worth a cycle of its own before then.
12. **A right-flipped panel that hits the right clamp overlaps its own object** (§3 observation 3).
    Correct per D-094 clause 11 as written. Revisit only if the human says so after seeing it.

## 10. Verdict

**ACCEPT.** Entry 0099 is the cleanest cycle in this project's recent history: the arithmetic is
pure and tested, the layering call is right, the one departure from its ruling was disclosed before
being asked about, and every number in its verification block is real. It is accepted without edits.

**The next four cycles are D-103's order, and D-097 goes first.**
