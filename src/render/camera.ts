/**
 * camera.ts
 *
 * Converts between world coordinates and screen coordinates, and holds the
 * pan, the zoom, and the limits on both.
 *
 * This is the only file that knows the transform. Every other file calls
 * worldToScreen or screenToWorld rather than multiplying by the zoom itself,
 * because a second copy of the formula drifts out of step the first time the
 * transform changes.
 *
 * zoomAtScreenPoint keeps the world point under the cursor pinned to the
 * cursor while the zoom changes, so a wheel zoom is anchored to the pointer
 * rather than to the origin.
 *
 * Render-layer code: it reads engine state and calls mutations, and crosses
 * that line for nothing else. Nothing in the engine imports this file, so a
 * GPU renderer can replace the whole layer later.
 */
import type { CameraState, Point } from "../engine/index.ts";

export type WorldPoint = Point;

export type ScreenPoint = Point;

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 100;

/**
 * This is the one conversion, and every other file calls it rather than a
 * second copy.
 */
export function worldToScreen(camera: CameraState, worldPoint: WorldPoint): ScreenPoint {
  return {
    x: (worldPoint.x - camera.x) * camera.zoom,
    y: (worldPoint.y - camera.y) * camera.zoom,
  };
}

export function screenToWorld(camera: CameraState, screenPoint: ScreenPoint): WorldPoint {
  return {
    x: screenPoint.x / camera.zoom + camera.x,
    y: screenPoint.y / camera.zoom + camera.y,
  };
}

export function panByScreenDelta(camera: CameraState, dxScreen: number, dyScreen: number): CameraState {
  return {
    x: finiteOrFallback(camera.x - dxScreen / camera.zoom, camera.x),
    y: finiteOrFallback(camera.y - dyScreen / camera.zoom, camera.y),
    zoom: camera.zoom,
  };
}

/** Zooms and keeps the world point under the cursor in place. */
export function zoomAtScreenPoint(camera: CameraState, screenPoint: ScreenPoint, requestedZoom: number): CameraState {
  const zoom = clampZoom(requestedZoom, camera.zoom);
  const worldPointUnderCursor = screenToWorld(camera, screenPoint);
  return {
    x: finiteOrFallback(worldPointUnderCursor.x - screenPoint.x / zoom, camera.x),
    y: finiteOrFallback(worldPointUnderCursor.y - screenPoint.y / zoom, camera.y),
    zoom,
  };
}

export function clampZoom(requestedZoom: number, fallbackZoom: number): number {
  if (!Number.isFinite(requestedZoom)) {
    return fallbackZoom;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, requestedZoom));
}

export function clampCamera(camera: CameraState): CameraState {
  return {
    x: finiteOrFallback(camera.x, 0),
    y: finiteOrFallback(camera.y, 0),
    zoom: clampZoom(camera.zoom, IDENTITY_ZOOM),
  };
}

export const IDENTITY_ZOOM = 1;

function finiteOrFallback(computed: number, fallback: number): number {
  return Number.isFinite(computed) ? computed : fallback;
}
