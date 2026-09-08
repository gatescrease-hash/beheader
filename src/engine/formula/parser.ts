/**
 * parser.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * Tokens to AST, by recursive descent. Stage two of four.
 *
 * The parser resolves an object name to an ID here. So a formula that names an
 * object which does not exist fails to parse, in any branch.
 *
 * A depth limit stops a deep input before it exhausts the stack.
 */

import { type Address, type AddressableObject, bareCellAddress, isAddressError, isCellReferenceForm, parseAddress } from "../address.ts";
import { MAX_FORMULA_AST_DEPTH, type BinaryOperator, type FormulaAst } from "./ast.ts";
import { checkArity, getFunctionEntry, RANGE_ACCEPTING_FUNCTION_NAMES } from "./functions.ts";
import { lex, type LexError, type Token } from "./lexer.ts";

export interface ParseError {
  readonly error: "#PARSE";
  readonly message: string;
  readonly start: number;
}

export function isParseError(value: unknown): value is ParseError {
  return typeof value === "object" && value !== null && "error" in value && value.error === "#PARSE";
}

function isLexError(result: readonly Token[] | LexError): result is LexError {
  return !Array.isArray(result);
}

export const MAX_FORMULA_PARSE_DEPTH = 256;

const OR_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([["or", "OR"]]);
const AND_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([["and", "AND"]]);
const COMPARISON_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([
  ["eq", "="],
  ["ne", "<>"],
  ["lt", "<"],
  ["gt", ">"],
  ["le", "<="],
  ["ge", ">="],
]);
const ADDITIVE_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([
  ["plus", "+"],
  ["minus", "-"],
]);
const MULTIPLICATIVE_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([
  ["star", "*"],
  ["slash", "/"],
  ["percent", "%"],
]);
const POWER_OPERATOR_TOKENS: ReadonlyMap<string, BinaryOperator> = new Map([["caret", "^"]]);

interface ParserState {
  readonly tokens: readonly Token[];
  pos: number;
  depth: number;
  readonly objects: readonly AddressableObject[];
  readonly tableObjectId: string | undefined;
}

function peek(state: ParserState): Token {
  return state.tokens[state.pos] as Token;
}

function peekAt(state: ParserState, offset: number): Token {
  const index = state.pos + offset;
  const clamped = index < state.tokens.length ? index : state.tokens.length - 1;
  return state.tokens[clamped] as Token;
}

function advance(state: ParserState): Token {
  const token = peek(state);
  if (token.type !== "eof") {
    state.pos += 1;
  }
  return token;
}

function unexpectedTokenError(token: Token, expected: string): ParseError {
  const found = token.type === "eof" ? "end of formula" : `"${token.text}"`;
  return { error: "#PARSE", message: `expected ${expected}, found ${found}`, start: token.start };
}

function expect(state: ParserState, type: Token["type"], description: string): Token | ParseError {
  const token = peek(state);
  if (token.type !== type) {
    return unexpectedTokenError(token, description);
  }
  return advance(state);
}

function parseLeftAssociativeExpr(
  state: ParserState,
  nextTier: (state: ParserState) => FormulaAst | ParseError,
  operatorTokens: ReadonlyMap<string, BinaryOperator>,
): FormulaAst | ParseError {
  let left = nextTier(state);
  if (isParseError(left)) {
    return left;
  }
  while (true) {
    const operator = operatorTokens.get(peek(state).type);
    if (operator === undefined) {
      return left;
    }
    advance(state);
    const right = nextTier(state);
    if (isParseError(right)) {
      return right;
    }
    left = { type: "binaryOp", operator, left, right };
  }
}

function parseOrExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parseAndExpr, OR_OPERATOR_TOKENS);
}

function parseAndExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parseComparisonExpr, AND_OPERATOR_TOKENS);
}

function parseComparisonExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parseAdditiveExpr, COMPARISON_OPERATOR_TOKENS);
}

function parseAdditiveExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parseMultiplicativeExpr, ADDITIVE_OPERATOR_TOKENS);
}

function parseMultiplicativeExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parsePowerExpr, MULTIPLICATIVE_OPERATOR_TOKENS);
}

function parsePowerExpr(state: ParserState): FormulaAst | ParseError {
  return parseLeftAssociativeExpr(state, parseUnaryExpr, POWER_OPERATOR_TOKENS);
}

function parseUnaryExpr(state: ParserState): FormulaAst | ParseError {
  return withNestingStep(state, parseUnaryExprInner);
}

function parseUnaryExprInner(state: ParserState): FormulaAst | ParseError {
  const token = peek(state);

  if (token.type === "minus") {
    advance(state);
    const operand = parseUnaryExpr(state);
    if (isParseError(operand)) {
      return operand;
    }
    return { type: "unaryOp", operator: "-", operand };
  }

  if (token.type === "not" && peekAt(state, 1).type !== "lparen") {
    advance(state);
    const operand = parseUnaryExpr(state);
    if (isParseError(operand)) {
      return operand;
    }
    return { type: "unaryOp", operator: "NOT", operand };
  }

  return parsePrimaryExpr(state);
}

function isFunctionNameToken(token: Token): boolean {
  return token.type === "identifier" || token.type === "and" || token.type === "or" || token.type === "not";
}

function parsePrimaryExpr(state: ParserState): FormulaAst | ParseError {
  return withNestingStep(state, parsePrimaryExprInner);
}

function withNestingStep(
  state: ParserState,
  tier: (state: ParserState) => FormulaAst | ParseError,
): FormulaAst | ParseError {
  state.depth += 1;
  const result =
    state.depth > MAX_FORMULA_PARSE_DEPTH
      ? {
          error: "#PARSE" as const,
          message: `formula nests too deeply (limit ${MAX_FORMULA_PARSE_DEPTH} nesting steps); split it across cells, or over several slots`,
          start: peek(state).start,
        }
      : tier(state);
  state.depth -= 1;
  return result;
}

function parsePrimaryExprInner(state: ParserState): FormulaAst | ParseError {
  const token = peek(state);

  if (token.type === "number" || token.type === "string" || token.type === "boolean") {
    advance(state);
    return { type: "literal", value: token.value };
  }

  if (token.type === "lparen") {
    advance(state);
    const inner = parseOrExpr(state);
    if (isParseError(inner)) {
      return inner;
    }
    const closing = expect(state, "rparen", '")"');
    if (isParseError(closing)) {
      return closing;
    }
    return inner;
  }

  if (isFunctionNameToken(token) && peekAt(state, 1).type === "lparen") {
    return parseFunctionCallExpr(state, token.text);
  }

  if (token.type === "identifier") {
    return parseReferenceOrRangeExpr(state);
  }

  return unexpectedTokenError(token, "an expression");
}

function parseFunctionCallExpr(state: ParserState, name: string): FormulaAst | ParseError {
  const nameToken = peek(state);
  advance(state);

  const openParen = expect(state, "lparen", '"("');
  if (isParseError(openParen)) {
    return openParen;
  }

  const args: FormulaAst[] = [];
  if (peek(state).type !== "rparen") {
    const first = parseOrExpr(state);
    if (isParseError(first)) {
      return first;
    }
    args.push(first);
    while (peek(state).type === "comma") {
      advance(state);
      const next = parseOrExpr(state);
      if (isParseError(next)) {
        return next;
      }
      args.push(next);
    }
  }

  const closeParen = expect(state, "rparen", '")" to close the argument list');
  if (isParseError(closeParen)) {
    return closeParen;
  }

  const entry = getFunctionEntry(name);
  if (entry === undefined) {
    return { error: "#PARSE", message: `unknown function "${name}"`, start: nameToken.start };
  }
  const arityCheck = checkArity(entry.name, entry.arity, args.length);
  if (!arityCheck.ok) {
    return { error: "#PARSE", message: arityCheck.message, start: nameToken.start };
  }

  return { type: "functionCall", name, args };
}

function parseReferenceOrRangeExpr(state: ParserState): FormulaAst | ParseError {
  const startAddress = parseReferenceAddress(state);
  if (isParseError(startAddress)) {
    return startAddress;
  }

  if (peek(state).type === "colon") {
    advance(state);
    const endAddress = parseReferenceAddress(state);
    if (isParseError(endAddress)) {
      return endAddress;
    }
    return { type: "range", start: startAddress, end: endAddress };
  }

  return { type: "reference", address: startAddress };
}

function parseReferenceAddress(state: ParserState): Address | ParseError {
  const startToken = peek(state);

  const first = consumePathSegment(state);
  if (isParseError(first)) {
    return first;
  }
  const segments: string[] = [first];

  while (peek(state).type === "dot") {
    advance(state);
    const next = consumePathSegment(state);
    if (isParseError(next)) {
      return next;
    }
    segments.push(next);
  }

  if (segments.length === 1) {
    const only = segments[0] as string;
    if (state.tableObjectId !== undefined && isCellReferenceForm(only)) {
      return bareCellAddress(state.tableObjectId, only);
    }
  }

  const resolved = parseAddress(segments.join("."), state.objects);
  if (isAddressError(resolved)) {
    return { error: "#PARSE", message: resolved.message, start: startToken.start };
  }
  return resolved;
}

function consumePathSegment(state: ParserState): string | ParseError {
  const token = peek(state);
  if (token.type === "identifier" || token.type === "number") {
    advance(state);
    return token.text;
  }
  return unexpectedTokenError(token, "a name or path segment");
}

function validateRangePlacement(ast: FormulaAst): ParseError | undefined {
  return walkForRangePlacement(ast, false, 1);
}

function walkForRangePlacement(
  node: FormulaAst,
  isDirectAggregateArgument: boolean,
  depth: number,
): ParseError | undefined {
  if (depth > MAX_FORMULA_AST_DEPTH) {
    return {
      error: "#PARSE",
      message: `formula has more than ${MAX_FORMULA_AST_DEPTH} nested operations; split it across cells, or use SUM over a range`,
      start: 0,
    };
  }
  switch (node.type) {
    case "range":
      if (!isDirectAggregateArgument) {
        return {
          error: "#PARSE",
          message:
            "a range (e.g. A1:B4) is only legal as a direct argument to an aggregate function (SUM, MIN, MAX, AVG)",
          start: 0,
        };
      }
      if (node.start.objectId !== node.end.objectId) {
        return {
          error: "#PARSE",
          message: "a range's two endpoints must be cells in the same table",
          start: 0,
        };
      }
      return undefined;
    case "literal":
    case "reference":
    case "error":
      return undefined;
    case "binaryOp":
      return walkForRangePlacement(node.left, false, depth + 1) ?? walkForRangePlacement(node.right, false, depth + 1);
    case "unaryOp":
      return walkForRangePlacement(node.operand, false, depth + 1);
    case "functionCall": {
      const isAggregate = RANGE_ACCEPTING_FUNCTION_NAMES.has(node.name);
      for (const arg of node.args) {
        const error = walkForRangePlacement(arg, isAggregate, depth + 1);
        if (error !== undefined) {
          return error;
        }
      }
      return undefined;
    }
    default: {
      const exhaustive: never = node;
      return {
        error: "#PARSE",
        message: `unrecognised formula AST node: ${JSON.stringify(exhaustive)}`,
        start: 0,
      };
    }
  }
}

export function parseFormulaTokens(
  tokens: readonly Token[],
  objects: readonly AddressableObject[],
  tableObjectId?: string,
): FormulaAst | ParseError {
  const state: ParserState = { tokens, pos: 0, depth: 0, objects, tableObjectId };

  if (peek(state).type === "eof") {
    return { error: "#PARSE", message: "empty formula", start: peek(state).start };
  }

  const ast = parseOrExpr(state);
  if (isParseError(ast)) {
    return ast;
  }

  const trailing = peek(state);
  if (trailing.type !== "eof") {
    return {
      error: "#PARSE",
      message: `unexpected trailing input starting at "${trailing.text}"`,
      start: trailing.start,
    };
  }

  const placementError = validateRangePlacement(ast);
  if (placementError !== undefined) {
    return placementError;
  }

  return ast;
}

export function parseFormula(
  source: string,
  objects: readonly AddressableObject[],
  tableObjectId?: string,
): FormulaAst | ParseError {
  const tokens = lex(source);
  if (isLexError(tokens)) {
    return tokens;
  }
  return parseFormulaTokens(tokens, objects, tableObjectId);
}
