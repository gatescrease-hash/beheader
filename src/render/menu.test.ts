/**
 * menu.test.ts
 *
 * These tests cover the menu a right press opens, and the command line each
 * entry stands for. Every entry is a line the operator can also type.
 */
import { describe, expect, it } from "vitest";
import { type CameraState, type GraphObject, HALF_CIRCLE_BULGE, type Slot } from "../engine/index.ts";
import { menuCommandLine, pathMenuAt } from "./menu.ts";

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };

interface TestPoint {
  readonly x: number;
  readonly y: number;
}

const TRIANGLE: readonly TestPoint[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

function pathObject(points: readonly TestPoint[] = TRIANGLE, closed = false, overrides: Record<string, Slot> = {}): GraphObject {
  const slots: Record<string, Slot> = {
    closed: { kind: "literal", value: closed },
    vertices: { kind: "derived", value: points.map((point) => ({ ...point })) },
  };
  points.forEach((point, index) => {
    slots[`vertex.${index}.x`] = { kind: "literal", value: point.x };
    slots[`vertex.${index}.y`] = { kind: "literal", value: point.y };
    slots[`vertex.${index}.bulge`] = { kind: "literal", value: 0 };
  });
  return { id: "obj_1", name: "polyline_1", type: "polyline", vertexCount: points.length, slots: { ...slots, ...overrides } };
}

function labelsAt(x: number, y: number, objects: readonly GraphObject[] = [pathObject()]): readonly string[] {
  return pathMenuAt({ x, y }, objects, CAMERA_IDENTITY)?.items.map((item) => item.label) ?? [];
}

describe("what a right press finds", () => {
  it("finds nothing on empty canvas", () => {
    expect(pathMenuAt({ x: 400, y: 400 }, [pathObject()], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("finds nothing over an object that is not a path", () => {
    const circle: GraphObject = {
      id: "obj_2",
      name: "circle_1",
      type: "circle",
      slots: { "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 }, radius: { kind: "literal", value: 50 } },
    };
    expect(pathMenuAt({ x: 50, y: 0 }, [circle], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("offers a vertex its own removal, and nothing else", () => {
    expect(labelsAt(100, 0)).toEqual(["delete this vertex"]);
  });

  it("names the part it found, so the menu says what the press picked", () => {
    expect(pathMenuAt({ x: 100, y: 0 }, [pathObject()], CAMERA_IDENTITY)?.title).toBe("vertex 1");
    expect(pathMenuAt({ x: 20, y: 0 }, [pathObject()], CAMERA_IDENTITY)?.title).toBe("edge 0");
  });

  it("offers an edge its three shapes and one new vertex", () => {
    expect(labelsAt(20, 0)).toEqual(["straight", "arc", "curve", "add a vertex here"]);
  });

  it("gives the vertex to a press that both a vertex and an edge answer", () => {
    // The middle grip of a one unit edge sits half a unit from both vertices.
    const tiny = pathObject([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(pathMenuAt({ x: 0, y: 0 }, [tiny], CAMERA_IDENTITY)?.title).toBe("vertex 0");
  });

  it("marks the shape the edge already has, and offers it anyway", () => {
    const straight = pathMenuAt({ x: 20, y: 0 }, [pathObject()], CAMERA_IDENTITY);
    expect(straight?.items.filter((item) => item.current).map((item) => item.label)).toEqual(["straight"]);
  });

  it("marks the arc on an edge a bulge bends", () => {
    const bowed = pathObject(TRIANGLE, false, { "vertex.0.bulge": { kind: "literal", value: HALF_CIRCLE_BULGE } });
    const menu = pathMenuAt({ x: 50, y: -50 }, [bowed], CAMERA_IDENTITY);
    expect(menu?.items.filter((item) => item.current).map((item) => item.label)).toEqual(["arc"]);
  });

  it("reaches the edge that closes a path", () => {
    expect(pathMenuAt({ x: 50, y: 50 }, [pathObject(TRIANGLE, true)], CAMERA_IDENTITY)?.title).toBe("edge 2");
  });

  it("gives the topmost path when two overlap, the order the hit test walks", () => {
    const under = pathObject();
    const over = { ...pathObject(), id: "obj_9", name: "polyline_9" };
    expect(pathMenuAt({ x: 20, y: 0 }, [under, over], CAMERA_IDENTITY)?.objectName).toBe("polyline_9");
  });
});

describe("the command line each entry stands for", () => {
  function lineFor(x: number, y: number, label: string, objects: readonly GraphObject[] = [pathObject()]): string {
    const menu = pathMenuAt({ x, y }, objects, CAMERA_IDENTITY);
    const item = menu?.items.find((candidate) => candidate.label === label);
    if (menu === undefined || item === undefined) {
      throw new Error(`expected an entry named "${label}"`);
    }
    return menuCommandLine(menu.objectName, item.action);
  }

  it("writes the delvertex line for a vertex", () => {
    expect(lineFor(100, 0, "delete this vertex")).toBe("delvertex polyline_1 1");
  });

  it("writes an edgetype line for each shape", () => {
    expect(lineFor(20, 0, "straight")).toBe("edgetype polyline_1 0 line");
    expect(lineFor(20, 0, "arc")).toBe("edgetype polyline_1 0 arc");
    expect(lineFor(20, 0, "curve")).toBe("edgetype polyline_1 0 curve");
  });

  it("writes a split line at the point the press landed on", () => {
    expect(lineFor(20, 0, "add a vertex here")).toBe("split polyline_1 0 20,0");
  });

  it("rounds a point to four decimals, so a long line does not carry float noise", () => {
    const line = menuCommandLine("polyline_1", { kind: "split", index: 0, point: { x: 1 / 3, y: -2 / 3 } });
    expect(line).toBe("split polyline_1 0 0.3333,-0.6667");
  });

  it("names the object the press found, so two paths never get one another's line", () => {
    const over = { ...pathObject(), id: "obj_9", name: "road_a" };
    expect(lineFor(20, 0, "arc", [over])).toBe("edgetype road_a 0 arc");
  });
});
