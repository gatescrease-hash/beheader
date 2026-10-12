import { describe, expect, it } from "vitest";
import { executeCommand } from "../../command/commands.ts";
import { parseCommand } from "../../command/parser.ts";
import { createEmptyDocument, type Document } from "../document.ts";
import type { EvalContext } from "../eval-context.ts";
import type { GraphObject, Value } from "../graph/node.ts";
import { mutate } from "../mutation.ts";
import { attachedConnectors, connectorLine } from "./connector.ts";

const box = (minX: number, minY: number, maxX: number, maxY: number): Value => [{ x: minX, y: minY }, { x: maxX, y: maxY }];

describe("connectorLine — from one box to another, cut at each edge", () => {
  it("runs between the facing edges of two boxes side by side", () => {
    expect(connectorLine(box(0, 0, 10, 10), box(100, 0, 110, 10))).toEqual([{ x: 10, y: 5 }, { x: 100, y: 5 }]);
  });

  it("leaves a box through the edge the line from centre to centre crosses, on a diagonal too", () => {
    const line = connectorLine(box(0, 0, 20, 20), box(100, 100, 120, 120)) as readonly { x: number; y: number }[];
    expect(line[0]).toEqual({ x: 20, y: 20 });
    expect(line[1]).toEqual({ x: 100, y: 100 });
  });

  it("stops exactly at a free end, so a point holds the line where it is", () => {
    expect(connectorLine(box(0, 0, 10, 10), { x: 50, y: 5 })).toEqual([{ x: 10, y: 5 }, { x: 50, y: 5 }]);
    expect(connectorLine({ x: -20, y: 5 }, { x: 50, y: 5 })).toEqual([{ x: -20, y: 5 }, { x: 50, y: 5 }]);
  });

  it("draws no line between two boxes that overlap, nor from a box to a point inside it", () => {
    expect(connectorLine(box(0, 0, 50, 50), box(40, 10, 90, 40))).toBeNull();
    expect(connectorLine(box(0, 0, 50, 50), { x: 10, y: 10 })).toBeNull();
    expect(connectorLine(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBeNull();
  });

  it("draws no line where an end holds null, which an object with no box gives", () => {
    expect(connectorLine(null, box(0, 0, 10, 10))).toBeNull();
  });

  it("passes an error on, and names an end that holds something other than a box or a point", () => {
    expect(connectorLine({ error: "#REF", message: "gone" }, box(0, 0, 1, 1))).toEqual({ error: "#REF", message: "gone" });
    expect(connectorLine(box(0, 0, 1, 1), 7, "connector_1")).toMatchObject({ error: "#TYPE", message: expect.stringContaining("connector_1.to") });
  });
});

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

describe("a connector in the graph", () => {
  it("follows a move of either object through ordinary evaluation", () => {
    const document = run(["rect x=0 y=0 w=10 h=10", "rect x=100 y=0 w=10 h=10", "connect rect_1 rect_2"]);
    expect(named(document, "connector_1").slots.vertices?.value).toEqual([{ x: 10, y: 5 }, { x: 100, y: 5 }]);
    const moved = run(["set rect_2.origin.y 100"], document);
    expect(named(moved, "connector_1").slots.vertices?.value).toEqual([{ x: 10, y: 10 }, { x: 100, y: 100 }]);
  });

  it("finds the connectors a delete takes along: an end that reads the box and nothing else", () => {
    const document = run(["rect x=0 y=0 w=10 h=10", "rect x=100 y=0 w=10 h=10", "circle x=300 y=0 r=5", "connect rect_1 rect_2", "connect rect_2 circle_1", "connect 0,200 circle_1"]);
    const ids = (names: readonly string[]) => new Set(names.map((name) => named(document, name).id));
    expect(attachedConnectors(document.objects, ids(["rect_1"])).map((object) => object.name)).toEqual(["connector_1"]);
    expect(attachedConnectors(document.objects, ids(["rect_2"])).map((object) => object.name)).toEqual(["connector_1", "connector_2"]);
    expect(attachedConnectors(document.objects, ids(["circle_1", "connector_3"])).map((object) => object.name)).toEqual(["connector_2"]);
  });

  it("leaves out a connector whose end reads more than the box, which a delete then refuses by name", () => {
    const document = run(["rect x=0 y=0 w=10 h=10", "rect x=100 y=0 w=10 h=10", "connect rect_1 rect_2"]);
    const connector = named(document, "connector_1");
    const rect = named(document, "rect_1");
    const rewritten = mutate(document.objects, [{ kind: "setSlot", address: { objectId: connector.id, path: ["from"] }, slot: {
      kind: "formula", ast: { type: "functionCall", name: "IF", args: [{ type: "literal", value: true }, { type: "reference", address: { objectId: rect.id, path: ["box"] } }, { type: "literal", value: 0 }] }, value: null,
    } }], document.journal, context);
    if (!rewritten.ok) throw new Error(rewritten.message);
    expect(attachedConnectors(rewritten.objects, new Set([rect.id]))).toEqual([]);
  });
});
