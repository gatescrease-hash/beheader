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
 *   `panByScreenDelta`, `zoomAtScreenPoint` and `clampCamera` are the three
 *   functions that PRODUCE a `CameraState`; the rest are pure reads. Every
 *   producer refuses a non-finite result in favour of the camera's own prior
 *   value rather than propagating `NaN`/`Infinity` into document state (D-027,
 *   which named this file in advance), and clamps zoom to `[MIN_ZOOM, MAX_ZOOM]`
 *   so it can never reach 0 — which would make `screenToWorld` divide by zero.
 *   `clampCamera` is D-062's boundary: a camera off a LOADED document has no
 *   such guarantee until it passes through here.
 *
 * NOT DONE HERE
 *   - Reading the mouse/wheel, or any DOM event handling — `main.ts` listens,
 *     and hands both this file and `render/interaction.ts` plain screen-space
 *     points and deltas. Neither of those two knows the DOM exists.
 *   - Deciding WHEN to pan/zoom, or how a wheel delta maps to a zoom factor —
 *     callers decide that and pass this file plain screen-space numbers.
 *   - "fit" (zoom to a bounding box) — needs a viewport size and a bounding box,
 *     neither of which this file owns. `main.ts` composes it from `clampZoom`
 *     plus `render/hittest.ts`'s `documentExtent` (D-061, D-075 clause 5).
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
 * Screen -> world, under `camera` — the exact inverse of `worldToScreen`. §5.9.
 *
 * PRECONDITION: `camera.zoom` is non-zero. Every `CameraState` this file
 * PRODUCES satisfies it — `clampZoom` holds zoom inside `[MIN_ZOOM, MAX_ZOOM]`
 * — but a camera read off a LOADED document does not. `deserializeDocument`
 * rejects only numbers that are illegal AS NUMBERS (non-finite, or `-0` —
 * D-027); `zoom: 0`, a negative zoom, and `1e-300` are all legal numbers and
 * load fine. At `zoom: 0` this returns `Infinity` rather than throwing, because
 * JS division does not throw — so a caller passing an unvalidated loaded camera
 * gets a silently useless point instead of an error.
 *
 * D-062 puts that guard in `render/`, where a loaded camera enters the render
 * layer, and NOT in `document.ts`: `MIN_ZOOM` is defined here, and Rule 1
 * forbids `engine/` importing `render/`, so the loader structurally cannot
 * enforce this file's range. That guard is `clampCamera` below, and `main.ts`
 * runs every camera it holds — loaded, created, or replaced — through it.
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
  const zoom = clampZoom(requestedZoom, camera.zoom);
  const worldPointUnderCursor = screenToWorld(camera, screenPoint);
  return {
    x: finiteOrFallback(worldPointUnderCursor.x - screenPoint.x / zoom, camera.x),
    y: finiteOrFallback(worldPointUnderCursor.y - screenPoint.y / zoom, camera.y),
    zoom,
  };
}

/**
 * Clamps to `[MIN_ZOOM, MAX_ZOOM]`. A non-finite request yields `fallbackZoom`
 * rather than snapping to a bound — the same "ignore a bad computation, don't
 * let it move the camera" posture `finiteOrFallback` states below, applied
 * before `Math.min`/`Math.max` (which would themselves propagate a `NaN`
 * argument straight through unchanged).
 *
 * Exported because a caller that must know the CLAMPED zoom before it can place
 * the camera — `main.ts`'s `fit`, which computes `camera.x`/`camera.y` from the
 * zoom it actually got (D-061, D-075 clause 5) — cannot get it from
 * `zoomAtScreenPoint`, which needs a finished camera to return. Takes a plain
 * fallback rather than a `CameraState` so `clampCamera` below can reuse it for a
 * camera whose own zoom is the thing in doubt.
 */
export function clampZoom(requestedZoom: number, fallbackZoom: number): number {
  if (!Number.isFinite(requestedZoom)) {
    return fallbackZoom;
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, requestedZoom));
}

/**
 * D-062's boundary, in one function: the point where a camera read off a LOADED
 * document (or off `createEmptyDocument`) enters the render layer and acquires
 * the range guarantee only a `CameraState` this file produced otherwise carries.
 *
 * Why it exists: `deserializeDocument` accepts `zoom: 0`, `zoom: -5` and
 * `1e-300` — all legal numbers (D-027), none a usable zoom — and at `zoom: 0`
 * `screenToWorld` returns `Infinity` and `hitTest`'s world tolerance becomes
 * `Infinity`, so every click selects the topmost object. D-062 clause 2 puts the
 * correction HERE, not in `document.ts` (Rule 1 forbids `engine/` importing this
 * file's constants), and makes it a correction rather than a rejection: a
 * document with a strange camera still opens, pointing somewhere usable.
 *
 * A zoom that is not finite at all cannot be corrected toward a bound (there is
 * no direction to correct it in), so it falls back to `IDENTITY_ZOOM`. `x`/`y`
 * fall back to the world origin for the same reason.
 */
export function clampCamera(camera: CameraState): CameraState {
  return {
    x: finiteOrFallback(camera.x, 0),
    y: finiteOrFallback(camera.y, 0),
    zoom: clampZoom(camera.zoom, IDENTITY_ZOOM),
  };
}

/** The zoom at which one world unit is one screen pixel — `createEmptyDocument`'s own default, and what `clampCamera` falls back to when a zoom is not a number it can clamp. */
export const IDENTITY_ZOOM = 1;

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
