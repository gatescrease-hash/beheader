/**
 * ast.ts
 *
 * The node types of the math language, and the program shape that a parsed
 * source text becomes.
 *
 * A MathProgram is a list of lines, because a math object holds one equation
 * for each line of its source the way a Desmos list holds one expression per
 * row. A line either defines a name, defines a function, or stands as an
 * expression that nothing reads.
 *
 * These types are a separate family from the formula AST of formula/ast.ts.
 * The two languages meet at a compute function on a derived slot and nowhere
 * else, so neither parser has to know the node types of the other. The math
 * language carries binding forms, and a formula has none, which is the reason
 * the node sets differ rather than nest.
 *
 * The AST is plain data with no closure and no class instance in it, so a
 * program survives a structured clone and a round trip through JSON. A parse
 * result can therefore sit in a mutation batch beside the slots it implies.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

export interface MathNumberNode {
  readonly type: "number";
  readonly value: number;
}

/**
 * A bare name, local to the object that holds it. The binder in names.ts
 * decides for each one whether an enclosing form binds it, an earlier line
 * defines it, or it is free and becomes an input port.
 */
export interface MathNameNode {
  readonly type: "name";
  readonly name: string;
}

export const MATH_BINARY_OPERATORS = ["+", "-", "*", "/", "^"] as const;
export type MathBinaryOperator = (typeof MATH_BINARY_OPERATORS)[number];

export interface MathBinaryNode {
  readonly type: "binary";
  readonly operator: MathBinaryOperator;
  readonly left: MathAst;
  readonly right: MathAst;
}

export interface MathNegateNode {
  readonly type: "negate";
  readonly operand: MathAst;
}

/**
 * A call of a built-in function such as sin, or of a function an earlier line
 * of the same object defines. The parser does not tell the two apart, because
 * a name it cannot resolve yet may still be defined further down the source.
 */
export interface MathCallNode {
  readonly type: "call";
  readonly name: string;
  readonly args: readonly MathAst[];
}

/**
 * A definite integral over a range. The variable binds over the body alone, so
 * a name that matches it inside the body reads the integration variable rather
 * than an input port of the object.
 */
export interface MathIntegralNode {
  readonly type: "integral";
  readonly variable: string;
  readonly lower: MathAst;
  readonly upper: MathAst;
  readonly body: MathAst;
}

/**
 * A sum or a product over an integer range. The variable binds the same way
 * the integration variable does, and the bounds evaluate outside that binding.
 */
export interface MathSeriesNode {
  readonly type: "series";
  readonly operation: "sum" | "product";
  readonly variable: string;
  readonly lower: MathAst;
  readonly upper: MathAst;
  readonly body: MathAst;
}

export type MathAst =
  | MathNumberNode
  | MathNameNode
  | MathBinaryNode
  | MathNegateNode
  | MathCallNode
  | MathIntegralNode
  | MathSeriesNode;

/** A line that gives a name a value, which becomes an export slot. */
export interface MathDefinitionLine {
  readonly type: "definition";
  readonly name: string;
  readonly value: MathAst;
}

/**
 * A line that defines a function. It creates no slot, because a slot holds a
 * value and the Value union has no function member. Later lines call it.
 */
export interface MathFunctionLine {
  readonly type: "functionDefinition";
  readonly name: string;
  readonly parameters: readonly string[];
  readonly body: MathAst;
}

/**
 * A line that computes something and gives it no name. It reads its inputs
 * like any other line, so it still contributes input ports, and an operator
 * sees its value in the editor.
 */
export interface MathExpressionLine {
  readonly type: "expression";
  readonly value: MathAst;
}

export type MathLine = MathDefinitionLine | MathFunctionLine | MathExpressionLine;

export interface MathProgram {
  readonly lines: readonly MathLine[];
}

/**
 * The depth limit on one expression. A program arrives from a text slot, and
 * an evaluator that walks a node tree recursively runs out of stack on a tree
 * deeper than this. The parser rejects a deeper expression, so evaluation
 * never meets one.
 */
export const MATH_MAX_DEPTH = 64;

/** The depth of the deepest branch of an expression, counting the root as 1. */
export function mathAstDepth(ast: MathAst): number {
  switch (ast.type) {
    case "number":
    case "name":
      return 1;
    case "negate":
      return 1 + mathAstDepth(ast.operand);
    case "binary":
      return 1 + Math.max(mathAstDepth(ast.left), mathAstDepth(ast.right));
    case "call":
      return 1 + ast.args.reduce((deepest, arg) => Math.max(deepest, mathAstDepth(arg)), 0);
    case "integral":
    case "series":
      return 1 + Math.max(mathAstDepth(ast.lower), mathAstDepth(ast.upper), mathAstDepth(ast.body));
  }
}
