/**
 * arc.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * The math of one path edge, straight or curved. A bulge is the tangent of a
 * quarter of the included angle, the encoding a DXF file uses. Zero makes a
 * straight line, 1 makes a half circle, and the sign gives the direction.
 *
 * Every answer here is exact. Nothing cuts a curve into sample points. A
 * vertex is a point an operator placed, so this file never invents one.
 */
import type { Point } from "../graph/node.ts";

/** One edge of a path. A bulge of 0 makes it a straight line. */
export interface PathEdge {
  readonly start: Point;
  readonly end: Point;
  readonly bulge: number;
}

/** The circle a curved edge rides on. A straight edge has none. */
export interface ArcGeometry {
  readonly center: Point;
  readonly radius: number;
  readonly startAngle: number;
  /** Signed. The arc turns one way at a positive sweep, the other way at a negative one. */
  readonly sweep: number;
}

export interface PathBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The bulge of a half circle. Two of these make one full circle from two vertices. */
export const HALF_CIRCLE_BULGE = 1;

const FULL_TURN = 2 * Math.PI;

const CARDINAL_ANGLES: readonly number[] = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

/**
 * The circle under a curved edge, from its two endpoints and its bulge. It
 * returns undefined for a straight edge, and for an edge with no length.
 */
export function arcOfEdge(edge: PathEdge): ArcGeometry | undefined {
  if (!Number.isFinite(edge.bulge) || edge.bulge === 0) {
    return undefined;
  }
  const chordX = edge.end.x - edge.start.x;
  const chordY = edge.end.y - edge.start.y;
  const chord = Math.hypot(chordX, chordY);
  if (chord === 0) {
    return undefined;
  }
  const sweep = 4 * Math.atan(edge.bulge);
  const halfSweep = sweep / 2;
  const sine = Math.abs(Math.sin(halfSweep));
  if (sine === 0) {
    return undefined;
  }
  const radius = chord / (2 * sine);
  // The centre sits on the perpendicular bisector of the chord. The sign of
  // the sweep puts it on the correct side, for a minor arc and a major one.
  const offset = Math.sign(sweep) * radius * Math.cos(halfSweep);
  const center = {
    x: (edge.start.x + edge.end.x) / 2 - (chordY / chord) * offset,
    y: (edge.start.y + edge.end.y) / 2 + (chordX / chord) * offset,
  };
  const startAngle = Math.atan2(edge.start.y - center.y, edge.start.x - center.x);
  return { center, radius, startAngle, sweep };
}

/** True when the arc passes this angle between its start and its end. */
export function sweepCoversAngle(arc: ArcGeometry, angle: number): boolean {
  let delta = (angle - arc.startAngle) % FULL_TURN;
  if (delta < 0) {
    delta += FULL_TURN;
  }
  return arc.sweep >= 0 ? delta <= arc.sweep : delta - FULL_TURN >= arc.sweep;
}

/** The exact length of one edge. An arc gives radius times angle, not a sum of chords. */
export function edgeLength(edge: PathEdge): number {
  const arc = arcOfEdge(edge);
  if (arc === undefined) {
    return Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y);
  }
  return Math.abs(arc.radius * arc.sweep);
}

/**
 * The doubled area between the chord and the arc. A shoelace over the chords
 * gives the rest of the shape. A straight edge adds nothing here.
 */
export function edgeDoubledAreaOverChord(edge: PathEdge): number {
  const arc = arcOfEdge(edge);
  if (arc === undefined) {
    return 0;
  }
  return arc.radius * arc.radius * (arc.sweep - Math.sin(arc.sweep));
}

interface LuneMoment {
  readonly point: Point;
  readonly doubledArea: number;
}

/** The centroid of the piece between the chord and the arc, with its doubled area. */
function edgeLuneMoment(edge: PathEdge): LuneMoment | undefined {
  const arc = arcOfEdge(edge);
  if (arc === undefined) {
    return undefined;
  }
  const doubledArea = arc.radius * arc.radius * (arc.sweep - Math.sin(arc.sweep));
  if (doubledArea === 0) {
    return undefined;
  }
  const halfSweep = arc.sweep / 2;
  const distance = (4 * arc.radius * Math.sin(halfSweep) ** 3) / (3 * (arc.sweep - Math.sin(arc.sweep)));
  const middleAngle = arc.startAngle + halfSweep;
  return {
    point: { x: arc.center.x + Math.cos(middleAngle) * distance, y: arc.center.y + Math.sin(middleAngle) * distance },
    doubledArea,
  };
}

/**
 * Every point one edge contributes to a bounding box: its two ends, plus each
 * quarter point of the circle the arc actually reaches. It is exact.
 */
export function edgeExtremePoints(edge: PathEdge): readonly Point[] {
  const arc = arcOfEdge(edge);
  if (arc === undefined) {
    return [edge.start, edge.end];
  }
  const points: Point[] = [edge.start, edge.end];
  for (const angle of CARDINAL_ANGLES) {
    if (sweepCoversAngle(arc, angle)) {
      points.push({ x: arc.center.x + Math.cos(angle) * arc.radius, y: arc.center.y + Math.sin(angle) * arc.radius });
    }
  }
  return points;
}

/** The distance from a point to a straight edge. */
export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const spanX = end.x - start.x;
  const spanY = end.y - start.y;
  const lengthSquared = spanX * spanX + spanY * spanY;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const along = Math.max(0, Math.min(1, ((point.x - start.x) * spanX + (point.y - start.y) * spanY) / lengthSquared));
  return Math.hypot(point.x - (start.x + along * spanX), point.y - (start.y + along * spanY));
}

/** The distance from a point to one edge. It measures to the true arc, not to a chord. */
export function distanceToEdge(point: Point, edge: PathEdge): number {
  const arc = arcOfEdge(edge);
  if (arc === undefined) {
    return distanceToSegment(point, edge.start, edge.end);
  }
  const angle = Math.atan2(point.y - arc.center.y, point.x - arc.center.x);
  if (sweepCoversAngle(arc, angle)) {
    return Math.abs(Math.hypot(point.x - arc.center.x, point.y - arc.center.y) - arc.radius);
  }
  return Math.min(
    Math.hypot(point.x - edge.start.x, point.y - edge.start.y),
    Math.hypot(point.x - edge.end.x, point.y - edge.end.y),
  );
}

/**
 * The edges of a path. Edge i leaves vertex i and carries the bulge of vertex
 * i. A closed path has one edge for each vertex. An open path has one fewer,
 * and the bulge of the last vertex waits, unused, until the path closes.
 */
export function buildPathEdges(vertices: readonly Point[], bulges: readonly number[], closed: boolean): readonly PathEdge[] {
  const edges: PathEdge[] = [];
  const edgeCount = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < edgeCount; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    if (start === undefined || end === undefined) {
      continue;
    }
    edges.push({ start, end, bulge: bulges[index] ?? 0 });
  }
  return edges;
}

export function pathLength(edges: readonly PathEdge[]): number {
  let total = 0;
  for (const edge of edges) {
    total += edgeLength(edge);
  }
  return total;
}

/** The signed area, doubled. A shoelace over the chords, plus one lune for each arc. */
export function pathDoubledSignedArea(edges: readonly PathEdge[]): number {
  let total = 0;
  for (const edge of edges) {
    total += edge.start.x * edge.end.y - edge.end.x * edge.start.y;
    total += edgeDoubledAreaOverChord(edge);
  }
  return total;
}

export function pathArea(edges: readonly PathEdge[]): number {
  return Math.abs(pathDoubledSignedArea(edges)) / 2;
}

/**
 * The area weighted centroid, arcs included. It adds the moment of the chord
 * polygon to the moment of each lune, then divides by the total area.
 */
export function pathCentroid(edges: readonly PathEdge[]): Point {
  let chordDoubledArea = 0;
  let chordMomentX = 0;
  let chordMomentY = 0;
  let luneDoubledArea = 0;
  let luneMomentX = 0;
  let luneMomentY = 0;
  for (const edge of edges) {
    const cross = edge.start.x * edge.end.y - edge.end.x * edge.start.y;
    chordDoubledArea += cross;
    chordMomentX += (edge.start.x + edge.end.x) * cross;
    chordMomentY += (edge.start.y + edge.end.y) * cross;
    const lune = edgeLuneMoment(edge);
    if (lune !== undefined) {
      luneDoubledArea += lune.doubledArea;
      luneMomentX += lune.doubledArea * lune.point.x;
      luneMomentY += lune.doubledArea * lune.point.y;
    }
  }
  const total = chordDoubledArea + luneDoubledArea;
  if (total === 0) {
    return meanOfEnds(edges);
  }
  return { x: (chordMomentX / 3 + luneMomentX) / total, y: (chordMomentY / 3 + luneMomentY) / total };
}

function meanOfEnds(edges: readonly PathEdge[]): Point {
  if (edges.length === 0) {
    return { x: 0, y: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  for (const edge of edges) {
    sumX += edge.start.x;
    sumY += edge.start.y;
  }
  return { x: sumX / edges.length, y: sumY / edges.length };
}

export function pathBounds(edges: readonly PathEdge[]): PathBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const edge of edges) {
    for (const point of edgeExtremePoints(edge)) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

/** The shortest distance from a point to any edge of a path. */
export function distanceToPath(point: Point, edges: readonly PathEdge[]): number {
  let shortest = Infinity;
  for (const edge of edges) {
    shortest = Math.min(shortest, distanceToEdge(point, edge));
  }
  return shortest;
}
