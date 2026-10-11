/**
 * marquee.test.ts
 *
 * These tests cover the two rules of a selection box, a window and a crossing,
 * against shapes whose boxes overlap the selection box while their strokes stay
 * clear of it, and the way a group answers as one unit.
 */
import { describe, expect, it } from "vitest";
import type { GraphObject, Slot } from "../engine/index.ts";
import { canvasUnits, marqueeBox, marqueeMode, marqueeUnits } from "./marquee.ts";

const FILL: Record<string, Slot> = { "style.fillColor": { kind: "literal", value: "#00ff00" } };

function square(id: string, x: number, y: number, size: number, extra: Record<string, Slot> = {}): GraphObject {
  return {
    id,
    name: id,
    type: "rect",
    slots: {
      vertices: { kind: "derived", value: [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }] },
      ...extra,
    },
  };
}

function circle(id: string, x: number, y: number, radius: number, extra: Record<string, Slot> = {}): GraphObject {
  return {
    id,
    name: id,
    type: "circle",
    slots: { "origin.x": { kind: "literal", value: x }, "origin.y": { kind: "literal", value: y }, radius: { kind: "literal", value: radius }, ...extra },
  };
}

function path(id: string, points: readonly { x: number; y: number }[], bulges: readonly number[] = [], extra: Record<string, Slot> = {}): GraphObject {
  const slots: Record<string, Slot> = { vertices: { kind: "derived", value: points }, closed: { kind: "literal", value: false }, ...extra };
  bulges.forEach((bulge, index) => {
    slots[`vertex.${index}.bulge`] = { kind: "literal", value: bulge };
  });
  return { id, name: id, type: "polyline", vertexCount: points.length, slots };
}

function text(id: string, x: number, y: number): GraphObject {
  return {
    id,
    name: id,
    type: "text",
    slots: {
      "origin.x": { kind: "literal", value: x },
      "origin.y": { kind: "literal", value: y },
      width: { kind: "literal", value: 100 },
      height: { kind: "literal", value: 40 },
      autoresize: { kind: "literal", value: false },
      content: { kind: "literal", value: "hello" },
      resolvedContent: { kind: "derived", value: "hello" },
    },
  };
}

function group(id: string, x: number, y: number): GraphObject {
  return { id, name: id, type: "group", slots: { "origin.x": { kind: "literal", value: x }, "origin.y": { kind: "literal", value: y } } };
}

const inGroup = (object: GraphObject, groupId: string): GraphObject => ({ ...object, slots: { ...object.slots, "view.group": { kind: "literal", value: groupId } } });

const window = (objects: readonly GraphObject[], minX: number, minY: number, maxX: number, maxY: number) =>
  marqueeUnits(objects, { minX, minY, maxX, maxY }, "window");
const crossing = (objects: readonly GraphObject[], minX: number, minY: number, maxX: number, maxY: number) =>
  marqueeUnits(objects, { minX, minY, maxX, maxY }, "crossing");

describe("marqueeMode and marqueeBox", () => {
  it("reads a box drawn to the right as a window and one drawn to the left as a crossing", () => {
    expect(marqueeMode({ x: 0, y: 0 }, { x: 10, y: -5 })).toBe("window");
    expect(marqueeMode({ x: 0, y: 0 }, { x: -10, y: 5 })).toBe("crossing");
  });

  it("counts a box drawn straight up or down as a window, because it has no direction across", () => {
    expect(marqueeMode({ x: 4, y: 0 }, { x: 4, y: 50 })).toBe("window");
  });

  it("gives the same box whichever corner the drag started from", () => {
    expect(marqueeBox({ x: 10, y: 20 }, { x: -5, y: 2 })).toEqual({ minX: -5, minY: 2, maxX: 10, maxY: 20 });
  });
});

describe("a window takes what lies wholly inside it", () => {
  it("takes a shape inside the box and leaves one the box only crosses", () => {
    const objects = [square("a", 0, 0, 20), square("b", 100, 0, 20)];
    expect(window(objects, -1, -1, 21, 21)).toEqual(["a"]);
    expect(window(objects, -1, -1, 110, 21)).toEqual(["a"]);
  });

  it("leaves a text box that sticks out past the selection box", () => {
    expect(window([text("t", 0, 0)], -1, -1, 50, 50)).toEqual([]);
    expect(window([text("t", 0, 0)], -1, -1, 101, 41)).toEqual(["t"]);
  });
});

describe("a crossing takes what it touches, by the rule of the hit test", () => {
  it("takes a hollow circle where the box crosses its ring, and leaves it when the box sits inside the ring", () => {
    const ring = circle("c", 0, 0, 50);
    expect(crossing([ring], 45, -5, 60, 5)).toEqual(["c"]);
    expect(crossing([ring], -10, -10, 10, 10)).toEqual([]);
  });

  it("takes a filled circle from anywhere over its disc", () => {
    expect(crossing([circle("c", 0, 0, 50, FILL)], -10, -10, 10, 10)).toEqual(["c"]);
  });

  it("leaves a circle whose box the selection box reaches at a corner where the circle is not", () => {
    expect(crossing([circle("c", 0, 0, 50, FILL)], 40, 40, 60, 60)).toEqual([]);
  });

  it("leaves a diagonal line whose box overlaps the selection box but which passes beside it", () => {
    const diagonal = path("p", [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    expect(crossing([diagonal], 60, 0, 80, 20)).toEqual([]);
    expect(crossing([diagonal], 40, 45, 60, 55)).toEqual(["p"]);
  });

  it("tests an arc against its true curve, not its chord", () => {
    // A half circle from (0, 0) to (100, 0) about (50, 0), bulging up the screen through (50, -50).
    const arc = path("p", [{ x: 0, y: 0 }, { x: 100, y: 0 }], [1]);
    expect(crossing([arc], 45, -5, 55, 5)).toEqual([]);
    expect(crossing([arc], 45, -55, 55, -45)).toEqual(["p"]);
    expect(crossing([arc], 45, 45, 55, 55)).toEqual([]);
  });

  it("takes a filled closed shape that holds the whole box, and leaves a hollow one", () => {
    expect(crossing([square("s", 0, 0, 100, FILL)], 40, 40, 60, 60)).toEqual(["s"]);
    expect(crossing([square("s", 0, 0, 100)], 40, 40, 60, 60)).toEqual([]);
  });

  it("takes a text box it overlaps at all, because the hit test treats text as a box", () => {
    expect(crossing([text("t", 0, 0)], 90, 30, 200, 200)).toEqual(["t"]);
  });
});

describe("a box takes units", () => {
  const members = () => [group("g", 0, 0), inGroup(square("a", 0, 0, 20), "g"), inGroup(square("b", 100, 0, 20), "g"), square("c", 300, 0, 20)];

  it("takes a group with a window around every member, and leaves out the padding of its outline", () => {
    expect(window(members(), -1, -1, 121, 21)).toEqual(["g"]);
    expect(window(members(), -1, -1, 50, 21)).toEqual([]);
  });

  it("takes a group with a window around its members when one member, an empty text, draws nothing", () => {
    const empty: GraphObject = { id: "e", name: "e", type: "text", slots: { "origin.x": { kind: "literal", value: 500 }, "origin.y": { kind: "literal", value: 500 } } };
    expect(window([group("g", 0, 0), inGroup(square("a", 0, 0, 20), "g"), inGroup(empty, "g")], -1, -1, 21, 21)).toEqual(["g"]);
  });

  it("takes a group with a crossing that touches one member, and never a member alone", () => {
    expect(crossing(members(), 110, -5, 130, 5)).toEqual(["g"]);
  });

  it("takes a group with a crossing over its outline, and leaves it for a crossing in the space inside", () => {
    // The outline runs from x = -16, padding to the left of member a.
    expect(crossing(members(), -20, 5, -10, 10)).toEqual(["g"]);
    expect(crossing(members(), 50, 5, 60, 10)).toEqual([]);
  });

  it("leaves hidden objects, the variable holder and the layers out", () => {
    const hidden = square("h", 0, 0, 20, { "view.visible": { kind: "literal", value: false } });
    const objects = [hidden, { id: "d", name: "doc", type: "doc", slots: {} } as GraphObject, { id: "l", name: "layer_1", type: "layer", slots: {} } as GraphObject];
    expect(window(objects, -1000, -1000, 1000, 1000)).toEqual([]);
    expect(canvasUnits(objects)).toEqual([]);
  });

  it("lists every unit on the canvas once, a group standing for its members", () => {
    expect(canvasUnits(members()).map((unit) => unit.id)).toEqual(["g", "c"]);
  });
});
