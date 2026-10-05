/**
 * rewire.test.ts
 *
 * These tests cover the plan for a rewire: the `set` line it writes, every
 * reference to the old address replaced, a range left alone, a text reader
 * and a reader with no formula refused, and the plan run through the command
 * line so a cycle refuses as any `set` does.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, readEdges, type Document, type Edge } from "../engine/index.ts";
import { executeCommand, isCommandFailure, type CommandOutcome } from "./commands.ts";
import { isCommandParseFailure, parseCommand } from "./parser.ts";
import { planRewire } from "./rewire.ts";

function run(line: string, document: Document): CommandOutcome {
  const parsed = parseCommand(line);
  if (isCommandParseFailure(parsed)) throw new Error(`"${line}" did not parse: ${parsed.message}`);
  return executeCommand(parsed.command, document);
}

function built(lines: readonly string[]): Document {
  let document = createEmptyDocument();
  for (const line of lines) {
    const outcome = run(line, document);
    if (isCommandFailure(outcome)) throw new Error(`"${line}" refused: ${outcome.message}`);
    document = outcome.document;
  }
  return document;
}

function idOf(document: Document, name: string): string {
  const object = document.objects.find((candidate) => candidate.name === name);
  if (object === undefined) throw new Error(`no object named ${name}`);
  return object.id;
}

/** The edge from one named object's slot to another's, as the overlay holds it. */
function edgeBetween(document: Document, source: string, reader: string, readerPath: string): Edge {
  const edge = readEdges(document.objects).find((candidate) =>
    candidate.sourceSlot.objectId === idOf(document, source) && candidate.dependentSlot.objectId === idOf(document, reader) && candidate.dependentSlot.path.join(".") === readerPath);
  if (edge === undefined) throw new Error(`no edge ${source} → ${reader}.${readerPath}`);
  return edge;
}

const BASE = [
  "circle x=0 y=0 r=10",
  "circle x=0 y=100 r=20",
  "circle x=300 y=0 r=5",
];

describe("planRewire", () => {
  it("writes a set line that replaces every reference to the old address", () => {
    const document = built([...BASE, "set circle_3.radius = circle_1.radius + circle_1.radius * 2"]);
    const plan = planRewire(document.objects, edgeBetween(document, "circle_1", "circle_3", "radius"), { objectId: idOf(document, "circle_2"), path: ["radius"] });
    expect(plan).toEqual({ ok: true, line: "set circle_3.radius = circle_2.radius + circle_2.radius * 2" });
    if (!plan.ok) return;
    const rewired = run(plan.line, document);
    expect(isCommandFailure(rewired)).toBe(false);
    if (isCommandFailure(rewired)) return;
    expect(rewired.document.objects.find((object) => object.name === "circle_3")?.slots.radius?.value).toBe(60);
  });

  it("leaves a range alone, and refuses an edge the formula reads only through one", () => {
    const document = built(["table x=0 y=0", "set table_1.A1 1", "set table_1.A2 2", "circle x=300 y=0 r=5", "set circle_1.radius = SUM(table_1.A1:table_1.A2) + table_1.A1"]);
    const cell = (name: string): { objectId: string; path: string[] } => ({ objectId: idOf(document, "table_1"), path: ["cells", name] });
    const viaReference = { sourceSlot: cell("A1"), dependentSlot: { objectId: idOf(document, "circle_1"), path: ["radius"] } };
    expect(planRewire(document.objects, viaReference, cell("B1"))).toEqual({ ok: true, line: "set circle_1.radius = SUM(table_1.A1:table_1.A2) + table_1.B1" });
    const viaRange = { sourceSlot: cell("A2"), dependentSlot: viaReference.dependentSlot };
    const refused = planRewire(document.objects, viaRange, cell("B2"));
    expect(refused.ok === false && refused.message).toContain("through a range");
  });

  it("refuses a text reader, a reader with no formula, and a move to the address already read", () => {
    const withText = built([...BASE, 'text x=0 y=300 "{= circle_1.radius}"']);
    const textEdge = edgeBetween(withText, "circle_1", "text_1", "resolvedContent");
    const text = planRewire(withText.objects, textEdge, { objectId: idOf(withText, "circle_2"), path: ["radius"] });
    expect(text.ok === false && text.message).toContain("text_1.content");

    const linked = built([...BASE, "set circle_3.radius = circle_1.radius"]);
    const edge = edgeBetween(linked, "circle_1", "circle_3", "radius");
    const same = planRewire(linked.objects, edge, edge.sourceSlot);
    expect(same.ok === false && same.message).toContain("already reads");
    const literal = { ...edge, dependentSlot: { objectId: idOf(linked, "circle_3"), path: ["origin", "x"] } };
    expect(planRewire(linked.objects, literal, { objectId: idOf(linked, "circle_2"), path: ["radius"] }).ok).toBe(false);
  });

  it("hands a rewire that would close a cycle to the set command, which refuses it with the ring", () => {
    const document = built([...BASE, "set circle_3.radius = circle_1.radius", "set circle_2.radius = circle_3.radius"]);
    const plan = planRewire(document.objects, edgeBetween(document, "circle_3", "circle_2", "radius"), { objectId: idOf(document, "circle_2"), path: ["area"] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const refused = run(plan.line, document);
    expect(isCommandFailure(refused) && refused.message).toContain("cyclic dependency");
    expect(isCommandFailure(refused) && refused.cycle?.length).toBeGreaterThan(0);
  });
});
