# 0159 — markdown-lite, parsed: `render/markdown.ts`

Date: 2026-09-02   Phase: 5   Model: Opus 5 (implementer)
Previous entry: 0158-RULINGS-phase5   Last review: 0157-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; 423 lines / 2 files changed so far.

## Declared scope

§5.6's markdown-lite list, parsed and nothing else: one new pure file,
`src/render/markdown.ts`, turning a resolved string into one `MarkdownLine` per hard line, each
holding the `MarkdownRun`s it draws with its markers removed. It is not wired to anything — no
measurer, no renderer, no engine file is touched this cycle.

## Explicitly not in scope

- **Measuring or drawing any of it.** That is the next cycle, and STATUS is emphatic that the
  measurer and the renderer must move together; they still both treat markup verbatim, so drawn and
  measured still agree exactly as they did before this cycle.
- **Which font a flag maps to, and how much bigger a heading is.** Deliberately left out of this
  file — those belong beside the layout, or `measure.ts` and `renderer.ts` become two answers to
  one question (D-010).
- **Q-025.** Nothing this cycle touches the in-place editor, so no site needs the tag yet. The next
  cycle takes recommendation (a) and tags it.
- **The wrap residual.** D-138. `layOutLines` was not opened at all this cycle.

## What I did

**`src/render/markdown.ts` (new, 230 lines).** §5.6's markdown-lite list, in full and nothing
beyond it.

- `parseMarkdownLite(text)` splits on `/\r?\n/` — the SAME split `measure.ts`'s `layOutLines` uses,
  so the hard-line count is identical whether or not markup is honoured — and parses each line.
- Line kinds: `heading` for `# `/`## `/`### ` (longest prefix first, so `#### x` is a paragraph —
  §5.6 says levels 1–3 and nothing more), `list` for `- `, `paragraph` otherwise. A blank line is a
  paragraph with no runs, which is §5.6's blank-line paragraph break already: it is one line's
  height and needs no separate mechanism.
- A prefix is recognised at position 0 only. `"  - nested"` is ordinary text — §5.6 forbids nested
  lists and indentation is what they are made of.
- `- ` is replaced by a `LIST_BULLET` (`"• "`) run, exported and emitted as an ordinary unstyled
  run so that wrapping, alignment and measurement need no list case at all.
- Inline: `**bold**`, `*italic*`, `` `code` ``. Markers are removed; the flags travel on the run.
  Bold and italic nest; a code run is emitted whole and its contents are NOT re-parsed.
- A marker opens ONLY when its closer is present later on the same line with at least one character
  between them. So `2 * 3` stays arithmetic, `**bold` stays six characters, and `****` stays four.

**`src/render/markdown.test.ts` (new, 193 lines).** 30 tests in six groups: hard lines and the
blank-line break, headings (including the fourth-level and indented refusals), list items
(including `-5` and the indented refusal), the three inline forms and their nesting, unmatched
markers, and §5.6's exactness (links, images, blockquotes, table rows and `_underscores_` all draw
verbatim). Plus two never-throws tests at 2,000-deep nesting and 50,000 characters.

## Decisions I made

**1. Markdown parsing lives in `render/`, not in `src/engine/`.** Markup here decides only which
FONT a stretch of text is drawn and measured in — it moves glyphs, which is precisely the work
Rule 1 and **D-120** put behind the measurer ("line-breaking lives in the measurer implementation,
never in `src/engine/`"). The engine's own parse of `content` is a different job: it resolves
VALUES into `resolvedContent`, and §5.6 says `content` holds "raw source including markup", so the
markup is still there verbatim when this file gets it. No engine file changed, which also means no
§6.2 load-bearing file was touched.

**2. Consequence of that ordering, stated because it is reachable:** markup that a `{= }` resolved
INTO is markup, and an engine-emitted `!`-marked broken span (D-116/D-117) is parsed like any other
text — a `*` inside the operator's own broken formula source can open an italic run. Recorded in
the file header and in Known problems rather than defended against; §5.6 gives no escaping
mechanism and inventing one is not on its list.

**3. An unmatched marker is literal, and both characters of `**` are consumed together.** Consuming
only the first would leave the second to open an italic run and turn `**` into emphasis nobody
typed. Requiring at least one character between opener and closer is what keeps `****` and ` `` `
visible instead of silently vanishing.

**4. Vocabulary: `MarkdownRun`, never "span".** "Span" is already this project's word for an
embedded `{= }` construct (D-115/D-116 — "a broken embedded span"), and "block" is already the
`Block` tree's (§5.6). PROCESS §5.1's vocabulary lock is about not having two words for one thing;
this is the mirror case — not having one word for two.

**5. Iterative with an explicit stack, no recursion.** `content` is a `literal` slot the operator
can nest as deeply as they like, and D-079's posture is that a recursion depth reachable from
document state is a hazard. There is a test at 2,000 markers.

**6. No hanging indent for a wrapped list item.** A continuation line starts at the box's left
edge, level with the bullet rather than with the text. §5.6 specifies no indentation and Rule 5
takes the dumber layout. Disclosed in the file's NOT DONE HERE.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean — no output, both configs)

$ npm test
 Test Files  34 passed (34)
      Tests  1740 passed (1740)
```

Baseline before this cycle was 33 files / 1710 tests, so the 30 new tests are the whole difference
and nothing else moved.

## Acceptance criteria status

Phase 5 criterion: "a text box reading `Radius: {= table_x.A1 }{? table_x.A1 > 50 } — **LARGE**{:}
— small{?}` updates both its number and its branch as the cell changes, wraps at its set width, and
re-renders when a value referenced only inside the currently non-taken branch changes" — **NOT YET**.
This cycle moves nothing toward it that is observable: the parser is not wired, so `**LARGE**` still
draws as eight characters. Demonstrated by: nothing, and deliberately so.

## Where I got stuck / what is unfinished

**Nothing was hard, and that is worth being suspicious about.** This file is inert. Every judgement
in it — the bullet glyph, the no-empty-emphasis rule, the position-0 prefix rule, whether `code`
should suppress nesting — is only testable against its own tests until the next cycle draws it. If
one of them is wrong, the tests here agree with the mistake.

**One test asserts a behaviour I am not sure anybody wants**, and I wrote it as documentation rather
than as a requirement: `\*soft\*` parses as a literal backslash followed by an ITALIC `soft\`,
because there is no escaping and the backslashes are ordinary characters that happen to sit next to
markers. It is the honest consequence of §5.6 listing no escape mechanism. If the human wants `\*`
to disarm a marker, that is a §5.6 extension and a question, not a fix.

**I did not rewrite `STATUS.md` in full at the end of this cycle.** I made a targeted edit
(the header block, the batch counters, and this entry's place in the built list) and left the full
§11.2 rewrite for the end of the session's second cycle, which is minutes away and would make a
full rewrite here stale on arrival. Disclosed rather than done silently; if a reader disagrees, the
remedy is that the next full rewrite lands at 0160 regardless.

## Open questions raised

None. **Q-025 is untouched and still the human's** — nothing here reaches the in-place editor.

## Review point

Fired: **none — batching.** No §6.1 trigger: no phase gate claimed; no new SUBSYSTEM (this is a new
FILE inside `render/`, an already-reviewed layer, on the same footing as `textbox.ts` and
`handles.ts` at 0153, which batched); no brief deviation (§5.6's list is implemented exactly, and
the two places it is silent — the bullet glyph and list indentation — are Rule 5 render constants,
disclosed); no hard rule worked around; **no test expectation changed and no previously-passing
test touched**; no dependency, build step or config file; no repeated bug; nothing from §8.

Cycles since last review 1/3, diff 423 lines / 2 files (cap 800/10).
