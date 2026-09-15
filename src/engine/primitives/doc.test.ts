/** Tests document variable commands through mutation, evaluation and persistence. */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, loadDocument, saveDocument, type Document } from "../document.ts";
import { executeCommand } from "../../command/commands.ts";
import { parseCommand } from "../../command/parser.ts";
import { completeAddress, formulaReferenceResolves } from "../complete.ts";
import { mutate } from "../mutation.ts";
import { journalIsComplete } from "../journal.ts";
import { documentVariableNameProblem } from "./doc.ts";

const context = { measurer: { measure: (text: string) => ({ width: text.length * 8, height: 20 }) } };
function execute(line: string, document: Document) {
  const parsed = parseCommand(line);
  if (!parsed.ok) throw new Error(parsed.message);
  return executeCommand(parsed.command, document, context);
}
function run(line: string, document = createEmptyDocument()): Document {
  const result = execute(line, document);
  if (!result.ok) throw new Error(result.message);
  return result.document;
}

describe("document variables", () => {
  it("creates the singleton lazily and evaluates bare and explicit references", () => {
    let doc = run("docvar speed 12");
    doc = run("docvar total = speed * 2", doc);
    doc = run("set doc.speed 7", doc);
    expect(doc.objects).toHaveLength(1);
    expect(doc.objects[0]?.slots.total?.value).toBe(14);
    expect(completeAddress("spe", doc.objects).fill).toBe("speed");
    expect(formulaReferenceResolves("speed", doc.objects)).toBe(true);
    expect(journalIsComplete(doc.objects, doc.journal, context)).toBe(true);
    expect(loadDocument(saveDocument(doc), context)).toEqual({ ok: true, document: doc });
  });

  it("reads from a table cell, text and a math input port", () => {
    let doc = run("docvar speed 12");
    doc = run("table x=0 y=0", doc);
    doc = run("set table_1.A1 = speed", doc);
    doc = run('text x=0 y=0 "speed {= speed }"', doc);
    doc = run('math x=0 y=0 "y=x*2"', doc);
    doc = run("set math_1.in.x = speed", doc);
    doc = run("set speed 9", doc);
    expect(doc.objects.find((o) => o.type === "table")?.slots["cells.A1"]?.value).toBe(9);
    expect(doc.objects.find((o) => o.type === "text")?.slots.resolvedContent?.value).toBe("speed 9");
    expect(doc.objects.find((o) => o.type === "math")?.slots["out.y"]?.value).toBe(18);
  });

  it.each(["SUM", "A1", "ABC123", "doc", "bad.name"])("refuses a colliding or malformed name %s", (name) => {
    expect(execute(`docvar ${name} 2`, createEmptyDocument()).ok).toBe(false);
  });

  it("refuses name collisions in both creation directions", () => {
    const withCircle = run("circle x=0 y=0 r=1");
    expect(execute("docvar circle_1 1", withCircle).ok).toBe(false);
    const withVariable = run("docvar chosen 1", withCircle);
    expect(execute("rename circle_1 chosen", withVariable).ok).toBe(false);
    expect(documentVariableNameProblem("CHOSEN", withVariable.objects)).toContain("already exists");
  });

  it("refuses a cycle and deletion with a named reader without changing the input", () => {
    const doc = run("docvar second = first", run("docvar first 1"));
    const before = saveDocument(doc);
    expect(execute("docvar first = second", doc)).toMatchObject({ ok: false, message: expect.stringContaining("cyclic") });
    expect(execute("delvar first", doc)).toMatchObject({ ok: false, message: expect.stringContaining("doc.second") });
    expect(saveDocument(doc)).toBe(before);
  });

  it("shares values between copies and removes copies with an unused variable", () => {
    let doc = run("docvar speed 12");
    doc = run("docvar speed x=200 y=140", doc);
    doc = run("docvar speed x=200 y=200", doc);
    doc = run("set speed 99", doc);
    expect(doc.objects.filter((o) => o.type === "docref").map((o) => o.slots.value?.value)).toEqual([99, 99]);
    expect(doc.objects[1]?.slots.measuredWidth?.value).toBe(80);
    expect(loadDocument(saveDocument(doc), context)).toEqual({ ok: true, document: doc });
    doc = run("delete docref_1", doc);
    expect(doc.objects[0]?.slots.speed?.value).toBe(99);
    doc = run("delvar speed", doc);
    expect(doc.objects.map((o) => o.type)).toEqual(["doc"]);
    expect(doc.objects[0]?.slots).toEqual({});
    expect(journalIsComplete(doc.objects, doc.journal, context)).toBe(true);
  });

  it("rejects invalid doc objects and copy targets through direct mutations", () => {
    const object = { id: "one", name: "doc", type: "doc" as const, slots: { SUM: { kind: "literal" as const, value: 1 } } };
    expect(mutate([], [{ kind: "createObject", object }], []).ok).toBe(false);
    expect(mutate([], [{ kind: "createObject", object: { ...object, type: "docref", name: "copy", slots: {} } }], []).ok).toBe(false);
  });

  it("refuses deletion through text dependencies before reparsing can lose them", () => {
    const doc = run('text x=0 y=0 "{? speed > 0 }{= speed }{:}zero{?}"', run("docvar speed 12"));
    expect(execute("delvar speed", doc)).toMatchObject({ ok: false, message: expect.stringContaining("text_1.resolvedContent") });
  });

  it("renames variable addresses, copy targets, text markers and math references atomically", () => {
    let doc = run("docvar speed 12");
    doc = run("docvar speed x=20 y=40", doc);
    doc = run("docvar total = speed * 2", doc);
    doc = run('text x=0 y=0 "speed {= speed } {? doc.speed > 0 }yes{:}no{?}"', doc);
    doc = run('math x=0 y=0 ' + JSON.stringify('y=\\gpref{doc.speed}*2'), doc);
    doc = run("renamevar speed velocity", doc);
    doc = run("set velocity 7", doc);
    expect(doc.objects[0]?.slots.speed).toBeUndefined();
    expect(doc.objects[0]?.slots.total?.value).toBe(14);
    expect(doc.objects.find((o) => o.type === "docref")?.target?.path).toEqual(["velocity"]);
    expect(doc.objects.find((o) => o.type === "text")?.slots.resolvedContent?.value).toBe("speed 7 yes");
    expect(doc.objects.find((o) => o.type === "math")?.slots["out.y"]?.value).toBe(14);
    expect(journalIsComplete(doc.objects, doc.journal, context)).toBe(true);
    expect(loadDocument(saveDocument(doc), context)).toEqual({ ok: true, document: doc });
  });

  it("rejects storage names even after the singleton exists", () => {
    const doc = run("docvar speed 1");
    for (const name of ["constructor", "__proto__", "toString"]) expect(execute(`docvar ${name} 2`, doc).ok).toBe(false);
  });
});


it("reports both the missing formula source and its closest live slot", () => {
  const doc = run("docvar speed 12");
  expect(execute("docvar total = doc.sped", doc)).toMatchObject({ ok: false, message: expect.stringContaining('doc.sped Did you mean "doc.speed"?') });
});

it("allocates object names around variable names and keeps variable matching case insensitive", () => {
  let doc = run("docvar circle_1 12");
  doc = run("circle x=0 y=0 r=2", doc);
  expect(doc.objects[1]?.name).toBe("circle_2");
  doc = run("set CIRCLE_1 24", doc);
  expect(doc.objects[0]?.slots.circle_1?.value).toBe(24);
  expect(execute("refs circle_1", doc).ok).toBe(true);
});

describe("the examples section 13 writes out", () => {
  it("takes a formula with no space after the equals sign", () => {
    let doc = run("docvar a 3");
    doc = run("docvar b 4", doc);
    doc = run("docvar total =doc.a+doc.b", doc);
    expect(doc.objects[0]?.slots.total?.value).toBe(7);
    doc = run("set doc.a 10", doc);
    expect(doc.objects[0]?.slots.total?.value).toBe(14);
  });

  it("refuses a circle of variables that define each other", () => {
    let doc = run("docvar a 1");
    doc = run("docvar b =doc.a", doc);
    expect(execute("docvar a =doc.b", doc).ok).toBe(false);
  });

  it("renames a variable and every kind of reader in one mutation", () => {
    let doc = run("docvar speed 12");
    doc = run("docvar total = speed * 2", doc);
    doc = run("table x=0 y=0", doc);
    doc = run("set table_1.A1 = speed", doc);
    doc = run('text x=0 y=0 "speed is {= speed }"', doc);
    doc = run("docvar speed x=10 y=10", doc);
    doc = run("renamevar speed velocity", doc);

    const variables = doc.objects.find((object) => object.type === "doc");
    expect(Object.keys(variables?.slots ?? {})).toEqual(["velocity", "total"]);
    expect(variables?.slots.total?.value).toBe(24);
    expect(doc.objects.find((object) => object.type === "table")?.slots["cells.A1"]?.value).toBe(12);
    // The prose around the formula is untouched, and only the address moves.
    expect(doc.objects.find((object) => object.type === "text")?.slots.content?.value).toContain("speed is");
    expect(doc.objects.find((object) => object.type === "docref")?.target?.path).toEqual(["velocity"]);
    expect(journalIsComplete(doc.objects, doc.journal, context)).toBe(true);
  });

  it("keeps the doc object when the last variable goes, and takes the copies with it", () => {
    let doc = run("docvar speed 12");
    doc = run("docvar speed x=10 y=10", doc);
    doc = run("docvar speed x=10 y=40", doc);
    expect(doc.objects.filter((object) => object.type === "docref")).toHaveLength(2);

    doc = run("delvar speed", doc);
    expect(doc.objects.filter((object) => object.type === "docref")).toHaveLength(0);
    expect(doc.objects.filter((object) => object.type === "doc")).toHaveLength(1);
    expect(loadDocument(saveDocument(doc), context)).toEqual({ ok: true, document: doc });
  });

  it("deletes one copy and leaves the variable and the other copy alone", () => {
    let doc = run("docvar speed 12");
    doc = run("docvar speed x=10 y=10", doc);
    doc = run("docvar speed x=10 y=40", doc);
    doc = run("delete docref_1", doc);
    expect(doc.objects.find((object) => object.type === "doc")?.slots.speed?.value).toBe(12);
    expect(doc.objects.filter((object) => object.type === "docref")).toHaveLength(1);
  });

  it("refuses a delete that a reader depends on, and names the reader", () => {
    let doc = run("docvar speed 12");
    doc = run("docvar total = speed * 2", doc);
    expect(execute("delvar speed", doc)).toMatchObject({
      ok: false,
      message: expect.stringContaining("doc.total"),
    });
  });
});
