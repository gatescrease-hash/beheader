/**
 * hittest.ts
 *
 * Layer: render. It reads engine state and calls mutations. It does nothing
 * else across that line. The engine must never import this file.
 *
 * A screen point to the topmost object.
 *
 * A fill uses point in polygon. A stroke uses distance to segment with a pixel
 * tolerance. Text, a table, an image and a script node use a box.
 *
 * Array order is z order. This file walks it backward.
 */
import { getSlot, type GraphObject, type Point } from "../engine/graph/node.ts";
import { CLOSED_PATH, ORIGIN_X_PATH, ORIGIN_Y_PATH, VERTICES_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import type { CameraState } from "../engine/document.ts";
import { screenToWorld, type ScreenPoint, type WorldPoint } from "./camera.ts";
import { objectExtent } from "./extent.ts";
import { asPointArray, readBoolean, readNumber, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";

export const STROKE_HIT_TOLERANCE_SCREEN_PIXELS = 5;

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * abx), point.y - (a.y + t * aby));
}

function distanceToClosedPolyline(point: Point, vertices: readonly Point[]): number {
  let minDistance = Infinity;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (a === undefined || b === undefined) {
      continue;
    }
    const distance = distanceToSegment(point, a, b);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
}

function hitTestVerticesShape(object: GraphObject, worldPoint: WorldPoint, strokeToleranceWorld: number): boolean {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  if (vertices === undefined || vertices.length === 0) {
    return false;
  }
  return distanceToClosedPolyline(worldPoint, vertices) <= strokeToleranceWorld;
}

function distanceToOpenPolyline(point: Point, vertices: readonly Point[]): number {
  let minDistance = Infinity;
  for (let i = 0; i + 1 < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[i + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    const distance = distanceToSegment(point, a, b);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
}

function hitTestPolyline(object: GraphObject, worldPoint: WorldPoint, strokeToleranceWorld: number): boolean {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  if (vertices === undefined || vertices.length < 2) {
    return false;
  }
  const distance = readBoolean(object, CLOSED_PATH) === true
    ? distanceToClosedPolyline(worldPoint, vertices)
    : distanceToOpenPolyline(worldPoint, vertices);
  return distance <= strokeToleranceWorld;
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
    case "polygon":
    case "rect":
      return hitTestVerticesShape(object, worldPoint, strokeToleranceWorld);
    case "table":
      return hitTestTable(object, worldPoint);
    case "text":
    case "image":
    case "script":
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
