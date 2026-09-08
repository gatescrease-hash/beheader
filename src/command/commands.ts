/**
 * commands.ts
 *
 * Layer: command. It turns a typed line into mutation calls. It imports from
 * engine and from its own layer.
 *
 * The command handlers. Each one turns a command object into mutation
 * operations and a log line.
 *
 * A refusal message gets written here, so this file carries the debug story.
 * Every refusal must name the slots it is about.
 */
import {
  findObjectByName,
  formatAddress,
  generateDefaultName,
  isAddressError,
  isValidName,
  parseAddress,
  TABLE_CELL_PATH_PREFIX,
  type Address,
} from "../engine/address.ts";
import { mintObjectId, type Document } from "../engine/document.ts";
import { isReferenceNode } from "../engine/formula/ast.ts";
import { formatFormula } from "../engine/formula/format.ts";
import { isParseError, parseFormula } from "../engine/formula/parser.ts";
import { addressKey, type Edge } from "../engine/graph/edge.ts";
import { getSlot, isLegalPortName, slotKey, POLYLINE_TYPE, SCRIPT_TYPE, TABLE_TYPE, TEXT_TYPE, type GraphObject, type ObjectType, type Slot, type Value } from "../engine/graph/node.ts";
import { deriveEdges, mutate, type Operation } from "../engine/mutation.ts";
import { NULL_EVAL_CONTEXT, type EvalContext } from "../engine/eval-context.ts";
import {
  MIN_POLYGON_SIDES,
  MIN_POLYLINE_VERTICES,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  POLYGON_ROTATION_PATH,
  POLYGON_SIDES_PATH,
  RADIUS_PATH,
  RECT_HEIGHT_PATH,
  RECT_WIDTH_PATH,
  vertexXPath,
  vertexYPath,
} from "../engine/primitives/geometry.ts";
import { findDerivedSlotSchema, getObjectSchema, resolveDerivedSlots, resolveNonDerivedSlotPaths } from "../engine/primitives/schema.ts";
import { MAX_TABLE_LINES, MIN_TABLE_LINES, TABLE_COLS_PATH, TABLE_ROWS_PATH } from "../engine/primitives/table.ts";
import {
  TEXT_AUTORESIZE_PATH,
  TEXT_CONTENT_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_STYLE_ALIGN_PATH,
  TEXT_STYLE_COLOR_PATH,
  TEXT_STYLE_FONT_PATH,
  TEXT_STYLE_FONT_SIZE_PATH,
  TEXT_STYLE_LINE_HEIGHT_PATH,
  TEXT_WIDTH_PATH,
} from "../engine/primitives/text.ts";
import { IMAGE_HEIGHT_PATH, IMAGE_OPACITY_PATH, IMAGE_PICTURE_ASPECT_PATH, IMAGE_PRESERVE_ASPECT_PATH, IMAGE_SOURCE_PATH, IMAGE_WIDTH_PATH } from "../engine/primitives/image.ts";
import { SCRIPT_LANGUAGE_PATH, SCRIPT_SOURCE_PATH, scriptInPortPath, scriptOutPortPath, scriptPlaceholderPath } from "../engine/script/stub.ts";
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
  CreateScriptCommand,
  CreateTableCommand,
  CreateTextCommand,
  DeleteCommand,
  DeleteVertexCommand,
  ExplodeCommand,
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
const DEFAULT_TEXT_STYLE_COLOR = "black";
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
  "circle",
  "polygon",
  "rect",
  "polyline",
  "text",
  "table",
  "image",
  "script",
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

function createCircle(command: CreateCircleCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "circle", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: RADIUS_PATH, value: command.radius },
  ], context);
}

function createPolygon(command: CreatePolygonCommand, document: Document, context: EvalContext): CommandOutcome {
  const refusal = refuseCountOutOfRange("sides", command.sides, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES);
  if (refusal !== undefined) {
    return { ok: false, message: refusal };
  }
  return createObjectFromCommand(document, "polygon", [
    { path: POLYGON_SIDES_PATH, value: command.sides },
    { path: RADIUS_PATH, value: command.radius },
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: POLYGON_ROTATION_PATH, value: DEFAULT_POLYGON_ROTATION },
  ], context);
}

function createRect(command: CreateRectCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "rect", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: RECT_WIDTH_PATH, value: command.width },
    { path: RECT_HEIGHT_PATH, value: command.height },
  ], context);
}

function createPolyline(command: CreatePolylineCommand, document: Document, context: EvalContext): CommandOutcome {
  if (command.points.length < MIN_POLYLINE_VERTICES) {
    return { ok: false, message: `a polyline needs at least ${MIN_POLYLINE_VERTICES} points, got ${command.points.length}` };
  }
  const literals: LiteralSlotDeclaration[] = [];
  command.points.forEach((point, index) => {
    literals.push({ path: vertexXPath(index), value: point.x });
    literals.push({ path: vertexYPath(index), value: point.y });
  });
  return createObjectFromCommand(document, "polyline", literals, context, command.points.length);
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
    return { ok: false, message: `${object.name} has no slot at "${target}" — object type "${object.type}" does not declare one` };
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

function buildSlot(write: SlotWrite, target: WritableSlotTarget, document: Document): SlotBuildResult {
  switch (write.kind) {
    case "literal":
      return { ok: true, slot: { kind: "literal", value: write.value }, lines: [`${target.displayName} = ${describeSlotValue(write.value)}`] };
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
    return { ok: false, message: `no object named "${command.target}"` };
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
    return { ok: false, message: `no object named "${command.target}"` };
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
    return { ok: false, message: `no object named "${command.target}"` };
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

function deleteVertex(command: DeleteVertexCommand, document: Document, context: EvalContext): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"` };
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
    return { ok: false, message: `no object named "${command.target}"` };
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
  if (isValidName(typed)) {
    const object = findGraphObjectByName(typed, document.objects);
    if (object === undefined) {
      return { ok: false, message: `no object named "${typed}"` };
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
    return { ok: false, message: `${object.name} has no slot at "${typed}" — object type "${object.type}" does not declare one` };
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
    return { ok: false, message: `no object named "${command.target}"` };
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
    return { ok: false, message: `no object named "${command.target}"` };
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

function countedNoun(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
