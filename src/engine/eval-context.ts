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

import type { Value } from "./graph/node.ts";
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

/** One run of a script: its source and the value of each input port. */
export interface ScriptRequest {
  readonly source: string;
  readonly inputs: Readonly<Record<string, Value>>;
}

export type ScriptAnswer =
  /** What the script returned, before scriptValue in script.ts checks each entry. */
  | { readonly status: "done"; readonly outputs: Readonly<Record<string, unknown>> }
  | { readonly status: "pending" }
  | { readonly status: "failed"; readonly message: string };

/**
 * Answers a script request at once, from whatever the host already knows.
 * Running Python takes time and happens outside the engine, so a host answers
 * "pending" for a request it has not finished, runs it elsewhere, and
 * evaluates again when the answer arrives. The engine never waits.
 */
export interface ScriptRunner {
  run(request: ScriptRequest): ScriptAnswer;
}

export interface EvalContext {
  readonly measurer: TextMeasurer;
  /** Absent in a context with no script runtime, where a script output shows its placeholder. */
  readonly scripts?: ScriptRunner;
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
