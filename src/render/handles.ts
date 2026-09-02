/**
 * handles.ts — The eight resize grabbers on a selected text box.
 *
 * IMPLEMENTS: the human's 2026-09-02 instruction — "text boxes need to be able
 * to be expanded and shrunken with grabbers in the corners, like in
 * word/powerpoint". Eight rather than four (corners plus edge midpoints)
 * because a corner alone cannot set a width without also setting a height, and
 * the WIDTH is the one that matters here: a `text` object's numeric `width` is
 * also its wrap width (`render/measure.ts`'s `maxWidth`), so the side grabbers
 * are how an operator says "wrap here".
 * LAYER: render (pure). No canvas, DOM, or window — coordinate math over a
 * `WorldExtent` and a `CameraState`. May import: engine/* (read-only), own
 * layer (`./camera.ts`, `./extent.ts`). NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `hasResizeHandles(object)` — which objects get grabbers at all. Today only
 *   `text`. A `circle`/`polygon`/`rect` is parametric (`radius`, `sides`), so
 *   dragging its box is a different question with a different answer, and
 *   guessing one here would bake it in; a `table`'s size is `rows`/`cols`.
 *
 *   `resizeHandleAt(screenPoint, extent, camera, ratio)` — which grabber a
 *   press lands on, or `undefined`. SCREEN-space, with a screen-space
 *   tolerance, so a grabber stays the same comfortable size at every zoom (the
 *   same reasoning that puts `renderer.ts`'s chrome in its own identity pass).
 *
 *   `handleEdges(handle)` — which of the box's four edges that grabber moves.
 *   This is the whole semantic content of a handle: `"nw"` moves the left and
 *   top edges, `"e"` moves the right one, and so on. `interaction.ts` turns
 *   that plus a world delta into `origin`/`width`/`height` writes.
 *
 *   `resizeBox(extent, handle, deltaX, deltaY)` — the box a drag step wants,
 *   clamped so an edge can never cross its opposite. Pure geometry, kept here
 *   with the handle vocabulary rather than in `interaction.ts`, so it is
 *   testable without a document.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws, reads no slot, writes nothing (Rule 2).
 *   - A resized box always has width and height >= `MIN_TEXT_BOX_SIZE`. Dragging
 *     an edge past its opposite parks it at the minimum instead of inverting
 *     the box, which is what every drawing tool does and what keeps
 *     `WorldExtent`'s `minX <= maxX` promise true for the caller.
 *   - World<->screen is `camera.ts`'s own `worldToScreen` (D-010).
 *
 * NOT DONE HERE
 *   - DRAWING the grabbers — `renderer.ts`'s screen-space chrome pass, which
 *     asks this file where they go.
 *   - Writing any slot. `interaction.ts` builds the `setSlot` operations and
 *     `mutate` commits them (Rule 2).
 *   - A rotate handle, or a shape's parametric resize. Neither is asked for.
 */
import type { CameraState } from "../engine/document.ts";
import { TEXT_TYPE, type GraphObject } from "../engine/graph/node.ts";
import { worldToScreen, type ScreenPoint, type WorldPoint } from "./camera.ts";
import type { WorldExtent } from "./extent.ts";

/** One of the eight grabbers, named by compass point — `"nw"` is the top-left corner, `"e"` the right edge's midpoint. */
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** All eight, in the order `renderer.ts` draws and `resizeHandleAt` tests them. Corners first, so a press in the overlap between a corner and an adjacent edge grabber resolves to the corner — the more specific gesture. */
export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "ne", "se", "sw", "n", "e", "s", "w"];

/**
 * How big a grabber is on screen, in BACKING pixels, and how far from its
 * centre a press still counts. Untuned (Rule 5), chosen to be comfortable with
 * a mouse without swallowing clicks meant for the text under them.
 */
export const RESIZE_HANDLE_SIZE_SCREEN = 8;
export const RESIZE_HANDLE_TOLERANCE_SCREEN = 7;

/** The smallest box a resize may leave behind, in world units — see the file header's invariant. */
export const MIN_TEXT_BOX_SIZE = 8;

/** Which of the box's four edges a grabber moves. The whole meaning of a handle, in one place, so `resizeBox` and `interaction.ts`'s slot planning cannot read it differently. */
export interface ResizeEdges {
  readonly left: boolean;
  readonly right: boolean;
  readonly top: boolean;
  readonly bottom: boolean;
}

/** Whether `object` gets resize grabbers when it is selected — see the file header for why this is `text` only. */
export function hasResizeHandles(object: GraphObject): boolean {
  return object.type === TEXT_TYPE;
}

/** Which edges `handle` moves. */
export function handleEdges(handle: ResizeHandle): ResizeEdges {
  return {
    left: handle === "nw" || handle === "w" || handle === "sw",
    right: handle === "ne" || handle === "e" || handle === "se",
    top: handle === "nw" || handle === "n" || handle === "ne",
    bottom: handle === "sw" || handle === "s" || handle === "se",
  };
}

/** Where a grabber's centre sits in world space. */
export function handlePoint(extent: WorldExtent, handle: ResizeHandle): WorldPoint {
  const edges = handleEdges(handle);
  const midX = (extent.minX + extent.maxX) / 2;
  const midY = (extent.minY + extent.maxY) / 2;
  return {
    x: edges.left ? extent.minX : edges.right ? extent.maxX : midX,
    y: edges.top ? extent.minY : edges.bottom ? extent.maxY : midY,
  };
}

/**
 * The grabber under `screenPoint`, or `undefined`.
 *
 * Tested in SCREEN space against a fixed pixel tolerance, exactly as §5.9 tests
 * a stroke ("distance-to-segment with pixel tolerance"): a grabber that shrank
 * with the camera would be unclickable at low zoom, which is the whole reason
 * it is chrome rather than geometry.
 *
 * `ratioBackingPerCss` is not taken: `screenPoint` and `worldToScreen` are both
 * in BACKING pixels (`main.ts`'s `screenPointOf` converts on the way in,
 * D-086 clause 3), so this comparison is already in one space.
 */
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

/**
 * The CSS `cursor` keyword for a grabber — `nwse-resize` on the two corners
 * that run that way, and so on. A grabber that does not say which way it
 * stretches before you press it is a grabber you have to discover by trying,
 * which is the affordance every drawing tool provides and the human's "like in
 * word/powerpoint" implies.
 *
 * Returned rather than assigned: this file touches no DOM (`main.ts` sets it on
 * the canvas from a plain pointer move).
 */
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
      // Compile-time exhaustiveness without a throw — the idiom every
      // discriminated-union switch in this codebase carries.
      const exhaustive: never = handle;
      void exhaustive;
      return "default";
    }
  }
}

/**
 * The box `handle` dragged by (`deltaX`, `deltaY`) asks for, clamped so neither
 * dimension falls below `MIN_TEXT_BOX_SIZE`.
 *
 * The clamp parks the moving edge rather than inverting the box: dragging the
 * left edge right past the right edge leaves a minimum-width box whose right
 * edge never moved, which is what a drawing tool does and what keeps
 * `minX <= maxX` true for every reader of the result.
 */
export function resizeBox(extent: WorldExtent, handle: ResizeHandle, deltaX: number, deltaY: number): WorldExtent {
  const edges = handleEdges(handle);
  // An edge the handle does not move stays exactly where it was — no arithmetic
  // at all, so a NaN delta on one axis cannot disturb the other.
  const minX = edges.left ? Math.min(extent.minX + deltaX, extent.maxX - MIN_TEXT_BOX_SIZE) : extent.minX;
  const maxX = edges.right ? Math.max(extent.maxX + deltaX, extent.minX + MIN_TEXT_BOX_SIZE) : extent.maxX;
  const minY = edges.top ? Math.min(extent.minY + deltaY, extent.maxY - MIN_TEXT_BOX_SIZE) : extent.minY;
  const maxY = edges.bottom ? Math.max(extent.maxY + deltaY, extent.minY + MIN_TEXT_BOX_SIZE) : extent.maxY;
  return { minX, minY, maxX, maxY };
}
