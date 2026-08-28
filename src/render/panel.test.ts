/**
 * panel.test.ts — Tests for `render/panel.ts`'s `placePropertiesPanel`
 * (D-094 clauses 11-12). Pure arithmetic; no DOM.
 */
import { describe, expect, it } from "vitest";
import type { CameraState } from "../engine/document.ts";
import type { WorldExtent } from "./extent.ts";
import { PANEL_OBJECT_GAP_CSS, placePropertiesPanel } from "./panel.ts";

const IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };
const VIEWPORT = { width: 800, height: 600 };
const PANEL = { width: 120, height: 80 };

function extent(minX: number, minY: number, maxX: number, maxY: number): WorldExtent {
  return { minX, minY, maxX, maxY };
}

describe("placePropertiesPanel — anchoring (D-094 clause 11)", () => {
  it("puts the panel's right edge one gap to the LEFT of the extent, top edges aligned, when there is room", () => {
    // left = 300 - GAP(8) - width(120) = 172; top = extent top = 50.
    expect(placePropertiesPanel(extent(300, 50, 400, 150), IDENTITY, 1, VIEWPORT, PANEL)).toEqual({ left: 172, top: 50 });
  });

  it("flips to the RIGHT of the extent when the left placement would run off the canvas's left edge", () => {
    // left would be 40 - 8 - 120 = -88 < 0, so flip: extent right (140) + gap (8) = 148.
    expect(placePropertiesPanel(extent(40, 50, 140, 150), IDENTITY, 1, VIEWPORT, PANEL)).toEqual({ left: 148, top: 50 });
  });

  it("keeps the gap constant regardless of which side the panel lands on", () => {
    const left = placePropertiesPanel(extent(400, 0, 500, 100), IDENTITY, 1, VIEWPORT, PANEL);
    const flipped = placePropertiesPanel(extent(10, 0, 110, 100), IDENTITY, 1, VIEWPORT, PANEL);
    expect(400 - (left.left + PANEL.width)).toBe(PANEL_OBJECT_GAP_CSS);
    expect(flipped.left - 110).toBe(PANEL_OBJECT_GAP_CSS);
  });
});

describe("placePropertiesPanel — clamping to the canvas (D-094 clause 11)", () => {
  it("clamps the panel to the top edge when the extent is above the canvas", () => {
    expect(placePropertiesPanel(extent(300, -100, 400, -20), IDENTITY, 1, VIEWPORT, PANEL)).toEqual({ left: 172, top: 0 });
  });

  it("clamps the panel to the bottom edge so it stays fully on the canvas", () => {
    // top would be 580; max is viewport.height (600) - panel.height (80) = 520.
    expect(placePropertiesPanel(extent(300, 580, 400, 660), IDENTITY, 1, VIEWPORT, PANEL)).toEqual({ left: 172, top: 520 });
  });

  it("clamps a right-flipped panel that would overflow the right edge", () => {
    // left placement -x -> flip -> extent right (790) + 8 = 798; max is 800 - 120 = 680.
    expect(placePropertiesPanel(extent(20, 50, 790, 150), IDENTITY, 1, VIEWPORT, PANEL)).toEqual({ left: 680, top: 50 });
  });
});

describe("placePropertiesPanel — CSS vs backing pixels (D-094 clause 12)", () => {
  it("divides worldToScreen's backing pixels down by the ratio the canvas actually has", () => {
    // ratio 2: backing (600, 100) -> CSS (300, 50); then left = 300 - 8 - 120 = 172.
    expect(placePropertiesPanel(extent(600, 100, 800, 300), IDENTITY, 2, VIEWPORT, PANEL)).toEqual({ left: 172, top: 50 });
  });

  it("falls back to a ratio of 1 for a non-finite or non-positive ratio", () => {
    const expected = { left: 172, top: 50 };
    expect(placePropertiesPanel(extent(300, 50, 400, 150), IDENTITY, 0, VIEWPORT, PANEL)).toEqual(expected);
    expect(placePropertiesPanel(extent(300, 50, 400, 150), IDENTITY, Number.NaN, VIEWPORT, PANEL)).toEqual(expected);
    expect(placePropertiesPanel(extent(300, 50, 400, 150), IDENTITY, -2, VIEWPORT, PANEL)).toEqual(expected);
  });
});

describe("placePropertiesPanel — the anchor is a world point (D-094 clause 13)", () => {
  it("follows the camera's pan and zoom", () => {
    // camera {x:50,y:20,zoom:2}: extent min (100,60) -> screen ((100-50)*2, (60-20)*2) = (100, 80).
    // left = 100 - 8 - 120 = -28 < 0 -> flip: extent max x 200 -> (200-50)*2 = 300; + 8 = 308.
    const camera: CameraState = { x: 50, y: 20, zoom: 2 };
    expect(placePropertiesPanel(extent(100, 60, 200, 160), camera, 1, VIEWPORT, PANEL)).toEqual({ left: 308, top: 80 });
  });
});
