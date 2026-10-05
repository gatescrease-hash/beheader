/**
 * wires.ts
 *
 * The dependency overlay of section 19, as data: which curves there are, where
 * each one runs, and which curve a point lands on. renderer.ts draws what this
 * file places, and main.ts asks it which curve a click picked.
 *
 * A wire stands for one ordered pair of objects, from the object that is read
 * to the object that reads it, and carries every slot edge between the two. A
 * table of fifty cells that each read one variable is one wire with fifty
 * edges, because fifty curves between the same two boxes are no clearer than
 * one. An edge inside one object stays off the overlay.
 *
 * The document variables live on the holder of section 13, which has no place
 * on the canvas. A variable shows on the canvas through its copies, so an edge
 * that reads a variable runs from each copy of it, and an edge that writes a
 * variable runs to each copy. A variable with no copy stays off the overlay,
 * and the `vars` command still lists it. The edge from a variable to its own
 * copy is how the copy shows its value, so it stays off the overlay too.
 *
 * Each curve leaves the box of the object that is read where the line between
 * the two centres crosses that box, and arrives where the same line crosses
 * the box of the reader. Two boxes that overlap, such as a group and an object
 * inside it, have no such pair of crossings, so the curve runs straight from
 * centre to centre. Every curve bows a little to its left, so when two objects
 * read each other the two curves bow apart and stay distinct.
 *
 * Render-layer code: it reads engine state, and touches no DOM.
 */
import {
  addressKey,
  DOC_TYPE,
  DOCREF_TYPE,
  readEdges,
  type Edge,
  type GraphObject,
  type Point,
} from "../engine/index.ts";
import type { WorldExtent } from "./extent.ts";

export interface Wire {
  /** The object that is read. */
  readonly sourceId: string;
  /** The object that reads it. */
  readonly readerId: string;
  /** Every slot edge between the two, in the order the document lists them. */
  readonly edges: readonly Edge[];
}

const wiresMemo = new WeakMap<readonly GraphObject[], readonly Wire[]>();

/** Every wire of the document, one for each ordered pair of objects with an edge between them. */
export function objectWires(objects: readonly GraphObject[]): readonly Wire[] {
  const memo = wiresMemo.get(objects);
  if (memo !== undefined) return memo;

  const typeOf = new Map(objects.map((object) => [object.id, object.type]));
  const copiesOf = new Map<string, string[]>();
  for (const object of objects) {
    if (object.type !== DOCREF_TYPE || object.target === undefined) continue;
    const key = addressKey(object.target);
    const copies = copiesOf.get(key);
    if (copies === undefined) copiesOf.set(key, [object.id]);
    else copies.push(object.id);
  }
  const drawnAs = (address: Edge["sourceSlot"]): readonly string[] =>
    typeOf.get(address.objectId) === DOC_TYPE ? copiesOf.get(addressKey(address)) ?? [] : [address.objectId];

  const byPair = new Map<string, { sourceId: string; readerId: string; edges: Edge[] }>();
  for (const edge of readEdges(objects)) {
    if (typeOf.get(edge.dependentSlot.objectId) === DOCREF_TYPE) continue;
    for (const sourceId of drawnAs(edge.sourceSlot)) {
      for (const readerId of drawnAs(edge.dependentSlot)) {
        if (sourceId === readerId) continue;
        const key = `${sourceId} ${readerId}`;
        const wire = byPair.get(key);
        if (wire === undefined) byPair.set(key, { sourceId, readerId, edges: [edge] });
        else if (!wire.edges.some((known) => sameEdge(known, edge))) wire.edges.push(edge);
      }
    }
  }
  const wires = [...byPair.values()];
  wiresMemo.set(objects, wires);
  return wires;
}

function sameEdge(a: Edge, b: Edge): boolean {
  return addressKey(a.sourceSlot) === addressKey(b.sourceSlot) && addressKey(a.dependentSlot) === addressKey(b.dependentSlot);
}

export function wireKey(wire: Pick<Wire, "sourceId" | "readerId">): string {
  return `${wire.sourceId} ${wire.readerId}`;
}

/** One wire placed in world space as a cubic curve. */
export interface PlacedWire {
  readonly wire: Wire;
  readonly from: Point;
  readonly control1: Point;
  readonly control2: Point;
  readonly to: Point;
}

/** How far a curve bows from the straight line, as a share of its length. */
const BOW_SHARE = 0.12;

/** The most a curve bows, in world units, so a long wire stays close to its line. */
const BOW_LIMIT = 60;

/**
 * Places each wire whose two objects both have a box. A wire to an object with
 * no box, such as one on a hidden layer, is left out.
 */
export function placeWires(wires: readonly Wire[], boxOf: (objectId: string) => WorldExtent | undefined): readonly PlacedWire[] {
  const placed: PlacedWire[] = [];
  for (const wire of wires) {
    const source = boxOf(wire.sourceId);
    const reader = boxOf(wire.readerId);
    if (source === undefined || reader === undefined) continue;
    placed.push(placeOne(wire, source, reader));
  }
  return placed;
}

function placeOne(wire: Wire, source: WorldExtent, reader: WorldExtent): PlacedWire {
  const a = centre(source);
  const b = centre(reader);
  const overlapping = source.minX <= reader.maxX && reader.minX <= source.maxX && source.minY <= reader.maxY && reader.minY <= source.maxY;
  const from = overlapping ? a : boxExit(source, a, b);
  const to = overlapping ? b : boxExit(reader, b, a);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const bow = overlapping || length === 0 ? 0 : Math.min(BOW_LIMIT, length * BOW_SHARE);
  // The left normal of the direction of travel, so the reverse wire bows the other way.
  const nx = length === 0 ? 0 : dy / length;
  const ny = length === 0 ? 0 : -dx / length;
  return {
    wire,
    from,
    control1: { x: from.x + dx / 3 + nx * bow, y: from.y + dy / 3 + ny * bow },
    control2: { x: from.x + (2 * dx) / 3 + nx * bow, y: from.y + (2 * dy) / 3 + ny * bow },
    to,
  };
}

function centre(box: WorldExtent): Point {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/** Where the ray from the centre of the box towards the target leaves the box. */
function boxExit(box: WorldExtent, from: Point, toward: Point): Point {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const halfWidth = (box.maxX - box.minX) / 2;
  const halfHeight = (box.maxY - box.minY) / 2;
  const tx = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const t = Math.min(tx, ty, 1);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/** The point at a share t of the way along the curve. */
export function wirePoint(placed: PlacedWire, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * placed.from.x + b * placed.control1.x + c * placed.control2.x + d * placed.to.x,
    y: a * placed.from.y + b * placed.control1.y + c * placed.control2.y + d * placed.to.y,
  };
}

/** How many straight pieces stand for a curve when a point is measured against it. */
const HIT_SEGMENTS = 24;

/**
 * The wire nearest the point within the tolerance, measured in world units,
 * or undefined. The middle of a wire with more than one edge also answers
 * within the radius of its count, so a click on the count picks the wire.
 */
export function wireAt(placed: readonly PlacedWire[], point: Point, tolerance: number, countRadius = tolerance): PlacedWire | undefined {
  let best: PlacedWire | undefined;
  let bestDistance = Infinity;
  for (const candidate of placed) {
    let distance = Infinity;
    let previous = candidate.from;
    for (let index = 1; index <= HIT_SEGMENTS; index += 1) {
      const next = wirePoint(candidate, index / HIT_SEGMENTS);
      distance = Math.min(distance, segmentDistance(point, previous, next));
      previous = next;
    }
    if (candidate.wire.edges.length > 1) {
      const middle = wirePoint(candidate, 0.5);
      if (Math.hypot(point.x - middle.x, point.y - middle.y) <= countRadius) distance = 0;
    }
    if (distance <= tolerance && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * The ring a refused cycle names, as object pairs to draw. Consecutive slots
 * on different objects make one pair each, and the last slot closes the ring
 * back to the first. A ring inside one object leaves the list of pairs empty,
 * and the caller outlines that object instead. A slot on an object the committed document
 * lacks, such as one a refused batch would have created, drops out.
 */
export function cycleRing(cycle: readonly Edge["sourceSlot"][], objects: readonly GraphObject[]): { readonly pairs: readonly Pick<Wire, "sourceId" | "readerId">[]; readonly objectIds: readonly string[] } {
  const present = new Set(objects.map((object) => object.id));
  const ids = cycle.map((address) => address.objectId).filter((id) => present.has(id));
  const pairs: Pick<Wire, "sourceId" | "readerId">[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < ids.length; index += 1) {
    const sourceId = ids[index]!;
    const readerId = ids[(index + 1) % ids.length]!;
    const key = `${sourceId} ${readerId}`;
    if (sourceId === readerId || seen.has(key)) continue;
    seen.add(key);
    pairs.push({ sourceId, readerId });
  }
  return { pairs, objectIds: [...new Set(ids)] };
}
