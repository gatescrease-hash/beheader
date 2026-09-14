import { describe, expect, it } from "vitest";
import { createMathObject, MATH_BOX_PADDING, MATH_FONT_SIZE, type GraphObject } from "../engine/index.ts";
import { createMathMeasurer, mathMarkup, mathOverlayPlacement, mathWorldBox, readMathLatex, type MathMeasurementHost } from "./math.ts";

/** An element that reports whatever size the test tells it to. */
function fakeHost(size: { width: number; height: number }): MathMeasurementHost & { markup: string; calls: number } {
  return {
    innerHTML: "",
    style: { fontSize: "" },
    markup: "",
    calls: 0,
    getBoundingClientRect() {
      this.calls += 1;
      this.markup = this.innerHTML;
      return size;
    },
  };
}

function measuredMath(width: number, height: number, latex = "y=1"): GraphObject {
  const object = createMathObject("obj_1", "math_1", 10, 20);
  return {
    ...object,
    slots: {
      ...object.slots,
      source: { kind: "literal", value: latex },
      measuredWidth: { kind: "derived", value: width },
      measuredHeight: { kind: "derived", value: height },
    },
  };
}

describe("mathMarkup", () => {
  it("turns notation into markup", () => {
    const markup = mathMarkup("x^2");
    expect(markup.length).toBeGreaterThan(0);
    expect(markup).toContain("<span");
  });

  it("gives an empty string for a source with nothing in it", () => {
    expect(mathMarkup("")).toBe("");
    expect(mathMarkup("   ")).toBe("");
  });
});

describe("createMathMeasurer", () => {
  it("reports the size the element lays the notation out at", () => {
    const measure = createMathMeasurer(fakeHost({ width: 120, height: 40 }));
    expect(measure("x^2", { fontSize: 18 })).toEqual({ width: 120, height: 40 });
  });

  it("puts the size it is asked for onto the element", () => {
    const host = fakeHost({ width: 1, height: 1 });
    const measure = createMathMeasurer(host);
    measure("x", { fontSize: 24 });
    expect(host.style.fontSize).toBe("24px");
  });

  it("measures the same notation once, because a pass runs on every keystroke", () => {
    const host = fakeHost({ width: 10, height: 10 });
    const measure = createMathMeasurer(host);
    measure("x", { fontSize: 18 });
    measure("x", { fontSize: 18 });
    expect(host.calls).toBe(1);
  });

  it("measures again for the same notation at a different size", () => {
    const host = fakeHost({ width: 10, height: 10 });
    const measure = createMathMeasurer(host);
    measure("x", { fontSize: 18 });
    measure("x", { fontSize: 24 });
    expect(host.calls).toBe(2);
  });

  it("measures again after it is told to forget, which is what a font arriving needs", () => {
    const host = fakeHost({ width: 10, height: 10 });
    const measure = createMathMeasurer(host);
    measure("x", { fontSize: 18 });
    measure.forget();
    measure("x", { fontSize: 18 });
    expect(host.calls).toBe(2);
  });
});

describe("mathWorldBox", () => {
  it("takes the box from the origin and the two measured slots", () => {
    expect(mathWorldBox(measuredMath(100, 40))).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 60 });
  });

  it("gives nothing while a measurement has not landed", () => {
    expect(mathWorldBox(createMathObject("obj_1", "math_1", 0, 0))).toBeUndefined();
  });

  it("gives nothing for a measurement that failed", () => {
    const object = measuredMath(100, 40);
    const broken: GraphObject = {
      ...object,
      slots: { ...object.slots, measuredWidth: { kind: "derived", value: { error: "#MEASURE", message: "no measurer" } } },
    };
    expect(mathWorldBox(broken)).toBeUndefined();
  });
});

describe("mathOverlayPlacement", () => {
  const camera = { x: 0, y: 0, zoom: 1 };

  it("puts the element at the top left of the object, in css pixels", () => {
    const placement = mathOverlayPlacement(measuredMath(100, 40), camera, 1);
    expect(placement).toMatchObject({ left: 10, top: 20, width: 100, height: 40, scale: 1 });
  });

  it("carries the zoom as a scale rather than folding it into the size", () => {
    const placement = mathOverlayPlacement(measuredMath(100, 40), { x: 0, y: 0, zoom: 2 }, 1);
    // The width stays in world units, because one transform applies the zoom.
    expect(placement).toMatchObject({ width: 100, height: 40, scale: 2 });
  });

  it("divides the screen position by the backing ratio, and the size not at all", () => {
    const placement = mathOverlayPlacement(measuredMath(100, 40), { x: 0, y: 0, zoom: 2 }, 2);
    expect(placement?.left).toBe(10);
    expect(placement?.width).toBe(100);
    expect(placement?.scale).toBe(1);
  });

  it("carries the font size and the padding the engine measured with", () => {
    const placement = mathOverlayPlacement(measuredMath(100, 40), camera, 1);
    expect(placement).toMatchObject({ fontSize: MATH_FONT_SIZE, padding: MATH_BOX_PADDING });
  });

  it("gives nothing for an object with no measurement yet", () => {
    expect(mathOverlayPlacement(createMathObject("obj_1", "math_1", 0, 0), camera, 1)).toBeUndefined();
  });

  it("treats a ratio that makes no sense as one", () => {
    expect(mathOverlayPlacement(measuredMath(100, 40), camera, 0)?.left).toBe(10);
  });
});

describe("readMathLatex", () => {
  it("gives the source an object holds", () => {
    expect(readMathLatex(measuredMath(1, 1, "a=1"))).toBe("a=1");
  });

  it("gives an empty string where the slot holds something else", () => {
    const object = measuredMath(1, 1);
    expect(readMathLatex({ ...object, slots: { ...object.slots, source: { kind: "literal", value: 7 } } })).toBe("");
  });
});
