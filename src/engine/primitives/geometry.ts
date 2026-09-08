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
 * A circle gets a polygon approximation for bounds and hit tests. The renderer
 * still draws a true arc.
 */
import type { Address } from "../address.ts";
import { getSlot, isErrorValue, slotKey, type ErrorValue, type GraphObject, type Point, type Slot, type Value } from "../graph/node.ts";
import type { DerivedSlotCompute, DerivedSlotDependencies, DerivedSlotSchema } from "./schema.ts";

export const VERTEX_PATH_PREFIX = "vertex";

export const ORIGIN_X_PATH: readonly string[] = ["origin", "x"];
export const ORIGIN_Y_PATH: readonly string[] = ["origin", "y"];
export const RADIUS_PATH: readonly string[] = ["radius"];
export const POLYGON_SIDES_PATH: readonly string[] = ["sides"];
export const POLYGON_ROTATION_PATH: readonly string[] = ["rotation"];
export const RECT_WIDTH_PATH: readonly string[] = ["width"];
export const RECT_HEIGHT_PATH: readonly string[] = ["height"];

export const VERTICES_PATH: readonly string[] = ["vertices"];
export const CENTROID_X_PATH: readonly string[] = ["centroid", "x"];
export const CENTROID_Y_PATH: readonly string[] = ["centroid", "y"];
export const AREA_PATH: readonly string[] = ["area"];
export const LENGTH_PATH: readonly string[] = ["length"];
export const BOUNDS_MIN_X_PATH: readonly string[] = ["bounds", "minX"];
export const BOUNDS_MIN_Y_PATH: readonly string[] = ["bounds", "minY"];
export const BOUNDS_MAX_X_PATH: readonly string[] = ["bounds", "maxX"];
export const BOUNDS_MAX_Y_PATH: readonly string[] = ["bounds", "maxY"];

export const CIRCLE_VERTEX_COUNT = 32;

export const MIN_POLYGON_SIDES = 3;

export const MIN_POLYLINE_VERTICES = 2;

/** The literal slot path of one vertex coordinate, such as vertex.0.x. */
export function vertexXPath(index: number): readonly string[] {
  return [VERTEX_PATH_PREFIX, String(index), "x"];
}

export function vertexYPath(index: number): readonly string[] {
  return [VERTEX_PATH_PREFIX, String(index), "y"];
}

export function computePolygonVertices(sides: number, radius: number, origin: Point, rotation: number): readonly Point[] {
  const vertices: Point[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    vertices.push({ x: origin.x + radius * Math.cos(angle), y: origin.y + radius * Math.sin(angle) });
  }
  return vertices;
}

export function computeCircleVertices(radius: number, origin: Point): readonly Point[] {
  return computePolygonVertices(CIRCLE_VERTEX_COUNT, radius, origin, 0);
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

export const computeCircleVerticesSlot: DerivedSlotCompute = (object, read) => {
  const inputs = readNumericSlots(object, read, "circle.vertices", {
    originX: ORIGIN_X_PATH,
    originY: ORIGIN_Y_PATH,
    radius: RADIUS_PATH,
  });
  if (isNumericSlotReadError(inputs)) {
    return inputs;
  }
  if (inputs.radius < 0) {
    return { error: "#TYPE", message: "circle.vertices: radius must not be negative" };
  }
  const vertices = computeCircleVertices(inputs.radius, { x: inputs.originX, y: inputs.originY });
  return finalizeVertices(vertices, "circle.vertices");
};

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
    paths.push(vertexXPath(index));
    paths.push(vertexYPath(index));
  }
  return paths;
}

export const polylineVerticesDependencies: DerivedSlotDependencies = {
  kind: "dynamic",
  resolve: (object) => enumeratePolylineVertexSlotPaths(object).map((path) => ({ objectId: object.id, path })),
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
 * The derived slots of an open path: centroid, length and bounds. Not area,
 * because SPEC.md section 8 scopes area to a closed path, and a polyline has
 * no closed slot yet. The centroid is the plain vertex mean, not the area
 * weighted centroid verticesDerivedSlots uses, because that formula assumes a
 * closed shape.
 */
export function openPathDerivedSlots(label: string): readonly DerivedSlotSchema[] {
  const dependencies: DerivedSlotDependencies = { kind: "static", paths: [VERTICES_PATH] };
  return [
    { path: CENTROID_X_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.centroid.x`, (v) => computeVertexMean(v).x) },
    { path: CENTROID_Y_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.centroid.y`, (v) => computeVertexMean(v).y) },
    { path: LENGTH_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.length`, computeOpenPathLength) },
    { path: BOUNDS_MIN_X_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.minX`, (v) => computeBounds(v).minX) },
    { path: BOUNDS_MIN_Y_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.minY`, (v) => computeBounds(v).minY) },
    { path: BOUNDS_MAX_X_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.maxX`, (v) => computeBounds(v).maxX) },
    { path: BOUNDS_MAX_Y_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.maxY`, (v) => computeBounds(v).maxY) },
  ];
}

/** Appends one vertex at the end. No vertex slot moves, so no reference elsewhere needs a rewrite. */
export function addVertexToObject(object: GraphObject, point: Point): GraphObject {
  const count = object.vertexCount ?? 0;
  return {
    ...object,
    vertexCount: count + 1,
    slots: {
      ...object.slots,
      [slotKey(vertexXPath(count))]: { kind: "literal", value: point.x },
      [slotKey(vertexYPath(count))]: { kind: "literal", value: point.y },
    },
  };
}

/** Removes one vertex and renumbers every later one down by one, in storage. */
export function deleteVertexFromObject(object: GraphObject, index: number): GraphObject {
  const count = object.vertexCount ?? 0;
  const newSlots: Record<string, Slot> = { ...object.slots };
  for (let i = 0; i < count; i += 1) {
    delete newSlots[slotKey(vertexXPath(i))];
    delete newSlots[slotKey(vertexYPath(i))];
  }
  for (let i = 0; i < count; i += 1) {
    if (i === index) {
      continue;
    }
    const x = getSlot(object, vertexXPath(i));
    const y = getSlot(object, vertexYPath(i));
    const newIndex = i < index ? i : i - 1;
    if (x !== undefined) {
      newSlots[slotKey(vertexXPath(newIndex))] = x;
    }
    if (y !== undefined) {
      newSlots[slotKey(vertexYPath(newIndex))] = y;
    }
  }
  return { ...object, vertexCount: Math.max(0, count - 1), slots: newSlots };
}

interface VertexAddress {
  readonly index: number;
  readonly axis: "x" | "y";
}

function asVertexAddress(address: Address, objectId: string): VertexAddress | undefined {
  if (address.objectId !== objectId) {
    return undefined;
  }
  const path = address.path;
  if (path.length !== 3 || path[0] !== VERTEX_PATH_PREFIX) {
    return undefined;
  }
  const axis = path[2];
  if (axis !== "x" && axis !== "y") {
    return undefined;
  }
  const indexText = path[1];
  if (indexText === undefined || String(Number(indexText)) !== indexText) {
    return undefined;
  }
  const index = Number(indexText);
  return Number.isInteger(index) && index >= 0 ? { index, axis } : undefined;
}

function vertexAddressAt(objectId: string, index: number, axis: "x" | "y"): Address {
  return { objectId, path: axis === "x" ? vertexXPath(index) : vertexYPath(index) };
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
  return vertexAddressAt(objectId, found.index - 1, found.axis);
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
    return vertexAddressAt(objectId, found.index - 1, found.axis);
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
