/**
 * parser.ts
 *
 * Turns the tokens of one math source into a MathProgram. It is the second of
 * the four stages of the math language: lexer, parser, names and eval.
 *
 * The parser runs over the source twice. The first pass reads the head of
 * every line and collects the names that the source defines as functions. The
 * second pass parses each line with that set in hand. Two passes are what
 * makes f(x+1) readable: whether a name in front of a bracket calls a function
 * or multiplies by one depends on a definition that may appear further down
 * the source, and a single pass reaching that bracket has not seen it yet.
 *
 * Juxtaposition is multiplication, the way it is on paper, so 2x and xy and
 * 2\sin(x) all parse as products. That rule leaves a differential ambiguous,
 * because the dx closing an integral would otherwise read as d times x. The
 * integrand therefore parses under a flag that ends a product at an identifier
 * named d that another identifier follows, and the integral consumes the pair.
 * A name spelled d inside an integrand is the cost of that rule.
 *
 * Every parse failure carries the offset it happened at, so a message can
 * point into the source the operator typed.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import {
  MATH_MAX_DEPTH,
  mathAstDepth,
  type MathAst,
  type MathBinaryOperator,
  type MathLine,
  type MathProgram,
} from "./ast.ts";
import { isMathLexError, tokenizeMath, type MathToken } from "./lexer.ts";

export interface MathParseError {
  readonly error: "#PARSE";
  readonly message: string;
  /** The line of the source the failure happened on, counted from zero. */
  readonly line: number;
}

export function isMathParseError(result: MathProgram | MathParseError): result is MathParseError {
  return "error" in result;
}

/**
 * The functions every program can call without defining them. A call of a name
 * outside this set and outside the function definitions of the same source is
 * an unknown function, which names.ts reports.
 */
export const MATH_BUILT_IN_FUNCTIONS: Readonly<Record<string, number>> = {
  sin: 1,
  cos: 1,
  tan: 1,
  arcsin: 1,
  arccos: 1,
  arctan: 1,
  sinh: 1,
  cosh: 1,
  tanh: 1,
  ln: 1,
  log: 1,
  exp: 1,
  sqrt: 1,
  abs: 1,
  floor: 1,
  ceil: 1,
  round: 1,
  sign: 1,
  min: 2,
  max: 2,
  mod: 2,
};

/** The commands that name a constant rather than an operation. */
const COMMAND_CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  tau: Math.PI * 2,
};

/** The commands that spell a product or a quotient. */
const COMMAND_OPERATORS: Readonly<Record<string, MathBinaryOperator>> = {
  cdot: "*",
  times: "*",
  div: "/",
};

/** The commands that name a built-in function, such as \sin. */
const COMMAND_FUNCTIONS = new Set(Object.keys(MATH_BUILT_IN_FUNCTIONS));

interface Cursor {
  readonly tokens: readonly MathToken[];
  index: number;
  /**
   * How many absolute value bars enclose the cursor. A bar both opens and
   * closes, so inside a pair the next bar is the closing one rather than the
   * start of another operand, and juxtaposition has to leave it alone.
   */
  bars: number;
  /** How many brackets and groups enclose the cursor, which bounds recursion. */
  depth: number;
}

class ParseFailure extends Error {
  constructor(message: string) {
    super(message);
  }
}

function peek(cursor: Cursor): MathToken {
  return cursor.tokens[cursor.index] as MathToken;
}

function advance(cursor: Cursor): MathToken {
  const current = peek(cursor);
  if (current.type !== "eof") {
    cursor.index += 1;
  }
  return current;
}

function expect(cursor: Cursor, type: MathToken["type"], what: string): MathToken {
  const current = peek(cursor);
  if (current.type !== type) {
    throw new ParseFailure(`${what} was expected, and "${current.text === "" ? "the end of the line" : current.text}" is there instead`);
  }
  return advance(cursor);
}

/** Answers whether a token can open an operand, which is what juxtaposition needs. */
function startsOperand(token: MathToken): boolean {
  if (token.type === "number" || token.type === "identifier" || token.type === "lparen" || token.type === "bar" || token.type === "reference") {
    return true;
  }
  return token.type === "command" && COMMAND_OPERATORS[token.name] === undefined;
}

interface ParseState {
  readonly functions: ReadonlySet<string>;
}

function parseExpression(cursor: Cursor, state: ParseState, stopAtDifferential = false): MathAst {
  return parseAdditive(cursor, state, stopAtDifferential);
}

function parseAdditive(cursor: Cursor, state: ParseState, stopAtDifferential: boolean): MathAst {
  let left = parseMultiplicative(cursor, state, stopAtDifferential);
  for (;;) {
    const current = peek(cursor);
    if (current.type !== "plus" && current.type !== "minus") {
      return left;
    }
    advance(cursor);
    const right = parseMultiplicative(cursor, state, stopAtDifferential);
    left = { type: "binary", operator: current.type === "plus" ? "+" : "-", left, right };
  }
}

/**
 * Answers whether the cursor sits on the differential that closes an
 * integrand, which is an identifier named d that another identifier follows.
 */
function atDifferential(cursor: Cursor): boolean {
  const current = peek(cursor);
  const after = cursor.tokens[cursor.index + 1];
  return current.type === "identifier" && current.name === "d" && after !== undefined && after.type === "identifier";
}

function parseMultiplicative(cursor: Cursor, state: ParseState, stopAtDifferential: boolean): MathAst {
  let left = parseUnary(cursor, state, stopAtDifferential);
  for (;;) {
    const current = peek(cursor);

    if (current.type === "star" || current.type === "slash") {
      advance(cursor);
      const right = parseUnary(cursor, state, stopAtDifferential);
      left = { type: "binary", operator: current.type === "star" ? "*" : "/", left, right };
      continue;
    }

    if (current.type === "command") {
      const operator = COMMAND_OPERATORS[current.name];
      if (operator !== undefined) {
        advance(cursor);
        const right = parseUnary(cursor, state, stopAtDifferential);
        left = { type: "binary", operator, left, right };
        continue;
      }
    }

    if (stopAtDifferential && atDifferential(cursor)) {
      return left;
    }

    if (startsOperand(current) && !(current.type === "bar" && cursor.bars > 0)) {
      const right = parseUnary(cursor, state, stopAtDifferential);
      left = { type: "binary", operator: "*", left, right };
      continue;
    }

    return left;
  }
}

function parseUnary(cursor: Cursor, state: ParseState, stopAtDifferential: boolean): MathAst {
  const current = peek(cursor);
  if (current.type === "minus") {
    advance(cursor);
    return { type: "negate", operand: parseUnary(cursor, state, stopAtDifferential) };
  }
  if (current.type === "plus") {
    advance(cursor);
    return parseUnary(cursor, state, stopAtDifferential);
  }
  return parsePower(cursor, state, stopAtDifferential);
}

function parsePower(cursor: Cursor, state: ParseState, stopAtDifferential: boolean): MathAst {
  const base = parseAtom(cursor, state);
  if (peek(cursor).type !== "caret") {
    return base;
  }
  advance(cursor);
  // An exponent is right associative, so 2^3^2 is 2^(3^2). The exponent parses
  // at the unary level, which keeps a product outside it: 2^2x is (2^2)x.
  const exponent = parseUnary(cursor, state, stopAtDifferential);
  return { type: "binary", operator: "^", left: base, right: exponent };
}

/** Reads a braced group, which is how LaTeX delimits an argument. */
function parseGroup(cursor: Cursor, state: ParseState): MathAst {
  expect(cursor, "lbrace", "an opening brace");
  const inner = parseExpression(cursor, state);
  expect(cursor, "rbrace", "a closing brace");
  return inner;
}

/**
 * Reads the bound, the variable and the body of an integral, a sum or a
 * product. All three spell their range the same way in LaTeX, and they differ
 * in where the variable comes from: an integral takes it from the differential
 * that closes the integrand, and a series takes it from its lower bound.
 */
function parseIntegral(cursor: Cursor, state: ParseState): MathAst {
  expect(cursor, "underscore", "a lower bound after the integral sign");
  const lower = parseBound(cursor, state);
  expect(cursor, "caret", "an upper bound after the lower bound");
  const upper = parseBound(cursor, state);
  const body = parseExpression(cursor, state, true);
  if (!atDifferential(cursor)) {
    throw new ParseFailure("an integral ends with a differential such as dx, which names the variable it integrates over");
  }
  advance(cursor);
  const variable = advance(cursor);
  return { type: "integral", variable: variable.name, lower, upper, body };
}

function parseSeries(cursor: Cursor, state: ParseState, operation: "sum" | "product"): MathAst {
  expect(cursor, "underscore", `a lower bound after the ${operation} sign`);
  expect(cursor, "lbrace", "an opening brace around the lower bound");
  const variable = expect(cursor, "identifier", `the variable the ${operation} runs over`);
  expect(cursor, "equals", "an equals sign between the variable and its first value");
  const lower = parseExpression(cursor, state);
  expect(cursor, "rbrace", "a closing brace around the lower bound");
  expect(cursor, "caret", "an upper bound after the lower bound");
  const upper = parseBound(cursor, state);
  const body = parseMultiplicative(cursor, state, false);
  return { type: "series", operation, variable: variable.name, lower, upper, body };
}

/**
 * Reads one bound of a range. LaTeX braces a bound of more than one character
 * and leaves a single character bare, so both forms arrive here.
 */
function parseBound(cursor: Cursor, state: ParseState): MathAst {
  if (peek(cursor).type === "lbrace") {
    return parseGroup(cursor, state);
  }
  return parseAtom(cursor, state);
}

function parseCallArguments(cursor: Cursor, state: ParseState): readonly MathAst[] {
  expect(cursor, "lparen", "an opening bracket after a function name");
  const args: MathAst[] = [];
  if (peek(cursor).type !== "rparen") {
    args.push(parseExpression(cursor, state));
    while (peek(cursor).type === "comma") {
      advance(cursor);
      args.push(parseExpression(cursor, state));
    }
  }
  expect(cursor, "rparen", "a closing bracket after the arguments");
  return args;
}

function parseCommandAtom(cursor: Cursor, state: ParseState, token: MathToken): MathAst {
  const constant = COMMAND_CONSTANTS[token.name];
  if (constant !== undefined) {
    return { type: "number", value: constant };
  }

  if (token.name === "frac" || token.name === "dfrac" || token.name === "tfrac") {
    const numerator = parseGroup(cursor, state);
    const denominator = parseGroup(cursor, state);
    return { type: "binary", operator: "/", left: numerator, right: denominator };
  }

  if (token.name === "sqrt") {
    if (peek(cursor).type === "lbracket") {
      advance(cursor);
      const degree = parseExpression(cursor, state);
      expect(cursor, "rbracket", "a closing bracket after the root degree");
      const radicand = parseGroup(cursor, state);
      return { type: "binary", operator: "^", left: radicand, right: { type: "binary", operator: "/", left: { type: "number", value: 1 }, right: degree } };
    }
    return { type: "call", name: "sqrt", args: [parseGroup(cursor, state)] };
  }

  if (token.name === "int") {
    return parseIntegral(cursor, state);
  }

  if (token.name === "sum") {
    return parseSeries(cursor, state, "sum");
  }

  if (token.name === "prod") {
    return parseSeries(cursor, state, "product");
  }

  if (COMMAND_FUNCTIONS.has(token.name)) {
    return { type: "call", name: token.name, args: parseCallArguments(cursor, state) };
  }

  throw new ParseFailure(`"\\${token.name}" is not a command this formula language reads`);
}

function parseAtom(cursor: Cursor, state: ParseState): MathAst {
  if (cursor.depth > MATH_MAX_DEPTH) {
    throw new ParseFailure(`this line nests deeper than ${MATH_MAX_DEPTH} levels`);
  }
  cursor.depth += 1;
  try {
    return parseAtomInner(cursor, state);
  } finally {
    cursor.depth -= 1;
  }
}

function parseAtomInner(cursor: Cursor, state: ParseState): MathAst {
  const current = advance(cursor);

  if (current.type === "number") {
    return { type: "number", value: current.value };
  }

  if (current.type === "reference") {
    const dot = current.name.indexOf(".");
    if (dot <= 0 || dot === current.name.length - 1) {
      throw new ParseFailure(`"${current.name}" is not an address, which names an object and then a slot of it`);
    }
    // The stored spelling carries the object id, so reading it works with no
    // list of objects and a rename of what it names rewrites nothing.
    return {
      type: "reference",
      address: { objectId: current.name.slice(0, dot), path: current.name.slice(dot + 1).split(".") },
    };
  }

  if (current.type === "identifier") {
    const isFunction = state.functions.has(current.name) || MATH_BUILT_IN_FUNCTIONS[current.name] !== undefined;
    if (isFunction && peek(cursor).type === "lparen") {
      return { type: "call", name: current.name, args: parseCallArguments(cursor, state) };
    }
    return { type: "name", name: current.name };
  }

  if (current.type === "lparen") {
    const inner = parseExpression(cursor, state);
    expect(cursor, "rparen", "a closing bracket");
    return inner;
  }

  if (current.type === "lbrace") {
    const inner = parseExpression(cursor, state);
    expect(cursor, "rbrace", "a closing brace");
    return inner;
  }

  if (current.type === "bar") {
    cursor.bars += 1;
    const inner = parseExpression(cursor, state);
    cursor.bars -= 1;
    expect(cursor, "bar", "a closing bar around an absolute value");
    return { type: "call", name: "abs", args: [inner] };
  }

  if (current.type === "command") {
    return parseCommandAtom(cursor, state, current);
  }

  throw new ParseFailure(`a value was expected, and "${current.text === "" ? "the end of the line" : current.text}" is there instead`);
}

/**
 * Reads the head of one line of tokens and reports the function it defines.
 * This is the first of the two passes, so it runs before any expression parses
 * and it looks at nothing beyond the bracket list.
 */
function readFunctionDefinitionName(tokens: readonly MathToken[]): string | undefined {
  if (tokens[0]?.type !== "identifier" || tokens[1]?.type !== "lparen") {
    return undefined;
  }
  let at = 2;
  if (tokens[at]?.type === "identifier") {
    at += 1;
    while (tokens[at]?.type === "comma" && tokens[at + 1]?.type === "identifier") {
      at += 2;
    }
  }
  if (tokens[at]?.type !== "rparen" || tokens[at + 1]?.type !== "equals") {
    return undefined;
  }
  return tokens[0]?.name;
}

function parseLine(tokens: readonly MathToken[], state: ParseState, sourceLine: number): MathLine {
  const cursor: Cursor = { tokens, index: 0, bars: 0, depth: 0 };

  const functionName = readFunctionDefinitionName(tokens);
  if (functionName !== undefined) {
    advance(cursor);
    advance(cursor);
    const parameters: string[] = [];
    if (peek(cursor).type === "identifier") {
      parameters.push(advance(cursor).name);
      while (peek(cursor).type === "comma") {
        advance(cursor);
        parameters.push(expect(cursor, "identifier", "a parameter name").name);
      }
    }
    expect(cursor, "rparen", "a closing bracket after the parameters");
    expect(cursor, "equals", "an equals sign after the parameter list");
    const body = parseExpression(cursor, state);
    expect(cursor, "eof", "the end of the line");
    if (new Set(parameters).size !== parameters.length) {
      throw new ParseFailure(`the parameters of "${functionName}" repeat a name, and each one names a different value`);
    }
    return { type: "functionDefinition", name: functionName, parameters, body };
  }

  if (tokens[0]?.type === "identifier" && tokens[1]?.type === "equals") {
    const name = advance(cursor).name;
    advance(cursor);
    const value = parseExpression(cursor, state);
    expect(cursor, "eof", "the end of the line");
    return { type: "definition", name, value, sourceLine };
  }

  // A line with an equals sign that did not match a definition head is almost
  // always a name of more than one letter, because juxtaposition is
  // multiplication and abc reads as a product of three names. The parser would
  // otherwise report the equals sign as a surprise, which describes the symptom
  // rather than the mistake.
  if (tokens.some((entry) => entry.type === "equals")) {
    const leading = tokens.filter((entry) => entry.type === "identifier").slice(0, 3).map((entry) => entry.name);
    if (tokens[0]?.type === "identifier" && tokens[1]?.type === "identifier") {
      throw new ParseFailure(
        `a definition names one value before the equals sign, and "${leading.join("")}" reads as ${leading.join(" times ")}, ` +
          `because letters beside each other multiply. A name of more than one letter takes a subscript such as x_{ans}, ` +
          `or the \\operatorname form`,
      );
    }
  }

  const value = parseExpression(cursor, state);
  expect(cursor, "eof", "the end of the line");
  return { type: "expression", value };
}

/** Answers whether a line holds anything besides space. */
function isBlankLine(line: string): boolean {
  return line.trim() === "";
}

/**
 * Parses a whole math source into a program, or reports the first line that
 * could not be read. A blank line is dropped rather than refused, so an
 * operator can space a source out.
 */
export function parseMath(source: string): MathProgram | MathParseError {
  const rawLines = source.split("\n");
  const tokenLines: { tokens: readonly MathToken[]; line: number }[] = [];

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index] as string;
    if (isBlankLine(raw)) {
      continue;
    }
    const tokens = tokenizeMath(raw);
    if (isMathLexError(tokens)) {
      return { error: "#PARSE", message: tokens.message, line: index };
    }
    tokenLines.push({ tokens, line: index });
  }

  const functions = new Set<string>();
  for (const entry of tokenLines) {
    const name = readFunctionDefinitionName(entry.tokens);
    if (name !== undefined) {
      functions.add(name);
    }
  }

  const state: ParseState = { functions };
  const lines: MathLine[] = [];
  for (const entry of tokenLines) {
    try {
      const line = parseLine(entry.tokens, state, entry.line);
      const body = line.type === "functionDefinition" ? line.body : line.value;
      if (mathAstDepth(body) > MATH_MAX_DEPTH) {
        return { error: "#PARSE", message: `this line nests deeper than ${MATH_MAX_DEPTH} levels`, line: entry.line };
      }
      lines.push(line);
    } catch (failure) {
      if (failure instanceof ParseFailure) {
        return { error: "#PARSE", message: failure.message, line: entry.line };
      }
      throw failure;
    }
  }

  return { lines };
}
