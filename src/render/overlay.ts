/**
 * overlay.ts
 *
 * Draws the dependency overlay that wires.ts places, in two passes that
 * renderer.ts calls around the objects.
 *
 * The first pass draws the ordinary curves beneath the objects, so a curve
 * never covers the text of a table or a label, and a click inside an object
 * reaches the object, as a curve drawn beneath it suggests. The second pass
 * draws above the objects what the operator is looking at: the curves that
 * touch the hovered object, the selected curve, and the ring of a refused
 * cycle. The ring draws even with the overlay off, because the operator has
 * just made the change it refused and needs to see the loop now.
 *
 * Lines, arrow heads and counts keep one size on screen at any zoom, so each
 * size is a screen size divided by the zoom of the world transform.
 *
 * Render-layer code: it reads engine state, and touches no DOM.
 */
import { displayObjects, type Address, type CameraState, type GraphObject, type Point } from "../engine/index.ts";
import { groupBoundary, objectExtent, type WorldExtent } from "./extent.ts";
import { cycleRing, objectWires, placeWires, wireKey, wirePoint, type PlacedWire, type Wire } from "./wires.ts";

/** What the overlay shows on one paint. */
export interface WireOverlay {
  /** Whether the toggle of section 19 is on. */
  readonly visible: boolean;
  /** The object under the pointer, whose curves draw at full strength while the rest dim. */
  readonly hoveredObjectId?: string;
  /** The curve the operator selected, by its two objects. */
  readonly selectedWire?: Pick<Wire, "sourceId" | "readerId">;
  /** The ring of slots a refused cycle named, which draws until the next change. */
  readonly cycle?: readonly Address[];
}

const WIRE_STYLE = "rgba(91, 100, 114, 0.55)";
const WIRE_DIMMED_STYLE = "rgba(91, 100, 114, 0.12)";
const WIRE_HOVER_STYLE = "rgba(56, 64, 76, 0.95)";
const WIRE_SELECTED_STYLE = "#a85e45";
const CYCLE_STYLE = "#c0392b";
const COUNT_FILL_STYLE = "#fbf8f1";
const COUNT_TEXT_STYLE = "#38404c";

const WIRE_WIDTH_SCREEN = 1.25;
const WIRE_EMPHASIS_WIDTH_SCREEN = 2;
const ARROW_LENGTH_SCREEN = 9;
const ARROW_HALF_WIDTH_SCREEN = 4;
const COUNT_FONT_SCREEN = 10;
const COUNT_HEIGHT_SCREEN = 14;
const CYCLE_DASH_SCREEN = 6;

/** The box a wire meets: the boundary of a group, or the extent of anything else. */
export function wireBox(object: GraphObject, objects: readonly GraphObject[]): WorldExtent | undefined {
  return object.type === "group" ? groupBoundary(object, objects) : objectExtent(object);
}

/** The placed curves of the objects on show. */
export function placedWires(objects: readonly GraphObject[]): readonly PlacedWire[] {
  const shown = displayObjects(objects);
  const byId = new Map(shown.map((object) => [object.id, object]));
  return placeWires(objectWires(objects), (id) => {
    const object = byId.get(id);
    return object === undefined ? undefined : wireBox(object, shown);
  });
}

/** The ordinary curves, drawn beneath the objects in world space. */
export function drawWiresUnder(ctx: CanvasRenderingContext2D, camera: CameraState, objects: readonly GraphObject[], overlay: WireOverlay | undefined): void {
  if (overlay?.visible !== true) return;
  const selected = overlay.selectedWire === undefined ? undefined : wireKey(overlay.selectedWire);
  for (const placed of visibleWires(objects, camera, ctx)) {
    const touching = touches(placed.wire, overlay.hoveredObjectId);
    if (touching || wireKey(placed.wire) === selected) continue;
    const style = overlay.hoveredObjectId === undefined ? WIRE_STYLE : WIRE_DIMMED_STYLE;
    drawCurve(ctx, camera, placed, style, WIRE_WIDTH_SCREEN);
  }
}

/** The curves the operator is looking at, and the ring of a refused cycle, drawn above the objects. */
export function drawWiresOver(ctx: CanvasRenderingContext2D, camera: CameraState, objects: readonly GraphObject[], overlay: WireOverlay | undefined): void {
  if (overlay === undefined) return;
  const all = overlay.visible || overlay.cycle !== undefined ? placedWires(objects) : [];
  if (overlay.visible) {
    const selected = overlay.selectedWire === undefined ? undefined : wireKey(overlay.selectedWire);
    for (const placed of all) {
      if (wireKey(placed.wire) === selected) drawCurve(ctx, camera, placed, WIRE_SELECTED_STYLE, WIRE_EMPHASIS_WIDTH_SCREEN);
      else if (touches(placed.wire, overlay.hoveredObjectId)) drawCurve(ctx, camera, placed, WIRE_HOVER_STYLE, WIRE_EMPHASIS_WIDTH_SCREEN);
    }
  }
  if (overlay.cycle !== undefined) drawCycle(ctx, camera, objects, all, overlay.cycle);
}

function touches(wire: Wire, objectId: string | undefined): boolean {
  return objectId !== undefined && (wire.sourceId === objectId || wire.readerId === objectId);
}

/**
 * The curves with any part on screen. A curve whose ends both sit off screen
 * on opposite sides still crosses the view, so the test reads the box around
 * all four points of the curve rather than its ends.
 */
function visibleWires(objects: readonly GraphObject[], camera: CameraState, ctx: CanvasRenderingContext2D): readonly PlacedWire[] {
  const width = ctx.canvas.width / camera.zoom;
  const height = ctx.canvas.height / camera.zoom;
  const view = { minX: camera.x, minY: camera.y, maxX: camera.x + width, maxY: camera.y + height };
  return placedWires(objects).filter((placed) => {
    const points = [placed.from, placed.control1, placed.control2, placed.to];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return Math.max(...xs) >= view.minX && Math.min(...xs) <= view.maxX && Math.max(...ys) >= view.minY && Math.min(...ys) <= view.maxY;
  });
}

function drawCurve(ctx: CanvasRenderingContext2D, camera: CameraState, placed: PlacedWire, style: string, widthScreen: number, dashed = false): void {
  const unit = 1 / camera.zoom;
  ctx.save();
  ctx.strokeStyle = style;
  ctx.fillStyle = style;
  ctx.lineWidth = widthScreen * unit;
  ctx.setLineDash(dashed ? [CYCLE_DASH_SCREEN * unit, CYCLE_DASH_SCREEN * unit * 0.6] : []);
  ctx.beginPath();
  ctx.moveTo(placed.from.x, placed.from.y);
  ctx.bezierCurveTo(placed.control1.x, placed.control1.y, placed.control2.x, placed.control2.y, placed.to.x, placed.to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  drawArrowHead(ctx, placed, unit);
  if (placed.wire.edges.length > 1) drawCount(ctx, wirePoint(placed, 0.5), placed.wire.edges.length, unit, style);
  ctx.restore();
}

/** An arrow head at the reading end, pointing along the last stretch of the curve. */
function drawArrowHead(ctx: CanvasRenderingContext2D, placed: PlacedWire, unit: number): void {
  const tail: Point = wirePoint(placed, 0.92);
  const dx = placed.to.x - tail.x;
  const dy = placed.to.y - tail.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const ux = dx / length;
  const uy = dy / length;
  const baseX = placed.to.x - ux * ARROW_LENGTH_SCREEN * unit;
  const baseY = placed.to.y - uy * ARROW_LENGTH_SCREEN * unit;
  const half = ARROW_HALF_WIDTH_SCREEN * unit;
  ctx.beginPath();
  ctx.moveTo(placed.to.x, placed.to.y);
  ctx.lineTo(baseX - uy * half, baseY + ux * half);
  ctx.lineTo(baseX + uy * half, baseY - ux * half);
  ctx.closePath();
  ctx.fill();
}

/** The count of slot edges behind a curve, in a small pill at its middle. */
function drawCount(ctx: CanvasRenderingContext2D, at: Point, count: number, unit: number, style: string): void {
  const label = String(count);
  ctx.font = `600 ${COUNT_FONT_SCREEN * unit}px sans-serif`;
  const height = COUNT_HEIGHT_SCREEN * unit;
  const width = Math.max(height, ctx.measureText(label).width + 8 * unit);
  ctx.beginPath();
  ctx.roundRect(at.x - width / 2, at.y - height / 2, width, height, height / 2);
  ctx.fillStyle = COUNT_FILL_STYLE;
  ctx.fill();
  ctx.lineWidth = unit;
  ctx.strokeStyle = style;
  ctx.stroke();
  ctx.fillStyle = COUNT_TEXT_STYLE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, at.x, at.y + 0.5 * unit);
}

/**
 * The ring of a refused cycle. A pair with a curve of its own follows that
 * curve. A pair with no curve in the committed document, which is the pair
 * whose edge the refused change would have added, gets a curve placed for it
 * between the two boxes. A ring inside one object outlines that object.
 */
function drawCycle(ctx: CanvasRenderingContext2D, camera: CameraState, objects: readonly GraphObject[], placed: readonly PlacedWire[], cycle: readonly Address[]): void {
  const ring = cycleRing(cycle, objects);
  const byKey = new Map(placed.map((entry) => [wireKey(entry.wire), entry]));
  const shown = displayObjects(objects);
  const boxOf = (id: string): WorldExtent | undefined => {
    const object = shown.find((candidate) => candidate.id === id);
    return object === undefined ? undefined : wireBox(object, shown);
  };
  if (ring.pairs.length === 0) {
    const unit = 1 / camera.zoom;
    for (const id of ring.objectIds) {
      const box = boxOf(id);
      if (box === undefined) continue;
      ctx.save();
      ctx.strokeStyle = CYCLE_STYLE;
      ctx.lineWidth = WIRE_EMPHASIS_WIDTH_SCREEN * unit;
      ctx.setLineDash([CYCLE_DASH_SCREEN * unit, CYCLE_DASH_SCREEN * unit * 0.6]);
      const pad = 6 * unit;
      ctx.strokeRect(box.minX - pad, box.minY - pad, box.maxX - box.minX + 2 * pad, box.maxY - box.minY + 2 * pad);
      ctx.restore();
    }
    return;
  }
  for (const pair of ring.pairs) {
    const existing = byKey.get(wireKey(pair));
    const curve = existing ?? placeWires([{ ...pair, edges: [] }], boxOf)[0];
    if (curve !== undefined) drawCurve(ctx, camera, { ...curve, wire: { ...curve.wire, edges: [] } }, CYCLE_STYLE, WIRE_EMPHASIS_WIDTH_SCREEN, true);
  }
}
