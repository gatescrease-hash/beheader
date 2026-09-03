/**
 * markdown.ts — §5.6's markdown-lite, parsed: which lines are headings or list
 * items, and which stretches of a line are bold, italic or code.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.6's markdown-lite list, in full and nothing
 * beyond it — `**bold**`, `*italic*`, `` `code` ``, `# heading` (levels 1-3),
 * `- list item`, blank-line paragraph breaks. §5.6's "No tables, images, links,
 * blockquotes, or nested lists" is upheld by this file recognising none of them.
 * LAYER: render (pure). No canvas, DOM, or window — a `string` in, a plain
 * array out. May import: nothing. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `parseMarkdownLite(text)` -> one `MarkdownLine` per hard line, each holding
 *   the `MarkdownRun`s that line draws: the text with its markers REMOVED, plus
 *   the three inline flags a font is chosen from. `verbatimLines(text)` is the
 *   same hard lines with no markup honoured, for the overlay (Q-025 (a)).
 *
 *   It lives in `render/`, not in `src/engine/`, because markup here decides
 *   only which FONT a stretch of text is drawn and measured in — glyph work,
 *   which Rule 1 and D-120 put behind the measurer. The engine's own parse of
 *   `content` (the `{= }`/`{? }` block tree) resolves VALUES instead, and §5.6
 *   says `content` holds "raw source including markup" — so the markup is still
 *   there, verbatim, in `resolvedContent` when this file gets it.
 *
 *   Intended consequence: markup a `{= }` resolved INTO is markup, and an
 *   engine-emitted `!`-marked broken span (D-116/D-117) parses like any other
 *   text — a `*` in a broken formula can open an italic run.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws, for any string, at any length.
 *   - Iterative: no recursion, so nesting depth is bounded by nothing (D-079's
 *     posture — `content` is a `literal` slot the operator can make as deep as
 *     they like).
 *   - An UNMATCHED marker is literal text, never a run that swallows the rest
 *     of the line: an emphasis marker opens only when it is followed by a
 *     non-space AND a closer (itself not preceded by a space) sits later on the
 *     same line, with at least one character between them. That pair of tests is
 *     CommonMark's left/right-flanking rule reduced to §5.6's markers, and it is
 *     what keeps `2 * 3` arithmetic even on a line that also holds a `**`.
 *   - Concatenating every run of every line, with the markers put back and the
 *     bullet dropped, is the input again — nothing is invented or lost.
 *   - Reads nothing from and writes nothing to graph state (Rule 2).
 *
 * NOT DONE HERE
 *   - MEASURING or DRAWING. `measure.ts` turns these runs into laid-out lines
 *     and `renderer.ts` paints them; both read the flags, neither re-parses.
 *   - Which font a flag maps to, and how much bigger a heading is — those are
 *     `measure.ts`'s, so drawn and measured cannot disagree (D-010).
 *   - How far a wrapped list item's continuation lines HANG in under its text.
 *     They do (entry 0161, the human's request), but by the measured width of
 *     `LIST_BULLET`, which only `measure.ts` can know — so the indent is
 *     computed there and this file just names the bullet.
 *   - Leading whitespace before a marker (`"  - x"`, `"  # x"`) is NOT a
 *     marker — a prefix is recognised at position 0 only. §5.6's list is
 *     exact and indentation is what nested lists are made of, which it forbids.
 *   - Escaping. There is no `\*`; a literal asterisk is one with no partner.
 */

/** One stretch of a line drawn in a single font: the text with its markers already removed, and the three flags §5.6 allows. `code` wins the family; `bold`/`italic` can both be set on one run (`**a *b* c**`). */
export interface MarkdownRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
}

/** What a hard line IS, as §5.6 names them. `paragraph` covers ordinary text and the blank line that makes a paragraph break (its `runs` are empty). */
export type MarkdownLineKind = "paragraph" | "heading" | "list";

/** One hard line of `resolvedContent`, parsed. `level` is 1-3 for a `heading` and `0` for everything else, so a reader never has to treat it as optional. */
export interface MarkdownLine {
  readonly kind: MarkdownLineKind;
  readonly level: number;
  readonly runs: readonly MarkdownRun[];
}

/**
 * What `- ` is drawn as. §5.6 asks for a list item and says nothing about its
 * marker; a bullet is the smallest thing that makes the line READ as a list
 * item, which is the whole content of the request. Emitted as an ordinary
 * unstyled run so wrapping, alignment and measurement need no list case at all.
 */
export const LIST_BULLET = "• ";

const HEADING_PREFIXES: readonly { readonly prefix: string; readonly level: number }[] = [
  // Longest first: `"#### x"` must not match `"# "` and become a level-1
  // heading with a `###` in it. §5.6 caps headings at three levels, so a fourth
  // `#` is ordinary text, drawn verbatim.
  { prefix: "### ", level: 3 },
  { prefix: "## ", level: 2 },
  { prefix: "# ", level: 1 },
];

const LIST_PREFIX = "- ";
const CODE_MARKER = "`";
const BOLD_MARKER = "**";
const ITALIC_MARKER = "*";

/** The inline flags in force at a point in the scan. `code` is not here: a code run is emitted whole and never nests, so it is never "in force". */
interface InlineStyle {
  readonly bold: boolean;
  readonly italic: boolean;
}

const PLAIN_STYLE: InlineStyle = { bold: false, italic: false };

/**
 * Splits `text` into the lines it draws as, each parsed for §5.6's markup.
 *
 * Why: the canvas draws `**bold**` in bold, so both the measurer and the
 * renderer need to know which characters are markers (they take no room and get
 * no glyph) and which font each remaining stretch is in. One parse, one answer,
 * two readers (D-010).
 *
 * Hard lines are split the way `measure.ts`'s layout splits them (`\r?\n`), so
 * the line COUNT is the same whether or not markup is being honoured. A blank
 * line stays a blank line — §5.6's paragraph break is that blank line's own
 * height, and needs no separate mechanism.
 *
 * Never throws; every unrecognised marker degrades to literal text.
 */
export function parseMarkdownLite(text: string): readonly MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  // Appended one at a time, never `push(...)`: the line count follows
  // `content`'s length, which the operator controls (D-077 clause 1, the same
  // reason `measure.ts`'s layout does it this way).
  for (const hardLine of text.split(/\r?\n/)) {
    lines.push(parseLine(hardLine));
  }
  return lines;
}

/**
 * The same hard lines, with NO markup honoured: every line is a paragraph
 * holding one plain run of exactly the characters it was given.
 *
 * Why this lives here rather than beside its caller: "what a hard line is"
 * (`/\r?\n/`) must have ONE answer, or a text object's line COUNT could depend
 * on whether markup was being read (D-010). `measure.ts` lays both shapes out
 * through one function; this is the shape it uses for the in-place editor's
 * overlay, which shows RAW SOURCE and is measured from it (**Q-025** (a)).
 *
 * A blank line gets no run at all, exactly as `parseMarkdownLite` gives it
 * none — an empty run and no run lay out identically, and one shape is easier
 * to assert against than two.
 */
export function verbatimLines(text: string): readonly MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  for (const hardLine of text.split(/\r?\n/)) {
    lines.push({
      kind: "paragraph",
      level: 0,
      runs: hardLine === "" ? [] : [{ text: hardLine, bold: false, italic: false, code: false }],
    });
  }
  return lines;
}

/** One hard line: its block marker (if any) stripped and recorded, the rest parsed for inline markup. */
function parseLine(hardLine: string): MarkdownLine {
  for (const heading of HEADING_PREFIXES) {
    if (hardLine.startsWith(heading.prefix)) {
      return { kind: "heading", level: heading.level, runs: parseInlineRuns(hardLine.slice(heading.prefix.length)) };
    }
  }
  if (hardLine.startsWith(LIST_PREFIX)) {
    const runs = parseInlineRuns(hardLine.slice(LIST_PREFIX.length));
    return { kind: "list", level: 0, runs: [{ text: LIST_BULLET, bold: false, italic: false, code: false }, ...runs] };
  }
  return { kind: "paragraph", level: 0, runs: parseInlineRuns(hardLine) };
}

/**
 * Does a marker at `index` CLOSE an emphasis run? CommonMark's right-flanking
 * rule, reduced to what §5.6 needs: a closer is never preceded by a space, so
 * the `**` in `a ** b` is two ordinary characters.
 */
function closesEmphasis(line: string, index: number): boolean {
  return index > 0 && line.charAt(index - 1) !== " ";
}

/** The first index at or after `from` where `marker` could CLOSE a run, or `-1`. Skips occurrences a space disqualifies rather than giving up at the first one. */
function closerIndex(line: string, marker: string, from: number): number {
  let at = line.indexOf(marker, from);
  while (at !== -1) {
    if (closesEmphasis(line, at)) {
      return at;
    }
    at = line.indexOf(marker, at + 1);
  }
  return -1;
}

/**
 * Could a marker at `index` OPEN an emphasis run: is it followed by a non-space,
 * and is there a closer for it later on the line with at least one character
 * between them?
 *
 * The non-space test is CommonMark's LEFT-flanking rule, reduced the same way,
 * and it is what keeps `2 * 3 and **bold` entirely literal — without it the lone
 * `*` pairs with the first `*` of the `**` and silently italicises the middle of
 * the operator's line. Adopting a *specified* rule rather than inventing one is
 * the move D-138 clause 4 sanctions, so the rule is named here at its site.
 */
function opensEmphasis(line: string, index: number, marker: string): boolean {
  const after = index + marker.length;
  if (after >= line.length || line.charAt(after) === " ") {
    return false;
  }
  return closerIndex(line, marker, after + 1) !== -1;
}

/**
 * One line's text, split into runs at its inline markers.
 *
 * An emphasis marker OPENS only when `opensEmphasis` accepts it; otherwise every
 * character of it is ordinary text. That is what makes a lone `*` (or a
 * half-typed `**bold`) draw as itself instead of silently restyling the rest of
 * the line — the same posture D-116 takes for a half-typed `{= }`, which the
 * operator can see and fix, rather than a failure they cannot locate.
 *
 * A code run is emitted whole and its contents are NOT re-parsed: inside
 * backticks, `*` is an asterisk. Bold and italic DO nest, because `**a *b* c**`
 * is ordinary to type and costs one flag to honour.
 *
 * Iterative, with an explicit stack of what is open (see the file header): a
 * line of a thousand nested markers is a long loop, never a deep one.
 */
function parseInlineRuns(line: string): readonly MarkdownRun[] {
  const runs: MarkdownRun[] = [];
  const open: { readonly closer: string; readonly outer: InlineStyle }[] = [];
  let style = PLAIN_STYLE;
  let pending = "";
  let index = 0;

  const flush = (): void => {
    if (pending !== "") {
      runs.push({ text: pending, bold: style.bold, italic: style.italic, code: false });
      pending = "";
    }
  };

  while (index < line.length) {
    // Closing what is open comes first: inside `**a**`, the second `**` is a
    // closer, not a second opener.
    const innermost = open[open.length - 1];
    if (innermost !== undefined && line.startsWith(innermost.closer, index) && closesEmphasis(line, index)) {
      flush();
      style = innermost.outer;
      open.pop();
      index += innermost.closer.length;
      continue;
    }
    if (line.startsWith(CODE_MARKER, index)) {
      const closer = line.indexOf(CODE_MARKER, index + CODE_MARKER.length);
      if (closer > index + CODE_MARKER.length) {
        flush();
        runs.push({ text: line.slice(index + CODE_MARKER.length, closer), bold: style.bold, italic: style.italic, code: true });
        index = closer + CODE_MARKER.length;
        continue;
      }
      pending += CODE_MARKER;
      index += CODE_MARKER.length;
      continue;
    }
    if (line.startsWith(BOLD_MARKER, index)) {
      if (!style.bold && opensEmphasis(line, index, BOLD_MARKER)) {
        flush();
        open.push({ closer: BOLD_MARKER, outer: style });
        style = { bold: true, italic: style.italic };
        index += BOLD_MARKER.length;
        continue;
      }
      // Both characters are literal, together: consuming only the first would
      // leave the second to open an italic run and turn `**` into emphasis
      // nobody typed.
      pending += BOLD_MARKER;
      index += BOLD_MARKER.length;
      continue;
    }
    if (line.startsWith(ITALIC_MARKER, index)) {
      if (!style.italic && opensEmphasis(line, index, ITALIC_MARKER)) {
        flush();
        open.push({ closer: ITALIC_MARKER, outer: style });
        style = { bold: style.bold, italic: true };
        index += ITALIC_MARKER.length;
        continue;
      }
      pending += ITALIC_MARKER;
      index += ITALIC_MARKER.length;
      continue;
    }
    pending += line.charAt(index);
    index += 1;
  }
  flush();
  return runs;
}
