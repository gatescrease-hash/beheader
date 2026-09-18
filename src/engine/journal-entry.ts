/**
 * journal-entry.ts
 *
 * Reads one loaded journal entry and says whether it holds a batch that can be
 * replayed.
 *
 * A loaded journal is deliberately permissive. document.ts checks the numbers
 * inside it and nothing else, so an entry arrives at a replay as whatever JSON
 * was in the file, and `["garbage", 42, null]` is a journal a file can carry.
 * The check below is what stands between that and mutate().
 *
 * Its refusals are written out rather than left to the runtime. Before this
 * file existed a malformed entry reached mutate() and threw, and the operator
 * saw the text of a JavaScript TypeError: "Cannot read properties of null
 * (reading 'kind')". That wording is the shape of the interpreter rather than
 * the shape of the file, and the Rust engine has no way to produce it, so both
 * engines answer from the wording here instead. `D-006` and `D-007` in
 * docs/RUST_PORT.md record that choice.
 *
 * The checks describe the fifteen operations that mutation.ts accepts. They
 * read the shape of an operation and not its meaning: whether a name is
 * available, an index is in range or a formula makes a cycle are questions for
 * mutate(), which sees every operation of the batch against the objects the
 * one before it left.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import { validateFormulaAstShape } from "./formula/ast.ts";

/** The reason an entry cannot be replayed, or nothing when it can. */
export type EntryProblem = string | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A member as a refusal quotes it, with a missing one reading as undefined. */
function quote(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

/**
 * The reason a loaded entry cannot be replayed, or nothing when its shape
 * holds every operation mutate() would read.
 */
export function journalEntryProblem(entry: unknown): EntryProblem {
  if (!isPlainObject(entry) || !Array.isArray(entry.operations)) {
    return 'an entry is an object with an "operations" array';
  }
  for (let index = 0; index < entry.operations.length; index += 1) {
    const problem = operationProblem(entry.operations[index], index);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

function operationProblem(operation: unknown, index: number): EntryProblem {
  if (!isPlainObject(operation)) {
    return `operation ${index} is an object`;
  }
  const kind = operation.kind;
  const at = (reason: string): string => `operation ${index} (${String(kind)}) ${reason}`;

  switch (kind) {
    case "createObject":
      return isPlainObject(operation.object) ? objectPayloadProblem(operation.object, index) : at('has an "object"');
    case "setSlot":
      return (
        addressProblem(operation.address, at) ??
        (operation.slot === undefined ? at('has a "slot"') : slotProblem(operation.slot, (reason) => at(`slot ${reason}`)))
      );
    case "clearSlot":
      return addressProblem(operation.address, at);
    case "renameVariable":
      return addressProblem(operation.address, at) ?? textProblem(operation.name, "name", at);
    case "renameObject":
      return textProblem(operation.objectId, "objectId", at) ?? textProblem(operation.name, "name", at);
    case "deleteObject":
      return textProblem(operation.objectId, "objectId", at) ?? forceProblem(operation.force, at);
    case "explode":
      return textProblem(operation.objectId, "objectId", at) ?? forceProblem(operation.force, at);
    case "insertTableLine":
    case "deleteTableLine":
      return (
        textProblem(operation.objectId, "objectId", at) ??
        memberOfProblem(operation.axis, "axis", ["row", "column"], at) ??
        numberProblem(operation.index, "index", at)
      );
    case "addPort":
    case "removePort":
      return (
        textProblem(operation.objectId, "objectId", at) ??
        memberOfProblem(operation.family, "family", ["in", "out"], at) ??
        textProblem(operation.name, "name", at)
      );
    case "setMathSource":
      return textProblem(operation.objectId, "objectId", at) ?? textProblem(operation.source, "source", at);
    case "addVertex":
      return textProblem(operation.objectId, "objectId", at) ?? pointProblem(operation.point, "point", at);
    case "deleteVertex":
      return (
        textProblem(operation.objectId, "objectId", at) ??
        numberProblem(operation.index, "index", at) ??
        forceProblem(operation.force, at)
      );
    case "splitEdge":
      return (
        textProblem(operation.objectId, "objectId", at) ??
        numberProblem(operation.index, "index", at) ??
        pointProblem(operation.point, "point", at)
      );
    default:
      return `operation ${index} has an unrecognised kind ${quote(kind)}`;
  }
}

type Phrase = (reason: string) => string;

function textProblem(value: unknown, member: string, at: Phrase): EntryProblem {
  return typeof value === "string" ? undefined : at(`has a string "${member}", not ${quote(value)}`);
}

function numberProblem(value: unknown, member: string, at: Phrase): EntryProblem {
  return typeof value === "number" ? undefined : at(`has a number "${member}", not ${quote(value)}`);
}

function forceProblem(value: unknown, at: Phrase): EntryProblem {
  return value === undefined || typeof value === "boolean" ? undefined : at(`has a boolean "force" where it has one, not ${quote(value)}`);
}

function memberOfProblem(value: unknown, member: string, allowed: readonly string[], at: Phrase): EntryProblem {
  return typeof value === "string" && allowed.includes(value)
    ? undefined
    : at(`sets "${member}" to ${allowed.map((name) => `"${name}"`).join(" or ")}, not ${quote(value)}`);
}

function addressProblem(value: unknown, at: Phrase): EntryProblem {
  if (!isPlainObject(value) || typeof value.objectId !== "string" || !Array.isArray(value.path) || !value.path.every((part) => typeof part === "string")) {
    return at('has an "address" with a string objectId and a path of strings');
  }
  return undefined;
}

function pointProblem(value: unknown, member: string, at: Phrase): EntryProblem {
  if (!isPlainObject(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    return at(`has a "${member}" with a numeric x and y`);
  }
  return undefined;
}

/**
 * How a slot falls short, as a phrase its caller puts after the name of the
 * slot. A setSlot operation names it "slot", and an object payload names it by
 * its key, so the phrase arrives with no name of its own.
 */
function slotProblem(value: unknown, at: Phrase): EntryProblem {
  if (!isPlainObject(value)) {
    return at("is an object");
  }
  switch (value.kind) {
    case "literal":
      return "value" in value ? undefined : at("is a literal with no value");
    case "formula": {
      if (!("ast" in value)) {
        return at("is a formula with no ast");
      }
      const shape = validateFormulaAstShape(value.ast);
      return shape.ok ? undefined : at(`is a formula whose ast ${shape.reason}`);
    }
    case "derived":
      return undefined;
    default:
      return at(`is of an unrecognised kind ${quote(value.kind)}`);
  }
}

/**
 * The shape of an object a createObject entry carries. It reads the members
 * that sit beside the slot map, because a generic walk cannot tell a port list
 * from a slot, and leaves what the object means to mutate().
 */
function objectPayloadProblem(object: Record<string, unknown>, index: number): EntryProblem {
  const at = (reason: string): string => `operation ${index} (createObject) object ${reason}`;
  if (typeof object.id !== "string" || typeof object.name !== "string" || typeof object.type !== "string") {
    return at("has a string id, name, and type");
  }
  if (!isPlainObject(object.slots)) {
    return at('has a "slots" object');
  }
  const slots = object.slots as Record<string, unknown>;
  for (const key of Object.keys(slots)) {
    const problem = slotProblem(slots[key], (reason) => at(`slot "${key}" ${reason}`));
    if (problem !== undefined) {
      return problem;
    }
  }
  if (object.target !== undefined && addressProblem(object.target, at) !== undefined) {
    return at('has a "target" with a string objectId and a path of strings');
  }
  if (object.ports !== undefined && !isPortsShape(object.ports)) {
    return at('has "ports" with an "in" list and an "out" list');
  }
  if (object.vertexCount !== undefined && typeof object.vertexCount !== "number") {
    return at(`has a number "vertexCount" where it has one, not ${quote(object.vertexCount)}`);
  }
  return undefined;
}

function isPortsShape(value: unknown): boolean {
  return isPlainObject(value) && Array.isArray(value.in) && Array.isArray(value.out);
}
