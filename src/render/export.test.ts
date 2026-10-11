/**
 * export.test.ts
 *
 * These tests cover the picture export: which objects a picture holds, the
 * frame it covers, the program's macros written out for MathML, the notation
 * each picture carries, and the vector form end to end, with the chrome left
 * out and notation drawn in.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type Document, type EvalContext, type GraphObject } from "../engine/index.ts";
import { executeCommand, isCommandFailure } from "../command/commands.ts";
import { isCommandParseFailure, parseCommand } from "../command/parser.ts";
import { EXPORT_MARGIN, expandMathMacros, exportedObjects, exportFrame, exportSvg, notationItems } from "./export.ts";
import { renderDocument } from "./renderer.ts";
import { SvgContext } from "./svg-context.ts";

const CONTEXT: EvalContext = {
  measurer: {
    measure: (text: string) => ({ width: text.length * 8, height: 20 }),
    measureMath: (latex: string) => ({ width: latex.length * 9, height: 24 }),
  },
};

const measureText = (_font: string, text: string): number => text.length * 8;
const measureMath = (latex: string): { width: number; height: number } => ({ width: latex.length * 9, height: 24 });
const mathml = (latex: string): string => `<mi>${latex}</mi>`;

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
  if (object === undefined) throw new Error(`no object named ${name}`);
  return object;
}

const DRAWING = ["circle x=100 y=100 r=40", "rect x=300 y=60 w=80 h=40", 'math x=100 y=300 "y=x^2"', 'text x=300 y=300 "area {$ r^2 } here"'];

describe("exportedObjects and exportFrame", () => {
  it("covers every object with a margin, and only the selection, with the members of a selected group, when asked", () => {
    const document = built([...DRAWING, "group circle_1,rect_1"]);
    const all = exportFrame(document.objects);
    expect(all?.minX).toBe(60 - EXPORT_MARGIN);
    expect(all?.minY).toBe(60 - EXPORT_MARGIN);
    const picked = exportedObjects(document.objects, [named(document, "group_1").id]);
    expect(picked.map((object) => object.name).filter((name) => name !== "doc")).toEqual(["circle_1", "rect_1", "group_1"]);
    const frame = exportFrame(picked);
    expect(frame).toEqual({ minX: 60 - EXPORT_MARGIN, minY: 60 - EXPORT_MARGIN, maxX: 380 + EXPORT_MARGIN, maxY: 140 + EXPORT_MARGIN });
  });

  it("covers nothing for a document with nothing on the canvas", () => {
    expect(exportFrame(createEmptyDocument().objects)).toBeUndefined();
  });
});

describe("expandMathMacros", () => {
  it("writes out the program's macros, braces inside the argument included, and leaves other LaTeX alone", () => {
    expect(expandMathMacros("y=\\gpref{circle_1.radius}*2")).toBe("y=\\mathtt{\\text{circle_1.radius}}*2");
    expect(expandMathMacros("\\gpref{a{b}c}+\\gpref{d}")).toBe("\\mathtt{\\text{a{b}c}}+\\mathtt{\\text{d}}");
    expect(expandMathMacros("\\solve{x} x^2=4")).toBe("\\operatorname{solve}\\,x\\,{:}\\, x^2=4");
    expect(expandMathMacros("\\frac{1}{2}")).toBe("\\frac{1}{2}");
  });
});

describe("notationItems", () => {
  it("carries a math object's notation in its box at its own size, and each run inside text at the size of that text", () => {
    const document = built(DRAWING);
    const report = renderDocument(new SvgContext(800, 600, measureText), 800, 600, document.objects, { x: 0, y: 0, zoom: 1 }, [], [], undefined, undefined, undefined, undefined, measureMath, undefined, false);
    const items = notationItems(document.objects, report.mathRuns);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ latex: "y=x^2", x: 100, y: 300, fontSize: 18, padding: 8, display: true });
    expect(items[1]).toMatchObject({ latex: "r^2", fontSize: 16, padding: 0, display: false });
  });
});

describe("exportSvg", () => {
  it("draws the objects without their chrome, and the notation in on top as MathML", () => {
    const objects = built(DRAWING).objects;
    const svg = exportSvg(objects, { measureText, mathml, measureMath });
    const frame = exportFrame(objects)!;
    expect(svg).toContain(`<rect width="${frame.maxX - frame.minX}" height="${frame.maxY - frame.minY}" fill="#ffffff"/>`);
    expect(svg).toMatch(/<path d="M[^"]*A40 40/);
    expect(svg).not.toContain(">circle_1</text>");
    expect(svg?.match(/<foreignObject/g)).toHaveLength(2);
    expect(svg).toContain(`<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>y=x^2</mi></math>`);
    expect(svg).toContain(`<mi>r^2</mi>`);
  });

  it("carries no notation for the same drawing without any", () => {
    const svg = exportSvg(built(DRAWING.slice(0, 2)).objects, { measureText, mathml, measureMath });
    expect(svg).not.toContain("<math");
    expect(svg).not.toContain("<foreignObject");
  });

  it("covers a frame's box exactly, draws its sheet with no name, and cuts what crosses its edge", () => {
    const document = built(["frame x=50 y=40 w=300 h=200", ...DRAWING]);
    const frame = { minX: 50, minY: 40, maxX: 350, maxY: 240 };
    const svg = exportSvg(document.objects, { measureText, mathml, measureMath, frame });
    expect(svg).toContain(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"`);
    expect(svg).toContain(`fill="#fffdf7"`);
    expect(svg).not.toContain(">frame_1</text>");
  });

  it("draws a selection alone, and nothing for a selection with no box", () => {
    const document = built(DRAWING);
    const svg = exportSvg(exportedObjects(document.objects, [named(document, "rect_1").id]), { measureText, mathml, measureMath });
    expect(svg).toContain(`width="${80 + 2 * EXPORT_MARGIN}"`);
    expect(svg).not.toContain("<math");
    expect(exportSvg(exportedObjects(document.objects, []), { measureText, mathml })).toBeUndefined();
  });
});
