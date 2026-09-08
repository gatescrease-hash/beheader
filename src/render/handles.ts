/**
 * handles.ts
 *
 * Layer: render. It reads engine state and calls mutations. It does nothing
 * else across that line. The engine must never import this file.
 *
 * The resize grabbers on a selected object, and the box math they drive.
 *
 * A resize is absolute. It reads the extent that the drag started with. It is
 * never a sum of small steps, because a sum drifts.
 */

import type { CameraState } from "../engine/document.ts";
import { IMAGE_TYPE, TEXT_TYPE, type GraphObject } from "../engine/graph/node.ts";
import { worldToScreen, type ScreenPoint, type WorldPoint } from "./camera.ts";
import type { WorldExtent } from "./extent.ts";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "ne", "se", "sw", "n", "e", "s", "w"];

export const RESIZE_HANDLE_SIZE_SCREEN = 8;
export const RESIZE_HANDLE_TOLERANCE_SCREEN = 7;

export const MIN_RESIZE_BOX_SIZE = 8;

export interface ResizeEdges {
  readonly left: boolean;
  readonly right: boolean;
  readonly top: boolean;
  readonly bottom: boolean;
}

export function hasResizeHandles(object: GraphObject): boolean {
  return object.type === TEXT_TYPE || object.type === IMAGE_TYPE;
}

export function handleEdges(handle: ResizeHandle): ResizeEdges {
  return {
    left: handle === "nw" || handle === "w" || handle === "sw",
    right: handle === "ne" || handle === "e" || handle === "se",
    top: handle === "nw" || handle === "n" || handle === "ne",
    bottom: handle === "sw" || handle === "s" || handle === "se",
  };
}

export function handlePoint(extent: WorldExtent, handle: ResizeHandle): WorldPoint {
  const edges = handleEdges(handle);
  const midX = (extent.minX + extent.maxX) / 2;
  const midY = (extent.minY + extent.maxY) / 2;
  return {
    x: edges.left ? extent.minX : edges.right ? extent.maxX : midX,
    y: edges.top ? extent.minY : edges.bottom ? extent.maxY : midY,
  };
}

export function resizeHandleAt(
  screenPoint: ScreenPoint,
  extent: WorldExtent,
  camera: CameraState,
): ResizeHandle | undefined {
  for (const handle of RESIZE_HANDLES) {
    const centre = worldToScreen(camera, handlePoint(extent, handle));
    if (
      Math.abs(screenPoint.x - centre.x) <= RESIZE_HANDLE_TOLERANCE_SCREEN &&
      Math.abs(screenPoint.y - centre.y) <= RESIZE_HANDLE_TOLERANCE_SCREEN
    ) {
      return handle;
    }
  }
  return undefined;
}

export function resizeCursor(handle: ResizeHandle): string {
  switch (handle) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    default: {
      const exhaustive: never = handle;
      void exhaustive;
      return "default";
    }
  }
}

/** The new box for a drag. It is absolute, from the extent the drag started with. */
export function resizeBox(extent: WorldExtent, handle: ResizeHandle, deltaX: number, deltaY: number): WorldExtent {
  const edges = handleEdges(handle);
  const minX = edges.left ? Math.min(extent.minX + deltaX, extent.maxX - MIN_RESIZE_BOX_SIZE) : extent.minX;
  const maxX = edges.right ? Math.max(extent.maxX + deltaX, extent.minX + MIN_RESIZE_BOX_SIZE) : extent.maxX;
  const minY = edges.top ? Math.min(extent.minY + deltaY, extent.maxY - MIN_RESIZE_BOX_SIZE) : extent.minY;
  const maxY = edges.bottom ? Math.max(extent.maxY + deltaY, extent.minY + MIN_RESIZE_BOX_SIZE) : extent.maxY;
  return { minX, minY, maxX, maxY };
}

/** Holds a box to an aspect ratio while it resizes. */
export function constrainBoxToRatio(start: WorldExtent, requested: WorldExtent, handle: ResizeHandle): WorldExtent {
  const startWidth = start.maxX - start.minX;
  const startHeight = start.maxY - start.minY;
  if (!(startWidth > 0) || !(startHeight > 0) || !Number.isFinite(startWidth) || !Number.isFinite(startHeight)) {
    return requested;
  }
  const edges = handleEdges(handle);
  const movesX = edges.left || edges.right;
  const movesY = edges.top || edges.bottom;
  const scaleX = (requested.maxX - requested.minX) / startWidth;
  const scaleY = (requested.maxY - requested.minY) / startHeight;
  const scale = movesX && movesY ? Math.max(scaleX, scaleY) : movesX ? scaleX : scaleY;

  const width = Math.max(startWidth * scale, MIN_RESIZE_BOX_SIZE);
  const height = Math.max(startHeight * scale, MIN_RESIZE_BOX_SIZE);
  const minX = edges.left ? start.maxX - width : start.minX;
  const minY = edges.top ? start.maxY - height : start.minY;
  return { minX, minY, maxX: minX + width, maxY: minY + height };
}
