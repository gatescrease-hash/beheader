import { expect, it } from "vitest";
import { gridGeometry, gridWorldStep } from "./grid.ts";

it("keeps grid spacing readable across the camera zoom range", () => {
  for (const zoom of [.01, .03, .1, .5, 1, 2, 10, 100]) {
    const grid = gridGeometry({ x: 123, y: -50, zoom }, 2);
    expect(grid.spacing).toBeGreaterThanOrEqual(8);
    expect(grid.spacing).toBeLessThanOrEqual(80);
    expect(grid.x).toBe(-123 * zoom / 2);
    expect(grid.y).toBe(50 * zoom / 2);
  }
});

it("gives the world step of the grid the canvas shows, which an arrow key moves a tenth of", () => {
  expect(gridWorldStep({ x: 0, y: 0, zoom: 1 })).toBe(10);
  expect(gridWorldStep({ x: 0, y: 0, zoom: 10 })).toBe(1);
  expect(gridWorldStep({ x: 0, y: 0, zoom: 0.1 })).toBe(100);
  // On a screen of twice the density the camera's zoom counts device pixels, so a zoom of 2 shows the grid a zoom of 1 shows elsewhere.
  expect(gridWorldStep({ x: 0, y: 0, zoom: 2 }, 2)).toBe(10);
  const grid = gridGeometry({ x: 0, y: 0, zoom: 3 }, 1);
  expect(grid.spacing).toBeCloseTo(gridWorldStep({ x: 0, y: 0, zoom: 3 }) * 3, 9);
});
