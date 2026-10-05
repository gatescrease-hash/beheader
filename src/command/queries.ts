/**
 * queries.ts
 *
 * The graph queries of section 19: `upstream`, `downstream`, `orphans`,
 * `broken` and `find`. Each answers with a list of object IDs, which
 * commands.ts hands on as a selection, so every other command then acts on the
 * answer.
 *
 * A walk follows slot edges, and not object pairs, so `upstream circle_1.r`
 * finds what the radius reads and leaves out what the fill reads. An edge
 * between two slots of one object costs no depth, and an edge from one object
 * to another costs one step. A depth of 1 therefore finds the objects that
 * read or are read directly, through any formula inside the object that
 * carries the value to the slot that crosses. The walk visits each slot once,
 * with the cheaper path to it kept, so it costs the edges it reaches.
 *
 * The edges come from readEdges in the engine, which adds what the engine leaves out:
 * a formula or a text box that reads an empty cell inside the extent of a
 * table. The engine leaves that edge out, because an empty cell is a place
 * with no slot to order, and the reader still reads the table. A delete without force names
 * that reader, so `downstream` names it too.
 *
 * The object at the start of a walk stays out of its own answer. A graph with
 * no cycles cannot lead a slot back to itself, and an object can still appear
 * on both sides of another one, such as a table that feeds a circle and reads
 * the circle back in another cell, so the answer leaves out the start by name.
 *
 * Command-layer code: it reads the engine through its public surface, and
 * touches no DOM.
 */
import {
  addressKey,
  DOC_TYPE,
  formatFormula,
  isErrorValue,
  mathSourceWithNames,
  TABLE_CELL_PATH_PREFIX,
  type Address,
  type Edge,
  type GraphObject,
} from "../engine/index.ts";

/** Where a walk starts: a whole object, or one slot on it. */
export interface WalkStart {
  readonly objectId: string;
  readonly address?: Address;
}

export interface WalkResult {
  /** The objects reached, nearest first, then in document order. */
  readonly objectIds: readonly string[];
  /**
   * For a walk downstream, the slots on other objects that read the start
   * directly. For a whole object these are the slots a delete without force
   * names when it refuses.
   */
  readonly directReaders: readonly Address[];
}

/**
 * Walks the edges from the start against their direction for `upstream` and
 * along it for `downstream`, as far as the depth allows, with no limit when the
 * depth is absent.
 */
export function walkGraph(
  edges: readonly Edge[],
  objects: readonly GraphObject[],
  start: WalkStart,
  direction: "upstream" | "downstream",
  depth?: number,
): WalkResult {
  const next = new Map<string, Address[]>();
  const seeds = new Map<string, Address>();
  const directReaders = new Map<string, Address>();
  const startKey = start.address === undefined ? undefined : addressKey(start.address);
  const atStart = (address: Address): boolean => (startKey === undefined ? address.objectId === start.objectId : addressKey(address) === startKey);
  for (const edge of edges) {
    const from = direction === "downstream" ? edge.sourceSlot : edge.dependentSlot;
    const to = direction === "downstream" ? edge.dependentSlot : edge.sourceSlot;
    const fromKey = addressKey(from);
    const list = next.get(fromKey);
    if (list === undefined) next.set(fromKey, [to]);
    else list.push(to);
    if (atStart(from)) seeds.set(fromKey, from);
    if (direction === "downstream" && atStart(edge.sourceSlot) && edge.dependentSlot.objectId !== start.objectId) {
      directReaders.set(addressKey(edge.dependentSlot), edge.dependentSlot);
    }
  }
  if (start.address !== undefined) seeds.set(addressKey(start.address), start.address);

  // A breadth first walk with two edge costs, 0 and 1, which a double ended
  // queue orders without a heap. A step of cost 0 goes on the front stack,
  // which empties before the next item of the back queue is taken.
  const distance = new Map<string, number>();
  const front: { readonly address: Address; readonly steps: number }[] = [];
  const back: { readonly address: Address; readonly steps: number }[] = [];
  let head = 0;
  for (const [key, address] of seeds) {
    distance.set(key, 0);
    back.push({ address, steps: 0 });
  }
  const objectSteps = new Map<string, number>();
  while (front.length > 0 || head < back.length) {
    const current = front.pop() ?? back[head++]!;
    if (current.steps !== distance.get(addressKey(current.address))) continue;
    const known = objectSteps.get(current.address.objectId);
    if (known === undefined || current.steps < known) objectSteps.set(current.address.objectId, current.steps);
    for (const to of next.get(addressKey(current.address)) ?? []) {
      const cost = to.objectId === current.address.objectId ? 0 : 1;
      const steps = current.steps + cost;
      if (depth !== undefined && steps > depth) continue;
      const toKey = addressKey(to);
      const previous = distance.get(toKey);
      if (previous !== undefined && previous <= steps) continue;
      distance.set(toKey, steps);
      (cost === 0 ? front : back).push({ address: to, steps });
    }
  }

  objectSteps.delete(start.objectId);
  const order = new Map(objects.map((object, index) => [object.id, index]));
  const objectIds = [...objectSteps.keys()].sort((a, b) => objectSteps.get(a)! - objectSteps.get(b)! || (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { objectIds, directReaders: [...directReaders.values()] };
}

/**
 * The objects with no edge to or from another object. The document variables
 * stay out, because their holder is no shape on the canvas, and an edge inside
 * one object, such as a radius that drives the vertices, connects that object
 * to nothing else.
 */
export function findOrphans(edges: readonly Edge[], objects: readonly GraphObject[]): readonly string[] {
  const connected = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceSlot.objectId !== edge.dependentSlot.objectId) {
      connected.add(edge.sourceSlot.objectId);
      connected.add(edge.dependentSlot.objectId);
    }
  }
  return objects.filter((object) => object.type !== DOC_TYPE && !connected.has(object.id)).map((object) => object.id);
}

export interface BrokenObject {
  readonly objectId: string;
  /**
   * The slots an operator wrote, as a literal or a formula, that hold an error,
   * each as its name and the error code. When the error arises in a derived
   * slot alone, such as a text box that cannot measure, the first derived slot
   * holding it stands here instead.
   */
  readonly slots: readonly { readonly name: string; readonly error: string }[];
  /** How many derived slots hold an error besides those named. */
  readonly derivedCount: number;
}

/**
 * The objects with a slot that holds an error value. A script still waiting
 * for its answer holds the pending code, which says nothing went wrong, so it
 * counts as no error here. An error in a written slot spreads to every derived
 * slot that reads it, so the answer names the written slots and counts the
 * rest, which keeps one division by zero to one line.
 */
export function findBroken(objects: readonly GraphObject[]): readonly BrokenObject[] {
  const broken: BrokenObject[] = [];
  for (const object of objects) {
    const written: { name: string; error: string }[] = [];
    const derived: { name: string; error: string }[] = [];
    for (const [key, slot] of Object.entries(object.slots)) {
      if (isErrorValue(slot.value) && slot.value.error !== "#PENDING") {
        (slot.kind === "derived" ? derived : written).push({ name: slotDisplayName(object, key), error: slot.value.error });
      }
    }
    if (written.length > 0) broken.push({ objectId: object.id, slots: written, derivedCount: derived.length });
    else if (derived.length > 0) broken.push({ objectId: object.id, slots: derived.slice(0, 1), derivedCount: derived.length - 1 });
  }
  return broken;
}

/**
 * The objects whose formulas or text hold the text, with case ignored. A
 * formula reads as the operator would type it, with names and not IDs, so a
 * search for `table_1.A1` finds every formula that names that cell. Text means
 * every literal string slot, which covers the content of a text box, a table
 * cell, the source of an equation and the source of a script. Computed values
 * are left out, because they change with every edit upstream.
 */
export function findText(objects: readonly GraphObject[], text: string): readonly string[] {
  const needle = text.toLowerCase();
  return objects.filter((object) => Object.entries(object.slots).some(([key, slot]) => {
    if (slot.kind === "formula") {
      return formatFormula(slot.ast, objects, object.id).toLowerCase().includes(needle)
        || formatFormula(slot.ast, objects).toLowerCase().includes(needle);
    }
    if (slot.kind !== "literal" || typeof slot.value !== "string") return false;
    const shown = object.type === "math" && key === "source" ? mathSourceWithNames(slot.value, objects) : slot.value;
    return shown.toLowerCase().includes(needle);
  })).map((object) => object.id);
}

/** A slot as an operator writes it, with the cell form for a table cell. */
function slotDisplayName(object: GraphObject, key: string): string {
  const cellPrefix = `${TABLE_CELL_PATH_PREFIX}.`;
  return `${object.name}.${key.startsWith(cellPrefix) ? key.slice(cellPrefix.length) : key}`;
}
