# 0137 — REVIEW (phase 5): the `text` command + D-121 / D-122 reconciliation
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (reviewer)
Reviews: entry 0136 (one cycle since 0135-REVIEW).   Verdict: **ACCEPT WITH EDITS**

Diff reviewed: `git diff 295f3ed..235f8cf` — `command/parser.ts`, `command/commands.ts`,
`engine/graph/node.ts`, `engine/primitives/schema.ts`, `engine/primitives/text.ts` (+ three test
files), plus `STATUS.md` and the log entry. ~277 source lines / 8 files. Reviewer edits: 4 stale
test comments (below).

---

## Verification (re-run, not read)

```
$ npx tsc --noEmit                          → clean
$ npx tsc --noEmit -p tsconfig.engine.json  → clean
$ npx vitest run                            → 30 files, 1443 passed, 0 skipped, 0 .only
$ grep -rn '\.only\(|\.skip\(' src          → no matches
```

Matches entry 0136's pasted output exactly. The three "changed" expectations
(`schema.test.ts`'s `text` path list, `parser.test.ts`'s `DOCUMENTED_EXAMPLES`,
`commands.test.ts`'s `EVERY_REGISTRY_EXAMPLE`) are additive pins that D-121 clause 2 and the
"disjoint is pinned by a test" contract both require to move when a command lands — reconciliation,
not weakening. §6.1 trigger 5 was reported honestly.

## Rule audit

- **Rule 1 (engine purity)** — upheld. `schema.ts` / `node.ts` / `text.ts` gain no DOM, `window`,
  `canvas`, or `render/` import. The D-122 guard lives in `command/commands.ts` (command layer).
- **Rule 2 (mutation-only state change)** — upheld. `createText` → `createObjectFromCommand` →
  `mutate`; the D-122 refusal returns `{ ok: false }` before any `mutate` call.
- **Rule 3 (addressing)** — not touched; `origin.x`/`origin.y` reuse the existing
  `ORIGIN_X_PATH`/`ORIGIN_Y_PATH` spelling, no new address surface.
- **Rule 4 (one text evaluator)** — not touched.
- **Rule 5 (dumbest correct)** — upheld. `DEFAULT_TEXT_*` are plain module constants; no layout or
  optimisation logic entered `createText`.
- **Rule 6 (slot set fixed)** — upheld. `origin.x`/`origin.y` join `TEXT_SCHEMA`'s single `static`
  non-derived group; a `text` object's slot set is a fixed 11 + 2, unchanged for the life of the
  object.
- **Rule 7 (edges re-derived, never hand-maintained)** — not touched. `origin.*` are `literal`, so
  they contribute no edge; `resolveTextDependencyAddresses` is unchanged (doc only).

## Invariant audit

- **Rejection leaves prior state bit-for-bit unchanged** — the D-122 guard fires at the top of
  `buildSlot`'s `case "formula"`, before `parseFormula` and before any candidate document is built.
  Test "the refusal fires before the formula is even parsed" pins it.
- **No dangling edges / no dangling references** — `origin.x`/`origin.y` are correctly declared NOT
  dependency-required (D-121 clause 2): nothing derived reads them, `findSchemaSlotKindMismatches`
  tolerates an absent one, and the pre-existing hand-built `text` fixtures in `commands.test.ts` /
  `main.test.ts` / `interaction.test.ts` (which carry no `origin` slot) still commit and still pass.
- **Graph state plain / serializable** — `DEFAULT_TEXT_*` are primitives (`"auto"`, `"visible"`,
  numbers, family strings); no closure, instance, or `Map` entered document state.

## Spec conformance

- **§5.10 "adding a command is one registry entry"** — met: one `COMMAND_SPECS` entry + one handler
  + the union member, `text` removed from `COMMANDS_SPECIFIED_BUT_NOT_BUILT` in the same cycle.
- **§5.6 "raw source including markup"** — `content` is stored verbatim; the parser resolves
  nothing (`parser.test.ts` "keeps … `{= }`/`{? }` markup verbatim", `commands.test.ts` "stores …
  content verbatim").
- **D-121** — reconciled exactly as ruled: both paths added, reusing `geometry.ts`'s constants (no
  new constant), `schema.test.ts` moved with it, STATUS count 9 → 11, no `PROVISIONAL` tag, `(D-121)`
  cited at the schema site. Front-of-list placement matches `TABLE_SCHEMA` (see Q&A 1 below).
- **D-122** — reconciled exactly as ruled: `link` and `set =` on `text_1.content` refused with a
  message naming D-122 and the literal-write remedy; a plain `set text_1.content "…"` unaffected;
  `text.ts`'s NOT DONE HERE note rewritten to the present ("closed by a refusal", not "owed a
  ruling"); no `PROVISIONAL` tag. Guard placement (`buildSlot`'s `formula` arm, not
  `resolveWritableSlot`) is sound — the refusal is kind-dependent, so it belongs where the write
  kind is known, and both `link` and `set =` land in that one arm.
- **Loader gap disclosed correctly** — a loaded document could still carry a `formula` `content`
  slot whose embedded references go untracked; this mirrors D-046's posture for a loaded `formula`
  `rows` slot exactly, and is disclosed in `text.ts` and STATUS. No new obligation.

## Legibility audit

Headers updated in `schema.ts`, `commands.ts`, `parser.ts`, present-tense, no changelog prose.
Vocabulary locked (object / slot / literal / formula / derived used correctly throughout). No
`any`. New tests are behaviour sentences. `node.ts`'s new `TEXT_TYPE` mirrors `TABLE_TYPE`'s doc.

**One miss, fixed by the reviewer (ACCEPT WITH EDITS).** Entry 0136 corrected the now-stale
"no `text` command yet" comment in `commands.test.ts` but left four equivalents falsified by the
same change:

1. `src/render/interaction.test.ts:552` — "hand-built, no `text` command exists"
2. `src/main.test.ts:305` — "there is no `text` command …"
3. `src/main.test.ts:962` — "No `text` command exists, so the fixture …"
4. `src/main.test.ts:1003` — "placed in the document directly (no `text` command)"

Each rewritten to state the present reason those fixtures stay hand-built — *the test is about
`EvalContext` threading / the drag, not creation* — which is the real invariant and does not rot.
Comment-only; `tsc` clean and 1443/1443 still green after the edit. This is the same class as
STATUS's carried "comment debt in TEST files only" item; the four sites are now current.

## Honesty audit

Log matches diff, file by file. Test-count claim (+16, 1427 → 1443) is consistent with the run.
The "Where I got stuck" section is accurate and unflattering: the render half of Phase 5 is
untouched, a `text` object has no extent and is not yet hit-testable or draggable, and the
`link text_1.origin.y …` path (D-121's Phase 7 payoff) is reachable but was tested on
`style.fontSize` rather than `origin.y`. That substitution is acceptable — same `buildSlot` arm,
same mechanism — but a direct `origin.y` link test is a cheap add for the render cycle.

No silent scope expansion. `DEFAULT_TEXT_*` are new but declared, documented, and within the
handler's remit (the `createPolygon` `rotation` precedent).

## Answers to the implementer's three questions

1. **`origin.x`/`origin.y` front-of-list vs trailing the §5.6 slots** — **front-of-list is correct.**
   It matches `TABLE_SCHEMA` (origin first), path order in `nonDerivedSlotPaths` is enumeration
   order only (it drives `props` display and the pinned test, nothing load-bearing), and "position
   first, then content/layout" is the reading a cold reader expects. Keep as built.

2. **`x`/`y` optional, defaulting to `0`** — **intended, keep as built.** D-121 clause 3's operative
   text is explicit ("`x=` / `y=` defaulting to `0`"). Its parenthetical "(matching `table`)" is
   imprecise — `table` uses `requiredNumber("x")`/`("y")` — but that aside changes nothing: the
   ruling's instruction stands, and "type the text, place it later" is a reasonable default for a
   command whose whole point is a string. The inconsistency with `circle`/`polygon`/`rect`/`table`
   is real, is disclosed in the entry and STATUS, and is not a defect. Not to be revisited absent a
   human ruling.

3. **`DEFAULT_TEXT_*` with no ruling and no `PROVISIONAL` tag** — **the right call.** These are
   `set`-changeable render/style config, not a data-model commitment; §5.6 specifies the `style`
   shape and the `overflow` enum but no defaults, and no open question covers them. The Q-016 /
   Q-019 "a tag with no reader is debt" reasoning applies. The font (`"sans-serif"`) is the value
   most likely to be re-decided when the render pass lands, but a generic CSS family is a safe,
   canvas-valid placeholder and the render cycle will exercise it directly. No tag needed; the
   handler doc comment already states they are provisional and why.

## Open questions

None raised. Q-022 → D-121 and Q-023 → D-122 are both reconciled here and move to fully-closed.
Q-016 and Q-017 remain the human's, non-blocking, untouched by this diff. Q-008 and Q-012
`PROVISIONAL` tags are untouched; no new tag was introduced.

## Verdict

**ACCEPT WITH EDITS.** The `text` command is a clean, well-tested registry entry; both rulings are
reconciled to the letter. The four reviewer edits are one-line test-comment corrections. Phase 5's
render work (draw pass, markdown-lite, layout, `text` extent + hit-testing) is unblocked and is the
next slice — the Phase 5 gate cannot be claimed until it lands.

No `DECISIONS.md` entry: nothing recurring surfaced. The stale-comment miss is a one-off, already
covered by STATUS's standing "comment debt in test files" note.
