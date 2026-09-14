import { describe, expect, it } from "vitest";
import { classifyCommandLine, classifyFormulaField, completeCommandLine, completeInFormulaField, splitLineWords, wordAtCursor } from "./complete.ts";
import type { GraphObject } from "../engine/index.ts";

function circle(id: string, name: string): GraphObject {
  return {
    id,
    name,
    type: "circle",
    slots: { "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 }, radius: { kind: "literal", value: 1 } },
  };
}

const DOCUMENT: readonly GraphObject[] = [circle("obj_1", "circle_1"), circle("obj_2", "circle_2")];

/** What a completion at the end of a line writes, or undefined for none. */
function fillAtEnd(line: string, objects: readonly GraphObject[] = DOCUMENT): string | undefined {
  return completeCommandLine(line, line.length, objects)?.fill;
}

describe("splitLineWords", () => {
  it("gives each word and where it sits", () => {
    expect(splitLineWords("set a 1")).toEqual([
      { text: "set", start: 0, end: 3, quoted: false },
      { text: "a", start: 4, end: 5, quoted: false },
      { text: "1", start: 6, end: 7, quoted: false },
    ]);
  });

  it("keeps a quoted run as one word", () => {
    const words = splitLineWords('text x=0 "a b"');
    expect(words).toHaveLength(3);
    expect(words[2]).toMatchObject({ text: "a b", quoted: true });
  });

  it("runs an unterminated quote to the end, because typing one is not finished", () => {
    const words = splitLineWords('text "a b');
    expect(words[1]).toMatchObject({ text: "a b", quoted: true });
  });

  it("gives nothing for a line of spaces", () => {
    expect(splitLineWords("   ")).toEqual([]);
  });
});

describe("wordAtCursor", () => {
  const words = splitLineWords("set a 1");

  it("finds the word the cursor is inside", () => {
    expect(wordAtCursor(words, 5)?.text).toBe("a");
  });

  it("finds the word the cursor sits at the end of, which is where typing leaves it", () => {
    expect(wordAtCursor(words, 3)?.text).toBe("set");
  });

  it("finds no word for a cursor in the space between two", () => {
    expect(wordAtCursor(splitLineWords("set  a"), 4)).toBeUndefined();
  });
});

describe("completeCommandLine", () => {
  it("completes a command word in the first position", () => {
    expect(fillAtEnd("sel")).toBe("select");
  });

  it("fills as far as two command words agree", () => {
    // set and set-formula share a start, and so do the two that begin with re.
    expect(fillAtEnd("re")).toBe("re");
  });

  it("offers every command word for an empty line", () => {
    const completion = completeCommandLine("", 0, DOCUMENT);
    expect(completion?.candidates.length).toBeGreaterThan(20);
  });

  it("completes an object name in an argument that names an object", () => {
    expect(fillAtEnd("delete circ")).toBe("circle_");
  });

  it("completes an address in an argument that names a slot", () => {
    expect(fillAtEnd("link circle_1.rad")).toBe("circle_1.radius");
  });

  it("completes the second address of a link, not the first", () => {
    const completion = completeCommandLine("link circle_1.radius circle_2.ra", 32, DOCUMENT);
    expect(completion?.fill).toBe("circle_2.radius");
    expect(completion?.from).toBe(21);
  });

  it("takes two completions to reach a whole address, and types no dot between them", () => {
    // This is the flow an operator actually uses: press, press, done. Writing
    // the dot by hand between the two would test something nobody does.
    expect(fillAtEnd("unlink circle_")).toBe("circle_");
    expect(fillAtEnd("unlink circle_1")).toBe("circle_1.");
    expect(fillAtEnd("unlink circle_1.rad")).toBe("circle_1.radius");
  });

  it("names where to write, so a completion replaces the word and nothing else", () => {
    const completion = completeCommandLine("delete circ", 11, DOCUMENT);
    expect(completion).toMatchObject({ from: 7, to: 11 });
  });

  it("skips a named argument when counting which position a word is", () => {
    // The content of a text object is free text, so nothing completes there.
    expect(fillAtEnd('text x=0 y=0 "hel')).toBeUndefined();
  });

  it("completes nothing inside a named argument itself", () => {
    expect(fillAtEnd("table x=0 y=")).toBeUndefined();
  });

  it("completes nothing for an argument that takes a number", () => {
    expect(fillAtEnd("zoom 1")).toBeUndefined();
  });

  it("completes nothing for a word past every argument a command takes", () => {
    expect(fillAtEnd("list extra")).toBeUndefined();
  });

  it("completes nothing for a command word nothing starts with", () => {
    expect(fillAtEnd("zzz")).toBeUndefined();
  });

  it("completes an empty argument to everything that argument could be", () => {
    const completion = completeCommandLine("delete ", 7, DOCUMENT);
    expect(completion?.candidates).toEqual(["circle_1", "circle_2"]);
  });
});

describe("classifyCommandLine", () => {
  /** The text of each run the line marked, for a readable expectation. */
  function marked(line: string, objects: readonly GraphObject[] = DOCUMENT): string[] {
    return classifyCommandLine(line, objects).map((span) => `${span.kind}:${line.slice(span.start, span.end)}`);
  }

  it("marks a command word it knows", () => {
    expect(marked("delete circle_1")).toContain("command:delete");
  });

  it("leaves a command word it does not know unmarked", () => {
    expect(marked("frobnicate circle_1")).toEqual([]);
  });

  it("marks an address that resolves", () => {
    expect(marked("link circle_1.radius circle_2.radius")).toEqual([
      "command:link",
      "address:circle_1.radius",
      "address:circle_2.radius",
    ]);
  });

  it("leaves a misspelt object unmarked, which is how a mistake shows", () => {
    expect(marked("link cirlce_1.radius circle_2.radius")).toEqual(["command:link", "address:circle_2.radius"]);
  });

  it("leaves a slot that does not exist on a real object unmarked", () => {
    expect(marked("unlink circle_1.nothing")).toEqual(["command:unlink"]);
  });

  it("marks a bare object name where the argument takes one", () => {
    expect(marked("delete circle_1")).toEqual(["command:delete", "address:circle_1"]);
  });

  it("does not mark a bare object name where the argument takes a slot", () => {
    // unlink takes an address, and an object name alone is not one.
    expect(marked("unlink circle_1")).toEqual(["command:unlink"]);
  });

  it("marks nothing in a quoted run, whatever it looks like", () => {
    expect(marked('text x=0 y=0 "circle_1.radius"')).toEqual(["command:text"]);
  });

  it("leaves a number alone", () => {
    expect(marked("zoom 2")).toEqual(["command:zoom"]);
  });

  it("gives the offsets of the run it marked, so a painter can find it", () => {
    const spans = classifyCommandLine("delete circle_1", DOCUMENT);
    expect(spans[1]).toEqual({ start: 7, end: 15, kind: "address" });
  });

  it("gives nothing for an empty line", () => {
    expect(classifyCommandLine("", DOCUMENT)).toEqual([]);
  });

  it("stops marking a name the moment the document stops carrying it", () => {
    expect(marked("delete circle_1", [])).toEqual(["command:delete"]);
  });
});

describe("completeInFormulaField", () => {
  /** A table, so a bare cell reference has somewhere to belong. */
  const TABLE: GraphObject = {
    id: "obj_9",
    name: "table_1",
    type: "table",
    slots: {
      "origin.x": { kind: "literal", value: 0 },
      "origin.y": { kind: "literal", value: 0 },
      rows: { kind: "literal", value: 2 },
      cols: { kind: "literal", value: 2 },
      "cells.A1": { kind: "literal", value: 0 },
      "cells.A2": { kind: "literal", value: 0 },
      "cells.B1": { kind: "literal", value: 0 },
      "cells.B2": { kind: "literal", value: 0 },
    },
  };
  const WITH_TABLE: readonly GraphObject[] = [...DOCUMENT, TABLE];

  it("writes the equals sign the field needs, so the operator types only the address", () => {
    const edit = completeInFormulaField("circle_1.rad", 12, WITH_TABLE);
    expect(edit?.value).toBe("=circle_1.radius");
  });

  it("leaves a sign that is already there alone rather than writing a second", () => {
    const edit = completeInFormulaField("=circle_1.rad", 13, WITH_TABLE);
    expect(edit?.value).toBe("=circle_1.radius");
  });

  it("puts the caret after what it wrote", () => {
    const edit = completeInFormulaField("circle_1.rad", 12, WITH_TABLE);
    expect(edit?.caret).toBe("=circle_1.radius".length);
  });

  it("completes a run inside a larger formula and keeps the rest of it", () => {
    const edit = completeInFormulaField("=2 * circle_1.rad + 1", 17, WITH_TABLE);
    expect(edit?.value).toBe("=2 * circle_1.radius + 1");
  });

  it("takes two presses to reach a whole address here too", () => {
    expect(completeInFormulaField("circle_1", 8, WITH_TABLE)?.value).toBe("=circle_1.");
    expect(completeInFormulaField("=circle_1.rad", 13, WITH_TABLE)?.value).toBe("=circle_1.radius");
  });

  it("marks a bare cell of its own table as a formula, which needs the sign and no completion", () => {
    const edit = completeInFormulaField("A1", 2, WITH_TABLE, "obj_9");
    expect(edit).toMatchObject({ value: "=A1", candidates: [] });
  });

  it("does nothing for a bare name that names nothing", () => {
    expect(completeInFormulaField("hello", 5, WITH_TABLE)).toBeUndefined();
  });

  it("does nothing where the cursor sits on no run at all", () => {
    expect(completeInFormulaField("=1 + 2", 6, WITH_TABLE)).toBeUndefined();
  });

  it("does nothing for an empty field", () => {
    expect(completeInFormulaField("", 0, WITH_TABLE)).toBeUndefined();
  });
});

describe("classifyFormulaField", () => {
  const TABLE: GraphObject = {
    id: "obj_9",
    name: "table_1",
    type: "table",
    slots: {
      "origin.x": { kind: "literal", value: 0 },
      rows: { kind: "literal", value: 2 },
      cols: { kind: "literal", value: 2 },
      "cells.A1": { kind: "literal", value: 0 },
      "cells.B1": { kind: "literal", value: 0 },
      "cells.A2": { kind: "literal", value: 0 },
      "cells.B2": { kind: "literal", value: 0 },
    },
  };
  const WITH_TABLE: readonly GraphObject[] = [...DOCUMENT, TABLE];

  function marked(value: string, tableObjectId?: string): string[] {
    return classifyFormulaField(value, WITH_TABLE, tableObjectId).map((span) => value.slice(span.start, span.end));
  }

  it("marks an address inside a formula", () => {
    expect(marked("=circle_1.radius * 2")).toEqual(["circle_1.radius"]);
  });

  it("marks each of several addresses", () => {
    expect(marked("=circle_1.radius + circle_2.radius")).toEqual(["circle_1.radius", "circle_2.radius"]);
  });

  it("marks nothing in a field that is not a formula, because it is text", () => {
    expect(marked("circle_1.radius")).toEqual([]);
  });

  it("leaves a misspelt name unmarked", () => {
    expect(marked("=cirlce_1.radius + circle_2.radius")).toEqual(["circle_2.radius"]);
  });

  it("leaves a slot that does not exist unmarked", () => {
    expect(marked("=circle_1.nothing")).toEqual([]);
  });

  it("marks a bare cell only inside the table it belongs to", () => {
    expect(marked("=A1 + 1", "obj_9")).toEqual(["A1"]);
    expect(marked("=A1 + 1")).toEqual([]);
  });

  it("gives offsets counted from the front of the field, past the sign", () => {
    expect(classifyFormulaField("=circle_1.radius", WITH_TABLE)[0]).toEqual({ start: 1, end: 16, kind: "address" });
  });

  it("marks a function call's arguments and not its name", () => {
    expect(marked("=SUM(circle_1.radius)")).toEqual(["circle_1.radius"]);
  });
});
