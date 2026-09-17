#!/usr/bin/env node
/**
 * conformance-runner.mjs
 *
 * Answers the shared conformance fixtures with the TypeScript engine. The
 * Rust binary in crates/beheader-conformance answers the same fixtures with
 * the Rust engine, and tools/conformance-compare.mjs puts the two results side
 * by side.
 *
 *   node tools/conformance-runner.mjs --fixtures <dir> --out <file>
 *   node tools/conformance-runner.mjs --calls
 *
 * The two runners are deliberately alike down to the wording of a refusal.
 * Each one decodes the arguments of a case, checks them against the declared
 * domain of the call, and reports the same three outcomes: a value, a refusal
 * of the arguments, or a call it cannot answer. A difference in that wording
 * would show up as a conformance failure, so the two adapters are held to the
 * same shape as the two engines are.
 *
 * The value codec below mirrors crates/beheader-engine/src/wire.rs. A fixture
 * carries a value as JSON, and four of the numbers the engine is tested
 * against have no JSON spelling that survives the trip. A non-finite number
 * has no spelling at all, and JSON.stringify writes a negative zero as a
 * positive one. Each of the four travels as a tagged object instead, with the
 * name of the number under the key `$number`. That shape belongs to the
 * fixtures, and a document never holds one, because a document never holds one
 * of those four numbers.
 *
 * Node reads the engine as TypeScript directly, so the runner imports the
 * engine barrel the same way the application does and no build step stands
 * between the two.
 *
 * Tooling code that runs under Node outside the application, so it has no part
 * in the browser bundle.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * The engine, read as TypeScript. Node strips the types itself from version
 * 22.18 onward, so nothing is built between the two engines and nothing in
 * between can be patched. The version is checked before the import, because a
 * static import runs before any code in this file and an older Node reports
 * the failure as an unknown file extension.
 */
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`this runner reads the engine as TypeScript, which Node does from 22.18 onward, and this is Node ${process.versions.node}`);
  process.exit(1);
}

const {
  addressKey,
  columnLettersToIndex,
  formatCellReference,
  hasIllegalNumber,
  indexToColumnLetters,
  isCellReferenceForm,
  isErrorValue,
  isIllegalNumber,
  evaluateFormulaAst,
  exceedsMaxFormulaAstDepth,
  extractDependencies,
  formatFormula,
  isLegalPortName,
  isParseError,
  isValidName,
  repairAddressesInAst,
  rewriteAddressesInAst,
  lex,
  validateFormulaAstShape,
  formatAddress,
  nearestName,
  parseAddress,
  parseCellReference,
  parseFormula,
  slotKey,
  toSurfacePath,
} = await import("../src/engine/index.ts");

/** The version of the results shape this runner writes. */
const RUNNER_VERSION = 1;

/** The fixture shape this runner reads. */
const FIXTURE_VERSION = 1;

const NUMBER_TAG = "$number";

const POINT_SHAPE = "a point is an object with an x member and a y member";

const OBJECT_TYPES = new Set([
  "circle", "polygon", "polyline", "rect", "text", "table", "script",
  "image", "math", "value", "doc", "docref", "add",
]);

const ERROR_CODES = new Set(["#REF", "#TYPE", "#DIV0", "#PARSE", "#SCRIPT", "#MEASURE", "#MATH"]);

/* ------------------------------------------------------------------ */
/* The value codec, which mirrors crates/beheader-engine/src/wire.rs   */
/* ------------------------------------------------------------------ */

function isPlainObject(json) {
  return typeof json === "object" && json !== null && !Array.isArray(json);
}

/** The tag of a number ordinary JSON cannot hold, or nothing for anything else. */
function taggedNumber(json) {
  if (!isPlainObject(json)) {
    return undefined;
  }
  const keys = Object.keys(json);
  if (keys.length !== 1 || keys[0] !== NUMBER_TAG || typeof json[NUMBER_TAG] !== "string") {
    return undefined;
  }
  return json[NUMBER_TAG];
}

class WireError extends Error {}

function decodeNumber(json) {
  const tag = taggedNumber(json);
  if (tag !== undefined) {
    switch (tag) {
      case "NaN": return Number.NaN;
      case "Infinity": return Number.POSITIVE_INFINITY;
      case "-Infinity": return Number.NEGATIVE_INFINITY;
      case "-0": return -0;
      default: throw new WireError(`"${tag}" is not a tagged number`);
    }
  }
  if (typeof json !== "number") {
    throw new WireError("a number is a plain JSON number or one of the four tagged ones");
  }
  return json;
}

function encodeNumber(number) {
  if (Number.isNaN(number)) {
    return { [NUMBER_TAG]: "NaN" };
  }
  if (number === Number.POSITIVE_INFINITY) {
    return { [NUMBER_TAG]: "Infinity" };
  }
  if (number === Number.NEGATIVE_INFINITY) {
    return { [NUMBER_TAG]: "-Infinity" };
  }
  if (Object.is(number, -0)) {
    return { [NUMBER_TAG]: "-0" };
  }
  return number;
}

function decodePoint(json) {
  if (!isPlainObject(json)) {
    throw new WireError(POINT_SHAPE);
  }
  const keys = Object.keys(json);
  if (!keys.includes("x") || !keys.includes("y")) {
    throw new WireError(POINT_SHAPE);
  }
  if (keys.length !== 2) {
    throw new WireError("a point carries an x and a y member and nothing else");
  }
  return { x: decodeNumber(json.x), y: decodeNumber(json.y) };
}

function encodePoint(point) {
  return { x: encodeNumber(point.x), y: encodeNumber(point.y) };
}

function decodeValue(json) {
  if (json === null) {
    return null;
  }
  if (typeof json === "boolean" || typeof json === "string") {
    return json;
  }
  if (typeof json === "number") {
    return json;
  }
  if (Array.isArray(json)) {
    return json.map(decodePoint);
  }
  if (taggedNumber(json) !== undefined) {
    return decodeNumber(json);
  }
  if (isPlainObject(json) && Object.hasOwn(json, "error")) {
    if (typeof json.error !== "string") {
      throw new WireError("the error member of an error value is text");
    }
    if (!ERROR_CODES.has(json.error)) {
      throw new WireError(`"${json.error}" is not one of the seven error codes`);
    }
    if (typeof json.message !== "string") {
      throw new WireError("an error value carries a message");
    }
    return { error: json.error, message: json.message };
  }
  return decodePoint(json);
}

function encodeValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return encodeNumber(value);
  }
  if (Array.isArray(value)) {
    return value.map(encodePoint);
  }
  if (isErrorValue(value)) {
    return { error: value.error, message: value.message };
  }
  return encodePoint(value);
}

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

/** A refusal of the arguments of a case, worded the way the Rust runner words it. */
class BadArgument extends Error {}

function argument(args, name) {
  if (!Object.hasOwn(args, name)) {
    throw new BadArgument(`the argument "${name}" is missing`);
  }
  return args[name];
}

function textArgument(args, name) {
  const value = argument(args, name);
  if (typeof value !== "string") {
    throw new BadArgument(`the argument "${name}" is text`);
  }
  return value;
}

function numberArgument(args, name) {
  const value = argument(args, name);
  try {
    return decodeNumber(value);
  } catch {
    throw new BadArgument(`the argument "${name}" is a number`);
  }
}

function safeIntegerArgument(args, name) {
  const number = numberArgument(args, name);
  if (!Number.isSafeInteger(number)) {
    throw new BadArgument(`the argument "${name}" is a safe integer`);
  }
  return number;
}

function pathArgument(args, name) {
  const value = argument(args, name);
  if (!Array.isArray(value) || value.some((segment) => typeof segment !== "string")) {
    throw new BadArgument(`the argument "${name}" is a list of text segments`);
  }
  return value;
}

function objectTypeArgument(args, name) {
  const value = textArgument(args, name);
  if (!OBJECT_TYPES.has(value)) {
    throw new BadArgument(`the argument "${name}" is one of the thirteen object types`);
  }
  return value;
}

function asciiLettersArgument(args, name) {
  const value = textArgument(args, name);
  if (!/^[A-Za-z]*$/.test(value)) {
    throw new BadArgument(`the argument "${name}" holds only letters from the ASCII alphabet`);
  }
  return value;
}

function valueArgument(args, name) {
  const json = argument(args, name);
  try {
    return decodeValue(json);
  } catch (error) {
    throw new BadArgument(`the argument "${name}" is a value the engine can hold: ${error.message}`);
  }
}

function objectListArgument(args, name) {
  const value = argument(args, name);
  const wellFormed =
    Array.isArray(value) &&
    value.every(
      (object) =>
        isPlainObject(object) &&
        typeof object.id === "string" &&
        typeof object.name === "string" &&
        OBJECT_TYPES.has(object.type),
    );
  if (!wellFormed) {
    throw new BadArgument(`the argument "${name}" is a list of objects with an id, a name and a type`);
  }
  return value;
}

/**
 * The objects an address resolves against. A fixture gives the slot names of
 * an object as a list rather than as an object, because a JSON object reaches
 * the Rust runner through a sorted map, and the order of the slot names is
 * part of what the two engines are being compared on.
 */
function addressableObjectListArgument(args, name) {
  const objects = objectListArgument(args, name);
  return objects.map((object) => ({
    ...object,
    slots: Object.fromEntries(
      (object.slotKeys ?? []).map((key) => [key, { kind: "literal", value: null }]),
    ),
  }));
}

/**
 * The value a literal token carries. A number goes through the tagged form the
 * fixtures use for every other number, so a token holding 1e21 compares by the
 * text both engines print rather than by what JSON does with it.
 */
/**
 * A formula tree as JSON, with a literal number carried in the tagged form the
 * fixtures use so a tree holding 1e21 compares by the text both engines print.
 */
function encodeAddress(address) {
  return { objectId: address.objectId, path: [...address.path] };
}

function encodeAst(ast) {
  switch (ast.type) {
    case "literal":
      return { type: "literal", value: typeof ast.value === "number" ? encodeNumber(ast.value) : ast.value };
    case "reference":
      return { type: "reference", address: { objectId: ast.address.objectId, path: [...ast.address.path] } };
    case "range":
      return {
        type: "range",
        start: { objectId: ast.start.objectId, path: [...ast.start.path] },
        end: { objectId: ast.end.objectId, path: [...ast.end.path] },
      };
    case "binaryOp":
      return { type: "binaryOp", operator: ast.operator, left: encodeAst(ast.left), right: encodeAst(ast.right) };
    case "unaryOp":
      return { type: "unaryOp", operator: ast.operator, operand: encodeAst(ast.operand) };
    case "functionCall":
      return { type: "functionCall", name: ast.name, args: ast.args.map(encodeAst) };
    default:
      return { type: "error", error: "#REF" };
  }
}

/** A chain of prefix minus nodes that deep, around one literal. */
function nestedAst(depth) {
  let ast = { type: "literal", value: 1 };
  for (let n = 0; n < depth; n += 1) {
    ast = { type: "unaryOp", operator: "-", operand: ast };
  }
  return ast;
}

function encodeTokenValue(value) {
  return typeof value === "number" ? encodeNumber(value) : value;
}

function textListArgument(args, name) {
  const value = argument(args, name);
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new BadArgument(`the argument "${name}" is a list of strings`);
  }
  return value;
}

function addressArgument(args, name) {
  const value = argument(args, name);
  if (!isPlainObject(value) || typeof value.objectId !== "string") {
    throw new BadArgument(`the argument "${name}" is an address with an objectId and a path`);
  }
  return { objectId: value.objectId, path: pathArgument(value, "path") };
}

/**
 * The one shape both spellings of an address answer take. A refusal is an
 * object carrying its code and its wording, and a success is the address or
 * the text, so a comparison of two engines reads one field set either way.
 */
function encodeAddressResult(result) {
  if (typeof result === "string") {
    return result;
  }
  if ("error" in result) {
    return { error: result.error, message: result.message };
  }
  return { objectId: result.objectId, path: [...result.path] };
}

/* ------------------------------------------------------------------ */
/* The calls                                                           */
/* ------------------------------------------------------------------ */

const CALLS = {
  numberToText: (args) => String(numberArgument(args, "number")),
  slotKey: (args) => slotKey(pathArgument(args, "path")),
  isValidName: (args) => isValidName(textArgument(args, "name")),
  isCellReferenceForm: (args) => isCellReferenceForm(textArgument(args, "segment")),
  parseCellReference: (args) => {
    const coordinates = parseCellReference(textArgument(args, "reference"));
    return coordinates === undefined
      ? null
      : { column: encodeNumber(coordinates.column), row: encodeNumber(coordinates.row) };
  },
  formatCellReference: (args) => {
    const column = safeIntegerArgument(args, "column");
    const row = numberArgument(args, "row");
    return formatCellReference({ column, row });
  },
  columnLettersToIndex: (args) => encodeNumber(columnLettersToIndex(asciiLettersArgument(args, "letters"))),
  indexToColumnLetters: (args) => indexToColumnLetters(safeIntegerArgument(args, "index")),
  toSurfacePath: (args) => {
    const type = objectTypeArgument(args, "type");
    return [...toSurfacePath(type, pathArgument(args, "path"))];
  },
  isErrorValue: (args) => isErrorValue(valueArgument(args, "value")),
  isIllegalNumber: (args) => isIllegalNumber(numberArgument(args, "number")),
  hasIllegalNumber: (args) => hasIllegalNumber(valueArgument(args, "value")),
  valueRoundTrip: (args) => encodeValue(valueArgument(args, "value")),
  isLegalPortName: (args) => isLegalPortName(textArgument(args, "name")),
  validateFormulaAstShape: (args) => {
    const result = validateFormulaAstShape(argument(args, "ast"));
    return result.ok ? { ok: true, ast: encodeAst(result.ast) } : { ok: false, reason: result.reason };
  },
  nestedFormulaDepth: (args) => {
    const raw = nestedAst(safeIntegerArgument(args, "depth"));
    const shape = validateFormulaAstShape(raw);
    return shape.ok
      ? { ok: true, exceeds: exceedsMaxFormulaAstDepth(shape.ast) }
      : { ok: false, reason: shape.reason };
  },
  lex: (args) => {
    const result = lex(textArgument(args, "source"));
    if (!Array.isArray(result)) {
      return { error: result.error, message: result.message, start: result.start };
    }
    return result.map((token) =>
      "value" in token
        ? { type: token.type, text: token.text, start: token.start, value: encodeTokenValue(token.value) }
        : { type: token.type, text: token.text, start: token.start },
    );
  },
  nearestName: (args) => {
    const nearest = nearestName(textArgument(args, "typed"), textListArgument(args, "candidates"));
    return nearest === undefined ? null : nearest;
  },
  addressKey: (args) => addressKey(addressArgument(args, "address")),
  parseAddress: (args) => encodeAddressResult(parseAddress(textArgument(args, "input"), addressableObjectListArgument(args, "objects"))),
  formatAddress: (args) => encodeAddressResult(formatAddress(addressArgument(args, "address"), addressableObjectListArgument(args, "objects"))),
  evaluateFormula: (args) => {
    const objects = addressableObjectListArgument(args, "objects");
    const table = "tableObjectId" in args ? textArgument(args, "tableObjectId") : undefined;
    const parsed = parseFormula(textArgument(args, "source"), objects, table);
    if (isParseError(parsed)) {
      return { error: parsed.error, message: parsed.message, start: parsed.start };
    }
    // The slots a case declares, keyed the way an address keys one, so both
    // runners read the same value for the same address.
    const slots = new Map(
      (args.slots ?? []).map((entry) => [
        `${entry.objectId}::${(entry.path ?? []).join(".")}`,
        decodeValue(entry.value),
      ]),
    );
    const read = (address) => slots.get(`${address.objectId}::${address.path.join(".")}`);
    const ranges = new Map(
      (args.ranges ?? []).map((entry) => [
        `${entry.start.objectId}::${entry.start.path.join(".")}:${entry.end.objectId}::${entry.end.path.join(".")}`,
        entry.error === undefined ? entry.values.map(decodeValue) : { error: entry.error, message: entry.message },
      ]),
    );
    const readRange =
      args.ranges === undefined
        ? undefined
        : (start, end) =>
            ranges.get(`${start.objectId}::${start.path.join(".")}:${end.objectId}::${end.path.join(".")}`) ?? {
              error: "#REF",
              message: "the case declared no values for this range",
            };
    return encodeValue(evaluateFormulaAst(parsed, read, readRange));
  },
  extractDependencies: (args) => {
    const shape = validateFormulaAstShape(argument(args, "ast"));
    if (!shape.ok) {
      return { ok: false, reason: shape.reason };
    }
    return extractDependencies(shape.ast).map((dependency) =>
      dependency.kind === "reference"
        ? { kind: "reference", address: encodeAddress(dependency.address) }
        : { kind: "range", start: encodeAddress(dependency.start), end: encodeAddress(dependency.end) },
    );
  },
  rewriteAddressesInAst: (args) => {
    const shape = validateFormulaAstShape(argument(args, "ast"));
    if (!shape.ok) {
      return { ok: false, reason: shape.reason };
    }
    const from = textArgument(args, "fromObjectId");
    const to = textArgument(args, "toObjectId");
    // The rewrite the fixtures use moves every address off one object and onto
    // another, which reaches each node kind that holds an address.
    return encodeAst(rewriteAddressesInAst(shape.ast, (address) =>
      address.objectId === from ? { objectId: to, path: [...address.path] } : address,
    ));
  },
  repairAddressesInAst: (args) => {
    const shape = validateFormulaAstShape(argument(args, "ast"));
    if (!shape.ok) {
      return { ok: false, reason: shape.reason };
    }
    const deleted = textArgument(args, "deletedObjectId");
    // The repair the fixtures use treats one object as deleted, and a range
    // with either end on it goes the same way as a reference to it.
    return encodeAst(
      repairAddressesInAst(
        shape.ast,
        (address) => (address.objectId === deleted ? "deleted" : address),
        (start, end) => (start.objectId === deleted || end.objectId === deleted ? "deleted" : { start, end }),
      ),
    );
  },
  formatFormula: (args) => {
    const shape = validateFormulaAstShape(argument(args, "ast"));
    if (!shape.ok) {
      return { ok: false, reason: shape.reason };
    }
    const relative = "relativeToObjectId" in args ? textArgument(args, "relativeToObjectId") : undefined;
    return formatFormula(shape.ast, addressableObjectListArgument(args, "objects"), relative);
  },
  parseThenFormat: (args) => {
    const objects = addressableObjectListArgument(args, "objects");
    const table = "tableObjectId" in args ? textArgument(args, "tableObjectId") : undefined;
    const parsed = parseFormula(textArgument(args, "source"), objects, table);
    if (isParseError(parsed)) {
      return { error: parsed.error, message: parsed.message, start: parsed.start };
    }
    const printed = formatFormula(parsed, objects, table);
    // Reading the printed text back gives the same tree where the printer put
    // its brackets in the right places, and a different one where it did not.
    const again = parseFormula(printed, objects, table);
    return {
      printed,
      reparsedEqual: !isParseError(again) && JSON.stringify(encodeAst(again)) === JSON.stringify(encodeAst(parsed)),
    };
  },
  parseFormula: (args) => {
    const table = "tableObjectId" in args ? textArgument(args, "tableObjectId") : undefined;
    const result = parseFormula(textArgument(args, "source"), addressableObjectListArgument(args, "objects"), table);
    return isParseError(result) ? { error: result.error, message: result.message, start: result.start } : encodeAst(result);
  },
};

const SUPPORTED_CALLS = Object.keys(CALLS).sort();

function runCase(call, args) {
  const handler = CALLS[call];
  if (handler === undefined) {
    return { status: "unsupported", detail: `the call "${call}" has no TypeScript implementation yet` };
  }
  try {
    return { status: "ok", value: handler(args) };
  } catch (error) {
    if (error instanceof BadArgument) {
      return { status: "error", detail: error.message };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Driver                                                             */
/* ------------------------------------------------------------------ */

function option(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }
  const inline = args.find((argument) => argument.startsWith(`--${name}=`));
  return inline === undefined ? undefined : inline.slice(`--${name}=`.length);
}

function readFixture(path) {
  const document = JSON.parse(readFileSync(path, "utf8"));
  if (document.fixtureVersion !== FIXTURE_VERSION) {
    throw new Error(`${path}: the fixture version is ${document.fixtureVersion} and this runner reads version ${FIXTURE_VERSION}`);
  }
  if (typeof document.id !== "string") {
    throw new Error(`${path}: the fixture has no id`);
  }
  if (!Array.isArray(document.cases)) {
    throw new Error(`${path}: the fixture has no list of cases`);
  }
  return document;
}

function runFixture(document, path, results) {
  document.cases.forEach((entry, index) => {
    if (typeof entry.call !== "string") {
      throw new Error(`${path}: case ${index} of ${document.id} names no call`);
    }
    if (entry.args !== undefined && !isPlainObject(entry.args)) {
      throw new Error(`${path}: case ${index} of ${document.id} carries arguments that are not an object`);
    }
    results.push({
      fixture: document.id,
      case: index,
      name: typeof entry.name === "string" ? entry.name : "",
      call: entry.call,
      outcome: runCase(entry.call, entry.args ?? {}),
    });
  });
}

function main() {
  if (process.argv.includes("--calls")) {
    console.log(JSON.stringify({ engine: "typescript", calls: SUPPORTED_CALLS }));
    return;
  }
  const fixtures = option("fixtures");
  const out = option("out");
  if (fixtures === undefined) {
    throw new Error("the --fixtures option names the directory to read");
  }
  if (out === undefined) {
    throw new Error("the --out option names the results file to write");
  }

  const files = readdirSync(fixtures)
    .filter((name) => extname(name) === ".json")
    .sort()
    .map((name) => join(fixtures, name));
  if (files.length === 0) {
    throw new Error(`${fixtures}: no fixture files`);
  }

  const results = [];
  for (const file of files) {
    runFixture(readFixture(file), file, results);
  }
  writeFileSync(out, `${JSON.stringify({ engine: "typescript", runnerVersion: RUNNER_VERSION, supportedCalls: SUPPORTED_CALLS, results }, null, 2)}\n`);
  console.error(`typescript runner: ${results.length} cases from ${files.length} fixtures`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
