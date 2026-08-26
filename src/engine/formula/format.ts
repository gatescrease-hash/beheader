/**
 * format.ts — Turning a stored `FormulaAst` back into the text a user reads.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.2's "displaying a formula maps IDs back to current
 * names", and the report D-040 requires of a `set` that replaces a formula.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   The inverse direction of `parser.ts`. A stored AST holds object IDs (§5.2), so
 *   nothing can show a formula to its author without resolving those IDs against the
 *   document's CURRENT object names — which is the whole reason renaming rewrites no
 *   formulas. This is the one place that resolution happens for display.
 *
 *   Parentheses are re-inserted from §5.3's precedence chain, not remembered: the AST
 *   carries none. So the output is the formula's MEANING spelled canonically, not the
 *   operator's own keystrokes — `1+2 * 3` comes back as `1 + 2 * 3`.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws, for any DOCUMENT state and for any SIZE: an `Address` whose object
 *     is gone formats as the `AddressError`'s own message, the way `mutation.ts`'s
 *     `formatCycleRejection` already handles it, and `formatNode`'s recursion stops at
 *     `ast.ts`'s `MAX_FORMULA_AST_DEPTH` (**D-079**), printing `DEPTH_ELISION` where it
 *     stopped rather than unwinding a `RangeError`. `parser.ts` refuses anything that
 *     deep, so no formula a user can type reaches the elision; §5.11's load path casts a
 *     saved AST unchecked, which is the route by which a deeper one can still arrive.
 *   - An object name is never concatenated here: every reference goes through
 *     `address.ts`'s `formatAddress` (D-015), which also strips a table cell's stored
 *     `cells` prefix so `table_x.A1` prints the way it was typed.
 *   - Re-parsing this output yields an identical AST for every formula §5.3's grammar
 *     can express, with three disclosed exceptions, all of them limits of the LEXER
 *     rather than choices made here: a number outside `[0-9]+(\.[0-9]+)?` (`1e21`)
 *     prints in JS exponent form, which `lexer.ts` cannot read back; a string value
 *     ending in a backslash re-lexes wrong, because §5.3 specifies `\"` as the only
 *     escape and there is none for the backslash itself; and an `ErrorNode` prints
 *     `#REF`, which §5.3 has no syntax for at all (D-028 — it is written by repair, so
 *     it can be displayed but was never typed).
 *
 * NOT DONE HERE
 *   - Deciding WHETHER to show a formula, or where. §5.4's formula bar and the
 *     `set`/`link`/`unlink` reports in `command/commands.ts` are the callers.
 *   - Evaluating anything. A formula's VALUE comes from `graph/eval.ts`; this file
 *     reads no slot and no value.
 *   - Text's `{= }` block tree (§5.6, Phase 5). Its embedded ASTs are this file's
 *     shape and reuse this function; the markup around them is not here.
 */
import { formatAddress, isAddressError, type Address, type AddressableObject } from "../address.ts";
import { MAX_FORMULA_AST_DEPTH, type BinaryOperator, type FormulaAst } from "./ast.ts";

/**
 * What `formatNode` prints in place of a subtree deeper than `MAX_FORMULA_AST_DEPTH`.
 *
 * Not an error code: `#REF` and `#PARSE` say the formula is broken, and a formula this
 * deep is not — it is unreadable, and only reachable through a hand-edited saved file
 * (see the file header). An ellipsis says "there is more here" without inventing a
 * fourth error vocabulary the brief does not have. It does not re-parse, which puts it
 * beside the three round-trip exceptions the header already discloses.
 */
const DEPTH_ELISION = "...";

/**
 * §5.3's precedence chain, loosest to tightest, as the numbers this file compares.
 * The chain itself is `parser.ts`'s — these are the same levels its recursive-descent
 * functions already encode, written as data because re-inserting a parenthesis is a
 * comparison rather than a call graph.
 */
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

/** Tighter than every binary operator, looser than an atom — §5.3's "unary `-` / `NOT`" step. */
const UNARY_PRECEDENCE = 7;

/** A literal, a reference, a range, a call, an error node: never needs a parenthesis around it. */
const ATOM_PRECEDENCE = 8;

/**
 * Formats one formula for display, resolving every stored ID to that object's current
 * name (§5.2).
 *
 * Why it exists: a stored AST is unreadable — `{objectId: "obj_7"}` is not something
 * an operator ever typed — and D-040 requires `set` over a formula slot to report the
 * formula it replaced, which is impossible without this. §5.4's formula bar needs the
 * identical function, so it is written once here rather than twice at two surfaces.
 *
 * Returns the expression WITHOUT a leading `=`. The `=` belongs to the surface that
 * authors a formula (D-071's `set <address> = <source>`), not to the formula, and a
 * caller that wants to echo the authoring form prefixes it.
 *
 * Never throws — not for an address whose object has been deleted, and not for an AST
 * nested past `MAX_FORMULA_AST_DEPTH`, which elides rather than recursing. See the file
 * header's invariants for both.
 */
export function formatFormula(ast: FormulaAst, objects: readonly AddressableObject[]): string {
  return formatNode(ast, objects, 0, 1);
}

/**
 * `minimumPrecedence` is what the PARENT will accept unparenthesized: a node looser
 * than that wraps itself. Passing the requirement down, rather than asking each parent
 * to inspect its children, is what keeps the associativity rule (below) in one place.
 */
function formatNode(
  ast: FormulaAst,
  objects: readonly AddressableObject[],
  minimumPrecedence: number,
  depth: number,
): string {
  // This file's own guard on the same limit `parser.ts` refuses at, kept here rather
  // than assumed away: `document.ts` casts a loaded formula slot's `ast` unchecked, so
  // a hand-edited file is a real path by which an AST no parse could have produced
  // reaches this recursion (the same reasoning `parser.ts`'s own exhaustiveness arm
  // gives). Displaying an elision is a display concern; it stores nothing and rejects
  // nothing.
  if (depth > MAX_FORMULA_AST_DEPTH) {
    return DEPTH_ELISION;
  }
  switch (ast.type) {
    case "literal":
      return formatLiteralValue(ast.value);
    case "reference":
      return formatOneAddress(ast.address, objects);
    case "range":
      // §5.3 stores a range as an endpoint PAIR and both endpoints name the same
      // object (D-045), so both sides print fully qualified rather than one of them
      // shortened — `table_x.A1:table_x.B4` re-parses; `table_x.A1:B4` would not.
      return `${formatOneAddress(ast.start, objects)}:${formatOneAddress(ast.end, objects)}`;
    case "binaryOp": {
      const precedence = BINARY_PRECEDENCE[ast.operator];
      // Every §5.3 binary operator is LEFT-associative, `^` included (D-030). So the
      // left child may sit at this same level unparenthesized and the right child may
      // not: `a - (b - c)` must keep its parenthesis or it re-parses as `(a - b) - c`.
      const left = formatNode(ast.left, objects, precedence, depth + 1);
      const right = formatNode(ast.right, objects, precedence + 1, depth + 1);
      return parenthesizeIfLooser(`${left} ${ast.operator} ${right}`, precedence, minimumPrecedence);
    }
    case "unaryOp": {
      // `NOT` is a word and needs the space; `-` is punctuation and reads better
      // without one. The operand is parenthesized whenever it is not an atom, which
      // covers `-(a + b)` and keeps `- -x` from printing as `--x`.
      const operand = formatNode(ast.operand, objects, ATOM_PRECEDENCE, depth + 1);
      const separator = ast.operator === "NOT" ? " " : "";
      return parenthesizeIfLooser(`${ast.operator}${separator}${operand}`, UNARY_PRECEDENCE, minimumPrecedence);
    }
    case "functionCall":
      return `${ast.name}(${ast.args.map((argument) => formatNode(argument, objects, 0, depth + 1)).join(", ")})`;
    case "error":
      // D-028's repaired reference. Displayable, not re-parseable — see the header.
      return ast.error;
    default: {
      const exhaustive: never = ast;
      void exhaustive;
      return "";
    }
  }
}

/** Wraps `text` only when the node it came from is looser than its parent will accept. */
function parenthesizeIfLooser(text: string, precedence: number, minimumPrecedence: number): string {
  return precedence < minimumPrecedence ? `(${text})` : text;
}

/**
 * Formats one stored `Address` through `address.ts` (D-015 — never `addressKey`, never
 * a hand-joined name and path).
 *
 * An `AddressError` here means the object was deleted out from under a reference that
 * survived, which §5.1.1 is supposed to make impossible; it prints the error's own
 * message rather than throwing, matching every other formatting call site in the
 * engine.
 */
function formatOneAddress(address: Address, objects: readonly AddressableObject[]): string {
  const formatted = formatAddress(address, objects);
  return isAddressError(formatted) ? formatted.message : formatted;
}

/**
 * Formats §5.3's three literal forms back to their source spelling.
 *
 * `TRUE`/`FALSE` are uppercase because that is the only spelling `lexer.ts` recognises.
 * A string is re-quoted with the ONE escape §5.3 specifies (`\"`) and no others — this
 * file must not invent an escape the lexer cannot read.
 */
function formatLiteralValue(value: number | string | boolean): string {
  if (typeof value === "string") {
    return `"${value.replaceAll('"', '\\"')}"`;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return String(value);
}
