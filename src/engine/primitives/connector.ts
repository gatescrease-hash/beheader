/**
 * connector.ts
 *
 * The slots of a connector, and the rule that turns its two ends into the line
 * the canvas draws.
 *
 * A connector is an object with no position of its own. Its `from` and `to`
 * slots each hold a formula, such as `= rect_1.box`, so each end is an edge of
 * the graph and a move of either object redraws the line through ordinary
 * evaluation. An end
 * holds either a box, as two corner points, or one point, which is a free end
 * the line runs to exactly.
 *
 * The line runs from the centre of one box toward the centre of the other, and
 * each end is cut where the line leaves its own box, so the line meets each box
 * at its edge rather than running under the object. Two boxes that overlap
 * leave the connector with no line, because no part of the line runs outside
 * both.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import type { Address } from "../address.ts";
import type { FormulaAst } from "../formula/ast.ts";
import { isErrorValue, type ErrorValue, type GraphObject, type Point, type Value } from "../graph/node.ts";
import { BOX_PATH, VERTICES_PATH } from "./geometry.ts";
import type { DerivedSlotSchema } from "./schema.ts";

export const CONNECTOR_FROM_PATH: readonly string[] = ["from"];
export const CONNECTOR_TO_PATH: readonly string[] = ["to"];
export const CONNECTOR_ARROW_PATH: readonly string[] = ["arrow"];

/** Where a connector draws an arrowhead: at the end it points to, at the start, at both, or at neither. */
export const CONNECTOR_ARROWS = ["end", "start", "both", "none"] as const;
export type ConnectorArrow = (typeof CONNECTOR_ARROWS)[number];

/** A new connector points at its second object, because a diagram reads a line with one head as a direction. */
export const DEFAULT_CONNECTOR_ARROW: ConnectorArrow = "end";

/** The stroke of a new connector, the dark ink the shapes draw in. */
export const DEFAULT_CONNECTOR_STROKE = "#1a1a1a";
export const DEFAULT_CONNECTOR_STROKE_WIDTH = 1.5;

/** One end of a connector: a box to leave from, or a point to stop at. */
type ConnectorEnd =
  | { readonly kind: "box"; readonly min: Point; readonly max: Point }
  | { readonly kind: "point"; readonly point: Point };

function isFinitePoint(value: unknown): value is Point {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as Point).x === "number" && typeof (value as Point).y === "number"
    && Number.isFinite((value as Point).x) && Number.isFinite((value as Point).y);
}

/**
 * Reads one end. Null, which an object with no box holds, leaves the
 * connector with no end and so with no line. An error passes through, so the line reports what broke upstream.
 */
function readEnd(value: Value | undefined, label: string): ConnectorEnd | ErrorValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (isErrorValue(value)) {
    return value;
  }
  if (Array.isArray(value) && value.length === 2 && isFinitePoint(value[0]) && isFinitePoint(value[1])) {
    const [a, b] = value as readonly Point[];
    return { kind: "box", min: { x: Math.min(a!.x, b!.x), y: Math.min(a!.y, b!.y) }, max: { x: Math.max(a!.x, b!.x), y: Math.max(a!.y, b!.y) } };
  }
  if (isFinitePoint(value)) {
    return { kind: "point", point: value };
  }
  return { error: "#TYPE", message: `${label} must hold a box, such as rect_1.box, or a point` };
}

function centreOf(end: ConnectorEnd): Point {
  return end.kind === "point" ? end.point : { x: (end.min.x + end.max.x) / 2, y: (end.min.y + end.max.y) / 2 };
}

/**
 * Where a line from the centre of an end toward a target leaves the end's box,
 * or undefined when the target lies inside the box, so the line never leaves
 * it. A free end gives its own point.
 */
function exitPoint(end: ConnectorEnd, target: Point): Point | undefined {
  if (end.kind === "point") {
    return end.point;
  }
  const centre = centreOf(end);
  const dx = target.x - centre.x;
  const dy = target.y - centre.y;
  const halfWidth = (end.max.x - end.min.x) / 2;
  const halfHeight = (end.max.y - end.min.y) / 2;
  const reach = Math.min(dx === 0 ? Infinity : halfWidth / Math.abs(dx), dy === 0 ? Infinity : halfHeight / Math.abs(dy));
  if (!(reach < 1)) {
    return undefined;
  }
  return { x: centre.x + dx * reach, y: centre.y + dy * reach };
}

/** Zero for a negative zero, which is not legal document state. */
function plainPoint(point: Point): Point {
  return { x: point.x === 0 ? 0 : point.x, y: point.y === 0 ? 0 : point.y };
}

/**
 * The two points a connector's line runs between, or null where there is no
 * line to draw: an end with no box, two ends at one centre, or two boxes that
 * overlap so far that no part of the line runs outside both.
 */
export function connectorLine(from: Value | undefined, to: Value | undefined, label = "connector"): readonly Point[] | ErrorValue | null {
  const start = readEnd(from, `${label}.from`);
  if (start !== undefined && "error" in start) {
    return start;
  }
  const end = readEnd(to, `${label}.to`);
  if (end !== undefined && "error" in end) {
    return end;
  }
  if (start === undefined || end === undefined) {
    return null;
  }
  const startCentre = centreOf(start);
  const endCentre = centreOf(end);
  if (startCentre.x === endCentre.x && startCentre.y === endCentre.y) {
    return null;
  }
  const leave = exitPoint(start, endCentre);
  const arrive = exitPoint(end, startCentre);
  if (leave === undefined || arrive === undefined) {
    return null;
  }
  // The two cut points pass each other where the boxes overlap along the line.
  const along = (arrive.x - leave.x) * (endCentre.x - startCentre.x) + (arrive.y - leave.y) * (endCentre.y - startCentre.y);
  if (!(along > 0)) {
    return null;
  }
  return [plainPoint(leave), plainPoint(arrive)];
}

/** The derived `vertices` of a connector, the two points its line runs between. */
export const CONNECTOR_DERIVED_SLOTS: readonly DerivedSlotSchema[] = [
  {
    path: VERTICES_PATH,
    dependencies: { kind: "static", paths: [CONNECTOR_FROM_PATH, CONNECTOR_TO_PATH] },
    compute: (object, read) => connectorLine(
      read({ objectId: object.id, path: CONNECTOR_FROM_PATH }),
      read({ objectId: object.id, path: CONNECTOR_TO_PATH }),
      object.name,
    ),
  },
];

/** The formula an end holds to follow the box of an object. */
export function boxReference(objectId: string): FormulaAst {
  return { type: "reference", address: { objectId, path: BOX_PATH } };
}

/** The object whose box an end follows, where the end's formula is that box and nothing else. */
export function connectorEndTarget(connector: GraphObject, path: readonly string[]): string | undefined {
  const slot = connector.slots[path.join(".")];
  if (slot?.kind !== "formula" || slot.ast.type !== "reference") {
    return undefined;
  }
  const address: Address = slot.ast.address;
  return address.path.length === 1 && address.path[0] === BOX_PATH[0] ? address.objectId : undefined;
}

/**
 * The connectors that a delete of these objects takes along: each with an end
 * that reads the box of one of them and nothing else, because a connector to
 * nothing is no part of a diagram. A connector already in the set is left out.
 */
export function attachedConnectors(objects: readonly GraphObject[], leaving: ReadonlySet<string>): readonly GraphObject[] {
  return objects.filter((object) => object.type === "connector" && !leaving.has(object.id)
    && [CONNECTOR_FROM_PATH, CONNECTOR_TO_PATH].some((path) => leaving.has(connectorEndTarget(object, path) ?? "")));
}
