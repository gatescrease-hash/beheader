/**
 * edge.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * The math of one path edge. An edge is straight, an arc, or a cubic bezier.
 * Two control points make it a bezier. Otherwise a bulge makes it an arc: the
 * bulge is the tangent of a quarter of the included angle, the number a DXF
 * file carries. Zero makes a straight line and 1 makes a half circle.
 *
 * Nothing here cuts a curve into sample points. A vertex is a point an
 * operator placed, so this file never invents one.
 *
 * An arc answers every question in closed form. A bezier answers its area,
 * its centroid and its box in closed form as well. Those integrands are
 * polynomials, and a five point Gauss rule integrates a polynomial of degree
 * nine exactly. Two answers about a bezier have no closed form for anybody:
 * its length, and the distance from a point to it. Each of those refines a
 * number until the number holds still. Neither makes a vertex.
 */
import type { Point } from "../graph/node.ts";

/**
 * One edge of a path. Two control points make it a cubic bezier. With none, a
 * bulge of 0 makes it a straight line and any other bulge makes it an arc.
 */
export interface PathEdge {
  readonly start: Point;
  readonly end: Point;
  readonly bulge: number;
  readonly controls?: readonly [Point, Point];
}

/** One cubic, as its four control points. The first and last are the two ends of the edge. */
export interface CubicBezier {
  readonly p0: Point;
  readonly p1: Point;
  readonly p2: Point;
  readonly p3: Point;
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
 * returns undefined for a straight edge, for an edge with no length, and for
 * a bezier, because control points win over a bulge.
 */
export function arcOfEdge(edge: PathEdge): ArcGeometry | undefined {
  if (bezierOfEdge(edge) !== undefined) {
    return undefined;
  }
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

/**
 * Five point Gauss-Legendre, mapped onto 0 to 1. A rule with five nodes
 * integrates a polynomial of degree nine exactly. Every area and moment
 * integrand of a cubic is degree eight or less, so these answers are exact
 * and not estimates.
 */
const GAUSS_NODES: readonly number[] = [
  0.5 - 0.5 * 0.906179845938664,
  0.5 - 0.5 * 0.5384693101056831,
  0.5,
  0.5 + 0.5 * 0.5384693101056831,
  0.5 + 0.5 * 0.906179845938664,
];

const GAUSS_WEIGHTS: readonly number[] = [
  0.5 * 0.23692688505618908,
  0.5 * 0.47862867049936647,
  0.5 * 0.5688888888888889,
  0.5 * 0.47862867049936647,
  0.5 * 0.23692688505618908,
];

/** How close a control polygon must come to its chord before a length holds still. */
const BEZIER_LENGTH_TOLERANCE = 1e-10;

const BEZIER_LENGTH_MAX_DEPTH = 24;

/** The coarse scan a nearest point search starts from, before it narrows. */
const BEZIER_SCAN_STEPS = 24;

const BEZIER_NARROW_STEPS = 60;

/** The cubic under an edge, or undefined when the edge carries no control points. */
export function bezierOfEdge(edge: PathEdge): CubicBezier | undefined {
  const controls = edge.controls;
  if (controls === undefined) {
    return undefined;
  }
  const [p1, p2] = controls;
  if (!isFinitePoint(p1) || !isFinitePoint(p2)) {
    return undefined;
  }
  return { p0: edge.start, p1, p2, p3: edge.end };
}

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** The straight edge from start to end, written as a cubic. It lets one integrator serve both. */
function chordAsCubic(start: Point, end: Point): CubicBezier {
  const spanX = end.x - start.x;
  const spanY = end.y - start.y;
  return {
    p0: start,
    p1: { x: start.x + spanX / 3, y: start.y + spanY / 3 },
    p2: { x: start.x + (2 * spanX) / 3, y: start.y + (2 * spanY) / 3 },
    p3: end,
  };
}

export function bezierPointAt(curve: CubicBezier, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * curve.p0.x + b * curve.p1.x + c * curve.p2.x + d * curve.p3.x,
    y: a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y,
  };
}

/** The first derivative, which the area and moment integrands need. */
function bezierSlopeAt(curve: CubicBezier, t: number): Point {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return {
    x: a * (curve.p1.x - curve.p0.x) + b * (curve.p2.x - curve.p1.x) + c * (curve.p3.x - curve.p2.x),
    y: a * (curve.p1.y - curve.p0.y) + b * (curve.p2.y - curve.p1.y) + c * (curve.p3.y - curve.p2.y),
  };
}

function integrateOverCurve(curve: CubicBezier, integrand: (point: Point, slope: Point) => number): number {
  let total = 0;
  for (let i = 0; i < GAUSS_NODES.length; i += 1) {
    const t = GAUSS_NODES[i] ?? 0;
    total += (GAUSS_WEIGHTS[i] ?? 0) * integrand(bezierPointAt(curve, t), bezierSlopeAt(curve, t));
  }
  return total;
}

/** Twice the signed area a curve sweeps about the origin. Green's theorem, one edge at a time. */
function curveDoubledSweptArea(curve: CubicBezier): number {
  return integrateOverCurve(curve, (point, slope) => point.x * slope.y - point.y * slope.x);
}

function curveMomentX(curve: CubicBezier): number {
  return integrateOverCurve(curve, (point, slope) => point.x * point.x * slope.y);
}

function curveMomentY(curve: CubicBezier): number {
  return -integrateOverCurve(curve, (point, slope) => point.y * point.y * slope.x);
}

/** De Casteljau. The two halves together hold the shape of the curve they replace, exactly. */
export function splitBezier(curve: CubicBezier, t: number): { readonly first: CubicBezier; readonly second: CubicBezier } {
  const a = mix(curve.p0, curve.p1, t);
  const b = mix(curve.p1, curve.p2, t);
  const c = mix(curve.p2, curve.p3, t);
  const d = mix(a, b, t);
  const e = mix(b, c, t);
  const f = mix(d, e, t);
  return { first: { p0: curve.p0, p1: a, p2: d, p3: f }, second: { p0: f, p1: e, p2: c, p3: curve.p3 } };
}

function mix(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * The length of a cubic. No closed form exists, for anybody. This halves the
 * curve until its control polygon and its chord agree, then takes the mean of
 * the two. It returns one number and makes no vertex.
 */
function bezierLength(curve: CubicBezier, depth: number): number {
  const chord = Math.hypot(curve.p3.x - curve.p0.x, curve.p3.y - curve.p0.y);
  const polygon =
    Math.hypot(curve.p1.x - curve.p0.x, curve.p1.y - curve.p0.y) +
    Math.hypot(curve.p2.x - curve.p1.x, curve.p2.y - curve.p1.y) +
    Math.hypot(curve.p3.x - curve.p2.x, curve.p3.y - curve.p2.y);
  if (depth >= BEZIER_LENGTH_MAX_DEPTH || polygon - chord <= BEZIER_LENGTH_TOLERANCE * Math.max(1, polygon)) {
    return (chord + polygon) / 2;
  }
  const halves = splitBezier(curve, 0.5);
  return bezierLength(halves.first, depth + 1) + bezierLength(halves.second, depth + 1);
}

/** The values of t inside the edge where one axis of a cubic turns around. */
function turningPoints(v0: number, v1: number, v2: number, v3: number): readonly number[] {
  const a = 3 * (-v0 + 3 * v1 - 3 * v2 + v3);
  const b = 6 * (v0 - 2 * v1 + v2);
  const c = 3 * (v1 - v0);
  const inside = (t: number): boolean => t > 0 && t < 1;
  if (a === 0) {
    if (b === 0) {
      return [];
    }
    const single = -c / b;
    return inside(single) ? [single] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return [];
  }
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter(inside);
}

/**
 * The value of t on a cubic nearest a point. It scans the curve coarsely, then
 * narrows the best bracket. There is no closed form. It returns one number.
 */
function nearestFractionOnBezier(curve: CubicBezier, point: Point): number {
  const distanceAt = (t: number): number => {
    const on = bezierPointAt(curve, t);
    return Math.hypot(on.x - point.x, on.y - point.y);
  };
  let best = 0;
  let bestDistance = Infinity;
  for (let step = 0; step <= BEZIER_SCAN_STEPS; step += 1) {
    const t = step / BEZIER_SCAN_STEPS;
    const distance = distanceAt(t);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = t;
    }
  }
  let low = Math.max(0, best - 1 / BEZIER_SCAN_STEPS);
  let high = Math.min(1, best + 1 / BEZIER_SCAN_STEPS);
  for (let step = 0; step < BEZIER_NARROW_STEPS; step += 1) {
    const third = (high - low) / 3;
    const left = low + third;
    const right = high - third;
    if (distanceAt(left) <= distanceAt(right)) {
      high = right;
    } else {
      low = left;
    }
  }
  return (low + high) / 2;
}

/** The exact length of one edge. An arc gives radius times angle, not a sum of chords. */
export function edgeLength(edge: PathEdge): number {
  const curve = bezierOfEdge(edge);
  if (curve !== undefined) {
    return bezierLength(curve, 0);
  }
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
  const curve = bezierOfEdge(edge);
  if (curve !== undefined) {
    return curveDoubledSweptArea(curve) - curveDoubledSweptArea(chordAsCubic(edge.start, edge.end));
  }
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
  const curve = bezierOfEdge(edge);
  if (curve !== undefined) {
    const chord = chordAsCubic(edge.start, edge.end);
    const doubledArea = curveDoubledSweptArea(curve) - curveDoubledSweptArea(chord);
    if (doubledArea === 0) {
      return undefined;
    }
    return {
      point: {
        x: (curveMomentX(curve) - curveMomentX(chord)) / doubledArea,
        y: (curveMomentY(curve) - curveMomentY(chord)) / doubledArea,
      },
      doubledArea,
    };
  }
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
  const curve = bezierOfEdge(edge);
  if (curve !== undefined) {
    const points: Point[] = [edge.start, edge.end];
    for (const t of turningPoints(curve.p0.x, curve.p1.x, curve.p2.x, curve.p3.x)) {
      points.push(bezierPointAt(curve, t));
    }
    for (const t of turningPoints(curve.p0.y, curve.p1.y, curve.p2.y, curve.p3.y)) {
      points.push(bezierPointAt(curve, t));
    }
    return points;
  }
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
  const curve = bezierOfEdge(edge);
  if (curve !== undefined) {
    const on = bezierPointAt(curve, nearestFractionOnBezier(curve, point));
    return Math.hypot(on.x - point.x, on.y - point.y);
  }
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
export function buildPathEdges(
  vertices: readonly Point[],
  bulges: readonly number[],
  closed: boolean,
  handlesIn: readonly Point[] = [],
  handlesOut: readonly Point[] = [],
): readonly PathEdge[] {
  const edges: PathEdge[] = [];
  const edgeCount = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < edgeCount; index += 1) {
    const endIndex = (index + 1) % vertices.length;
    const start = vertices[index];
    const end = vertices[endIndex];
    if (start === undefined || end === undefined) {
      continue;
    }
    const bulge = bulges[index] ?? 0;
    const controls = controlsFromHandles(start, end, handlesOut[index], handlesIn[endIndex]);
    edges.push(controls === undefined ? { start, end, bulge } : { start, end, bulge, controls });
  }
  return edges;
}

/**
 * The two control points of one edge, or undefined when neither end pulls it.
 * A handle is an offset from its own vertex, so a vertex carries its handles
 * when it moves. Two zero handles leave the edge to its bulge.
 */
function controlsFromHandles(
  start: Point,
  end: Point,
  out: Point | undefined,
  into: Point | undefined,
): readonly [Point, Point] | undefined {
  const outX = out?.x ?? 0;
  const outY = out?.y ?? 0;
  const inX = into?.x ?? 0;
  const inY = into?.y ?? 0;
  if (outX === 0 && outY === 0 && inX === 0 && inY === 0) {
    return undefined;
  }
  return [{ x: start.x + outX, y: start.y + outY }, { x: end.x + inX, y: end.y + inY }];
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

/** Where a split lands on one edge, and every slot the split rewrites. */
export interface EdgeSplit {
  readonly point: Point;
  /** How far along the edge the split lands, from 0 at the start to 1 at the end. */
  readonly fraction: number;
  readonly firstBulge: number;
  readonly secondBulge: number;
  /** The four handles. Each one is zero when the edge is straight or an arc. */
  readonly startOutHandle: Point;
  readonly newInHandle: Point;
  readonly newOutHandle: Point;
  readonly endInHandle: Point;
}

const NO_HANDLES = {
  startOutHandle: { x: 0, y: 0 },
  newInHandle: { x: 0, y: 0 },
  newOutHandle: { x: 0, y: 0 },
  endInHandle: { x: 0, y: 0 },
};

/** How far along the arc an angle lands, clamped to the two ends of the sweep. */
function fractionAlongArc(arc: ArcGeometry, angle: number): number {
  let delta = (angle - arc.startAngle) % FULL_TURN;
  if (delta < 0) {
    delta += FULL_TURN;
  }
  if (arc.sweep === 0) {
    return 0;
  }
  const signed = arc.sweep > 0 ? delta : (delta === 0 ? 0 : delta - FULL_TURN);
  return Math.max(0, Math.min(1, signed / arc.sweep));
}

/**
 * Cuts one edge at the point on it nearest the given point. An arc becomes two
 * arcs on the same circle, so the two together hold the shape of the one they
 * replace. Nothing here subdivides an edge evenly. The caller picks the place.
 */
export function splitEdgeAt(edge: PathEdge, near: Point): EdgeSplit {
  const curve = bezierOfEdge(edge);
  if (curve !== undefined) {
    const fraction = nearestFractionOnBezier(curve, near);
    const halves = splitBezier(curve, fraction);
    const point = halves.first.p3;
    return {
      point,
      fraction,
      firstBulge: 0,
      secondBulge: 0,
      startOutHandle: { x: halves.first.p1.x - edge.start.x, y: halves.first.p1.y - edge.start.y },
      newInHandle: { x: halves.first.p2.x - point.x, y: halves.first.p2.y - point.y },
      newOutHandle: { x: halves.second.p1.x - point.x, y: halves.second.p1.y - point.y },
      endInHandle: { x: halves.second.p2.x - edge.end.x, y: halves.second.p2.y - edge.end.y },
    };
  }
  const arc = arcOfEdge(edge);
  if (arc === undefined) {
    const spanX = edge.end.x - edge.start.x;
    const spanY = edge.end.y - edge.start.y;
    const lengthSquared = spanX * spanX + spanY * spanY;
    const fraction = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((near.x - edge.start.x) * spanX + (near.y - edge.start.y) * spanY) / lengthSquared));
    return {
      point: { x: edge.start.x + fraction * spanX, y: edge.start.y + fraction * spanY },
      fraction,
      firstBulge: 0,
      secondBulge: 0,
      ...NO_HANDLES,
    };
  }
  const fraction = fractionAlongArc(arc, Math.atan2(near.y - arc.center.y, near.x - arc.center.x));
  const firstSweep = arc.sweep * fraction;
  const secondSweep = arc.sweep - firstSweep;
  const splitAngle = arc.startAngle + firstSweep;
  return {
    point: { x: arc.center.x + Math.cos(splitAngle) * arc.radius, y: arc.center.y + Math.sin(splitAngle) * arc.radius },
    fraction,
    firstBulge: Math.tan(firstSweep / 4),
    secondBulge: Math.tan(secondSweep / 4),
    ...NO_HANDLES,
  };
}

/** How many times bisection halves a bracket before it takes the middle. */
const ROOT_STEPS = 60;

/**
 * True when a closed path encloses the point, by the nonzero rule a canvas
 * fills with. It casts one ray along positive x and counts the edges that
 * cross it, each with the direction it crosses. An arc crosses where the ray
 * meets its circle. A cubic crosses at the roots of its own y, on each stretch
 * where that y only rises or only falls.
 *
 * An edge counts where the ray meets its start, and not where the ray meets
 * its end. So a vertex two edges share counts once.
 *
 * It answers for the edges it gets. An open list winds as though a straight
 * edge closed it, which is what ctx.fill does too. Whether an open path fills
 * at all is the decision of the caller.
 */
export function pathContains(point: Point, edges: readonly PathEdge[]): boolean {
  let winding = 0;
  for (const edge of edges) {
    winding += edgeCrossings(point, edge);
  }
  return winding !== 0;
}

function edgeCrossings(point: Point, edge: PathEdge): number {
  const curve = bezierOfEdge(edge);
  if (curve !== undefined) {
    return cubicCrossings(point, curve);
  }
  const arc = arcOfEdge(edge);
  if (arc === undefined) {
    return straightCrossings(point, edge);
  }
  return arcCrossings(point, arc);
}

function straightCrossings(point: Point, edge: PathEdge): number {
  const rise = edge.end.y - edge.start.y;
  if (rise === 0) {
    return 0;
  }
  const t = (point.y - edge.start.y) / rise;
  if (t < 0 || t >= 1) {
    return 0;
  }
  const x = edge.start.x + t * (edge.end.x - edge.start.x);
  return x > point.x ? Math.sign(rise) : 0;
}

function arcCrossings(point: Point, arc: ArcGeometry): number {
  const rise = point.y - arc.center.y;
  const half = arc.radius * arc.radius - rise * rise;
  if (half <= 0) {
    return 0;
  }
  const reach = Math.sqrt(half);
  let winding = 0;
  for (const x of [arc.center.x - reach, arc.center.x + reach]) {
    if (x <= point.x) {
      continue;
    }
    const angle = Math.atan2(rise, x - arc.center.x);
    let delta = (angle - arc.startAngle) % FULL_TURN;
    if (delta < 0) {
      delta += FULL_TURN;
    }
    const along = arc.sweep > 0 ? delta / arc.sweep : (delta === 0 ? 0 : (delta - FULL_TURN) / arc.sweep);
    if (along < 0 || along >= 1) {
      continue;
    }
    winding += Math.sign(Math.cos(angle) * arc.sweep);
  }
  return winding;
}

function cubicCrossings(point: Point, curve: CubicBezier): number {
  const heightAt = (t: number): number => bezierPointAt(curve, t).y - point.y;
  const edges = [0, ...turningPoints(curve.p0.y, curve.p1.y, curve.p2.y, curve.p3.y).slice().sort((a, b) => a - b), 1];
  let winding = 0;
  for (let piece = 0; piece + 1 < edges.length; piece += 1) {
    const low = edges[piece] ?? 0;
    const high = edges[piece + 1] ?? 1;
    const t = rootBetween(heightAt, low, high);
    if (t === undefined || t < 0 || t >= 1) {
      continue;
    }
    if (bezierPointAt(curve, t).x <= point.x) {
      continue;
    }
    winding += Math.sign(bezierSlopeAt(curve, t).y);
  }
  return winding;
}

/** The one root of a function that only rises or only falls between low and high. */
function rootBetween(heightAt: (t: number) => number, low: number, high: number): number | undefined {
  let start = low;
  let end = high;
  const atStart = heightAt(start);
  const atEnd = heightAt(end);
  if (atStart === 0) {
    return start;
  }
  if (atStart > 0 === atEnd > 0) {
    return undefined;
  }
  const startIsBelow = atStart < 0;
  for (let step = 0; step < ROOT_STEPS; step += 1) {
    const middle = (start + end) / 2;
    if (heightAt(middle) < 0 === startIsBelow) {
      start = middle;
    } else {
      end = middle;
    }
  }
  return (start + end) / 2;
}

/** The shortest distance from a point to any edge of a path. */
export function distanceToPath(point: Point, edges: readonly PathEdge[]): number {
  let shortest = Infinity;
  for (const edge of edges) {
    shortest = Math.min(shortest, distanceToEdge(point, edge));
  }
  return shortest;
}
