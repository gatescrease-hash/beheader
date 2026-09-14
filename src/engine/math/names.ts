/**
 * names.ts
 *
 * Works out what the names in a parsed program mean. It is the third of the
 * four stages of the math language: lexer, parser, names and eval.
 *
 * Every bare name in a math source falls into one of four groups, and the
 * group decides what the object does about it.
 *
 * A bound name comes from an enclosing form. An integral binds the variable of
 * its differential over its integrand, a sum and a product bind the variable
 * of their range over their body, and a function definition binds its
 * parameters over its body. A bound name never reaches the slot set, because
 * the value belongs to the form rather than to the document. So the x of an
 * integral over sin(x_input) arrives with no port, while x_input brings one.
 *
 * A defined name comes from an earlier line of the same source, and it becomes
 * an export slot under out. Earlier is the whole rule: a line reads the names
 * above it and never the names below it, so a circle of definitions inside one
 * object cannot be written, and the evaluator runs with no ordering pass.
 *
 * A free name is neither of those, and it becomes an input port under in. The
 * operator gives it a value or links it to an upstream address.
 *
 * A called name is a function, and it resolves against the built-in table and
 * the function definitions of the same source. A call of anything else is
 * reported here rather than at evaluation time, so a source that cannot work
 * fails the mutation instead of filling every export with an error.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import { isLegalPortName } from "../graph/node.ts";
import type { MathAst, MathProgram } from "./ast.ts";
import { MATH_BUILT_IN_FUNCTIONS } from "./parser.ts";

export interface MathNameError {
  readonly error: "#PARSE";
  readonly message: string;
  readonly line: number;
}

export interface MathNames {
  /** The names the source defines, under out, in the order the lines define them. */
  readonly exports: readonly string[];
  /** The free names, under in, in the order the source first reads them. */
  readonly inputs: readonly string[];
  /** The functions the source defines, each of them with no slot of its own. */
  readonly functions: readonly string[];
}

export function isMathNameError(result: MathNames | MathNameError): result is MathNameError {
  return "error" in result;
}

interface Walk {
  readonly defined: ReadonlySet<string>;
  readonly bound: ReadonlySet<string>;
  /** The functions of earlier lines, with the argument count of each. */
  readonly functions: ReadonlyMap<string, number>;
  /** Every function the source defines, for a message about one defined below. */
  readonly allFunctions: ReadonlySet<string>;
  readonly inputs: string[];
  readonly seenInputs: Set<string>;
}

function withBinding(walk: Walk, name: string): Walk {
  return { ...walk, bound: new Set([...walk.bound, name]) };
}

/**
 * Walks one expression and records every free name it reads. It throws a
 * NameFailure for a call the source cannot satisfy, which the caller turns
 * into the line it happened on.
 */
function walkExpression(ast: MathAst, walk: Walk): void {
  switch (ast.type) {
    case "number":
      return;

    case "name": {
      if (walk.bound.has(ast.name) || walk.defined.has(ast.name)) {
        return;
      }
      if (walk.allFunctions.has(ast.name)) {
        throw new NameFailure(`"${ast.name}" names a function of this object, and a function has no value of its own`);
      }
      if (!isLegalPortName(ast.name)) {
        throw new NameFailure(`"${ast.name}" holds a character that an input port name cannot carry`);
      }
      if (!walk.seenInputs.has(ast.name)) {
        walk.seenInputs.add(ast.name);
        walk.inputs.push(ast.name);
      }
      return;
    }

    case "negate":
      walkExpression(ast.operand, walk);
      return;

    case "binary":
      walkExpression(ast.left, walk);
      walkExpression(ast.right, walk);
      return;

    case "call": {
      const declared = walk.functions.get(ast.name);
      const builtIn = MATH_BUILT_IN_FUNCTIONS[ast.name];
      const arity = declared ?? builtIn;
      if (arity === undefined) {
        if (walk.allFunctions.has(ast.name)) {
          throw new NameFailure(
            `"${ast.name}" is defined below this line, and a line calls the functions above it alone, so a function never calls itself`,
          );
        }
        throw new NameFailure(`"${ast.name}" is not a function this object defines or this language knows`);
      }
      if (ast.args.length !== arity) {
        throw new NameFailure(`"${ast.name}" takes ${arity} argument${arity === 1 ? "" : "s"}, and this call passes ${ast.args.length}`);
      }
      for (const argument of ast.args) {
        walkExpression(argument, walk);
      }
      return;
    }

    case "integral":
    case "series": {
      // A bound holds the value the variable runs between, so it reads the
      // names around the form rather than the variable the form binds.
      walkExpression(ast.lower, walk);
      walkExpression(ast.upper, walk);
      walkExpression(ast.body, withBinding(walk, ast.variable));
      return;
    }
  }
}

class NameFailure extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Reads a program and reports the names it exports, the names it needs and the
 * functions it defines. A name that breaks a rule of the language stops the
 * whole read, because a source whose slot set cannot be worked out is one the
 * mutation refuses.
 */
export function resolveMathNames(program: MathProgram): MathNames | MathNameError {
  const defined = new Set<string>();
  const exports: string[] = [];
  const functions = new Map<string, number>();
  const inputs: string[] = [];
  const seenInputs = new Set<string>();

  const allFunctions = new Set<string>();
  for (let index = 0; index < program.lines.length; index += 1) {
    const line = program.lines[index];
    if (line?.type === "functionDefinition") {
      if (allFunctions.has(line.name)) {
        return { error: "#PARSE", message: `"${line.name}" is defined as a function twice`, line: index };
      }
      allFunctions.add(line.name);
    }
  }

  for (let index = 0; index < program.lines.length; index += 1) {
    const line = program.lines[index];
    if (line === undefined) {
      continue;
    }
    const walk: Walk = { defined, bound: new Set(), functions, allFunctions, inputs, seenInputs };

    try {
      if (line.type === "functionDefinition") {
        let bodyWalk = walk;
        for (const parameter of line.parameters) {
          bodyWalk = withBinding(bodyWalk, parameter);
        }
        walkExpression(line.body, bodyWalk);
        functions.set(line.name, line.parameters.length);
        continue;
      }

      if (line.type === "expression") {
        walkExpression(line.value, walk);
        continue;
      }

      if (defined.has(line.name)) {
        return { error: "#PARSE", message: `"${line.name}" is defined twice, and a name carries one value`, line: index };
      }
      if (allFunctions.has(line.name)) {
        return { error: "#PARSE", message: `"${line.name}" is both a function and a value of this object`, line: index };
      }
      if (!isLegalPortName(line.name)) {
        return { error: "#PARSE", message: `"${line.name}" holds a character that an export name cannot carry`, line: index };
      }
      if (seenInputs.has(line.name)) {
        return {
          error: "#PARSE",
          message: `"${line.name}" is read above the line that defines it, and a line reads the names above it alone`,
          line: index,
        };
      }
      walkExpression(line.value, walk);
      defined.add(line.name);
      exports.push(line.name);
    } catch (failure) {
      if (failure instanceof NameFailure) {
        return { error: "#PARSE", message: failure.message, line: index };
      }
      throw failure;
    }
  }

  return { exports, inputs, functions: [...allFunctions] };
}
