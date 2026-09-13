/**
 * eval.ts
 *
 * This file turns an AST into a value, as stage four of four.
 *
 * Evaluation is lazy. IF evaluates one branch. AND and OR stop early. So a
 * runtime error in a branch that nothing takes never happens.
 *
 * Compare formula/deps.ts, which is eager and total.
 *
 * The file belongs to the engine layer and works on plain data alone. It does
 * not use the DOM, a window or a canvas. That keeps it testable without a
 * browser, and ready for a port to Rust.
 */
import type { Address } from "../address.ts";
import type { BinaryOpNode, FormulaAst, FunctionCallNode, UnaryOpNode } from "./ast.ts";
import { checkArity, finiteResult, getFunctionEntry } from "./functions.ts";
import { isErrorValue, type ErrorValue, type Value } from "../graph/node.ts";

export type ReadSlot = (address: Address) => Value | undefined;

export type ReadRange = (start: Address, end: Address) => readonly Value[] | ErrorValue;

function isRangeReadError(result: readonly Value[] | ErrorValue): result is ErrorValue {
  return !Array.isArray(result);
}

type ComparisonOperator = "=" | "<>" | "<" | ">" | "<=" | ">=";
type ArithmeticOperator = "+" | "-" | "*" | "/" | "%" | "^";

function isComparisonOperator(operator: BinaryOpNode["operator"]): operator is ComparisonOperator {
  return operator === "=" || operator === "<>" || operator === "<" || operator === ">" || operator === "<=" || operator === ">=";
}

function isArithmeticOperator(operator: BinaryOpNode["operator"]): operator is ArithmeticOperator {
  return operator === "+" || operator === "-" || operator === "*" || operator === "/" || operator === "%" || operator === "^";
}

export function evaluate(ast: FormulaAst, read: ReadSlot, readRange?: ReadRange): Value {
  return evaluateNode(ast, read, readRange);
}

function evaluateNode(ast: FormulaAst, read: ReadSlot, readRange: ReadRange | undefined): Value {
  switch (ast.type) {
    case "literal":
      return ast.value;
    case "reference":
      return evaluateReference(ast.address, read);
    case "range":
      return evaluateRangeNode();
    case "error":
      return { error: ast.error, message: "this reference was invalidated by a repair pass (#REF)" };
    case "binaryOp":
      return evaluateBinaryOp(ast, read, readRange);
    case "unaryOp":
      return evaluateUnaryOp(ast, read, readRange);
    case "functionCall":
      return evaluateFunctionCall(ast, read, readRange);
    default: {
      const exhaustive: never = ast;
      return { error: "#PARSE", message: `unrecognised formula AST node: ${JSON.stringify(exhaustive)}` };
    }
  }
}

function evaluateReference(address: Address, read: ReadSlot): Value {
  const value = read(address);
  if (value === undefined) {
    return { error: "#REF", message: "formula reference did not resolve to a value" };
  }
  return value;
}

function evaluateRangeNode(): Value {
  return {
    error: "#PARSE",
    message: "range evaluation is not wired in for this caller — no readRange callback was supplied",
  };
}

function evaluateBinaryOp(node: BinaryOpNode, read: ReadSlot, readRange: ReadRange | undefined): Value {
  if (node.operator === "AND") {
    return evaluateAndOperands([node.left, node.right], read, readRange);
  }
  if (node.operator === "OR") {
    return evaluateOrOperands([node.left, node.right], read, readRange);
  }
  if (isComparisonOperator(node.operator)) {
    return evaluateComparison(node.operator, node.left, node.right, read, readRange);
  }
  if (isArithmeticOperator(node.operator)) {
    return evaluateArithmetic(node.operator, node.left, node.right, read, readRange);
  }
  return { error: "#PARSE", message: `unrecognised binary operator: ${JSON.stringify(node.operator)}` };
}

function evaluateUnaryOp(node: UnaryOpNode, read: ReadSlot, readRange: ReadRange | undefined): Value {
  if (node.operator === "NOT") {
    return evaluateNot([node.operand], read, readRange);
  }
  const operandValue = evaluateNode(node.operand, read, readRange);
  if (isErrorValue(operandValue)) {
    return operandValue;
  }
  if (typeof operandValue !== "number") {
    return { error: "#TYPE", message: `unary "-": operand must be a number, got ${describeValueType(operandValue)}` };
  }
  return finiteResult("-", -operandValue);
}

function evaluateComparison(
  operator: ComparisonOperator,
  left: FormulaAst,
  right: FormulaAst,
  read: ReadSlot,
  readRange: ReadRange | undefined,
): Value {
  const leftValue = evaluateNode(left, read, readRange);
  if (isErrorValue(leftValue)) {
    return leftValue;
  }
  const rightValue = evaluateNode(right, read, readRange);
  if (isErrorValue(rightValue)) {
    return rightValue;
  }
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return compareOrdered(operator, leftValue, rightValue);
  }
  if (typeof leftValue === "string" && typeof rightValue === "string") {
    return compareOrdered(operator, leftValue, rightValue);
  }
  if (typeof leftValue === "boolean" && typeof rightValue === "boolean") {
    return compareOrdered(operator, leftValue, rightValue);
  }
  return {
    error: "#TYPE",
    message: `cannot compare ${describeValueType(leftValue)} to ${describeValueType(rightValue)}`,
  };
}

function compareOrdered<T extends number | string | boolean>(
  operator: ComparisonOperator,
  left: T,
  right: T,
): boolean {
  switch (operator) {
    case "=":
      return left === right;
    case "<>":
      return left !== right;
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
  }
}

function evaluateArithmetic(
  operator: ArithmeticOperator,
  left: FormulaAst,
  right: FormulaAst,
  read: ReadSlot,
  readRange: ReadRange | undefined,
): Value {
  const leftValue = evaluateNode(left, read, readRange);
  if (isErrorValue(leftValue)) {
    return leftValue;
  }
  if (typeof leftValue !== "number") {
    return { error: "#TYPE", message: `"${operator}": left operand must be a number, got ${describeValueType(leftValue)}` };
  }
  const rightValue = evaluateNode(right, read, readRange);
  if (isErrorValue(rightValue)) {
    return rightValue;
  }
  if (typeof rightValue !== "number") {
    return { error: "#TYPE", message: `"${operator}": right operand must be a number, got ${describeValueType(rightValue)}` };
  }
  switch (operator) {
    case "+":
      return finiteResult("+", leftValue + rightValue);
    case "-":
      return finiteResult("-", leftValue - rightValue);
    case "*":
      return finiteResult("*", leftValue * rightValue);
    case "/":
      if (rightValue === 0) {
        return { error: "#DIV0", message: "division by zero" };
      }
      return finiteResult("/", leftValue / rightValue);
    case "%":
      if (rightValue === 0) {
        return { error: "#DIV0", message: "modulo by zero" };
      }
      return finiteResult("%", ((leftValue % rightValue) + rightValue) % rightValue);
    case "^":
      return finiteResult("^", Math.pow(leftValue, rightValue));
  }
}

function evaluateAndOperands(operands: readonly FormulaAst[], read: ReadSlot, readRange: ReadRange | undefined): Value {
  for (const operand of operands) {
    const value = evaluateNode(operand, read, readRange);
    if (isErrorValue(value)) {
      return value;
    }
    if (typeof value !== "boolean") {
      return { error: "#TYPE", message: `AND: operand must be a boolean, got ${describeValueType(value)}` };
    }
    if (value === false) {
      return false;
    }
  }
  return true;
}

function evaluateOrOperands(operands: readonly FormulaAst[], read: ReadSlot, readRange: ReadRange | undefined): Value {
  for (const operand of operands) {
    const value = evaluateNode(operand, read, readRange);
    if (isErrorValue(value)) {
      return value;
    }
    if (typeof value !== "boolean") {
      return { error: "#TYPE", message: `OR: operand must be a boolean, got ${describeValueType(value)}` };
    }
    if (value === true) {
      return true;
    }
  }
  return false;
}

function evaluateIf(args: readonly FormulaAst[], read: ReadSlot, readRange: ReadRange | undefined): Value {
  const condition = args[0];
  if (condition === undefined) {
    return { error: "#TYPE", message: "IF: missing condition" };
  }
  const conditionValue = evaluateNode(condition, read, readRange);
  if (isErrorValue(conditionValue)) {
    return conditionValue;
  }
  if (typeof conditionValue !== "boolean") {
    return { error: "#TYPE", message: `IF: condition must be a boolean, got ${describeValueType(conditionValue)}` };
  }
  const branch = conditionValue ? args[1] : args[2];
  if (branch === undefined) {
    return { error: "#TYPE", message: `IF: missing ${conditionValue ? "true" : "false"} branch` };
  }
  return evaluateNode(branch, read, readRange);
}

function evaluateNot(args: readonly FormulaAst[], read: ReadSlot, readRange: ReadRange | undefined): Value {
  const operand = args[0];
  if (operand === undefined) {
    return { error: "#TYPE", message: "NOT: missing argument 1" };
  }
  const operandValue = evaluateNode(operand, read, readRange);
  const entry = getFunctionEntry("NOT");
  if (entry === undefined || entry.evaluationMode !== "eager") {
    return { error: "#TYPE", message: 'NOT: registry entry is missing or not eager (internal error)' };
  }
  return entry.implementation([operandValue]);
}

function evaluateFunctionCall(node: FunctionCallNode, read: ReadSlot, readRange: ReadRange | undefined): Value {
  const entry = getFunctionEntry(node.name);
  if (entry === undefined) {
    return { error: "#TYPE", message: `unknown function "${node.name}"` };
  }

  const arityCheck = checkArity(entry.name, entry.arity, node.args.length);
  if (!arityCheck.ok) {
    return { error: "#TYPE", message: arityCheck.message };
  }

  if (entry.evaluationMode === "lazy") {
    switch (node.name) {
      case "IF":
        return evaluateIf(node.args, read, readRange);
      case "AND":
        return evaluateAndOperands(node.args, read, readRange);
      case "OR":
        return evaluateOrOperands(node.args, read, readRange);
      default:
        return {
          error: "#TYPE",
          message: `"${node.name}" is registered lazy but has no evaluator wired in formula/eval.ts (internal error)`,
        };
    }
  }

  const argValues: Value[] = [];
  for (const arg of node.args) {
    if (arg.type === "range") {
      if (readRange === undefined) {
        return evaluateRangeNode();
      }
      const rangeValues = readRange(arg.start, arg.end);
      if (isRangeReadError(rangeValues)) {
        return rangeValues;
      }
      let firstRangeError: Value | undefined;
      for (const cellValue of rangeValues) {
        if (isErrorValue(cellValue)) {
          firstRangeError = cellValue;
          break;
        }
        argValues.push(cellValue);
      }
      if (firstRangeError !== undefined) {
        return firstRangeError;
      }
      continue;
    }
    const value = evaluateNode(arg, read, readRange);
    if (isErrorValue(value)) {
      return value;
    }
    argValues.push(value);
  }
  return entry.implementation(argValues);
}

function describeValueType(value: Value): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "a point array";
  }
  if (typeof value === "object") {
    return "a point";
  }
  return typeof value;
}
