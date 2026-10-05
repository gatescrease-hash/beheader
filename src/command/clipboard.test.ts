/**
 * clipboard.test.ts
 *
 * These tests cover the clipboard planners: a copied wired pair pastes with
 * its wiring on the copies, a copied half keeps reading the original, a group
 * copies with its members, text and notation follow the copies, copied cells
 * move their references by the distance pasted, and pasted text grows the
 * table within the limit of section 7 or names the size it needed.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, formatFormula, MAX_TABLE_LINES, mutate, type Document, type EvalContext, type GraphObject } from "../engine/index.ts";
import { executeCommand, isCommandFailure } from "./commands.ts";
import { isCommandParseFailure, parseCommand } from "./parser.ts";
import { copyCells, copyObjects, parseDelimited, pasteCells, pasteObjects, pasteText } from "./clipboard.ts";

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

function named(document: Document, name: string): GraphObject {
  const object = document.objects.find((candidate) => candidate.name === name);
  if (object === undefined) throw new Error(`no object named ${name}, have ${document.objects.map((each) => each.name).join(", ")}`);
  return object;
}

function pasted(document: Document, names: readonly string[], offset = { x: 20, y: 20 }): Document {
  const plan = pasteObjects(document, copyObjects(document.objects, names.map((name) => named(document, name).id)), offset);
  if ("ok" in plan) throw new Error(plan.message);
  const result = mutate(document.objects, plan.operations, document.journal, CONTEXT);
  if (!result.ok) throw new Error(result.message);
  return { ...document, objects: result.objects, journal: result.journal, nextObjectId: plan.nextObjectId };
}

function formulaOf(document: Document, name: string, key: string): string {
  const slot = named(document, name).slots[key];
  if (slot?.kind !== "formula") throw new Error(`${name}.${key} holds no formula`);
  return formatFormula(slot.ast, document.objects);
}

const PAIR = ["circle x=0 y=0 r=10", "circle x=100 y=0 r=5", "set circle_2.radius = circle_1.radius * 2"];

describe("copying objects", () => {
  it("pastes a wired pair with its wiring on the copies, moved by the offset, under the next free names", () => {
    const document = pasted(built(PAIR), ["circle_1", "circle_2"]);
    expect(formulaOf(document, "circle_4", "radius")).toBe("circle_3.radius * 2");
    expect(named(document, "circle_3").slots["origin.x"]?.value).toBe(20);
    expect(named(document, "circle_4").slots.radius?.value).toBe(20);
    expect(formulaOf(document, "circle_2", "radius")).toBe("circle_1.radius * 2");
  });

  it("keeps a copied half reading the original", () => {
    const document = pasted(built(PAIR), ["circle_2"]);
    expect(formulaOf(document, "circle_3", "radius")).toBe("circle_1.radius * 2");
  });

  it("copies a group with its members, and points text and notation at the copies", () => {
    const document = pasted(built([
      ...PAIR,
      'text x=0 y=100 "r = {= circle_1.radius}"',
      "group circle_1,text_1",
    ]), ["group_1"]);
    const group = named(document, "group_2");
    expect(named(document, "circle_3").slots["view.group"]?.value).toBe(group.id);
    expect(named(document, "text_2").slots["view.group"]?.value).toBe(group.id);
    expect(named(document, "text_2").slots.content?.value).toBe("r = {= circle_3.radius }");
    expect(named(document, "text_1").slots.content?.value).toBe("r = {= circle_1.radius}");
  });

  it("leaves the variable holder out of a copy", () => {
    const document = built(["docvar speed 3", "circle x=0 y=0 r=10"]);
    const payload = copyObjects(document.objects, document.objects.map((object) => object.id));
    expect(payload.objects.map((object) => object.type)).toEqual(["circle"]);
  });
});

describe("copying cells", () => {
  const TABLE = ["table x=0 y=0 rows=3 cols=3", "set table_1.A1 2", "set table_1.B1 = table_1.A1 * 10", "circle x=300 y=0 r=4", "set table_1.C1 = circle_1.radius"];

  it("puts tab separated values on the clipboard of the system", () => {
    const document = built(TABLE);
    const { text } = copyCells(named(document, "table_1"), { row: 1, column: 1 }, { rows: 1, columns: 3 });
    expect(text).toBe("2\t20\t4");
  });

  it("moves references into the copied table by the distance pasted, and leaves other references alone", () => {
    const document = built(TABLE);
    const table = named(document, "table_1");
    const { payload } = copyCells(table, { row: 1, column: 1 }, { rows: 1, columns: 3 });
    const plan = pasteCells(table, { row: 3, column: 1 }, payload);
    if (!plan.ok) throw new Error(plan.message);
    const result = mutate(document.objects, plan.operations, document.journal, CONTEXT);
    if (!result.ok) throw new Error(result.message);
    const after = { ...document, objects: result.objects };
    expect(formulaOf(after, "table_1", "cells.B3")).toBe("table_1.A3 * 10");
    expect(formulaOf(after, "table_1", "cells.C3")).toBe("circle_1.radius");
    expect(named(after, "table_1").slots["cells.B3"]?.value).toBe(20);
  });

  it("turns a reference moved off the table into #REF", () => {
    const document = built(TABLE);
    const table = named(document, "table_1");
    const { payload } = copyCells(table, { row: 1, column: 2 }, { rows: 1, columns: 1 });
    const plan = pasteCells(table, { row: 1, column: 1 }, payload);
    expect(plan.ok && plan.operations[0]).toMatchObject({ slot: { kind: "formula", ast: { type: "binaryOp", left: { type: "error", error: "#REF" } } } });
  });
});

describe("pasting text into cells", () => {
  it("reads tab or comma separated rows as literals, numbers as numbers, and grows the table to hold them", () => {
    const document = built(["table x=0 y=0 rows=2 cols=2"]);
    const plan = pasteText(named(document, "table_1"), { row: 2, column: 2 }, "1,two,3\n4,\"five, six\",7\n");
    if (!plan.ok) throw new Error(plan.message);
    const result = mutate(document.objects, plan.operations, document.journal, CONTEXT);
    if (!result.ok) throw new Error(result.message);
    const table = result.objects.find((object) => object.name === "table_1")!;
    expect(table.slots.rows?.value).toBe(3);
    expect(table.slots.cols?.value).toBe(4);
    expect(table.slots["cells.B2"]?.value).toBe(1);
    expect(table.slots["cells.C2"]?.value).toBe("two");
    expect(table.slots["cells.C3"]?.value).toBe("five, six");
  });

  it("refuses text that would pass the limit on rows, and names the size it needed", () => {
    const document = built(["table x=0 y=0 rows=2 cols=2"]);
    const plan = pasteText(named(document, "table_1"), { row: MAX_TABLE_LINES, column: 1 }, "1\n2");
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.message).toContain(`${MAX_TABLE_LINES + 1} rows`);
  });

  it("reads quoted fields with line breaks and doubled quotes, as a spreadsheet writes them", () => {
    expect(parseDelimited('a\t"b\nc"\t"say ""hi"""\r\nd', "\t")).toEqual([["a", "b\nc", 'say "hi"'], ["d"]]);
  });
});
