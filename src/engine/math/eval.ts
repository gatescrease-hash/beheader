/**
 * eval.ts
 *
 * Evaluates a parsed program over a set of input values. It is the last of the
 * four stages of the math language: lexer, parser, names and eval.
 *
 * evaluateMathObject is the seam the whole language sits behind. The graph
 * evaluator calls it through a compute function on a derived slot and knows
 * nothing about an equation, the same arrangement evaluateScriptOutput gives a
 * script node. A different implementation of this one function, whether it is
 * a library or a Rust port, changes nothing anywhere else.
 *
 * Every operation here terminates. Arithmetic and a function call return at
 * once, a definite integral runs a fixed number of quadrature steps, and a sum
 * or a product runs over a range whose size is checked before the loop starts.
 * So a program that parses always finishes, and the evaluation pass that runs
 * on every mutation has no way to hang.
 *
 * An integral uses Simpson's rule over an even number of intervals. The count
 * is fixed rather than adaptive, because an adaptive rule reaches a different
 * answer as the tolerance changes and evaluation runs again on every mutation.
 * A value that moved on its own between two frames would read as a bug in the
 * document rather than in the quadrature.
 *
 * A number that leaves an operation non-finite becomes an error value instead,
 * because a slot that holds an infinity spreads it silently through everything
 * that reads it.
 *
 * An implicit line is solved by search rather than by algebra. The difference
 * between the two sides of the equation is a function of the unknown, and the
 * solve looks outward from the seed for a place where that difference changes
 * sign, then halves that interval down to the value between the two sides. The
 * search reads the same snapshot of the inputs and the references from its
 * first step to its last, it runs a fixed number of steps whatever the
 * equation, and it starts from a value a slot carries rather than from a
 * guess, which are the four properties section 12 of the spec asks of a solve
 * that runs inside the evaluation pass.
 *
 * The cost of finding a root this way is that a root the curve touches without
 * crossing, such as the one of (x-2)^2 = 0, is invisible to a sign change and
 * gives an error value instead. Algebra would find it. A search over a
 * function this language can build out of an integral and a series has no
 * algebra to call on, and a curve that comes back from zero without passing
 * through it is rare beside one that crosses.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import type { Address } from "../address.ts";
import type { ErrorValue, Value } from "../graph/node.ts";
import type { MathAst, MathProgram, MathSolveLine } from "./ast.ts";

/** The number of intervals Simpson's rule divides an integral into. */
export const MATH_QUADRATURE_INTERVALS = 512;

/**
 * The largest number of terms a sum or a product runs over. A range wider than
 * this is a mistake rather than an intention, and the limit keeps one line of
 * a source from stalling the evaluation pass.
 */
export const MATH_MAX_SERIES_TERMS = 100000;

/**
 * The deepest chain of function calls an evaluation follows. names.ts refuses
 * a source whose functions call each other in a circle, so a program that
 * arrives through a parse stays far below this. The limit covers a program
 * built by hand instead, and it keeps the promise that evaluation terminates a
 * property of this function rather than of the caller.
 */
export const MATH_MAX_CALL_DEPTH = 64;

/**
 * How many rings the search for a root looks through before it gives up. Each
 * ring is twice as far from the seed as the one before it, so the last of this
 * many reaches about 2^51 times the scale of the seed, which is past the point
 * where a double carries whole numbers exactly. The count is the iteration
 * bound that makes a solve terminate.
 */
export const MATH_SOLVE_RINGS = 60;

/**
 * The radius of the first ring, as a fraction of the scale of the seed. It is
 * small enough that a root close to the seed lands in an early ring, and the
 * doubling covers the distance to a far one in few enough steps.
 */
export const MATH_SOLVE_FIRST_RADIUS = 1 / 256;

/**
 * How many times the search halves an interval that holds a root. Each step
 * halves the width, so this many steps take any starting interval below the
 * spacing between two neighbouring doubles, and the loop stops early when the
 * midpoint lands on an end of the interval.
 */
export const MATH_SOLVE_BISECTIONS = 80;

interface Environment {
  readonly values: ReadonlyMap<string, number>;
  /** The value of each document address the source reads, keyed by address. */
  readonly references: ReadonlyMap<string, number>;
  readonly functions: ReadonlyMap<string, { parameters: readonly string[]; body: MathAst }>;
  /** How many function calls enclose this expression. */
  readonly depth: number;
}

class EvalFailure extends Error {
  readonly value: ErrorValue;
  constructor(value: ErrorValue) {
    super(value.message);
    this.value = value;
  }
}

function fail(message: string): never {
  throw new EvalFailure({ error: "#MATH", message });
}

function checkFinite(result: number, what: string): number {
  if (!Number.isFinite(result)) {
    fail(`${what} gave a result that is not a finite number`);
  }
  return result === 0 ? 0 : result;
}

const UNARY_FUNCTIONS: Readonly<Record<string, (x: number) => number>> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
};

const BINARY_FUNCTIONS: Readonly<Record<string, (a: number, b: number) => number>> = {
  min: Math.min,
  max: Math.max,
  mod: (a, b) => a - b * Math.floor(a / b),
};

function evaluateNode(ast: MathAst, environment: Environment): number {
  switch (ast.type) {
    case "number":
      return ast.value;

    case "name": {
      const value = environment.values.get(ast.name);
      if (value === undefined) {
        fail(`"${ast.name}" has no value here`);
      }
      return value;
    }

    case "reference": {
      const key = mathAddressKey(ast.address);
      const value = environment.references.get(key);
      if (value === undefined) {
        fail(`the address "${key}" carries no number here`);
      }
      return value;
    }

    case "negate":
      return checkFinite(-evaluateNode(ast.operand, environment), "a negation");

    case "binary": {
      const left = evaluateNode(ast.left, environment);
      const right = evaluateNode(ast.right, environment);
      switch (ast.operator) {
        case "+":
          return checkFinite(left + right, "an addition");
        case "-":
          return checkFinite(left - right, "a subtraction");
        case "*":
          return checkFinite(left * right, "a multiplication");
        case "/": {
          if (right === 0) {
            throw new EvalFailure({ error: "#DIV0", message: "a division by zero" });
          }
          return checkFinite(left / right, "a division");
        }
        case "^":
          return checkFinite(left ** right, "a power");
      }
      break;
    }

    case "call": {
      const declared = environment.functions.get(ast.name);
      if (declared !== undefined) {
        if (environment.depth >= MATH_MAX_CALL_DEPTH) {
          fail(`a chain of ${MATH_MAX_CALL_DEPTH} function calls is deeper than this language runs`);
        }
        const values = new Map(environment.values);
        for (let index = 0; index < declared.parameters.length; index += 1) {
          const parameter = declared.parameters[index] as string;
          const argument = ast.args[index];
          if (argument === undefined) {
            fail(`"${ast.name}" was called with too few arguments`);
          }
          values.set(parameter, evaluateNode(argument, environment));
        }
        return evaluateNode(declared.body, { ...environment, values, depth: environment.depth + 1 });
      }
      const unary = UNARY_FUNCTIONS[ast.name];
      if (unary !== undefined) {
        const argument = ast.args[0];
        if (argument === undefined) {
          fail(`"${ast.name}" takes one argument`);
        }
        return checkFinite(unary(evaluateNode(argument, environment)), `"${ast.name}"`);
      }
      const binary = BINARY_FUNCTIONS[ast.name];
      if (binary !== undefined) {
        const first = ast.args[0];
        const second = ast.args[1];
        if (first === undefined || second === undefined) {
          fail(`"${ast.name}" takes two arguments`);
        }
        return checkFinite(binary(evaluateNode(first, environment), evaluateNode(second, environment)), `"${ast.name}"`);
      }
      fail(`"${ast.name}" is not a function this language knows`);
      break;
    }

    case "integral":
      return evaluateIntegral(ast, environment);

    case "series":
      return evaluateSeries(ast, environment);
  }
  fail("an expression this evaluator does not read");
}

/** One value of the body of a binding form, with the variable set to at. */
function evaluateAt(body: MathAst, variable: string, at: number, environment: Environment): number {
  const values = new Map(environment.values);
  values.set(variable, at);
  return evaluateNode(body, { ...environment, values });
}

function evaluateIntegral(
  ast: MathAst & { readonly type: "integral" },
  environment: Environment,
): number {
  const lower = evaluateNode(ast.lower, environment);
  const upper = evaluateNode(ast.upper, environment);
  if (lower === upper) {
    return 0;
  }

  const intervals = MATH_QUADRATURE_INTERVALS;
  const width = (upper - lower) / intervals;
  let total = evaluateAt(ast.body, ast.variable, lower, environment) + evaluateAt(ast.body, ast.variable, upper, environment);

  for (let step = 1; step < intervals; step += 1) {
    const weight = step % 2 === 0 ? 2 : 4;
    total += weight * evaluateAt(ast.body, ast.variable, lower + step * width, environment);
  }

  return checkFinite((total * width) / 3, "an integral");
}

function evaluateSeries(ast: MathAst & { readonly type: "series" }, environment: Environment): number {
  const lower = evaluateNode(ast.lower, environment);
  const upper = evaluateNode(ast.upper, environment);

  if (!Number.isInteger(lower) || !Number.isInteger(upper)) {
    fail(`a ${ast.operation} runs between two whole numbers, and this one runs between ${lower} and ${upper}`);
  }
  if (upper < lower) {
    return ast.operation === "sum" ? 0 : 1;
  }
  const terms = upper - lower + 1;
  if (terms > MATH_MAX_SERIES_TERMS) {
    fail(`a ${ast.operation} over ${terms} terms is wider than the limit of ${MATH_MAX_SERIES_TERMS}`);
  }

  let total = ast.operation === "sum" ? 0 : 1;
  for (let step = lower; step <= upper; step += 1) {
    const term = evaluateAt(ast.body, ast.variable, step, environment);
    total = ast.operation === "sum" ? total + term : total * term;
  }
  return checkFinite(total, `a ${ast.operation}`);
}

/**
 * The difference between the two sides of an equation, at one value of the
 * unknown. A root of this function is a value that makes the equation true.
 */
function residualAt(line: MathSolveLine, at: number, environment: Environment): number {
  const values = new Map(environment.values);
  values.set(line.unknown, at);
  const inner = { ...environment, values };
  return checkFinite(evaluateNode(line.left, inner) - evaluateNode(line.right, inner), "an equation");
}

/**
 * The difference at one value, or nothing where the equation has no value
 * there. A square root of a negative number and a division by zero both happen
 * at some values of the unknown and not at others, so a place the equation
 * cannot be read is a place the search steps over rather than a failure of the
 * whole solve.
 */
function residualOrNothing(line: MathSolveLine, at: number, environment: Environment): number | undefined {
  try {
    return residualAt(line, at, environment);
  } catch (failure) {
    if (failure instanceof EvalFailure) {
      return undefined;
    }
    throw failure;
  }
}

/**
 * The value between two points the difference changes sign across, found by
 * halving the interval a fixed number of times. A midpoint the equation cannot
 * be read at stops the halving and fails the solve, because the interval has
 * come apart and no smaller one is left to look in.
 */
function bisect(line: MathSolveLine, lower: number, upper: number, atLower: number, environment: Environment): number {
  let low = lower;
  let high = upper;
  let atLow = atLower;

  for (let step = 0; step < MATH_SOLVE_BISECTIONS; step += 1) {
    const middle = (low + high) / 2;
    if (middle === low || middle === high) {
      break;
    }
    const atMiddle = residualAt(line, middle, environment);
    if (atMiddle === 0) {
      return middle;
    }
    if (atMiddle > 0 === atLow > 0) {
      low = middle;
      atLow = atMiddle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

/**
 * The value of the unknown that satisfies one implicit line, looked for
 * outward from the seed.
 *
 * The search walks rings of doubling radius around the seed and watches the
 * two ends of each ring. A ring whose ends carry differences of opposite sign
 * holds a root between them, and both sides of that ring are checked before
 * either answer is taken, so the nearer of two roots at a similar distance is
 * the one that comes back.
 *
 * Two roots inside one ring on the same side hide each other, because the two
 * ends of the ring then carry the same sign. A smaller first radius narrows
 * that window without closing it, and a seed near the root an operator wants
 * is what closes it.
 */
function solveLine(line: MathSolveLine, seed: number, environment: Environment): number {
  const atSeed = residualAt(line, seed, environment);
  if (atSeed === 0) {
    return seed;
  }

  // The radius grows with the size of the seed, so a search around a million
  // takes its steps in units of a million rather than crawling out from the
  // seed in fractions.
  const scale = Math.max(1, Math.abs(seed));
  let insideRadius = 0;
  let atInsideAbove: number | undefined = atSeed;
  let atInsideBelow: number | undefined = atSeed;

  for (let ring = 0; ring < MATH_SOLVE_RINGS; ring += 1) {
    const radius = MATH_SOLVE_FIRST_RADIUS * scale * 2 ** ring;
    if (!Number.isFinite(radius)) {
      break;
    }
    const above = seed + radius;
    const below = seed - radius;
    const atAbove = residualOrNothing(line, above, environment);
    const atBelow = residualOrNothing(line, below, environment);

    let found: number | undefined;
    if (atAbove !== undefined && atInsideAbove !== undefined && (atAbove === 0 || atAbove > 0 !== atInsideAbove > 0)) {
      found = atAbove === 0 ? above : bisect(line, seed + insideRadius, above, atInsideAbove, environment);
    }
    if (atBelow !== undefined && atInsideBelow !== undefined && (atBelow === 0 || atBelow > 0 !== atInsideBelow > 0)) {
      const root = atBelow === 0 ? below : bisect(line, below, seed - insideRadius, atBelow, environment);
      if (found === undefined || Math.abs(root - seed) < Math.abs(found - seed)) {
        found = root;
      }
    }
    if (found !== undefined) {
      return found;
    }

    insideRadius = radius;
    atInsideAbove = atAbove;
    atInsideBelow = atBelow;
  }

  fail(
    `the equation for "${line.unknown}" has no place within ${MATH_SOLVE_RINGS} doublings of the seed where its two sides ` +
      `cross, so this line has no root the search can reach. A seed nearer the answer finds a root the search stepped over`,
  );
}

/**
 * The one spelling of an address this language keys a value by. The graph has
 * its own key for an edge, and this one stays inside the box, so a change to
 * either leaves the other alone.
 */
export function mathAddressKey(address: Address): string {
  return `${address.objectId}.${address.path.join(".")}`;
}

export interface MathEvaluation {
  /** The value of each name the source defines, keyed by that name. */
  readonly exports: Readonly<Record<string, Value>>;
}

/**
 * Runs a program over its inputs and returns the value of every name it
 * defines. A line that fails puts an error value on the name it defines and
 * leaves the lines around it alone, because an error on one export is ordinary
 * state rather than a reason to refuse the rest.
 *
 * The inputs, the references and the seeds are copied into maps before the
 * first line runs, so every line and every step of a solve reads the same
 * numbers. A seed a source names and the caller leaves out is read as zero,
 * which is where a search starts before an operator has moved it.
 *
 * This is the one function between the math language and the graph. Nothing
 * above it reads a node type of the language, and nothing below it reads a
 * slot.
 */
export function evaluateMathObject(
  program: MathProgram,
  inputs: Readonly<Record<string, number>>,
  references: Readonly<Record<string, number>> = {},
  seeds: Readonly<Record<string, number>> = {},
): MathEvaluation {
  const values = new Map<string, number>(Object.entries(inputs));
  const referenceValues = new Map<string, number>(Object.entries(references));
  const seedValues = new Map<string, number>(Object.entries(seeds));
  const functions = new Map<string, { parameters: readonly string[]; body: MathAst }>();
  const exports: Record<string, Value> = {};

  for (const line of program.lines) {
    if (line.type === "functionDefinition") {
      functions.set(line.name, { parameters: line.parameters, body: line.body });
      continue;
    }
    if (line.type === "expression") {
      continue;
    }
    const environment: Environment = { values, functions, references: referenceValues, depth: 0 };
    const name = line.type === "solve" ? line.unknown : line.name;
    try {
      const value = line.type === "solve" ? solveLine(line, seedValues.get(line.unknown) ?? 0, environment) : evaluateNode(line.value, environment);
      values.set(name, value);
      exports[name] = value;
    } catch (failure) {
      if (failure instanceof EvalFailure) {
        exports[name] = failure.value;
        continue;
      }
      throw failure;
    }
  }

  return { exports };
}
