/**
 * arrange.ts
 *
 * Plans the arrangements of section 20: `arrange flow`, `arrange grid`,
 * `arrange tidy`, `align` and `distribute`. Each plan is one batch of slot
 * writes, so an arrangement commits as one mutation and one undo takes all of
 * it back.
 *
 * The plan moves units. A unit is an object on the canvas with no group around
 * it, or the outermost group of the objects inside one, because a group moves
 * with everything in it. The variable holder and the layers have no place on
 * the canvas, so they are no unit. A unit moves through planMove, the planner
 * a drag uses, so the rule of a drag holds here as well: a position a formula
 * drives holds still, a path with no origin moves every vertex, and a vertex a
 * formula drives stays. The plan names every unit that a formula held, so an
 * arrangement that looks wrong carries its own reason.
 *
 * `arrange flow` ranks units by dependency depth over the curves of the
 * overlay: a unit that reads nothing sits in the first column, and each other
 * unit sits one column right of the deepest unit it reads. Two units that
 * read each other through different slots have no order between them, so
 * the units left over once every ordered unit is placed share the column
 * after the deepest one.
 *
 * Host-layer code: it reads the engine and the render layer through their
 * public surfaces, and touches no DOM.
 */
import { displayObjects, groupOf, type CameraState, type GraphObject, type Operation } from "./engine/index.ts";
import { groupBoundary, objectExtent, type WorldExtent } from "./render/extent.ts";
import { planMove } from "./render/interaction.ts";
import { objectWires } from "./render/wires.ts";

export type ArrangeMode = "flow" | "grid" | "tidy";
export type AlignEdge = "left" | "right" | "top" | "bottom" | "centerx" | "centery";
export type DistributeAxis = "x" | "y";

export interface ArrangePlan {
  readonly operations: readonly Operation[];
  /** The names of the units that moved. */
  readonly moved: readonly string[];
  /** The names of the units a formula held, wholly or in part. */
  readonly held: readonly string[];
}

interface Unit {
  readonly object: GraphObject;
  readonly box: WorldExtent;
}

/** The space between two columns of `arrange flow` and `arrange grid`, in world units. */
const COLUMN_GAP = 80;

/**
 * The space between two units stacked in one column, in world units. A name
 * label and the headers of a table draw above the box of their object, so
 * the gap leaves room for both.
 */
const ROW_GAP = 60;

/**
 * The units an arrangement moves. A selection of two or more objects names
 * them, with an object left out when a group around it is also selected.
 * Otherwise every unit on the canvas moves.
 */
export function arrangeUnits(objects: readonly GraphObject[], selectedIds: readonly string[]): readonly Unit[] {
  const shown = displayObjects(objects);
  const byId = new Map(shown.map((object) => [object.id, object]));
  const outermost = (object: GraphObject): GraphObject => {
    let current = object;
    for (let parent = groupOf(current); parent !== undefined; parent = groupOf(current)) {
      const group = byId.get(parent);
      if (group === undefined) break;
      current = group;
    }
    return current;
  };
  const chosen = selectedIds.length >= 2
    ? selectedIds.map((id) => byId.get(id)).filter((object): object is GraphObject => object !== undefined)
      .filter((object) => !hasSelectedAncestor(object, new Set(selectedIds), byId))
    : shown.filter((object) => groupOf(object) === undefined || byId.get(groupOf(object)!) === undefined).map(outermost);
  const units: Unit[] = [];
  const seen = new Set<string>();
  for (const object of chosen) {
    if (seen.has(object.id) || object.type === "doc" || object.type === "layer") continue;
    seen.add(object.id);
    const box = object.type === "group" ? groupBoundary(object, shown) : objectExtent(object);
    if (box !== undefined) units.push({ object, box });
  }
  return units;
}

function hasSelectedAncestor(object: GraphObject, selected: ReadonlySet<string>, byId: ReadonlyMap<string, GraphObject>): boolean {
  let parent = groupOf(object);
  while (parent !== undefined) {
    if (selected.has(parent)) return true;
    const group = byId.get(parent);
    parent = group === undefined ? undefined : groupOf(group);
  }
  return false;
}

/** Moves each unit so the top left corner of its box lands on its target. */
function planTargets(objects: readonly GraphObject[], placed: readonly { readonly unit: Unit; readonly x: number; readonly y: number }[]): ArrangePlan {
  const operations: Operation[] = [];
  const moved: string[] = [];
  const held: string[] = [];
  for (const { unit, x, y } of placed) {
    const deltaX = x - unit.box.minX;
    const deltaY = y - unit.box.minY;
    if (Math.abs(deltaX) < 1e-9 && Math.abs(deltaY) < 1e-9) continue;
    const plan = planMove(unit.object, objects, deltaX, deltaY);
    operations.push(...plan.operations);
    if (plan.operations.length > 0) moved.push(unit.object.name);
    if (plan.notices.length > 0) held.push(unit.object.name);
  }
  return { operations, moved, held };
}

export function planArrange(objects: readonly GraphObject[], selectedIds: readonly string[], mode: ArrangeMode, camera: CameraState): ArrangePlan {
  const units = arrangeUnits(objects, selectedIds);
  if (units.length === 0) return { operations: [], moved: [], held: [] };
  switch (mode) {
    case "flow":
      return planTargets(objects, columnsLayout(units, flowRanks(objects, units)));
    case "grid": {
      const columns = Math.ceil(Math.sqrt(units.length));
      return planTargets(objects, gridLayout(units, columns));
    }
    case "tidy": {
      const step = 10 ** Math.floor(Math.log10(80 / camera.zoom));
      const snap = (value: number): number => Math.round(value / step) * step;
      return planTargets(objects, units.map((unit) => ({ unit, x: snap(unit.box.minX), y: snap(unit.box.minY) })));
    }
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

/** The column of each unit for `arrange flow`, by unit ID. */
export function flowRanks(objects: readonly GraphObject[], units: readonly Unit[]): ReadonlyMap<string, number> {
  const unitIds = new Set(units.map((unit) => unit.object.id));
  const byId = new Map(objects.map((object) => [object.id, object]));
  const unitOf = (id: string): string | undefined => {
    let current = byId.get(id);
    while (current !== undefined && !unitIds.has(current.id)) {
      const parent = groupOf(current);
      current = parent === undefined ? undefined : byId.get(parent);
    }
    return current?.id;
  };
  const readers = new Map<string, Set<string>>();
  const sources = new Map<string, Set<string>>();
  for (const id of unitIds) {
    readers.set(id, new Set());
    sources.set(id, new Set());
  }
  for (const wire of objectWires(objects)) {
    const from = unitOf(wire.sourceId);
    const to = unitOf(wire.readerId);
    if (from === undefined || to === undefined || from === to) continue;
    readers.get(from)!.add(to);
    sources.get(to)!.add(from);
  }
  const ranks = new Map<string, number>();
  const waiting = new Map([...sources].map(([id, set]) => [id, set.size]));
  const ready = units.map((unit) => unit.object.id).filter((id) => waiting.get(id) === 0);
  for (const id of ready) ranks.set(id, 0);
  for (let index = 0; index < ready.length; index += 1) {
    const id = ready[index]!;
    for (const reader of readers.get(id)!) {
      ranks.set(reader, Math.max(ranks.get(reader) ?? 0, ranks.get(id)! + 1));
      const left = waiting.get(reader)! - 1;
      waiting.set(reader, left);
      if (left === 0) ready.push(reader);
    }
  }
  const ordered = new Set(ready);
  const deepest = Math.max(-1, ...ready.map((id) => ranks.get(id)!));
  for (const unit of units) {
    if (!ordered.has(unit.object.id)) ranks.set(unit.object.id, deepest + 1);
  }
  return ranks;
}

/** Units in columns by rank, from the top left of the boxes they cover now, in document order down each column. */
function columnsLayout(units: readonly Unit[], ranks: ReadonlyMap<string, number>): readonly { unit: Unit; x: number; y: number }[] {
  const left = Math.min(...units.map((unit) => unit.box.minX));
  const top = Math.min(...units.map((unit) => unit.box.minY));
  const columns = new Map<number, Unit[]>();
  for (const unit of units) {
    const rank = ranks.get(unit.object.id) ?? 0;
    const column = columns.get(rank);
    if (column === undefined) columns.set(rank, [unit]);
    else column.push(unit);
  }
  const placed: { unit: Unit; x: number; y: number }[] = [];
  let x = left;
  for (const rank of [...columns.keys()].sort((a, b) => a - b)) {
    const column = columns.get(rank)!;
    let y = top;
    for (const unit of column) {
      placed.push({ unit, x, y });
      y += height(unit.box) + ROW_GAP;
    }
    x += Math.max(...column.map((unit) => width(unit.box))) + COLUMN_GAP;
  }
  return placed;
}

/** Units in rows and columns in document order, each column as wide as its widest unit and each row as tall as its tallest. */
function gridLayout(units: readonly Unit[], columns: number): readonly { unit: Unit; x: number; y: number }[] {
  const left = Math.min(...units.map((unit) => unit.box.minX));
  const top = Math.min(...units.map((unit) => unit.box.minY));
  const columnWidths = Array.from({ length: columns }, (_unused, column) =>
    Math.max(0, ...units.filter((_unit, index) => index % columns === column).map((unit) => width(unit.box))));
  const rows = Math.ceil(units.length / columns);
  const rowHeights = Array.from({ length: rows }, (_unused, row) =>
    Math.max(0, ...units.slice(row * columns, row * columns + columns).map((unit) => height(unit.box))));
  return units.map((unit, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = left + columnWidths.slice(0, column).reduce((sum, value) => sum + value + ROW_GAP, 0);
    const y = top + rowHeights.slice(0, row).reduce((sum, value) => sum + value + ROW_GAP, 0);
    return { unit, x, y };
  });
}

/** Lines the selected units up on one edge or centre line of the box around all of them. */
export function planAlign(objects: readonly GraphObject[], selectedIds: readonly string[], edge: AlignEdge): ArrangePlan {
  const units = selectedIds.length >= 2 ? arrangeUnits(objects, selectedIds) : [];
  if (units.length < 2) return { operations: [], moved: [], held: [] };
  const minX = Math.min(...units.map((unit) => unit.box.minX));
  const maxX = Math.max(...units.map((unit) => unit.box.maxX));
  const minY = Math.min(...units.map((unit) => unit.box.minY));
  const maxY = Math.max(...units.map((unit) => unit.box.maxY));
  return planTargets(objects, units.map((unit) => {
    const { box } = unit;
    switch (edge) {
      case "left": return { unit, x: minX, y: box.minY };
      case "right": return { unit, x: maxX - width(box), y: box.minY };
      case "top": return { unit, x: box.minX, y: minY };
      case "bottom": return { unit, x: box.minX, y: maxY - height(box) };
      case "centerx": return { unit, x: (minX + maxX) / 2 - width(box) / 2, y: box.minY };
      case "centery": return { unit, x: box.minX, y: (minY + maxY) / 2 - height(box) / 2 };
      default: {
        const exhaustive: never = edge;
        return exhaustive;
      }
    }
  }));
}

/**
 * Spaces the selected units evenly along one axis. The first and the last, by
 * their centres, hold still, and the units between them move so every gap
 * between two neighbouring boxes is the same.
 */
export function planDistribute(objects: readonly GraphObject[], selectedIds: readonly string[], axis: DistributeAxis): ArrangePlan {
  const units = selectedIds.length >= 3 ? arrangeUnits(objects, selectedIds) : [];
  if (units.length < 3) return { operations: [], moved: [], held: [] };
  const low = (box: WorldExtent): number => (axis === "x" ? box.minX : box.minY);
  const size = (box: WorldExtent): number => (axis === "x" ? width(box) : height(box));
  const sorted = [...units].sort((a, b) => low(a.box) + size(a.box) / 2 - (low(b.box) + size(b.box) / 2));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = low(last.box) + size(last.box) - low(first.box);
  const gap = (span - sorted.reduce((sum, unit) => sum + size(unit.box), 0)) / (sorted.length - 1);
  let at = low(first.box);
  return planTargets(objects, sorted.map((unit) => {
    const position = at;
    at += size(unit.box) + gap;
    return axis === "x" ? { unit, x: position, y: unit.box.minY } : { unit, x: unit.box.minX, y: position };
  }));
}

function width(box: WorldExtent): number {
  return box.maxX - box.minX;
}

function height(box: WorldExtent): number {
  return box.maxY - box.minY;
}
