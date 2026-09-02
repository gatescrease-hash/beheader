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
 *   hard line, measuring candidates with `ctx.measureText`. A word wider than
 *   `maxWidth` sits alone and overflows: no mid-word breaking, no hyphenation
 *   (Rule 5; §5.6 asks for none). No `maxWidth` (`width` is `"auto"`) -> no wrap.
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

/**
 * Splits `text` into the lines it lays out as: on its own newlines first (the
 * operator's hard breaks), then — only when `wrapWidth` is set — greedily
 * word-wrapping each hard line to fit. `measureWidth` is `ctx.measureText` with
 * `ctx.font` already set.
 *
 * Iterative, and appends one line at a time (see the file header's INVARIANTS):
 * the number of lines follows `content`'s length, which the operator controls.
 * A run of spaces is collapsed for wrap fitting (Rule 5 — D-120 leaves the
 * whitespace rule to this file); a blank hard line stays one blank line.
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
    for (const word of hardLine.split(" ")) {
      if (word === "") {
        continue; // a run of spaces — collapsed for wrap fitting
      }
      const candidate = current === "" ? word : `${current} ${word}`;
      if (current !== "" && measureWidth(candidate) > wrapWidth) {
        lines.push(current);
        current = word; // a word wider than wrapWidth still goes on its own line and overflows
      } else {
        current = candidate;
      }
    }
    lines.push(current);
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
