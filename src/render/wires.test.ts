/**
 * wires.test.ts
 *
 * These tests cover the wire model: one wire for each ordered pair of objects
 * with the count of slot edges behind it, the copies that stand for a document
 * variable, the curve geometry, picking a curve, and the ring of a refused
 * cycle.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type Document, type EvalContext, type GraphObject } from "../engine/index.ts";
import { executeCommand, isCommandFailure } from "../command/commands.ts";
import { isCommandParseFailure, parseCommand } from "../command/parser.ts";
import { cycleRing, objectWires, placeWires, wireAt, wirePoint, type Wire } from "./wires.ts";

const CONTEXT: EvalContext = { measurer: { measure: (text: string) => ({ width: text.length * 8, height: 20 }) } };

function built(lines: readonly string[]): Document {
  let document = createEmptyDocument();
  for (const line of lines) {
    const parsed = parseCommand(line);
    if (isCommandParseFailure(parsed)) throw new Error(`"${line}" did not parse: ${parsed.message}`);
    const outcome = executeCommand(parsed.command, document, CONTEXT);
    if (isCommandFailure(outcome)) throw new Error(`"${line}" refused: ${outcome.message}`);
    document = outcome.document;
  }
  return document;
}

/** Each wire as "source > reader ×count", by name. */
function described(document: Document): readonly string[] {
  const name = (id: string): string => document.objects.find((object) => object.id === id)?.name ?? id;
  return objectWires(document.objects).map((wire) => `${name(wire.sourceId)} > ${name(wire.readerId)} ×${wire.edges.length}`).sort();
}

describe("objectWires", () => {
  it("draws one wire for each ordered pair of objects, counting the slot edges behind it", () => {
    const document = built([
      "table x=0 y=0",
      "set table_1.A1 3",
      "circle x=300 y=0 r=10",
      "set circle_1.radius = table_1.A1 + table_1.A1 * 2",
      "set circle_1.origin.x = table_1.A1",
      "set circle_1.origin.y = table_1.B1",
      "set table_1.C1 = circle_1.area",
    ]);
    expect(described(document)).toEqual(["circle_1 > table_1 ×1", "table_1 > circle_1 ×3"]);
  });

  it("runs a variable's wires from each copy of it, with no wire from a variable to its own copy", () => {
    const document = built([
      "docvar speed 12 x=0 y=0",
      "docvar speed x=0 y=100",
      "circle x=300 y=0 r=10",
      "set circle_1.radius = doc.speed",
      "docvar lonely 1",
      "circle x=300 y=200 r=10",
      "set circle_2.radius = doc.lonely",
    ]);
    expect(described(document)).toEqual(["docref_1 > circle_1 ×1", "docref_2 > circle_1 ×1"]);
  });

  it("draws the wires of a text box and of a script input as it does a formula", () => {
    const document = built([
      "circle x=0 y=0 r=10",
      'text x=300 y=0 "r = {= circle_1.radius}"',
      "script x=0 y=300",
      "addport script_1.in.r",
      "link script_1.in.r circle_1.radius",
    ]);
    expect(described(document)).toEqual(["circle_1 > script_1 ×1", "circle_1 > text_1 ×1"]);
  });

  it("draws a wire into an empty table cell's reader, as the graph queries see it", () => {
    const document = built(["table x=0 y=0", "circle x=300 y=0 r=10", "set circle_1.radius = table_1.B2"]);
    expect(described(document)).toEqual(["table_1 > circle_1 ×1"]);
  });

  it("answers the same list for the same object list, so painting derives it once", () => {
    const document = built(["circle x=0 y=0 r=10", "circle x=300 y=0 r=10", "set circle_2.radius = circle_1.radius"]);
    expect(objectWires(document.objects)).toBe(objectWires(document.objects));
  });
});

const BOXES = {
  a: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
  b: { minX: 300, minY: 0, maxX: 400, maxY: 50 },
  inner: { minX: 20, minY: 10, maxX: 40, maxY: 30 },
};

function wire(sourceId: keyof typeof BOXES, readerId: keyof typeof BOXES, edges = 1): Wire {
  const edge = { sourceSlot: { objectId: sourceId, path: ["x"] }, dependentSlot: { objectId: readerId, path: ["y"] } };
  return { sourceId, readerId, edges: Array.from({ length: edges }, () => edge) };
}

describe("placeWires and wireAt", () => {
  it("runs from the edge of the source box to the edge of the reader box", () => {
    const [placed] = placeWires([wire("a", "b")], (id) => BOXES[id as keyof typeof BOXES]);
    expect(placed!.from).toEqual({ x: 100, y: 25 });
    expect(placed!.to).toEqual({ x: 300, y: 25 });
  });

  it("bows the two wires of objects that read each other to opposite sides", () => {
    const [ab, ba] = placeWires([wire("a", "b"), wire("b", "a")], (id) => BOXES[id as keyof typeof BOXES]);
    const sideOf = (y: number): number => Math.sign(y - 25);
    expect(sideOf(wirePoint(ab!, 0.5).y)).toBe(-sideOf(wirePoint(ba!, 0.5).y));
    expect(sideOf(wirePoint(ab!, 0.5).y)).not.toBe(0);
  });

  it("runs straight from centre to centre between boxes that overlap, and leaves out an object with no box", () => {
    const placed = placeWires([wire("inner", "a"), wire("a", "b")], (id) => (id === "b" ? undefined : BOXES[id as keyof typeof BOXES]));
    expect(placed).toHaveLength(1);
    expect(placed[0]!.from).toEqual({ x: 30, y: 20 });
    expect(placed[0]!.to).toEqual({ x: 50, y: 25 });
    expect(wirePoint(placed[0]!, 0.5)).toEqual({ x: 40, y: 22.5 });
  });

  it("picks the wire under a point within the tolerance, and the count of a wire with many edges", () => {
    const placed = placeWires([wire("a", "b", 3)], (id) => BOXES[id as keyof typeof BOXES]);
    const middle = wirePoint(placed[0]!, 0.5);
    expect(wireAt(placed, { x: middle.x, y: middle.y + 3 }, 4)?.wire.sourceId).toBe("a");
    expect(wireAt(placed, { x: middle.x, y: middle.y + 30 }, 4)).toBeUndefined();
    expect(wireAt(placed, { x: middle.x + 8, y: middle.y }, 1, 10)?.wire.sourceId).toBe("a");
  });
});

describe("cycleRing", () => {
  it("draws the ring between objects in reading order, and names the objects for a ring inside one", () => {
    const objects = [{ id: "p" }, { id: "q" }] as unknown as readonly GraphObject[];
    const across = cycleRing([{ objectId: "p", path: ["a"] }, { objectId: "p", path: ["b"] }, { objectId: "q", path: ["c"] }], objects);
    expect(across.pairs).toEqual([{ sourceId: "p", readerId: "q" }, { sourceId: "q", readerId: "p" }]);
    const inside = cycleRing([{ objectId: "p", path: ["a"] }, { objectId: "p", path: ["b"] }], objects);
    expect(inside.pairs).toEqual([]);
    expect(inside.objectIds).toEqual(["p"]);
    const missing = cycleRing([{ objectId: "p", path: ["a"] }, { objectId: "gone", path: ["b"] }], objects);
    expect(missing.objectIds).toEqual(["p"]);
  });
});
