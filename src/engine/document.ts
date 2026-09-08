/**
 * document.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * The versioned JSON document format, and save and load.
 *
 * The file never stores a derived value. A full evaluation pass on load makes
 * them again. So a new derived slot does not break an old saved file.
 *
 * A load goes through the mutation API, so a bad file fails the same checks a
 * bad command does.
 */

import { mutate, type MutationJournalEntry, type Operation } from "./mutation.ts";
import { NULL_EVAL_CONTEXT, type EvalContext } from "./eval-context.ts";
import { exceedsMaxFormulaAstDepth, MAX_FORMULA_AST_DEPTH, validateFormulaAstShape, type FormulaAst } from "./formula/ast.ts";
import { isIllegalNumber, isLegalPortName, slotKey, type GraphObject, type GraphObjectPorts, type ObjectType, type Slot, type Value } from "./graph/node.ts";
import { getObjectSchema, resolveDerivedSlots } from "./primitives/schema.ts";

export const FORMAT_VERSION = 1;

export interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

const DEFAULT_CAMERA: CameraState = { x: 0, y: 0, zoom: 1 };

export interface Document {
  readonly formatVersion: number;
  readonly nextObjectId: number;
  readonly objects: readonly GraphObject[];
  readonly journal: readonly MutationJournalEntry[];
  readonly camera: CameraState;
}

export function createEmptyDocument(): Document {
  return { formatVersion: FORMAT_VERSION, nextObjectId: 1, objects: [], journal: [], camera: DEFAULT_CAMERA };
}

export interface MintedObjectId {
  readonly id: string;
  readonly nextObjectId: number;
}

/** Makes the next object ID. An ID is never reused. */
export function mintObjectId(document: Document): MintedObjectId {
  return { id: `obj_${document.nextObjectId}`, nextObjectId: document.nextObjectId + 1 };
}

export type SerializedSlot = { readonly kind: "literal"; readonly value: Value } | { readonly kind: "formula"; readonly ast: FormulaAst; readonly value: Value } | { readonly kind: "derived" };

export interface SerializedGraphObject {
  readonly id: string;
  readonly name: string;
  readonly type: ObjectType;
  readonly slots: Readonly<Record<string, SerializedSlot>>;
  readonly ports?: GraphObjectPorts;
}

export interface SerializedDocument {
  readonly formatVersion: number;
  readonly nextObjectId: number;
  readonly objects: readonly SerializedGraphObject[];
  readonly journal: readonly MutationJournalEntry[];
  readonly camera: CameraState;
}

/** Document to plain JSON. It never writes a derived value. */
export function serializeDocument(document: Document): SerializedDocument {
  return {
    formatVersion: document.formatVersion,
    nextObjectId: document.nextObjectId,
    objects: document.objects.map(serializeObject),
    journal: document.journal,
    camera: document.camera,
  };
}

function serializeObject(object: GraphObject): SerializedGraphObject {
  const slots: Record<string, SerializedSlot> = {};
  for (const key of Object.keys(object.slots)) {
    const slot = object.slots[key];
    if (slot === undefined) {
      continue;
    }
    slots[key] = slot.kind === "derived" ? { kind: "derived" } : slot;
  }
  return object.ports === undefined
    ? { id: object.id, name: object.name, type: object.type, slots }
    : { id: object.id, name: object.name, type: object.type, slots, ports: object.ports };
}

export type DocumentLoadResult = { readonly ok: true; readonly document: Document } | { readonly ok: false; readonly message: string };

export function saveDocument(document: Document): string {
  return JSON.stringify(serializeDocument(document));
}

export function loadDocument(json: string, context: EvalContext = NULL_EVAL_CONTEXT): DocumentLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `document is not valid JSON: ${reason}` };
  }
  return deserializeDocument(parsed, context);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawContainsIllegalNumber(raw: unknown): boolean {
  if (typeof raw === "number") {
    return isIllegalNumber(raw);
  }
  if (Array.isArray(raw)) {
    return raw.some(rawContainsIllegalNumber);
  }
  if (typeof raw === "object" && raw !== null) {
    return Object.values(raw).some(rawContainsIllegalNumber);
  }
  return false;
}

/** JSON to a document. It goes through the mutation API, so a bad file fails the same checks a bad command does. */
export function deserializeDocument(raw: unknown, context: EvalContext = NULL_EVAL_CONTEXT): DocumentLoadResult {
  if (!isPlainObject(raw)) {
    return { ok: false, message: `a document must be a JSON object, not ${describeTypeof(raw)}` };
  }
  if (raw.formatVersion !== FORMAT_VERSION) {
    return {
      ok: false,
      message: `unsupported document formatVersion ${JSON.stringify(raw.formatVersion)} — this build only reads formatVersion ${FORMAT_VERSION}`,
    };
  }
  if (
    typeof raw.nextObjectId !== "number" ||
    !Number.isInteger(raw.nextObjectId) ||
    raw.nextObjectId < 0 ||
    isIllegalNumber(raw.nextObjectId)
  ) {
    return { ok: false, message: "nextObjectId must be a non-negative integer, and not -0" };
  }
  if (!Array.isArray(raw.objects)) {
    return { ok: false, message: "objects must be an array" };
  }
  if (!Array.isArray(raw.journal)) {
    return { ok: false, message: "journal must be an array" };
  }
  if (rawContainsIllegalNumber(raw.journal)) {
    return { ok: false, message: "journal contains an illegal number (non-finite, or -0), which is not legal document state" };
  }
  const cameraResult = reconstructCamera(raw.camera);
  if (!cameraResult.ok) {
    return cameraResult;
  }

  const reconstructedObjects: GraphObject[] = [];
  for (let index = 0; index < raw.objects.length; index += 1) {
    const objectResult = reconstructObject(raw.objects[index], index);
    if (!objectResult.ok) {
      return objectResult;
    }
    reconstructedObjects.push(objectResult.object);
  }

  const nextObjectId = raw.nextObjectId;
  const journal = raw.journal as readonly MutationJournalEntry[];

  if (reconstructedObjects.length === 0) {
    return { ok: true, document: { formatVersion: FORMAT_VERSION, nextObjectId, objects: [], journal, camera: cameraResult.camera } };
  }

  const operations: readonly Operation[] = reconstructedObjects.map((object) => ({ kind: "createObject", object }));
  const result = mutate([], operations, [], context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  return {
    ok: true,
    document: { formatVersion: FORMAT_VERSION, nextObjectId, objects: result.objects, journal, camera: cameraResult.camera },
  };
}

type CameraReconstructionResult = { readonly ok: true; readonly camera: CameraState } | { readonly ok: false; readonly message: string };

function reconstructCamera(raw: unknown): CameraReconstructionResult {
  if (!isPlainObject(raw) || typeof raw.x !== "number" || typeof raw.y !== "number" || typeof raw.zoom !== "number") {
    return { ok: false, message: "camera must be an object with numeric x, y, and zoom (see CameraState's doc comment)" };
  }
  if (isIllegalNumber(raw.x) || isIllegalNumber(raw.y) || isIllegalNumber(raw.zoom)) {
    return {
      ok: false,
      message: "camera holds an illegal number (non-finite, or -0), which is not legal document state",
    };
  }
  return { ok: true, camera: { x: raw.x, y: raw.y, zoom: raw.zoom } };
}

type ObjectReconstructionResult = { readonly ok: true; readonly object: GraphObject } | { readonly ok: false; readonly message: string };

function reconstructObject(raw: unknown, index: number): ObjectReconstructionResult {
  if (!isPlainObject(raw)) {
    return { ok: false, message: `objects[${index}] must be an object` };
  }
  const { id, name, type, slots: rawSlots, ports: rawPorts } = raw;
  if (typeof id !== "string" || typeof name !== "string" || typeof type !== "string") {
    return { ok: false, message: `objects[${index}] must have a string id, name, and type` };
  }
  if (!isPlainObject(rawSlots)) {
    return { ok: false, message: `${name}.slots must be an object` };
  }

  const slots: Record<string, Slot> = {};
  for (const key of Object.keys(rawSlots)) {
    const slotResult = reconstructSlot(rawSlots[key], name, key);
    if (!slotResult.ok) {
      return slotResult;
    }
    slots[key] = slotResult.slot;
  }

  const portsResult = reconstructPorts(rawPorts, name);
  if (!portsResult.ok) {
    return portsResult;
  }

  const objectType = type as ObjectType;
  const object: GraphObject = portsResult.ports === undefined
    ? { id, name, type: objectType, slots }
    : { id, name, type: objectType, slots, ports: portsResult.ports };
  return { ok: true, object: { ...object, slots: withSchemaDerivedSlots(object) } };
}

type PortsReconstructionResult = { readonly ok: true; readonly ports: GraphObjectPorts | undefined } | { readonly ok: false; readonly message: string };

function reconstructPorts(raw: unknown, objectName: string): PortsReconstructionResult {
  if (raw === undefined) {
    return { ok: true, ports: undefined };
  }
  if (!isPlainObject(raw) || !Array.isArray(raw.in) || !Array.isArray(raw.out)) {
    return { ok: false, message: `${objectName}.ports must be an object with array "in" and "out" fields` };
  }
  const families: readonly (readonly [string, readonly unknown[]])[] = [
    ["in", raw.in],
    ["out", raw.out],
  ];
  for (const [family, names] of families) {
    const seen = new Set<string>();
    for (const name of names) {
      if (typeof name !== "string" || !isLegalPortName(name)) {
        return { ok: false, message: `${objectName}.ports.${family} holds an illegal port name (must contain only letters, digits, and underscore)` };
      }
      if (seen.has(name)) {
        return { ok: false, message: `${objectName}.ports.${family} names "${name}" more than once` };
      }
      seen.add(name);
    }
  }
  return { ok: true, ports: { in: raw.in as readonly string[], out: raw.out as readonly string[] } };
}

function withSchemaDerivedSlots(object: GraphObject): Record<string, Slot> {
  const schema = getObjectSchema(object.type);
  const slots = object.slots as Record<string, Slot>;
  if (schema === undefined) {
    return slots;
  }
  const derivedSlots = resolveDerivedSlots(object, schema.derivedSlots);
  const declared = new Set(derivedSlots.map((derived) => slotKey(derived.path)));
  const rebuilt: Record<string, Slot> = {};
  for (const key of Object.keys(slots)) {
    const slot = slots[key];
    if (slot === undefined) {
      continue;
    }
    if (slot.kind === "derived" && !declared.has(key)) {
      continue;
    }
    rebuilt[key] = slot;
  }
  for (const derived of derivedSlots) {
    const key = slotKey(derived.path);
    if (rebuilt[key] === undefined) {
      rebuilt[key] = { kind: "derived", value: null };
    }
  }
  return rebuilt;
}

type SlotReconstructionResult = { readonly ok: true; readonly slot: Slot } | { readonly ok: false; readonly message: string };

function reconstructSlot(raw: unknown, objectName: string, key: string): SlotReconstructionResult {
  if (!isPlainObject(raw)) {
    return { ok: false, message: `${objectName}.${key} must be an object` };
  }
  if (raw.kind === "literal") {
    if (!("value" in raw)) {
      return { ok: false, message: `${objectName}.${key} (literal) is missing its value` };
    }
    return { ok: true, slot: { kind: "literal", value: raw.value as Value } };
  }
  if (raw.kind === "formula") {
    if (!("ast" in raw)) {
      return { ok: false, message: `${objectName}.${key} (formula) is missing its ast` };
    }
    const shape = validateFormulaAstShape(raw.ast);
    if (!shape.ok) {
      return { ok: false, message: `${objectName}.${key} (formula): ${shape.reason}` };
    }
    const ast = shape.ast;
    if (exceedsMaxFormulaAstDepth(ast)) {
      return {
        ok: false,
        message: `${objectName}.${key}: formula has more than ${MAX_FORMULA_AST_DEPTH} nested operations; split it across cells, or use SUM over a range`,
      };
    }
    return { ok: true, slot: { kind: "formula", ast, value: "value" in raw ? (raw.value as Value) : null } };
  }
  if (raw.kind === "derived") {
    return { ok: true, slot: { kind: "derived", value: null } };
  }
  return { ok: false, message: `${objectName}.${key} has an unrecognised slot kind ${JSON.stringify(raw.kind)}` };
}

function describeTypeof(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return `a ${typeof value}`;
}
