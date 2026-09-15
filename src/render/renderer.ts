/**
 * renderer.ts
 *
 * The immediate mode painter: every frame redraws everything, in three passes.
 *
 * The first pass clears the viewport in screen space. The second sets the
 * camera transform once and draws every object in world coordinates, letting
 * the canvas do the conversion. The third resets to the identity transform and
 * draws the furniture, such as a name label or an error badge, so those stay
 * one size at every zoom. The grips of a selected path are drawn in that third
 * pass for the same reason.
 *
 * A selection highlight draws in its own pass after all the objects, so an
 * object later in z order cannot paint over it.
 *
 * The opacity of an image is clamped to the range 0 to 1 here, at draw time,
 * rather than where the slot is written. So the slot holds whatever a formula
 * puts in it, including a number outside that range, and the clamp applies to
 * the painted result alone.
 *
 * Every colour is written twice: the default first, then whatever the style
 * slot holds. A canvas silently keeps its previous colour when it cannot parse
 * the one it is given, so a single write would paint one shape in the colour
 * of the shape before it. Writing the default first makes that failure fall
 * back to the default instead.
 *
 * PathPreview is the one thing this file draws that no object owns. It is the
 * points, the bulges and the closed flag of a command the operator has not
 * finished yet, drawn dashed with a square on each point, over the objects and
 * under the screen space furniture. It is plain geometry, so this file never
 * has to ask which command produced it. buildEdgePath walks an edge list for a
 * preview and for a real path alike.
 *
 * The camera transform comes from camera.ts and the line breaking comes from
 * layOutText in measure.ts. There is no second copy of either formula here,
 * and a change to how lines break needs the matching change in measure.ts,
 * because one layout function with two readers is the only reason the drawn
 * text and the measured height agree.
 *
 * Render-layer code: it reads engine state and calls mutations, and crosses
 * that line for nothing else. Nothing in the engine imports this file, so a
 * GPU renderer can replace the whole layer later.
 */
import {
  docrefLabel,
  DOCREF_STYLE,
  arcOfEdge,
  bezierOfEdge,
  buildPathEdges,
  type CameraState,
  CLOSED_PATH,
  formatCellReference,
  getSlot,
  getTableDimensions,
  type GraphObject,
  IMAGE_OPACITY_PATH,
  IMAGE_PRESERVE_ASPECT_PATH,
  IMAGE_SOURCE_PATH,
  indexToColumnLetters,
  isErrorValue,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  type PathEdge,
  pathEdgesOfObject,
  type Point,
  RADIUS_PATH,
  SCRIPT_LANGUAGE_PATH,
  TABLE_CELL_PATH_PREFIX,
  TABLE_TYPE,
  TEXT_AUTORESIZE_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_MEASURED_HEIGHT_PATH,
  MATH_MEASURED_WIDTH_PATH,
  TEXT_MEASURED_WIDTH_PATH,
  TEXT_RESOLVED_CONTENT_PATH,
  TEXT_STYLE_ALIGN_PATH,
  TEXT_STYLE_COLOR_PATH,
  TEXT_STYLE_FONT_PATH,
  TEXT_STYLE_FONT_SIZE_PATH,
  TEXT_STYLE_LINE_HEIGHT_PATH,
  TEXT_WIDTH_PATH,
  type Value,
  VERTICES_PATH,
} from "../engine/index.ts";
import type { EditorTarget } from "./editor.ts";
import { worldToScreen } from "./camera.ts";
import type { ImageBitmaps } from "./images.ts";
import { handlePoint, hasResizeHandles, RESIZE_HANDLES, RESIZE_HANDLE_SIZE_SCREEN } from "./handles.ts";
import { EDGE_GRIP_SIZE_SCREEN, hasPathGrips, pathGrips, sameGrip, VERTEX_GRIP_SIZE_SCREEN, type PathGrip } from "./grips.ts";
import { layOutText } from "./measure.ts";
import { asPointArray, readBoolean, readNumber, readShapeStyle, readText, SCRIPT_HEADER_HEIGHT, SCRIPT_PORT_ROW_HEIGHT, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";
import { textBoxSize } from "./textbox.ts";
import { objectExtent } from "./extent.ts";

const DEFAULT_SHAPE_STROKE_STYLE = "#1a1a1a";
const TRANSPARENT = "transparent";
const DEFAULT_SHAPE_STROKE_WIDTH = 1;

const TABLE_CELL_TEXT_PADDING = 4;
const TABLE_GRID_STROKE_STYLE = "#999999";
const TABLE_CELL_TEXT_STYLE = "#1a1a1a";
const TABLE_CELL_FONT = "14px sans-serif";

const DEFAULT_TEXT_FILL_STYLE = "#1a1a1a";
const DEFAULT_TEXT_FONT_FAMILY = "sans-serif";
const DEFAULT_TEXT_FONT_SIZE = 16;
const DEFAULT_TEXT_LINE_HEIGHT = 20;

// A copy draws in the same ink as the text primitive, so a variable on the
// canvas reads as document text rather than as a control.
const DOCREF_TEXT_STYLE = "#1a1a1a";

const SCRIPT_BOX_STROKE_STYLE = "#5b6472";
const SCRIPT_BODY_FILL_STYLE = "#f4f5f7";
const SCRIPT_TEXT_STYLE = "#1a1a1a";

const MATH_BOX_STROKE_STYLE = "#c8ccd4";
const MATH_BODY_FILL_STYLE = "#ffffff";
const MATH_ERROR_STROKE_STYLE = "#c0392b";
const SCRIPT_PORT_STUB_STYLE = "#5b6472";
const SCRIPT_FONT = "12px sans-serif";
const SCRIPT_TEXT_PADDING = 6;
const SCRIPT_PORT_STUB_SIZE = 6;

const IMAGE_FRAME_STROKE_STYLE = "#999999";

const DEFAULT_IMAGE_OPACITY = 1;

function drawImage(ctx: CanvasRenderingContext2D, object: GraphObject, images: ImageBitmaps | undefined): void {
  const box = objectExtent(object);
  if (box === undefined) {
    return;
  }
  const boxWidth = box.maxX - box.minX;
  const boxHeight = box.maxY - box.minY;
  ctx.strokeStyle = IMAGE_FRAME_STROKE_STYLE;
  ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
  ctx.strokeRect(box.minX, box.minY, boxWidth, boxHeight);

  const source = readText(object, IMAGE_SOURCE_PATH);
  if (source === undefined || images === undefined) {
    return;
  }
  const bitmap = images.bitmapFor(source);
  if (bitmap === undefined) {
    return;
  }
  const preserveAspect = readBoolean(object, IMAGE_PRESERVE_ASPECT_PATH) ?? true;
  const fitted = preserveAspect
    ? fitBitmapIntoBox(boxWidth, boxHeight, bitmap.naturalWidth, bitmap.naturalHeight)
    : { x: 0, y: 0, width: boxWidth, height: boxHeight };
  const opacity = readNumber(object, IMAGE_OPACITY_PATH) ?? DEFAULT_IMAGE_OPACITY;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : DEFAULT_IMAGE_OPACITY;
  ctx.drawImage(bitmap.image, box.minX + fitted.x, box.minY + fitted.y, fitted.width, fitted.height);
  ctx.globalAlpha = previousAlpha;
}

/**
 * Draws the box of a math object and nothing inside it. The notation is an
 * element above the canvas, put there by main.ts, because the markup that
 * MathLive returns is not something a canvas draws. This pass leaves the room
 * for it and marks a source that failed to measure.
 */
function drawMath(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  const box = objectExtent(object);
  if (box === undefined) {
    return;
  }
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;

  ctx.fillStyle = MATH_BODY_FILL_STYLE;
  ctx.fillRect(box.minX, box.minY, width, height);

  const measured = getSlot(object, MATH_MEASURED_WIDTH_PATH)?.value;
  const failed = measured !== undefined && isErrorValue(measured);
  ctx.strokeStyle = failed ? MATH_ERROR_STROKE_STYLE : MATH_BOX_STROKE_STYLE;
  ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
  ctx.strokeRect(box.minX, box.minY, width, height);
}

function drawScript(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  const box = objectExtent(object);
  if (box === undefined) {
    return;
  }
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;

  ctx.fillStyle = SCRIPT_BODY_FILL_STYLE;
  ctx.fillRect(box.minX, box.minY, width, height);
  ctx.strokeStyle = SCRIPT_BOX_STROKE_STYLE;
  ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
  ctx.strokeRect(box.minX, box.minY, width, height);

  const headerBottom = box.minY + SCRIPT_HEADER_HEIGHT;
  ctx.beginPath();
  ctx.moveTo(box.minX, headerBottom);
  ctx.lineTo(box.maxX, headerBottom);
  ctx.stroke();

  ctx.font = SCRIPT_FONT;
  ctx.fillStyle = SCRIPT_TEXT_STYLE;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(readText(object, SCRIPT_LANGUAGE_PATH) ?? "", box.minX + SCRIPT_TEXT_PADDING, box.minY + SCRIPT_HEADER_HEIGHT / 2);

  const inPorts = object.ports?.in ?? [];
  const outPorts = object.ports?.out ?? [];
  for (let index = 0; index < inPorts.length; index += 1) {
    const centre = headerBottom + (index + 0.5) * SCRIPT_PORT_ROW_HEIGHT;
    ctx.fillStyle = SCRIPT_PORT_STUB_STYLE;
    ctx.fillRect(box.minX - SCRIPT_PORT_STUB_SIZE / 2, centre - SCRIPT_PORT_STUB_SIZE / 2, SCRIPT_PORT_STUB_SIZE, SCRIPT_PORT_STUB_SIZE);
    ctx.fillStyle = SCRIPT_TEXT_STYLE;
    ctx.textAlign = "left";
    ctx.fillText(inPorts[index] ?? "", box.minX + SCRIPT_TEXT_PADDING, centre);
  }
  for (let index = 0; index < outPorts.length; index += 1) {
    const centre = headerBottom + (index + 0.5) * SCRIPT_PORT_ROW_HEIGHT;
    ctx.fillStyle = SCRIPT_PORT_STUB_STYLE;
    ctx.fillRect(box.maxX - SCRIPT_PORT_STUB_SIZE / 2, centre - SCRIPT_PORT_STUB_SIZE / 2, SCRIPT_PORT_STUB_SIZE, SCRIPT_PORT_STUB_SIZE);
    ctx.fillStyle = SCRIPT_TEXT_STYLE;
    ctx.textAlign = "right";
    ctx.fillText(outPorts[index] ?? "", box.maxX - SCRIPT_TEXT_PADDING, centre);
  }
}

export function fitBitmapIntoBox(
  boxWidth: number,
  boxHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  }
  const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

const SELECTION_HIGHLIGHT_STYLE = "#2456c9";

/**
 * The grips on a selected path. A free grip is white inside and a bound one is
 * grey. So a held vertex reads as a different thing, and not a different mood.
 */
const GRIP_STROKE_STYLE = "#2456c9";
const GRIP_FREE_FILL_STYLE = "#ffffff";
const GRIP_BOUND_FILL_STYLE = "#b9c2d6";
const GRIP_FOCUS_FILL_STYLE = "#2456c9";
const GRIP_LINE_WIDTH = 1;

/** The half finished path a prompt sequence draws. Every size here is screen pixels. */
const PREVIEW_STROKE_STYLE = "#2456c9";
const PREVIEW_LINE_WIDTH_SCREEN = 1;
const PREVIEW_DASH_SCREEN = 5;
const PREVIEW_POINT_SIZE_SCREEN = 6;
const SELECTION_HIGHLIGHT_WIDTH = DEFAULT_SHAPE_STROKE_WIDTH * 3;

const RESIZE_HANDLE_FILL_STYLE = "#ffffff";
const RESIZE_HANDLE_STROKE_WIDTH_SCREEN = 1;

const CHROME_ANCHOR_MARGIN_SCREEN = 6;
const CHROME_GAP_SCREEN = 6;
const CHROME_FONT = "12px sans-serif";
const CHROME_LABEL_STYLE = "#1a1a1a";
const CHROME_ERROR_BADGE_STYLE = "#c0392b";
const CHROME_FORMULA_TICK_STYLE = "#2456c9";

const TABLE_HEADER_MARGIN_SCREEN = 4;
const TABLE_HEADER_LABEL_STYLE = "#6b7280";
const TABLE_HEADER_MIN_CELL_SCREEN = 14;

function chromeTopReservedScreen(object: GraphObject): number {
  return object.type === TABLE_TYPE ? CHROME_FONT_SIZE_SCREEN + TABLE_HEADER_MARGIN_SCREEN : 0;
}

const CHROME_FONT_SIZE_SCREEN = 12;

function clearScreen(ctx: CanvasRenderingContext2D, viewportWidth: number, viewportHeight: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, viewportWidth, viewportHeight);
}

/**
 * The path a half finished command draws, before any object exists for it.
 * It is plain geometry. This file never asks which command made it.
 */
export interface PathPreview {
  readonly points: readonly Point[];
  readonly bulges: readonly number[];
  readonly closed: boolean;
}

/**
 * Where one run of notation inside a text object landed, in world units.
 *
 * Notation reaches the screen as an element rather than as paint, so the pass
 * that laid the text out reports where each run belongs and the caller puts an
 * element there. The report comes from the pass rather than from a second
 * layout, because a second one would drift from this and every run would sit a
 * little further from its line.
 */
export interface TextMathRun {
  readonly objectId: string;
  readonly index: number;
  readonly latex: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * The size the run was measured at, which is the size of the text around it
   * rather than the size a standalone math object draws at. Drawing it at any
   * other size makes it wider than the room the layout left, and the words
   * after it are then written over.
   */
  readonly fontSize: number;
}

export interface RenderReport {
  readonly mathRuns: readonly TextMathRun[];
}

/** The size a run of notation takes, which the layout needs and a canvas cannot answer. */
export type MathRunMeasurer = (latex: string, fontSize: number) => { readonly width: number; readonly height: number };

export function renderDocument(
  ctx: CanvasRenderingContext2D,
  viewportWidth: number,
  viewportHeight: number,
  objects: readonly GraphObject[],
  camera: CameraState,
  selectedObjectIds: readonly string[] = [],
  panelledObjectIds: readonly string[] = selectedObjectIds,
  editing: EditorTarget | undefined = undefined,
  images: ImageBitmaps | undefined = undefined,
  preview: PathPreview | undefined = undefined,
  focusedGrip: PathGrip | undefined = undefined,
  measureMath: MathRunMeasurer | undefined = undefined,
): RenderReport {
  clearScreen(ctx, viewportWidth, viewportHeight);
  const mathRuns: TextMathRun[] = [];

  const editingTextId = editing?.kind === "text" || editing?.kind === "docref" ? editing.objectId : undefined;
  const editingCellOn = (objectId: string): string | undefined =>
    editing?.kind === "cell" && editing.objectId === objectId ? editing.cell : undefined;

  const screenOrigin = worldToScreen(camera, { x: 0, y: 0 });
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, screenOrigin.x, screenOrigin.y);

  for (const object of objects) {
    if (object.id === editingTextId) {
      continue;
    }
    drawObject(ctx, object, editingCellOn(object.id), images, measureMath, mathRuns);
  }

  const selectedIds = new Set(selectedObjectIds);

  for (const object of objects) {
    if (selectedIds.has(object.id) && object.id !== editingTextId) {
      drawSelectionHighlight(ctx, object);
    }
  }

  if (preview !== undefined) {
    drawPathPreview(ctx, camera, preview);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const panelledIds = new Set(panelledObjectIds);
  for (const object of objects) {
    drawObjectChrome(ctx, camera, object, panelledIds.has(object.id));
    drawTableHeaders(ctx, camera, object);
  }

  for (const object of objects) {
    if (selectedIds.has(object.id) && object.id !== editingTextId) {
      drawResizeHandles(ctx, camera, object);
      drawPathGrips(ctx, camera, object, focusedGrip);
    }
  }

  return { mathRuns };
}

/**
 * The grips of a selected path, in screen space.
 *
 * A vertex is a square and an edge is a diamond at its middle. A grip whose
 * slots a formula drives draws hollow. So the operator sees which points hold
 * still before a drag refuses to move them. The focused grip fills solid.
 */
function drawPathGrips(
  ctx: CanvasRenderingContext2D,
  camera: CameraState,
  object: GraphObject,
  focusedGrip: PathGrip | undefined,
): void {
  if (!hasPathGrips(object)) {
    return;
  }
  for (const placed of pathGrips(object)) {
    const centre = worldToScreen(camera, placed.point);
    const focused = focusedGrip !== undefined && sameGrip(focusedGrip, placed.grip);
    const half = (placed.grip.kind === "vertex" ? VERTEX_GRIP_SIZE_SCREEN : EDGE_GRIP_SIZE_SCREEN) / 2;
    ctx.strokeStyle = DEFAULT_SHAPE_STROKE_STYLE;
    ctx.strokeStyle = GRIP_STROKE_STYLE;
    ctx.fillStyle = focused ? GRIP_FOCUS_FILL_STYLE : placed.free ? GRIP_FREE_FILL_STYLE : GRIP_BOUND_FILL_STYLE;
    ctx.lineWidth = GRIP_LINE_WIDTH;
    ctx.beginPath();
    if (placed.grip.kind === "vertex") {
      ctx.moveTo(centre.x - half, centre.y - half);
      ctx.lineTo(centre.x + half, centre.y - half);
      ctx.lineTo(centre.x + half, centre.y + half);
      ctx.lineTo(centre.x - half, centre.y + half);
    } else {
      ctx.moveTo(centre.x, centre.y - half);
      ctx.lineTo(centre.x + half, centre.y);
      ctx.lineTo(centre.x, centre.y + half);
      ctx.lineTo(centre.x - half, centre.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * The path a prompt sequence has so far, in a dashed accent colour, with a
 * marker on each point. It draws under the camera transform, so every screen
 * size here divides by the zoom to hold still.
 *
 * A dash pattern outlives the call that sets it, so this clears it again.
 */
function drawPathPreview(ctx: CanvasRenderingContext2D, camera: CameraState, preview: PathPreview): void {
  ctx.strokeStyle = DEFAULT_SHAPE_STROKE_STYLE;
  ctx.strokeStyle = PREVIEW_STROKE_STYLE;
  ctx.lineWidth = PREVIEW_LINE_WIDTH_SCREEN / camera.zoom;
  if (buildEdgePath(ctx, buildPathEdges(preview.points, preview.bulges, preview.closed), preview.closed)) {
    ctx.setLineDash([PREVIEW_DASH_SCREEN / camera.zoom, PREVIEW_DASH_SCREEN / camera.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const side = PREVIEW_POINT_SIZE_SCREEN / camera.zoom;
  for (const point of preview.points) {
    ctx.strokeRect(point.x - side / 2, point.y - side / 2, side, side);
  }
}

function drawResizeHandles(ctx: CanvasRenderingContext2D, camera: CameraState, object: GraphObject): void {
  if (!hasResizeHandles(object)) {
    return;
  }
  const extent = objectExtent(object);
  if (extent === undefined) {
    return;
  }
  const half = RESIZE_HANDLE_SIZE_SCREEN / 2;
  ctx.fillStyle = RESIZE_HANDLE_FILL_STYLE;
  ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
  ctx.lineWidth = RESIZE_HANDLE_STROKE_WIDTH_SCREEN;
  for (const handle of RESIZE_HANDLES) {
    const centre = worldToScreen(camera, handlePoint(extent, handle));
    ctx.fillRect(centre.x - half, centre.y - half, RESIZE_HANDLE_SIZE_SCREEN, RESIZE_HANDLE_SIZE_SCREEN);
    ctx.strokeRect(centre.x - half, centre.y - half, RESIZE_HANDLE_SIZE_SCREEN, RESIZE_HANDLE_SIZE_SCREEN);
  }
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  object: GraphObject,
  editingCell: string | undefined,
  images: ImageBitmaps | undefined,
  measureMath: MathRunMeasurer | undefined,
  mathRuns: TextMathRun[],
): void {
  switch (object.type) {
    // The doc object has no origin and nothing to draw. Its variables reach
    // the screen through the panel and through the copies of them.
    case "doc":
      return;
    case "docref": {
      ctx.font = `${DOCREF_STYLE.fontSize}px ${DOCREF_STYLE.font}`;
      ctx.fillStyle = DOCREF_TEXT_STYLE;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const label = docrefLabel(object.target, getSlot(object, ["value"])?.value ?? null);
      ctx.fillText(label, readNumber(object, ORIGIN_X_PATH) ?? 0, readNumber(object, ORIGIN_Y_PATH) ?? 0);
      return;
    }
    case "circle":
      drawCircle(ctx, object);
      return;
    case "polygon":
    case "rect":
      drawVerticesShape(ctx, object);
      return;
    case "polyline":
      drawPolyline(ctx, object);
      return;
    case "table":
      drawTable(ctx, object, editingCell);
      return;
    case "text":
      drawText(ctx, object, measureMath, mathRuns);
      return;
    case "image":
      drawImage(ctx, object, images);
      return;
    case "script":
      drawScript(ctx, object);
      return;
    case "math":
      drawMath(ctx, object);
      return;
    case "value":
    case "add":
      return;
    default: {
      const exhaustive: never = object.type;
      void exhaustive;
      return;
    }
  }
}

function buildCirclePath(ctx: CanvasRenderingContext2D, object: GraphObject): boolean {
  const originX = readNumber(object, ORIGIN_X_PATH);
  const originY = readNumber(object, ORIGIN_Y_PATH);
  const radius = readNumber(object, RADIUS_PATH);
  if (originX === undefined || originY === undefined || radius === undefined || radius < 0) {
    return false;
  }
  ctx.beginPath();
  ctx.arc(originX, originY, radius, 0, Math.PI * 2);
  return true;
}

function drawCircle(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  paintShape(ctx, object, buildCirclePath(ctx, object), true);
}

function buildVerticesPath(ctx: CanvasRenderingContext2D, object: GraphObject): boolean {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  const first = vertices?.[0];
  if (vertices === undefined || first === undefined) {
    return false;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    if (vertex === undefined) {
      continue;
    }
    ctx.lineTo(vertex.x, vertex.y);
  }
  ctx.closePath();
  return true;
}

function drawVerticesShape(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  paintShape(ctx, object, buildVerticesPath(ctx, object), true);
}

/**
 * Fills the path, then strokes it, in the colours the style slots hold. Only a
 * closed shape fills. Each colour goes on twice: the default first, then the
 * slot value. A canvas ignores a colour string it cannot read, so the first
 * write is what an unreadable second write falls back to. With one write only,
 * the shape takes the colour of whatever drew before it.
 */
function paintShape(ctx: CanvasRenderingContext2D, object: GraphObject, built: boolean, closed: boolean): void {
  if (!built) {
    return;
  }
  const style = readShapeStyle(object);
  if (closed && style.fillColor !== undefined) {
    ctx.fillStyle = TRANSPARENT;
    ctx.fillStyle = style.fillColor;
    ctx.fill();
  }
  ctx.strokeStyle = DEFAULT_SHAPE_STROKE_STYLE;
  ctx.strokeStyle = style.strokeColor;
  ctx.lineWidth = style.strokeWidth;
  ctx.stroke();
}

/** An open path, unlike buildVerticesPath. It never closes the last gap. */
function buildOpenVerticesPath(ctx: CanvasRenderingContext2D, object: GraphObject): boolean {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  const first = vertices?.[0];
  if (vertices === undefined || first === undefined) {
    return false;
  }
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    if (vertex === undefined) {
      continue;
    }
    ctx.lineTo(vertex.x, vertex.y);
  }
  return true;
}

/**
 * A polyline draws its edges, straight or curved. It draws a true arc through
 * ctx.arc, the same call a circle uses. Nothing here reads a sample point,
 * because a curved edge never becomes one.
 */
function buildEdgePath(ctx: CanvasRenderingContext2D, edges: readonly PathEdge[], closed: boolean): boolean {
  const first = edges[0];
  if (first === undefined) {
    return false;
  }
  ctx.beginPath();
  ctx.moveTo(first.start.x, first.start.y);
  for (const edge of edges) {
    const curve = bezierOfEdge(edge);
    if (curve !== undefined) {
      ctx.bezierCurveTo(curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y);
      continue;
    }
    const arc = arcOfEdge(edge);
    if (arc === undefined) {
      ctx.lineTo(edge.end.x, edge.end.y);
      continue;
    }
    ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.startAngle + arc.sweep, arc.sweep < 0);
  }
  if (closed) {
    ctx.closePath();
  }
  return true;
}

function buildPolylinePath(ctx: CanvasRenderingContext2D, object: GraphObject): boolean {
  return buildEdgePath(ctx, pathEdgesOfObject(object), readBoolean(object, CLOSED_PATH) === true);
}

function drawPolyline(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  paintShape(ctx, object, buildPolylinePath(ctx, object), readBoolean(object, CLOSED_PATH) === true);
}

function drawTable(ctx: CanvasRenderingContext2D, object: GraphObject, editingCell: string | undefined): void {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);

  ctx.font = TABLE_CELL_FONT;
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= cols; column += 1) {
      const cellLeft = originX + (column - 1) * TABLE_CELL_WIDTH;
      const cellTop = originY + (row - 1) * TABLE_CELL_HEIGHT;

      ctx.strokeStyle = TABLE_GRID_STROKE_STYLE;
      ctx.lineWidth = DEFAULT_SHAPE_STROKE_WIDTH;
      ctx.strokeRect(cellLeft, cellTop, TABLE_CELL_WIDTH, TABLE_CELL_HEIGHT);

      const reference = formatCellReference({ column, row });
      if (reference === editingCell) {
        continue;
      }
      const cellPath = [TABLE_CELL_PATH_PREFIX, reference];
      drawCellText(ctx, getSlot(object, cellPath)?.value, cellLeft, cellTop);
    }
  }
}

function drawCellText(ctx: CanvasRenderingContext2D, value: Value | undefined, cellLeft: number, cellTop: number): void {
  if (value === undefined) {
    return;
  }
  const formatted = formatCellValue(value);
  if (formatted === null) {
    return;
  }
  ctx.fillStyle = TABLE_CELL_TEXT_STYLE;
  ctx.textBaseline = "middle";
  const y = cellTop + TABLE_CELL_HEIGHT / 2;
  if (typeof value === "number") {
    ctx.textAlign = "right";
    ctx.fillText(formatted, cellLeft + TABLE_CELL_WIDTH - TABLE_CELL_TEXT_PADDING, y);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(formatted, cellLeft + TABLE_CELL_TEXT_PADDING, y);
  }
}

function formatCellValue(value: Value): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (isErrorValue(value)) {
    return value.error;
  }
  if (Array.isArray(value)) {
    return `[${value.length} points]`;
  }
  const point = value as Point;
  return `(${point.x}, ${point.y})`;
}

interface ResolvedTextStyle {
  readonly family: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly color: string;
  readonly align: "left" | "center" | "right";
}

function resolveTextStyle(object: GraphObject): ResolvedTextStyle {
  const fontSize = readNumber(object, TEXT_STYLE_FONT_SIZE_PATH);
  const lineHeight = readNumber(object, TEXT_STYLE_LINE_HEIGHT_PATH);
  const align = readText(object, TEXT_STYLE_ALIGN_PATH);
  return {
    family: readText(object, TEXT_STYLE_FONT_PATH) ?? DEFAULT_TEXT_FONT_FAMILY,
    fontSize: fontSize !== undefined && fontSize > 0 ? fontSize : DEFAULT_TEXT_FONT_SIZE,
    lineHeight: lineHeight !== undefined && lineHeight > 0 ? lineHeight : DEFAULT_TEXT_LINE_HEIGHT,
    color: readText(object, TEXT_STYLE_COLOR_PATH) ?? DEFAULT_TEXT_FILL_STYLE,
    align: align === "center" || align === "right" ? align : "left",
  };
}

function alignmentOffset(align: "left" | "center" | "right", boxWidth: number, lineWidth: number): number {
  if (align === "center") {
    return (boxWidth - lineWidth) / 2;
  }
  if (align === "right") {
    return boxWidth - lineWidth;
  }
  return 0;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  object: GraphObject,
  measureMath: MathRunMeasurer | undefined,
  mathRuns: TextMathRun[],
): void {
  const resolved = readText(object, TEXT_RESOLVED_CONTENT_PATH);
  if (resolved === undefined) {
    return;
  }
  const style = resolveTextStyle(object);
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;

  const fixedWidth = readNumber(object, TEXT_WIDTH_PATH);
  const wrapWidth = fixedWidth !== undefined && fixedWidth > 0 ? fixedWidth : undefined;
  const layout = layOutText({
    text: resolved,
    style: { font: style.family, fontSize: style.fontSize, lineHeight: style.lineHeight },
    wrapWidth,
    markup: true,
    measureRun: (text, font) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    },
    measureMath,
  });

  const { width: boxWidth } = textBoxSize({
    fixedWidth,
    fixedHeight: readNumber(object, TEXT_HEIGHT_PATH),
    autoresize: readBoolean(object, TEXT_AUTORESIZE_PATH) ?? true,
    measuredWidth: readNumber(object, TEXT_MEASURED_WIDTH_PATH),
    measuredHeight: readNumber(object, TEXT_MEASURED_HEIGHT_PATH),
  });

  ctx.fillStyle = style.color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  let mathIndex = 0;
  for (const line of layout.lines) {
    const lineLeft = originX + alignmentOffset(style.align, boxWidth, line.width);
    for (const run of line.runs) {
      if (run.latex !== undefined) {
        // Notation arrives as an element, so the run is reported and nothing is
        // painted where it sits. It is put on the bottom of the line, which is
        // where a baseline of text would be, so notation inside a sentence sits
        // on the same line the words do.
        const height = run.height ?? line.height;
        mathRuns.push({
          objectId: object.id,
          index: mathIndex,
          latex: run.latex,
          x: lineLeft + run.x,
          y: originY + line.top + Math.max(0, line.height - height),
          width: run.width,
          height,
          fontSize: style.fontSize,
        });
        mathIndex += 1;
        continue;
      }
      ctx.font = run.font;
      ctx.fillText(run.text, lineLeft + run.x, originY + line.top);
    }
  }
}

function drawSelectionHighlight(ctx: CanvasRenderingContext2D, object: GraphObject): void {
  switch (object.type) {
    // The doc object has no box to outline. `vars` names it in the panel
    // header instead, which is the whole of what selecting it shows.
    case "doc":
      return;
    case "circle": {
      if (buildCirclePath(ctx, object)) {
        strokeHighlight(ctx);
      }
      return;
    }
    case "polygon":
    case "rect": {
      if (buildVerticesPath(ctx, object)) {
        strokeHighlight(ctx);
      }
      return;
    }
    case "polyline": {
      if (buildPolylinePath(ctx, object)) {
        strokeHighlight(ctx);
      }
      return;
    }
    case "table": {
      const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
      const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
      const { rows, cols } = getTableDimensions(object);
      const width = cols * TABLE_CELL_WIDTH;
      const height = rows * TABLE_CELL_HEIGHT;
      if (width <= 0 || height <= 0) {
        return;
      }
      ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
      ctx.lineWidth = SELECTION_HIGHLIGHT_WIDTH;
      ctx.strokeRect(originX, originY, width, height);
      return;
    }
    case "text":
    case "docref":
    case "image":
    case "script": {
      const extent = objectExtent(object);
      if (extent === undefined) {
        return;
      }
      ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
      ctx.lineWidth = SELECTION_HIGHLIGHT_WIDTH;
      ctx.strokeRect(extent.minX, extent.minY, extent.maxX - extent.minX, extent.maxY - extent.minY);
      return;
    }
    case "math":
    case "value":
    case "add":
      return;
    default: {
      const exhaustive: never = object.type;
      void exhaustive;
      return;
    }
  }
}

function strokeHighlight(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = SELECTION_HIGHLIGHT_STYLE;
  ctx.lineWidth = SELECTION_HIGHLIGHT_WIDTH;
  ctx.stroke();
}

function chromeAnchorPoint(object: GraphObject): Point | undefined {
  const extent = objectExtent(object);
  if (extent === undefined) {
    return undefined;
  }
  return { x: (extent.minX + extent.maxX) / 2, y: extent.minY };
}

function objectHasError(object: GraphObject): boolean {
  return Object.values(object.slots).some((slot) => isErrorValue(slot.value));
}

function drawObjectChrome(ctx: CanvasRenderingContext2D, camera: CameraState, object: GraphObject, suppressName: boolean): void {
  // A copy draws the variable name as the left half of its own label, and it
  // draws the error code in place of the value, so the name tag and the error
  // badge would both repeat what the operator is already reading.
  if (object.type === "docref") {
    return;
  }
  const anchor = chromeAnchorPoint(object);
  if (anchor === undefined) {
    return;
  }
  const screen = worldToScreen(camera, anchor);
  const baseline = screen.y - CHROME_ANCHOR_MARGIN_SCREEN - chromeTopReservedScreen(object);

  ctx.font = CHROME_FONT;
  ctx.textBaseline = "bottom";

  ctx.fillStyle = CHROME_LABEL_STYLE;
  ctx.textAlign = "center";
  if (!suppressName) {
    ctx.fillText(object.name, screen.x, baseline);
  }

  const halfName = suppressName ? 0 : ctx.measureText(object.name).width / 2;

  if (objectHasError(object)) {
    ctx.fillStyle = CHROME_ERROR_BADGE_STYLE;
    ctx.textAlign = "left";
    ctx.fillText("!", screen.x + halfName + CHROME_GAP_SCREEN, baseline);
  }

  const ticks = formulaDrivenTicks(object);
  if (ticks !== "") {
    ctx.fillStyle = CHROME_FORMULA_TICK_STYLE;
    ctx.textAlign = "right";
    ctx.fillText(ticks, screen.x - halfName - CHROME_GAP_SCREEN, baseline);
  }
}

function drawTableHeaders(ctx: CanvasRenderingContext2D, camera: CameraState, object: GraphObject): void {
  if (object.type !== TABLE_TYPE) {
    return;
  }
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);
  const topLeft = worldToScreen(camera, { x: originX, y: originY });
  const cellCorner = worldToScreen(camera, { x: originX + TABLE_CELL_WIDTH, y: originY + TABLE_CELL_HEIGHT });
  const cellWidthScreen = cellCorner.x - topLeft.x;
  const cellHeightScreen = cellCorner.y - topLeft.y;

  ctx.font = CHROME_FONT;
  ctx.fillStyle = TABLE_HEADER_LABEL_STYLE;

  if (cellWidthScreen >= TABLE_HEADER_MIN_CELL_SCREEN) {
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (let column = 1; column <= cols; column += 1) {
      const centreX = topLeft.x + (column - 0.5) * cellWidthScreen;
      ctx.fillText(indexToColumnLetters(column), centreX, topLeft.y - TABLE_HEADER_MARGIN_SCREEN);
    }
  }

  if (cellHeightScreen >= TABLE_HEADER_MIN_CELL_SCREEN) {
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let row = 1; row <= rows; row += 1) {
      const centreY = topLeft.y + (row - 0.5) * cellHeightScreen;
      ctx.fillText(String(row), topLeft.x - TABLE_HEADER_MARGIN_SCREEN, centreY);
    }
  }
}

function formulaDrivenTicks(object: GraphObject): string {
  const xDriven = getSlot(object, ORIGIN_X_PATH)?.kind === "formula";
  const yDriven = getSlot(object, ORIGIN_Y_PATH)?.kind === "formula";
  if (xDriven && yDriven) {
    return "•x •y";
  }
  if (xDriven) {
    return "•x";
  }
  return yDriven ? "•y" : "";
}
