/**
 * grips.ts
 *
 * The grabbers on a selected path each name one part of it.
 *
 * A vertex grip sits on a vertex and moves it. An edge grip sits halfway
 * along an edge and bends it. Both appear only on a selected path, so the
 * first press picks the object and the next one picks a part of it.
 *
 * A grip reports whether the slots behind it are literal. A grip that a
 * formula drives draws hollow. So the operator sees which points hold still
 * before a drag tells them.
 *
 * Render-layer code: it reads engine state and calls mutations, and crosses
 * that line for nothing else. Nothing in the engine imports this file, so a
 * GPU renderer can replace the whole layer later.
 */

import {
  arcOfEdge,
  bezierOfEdge,
  bulgeForMidpoint,
  type CameraState,
  edgeMidpoint,
  getSlot,
  type GraphObject,
  pathEdgesOfObject,
  type Point,
  POLYLINE_TYPE,
  vertexBulgePath,
  vertexXPath,
  vertexYPath,
} from "../engine/index.ts";
import { worldToScreen, type ScreenPoint } from "./camera.ts";

/**
 * A grip names one part of a path. The index of an edge is the index of the
 * vertex it leaves.
 */
export type PathGrip =
  | { readonly kind: "vertex"; readonly index: number }
  | { readonly kind: "edge"; readonly index: number };

export interface PlacedGrip {
  readonly grip: PathGrip;
  readonly point: Point;
  /** True when every slot behind this grip is a literal, so a drag can write it. */
  readonly free: boolean;
}

export const VERTEX_GRIP_SIZE_SCREEN = 8;
export const EDGE_GRIP_SIZE_SCREEN = 7;
export const GRIP_TOLERANCE_SCREEN = 7;

export function hasPathGrips(object: GraphObject): boolean {
  return object.type === POLYLINE_TYPE && (object.vertexCount ?? 0) > 0;
}

/**
 * Every grip of a path, vertices first.
 *
 * A vertex grip exists for each vertex. An edge grip exists for each edge the
 * path actually has, so an open path has one fewer than a closed one.
 */
export function pathGrips(object: GraphObject): readonly PlacedGrip[] {
  if (!hasPathGrips(object)) {
    return [];
  }
  const count = object.vertexCount ?? 0;
  const vertices: PlacedGrip[] = [];
  for (let index = 0; index < count; index += 1) {
    const point = vertexPoint(object, index);
    if (point !== undefined) {
      vertices.push({ grip: { kind: "vertex", index }, point, free: vertexIsFree(object, index) });
    }
  }
  const edges = pathEdgesOfObject(object).map((edge, index) => ({
    grip: { kind: "edge", index } as const,
    point: edgeMidpoint(edge),
    free: isLiteral(object, vertexBulgePath(index)),
  }));
  return [...vertices, ...edges];
}

/**
 * The grip under a screen point, or nothing.
 *
 * A vertex wins a tie with an edge. The two sit on top of each other when an
 * edge is short, and a vertex is the part an operator reaches for.
 */
export function gripAt(object: GraphObject, screenPoint: ScreenPoint, camera: CameraState): PathGrip | undefined {
  let nearest: PlacedGrip | undefined;
  let shortest = GRIP_TOLERANCE_SCREEN;
  for (const placed of pathGrips(object)) {
    const centre = worldToScreen(camera, placed.point);
    const distance = Math.hypot(screenPoint.x - centre.x, screenPoint.y - centre.y);
    const wins = distance < shortest || (distance === shortest && placed.grip.kind === "vertex");
    if (distance <= GRIP_TOLERANCE_SCREEN && wins) {
      shortest = distance;
      nearest = placed;
    }
  }
  return nearest?.grip;
}

/**
 * What one edge is: straight, an arc, or a cubic.
 *
 * A handle wins over a bulge, the same order edge.ts builds an edge in. Nothing
 * else in the interface says which of the five slots behind an edge is live. So
 * a half unit handle turns an edge into a curve, and no reader can see it.
 */
export type EdgeShape = "line" | "arc" | "curve";

export function edgeShape(object: GraphObject, index: number): EdgeShape | undefined {
  const edge = pathEdgesOfObject(object)[index];
  if (edge === undefined) {
    return undefined;
  }
  if (bezierOfEdge(edge) !== undefined) {
    return "curve";
  }
  return arcOfEdge(edge) === undefined ? "line" : "arc";
}

export function sameGrip(one: PathGrip, other: PathGrip): boolean {
  return one.kind === other.kind && one.index === other.index;
}

/** The two ends of one edge, or nothing when the path has no such edge. */
export function edgeEnds(object: GraphObject, index: number): { readonly start: Point; readonly end: Point } | undefined {
  const count = object.vertexCount ?? 0;
  const edges = pathEdgesOfObject(object);
  if (count === 0 || index < 0 || index >= edges.length) {
    return undefined;
  }
  const start = vertexPoint(object, index);
  const end = vertexPoint(object, (index + 1) % count);
  return start === undefined || end === undefined ? undefined : { start, end };
}

/**
 * The bulge that puts the middle of one edge under a point.
 *
 * The caller writes it to vertex.N.bulge. It is absolute, read from the ends
 * the edge has now, so a bend never sums small steps and never drifts.
 */
export function bulgeForGrabbedMidpoint(object: GraphObject, index: number, worldPoint: Point): number | undefined {
  const ends = edgeEnds(object, index);
  return ends === undefined ? undefined : bulgeForMidpoint(ends.start, ends.end, worldPoint);
}

function vertexPoint(object: GraphObject, index: number): Point | undefined {
  const x = getSlot(object, vertexXPath(index))?.value;
  const y = getSlot(object, vertexYPath(index))?.value;
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

function vertexIsFree(object: GraphObject, index: number): boolean {
  return isLiteral(object, vertexXPath(index)) && isLiteral(object, vertexYPath(index));
}

function isLiteral(object: GraphObject, path: readonly string[]): boolean {
  const slot = getSlot(object, path);
  return slot === undefined || slot.kind === "literal";
}
