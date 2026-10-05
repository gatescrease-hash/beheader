/**
 * queries.test.ts
 *
 * These tests cover the graph queries through the command line, against one
 * chain: a document variable feeds a table cell, the cell feeds the radius of
 * a circle, and the radius feeds the content of a text box. A polygon stands
 * apart from the chain, and a second circle divides by zero.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type Document, type EvalContext } from "../engine/index.ts";
import { executeCommand, isCommandFailure, type CommandOutcome } from "./commands.ts";
import { isCommandParseFailure, parseCommand } from "./parser.ts";

/** A measurer of fixed width per character, so a text box measures with no #MEASURE error. */
const CONTEXT: EvalContext = { measurer: { measure: (text: string) => ({ width: text.length * 8, height: 20 }) } };

function run(line: string, document: Document): CommandOutcome {
  const parsed = parseCommand(line);
  if (isCommandParseFailure(parsed)) throw new Error(`"${line}" did not parse: ${parsed.message}`);
  return executeCommand(parsed.command, document, CONTEXT);
}

function committed(lines: readonly string[]): Document {
  let document = createEmptyDocument();
  for (const line of lines) {
    const outcome = run(line, document);
    if (isCommandFailure(outcome)) throw new Error(`"${line}" refused: ${outcome.message}`);
    document = outcome.document;
  }
  return document;
}

const CHAIN = committed([
  "docvar speed 12",
  "table x=0 y=0",
  "set table_1.A1 = doc.speed * 2",
  "circle x=200 y=0 r=10",
  "link circle_1.radius table_1.A1",
  'text x=400 y=0 "label {= circle_1.radius + 1}"',
  "polygon sides=5 x=0 y=300 r=40",
  "circle x=200 y=300 r=10",
  "set circle_2.radius = 1 / 0",
]);

/** The names a query selected, in the order it gave them. */
function selected(line: string, document: Document = CHAIN): readonly string[] {
  const outcome = run(line, document);
  if (isCommandFailure(outcome)) throw new Error(`"${line}" refused: ${outcome.message}`);
  if (outcome.effect?.kind !== "select") throw new Error(`"${line}" left no selection`);
  return outcome.effect.objectIds.map((id) => document.objects.find((object) => object.id === id)?.name ?? id);
}

function lines(line: string, document: Document = CHAIN): readonly string[] {
  const outcome = run(line, document);
  if (isCommandFailure(outcome)) throw new Error(`"${line}" refused: ${outcome.message}`);
  return outcome.lines;
}

describe("upstream and downstream", () => {
  it("walk the chain in both directions, nearest first, and leave the start out", () => {
    expect(selected("upstream text_1")).toEqual(["circle_1", "table_1", "doc"]);
    expect(selected("downstream table_1")).toEqual(["circle_1", "text_1"]);
    expect(selected("downstream doc.speed")).toEqual(["table_1", "circle_1", "text_1"]);
  });

  it("stop at the depth, counted in steps from one object to the next", () => {
    expect(selected("upstream text_1 1")).toEqual(["circle_1"]);
    expect(selected("upstream text_1 2")).toEqual(["circle_1", "table_1"]);
    expect(selected("downstream doc.speed 1")).toEqual(["table_1"]);
  });

  it("count no step for an edge inside one object, such as a radius that drives the vertices", () => {
    const derived = committed([
      "table x=0 y=0",
      "set table_1.A1 3",
      "polygon sides=5 x=0 y=300 r=40",
      "link polygon_1.radius table_1.A1",
      'text x=0 y=0 "{= polygon_1.vertices}"',
    ]);
    expect(selected("upstream text_1 1", derived)).toEqual(["polygon_1"]);
    expect(selected("upstream text_1 2", derived)).toEqual(["polygon_1", "table_1"]);
  });

  it("follow one slot when the start is an address, through the derived slots of its own object", () => {
    expect(selected("downstream circle_1.radius")).toEqual(["text_1"]);
    expect(selected("downstream circle_1.origin.x")).toEqual([]);
    expect(selected("upstream circle_1.origin.x")).toEqual([]);
  });

  it("names every slot downstream that a delete without force refuses with, empty cells included", () => {
    expect(lines("downstream table_1")[0]).toBe("read directly by circle_1.radius");
    const many = committed([
      "table x=0 y=0",
      "circle x=0 y=0 r=1",
      "set circle_1.radius = table_1.A1",
      "set circle_1.origin.x = SUM(table_1.B1:table_1.B2)",
      'text x=0 y=0 "{= table_1.A1}"',
    ]);
    const named = lines("downstream table_1", many)[0]!.replace("read directly by ", "").split(", ").sort();
    expect(named).toEqual(["circle_1.origin.x", "circle_1.radius", "text_1.content"]);
    expect(selected("downstream table_1", many)).toEqual(["circle_1", "text_1"]);
    const refusal = run("delete table_1", many);
    if (!isCommandFailure(refusal)) throw new Error("expected the delete to refuse");
    const refused = [...refusal.message.matchAll(/\b(\w+\.[\w.]+) references?\b/g)].map((match) => match[1]!);
    expect(refused.length).toBeGreaterThan(0);
    for (const slot of refused) expect(named).toContain(slot);
  });

  it("refuses a depth below 1 or with a fraction, and a name nothing has", () => {
    expect(isCommandFailure(run("upstream text_1 0", CHAIN))).toBe(true);
    expect(isCommandFailure(run("upstream text_1 1.5", CHAIN))).toBe(true);
    expect(isCommandFailure(run("upstream nothing_here", CHAIN))).toBe(true);
  });
});

describe("orphans, broken and find", () => {
  it("selects the objects with no edge to another object, leaving the variables out", () => {
    expect(selected("orphans")).toEqual(["polygon_1", "circle_2"]);
  });

  it("selects the objects holding an error value and names each slot", () => {
    expect(selected("broken")).toEqual(["circle_2"]);
    expect(lines("broken")[0]).toMatch(/^circle_2\.radius #DIV0, and \d+ derived slots after it$/);
  });

  it("finds text in formulas as the operator types them, and in literal text, with case ignored", () => {
    expect(selected("find doc.speed")).toEqual(["table_1"]);
    expect(selected('find "CIRCLE_1.radius"')).toEqual(["text_1"]);
    expect(selected("find label")).toEqual(["text_1"]);
  });

  it("clears the selection when nothing answers, and says so", () => {
    expect(selected("find zebra")).toEqual([]);
    expect(lines("find zebra").at(-1)).toContain("nothing is selected");
  });
});
