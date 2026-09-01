/**
 * panel.ts — Where the properties panel floats: the pure placement arithmetic
 * D-094 clause 11 requires to live in `render/` and be tested, never in `start`.
 *
 * IMPLEMENTS: D-094 clause 11 (anchor the panel beside the selected object's
 * drawn extent, flip when it would overflow the canvas's left edge, clamp so
 * the whole panel stays on the canvas) and clause 12 (the panel is a DOM
 * element laid out in CSS pixels while `worldToScreen` returns BACKING pixels,
 * so every screen coordinate here is divided back down by the canvas's own
 * backing/CSS ratio — the same conversion `main.ts`'s `screenPointOf` makes in
 * the other direction, D-086 clause 3).
 * LAYER: render (pure). No canvas, DOM, or window — plain coordinate math over
 * a `WorldExtent` and a `CameraState`. May import: engine/* (types), own layer
 * (`./camera.ts`, `./extent.ts`). NEVER imports command/*, the DOM, or a
 * canvas; NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `placePropertiesPanel(extent, camera, ratioBackingPerCss, viewport, panel)`
 *   → the panel's top-left corner in CSS pixels, measured from the canvas's own
 *   top-left. It anchors the panel's top edge to the extent's top and its right
 *   edge one gap to the LEFT of the extent (the human's sketch at entry 0095);
 *   when that would put the panel off the canvas's left edge it flips to the
 *   RIGHT of the extent instead; either way the result is clamped so the whole
 *   panel stays inside the canvas.
 *
 *   Building the panel's DOM rows is NOT here — `main.ts` does that from
 *   `command/props.ts`'s descriptors (D-094 clause 9). This file is only the
 *   arithmetic, because entry 0090 found four defects and every one of them was
 *   in untested `start` code (D-094 clause 11's own reason for existing).
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws, and never returns a non-finite coordinate for a finite
 *     input: a non-finite or non-positive ratio falls back to 1, the same "a
 *     bad number does not move furniture" posture `camera.ts` takes.
 *   - The world<->screen mapping is `camera.ts`'s own `worldToScreen`, never a
 *     second hand-written copy of it (D-010).
 *
 * NOT DONE HERE
 *   - Whether the panel is shown at all — `main.ts`'s job (D-094 clause 2:
 *     the object must have a drawn extent; **D-106**: its panel must not be
 *     dismissed) — what it contains, or the sketch's dashed leader line to
 *     the object (D-094 defers that).
 *   - Where a DRAGGED panel goes (**D-101** clause 5). This function is not
 *     even called for one: `main.ts` holds its manual CSS position instead
 *     once the operator has detached it, which is what makes clause 5's "not
 *     following pan or zoom" true — nothing here re-derives a position for a
 *     panel this file was never consulted about.
 */
import type { CameraState } from "../engine/document.ts";
import { worldToScreen } from "./camera.ts";
import type { WorldExtent } from "./extent.ts";

/** A CSS-pixel size — the canvas's own box, or the panel's measured rect. */
export interface PanelSize {
  readonly width: number;
  readonly height: number;
}

/** The panel's top-left corner, in CSS pixels from the canvas's top-left. */
export interface PanelPlacement {
  readonly left: number;
  readonly top: number;
}

/**
 * The gap between the panel and the object's drawn extent, in CSS pixels.
 * Untuned (Rule 5) — chosen to read as "attached to, not touching", like every
 * other spacing constant in `render/`.
 */
export const PANEL_OBJECT_GAP_CSS = 8;

/**
 * Where the properties panel's top-left corner sits (D-094 clauses 11-12).
 *
 * `ratioBackingPerCss` is `canvas.width / bounds.width` (D-086 clause 3): the
 * screen points `worldToScreen` returns are in BACKING pixels and the panel is
 * laid out in CSS pixels. `viewport` is the canvas's CSS-pixel box (for the
 * clamp); `panel` is the panel's own measured CSS-pixel size.
 */
export function placePropertiesPanel(
  extent: WorldExtent,
  camera: CameraState,
  ratioBackingPerCss: number,
  viewport: PanelSize,
  panel: PanelSize,
): PanelPlacement {
  const ratio = Number.isFinite(ratioBackingPerCss) && ratioBackingPerCss > 0 ? ratioBackingPerCss : 1;
  const extentTopLeft = worldToScreen(camera, { x: extent.minX, y: extent.minY });
  const extentTopRight = worldToScreen(camera, { x: extent.maxX, y: extent.minY });
  const extentLeftCss = extentTopLeft.x / ratio;
  const extentTopCss = extentTopLeft.y / ratio;
  const extentRightCss = extentTopRight.x / ratio;

  // Anchor to the LEFT of the extent, top edges aligned (the human's sketch).
  let left = extentLeftCss - PANEL_OBJECT_GAP_CSS - panel.width;
  if (left < 0) {
    // The left placement runs off the canvas's left edge — flip to the RIGHT.
    left = extentRightCss + PANEL_OBJECT_GAP_CSS;
  }

  return {
    left: clampToRange(left, 0, Math.max(0, viewport.width - panel.width)),
    top: clampToRange(extentTopCss, 0, Math.max(0, viewport.height - panel.height)),
  };
}

function clampToRange(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
