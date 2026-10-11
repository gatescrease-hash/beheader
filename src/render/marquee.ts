/**
 * marquee.ts
 *
 * The selection box that a press on empty canvas draws: the units it takes,
 * and how it looks on screen.
 *
 * The direction of the drag picks the rule, the way AutoCAD picks it. A box
 * drawn from left to right is a window, and takes a unit that lies wholly
 * inside it. A box drawn from right to left is a crossing, and takes a unit it
 * touches. Touching follows the hit test: a filled shape touches the box
 * anywhere over its inside, and a hollow outline touches it only where its
 * stroke crosses the box, so a crossing drawn inside a hollow circle takes
 * nothing. A text, a table, an image, a script node and a math object are
 * boxes to the hit test, and so they are here.
 *
 * The box takes units, the same units an arrangement moves: an object with no
 * group around it, or the outermost group of an object inside one. A window
 * takes a group when it encloses every member at any depth, and leaves the
 * padding of the outline out, because that padding belongs to no member. A
 * crossing takes a group when it touches any member, or the outline and tab
 * that a press on the group would hit.
 *
 * A curved edge is tested against its true arc, and a cubic against a run of
 * short chords along it, which strays from the curve by far less than a pixel
 * at any zoom an operator draws a box at.
 *
 * Render-layer code: it reads engine state and touches no DOM. The drawing goes
 * through DrawingContext, so the call that paints the canvas could paint any
 * other backend.
 */
import {
  arcOfEdge,
  bezierOfEdge,
  bezierPointAt,
  buildPathEdges,
  type CameraState,
  CLOSED_PATH,
  displayObjects,
  getSlot,
  groupDescendants,
  groupOf,
  type GraphObject,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  pathContains,
  pathEdgesOfObject,
  type PathEdge,
  type Point,
  RADIUS_PATH,
  sweepCoversAngle,
  VERTICES_PATH,
} from "../engine/index.ts";
import { worldToScreen, type WorldPoint } from "./camera.ts";
import type { DrawingContext } from "./drawing.ts";
import { GROUP_TAB_HEIGHT, groupBoundary, groupTabWidth, objectExtent, type WorldExtent } from "./extent.ts";
import { asPointArray, readBoolean, readNumber, readShapeStyle } from "./slots.ts";

/** A window takes what lies wholly inside the box, and a crossing takes what the box touches. */
export type MarqueeMode = "window" | "crossing";

/** How many chords stand for one cubic edge when a crossing tests it. */
const CUBIC_CHORDS = 32;

/**
 * The rule a box follows, from the direction it was drawn in. A box drawn
 * straight up or down has no direction across, and counts as a window.
 */
export function marqueeMode(start: WorldPoint, end: WorldPoint): MarqueeMode {
  return end.x >= start.x ? "window" : "crossing";
}

/** The box between the press and the pointer, whichever way it was drawn. */
export function marqueeBox(start: WorldPoint, end: WorldPoint): WorldExtent {
  return { minX: Math.min(start.x, end.x), minY: Math.min(start.y, end.y), maxX: Math.max(start.x, end.x), maxY: Math.max(start.y, end.y) };
}

/**
 * Every unit on the canvas, in the order the drawing reaches it: what Ctrl+A
 * selects. Hidden objects, the variable holder and the layers are no units,
 * because none of them draws on the canvas.
 */
export function canvasUnits(objects: readonly GraphObject[]): readonly GraphObject[] {
  return unitsOf(displayObjects(objects));
}

function unitsOf(shown: readonly GraphObject[]): readonly GraphObject[] {
  const byId = new Map(shown.map((object) => [object.id, object]));
  const units: GraphObject[] = [];
  const seen = new Set<string>();
  for (const object of shown) {
    let unit = object;
    for (let parent = groupOf(unit); parent !== undefined; parent = groupOf(unit)) {
      const group = byId.get(parent);
      if (group === undefined) break;
      unit = group;
    }
    if (seen.has(unit.id)) continue;
    seen.add(unit.id);
    units.push(unit);
  }
  return units;
}

/** The units a box takes, in the order canvasUnits gives them. */
export function marqueeUnits(objects: readonly GraphObject[], box: WorldExtent, mode: MarqueeMode): readonly string[] {
  const shown = displayObjects(objects);
  return unitsOf(shown)
    .filter((unit) => (unit.type === "group" ? groupTaken(unit, shown, box, mode) : mode === "window" ? enclosed(objectExtent(unit), box) : touches(unit, box)))
    .map((unit) => unit.id);
}

function groupTaken(group: GraphObject, shown: readonly GraphObject[], box: WorldExtent, mode: MarqueeMode): boolean {
  const inside = groupDescendants(group.id, shown);
  const members = inside.filter((object) => object.type !== "group");
  if (mode === "window") {
    return members.length === 0 ? enclosed(groupBoundary(group, shown), box) : members.every((member) => enclosed(objectExtent(member), box));
  }
  return members.some((member) => touches(member, box))
    || [group, ...inside.filter((object) => object.type === "group")].some((each) => touchesGroupOutline(each, shown, box));
}

function enclosed(extent: WorldExtent | undefined, box: WorldExtent): boolean {
  return extent !== undefined && extent.minX >= box.minX && extent.maxX <= box.maxX && extent.minY >= box.minY && extent.maxY <= box.maxY;
}

function overlaps(a: WorldExtent, b: WorldExtent): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function inside(point: Point, box: WorldExtent): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
}

/** True when the box touches what a press on the object would hit. */
function touches(object: GraphObject, box: WorldExtent): boolean {
  const extent = objectExtent(object);
  if (extent === undefined || !overlaps(extent, box)) {
    return false;
  }
  if (enclosed(extent, box)) {
    return true;
  }
  const filled = readShapeStyle(object).fillColor !== undefined;
  switch (object.type) {
    case "circle":
      return circleTouches(object, box, filled);
    case "polygon":
    case "rect": {
      const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
      return vertices !== undefined && vertices.length > 0 && edgesTouch(buildPathEdges(vertices, [], true), box, filled);
    }
    case "polyline":
      return edgesTouch(pathEdgesOfObject(object), box, filled && readBoolean(object, CLOSED_PATH) === true);
    default:
      return true;
  }
}

/** A filled circle touches the box over its disc, and a hollow one only along its ring. */
function circleTouches(object: GraphObject, box: WorldExtent, filled: boolean): boolean {
  const x = readNumber(object, ORIGIN_X_PATH);
  const y = readNumber(object, ORIGIN_Y_PATH);
  const radius = readNumber(object, RADIUS_PATH);
  if (x === undefined || y === undefined || radius === undefined || radius < 0) {
    return false;
  }
  const nearest = Math.hypot(x - Math.max(box.minX, Math.min(x, box.maxX)), y - Math.max(box.minY, Math.min(y, box.maxY)));
  const farthest = Math.hypot(Math.max(Math.abs(x - box.minX), Math.abs(x - box.maxX)), Math.max(Math.abs(y - box.minY), Math.abs(y - box.maxY)));
  return nearest <= radius && (filled || farthest >= radius);
}

/**
 * True when an edge passes through the box, or when the box sits inside a
 * filled path. With no edge through it, the box lies wholly inside the path or
 * wholly outside it, so one point of the box settles which.
 */
function edgesTouch(edges: readonly PathEdge[], box: WorldExtent, filled: boolean): boolean {
  if (edges.some((edge) => edgeTouches(edge, box))) {
    return true;
  }
  return filled && edges.length > 0 && pathContains({ x: box.minX, y: box.minY }, edges);
}

function edgeTouches(edge: PathEdge, box: WorldExtent): boolean {
  if (inside(edge.start, box) || inside(edge.end, box)) {
    return true;
  }
  const curve = bezierOfEdge(edge);
  if (curve !== undefined) {
    let previous = curve.p0;
    for (let step = 1; step <= CUBIC_CHORDS; step += 1) {
      const next = bezierPointAt(curve, step / CUBIC_CHORDS);
      if (segmentTouches(previous, next, box)) return true;
      previous = next;
    }
    return false;
  }
  const arc = arcOfEdge(edge);
  if (arc === undefined) {
    return segmentTouches(edge.start, edge.end, box);
  }
  // Neither end lies inside the box, so an arc that reaches the box crosses one
  // of its sides on the way in.
  const corners: readonly Point[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  return corners.some((corner, index) =>
    circleCrossings(arc.center, arc.radius, corner, corners[(index + 1) % corners.length]!)
      .some((point) => sweepCoversAngle(arc, Math.atan2(point.y - arc.center.y, point.x - arc.center.x))));
}

/** True when a straight segment has any point inside the box, by clipping it to each side in turn. */
function segmentTouches(start: Point, end: Point, box: WorldExtent): boolean {
  const spanX = end.x - start.x;
  const spanY = end.y - start.y;
  let enter = 0;
  let leave = 1;
  const clip = (direction: number, room: number): boolean => {
    if (direction === 0) return room >= 0;
    const at = room / direction;
    if (direction < 0) {
      if (at > leave) return false;
      enter = Math.max(enter, at);
    } else {
      if (at < enter) return false;
      leave = Math.min(leave, at);
    }
    return true;
  };
  return clip(-spanX, start.x - box.minX) && clip(spanX, box.maxX - start.x) && clip(-spanY, start.y - box.minY) && clip(spanY, box.maxY - start.y);
}

/** The points where a circle crosses a straight segment. */
function circleCrossings(center: Point, radius: number, start: Point, end: Point): readonly Point[] {
  const spanX = end.x - start.x;
  const spanY = end.y - start.y;
  const offsetX = start.x - center.x;
  const offsetY = start.y - center.y;
  const a = spanX * spanX + spanY * spanY;
  const b = 2 * (offsetX * spanX + offsetY * spanY);
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (a === 0 || discriminant < 0) {
    return [];
  }
  const root = Math.sqrt(discriminant);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((along) => along >= 0 && along <= 1)
    .map((along) => ({ x: start.x + along * spanX, y: start.y + along * spanY }));
}

/**
 * True when the box touches the outline of a group or its tab. A box drawn in
 * the space inside the outline touches neither, because a press there passes
 * through the group to whatever lies under it.
 */
function touchesGroupOutline(group: GraphObject, objects: readonly GraphObject[], box: WorldExtent): boolean {
  const outline = groupBoundary(group, objects);
  if (outline === undefined) {
    return false;
  }
  const tab: WorldExtent = { minX: outline.minX, minY: outline.minY - GROUP_TAB_HEIGHT, maxX: outline.minX + groupTabWidth(group), maxY: outline.minY };
  const withinOutline = box.minX > outline.minX && box.maxX < outline.maxX && box.minY > outline.minY && box.maxY < outline.maxY;
  return overlaps(tab, box) || (overlaps(outline, box) && !withinOutline);
}

/** The colours AutoCAD gives the two boxes: blue for a window and green for a crossing. */
const MARQUEE_COLORS: Readonly<Record<MarqueeMode, { readonly stroke: string; readonly fill: string }>> = {
  window: { stroke: "#2f6fdd", fill: "rgba(47, 111, 221, 0.10)" },
  crossing: { stroke: "#2f9e57", fill: "rgba(47, 158, 87, 0.10)" },
};

/**
 * Draws the box in screen space, so its outline keeps one width at every zoom.
 * A window draws solid and a crossing draws dashed, so the rule a release
 * follows shows before the release.
 */
export function drawMarquee(ctx: DrawingContext, camera: CameraState, start: WorldPoint, end: WorldPoint, pixelRatio: number = 1): void {
  const mode = marqueeMode(start, end);
  const from = worldToScreen(camera, start);
  const to = worldToScreen(camera, end);
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = MARQUEE_COLORS[mode].fill;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = MARQUEE_COLORS[mode].stroke;
  ctx.lineWidth = pixelRatio;
  ctx.setLineDash(mode === "crossing" ? [5 * pixelRatio, 3 * pixelRatio] : []);
  ctx.strokeRect(x + 0.5, y + 0.5, width, height);
  ctx.restore();
}
