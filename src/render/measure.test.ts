/**
 * measure.test.ts — Tests for `measure.ts` (§5.6, Rule 1's `TextMeasurer` seam, D-120).
 *
 * No jsdom (D-001 / PROCESS_BRIEF §4: never add a runtime dependency): every
 * test builds a fake `MeasurementContext` — a settable `font` string and a
 * `measureText` that returns a width from the string's length — and records what
 * `font` it was set to. The render-layer analogue of the engine's injected-fake
 * `TextMeasurer` pattern (Rule 1's own test posture), and the same shape
 * `renderer.test.ts` already uses for its wider canvas fake.
 */
import { describe, expect, it } from "vitest";
import type { TextStyle } from "../engine/eval-context.ts";
import { createCanvas2dTextMeasurer, cssFont, layOutLines, type MeasurementContext } from "./measure.ts";

/** Per-character width the fake reports — keeps every expected number exact and hand-checkable, the way `renderer.test.ts`'s `FAKE_CHAR_WIDTH` does. */
const CHAR = 10;

/** A fake context: `measureText` is `CHAR` px per character, and every `font` it is set to is recorded so a test can assert the shorthand. */
function fakeContext(): { readonly ctx: MeasurementContext; readonly fonts: readonly string[] } {
  const fonts: string[] = [];
  const ctx: MeasurementContext = {
    set font(value: string) {
      fonts.push(value);
    },
    get font() {
      return fonts[fonts.length - 1] ?? "";
    },
    measureText(text: string) {
      return { width: text.length * CHAR };
    },
  };
  return { ctx, fonts };
}

const STYLE: TextStyle = { font: "Inter, sans-serif", fontSize: 16, lineHeight: 20 };

describe("createCanvas2dTextMeasurer — width", () => {
  it("measures a single unwrapped line as its character count times the glyph width", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("hello", STYLE).width).toBe(5 * CHAR);
  });

  it("reports the WIDEST line's width when the text has hard breaks", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("hi\nlonger line\nx", STYLE).width).toBe("longer line".length * CHAR);
  });

  it("sets ctx.font to `<fontSize>px <family>` so measureText's widths are in the fontSize unit", () => {
    const { ctx, fonts } = fakeContext();
    createCanvas2dTextMeasurer(ctx).measure("x", STYLE);
    expect(fonts).toContain("16px Inter, sans-serif");
  });
});

describe("createCanvas2dTextMeasurer — height is lineCount * lineHeight (lineHeight is an absolute length — eval-context.ts's TextStyle)", () => {
  it("is one lineHeight for a single line", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("one line", STYLE).height).toBe(20);
  });

  it("counts the operator's hard newlines, blank lines included", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("a\nb\nc", STYLE).height).toBe(3 * 20);
    expect(measurer.measure("a\n\nb", STYLE).height).toBe(3 * 20); // the blank middle line still counts
  });

  it("treats \\r\\n the same as \\n", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("a\r\nb", STYLE).height).toBe(2 * 20);
  });
});

describe("createCanvas2dTextMeasurer — an empty string measures a zero box (matches NULL_TEXT_MEASURER)", () => {
  it("returns { width: 0, height: 0 } for an empty resolved string", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("", STYLE)).toEqual({ width: 0, height: 0 });
  });

  it("does not even set ctx.font for an empty string", () => {
    const { ctx, fonts } = fakeContext();
    createCanvas2dTextMeasurer(ctx).measure("", STYLE);
    expect(fonts).toEqual([]);
  });
});

describe("createCanvas2dTextMeasurer — line-breaking lives here (D-120), and only when maxWidth is given", () => {
  it("does NOT wrap when maxWidth is undefined — a long line stays one line", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    const result = measurer.measure("one two three four five", STYLE);
    expect(result.height).toBe(20); // one line
    expect(result.width).toBe("one two three four five".length * CHAR);
  });

  it("greedily wraps a hard line to fit maxWidth, growing the height", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    // Each word is 3 chars = 30px; "aaa bbb" is 70px. maxWidth 75 fits two words
    // per line, so "aaa bbb ccc ddd" -> ["aaa bbb", "ccc ddd"] -> 2 lines.
    const result = measurer.measure("aaa bbb ccc ddd", STYLE, 75);
    expect(result.height).toBe(2 * 20);
    expect(result.width).toBe("aaa bbb".length * CHAR);
  });

  // The human's 2026-09-02 report: "the text wrapping ... refuses to break up
  // continuous streams of text without spaces, which also sort of breaks the box
  // boundaries". A word too wide for its own line used to sit there and punch
  // out through the side of the box, while the editor's `<textarea>` — which has
  // `overflow-wrap: break-word` — broke it neatly. Now both break it.
  it("BREAKS a word wider than maxWidth between characters rather than letting it overflow (CSS `overflow-wrap: break-word`)", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    // CHAR = 10, maxWidth 50 -> five characters per line. The 20-character word
    // fills four of them, then "short" (exactly 50) follows on its own.
    const result = measurer.measure("supercalifragilistic short", STYLE, 50);
    expect(result.height).toBe(5 * 20);
    // The measured width no longer exceeds the wrap width — which is what stops
    // the drawn text from escaping its own box.
    expect(result.width).toBe(50);
  });

  it("moves the long word to a fresh line FIRST and only then breaks it — `break-word`, not `break-all`", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    // "ab" (20px) is on line 1; the 8-char word does not fit after it, so it
    // starts line 2 whole and is split from there — never "ab" + "abcd" on one.
    expect(layOutLines("ab abcdefgh", 50, (line) => line.length * CHAR)).toEqual(["ab", "abcde", "fgh"]);
  });

  it("never loops forever when even ONE character is wider than the line — it goes on and overflows, as a browser does", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    const result = measurer.measure("abc", STYLE, 4); // 4px wide box, 10px characters
    expect(result.height).toBe(3 * 20); // one character per line
    expect(result.width).toBe(CHAR);
  });

  it("wraps each hard line independently — a newline plus wrapping compound", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    // "aaa bbb" wraps to 2 lines at maxWidth 35 (one 3-char word = 30px per line); "ccc" is its own hard line.
    expect(measurer.measure("aaa bbb\nccc", STYLE, 35).height).toBe(3 * 20);
  });

  // Also the human's 2026-09-02 report ("some edge cases where the text shows as
  // X lines in the rendered mode but pops to X+1 lines in the editor mode").
  // `white-space: pre-wrap` — what a soft-wrapping `<textarea>` uses — PRESERVES
  // a run of spaces, so collapsing it here made the canvas fit text on one line
  // that the editor had already pushed onto two.
  it("PRESERVES a run of spaces when fitting, so it can force the same break the editor's pre-wrap does", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    // "aaa bbb" (70px) fits in 75; "aaa    bbb" (100px) does not.
    expect(measurer.measure("aaa bbb", STYLE, 75).height).toBe(20);
    expect(measurer.measure("aaa    bbb", STYLE, 75).height).toBe(2 * 20);
  });

  it("HANGS spaces at the end of a line (CSS Text 3): they neither force a break nor widen the box", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    const result = measurer.measure("aaa     ", STYLE, 40); // 3 characters of text, 5 of trailing space
    expect(result.height).toBe(20); // still one line
    expect(result.width).toBe(3 * CHAR); // the spaces take no room in the box
  });

  it("does not wrap for a non-positive or non-finite maxWidth (same as 'auto')", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("one two three four", STYLE, 0).height).toBe(20);
    expect(measurer.measure("one two three four", STYLE, -5).height).toBe(20);
    expect(measurer.measure("one two three four", STYLE, Number.POSITIVE_INFINITY).height).toBe(20);
  });
});

describe("createCanvas2dTextMeasurer — the eval-context.ts contract: never throws, always finite and non-negative", () => {
  it("returns a zero box for a non-finite or non-positive fontSize rather than a NaN measurement", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("hello", { ...STYLE, fontSize: Number.NaN })).toEqual({ width: 0, height: 0 });
    expect(measurer.measure("hello", { ...STYLE, fontSize: 0 })).toEqual({ width: 0, height: 0 });
    expect(measurer.measure("hello", { ...STYLE, fontSize: -4 })).toEqual({ width: 0, height: 0 });
  });

  it("falls back to single spacing (fontSize) for a NaN or non-positive lineHeight", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("a\nb", { ...STYLE, lineHeight: Number.NaN }).height).toBe(2 * STYLE.fontSize);
    expect(measurer.measure("a\nb", { ...STYLE, lineHeight: -1 }).height).toBe(2 * STYLE.fontSize);
  });

  it("coerces a non-finite width back from measureText to 0 rather than propagating it", () => {
    const ctx: MeasurementContext = { font: "", measureText: () => ({ width: Number.NaN }) };
    const result = createCanvas2dTextMeasurer(ctx).measure("hello", STYLE);
    expect(result.width).toBe(0);
    expect(Number.isFinite(result.height)).toBe(true);
  });

  it("falls back to a generic family for a blank style.font, so the measurement is deterministic", () => {
    const { ctx, fonts } = fakeContext();
    createCanvas2dTextMeasurer(ctx).measure("x", { ...STYLE, font: "   " });
    expect(fonts).toContain("16px sans-serif");
  });

  it("never throws for any of the pathological inputs above", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(() => measurer.measure("", STYLE)).not.toThrow();
    expect(() => measurer.measure("x".repeat(5000), STYLE, 1)).not.toThrow();
    expect(() => measurer.measure("a\n".repeat(2000), { ...STYLE, lineHeight: 0 })).not.toThrow();
  });
});

describe("layOutLines / cssFont — exported for renderer.ts to draw the SAME lines this file measures (entry 0138)", () => {
  const width = (line: string): number => line.length * CHAR;

  it("splits on hard newlines and does not wrap when wrapWidth is undefined", () => {
    expect(layOutLines("a\nbb\nccc", undefined, width)).toEqual(["a", "bb", "ccc"]);
    expect(layOutLines("one very long line", undefined, width)).toEqual(["one very long line"]);
  });

  it("treats \\r\\n as a hard break and keeps a blank line", () => {
    expect(layOutLines("a\r\n\r\nb", undefined, width)).toEqual(["a", "", "b"]);
  });

  it("greedily word-wraps each hard line when wrapWidth is set", () => {
    // CHAR = 10: "aaa" is 30px, "aaa bbb" is 70px; wrapWidth 40 -> one word per line.
    expect(layOutLines("aaa bbb ccc", 40, width)).toEqual(["aaa", "bbb", "ccc"]);
    expect(layOutLines("aaa bbb\nzzz", 100, width)).toEqual(["aaa bbb", "zzz"]);
  });

  // `renderer.ts` DRAWS these strings. Collapsing a double space here did not
  // just move a wrap point — it drew "a  b" as "a b", so the text visibly
  // changed the moment the editor closed. That is the exact thing the
  // 2026-09-02 rework exists to make impossible.
  it("emits the operator's spacing VERBATIM, so the drawn glyphs are the typed ones", () => {
    expect(layOutLines("a  b", 200, width)).toEqual(["a  b"]);
    expect(layOutLines("  indented", 200, width)).toEqual(["  indented"]);
  });

  it("drops only the trailing spaces of an emitted line — they hang, and drawing them could shift centred text", () => {
    expect(layOutLines("aaa   bbb   ", 60, width)).toEqual(["aaa", "bbb"]);
  });

  it("splits a long word between CODE POINTS, so a break never halves an emoji into two lone surrogates", () => {
    // Each astral character is one code point and (to the fake) two "characters"
    // of width, since `.length` counts UTF-16 units. Four of them at wrapWidth
    // 40 -> two per line, and every emitted piece must still be a valid string.
    const lines = layOutLines("😀😀😀😀", 40, width);
    expect(lines).toEqual(["😀😀", "😀😀"]);
    expect(lines.join("")).toBe("😀😀😀😀");
  });

  it("cssFont builds `<size>px <family>` and falls back to sans-serif for a blank family", () => {
    expect(cssFont(16, "Inter, sans-serif")).toBe("16px Inter, sans-serif");
    expect(cssFont(24, "   ")).toBe("24px sans-serif");
  });
});
