import { expect, it } from "vitest";
import { gridGeometry } from "./grid.ts";

it("keeps grid spacing readable across the camera zoom range", () => {
  for (const zoom of [.01, .03, .1, .5, 1, 2, 10, 100]) {
    const grid = gridGeometry({ x: 123, y: -50, zoom }, 2);
    expect(grid.spacing).toBeGreaterThanOrEqual(8);
    expect(grid.spacing).toBeLessThanOrEqual(80);
    expect(grid.x).toBe(-123 * zoom / 2);
    expect(grid.y).toBe(50 * zoom / 2);
  }
});
