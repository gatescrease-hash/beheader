/**
 * connector-layout.ts
 *
 * Where the parts of a connector sit in world units: the line, shortened at
 * each end that carries an arrowhead, and the arrowheads themselves. The
 * painter, the picture export, the hit test and the extent all read this one
 * layout, so the line a press picks is the line the canvas draws.
 *
 * An arrowhead scales with the stroke, so a heavier line has a larger head,
 * and the line stops at the base of a head rather than at its tip, because a
 * line drawn to the tip shows through the point of the head at any width.
 *
 * Render-layer code: it reads slot values and touches no DOM.
 */
import { CONNECTOR_ARROW_PATH, type GraphObject, getSlot, type Point, VERTICES_PATH } from "../engine/index.ts";
import type { WorldExtent } from "./extent.ts";
import { readShapeStyle } from "./slots.ts";

/** The length of an arrowhead along the line, for a stroke of a given width. */
export function arrowheadLength(strokeWidth: number): number {
  return 6 + 4 * strokeWidth;
}

/** The arrowhead is this fraction of its length wide on each side of the line. */
const ARROWHEAD_HALF_WIDTH_RATIO = 0.4;

export interface ConnectorLayout {
  /** Where the line starts and ends, each pulled back to the base of an arrowhead it carries. */
  readonly lineStart: Point;
  readonly lineEnd: Point;
  /** The two points the line runs between, the tips of any arrowheads. */
  readonly start: Point;
  readonly end: Point;
  /** Each arrowhead as a triangle: its tip, then the two corners of its base. */
  readonly heads: readonly (readonly Point[])[];
  readonly strokeColor: string;
  readonly strokeWidth: number;
}

function arrowAt(tip: Point, from: Point, length: number): readonly Point[] {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const span = Math.hypot(dx, dy);
  const ux = dx / span;
  const uy = dy / span;
  const base = { x: tip.x - ux * length, y: tip.y - uy * length };
  const half = length * ARROWHEAD_HALF_WIDTH_RATIO;
  return [tip, { x: base.x - uy * half, y: base.y + ux * half }, { x: base.x + uy * half, y: base.y - ux * half }];
}

/** The layout of a connector, or undefined for a connector with no line to draw. */
export function connectorLayout(object: GraphObject): ConnectorLayout | undefined {
  const value = getSlot(object, VERTICES_PATH)?.value;
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined;
  }
  const [start, end] = value as readonly Point[];
  if (start === undefined || end === undefined) {
    return undefined;
  }
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(span > 0) || !Number.isFinite(span)) {
    return undefined;
  }
  const style = readShapeStyle(object);
  const arrow = getSlot(object, CONNECTOR_ARROW_PATH)?.value;
  const atEnd = arrow === "end" || arrow === "both";
  const atStart = arrow === "start" || arrow === "both";
  // Two heads that would meet in the middle shrink to share the line.
  const length = Math.min(arrowheadLength(style.strokeWidth), span / ((atEnd ? 1 : 0) + (atStart ? 1 : 0) || 1));
  const pull = (from: Point, to: Point, by: number): Point => ({ x: from.x + ((to.x - from.x) / span) * by, y: from.y + ((to.y - from.y) / span) * by });
  return {
    start,
    end,
    lineStart: atStart ? pull(start, end, length) : start,
    lineEnd: atEnd ? pull(end, start, length) : end,
    heads: [...(atEnd ? [arrowAt(end, start, length)] : []), ...(atStart ? [arrowAt(start, end, length)] : [])],
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
  };
}

/** The box around a connector's line and heads. */
export function connectorExtent(layout: ConnectorLayout): WorldExtent {
  const points = [layout.start, layout.end, ...layout.heads.flat()];
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** The distance from a world point to a connector's line, from tip to tip. */
export function distanceToConnector(layout: ConnectorLayout, point: Point): number {
  const dx = layout.end.x - layout.start.x;
  const dy = layout.end.y - layout.start.y;
  const t = Math.max(0, Math.min(1, ((point.x - layout.start.x) * dx + (point.y - layout.start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (layout.start.x + t * dx), point.y - (layout.start.y + t * dy));
}
