/**
 * editor.ts
 *
 * The in place editor needs a position and a look, and this file decides
 * both.
 *
 * It answers the placement question for a text box and for a table cell.
 * main.ts mounts the real element.
 *
 * The overlay lays out in world units and one transform scales it. Nothing
 * multiplies the zoom into its width or its font size a second time.
 *
 * The file belongs to the render layer. It reads engine state and calls
 * mutations, and it crosses that line for nothing else. The engine holds no
 * import of this file, which keeps the drawing code replaceable.
 */
import {
  type CameraState,
  formatCellReference,
  getTableDimensions,
  type GraphObject,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  parseCellReference,
  TABLE_TYPE,
  TEXT_AUTORESIZE_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_STYLE_ALIGN_PATH,
  TEXT_STYLE_COLOR_PATH,
  TEXT_STYLE_FONT_PATH,
  TEXT_STYLE_FONT_SIZE_PATH,
  TEXT_STYLE_LINE_HEIGHT_PATH,
  TEXT_TYPE,
  TEXT_WIDTH_PATH,
  type TextMeasurer,
} from "../engine/index.ts";
import { screenToWorld, worldToScreen, type ScreenPoint } from "./camera.ts";
import { objectExtent, type WorldExtent } from "./extent.ts";
import { hitTest } from "./hittest.ts";
import { readBoolean, readNumber, readText, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";
import { textBoxSize, TEXT_FALLBACK_BOX_HEIGHT, TEXT_FALLBACK_BOX_WIDTH, type TextBoxSize } from "./textbox.ts";

export type EditorTarget =
  | { readonly kind: "text"; readonly objectId: string }
  | { readonly kind: "cell"; readonly objectId: string; readonly cell: string };

export interface EditorPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

export interface EditorTextStyle {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly lineHeight: number;
  readonly textAlign: "left" | "center" | "right";
  readonly color: string;
  readonly wraps: boolean;
}

const TEXT_EDITOR_FALLBACK_FONT_SIZE = 16;
const TEXT_EDITOR_FALLBACK_LINE_HEIGHT = 20;
const TEXT_EDITOR_FALLBACK_FONT_FAMILY = "sans-serif";
const TEXT_EDITOR_FALLBACK_COLOR = "#1a1a1a";
const CELL_EDITOR_FONT_SIZE = 14;
const CELL_EDITOR_FONT_FAMILY = "sans-serif";
const CELL_EDITOR_COLOR = "#1a1a1a";

const CARET_ALLOWANCE = 2;

export function editorTargetAt(
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  camera: CameraState,
): EditorTarget | undefined {
  const hit = hitTest(screenPoint, objects, camera);
  if (hit === undefined) {
    return undefined;
  }
  if (hit.type === TEXT_TYPE) {
    return { kind: "text", objectId: hit.id };
  }
  if (hit.type === TABLE_TYPE) {
    const cell = cellReferenceAt(hit, screenPoint, camera);
    return cell === undefined ? undefined : { kind: "cell", objectId: hit.id, cell };
  }
  return undefined;
}

function cellReferenceAt(object: GraphObject, screenPoint: ScreenPoint, camera: CameraState): string | undefined {
  const world = screenToWorld(camera, screenPoint);
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);
  const column = Math.floor((world.x - originX) / TABLE_CELL_WIDTH) + 1;
  const row = Math.floor((world.y - originY) / TABLE_CELL_HEIGHT) + 1;
  if (column < 1 || column > cols || row < 1 || row > rows) {
    return undefined;
  }
  return formatCellReference({ column, row });
}

export function editorPlacement(
  target: EditorTarget,
  object: GraphObject,
  camera: CameraState,
  ratioBackingPerCss: number,
  liveSize?: TextBoxSize,
): EditorPlacement {
  const ratio = usableRatio(ratioBackingPerCss);
  const box = target.kind === "text" ? textEditorBox(object, liveSize) : cellEditorBox(object, target.cell);
  const topLeft = worldToScreen(camera, { x: box.minX, y: box.minY });
  return {
    left: topLeft.x / ratio,
    top: topLeft.y / ratio,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    scale: camera.zoom / ratio,
  };
}

export function editorTextBoxSize(
  object: GraphObject,
  typed: string,
  style: EditorTextStyle,
  measurer: TextMeasurer,
): TextBoxSize {
  const fixedWidth = readNumber(object, TEXT_WIDTH_PATH);
  const wrapWidth = fixedWidth !== undefined && fixedWidth > 0 ? fixedWidth : undefined;
  const measurement = measurer.measure(
    typed,
    { font: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight },
    wrapWidth,
  );
  const box = textBoxSize({
    fixedWidth,
    fixedHeight: readNumber(object, TEXT_HEIGHT_PATH),
    autoresize: readBoolean(object, TEXT_AUTORESIZE_PATH) ?? true,
    measuredWidth: measurement.width,
    measuredHeight: measurement.height,
  });
  return wrapWidth === undefined ? { width: box.width + CARET_ALLOWANCE, height: box.height } : box;
}

export function editorTextStyle(
  target: EditorTarget,
  object: GraphObject,
  _camera: CameraState,
  _ratioBackingPerCss: number,
): EditorTextStyle {
  if (target.kind === "cell") {
    return {
      fontSize: CELL_EDITOR_FONT_SIZE,
      fontFamily: CELL_EDITOR_FONT_FAMILY,
      lineHeight: TABLE_CELL_HEIGHT,
      textAlign: "left",
      color: CELL_EDITOR_COLOR,
      wraps: false,
    };
  }
  const fontSize = readNumber(object, TEXT_STYLE_FONT_SIZE_PATH);
  const lineHeight = readNumber(object, TEXT_STYLE_LINE_HEIGHT_PATH);
  const align = readText(object, TEXT_STYLE_ALIGN_PATH);
  const fixedWidth = readNumber(object, TEXT_WIDTH_PATH);
  const family = readText(object, TEXT_STYLE_FONT_PATH);
  return {
    fontSize: fontSize !== undefined && fontSize > 0 ? fontSize : TEXT_EDITOR_FALLBACK_FONT_SIZE,
    fontFamily: family === undefined || family.trim() === "" ? TEXT_EDITOR_FALLBACK_FONT_FAMILY : family,
    lineHeight: lineHeight !== undefined && lineHeight > 0 ? lineHeight : TEXT_EDITOR_FALLBACK_LINE_HEIGHT,
    textAlign: align === "center" || align === "right" ? align : "left",
    color: readText(object, TEXT_STYLE_COLOR_PATH) ?? TEXT_EDITOR_FALLBACK_COLOR,
    wraps: fixedWidth !== undefined && fixedWidth > 0,
  };
}

function usableRatio(ratioBackingPerCss: number): number {
  return Number.isFinite(ratioBackingPerCss) && ratioBackingPerCss > 0 ? ratioBackingPerCss : 1;
}

function textEditorBox(object: GraphObject, liveSize: TextBoxSize | undefined): WorldExtent {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  if (liveSize !== undefined) {
    return { minX: originX, minY: originY, maxX: originX + liveSize.width, maxY: originY + liveSize.height };
  }
  const extent = objectExtent(object);
  if (extent !== undefined) {
    return extent;
  }
  return {
    minX: originX,
    minY: originY,
    maxX: originX + TEXT_FALLBACK_BOX_WIDTH,
    maxY: originY + TEXT_FALLBACK_BOX_HEIGHT,
  };
}

function cellEditorBox(object: GraphObject, cell: string): WorldExtent {
  const coordinates = parseCellReference(cell);
  const column = coordinates?.column ?? 1;
  const row = coordinates?.row ?? 1;
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const left = originX + (column - 1) * TABLE_CELL_WIDTH;
  const top = originY + (row - 1) * TABLE_CELL_HEIGHT;
  return { minX: left, minY: top, maxX: left + TABLE_CELL_WIDTH, maxY: top + TABLE_CELL_HEIGHT };
}
