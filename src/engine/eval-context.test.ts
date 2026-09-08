/**
 * eval-context.test.ts
 *
 * The measurer interface and the null context. A frozen context must
 * refuse a write at runtime, not only at compile time.
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

  it("ignores the maxWidth argument — it never wraps, so it never needs one", () => {
    expect(NULL_EVAL_CONTEXT.measurer.measure("anything", STYLE, 120)).toEqual({ width: 0, height: 0 });
  });

  it("is frozen — measurer included — so a shared default cannot be corrupted for later passes", () => {
    expect(Object.isFrozen(NULL_EVAL_CONTEXT)).toBe(true);
    expect(Object.isFrozen(NULL_EVAL_CONTEXT.measurer)).toBe(true);
    expect(() => {
      // @ts-expect-error. A write to a readonly frozen object is the mistake this test guards.
      NULL_EVAL_CONTEXT.measurer = { measure: () => ({ width: 99, height: 99 }) };
    }).toThrow();
    expect(() => {
      // Legal to the type checker, so no @ts-expect-error. It must fail at runtime.
      NULL_EVAL_CONTEXT.measurer.measure = () => ({ width: 99, height: 99 });
    }).toThrow();
    expect(NULL_EVAL_CONTEXT.measurer.measure("x", STYLE)).toEqual({ width: 0, height: 0 });
  });
});

describe("DerivedSlotCompute — a compute function receives the injected EvalContext", () => {
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

describe("hasRealMeasurer — it detects the null measurer", () => {
  it("is false for NULL_EVAL_CONTEXT and for undefined; true for an injected measurer", () => {
    expect(hasRealMeasurer(NULL_EVAL_CONTEXT)).toBe(false);
    expect(hasRealMeasurer(undefined)).toBe(false);
    expect(hasRealMeasurer({ measurer: { measure: () => ({ width: 1, height: 1 }) } })).toBe(true);
  });

  it("catches a context that was hand-built to REUSE the null measurer, not just NULL_EVAL_CONTEXT by identity", () => {
    expect(hasRealMeasurer({ measurer: NULL_EVAL_CONTEXT.measurer })).toBe(false);
  });
});
