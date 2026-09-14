/**
 * math.ts
 *
 * Everything that faces MathLive. It turns the LaTeX of a math object into
 * markup, measures that markup, and works out where the element holding it
 * goes on screen.
 *
 * The whole codebase reaches MathLive through this one file. A library that
 * arrives at one door can be replaced behind that door, which matters for a
 * dependency that draws on every frame and that the planned Rust and WebGPU
 * stack has no answer for yet.
 *
 * Notation reaches the screen as an element rather than as paint on the
 * canvas, because convertLatexToMarkup returns markup and a canvas draws none.
 * The element lays out in world units and one transform scales it to the
 * current zoom, which is the arrangement the in place editor already uses.
 * Nothing here multiplies the zoom into a width or a font size as well,
 * because the transform has applied it once already. An element draws above
 * the canvas, so a math object covers a canvas object that the document order
 * puts in front of it.
 *
 * Measurement runs the markup through a real element and reads the box back,
 * so the size follows whatever the fonts of the page do. Results are held
 * against the LaTeX and the size they were measured at, because the
 * measurement runs on every evaluation pass and a pass runs on every
 * keystroke, and a reflow for each one is visible on screen.
 *
 * A measurement taken before the mathematical fonts arrive is short, because
 * the browser falls back to a font with different metrics and notation set in
 * it is narrower than the same notation set in the real one. The gap is about
 * a sixth of the width, which is wide enough to push the end of a formula
 * through the side of its box. So the cache can be emptied, and main.ts empties
 * it and evaluates again each time a font finishes loading.
 *
 * Render-layer code: it reads engine state and calls mutations, and crosses
 * that line for nothing else. Nothing in the engine imports this file, so a
 * GPU renderer can replace the whole layer later.
 */
import { convertLatexToMarkup } from "mathlive/ssr";
import {
  type CameraState,
  type GraphObject,
  type MathStyle,
  type TextMeasurement,
  getSlot,
  MATH_BOX_PADDING,
  MATH_FONT_SIZE,
  MATH_MEASURED_HEIGHT_PATH,
  MATH_MEASURED_WIDTH_PATH,
  MATH_SOURCE_PATH,
  readMathDisplayLatex,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
} from "../engine/index.ts";
import { worldToScreen } from "./camera.ts";

/**
 * The element a measurement runs through. It is the smallest shape a real
 * element satisfies, so a test supplies a fake with fixed sizes and no browser.
 */
export interface MathMeasurementHost {
  innerHTML: string;
  readonly style: { fontSize: string };
  getBoundingClientRect(): { readonly width: number; readonly height: number };
}

/** The markup of one run of notation, ready to put inside an element. */
export function mathMarkup(latex: string): string {
  if (latex.trim() === "") {
    return "";
  }
  return convertLatexToMarkup(latex);
}

/**
 * The number of measurements held at once. A document holds far fewer math
 * objects than this, and the surplus covers the sources an operator passes
 * through while typing one.
 */
const MEASUREMENT_CACHE_LIMIT = 256;

/**
 * A measurer, and the way to make it forget what it measured. A caller empties
 * the cache when something that changes a size has happened outside the
 * document, which so far means a font arriving.
 */
export interface MathMeasurerHandle {
  (latex: string, style: MathStyle): TextMeasurement;
  forget(): void;
}

export function createMathMeasurer(host: MathMeasurementHost): MathMeasurerHandle {
  const cache = new Map<string, TextMeasurement>();

  const measure = (latex: string, style: MathStyle): TextMeasurement => {
    const key = `${style.fontSize}:${latex}`;
    const remembered = cache.get(key);
    if (remembered !== undefined) {
      return remembered;
    }

    host.style.fontSize = `${style.fontSize}px`;
    host.innerHTML = mathMarkup(latex);
    const box = host.getBoundingClientRect();
    const measured: TextMeasurement = { width: box.width, height: box.height };

    if (cache.size >= MEASUREMENT_CACHE_LIMIT) {
      cache.clear();
    }
    cache.set(key, measured);
    return measured;
  };

  measure.forget = (): void => {
    cache.clear();
  };

  return measure;
}

export interface MathOverlayPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly fontSize: number;
  readonly padding: number;
}

function readNumber(object: GraphObject, path: readonly string[]): number | undefined {
  const value = getSlot(object, path)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The LaTeX a math object holds, or an empty string where it holds none. */
export function readMathLatex(object: GraphObject): string {
  const value = getSlot(object, MATH_SOURCE_PATH)?.value;
  return typeof value === "string" ? value : "";
}

/**
 * The LaTeX an object draws, which is its source or one of the forms that show
 * a result. The engine measured the same string through the same function, so
 * the box the canvas drew is the size of what goes into it.
 */
export function readMathDrawnLatex(object: GraphObject): string {
  return readMathDisplayLatex(object);
}

/**
 * The world box of a math object, taken from its origin and the two measured
 * slots. A measurement that has not landed yet leaves the box undefined, and
 * every caller treats that as an object with no place on screen rather than
 * drawing a box of the wrong size.
 */
export function mathWorldBox(object: GraphObject): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  const originX = readNumber(object, ORIGIN_X_PATH);
  const originY = readNumber(object, ORIGIN_Y_PATH);
  const width = readNumber(object, MATH_MEASURED_WIDTH_PATH);
  const height = readNumber(object, MATH_MEASURED_HEIGHT_PATH);
  if (originX === undefined || originY === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { minX: originX, minY: originY, maxX: originX + width, maxY: originY + height };
}

/** Where the element holding the notation goes, in CSS pixels. */
export function mathOverlayPlacement(
  object: GraphObject,
  camera: CameraState,
  ratioBackingPerCss: number,
): MathOverlayPlacement | undefined {
  const box = mathWorldBox(object);
  if (box === undefined) {
    return undefined;
  }
  const ratio = Number.isFinite(ratioBackingPerCss) && ratioBackingPerCss > 0 ? ratioBackingPerCss : 1;
  const topLeft = worldToScreen(camera, { x: box.minX, y: box.minY });
  return {
    left: topLeft.x / ratio,
    top: topLeft.y / ratio,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    scale: camera.zoom / ratio,
    fontSize: MATH_FONT_SIZE,
    padding: MATH_BOX_PADDING,
  };
}
