/**
 * mutation.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * The single channel for state change. No other code writes document state.
 *
 * Every mutation runs these eight steps in order.
 *   1. Stage. Deep clone the current state.
 *   2. Apply the operations to the clone.
 *   3. Derive the whole edge set again, from stored ASTs and from the schema.
 *   4. Check integrity. Refuse a formula that names a slot which is absent.
 *   5. Check for cycles. Refuse and name every slot in the cycle.
 *   6. On a refusal, throw the clone away. The old state never changed.
 *   7. Evaluate. An evaluation error makes an error value, not a rollback.
 *   8. Commit. Swap the clone in and append to the journal.
 *
 * A batch applies many operations to one clone and commits all or nothing. A
 * document load must use a batch.
 *
 * The integrity check must run before the cycle check. A cycle check over an
 * edge set that nobody trusts proves nothing.
 *
 * This file and primitives/schema.ts must agree about every slot path. Both
 * read the schema through the same resolver for that reason.
 */

import { checkNameAvailable, formatAddress, isAddressError, TABLE_CELL_PATH_PREFIX, type Address } from "./address.ts";
import { NULL_EVAL_CONTEXT, type EvalContext } from "./eval-context.ts";
import type { FormulaAst } from "./formula/ast.ts";
import { extractDependencies, repairAddressesInAst, rewriteAddressesInAst } from "./formula/deps.ts";
import { derivedSlotDependencyAddresses, getObjectSchema, resolveDerivedSlots, resolveNonDerivedSlotPaths } from "./primitives/schema.ts";
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
import { hasIllegalNumber, isIllegalNumber, isLegalPortName, resolveSlot, slotKey, TABLE_TYPE, type GraphObject, type ObjectType, type Point, type Slot, type Value } from "./graph/node.ts";

/**
 * Rebuilds the whole edge set from stored ASTs and from the schema. Step 3.
 * It reads slot paths through the schema resolver. It never takes a key apart.
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
 * Step 4. Four checks, in this order. An undeclared slot first, because a later
 * cycle check over an edge set that nobody trusts proves nothing.
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

export type Operation =
  | SetSlotOperation
  | ClearSlotOperation
  | DeleteObjectOperation
  | CreateObjectOperation
  | InsertTableLineOperation
  | DeleteTableLineOperation
  | RenameObjectOperation
  | AddPortOperation
  | RemovePortOperation;

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
    operation.kind === "removePort"
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
