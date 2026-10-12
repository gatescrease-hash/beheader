import { describe, expect, it } from "vitest";
import { executeCommand } from "../../command/commands.ts";
import { parseCommand } from "../../command/parser.ts";
import { createEmptyDocument, type Document } from "../document.ts";
import type { EvalContext } from "../eval-context.ts";
import type { GraphObject, Point } from "../graph/node.ts";
import { mutate } from "../mutation.ts";
import { PLOT_SAMPLE_COUNT } from "./plot.ts";

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

function refusal(lines: readonly string[], line: string): string {
  const document = run(lines);
  const parsed = parseCommand(line);
  if (!parsed.ok) throw new Error(parsed.message);
  const result = executeCommand(parsed.command, document, context);
  if (result.ok) throw new Error(`expected "${line}" to refuse`);
  return result.message;
}

function named(document: Document, name: string): GraphObject {
  const object = document.objects.find((candidate) => candidate.name === name);
  if (object === undefined) throw new Error(`test setup: no object named ${name}`);
  return object;
}

const samples = (document: Document): readonly Point[] => named(document, "plot_1").slots.samples?.value as readonly Point[];

describe("a plot samples a math object along one input", () => {
  it("runs the program at each place from xmin to xmax, the ends and the middle included", () => {
    const points = samples(run(['math "y = x^2"', "plot math_1 from=-2 to=2"]));
    expect(points).toHaveLength(PLOT_SAMPLE_COUNT);
    expect(points[0]).toEqual({ x: -2, y: 4 });
    expect(points[(PLOT_SAMPLE_COUNT - 1) / 2]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 2, y: 4 });
  });

  it("reads every other input as the math object holds it, and follows a change to one", () => {
    const document = run(['math "y = a x"', "set math_1.in.a 3", "plot math_1 from=0 to=1"]);
    expect(samples(document).at(-1)).toEqual({ x: 1, y: 3 });
    expect(samples(run(["set math_1.in.a 5"], document)).at(-1)).toEqual({ x: 1, y: 5 });
  });

  it("follows a new source on the math object, and a range a formula drives", () => {
    const document = run(['math "y = x"', "plot math_1 from=0 to=1", "slider x=0 y=300 min=1 max=10 value=4", "link plot_1.xmax slider_1.value"]);
    expect(samples(document).at(-1)).toEqual({ x: 4, y: 4 });
    const narrowed = run(["set slider_1.value 2"], document);
    expect(samples(narrowed).at(-1)).toEqual({ x: 2, y: 2 });
    // Editing the equations writes the source through setMathSource, which rebuilds the ports.
    const edited = mutate(narrowed.objects, [{ kind: "setMathSource", objectId: named(narrowed, "math_1").id, source: "y = 2 x" }], narrowed.journal, context);
    if (!edited.ok) throw new Error(edited.message);
    expect(samples({ ...narrowed, objects: edited.objects }).at(-1)).toEqual({ x: 2, y: 4 });
  });

  it("reads an input the math object gains after the plot was made", () => {
    const document = run(['math "y = x"', "plot math_1 from=0 to=1"]);
    const edited = mutate(document.objects, [{ kind: "setMathSource", objectId: named(document, "math_1").id, source: "y = b x" }], document.journal, context);
    if (!edited.ok) throw new Error(edited.message);
    const gained = { ...document, objects: edited.objects, journal: edited.journal };
    expect(samples(run(["set math_1.in.b 3"], gained)).at(-1)).toEqual({ x: 1, y: 3 });
    expect(samples(run(["set math_1.in.b 3", "set math_1.in.b 7"], gained)).at(-1)).toEqual({ x: 1, y: 7 });
  });

  it("leaves a gap where the export gives no finite number", () => {
    const points = samples(run(['math "y = 1 / x"', "plot math_1 from=-1 to=1"]));
    expect(points).toHaveLength(PLOT_SAMPLE_COUNT - 1);
    expect(points.some((point) => point.x === 0)).toBe(false);
  });

  it("says what is wrong when the variable names no input, or the range runs backwards", () => {
    const document = run(['math "y = x"', "plot math_1"]);
    expect(named(run(['set plot_1.variable "t"'], document), "plot_1").slots.samples?.value).toMatchObject({ error: "#TYPE", message: expect.stringContaining("variable") });
    expect(named(run(["set plot_1.xmin 20"], document), "plot_1").slots.samples?.value).toMatchObject({ error: "#TYPE", message: expect.stringContaining("xmax above xmin") });
  });

  it("refuses a plot of something other than a math object, and of a math object with nothing to graph", () => {
    expect(refusal(["rect x=0 y=0 w=10 h=10"], "plot rect_1")).toContain("graphs a math object");
    expect(refusal(['math "z = 1"'], "plot math_1")).toContain("needs a line that defines a name from an input");
  });

  it("holds the math object as an ordinary reader, so a delete of it refuses by name", () => {
    const document = run(['math "y = x"', "plot math_1"]);
    expect(refusal(['math "y = x"', "plot math_1"], "delete math_1")).toContain("plot_1.curve");
    expect(named(document, "plot_1").slots.box?.value).toEqual([{ x: 0, y: 0 }, { x: 320, y: 200 }]);
  });
});
