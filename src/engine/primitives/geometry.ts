/**
 * geometry.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * Vertex math for the presets, plus centroid, area, length and bounds.
 *
 * A preset has one derived vertices slot, not a slot for each vertex. So a
 * change to sides changes a value and not the slot set, and Rule 4 holds.
 *
 * A circle has no vertices slot. Its area, length, centroid and bounds each
 * have a closed form. Explode turns it into two vertices and two bulges of 1,
 * which is the same circle exactly.
 */
import type { Address } from "../address.ts";
import {
  buildPathEdges,
  HALF_CIRCLE_BULGE,
  pathArea,
  pathBounds,
  pathCentroid,
  pathLength,
  splitEdgeAt,
  type EdgeSplit,
  type PathEdge,
} from "./edge.ts";
import { getSlot, isErrorValue, slotKey, type ErrorValue, type GraphObject, type ObjectType, type Point, type Slot, type Value } from "../graph/node.ts";
import type { DerivedSlotCompute, DerivedSlotDependencies, DerivedSlotSchema } from "./schema.ts";

export const VERTEX_PATH_PREFIX = "vertex";

/**
 * The seven slots of one vertex. Two coordinates, the bulge of the edge after
 * it, and one handle for each direction. delvertex and split must move all
 * seven together.
 */
export const VERTEX_PART_SUFFIXES: readonly (readonly string[])[] = [
  ["x"],
  ["y"],
  ["bulge"],
  ["handle", "in", "x"],
  ["handle", "in", "y"],
  ["handle", "out", "x"],
  ["handle", "out", "y"],
];

/** The bulge and handle slots. A change to one of these bends an edge and moves no point. */
const CURVE_PART_SUFFIXES: readonly (readonly string[])[] = VERTEX_PART_SUFFIXES.slice(2);

export const ORIGIN_X_PATH: readonly string[] = ["origin", "x"];
export const ORIGIN_Y_PATH: readonly string[] = ["origin", "y"];
export const RADIUS_PATH: readonly string[] = ["radius"];
export const POLYGON_SIDES_PATH: readonly string[] = ["sides"];
export const POLYGON_ROTATION_PATH: readonly string[] = ["rotation"];
export const RECT_WIDTH_PATH: readonly string[] = ["width"];
export const RECT_HEIGHT_PATH: readonly string[] = ["height"];
export const CLOSED_PATH: readonly string[] = ["closed"];

export const STYLE_STROKE_COLOR_PATH: readonly string[] = ["style", "strokeColor"];
export const STYLE_STROKE_WIDTH_PATH: readonly string[] = ["style", "strokeWidth"];
export const STYLE_FILL_COLOR_PATH: readonly string[] = ["style", "fillColor"];

/**
 * The three style slots every shape carries. A formula can drive each one, so
 * a table cell can colour a shape. They hold plain data here. The render layer
 * decides what a colour string means, because the engine knows no canvas.
 */
export const GEOMETRY_STYLE_PATHS: readonly (readonly string[])[] = [
  STYLE_STROKE_COLOR_PATH,
  STYLE_STROKE_WIDTH_PATH,
  STYLE_FILL_COLOR_PATH,
];

export const DEFAULT_STROKE_COLOR = "#1a1a1a";
export const DEFAULT_STROKE_WIDTH = 1;

/** A new shape draws its outline and fills nothing. Null is a fill an operator can see is off. */
export const GEOMETRY_STYLE_DEFAULTS: readonly { readonly path: readonly string[]; readonly value: string | number | null }[] = [
  { path: STYLE_STROKE_COLOR_PATH, value: DEFAULT_STROKE_COLOR },
  { path: STYLE_STROKE_WIDTH_PATH, value: DEFAULT_STROKE_WIDTH },
  { path: STYLE_FILL_COLOR_PATH, value: null },
];

export const VERTICES_PATH: readonly string[] = ["vertices"];
export const CENTROID_X_PATH: readonly string[] = ["centroid", "x"];
export const CENTROID_Y_PATH: readonly string[] = ["centroid", "y"];
export const AREA_PATH: readonly string[] = ["area"];
export const LENGTH_PATH: readonly string[] = ["length"];
export const BOUNDS_MIN_X_PATH: readonly string[] = ["bounds", "minX"];
export const BOUNDS_MIN_Y_PATH: readonly string[] = ["bounds", "minY"];
export const BOUNDS_MAX_X_PATH: readonly string[] = ["bounds", "maxX"];
export const BOUNDS_MAX_Y_PATH: readonly string[] = ["bounds", "maxY"];

export const MIN_POLYGON_SIDES = 3;

export const MIN_POLYLINE_VERTICES = 2;

/** The literal slot path of one vertex coordinate, such as vertex.0.x. */
export function vertexXPath(index: number): readonly string[] {
  return [VERTEX_PATH_PREFIX, String(index), "x"];
}

export function vertexYPath(index: number): readonly string[] {
  return [VERTEX_PATH_PREFIX, String(index), "y"];
}

/**
 * The curvature of the edge that leaves this vertex, as a DXF file states it.
 * A DXF vertex record carries the bulge of the edge after it, and so does this
 * one. So a path with N vertices carries N bulges, and the last one belongs to
 * the edge home to vertex 0. That edge draws only when closed is true, and the
 * slot exists at every value of closed, which keeps Rule 4 safe.
 */
export function vertexBulgePath(index: number): readonly string[] {
  return [VERTEX_PATH_PREFIX, String(index), "bulge"];
}

/**
 * The handle that pulls the edge which arrives at this vertex, as an offset
 * from it. The handle of the vertex before it pulls the same edge, from the
 * other end.
 */
export function vertexHandleInPaths(index: number): { readonly x: readonly string[]; readonly y: readonly string[] } {
  return { x: vertexPartPath(index, ["handle", "in", "x"]), y: vertexPartPath(index, ["handle", "in", "y"]) };
}

/** The handle that pulls the edge which leaves this vertex, as an offset from it. */
export function vertexHandleOutPaths(index: number): { readonly x: readonly string[]; readonly y: readonly string[] } {
  return { x: vertexPartPath(index, ["handle", "out", "x"]), y: vertexPartPath(index, ["handle", "out", "y"]) };
}

export function computePolygonVertices(sides: number, radius: number, origin: Point, rotation: number): readonly Point[] {
  const vertices: Point[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    vertices.push({ x: origin.x + radius * Math.cos(angle), y: origin.y + radius * Math.sin(angle) });
  }
  return vertices;
}

export function computeRectVertices(origin: Point, width: number, height: number): readonly Point[] {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + height },
    { x: origin.x, y: origin.y + height },
  ];
}

function edgePairs(vertices: readonly Point[]): ReadonlyArray<readonly [Point, Point]> {
  const pairs: Array<readonly [Point, Point]> = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (a === undefined || b === undefined) {
      continue;
    }
    pairs.push([a, b]);
  }
  return pairs;
}

function computeSignedAreaDoubled(vertices: readonly Point[]): number {
  let sum = 0;
  for (const [a, b] of edgePairs(vertices)) {
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

export function computeArea(vertices: readonly Point[]): number {
  return Math.abs(computeSignedAreaDoubled(vertices)) / 2;
}

export function computeCentroid(vertices: readonly Point[]): Point {
  const doubledArea = computeSignedAreaDoubled(vertices);
  if (doubledArea === 0) {
    return computeVertexMean(vertices);
  }
  let weightedX = 0;
  let weightedY = 0;
  for (const [a, b] of edgePairs(vertices)) {
    const cross = a.x * b.y - b.x * a.y;
    weightedX += (a.x + b.x) * cross;
    weightedY += (a.y + b.y) * cross;
  }
  const sixSignedArea = 3 * doubledArea;
  return { x: weightedX / sixSignedArea, y: weightedY / sixSignedArea };
}

export function computeVertexMean(vertices: readonly Point[]): Point {
  if (vertices.length === 0) {
    return { x: 0, y: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  for (const vertex of vertices) {
    sumX += vertex.x;
    sumY += vertex.y;
  }
  return { x: sumX / vertices.length, y: sumY / vertices.length };
}

export function computePerimeterLength(vertices: readonly Point[]): number {
  let total = 0;
  for (const [a, b] of edgePairs(vertices)) {
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** The length of an open path. It sums each segment once and never closes the last gap. */
export function computeOpenPathLength(vertices: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i + 1 < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[i + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export function computeBounds(vertices: readonly Point[]): { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } {
  const first = vertices[0];
  if (first === undefined) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const vertex of vertices) {
    if (vertex.x < minX) {
      minX = vertex.x;
    }
    if (vertex.x > maxX) {
      maxX = vertex.x;
    }
    if (vertex.y < minY) {
      minY = vertex.y;
    }
    if (vertex.y > maxY) {
      maxY = vertex.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function finiteOrTypeError(value: number, label: string): Value {
  if (!Number.isFinite(value)) {
    return { error: "#TYPE", message: `${label} produced a non-finite number (${value})` };
  }
  return Object.is(value, -0) ? 0 : value;
}

function finalizeVertices(vertices: readonly Point[], label: string): readonly Point[] | ErrorValue {
  const finalized: Point[] = [];
  for (const vertex of vertices) {
    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
      return { error: "#TYPE", message: `${label} produced a non-finite vertex (${vertex.x}, ${vertex.y})` };
    }
    finalized.push(vertex);
  }
  return finalized;
}

function isNumericSlotReadError<K extends string>(result: Readonly<Record<K, number>> | ErrorValue): result is ErrorValue {
  return "error" in result;
}

function readNumericSlots<K extends string>(
  object: GraphObject,
  read: (address: Address) => Value | undefined,
  label: string,
  specs: Readonly<Record<K, readonly string[]>>,
): Readonly<Record<K, number>> | ErrorValue {
  const result = {} as Record<K, number>;
  for (const name of Object.keys(specs) as K[]) {
    const path = specs[name];
    const value = read({ objectId: object.id, path });
    if (value === undefined) {
      return { error: "#REF", message: `${label}: ${name} did not resolve to a value` };
    }
    if (isErrorValue(value)) {
      return value;
    }
    if (typeof value !== "number") {
      return { error: "#TYPE", message: `${label}: ${name} must be a number` };
    }
    result[name] = value;
  }
  return result;
}


export const computePolygonVerticesSlot: DerivedSlotCompute = (object, read) => {
  const inputs = readNumericSlots(object, read, "polygon.vertices", {
    sides: POLYGON_SIDES_PATH,
    radius: RADIUS_PATH,
    originX: ORIGIN_X_PATH,
    originY: ORIGIN_Y_PATH,
    rotation: POLYGON_ROTATION_PATH,
  });
  if (isNumericSlotReadError(inputs)) {
    return inputs;
  }
  if (!Number.isInteger(inputs.sides) || inputs.sides < MIN_POLYGON_SIDES) {
    return { error: "#TYPE", message: `polygon.vertices: sides must be an integer >= ${MIN_POLYGON_SIDES}` };
  }
  if (inputs.radius < 0) {
    return { error: "#TYPE", message: "polygon.vertices: radius must not be negative" };
  }
  const vertices = computePolygonVertices(inputs.sides, inputs.radius, { x: inputs.originX, y: inputs.originY }, inputs.rotation);
  return finalizeVertices(vertices, "polygon.vertices");
};

export const computeRectVerticesSlot: DerivedSlotCompute = (object, read) => {
  const inputs = readNumericSlots(object, read, "rect.vertices", {
    originX: ORIGIN_X_PATH,
    originY: ORIGIN_Y_PATH,
    width: RECT_WIDTH_PATH,
    height: RECT_HEIGHT_PATH,
  });
  if (isNumericSlotReadError(inputs)) {
    return inputs;
  }
  if (inputs.width < 0 || inputs.height < 0) {
    return { error: "#TYPE", message: "rect.vertices: width and height must not be negative" };
  }
  const vertices = computeRectVertices({ x: inputs.originX, y: inputs.originY }, inputs.width, inputs.height);
  return finalizeVertices(vertices, "rect.vertices");
};

/**
 * The vertex.N.x and vertex.N.y paths a polyline declares now. The count comes
 * from vertexCount, a field on the object itself and not a slot, because the
 * count changes only through addvertex or delvertex.
 */
export function enumeratePolylineVertexSlotPaths(object: GraphObject): readonly (readonly string[])[] {
  const count = object.vertexCount ?? 0;
  const paths: (readonly string[])[] = [];
  for (let index = 0; index < count; index += 1) {
    for (const suffix of VERTEX_PART_SUFFIXES) {
      paths.push(vertexPartPath(index, suffix));
    }
  }
  return paths;
}

/**
 * The bulge and handle slots this object carries now. A path built before one
 * of them existed carries none, and reads as 0 there.
 */
function existingCurvePaths(object: GraphObject): readonly (readonly string[])[] {
  const count = object.vertexCount ?? 0;
  const paths: (readonly string[])[] = [];
  for (let index = 0; index < count; index += 1) {
    for (const suffix of CURVE_PART_SUFFIXES) {
      const path = vertexPartPath(index, suffix);
      if (getSlot(object, path) !== undefined) {
        paths.push(path);
      }
    }
  }
  return paths;
}

/**
 * The two coordinate slots of every vertex, and no bulge. The vertices slot
 * holds the points an operator placed, so a change to the curvature of an
 * edge leaves it alone.
 */
export function enumeratePolylineCoordinateSlotPaths(object: GraphObject): readonly (readonly string[])[] {
  const count = object.vertexCount ?? 0;
  const paths: (readonly string[])[] = [];
  for (let index = 0; index < count; index += 1) {
    paths.push(vertexXPath(index));
    paths.push(vertexYPath(index));
  }
  return paths;
}

export const polylineVerticesDependencies: DerivedSlotDependencies = {
  kind: "dynamic",
  resolve: (object) => enumeratePolylineCoordinateSlotPaths(object).map((path) => ({ objectId: object.id, path })),
};

/** Gathers a polyline's per vertex slots into the one Point[] every consumer reads. */
export const computePolylineVerticesSlot: DerivedSlotCompute = (object, read) => {
  const count = object.vertexCount ?? 0;
  if (count < MIN_POLYLINE_VERTICES) {
    return { error: "#TYPE", message: `polyline.vertices: a polyline needs at least ${MIN_POLYLINE_VERTICES} vertices` };
  }
  const vertices: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = read({ objectId: object.id, path: vertexXPath(index) });
    const y = read({ objectId: object.id, path: vertexYPath(index) });
    if (x === undefined || y === undefined) {
      return { error: "#REF", message: `polyline.vertices: vertex ${index} did not resolve to a value` };
    }
    if (isErrorValue(x)) {
      return x;
    }
    if (isErrorValue(y)) {
      return y;
    }
    if (typeof x !== "number" || typeof y !== "number") {
      return { error: "#TYPE", message: `polyline.vertices: vertex ${index} must be a pair of numbers` };
    }
    vertices.push({ x, y });
  }
  return finalizeVertices(vertices, "polyline.vertices");
};

/**
 * True when the object carries a closed slot. A path built before the closed
 * slot existed carries none. The dependency list and readClosedFlag must ask
 * this one question. Two answers that drift produce a #REF at every derived
 * slot of the path.
 */
function hasClosedSlot(object: GraphObject): boolean {
  return getSlot(object, CLOSED_PATH) !== undefined;
}

/** The vertices slot, and the closed slot when the object carries one. */
export const pathDependencies: DerivedSlotDependencies = {
  kind: "dynamic",
  resolve: (object) => {
    const addresses: Address[] = [{ objectId: object.id, path: VERTICES_PATH }];
    if (hasClosedSlot(object)) {
      addresses.push({ objectId: object.id, path: CLOSED_PATH });
    }
    for (const path of existingCurvePaths(object)) {
      addresses.push({ objectId: object.id, path });
    }
    return addresses;
  },
};

/** A path as its slots describe it now: the placed points, the edges and the closed flag. */
export interface PathShape {
  readonly vertices: readonly Point[];
  readonly edges: readonly PathEdge[];
  readonly closed: boolean;
}

/** One measurement of a path. It returns a number, or the reason it cannot. */
export type PathMeasure = (shape: PathShape) => number | ErrorValue;

/**
 * True when the path closes back to its first vertex. An absent slot reads as
 * an open path, so a document written before the closed slot still loads.
 */
export function readClosedFlag(
  object: GraphObject,
  read: (address: Address) => Value | undefined,
  label: string,
): boolean | ErrorValue {
  if (!hasClosedSlot(object)) {
    return false;
  }
  const value = read({ objectId: object.id, path: CLOSED_PATH });
  if (value === undefined || value === null) {
    return false;
  }
  if (isErrorValue(value)) {
    return value;
  }
  if (typeof value !== "boolean") {
    return { error: "#TYPE", message: `${label}: closed must be true or false` };
  }
  return value;
}

/**
 * The bulge of every vertex, in order. An absent slot reads as 0, a straight
 * edge, so a path built before bulges existed still measures. This test for an
 * absent slot must match the one existingBulgePaths uses.
 */
interface CurveParts {
  readonly bulges: readonly number[];
  readonly handlesIn: readonly Point[];
  readonly handlesOut: readonly Point[];
}

type CurveReading =
  | { readonly ok: true; readonly parts: CurveParts }
  | { readonly ok: false; readonly error: ErrorValue };

/**
 * The bulge and the two handles of every vertex, in order. An absent slot
 * reads as 0, which leaves the edge straight. So a path built before one of
 * these slots existed still measures. This test for an absent slot must match
 * the one existingCurvePaths uses.
 */
function readCurveParts(
  object: GraphObject,
  read: (address: Address) => Value | undefined,
  count: number,
  label: string,
): CurveReading {
  const bulges: number[] = [];
  const handlesIn: Point[] = [];
  const handlesOut: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const readAt = (path: readonly string[], what: string): number | ErrorValue => {
      if (getSlot(object, path) === undefined) {
        return 0;
      }
      const value = read({ objectId: object.id, path });
      if (value === undefined || value === null) {
        return 0;
      }
      if (isErrorValue(value)) {
        return value;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { error: "#TYPE", message: `${label}: ${what} of vertex ${index} must be a number` };
      }
      return value;
    };
    const handleIn = vertexHandleInPaths(index);
    const handleOut = vertexHandleOutPaths(index);
    const numbers = [
      readAt(vertexBulgePath(index), "the bulge"),
      readAt(handleIn.x, "the incoming handle"),
      readAt(handleIn.y, "the incoming handle"),
      readAt(handleOut.x, "the outgoing handle"),
      readAt(handleOut.y, "the outgoing handle"),
    ];
    for (const number of numbers) {
      if (isErrorValue(number)) {
        return { ok: false, error: number };
      }
    }
    const [bulge, inX, inY, outX, outY] = numbers as readonly number[];
    bulges.push(bulge ?? 0);
    handlesIn.push({ x: inX ?? 0, y: inY ?? 0 });
    handlesOut.push({ x: outX ?? 0, y: outY ?? 0 });
  }
  return { ok: true, parts: { bulges, handlesIn, handlesOut } };
}

function derivePathNumber(label: string, measure: PathMeasure): DerivedSlotCompute {
  return (object, read) => {
    const closed = readClosedFlag(object, read, label);
    if (isErrorValue(closed)) {
      return closed;
    }
    const vertices = readVertices(object, read, label);
    if (isErrorValue(vertices)) {
      return vertices;
    }
    const parts = readCurveParts(object, read, vertices.length, label);
    if (!parts.ok) {
      return parts.error;
    }
    const edges = buildPathEdges(vertices, parts.parts.bulges, closed, parts.parts.handlesIn, parts.parts.handlesOut);
    const measured = measure({ vertices, edges, closed });
    return isErrorValue(measured) ? measured : finiteOrTypeError(measured, label);
  };
}

/**
 * The derived slots of a circle, each one exact. A circle needs no vertices
 * slot now that an arc exists. Two vertices and two bulges of 1 hold a circle
 * exactly, and explode makes that path.
 */
export function circleDerivedSlots(label: string): readonly DerivedSlotSchema[] {
  const dependencies: DerivedSlotDependencies = { kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, RADIUS_PATH] };
  return [
    { path: CENTROID_X_PATH, dependencies, compute: deriveCircleNumber(`${label}.centroid.x`, (origin) => origin.x) },
    { path: CENTROID_Y_PATH, dependencies, compute: deriveCircleNumber(`${label}.centroid.y`, (origin) => origin.y) },
    { path: AREA_PATH, dependencies, compute: deriveCircleNumber(`${label}.area`, (_origin, radius) => Math.PI * radius * radius) },
    { path: LENGTH_PATH, dependencies, compute: deriveCircleNumber(`${label}.length`, (_origin, radius) => 2 * Math.PI * radius) },
    { path: BOUNDS_MIN_X_PATH, dependencies, compute: deriveCircleNumber(`${label}.bounds.minX`, (origin, radius) => origin.x - radius) },
    { path: BOUNDS_MIN_Y_PATH, dependencies, compute: deriveCircleNumber(`${label}.bounds.minY`, (origin, radius) => origin.y - radius) },
    { path: BOUNDS_MAX_X_PATH, dependencies, compute: deriveCircleNumber(`${label}.bounds.maxX`, (origin, radius) => origin.x + radius) },
    { path: BOUNDS_MAX_Y_PATH, dependencies, compute: deriveCircleNumber(`${label}.bounds.maxY`, (origin, radius) => origin.y + radius) },
  ];
}

function deriveCircleNumber(label: string, measure: (origin: Point, radius: number) => number): DerivedSlotCompute {
  return (object, read) => {
    const inputs = readNumericSlots(object, read, label, {
      originX: ORIGIN_X_PATH,
      originY: ORIGIN_Y_PATH,
      radius: RADIUS_PATH,
    });
    if (isNumericSlotReadError(inputs)) {
      return inputs;
    }
    if (inputs.radius < 0) {
      return { error: "#TYPE", message: `${label}: radius must not be negative` };
    }
    return finiteOrTypeError(measure({ x: inputs.originX, y: inputs.originY }, inputs.radius), label);
  };
}

/**
 * The derived slots of a path. The closed slot picks the math for each one. A
 * closed path gets the shoelace area, the area weighted centroid and the full
 * perimeter. An open path gets the plain vertex mean, the length of the
 * segments it has, and an error at area. Both sets sit at the same paths. So a
 * write to closed changes values, and never the slot set.
 */
export function pathDerivedSlots(label: string): readonly DerivedSlotSchema[] {
  const dependencies = pathDependencies;
  const noArea: PathMeasure = () => ({ error: "#TYPE", message: `${label}.area: an open path has no area. Set closed to true first` });
  return [
    { path: CENTROID_X_PATH, dependencies, compute: derivePathNumber(`${label}.centroid.x`, (s) => (s.closed ? pathCentroid(s.edges).x : computeVertexMean(s.vertices).x)) },
    { path: CENTROID_Y_PATH, dependencies, compute: derivePathNumber(`${label}.centroid.y`, (s) => (s.closed ? pathCentroid(s.edges).y : computeVertexMean(s.vertices).y)) },
    { path: AREA_PATH, dependencies, compute: derivePathNumber(`${label}.area`, (s) => (s.closed ? pathArea(s.edges) : noArea(s))) },
    { path: LENGTH_PATH, dependencies, compute: derivePathNumber(`${label}.length`, (s) => pathLength(s.edges)) },
    { path: BOUNDS_MIN_X_PATH, dependencies, compute: derivePathNumber(`${label}.bounds.minX`, (s) => pathBounds(s.edges).minX) },
    { path: BOUNDS_MIN_Y_PATH, dependencies, compute: derivePathNumber(`${label}.bounds.minY`, (s) => pathBounds(s.edges).minY) },
    { path: BOUNDS_MAX_X_PATH, dependencies, compute: derivePathNumber(`${label}.bounds.maxX`, (s) => pathBounds(s.edges).maxX) },
    { path: BOUNDS_MAX_Y_PATH, dependencies, compute: derivePathNumber(`${label}.bounds.maxY`, (s) => pathBounds(s.edges).maxY) },
  ];
}

/**
 * The edges of a path, read straight off its slots. The render layer builds a
 * canvas path and a hit test from these. It never reads a sample point,
 * because none exists.
 */
export function pathEdgesOfObject(object: GraphObject): readonly PathEdge[] {
  const value = getSlot(object, VERTICES_PATH)?.value;
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  const vertices = value as readonly Point[];
  const number = (path: readonly string[]): number => {
    const held = getSlot(object, path)?.value;
    return typeof held === "number" && Number.isFinite(held) ? held : 0;
  };
  const bulges: number[] = [];
  const handlesIn: Point[] = [];
  const handlesOut: Point[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const handleIn = vertexHandleInPaths(index);
    const handleOut = vertexHandleOutPaths(index);
    bulges.push(number(vertexBulgePath(index)));
    handlesIn.push({ x: number(handleIn.x), y: number(handleIn.y) });
    handlesOut.push({ x: number(handleOut.x), y: number(handleOut.y) });
  }
  return buildPathEdges(vertices, bulges, getSlot(object, CLOSED_PATH)?.value === true, handlesIn, handlesOut);
}

/**
 * Appends one vertex at the end. No vertex slot moves, so no reference
 * elsewhere needs a rewrite. The new vertex gets a straight edge. No bulge
 * already on the path moves. So a curve an operator drew keeps its shape, and
 * only the edge home to vertex 0 becomes straight.
 */
export function addVertexToObject(object: GraphObject, point: Point): GraphObject {
  const count = object.vertexCount ?? 0;
  return {
    ...object,
    vertexCount: count + 1,
    slots: {
      ...object.slots,
      ...straightVertexSlots(count, point),
    },
  };
}

/** One vertex with a straight edge after it and no handles. Every part written, none left absent. */
function straightVertexSlots(index: number, point: Point): Record<string, Slot> {
  const handleIn = vertexHandleInPaths(index);
  const handleOut = vertexHandleOutPaths(index);
  return {
    [slotKey(vertexXPath(index))]: { kind: "literal", value: point.x },
    [slotKey(vertexYPath(index))]: { kind: "literal", value: point.y },
    [slotKey(vertexBulgePath(index))]: { kind: "literal", value: 0 },
    [slotKey(handleIn.x)]: { kind: "literal", value: 0 },
    [slotKey(handleIn.y)]: { kind: "literal", value: 0 },
    [slotKey(handleOut.x)]: { kind: "literal", value: 0 },
    [slotKey(handleOut.y)]: { kind: "literal", value: 0 },
  };
}

/**
 * The number of edges this path has now. A closed path has one for each
 * vertex. An open path has one fewer, because it never walks home to vertex 0.
 */
export function polylineEdgeCount(object: GraphObject): number {
  const count = object.vertexCount ?? 0;
  if (getSlot(object, CLOSED_PATH)?.value === true) {
    return count;
  }
  return Math.max(0, count - 1);
}

/**
 * Cuts edge index at the point on it nearest the given point, and puts a new
 * vertex there. An arc becomes two arcs of the same circle, so the shape on
 * screen does not move. It returns undefined when the edge does not exist.
 */
export function splitPolylineEdge(object: GraphObject, index: number, near: Point): EdgeSplit | undefined {
  const edge = pathEdgesOfObject(object)[index];
  return edge === undefined ? undefined : splitEdgeAt(edge, near);
}

/**
 * Puts one vertex at insertIndex and moves every vertex at or after it up one.
 * The vertex before the new one takes bulgeBefore, and the new one takes
 * bulgeAfter. An insert drops no vertex, so a reference only ever needs a shift.
 */
export function insertVertexIntoObject(object: GraphObject, edgeIndex: number, split: EdgeSplit): GraphObject {
  const insertIndex = edgeIndex + 1;
  const count = object.vertexCount ?? 0;
  const newSlots: Record<string, Slot> = { ...object.slots };
  for (let i = 0; i < count; i += 1) {
    for (const path of vertexPartPaths(i)) {
      delete newSlots[slotKey(path)];
    }
  }
  for (let i = 0; i < count; i += 1) {
    const newIndex = i < insertIndex ? i : i + 1;
    for (const suffix of VERTEX_PART_SUFFIXES) {
      const slot = getSlot(object, vertexPartPath(i, suffix));
      if (slot !== undefined) {
        newSlots[slotKey(vertexPartPath(newIndex, suffix))] = slot;
      }
    }
  }
  const endIndex = (edgeIndex + 1) % count;
  const shiftedEnd = endIndex >= insertIndex ? endIndex + 1 : endIndex;
  const literal = (path: readonly string[], value: number): void => {
    newSlots[slotKey(path)] = { kind: "literal", value };
  };
  literal(vertexBulgePath(edgeIndex), split.firstBulge);
  literal(vertexHandleOutPaths(edgeIndex).x, split.startOutHandle.x);
  literal(vertexHandleOutPaths(edgeIndex).y, split.startOutHandle.y);
  literal(vertexXPath(insertIndex), split.point.x);
  literal(vertexYPath(insertIndex), split.point.y);
  literal(vertexBulgePath(insertIndex), split.secondBulge);
  literal(vertexHandleInPaths(insertIndex).x, split.newInHandle.x);
  literal(vertexHandleInPaths(insertIndex).y, split.newInHandle.y);
  literal(vertexHandleOutPaths(insertIndex).x, split.newOutHandle.x);
  literal(vertexHandleOutPaths(insertIndex).y, split.newOutHandle.y);
  literal(vertexHandleInPaths(shiftedEnd).x, split.endInHandle.x);
  literal(vertexHandleInPaths(shiftedEnd).y, split.endInHandle.y);
  return { ...object, vertexCount: count + 1, slots: newSlots };
}

/**
 * Moves a reference to the new vertex, or to any vertex after it, up one
 * index. An insert loses no vertex, so this never breaks a reference. There is
 * no force path, unlike a delete.
 */
export function shiftVertexAddressForInsert(address: Address, objectId: string, insertedIndex: number): Address {
  const found = asVertexAddress(address, objectId);
  if (found === undefined || found.index < insertedIndex) {
    return address;
  }
  return vertexAddressAt(objectId, found.index + 1, found.suffix);
}

/** Removes one vertex and renumbers every later one down by one, in storage. */
export function deleteVertexFromObject(object: GraphObject, index: number): GraphObject {
  const count = object.vertexCount ?? 0;
  const newSlots: Record<string, Slot> = { ...object.slots };
  for (let i = 0; i < count; i += 1) {
    for (const path of vertexPartPaths(i)) {
      delete newSlots[slotKey(path)];
    }
  }
  for (let i = 0; i < count; i += 1) {
    if (i === index) {
      continue;
    }
    const newIndex = i < index ? i : i - 1;
    for (const suffix of VERTEX_PART_SUFFIXES) {
      const slot = getSlot(object, vertexPartPath(i, suffix));
      if (slot !== undefined) {
        newSlots[slotKey(vertexPartPath(newIndex, suffix))] = slot;
      }
    }
  }
  return { ...object, vertexCount: Math.max(0, count - 1), slots: newSlots };
}

interface VertexAddress {
  readonly index: number;
  readonly suffix: readonly string[];
}

function asVertexAddress(address: Address, objectId: string): VertexAddress | undefined {
  if (address.objectId !== objectId) {
    return undefined;
  }
  const path = address.path;
  if (path.length < 3 || path[0] !== VERTEX_PATH_PREFIX) {
    return undefined;
  }
  const rest = path.slice(2);
  const suffix = VERTEX_PART_SUFFIXES.find(
    (candidate) => candidate.length === rest.length && candidate.every((segment, at) => segment === rest[at]),
  );
  if (suffix === undefined) {
    return undefined;
  }
  const indexText = path[1];
  if (indexText === undefined || String(Number(indexText)) !== indexText) {
    return undefined;
  }
  const index = Number(indexText);
  return Number.isInteger(index) && index >= 0 ? { index, suffix } : undefined;
}

function vertexAddressAt(objectId: string, index: number, suffix: readonly string[]): Address {
  return { objectId, path: vertexPartPath(index, suffix) };
}

/** The slot path of one part of one vertex, such as its y or one of its handles. */
export function vertexPartPath(index: number, suffix: readonly string[]): readonly string[] {
  return [VERTEX_PATH_PREFIX, String(index), ...suffix];
}

/** Every slot path of one vertex. delvertex must move or break all three together. */
export function vertexPartPaths(index: number): readonly (readonly string[])[] {
  return VERTEX_PART_SUFFIXES.map((suffix) => vertexPartPath(index, suffix));
}

/**
 * Shifts a reference to a vertex after the deleted one down by one index. A
 * reference to the deleted vertex itself, or to an earlier one, passes
 * through unchanged. The refusal for a live reference to the exact vertex
 * marked for removal happens earlier, in mutation.ts, before this function
 * ever runs. A call that reaches this function only shifts the survivors.
 */
export function shiftVertexAddressForDelete(address: Address, objectId: string, deletedIndex: number): Address {
  const found = asVertexAddress(address, objectId);
  if (found === undefined || found.index <= deletedIndex) {
    return address;
  }
  return vertexAddressAt(objectId, found.index - 1, found.suffix);
}

/**
 * The force path. It shifts every vertex after the deleted one, the same as
 * shiftVertexAddressForDelete. It also marks a reference to the deleted
 * vertex itself "deleted", so the caller rewrites it to #REF.
 */
export function repairVertexAddressForDelete(address: Address, objectId: string, deletedIndex: number): Address | "deleted" {
  const found = asVertexAddress(address, objectId);
  if (found === undefined) {
    return address;
  }
  if (found.index === deletedIndex) {
    return "deleted";
  }
  if (found.index > deletedIndex) {
    return vertexAddressAt(objectId, found.index - 1, found.suffix);
  }
  return address;
}

/** A vertex address never spans a range. The formula language has no range syntax for one. */
export function passThroughVertexRangeForDelete(
  start: Address,
  end: Address,
): { readonly start: Address; readonly end: Address } {
  return { start, end };
}

function readVertices(object: GraphObject, read: (address: Address) => Value | undefined, label: string): readonly Point[] | ErrorValue {
  const value = read({ objectId: object.id, path: VERTICES_PATH });
  if (value === undefined) {
    return { error: "#REF", message: `${label}: vertices did not resolve to a value` };
  }
  if (isErrorValue(value)) {
    return value;
  }
  if (!Array.isArray(value)) {
    return { error: "#TYPE", message: `${label}: vertices must be a list of points` };
  }
  const vertices = value as readonly Point[];
  if (vertices.length === 0) {
    return { error: "#TYPE", message: `${label}: vertices is empty` };
  }
  return vertices;
}

function deriveNumberFromVertices(label: string, compute: (vertices: readonly Point[]) => number): DerivedSlotCompute {
  return (object, read) => {
    const vertices = readVertices(object, read, label);
    if (isErrorValue(vertices)) {
      return vertices;
    }
    return finiteOrTypeError(compute(vertices), label);
  };
}

export function verticesDerivedSlots(label: string): readonly DerivedSlotSchema[] {
  const dependencies: DerivedSlotDependencies = { kind: "static", paths: [VERTICES_PATH] };
  return [
    { path: CENTROID_X_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.centroid.x`, (v) => computeCentroid(v).x) },
    { path: CENTROID_Y_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.centroid.y`, (v) => computeCentroid(v).y) },
    { path: AREA_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.area`, computeArea) },
    { path: LENGTH_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.length`, computePerimeterLength) },
    { path: BOUNDS_MIN_X_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.minX`, (v) => computeBounds(v).minX) },
    { path: BOUNDS_MIN_Y_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.minY`, (v) => computeBounds(v).minY) },
    { path: BOUNDS_MAX_X_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.maxX`, (v) => computeBounds(v).maxX) },
    { path: BOUNDS_MAX_Y_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.maxY`, (v) => computeBounds(v).maxY) },
  ];
}

/** The preset types explode accepts. A polyline is already an editable path. */
export const EXPLODABLE_TYPES: ReadonlySet<ObjectType> = new Set(["circle", "polygon", "rect"]);

export type ExplodeResult = { readonly ok: true; readonly object: GraphObject } | { readonly ok: false; readonly message: string };

const POLYLINE_DERIVED_PATHS: readonly (readonly string[])[] = [
  VERTICES_PATH,
  CENTROID_X_PATH,
  CENTROID_Y_PATH,
  AREA_PATH,
  LENGTH_PATH,
  BOUNDS_MIN_X_PATH,
  BOUNDS_MIN_Y_PATH,
  BOUNDS_MAX_X_PATH,
  BOUNDS_MAX_Y_PATH,
];

/**
 * Snapshots a preset's current vertices into a fresh polyline object, same id
 * and name. The parameter slots (origin, radius, sides, and so on) are gone.
 * The new path closes, because every preset it accepts is a closed shape. So
 * vertices, centroid, area, length and bounds all survive at the same paths,
 * and so does the style. A formula that reads one of them needs no repair.
 */
export function explodeObjectToPolyline(object: GraphObject, label: string): ExplodeResult {
  if (object.type === "circle") {
    return explodeCircleToPolyline(object, label);
  }
  const value = getSlot(object, VERTICES_PATH)?.value;
  if (value === undefined) {
    return { ok: false, message: `${label}: vertices did not resolve to a value, so there is nothing to snapshot` };
  }
  if (isErrorValue(value)) {
    return { ok: false, message: `${label}: vertices holds an error (${value.error}: ${value.message}), so there is nothing to snapshot` };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: `${label}: vertices is not a point list, so there is nothing to snapshot` };
  }
  const vertices = value as readonly Point[];
  return { ok: true, object: buildExplodedPolyline(object, vertices, vertices.map(() => 0)) };
}

/**
 * A circle explodes into two vertices across its diameter, joined by two half
 * circles. That path is the same circle, to the last decimal. There is no
 * point list to snapshot, because a circle carries none.
 */
function explodeCircleToPolyline(object: GraphObject, label: string): ExplodeResult {
  const originX = getSlot(object, ORIGIN_X_PATH)?.value;
  const originY = getSlot(object, ORIGIN_Y_PATH)?.value;
  const radius = getSlot(object, RADIUS_PATH)?.value;
  if (typeof originX !== "number" || typeof originY !== "number" || typeof radius !== "number") {
    return { ok: false, message: `${label}: origin and radius must each hold a number, so there is nothing to explode` };
  }
  if (!(radius > 0)) {
    return { ok: false, message: `${label}: the radius must be more than 0, so there is nothing to explode` };
  }
  const vertices: readonly Point[] = [
    { x: originX - radius, y: originY },
    { x: originX + radius, y: originY },
  ];
  return { ok: true, object: buildExplodedPolyline(object, vertices, [HALF_CIRCLE_BULGE, HALF_CIRCLE_BULGE]) };
}

function buildExplodedPolyline(object: GraphObject, vertices: readonly Point[], bulges: readonly number[]): GraphObject {
  const slots: Record<string, Slot> = {};
  vertices.forEach((vertex, index) => {
    Object.assign(slots, straightVertexSlots(index, vertex));
    slots[slotKey(vertexBulgePath(index))] = { kind: "literal", value: bulges[index] ?? 0 };
  });
  slots[slotKey(CLOSED_PATH)] = { kind: "literal", value: true };
  // A polyline declares the style slots at the same paths a preset does, so
  // they cross an explode untouched. An operator keeps the colour they chose,
  // and a formula that drives one needs no repair.
  for (const path of GEOMETRY_STYLE_PATHS) {
    const slot = getSlot(object, path);
    if (slot !== undefined) {
      slots[slotKey(path)] = slot;
    }
  }
  for (const path of POLYLINE_DERIVED_PATHS) {
    slots[slotKey(path)] = { kind: "derived", value: null };
  }
  return { id: object.id, name: object.name, type: "polyline", vertexCount: vertices.length, slots };
}
