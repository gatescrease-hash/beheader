/**
 * eval-context.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * The TextMeasurer interface and the EvalContext that carries it.
 *
 * Text layout needs glyph widths, and a glyph width needs a canvas. The engine
 * must not open a canvas, so it declares this interface instead. render/
 * supplies the real implementation and main.ts wires it in. A test supplies a
 * fake measurer with fixed widths.
 *
 * This file has no imports at all. That is the point.
 */
export interface TextStyle {
  readonly font: string;
  readonly fontSize: number;
  readonly lineHeight: number;
}

export interface TextMeasurement {
  readonly width: number;
  readonly height: number;
}

export interface TextMeasurer {
  measure(text: string, style: TextStyle, maxWidth?: number): TextMeasurement;
}

export interface EvalContext {
  readonly measurer: TextMeasurer;
}

const NULL_TEXT_MEASURER: TextMeasurer = Object.freeze({
  measure: () => ({ width: 0, height: 0 }),
});

export const NULL_EVAL_CONTEXT: EvalContext = Object.freeze({
  measurer: NULL_TEXT_MEASURER,
});

export function hasRealMeasurer(context: EvalContext | undefined): context is EvalContext {
  return context !== undefined && context.measurer !== NULL_TEXT_MEASURER;
}
