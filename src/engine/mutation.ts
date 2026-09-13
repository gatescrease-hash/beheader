/**
 * mutation.ts
 *
 * The single channel for state change. No other code writes document state.
 *
 * Every mutation runs these eight steps in order.
 *
 * 1. Stage. It deep clones the current state. 2. Apply. It applies the
 * operations to the clone. 3. Derive. It rebuilds the edge set, from stored
 * ASTs and from the schema. 4. Check integrity. It refuses a formula that
 * names an absent slot. 5. Check cycles. It refuses a cycle, and names every
 * slot in it. 6. Refuse. It throws the clone away, and the old state never
 * changed. 7. Evaluate. An error makes an error value, rather than a
 * rollback. 8. Commit. It swaps the clone in, and appends to the journal.
 *
 * A batch applies many operations to one clone and commits all or nothing. A
 * document load uses a batch, so a bad file fails as one unit.
 *
 * The integrity check runs before the cycle check, because a cycle check over
 * an edge set that nobody trusts proves nothing.
 *
 * This file and primitives/schema.ts agree about every slot path. Both read
 * the schema through the same resolver, or a dynamic slot family drifts
 * between them.
 *
 * The file belongs to the engine layer and works on plain data alone. It does
 * not use the DOM, a window or a canvas. That keeps it testable without a
 * browser, and ready for a port to Rust.
 */

import { checkNameAvailable, formatAddress, isAddressError, TABLE_CELL_PATH_PREFIX, type Address } from "./address.ts";
import { NULL_EVAL_CONTEXT, type EvalContext } from "./eval-context.ts";
import type { FormulaAst } from "./formula/ast.ts";
import { extractDependencies, repairAddressesInAst, rewriteAddressesInAst } from "./formula/deps.ts";
import { derivedSlotDependencyAddresses, getObjectSchema, resolveDerivedSlots, resolveNonDerivedSlotPaths } from "./primitives/schema.ts";
import {
  addVertexToObject,
  deleteVertexFromObject,
  explodeObjectToPolyline,
  EXPLODABLE_TYPES,
  passThroughVertexRangeForDelete,
  repairVertexAddressForDelete,
  shiftVertexAddressForDelete,
  insertVertexIntoObject,
  polylineEdgeCount,
  shiftVertexAddressForInsert,
  splitPolylineEdge,
  vertexPartPaths,
  vertexXPath,
  vertexYPath,
} from "./primitives/geometry.ts";
import {
  deleteTableLine,
  enumerateRangeCellAddresses,
  getTableDimensions,
  insertTableLine,
  isInExtentTableCellAddress,
  isRangeEnumerationError,
  isTableDimensionResizable,
  MAX_TABLE_LINES,
  MIN_TABLE_LINES,
  repairCellAddressForDelete,
  repairRangeEndpointsForDelete,
  shiftCellAddressForInsert,
  TABLE_COLS_PATH,
  TABLE_ROWS_PATH,
} from "./primitives/table.ts";
import { detectCycle } from "./graph/cycles.ts";
import { addressKey, type Edge } from "./graph/edge.ts";
import { evaluate } from "./graph/eval.ts";
import { hasIllegalNumber, isIllegalNumber, isLegalPortName, POLYLINE_TYPE, resolveSlot, slotKey, TABLE_TYPE, type GraphObject, type ObjectType, type Point, type Slot, type Value } from "./graph/node.ts";

/**
 * Step 3 rebuilds the whole edge set from stored ASTs and from the schema. It
 * reads slot paths through the schema resolver. It never takes a key apart.
 */
export function deriveEdges(objects: readonly GraphObject[]): readonly Edge[] {
  const edges: Edge[] = [];

  for (const object of objects) {
    const schema = getObjectSchema(object.type);
    if (schema === undefined) {
      continue;
    }

    for (const path of resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths)) {
      const slot = object.slots[slotKey(path)];
      if (slot === undefined || slot.kind !== "formula") {
        continue;
      }
      const dependentSlot = { objectId: object.id, path };
      for (const dependency of extractDependencies(slot.ast)) {
        if (dependency.kind === "reference") {
          if (resolveSlot(dependency.address, objects) === undefined && isInExtentTableCellAddress(dependency.address, objects)) {
            continue;
          }
          edges.push({ sourceSlot: dependency.address, dependentSlot });
          continue;
        }
        const tableObject = objects.find((candidate) => candidate.id === dependency.start.objectId);
        if (tableObject === undefined) {
          edges.push({ sourceSlot: dependency.start, dependentSlot });
          continue;
        }
        const cellAddresses = enumerateRangeCellAddresses(dependency.start, dependency.end, tableObject);
        if (isRangeEnumerationError(cellAddresses)) {
          edges.push({ sourceSlot: dependency.start, dependentSlot });
          continue;
        }
        for (const cellAddress of cellAddresses) {
          if (tableObject.slots[slotKey(cellAddress.path)] === undefined) {
            continue;
          }
          edges.push({ sourceSlot: cellAddress, dependentSlot });
        }
      }
    }

    for (const derivedSlotEntry of resolveDerivedSlots(object, schema.derivedSlots)) {
      const dependencyAddresses = derivedSlotDependencyAddresses(object, derivedSlotEntry.dependencies, objects);
      for (const sourceSlot of dependencyAddresses) {
        edges.push({
          sourceSlot,
          dependentSlot: { objectId: object.id, path: derivedSlotEntry.path },
        });
      }
    }
  }

  return edges;
}

export type IntegrityCheckResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Step 4 runs four checks, in this order. An undeclared slot first, because a
 * later cycle check over an edge set that nobody trusts proves nothing.
 */
export function validateIntegrity(objects: readonly GraphObject[], edges: readonly Edge[]): IntegrityCheckResult {
  const undeclaredSlotProblems = findUndeclaredFormulaOrDerivedSlots(objects);
  if (undeclaredSlotProblems.length > 0) {
    return { ok: false, message: undeclaredSlotProblems.join("; ") };
  }

  const schemaKindMismatchProblems = findSchemaSlotKindMismatches(objects);
  if (schemaKindMismatchProblems.length > 0) {
    return { ok: false, message: schemaKindMismatchProblems.join("; ") };
  }

  const danglingReferenceProblems = findDanglingReferences(objects, edges);
  if (danglingReferenceProblems.length > 0) {
    return { ok: false, message: danglingReferenceProblems.join("; ") };
  }

  const illegalValueProblems = findIllegalSlotValues(objects);
  if (illegalValueProblems.length > 0) {
    return { ok: false, message: illegalValueProblems.join("; ") };
  }

  return { ok: true };
}

export type GraphEvaluationResult =
  | { readonly ok: true; readonly objects: readonly GraphObject[] }
  | { readonly ok: false; readonly message: string };

export function deriveValidateAndEvaluate(
  objects: readonly GraphObject[],
  context: EvalContext = NULL_EVAL_CONTEXT,
): GraphEvaluationResult {
  const edges = deriveEdges(objects);

  const integrity = validateIntegrity(objects, edges);
  if (!integrity.ok) {
    return integrity;
  }

  const cycleCheck = detectCycle(edges);
  if (cycleCheck.hasCycle) {
    return { ok: false, message: formatCycleRejection(cycleCheck.cycle, objects) };
  }

  return { ok: true, objects: evaluate(objects, edges, context) };
}

function formatCycleRejection(cycle: readonly Address[], objects: readonly GraphObject[]): string {
  const names = cycle.map((address) => {
    const formatted = formatAddress(address, objects);
    return isAddressError(formatted) ? formatted.message : formatted;
  });
  const first = names[0];
  const chain = first === undefined ? names.join(" → ") : [...names, first].join(" → ");
  return `cyclic dependency: ${chain}`;
}

export interface SetSlotOperation {
  readonly kind: "setSlot";
  readonly address: Address;
  readonly slot: Slot;
}

export interface ClearSlotOperation {
  readonly kind: "clearSlot";
  readonly address: Address;
}

export interface DeleteObjectOperation {
  readonly kind: "deleteObject";
  readonly objectId: string;
  readonly force?: boolean;
}

export interface CreateObjectOperation {
  readonly kind: "createObject";
  readonly object: GraphObject;
}

export interface InsertTableLineOperation {
  readonly kind: "insertTableLine";
  readonly objectId: string;
  readonly axis: "row" | "column";
  readonly index: number;
}

export interface DeleteTableLineOperation {
  readonly kind: "deleteTableLine";
  readonly objectId: string;
  readonly axis: "row" | "column";
  readonly index: number;
}

export interface RenameObjectOperation {
  readonly kind: "renameObject";
  readonly objectId: string;
  readonly name: string;
}

export interface AddPortOperation {
  readonly kind: "addPort";
  readonly objectId: string;
  readonly family: "in" | "out";
  readonly name: string;
}

export interface RemovePortOperation {
  readonly kind: "removePort";
  readonly objectId: string;
  readonly family: "in" | "out";
  readonly name: string;
}

export interface AddVertexOperation {
  readonly kind: "addVertex";
  readonly objectId: string;
  readonly point: Point;
}

export interface DeleteVertexOperation {
  readonly kind: "deleteVertex";
  readonly objectId: string;
  readonly index: number;
  readonly force?: boolean;
}

export interface ExplodeOperation {
  readonly kind: "explode";
  readonly objectId: string;
  readonly force?: boolean;
}

/**
 * Cuts one edge at the point on it nearest point, and puts a vertex there. An
 * arc becomes two arcs of the same circle, so the shape on screen holds still.
 * There is no force flag, because an insert loses no vertex.
 */
export interface SplitEdgeOperation {
  readonly kind: "splitEdge";
  readonly objectId: string;
  readonly index: number;
  readonly point: Point;
}

export type Operation =
  | SetSlotOperation
  | ClearSlotOperation
  | DeleteObjectOperation
  | CreateObjectOperation
  | InsertTableLineOperation
  | DeleteTableLineOperation
  | RenameObjectOperation
  | AddPortOperation
  | RemovePortOperation
  | AddVertexOperation
  | DeleteVertexOperation
  | ExplodeOperation
  | SplitEdgeOperation;

function operationTargetId(operation: Operation): string {
  if (operation.kind === "deleteObject") {
    return operation.objectId;
  }
  if (operation.kind === "createObject") {
    return operation.object.id;
  }
  if (
    operation.kind === "insertTableLine" ||
    operation.kind === "deleteTableLine" ||
    operation.kind === "renameObject" ||
    operation.kind === "addPort" ||
    operation.kind === "removePort" ||
    operation.kind === "addVertex" ||
    operation.kind === "deleteVertex" ||
    operation.kind === "explode" ||
    operation.kind === "splitEdge"
  ) {
    return operation.objectId;
  }
  return operation.address.objectId;
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      clone[key] = deepClone((value as Record<string, unknown>)[key]);
    }
    return clone as T;
  }
  return value;
}

function cloneObjects(objects: readonly GraphObject[]): GraphObject[] {
  return deepClone(objects as GraphObject[]);
}

function applyOperation(
  objects: readonly GraphObject[],
  operation: Operation,
): { readonly objects: readonly GraphObject[]; readonly brokenSlots: readonly Address[] } {
  if (operation.kind === "deleteObject") {
    if (operation.force !== true) {
      return { objects: objects.filter((object) => object.id !== operation.objectId), brokenSlots: [] };
    }
    const repairReference = (address: Address): Address | "deleted" => repairReferenceForDeletedObject(address, operation.objectId);
    const repairRange = (start: Address, end: Address) => repairRangeForDeletedObject(start, end, operation.objectId);
    const repaired = objects
      .map((object) => repairObjectFormulaAddresses(object, repairReference, repairRange))
      .filter((entry) => entry.object.id !== operation.objectId);
    return { objects: repaired.map((entry) => entry.object), brokenSlots: repaired.flatMap((entry) => entry.brokenSlots) };
  }
  if (operation.kind === "renameObject") {
    return {
      objects: objects.map((object) => (object.id === operation.objectId ? { ...object, name: operation.name } : object)),
      brokenSlots: [],
    };
  }
  if (operation.kind === "createObject") {
    return { objects: [...objects, deepClone(operation.object)], brokenSlots: [] };
  }
  if (operation.kind === "insertTableLine") {
    const target = objects.find((object) => object.id === operation.objectId);
    if (target === undefined) {
      return { objects, brokenSlots: [] };
    }
    const { rows, cols } = getTableDimensions(target);
    const bound = operation.axis === "row" ? rows : cols;
    const clampedIndex = Math.max(1, Math.min(operation.index, bound + 1));
    const shiftAddress = (address: Address): Address => shiftCellAddressForInsert(address, operation.objectId, operation.axis, clampedIndex);
    return {
      objects: objects.map((object) => {
        const resized = object.id === operation.objectId ? insertTableLine(object, operation.axis, clampedIndex) : object;
        return rewriteObjectFormulaAddresses(resized, shiftAddress);
      }),
      brokenSlots: [],
    };
  }
  if (operation.kind === "deleteTableLine") {
    const target = objects.find((object) => object.id === operation.objectId);
    if (target === undefined) {
      return { objects, brokenSlots: [] };
    }
    const repairReference = (address: Address): Address | "deleted" =>
      repairCellAddressForDelete(address, operation.objectId, operation.axis, operation.index);
    const repairRange = (start: Address, end: Address) => repairRangeEndpointsForDelete(start, end, operation.objectId, operation.axis, operation.index);
    const repaired = objects.map((object) => {
      const resized = object.id === operation.objectId ? deleteTableLine(object, operation.axis, operation.index) : object;
      return repairObjectFormulaAddresses(resized, repairReference, repairRange);
    });
    return { objects: repaired.map((entry) => entry.object), brokenSlots: repaired.flatMap((entry) => entry.brokenSlots) };
  }
  if (operation.kind === "clearSlot") {
    const key = slotKey(operation.address.path);
    return {
      objects: objects.map((object) => {
        if (object.id !== operation.address.objectId) {
          return object;
        }
        const slots: Record<string, Slot> = {};
        for (const existing of Object.keys(object.slots)) {
          const slot = object.slots[existing];
          if (existing !== key && slot !== undefined) {
            slots[existing] = slot;
          }
        }
        return { ...object, slots };
      }),
      brokenSlots: [],
    };
  }
  if (operation.kind === "addPort") {
    return {
      objects: objects.map((object) => {
        if (object.id !== operation.objectId) {
          return object;
        }
        const ports = object.ports ?? { in: [], out: [] };
        return {
          ...object,
          ports: operation.family === "in" ? { ...ports, in: [...ports.in, operation.name] } : { ...ports, out: [...ports.out, operation.name] },
        };
      }),
      brokenSlots: [],
    };
  }
  if (operation.kind === "removePort") {
    const key = slotKey([operation.family, operation.name]);
    return {
      objects: objects.map((object) => {
        if (object.id !== operation.objectId) {
          return object;
        }
        const ports = object.ports ?? { in: [], out: [] };
        const nextPorts =
          operation.family === "in"
            ? { ...ports, in: ports.in.filter((name) => name !== operation.name) }
            : { ...ports, out: ports.out.filter((name) => name !== operation.name) };
        const slots: Record<string, Slot> = {};
        for (const existing of Object.keys(object.slots)) {
          const slot = object.slots[existing];
          if (existing !== key && slot !== undefined) {
            slots[existing] = slot;
          }
        }
        return { ...object, ports: nextPorts, slots };
      }),
      brokenSlots: [],
    };
  }
  if (operation.kind === "addVertex") {
    return {
      objects: objects.map((object) => (object.id === operation.objectId ? addVertexToObject(object, operation.point) : object)),
      brokenSlots: [],
    };
  }
  if (operation.kind === "deleteVertex") {
    const target = objects.find((object) => object.id === operation.objectId);
    if (target === undefined) {
      return { objects, brokenSlots: [] };
    }
    const resized = deleteVertexFromObject(target, operation.index);
    if (operation.force !== true) {
      const shiftAddress = (address: Address): Address => shiftVertexAddressForDelete(address, operation.objectId, operation.index);
      return {
        objects: objects.map((object) => rewriteObjectFormulaAddresses(object.id === operation.objectId ? resized : object, shiftAddress)),
        brokenSlots: [],
      };
    }
    const repairReference = (address: Address): Address | "deleted" => repairVertexAddressForDelete(address, operation.objectId, operation.index);
    const repaired = objects.map((object) =>
      repairObjectFormulaAddresses(object.id === operation.objectId ? resized : object, repairReference, passThroughVertexRangeForDelete),
    );
    return { objects: repaired.map((entry) => entry.object), brokenSlots: repaired.flatMap((entry) => entry.brokenSlots) };
  }
  if (operation.kind === "splitEdge") {
    const target = objects.find((object) => object.id === operation.objectId);
    if (target === undefined) {
      return { objects, brokenSlots: [] };
    }
    const split = splitPolylineEdge(target, operation.index, operation.point);
    if (split === undefined) {
      return { objects, brokenSlots: [] };
    }
    const insertedIndex = operation.index + 1;
    const grown = insertVertexIntoObject(target, operation.index, split);
    const shiftAddress = (address: Address): Address => shiftVertexAddressForInsert(address, operation.objectId, insertedIndex);
    return {
      objects: objects.map((object) => rewriteObjectFormulaAddresses(object.id === operation.objectId ? grown : object, shiftAddress)),
      brokenSlots: [],
    };
  }
  if (operation.kind === "explode") {
    const target = objects.find((object) => object.id === operation.objectId);
    if (target === undefined) {
      return { objects, brokenSlots: [] };
    }
    const exploded = explodeObjectToPolyline(target, target.name);
    if (!exploded.ok) {
      return { objects, brokenSlots: [] };
    }
    const newObject = exploded.object;
    if (operation.force !== true) {
      return {
        objects: objects.map((object) => (object.id === operation.objectId ? newObject : object)),
        brokenSlots: [],
      };
    }
    const removed = removedSlotKeys(target, newObject);
    const repairReference = (address: Address): Address | "deleted" =>
      address.objectId === operation.objectId && removed.has(slotKey(address.path)) ? "deleted" : address;
    const passThroughRange = (start: Address, end: Address): { readonly start: Address; readonly end: Address } => ({ start, end });
    const repaired = objects.map((object) =>
      repairObjectFormulaAddresses(object.id === operation.objectId ? newObject : object, repairReference, passThroughRange),
    );
    return { objects: repaired.map((entry) => entry.object), brokenSlots: repaired.flatMap((entry) => entry.brokenSlots) };
  }
  return {
    objects: objects.map((object) => {
      if (object.id !== operation.address.objectId) {
        return object;
      }
      return {
        ...object,
        slots: { ...object.slots, [slotKey(operation.address.path)]: deepClone(operation.slot) },
      };
    }),
    brokenSlots: [],
  };
}

function repairReferenceForDeletedObject(address: Address, deletedObjectId: string): Address | "deleted" {
  return address.objectId === deletedObjectId ? "deleted" : address;
}

function repairRangeForDeletedObject(
  start: Address,
  end: Address,
  deletedObjectId: string,
): { readonly start: Address; readonly end: Address } | "deleted" {
  return start.objectId === deletedObjectId || end.objectId === deletedObjectId ? "deleted" : { start, end };
}

function rewriteObjectFormulaAddresses(object: GraphObject, shiftAddress: (address: Address) => Address): GraphObject {
  const newSlots: Record<string, Slot> = {};
  for (const key of Object.keys(object.slots)) {
    const slot = object.slots[key];
    if (slot === undefined) {
      continue;
    }
    newSlots[key] = slot.kind === "formula" ? { ...slot, ast: rewriteAddressesInAst(slot.ast, shiftAddress) } : slot;
  }
  return { ...object, slots: newSlots };
}

function repairObjectFormulaAddresses(
  object: GraphObject,
  repairReference: (address: Address) => Address | "deleted",
  repairRange: (start: Address, end: Address) => { readonly start: Address; readonly end: Address } | "deleted",
): { readonly object: GraphObject; readonly brokenSlots: readonly Address[] } {
  const newSlots: Record<string, Slot> = {};
  const brokenSlots: Address[] = [];
  for (const key of Object.keys(object.slots)) {
    const slot = object.slots[key];
    if (slot === undefined) {
      continue;
    }
    if (slot.kind !== "formula") {
      newSlots[key] = slot;
      continue;
    }
    let broke = false;
    const trackedReference = (address: Address): Address | "deleted" => {
      const repaired = repairReference(address);
      if (repaired === "deleted") {
        broke = true;
      }
      return repaired;
    };
    const trackedRange = (start: Address, end: Address): { readonly start: Address; readonly end: Address } | "deleted" => {
      const repaired = repairRange(start, end);
      if (repaired === "deleted") {
        broke = true;
      }
      return repaired;
    };
    newSlots[key] = { ...slot, ast: repairAddressesInAst(slot.ast, trackedReference, trackedRange) };
    if (broke) {
      const path = resolveSlotPathForKey(object, key);
      if (path !== undefined) {
        brokenSlots.push({ objectId: object.id, path });
      }
    }
  }
  return { object: { ...object, slots: newSlots }, brokenSlots };
}

function resolveSlotPathForKey(object: GraphObject, key: string): readonly string[] | undefined {
  const schema = getObjectSchema(object.type);
  if (schema === undefined) {
    return undefined;
  }
  return resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths).find((path) => slotKey(path) === key);
}

export interface MutationJournalEntry {
  readonly operations: readonly Operation[];
}

export type MutationResult =
  | {
      readonly ok: true;
      readonly objects: readonly GraphObject[];
      readonly journal: readonly MutationJournalEntry[];
      readonly brokenSlots: readonly Address[];
    }
  | { readonly ok: false; readonly message: string };

/**
 * The one entry point for state change. It runs all eight steps.
 * It commits all the operations or none of them.
 */
export function mutate(
  objects: readonly GraphObject[],
  operations: readonly Operation[],
  journal: readonly MutationJournalEntry[],
  context: EvalContext = NULL_EVAL_CONTEXT,
): MutationResult {
  if (operations.length === 0) {
    return { ok: false, message: "a mutation batch must contain at least one operation" };
  }

  const survivingIds = new Set(objects.map((object) => object.id));
  const missingTargetMessages: string[] = [];
  operations.forEach((operation, index) => {
    const targetId = operationTargetId(operation);
    const prefix = `operation ${index + 1} of ${operations.length}`;
    if (operation.kind === "createObject") {
      if (survivingIds.has(targetId)) {
        missingTargetMessages.push(
          `${prefix} attempts to create object id "${targetId}", which ALREADY exists in this document`,
        );
        return;
      }
      survivingIds.add(targetId);
      return;
    }
    if (!survivingIds.has(targetId)) {
      let detail: string;
      if (operation.kind === "deleteObject") {
        detail = `attempts to delete object id "${targetId}"`;
      } else if (operation.kind === "insertTableLine") {
        detail = `attempts to insert a ${operation.axis} into object id "${targetId}"`;
      } else if (operation.kind === "deleteTableLine") {
        detail = `attempts to delete a ${operation.axis} from object id "${targetId}"`;
      } else if (operation.kind === "renameObject") {
        detail = `attempts to rename object id "${targetId}" to "${operation.name}"`;
      } else if (operation.kind === "addPort") {
        detail = `attempts to add ${operation.family} port "${operation.name}" to object id "${targetId}"`;
      } else if (operation.kind === "removePort") {
        detail = `attempts to remove ${operation.family} port "${operation.name}" from object id "${targetId}"`;
      } else if (operation.kind === "addVertex") {
        detail = `attempts to add a vertex to object id "${targetId}"`;
      } else if (operation.kind === "deleteVertex") {
        detail = `attempts to delete vertex ${operation.index} from object id "${targetId}"`;
      } else if (operation.kind === "explode") {
        detail = `attempts to explode object id "${targetId}"`;
      } else if (operation.kind === "splitEdge") {
        detail = `attempts to split edge ${operation.index} of object id "${targetId}"`;
      } else {
        detail = `targets slot "${slotKey(operation.address.path)}" on object id "${targetId}"`;
      }
      missingTargetMessages.push(`${prefix} ${detail}, which does not exist in this document`);
      return;
    }
    if (operation.kind === "deleteObject") {
      survivingIds.delete(targetId);
    }
  });
  if (missingTargetMessages.length > 0) {
    return { ok: false, message: missingTargetMessages.join("; ") };
  }

  const illegalPayloadMessages = findIllegalOperationPayloads(operations, objects);
  if (illegalPayloadMessages.length > 0) {
    return { ok: false, message: illegalPayloadMessages.join("; ") };
  }

  const invalidResizeMessages = findInvalidTableResizes(operations, objects);
  if (invalidResizeMessages.length > 0) {
    return { ok: false, message: invalidResizeMessages.join("; ") };
  }

  const illegalClearMessages = findIllegalSlotClears(operations, objects);
  if (illegalClearMessages.length > 0) {
    return { ok: false, message: illegalClearMessages.join("; ") };
  }

  const invalidDimensionMessages = findInvalidDimensionWrites(operations, objects);
  if (invalidDimensionMessages.length > 0) {
    return { ok: false, message: invalidDimensionMessages.join("; ") };
  }

  const invalidNameMessages = findInvalidNames(operations, objects);
  if (invalidNameMessages.length > 0) {
    return { ok: false, message: invalidNameMessages.join("; ") };
  }

  const invalidPortMessages = findInvalidPortOperations(operations, objects);
  if (invalidPortMessages.length > 0) {
    return { ok: false, message: invalidPortMessages.join("; ") };
  }

  const invalidVertexMessages = findInvalidVertexOperations(operations, objects);
  if (invalidVertexMessages.length > 0) {
    return { ok: false, message: invalidVertexMessages.join("; ") };
  }

  const invalidExplodeMessages = findInvalidExplodeOperations(operations, objects);
  if (invalidExplodeMessages.length > 0) {
    return { ok: false, message: invalidExplodeMessages.join("; ") };
  }

  const invalidSplitMessages = findInvalidSplitOperations(operations, objects);
  if (invalidSplitMessages.length > 0) {
    return { ok: false, message: invalidSplitMessages.join("; ") };
  }

  const staged = cloneObjects(objects);
  const folded = operations.reduce<{ readonly objects: readonly GraphObject[]; readonly brokenSlots: readonly Address[] }>(
    (current, operation) => {
      const applied = applyOperation(current.objects, operation);
      return { objects: applied.objects, brokenSlots: [...current.brokenSlots, ...applied.brokenSlots] };
    },
    { objects: staged, brokenSlots: [] },
  );

  const result = deriveValidateAndEvaluate(folded.objects, context);
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    objects: result.objects,
    journal: [...journal, { operations: deepClone([...operations]) }],
    brokenSlots: dedupeAddresses(folded.brokenSlots).filter((address) => {
      const object = result.objects.find((candidate) => candidate.id === address.objectId);
      return object !== undefined && object.slots[slotKey(address.path)] !== undefined;
    }),
  };
}

function dedupeAddresses(addresses: readonly Address[]): readonly Address[] {
  const seen = new Set<string>();
  const deduped: Address[] = [];
  for (const address of addresses) {
    const key = addressKey(address);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(address);
  }
  return deduped;
}

function findUndeclaredFormulaOrDerivedSlots(objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];

  for (const object of objects) {
    const schema = getObjectSchema(object.type);
    if (schema === undefined) {
      continue;
    }

    const declaredKeys = new Set<string>([
      ...resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths).map((path) => slotKey(path)),
      ...resolveDerivedSlots(object, schema.derivedSlots).map((entry) => slotKey(entry.path)),
    ]);

    for (const key of Object.keys(object.slots)) {
      const slot = object.slots[key];
      if (slot === undefined) {
        continue;
      }
      if ((slot.kind === "formula" || slot.kind === "derived") && !declaredKeys.has(key)) {
        problems.push(
          `${describeUndeclaredSlot(object, key)} is a "${slot.kind}" slot that object type ` +
            `"${object.type}"'s schema does not declare — its edges were silently omitted`,
        );
      }
    }
  }

  return problems;
}

function describeUndeclaredSlot(object: GraphObject, key: string): string {
  return `${object.name}.${key}`;
}

function findSchemaSlotKindMismatches(objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];

  for (const object of objects) {
    const schema = getObjectSchema(object.type);
    if (schema === undefined) {
      continue;
    }

    for (const derivedSlotEntry of resolveDerivedSlots(object, schema.derivedSlots)) {
      const slot = object.slots[slotKey(derivedSlotEntry.path)];
      if (slot !== undefined && slot.kind === "derived") {
        continue;
      }
      const name = formatSchemaAddress({ objectId: object.id, path: derivedSlotEntry.path }, objects);
      const reason =
        slot === undefined
          ? "is missing — deriveEdges still emits an edge into it, pointing at a slot that does not exist"
          : `is a "${slot.kind}" slot where its schema declares "derived" — derived slots can never be converted`;
      problems.push(`${name} ${reason}`);
    }

    for (const path of resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths)) {
      const slot = object.slots[slotKey(path)];
      if (slot === undefined || slot.kind !== "derived") {
        continue;
      }
      const name = formatSchemaAddress({ objectId: object.id, path }, objects);
      problems.push(`${name} is a "derived" slot at a path its schema declares non-derived — derived slots can never be converted`);
    }
  }

  return problems;
}

function formatSchemaAddress(address: Address, objects: readonly GraphObject[]): string {
  const formatted = formatAddress(address, objects);
  return isAddressError(formatted) ? formatted.message : formatted;
}

function findDanglingReferences(objects: readonly GraphObject[], edges: readonly Edge[]): readonly string[] {
  const dependentsByMissingSource = new Map<string, Address[]>();

  for (const edge of edges) {
    if (resolveSlot(edge.sourceSlot, objects) !== undefined) {
      continue;
    }
    const key = addressKey(edge.sourceSlot);
    const existing = dependentsByMissingSource.get(key);
    if (existing === undefined) {
      dependentsByMissingSource.set(key, [edge.dependentSlot]);
    } else {
      existing.push(edge.dependentSlot);
    }
  }

  const problems: string[] = [];
  for (const dependents of dependentsByMissingSource.values()) {
    const names = dependents.map((address) => {
      const formatted = formatAddress(address, objects);
      return isAddressError(formatted) ? formatted.message : formatted;
    });
    const verb = names.length === 1 ? "references" : "reference";
    problems.push(`${names.join(", ")} ${verb} a slot that does not exist`);
  }
  return problems;
}

function findIllegalSlotValues(objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];

  for (const object of objects) {
    for (const key of Object.keys(object.slots)) {
      const slot = object.slots[key];
      if (slot === undefined) {
        continue;
      }
      if (hasIllegalNumber(slot.value)) {
        problems.push(`${describeUndeclaredSlot(object, key)} holds an illegal value (${describeIllegalValue(slot.value)}), which is not legal document state`);
      }
      if (slot.kind === "formula") {
        const illegalLiterals = collectIllegalAstLiterals(slot.ast);
        if (illegalLiterals.length > 0) {
          problems.push(
            `${describeUndeclaredSlot(object, key)}'s stored formula holds illegal number literal(s) ` +
              `(${illegalLiterals.map(formatIllegalNumber).join(", ")}), which is not legal document state`,
          );
        }
      }
    }
  }

  return problems;
}

function collectIllegalAstLiterals(ast: FormulaAst, out: number[] = []): number[] {
  switch (ast.type) {
    case "literal":
      if (typeof ast.value === "number" && isIllegalNumber(ast.value)) {
        out.push(ast.value);
      }
      return out;
    case "reference":
    case "range":
    case "error":
      return out;
    case "binaryOp":
      collectIllegalAstLiterals(ast.left, out);
      collectIllegalAstLiterals(ast.right, out);
      return out;
    case "unaryOp":
      collectIllegalAstLiterals(ast.operand, out);
      return out;
    case "functionCall":
      for (const arg of ast.args) {
        collectIllegalAstLiterals(arg, out);
      }
      return out;
    default: {
      const exhaustive: never = ast;
      void exhaustive;
      return out;
    }
  }
}

function findIllegalOperationPayloads(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];

  operations.forEach((operation, index) => {
    const prefix = `operation ${index + 1} of ${operations.length}`;

    if (operation.kind === "setSlot") {
      const formatted = formatAddress(operation.address, objects);
      const name = isAddressError(formatted) ? formatted.message : formatted;
      if (hasIllegalNumber(operation.slot.value)) {
        problems.push(
          `${prefix}: ${name} would hold an illegal value (${describeIllegalValue(operation.slot.value)}), which is not legal document state`,
        );
      }
      if (operation.slot.kind === "formula") {
        const illegalLiterals = collectIllegalAstLiterals(operation.slot.ast);
        if (illegalLiterals.length > 0) {
          problems.push(
            `${prefix}: ${name}'s formula would hold illegal number literal(s) ` +
              `(${illegalLiterals.map(formatIllegalNumber).join(", ")}), which is not legal document state`,
          );
        }
      }
      return;
    }

    if (operation.kind === "createObject") {
      for (const key of Object.keys(operation.object.slots)) {
        const slot = operation.object.slots[key];
        if (slot === undefined) {
          continue;
        }
        if (hasIllegalNumber(slot.value)) {
          problems.push(
            `${prefix}: ${describeUndeclaredSlot(operation.object, key)} would hold an illegal value ` +
              `(${describeIllegalValue(slot.value)}), which is not legal document state`,
          );
        }
        if (slot.kind === "formula") {
          const illegalLiterals = collectIllegalAstLiterals(slot.ast);
          if (illegalLiterals.length > 0) {
            problems.push(
              `${prefix}: ${describeUndeclaredSlot(operation.object, key)}'s formula would hold illegal number literal(s) ` +
                `(${illegalLiterals.map(formatIllegalNumber).join(", ")}), which is not legal document state`,
            );
          }
        }
      }
      return;
    }

    if (operation.kind === "addVertex" && hasIllegalNumber(operation.point)) {
      problems.push(
        `${prefix}: the new vertex would hold an illegal value (${describeIllegalValue(operation.point)}), which is not legal document state`,
      );
    }
  });

  return problems;
}

interface TrackedTableState {
  readonly name: string;
  readonly isTable: boolean;
  readonly rowsResizable: boolean;
  readonly colsResizable: boolean;
  rows: number;
  cols: number;
}

function findInvalidTableResizes(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];
  const tracked = new Map<string, TrackedTableState>();

  const resolveTrackedTableState = (objectId: string): TrackedTableState | undefined => {
    const existing = tracked.get(objectId);
    if (existing !== undefined) {
      return existing;
    }
    const fromObjects = objects.find((candidate) => candidate.id === objectId);
    const fromCreate = fromObjects === undefined
      ? operations.find((candidate): candidate is CreateObjectOperation => candidate.kind === "createObject" && candidate.object.id === objectId)?.object
      : undefined;
    const source = fromObjects ?? fromCreate;
    if (source === undefined) {
      return undefined;
    }
    const { rows, cols } = getTableDimensions(source);
    const state: TrackedTableState = {
      name: source.name,
      isTable: source.type === "table",
      rowsResizable: isTableDimensionResizable(source, "row"),
      colsResizable: isTableDimensionResizable(source, "column"),
      rows,
      cols,
    };
    tracked.set(objectId, state);
    return state;
  };

  operations.forEach((operation, index) => {
    if (operation.kind !== "insertTableLine" && operation.kind !== "deleteTableLine") {
      return;
    }
    const isInsert = operation.kind === "insertTableLine";
    const verb = isInsert ? "insertion" : "deletion";
    const prefix = `operation ${index + 1} of ${operations.length}`;
    const state = resolveTrackedTableState(operation.objectId);
    if (state === undefined) {
      return;
    }
    if (!state.isTable) {
      problems.push(`${prefix}: object "${state.name}" is not a table, so its ${operation.axis}s cannot be resized`);
      return;
    }
    const badDimensions: string[] = [];
    if (!state.rowsResizable) badDimensions.push("rows");
    if (!state.colsResizable) badDimensions.push("cols");
    if (badDimensions.length > 0) {
      const verbAgreement = badDimensions.length > 1 ? "slots are" : "slot is";
      problems.push(
        `${prefix}: "${state.name}"'s ${badDimensions.join(" and ")} ${verbAgreement} not "literal" — ` +
          "its extent cannot be coherently resized on any axis",
      );
      return;
    }
    const bound = operation.axis === "row" ? state.rows : state.cols;
    const maxValidIndex = isInsert ? bound + 1 : bound;
    if (!Number.isInteger(operation.index) || operation.index < 1 || operation.index > maxValidIndex) {
      problems.push(
        `${prefix}: ${operation.axis} ${verb} index ${operation.index} is out of range for "${state.name}" ` +
          `(currently ${bound} ${operation.axis}s; must be an integer from 1 to ${maxValidIndex})`,
      );
      return;
    }
    const delta = isInsert ? 1 : -1;
    if (operation.axis === "row") {
      state.rows += delta;
    } else {
      state.cols += delta;
    }
  });

  return problems;
}

function findInvalidDimensionWrites(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];
  const trackedTypes = new Map<string, { readonly name: string; readonly type: ObjectType }>();

  const resolveTracked = (objectId: string): { readonly name: string; readonly type: ObjectType } | undefined => {
    const existing = trackedTypes.get(objectId);
    if (existing !== undefined) {
      return existing;
    }
    const fromObjects = objects.find((candidate) => candidate.id === objectId);
    const fromCreate = fromObjects === undefined
      ? operations.find((candidate): candidate is CreateObjectOperation => candidate.kind === "createObject" && candidate.object.id === objectId)?.object
      : undefined;
    const source = fromObjects ?? fromCreate;
    if (source === undefined) {
      return undefined;
    }
    const state = { name: source.name, type: source.type };
    trackedTypes.set(objectId, state);
    return state;
  };

  operations.forEach((operation, index) => {
    if (operation.kind !== "setSlot") {
      return;
    }
    const axisName = dimensionPathName(operation.address.path);
    if (axisName === undefined) {
      return;
    }
    const tracked = resolveTracked(operation.address.objectId);
    if (tracked === undefined || tracked.type !== TABLE_TYPE) {
      return;
    }
    const problem = describeDimensionWriteProblem(operation.slot);
    if (problem === undefined) {
      return;
    }
    problems.push(
      `operation ${index + 1} of ${operations.length}: ${tracked.name}.${axisName} must be a whole number from ` +
        `${MIN_TABLE_LINES} to ${MAX_TABLE_LINES} held as a literal — a formula there would let evaluation resize ` +
        `the table (Rule 6). Got: ${problem}`,
    );
  });

  return problems;
}

function findIllegalSlotClears(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];
  operations.forEach((operation, index) => {
    if (operation.kind !== "clearSlot") {
      return;
    }
    const fromObjects = objects.find((candidate) => candidate.id === operation.address.objectId);
    const fromCreate = fromObjects === undefined
      ? operations.find((candidate): candidate is CreateObjectOperation => candidate.kind === "createObject" && candidate.object.id === operation.address.objectId)?.object
      : undefined;
    const target = fromObjects ?? fromCreate;
    if (target === undefined) {
      return;
    }
    const path = operation.address.path;
    const isCell = target.type === TABLE_TYPE && path.length === 2 && path[0] === TABLE_CELL_PATH_PREFIX;
    if (isCell) {
      return;
    }
    problems.push(
      `operation ${index + 1} of ${operations.length}: ${target.name}.${slotKey(path)} cannot be cleared — ` +
        `only a table cell may be emptied by removing its slot. Every other slot is schema-declared, ` +
        `and what an absent one means is not settled; write a value there instead`,
    );
  });
  return problems;
}

function dimensionPathName(path: readonly string[]): "rows" | "cols" | undefined {
  if (path.length !== 1) {
    return undefined;
  }
  if (path[0] === TABLE_ROWS_PATH[0]) {
    return "rows";
  }
  if (path[0] === TABLE_COLS_PATH[0]) {
    return "cols";
  }
  return undefined;
}

function describeDimensionWriteProblem(slot: Slot): string | undefined {
  if (slot.kind !== "literal") {
    return slot.kind === "formula" ? "a formula" : `a "${slot.kind}" slot`;
  }
  if (typeof slot.value !== "number" || !Number.isInteger(slot.value) || slot.value < MIN_TABLE_LINES || slot.value > MAX_TABLE_LINES) {
    return describeDimensionSlotValue(slot.value);
  }
  return undefined;
}

function describeDimensionSlotValue(value: Value): string {
  if (typeof value === "number") {
    return formatIllegalNumber(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value) || (typeof value === "object" && value !== null && "x" in value && "y" in value)) {
    return "a point value";
  }
  return String(value);
}

function findInvalidNames(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];
  const tracked: { id: string; name: string; type: ObjectType }[] = objects.map((object) => ({ id: object.id, name: object.name, type: object.type }));

  operations.forEach((operation, index) => {
    if (operation.kind === "createObject") {
      const check = checkNameAvailable(operation.object.name, tracked);
      if (!check.ok) {
        problems.push(`operation ${index + 1} of ${operations.length} cannot create: ${check.message}`);
        return;
      }
      tracked.push({ id: operation.object.id, name: operation.object.name, type: operation.object.type });
      return;
    }
    if (operation.kind === "deleteObject") {
      const at = tracked.findIndex((entry) => entry.id === operation.objectId);
      if (at !== -1) {
        tracked.splice(at, 1);
      }
      return;
    }
    if (operation.kind !== "renameObject") {
      return;
    }
    const check = checkNameAvailable(operation.name, tracked, operation.objectId);
    if (!check.ok) {
      problems.push(`operation ${index + 1} of ${operations.length} cannot rename: ${check.message}`);
      return;
    }
    const entry = tracked.find((candidate) => candidate.id === operation.objectId);
    if (entry !== undefined) {
      entry.name = operation.name;
    }
  });

  return problems;
}

function findInvalidPortOperations(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];
  const tracked = new Map<string, { in: Set<string>; out: Set<string> }>(
    objects.map((object) => [object.id, { in: new Set(object.ports?.in ?? []), out: new Set(object.ports?.out ?? []) }]),
  );

  operations.forEach((operation, index) => {
    if (operation.kind === "createObject") {
      tracked.set(operation.object.id, { in: new Set(operation.object.ports?.in ?? []), out: new Set(operation.object.ports?.out ?? []) });
      return;
    }
    if (operation.kind === "deleteObject") {
      tracked.delete(operation.objectId);
      return;
    }
    if (operation.kind !== "addPort" && operation.kind !== "removePort") {
      return;
    }
    const prefix = `operation ${index + 1} of ${operations.length}`;
    const ports = tracked.get(operation.objectId);
    if (ports === undefined) {
      return;
    }
    const family = ports[operation.family];
    if (operation.kind === "addPort") {
      if (!isLegalPortName(operation.name)) {
        problems.push(`${prefix} attempts to add a port named "${operation.name}", which is not a legal port name (letters, digits and underscore only)`);
        return;
      }
      if (family.has(operation.name)) {
        problems.push(`${prefix} attempts to add ${operation.family} port "${operation.name}", which already exists`);
        return;
      }
      family.add(operation.name);
      return;
    }
    if (!family.has(operation.name)) {
      problems.push(`${prefix} attempts to remove ${operation.family} port "${operation.name}", which does not exist`);
      return;
    }
    family.delete(operation.name);
  });

  return problems;
}

interface TrackedVertexCount {
  readonly name: string;
  readonly type: ObjectType;
  count: number;
}

/**
 * Tracks each polyline's vertex count across the batch, in order. This
 * function checks an addVertex followed by a deleteVertex of the vertex it
 * just added against the count the batch reaches by then. It never checks
 * against the count before the batch started.
 */
function findInvalidVertexOperations(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];
  const tracked = new Map<string, TrackedVertexCount>();

  const resolveTracked = (objectId: string): TrackedVertexCount | undefined => {
    const existing = tracked.get(objectId);
    if (existing !== undefined) {
      return existing;
    }
    const fromObjects = objects.find((candidate) => candidate.id === objectId);
    const fromCreate = fromObjects === undefined
      ? operations.find((candidate): candidate is CreateObjectOperation => candidate.kind === "createObject" && candidate.object.id === objectId)?.object
      : undefined;
    const source = fromObjects ?? fromCreate;
    if (source === undefined) {
      return undefined;
    }
    const state: TrackedVertexCount = { name: source.name, type: source.type, count: source.vertexCount ?? 0 };
    tracked.set(objectId, state);
    return state;
  };

  operations.forEach((operation, index) => {
    if (operation.kind !== "addVertex" && operation.kind !== "deleteVertex") {
      return;
    }
    const prefix = `operation ${index + 1} of ${operations.length}`;
    const state = resolveTracked(operation.objectId);
    if (state === undefined) {
      return;
    }
    if (state.type !== POLYLINE_TYPE) {
      const verb = operation.kind === "addVertex" ? "add" : "delete";
      problems.push(`${prefix}: object "${state.name}" is a "${state.type}", not a polyline, so it has no vertices to ${verb}`);
      return;
    }
    if (operation.kind === "addVertex") {
      state.count += 1;
      return;
    }
    if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index >= state.count) {
      const bound = state.count === 0 ? "it has no vertices" : `must be an integer from 0 to ${state.count - 1}`;
      problems.push(`${prefix}: vertex index ${operation.index} is out of range for "${state.name}" (currently ${state.count} vertices; ${bound})`);
      return;
    }
    if (operation.force !== true) {
      const dependents = findLiveVertexDependents(objects, operation.objectId, operation.index);
      if (dependents.length > 0) {
        const verb = dependents.length === 1 ? "references" : "reference";
        problems.push(`${prefix}: ${dependents.join(", ")} still ${verb} vertex ${operation.index} of "${state.name}"`);
      }
    }
    state.count -= 1;
  });

  return problems;
}

/**
 * Every formula, anywhere in the document as it stands now, that names the
 * exact vertex a deleteVertex operation names for removal. A shift down the
 * line is never a break, because the same real vertex survives under a new
 * index. Only a reference to the exact vertex that leaves counts here.
 */
function findLiveVertexDependents(objects: readonly GraphObject[], targetObjectId: string, index: number): readonly string[] {
  const targetKeys = new Set(vertexPartPaths(index).map((path) => slotKey(path)));
  const names: string[] = [];
  for (const object of objects) {
    const schema = getObjectSchema(object.type);
    if (schema === undefined) {
      continue;
    }
    for (const path of resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths)) {
      const slot = object.slots[slotKey(path)];
      if (slot === undefined || slot.kind !== "formula") {
        continue;
      }
      const namesThisVertex = extractDependencies(slot.ast).some(
        (dependency) =>
          dependency.kind === "reference" &&
          dependency.address.objectId === targetObjectId &&
          targetKeys.has(slotKey(dependency.address.path)),
      );
      if (!namesThisVertex) {
        continue;
      }
      const formatted = formatAddress({ objectId: object.id, path }, objects);
      names.push(isAddressError(formatted) ? formatted.message : formatted);
    }
  }
  return names;
}

/**
 * Explode is valid only for a preset type, and only when its vertices slot
 * holds a real point list right now. explodeObjectToPolyline runs the same
 * check applyOperation later trusts, so a bad explode never reaches the
 * stage step.
 */
/**
 * A split names an edge, not a vertex. An open path has one fewer edge than it
 * has vertices, so the bound moves with the closed slot.
 */
function findInvalidSplitOperations(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];
  operations.forEach((operation, index) => {
    if (operation.kind !== "splitEdge") {
      return;
    }
    const prefix = `operation ${index + 1} of ${operations.length}`;
    const target = objects.find((candidate) => candidate.id === operation.objectId);
    if (target === undefined) {
      return;
    }
    if (target.type !== POLYLINE_TYPE) {
      problems.push(`${prefix}: object "${target.name}" is a "${target.type}", not a polyline, so it has no edge to split`);
      return;
    }
    const edges = polylineEdgeCount(target);
    if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index >= edges) {
      const bound = edges === 0 ? "it has no edges" : `must be an integer from 0 to ${edges - 1}`;
      problems.push(`${prefix}: edge index ${operation.index} is out of range for "${target.name}" (currently ${edges} edges; ${bound})`);
      return;
    }
    // A split reads the current vertices value, the way an explode does. Refuse
    // rather than do nothing when that value has not resolved to a point list.
    if (splitPolylineEdge(target, operation.index, operation.point) === undefined) {
      problems.push(`${prefix}: "${target.name}".vertices did not resolve to a point list, so edge ${operation.index} cannot be cut`);
    }
  });
  return problems;
}

function findInvalidExplodeOperations(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];
  operations.forEach((operation, index) => {
    if (operation.kind !== "explode") {
      return;
    }
    const prefix = `operation ${index + 1} of ${operations.length}`;
    const target = objects.find((candidate) => candidate.id === operation.objectId);
    if (target === undefined) {
      return;
    }
    if (!EXPLODABLE_TYPES.has(target.type)) {
      problems.push(`${prefix}: object "${target.name}" is a "${target.type}" — only a circle, a polygon or a rect can be exploded`);
      return;
    }
    const result = explodeObjectToPolyline(target, target.name);
    if (!result.ok) {
      problems.push(`${prefix}: ${result.message}`);
    }
  });
  return problems;
}

/** The slot keys the old object had that the new one drops. Everything else keeps its path. */
function removedSlotKeys(oldObject: GraphObject, newObject: GraphObject): ReadonlySet<string> {
  const surviving = new Set(Object.keys(newObject.slots));
  const removed = new Set<string>();
  for (const key of Object.keys(oldObject.slots)) {
    if (!surviving.has(key)) {
      removed.add(key);
    }
  }
  return removed;
}

function describeIllegalValue(value: Value): string {
  if (typeof value === "number") {
    return formatIllegalNumber(value);
  }
  if (Array.isArray(value)) {
    return `[${(value as readonly Point[]).map(describePoint).join(", ")}]`;
  }
  if (typeof value === "object" && value !== null && "x" in value && "y" in value) {
    return describePoint(value as Point);
  }
  return String(value);
}

function describePoint(point: Point): string {
  return `{ x: ${formatIllegalNumber(point.x)}, y: ${formatIllegalNumber(point.y)} }`;
}

function formatIllegalNumber(n: number): string {
  return Object.is(n, -0) ? "-0" : String(n);
}
