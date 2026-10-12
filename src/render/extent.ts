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
  displayObjects,
  getSlot,
  type GraphObject,
  groupOf,
  objectBox,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  pathBounds,
  pathEdgesOfObject,
  RADIUS_PATH,
  VERTICES_PATH,
} from "../engine/index.ts";
import { asPointArray, readNumber } from "./slots.ts";
import { connectorExtent, connectorLayout } from "./connector-layout.ts";

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
export function objectExtent(object: GraphObject): WorldExtent | undefined {
  switch (object.type) {
    // The doc object has no origin and never draws, so it has no box. Every
    // caller already handles an object with no extent.
    case "doc":
    case "layer":
      return undefined;
    case "circle":
      return circleExtent(object);
    case "polygon":
    case "rect":
      return verticesExtent(object);
    case "polyline":
      return polylineExtent(object);
    // The engine's box rule sizes every other type, so the box drawn and
    // pressed here is the box a formula reads from the `box` slot.
    case "docref":
    case "table":
    case "text":
    case "image":
    case "script":
    case "math":
    case "slider":
    case "frame":
    case "plot":
      return committedBox(object);
    case "group":
      return groupAnchorBox(object);
    // A connector's box is the box around its line and heads, which it draws
    // from two other objects rather than a place of its own.
    case "connector": {
      const layout = connectorLayout(object);
      return layout === undefined ? undefined : connectorExtent(layout);
    }
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

/** The box of an object by the engine's rule, read from the object as committed. */
function committedBox(object: GraphObject): WorldExtent | undefined {
  return objectBox(object, (path) => getSlot(object, path)?.value);
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

/** The world box that holds every object. The fit command uses it. */
export function documentExtent(objects: readonly GraphObject[]): WorldExtent | undefined {
  let extent: WorldExtent | undefined;
  for (const object of displayObjects(objects)) {
    const objectBox = object.type === "group" ? groupBoundary(object, objects) : objectExtent(object);
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

export const GROUP_EMPTY_WIDTH = 160;
export const GROUP_EMPTY_HEIGHT = 80;
export const GROUP_PADDING = 16;
export const GROUP_TAB_HEIGHT = 20;
export const GROUP_PADDING_TOP = 30;

/**
 * The box a group takes with nothing inside it: a fixed size from its origin.
 * objectExtent gives this for a group, because it sees one object at a time
 * and a group's real boundary depends on its members.
 */
function groupAnchorBox(object: GraphObject): WorldExtent | undefined {
  const x = readNumber(object, ORIGIN_X_PATH);
  const y = readNumber(object, ORIGIN_Y_PATH);
  return x === undefined || y === undefined ? undefined : { minX: x, minY: y, maxX: x + GROUP_EMPTY_WIDTH, maxY: y + GROUP_EMPTY_HEIGHT };
}

/**
 * The soft boundary a group draws: the union of its origin and the boxes of
 * its direct members, with padding. A member that is itself a group counts
 * with its own boundary and the tab above it, so nested boxes and their tabs
 * never overlap. The padding above the members leaves room for the name each
 * member draws over itself. The boundary never clips a member, so a member that
 * moves away stretches it rather than vanishing. A group with nothing inside it
 * takes the box from its origin.
 */
export function groupBoundary(group: GraphObject, objects: readonly GraphObject[], visiting: ReadonlySet<string> = new Set()): WorldExtent | undefined {
  const anchor = groupAnchorBox(group);
  if (anchor === undefined || visiting.has(group.id)) {
    return anchor;
  }
  const inside = new Set([...visiting, group.id]);
  const boxes = objects
    .filter((object) => groupOf(object) === group.id)
    .map((object) => {
      if (object.type !== "group") return objectExtent(object);
      const box = groupBoundary(object, objects, inside);
      return box === undefined ? undefined : { ...box, minY: box.minY - GROUP_TAB_HEIGHT };
    })
    .filter((box): box is WorldExtent => box !== undefined);
  if (boxes.length === 0) {
    return anchor;
  }
  return {
    minX: Math.min(anchor.minX, ...boxes.map((box) => box.minX - GROUP_PADDING)),
    minY: Math.min(anchor.minY, ...boxes.map((box) => box.minY - GROUP_PADDING_TOP)),
    maxX: Math.max(anchor.minX, ...boxes.map((box) => box.maxX + GROUP_PADDING)),
    maxY: Math.max(anchor.minY, ...boxes.map((box) => box.maxY + GROUP_PADDING)),
  };
}

/** The height of the name a frame draws above its top left corner, in world units. */
export const FRAME_LABEL_HEIGHT = 18;

/** The width a frame's name takes above its corner, in world units, from the length of the name. */
export function frameLabelWidth(frame: GraphObject): number {
  return frame.name.length * 7 + 12;
}

/** The width a group's name tab takes, in world units, from the length of the name. */
export function groupTabWidth(group: GraphObject): number {
  return group.name.length * 7 + 28;
}
