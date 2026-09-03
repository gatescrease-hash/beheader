/**
 * measure.ts — Where every line and every glyph of a `text` object goes, and
 * the Canvas2D-backed `TextMeasurer` (Rule 1's text-measurement seam) over it.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.6 (`measuredHeight` "computed via the injected
 * `TextMeasurer`"; "fixed width + auto height (wrap, grow down) is the default";
 * the markdown-lite list, whose fonts are chosen here), Rule 1's
 * text-measurement trap (`engine/eval-context.ts` DEFINES the interface;
 * "`src/render/` provides the real Canvas2D-backed implementation and `main.ts`
 * wires it in"), and **D-120** (line-breaking lives HERE, never in
 * `src/engine/`; `measure` takes an optional `maxWidth`).
 * LAYER: render. Touches Canvas2D — the one layer Rule 1 does not bind (Rule 1 is
 *        `engine/`-only). May import: engine/* (read-only, for the interface it
 *        implements), own layer (`./markdown.ts`). NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `layOutText(request)` -> a `TextLayout`: the lines a string occupies, each
 *   as positioned `LaidOutRun`s carrying the exact `ctx.font` they draw in.
 *   `renderer.ts` PAINTS that layout and this file MEASURES it (widest line,
 *   summed line heights), so the box and the ink come from one answer to "how
 *   does this text lay out" and cannot drift (D-010).
 *
 *   `request.markup` picks which reading of the string is laid out, and both
 *   are `markdown.ts`'s: TRUE parses §5.6's markdown-lite, so `**bold**` is
 *   four fewer characters in a bold font; FALSE takes every character at face
 *   value. The canvas measurer is markup-aware because the canvas DRAWS markup
 *   (`createCanvas2dTextMeasurer`, feeding `measuredWidth`/`measuredHeight`).
 *   The in-place editor's overlay shows RAW SOURCE, so it is measured raw
 *   (`createSourceTextMeasurer`) — **Q-025** (a), provisional.
 *
 *   `cssFont` builds every `ctx.font` string in the project's text pipeline.
 *   Markdown flags reach the canvas ONLY through it: `code` swaps the family
 *   for `monospace`, a heading scales the size and line height by CSS's own
 *   `h1`/`h2`/`h3` `em` sizes, and bold/italic become the shorthand's prefix.
 *
 *   LINE-BREAKING (**D-120**): split on the operator's own newlines first, then
 *   — ONLY when `wrapWidth` is a positive finite number — greedily wrap each
 *   hard line, measuring candidates with `ctx.measureText`. No wrap width
 *   (`width` is `"auto"`) -> no wrap.
 *
 *   The rule this file breaks lines by is **CSS's**, deliberately and to the
 *   letter — specifically `white-space: pre-wrap` plus `overflow-wrap:
 *   break-word`, which is what the in-place editor's `<textarea>` uses (the
 *   human's 2026-09-02 report). Two consequences, and neither is a style
 *   preference:
 *
 *     - **A run of spaces is PRESERVED, not collapsed.** `pre-wrap` keeps every
 *       space, so `"a  b"` is wider in the editor than a collapsed `"a b"` is on
 *       the canvas — near a wrap boundary that is one extra line in the editor
 *       and not on the canvas, which is exactly the "X lines rendered, X+1 lines
 *       editing" the operator saw. Spaces at the END of a line HANG (CSS Text 3):
 *       they are trimmed off the emitted line, so they neither widen the box nor
 *       force a break.
 *     - **A word wider than the wrap width is BROKEN between characters.** It
 *       used to sit alone and overflow, which meant a long unbroken run of text —
 *       a URL, a keyboard mash — punched straight out through the side of its own
 *       box on the canvas while the editor broke it neatly. `overflow-wrap:
 *       break-word` is the CSS rule reproduced: the word first moves to a line of
 *       its own, and only if it STILL does not fit is it split.
 *
 *   A word may span two runs (`**bo**ld`), and it is NOT broken there: chunks
 *   are accumulated across runs and only a space opens a break opportunity,
 *   which is what CSS does too.
 *
 *   Rule 5 still applies to everything CSS does beyond that: no hyphenation, no
 *   dictionary, no grapheme-cluster or bidi handling, no tab stops (a tab is part
 *   of a word here — only U+0020 is a break opportunity). Those are differences
 *   between this measurer and a browser that no document reachable today can see.
 *
 *   That drawn/measured agreement holds WHILE both files read the same usable
 *   `style.*` slots — true of every object `command/commands.ts`'s `createText`
 *   builds. When a `style.*` slot is missing or unusable the two fall back
 *   DIFFERENTLY: here an unusable `lineHeight` becomes `fontSize` and an unusable
 *   `fontSize` returns an empty layout, while `renderer.ts` substitutes its own
 *   `DEFAULT_TEXT_*` and draws anyway (deliberately — it would rather show text
 *   than blank the box). So for a hand-built or loaded `text` object with a
 *   broken style, drawn and measured CAN disagree. Disclosed, not fixed: one
 *   shared set of fallbacks needs a ruling on which file owns them
 *   (0139-REVIEW).
 *
 * INVARIANTS UPHELD HERE
 *   - `measure` NEVER throws and ALWAYS returns two finite, non-negative
 *     numbers — `engine/eval-context.ts`'s `TextMeasurer` contract, which a pure
 *     `derived`-slot compute (`measureTextBox`) trusts the way it trusts `read`.
 *     A non-finite / non-positive `fontSize`, `lineHeight` or `maxWidth`, and a
 *     `measureText` returning a non-finite width, are each coerced to a safe
 *     value here rather than propagated.
 *   - An empty resolved string measures `{ width: 0, height: 0 }` — a text
 *     object with nothing in it takes no room (matching `NULL_TEXT_MEASURER`).
 *   - A line's measured width is the SUM OF THE SAME RUN MEASUREMENTS the
 *     renderer positions those runs by, so a line can never be measured wider or
 *     narrower than it draws.
 *   - No wrap loop, whitespace rule, or markdown handling leaks into
 *     `src/engine/` (D-120 clause 2): every bit of it is in this file and
 *     `markdown.ts`.
 *   - Lines and runs are appended one at a time, never `push(...lines)` /
 *     `Math.max(...)`: the count is a function of `resolvedContent`, itself a
 *     function of `content` — a `literal` slot the operator can make arbitrarily
 *     long — so a spread would be a `RangeError` at a size document state can
 *     reach (D-077 clause 1).
 *   - Reads nothing from and writes nothing to graph state (Rule 2) — handed a
 *     `string` + a `TextStyle`, returns numbers.
 *
 * NOT DONE HERE
 *   - PARSING the markup. `markdown.ts` decides what is a heading, a list item
 *     or an emphasised stretch; this file decides only what font that becomes.
 *   - Drawing — `renderer.ts`'s text pass. It calls `layOutText` and paints the
 *     runs it gets back; this file still only MEASURES.
 *   - `align` / `color` — they change how a laid-out line is PAINTED, not its
 *     size, and are not in `TextStyle` (`engine/eval-context.ts`). Alignment
 *     needs the BOX width (`textbox.ts`), which is not this file's either.
 *   - Compensating for the residual disagreement between these line breaks and
 *     a `<textarea>`'s — **D-138** forbids it unconditionally. A further
 *     *specified* CSS rule may be adopted, and must be named at its site.
 */
import type { TextMeasurement, TextMeasurer, TextStyle } from "../engine/eval-context.ts";
import { parseMarkdownLite, verbatimLines, type MarkdownLine, type MarkdownRun } from "./markdown.ts";

/**
 * The slice of `CanvasRenderingContext2D` this file uses. A real 2D context
 * satisfies it structurally; a test supplies a fake with just these two members,
 * so no `as unknown as` cast is needed the way `renderer.test.ts` needs one for
 * its wider fake.
 */
export interface MeasurementContext {
  font: string;
  measureText(text: string): { readonly width: number };
}

/** Whether a `ctx.font` shorthand carries the CSS `font-style`/`font-weight` prefix. Both false — the ordinary case — produces no prefix at all, so a plain run's font string is exactly what it was before markdown existed. */
export interface FontEmphasis {
  readonly bold: boolean;
  readonly italic: boolean;
}

/** One stretch of a laid-out line drawn in a single font, positioned from the line's own left edge. `renderer.ts` sets `font`, then `fillText(text, lineLeft + x, …)`. */
export interface LaidOutRun {
  readonly text: string;
  readonly font: string;
  readonly x: number;
  readonly width: number;
}

/** One drawn line. `top` is its offset from the text's first line, which for markdown is NOT `index * lineHeight` — a heading line is taller than the lines around it. */
export interface LaidOutLine {
  readonly runs: readonly LaidOutRun[];
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Everything a caller needs to either measure or draw one `text` object's text. `width` is the widest line and `height` the summed line heights — the two numbers `measuredWidth`/`measuredHeight` report (D-123 clause 2: one measurement, two slots). */
export interface TextLayout {
  readonly lines: readonly LaidOutLine[];
  readonly width: number;
  readonly height: number;
}

/** What to lay out. `wrapWidth` is the `text` object's `width` slot when it holds a positive finite number, `undefined` for `"auto"` (§5.6: "auto width + auto height means no wrapping"). `measureRun` sets the font it is handed and returns that text's width in the same unit as `style.fontSize`. */
export interface TextLayoutRequest {
  readonly text: string;
  readonly style: TextStyle;
  readonly wrapWidth: number | undefined;
  readonly markup: boolean;
  readonly measureRun: (text: string, font: string) => number;
}

/**
 * §5.6's heading levels 1-3, as multiples of the object's own `style.fontSize`
 * and `style.lineHeight`.
 *
 * These are **CSS 2.1's sample stylesheet sizes** for `h1`/`h2`/`h3` — `2em`,
 * `1.5em` and `1.17em`, with `font-weight: bold` — adopted rather than invented.
 * §5.6 asks for headings and says nothing about their size, and **D-138**
 * clause 4 draws exactly this line: adopting a *specified* rule is legitimate
 * where tuning a number is not. The line height is scaled by the same factor,
 * because a 32px heading in a 20px line box overlaps its neighbours.
 */
const HEADING_FONT_SCALES: readonly number[] = [2, 1.5, 1.17];

/** §5.6's `` `code` ``: the generic monospace family, never a named typeface — this file does not choose the operator's fonts, and `sans-serif` is already `cssFont`'s own generic fallback. */
const CODE_FONT_FAMILY = "monospace";

/** One stretch of text in one font, before it is positioned. The wrap loop moves these between lines; `mergeRuns` turns a line's worth of them into `LaidOutRun`s. */
interface Piece {
  readonly text: string;
  readonly font: string;
}

/** A finite, positive number, or `undefined` — rejects a `fontSize`/`lineHeight`/`maxWidth` the measurer cannot use rather than letting a `NaN` reach the arithmetic. */
function finitePositive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A finite, non-negative number, or `0` — the last guard before a width/height leaves this file (`eval-context.ts`'s contract: `measure` always returns finite, non-negative). */
function finiteOrZero(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * `ctx.font` shorthand from a size, a family and (optionally) markdown's two
 * emphasis flags: `"16px Inter, sans-serif"`, `"italic bold 24px sans-serif"`.
 * The size is `fontSize` px, so `ctx.measureText` returns widths numerically in
 * the same unit as `fontSize` (world units — `eval-context.ts`'s `TextStyle`).
 *
 * `font-style` before `font-weight` before the size is the CSS `font` shorthand's
 * required order; a canvas silently IGNORES an invalid assignment, so getting it
 * wrong would leave the measurement running against whatever font the previous
 * call set rather than failing.
 *
 * A blank family falls back to the generic `sans-serif` — NOT this file
 * inventing a typeface (`measureTextBox` already `#TYPE`s a non-string
 * `style.font`, so only `""` reaches here, and only from a hand-built or loaded
 * object), but so the measurement is DETERMINISTIC, for the same reason
 * (`render/camera.ts`'s `finiteOrFallback` posture — D-062 — applied to a font
 * string).
 */
export function cssFont(fontSize: number, family: string, emphasis?: FontEmphasis): string {
  const italic = emphasis?.italic === true ? "italic " : "";
  const bold = emphasis?.bold === true ? "bold " : "";
  return `${italic}${bold}${fontSize}px ${family.trim() === "" ? "sans-serif" : family}`;
}

/** A line's trailing spaces, removed. CSS Text 3 HANGS them at a `pre-wrap` line's end — they take no width, cannot force a break, and are invisible — so an emitted line drops them and every measurement here is of a line that has already been through this. Only U+0020, matching the one character this file treats as a break opportunity. Walks BACK through the pieces, because a whole piece can be spaces (`**a** ` + `b`). */
function withoutHangingSpaces(pieces: readonly Piece[]): Piece[] {
  const trimmed = pieces.slice();
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    if (last === undefined) {
      break;
    }
    const text = last.text.replace(/ +$/, "");
    if (text === last.text) {
      break;
    }
    if (text === "") {
      trimmed.pop();
      continue;
    }
    trimmed[trimmed.length - 1] = { text, font: last.font };
    break;
  }
  return trimmed;
}

/**
 * One run's text, split at its soft-wrap opportunities: each chunk is one word
 * plus the spaces that FOLLOW it, because CSS puts the break opportunity AFTER a
 * space run, not before it. A leading space run (no word) is its own first
 * chunk, and every chunk concatenated is the input back verbatim — which is what
 * makes the layout preserve the operator's spacing instead of collapsing it.
 *
 * `"a  bb c"` -> `["a  ", "bb ", "c"]`; `"  x"` -> `["  ", "x"]`; `""` -> `[]`.
 */
function wrapChunks(runText: string): readonly string[] {
  return runText.match(/[^ ]+ *| +/g) ?? [];
}

/** The `ctx.font` one parsed run draws in: `code` takes the monospace family, a heading is bold at its scaled size, and the two inline flags become the shorthand's prefix. The ONE place a markdown flag becomes a font (D-010). */
function runFont(run: MarkdownRun, line: MarkdownLine, family: string, fontSize: number): string {
  return cssFont(fontSize, run.code ? CODE_FONT_FAMILY : family, {
    bold: run.bold || line.kind === "heading",
    italic: run.italic,
  });
}

/** How much bigger than the object's own `style` this line is drawn — CSS's `h1`/`h2`/`h3` `em` size for a heading, `1` for everything else. A level outside 1-3 cannot be produced by `markdown.ts`, and falls back to `1` rather than to `undefined` arithmetic. */
function headingScale(line: MarkdownLine): number {
  if (line.kind !== "heading") {
    return 1;
  }
  return HEADING_FONT_SCALES[line.level - 1] ?? 1;
}

/**
 * The break units of one parsed line, in order, each a list of pieces.
 *
 * Chunks are accumulated ACROSS runs: `**bo**ld` is one word, and CSS gives it
 * no break opportunity in the middle, so neither does this. A new chunk starts
 * only where a space ended the previous one — which is also why a chunk can
 * carry two fonts.
 */
function chunksOf(line: MarkdownLine, family: string, fontSize: number): Piece[][] {
  const chunks: Piece[][] = [];
  for (const run of line.runs) {
    const font = runFont(run, line, family, fontSize);
    for (const chunkText of wrapChunks(run.text)) {
      const previous = chunks[chunks.length - 1];
      const lastPiece = previous?.[previous.length - 1];
      if (previous !== undefined && lastPiece !== undefined && !lastPiece.text.endsWith(" ") && !chunkText.startsWith(" ")) {
        previous.push({ text: chunkText, font });
        continue;
      }
      chunks.push([{ text: chunkText, font }]);
    }
  }
  return chunks;
}

/**
 * A line's pieces, positioned: adjacent pieces in the SAME font are merged and
 * measured as one string, so kerning across a chunk boundary is measured the
 * way it is drawn, and a plain line is exactly one `measureText` call on the
 * whole line — bit-for-bit what this file did before markdown existed.
 *
 * The returned `width` is the sum of the run widths, which is why a line can
 * never be measured wider than the runs the renderer will position (see the
 * file header's invariants).
 */
function mergeRuns(pieces: readonly Piece[], measureRun: (text: string, font: string) => number): { readonly runs: LaidOutRun[]; readonly width: number } {
  const runs: LaidOutRun[] = [];
  let x = 0;
  let index = 0;
  while (index < pieces.length) {
    const font = pieces[index]?.font ?? "";
    let text = "";
    while (index < pieces.length) {
      const piece = pieces[index];
      if (piece === undefined || piece.font !== font) {
        break;
      }
      text += piece.text;
      index += 1;
    }
    const width = finiteOrZero(measureRun(text, font));
    runs.push({ text, font, x, width });
    x += width;
  }
  return { runs, width: x };
}

/** `pieces` with `character` on the end — extending the last piece when the font matches, so a broken word stays one run. Never mutates its input: a pushed line and the line being built share `Piece` objects. */
function appendCharacter(pieces: readonly Piece[], font: string, character: string): Piece[] {
  const last = pieces[pieces.length - 1];
  if (last === undefined || last.font !== font) {
    return pieces.concat([{ text: character, font }]);
  }
  const extended = pieces.slice(0, -1);
  extended.push({ text: last.text + character, font });
  return extended;
}

/**
 * One parsed line's chunks, greedily filled into as many drawn lines as they
 * need — the `pre-wrap` + `break-word` rules in the file header, over pieces
 * rather than over one string.
 *
 * A chunk that does not fit after what is already on the line starts a new one;
 * a chunk that does not fit even alone is split between CODE POINTS (`for..of`
 * walks code points, so a break never halves an emoji into two lone
 * surrogates). The `current.length > 0` guard is what stops a single character
 * wider than the whole line from looping forever — it goes on the line and
 * overflows, which is what a browser does too.
 */
function wrapLine(chunks: readonly Piece[][], wrapWidth: number, measureRun: (text: string, font: string) => number): Piece[][] {
  const width = (pieces: readonly Piece[]): number => mergeRuns(withoutHangingSpaces(pieces), measureRun).width;
  const lines: Piece[][] = [];
  let current: Piece[] = [];
  for (const chunk of chunks) {
    if (current.length > 0) {
      const candidate = current.concat(chunk);
      if (width(candidate) <= wrapWidth) {
        current = candidate;
        continue;
      }
      // Does not fit after what is already on the line: break here, and let
      // `current`'s own trailing spaces hang off the end of the pushed line.
      lines.push(withoutHangingSpaces(current));
      current = [];
    }
    if (width(chunk) <= wrapWidth) {
      current = chunk.slice(); // fits on a line of its own — the ordinary case
      continue;
    }
    // Too wide even alone. `overflow-wrap: break-word`'s last resort.
    for (const piece of chunk) {
      for (const character of piece.text) {
        const candidate = appendCharacter(current, piece.font, character);
        if (current.length > 0 && width(candidate) > wrapWidth) {
          lines.push(withoutHangingSpaces(current));
          current = [{ text: character, font: piece.font }];
        } else {
          current = candidate;
        }
      }
    }
  }
  lines.push(withoutHangingSpaces(current));
  return lines;
}

/**
 * Where every line and every run of `request.text` goes.
 *
 * Why it is one function with two readers: `renderer.ts` draws exactly what this
 * returns and this file measures exactly what it returns, so "how wide is this
 * text" and "where does this glyph go" can never be two answers (D-010). It is
 * also why `markup` is a parameter rather than two functions — the wrap rules,
 * the hanging spaces and the code-point splitting are the same either way, and a
 * second copy of them is how the canvas and the overlay drifted apart before.
 *
 * Returns an EMPTY layout for an unusable `style.fontSize` — the caller decides
 * whether that is a zero box (`measure`) or a reason to substitute a default and
 * draw anyway (`renderer.ts`); this file does not invent a size. An unusable
 * `lineHeight` falls back to single spacing (`fontSize`). Never throws.
 */
export function layOutText(request: TextLayoutRequest): TextLayout {
  const fontSize = finitePositive(request.style.fontSize);
  if (fontSize === undefined) {
    return { lines: [], width: 0, height: 0 };
  }
  // Not a usable length -> single-spaced fallback (`fontSize`). A defensive
  // default, not an invented one: `measureTextBox` already `#TYPE`s a
  // non-number `style.lineHeight`, so only a negative / `NaN` one slips here.
  const lineHeight = finitePositive(request.style.lineHeight) ?? fontSize;
  // D-120: the wrap boundary comes from the `width` slot; a non-positive /
  // non-finite one means "no wrap", same as `"auto"` (§5.6 layout).
  const wrapWidth = request.wrapWidth === undefined ? undefined : finitePositive(request.wrapWidth);
  const sourceLines = request.markup ? parseMarkdownLite(request.text) : verbatimLines(request.text);

  const lines: LaidOutLine[] = [];
  let top = 0;
  let widest = 0;
  for (const sourceLine of sourceLines) {
    const scale = headingScale(sourceLine);
    const height = lineHeight * scale;
    const chunks = chunksOf(sourceLine, request.style.font, fontSize * scale);
    // No wrap width means the operator's own hard lines, untouched — trailing
    // spaces included, since nothing here is deciding where a line ends.
    const wrapped = wrapWidth === undefined ? [chunks.flat()] : wrapLine(chunks, wrapWidth, request.measureRun);
    for (const linePieces of wrapped) {
      const { runs, width } = mergeRuns(linePieces, request.measureRun);
      lines.push({ runs, top, width, height });
      if (width > widest) {
        widest = width;
      }
      top += height;
    }
  }
  return { lines, width: widest, height: top };
}

/**
 * A Canvas2D-backed `TextMeasurer` (§5.6, Rule 1) over `layOutText`. `ctx` is
 * any object with a settable `font` and a `measureText` — `main.ts` passes a
 * real 2D context (its OWN, separate from the renderer's, so setting `font`
 * here never disturbs a draw in progress).
 *
 * `measure` follows `eval-context.ts`'s contract to the letter: it never throws
 * and always returns two finite, non-negative numbers. Line-breaking is done
 * here with `ctx.measureText` (**D-120**, answering Q-021).
 */
function createMeasurer(ctx: MeasurementContext, markup: boolean): TextMeasurer {
  const measureRun = (text: string, font: string): number => {
    ctx.font = font;
    return finiteOrZero(ctx.measureText(text).width);
  };
  return {
    measure(text: string, style: TextStyle, maxWidth?: number): TextMeasurement {
      if (finitePositive(style.fontSize) === undefined || text === "") {
        // No usable size, or nothing to measure — a zero box, same as
        // NULL_TEXT_MEASURER. `ctx.font` is deliberately left untouched here.
        return { width: 0, height: 0 };
      }
      const layout = layOutText({ text, style, wrapWidth: maxWidth, markup, measureRun });
      return { width: finiteOrZero(layout.width), height: finiteOrZero(layout.height) };
    },
  };
}

/**
 * The measurer the ENGINE gets (`main.ts`'s `EvalContext`), and therefore the
 * one `measuredWidth` / `measuredHeight` are computed by: markup-aware, because
 * the canvas draws markup. `**bold**` measures as four bold characters, which is
 * what makes the box `render/textbox.ts` sizes match the ink `renderer.ts` puts
 * in it (D-123 clause 5 — the box follows the text).
 */
export function createCanvas2dTextMeasurer(ctx: MeasurementContext): TextMeasurer {
  return createMeasurer(ctx, true);
}

/**
 * The measurer the in-place editor's OVERLAY is sized by: markup is measured
 * verbatim, because a `<textarea>` can only ever show the raw source and the
 * box has to hold what is actually being typed.
 *
 * PROVISIONAL(Q-025): the human has not yet ruled what the overlay shows once
 * the canvas renders markdown. This is recommendation (a) — raw source, measured
 * raw — taken provisionally per STATUS's instruction to the markdown cycle. If
 * (b) is ruled instead, this function goes and `main.ts` passes the markup-aware
 * measurer to `editorTextBoxSize`; nothing stored depends on the answer.
 */
export function createSourceTextMeasurer(ctx: MeasurementContext): TextMeasurer {
  return createMeasurer(ctx, false);
}
