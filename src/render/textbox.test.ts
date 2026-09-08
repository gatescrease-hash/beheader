/**
 * textbox.test.ts
 *
 * The one rule for the size of a text box, over every combination of
 * fixed and measured size.
 */
import { describe, expect, it } from "vitest";
import { textBoxSize, TEXT_FALLBACK_BOX_HEIGHT, TEXT_FALLBACK_BOX_WIDTH } from "./textbox.ts";

function measured(measuredWidth: number, measuredHeight: number) {
  return { fixedWidth: undefined, fixedHeight: undefined, autoresize: true, measuredWidth, measuredHeight };
}

describe("textBoxSize — no set size: the box hugs its text", () => {
  it("is the measurement on both axes", () => {
    expect(textBoxSize(measured(137, 60))).toEqual({ width: 137, height: 60 });
  });

  it("falls back to a fixed box when there is no usable measurement either — the case with no real measurer, where nothing better is knowable", () => {
    expect(textBoxSize(measured(0, 0))).toEqual({ width: TEXT_FALLBACK_BOX_WIDTH, height: TEXT_FALLBACK_BOX_HEIGHT });
  });
});

describe("textBoxSize — a set HEIGHT, and what autoresize does with it", () => {
  it("grows past the set height when the text is taller — a text box never crops (the human, 2026-09-02)", () => {
    expect(textBoxSize({ ...measured(100, 200), fixedHeight: 50, autoresize: false }).height).toBe(200);
  });

  it("keeps the set height when the text is shorter and autoresize is OFF — 'stay as it was'", () => {
    expect(textBoxSize({ ...measured(100, 20), fixedHeight: 120, autoresize: false }).height).toBe(120);
  });

  it("shrinks back to the text when autoresize is ON — 'shrink to fit'", () => {
    expect(textBoxSize({ ...measured(100, 20), fixedHeight: 120, autoresize: true }).height).toBe(20);
  });

  it("keeps the set height when there is no usable measurement, whatever autoresize says", () => {
    expect(textBoxSize({ ...measured(100, 0), fixedHeight: 120, autoresize: true }).height).toBe(120);
    expect(textBoxSize({ ...measured(100, 0), fixedHeight: 120, autoresize: false }).height).toBe(120);
  });
});

describe("textBoxSize — a set WIDTH is a floor, never a ceiling", () => {
  it("holds when the text fits inside it, even with autoresize ON — a set width is also the WRAP width, so shrinking it would hide the operator's own dragged edge while still wrapping there", () => {
    expect(textBoxSize({ ...measured(60, 20), fixedWidth: 300, autoresize: true }).width).toBe(300);
  });

  it("grows to the measurement when the text could not be wrapped into it — one word longer than the box (measure.ts breaks between words only)", () => {
    expect(textBoxSize({ ...measured(400, 20), fixedWidth: 60, autoresize: false }).width).toBe(400);
  });

  it("holds when there is no usable measurement", () => {
    expect(textBoxSize({ ...measured(0, 20), fixedWidth: 300, autoresize: true }).width).toBe(300);
  });
});

describe("textBoxSize — a bad number is treated as absent, never propagated", () => {
  it("ignores a non-finite or non-positive set size", () => {
    expect(textBoxSize({ ...measured(100, 40), fixedWidth: Number.NaN, fixedHeight: -5 })).toEqual({ width: 100, height: 40 });
    expect(textBoxSize({ ...measured(100, 40), fixedWidth: 0, fixedHeight: Number.POSITIVE_INFINITY })).toEqual({ width: 100, height: 40 });
  });

  it("ignores a non-finite or non-positive measurement", () => {
    expect(textBoxSize({ ...measured(Number.NaN, -1), fixedWidth: 200, fixedHeight: 80, autoresize: true })).toEqual({
      width: 200,
      height: 80,
    });
  });

  it("always returns two finite positive numbers, even given nothing usable at all", () => {
    const box = textBoxSize({
      fixedWidth: Number.NaN,
      fixedHeight: Number.NaN,
      autoresize: true,
      measuredWidth: undefined,
      measuredHeight: undefined,
    });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(Number.isFinite(box.width) && Number.isFinite(box.height)).toBe(true);
  });
});
