import { describe, expect, it } from "vitest";
import { completeCommandLine, splitLineWords, wordAtCursor } from "./complete.ts";
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
