/**
 * markdown.test.ts
 *
 * These tests cover the markdown lite parser, and the rule for which asterisk
 * opens an emphasis span and which one closes it.
 */
import { describe, expect, it } from "vitest";
import { LIST_BULLET, parseMarkdownLite, verbatimLines, type MarkdownRun } from "./markdown.ts";

function onlyLine(text: string) {
  const lines = parseMarkdownLite(text);
  expect(lines).toHaveLength(1);
  const line = lines[0];
  if (line === undefined) {
    throw new Error("unreachable — length was asserted above");
  }
  return line;
}

function texts(runs: readonly MarkdownRun[]): readonly string[] {
  return runs.map((run) => run.text);
}

const PLAIN = { bold: false, italic: false, code: false };

describe("parseMarkdownLite — hard lines and the blank line paragraph break", () => {
  it("returns one line per hard line, so the line count is markup-independent", () => {
    expect(parseMarkdownLite("a\nb\nc")).toHaveLength(3);
  });

  it("treats \\r\\n as a hard break, the same split render/measure.ts lays out by", () => {
    expect(parseMarkdownLite("a\r\nb")).toHaveLength(2);
  });

  it("keeps a blank line as a line with no runs, because a paragraph break is that line's own height", () => {
    const lines = parseMarkdownLite("a\n\nb");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toEqual({ kind: "paragraph", level: 0, runs: [] });
  });

  it("parses an empty string as one empty paragraph rather than no lines", () => {
    expect(parseMarkdownLite("")).toEqual([{ kind: "paragraph", level: 0, runs: [] }]);
  });
});

describe("parseMarkdownLite — headings, levels 1-3 and no further", () => {
  it("reads `# `, `## ` and `### ` as levels 1, 2 and 3 with the marker removed", () => {
    expect(onlyLine("# Title")).toEqual({ kind: "heading", level: 1, runs: [{ text: "Title", ...PLAIN }] });
    expect(onlyLine("## Title")).toEqual({ kind: "heading", level: 2, runs: [{ text: "Title", ...PLAIN }] });
    expect(onlyLine("### Title")).toEqual({ kind: "heading", level: 3, runs: [{ text: "Title", ...PLAIN }] });
  });

  it("draws a FOURTH level verbatim, because the parser takes levels 1 to 3 and nothing more", () => {
    expect(onlyLine("#### Title")).toEqual({ kind: "paragraph", level: 0, runs: [{ text: "#### Title", ...PLAIN }] });
  });

  it("needs the space: `#Title` is ordinary text, not a heading", () => {
    expect(onlyLine("#Title").kind).toBe("paragraph");
  });

  it("does not recognise an INDENTED heading — a prefix is read at position 0 only", () => {
    expect(onlyLine("  # Title").kind).toBe("paragraph");
  });

  it("parses inline markup inside a heading", () => {
    expect(onlyLine("## a **b**").runs).toEqual([
      { text: "a ", ...PLAIN },
      { text: "b", bold: true, italic: false, code: false },
    ]);
  });
});

describe("parseMarkdownLite — list items, marked with a bullet", () => {
  it("replaces `- ` with the bullet run and keeps the rest as the item's text", () => {
    expect(onlyLine("- milk")).toEqual({
      kind: "list",
      level: 0,
      runs: [
        { text: LIST_BULLET, ...PLAIN },
        { text: "milk", ...PLAIN },
      ],
    });
  });

  it("needs the space: `-5` is ordinary text, so a negative number is never a list", () => {
    expect(onlyLine("-5 degrees").kind).toBe("paragraph");
  });

  it("does not recognise an INDENTED item, because there are no nested lists, and indentation is what makes one", () => {
    expect(onlyLine("  - nested").kind).toBe("paragraph");
  });

  it("parses inline markup inside an item, after the bullet", () => {
    expect(texts(onlyLine("- **milk** now").runs)).toEqual([LIST_BULLET, "milk", " now"]);
  });
});

describe("parseMarkdownLite — bold, italic and code, markers removed", () => {
  it("reads `**bold**` as one bold run with the four marker characters gone", () => {
    expect(onlyLine("**loud**").runs).toEqual([{ text: "loud", bold: true, italic: false, code: false }]);
  });

  it("reads `*italic*` as one italic run", () => {
    expect(onlyLine("*soft*").runs).toEqual([{ text: "soft", bold: false, italic: true, code: false }]);
  });

  it("reads `` `code` `` as one code run", () => {
    expect(onlyLine("`x + 1`").runs).toEqual([{ text: "x + 1", bold: false, italic: false, code: true }]);
  });

  it("splits a line into styled and plain runs in order", () => {
    expect(onlyLine("a **b** c").runs).toEqual([
      { text: "a ", ...PLAIN },
      { text: "b", bold: true, italic: false, code: false },
      { text: " c", ...PLAIN },
    ]);
  });

  it("NESTS italic inside bold, because `**a *b* c**` is ordinary to type", () => {
    expect(onlyLine("**a *b* c**").runs).toEqual([
      { text: "a ", bold: true, italic: false, code: false },
      { text: "b", bold: true, italic: true, code: false },
      { text: " c", bold: true, italic: false, code: false },
    ]);
  });

  it("does NOT re-parse a code run's contents — inside backticks an asterisk is an asterisk", () => {
    expect(onlyLine("`a *b* c`").runs).toEqual([{ text: "a *b* c", bold: false, italic: false, code: true }]);
  });

  it("prefers `**` to `*` at the same position, so bold is never read as two empty italics", () => {
    expect(onlyLine("**x**").runs).toEqual([{ text: "x", bold: true, italic: false, code: false }]);
  });
});

describe("parseMarkdownLite — an UNMATCHED marker is literal text, never a run that swallows the line", () => {
  it("draws a lone asterisk as itself", () => {
    expect(onlyLine("2 * 3 = 6").runs).toEqual([{ text: "2 * 3 = 6", ...PLAIN }]);
  });

  it("draws a half-typed `**bold` as itself, both marker characters included", () => {
    expect(onlyLine("**bold").runs).toEqual([{ text: "**bold", ...PLAIN }]);
  });

  it("draws an unclosed backtick as itself", () => {
    expect(onlyLine("a ` b").runs).toEqual([{ text: "a ` b", ...PLAIN }]);
  });

  it("draws EMPTY emphasis literally rather than as a run with nothing in it", () => {
    expect(texts(onlyLine("****").runs)).toEqual(["****"]);
    expect(texts(onlyLine("``").runs)).toEqual(["``"]);
  });

  it("keeps every character: putting the markers back reproduces the input", () => {
    const line = "a **b** `c` *d* ** e";
    expect(texts(onlyLine(line).runs).join("")).toBe("a b c d ** e");
  });
});

describe("parseMarkdownLite — the list of markup is exact, and nothing else counts", () => {
  it("draws a link, an image, a blockquote and a table row verbatim", () => {
    expect(texts(onlyLine("[text](url)").runs)).toEqual(["[text](url)"]);
    expect(texts(onlyLine("![alt](src)").runs)).toEqual(["![alt](src)"]);
    expect(texts(onlyLine("> quoted").runs)).toEqual(["> quoted"]);
    expect(texts(onlyLine("| a | b |").runs)).toEqual(["| a | b |"]);
  });

  it("draws an underscore emphasis verbatim, because the parser takes the asterisk forms only", () => {
    expect(texts(onlyLine("_soft_").runs)).toEqual(["_soft_"]);
  });

  it("has no escaping: a backslash is an ordinary character and does not disarm a marker", () => {
    expect(onlyLine("\\*soft\\*").runs).toEqual([
      { text: "\\", ...PLAIN },
      { text: "soft\\", bold: false, italic: true, code: false },
    ]);
  });
});

describe("parseMarkdownLite — never throws, at any size or nesting depth", () => {
  it("survives a thousand nested markers without recursing", () => {
    expect(() => parseMarkdownLite("*".repeat(2000) + "x" + "*".repeat(2000))).not.toThrow();
  });

  it("survives a very long line and a very large line count", () => {
    expect(() => parseMarkdownLite("a".repeat(50_000))).not.toThrow();
    expect(parseMarkdownLite("x\n".repeat(5000))).toHaveLength(5001);
  });
});

describe("parseMarkdownLite — CommonMark's flanking rule, reduced: a marker beside a space is text", () => {
  it("keeps `2 * 3` arithmetic even on a line that ALSO holds a `**`, which a bare closer search would have paired it with", () => {
    expect(texts(onlyLine("2 * 3 and **bold").runs)).toEqual(["2 * 3 and **bold"]);
  });

  it("refuses to OPEN on a marker followed by a space", () => {
    expect(texts(onlyLine("a * b * c").runs)).toEqual(["a * b * c"]);
    expect(texts(onlyLine("a ** b ** c").runs)).toEqual(["a ** b ** c"]);
  });

  it("refuses to CLOSE on a marker preceded by a space, and finds the next one that qualifies", () => {
    expect(onlyLine("**a ** b**").runs).toEqual([{ text: "a ** b", bold: true, italic: false, code: false }]);
  });

  it("still opens on a marker at the very start of a line, where there is nothing before it", () => {
    expect(onlyLine("**start** of line").runs[0]).toEqual({ text: "start", bold: true, italic: false, code: false });
  });

  it("does not apply the rule to a code span — backticks pair with any later backtick, as markdown does", () => {
    expect(onlyLine("a ` b ` c").runs).toEqual([
      { text: "a ", ...PLAIN },
      { text: " b ", bold: false, italic: false, code: true },
      { text: " c", ...PLAIN },
    ]);
  });
});

describe("verbatimLines — the same hard lines with no markup honoured", () => {
  it("splits exactly where parseMarkdownLite splits, so the line COUNT never depends on markup", () => {
    for (const text of ["a\nb\nc", "a\r\n\r\nb", "", "# h\n- l\n**b**"]) {
      expect(verbatimLines(text)).toHaveLength(parseMarkdownLite(text).length);
    }
  });

  it("keeps every marker character as ordinary text in one plain run", () => {
    expect(verbatimLines("# **bold**")).toEqual([
      { kind: "paragraph", level: 0, runs: [{ text: "# **bold**", ...PLAIN }] },
    ]);
  });

  it("gives a blank line no run, the same shape parseMarkdownLite gives it", () => {
    expect(verbatimLines("a\n\nb")[1]).toEqual({ kind: "paragraph", level: 0, runs: [] });
  });
});
