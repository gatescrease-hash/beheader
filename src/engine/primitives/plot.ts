/**
 * plot.ts
 *
 * The slots of a plot, and the rule that samples a math object along one of
 * its inputs into the points the canvas draws.
 *
 * A plot is an object with no equations of its own. Its `curve` slot is a
 * formula that reads one export of a math object, such as `= math_1.out.y`,
 * and its `variable` slot names the input of that object that runs along the
 * horizontal axis. The formula makes the plot an ordinary reader of the math
 * object: a rename rewrites it, a delete of the math object refuses by name,
 * and a move of the object's inputs re-evaluates the plot.
 *
 * The derived `samples` slot runs the math object's program at a fixed number
 * of places from `xmin` to `xmax`, with the variable set to each place and
 * every other input as the math object holds it. A place where the export
 * is something other than a finite number, such as a pole or a square root of a negative,
 * leaves a gap rather than a point, because no number stands for it in plain
 * document state. The count is fixed, so a plot costs the same to evaluate at
 * any zoom and in any document, which Rule 5 asks for.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import type { Address } from "../address.ts";
import { isErrorValue, type GraphObject, type Point, type Value } from "../graph/node.ts";
import { evaluateMathObject } from "../math/eval.ts";
import { isMathSourceError, MATH_SOURCE_PATH, mathEnvironmentDependencies, readMathEnvironment, readMathNames } from "./math.ts";
import type { DerivedSlotSchema } from "./schema.ts";

export const PLOT_CURVE_PATH: readonly string[] = ["curve"];
export const PLOT_VARIABLE_PATH: readonly string[] = ["variable"];
export const PLOT_XMIN_PATH: readonly string[] = ["xmin"];
export const PLOT_XMAX_PATH: readonly string[] = ["xmax"];
export const PLOT_YMIN_PATH: readonly string[] = ["ymin"];
export const PLOT_YMAX_PATH: readonly string[] = ["ymax"];
export const PLOT_WIDTH_PATH: readonly string[] = ["width"];
export const PLOT_HEIGHT_PATH: readonly string[] = ["height"];
export const PLOT_SAMPLES_PATH: readonly string[] = ["samples"];

export const DEFAULT_PLOT_WIDTH = 320;
export const DEFAULT_PLOT_HEIGHT = 200;
export const DEFAULT_PLOT_XMIN = -10;
export const DEFAULT_PLOT_XMAX = 10;
export const DEFAULT_PLOT_STROKE = "#2f6db5";
export const DEFAULT_PLOT_STROKE_WIDTH = 2;

/** How many places a plot samples. 201 puts a sample on each end and on the middle of a symmetric range. */
export const PLOT_SAMPLE_COUNT = 201;

/** The math object and the export a plot's curve reads, where the curve is one export and nothing else. */
export function plotCurveTarget(plot: GraphObject): { readonly objectId: string; readonly exportName: string } | undefined {
  const slot = plot.slots[PLOT_CURVE_PATH.join(".")];
  if (slot?.kind !== "formula" || slot.ast.type !== "reference") {
    return undefined;
  }
  const address: Address = slot.ast.address;
  return address.path.length === 2 && address.path[0] === "out" ? { objectId: address.objectId, exportName: address.path[1]! } : undefined;
}

function finiteNumber(value: Value | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The points of a plot: one for each place along the axis where the export
 * gives a finite number, in the plot's own units, the horizontal first.
 */
function computeSamples(object: GraphObject, read: (address: Address) => Value | undefined): Value {
  const own = (path: readonly string[]): Value | undefined => read({ objectId: object.id, path });
  const target = plotCurveTarget(object);
  if (target === undefined) {
    return { error: "#TYPE", message: `${object.name}.curve must read one export of a math object, such as = math_1.out.y` };
  }
  // The names come from the math object's source rather than its record, so
  // the compute reads through the evaluator alone and never searches the
  // document. A source names exactly the ports the object carries.
  const source = read({ objectId: target.objectId, path: MATH_SOURCE_PATH });
  if (source !== undefined && isErrorValue(source)) {
    return source;
  }
  const reading = typeof source === "string" ? readMathNames(source) : undefined;
  if (reading === undefined || isMathSourceError(reading)) {
    return { error: "#REF", message: `${object.name}.curve reads no math object with a source that reads` };
  }
  const { inputs, exports, seeds } = reading.names;
  const variable = own(PLOT_VARIABLE_PATH);
  if (typeof variable !== "string" || !inputs.includes(variable)) {
    return { error: "#TYPE", message: `${object.name}.variable must name an input of the math object, one of ${inputs.join(", ") || "none"}` };
  }
  const xmin = own(PLOT_XMIN_PATH);
  const xmax = own(PLOT_XMAX_PATH);
  if (xmin !== undefined && isErrorValue(xmin)) return xmin;
  if (xmax !== undefined && isErrorValue(xmax)) return xmax;
  const low = finiteNumber(xmin);
  const high = finiteNumber(xmax);
  if (low === undefined || high === undefined || !(high > low)) {
    return { error: "#TYPE", message: `${object.name} needs xmax above xmin, each a number` };
  }
  const math: GraphObject = { id: target.objectId, name: "", type: "math", slots: {}, ports: { in: inputs, out: exports, ...(seeds.length === 0 ? {} : { seed: seeds }) } };
  const environment = readMathEnvironment(math, read);
  if ("error" in environment) {
    return environment;
  }
  const points: Point[] = [];
  for (let index = 0; index < PLOT_SAMPLE_COUNT; index += 1) {
    const x = low + ((high - low) * index) / (PLOT_SAMPLE_COUNT - 1);
    const evaluation = evaluateMathObject(environment.program, { ...environment.inputs, [variable]: x }, environment.references, environment.seeds);
    const y = evaluation.exports[target.exportName];
    if (typeof y === "number" && Number.isFinite(y)) {
      points.push({ x: x === 0 ? 0 : x, y: y === 0 ? 0 : y });
    }
  }
  return points;
}

/** The derived `samples` of a plot. */
export const PLOT_SAMPLES_SLOT: DerivedSlotSchema = {
  path: PLOT_SAMPLES_PATH,
  dependencies: {
    kind: "dynamic",
    resolve: (object, objects) => {
      const own = [PLOT_CURVE_PATH, PLOT_VARIABLE_PATH, PLOT_XMIN_PATH, PLOT_XMAX_PATH]
        .filter((path) => object.slots[path.join(".")] !== undefined)
        .map((path): Address => ({ objectId: object.id, path }));
      const target = plotCurveTarget(object);
      const math = target === undefined ? undefined : objects.find((candidate) => candidate.id === target.objectId);
      return math?.type === "math" ? [...own, ...mathEnvironmentDependencies(math)] : own;
    },
  },
  compute: (object, read) => computeSamples(object, read),
};
