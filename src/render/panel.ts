/**
 * panel.ts
 *
 * Works out where a properties panel sits next to its object, and nothing
 * else. main.ts builds the rows inside it and owns the DOM.
 *
 * Render-layer code: it reads engine state and calls mutations, and crosses
 * that line for nothing else. Nothing in the engine imports this file, so a
 * GPU renderer can replace the whole layer later.
 */
import type { CameraState } from "../engine/index.ts";
import { worldToScreen } from "./camera.ts";
import type { WorldExtent } from "./extent.ts";

export interface PanelSize {
  readonly width: number;
  readonly height: number;
}

export interface PanelPlacement {
  readonly left: number;
  readonly top: number;
}

export const PANEL_OBJECT_GAP_CSS = 8;

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

  let left = extentLeftCss - PANEL_OBJECT_GAP_CSS - panel.width;
  if (left < 0) {
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
