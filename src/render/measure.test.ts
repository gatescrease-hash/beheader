/**
 * measure.test.ts
 *
 * The line breaker and the two measurers.
 */
import { describe, expect, it } from "vitest";
import type { TextStyle } from "../engine/index.ts";
import { createCanvas2dTextMeasurer, createSourceTextMeasurer, cssFont, layOutText, type MeasurementContext } from "./measure.ts";

const CHAR = 10;

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

function plainLines(text: string, wrapWidth: number | undefined, measure: (line: string) => number): readonly string[] {
  return layOutText({ text, style: STYLE, wrapWidth, markup: false, measureRun: (runText) => measure(runText) }).lines.map(
    (line) => line.runs.map((run) => run.text).join(""),
  );
}

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
    expect(measurer.measure("a\n\nb", STYLE).height).toBe(3 * 20);
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

describe("createCanvas2dTextMeasurer — line-breaking lives here, and only when maxWidth is given", () => {
  it("does NOT wrap when maxWidth is undefined — a long line stays one line", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    const result = measurer.measure("one two three four five", STYLE);
    expect(result.height).toBe(20);
    expect(result.width).toBe("one two three four five".length * CHAR);
  });

  it("greedily wraps a hard line to fit maxWidth, growing the height", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    const result = measurer.measure("aaa bbb ccc ddd", STYLE, 75);
    expect(result.height).toBe(2 * 20);
    expect(result.width).toBe("aaa bbb".length * CHAR);
  });

  it("BREAKS a word wider than maxWidth between characters rather than letting it overflow (CSS `overflow-wrap: break-word`)", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    const result = measurer.measure("supercalifragilistic short", STYLE, 50);
    expect(result.height).toBe(5 * 20);
    expect(result.width).toBe(50);
  });

  it("moves the long word to a fresh line FIRST and only then breaks it — `break-word`, not `break-all`", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(plainLines("ab abcdefgh", 50, (line) => line.length * CHAR)).toEqual(["ab", "abcde", "fgh"]);
  });

  it("never loops forever when even ONE character is wider than the line — it goes on and overflows, as a browser does", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    const result = measurer.measure("abc", STYLE, 4);
    expect(result.height).toBe(3 * 20);
    expect(result.width).toBe(CHAR);
  });

  it("wraps each hard line independently — a newline plus wrapping compound", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("aaa bbb\nccc", STYLE, 35).height).toBe(3 * 20);
  });

  it("PRESERVES a run of spaces when fitting, so it can force the same break the editor's pre-wrap does", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(measurer.measure("aaa bbb", STYLE, 75).height).toBe(20);
    expect(measurer.measure("aaa    bbb", STYLE, 75).height).toBe(2 * 20);
  });

  it("HANGS spaces at the end of a line (CSS Text 3): they neither force a break nor widen the box", () => {
    const measurer = createCanvas2dTextMeasurer(fakeContext().ctx);
    const result = measurer.measure("aaa     ", STYLE, 40);
    expect(result.height).toBe(20);
    expect(result.width).toBe(3 * CHAR);
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

describe("layOutText / cssFont — exported for renderer.ts to draw the SAME lines this file measures", () => {
  const width = (line: string): number => line.length * CHAR;

  it("splits on hard newlines and does not wrap when wrapWidth is undefined", () => {
    expect(plainLines("a\nbb\nccc", undefined, width)).toEqual(["a", "bb", "ccc"]);
    expect(plainLines("one very long line", undefined, width)).toEqual(["one very long line"]);
  });

  it("treats \\r\\n as a hard break and keeps a blank line", () => {
    expect(plainLines("a\r\n\r\nb", undefined, width)).toEqual(["a", "", "b"]);
  });

  it("greedily word-wraps each hard line when wrapWidth is set", () => {
    expect(plainLines("aaa bbb ccc", 40, width)).toEqual(["aaa", "bbb", "ccc"]);
    expect(plainLines("aaa bbb\nzzz", 100, width)).toEqual(["aaa bbb", "zzz"]);
  });

  it("emits the operator's spacing VERBATIM, so the drawn glyphs are the typed ones", () => {
    expect(plainLines("a  b", 200, width)).toEqual(["a  b"]);
    expect(plainLines("  indented", 200, width)).toEqual(["  indented"]);
  });

  it("drops only the trailing spaces of an emitted line — they hang, and drawing them could shift centred text", () => {
    expect(plainLines("aaa   bbb   ", 60, width)).toEqual(["aaa", "bbb"]);
  });

  it("splits a long word between CODE POINTS, so a break never halves an emoji into two lone surrogates", () => {
    const lines = plainLines("😀😀😀😀", 40, width);
    expect(lines).toEqual(["😀😀", "😀😀"]);
    expect(lines.join("")).toBe("😀😀😀😀");
  });

  it("cssFont builds `<size>px <family>` and falls back to sans-serif for a blank family", () => {
    expect(cssFont(16, "Inter, sans-serif")).toBe("16px Inter, sans-serif");
    expect(cssFont(24, "   ")).toBe("24px sans-serif");
  });
});

describe("layOutText — markup:true honours the markdown lite rules; markup:false takes every character at face value", () => {
  const width = (line: string): number => line.length * CHAR;

  function markupLayout(text: string, wrapWidth?: number) {
    return layOutText({ text, style: STYLE, wrapWidth, markup: true, measureRun: (runText) => width(runText) });
  }

  function allRuns(text: string, wrapWidth?: number) {
    return markupLayout(text, wrapWidth).lines.flatMap((line) => line.runs);
  }

  it("drops the markers from the drawn text, so `**bold**` occupies four characters and not eight", () => {
    expect(markupLayout("**bold**").width).toBe(4 * CHAR);
    expect(markupLayout("**bold**").lines[0]?.runs.map((run) => run.text)).toEqual(["bold"]);
  });

  it("keeps every character when markup is NOT honoured — the overlay measures what the operator actually typed", () => {
    expect(plainLines("**bold**", undefined, width)).toEqual(["**bold**"]);
    expect(
      layOutText({ text: "**bold**", style: STYLE, wrapWidth: undefined, markup: false, measureRun: (runText) => width(runText) }).width,
    ).toBe(8 * CHAR);
  });

  it("puts a bold run in a bold font and an italic run in an italic one, in the CSS shorthand's order", () => {
    expect(allRuns("**b**")[0]?.font).toBe("bold 16px Inter, sans-serif");
    expect(allRuns("*i*")[0]?.font).toBe("italic 16px Inter, sans-serif");
    expect(allRuns("**a *b* c**")[1]?.font).toBe("italic bold 16px Inter, sans-serif");
  });

  it("puts a code run in the generic monospace family at the same size", () => {
    expect(allRuns("`x`")[0]?.font).toBe("16px monospace");
  });

  it("leaves a plain run's font EXACTLY what it was before markdown existed — no empty prefix", () => {
    expect(allRuns("plain")[0]?.font).toBe("16px Inter, sans-serif");
  });

  it("scales a heading's size AND its line height by CSS's own h1/h2/h3 em sizes, and draws it bold", () => {
    expect(allRuns("# Big")[0]?.font).toBe("bold 32px Inter, sans-serif");
    expect(allRuns("## Big")[0]?.font).toBe("bold 24px Inter, sans-serif");
    expect(markupLayout("# Big").height).toBe(2 * 20);
    expect(markupLayout("## Big").height).toBe(1.5 * 20);
  });

  it("stacks a heading's neighbours below its OWN height, not below one lineHeight", () => {
    const layout = markupLayout("# Big\nafter");
    expect(layout.lines[0]?.top).toBe(0);
    expect(layout.lines[1]?.top).toBe(40);
    expect(layout.height).toBe(60);
  });

  it("draws a list item's bullet as part of the line", () => {
    expect(markupLayout("- milk").lines[0]?.runs.map((run) => run.text)).toEqual(["• milk"]);
  });

  it("merges adjacent runs in the SAME font into one run, so a plain line is one fillText and one measureText", () => {
    expect(markupLayout("a  b").lines[0]?.runs).toHaveLength(1);
  });

  it("positions each run after the widths of the runs before it", () => {
    const runs = allRuns("ab**cd**");
    expect(runs.map((run) => ({ text: run.text, x: run.x, width: run.width }))).toEqual([
      { text: "ab", x: 0, width: 2 * CHAR },
      { text: "cd", x: 2 * CHAR, width: 2 * CHAR },
    ]);
  });

  it("does NOT break a word at a run boundary — `**bo**ld` is one word to CSS and to this file", () => {
    expect(markupLayout("**bo**ld", 40).lines).toHaveLength(1);
  });

  it("wraps markup text at the width the markers do NOT count toward", () => {
    expect(markupLayout("**aaa** bbb", 70).lines).toHaveLength(1);
    expect(plainLines("**aaa** bbb", 70, width)).toHaveLength(2);
  });
});

describe("createSourceTextMeasurer — the measurer for the overlay", () => {
  it("measures markup verbatim where the canvas measurer measures it rendered", () => {
    const source = createSourceTextMeasurer(fakeContext().ctx);
    const canvas = createCanvas2dTextMeasurer(fakeContext().ctx);
    expect(source.measure("**bold**", STYLE).width).toBe(8 * CHAR);
    expect(canvas.measure("**bold**", STYLE).width).toBe(4 * CHAR);
  });

  it("gives a heading line one ordinary line height, because a textarea shows `# ` as two characters", () => {
    const source = createSourceTextMeasurer(fakeContext().ctx);
    expect(source.measure("# Big", STYLE).height).toBe(20);
  });

  it("keeps every other part of the contract — zero box for empty text, never throws", () => {
    const source = createSourceTextMeasurer(fakeContext().ctx);
    expect(source.measure("", STYLE)).toEqual({ width: 0, height: 0 });
    expect(() => source.measure("*".repeat(4000), STYLE, 1)).not.toThrow();
  });
});

describe("layOutText — a wrapped list item hangs its continuation lines under its text", () => {
  const width = (line: string): number => line.length * CHAR;

  function listLayout(text: string, wrapWidth?: number) {
    return layOutText({ text, style: STYLE, wrapWidth, markup: true, measureRun: (runText) => width(runText) });
  }

  it("starts the FIRST line at zero and every continuation at the bullet's width", () => {
    const lines = listLayout("- aaa bbb", 60).lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]?.runs[0]?.x).toBe(0);
    expect(lines[1]?.runs[0]?.x).toBe(2 * CHAR);
  });

  it("wraps the continuation at the NARROWER width, so the indent cannot push a word out of the box", () => {
    const lines = listLayout("- aaa bbb ccc", 60).lines;
    expect(lines.map((line) => line.runs.map((run) => run.text).join(""))).toEqual(["• aaa", "bbb", "ccc"]);
  });

  it("counts the indent in the line's width, so measuredWidth is wide enough to hold the indented text", () => {
    const layout = listLayout("- aaa bbb", 60);
    expect(layout.lines[1]?.width).toBe(2 * CHAR + 3 * CHAR);
    expect(layout.width).toBe(50);
  });

  it("indents NOTHING when the line does not wrap — there is no continuation to hang", () => {
    expect(listLayout("- short", 200).lines[0]?.runs[0]?.x).toBe(0);
    expect(listLayout("- short").lines).toHaveLength(1);
  });

  it("indents no other kind of line — a wrapped paragraph and a wrapped heading both start at zero", () => {
    for (const text of ["aaa bbb ccc", "# aaa bbb ccc"]) {
      const lines = listLayout(text, 60).lines;
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[1]?.runs[0]?.x).toBe(0);
    }
  });

  it("gives up the indent rather than the text when the bullet is as wide as the whole box", () => {
    const lines = listLayout("- aaa bbb", 15).lines;
    for (const line of lines) {
      expect(line.runs[0]?.x ?? 0).toBe(0);
    }
  });

  it("indents by the BULLET's own width even when the item's text is a different font", () => {
    expect(listLayout("- `aaa` `bbb`", 60).lines[1]?.runs[0]?.x).toBe(2 * CHAR);
  });
});
