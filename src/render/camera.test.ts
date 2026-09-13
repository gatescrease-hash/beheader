/**
 * camera.test.ts
 *
 * These tests cover world to screen and back, pan, zoom to a point, and the
 * clamps.
 */
import { describe, expect, it } from "vitest";
import { type CameraState, deserializeDocument } from "../engine/index.ts";
import { clampCamera, clampZoom, IDENTITY_ZOOM, MAX_ZOOM, MIN_ZOOM, panByScreenDelta, screenToWorld, worldToScreen, zoomAtScreenPoint } from "./camera.ts";

const IDENTITY_CAMERA: CameraState = { x: 0, y: 0, zoom: 1 };

describe("worldToScreen", () => {
  it("is the identity at the default camera (no pan, zoom 1)", () => {
    expect(worldToScreen(IDENTITY_CAMERA, { x: 12, y: -7 })).toEqual({ x: 12, y: -7 });
  });

  it("scales world distances by zoom", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 2 };
    expect(worldToScreen(camera, { x: 10, y: 5 })).toEqual({ x: 20, y: 10 });
  });

  it("treats camera.x/camera.y as the world point at the screen origin", () => {
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
    expect(panByScreenDelta(camera, 40, 0).x).toBe(-10);
  });

  it("ignores a non-finite delta component and leaves that component of the camera unchanged", () => {
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

  it("keeps the current zoom when the request is non-finite, rather than snapping to a bound", () => {
    const camera: CameraState = { x: 1, y: 2, zoom: 5 };
    expect(zoomAtScreenPoint(camera, { x: 0, y: 0 }, Number.NaN).zoom).toBe(5);
    expect(zoomAtScreenPoint(camera, { x: 0, y: 0 }, Number.POSITIVE_INFINITY).zoom).toBe(5);
  });

  it("never produces a computed x/y that is itself non-finite, even from an extreme clamp", () => {
    const result = zoomAtScreenPoint(IDENTITY_CAMERA, { x: 1e6, y: -1e6 }, MIN_ZOOM);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});

describe("a loaded camera is not clamped to [MIN_ZOOM, MAX_ZOOM], a known gap", () => {
  const loadCameraWithZoom = (zoom: number): CameraState => {
    const result = deserializeDocument({
      formatVersion: 1,
      nextObjectId: 1,
      objects: [],
      journal: [],
      camera: { x: 0, y: 0, zoom },
    });
    if (!result.ok) {
      throw new Error(`expected the loader to accept zoom ${zoom}, got: ${result.message}`);
    }
    return result.document.camera;
  };

  it("loads a zoom of 0, and screenToWorld then yields a non-finite point instead of throwing", () => {
    const camera = loadCameraWithZoom(0);
    expect(camera.zoom).toBe(0);
    expect(screenToWorld(camera, { x: 100, y: 50 })).toEqual({ x: Infinity, y: Infinity });
  });

  it("loads a NEGATIVE zoom, which mirrors the world rather than being rejected", () => {
    const camera = loadCameraWithZoom(-5);
    expect(worldToScreen(camera, { x: 10, y: 0 })).toEqual({ x: -50, y: -0 });
  });

  it("loads a zoom far below MIN_ZOOM, so MIN_ZOOM binds only cameras this file produces", () => {
    const camera = loadCameraWithZoom(1e-300);
    expect(camera.zoom).toBeLessThan(MIN_ZOOM);
  });
});

describe("clampCamera — the boundary where a loaded camera enters the render layer", () => {
  it("leaves a camera already inside the zoom range bit-for-bit alone", () => {
    expect(clampCamera({ x: 37, y: -19, zoom: 3.5 })).toEqual({ x: 37, y: -19, zoom: 3.5 });
  });

  it("corrects the zoom deserializeDocument accepts and screenToWorld cannot use", () => {
    expect(clampCamera({ x: 0, y: 0, zoom: 0 }).zoom).toBe(MIN_ZOOM);
    expect(clampCamera({ x: 0, y: 0, zoom: -5 }).zoom).toBe(MIN_ZOOM);
    expect(clampCamera({ x: 0, y: 0, zoom: 1e-300 }).zoom).toBe(MIN_ZOOM);
    expect(clampCamera({ x: 0, y: 0, zoom: 1e9 }).zoom).toBe(MAX_ZOOM);
  });

  it("makes screenToWorld usable for the camera that used to return Infinity", () => {
    const loaded: CameraState = { x: 0, y: 0, zoom: 0 };
    expect(screenToWorld(loaded, { x: 100, y: 100 })).toEqual({ x: Infinity, y: Infinity });
    expect(screenToWorld(clampCamera(loaded), { x: 100, y: 100 })).toEqual({ x: 100 / MIN_ZOOM, y: 100 / MIN_ZOOM });
  });

  it("clamps a zoom that a real document round-trip carried in, not just a hand-built one", () => {
    const raw = { formatVersion: 1, nextObjectId: 1, objects: [], journal: [], camera: { x: 5, y: 6, zoom: 0 } };
    const loaded = deserializeDocument(raw);
    if (!loaded.ok) {
      throw new Error(`expected the zero-zoom camera to load, which is the whole point, got: ${loaded.message}`);
    }
    expect(clampCamera(loaded.document.camera)).toEqual({ x: 5, y: 6, zoom: MIN_ZOOM });
  });

  it("falls back to identity zoom for a zoom no bound can correct, and to the world origin for a non-finite pan", () => {
    expect(clampCamera({ x: Number.NaN, y: Infinity, zoom: Number.NaN })).toEqual({ x: 0, y: 0, zoom: IDENTITY_ZOOM });
  });
});

describe("clampZoom — the range half, exported for a caller that must place a camera at the zoom it actually got", () => {
  it("clamps to the bounds and keeps an in-range request unchanged", () => {
    expect(clampZoom(0.5, 1)).toBe(0.5);
    expect(clampZoom(0, 1)).toBe(MIN_ZOOM);
    expect(clampZoom(1e9, 1)).toBe(MAX_ZOOM);
  });

  it("returns the fallback for a non-finite request rather than snapping to a bound", () => {
    expect(clampZoom(Number.NaN, 4)).toBe(4);
    expect(clampZoom(Infinity, 4)).toBe(4);
  });

  it("agrees with zoomAtScreenPoint, which must not develop a second clamp", () => {
    const camera: CameraState = { x: 0, y: 0, zoom: 2 };
    expect(zoomAtScreenPoint(camera, { x: 10, y: 10 }, 1e9).zoom).toBe(clampZoom(1e9, camera.zoom));
    expect(zoomAtScreenPoint(camera, { x: 10, y: 10 }, Number.NaN).zoom).toBe(clampZoom(Number.NaN, camera.zoom));
  });
});
