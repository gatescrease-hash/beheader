/**
 * drawing.ts
 *
 * The part of the Canvas2D context the renderer draws through. renderer.ts and
 * overlay.ts take this type rather than a whole CanvasRenderingContext2D, so a
 * second backend that implements the same part receives the same geometry,
 * text layout and measurement. The canvas on screen is one backend, and
 * svg-context.ts, which writes a vector picture, is the other.
 *
 * A member joins this list when the renderer starts to use it, and the SVG
 * backend has to implement it in the same change, because the type check fails
 * until it does.
 *
 * Render-layer code: it names a browser type, and touches no DOM.
 */
export type DrawingContext = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "globalAlpha"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "bezierCurveTo"
  | "closePath"
  | "rect"
  | "roundRect"
  | "fill"
  | "stroke"
  | "clip"
  | "fillRect"
  | "strokeRect"
  | "clearRect"
  | "fillText"
  | "measureText"
  | "setLineDash"
  | "setTransform"
  | "save"
  | "restore"
  | "drawImage"
>;
