/**
 * commands.ts
 *
 * The handlers. Each one turns a command object into a list of mutation
 * operations and the line the log shows.
 *
 * Refusal messages are written here rather than in the engine, so this file
 * carries the part of the debug story that quotes command syntax. The
 * engine refuses with the facts it has: deleteVertex names the formulas
 * that depend on the vertex, and knows nothing about a force flag. The
 * handler adds the suggestion to retry with force, because an Operation has
 * no command syntax to quote. deleteObject and explode split the work the
 * same way.
 *
 * Command-layer code: it turns a typed line into mutation calls, and
 * imports from the engine and from its own layer.
 */
import {
  type Address,
  addressKey,
  bezierOfEdge,
  bulgeForMidpoint,
  CLOSED_PATH,
  cubicHandlesForEdge,
  deriveEdges,
  DOC_TYPE,
  DOCREF_TYPE,
  documentVariableNameProblem,
  nameSuggestion,
  objectSlotPaths,
  edgeMidpoint,
  type PathEdge,
  pathEdgesOfObject,
  QUARTER_TURN_BULGE,
  type Document,
  type Edge,
  type EvalContext,
  findDerivedSlotSchema,
  COLOR_NONE,
  findObjectByName,
  findSlotFormat,
  findSlotOptions,
  isColorValue,
  formatAddress,
  formatFormula,
  generateDefaultName,
  GEOMETRY_STYLE_DEFAULTS,
  getObjectSchema,
  getSlot,
  type GraphObject,
  IMAGE_HEIGHT_PATH,
  IMAGE_OPACITY_PATH,
  IMAGE_PICTURE_ASPECT_PATH,
  IMAGE_PRESERVE_ASPECT_PATH,
  IMAGE_SOURCE_PATH,
  IMAGE_WIDTH_PATH,
  isAddressError,
  isLegalPortName,
  isParseError,
  isReferenceNode,
  isValidName,
  MAX_TABLE_LINES,
  MIN_POLYGON_SIDES,
  MIN_POLYLINE_VERTICES,
  MIN_TABLE_LINES,
  mintObjectId,
  mutate,
  NULL_EVAL_CONTEXT,
  type ObjectType,
  type Operation,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  parseAddress,
  parseFormula,
  POLYGON_ROTATION_PATH,
  POLYGON_SIDES_PATH,
  POLYLINE_TYPE,
  RADIUS_PATH,
  RECT_HEIGHT_PATH,
  RECT_WIDTH_PATH,
  resolveDerivedSlots,
  resolveNonDerivedSlotPaths,
  SCRIPT_LANGUAGE_PATH,
  createMathObject,
  mathSourceWithIds,
  SCRIPT_SOURCE_PATH,
  SCRIPT_TYPE,
  scriptInPortPath,
  scriptOutPortPath,
  scriptPlaceholderPath,
  type Slot,
  slotKey,
  splitPolylineEdge,
  TABLE_CELL_PATH_PREFIX,
  TABLE_COLS_PATH,
  TABLE_ROWS_PATH,
  TABLE_TYPE,
  TEXT_AUTORESIZE_PATH,
  TEXT_CONTENT_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_STYLE_ALIGN_PATH,
  TEXT_STYLE_COLOR_PATH,
  TEXT_STYLE_FONT_PATH,
  TEXT_STYLE_FONT_SIZE_PATH,
  TEXT_STYLE_LINE_HEIGHT_PATH,
  TEXT_TYPE,
  TEXT_WIDTH_PATH,
  type Value,
  vertexBulgePath,
  vertexHandleInPaths,
  vertexHandleOutPaths,
  vertexXPath,
  vertexYPath,
} from "../engine/index.ts";
import { buildSlotDescriptors, describeSlotValue, type SlotDescriptor } from "./props.ts";
import type {
  AddPortCommand,
  AddVertexCommand,
  ClearCommand,
  Command,
  CreateCircleCommand,
  CreateImageCommand,
  CreatePolygonCommand,
  CreatePolylineCommand,
  CreateRectCommand,
  CreateMathCommand,
  CreateScriptCommand,
  CreateTableCommand,
  CreateTextCommand,
  DeleteCommand,
  DeleteVertexCommand,
  EdgeTypeCommand,
  EdgeTypeName,
  ExplodeCommand,
  SplitEdgeCommand,
  LinkCommand,
  PropsCommand,
  RefsCommand,
  RemovePortCommand,
  RenameCommand,
  SelectCommand,
  SetFormulaCommand,
  SetLiteralCommand,
  UnlinkCommand,
  ZoomCommand,
} from "./parser.ts";
import { EDGE_TYPE_NAMES } from "./parser.ts";

export type CommandOutcome =
  | {
      readonly ok: true;
      readonly document: Document;
      readonly lines: readonly string[];
      readonly effect?: CommandEffect;
      readonly createdObjectId?: string;
    }
  | { readonly ok: false; readonly message: string };

export type CommandEffect =
  | { readonly kind: "select"; readonly objectId: string }
  | { readonly kind: "zoom"; readonly factor: number }
  | { readonly kind: "fit" }
  | { readonly kind: "save" }
  | { readonly kind: "load" };

export function isCommandFailure(outcome: CommandOutcome): outcome is { readonly ok: false; readonly message: string } {
  return outcome.ok === false;
}

export const MAX_POLYGON_SIDES = 1000;

const DEFAULT_POLYGON_ROTATION = 0;

const DEFAULT_TEXT_WIDTH = "auto";
const DEFAULT_TEXT_HEIGHT = "auto";

const DEFAULT_TEXT_AUTORESIZE = true;
const DEFAULT_TEXT_STYLE_FONT = "sans-serif";
const DEFAULT_TEXT_STYLE_FONT_SIZE = 16;
const DEFAULT_TEXT_STYLE_LINE_HEIGHT = 20;
// Every colour slot holds a hex colour, so the typed form and the picked form
// agree. A canvas reads "black" too, but a picker can never give it back.
const DEFAULT_TEXT_STYLE_COLOR = "#000000";
const DEFAULT_TEXT_STYLE_ALIGN = "left";

export const DEFAULT_IMAGE_EXTENT = 100;
const DEFAULT_IMAGE_WIDTH = DEFAULT_IMAGE_EXTENT;
const DEFAULT_IMAGE_HEIGHT = DEFAULT_IMAGE_EXTENT;
const DEFAULT_IMAGE_OPACITY = 1;
const DEFAULT_IMAGE_SOURCE = "";
const DEFAULT_IMAGE_PRESERVE_ASPECT = true;
const DEFAULT_IMAGE_PICTURE_ASPECT = 0;

const DEFAULT_SCRIPT_LANGUAGE = "python";
const DEFAULT_SCRIPT_SOURCE = "";

function refuseCountOutOfRange(name: string, value: number, minimum: number, maximum: number): string | undefined {
  if (Number.isInteger(value) && value >= minimum && value <= maximum) {
    return undefined;
  }
  return `${name} must be a whole number from ${minimum} to ${maximum}, got ${value}`;
}

/** Runs one command object. It returns the new document, log lines and any effect. */
export function executeCommand(command: Command, document: Document, context: EvalContext = NULL_EVAL_CONTEXT): CommandOutcome {
  switch (command.kind) {
    case "renamevar":
      return renameDocumentVariable(command, document, context);
    case "docvar":
      return writeDocumentVariable(command, document, context);
    case "delvar":
      return deleteDocumentVariable(command, document, context);
    case "vars":
      // The doc object draws nothing, so selecting it is the whole of what
      // `vars` does: the panel is the only surface a variable with no copy has.
      return select({ kind: "select", target: DOC_TYPE }, document);
    case "circle":
      return createCircle(command, document, context);
    case "polygon":
      return createPolygon(command, document, context);
    case "rect":
      return createRect(command, document, context);
    case "polyline":
      return createPolyline(command, document, context);
    case "text":
      return createText(command, document, context);
    case "table":
      return createTable(command, document, context);
    case "image":
      return createImage(command, document, context);
    case "script":
      return createScript(command, document, context);
    case "math":
      return createMath(command, document, context);
    case "set":
      return setLiteral(command, document, context);
    case "set-formula":
      return setFormula(command, document, context);
    case "link":
      return link(command, document, context);
    case "unlink":
      return unlink(command, document, context);
    case "clear":
      return clearSlotCommand(command, document, context);
    case "addport":
      return addPortCommand(command, document, context);
    case "removeport":
      return removePortCommand(command, document, context);
    case "rename":
      return renameObject(command, document, context);
    case "delete":
      return deleteObject(command, document, context);
    case "addvertex":
      return addVertex(command, document, context);
    case "delvertex":
      return deleteVertex(command, document, context);
    case "explode":
      return explodeObject(command, document, context);
    case "split":
      return splitEdge(command, document, context);
    case "edgetype":
      return setEdgeType(command, document, context);
    case "refs":
      return refs(command, document);
    case "props":
      return props(command, document);
    case "list":
      return list(document);
    case "select":
      return select(command, document);
    case "zoom":
      return zoom(command, document);
    case "fit":
      return fit(document);
    case "save":
      return save(document);
    case "load":
      return load(document);
    default: {
      const exhaustive: never = command;
      void exhaustive;
      return { ok: false, message: "this command declares a kind no handler reads" };
    }
  }
}

export const COMMANDS_WITH_HANDLERS: readonly string[] = [
  "renamevar",
  "docvar", "delvar", "vars",
  "circle",
  "polygon",
  "rect",
  "polyline",
  "text",
  "table",
  "image",
  "script",
  "math",
  "set",
  "link",
  "unlink",
  "clear",
  "addport",
  "removeport",
  "rename",
  "delete",
  "addvertex",
  "delvertex",
  "explode",
  "split",
  "edgetype",
  "refs",
  "props",
  "list",
  "select",
  "zoom",
  "fit",
  "save",
  "load",
];

interface LiteralSlotDeclaration {
  readonly path: readonly string[];
  readonly value: Value;
}

function createObjectFromCommand(
  document: Document,
  type: ObjectType,
  literals: readonly LiteralSlotDeclaration[],
  context: EvalContext,
  vertexCount?: number,
): CommandOutcome {
  const schema = getObjectSchema(type);
  if (schema === undefined) {
    return { ok: false, message: `object type "${type}" has no schema, so nothing can create one` };
  }

  const minted = mintObjectId(document);
  if ("ok" in minted) return minted;
  const name = generateDefaultName(type, document.objects);

  const slots: Record<string, Slot> = {};
  for (const literal of literals) {
    slots[slotKey(literal.path)] = { kind: "literal", value: literal.value };
  }
  const objectSoFar: GraphObject = { id: minted.id, name, type, slots };
  for (const derived of resolveDerivedSlots(objectSoFar, schema.derivedSlots)) {
    slots[slotKey(derived.path)] = { kind: "derived", value: null };
  }

  const object: GraphObject = { id: minted.id, name, type, slots, ...(vertexCount === undefined ? {} : { vertexCount }) };
  const operation: Operation = { kind: "createObject", object };
  const result = mutate(document.objects, [operation], document.journal, context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    document: { ...document, nextObjectId: minted.nextObjectId, objects: result.objects, journal: result.journal },
    lines: [`created ${name}`],
    createdObjectId: minted.id,
  };
}

/** Every shape starts with the same outline and no fill. A formula can drive each slot later. */
function withGeometryStyle(literals: readonly LiteralSlotDeclaration[]): LiteralSlotDeclaration[] {
  return [...literals, ...GEOMETRY_STYLE_DEFAULTS.map((entry) => ({ path: entry.path, value: entry.value }))];
}

function createCircle(command: CreateCircleCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "circle", withGeometryStyle([
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: RADIUS_PATH, value: command.radius },
  ]), context);
}

function createPolygon(command: CreatePolygonCommand, document: Document, context: EvalContext): CommandOutcome {
  const refusal = refuseCountOutOfRange("sides", command.sides, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES);
  if (refusal !== undefined) {
    return { ok: false, message: refusal };
  }
  return createObjectFromCommand(document, "polygon", withGeometryStyle([
    { path: POLYGON_SIDES_PATH, value: command.sides },
    { path: RADIUS_PATH, value: command.radius },
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: POLYGON_ROTATION_PATH, value: DEFAULT_POLYGON_ROTATION },
  ]), context);
}

function createRect(command: CreateRectCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "rect", withGeometryStyle([
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: RECT_WIDTH_PATH, value: command.width },
    { path: RECT_HEIGHT_PATH, value: command.height },
  ]), context);
}

function createPolyline(command: CreatePolylineCommand, document: Document, context: EvalContext): CommandOutcome {
  if (command.points.length < MIN_POLYLINE_VERTICES) {
    return { ok: false, message: `a polyline needs at least ${MIN_POLYLINE_VERTICES} points, got ${command.points.length}` };
  }
  const literals: LiteralSlotDeclaration[] = [{ path: CLOSED_PATH, value: command.closed }];
  command.points.forEach((point, index) => {
    literals.push({ path: vertexXPath(index), value: point.x });
    literals.push({ path: vertexYPath(index), value: point.y });
    literals.push({ path: vertexBulgePath(index), value: command.bulges[index] ?? 0 });
    const handleIn = vertexHandleInPaths(index);
    const handleOut = vertexHandleOutPaths(index);
    literals.push({ path: handleIn.x, value: 0 });
    literals.push({ path: handleIn.y, value: 0 });
    literals.push({ path: handleOut.x, value: 0 });
    literals.push({ path: handleOut.y, value: 0 });
  });
  return createObjectFromCommand(document, "polyline", withGeometryStyle(literals), context, command.points.length);
}

function createTable(command: CreateTableCommand, document: Document, context: EvalContext): CommandOutcome {
  const refusals = [
    refuseCountOutOfRange("rows", command.rows, MIN_TABLE_LINES, MAX_TABLE_LINES),
    refuseCountOutOfRange("cols", command.cols, MIN_TABLE_LINES, MAX_TABLE_LINES),
  ].filter((refusal): refusal is string => refusal !== undefined);
  if (refusals.length > 0) {
    return { ok: false, message: refusals.join("; ") };
  }
  return createObjectFromCommand(document, "table", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: TABLE_ROWS_PATH, value: command.rows },
    { path: TABLE_COLS_PATH, value: command.cols },
  ], context);
}

function createText(command: CreateTextCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "text", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: TEXT_CONTENT_PATH, value: command.content },
    { path: TEXT_WIDTH_PATH, value: DEFAULT_TEXT_WIDTH },
    { path: TEXT_HEIGHT_PATH, value: DEFAULT_TEXT_HEIGHT },
    { path: TEXT_AUTORESIZE_PATH, value: DEFAULT_TEXT_AUTORESIZE },
    { path: TEXT_STYLE_FONT_PATH, value: DEFAULT_TEXT_STYLE_FONT },
    { path: TEXT_STYLE_FONT_SIZE_PATH, value: DEFAULT_TEXT_STYLE_FONT_SIZE },
    { path: TEXT_STYLE_LINE_HEIGHT_PATH, value: DEFAULT_TEXT_STYLE_LINE_HEIGHT },
    { path: TEXT_STYLE_COLOR_PATH, value: DEFAULT_TEXT_STYLE_COLOR },
    { path: TEXT_STYLE_ALIGN_PATH, value: DEFAULT_TEXT_STYLE_ALIGN },
  ], context);
}

function createImage(command: CreateImageCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "image", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: IMAGE_WIDTH_PATH, value: DEFAULT_IMAGE_WIDTH },
    { path: IMAGE_HEIGHT_PATH, value: DEFAULT_IMAGE_HEIGHT },
    { path: IMAGE_OPACITY_PATH, value: DEFAULT_IMAGE_OPACITY },
    { path: IMAGE_SOURCE_PATH, value: DEFAULT_IMAGE_SOURCE },
    { path: IMAGE_PRESERVE_ASPECT_PATH, value: DEFAULT_IMAGE_PRESERVE_ASPECT },
    { path: IMAGE_PICTURE_ASPECT_PATH, value: DEFAULT_IMAGE_PICTURE_ASPECT },
  ], context);
}

function createScript(command: CreateScriptCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "script", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: SCRIPT_LANGUAGE_PATH, value: DEFAULT_SCRIPT_LANGUAGE },
    { path: SCRIPT_SOURCE_PATH, value: DEFAULT_SCRIPT_SOURCE },
  ], context);
}

/**
 * Creates a math object and writes its source in one batch. The two land
 * together because the source decides which port slots the object carries, and
 * an object committed without them would be a math object that reads nothing
 * until a second command arrived.
 */
function createMath(command: CreateMathCommand, document: Document, context: EvalContext): CommandOutcome {
  const minted = mintObjectId(document);
  if ("ok" in minted) return minted;
  const name = generateDefaultName("math", document.objects);
  const object = createMathObject(minted.id, name, command.x, command.y);

  const operations: Operation[] = [{ kind: "createObject", object }];
  if (command.source !== "") {
    // An operator writes an address by the name it carries, and the document
    // stores the id, so a rename rewrites nothing.
    operations.push({ kind: "setMathSource", objectId: minted.id, source: mathSourceWithIds(command.source, document.objects) });
  }

  const result = mutate(document.objects, operations, document.journal, context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    document: { ...document, nextObjectId: minted.nextObjectId, objects: result.objects, journal: result.journal },
    lines: [`created ${name}`],
    createdObjectId: minted.id,
  };
}

interface WritableSlotTarget {
  readonly object: GraphObject;
  readonly address: Address;
  readonly existing: Slot | undefined;
  readonly displayName: string;
}

type SlotTargetResult = { readonly ok: true; readonly target: WritableSlotTarget } | { readonly ok: false; readonly message: string };

function resolveWritableSlot(target: string, document: Document): SlotTargetResult {
  const address = parseAddress(target, document.objects);
  if (isAddressError(address)) {
    return { ok: false, message: address.message };
  }
  const object = document.objects.find((candidate) => candidate.id === address.objectId);
  if (object === undefined) {
    return { ok: false, message: `no object with id "${address.objectId}"` };
  }
  const displayName = formatSlotName(address, document.objects, target);

  if (findDerivedSlotSchema(object, address.path) !== undefined) {
    return { ok: false, message: `${displayName} is a derived slot — its value is computed by its object's schema and can never be set or linked` };
  }

  const schema = getObjectSchema(object.type);
  if (schema === undefined) {
    return { ok: false, message: `object type "${object.type}" has no schema, so nothing can say which slots ${object.name} has` };
  }
  const declared = resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths).some((path) => slotKey(path) === slotKey(address.path));
  if (!declared) {
    return { ok: false, message: `${object.name} has no slot at "${target}" — object type "${object.type}" does not declare one${nameSuggestion(target.includes(".") ? target.slice(target.indexOf(".") + 1) : target, objectSlotPaths(object))}` };
  }

  return { ok: true, target: { object, address, existing: getSlot(object, address.path), displayName } };
}

function formatSlotName(address: Address, objects: readonly GraphObject[], typed: string): string {
  const formatted = formatAddress(address, objects);
  return isAddressError(formatted) ? typed : formatted;
}

type SlotWrite =
  | { readonly kind: "literal"; readonly value: number | string | boolean }
  | { readonly kind: "formula"; readonly source: string; readonly mustBeReference: boolean }
  | { readonly kind: "unlink" };

function writeSlot(write: SlotWrite, targetText: string, document: Document, context: EvalContext): CommandOutcome {
  const resolved = resolveWritableSlot(targetText, document);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const { address, existing } = resolved.target;

  const built = buildSlot(write, resolved.target, document);
  if (!built.ok) {
    return { ok: false, message: built.message };
  }

  const result = mutate(document.objects, [{ kind: "setSlot", address, slot: built.slot }], document.journal, context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  const lines = [...built.lines];
  if (write.kind !== "unlink" && existing !== undefined && existing.kind === "formula") {
    lines.push(`replaced formula: = ${formatFormula(existing.ast, document.objects)}`);
  }
  return { ok: true, document: { ...document, objects: result.objects, journal: result.journal }, lines };
}

type SlotBuildResult = { readonly ok: true; readonly slot: Slot; readonly lines: readonly string[] } | { readonly ok: false; readonly message: string };

/**
 * The refusal for a literal outside the values its slot declares, or nothing.
 *
 * A slot with an option list takes those values and no others. Without this,
 * "set path.closed 0" writes a number to a slot that reads booleans, and the
 * write reports success. Every derived slot of the object then turns into a
 * #TYPE error that names no cause. A formula still writes what it likes,
 * because only evaluation knows what a formula produces.
 */
type FormattedRead = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly message: string };

/**
 * The value a slot with a declared format takes, or a refusal that names the
 * form it wants.
 *
 * A colour slot takes a hex colour, or the word "none" for no colour at all,
 * which writes null. A canvas quietly ignores a colour string it cannot read.
 * It paints the colour of the shape before it instead, so a wrong colour is
 * invisible rather than loud. This is where it becomes loud.
 */
function readFormattedValue(value: Value, target: WritableSlotTarget): FormattedRead {
  if (findSlotFormat(target.object.type, target.address.path) !== "color") {
    return { ok: true, value };
  }
  const folded = typeof value === "string" ? value.trim().toLowerCase() : value;
  if (folded === COLOR_NONE) {
    return { ok: true, value: null };
  }
  if (isColorValue(folded)) {
    return { ok: true, value: folded };
  }
  return {
    ok: false,
    message: `${target.displayName} takes a hex colour such as #1a1a1a, or "${COLOR_NONE}", and not ${describeSlotValue(value)}`,
  };
}

function refuseValueOffTheOptionList(value: Value, target: WritableSlotTarget): string | undefined {
  const options = findSlotOptions(target.object.type, target.address.path);
  if (options === undefined || options.values.some((candidate) => candidate === value)) {
    return undefined;
  }
  const offered = options.values.map((candidate) => describeSlotValue(candidate)).join(" or ");
  return `${target.displayName} takes ${offered}, and not ${describeSlotValue(value)}`;
}

function buildSlot(write: SlotWrite, target: WritableSlotTarget, document: Document): SlotBuildResult {
  switch (write.kind) {
    case "literal": {
      const offList = refuseValueOffTheOptionList(write.value, target);
      if (offList !== undefined) {
        return { ok: false, message: offList };
      }
      const read = readFormattedValue(write.value, target);
      if (!read.ok) {
        return read;
      }
      return { ok: true, slot: { kind: "literal", value: read.value }, lines: [`${target.displayName} = ${describeSlotValue(read.value)}`] };
    }
    case "formula": {
      if (isTextContentTarget(target)) {
        return {
          ok: false,
          message: `${target.displayName} is read as raw source only — a text object's content cannot be a formula or a link. Write it with: set ${target.displayName} "..."`,
        };
      }
      const source = write.source.trim();
      const ast = parseFormula(source, document.objects, cellHostObjectId(target));
      if (isParseError(ast)) {
        return { ok: false, message: `${ast.message} (at position ${ast.start} of "${source}")` };
      }
      if (write.mustBeReference && !isReferenceNode(ast)) {
        return { ok: false, message: `"link" takes an address as its source — usage: link <address> <address>. Use "set ${target.displayName} = ${source}" to write a formula` };
      }
      return { ok: true, slot: { kind: "formula", ast, value: null }, lines: [`${target.displayName} = ${formatFormula(ast, document.objects)}`] };
    }
    case "unlink": {
      const existing = target.existing;
      if (existing === undefined || existing.kind !== "formula") {
        const state = existing === undefined ? "holds nothing" : `is already a "${existing.kind}" slot`;
        return { ok: false, message: `${target.displayName} ${state} — "unlink" reverts a formula slot to a literal` };
      }
      return {
        ok: true,
        slot: { kind: "literal", value: existing.value },
        lines: [`unlinked ${target.displayName} — kept ${describeSlotValue(existing.value)}`, `removed formula: = ${formatFormula(existing.ast, document.objects)}`],
      };
    }
    default: {
      const exhaustive: never = write;
      void exhaustive;
      return { ok: false, message: "this slot write declares a kind no builder reads" };
    }
  }
}

function isTextContentTarget(target: WritableSlotTarget): boolean {
  return target.object.type === TEXT_TYPE && slotKey(target.address.path) === slotKey(TEXT_CONTENT_PATH);
}

function cellHostObjectId(target: WritableSlotTarget): string | undefined {
  const isCell = target.object.type === TABLE_TYPE && target.address.path.length === 2 && target.address.path[0] === TABLE_CELL_PATH_PREFIX;
  return isCell ? target.object.id : undefined;
}

function setLiteral(command: SetLiteralCommand, document: Document, context: EvalContext): CommandOutcome {
  return writeSlot({ kind: "literal", value: command.value }, command.target, document, context);
}

function setFormula(command: SetFormulaCommand, document: Document, context: EvalContext): CommandOutcome {
  return writeSlot({ kind: "formula", source: command.source.slice(1), mustBeReference: false }, command.target, document, context);
}

function link(command: LinkCommand, document: Document, context: EvalContext): CommandOutcome {
  return writeSlot({ kind: "formula", source: command.source, mustBeReference: true }, command.target, document, context);
}

function unlink(command: UnlinkCommand, document: Document, context: EvalContext): CommandOutcome {
  return writeSlot({ kind: "unlink" }, command.target, document, context);
}

function clearSlotCommand(command: ClearCommand, document: Document, context: EvalContext): CommandOutcome {
  const resolved = resolveWritableSlot(command.target, document);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const { address, existing, displayName } = resolved.target;
  if (cellHostObjectId(resolved.target) === undefined) {
    return {
      ok: false,
      message: `${displayName} is not a table cell — "clear" empties a cell by removing it, and only a cell has an empty state. Use "set ${displayName} <value>" instead`,
    };
  }
  if (existing === undefined) {
    return { ok: true, document, lines: [`${displayName} is already empty`] };
  }
  const was = existing.kind === "formula"
    ? `= ${formatFormula(existing.ast, document.objects)}`
    : describeSlotValue(existing.value);
  const result = mutate(document.objects, [{ kind: "clearSlot", address }], document.journal, context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, document: { ...document, objects: result.objects, journal: result.journal }, lines: [`cleared ${displayName} — was ${was}`] };
}

interface PortTarget {
  readonly object: GraphObject;
  readonly family: "in" | "out";
  readonly name: string;
}

type PortTargetResult = { readonly ok: true; readonly target: PortTarget } | { readonly ok: false; readonly message: string };

function resolvePortTarget(target: string, document: Document): PortTargetResult {
  const address = parseAddress(target, document.objects);
  if (isAddressError(address)) {
    return { ok: false, message: address.message };
  }
  const object = document.objects.find((candidate) => candidate.id === address.objectId);
  if (object === undefined) {
    return { ok: false, message: `no object named in "${target}"` };
  }
  if (object.type !== SCRIPT_TYPE) {
    return { ok: false, message: `${object.name} is a "${object.type}" object — only a script node has ports` };
  }
  if (address.path.length !== 2) {
    return { ok: false, message: `"${target}" does not name a port — use <object>.in.<port> or <object>.out.<port>` };
  }
  const family = address.path[0];
  const name = address.path[1] ?? "";
  if (family !== "in" && family !== "out") {
    return { ok: false, message: `"${family ?? ""}" is not a port family — use "in" or "out"` };
  }
  if (!isLegalPortName(name)) {
    return { ok: false, message: `"${name}" is not a legal port name — letters, digits and underscores only` };
  }
  return { ok: true, target: { object, family, name } };
}

function addPortCommand(command: AddPortCommand, document: Document, context: EvalContext): CommandOutcome {
  const resolved = resolvePortTarget(command.target, document);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const { object, family, name } = resolved.target;
  const operations: Operation[] =
    family === "in"
      ? [
          { kind: "addPort", objectId: object.id, family, name },
          { kind: "setSlot", address: { objectId: object.id, path: scriptInPortPath(name) }, slot: { kind: "literal", value: null } },
        ]
      : [
          { kind: "addPort", objectId: object.id, family, name },
          ...(getSlot(object, scriptPlaceholderPath(name)) === undefined
            ? [{ kind: "setSlot", address: { objectId: object.id, path: scriptPlaceholderPath(name) }, slot: { kind: "literal", value: null } } as Operation]
            : []),
          { kind: "setSlot", address: { objectId: object.id, path: scriptOutPortPath(name) }, slot: { kind: "derived", value: null } },
        ];

  const result = mutate(document.objects, operations, document.journal, context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  const address = `${object.name}.${family}.${name}`;
  return {
    ok: true,
    document: { ...document, objects: result.objects, journal: result.journal },
    lines:
      family === "in"
        ? [`added input port ${address} — bind it with \`link ${address} <address>\``]
        : [`added output port ${address} — set its stub value with \`set ${object.name}.placeholder.${name} <value>\``],
  };
}

function removePortCommand(command: RemovePortCommand, document: Document, context: EvalContext): CommandOutcome {
  const resolved = resolvePortTarget(command.target, document);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const { object, family, name } = resolved.target;
  const declared = (family === "in" ? object.ports?.in : object.ports?.out) ?? [];
  if (!declared.includes(name)) {
    return { ok: false, message: `${object.name} has no ${family} port named "${name}"` };
  }
  const operations: Operation[] = [{ kind: "removePort", objectId: object.id, family, name }];

  const result = mutate(document.objects, operations, document.journal, context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    document: { ...document, objects: result.objects, journal: result.journal },
    lines: [`removed ${family} port ${object.name}.${family}.${name}`],
  };
}

function renameObject(command: RenameCommand, document: Document, context: EvalContext): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"${nameSuggestion(command.target, document.objects.map((object) => object.name))}` };
  }

  const result = mutate(document.objects, [{ kind: "renameObject", objectId: object.id, name: command.newName }], document.journal, context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    document: { ...document, objects: result.objects, journal: result.journal },
    lines: [`renamed ${object.name} to ${command.newName}`],
  };
}

function deleteObject(command: DeleteCommand, document: Document, context: EvalContext): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"${nameSuggestion(command.target, document.objects.map((object) => object.name))}` };
  }

  const result = mutate(document.objects, [{ kind: "deleteObject", objectId: object.id, force: command.force }], document.journal, context);
  if (!result.ok) {
    return {
      ok: false,
      message: command.force ? result.message : `${result.message} — unlink each, or "delete ${object.name} force" to rewrite them to #REF instead`,
    };
  }

  const lines = [`deleted ${object.name}`];
  if (result.brokenSlots.length > 0) {
    const broken = result.brokenSlots.map((address) => formatSlotAddress(address, result.objects));
    lines.push(`broke ${countedNoun(broken.length, "formula")}: ${broken.join(", ")} — each now reads #REF where it read ${object.name}`);
  }
  return { ok: true, document: { ...document, objects: result.objects, journal: result.journal }, lines };
}

function addVertex(command: AddVertexCommand, document: Document, context: EvalContext): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"${nameSuggestion(command.target, document.objects.map((object) => object.name))}` };
  }
  if (object.type !== POLYLINE_TYPE) {
    return { ok: false, message: `${object.name} is a "${object.type}" object — only a polyline has vertices to add` };
  }
  if (command.points.length !== 1) {
    return { ok: false, message: `addvertex takes exactly one point, given as x,y — got ${command.points.length}` };
  }
  const point = command.points[0];
  if (point === undefined) {
    return { ok: false, message: "addvertex needs a point, given as x,y" };
  }

  const newIndex = object.vertexCount ?? 0;
  const result = mutate(document.objects, [{ kind: "addVertex", objectId: object.id, point }], document.journal, context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    document: { ...document, objects: result.objects, journal: result.journal },
    lines: [`added ${object.name}.vertex.${newIndex} at ${describeSlotValue(point)}`],
  };
}

/**
 * Cuts one edge where the operator points, and puts a vertex there. A curved
 * edge becomes two curves of the same circle, so the shape holds still. This
 * is the only way a vertex arrives on a curve. Nothing subdivides an edge.
 */
/**
 * Changes one edge of a path between straight, arc and cubic.
 *
 * The five slots behind an edge say which of the three it is, and no single
 * slot names it. So this is the one gesture that sets all five together. It is
 * also the only way to a cubic that leaves four handle slots untyped.
 *
 * The conversion keeps the shape where it can. A curve that becomes an arc
 * keeps its middle. A straight edge that becomes a curve stays straight, so
 * the operator has two handles to pull. A straight edge that becomes an arc has
 * no shape to keep, so it takes a quarter turn.
 */
function setEdgeType(command: EdgeTypeCommand, document: Document, context: EvalContext): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"${nameSuggestion(command.target, document.objects.map((object) => object.name))}` };
  }
  if (object.type !== POLYLINE_TYPE) {
    return { ok: false, message: `${object.name} is a "${object.type}" object — only a polyline has an edge to shape` };
  }
  const shape = command.shape.trim().toLowerCase();
  if (!EDGE_TYPE_NAMES.some((candidate) => candidate === shape)) {
    return { ok: false, message: `"${command.shape}" is not an edge shape — edgetype takes ${EDGE_TYPE_NAMES.join(", ")}` };
  }
  const edges = pathEdgesOfObject(object);
  const edge = edges[command.index];
  if (edge === undefined) {
    return {
      ok: false,
      message: `${object.name} has no edge ${command.index} — it has ${edges.length} ${edges.length === 1 ? "edge" : "edges"}`,
    };
  }

  const count = object.vertexCount ?? 0;
  const endIndex = (command.index + 1) % count;
  const writes = edgeShapeWrites(shape as EdgeTypeName, edge, command.index, endIndex);
  const held = writes.filter((write) => getSlot(object, write.path)?.kind === "formula").map((write) => slotKey(write.path));
  if (held.length > 0) {
    return {
      ok: false,
      message: `${object.name} cannot change the shape of edge ${command.index}: a formula drives ${held.join(", ")}. Unlink first`,
    };
  }

  const result = mutate(
    document.objects,
    writes.map((write) => ({
      kind: "setSlot" as const,
      address: { objectId: object.id, path: write.path },
      slot: { kind: "literal" as const, value: write.value },
    })),
    document.journal,
    context,
  );
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    document: { ...document, objects: result.objects, journal: result.journal },
    lines: [`${object.name} edge ${command.index} is now a ${shape}`],
  };
}

/** The five slot writes one shape needs. All five move together or none of them do. */
function edgeShapeWrites(
  shape: EdgeTypeName,
  edge: PathEdge,
  index: number,
  endIndex: number,
): readonly { readonly path: readonly string[]; readonly value: number }[] {
  const handleOut = vertexHandleOutPaths(index);
  const handleIn = vertexHandleInPaths(endIndex);
  if (shape === "curve") {
    const handles = cubicHandlesForEdge(edge);
    return [
      { path: vertexBulgePath(index), value: 0 },
      { path: handleOut.x, value: handles.out.x },
      { path: handleOut.y, value: handles.out.y },
      { path: handleIn.x, value: handles.in.x },
      { path: handleIn.y, value: handles.in.y },
    ];
  }
  const bulge = shape === "line" ? 0 : arcBulgeFor(edge);
  return [
    { path: vertexBulgePath(index), value: bulge },
    { path: handleOut.x, value: 0 },
    { path: handleOut.y, value: 0 },
    { path: handleIn.x, value: 0 },
    { path: handleIn.y, value: 0 },
  ];
}

/** The bulge an edge takes when it becomes an arc. It keeps the middle where it can. */
function arcBulgeFor(edge: PathEdge): number {
  if (bezierOfEdge(edge) !== undefined) {
    return bulgeForMidpoint(edge.start, edge.end, edgeMidpoint(edge));
  }
  return edge.bulge === 0 ? QUARTER_TURN_BULGE : edge.bulge;
}

function splitEdge(command: SplitEdgeCommand, document: Document, context: EvalContext): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"${nameSuggestion(command.target, document.objects.map((object) => object.name))}` };
  }
  if (object.type !== POLYLINE_TYPE) {
    return { ok: false, message: `${object.name} is a "${object.type}" object — only a polyline has an edge to split` };
  }
  if (command.points.length !== 1) {
    return { ok: false, message: `split takes exactly one point, given as x,y — got ${command.points.length}` };
  }
  const point = command.points[0];
  if (point === undefined) {
    return { ok: false, message: "split needs a point, given as x,y" };
  }
  const split = splitPolylineEdge(object, command.index, point);
  if (split !== undefined && (split.fraction <= 0 || split.fraction >= 1)) {
    return {
      ok: false,
      message: `that point lands on an end of edge ${command.index}, where ${object.name} already has a vertex — aim between the two ends`,
    };
  }

  const result = mutate(
    document.objects,
    [{ kind: "splitEdge", objectId: object.id, index: command.index, point }],
    document.journal,
    context,
  );
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    document: { ...document, objects: result.objects, journal: result.journal },
    lines: [`split ${object.name}.edge.${command.index}, new vertex ${command.index + 1} at ${describeSlotValue(split?.point ?? point)}`],
  };
}

function deleteVertex(command: DeleteVertexCommand, document: Document, context: EvalContext): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"${nameSuggestion(command.target, document.objects.map((object) => object.name))}` };
  }
  if (object.type !== POLYLINE_TYPE) {
    return { ok: false, message: `${object.name} is a "${object.type}" object — only a polyline has vertices to delete` };
  }

  const result = mutate(
    document.objects,
    [{ kind: "deleteVertex", objectId: object.id, index: command.index, force: command.force }],
    document.journal,
    context,
  );
  if (!result.ok) {
    return {
      ok: false,
      message: command.force
        ? result.message
        : `${result.message} — unlink each, or "delvertex ${object.name} ${command.index} force" to rewrite them to #REF instead`,
    };
  }

  const lines = [`deleted ${object.name}.vertex.${command.index}`];
  if (result.brokenSlots.length > 0) {
    const broken = result.brokenSlots.map((address) => formatSlotAddress(address, result.objects));
    lines.push(`broke ${countedNoun(broken.length, "formula")}: ${broken.join(", ")} — each now reads #REF where it read this vertex`);
  }
  return { ok: true, document: { ...document, objects: result.objects, journal: result.journal }, lines };
}

function explodeObject(command: ExplodeCommand, document: Document, context: EvalContext): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"${nameSuggestion(command.target, document.objects.map((object) => object.name))}` };
  }

  const result = mutate(document.objects, [{ kind: "explode", objectId: object.id, force: command.force }], document.journal, context);
  if (!result.ok) {
    return {
      ok: false,
      message: command.force ? result.message : `${result.message} — unlink each, or "explode ${object.name} force" to rewrite them to #REF instead`,
    };
  }

  const lines = [`exploded ${object.name} into an editable path`];
  if (result.brokenSlots.length > 0) {
    const broken = result.brokenSlots.map((address) => formatSlotAddress(address, result.objects));
    lines.push(`broke ${countedNoun(broken.length, "formula")}: ${broken.join(", ")} — each now reads #REF where it read ${object.name}`);
  }
  return { ok: true, document: { ...document, objects: result.objects, journal: result.journal }, lines };
}

function list(document: Document): CommandOutcome {
  if (document.objects.length === 0) {
    return { ok: true, document, lines: ["no objects"] };
  }
  return { ok: true, document, lines: document.objects.map((object) => `${object.name} — ${object.type}`) };
}

type RefsTarget =
  | { readonly kind: "object"; readonly object: GraphObject }
  | { readonly kind: "slot"; readonly object: GraphObject; readonly address: Address; readonly displayName: string };

function refs(command: RefsCommand, document: Document): CommandOutcome {
  const resolved = resolveRefsTarget(command.target, document);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const target = resolved.target;
  const displayName = target.kind === "object" ? target.object.name : target.displayName;

  const current = partitionDependents(deriveEdges(document.objects), target, document.objects);
  const afterRemoval =
    target.kind === "object"
      ? partitionDependents(deriveEdges(document.objects.filter((candidate) => candidate.id !== target.object.id)), target, document.objects)
      : current;

  const own = current.onTarget;
  const others = afterRemoval.elsewhere;
  if (own.length + others.length === 0) {
    return { ok: true, document, lines: [`nothing references ${displayName}`] };
  }
  const ownSlots = current.onTargetSlotCount;
  const otherSlots = afterRemoval.elsewhereSlotCount;
  return {
    ok: true,
    document,
    lines: [
      ...others,
      ...own,
      `${countedNoun(others.length + own.length, "inbound edge")} from ${countedNoun(otherSlots + ownSlots, "dependent slot")}: ${otherSlots} on other objects, ${ownSlots} on ${target.object.name} itself`,
    ],
  };
}

interface PartitionedDependents {
  readonly onTarget: readonly string[];
  readonly elsewhere: readonly string[];
  readonly onTargetSlotCount: number;
  readonly elsewhereSlotCount: number;
}

function partitionDependents(edges: readonly Edge[], target: RefsTarget, objects: readonly GraphObject[]): PartitionedDependents {
  const onTarget: string[] = [];
  const elsewhere: string[] = [];
  const onTargetSlots = new Set<string>();
  const elsewhereSlots = new Set<string>();
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!edgeReadsTarget(edge.sourceSlot, target)) {
      continue;
    }
    const identity = `${addressKey(edge.sourceSlot)} ${addressKey(edge.dependentSlot)}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    const line = `${formatSlotAddress(edge.sourceSlot, objects)} → ${formatSlotAddress(edge.dependentSlot, objects)}`;
    if (edge.dependentSlot.objectId === target.object.id) {
      onTarget.push(line);
      onTargetSlots.add(addressKey(edge.dependentSlot));
    } else {
      elsewhere.push(line);
      elsewhereSlots.add(addressKey(edge.dependentSlot));
    }
  }
  return { onTarget, elsewhere, onTargetSlotCount: onTargetSlots.size, elsewhereSlotCount: elsewhereSlots.size };
}

function edgeReadsTarget(sourceSlot: Address, target: RefsTarget): boolean {
  if (target.kind === "object") {
    return sourceSlot.objectId === target.object.id;
  }
  return addressKey(sourceSlot) === addressKey(target.address);
}

type RefsTargetResult = { readonly ok: true; readonly target: RefsTarget } | { readonly ok: false; readonly message: string };

function resolveRefsTarget(typed: string, document: Document): RefsTargetResult {
  if (isValidName(typed) && !document.objects.some((object) => object.type === "doc" && Object.keys(object.slots).some((name) => name.toLowerCase() === typed.toLowerCase()))) {
    const object = findGraphObjectByName(typed, document.objects);
    if (object === undefined) {
      return { ok: false, message: `no object named "${typed}"${nameSuggestion(typed, document.objects.map((object) => object.name))}` };
    }
    return { ok: true, target: { kind: "object", object } };
  }

  const address = parseAddress(typed, document.objects);
  if (isAddressError(address)) {
    return { ok: false, message: address.message };
  }
  const object = document.objects.find((candidate) => candidate.id === address.objectId);
  if (object === undefined) {
    return { ok: false, message: `no object with id "${address.objectId}"` };
  }
  if (!declaresSlotPath(object, address.path)) {
    return { ok: false, message: `${object.name} has no slot at "${typed}" — object type "${object.type}" does not declare one${nameSuggestion(typed.slice(typed.indexOf(".") + 1), objectSlotPaths(object))}` };
  }
  return { ok: true, target: { kind: "slot", object, address, displayName: formatSlotName(address, document.objects, typed) } };
}

function declaresSlotPath(object: GraphObject, path: readonly string[]): boolean {
  if (findDerivedSlotSchema(object, path) !== undefined) {
    return true;
  }
  const schema = getObjectSchema(object.type);
  if (schema === undefined) {
    return false;
  }
  const key = slotKey(path);
  return resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths).some((declared) => slotKey(declared) === key);
}

function props(command: PropsCommand, document: Document): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"${nameSuggestion(command.target, document.objects.map((object) => object.name))}` };
  }
  const descriptors = buildSlotDescriptors(object, document.objects);
  if (descriptors.length === 0) {
    return { ok: false, message: `object type "${object.type}" has no schema, so nothing can say which slots ${object.name} has` };
  }
  return {
    ok: true,
    document,
    lines: [`${object.name} — ${object.type}`, ...descriptors.map(formatSlotDescriptorLine)],
  };
}

function formatSlotDescriptorLine(descriptor: SlotDescriptor): string {
  const path = slotKey(descriptor.path);
  const value = describeSlotValue(descriptor.value);
  if (descriptor.kind === "formula") {
    return `${path} = ${value} (formula, = ${descriptor.formulaSource})`;
  }
  return `${path} = ${value} (${descriptor.kind})`;
}

function select(command: SelectCommand, document: Document): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"${nameSuggestion(command.target, document.objects.map((object) => object.name))}` };
  }
  return { ok: true, document, lines: [`selected ${object.name}`], effect: { kind: "select", objectId: object.id } };
}

function zoom(command: ZoomCommand, document: Document): CommandOutcome {
  if (!Number.isFinite(command.factor) || command.factor <= 0) {
    return { ok: false, message: `factor must be a positive number, got ${command.factor}` };
  }
  return { ok: true, document, lines: [`zoom by ${command.factor}`], effect: { kind: "zoom", factor: command.factor } };
}

function fit(document: Document): CommandOutcome {
  if (document.objects.length === 0) {
    return { ok: false, message: "no objects to fit — create one first" };
  }
  return { ok: true, document, lines: ["fit to the document extent"], effect: { kind: "fit" } };
}

function save(document: Document): CommandOutcome {
  return { ok: true, document, lines: ["saving document"], effect: { kind: "save" } };
}

function load(document: Document): CommandOutcome {
  return { ok: true, document, lines: ["loading document"], effect: { kind: "load" } };
}

function findGraphObjectByName(name: string, objects: readonly GraphObject[]): GraphObject | undefined {
  const found = findObjectByName(name, objects);
  return found === undefined ? undefined : objects.find((candidate) => candidate.id === found.id);
}

function formatSlotAddress(address: Address, objects: readonly GraphObject[]): string {
  const formatted = formatAddress(address, objects);
  return isAddressError(formatted) ? formatted.message : formatted;
}

/**
 * The address of a variable an operator named, under either spelling.
 *
 * A variable is written `speed` on the command line and `doc.speed` inside a
 * formula, and both reach the same slot, so a command takes either and the
 * dotted form is what `parseAddress` resolves.
 */
function documentVariableAddress(name: string, document: Document): Address | { readonly ok: false; readonly message: string } {
  const address = parseAddress(name.includes(".") ? name : `${DOC_TYPE}.${name}`, document.objects);
  if (isAddressError(address)) {
    return { ok: false, message: address.message };
  }
  const doc = document.objects.find((object) => object.id === address.objectId);
  if (doc?.type !== DOC_TYPE || address.path.length !== 1 || getSlot(doc, address.path) === undefined) {
    return { ok: false, message: `no document variable named "${name}"` };
  }
  return address;
}

/** Runs `renamevar`, which moves a variable and every reader of it together. */
function renameDocumentVariable(command: Extract<Command, { kind: "renamevar" }>, document: Document, context: EvalContext): CommandOutcome {
  const address = documentVariableAddress(command.name, document);
  if ("ok" in address) {
    return address;
  }
  const result = mutate(document.objects, [{ kind: "renameVariable", address, name: command.newName }], document.journal, context);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    document: { ...document, objects: result.objects, journal: result.journal },
    lines: [`renamed ${command.name} to ${command.newName}`],
  };
}

/**
 * Runs `delvar`, which removes one variable and the copies that drew it.
 *
 * The doc object stays behind with no variables in it, because an operator who
 * removes the last one has said nothing about the next one, and a `docvar`
 * that follows finds the object already there.
 */
function deleteDocumentVariable(command: Extract<Command, { kind: "delvar" }>, document: Document, context: EvalContext): CommandOutcome {
  const address = documentVariableAddress(command.name, document);
  if ("ok" in address) {
    return address;
  }
  const result = mutate(document.objects, [{ kind: "clearSlot", address }], document.journal, context);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    document: { ...document, objects: result.objects, journal: result.journal },
    lines: [`deleted ${command.name}`],
  };
}

/**
 * Runs `docvar`, which writes a variable, puts a copy of one on the canvas, or
 * does both in one mutation.
 *
 * The three things it may do reach `mutate` as one batch, so a command that
 * creates the doc object, writes the first variable into it and puts a copy
 * down either lands whole or leaves the document as it was. A copy created in
 * a separate mutation would sit for one pass against a variable that the batch
 * had not written yet, and the integrity check refuses that.
 *
 * A name is matched against the variables that exist without regard to case,
 * and the spelling the slot already carries is what the write takes, so
 * `docvar Speed 3` moves `speed` rather than opening a second variable beside
 * it. A name that matches nothing is checked for the collisions of section 13
 * before it becomes a slot.
 */
function writeDocumentVariable(command: Extract<Command, { kind: "docvar" }>, document: Document, context: EvalContext): CommandOutcome {
  const hasPosition = command.x !== undefined || command.y !== undefined;
  if (hasPosition && (command.x === undefined || command.y === undefined)) {
    return { ok: false, message: "a variable copy needs both x and y" };
  }
  if (command.value === undefined && command.formula === undefined && !hasPosition) {
    return { ok: false, message: "docvar needs a value, a formula, or x and y for a copy" };
  }

  const operations: Operation[] = [];
  let nextObjectId = document.nextObjectId;
  let doc = document.objects.find((object) => object.type === DOC_TYPE);
  const name = Object.keys(doc?.slots ?? {}).find((key) => key.toLowerCase() === command.name.toLowerCase()) ?? command.name;
  const existing = doc !== undefined && Object.hasOwn(doc.slots, name) ? doc.slots[name] : undefined;
  if (existing === undefined) {
    if (command.value === undefined && command.formula === undefined) {
      return { ok: false, message: `no document variable named "${command.name}"` };
    }
    const problem = documentVariableNameProblem(command.name, document.objects);
    if (problem !== undefined) {
      return { ok: false, message: problem };
    }
  }

  // The first variable of a document creates the object that holds them all.
  if (doc === undefined) {
    const minted = mintObjectId(document);
    if ("ok" in minted) {
      return minted;
    }
    nextObjectId = minted.nextObjectId;
    doc = { id: minted.id, name: DOC_TYPE, type: DOC_TYPE, slots: {} };
    operations.push({ kind: "createObject", object: doc });
  }

  if (command.value !== undefined || command.formula !== undefined) {
    let slot: Slot = { kind: "literal", value: command.value ?? null };
    if (command.formula !== undefined) {
      // The formula is parsed against a doc object that already carries the
      // name being written, so `docvar total =total+1` parses and reaches the
      // cycle check, which is where a formula that reads itself is refused.
      const parsingDoc = { ...doc, slots: { ...doc.slots, [name]: existing ?? { kind: "literal" as const, value: null } } };
      const others = document.objects.filter((object) => object.id !== doc.id);
      const ast = parseFormula(command.formula.replace(/^=/, ""), [...others, parsingDoc]);
      if (isParseError(ast)) {
        return { ok: false, message: ast.message };
      }
      slot = { kind: "formula", ast, value: null };
    }
    operations.push({ kind: "setSlot", address: { objectId: doc.id, path: [name] }, slot });
  }

  let createdObjectId: string | undefined;
  if (hasPosition) {
    const minted = mintObjectId({ ...document, nextObjectId });
    if ("ok" in minted) {
      return minted;
    }
    nextObjectId = minted.nextObjectId;
    createdObjectId = minted.id;
    operations.push({
      kind: "createObject",
      object: {
        id: minted.id,
        name: generateDefaultName(DOCREF_TYPE, document.objects),
        type: DOCREF_TYPE,
        target: { objectId: doc.id, path: [name] },
        slots: {
          "origin.x": { kind: "literal", value: command.x! },
          "origin.y": { kind: "literal", value: command.y! },
          value: { kind: "derived", value: null },
          measuredWidth: { kind: "derived", value: null },
          measuredHeight: { kind: "derived", value: null },
        },
      },
    });
  }

  const result = mutate(document.objects, operations, document.journal, context);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    document: { ...document, nextObjectId, objects: result.objects, journal: result.journal },
    lines: [hasPosition ? `created copy of ${name}` : `set doc.${name}`],
    ...(createdObjectId === undefined ? {} : { createdObjectId }),
  };
}

function countedNoun(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
