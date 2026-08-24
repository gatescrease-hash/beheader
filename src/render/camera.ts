/**
 * camera.ts — World <-> screen coordinate transform, pan, and zoom-to-cursor.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.9 ("Camera: pan..., zoom to cursor (wheel), world ->
 * screen and screen -> world. All object coordinates are world coordinates; the
 * camera is the only thing that knows about screen space.").
 * LAYER: render. This file itself touches no canvas, DOM, or window — it is pure
 * coordinate math over `document.ts`'s `CameraState`. May import: engine/*, own
 * layer. NEVER imported by engine/* (Rule 1: render never flows backward into
 * engine).
 * Resolves Q-007 (OPEN_QUESTIONS.md): this is the consumer 0025-REVIEW-phase0
 * named as `CameraState`'s real owner.
 *
 * WHAT THIS IS
 *   `camera.x`/`camera.y` (`document.ts`'s `CameraState`) is the WORLD-space point
 *   that sits at the screen's top-left corner; `camera.zoom` scales world lengths
 *   to screen pixels: `screen = (world - camera) * zoom`. Chosen over a
 *   center-of-viewport convention because it needs no viewport size to define, so
 *   `CameraState` needs no widening to serve this file — it stays exactly
 *   `{ x, y, zoom }`, per Q-007's binding constraint that Phase 3 widens the shape
 *   rather than replacing it, and only if it must.
 *
 *   `panByScreenDelta` and `zoomAtScreenPoint` are the only two functions here that
 *   PRODUCE a `CameraState`; `worldToScreen`/`screenToWorld` are pure reads. Per
 *   D-027 ("every number reachable from a Document... guard it where it is
 *   computed"), both producers reject a non-finite result in favour of the
 *   camera's own prior coordinate rather than propagate `NaN`/`Infinity` into
 *   document state — this is the file D-027 named in advance ("a NaN zoom out of
 *   a zoom-to-fit over an empty selection... guard it where it is computed").
 *   Zoom is additionally clamped to `[MIN_ZOOM, MAX_ZOOM]` so it can never reach 0
 *   (which would make `screenToWorld` divide by zero) or an unusable extreme.
 *
 * NOT DONE HERE
 *   - Reading the mouse/wheel, or any DOM event handling — a future
 *     `render/interaction.ts`.
 *   - Deciding WHEN to pan/zoom, or how a wheel delta maps to a zoom factor —
 *     callers decide that and pass this file plain screen-space numbers.
 *   - "fit" (zoom to a bounding box) — needs a viewport size and a bounding box,
 *     neither of which this file owns; composes from `zoomAtScreenPoint` plus the
 *     caller's own arithmetic, later.
 */
import type { CameraState } from "../engine/document.ts";
import type { Point } from "../engine/graph/node.ts";

/** A point in world space — the same coordinate system every object on the canvas is stored in. */
export type WorldPoint = Point;

/** A point in screen space — pixels from the canvas's top-left corner. */
export type ScreenPoint = Point;

/**
 * Zoom is clamped to this range: never 0 (`screenToWorld` would divide by it),
 * never an unusably extreme scale. Round numbers, not tuned — Rule 5: the
 * dumbest correct implementation, not a fitted one.
 */
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 100;

/** World -> screen, under `camera`. Pure; never throws. §5.9. */
export function worldToScreen(camera: CameraState, worldPoint: WorldPoint): ScreenPoint {
  return {
    x: (worldPoint.x - camera.x) * camera.zoom,
    y: (worldPoint.y - camera.y) * camera.zoom,
  };
}

/**
 * Screen -> world, under `camera` — the exact inverse of `worldToScreen`. Pure;
 * never throws: `camera.zoom` is always `>= MIN_ZOOM > 0` (every `CameraState`
 * this file produces is clamped, and `document.ts`'s `deserializeDocument`
 * rejects a malformed camera on load), so this never divides by zero. §5.9.
 */
export function screenToWorld(camera: CameraState, screenPoint: ScreenPoint): WorldPoint {
  return {
    x: screenPoint.x / camera.zoom + camera.x,
    y: screenPoint.y / camera.zoom + camera.y,
  };
}

/**
 * Pans by a screen-space pixel delta (e.g. a mouse-drag delta since the last
 * frame), keeping zoom fixed. §5.9: "pan (middle-drag or space-drag)." The
 * content under the cursor follows it: dragging the mouse right by `dxScreen`
 * pixels moves everything on screen right by that same `dxScreen` pixels,
 * regardless of zoom (verified in the test file via `worldToScreen`, not
 * asserted from the formula alone).
 */
export function panByScreenDelta(camera: CameraState, dxScreen: number, dyScreen: number): CameraState {
  return {
    x: finiteOrFallback(camera.x - dxScreen / camera.zoom, camera.x),
    y: finiteOrFallback(camera.y - dyScreen / camera.zoom, camera.y),
    zoom: camera.zoom,
  };
}

/**
 * Sets zoom to `requestedZoom` (clamped to `[MIN_ZOOM, MAX_ZOOM]`) while keeping
 * the world point currently under `screenPoint` fixed on screen — §5.9: "zoom to
 * cursor (wheel)." The caller supplies the target zoom (e.g. `camera.zoom *
 * wheelFactor`); this file does not interpret wheel deltas (file header).
 */
export function zoomAtScreenPoint(camera: CameraState, screenPoint: ScreenPoint, requestedZoom: number): CameraState {
  const zoom = clampZoom(camera, requestedZoom);
  const worldPointUnderCursor = screenToWorld(camera, screenPoint);
  return {
    x: finiteOrFallback(worldPointUnderCursor.x - screenPoint.x / zoom, camera.x),
    y: finiteOrFallback(worldPointUnderCursor.y - screenPoint.y / zoom, camera.y),
    zoom,
  };
}

/**
 * Clamps to `[MIN_ZOOM, MAX_ZOOM]`. A non-finite request keeps the CURRENT zoom
 * rather than snapping to a bound — the same "ignore a bad computation, don't
 * let it move the camera" posture `finiteOrFallback` states below, applied
 * before `Math.min`/`Math.max` (which would themselves propagate a `NaN`
 * argument straight through unchanged).
 */
function clampZoom(camera: CameraState, requestedZoom: number): number {
  if (!Number.isFinite(requestedZoom)) {
    return camera.zoom;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, requestedZoom));
}

/**
 * D-027: a camera-producing function must never emit a non-finite number into
 * `CameraState`. Falls back to the camera's own PRIOR coordinate rather than an
 * arbitrary constant, so a bad delta or a degenerate computation (D-027's own
 * example: "a NaN zoom out of a zoom-to-fit over an empty selection") leaves the
 * camera where it was instead of teleporting it or making the document
 * unloadable.
 *
 * No separate `-0` branch. By the same proof `primitives/schema.ts`'s `add`
 * already relies on for `+` (D-033: "IEEE754 `+` of two finite, non-`-0`
 * operands cannot itself produce `-0`"), subtracting two already-legal
 * (never-`-0`) finite operands cannot produce `-0` either — cancellation to
 * exact zero is always `+0` in round-to-nearest, which JS always uses. Every
 * operand reaching this file's arithmetic is either an already-legal `camera`
 * field (guaranteed by this same fallback, inductively, plus
 * `deserializeDocument`'s load-time rejection) or a caller-supplied screen
 * coordinate, so the `-0` case D-033 handled for multiplication/division never
 * arises from subtraction or addition here.
 */
function finiteOrFallback(computed: number, fallback: number): number {
  return Number.isFinite(computed) ? computed : fallback;
}
