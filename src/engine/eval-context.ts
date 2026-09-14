/**
 * eval-context.ts
 *
 * Declares TextMeasurer, the one interface the engine uses to ask how wide a
 * run of text is, and EvalContext, the record that carries a measurer into
 * evaluation.
 *
 * Text layout needs glyph widths, and a glyph width needs a canvas, which the
 * engine cannot open. So the engine declares the interface and takes an
 * implementation from outside it: render/measure.ts supplies the real one,
 * main.ts wires it in, and a test supplies a fake with fixed widths.
 *
 * This file imports nothing at all, so nothing can pull a DOM dependency into
 * the engine through it.
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
