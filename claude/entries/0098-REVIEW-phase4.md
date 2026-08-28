# 0098 — REVIEW (phase 4): entries 0096–0097 — ACCEPT WITH EDITS
Date: 2026-08-27   Phase: 4   Model: Claude Opus 5 (reviewer)
Previous entry: 0097-props-command   Last review: 0095-REVIEW-phase4 (verdict: ACCEPT)
Reviewing: entry 0096 (`render/slots.ts` + `render/extent.ts`, D-093's split) and entry 0097
(`command/props.ts` + the `props` command, D-092 clause 4 / D-094 clause 9).
Diff reviewed: `ccb09dc..f058047` — 14 source files, 1161 insertions / 302 deletions.

## Verdict

**ACCEPT WITH EDITS.** Two doc-comment edits by me, listed in §6, no behaviour touched. One
conformance finding (§4), ratified rather than reverted, and ruled generally as **D-096** clause 1.
Entry 0097's three questions are answered as **D-096** clauses 2–4. Proceed to the properties panel
(D-094) — `props.ts`'s `SlotDescriptor` shape is accepted as it stands, so nothing in the queue's
item 1 is waiting on a shape change.

## 1. Rule audit

- **Rule 1 (no DOM in `engine/`)** — upheld. Nothing in the diff touches `engine/`'s source at all;
  the two new `render/` files and `command/props.ts` are grepped clean of `document.`, `window.`,
  `canvas` and `render/*` imports (`props.ts` imports `engine/*` only; `slots.ts` imports `engine/*`
  only; `extent.ts` imports `engine/*` and `./slots.ts`). `tsc -p tsconfig.engine.json` clean,
  which is the mechanical half of the same check.
- **Rule 2 (state changes only through `mutation.ts`)** — upheld. `props` builds no `Operation`,
  calls no `mutate`, and returns the document it was given; `commands.test.ts` pins that with a test
  rather than leaving it to inspection. `slots.ts`/`extent.ts` are reads only.
- **Rule 3 (addressing load-bearing)** — upheld, and exercised: `props.ts` never builds a path
  string, taking every `path` from the schema (and `TABLE_CELL_PATH_PREFIX` for the summary row) and
  joining only through `slotKey` at the formatting edge. `props.test.ts` renames the object a formula
  points at and asserts the reconstructed source follows the new name — the two-layer scheme,
  tested at a new reader.
- **Rule 5 (dumbest correct implementation)** — upheld, twice deliberately: the table-specific branch
  instead of a generic dynamic-group abstraction, and the declined bypass field in the shared
  formatter. Both were disclosed as choices rather than presented as the only option, which is what
  made them cheap to rule on (D-096 clauses 2–3).
- **Rules 4, 6, 7** — not touched by this diff.

## 2. Invariant audit

Nothing in this diff evaluates, derives, extracts dependencies, or mutates, so the evaluation-order
and edge invariants are not in play — one line, per §8's instruction not to restate an untouched
table. The two that ARE in play:

- **Graph state stays plain and serializable.** `SlotDescriptor` holds a readonly `string[]`, a
  string-union kind, a `Value`, and an optional string. No closure, no class, no live `Map`, no
  object reference used as identity. It is a display record, never stored, never journalled.
- **Never throws.** `buildSlotDescriptors` returns `[]` for an unregistered type, skips a declared
  path with no slot rather than assuming one, `?? null`s a missing derived value, and carries an
  exhaustiveness `never` arm. Each of those has a stated reason at the site, and the "unreachable
  today" ones say why they are kept anyway.

**D-077 — the one invariant this cycle could have destroyed.** `buildSlotDescriptors` walks
`schema.nonDerivedSlotPaths` itself rather than calling `resolveNonDerivedSlotPaths`, so a table's
`cells.*` family becomes one descriptor, never one per declared cell (0078-REVIEW measured
90,000–130,000 for a large table). This is defended by two named tests and, independently, by entry
0097's third seeded mutant — replacing the summary with a full enumeration killed 7 tests. That is
the right shape of protection for an invariant whose violation is a hang rather than a wrong answer.

## 3. Entry 0096 — the pure-move claim, checked mechanically rather than read

The entry claims the moved bodies are byte-identical. I extracted each moved declaration from
`ccb09dc`'s `hittest.ts`/`renderer.ts` and compared it to the new files:

```
export function objectExtent       DIFFERS  (one inline comment, below)
function verticesExtent            IDENTICAL
function tableExtent               IDENTICAL
export function documentExtent     IDENTICAL
export interface WorldExtent       IDENTICAL
export function readNumber         IDENTICAL
export function asPointArray       IDENTICAL
TABLE_CELL_WIDTH = 80              unchanged
TABLE_CELL_HEIGHT = 24             unchanged
```

The single difference is `objectExtent`'s inline `// Draws nothing yet (file header)` becoming
`(renderer.ts's header)` — a correction the move REQUIRED, since "file header" no longer names
the file that documents which types draw. Correct, and covered by the entry's "docs reworded for the
new home", though it sits in a body comment rather than a doc comment. Noted for completeness, not
as a finding.

The resulting graph is a DAG and the compiler agrees. Both HAZARD notes D-093 clause 3 ordered
deleted are gone rather than amended, and `renderer.ts` re-exports nothing (clause 4).

## 4. Finding — D-093 clause 1 named five declarations; four moved

`TABLE_CELL_TEXT_PADDING` (`renderer.ts:123`) stayed. **The decision is right and I have ratified
it** — it is module-private with one consumer, and moving it would export a private constant for no
second reader, against the very sentence in D-093 clause 1 that justifies `slots.ts` ("the reads
more than one file in `render/` makes"). Reverting a correct call to satisfy a list would be the
worse outcome.

**The finding is the silence.** Entry 0096 lists four moves and describes the slice as D-093's split
with "no logic change"; a reviewer counting the ruling's list against the diff finds a shortfall with
no sentence explaining it, and cannot tell a considered omission from a missed line without going and
reading `renderer.ts`. One sentence in "Decisions I made" would have cost nothing.

Ruled generally as **D-096 clause 1**: a ruling's enumerated list is a ceiling, its rationale governs
where the two diverge, and the divergence must be named in the log entry. No revision to the code.

## 5. Entry 0097 — spec conformance, `props`

Checked against D-092 clauses 4–6 and D-094 clauses 5, 7, 8, 9:

- **Every slot, with path, kind, value, and a formula's reconstructed source** (D-092 clause 4) —
  present, and the source is built by `formula/format.ts` against current names rather than by a
  second formatter (Rule 4's shape, one layer up).
- **The three kinds are legible** (D-092 clause 5) — every line ends in its kind, and a formula line
  carries both the value and the `= source`. This is the clause most likely to be normalised away
  into a bare `path = value` dump, and it was not.
- **Reads and refuses to write** (D-092 clause 6, D-075 clause 4) — no `effect`, no `mutate`, and a
  test that the returned document is the given one, unjournalled.
- **Schema declaration order, non-derived then derived** (D-094 clause 7) — the loop is literally
  that order, and it is pinned twice: at module level against `add`'s two ins then its one out, and
  end to end against a polygon's fourteen slots by path.
- **One row for a table's cells** (D-094 clause 8) — held, see §2.
- **ONE enumeration serves both readers** (D-094 clause 9) — `props.ts` returns data and formats
  nothing; `commands.ts` formats log lines from it; `describeSlotValue` is exported for the panel
  rather than copied. The panel can now be built without a second reading of the schema, which is the
  whole point of the clause.

The `descriptors.length === 0` refusal deserves a note: `props` reports "no schema" as `ok: false`
rather than an empty success. That is right — an operator who asks what an object has and gets a
blank success learns nothing — and the comment at the site correctly states that this is reachable
only for a type with no registry entry, which is a truthful "why" rather than a defensive guess.

**One edge case, recorded and NOT to be fixed on suspicion:** a table whose `rows`/`cols` slot is a
`formula` reads as `0` under D-046's fail-safe, so its summary would say "0×0 grid — N of 0 cells
written" while N cells are genuinely written. That is D-046's fail-safe behaving as ruled, visible
here rather than caused here, and `mutation.ts`'s `findInvalidTableResizes` is what keeps it rare.
Not a defect in this diff; not a fix list item.

## 6. Legibility audit, and my two edits

Headers present and correct on both new `render/` files and on `props.ts`; vocabulary locked
throughout (slot, path, kind, descriptor — no "property", no "field", and the panel is never called a
table, per D-094 clause 1); no `any`; tests named as behaviour sentences that name the rule they
defend. `props.ts`'s header discloses its own limitation (the dropped future dynamic group) in
`INVARIANTS UPHELD HERE` rather than hiding it, which is the disclosure that made D-096 clause 3
possible to rule.

**Two edits, both to `props.ts` doc comments, no behaviour:**

1. **Two "this cycle" diaries removed** (header line 22, and `describeSlotValue`'s doc). §5.4's
   D-060 half is explicit: a comment describes the present, and where it dates something it names
   the entry, never a bare "this cycle" — which is false to every reader after the next cycle. Both
   now read in the present tense; one names entry 0097 where the pointer is worth keeping. The rest
   of the codebase carries older instances of this phrase; they are pre-existing and NOT to be swept
   (D-058's stance), only fixed where a cycle opens the file anyway.
2. **`describeSlotValue`'s dropped rationale restored.** The move deleted the sentence explaining
   WHY it shows a value rather than a type name ("D-041's report is 'here is what was kept' and a
   type name would not tell the operator whether to type over it"), keeping only the contrast with
   `describeValueType`. §5.4 names rationale as the expensive knowledge a move must carry; the
   contrast without the reason tells a reader what the function is not, not why it is. Restored, plus
   one line naming both call sites now that there are two.

`tsc --noEmit` clean on both configs and 1174/1174 after my edits.

## 7. Honesty audit

Re-run, not read:

```
$ npx tsc --noEmit                              (exit 0, no output)
$ npx tsc --noEmit -p tsconfig.engine.json      (exit 0, no output)
$ npx vitest run
 Test Files  26 passed (26)
      Tests  1174 passed (1174)
```

Both entries' claimed counts match exactly (1148 at 0096, 1174 at 0097, 26 files). Zero skipped, zero
`.only`, confirmed by grep as well as by the runner. The batch-cap arithmetic in both entries is
correct and honestly reported: 0097 declared itself over both §6.3 caps AND under a §6.1 trigger and
stopped, which is the behaviour the process wants and is worth saying plainly because the alternative
— one more "small" cycle — is the failure mode §6.3 exists to catch.

Entry 0097's mutation check is real work and reported at the right grain: three mutants, each killed,
each with the kill count and the tests that did it. It is also the reason §2's D-077 paragraph is
short — the invariant is defended by a test that was demonstrated to fail when the invariant breaks,
which is stronger than my reading the loop.

The one discrepancy between log and diff is §4's, and it is an omission rather than a
misstatement — nothing either entry claims is untrue.

## 8. Open questions

No new `Q-NNN` raised by either cycle, correctly: everything both touched was already ruled by D-092,
D-093 and D-094. **Q-014's remaining half (editing slots by mouse) stays open and unruled** — D-096
clause 2 deliberately does not pre-decide its `SlotDescriptor` shape beyond naming what the editing
cycle should add when it arrives. No live `PROVISIONAL` tag was introduced; `slots.ts` carries
`PROVISIONAL(Q-012)` forward on the cell-size constants, unchanged, on the same open question.

## 9. Direction for the next cycle

Build D-094's properties panel — queue item 1, now unblocked. Its fourteen clauses stand unamended
and `SlotDescriptor` is stable, so clause 9's "render rows from the same output" can be taken
literally. The four clauses that cost the most if missed are the ones STATUS.md already names
(pure tested placement function, CSS-vs-backing pixels, suppressed canvas label, `pointer-events:
none`). It is a new subsystem's first file and a §6.1 trigger by itself — expect to stop after it.
