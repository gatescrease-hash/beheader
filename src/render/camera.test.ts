/**
 * camera.test.ts — Tests for world<->screen transform, pan, and zoom-to-cursor
 * (§5.9). Colocated with camera.ts per D-001.
 */
import { describe, expect, it } from "vitest";
import type { CameraState } from "../engine/document.ts";
import { MAX_ZOOM, MIN_ZOOM, panByScreenDelta, screenToWorld, worldToScreen, zoomAtScreenPoint } from "./camera.ts";

const IDENTITY_CAMERA: CameraState = { x: 0, y: 0, zoom: 1 };

describe("worldToScreen", () => {
  it("is the identity at the default camera (no pan, zoom 1)", () => {
    expect(worldToScreen(IDENTITY_CAMERA, { x: 12, y: -7 })).toEqual({ x: 12, y: -7 });
  });

  it("scales world distances by zoom", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 2 };
    expect(worldToScreen(camera, { x: 10, y: 5 })).toEqual({ x: 20, y: 10 });
  });

  it("treats camera.x/camera.y as the world point at the screen origin (§5.9's own vocabulary)", () => {
    const camera: CameraState = { x: 100, y: 50, zoom: 1 };
    expect(worldToScreen(camera, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(worldToScreen(camera, { x: 110, y: 50 })).toEqual({ x: 10, y: 0 });
  });
});

describe("screenToWorld", () => {
  it("is the exact inverse of worldToScreen, across an arbitrary pan and zoom", () => {
    const camera: CameraState = { x: 37, y: -19, zoom: 3.5 };
    const worldPoint = { x: 4, y: -8 };
    const screenPoint = worldToScreen(camera, worldPoint);
    expect(screenToWorld(camera, screenPoint)).toEqual(worldPoint);
  });
});

describe("panByScreenDelta", () => {
  it("moves everything on screen by exactly the screen-space delta dragged, at zoom 1", () => {
    const camera = IDENTITY_CAMERA;
    const worldPoint = { x: 5, y: 5 };
    const before = worldToScreen(camera, worldPoint);
    const after = panByScreenDelta(camera, 30, -10);
    expect(worldToScreen(after, worldPoint)).toEqual({ x: before.x + 30, y: before.y - 10 });
  });

  it("leaves zoom untouched — panning never changes scale", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 4 };
    expect(panByScreenDelta(camera, 40, 0).zoom).toBe(4);
  });

  it("divides the screen delta by zoom, so the same screen-space drag moves content less in world space at higher zoom", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 4 };
    // 40 screen px at zoom 4 is 10 world units.
    expect(panByScreenDelta(camera, 40, 0).x).toBe(-10);
  });

  it("ignores a non-finite delta component and leaves that component of the camera unchanged (D-027)", () => {
    const camera: CameraState = { x: 5, y: -5, zoom: 1 };
    expect(panByScreenDelta(camera, Number.NaN, Number.POSITIVE_INFINITY)).toEqual(camera);
  });
});

describe("zoomAtScreenPoint", () => {
  it("keeps the world point under the cursor fixed on screen after the zoom changes", () => {
    const camera: CameraState = { x: 10, y: 10, zoom: 1 };
    const cursor: { x: number; y: number } = { x: 200, y: 150 };
    const worldUnderCursorBefore = screenToWorld(camera, cursor);
    const zoomed = zoomAtScreenPoint(camera, cursor, 3);
    expect(zoomed.zoom).toBe(3);
    expect(screenToWorld(zoomed, cursor)).toEqual(worldUnderCursorBefore);
  });

  it("clamps a requested zoom above MAX_ZOOM", () => {
    expect(zoomAtScreenPoint(IDENTITY_CAMERA, { x: 0, y: 0 }, MAX_ZOOM * 10).zoom).toBe(MAX_ZOOM);
  });

  it("clamps a requested zoom at or below 0, never reaching MIN_ZOOM's floor of zero", () => {
    expect(zoomAtScreenPoint(IDENTITY_CAMERA, { x: 0, y: 0 }, MIN_ZOOM / 10).zoom).toBe(MIN_ZOOM);
    expect(zoomAtScreenPoint(IDENTITY_CAMERA, { x: 0, y: 0 }, 0).zoom).toBe(MIN_ZOOM);
    expect(zoomAtScreenPoint(IDENTITY_CAMERA, { x: 0, y: 0 }, -5).zoom).toBe(MIN_ZOOM);
  });

  it("negative zero resolves to MIN_ZOOM, same as any other requested zoom at or below the floor", () => {
    expect(zoomAtScreenPoint(IDENTITY_CAMERA, { x: 0, y: 0 }, -0).zoom).toBe(MIN_ZOOM);
  });

  it("keeps the current zoom when the request is non-finite, rather than snapping to a bound (D-027)", () => {
    const camera: CameraState = { x: 1, y: 2, zoom: 5 };
    expect(zoomAtScreenPoint(camera, { x: 0, y: 0 }, Number.NaN).zoom).toBe(5);
    expect(zoomAtScreenPoint(camera, { x: 0, y: 0 }, Number.POSITIVE_INFINITY).zoom).toBe(5);
  });

  it("never produces a computed x/y that is itself non-finite, even from an extreme clamp", () => {
    // A huge screenPoint divided by the clamped MIN_ZOOM stays finite here, but
    // this pins the contract (D-027) rather than any specific arithmetic path.
    const result = zoomAtScreenPoint(IDENTITY_CAMERA, { x: 1e6, y: -1e6 }, MIN_ZOOM);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});
