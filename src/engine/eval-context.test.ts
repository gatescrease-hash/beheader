/**
 * eval-context.test.ts — Tests for §5.1's injected evaluation-context services.
 *
 * Colocated with eval-context.ts per D-001. These pin the null-object's
 * behaviour and the shape of the `TextMeasurer` / `DerivedSlotCompute` contract
 * a compute function relies on. The end-to-end path (a real `measuredHeight`
 * compute measuring through `evaluate`) lands with the cycle that builds
 * `measuredHeight` itself — see `eval-context.ts`'s NOT DONE HERE.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "./address.ts";
import { hasRealMeasurer, NULL_EVAL_CONTEXT, type EvalContext, type TextMeasurer, type TextStyle } from "./eval-context.ts";
import type { DerivedSlotCompute } from "./primitives/schema.ts";
import type { GraphObject, Value } from "./graph/node.ts";

const STYLE: TextStyle = { font: "sans", fontSize: 10, lineHeight: 12 };

describe("NULL_EVAL_CONTEXT — the documented default for callers with no text", () => {
  it("measures every box as zero-sized, and never throws", () => {
    expect(() => NULL_EVAL_CONTEXT.measurer.measure("anything at all", STYLE)).not.toThrow();
    expect(NULL_EVAL_CONTEXT.measurer.measure("anything at all", STYLE)).toEqual({ width: 0, height: 0 });
    expect(NULL_EVAL_CONTEXT.measurer.measure("", STYLE)).toEqual({ width: 0, height: 0 });
  });

  it("ignores the PROVISIONAL(Q-021) maxWidth argument — it never wraps, so it never needs one", () => {
    expect(NULL_EVAL_CONTEXT.measurer.measure("anything", STYLE, 120)).toEqual({ width: 0, height: 0 });
  });

  it("is frozen — measurer included — so a shared default cannot be corrupted for later passes", () => {
    expect(Object.isFrozen(NULL_EVAL_CONTEXT)).toBe(true);
    expect(Object.isFrozen(NULL_EVAL_CONTEXT.measurer)).toBe(true);
    expect(() => {
      // @ts-expect-error — writing to a readonly, frozen object is the mistake this guards against.
      NULL_EVAL_CONTEXT.measurer = { measure: () => ({ width: 99, height: 99 }) };
    }).toThrow();
    expect(() => {
      // The nested measurer is the other write path a shallow freeze would miss —
      // type-legal, so no @ts-expect-error; it must fail at runtime instead.
      NULL_EVAL_CONTEXT.measurer.measure = () => ({ width: 99, height: 99 });
    }).toThrow();
    expect(NULL_EVAL_CONTEXT.measurer.measure("x", STYLE)).toEqual({ width: 0, height: 0 });
  });
});

describe("DerivedSlotCompute — a compute function receives the injected EvalContext", () => {
  /** A fixed-width fake: every glyph is `perChar` wide, one line tall at `lineHeight`. The shape tests inject. */
  function fixedWidthMeasurer(perChar: number): TextMeasurer {
    return {
      measure: (text: string, style: TextStyle) => ({
        width: text.length * perChar,
        height: style.lineHeight,
      }),
    };
  }

  const OBJECT: GraphObject = { id: "obj_1", name: "text_1", type: "text", slots: {} };
  const noRead = (_address: Address): Value | undefined => undefined;

  it("can measure text through context.measurer rather than reaching for a canvas (Rule 1)", () => {
    // Stand-in for a future `measuredHeight` compute: it reads nothing, it just
    // measures a fixed string and returns the height.
    const measuredHeightLike: DerivedSlotCompute = (_object, _read, context = NULL_EVAL_CONTEXT) => {
      return context.measurer.measure("hello", STYLE).height;
    };

    const injected: EvalContext = { measurer: fixedWidthMeasurer(3) };
    expect(measuredHeightLike(OBJECT, noRead, injected)).toBe(STYLE.lineHeight);
  });

  it("falls back to a zero measurement when called in isolation with no context (the test-only path)", () => {
    const widthLike: DerivedSlotCompute = (_object, _read, context = NULL_EVAL_CONTEXT) => {
      return context.measurer.measure("hello", STYLE).width;
    };
    expect(widthLike(OBJECT, noRead)).toBe(0);
  });
});

describe("hasRealMeasurer — D-118's null-measurer detector", () => {
  it("is false for NULL_EVAL_CONTEXT and for undefined; true for an injected measurer", () => {
    expect(hasRealMeasurer(NULL_EVAL_CONTEXT)).toBe(false);
    expect(hasRealMeasurer(undefined)).toBe(false);
    expect(hasRealMeasurer({ measurer: { measure: () => ({ width: 1, height: 1 }) } })).toBe(true);
  });

  it("catches a context that was hand-built to REUSE the null measurer, not just NULL_EVAL_CONTEXT by identity", () => {
    // It checks the measurer, not the context object — so wrapping the null
    // measurer in a fresh EvalContext does not sneak past D-118.
    expect(hasRealMeasurer({ measurer: NULL_EVAL_CONTEXT.measurer })).toBe(false);
  });
});
