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
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import type { ErrorValue, Value } from "../graph/node.ts";
import type { MathAst, MathProgram } from "./ast.ts";

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

interface Environment {
  readonly values: ReadonlyMap<string, number>;
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
 * This is the one function between the math language and the graph. Nothing
 * above it reads a node type of the language, and nothing below it reads a
 * slot.
 */
export function evaluateMathObject(program: MathProgram, inputs: Readonly<Record<string, number>>): MathEvaluation {
  const values = new Map<string, number>(Object.entries(inputs));
  const functions = new Map<string, { parameters: readonly string[]; body: MathAst }>();
  const exports: Record<string, Value> = {};

  for (const line of program.lines) {
    if (line.type === "functionDefinition") {
      functions.set(line.name, { parameters: line.parameters, body: line.body });
      continue;
    }
    if (line.type !== "definition") {
      continue;
    }
    try {
      const value = evaluateNode(line.value, { values, functions, depth: 0 });
      values.set(line.name, value);
      exports[line.name] = value;
    } catch (failure) {
      if (failure instanceof EvalFailure) {
        exports[line.name] = failure.value;
        continue;
      }
      throw failure;
    }
  }

  return { exports };
}
