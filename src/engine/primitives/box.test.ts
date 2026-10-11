import { describe, expect, it } from "vitest";
import { executeCommand } from "../../command/commands.ts";
import { parseCommand } from "../../command/parser.ts";
import { createEmptyDocument, loadDocument, saveDocument, type Document } from "../document.ts";
import type { EvalContext } from "../eval-context.ts";
import type { GraphObject, Value } from "../graph/node.ts";
import { startUndoHistory } from "../journal.ts";
import { mutate } from "../mutation.ts";
import { boxValue, objectBox } from "./box.ts";

/** A measurer that gives each character eight units and each line twenty, so a text box has a size to check. */
const context: EvalContext = { measurer: { measure: (text: string) => ({ width: text.length * 8, height: 20 }) } };

function run(lines: readonly string[], start: Document = createEmptyDocument()): Document {
  let document = start;
  for (const line of lines) {
    const parsed = parseCommand(line);
    if (!parsed.ok) throw new Error(`test setup: ${line}: ${parsed.message}`);
    const result = executeCommand(parsed.command, document, context);
    if (!result.ok) throw new Error(`test setup: ${line}: ${result.message}`);
    document = result.document;
  }
  return document;
}

function named(document: Document, name: string): GraphObject {
  const object = document.objects.find((candidate) => candidate.name === name);
  if (object === undefined) throw new Error(`test setup: no object named ${name}`);
  return object;
}

function boxOf(document: Document, name: string): Value | undefined {
  return named(document, name).slots.box?.value;
}

const corners = (minX: number, minY: number, maxX: number, maxY: number): Value => [{ x: minX, y: minY }, { x: maxX, y: maxY }];

describe("the derived box — one rule for every object with a place", () => {
  it("gives each shape the box of its outline, a polygon's from its vertices and a circle's from its radius", () => {
    const document = run(["circle x=100 y=50 r=20", "rect x=10 y=20 w=30 h=40", "polygon sides=4 x=0 y=0 r=10"]);
    expect(boxOf(document, "circle_1")).toEqual(corners(80, 30, 120, 70));
    expect(boxOf(document, "rect_1")).toEqual(corners(10, 20, 40, 60));
    const square = boxOf(document, "polygon_1") as readonly { x: number; y: number }[];
    expect(square[0]!.x).toBeCloseTo(-10);
    expect(square[1]!.y).toBeCloseTo(10);
  });

  it("takes a path's box from its edges, so an arc that bows past its two ends is inside it", () => {
    const document = run(["polyline 0,0 40,0", "edgetype polyline_1 0 arc"]);
    const box = boxOf(document, "polyline_1") as readonly { x: number; y: number }[];
    expect(box[0]!.x).toBe(0);
    expect(box[1]!.x).toBe(40);
    expect(Math.max(Math.abs(box[0]!.y), Math.abs(box[1]!.y))).toBeGreaterThan(0);
  });

  it("sizes a table from its rows and columns, and a column's own width widens it", () => {
    const document = run(["table x=0 y=0 rows=2 cols=3"]);
    expect(boxOf(document, "table_1")).toEqual(corners(0, 0, 240, 48));
    // A drag on a column's edge writes the column's first width, which is how the slot comes to exist.
    const widened = mutate(document.objects, [{ kind: "setSlot", address: { objectId: named(document, "table_1").id, path: ["columns", "2", "width"] }, slot: { kind: "literal", value: 120 } }], document.journal, context);
    if (!widened.ok) throw new Error(widened.message);
    const wider: Document = { ...document, objects: widened.objects, journal: widened.journal };
    expect(boxOf(wider, "table_1")).toEqual(corners(0, 0, 280, 48));
    const taller = run(["set table_1.rows 4"], wider);
    expect(boxOf(taller, "table_1")).toEqual(corners(0, 0, 280, 96));
  });

  it("sizes a text by the measured size of what it shows, and a text with nothing in it has no box", () => {
    const document = run(['text x=10 y=10 "hello"']);
    expect(boxOf(document, "text_1")).toEqual(corners(10, 10, 50, 30));
    const empty = run(['set text_1.content ""'], document);
    expect(boxOf(empty, "text_1")).toBeNull();
  });

  it("grows a script node with its rows of ports", () => {
    const document = run(["script x=0 y=0"]);
    expect(boxOf(document, "script_1")).toEqual(corners(0, 0, 200, 42));
    const ported = run(["addport script_1.in.a", "addport script_1.in.b"], document);
    expect(boxOf(ported, "script_1")).toEqual(corners(0, 0, 200, 60));
  });

  it("gives an image, a slider and a frame the box of their size from the origin", () => {
    const document = run(["image x=5 y=5", "slider x=0 y=200", "frame x=0 y=400 w=300 h=100"]);
    expect(boxOf(document, "image_1")).toEqual(corners(5, 5, 105, 105));
    expect(boxOf(document, "slider_1")).toEqual(corners(0, 200, 200, 232));
    expect(boxOf(document, "frame_1")).toEqual(corners(0, 400, 300, 500));
  });

  it("gives a copy of a variable its measured box, and a math object none until its notation is measured", () => {
    const document = run(["docvar speed 12 x=0 y=0", 'math x=0 y=100 "y=2"']);
    const copy = document.objects.find((object) => object.type === "docref")!;
    const box = copy.slots.box?.value as readonly { x: number; y: number }[];
    expect(box[0]).toEqual({ x: 0, y: 0 });
    expect(box[1]!.x).toBeGreaterThan(0);
    expect(boxOf(document, "math_1")).toBeNull();
    const math = named(document, "math_1");
    const read = (path: readonly string[]) => ({ "origin.x": 0, "origin.y": 100, measuredWidth: 30, measuredHeight: 20 } as Record<string, Value>)[path.join(".")];
    expect(boxValue(objectBox(math, read))).toEqual(corners(0, 100, 30, 120));
  });

  it("gives a group no box at all, because its boundary comes from a scan of its members", () => {
    const document = run(["rect x=0 y=0 w=10 h=10", "group rect_1"]);
    expect(named(document, "group_1").slots.box).toBeUndefined();
  });

  it("follows a move, so a formula that reads the box reads the new place", () => {
    const document = run(["rect x=0 y=0 w=10 h=10", "docvar corners =rect_1.box"]);
    const rect = named(document, "rect_1");
    const moved = mutate(document.objects, [{ kind: "setSlot", address: { objectId: rect.id, path: ["origin", "x"] }, slot: { kind: "literal", value: 50 } }], document.journal, context);
    if (!moved.ok) throw new Error(moved.message);
    expect(moved.objects.find((object) => object.id === rect.id)?.slots.box?.value).toEqual(corners(50, 0, 60, 10));
    expect(moved.objects.find((object) => object.type === "doc")?.slots.corners?.value).toEqual(corners(50, 0, 60, 10));
  });

  it("holds null rather than a box for a size that is not a number, and no negative zero", () => {
    const frame: GraphObject = { id: "f", name: "frame_1", type: "frame", slots: {} };
    const read = (values: Record<string, Value>) => (path: readonly string[]) => values[path.join(".")];
    expect(boxValue(objectBox(frame, read({ "origin.x": 0, "origin.y": 0, width: "wide", height: 10 })))).toBeNull();
    expect(boxValue(objectBox(frame, read({ "origin.x": -0, "origin.y": 0, width: 10, height: 10 })))).toEqual(corners(0, 0, 10, 10));
    expect(Object.is((boxValue({ minX: -0, minY: 0, maxX: 1, maxY: 1 }) as readonly { x: number }[])[0]!.x, -0)).toBe(false);
  });
});

/** The saved form of a document with every `box` slot taken out, which is what a build from before the box saved. */
function withoutBoxes(json: string): string {
  const raw = JSON.parse(json) as { objects: { slots: Record<string, unknown> }[]; journal: { operations: { kind: string; object?: { slots: Record<string, unknown> } }[] }[] };
  for (const object of raw.objects) delete object.slots.box;
  for (const entry of raw.journal) {
    for (const operation of entry.operations) {
      if (operation.object !== undefined) delete operation.object.slots.box;
    }
  }
  return JSON.stringify(raw);
}

describe("a document from before the box", () => {
  it("loads, fills each box, and keeps an undo history that reaches back to the empty document", () => {
    const document = run(["rect x=0 y=0 w=10 h=10", "table x=100 y=0 rows=2 cols=2", 'text x=0 y=100 "note"', "script x=300 y=0"]);
    const old = withoutBoxes(saveDocument(document));
    expect(old).not.toContain('"box"');

    const loaded = loadDocument(old, context);
    if (!loaded.ok) throw new Error(loaded.message);
    expect(boxOf(loaded.document, "rect_1")).toEqual(corners(0, 0, 10, 10));
    expect(boxOf(loaded.document, "table_1")).toEqual(corners(100, 0, 260, 48));

    const history = startUndoHistory(loaded.document.objects, loaded.document.journal, context);
    expect(history.floor).toBe(0);
  });

  it("still refuses a fresh object created with its box missing, because mutate stays strict", () => {
    const result = mutate([], [{ kind: "createObject", object: { id: "r", name: "rect_1", type: "frame", slots: {
      "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 }, width: { kind: "literal", value: 1 }, height: { kind: "literal", value: 1 },
      "style.fillColor": { kind: "literal", value: null }, "style.strokeColor": { kind: "literal", value: null },
    } } }], []);
    expect(result.ok === false && result.message).toContain("box is missing");
  });
});
