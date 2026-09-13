/**
 * ast.ts
 *
 * This file declares the AST node types, and it holds a shape check and a
 * depth check.
 *
 * The AST is the interchange format between the four stages of the formula
 * engine. The document also stores it, so a change to these types is a change
 * to the file format.
 *
 * The file belongs to the engine layer and works on plain data alone. It does
 * not use the DOM, a window or a canvas. That keeps it testable without a
 * browser, and ready for a port to Rust.
 */
import type { Address } from "../address.ts";

export interface LiteralNode {
  readonly type: "literal";
  readonly value: number | string | boolean;
}

export interface ReferenceNode {
  readonly type: "reference";
  readonly address: Address;
}

export interface RangeNode {
  readonly type: "range";
  readonly start: Address;
  readonly end: Address;
}

export const BINARY_OPERATORS = ["OR", "AND", "=", "<>", "<", ">", "<=", ">=", "+", "-", "*", "/", "%", "^"] as const;
export type BinaryOperator = (typeof BINARY_OPERATORS)[number];

export interface BinaryOpNode {
  readonly type: "binaryOp";
  readonly operator: BinaryOperator;
  readonly left: FormulaAst;
  readonly right: FormulaAst;
}

export const UNARY_OPERATORS = ["-", "NOT"] as const;
export type UnaryOperator = (typeof UNARY_OPERATORS)[number];

export interface UnaryOpNode {
  readonly type: "unaryOp";
  readonly operator: UnaryOperator;
  readonly operand: FormulaAst;
}

export interface FunctionCallNode {
  readonly type: "functionCall";
  readonly name: string;
  readonly args: readonly FormulaAst[];
}

export interface ErrorNode {
  readonly type: "error";
  readonly error: "#REF";
}

export type FormulaAst =
  | LiteralNode
  | ReferenceNode
  | RangeNode
  | BinaryOpNode
  | UnaryOpNode
  | FunctionCallNode
  | ErrorNode;

export function isReferenceNode(ast: FormulaAst): ast is ReferenceNode {
  return ast.type === "reference";
}

export const MAX_FORMULA_AST_DEPTH = 1000;

export type FormulaAstShapeResult = { readonly ok: true; readonly ast: FormulaAst } | { readonly ok: false; readonly reason: string };

export function validateFormulaAstShape(raw: unknown, depth = 1): FormulaAstShapeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `a formula node must be an object, not ${raw === null ? "null" : Array.isArray(raw) ? "an array" : typeof raw}` };
  }
  const node = raw as Record<string, unknown>;
  if (depth > MAX_FORMULA_AST_DEPTH) {
    return { ok: true, ast: node as unknown as FormulaAst };
  }
  switch (node["type"]) {
    case "literal": {
      const value = node["value"];
      if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") {
        return { ok: false, reason: `a literal node's value must be a number, string, or boolean, not ${describeRaw(value)}` };
      }
      return { ok: true, ast: { type: "literal", value } };
    }
    case "reference": {
      const address = readAddress(node["address"]);
      return address === undefined
        ? { ok: false, reason: "a reference node's address must be { objectId: string, path: string[] }" }
        : { ok: true, ast: { type: "reference", address } };
    }
    case "range": {
      const start = readAddress(node["start"]);
      const end = readAddress(node["end"]);
      return start === undefined || end === undefined
        ? { ok: false, reason: "a range node's start and end must each be { objectId: string, path: string[] }" }
        : { ok: true, ast: { type: "range", start, end } };
    }
    case "binaryOp": {
      const operator = node["operator"];
      if (!isBinaryOperator(operator)) {
        return { ok: false, reason: `${describeRaw(operator)} is not one of the binary operators` };
      }
      const left = validateFormulaAstShape(node["left"], depth + 1);
      if (!left.ok) {
        return left;
      }
      const right = validateFormulaAstShape(node["right"], depth + 1);
      if (!right.ok) {
        return right;
      }
      return { ok: true, ast: { type: "binaryOp", operator, left: left.ast, right: right.ast } };
    }
    case "unaryOp": {
      const operator = node["operator"];
      if (!isUnaryOperator(operator)) {
        return { ok: false, reason: `${describeRaw(operator)} is not one of the prefix operators` };
      }
      const operand = validateFormulaAstShape(node["operand"], depth + 1);
      return operand.ok ? { ok: true, ast: { type: "unaryOp", operator, operand: operand.ast } } : operand;
    }
    case "functionCall": {
      const name = node["name"];
      const rawArgs = node["args"];
      if (typeof name !== "string") {
        return { ok: false, reason: `a function call's name must be a string, not ${describeRaw(name)}` };
      }
      if (!Array.isArray(rawArgs)) {
        return { ok: false, reason: `${name}'s args must be an array, not ${describeRaw(rawArgs)}` };
      }
      const args: FormulaAst[] = [];
      for (const rawArg of rawArgs) {
        const arg = validateFormulaAstShape(rawArg, depth + 1);
        if (!arg.ok) {
          return arg;
        }
        args.push(arg.ast);
      }
      return { ok: true, ast: { type: "functionCall", name, args } };
    }
    case "error": {
      return node["error"] === "#REF"
        ? { ok: true, ast: { type: "error", error: "#REF" } }
        : { ok: false, reason: `an error node's error must be "#REF", not ${describeRaw(node["error"])}` };
    }
    default:
      return { ok: false, reason: `${describeRaw(node["type"])} is not a formula node type` };
  }
}

function readAddress(raw: unknown): Address | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const candidate = raw as Record<string, unknown>;
  const objectId = candidate["objectId"];
  const path = candidate["path"];
  if (typeof objectId !== "string" || !Array.isArray(path) || !path.every((segment) => typeof segment === "string")) {
    return undefined;
  }
  return { objectId, path: path as readonly string[] };
}

function isBinaryOperator(raw: unknown): raw is BinaryOperator {
  return typeof raw === "string" && (BINARY_OPERATORS as readonly string[]).includes(raw);
}

function isUnaryOperator(raw: unknown): raw is UnaryOperator {
  return typeof raw === "string" && (UNARY_OPERATORS as readonly string[]).includes(raw);
}

function describeRaw(raw: unknown): string {
  if (raw === null) {
    return "null";
  }
  if (typeof raw === "string") {
    return JSON.stringify(raw);
  }
  if (Array.isArray(raw)) {
    return "an array";
  }
  return typeof raw === "object" ? "an object" : String(raw);
}

export function exceedsMaxFormulaAstDepth(ast: FormulaAst, depth = 1): boolean {
  if (depth > MAX_FORMULA_AST_DEPTH) {
    return true;
  }
  switch (ast.type) {
    case "literal":
    case "reference":
    case "range":
    case "error":
      return false;
    case "binaryOp":
      return exceedsMaxFormulaAstDepth(ast.left, depth + 1) || exceedsMaxFormulaAstDepth(ast.right, depth + 1);
    case "unaryOp":
      return exceedsMaxFormulaAstDepth(ast.operand, depth + 1);
    case "functionCall":
      return ast.args.some((arg) => exceedsMaxFormulaAstDepth(arg, depth + 1));
    default: {
      const exhaustive: never = ast;
      void exhaustive;
      return false;
    }
  }
}
