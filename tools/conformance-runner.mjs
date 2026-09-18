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
  evaluateMathObject,
  parseMath,
  resolveMathNames,
  slotKey,
  tokenizeMath,
  toSurfacePath,
  arcOfEdge,
  bezierOfEdge,
  buildPathEdges,
  bulgeForMidpoint,
  bulgeForTangentArc,
  cubicHandlesForEdge,
  distanceToEdge,
  distanceToPath,
  distanceToSegment,
  edgeDoubledAreaOverChord,
  edgeEndDirection,
  edgeExtremePoints,
  edgeLength,
  edgeMidpoint,
  pathArea,
  pathBounds,
  pathCentroid,
  pathContains,
  pathDoubledSignedArea,
  pathLength,
  splitEdgeAt,
  sweepCoversAngle,
  addVertexToObject,
  computeArea,
  computeBounds,
  computeCentroid,
  computeOpenPathLength,
  computePerimeterLength,
  computePolygonVertices,
  computeRectVertices,
  computeVertexMean,
  deleteVertexFromObject,
  enumeratePolylineCoordinateSlotPaths,
  enumeratePolylineVertexSlotPaths,
  explodeObjectToPolyline,
  insertVertexIntoObject,
  pathEdgesOfObject,
  polylineEdgeCount,
  repairVertexAddressForDelete,
  shiftVertexAddressForDelete,
  shiftVertexAddressForInsert,
  splitPolylineEdge,
  cellAddressToCoordinates,
  deleteTableLine,
  enumerateRangeCellAddresses,
  enumerateTableCellSlotPaths,
  getTableDimensions,
  insertTableLine,
  isInExtentTableCellAddress,
  isRangeEnumerationError,
  isTableDimensionResizable,
  repairCellAddressForDelete,
  repairRangeEndpointsForDelete,
  shiftCellAddressForInsert,
  derivedSlotDependencyAddresses,
  findSlotFormat,
  findSlotOptions,
  getObjectSchema,
  isColorValue,
  resolveDerivedSlots,
  resolveNonDerivedSlotPaths,
  docrefLabel,
  documentVariableNameProblem,
  evaluateBlockTree,
  extractTextDependencies,
  matchMathMarkerAt,
  parseTextContent,
  resolveTextDependencyAddresses,
  applyMathSource,
  createMathObject,
  isMathSourceError,
  mathDisplayLatex,
  mathSourceReferences,
  mathSourceWithIds,
  mathSourceWithNames,
  readMathDisplayLatex,
  readMathNames,
  rewriteMathReferences,
  unresolvedMathReferences,
  deriveEdges,
  detectCycle,
  deriveValidateAndEvaluate,
  validateIntegrity,
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

function booleanArgument(args, name) {
  const value = argument(args, name);
  if (typeof value !== "boolean") {
    throw new BadArgument(`the argument "${name}" is a boolean`);
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
/** A math expression as JSON, with every number in the tagged form. */
function encodeMathAst(ast) {
  switch (ast.type) {
    case "number":
      return { type: "number", value: encodeNumber(ast.value) };
    case "name":
      return { type: "name", name: ast.name };
    case "reference":
      return { type: "reference", address: encodeAddress(ast.address) };
    case "binary":
      return { type: "binary", operator: ast.operator, left: encodeMathAst(ast.left), right: encodeMathAst(ast.right) };
    case "negate":
      return { type: "negate", operand: encodeMathAst(ast.operand) };
    case "call":
      return { type: "call", name: ast.name, args: ast.args.map(encodeMathAst) };
    case "integral":
      return {
        type: "integral",
        variable: ast.variable,
        lower: encodeMathAst(ast.lower),
        upper: encodeMathAst(ast.upper),
        body: encodeMathAst(ast.body),
      };
    default:
      return {
        type: "series",
        operation: ast.operation,
        variable: ast.variable,
        lower: encodeMathAst(ast.lower),
        upper: encodeMathAst(ast.upper),
        body: encodeMathAst(ast.body),
      };
  }
}

function encodeMathLine(line) {
  switch (line.type) {
    case "definition":
      return { type: "definition", name: line.name, value: encodeMathAst(line.value), sourceLine: line.sourceLine };
    case "functionDefinition":
      return { type: "functionDefinition", name: line.name, parameters: [...line.parameters], body: encodeMathAst(line.body) };
    case "solve":
      return { type: "solve", unknown: line.unknown, left: encodeMathAst(line.left), right: encodeMathAst(line.right), sourceLine: line.sourceLine };
    default:
      return { type: "expression", value: encodeMathAst(line.value) };
  }
}

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
/* Geometry arguments and answers                                      */
/* ------------------------------------------------------------------ */

function pointFrom(value, name) {
  try {
    return decodePoint(value);
  } catch {
    throw new BadArgument(`the argument "${name}" is a point`);
  }
}

function pointArgument(args, name) {
  return pointFrom(argument(args, name), name);
}

function pointListArgument(args, name) {
  const value = args[name];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadArgument(`the argument "${name}" is a list of points`);
  }
  return value.map((entry) => pointFrom(entry, name));
}

function numberListArgument(args, name) {
  const value = args[name];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadArgument(`the argument "${name}" is a list of numbers`);
  }
  return value.map((entry) => decodeNumber(entry));
}

/**
 * One edge from its four fields. The controls are absent for a straight edge
 * and an arc, because a pair of control points wins over a bulge and an edge
 * that carries both would never reach its bulge.
 */
function edgeArgument(args, name) {
  const value = argument(args, name);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadArgument(`the argument "${name}" is an edge`);
  }
  const edge = {
    start: pointFrom(value.start, name),
    end: pointFrom(value.end, name),
    bulge: decodeNumber(value.bulge ?? 0),
  };
  if (value.controls === undefined || value.controls === null) {
    return edge;
  }
  if (!Array.isArray(value.controls) || value.controls.length !== 2) {
    throw new BadArgument(`the argument "${name}" carries two control points or none`);
  }
  return { ...edge, controls: value.controls.map((entry) => pointFrom(entry, name)) };
}

/** The edges of a path, from the slots a polyline stores. */
function pathEdgesArgument(args) {
  return buildPathEdges(
    pointListArgument(args, "vertices"),
    numberListArgument(args, "bulges"),
    booleanArgument(args, "closed"),
    pointListArgument(args, "handlesIn"),
    pointListArgument(args, "handlesOut"),
  );
}

function encodeArc(arc) {
  return arc === undefined
    ? null
    : {
        center: encodePoint(arc.center),
        radius: encodeNumber(arc.radius),
        startAngle: encodeNumber(arc.startAngle),
        sweep: encodeNumber(arc.sweep),
      };
}


/**
 * A shape as a fixture states it: the object fields, and the slots as an
 * ordered list rather than as a JSON object. Slot order is observable in
 * drawing and completion, one engine keeps the order a JSON object was written
 * in and the other sorts it, so a fixture that wrote the slots as an object
 * would compare the two JSON readers rather than the two engines.
 */
function shapeObjectArgument(args, name) {
  const value = argument(args, name);
  if (!isPlainObject(value) || typeof value.id !== "string" || !OBJECT_TYPES.has(value.type)) {
    throw new BadArgument(`the argument "${name}" is an object with an id and a type`);
  }
  const entries = Array.isArray(value.slots) ? value.slots : [];
  const slots = {};
  for (const entry of entries) {
    if (!isPlainObject(entry) || typeof entry.key !== "string") {
      throw new BadArgument(`the argument "${name}" carries slots with a key each`);
    }
    slots[entry.key] = { kind: entry.kind ?? "literal", value: decodeValue(entry.value ?? null) };
  }
  const named = (key) => {
    const held = value.ports?.[key];
    return Array.isArray(held) && held.every((name) => typeof name === "string") ? held : undefined;
  };
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
    type: value.type,
    vertexCount: value.vertexCount === undefined ? undefined : decodeNumber(value.vertexCount),
    ports: value.ports === undefined
      ? undefined
      : {
          in: named("in") ?? [],
          out: named("out") ?? [],
          // A source that solves for nothing arrives with no seed family, so
          // an absent list stays absent rather than becoming an empty one.
          ...(named("seed") === undefined ? {} : { seed: named("seed") }),
        },
    target: value.target === undefined || value.target === null
      ? undefined
      : addressArgument({ target: value.target }, "target"),
    slots,
  };
}

/**
 * A measurer whose answer follows from the text alone, so both engines can be
 * asked what a copy of a variable measures. A width counts the units a
 * JavaScript string counts, so a label holding a character outside the basic
 * plane measures two units wide rather than one.
 */
const FAKE_MEASURER = {
  measure: (text, style) => ({
    width: text.length * style.fontSize * 0.6,
    height: style.lineHeight,
  }),
  measureMath: (latex, style) => ({
    width: latex.length * style.fontSize * 0.5,
    height: style.fontSize * 1.5,
  }),
};

/** A measurer whose host has gone, which is what a closed page looks like. */
const FAILING_MEASURER = {
  measure: () => {
    throw new Error("the host has gone");
  },
  measureMath: () => {
    throw new Error("the host has gone");
  },
};

/**
 * The context a derived slot computes against. A case naming no measurer gets
 * none, which is what leaves a measured slot reporting a measurement error
 * rather than a guessed size.
 */
function evalContextArgument(args) {
  if (args.measurer === "fake") {
    return { measurer: FAKE_MEASURER };
  }
  return args.measurer === "failing" ? { measurer: FAILING_MEASURER } : undefined;
}

/** The axis a table resize runs along. */
function tableAxisArgument(args) {
  const axis = textArgument(args, "axis");
  if (axis !== "row" && axis !== "column") {
    throw new BadArgument('the argument "axis" is "row" or "column"');
  }
  return axis;
}

/**
 * Several shapes, read the same way one is, and then a second pass that parses
 * every formula against the whole list. A formula names objects by the names
 * they carry, so it cannot be parsed until every object in the case exists.
 */
function shapeObjectListArgument(args, name) {
  const items = argument(args, name);
  if (!Array.isArray(items)) {
    throw new BadArgument(`the argument "${name}" is a list of objects`);
  }
  const objects = items.map((entry) => shapeObjectArgument({ object: entry }, "object"));
  for (const [index, entry] of items.entries()) {
    for (const slot of Array.isArray(entry.slots) ? entry.slots : []) {
      if (typeof slot.formula !== "string") {
        continue;
      }
      const parsed = parseFormula(slot.formula, objects);
      if (isParseError(parsed)) {
        throw new BadArgument(`the formula "${slot.formula}" does not parse: ${parsed.message}`);
      }
      objects[index].slots[slot.key] = { kind: "formula", ast: parsed, value: null };
    }
  }
  return objects;
}

/** A shape back out, with its slots in the order they sit in. */
function encodeShapeObject(object) {
  return {
    id: object.id,
    name: object.name,
    type: object.type,
    vertexCount: object.vertexCount === undefined ? null : encodeNumber(object.vertexCount),
    slots: Object.entries(object.slots).map(([key, slot]) => ({
      key,
      kind: slot.kind,
      value: encodeValue(slot.value),
    })),
  };
}

function encodeEdge(edge) {
  return {
    start: encodePoint(edge.start),
    end: encodePoint(edge.end),
    bulge: encodeNumber(edge.bulge),
    controls: edge.controls === undefined ? null : edge.controls.map(encodePoint),
  };
}


/** A block tree as JSON, with each node naming its own kind. */
function encodeBlock(block) {
  switch (block.type) {
    case "text":
      return { type: "text", value: block.value };
    case "math":
      return { type: "math", latex: block.latex, display: block.display, source: block.source };
    case "formula":
      return { type: "formula", ast: encodeAst(block.ast) };
    case "conditional":
      return {
        type: "conditional",
        condition: encodeAst(block.condition),
        trueBranch: block.trueBranch.map(encodeBlock),
        falseBranch: block.falseBranch.map(encodeBlock),
      };
    default:
      return {
        type: "error",
        message: block.message,
        source: block.source,
        start: block.start,
        orphaned: block.orphaned.map(encodeBlock),
      };
  }
}

function encodeDependency(dependency) {
  return dependency.kind === "reference"
    ? { kind: "reference", address: encodeAddress(dependency.address) }
    : { kind: "range", start: encodeAddress(dependency.start), end: encodeAddress(dependency.end) };
}

/**
 * A reader over the slots of the objects a case declares, which is what a text
 * block resolves its references against.
 */
function slotReaderFor(objects) {
  return (address) => {
    const object = objects.find((candidate) => candidate.id === address.objectId);
    return object?.slots[slotKey(address.path)]?.value;
  };
}

/* ------------------------------------------------------------------ */
/* The calls                                                           */
/* ------------------------------------------------------------------ */

/**
 * The arithmetic each engine has to agree on before any geometry can be
 * compared. The Rust side reaches these through named wrappers rather than
 * through the methods its target supplies, because a native build and a
 * wasm32-unknown-unknown build otherwise answer differently and only the
 * second one is what an operator loads.
 */
const JAVASCRIPT_ARITHMETIC = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log10: Math.log10,
  exp: Math.exp,
  sqrt: Math.sqrt,
  atan2: Math.atan2,
  hypot: Math.hypot,
  pow: Math.pow,
};

/** The three that read a second argument. The rest take one. */
const TWO_ARGUMENT_ARITHMETIC = new Set(["atan2", "hypot", "pow"]);

const CALLS = {
  numberToText: (args) => String(numberArgument(args, "number")),
  graphEdges: (args) =>
    deriveEdges(shapeObjectListArgument(args, "objects")).map((edge) => ({
      source: encodeAddress(edge.sourceSlot),
      dependent: encodeAddress(edge.dependentSlot),
    })),
  graphIntegrity: (args) => {
    const objects = shapeObjectListArgument(args, "objects");
    const result = validateIntegrity(objects, deriveEdges(objects));
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  },
  graphCycle: (args) => {
    const objects = shapeObjectListArgument(args, "objects");
    const found = detectCycle(deriveEdges(objects));
    return found.hasCycle ? { cycle: found.cycle.map(encodeAddress) } : { cycle: null };
  },
  graphPass: (args) => {
    const objects = shapeObjectListArgument(args, "objects");
    const result = deriveValidateAndEvaluate(objects, evalContextArgument(args));
    return result.ok
      ? { ok: true, objects: result.objects.map(encodeShapeObject) }
      : { ok: false, message: result.message };
  },
  mathNames: (args) => {
    const reading = readMathNames(textArgument(args, "source"));
    if (isMathSourceError(reading)) {
      return { ok: false, message: reading.message, line: reading.line };
    }
    return {
      ok: true,
      references: reading.names.references.map(encodeAddress),
      exports: [...reading.names.exports],
      inputs: [...reading.names.inputs],
      functions: [...reading.names.functions],
      seeds: [...(reading.names.seeds ?? [])],
    };
  },
  mathApplySource: (args) => {
    const object = shapeObjectArgument(args, "object");
    const source = textArgument(args, "source");
    const reading = readMathNames(source);
    if (isMathSourceError(reading)) {
      return { ok: false, message: reading.message, line: reading.line };
    }
    return { ok: true, object: encodeShapeObject(applyMathSource(object, source, reading.names)) };
  },
  mathDisplay: (args) => readMathDisplayLatex(shapeObjectArgument(args, "object")),
  mathSourceAddresses: (args) => {
    const object = shapeObjectArgument(args, "object");
    return {
      references: mathSourceReferences(object).map(encodeAddress),
      unresolved: unresolvedMathReferences(
        object.slots[slotKey(["source"])]?.value ?? "",
        shapeObjectListArgument(args, "objects"),
      ),
    };
  },
  mathSourceSpelling: (args) => {
    const objects = shapeObjectListArgument(args, "objects");
    const source = textArgument(args, "source");
    return {
      withNames: mathSourceWithNames(source, objects),
      withIds: mathSourceWithIds(source, objects),
      shifted: rewriteMathReferences(source, (address) => ({
        objectId: address.objectId,
        path: [...address.path, "moved"],
      })),
    };
  },
  mathNewObject: (args) =>
    encodeShapeObject(createMathObject("m1", textArgument(args, "name"), 0, 0)),
  parseTextContent: (args) =>
    parseTextContent(textArgument(args, "content"), shapeObjectListArgument(args, "objects")).map(encodeBlock),
  textDependencies: (args) => {
    const blocks = parseTextContent(textArgument(args, "content"), shapeObjectListArgument(args, "objects"));
    return extractTextDependencies(blocks).map(encodeDependency);
  },
  resolveTextDependencies: (args) => {
    const objects = shapeObjectListArgument(args, "objects");
    const object = shapeObjectArgument(args, "object");
    return resolveTextDependencyAddresses(object, objects).map(encodeAddress);
  },
  evaluateTextContent: (args) => {
    const objects = shapeObjectListArgument(args, "objects");
    const blocks = parseTextContent(textArgument(args, "content"), objects);
    return evaluateBlockTree(blocks, slotReaderFor(objects));
  },
  mathMarker: (args) => {
    const found = matchMathMarkerAt(textArgument(args, "content"), safeIntegerArgument(args, "at"));
    return found === undefined ? null : { latex: found.latex, display: found.display, end: found.end };
  },
  documentVariableName: (args) => {
    const problem = documentVariableNameProblem(
      textArgument(args, "name"),
      shapeObjectListArgument(args, "objects"),
      args.exclude === undefined ? undefined : textArgument(args, "exclude"),
    );
    return problem ?? null;
  },
  docrefLabel: (args) =>
    docrefLabel(
      args.target === undefined || args.target === null ? undefined : addressArgument(args, "target"),
      valueArgument(args, "value"),
    ),
  objectSchema: (args) => {
    const object = shapeObjectArgument(args, "object");
    const schema = getObjectSchema(object.type);
    if (schema === undefined) {
      return { declared: false };
    }
    const derived = resolveDerivedSlots(object, schema.derivedSlots);
    return {
      declared: true,
      nonDerived: resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths),
      derived: derived.map((entry) => ({
        path: entry.path,
        dependencies: derivedSlotDependencyAddresses(object, entry.dependencies, [object]).map(encodeAddress),
      })),
      options: (schema.slotOptions ?? []).map((entry) => ({
        path: entry.path,
        values: entry.values.map(encodeValue),
        labels: entry.labels ?? null,
      })),
      formats: (schema.slotFormats ?? []).map((entry) => ({ path: entry.path, format: entry.format })),
    };
  },
  computeDerivedSlots: (args) => {
    const object = shapeObjectArgument(args, "object");
    const schema = getObjectSchema(object.type);
    if (schema === undefined) {
      return { declared: false };
    }
    const read = (address) =>
      address.objectId === object.id ? object.slots[slotKey(address.path)]?.value : undefined;
    const context = evalContextArgument(args);
    return {
      declared: true,
      values: resolveDerivedSlots(object, schema.derivedSlots).map((entry) => ({
        path: entry.path,
        value: encodeValue(entry.compute(object, read, context, { objects: [object] })),
      })),
    };
  },
  slotNarrowing: (args) => {
    const type = objectTypeArgument(args, "type");
    const path = pathArgument(args, "path");
    const options = findSlotOptions(type, path);
    return {
      format: findSlotFormat(type, path) ?? null,
      options: options === undefined
        ? null
        : { values: options.values.map(encodeValue), labels: options.labels ?? null },
    };
  },
  colorValue: (args) => isColorValue(valueArgument(args, "value")),
  tableCellPaths: (args) => {
    const object = shapeObjectArgument(args, "object");
    const size = getTableDimensions(object);
    return {
      rows: encodeNumber(size.rows),
      cols: encodeNumber(size.cols),
      cells: enumerateTableCellSlotPaths(object),
      rowsResizable: isTableDimensionResizable(object, "row"),
      columnsResizable: isTableDimensionResizable(object, "column"),
    };
  },
  tableRange: (args) => {
    const result = enumerateRangeCellAddresses(
      addressArgument(args, "start"),
      addressArgument(args, "end"),
      shapeObjectArgument(args, "object"),
    );
    return isRangeEnumerationError(result)
      ? { error: result.error, message: result.message }
      : { cells: result.map(encodeAddress) };
  },
  tableResize: (args) => {
    const object = shapeObjectArgument(args, "object");
    const axis = tableAxisArgument(args);
    const index = numberArgument(args, "index");
    return {
      inserted: encodeShapeObject(insertTableLine(object, axis, index)),
      deleted: encodeShapeObject(deleteTableLine(object, axis, index)),
    };
  },
  tableAddressRewrite: (args) => {
    const address = addressArgument(args, "address");
    const tableId = textArgument(args, "tableId");
    const axis = tableAxisArgument(args);
    const index = numberArgument(args, "index");
    const repaired = repairCellAddressForDelete(address, tableId, axis, index);
    const range = repairRangeEndpointsForDelete(
      address,
      addressArgument(args, "end"),
      tableId,
      axis,
      index,
    );
    return {
      coordinates: (() => {
        const found = cellAddressToCoordinates(address);
        return found === undefined
          ? null
          : { column: encodeNumber(found.column), row: encodeNumber(found.row) };
      })(),
      forInsert: encodeAddress(shiftCellAddressForInsert(address, tableId, axis, index)),
      repaired: repaired === "deleted" ? "deleted" : encodeAddress(repaired),
      range: range === "deleted"
        ? "deleted"
        : { start: encodeAddress(range.start), end: encodeAddress(range.end) },
    };
  },
  tableCellInExtent: (args) =>
    isInExtentTableCellAddress(addressArgument(args, "address"), [shapeObjectArgument(args, "object")]),
  computePresetVertices: (args) => {
    const kind = textArgument(args, "shape");
    if (kind === "polygon") {
      return computePolygonVertices(
        numberArgument(args, "sides"),
        numberArgument(args, "radius"),
        pointArgument(args, "origin"),
        numberArgument(args, "rotation"),
      ).map(encodePoint);
    }
    if (kind === "rect") {
      return computeRectVertices(
        pointArgument(args, "origin"),
        numberArgument(args, "width"),
        numberArgument(args, "height"),
      ).map(encodePoint);
    }
    throw new BadArgument('the argument "shape" is "polygon" or "rect"');
  },
  verticesMetrics: (args) => {
    const vertices = pointListArgument(args, "vertices");
    const bounds = computeBounds(vertices);
    return {
      area: encodeNumber(computeArea(vertices)),
      centroid: encodePoint(computeCentroid(vertices)),
      vertexMean: encodePoint(computeVertexMean(vertices)),
      perimeterLength: encodeNumber(computePerimeterLength(vertices)),
      openPathLength: encodeNumber(computeOpenPathLength(vertices)),
      bounds: {
        minX: encodeNumber(bounds.minX),
        minY: encodeNumber(bounds.minY),
        maxX: encodeNumber(bounds.maxX),
        maxY: encodeNumber(bounds.maxY),
      },
    };
  },
  vertexSlotPaths: (args) => {
    const object = shapeObjectArgument(args, "object");
    return {
      everyPart: enumeratePolylineVertexSlotPaths(object),
      coordinates: enumeratePolylineCoordinateSlotPaths(object),
      edgeCount: encodeNumber(polylineEdgeCount(object)),
      edges: pathEdgesOfObject(object).map(encodeEdge),
    };
  },
  addVertex: (args) =>
    encodeShapeObject(addVertexToObject(shapeObjectArgument(args, "object"), pointArgument(args, "point"))),
  deleteVertex: (args) =>
    encodeShapeObject(deleteVertexFromObject(shapeObjectArgument(args, "object"), numberArgument(args, "index"))),
  insertVertex: (args) => {
    const object = shapeObjectArgument(args, "object");
    const edgeIndex = numberArgument(args, "edgeIndex");
    const split = splitPolylineEdge(object, edgeIndex, pointArgument(args, "near"));
    if (split === undefined) {
      return { split: false };
    }
    return { split: true, object: encodeShapeObject(insertVertexIntoObject(object, edgeIndex, split)) };
  },
  explodeObject: (args) => {
    const result = explodeObjectToPolyline(shapeObjectArgument(args, "object"), textArgument(args, "label"));
    return result.ok
      ? { ok: true, object: encodeShapeObject(result.object) }
      : { ok: false, message: result.message };
  },
  vertexAddressRewrite: (args) => {
    const address = addressArgument(args, "address");
    const objectId = textArgument(args, "objectId");
    const index = numberArgument(args, "index");
    const repaired = repairVertexAddressForDelete(address, objectId, index);
    return {
      forInsert: encodeAddress(shiftVertexAddressForInsert(address, objectId, index)),
      forDelete: encodeAddress(shiftVertexAddressForDelete(address, objectId, index)),
      repaired: repaired === "deleted" ? "deleted" : encodeAddress(repaired),
    };
  },

  edgeAnswers: (args) => {
    const edge = edgeArgument(args, "edge");
    const handles = cubicHandlesForEdge(edge);
    return {
      arc: encodeArc(arcOfEdge(edge)),
      isBezier: bezierOfEdge(edge) !== undefined,
      length: encodeNumber(edgeLength(edge)),
      doubledAreaOverChord: encodeNumber(edgeDoubledAreaOverChord(edge)),
      midpoint: encodePoint(edgeMidpoint(edge)),
      endDirection: encodePoint(edgeEndDirection(edge)),
      handleOut: encodePoint(handles.out),
      handleIn: encodePoint(handles.in),
      extremePoints: edgeExtremePoints(edge).map(encodePoint),
    };
  },
  pathAnswers: (args) => {
    const edges = pathEdgesArgument(args);
    const bounds = pathBounds(edges);
    return {
      edgeCount: edges.length,
      length: encodeNumber(pathLength(edges)),
      area: encodeNumber(pathArea(edges)),
      doubledSignedArea: encodeNumber(pathDoubledSignedArea(edges)),
      centroid: encodePoint(pathCentroid(edges)),
      bounds: {
        minX: encodeNumber(bounds.minX),
        minY: encodeNumber(bounds.minY),
        maxX: encodeNumber(bounds.maxX),
        maxY: encodeNumber(bounds.maxY),
      },
    };
  },
  splitEdge: (args) => {
    const split = splitEdgeAt(edgeArgument(args, "edge"), pointArgument(args, "near"));
    return {
      point: encodePoint(split.point),
      fraction: encodeNumber(split.fraction),
      firstBulge: encodeNumber(split.firstBulge),
      secondBulge: encodeNumber(split.secondBulge),
      startOutHandle: encodePoint(split.startOutHandle),
      newInHandle: encodePoint(split.newInHandle),
      newOutHandle: encodePoint(split.newOutHandle),
      endInHandle: encodePoint(split.endInHandle),
    };
  },
  pathContains: (args) => pathContains(pointArgument(args, "point"), pathEdgesArgument(args)),
  distanceToPath: (args) =>
    encodeNumber(distanceToPath(pointArgument(args, "point"), pathEdgesArgument(args))),
  distanceToEdge: (args) =>
    encodeNumber(distanceToEdge(pointArgument(args, "point"), edgeArgument(args, "edge"))),
  distanceToSegment: (args) =>
    encodeNumber(
      distanceToSegment(
        pointArgument(args, "point"),
        pointArgument(args, "start"),
        pointArgument(args, "end"),
      ),
    ),
  bulgeForMidpoint: (args) =>
    encodeNumber(
      bulgeForMidpoint(
        pointArgument(args, "start"),
        pointArgument(args, "end"),
        pointArgument(args, "midpoint"),
      ),
    ),
  bulgeForTangentArc: (args) =>
    encodeNumber(
      bulgeForTangentArc(
        pointArgument(args, "start"),
        pointArgument(args, "end"),
        pointArgument(args, "direction"),
      ),
    ),
  sweepCoversAngle: (args) => {
    const arc = arcOfEdge(edgeArgument(args, "edge"));
    if (arc === undefined) {
      throw new BadArgument("the argument \"edge\" is an edge that rides on a circle");
    }
    return sweepCoversAngle(arc, numberArgument(args, "angle"));
  },
  javascriptArithmetic: (args) => {
    const name = textArgument(args, "function");
    const implementation = JAVASCRIPT_ARITHMETIC[name];
    if (implementation === undefined) {
      throw new Error(`no arithmetic named "${name}"`);
    }
    const x = numberArgument(args, "x");
    return encodeNumber(
      TWO_ARGUMENT_ARITHMETIC.has(name) ? implementation(x, numberArgument(args, "y")) : implementation(x),
    );
  },
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
  evaluateMathObject: (args) => {
    const program = parseMath(textArgument(args, "source"));
    if ("error" in program) {
      return { error: program.error, message: program.message, line: program.line };
    }
    const numbers = (name) =>
      Object.fromEntries(Object.entries(args[name] ?? {}).map(([key, value]) => [key, decodeNumber(value)]));
    const evaluation = evaluateMathObject(program, numbers("inputs"), numbers("references"), numbers("seeds"));
    // The exports go out as a list of pairs, because a JSON object reaches the
    // Rust runner through a sorted map and the order the lines define the
    // names in is part of what the comparison asks about.
    return Object.entries(evaluation.exports).map(([name, value]) => [name, encodeValue(value)]);
  },
  resolveMathNames: (args) => {
    const program = parseMath(textArgument(args, "source"));
    if ("error" in program) {
      return { error: program.error, message: program.message, line: program.line };
    }
    const names = resolveMathNames(program);
    if ("error" in names) {
      return { error: names.error, message: names.message, line: names.line };
    }
    return {
      references: names.references.map(encodeAddress),
      exports: [...names.exports],
      inputs: [...names.inputs],
      functions: [...names.functions],
      seeds: [...names.seeds],
    };
  },
  parseMath: (args) => {
    const result = parseMath(textArgument(args, "source"));
    if ("error" in result) {
      return { error: result.error, message: result.message, line: result.line };
    }
    return { lines: result.lines.map(encodeMathLine) };
  },
  tokenizeMath: (args) => {
    const result = tokenizeMath(textArgument(args, "source"));
    if (!Array.isArray(result)) {
      return { error: result.error, message: result.message, start: result.start };
    }
    return result.map((token) => ({
      type: token.type,
      text: token.text,
      start: token.start,
      value: encodeNumber(token.value),
      name: token.name,
    }));
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
