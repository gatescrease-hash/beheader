/**
 * hittest.ts
 *
 * Turns a screen point into the topmost object under it, or into nothing.
 *
 * What a shape answers to depends on whether it paints its inside. A filled
 * shape answers a click anywhere within it, by the same nonzero winding
 * rule a canvas fills with, so the answer agrees with what the operator can
 * see. A shape with no fill is a hollow outline and answers only within a
 * few pixels of its edge. Text, a table, an image and a script node are
 * boxes.
 *
 * A circle is tested against its true ring, from the origin and the radius,
 * and a polyline against its real edges. So a click near an arc measures to
 * the circle rather than to the chord across it. The closed slot of a
 * polyline decides whether the gap between its last vertex and its first is
 * a real edge to test against.
 *
 * The object array is in z order, and this file walks it backward, so the
 * topmost object wins.
 *
 * Render-layer code: it reads engine state and calls mutations, and crosses
 * that line for nothing else. Nothing in the engine imports this file, so a
 * GPU renderer can replace the whole layer later.
 */
import {
  buildPathEdges,
  type CameraState,
  CLOSED_PATH,
  distanceToEdge,
  distanceToPath,
  getSlot,
  getTableDimensions,
  type GraphObject,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  pathContains,
  pathEdgesOfObject,
  type Point,
  POLYLINE_TYPE,
  RADIUS_PATH,
  VERTICES_PATH,
} from "../engine/index.ts";
import { screenToWorld, type ScreenPoint, type WorldPoint } from "./camera.ts";
import { objectExtent } from "./extent.ts";
import { asPointArray, readBoolean, readNumber, readShapeStyle, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";

export const STROKE_HIT_TOLERANCE_SCREEN_PIXELS = 5;

/** True when the shape paints its inside. A shape with no fill is a hollow outline to a click. */
function fillsItsInside(object: GraphObject): boolean {
  return readShapeStyle(object).fillColor !== undefined;
}

/** A preset is a closed run of straight edges. Its vertices say everything about its shape. */
function hitTestVerticesShape(object: GraphObject, worldPoint: WorldPoint, strokeToleranceWorld: number): boolean {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  if (vertices === undefined || vertices.length === 0) {
    return false;
  }
  const edges = buildPathEdges(vertices, [], true);
  if (fillsItsInside(object) && pathContains(worldPoint, edges)) {
    return true;
  }
  return distanceToPath(worldPoint, edges) <= strokeToleranceWorld;
}

/** A circle hits on its true ring. It measures to the circle the renderer draws. */
function hitTestCircle(object: GraphObject, worldPoint: WorldPoint, strokeToleranceWorld: number): boolean {
  const originX = readNumber(object, ORIGIN_X_PATH);
  const originY = readNumber(object, ORIGIN_Y_PATH);
  const radius = readNumber(object, RADIUS_PATH);
  if (originX === undefined || originY === undefined || radius === undefined || radius < 0) {
    return false;
  }
  const distance = Math.hypot(worldPoint.x - originX, worldPoint.y - originY);
  if (fillsItsInside(object) && distance <= radius) {
    return true;
  }
  return Math.abs(distance - radius) <= strokeToleranceWorld;
}

/**
 * A polyline hits on its true edges. An arc measures to the circle it rides
 * on, not to the chord across it, so a click follows what the screen draws.
 */
function hitTestPolyline(object: GraphObject, worldPoint: WorldPoint, strokeToleranceWorld: number): boolean {
  const edges = pathEdgesOfObject(object);
  if (edges.length === 0) {
    return false;
  }
  const closed = readBoolean(object, CLOSED_PATH) === true;
  if (closed && fillsItsInside(object) && pathContains(worldPoint, edges)) {
    return true;
  }
  return distanceToPath(worldPoint, edges) <= strokeToleranceWorld;
}

function hitTestTable(object: GraphObject, worldPoint: WorldPoint): boolean {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);
  const width = cols * TABLE_CELL_WIDTH;
  const height = rows * TABLE_CELL_HEIGHT;
  if (width <= 0 || height <= 0) {
    return false;
  }
  return worldPoint.x >= originX && worldPoint.x <= originX + width && worldPoint.y >= originY && worldPoint.y <= originY + height;
}

function hitTestBoundingBox(object: GraphObject, worldPoint: WorldPoint): boolean {
  const extent = objectExtent(object);
  if (extent === undefined) {
    return false;
  }
  return worldPoint.x >= extent.minX && worldPoint.x <= extent.maxX && worldPoint.y >= extent.minY && worldPoint.y <= extent.maxY;
}

function hitTestObject(object: GraphObject, worldPoint: WorldPoint, strokeToleranceWorld: number): boolean {
  switch (object.type) {
    case "circle":
      return hitTestCircle(object, worldPoint, strokeToleranceWorld);
    case "polygon":
    case "rect":
      return hitTestVerticesShape(object, worldPoint, strokeToleranceWorld);
    case "table":
      return hitTestTable(object, worldPoint);
    case "text":
    case "image":
    case "script":
    case "math":
      return hitTestBoundingBox(object, worldPoint);
    case "polyline":
      return hitTestPolyline(object, worldPoint, strokeToleranceWorld);
    case "value":
    case "add":
      return false;
    default: {
      const exhaustive: never = object.type;
      void exhaustive;
      return false;
    }
  }
}

/**
 * The two vertices of the path edge under a point, when one edge sits within
 * the stroke tolerance. A shift drag moves that pair and leaves the rest of
 * the path where it is. A click inside a filled path reaches no edge, so this
 * gives undefined and the whole path moves instead.
 */
export function pathEdgeUnder(object: GraphObject, screenPoint: ScreenPoint, camera: CameraState): number | undefined {
  if (object.type !== POLYLINE_TYPE) {
    return undefined;
  }
  const edges = pathEdgesOfObject(object);
  if ((object.vertexCount ?? 0) === 0 || edges.length === 0) {
    return undefined;
  }
  const worldPoint = screenToWorld(camera, screenPoint);
  let nearest: number | undefined;
  let shortest = STROKE_HIT_TOLERANCE_SCREEN_PIXELS / camera.zoom;
  edges.forEach((edge, index) => {
    const distance = distanceToEdge(worldPoint, edge);
    if (distance <= shortest) {
      shortest = distance;
      nearest = index;
    }
  });
  return nearest;
}

export function pathSegmentUnder(
  object: GraphObject,
  screenPoint: ScreenPoint,
  camera: CameraState,
): readonly [number, number] | undefined {
  const index = pathEdgeUnder(object, screenPoint, camera);
  const count = object.vertexCount ?? 0;
  return index === undefined ? undefined : [index, (index + 1) % count];
}

/** The topmost object under a screen point, or undefined. */
export function hitTest(screenPoint: ScreenPoint, objects: readonly GraphObject[], camera: CameraState): GraphObject | undefined {
  const worldPoint = screenToWorld(camera, screenPoint);
  const strokeToleranceWorld = STROKE_HIT_TOLERANCE_SCREEN_PIXELS / camera.zoom;
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const object = objects[i];
    if (object === undefined) {
      continue;
    }
    if (hitTestObject(object, worldPoint, strokeToleranceWorld)) {
      return object;
    }
  }
  return undefined;
}
