/**
 * deps.ts
 *
 * extractDependencies walks an AST and returns every address the formula could
 * read. It is eager and total: for an IF it returns the addresses in both
 * branches, not only the branch that is live now.
 *
 * That is deliberate, and it is not a defect. Which branch is live depends on
 * a value that evaluation has not produced yet, and it changes as the document
 * changes. If the graph subscribed only to the live branch, flipping the
 * condition would leave the object reading a slot it never subscribed to, and
 * it would stop updating. formula/eval.ts takes the opposite approach and
 * evaluates lazily, which is the right trade in that direction.
 *
 * The two rewrite passes at the end of the file serve a table resize.
 * rewriteAddressesInAst shifts an address when rows or columns move, and
 * repairAddressesInAst turns an address that no longer exists into a #REF
 * node.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import type { Address } from "../address.ts";
import type { FormulaAst } from "./ast.ts";

export interface ReferenceDependency {
  readonly kind: "reference";
  readonly address: Address;
}

export interface RangeDependency {
  readonly kind: "range";
  readonly start: Address;
  readonly end: Address;
}

export type Dependency = ReferenceDependency | RangeDependency;

/** Every address the AST can read, from both branches of every IF. */
export function extractDependencies(ast: FormulaAst): readonly Dependency[] {
  const dependencies: Dependency[] = [];
  walk(ast, dependencies);
  return dependencies;
}

/** Shifts every address in an AST. A table insert uses this. */
export function rewriteAddressesInAst(ast: FormulaAst, rewrite: (address: Address) => Address): FormulaAst {
  switch (ast.type) {
    case "literal":
    case "error":
      return ast;
    case "reference":
      return { ...ast, address: rewrite(ast.address) };
    case "range":
      return { ...ast, start: rewrite(ast.start), end: rewrite(ast.end) };
    case "binaryOp":
      return { ...ast, left: rewriteAddressesInAst(ast.left, rewrite), right: rewriteAddressesInAst(ast.right, rewrite) };
    case "unaryOp":
      return { ...ast, operand: rewriteAddressesInAst(ast.operand, rewrite) };
    case "functionCall":
      return { ...ast, args: ast.args.map((arg) => rewriteAddressesInAst(arg, rewrite)) };
    default: {
      const exhaustive: never = ast;
      return exhaustive;
    }
  }
}

/** Turns an address that no longer resolves into a #REF node. A table delete uses this. */
export function repairAddressesInAst(
  ast: FormulaAst,
  repairReference: (address: Address) => Address | "deleted",
  repairRange: (start: Address, end: Address) => { readonly start: Address; readonly end: Address } | "deleted",
): FormulaAst {
  switch (ast.type) {
    case "literal":
    case "error":
      return ast;
    case "reference": {
      const repaired = repairReference(ast.address);
      return repaired === "deleted" ? { type: "error", error: "#REF" } : { ...ast, address: repaired };
    }
    case "range": {
      const repaired = repairRange(ast.start, ast.end);
      return repaired === "deleted" ? { type: "error", error: "#REF" } : { ...ast, start: repaired.start, end: repaired.end };
    }
    case "binaryOp":
      return {
        ...ast,
        left: repairAddressesInAst(ast.left, repairReference, repairRange),
        right: repairAddressesInAst(ast.right, repairReference, repairRange),
      };
    case "unaryOp":
      return { ...ast, operand: repairAddressesInAst(ast.operand, repairReference, repairRange) };
    case "functionCall":
      return { ...ast, args: ast.args.map((arg) => repairAddressesInAst(arg, repairReference, repairRange)) };
    default: {
      const exhaustive: never = ast;
      return exhaustive;
    }
  }
}

function walk(node: FormulaAst, out: Dependency[]): void {
  switch (node.type) {
    case "literal":
      return;
    case "reference":
      out.push({ kind: "reference", address: node.address });
      return;
    case "range":
      out.push({ kind: "range", start: node.start, end: node.end });
      return;
    case "binaryOp":
      walk(node.left, out);
      walk(node.right, out);
      return;
    case "unaryOp":
      walk(node.operand, out);
      return;
    case "functionCall":
      for (const arg of node.args) {
        walk(arg, out);
      }
      return;
    case "error":
      return;
    default: {
      const exhaustive: never = node;
      void exhaustive;
      return;
    }
  }
}
