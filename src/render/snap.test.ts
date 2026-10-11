/**
 * snap.test.ts
 *
 * These tests cover where a drag lands near the lines of other boxes and near
 * the grid, the guides it draws there, and the way a snap measured from the
 * press lets go once the pointer moves out of reach.
 */
import { describe, expect, it } from "vitest";
import type { WorldExtent } from "./extent.ts";
import { snapTargets, snapTravel } from "./snap.ts";

const box = (minX: number, minY: number, maxX: number, maxY: number): WorldExtent => ({ minX, minY, maxX, maxY });

describe("snapTravel", () => {
  // A 20 by 20 box at the origin, dragged near a neighbour that spans x 100..140 and y 200..260.
  const targets = snapTargets(box(0, 0, 20, 20), [box(100, 200, 140, 260)], true, true);

  it("leaves the travel alone when no line is in reach", () => {
    expect(snapTravel(targets, { x: 50, y: 50 }, 3)).toEqual({ travel: { x: 50, y: 50 }, guides: [] });
  });

  it("moves the rest of the way onto the nearest line, from an edge or the centre, and guides across both boxes", () => {
    // The left edge at 98 is 2 short of the neighbour's left edge at 100. Once
    // it lands there, the right edge at 120 also sits on the neighbour's centre.
    const left = snapTravel(targets, { x: 98, y: 50 }, 3);
    expect(left.travel).toEqual({ x: 100, y: 50 });
    expect(left.guides).toEqual([{ axis: "x", at: 100, from: 50, to: 260 }, { axis: "x", at: 120, from: 50, to: 260 }]);
    // The centre at 121 is 1 past the neighbour's centre at 120.
    expect(snapTravel(targets, { x: 111, y: 50 }, 3).travel.x).toBe(110);
    // The bottom edge at 199 is 1 short of the neighbour's top edge at 200.
    const stacked = snapTravel(targets, { x: 300, y: 179 }, 3);
    expect(stacked.travel).toEqual({ x: 300, y: 180 });
    expect(stacked.guides).toEqual([{ axis: "y", at: 200, from: 100, to: 320 }]);
  });

  it("takes the nearest of several lines in reach", () => {
    const crowded = snapTargets(box(0, 0, 10, 10), [box(102, 0, 150, 10), box(99, 50, 150, 60)], true, true);
    expect(snapTravel(crowded, { x: 100, y: 500 }, 3).travel.x).toBe(99);
  });

  it("measures from the press, so a pointer that moves out of reach leaves the line", () => {
    expect(snapTravel(targets, { x: 99, y: 50 }, 3).travel.x).toBe(100);
    expect(snapTravel(targets, { x: 95, y: 50 }, 3).travel.x).toBe(95);
  });

  it("snaps the top left corner to the grid when no object line is in reach, and draws no guide for it", () => {
    const result = snapTravel(targets, { x: 52, y: 38 }, 3, 10);
    expect(result.travel).toEqual({ x: 50, y: 40 });
    expect(result.guides).toEqual([]);
    expect(snapTravel(targets, { x: 55, y: 35 }, 3, 10).travel).toEqual({ x: 55, y: 35 });
  });

  it("prefers a line of another object to the grid", () => {
    expect(snapTravel(targets, { x: 99, y: 50 }, 3, 10).travel.x).toBe(100);
  });

  it("leaves an axis a formula holds as the pointer took it, with no guide", () => {
    const heldX = snapTargets(box(0, 0, 20, 20), [box(100, 200, 140, 260)], false, true);
    const result = snapTravel(heldX, { x: 98, y: 179 }, 3, 10);
    expect(result.travel).toEqual({ x: 98, y: 180 });
    expect(result.guides.map((guide) => guide.axis)).toEqual(["y"]);
  });

  it("guides every line the moved box sits on, such as an edge and a centre at once", () => {
    const twin = snapTargets(box(0, 0, 40, 20), [box(100, 200, 140, 260)], true, true);
    expect(snapTravel(twin, { x: 101, y: 50 }, 3).guides.map((guide) => guide.at)).toEqual([100, 120, 140]);
  });
});
