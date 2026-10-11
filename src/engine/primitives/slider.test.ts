/**
 * slider.test.ts
 *
 * These tests cover the rule a slider's knob follows: where along the track
 * gives which value, stepped from the minimum and held to the ends, and where
 * a value puts the knob.
 */
import { describe, expect, it } from "vitest";
import { sliderFraction, sliderValueAt } from "./slider.ts";

describe("sliderValueAt", () => {
  it("maps the ends of the track to the ends of the range, and holds a fraction past either end", () => {
    expect(sliderValueAt(0, 0, 10, 1)).toBe(0);
    expect(sliderValueAt(1, 0, 10, 1)).toBe(10);
    expect(sliderValueAt(-0.5, 0, 10, 1)).toBe(0);
    expect(sliderValueAt(1.5, 0, 10, 1)).toBe(10);
  });

  it("rounds to the nearest step counted from the minimum", () => {
    expect(sliderValueAt(0.34, 0, 10, 1)).toBe(3);
    expect(sliderValueAt(0.5, 0.5, 2.5, 1)).toBe(1.5);
    expect(sliderValueAt(0.3, 0, 10, 2.5)).toBe(2.5);
  });

  it("keeps the decimals of the step, with no binary rounding error", () => {
    expect(sliderValueAt(0.3, 0, 1, 0.1)).toBe(0.3);
    expect(sliderValueAt(0.7, 0, 1, 0.1)).toBe(0.7);
  });

  it("holds a step that overshoots the maximum to the maximum", () => {
    expect(sliderValueAt(1, 0, 10, 3)).toBe(9);
    expect(sliderValueAt(0.99, 0, 10, 4)).toBe(8);
  });

  it("stops anywhere with a step of 0", () => {
    expect(sliderValueAt(0.25, 0, 10, 0)).toBe(2.5);
  });

  it("writes the minimum when the range has no width", () => {
    expect(sliderValueAt(0.5, 5, 5, 1)).toBe(5);
    expect(sliderValueAt(0.5, 5, 2, 1)).toBe(5);
  });
});

describe("sliderFraction", () => {
  it("puts the knob along the track by the value, and pins a value outside the range to the nearer end", () => {
    expect(sliderFraction(5, 0, 10)).toBe(0.5);
    expect(sliderFraction(50, 0, 10)).toBe(1);
    expect(sliderFraction(-3, 0, 10)).toBe(0);
    expect(sliderFraction(5, 10, 10)).toBe(0);
  });
});
