/**
 * eval-context.ts
 *
 * The engine measures text through the TextMeasurer interface, which
 * EvalContext carries.
 *
 * Text layout needs glyph widths, and a glyph width needs a canvas. The
 * engine does not open a canvas, so it declares this interface instead.
 * render/ supplies the real implementation and main.ts wires it in. A test
 * supplies a fake measurer with fixed widths.
 *
 * This file has no imports at all, so the boundary is real and not only a
 * rule.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
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
