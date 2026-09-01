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
import { createCanvas2dTextMeasurer, type MeasurementContext } from "./measure.ts";

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

  it("puts a word wider than maxWidth alone on its line and lets it overflow (no mid-word breaking)", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    const result = measurer.measure("supercalifragilistic short", STYLE, 50);
    expect(result.height).toBe(2 * 20); // the long word, then "short"
    expect(result.width).toBe("supercalifragilistic".length * CHAR); // overflows past 50
  });

  it("wraps each hard line independently — a newline plus wrapping compound", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    // "aaa bbb" wraps to 2 lines at maxWidth 35 (one 3-char word = 30px per line); "ccc" is its own hard line.
    expect(measurer.measure("aaa bbb\nccc", STYLE, 35).height).toBe(3 * 20);
  });

  it("collapses a run of spaces for wrap fitting", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("aaa    bbb", STYLE, 75).height).toBe(20); // one line — the double space does not force a break
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
