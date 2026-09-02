/**
 * measure.ts — The Canvas2D-backed `TextMeasurer` (Rule 1's text-measurement seam).
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.6 (`measuredHeight` "computed via the injected
 * `TextMeasurer`"; "fixed width + auto height (wrap, grow down) is the default"),
 * Rule 1's text-measurement trap (`engine/eval-context.ts` DEFINES the interface;
 * "`src/render/` provides the real Canvas2D-backed implementation and `main.ts`
 * wires it in"), and **D-120** (line-breaking lives HERE, never in `src/engine/`;
 * `measure` takes an optional `maxWidth`).
 * LAYER: render. Touches Canvas2D — the one layer Rule 1 does not bind (Rule 1 is
 *        `engine/`-only). May import: engine/* (read-only, for the interface it
 *        implements), own layer. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `createCanvas2dTextMeasurer(ctx)` -> a `TextMeasurer`
 *   (`engine/eval-context.ts`). `ctx` is anything with a settable `font` and a
 *   `measureText` — a real `CanvasRenderingContext2D` or a test fake. It answers
 *   §5.6's "how wide and how tall is this resolved text, at this style, wrapped
 *   to this width": width is the widest laid-out line from `ctx.measureText`,
 *   height is `lineCount * style.lineHeight`. `lineHeight` (like `fontSize`) is
 *   an ABSOLUTE length in the document's own unit, not a ratio — inherited from
 *   `engine/eval-context.ts`'s `TextStyle` doc, not re-decided here.
 *
 *   `layOutLines` and `cssFont` are also EXPORTED (entry 0138): `renderer.ts`'s
 *   text-drawing pass breaks lines and builds its `ctx.font` string the SAME way
 *   the measurement does, so the text it draws occupies exactly the box that was
 *   measured (D-010 — one reading of "how does this text lay out", shared, never
 *   two that can drift). `renderer.ts` draws in world space under the camera
 *   transform; this file measures with the transform at identity; both feed
 *   `ctx.measureText` the same `cssFont` string and compare against the same
 *   world-unit `maxWidth`, so the line breaks land identically.
 *
 *   That agreement holds WHILE both files read the same usable `style.*` slots —
 *   true of every object `command/commands.ts`'s `createText` builds. When a
 *   `style.*` slot is missing or unusable the two fall back DIFFERENTLY: here an
 *   unusable `lineHeight` becomes `fontSize` and an unusable `fontSize` returns a
 *   zero box, while `renderer.ts` substitutes its own `DEFAULT_TEXT_*` and draws
 *   anyway (deliberately — it would rather show text than blank the box). So for
 *   a hand-built or loaded `text` object with a broken style, drawn and measured
 *   CAN disagree. Disclosed, not fixed: one shared set of fallbacks needs a
 *   ruling on which file owns them (0139-REVIEW).
 *
 *   LINE-BREAKING (**D-120**): split on the operator's own newlines first, then
 *   — ONLY when `maxWidth` is a positive finite number — greedily word-wrap each
 *   hard line, measuring candidates with `ctx.measureText`. No `maxWidth`
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
 *     - **A word wider than `maxWidth` is BROKEN between characters.** It used to
 *       sit alone and overflow, which meant a long unbroken run of text — a URL,
 *       a keyboard mash — punched straight out through the side of its own box on
 *       the canvas while the editor broke it neatly. `overflow-wrap: break-word`
 *       is the CSS rule reproduced: the word first moves to a line of its own,
 *       and only if it STILL does not fit is it split.
 *
 *   Rule 5 still applies to everything CSS does beyond that: no hyphenation, no
 *   dictionary, no grapheme-cluster or bidi handling, no tab stops (a tab is part
 *   of a word here — only U+0020 is a break opportunity). Those are differences
 *   between this measurer and a browser that no document reachable today can see.
 *
 * INVARIANTS UPHELD HERE
 *   - `measure` NEVER throws and ALWAYS returns two finite, non-negative
 *     numbers — `engine/eval-context.ts`'s `TextMeasurer` contract, which a pure
 *     `derived`-slot compute (`computeMeasuredHeight`) trusts the way it trusts
 *     `read`. A non-finite / non-positive `fontSize`, `lineHeight` or `maxWidth`,
 *     and a `measureText` returning a non-finite width, are each coerced to a
 *     safe value here rather than propagated.
 *   - An empty resolved string measures `{ width: 0, height: 0 }` — a text
 *     object with nothing in it takes no room (matching `NULL_TEXT_MEASURER`).
 *   - No wrap loop, whitespace rule, or markdown handling leaks into
 *     `src/engine/` (D-120 clause 2): every bit of it is in this file.
 *   - Lines are appended one at a time, never `push(...lines)` / `Math.max(...)`:
 *     the line count is a function of `resolvedContent`, itself a function of
 *     `content` — a `literal` slot the operator can make arbitrarily long — so a
 *     spread would be a `RangeError` at a size document state can reach (D-077
 *     clause 1).
 *   - Reads nothing from and writes nothing to graph state (Rule 2) — handed a
 *     `string` + a `TextStyle`, returns two numbers.
 *
 * NOT DONE HERE
 *   - WIRING this measurer into an `EvalContext` and threading that through
 *     `mutate` — `main.ts` plus the context-threading cycle
 *     (`engine/eval-context.ts`'s own NOT DONE HERE). Until that lands
 *     `measuredHeight` still reports `#MEASURE` for every real document (D-118).
 *   - Markdown-lite: `**bold**` / `# heading` markers are measured VERBATIM,
 *     because `resolvedContent` holds them verbatim (§5.6 — markdown rendering is
 *     `renderer.ts`'s, unbuilt). A later cycle may make the measurer
 *     markdown-aware; D-120's "the measurer's job" framing allows it and it is
 *     not decided here.
 *   - Drawing the text — `renderer.ts`'s text pass (entry 0138). It imports
 *     `layOutLines`/`cssFont` from here but does its own `fillText` loop; this
 *     file still only MEASURES.
 *   - `align` / `color` — they change how text is PAINTED, not its size, and are
 *     not in `TextStyle` (`engine/eval-context.ts`).
 */
import type { TextMeasurement, TextMeasurer, TextStyle } from "../engine/eval-context.ts";

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

/** A finite, positive number, or `undefined` — rejects a `fontSize`/`lineHeight`/`maxWidth` the measurer cannot use rather than letting a `NaN` reach the arithmetic. */
function finitePositive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A finite, non-negative number, or `0` — the last guard before a width/height leaves this file (`eval-context.ts`'s contract: `measure` always returns finite, non-negative). */
function finiteOrZero(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * `ctx.font` shorthand from a `TextStyle`: `"16px Inter, system-ui, sans-serif"`.
 * The size is `fontSize` px, so `ctx.measureText` returns widths numerically in
 * the same unit as `fontSize` (world units — `eval-context.ts`'s `TextStyle`).
 *
 * A blank family falls back to the generic `sans-serif` — NOT this file
 * inventing a typeface (`computeMeasuredHeight` already `#TYPE`s a non-string
 * `style.font`, so only `""` reaches here, and only from a hand-built or loaded
 * object), but so the measurement is DETERMINISTIC: an invalid `ctx.font`
 * assignment is silently ignored by the canvas, which would otherwise leave the
 * measurement running against whatever font the previous `measure` call set
 * (`render/camera.ts`'s `finiteOrFallback` posture — D-062 — applied to a font
 * string).
 */
export function cssFont(fontSize: number, family: string): string {
  return `${fontSize}px ${family.trim() === "" ? "sans-serif" : family}`;
}

/** A line's trailing spaces, removed. CSS Text 3 HANGS them at a `pre-wrap` line's end — they take no width, cannot force a break, and are invisible — so an emitted line drops them and every measurement here is of a line that has already been through this. Only U+0020, matching the one character this file treats as a break opportunity. */
function withoutHangingSpaces(line: string): string {
  return line.replace(/ +$/, "");
}

/**
 * One hard line, split at its soft-wrap opportunities: each chunk is one word
 * plus the spaces that FOLLOW it, because CSS puts the break opportunity AFTER a
 * space run, not before it. A leading space run (no word) is its own first
 * chunk, and every chunk concatenated is the input back verbatim — which is what
 * makes `layOutLines` preserve the operator's spacing instead of collapsing it.
 *
 * `"a  bb c"` -> `["a  ", "bb ", "c"]`; `"  x"` -> `["  ", "x"]`; `""` -> `[]`.
 */
function wrapChunks(hardLine: string): readonly string[] {
  return hardLine.match(/[^ ]+ *| +/g) ?? [];
}

/**
 * Splits `text` into the lines it lays out as: on its own newlines first (the
 * operator's hard breaks), then — only when `wrapWidth` is set — greedily
 * word-wrapping each hard line to fit. `measureWidth` is `ctx.measureText` with
 * `ctx.font` already set.
 *
 * Iterative, and appends one line at a time (see the file header's INVARIANTS):
 * the number of lines follows `content`'s length, which the operator controls.
 * A blank hard line stays one blank line.
 *
 * The whitespace and word-breaking rules are CSS's `pre-wrap` +
 * `overflow-wrap: break-word`, on purpose — see the file header's LINE-BREAKING
 * note. Spaces are preserved, trailing ones hang, and a word too wide for the
 * line even by itself is split between characters rather than left to overflow.
 * Iterating the word with `for..of` walks CODE POINTS, so a split never lands
 * inside a surrogate pair and halves an emoji.
 *
 * Exported (entry 0138) so `renderer.ts` draws the SAME lines this file measures
 * — see the file header. `wrapWidth` is the `text` object's `width` slot when it
 * holds a positive finite number, `undefined` for `"auto"` (no wrap).
 */
export function layOutLines(text: string, wrapWidth: number | undefined, measureWidth: (line: string) => number): readonly string[] {
  const hardLines = text.split(/\r?\n/);
  if (wrapWidth === undefined) {
    return hardLines;
  }
  const lines: string[] = [];
  for (const hardLine of hardLines) {
    let current = "";
    for (const chunk of wrapChunks(hardLine)) {
      if (current !== "") {
        if (measureWidth(withoutHangingSpaces(current + chunk)) <= wrapWidth) {
          current += chunk;
          continue;
        }
        // Does not fit after what is already on the line: break here, and let
        // `current`'s own trailing spaces hang off the end of the pushed line.
        lines.push(withoutHangingSpaces(current));
        current = "";
      }
      if (measureWidth(withoutHangingSpaces(chunk)) <= wrapWidth) {
        current = chunk; // fits on a line of its own — the ordinary case
        continue;
      }
      // Too wide even alone. `overflow-wrap: break-word`'s last resort: split
      // the word between characters. The `current !== ""` guard is what stops a
      // single character wider than the whole line from looping forever — it
      // goes on the line and overflows, which is what a browser does too.
      for (const character of chunk) {
        if (current !== "" && measureWidth(withoutHangingSpaces(current + character)) > wrapWidth) {
          lines.push(withoutHangingSpaces(current));
          current = character;
        } else {
          current += character;
        }
      }
    }
    lines.push(withoutHangingSpaces(current));
  }
  return lines;
}

/**
 * The Canvas2D-backed `TextMeasurer` (§5.6, Rule 1). `ctx` is any object with a
 * settable `font` and a `measureText` — `main.ts` passes a real 2D context (its
 * OWN, separate from the renderer's, so setting `font` here never disturbs a
 * draw in progress).
 *
 * `measure` follows `eval-context.ts`'s contract to the letter: it never throws
 * and always returns two finite, non-negative numbers. Line-breaking is done
 * here with `ctx.measureText` (**D-120**, answering Q-021).
 */
export function createCanvas2dTextMeasurer(ctx: MeasurementContext): TextMeasurer {
  const measureWidth = (line: string): number => finiteOrZero(ctx.measureText(line).width);
  return {
    measure(text: string, style: TextStyle, maxWidth?: number): TextMeasurement {
      const fontSize = finitePositive(style.fontSize);
      if (fontSize === undefined || text === "") {
        // No usable size, or nothing to measure — a zero box, same as
        // NULL_TEXT_MEASURER. `ctx.font` is deliberately left untouched here.
        return { width: 0, height: 0 };
      }
      // Not a usable length -> single-spaced fallback (`fontSize`). A defensive
      // default, not an invented one: `computeMeasuredHeight` already `#TYPE`s a
      // non-number `style.lineHeight`, so only a negative / `NaN` one slips here.
      const lineHeight = finitePositive(style.lineHeight) ?? fontSize;
      ctx.font = cssFont(fontSize, style.font);

      // D-120: `maxWidth` (from the `width` slot when numeric) is the wrap
      // boundary; a non-positive / non-finite one means "no wrap", same as
      // `"auto"` (§5.6 layout).
      const wrapWidth = maxWidth === undefined ? undefined : finitePositive(maxWidth);
      const lines = layOutLines(text, wrapWidth, measureWidth);

      let widest = 0;
      for (const line of lines) {
        const lineWidth = measureWidth(line);
        if (lineWidth > widest) {
          widest = lineWidth;
        }
      }
      return { width: finiteOrZero(widest), height: finiteOrZero(lines.length * lineHeight) };
    },
  };
}
