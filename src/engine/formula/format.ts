/**
 * format.ts
 *
 * The formatter turns an AST back into source text. It maps an object ID back
 * to the current name.
 *
 * This is what lets the properties panel and the props command show a formula
 * the way the operator wrote it, after a rename.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import { formatAddress, isAddressError, isCellReferenceForm, TABLE_CELL_PATH_PREFIX, type Address, type AddressableObject } from "../address.ts";
import { MAX_FORMULA_AST_DEPTH, type BinaryOperator, type FormulaAst } from "./ast.ts";

const DEPTH_ELISION = "...";

const BINARY_PRECEDENCE: Readonly<Record<BinaryOperator, number>> = {
  OR: 1,
  AND: 2,
  "=": 3,
  "<>": 3,
  "<": 3,
  ">": 3,
  "<=": 3,
  ">=": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
  "%": 5,
  "^": 6,
};

const UNARY_PRECEDENCE = 7;

const ATOM_PRECEDENCE = 8;

export function formatFormula(
  ast: FormulaAst,
  objects: readonly AddressableObject[],
  relativeToObjectId?: string,
): string {
  return formatNode(ast, objects, 0, 1, relativeToObjectId);
}

function relativeCellReference(address: Address, relativeToObjectId: string | undefined): string | undefined {
  if (relativeToObjectId === undefined || address.objectId !== relativeToObjectId) {
    return undefined;
  }
  const [prefix, cell] = address.path;
  if (address.path.length !== 2 || prefix !== TABLE_CELL_PATH_PREFIX || cell === undefined || !isCellReferenceForm(cell)) {
    return undefined;
  }
  return cell;
}

function formatNode(
  ast: FormulaAst,
  objects: readonly AddressableObject[],
  minimumPrecedence: number,
  depth: number,
  relativeToObjectId: string | undefined,
): string {
  if (depth > MAX_FORMULA_AST_DEPTH) {
    return DEPTH_ELISION;
  }
  switch (ast.type) {
    case "literal":
      return formatLiteralValue(ast.value);
    case "reference":
      return formatOneAddress(ast.address, objects, relativeToObjectId);
    case "range": {
      const start = relativeCellReference(ast.start, relativeToObjectId);
      const end = relativeCellReference(ast.end, relativeToObjectId);
      if (start !== undefined && end !== undefined) {
        return `${start}:${end}`;
      }
      return `${formatOneAddress(ast.start, objects, undefined)}:${formatOneAddress(ast.end, objects, undefined)}`;
    }
    case "binaryOp": {
      const precedence = BINARY_PRECEDENCE[ast.operator];
      const left = formatNode(ast.left, objects, precedence, depth + 1, relativeToObjectId);
      const right = formatNode(ast.right, objects, precedence + 1, depth + 1, relativeToObjectId);
      return parenthesizeIfLooser(`${left} ${ast.operator} ${right}`, precedence, minimumPrecedence);
    }
    case "unaryOp": {
      const operand = formatNode(ast.operand, objects, ATOM_PRECEDENCE, depth + 1, relativeToObjectId);
      const separator = ast.operator === "NOT" ? " " : "";
      return parenthesizeIfLooser(`${ast.operator}${separator}${operand}`, UNARY_PRECEDENCE, minimumPrecedence);
    }
    case "functionCall":
      return `${ast.name}(${ast.args.map((argument) => formatNode(argument, objects, 0, depth + 1, relativeToObjectId)).join(", ")})`;
    case "error":
      return ast.error;
    default: {
      const exhaustive: never = ast;
      void exhaustive;
      return "";
    }
  }
}

function parenthesizeIfLooser(text: string, precedence: number, minimumPrecedence: number): string {
  return precedence < minimumPrecedence ? `(${text})` : text;
}

function formatOneAddress(
  address: Address,
  objects: readonly AddressableObject[],
  relativeToObjectId: string | undefined,
): string {
  const relative = relativeCellReference(address, relativeToObjectId);
  if (relative !== undefined) {
    return relative;
  }
  const formatted = formatAddress(address, objects);
  return isAddressError(formatted) ? formatted.message : formatted;
}

function formatLiteralValue(value: number | string | boolean): string {
  if (typeof value === "string") {
    return `"${value.replaceAll('"', '\\"')}"`;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return String(value);
}
