/**
 * export.ts
 *
 * A picture of the document or of the selection, as section 22 of SPEC.md asks
 * for: the frame it covers, the objects it holds, the notation drawn into it,
 * and the vector form written through svg-context.ts.
 *
 * A picture holds the objects alone. The renderer runs with its chrome turned
 * off, so no name label, table header, group outline or selection mark reaches
 * it, and the frame is the box around the objects drawn with a margin, at one
 * picture unit for each world unit before any scale.
 *
 * Notation is not paint. The canvas on screen shows it as an element above the
 * canvas, so a picture needs it drawn in along a path of its own. Each run of
 * notation becomes an item: the box it fills, the size its type was measured
 * at, and its LaTeX. The vector form writes each item as MathML inside a
 * foreignObject, and the raster form, which main.ts draws, lays each item over
 * the canvas as a small picture of that MathML. MathML has no macros, so the
 * two the program defines are expanded first, from the same definitions the
 * screen uses.
 *
 * A picture of a frame covers the frame's box exactly, with no margin, and
 * draws everything that overlaps it, cut at its edges by the edges of the
 * picture.
 *
 * A selection picture holds the selected objects and everything inside a
 * selected group, and covers their box. An object outside the selection stays
 * out of the picture even where it overlaps the frame, because a picture of
 * part of a drawing is a picture of that part.
 *
 * Render-layer code: it builds strings and boxes, and touches no DOM. The
 * MathML conversion, the text measurer and the image URLs come in from main.ts.
 */
import { displayObjects, getSlot, groupDescendants, MATH_BOX_PADDING, MATH_FONT_SIZE, mathSourceWithNames, type CameraState, type GraphObject } from "../engine/index.ts";
import { objectExtent, type WorldExtent } from "./extent.ts";
import type { ImageBitmaps } from "./images.ts";
import { MATH_MACROS, mathWorldBox, readMathDrawnLatex } from "./math.ts";
import { renderDocument, type MathRunMeasurer, type TextMathRun } from "./renderer.ts";
import { SvgContext, type SvgTextMeasurer } from "./svg-context.ts";

/** The space a picture leaves around its objects, in world units. */
export const EXPORT_MARGIN = 16;

/** The largest side of a raster picture, in pixels, which every browser can allocate. */
export const MAX_EXPORT_PIXELS = 8192;

/** The colour of the ground under a picture. */
export const EXPORT_BACKGROUND = "#ffffff";

/** One run of notation in a picture, in world units. */
export interface NotationItem {
  readonly latex: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly padding: number;
  readonly color: string;
  /** A math object sets its notation as a display, and a run inside text sets it inline. */
  readonly display: boolean;
}

/**
 * The objects a picture holds: every object, or, when a selection is given,
 * the selected objects and everything inside a selected group, in document
 * order.
 */
export function exportedObjects(objects: readonly GraphObject[], selectedIds?: readonly string[]): readonly GraphObject[] {
  if (selectedIds === undefined) {
    return objects;
  }
  const chosen = new Set(selectedIds);
  for (const id of selectedIds) {
    for (const member of groupDescendants(id, objects)) chosen.add(member.id);
  }
  return objects.filter((object) => chosen.has(object.id) || object.type === "doc" || object.type === "layer");
}

/**
 * The box a picture covers: the objects it draws, with the margin around them.
 * A picture leaves the outline of a group out, so its members' boxes stand for it.
 * Undefined when nothing in the list has a box.
 */
export function exportFrame(objects: readonly GraphObject[]): WorldExtent | undefined {
  let frame: WorldExtent | undefined;
  for (const object of displayObjects(objects)) {
    const box = object.type === "group" ? undefined : objectExtent(object);
    if (box === undefined) continue;
    frame = frame === undefined
      ? box
      : { minX: Math.min(frame.minX, box.minX), minY: Math.min(frame.minY, box.minY), maxX: Math.max(frame.maxX, box.maxX), maxY: Math.max(frame.maxY, box.maxY) };
  }
  return frame === undefined
    ? undefined
    : { minX: frame.minX - EXPORT_MARGIN, minY: frame.minY - EXPORT_MARGIN, maxX: frame.maxX + EXPORT_MARGIN, maxY: frame.maxY + EXPORT_MARGIN };
}

/**
 * Every run of notation a picture holds: the notation of each math object on
 * show, in the box the object fills, and each run inside a text object, where
 * the layout of that text put it.
 */
export function notationItems(objects: readonly GraphObject[], textRuns: readonly TextMathRun[]): readonly NotationItem[] {
  const items: NotationItem[] = [];
  for (const object of displayObjects(objects)) {
    if (object.type !== "math") continue;
    const box = mathWorldBox(object);
    const latex = mathSourceWithNames(readMathDrawnLatex(object), objects);
    if (box === undefined || latex.trim() === "") continue;
    items.push({ latex, x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY, fontSize: MATH_FONT_SIZE, padding: MATH_BOX_PADDING, color: "#1a1a1a", display: true });
  }
  const byId = new Map(objects.map((object) => [object.id, object]));
  for (const run of textRuns) {
    if (run.latex.trim() === "") continue;
    const color = getSlot(byId.get(run.objectId) ?? { id: "", name: "", type: "text", slots: {} }, ["style", "color"])?.value;
    items.push({ latex: run.latex, x: run.x, y: run.y, width: run.width, height: run.height, fontSize: run.fontSize, padding: 0, color: typeof color === "string" ? color : "#000000", display: false });
  }
  return items;
}

/**
 * LaTeX with the program's own macros written out, because MathML conversion
 * knows none of them. Each macro takes one argument in braces, which may hold
 * braces of its own.
 */
export function expandMathMacros(latex: string): string {
  let out = latex;
  for (const [name, body] of Object.entries(MATH_MACROS)) {
    const opening = `\\${name}{`;
    let at = out.indexOf(opening);
    while (at !== -1) {
      let depth = 1;
      let index = at + opening.length;
      while (index < out.length && depth > 0) {
        if (out[index] === "{") depth += 1;
        else if (out[index] === "}") depth -= 1;
        index += 1;
      }
      if (depth !== 0) break;
      const argument = out.slice(at + opening.length, index - 1);
      const expanded = body.replace(/#1/g, argument);
      out = out.slice(0, at) + expanded + out.slice(index);
      at = out.indexOf(opening, at + expanded.length);
    }
  }
  return out;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The element that holds one run of notation, sized and coloured as the screen shows it. */
function notationBlock(item: NotationItem, mathml: string): string {
  const style = `font-size:${item.fontSize}px;line-height:1;padding:${item.padding}px;color:${escapeXml(item.color)};margin:0;overflow:visible;white-space:nowrap`;
  const math = `<math xmlns="http://www.w3.org/1998/Math/MathML"${item.display ? ` display="block"` : ""}>${mathml}</math>`;
  return `<div xmlns="http://www.w3.org/1999/xhtml" style="${style}">${math}</div>`;
}

/** One run of notation as an element of a picture whose origin is the frame's corner. */
export function notationForeignObject(item: NotationItem, frame: WorldExtent, mathml: string): string {
  const x = item.x - frame.minX;
  const y = item.y - frame.minY;
  return `<foreignObject x="${x}" y="${y}" width="${item.width}" height="${item.height}" overflow="visible">${notationBlock(item, mathml)}</foreignObject>`;
}

/**
 * One run of notation as a picture of its own, at a scale, for the raster form
 * to lay over its canvas. The view box keeps the layout in world units, so the
 * notation is set at its own size and drawn sharp at the scale.
 */
export function notationPicture(item: NotationItem, mathml: string, scale: number): string {
  const width = Math.max(1, Math.ceil(item.width * scale));
  const height = Math.max(1, Math.ceil(item.height * scale));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${item.width} ${item.height}">`
    + `<foreignObject x="0" y="0" width="${item.width}" height="${item.height}" overflow="visible">${notationBlock(item, mathml)}</foreignObject></svg>`;
}

/** The camera that puts a frame's corner at the picture's origin, at a scale. */
export function exportCamera(frame: WorldExtent, scale: number): CameraState {
  return { x: frame.minX, y: frame.minY, zoom: scale };
}

export interface SvgExportOptions {
  readonly measureText: SvgTextMeasurer;
  readonly mathml: (latex: string) => string;
  readonly images?: ImageBitmaps;
  readonly measureMath?: MathRunMeasurer;
  /** The box the picture covers exactly, for a picture of a frame, in place of the box around the objects. */
  readonly frame?: WorldExtent;
}

/**
 * The vector picture of a list of objects, or undefined when nothing in it has
 * a box. The renderer draws into an SvgContext exactly as it draws into the
 * canvas, with its chrome off, and the notation goes in on top.
 */
export function exportSvg(objects: readonly GraphObject[], options: SvgExportOptions): string | undefined {
  const frame = options.frame ?? exportFrame(objects);
  if (frame === undefined) {
    return undefined;
  }
  const width = frame.maxX - frame.minX;
  const height = frame.maxY - frame.minY;
  const hrefs = new WeakMap<object, string>();
  const images: ImageBitmaps | undefined = options.images === undefined ? undefined : {
    bitmapFor(source) {
      const bitmap = options.images?.bitmapFor(source);
      if (bitmap !== undefined) hrefs.set(bitmap.image, source);
      return bitmap;
    },
  };
  const context = new SvgContext(width, height, options.measureText, (image) => hrefs.get(image));
  const report = renderDocument(context, width, height, objects, exportCamera(frame, 1), [], [], undefined, images, undefined, undefined, options.measureMath, undefined, false);
  for (const item of notationItems(objects, report.mathRuns)) {
    context.append(notationForeignObject(item, frame, options.mathml(expandMathMacros(item.latex))));
  }
  return context.toString(EXPORT_BACKGROUND);
}
