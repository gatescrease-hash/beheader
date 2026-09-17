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
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly font: string;
  readonly fontSize: number;
  readonly lineHeight: number;
}

export interface TextMeasurement {
  readonly width: number;
  readonly height: number;
}

/** The size a run of mathematical notation is drawn at. */
export interface MathStyle {
  readonly fontSize: number;
}

export interface TextMeasurer {
  measure(text: string, style: TextStyle, maxWidth?: number): TextMeasurement;

  /**
   * The size one run of mathematical notation takes, given its LaTeX. It is
   * optional because a measurer written before the math object existed answers
   * for text alone, and a fake in a test that never meets a math object has no
   * reason to grow one. A math object asked to measure itself through a
   * measurer without this method reports a measurement error rather than a
   * guessed size.
   */
  measureMath?(latex: string, style: MathStyle): TextMeasurement;
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

/** Answers whether a context carries a measurer that can size notation. */
export function hasMathMeasurer(context: EvalContext | undefined): context is EvalContext {
  return hasRealMeasurer(context) && typeof context.measurer.measureMath === "function";
}
