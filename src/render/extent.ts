/**
 * extent.ts
 *
 * An extent is the world space box around one object, or around the whole
 * document.
 *
 * The drawn extent and the clickable extent are the same extent. Adding an arm
 * to extentOfObject therefore makes a type clickable straight away, and a type
 * that gains no matching arm in renderer.ts in the same change becomes an
 * invisible click target: it swallows presses over what looks like empty
 * canvas.
 *
 * Render-layer code: it reads engine state and calls mutations, and crosses
 * that line for nothing else. Nothing in the engine imports this file, so a
 * GPU renderer can replace the whole layer later.
 */
import {
  getSlot,
  getTableDimensions,
  type GraphObject,
  IMAGE_HEIGHT_PATH,
  IMAGE_WIDTH_PATH,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  pathBounds,
  pathEdgesOfObject,
  RADIUS_PATH,
  TEXT_AUTORESIZE_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_MEASURED_HEIGHT_PATH,
  TEXT_MEASURED_WIDTH_PATH,
  TEXT_RESOLVED_CONTENT_PATH,
  TEXT_WIDTH_PATH,
  VERTICES_PATH,
} from "../engine/index.ts";
import { mathWorldBox } from "./math.ts";
import { asPointArray, readBoolean, readNumber, scriptBoxHeight, SCRIPT_BOX_WIDTH, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";
import { textBoxSize } from "./textbox.ts";

export interface WorldExtent {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * The world box of one object. A type with an arm here becomes clickable. A
 * type with no renderer arm in the same change becomes an invisible target.
 */
/**
 * The box a copy takes where neither measured slot holds a number. It is wide
 * enough for a short name, an equals sign and a small value, so a copy stays
 * clickable in a document that was evaluated with no real measurer.
 */
export const DOCREF_FALLBACK_WIDTH = 120;
export const DOCREF_FALLBACK_HEIGHT = 20;

export function objectExtent(object: GraphObject): WorldExtent | undefined {
  switch (object.type) {
    // A copy is measured text, so its box comes from the two measured slots.
    // The fallback covers a document evaluated with no real measurer, where
    // both slots hold #MEASURE and a box of no size would make the copy
    // impossible to click on.
    case "docref": {
      const x = readNumber(object, ORIGIN_X_PATH) ?? 0;
      const y = readNumber(object, ORIGIN_Y_PATH) ?? 0;
      const width = readNumber(object, ["measuredWidth"]) ?? DOCREF_FALLBACK_WIDTH;
      const height = readNumber(object, ["measuredHeight"]) ?? DOCREF_FALLBACK_HEIGHT;
      return { minX: x, minY: y, maxX: x + width, maxY: y + height };
    }
    // The doc object has no origin and never draws, so it has no box. Every
    // caller already handles an object with no extent.
    case "doc":
      return undefined;
    case "circle":
      return circleExtent(object);
    case "polygon":
    case "rect":
      return verticesExtent(object);
    case "polyline":
      return polylineExtent(object);
    case "table":
      return tableExtent(object);
    case "text":
      return textExtent(object);
    case "image":
      return imageExtent(object);
    case "script":
      return scriptExtent(object);
    case "math":
      return mathWorldBox(object);
    case "value":
    case "add":
      return undefined;
    default: {
      const exhaustive: never = object.type;
      void exhaustive;
      return undefined;
    }
  }
}

function verticesExtent(object: GraphObject): WorldExtent | undefined {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  if (vertices === undefined || vertices.length === 0) {
    return undefined;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return undefined;
  }
  return { minX, minY, maxX, maxY };
}

/** The exact box of a circle. It reads the origin and the radius, and no point list. */
function circleExtent(object: GraphObject): WorldExtent | undefined {
  const originX = readNumber(object, ORIGIN_X_PATH);
  const originY = readNumber(object, ORIGIN_Y_PATH);
  const radius = readNumber(object, RADIUS_PATH);
  if (originX === undefined || originY === undefined || radius === undefined || radius < 0) {
    return undefined;
  }
  return { minX: originX - radius, minY: originY - radius, maxX: originX + radius, maxY: originY + radius };
}

/**
 * A polyline can carry arcs, so its box comes from its edges and not from its
 * vertices. An arc leaves the chord between its two ends, and the exact box
 * needs the quarter points of the circle the arc reaches.
 */
function polylineExtent(object: GraphObject): WorldExtent | undefined {
  const edges = pathEdgesOfObject(object);
  if (edges.length === 0) {
    return undefined;
  }
  const bounds = pathBounds(edges);
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)) {
    return undefined;
  }
  return bounds;
}

function tableExtent(object: GraphObject): WorldExtent | undefined {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);
  const width = cols * TABLE_CELL_WIDTH;
  const height = rows * TABLE_CELL_HEIGHT;
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { minX: originX, minY: originY, maxX: originX + width, maxY: originY + height };
}

function textExtent(object: GraphObject): WorldExtent | undefined {
  const resolved = getSlot(object, TEXT_RESOLVED_CONTENT_PATH)?.value;
  if (typeof resolved !== "string" || resolved === "") {
    return undefined;
  }
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { width, height } = textBoxSize({
    fixedWidth: readNumber(object, TEXT_WIDTH_PATH),
    fixedHeight: readNumber(object, TEXT_HEIGHT_PATH),
    autoresize: readBoolean(object, TEXT_AUTORESIZE_PATH) ?? true,
    measuredWidth: readNumber(object, TEXT_MEASURED_WIDTH_PATH),
    measuredHeight: readNumber(object, TEXT_MEASURED_HEIGHT_PATH),
  });
  return { minX: originX, minY: originY, maxX: originX + width, maxY: originY + height };
}

function imageExtent(object: GraphObject): WorldExtent | undefined {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const width = readNumber(object, IMAGE_WIDTH_PATH);
  const height = readNumber(object, IMAGE_HEIGHT_PATH);
  if (width === undefined || height === undefined || !(width > 0) || !(height > 0)) {
    return undefined;
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(originX) || !Number.isFinite(originY)) {
    return undefined;
  }
  return { minX: originX, minY: originY, maxX: originX + width, maxY: originY + height };
}

function scriptExtent(object: GraphObject): WorldExtent | undefined {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
    return undefined;
  }
  const height = scriptBoxHeight(object.ports?.in.length ?? 0, object.ports?.out.length ?? 0);
  return { minX: originX, minY: originY, maxX: originX + SCRIPT_BOX_WIDTH, maxY: originY + height };
}

/** The world box that holds every object. The fit command uses it. */
export function documentExtent(objects: readonly GraphObject[]): WorldExtent | undefined {
  let extent: WorldExtent | undefined;
  for (const object of objects) {
    const objectBox = objectExtent(object);
    if (objectBox === undefined) {
      continue;
    }
    extent =
      extent === undefined
        ? objectBox
        : {
            minX: Math.min(extent.minX, objectBox.minX),
            minY: Math.min(extent.minY, objectBox.minY),
            maxX: Math.max(extent.maxX, objectBox.maxX),
            maxY: Math.max(extent.maxY, objectBox.maxY),
          };
  }
  return extent;
}
