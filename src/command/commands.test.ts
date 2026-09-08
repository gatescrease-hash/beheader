/**
 * commands.test.ts
 *
 * Every handler, and the refusal message each one produces.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type Document } from "../engine/document.ts";
import type { EvalContext } from "../engine/eval-context.ts";
import { getSlot, type GraphObject, type Point } from "../engine/graph/node.ts";
import { mutate, type Operation } from "../engine/mutation.ts";
import { MAX_TABLE_LINES } from "../engine/primitives/table.ts";
import { hitTest } from "../render/hittest.ts";
import { INITIAL_INTERACTION_STATE, pointerDown, pointerMove } from "../render/interaction.ts";
import { COMMAND_NAMES, isCommandParseFailure, parseCommand, type Command } from "./parser.ts";
import { beginCommand, respond } from "./prompt.ts";
import { COMMANDS_WITH_HANDLERS, executeCommand, isCommandFailure, MAX_POLYGON_SIDES, type CommandOutcome } from "./commands.ts";

function parsed(line: string): Command {
  const result = parseCommand(line);
  if (isCommandParseFailure(result)) {
    throw new Error(`expected "${line}" to parse, got: ${result.message}`);
  }
  return result.command;
}

function run(line: string, document: Document): CommandOutcome {
  return executeCommand(parsed(line), document);
}

function committed(line: string, document: Document): Document {
  const outcome = run(line, document);
  if (isCommandFailure(outcome)) {
    throw new Error(`expected "${line}" to succeed, got: ${outcome.message}`);
  }
  return outcome.document;
}

function mutateOrThrow(document: Document, operations: readonly Operation[]): Document {
  const result = mutate(document.objects, operations, document.journal);
  if (!result.ok) {
    throw new Error(`test setup: expected the batch to succeed, got: ${result.message}`);
  }
  return { ...document, objects: result.objects, journal: result.journal };
}

function refused(line: string, document: Document): string {
  const outcome = run(line, document);
  if (!isCommandFailure(outcome)) {
    throw new Error(`expected "${line}" to be refused, but it committed`);
  }
  return outcome.message;
}

function onlyObject(document: Document): GraphObject {
  const object = document.objects[0];
  if (document.objects.length !== 1 || object === undefined) {
    throw new Error(`expected exactly one object, got ${document.objects.length}`);
  }
  return object;
}

function onlyNamed(document: Document, objectName: string): GraphObject {
  const object = document.objects.find((candidate) => candidate.name === objectName);
  if (object === undefined) {
    throw new Error(`expected an object named ${objectName}`);
  }
  return object;
}

function literalValue(object: GraphObject, path: readonly string[]): unknown {
  const slot = getSlot(object, path);
  return slot === undefined || slot.kind !== "literal" ? undefined : slot.value;
}

function verticesOf(object: GraphObject): readonly Point[] {
  const slot = getSlot(object, ["vertices"]);
  if (slot === undefined || slot.kind !== "derived" || !Array.isArray(slot.value)) {
    throw new Error(`expected ${object.name} to hold a derived vertices array, got ${JSON.stringify(slot)}`);
  }
  return slot.value;
}

describe("creation — a typed line becomes an object", () => {
  it("creates a circle with its three parameter slots literal, at the documented example line", () => {
    const object = onlyObject(committed("circle x=100 y=100 r=20", createEmptyDocument()));
    expect(object.type).toBe("circle");
    expect(object.name).toBe("circle_1");
    expect(literalValue(object, ["origin", "x"])).toBe(100);
    expect(literalValue(object, ["origin", "y"])).toBe(100);
    expect(literalValue(object, ["radius"])).toBe(20);
  });

  it("echoes the name it generated, because nothing else tells the operator what to type next", () => {
    const outcome = run("circle x=0 y=0 r=1", createEmptyDocument());
    expect(outcome.ok && outcome.lines).toEqual(["created circle_1"]);
  });

  it("leaves every derived slot EVALUATED, not null — step 7 runs inside the creating mutation, so a fresh circle already has its 32 vertices", () => {
    const object = onlyObject(committed("circle x=0 y=0 r=10", createEmptyDocument()));
    expect(verticesOf(object)).toHaveLength(32);
    expect(getSlot(object, ["area"])?.value).toBeCloseTo(0.5 * 32 * 100 * Math.sin((2 * Math.PI) / 32), 6);
  });

  it("creates a polygon with the number of vertices its sides argument asked for, and rotation defaulted to 0, because the command form gives no rotation", () => {
    const object = onlyObject(committed("polygon sides=5 x=0 y=0 r=50", createEmptyDocument()));
    expect(object.name).toBe("polygon_1");
    expect(literalValue(object, ["rotation"])).toBe(0);
    expect(verticesOf(object)).toHaveLength(5);
  });

  it("creates a rect whose derived area is width times height", () => {
    const object = onlyObject(committed("rect x=0 y=0 w=200 h=100", createEmptyDocument()));
    expect(object.name).toBe("rect_1");
    expect(verticesOf(object)).toHaveLength(4);
    expect(getSlot(object, ["area"])?.value).toBe(20000);
  });

  it("creates a polyline whose vertex slots hold the typed points, in order", () => {
    const object = onlyObject(committed("polyline 0,0 100,0 100,100", createEmptyDocument()));
    expect(object.type).toBe("polyline");
    expect(object.name).toBe("polyline_1");
    expect(object.vertexCount).toBe(3);
    expect(literalValue(object, ["vertex", "0", "x"])).toBe(0);
    expect(literalValue(object, ["vertex", "0", "y"])).toBe(0);
    expect(literalValue(object, ["vertex", "1", "x"])).toBe(100);
    expect(literalValue(object, ["vertex", "1", "y"])).toBe(0);
    expect(literalValue(object, ["vertex", "2", "x"])).toBe(100);
    expect(literalValue(object, ["vertex", "2", "y"])).toBe(100);
    expect(verticesOf(object)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it("gives a polyline a derived length that sums its segments and never closes back to the first point", () => {
    const object = onlyObject(committed("polyline 0,0 3,4 3,0", createEmptyDocument()));
    expect(getSlot(object, ["length"])?.value).toBeCloseTo(9);
    expect(getSlot(object, ["area"])).toBeUndefined();
  });

  it("refuses a polyline with fewer than two points, naming the count it got", () => {
    expect(refused("polyline 0,0", createEmptyDocument())).toContain("at least 2");
  });

  it("creates a table carrying its origin and both dimensions, and NO cell slots, because an absent cell is how a table spells empty", () => {
    const object = onlyObject(committed("table x=0 y=0 rows=8 cols=8", createEmptyDocument()));
    expect(object.type).toBe("table");
    expect(object.name).toBe("table_1");
    expect(literalValue(object, ["origin", "x"])).toBe(0);
    expect(literalValue(object, ["origin", "y"])).toBe(0);
    expect(literalValue(object, ["rows"])).toBe(8);
    expect(literalValue(object, ["cols"])).toBe(8);
    expect(Object.keys(object.slots).filter((key) => key.startsWith("cells."))).toEqual([]);
  });

  it("gives a table an origin its SCHEMA declares, so its position may be DRIVEN by a formula the way a polygon's already is", () => {
    const seeded: Document = {
      ...createEmptyDocument(),
      objects: [{ id: "obj_9", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 42 } } }],
      nextObjectId: 10,
    };
    const withTable = committed("table x=0 y=0 rows=1 cols=1", seeded);
    const table = withTable.objects[1];
    if (table === undefined) {
      throw new Error("test setup: expected the table to be the second object");
    }
    const bound = mutate(
      withTable.objects,
      [
        {
          kind: "setSlot",
          address: { objectId: table.id, path: ["origin", "x"] },
          slot: { kind: "formula", ast: { type: "reference", address: { objectId: "obj_9", path: ["value"] } }, value: null },
        },
      ],
      withTable.journal,
    );
    if (!bound.ok) {
      throw new Error(`expected the binding to commit, got: ${bound.message}`);
    }
    const boundTable = bound.objects[1];
    if (boundTable === undefined) {
      throw new Error("expected the table to survive the binding");
    }
    expect(getSlot(boundTable, ["origin", "x"])?.value).toBe(42);
  });

  it("takes the 8 by 8 default when rows and cols are omitted, because the parser supplied them", () => {
    const object = onlyObject(committed("table x=0 y=0", createEmptyDocument()));
    expect(literalValue(object, ["rows"])).toBe(8);
    expect(literalValue(object, ["cols"])).toBe(8);
  });

  it("accepts a negative radius and stores it — a value that computes to #TYPE is legitimate state, not a rejection", () => {
    const object = onlyObject(committed("circle x=0 y=0 r=-5", createEmptyDocument()));
    expect(literalValue(object, ["radius"])).toBe(-5);
    expect(getSlot(object, ["vertices"])?.value).toEqual({ error: "#TYPE", message: "circle.vertices: radius must not be negative" });
  });

  it("creates a text object with all eleven non-derived slots (origin.x, origin.y, content, and eight layout and style defaults) plus all three derived placeholders", () => {
    const object = onlyObject(committed('text x=10 y=20 "Radius is {= table_x.A1 }"', createEmptyDocument()));
    expect(object.type).toBe("text");
    expect(object.name).toBe("text_1");
    expect(literalValue(object, ["origin", "x"])).toBe(10);
    expect(literalValue(object, ["origin", "y"])).toBe(20);
    expect(literalValue(object, ["content"])).toBe("Radius is {= table_x.A1 }");
    expect(literalValue(object, ["width"])).toBe("auto");
    expect(literalValue(object, ["height"])).toBe("auto");
    expect(literalValue(object, ["autoresize"])).toBe(true);
    expect(getSlot(object, ["overflow"])).toBeUndefined();
    expect(literalValue(object, ["style", "font"])).toBe("sans-serif");
    expect(literalValue(object, ["style", "fontSize"])).toBe(16);
    expect(literalValue(object, ["style", "lineHeight"])).toBe(20);
    expect(literalValue(object, ["style", "color"])).toBe("black");
    expect(literalValue(object, ["style", "align"])).toBe("left");
    expect(getSlot(object, ["resolvedContent"])?.kind).toBe("derived");
    expect(getSlot(object, ["measuredHeight"])?.kind).toBe("derived");
    expect(getSlot(object, ["measuredWidth"])?.kind).toBe("derived");
  });

  it("defaults a text object's x and y to 0 when omitted — the geometry presets require theirs", () => {
    const object = onlyObject(committed('text "just text"', createEmptyDocument()));
    expect(literalValue(object, ["origin", "x"])).toBe(0);
    expect(literalValue(object, ["origin", "y"])).toBe(0);
  });

  it("stores a text object's content verbatim — markup and stray braces are not parsed at the command line", () => {
    const object = onlyObject(committed('text x=0 y=0 "{? x }a{:}b{?} literal { brace"', createEmptyDocument()));
    expect(literalValue(object, ["content"])).toBe("{? x }a{:}b{?} literal { brace");
  });

  it("evaluates a text object's resolvedContent inside the creating mutation — a plain string resolves to itself", () => {
    const object = onlyObject(committed('text x=0 y=0 "hello"', createEmptyDocument()));
    expect(getSlot(object, ["resolvedContent"])?.value).toBe("hello");
  });

  it("leaves a fresh text object's measuredHeight as #MEASURE under the default null EvalContext — legitimate state, not a refused creation", () => {
    const object = onlyObject(committed('text x=0 y=0 "hello"', createEmptyDocument()));
    expect(getSlot(object, ["measuredHeight"])?.value).toMatchObject({ error: "#MEASURE" });
    expect(getSlot(object, ["measuredWidth"])?.value).toMatchObject({ error: "#MEASURE" });
  });

  it("a text object created with a real measurer threaded carries a measured WIDTH as well as a height — the default DEFAULT_TEXT_WIDTH is \"auto\", so this is the normal path", () => {
    const measurer: EvalContext = { measurer: { measure: (text) => ({ width: text.length * 7, height: 20 }) } };
    const outcome = executeCommand(parsed('text x=0 y=0 "hello"'), createEmptyDocument(), measurer);
    if (isCommandFailure(outcome)) {
      throw new Error(outcome.message);
    }
    const object = onlyObject(outcome.document);
    expect(getSlot(object, ["measuredWidth"])?.value).toBe(35);
    expect(getSlot(object, ["measuredHeight"])?.value).toBe(20);
  });

  it("names text objects from their own sequence — text_1, text_2", () => {
    const document = committed('text x=0 y=0 "b"', committed('text x=0 y=0 "a"', createEmptyDocument()));
    expect(document.objects.map((object) => object.name)).toEqual(["text_1", "text_2"]);
  });

  it("a successful creation names the object it made in `createdObjectId`, so main.ts can open the editor on a fresh text box with no lookup", () => {
    const outcome = executeCommand(parsed('text x=1 y=2 ""'), createEmptyDocument());
    if (isCommandFailure(outcome)) {
      throw new Error(outcome.message);
    }
    expect(outcome.createdObjectId).toBe(onlyObject(outcome.document).id);
  });

  it("the point-placed form (buildFromPrompts) creates the box with empty content, ready for the in-place editor", () => {
    const started = beginCommand("text");
    if (started.status !== "prompting") {
      throw new Error(`expected a prompt, got ${started.status}`);
    }
    const finished = respond(started.pending, { kind: "picked", point: { x: 40, y: 55 } });
    if (finished.status !== "complete") {
      throw new Error(`expected completion, got ${finished.status}`);
    }
    const outcome = executeCommand(finished.command, createEmptyDocument());
    if (isCommandFailure(outcome)) {
      throw new Error(outcome.message);
    }
    const object = onlyObject(outcome.document);
    expect(literalValue(object, ["origin", "x"])).toBe(40);
    expect(literalValue(object, ["origin", "y"])).toBe(55);
    expect(literalValue(object, ["content"])).toBe("");
  });

  it("carries `createdObjectId` for every creation command, undefined for a non-creation one", () => {
    for (const line of ['circle x=0 y=0 r=1', 'rect x=0 y=0 w=1 h=1', 'table x=0 y=0', 'text x=0 y=0 ""', 'image x=0 y=0', 'script x=0 y=0']) {
      const outcome = executeCommand(parsed(line), createEmptyDocument());
      if (isCommandFailure(outcome)) {
        throw new Error(`${line}: ${outcome.message}`);
      }
      expect(outcome.createdObjectId).toBe(onlyObject(outcome.document).id);
    }
    const listed = executeCommand(parsed("list"), createEmptyDocument());
    expect(isCommandFailure(listed) ? undefined : listed.createdObjectId).toBeUndefined();
  });

  it("creates an image with all eight non-derived slots — the five the spec names plus `source`, `preserveAspect` and `pictureAspect` — and no derived ones", () => {
    const object = onlyObject(committed("image x=30 y=40", createEmptyDocument()));
    expect(object.type).toBe("image");
    expect(object.name).toBe("image_1");
    expect(literalValue(object, ["origin", "x"])).toBe(30);
    expect(literalValue(object, ["origin", "y"])).toBe(40);
    expect(literalValue(object, ["width"])).toBe(100);
    expect(literalValue(object, ["height"])).toBe(100);
    expect(literalValue(object, ["opacity"])).toBe(1);
    expect(literalValue(object, ["source"])).toBe("");
    expect(literalValue(object, ["preserveAspect"])).toBe(true);
    expect(literalValue(object, ["pictureAspect"])).toBe(0);
    expect(Object.keys(object.slots).sort()).toEqual(["height", "opacity", "origin.x", "origin.y", "pictureAspect", "preserveAspect", "source", "width"]);
  });

  it("gives an image the SAME origin paths every positioned object uses, so `link image_1.origin.x <cell>` commits", () => {
    const withTable = committed("table x=0 y=0 rows=1 cols=1", createEmptyDocument());
    const seeded = committed("set table_1.A1 42", withTable);
    const withImage = committed("image x=0 y=0", seeded);
    const linked = committed("link image_1.origin.x table_1.A1", withImage);
    const image = linked.objects.find((object) => object.name === "image_1");
    expect(image === undefined ? undefined : getSlot(image, ["origin", "x"])?.kind).toBe("formula");
    expect(image === undefined ? undefined : getSlot(image, ["origin", "x"])?.value).toBe(42);
  });

  it("accepts an opacity outside 0..1 — it sizes no slot family, so the count bound does not reach it, and the renderer clamps what it paints", () => {
    const document = committed("set image_1.opacity 4", committed("image x=0 y=0", createEmptyDocument()));
    expect(literalValue(onlyObject(document), ["opacity"])).toBe(4);
  });

  it("takes no size arguments — the form is `image x= y=` and nothing else, so a stray w= is a parse failure rather than a silent default", () => {
    const result = parseCommand("image x=0 y=0 w=50");
    expect(isCommandParseFailure(result) && result.message).toContain('"w"');
  });

  it("creates a script with its four static slots and no ports, which the next slice adds", () => {
    const object = onlyObject(committed("script x=30 y=40", createEmptyDocument()));
    expect(object.type).toBe("script");
    expect(object.name).toBe("script_1");
    expect(literalValue(object, ["origin", "x"])).toBe(30);
    expect(literalValue(object, ["origin", "y"])).toBe(40);
    expect(literalValue(object, ["language"])).toBe("python");
    expect(literalValue(object, ["source"])).toBe("");
    expect(object.ports).toBeUndefined();
    expect(Object.keys(object.slots).sort()).toEqual(["language", "origin.x", "origin.y", "source"]);
  });

  it("gives a script the SAME origin paths every positioned object uses, so `link script_1.origin.x <cell>` commits", () => {
    const withTable = committed("table x=0 y=0 rows=1 cols=1", createEmptyDocument());
    const seeded = committed("set table_1.A1 42", withTable);
    const withScript = committed("script x=0 y=0", seeded);
    const linked = committed("link script_1.origin.x table_1.A1", withScript);
    const script = linked.objects.find((object) => object.name === "script_1");
    expect(script === undefined ? undefined : getSlot(script, ["origin", "x"])?.kind).toBe("formula");
    expect(script === undefined ? undefined : getSlot(script, ["origin", "x"])?.value).toBe(42);
  });

  it("takes no other arguments — the form is `script x= y=` and nothing else", () => {
    const result = parseCommand("script x=0 y=0 language=python");
    expect(isCommandParseFailure(result) && result.message).toContain('"language"');
  });

  it("declares an in/out port through the existing addPort mutation, then reads/writes it exactly like any other declared slot, which is the acceptance shape at the mutation layer", () => {
    const withScript = committed("script x=0 y=0", createEmptyDocument());
    const script = onlyNamed(withScript, "script_1");

    const withIn = mutateOrThrow(withScript, [
      { kind: "addPort", objectId: script.id, family: "in", name: "factor" },
      { kind: "setSlot", address: { objectId: script.id, path: ["in", "factor"] }, slot: { kind: "literal", value: 7 } },
    ]);
    expect(literalValue(onlyNamed(withIn, "script_1"), ["in", "factor"])).toBe(7);

    const withOut = mutateOrThrow(withIn, [
      { kind: "addPort", objectId: script.id, family: "out", name: "result" },
      { kind: "setSlot", address: { objectId: script.id, path: ["placeholder", "result"] }, slot: { kind: "literal", value: 0 } },
      { kind: "setSlot", address: { objectId: script.id, path: ["out", "result"] }, slot: { kind: "derived", value: null } },
    ]);

    const withPlaceholder = committed("set script_1.placeholder.result 99", withOut);
    expect(getSlot(onlyNamed(withPlaceholder, "script_1"), ["out", "result"])?.value).toBe(99);
  });

  it("Phase 6's acceptance criterion, its exact shape: a table cell drives script_1.in.factor, another object's slot is bound to script_1.out.result, and moving the placeholder moves that object — with no script-specific code in eval.ts", () => {
    const withTable = committed("table x=0 y=0 rows=1 cols=1", createEmptyDocument());
    const seeded = committed("set table_1.A1 3", withTable);
    const withScript = committed("script x=0 y=0", seeded);
    const script = onlyNamed(withScript, "script_1");

    const withIn = mutateOrThrow(withScript, [{ kind: "addPort", objectId: script.id, family: "in", name: "factor" }]);
    const linkedIn = committed("link script_1.in.factor table_1.A1", withIn);
    expect(literalValue(onlyNamed(linkedIn, "script_1"), ["in", "factor"])).toBeUndefined();
    expect(getSlot(onlyNamed(linkedIn, "script_1"), ["in", "factor"])?.value).toBe(3);

    const withOut = mutateOrThrow(linkedIn, [
      { kind: "addPort", objectId: script.id, family: "out", name: "result" },
      { kind: "setSlot", address: { objectId: script.id, path: ["placeholder", "result"] }, slot: { kind: "literal", value: 10 } },
      { kind: "setSlot", address: { objectId: script.id, path: ["out", "result"] }, slot: { kind: "derived", value: null } },
    ]);
    const withPolygon = committed("polygon sides=5 x=0 y=0 r=1", withOut);
    const linkedOut = committed("link polygon_1.radius script_1.out.result", withPolygon);
    expect(getSlot(onlyNamed(linkedOut, "polygon_1"), ["radius"])?.value).toBe(10);

    const moved = committed("set script_1.placeholder.result 25", linkedOut);
    expect(getSlot(onlyNamed(moved, "polygon_1"), ["radius"])?.value).toBe(25);
    expect(getSlot(onlyNamed(moved, "script_1"), ["out", "result"])?.value).toBe(25);

    const cellChanged = committed("set table_1.A1 7", moved);
    expect(getSlot(onlyNamed(cellChanged, "script_1"), ["in", "factor"])?.value).toBe(7);
  });
});

describe("addport / removeport — ports that the operator declares", () => {
  function withScript(): Document {
    return committed("script x=0 y=0", createEmptyDocument());
  }

  it("declares an IN port and writes its slot in the same batch, so the port and the thing it names arrive together", () => {
    const after = committed("addport script_1.in.factor", withScript());
    const script = onlyNamed(after, "script_1");
    expect(script.ports?.in).toEqual(["factor"]);
    expect(getSlot(script, ["in", "factor"])).toEqual({ kind: "literal", value: null });
  });

  it("declares an OUT port with BOTH slots it implies — the derived `out.<port>` and the `placeholder.<port>` its compute reads", () => {
    const after = committed("addport script_1.out.result", withScript());
    const script = onlyNamed(after, "script_1");
    expect(script.ports?.out).toEqual(["result"]);
    expect(getSlot(script, ["placeholder", "result"])).toEqual({ kind: "literal", value: null });
    expect(getSlot(script, ["out", "result"])?.kind).toBe("derived");
  });

  it("lets an out port be declared FIRST and an in port after, which the raw operations alone cannot do", () => {
    const withOut = committed("addport script_1.out.result", withScript());
    const both = committed("addport script_1.in.factor", withOut);
    expect(onlyNamed(both, "script_1").ports).toEqual({ in: ["factor"], out: ["result"] });
  });

  it("tells the operator what to do next, naming the exact line that fills the port", () => {
    const outcome = run("addport script_1.out.result", withScript());
    expect(isCommandFailure(outcome) ? "" : outcome.lines.join("\n")).toContain("set script_1.placeholder.result <value>");
  });

  it("refuses a port on anything but a script node, naming the type it actually got", () => {
    const withCircle = committed("circle x=0 y=0 r=5", createEmptyDocument());
    expect(refused("addport circle_1.in.factor", withCircle)).toContain('is a "circle" object');
  });

  it("refuses a family that is neither in nor out, and an address that names no port at all", () => {
    expect(refused("addport script_1.sideways.factor", withScript())).toContain('"sideways" is not a port family');
    expect(refused("addport script_1.factor", withScript())).toContain("does not name a port");
  });

  it("refuses a duplicate port, through the check in mutate rather than a second one here", () => {
    const once = committed("addport script_1.in.factor", withScript());
    expect(refused("addport script_1.in.factor", once)).not.toBe("");
    expect(onlyNamed(once, "script_1").ports?.in).toEqual(["factor"]);
  });

  it("removes a port and its derived `out.<port>` slot, while the placeholder deliberately OUTLIVES it", () => {
    const added = committed("addport script_1.out.result", withScript());
    const valued = committed("set script_1.placeholder.result 42", added);
    const removed = committed("removeport script_1.out.result", valued);
    const script = onlyNamed(removed, "script_1");
    expect(script.ports?.out ?? []).toEqual([]);
    expect(getSlot(script, ["out", "result"])).toBeUndefined();
    expect(getSlot(script, ["placeholder", "result"])).toEqual({ kind: "literal", value: 42 });
  });

  it("gives the operator their stub value BACK when a removed port is re-added, rather than silently resetting it to nothing", () => {
    const added = committed("addport script_1.out.result", withScript());
    const valued = committed("set script_1.placeholder.result 42", added);
    const readded = committed("addport script_1.out.result", committed("removeport script_1.out.result", valued));
    const script = onlyNamed(readded, "script_1");
    expect(getSlot(script, ["placeholder", "result"])).toEqual({ kind: "literal", value: 42 });
    expect(getSlot(script, ["out", "result"])?.value).toBe(42);
  });

  it("REFUSES to remove an out port another object still reads, rather than silently breaking that formula", () => {
    const added = committed("addport script_1.out.result", withScript());
    const seeded = committed("set script_1.placeholder.result 10", added);
    const withPolygon = committed("polygon sides=5 x=0 y=0 r=1", seeded);
    const linked = committed("link polygon_1.radius script_1.out.result", withPolygon);
    expect(refused("removeport script_1.out.result", linked)).toContain("polygon_1.radius");
    expect(getSlot(onlyNamed(linked, "polygon_1"), ["radius"])?.value).toBe(10);
  });

  it("refuses to remove a port that is not there, naming the family", () => {
    expect(refused("removeport script_1.in.absent", withScript())).toContain('has no in port named "absent"');
  });

  it("the acceptance criterion for the script node, typed the way a person enters it", () => {
    let document = createEmptyDocument();
    for (const line of [
      "table x=0 y=0 rows=1 cols=1",
      "set table_1.A1 3",
      "script x=0 y=0",
      "addport script_1.in.factor",
      "link script_1.in.factor table_1.A1",
      "addport script_1.out.result",
      "set script_1.placeholder.result 10",
      "polygon sides=5 x=0 y=0 r=1",
      "link polygon_1.radius script_1.out.result",
    ]) {
      document = committed(line, document);
    }
    expect(getSlot(onlyNamed(document, "polygon_1"), ["radius"])?.value).toBe(10);

    const moved = committed("set script_1.placeholder.result 25", document);
    expect(getSlot(onlyNamed(moved, "polygon_1"), ["radius"])?.value).toBe(25);

    const cellChanged = committed("set table_1.A1 7", moved);
    expect(getSlot(onlyNamed(cellChanged, "script_1"), ["in", "factor"])?.value).toBe(7);
  });

  it("shows a declared port in `props`, so an operator can see the port they just made, while a table still shows a summary of its cells", () => {
    const added = committed("addport script_1.in.factor", withScript());
    const outcome = run("props script_1", committed("addport script_1.out.result", added));
    const lines = isCommandFailure(outcome) ? "" : outcome.lines.join("\n");
    expect(lines).toContain("in.factor");
    expect(lines).toContain("placeholder.result");
    expect(lines).toContain("out.result");
  });
});

describe("the `content` slot of a text object takes a literal only", () => {
  function docWithTextObject(): Document {
    return committed('text x=0 y=0 "hello"', createEmptyDocument());
  }

  it("refuses `link text_1.content <address>` — content is read as raw source before any formula value exists, so its embedded references could not be tracked", () => {
    const message = refused("link text_1.content some.slot", docWithTextObject());
    expect(message).toContain("raw source only");
    expect(message).toContain("cannot be a formula or a link");
  });

  it("refuses `set text_1.content = <formula>` for the same reason a table dimension does", () => {
    const message = refused("set text_1.content = 1 + 1", docWithTextObject());
    expect(message).toContain("cannot be a formula or a link");
  });

  it("the refusal fires before the formula is even parsed — an unresolvable source in the link still gets the literal only message, not a #PARSE", () => {
    expect(refused("link text_1.content nonexistent.slot", docWithTextObject())).toContain("cannot be a formula or a link");
  });

  it("still accepts a plain literal `set text_1.content \"...\"` — that is how content is authored", () => {
    const document = committed('set text_1.content "brand new"', docWithTextObject());
    expect(literalValue(onlyNamed(document, "text_1"), ["content"])).toBe("brand new");
  });

  it("keeps a quoted string that merely looks like a formula as a literal — quoting decides type", () => {
    const document = committed('set text_1.content "= not a formula"', docWithTextObject());
    expect(literalValue(onlyNamed(document, "text_1"), ["content"])).toBe("= not a formula");
  });

  it("does not constrain a text object's other slots — style.fontSize can still be linked to a cell", () => {
    const withTable = committed("table x=0 y=0 rows=1 cols=1", docWithTextObject());
    const seeded = committed("set table_1.A1 18", withTable);
    const linked = committed("link text_1.style.fontSize table_1.A1", seeded);
    expect(getSlot(onlyNamed(linked, "text_1"), ["style", "fontSize"])?.kind).toBe("formula");
  });
});

describe("identity — ids and names", () => {
  it("mints a fresh id per object and advances the document's own counter, never reusing one", () => {
    const first = committed("circle x=0 y=0 r=1", createEmptyDocument());
    const second = committed("circle x=1 y=1 r=1", first);
    expect(second.objects.map((object) => object.id)).toEqual(["obj_1", "obj_2"]);
    expect(second.nextObjectId).toBe(3);
  });

  it("counts default names up per type, so two circles are circle_1 and circle_2", () => {
    const second = committed("circle x=1 y=1 r=1", committed("circle x=0 y=0 r=1", createEmptyDocument()));
    expect(second.objects.map((object) => object.name)).toEqual(["circle_1", "circle_2"]);
  });

  it("names each type from its own sequence — a circle does not push the first polygon past polygon_1", () => {
    const document = committed("polygon sides=3 x=0 y=0 r=1", committed("circle x=0 y=0 r=1", createEmptyDocument()));
    expect(document.objects.map((object) => object.name)).toEqual(["circle_1", "polygon_1"]);
  });

  it("skips a default name already in use rather than colliding with it", () => {
    const seeded: Document = {
      ...createEmptyDocument(),
      objects: [{ id: "obj_99", name: "circle_1", type: "value", slots: { value: { kind: "literal", value: 1 } } }],
      nextObjectId: 100,
    };
    expect(committed("circle x=0 y=0 r=1", seeded).objects[1]?.name).toBe("circle_2");
  });

  it("does NOT advance the counter when the creation is refused — a rejected command takes no id", () => {
    const document = createEmptyDocument();
    expect(refused("polygon sides=2 x=0 y=0 r=1", document)).toContain("sides");
    expect(document.nextObjectId).toBe(1);
    expect(document.objects).toEqual([]);
  });

  it("leaves the caller's own document untouched on success — the returned one is new, and prior state is the same reference (Rule 2)", () => {
    const before = createEmptyDocument();
    const after = committed("circle x=0 y=0 r=1", before);
    expect(before.objects).toEqual([]);
    expect(before.nextObjectId).toBe(1);
    expect(after).not.toBe(before);
  });

  it("appends exactly one journal entry per committed command, holding the operation that ran (Rule 2)", () => {
    const document = committed("circle x=0 y=0 r=1", createEmptyDocument());
    expect(document.journal).toHaveLength(1);
    expect(document.journal[0]?.operations.map((operation) => operation.kind)).toEqual(["createObject"]);
  });
});

describe("a creation count is bounded by the HANDLER, and out of range REJECTS", () => {
  it("refuses sides below the minimum, naming the argument and the range", () => {
    expect(refused("polygon sides=2 x=0 y=0 r=1", createEmptyDocument())).toBe(`sides must be a whole number from 3 to ${MAX_POLYGON_SIDES}, got 2`);
  });

  it("refuses a fractional sides count, because a slot count is not a value that can be rounded on the operator's behalf", () => {
    expect(refused("polygon sides=2.5 x=0 y=0 r=1", createEmptyDocument())).toContain("got 2.5");
  });

  it("refuses sides above the maximum but accepts the maximum itself", () => {
    expect(refused(`polygon sides=${MAX_POLYGON_SIDES + 1} x=0 y=0 r=1`, createEmptyDocument())).toContain("must be a whole number");
    expect(verticesOf(onlyObject(committed(`polygon sides=${MAX_POLYGON_SIDES} x=0 y=0 r=1`, createEmptyDocument())))).toHaveLength(MAX_POLYGON_SIDES);
  });

  it("refuses a table row count that would allocate an unbounded slot family, and creates nothing at all", () => {
    const document = createEmptyDocument();
    expect(refused("table x=0 y=0 rows=1000000 cols=8", document)).toContain("rows must be a whole number");
    expect(document.objects).toEqual([]);
  });

  it("names BOTH dimensions when both are out of range, rather than sending the operator back twice", () => {
    const message = refused("table x=0 y=0 rows=0 cols=-1", createEmptyDocument());
    expect(message).toContain("rows must be a whole number from 1 to");
    expect(message).toContain("cols must be a whole number from 1 to");
  });

  it("accepts a 1x1 table and a maximum-sized dimension — the bounds are inclusive", () => {
    expect(literalValue(onlyObject(committed("table x=0 y=0 rows=1 cols=1", createEmptyDocument())), ["rows"])).toBe(1);
    expect(literalValue(onlyObject(committed(`table x=0 y=0 rows=1 cols=${MAX_TABLE_LINES}`, createEmptyDocument())), ["cols"])).toBe(MAX_TABLE_LINES);
  });

  it("leaves a COORDINATE unbounded — only a count decides how many slots exist", () => {
    expect(literalValue(onlyObject(committed("circle x=-99999999 y=99999999 r=1", createEmptyDocument())), ["origin", "x"])).toBe(-99999999);
  });
});

describe("the rows and cols of a table are bounded at every write, not only at creation", () => {
  function seeded(): Document {
    return committed("table x=0 y=0 rows=3 cols=3", createEmptyDocument());
  }

  it("refuses set table_1.rows = 5 — a formula there would let evaluation resize the table (Rule 6), and the table is untouched", () => {
    const document = seeded();
    const message = refused("set table_1.rows = 5", document);
    expect(message).toContain("table_1.rows");
    expect(message).toContain("Rule 6");
    expect(literalValue(onlyNamed(document, "table_1"), ["rows"])).toBe(3);
  });

  it("refuses set table_1.rows 0 — below the minimum, and the table is untouched", () => {
    const document = seeded();
    expect(refused("set table_1.rows 0", document)).toContain("table_1.rows must be a whole number from 1 to");
    expect(literalValue(onlyNamed(document, "table_1"), ["rows"])).toBe(3);
  });

  it("refuses set table_1.rows -2 — negative, and the table is untouched", () => {
    const document = seeded();
    expect(refused("set table_1.rows -2", document)).toContain("table_1.rows");
    expect(literalValue(onlyNamed(document, "table_1"), ["rows"])).toBe(3);
  });

  it("refuses set table_1.rows 2.5 — non-integer, and the table is untouched", () => {
    const document = seeded();
    expect(refused("set table_1.rows 2.5", document)).toContain("table_1.rows");
    expect(literalValue(onlyNamed(document, "table_1"), ["rows"])).toBe(3);
  });

  it("refuses the identical four shapes for cols, symmetric to rows", () => {
    const document = seeded();
    expect(refused("set table_1.cols 0", document)).toContain("table_1.cols");
  });

  it("a legal set table_1.rows 5 still commits and GROWS the table's declared extent", () => {
    const after = committed("set table_1.rows 5", seeded());
    expect(literalValue(onlyNamed(after, "table_1"), ["rows"])).toBe(5);
    const withCell = committed("set table_1.A5 1", after);
    expect(literalValue(onlyNamed(withCell, "table_1"), ["cells", "A5"])).toBe(1);
  });
});

describe("a mutate rejection reaches the operator as a message, never as a throw", () => {
  it("reports a coordinate that overflowed to a non-finite number, and commits nothing", () => {
    const document = createEmptyDocument();
    const overflowing = `circle x=${"1".repeat(400)} y=0 r=1`;
    const message = refused(overflowing, document);
    expect(message).toContain("Infinity");
    expect(document.objects).toEqual([]);
  });
});

describe("every registry command reaches a handler", () => {
  it("routes every word the parser can produce, so a new registry entry cannot land unrouted", () => {
    expect([...COMMANDS_WITH_HANDLERS].sort()).toEqual([...COMMAND_NAMES].sort());
  });

  const EVERY_REGISTRY_EXAMPLE: readonly string[] = [
    "circle x=0 y=0 r=1",
    "polygon sides=3 x=0 y=0 r=1",
    "rect x=0 y=0 w=1 h=1",
    "polyline 0,0 1,1",
    'text x=0 y=0 "hi"',
    "table x=0 y=0",
    "image x=0 y=0",
    "script x=0 y=0",
    "set polygon_1.radius 42",
    "set polygon_1.radius = 1 + 1",
    "link polygon_1.origin.x table_x.A1",
    "unlink polygon_1.origin.x",
    "clear table_x.A1",
    "addport script_1.in.factor",
    "removeport script_1.out.result",
    "rename intersection_a polygon_9",
    "delete intersection_a",
    "addvertex polyline_1 0,0",
    "delvertex polyline_1 0",
    "refs intersection_a",
    "props intersection_a",
    "list",
    "select intersection_a",
    "zoom 2",
    "fit",
    "save",
    "load",
  ];

  it("never throws for any command in the registry, run against an empty document — every word, not a sample of them", () => {
    for (const line of EVERY_REGISTRY_EXAMPLE) {
      expect(() => run(line, createEmptyDocument())).not.toThrow();
    }
  });

  it("draws that sweep from the whole registry, so a command word cannot be added without landing in it", () => {
    const swept = new Set(EVERY_REGISTRY_EXAMPLE.map((line) => line.split(" ")[0]));
    expect([...swept].sort()).toEqual([...COMMAND_NAMES].sort());
  });
});

describe("the effect commands — select, zoom, fit, save, load", () => {
  function sandbox(): Document {
    return committed("table x=0 y=0 rows=2 cols=2", committed("polygon sides=5 x=10 y=20 r=50", createEmptyDocument()));
  }

  function succeeded(line: string, document: Document) {
    const outcome = run(line, document);
    if (isCommandFailure(outcome)) {
      throw new Error(`expected "${line}" to succeed, got: ${outcome.message}`);
    }
    return outcome;
  }

  describe("select", () => {
    it("resolves the name HERE and returns the ID, because a name is mutable and main.ts must not resolve one", () => {
      const document = sandbox();
      const outcome = succeeded("select polygon_1", document);
      expect(outcome.effect).toEqual({ kind: "select", objectId: onlyNamed(document, "polygon_1").id });
      expect(outcome.lines).toEqual(["selected polygon_1"]);
    });

    it("resolves case-insensitively, the same lookup that delete and rename use", () => {
      const document = sandbox();
      expect(succeeded("select POLYGON_1", document).effect).toEqual({ kind: "select", objectId: onlyNamed(document, "polygon_1").id });
    });

    it("refuses an unknown name here rather than handing main.ts an effect it cannot check", () => {
      expect(refused("select nosuch", sandbox())).toBe('no object named "nosuch"');
    });

    it("returns the document it was given, by identity — nothing about the selection is document state", () => {
      const document = sandbox();
      expect(succeeded("select table_1", document).document).toBe(document);
    });
  });

  describe("zoom", () => {
    it("passes the factor through untouched, because the clamp to [MIN_ZOOM, MAX_ZOOM] is render/camera.ts's", () => {
      const outcome = succeeded("zoom 2", createEmptyDocument());
      expect(outcome.effect).toEqual({ kind: "zoom", factor: 2 });
      expect(outcome.lines).toEqual(["zoom by 2"]);
    });

    it("accepts a factor below 1, which is zooming out and not an error", () => {
      expect(succeeded("zoom 0.5", createEmptyDocument()).effect).toEqual({ kind: "zoom", factor: 0.5 });
    });

    it("returns the document it was given, by identity — Document.camera is written by main.ts, never here", () => {
      const document = sandbox();
      expect(succeeded("zoom 2", document).document).toBe(document);
    });

    it("needs no objects — an empty document still has a camera", () => {
      expect(succeeded("zoom 3", createEmptyDocument()).effect).toEqual({ kind: "zoom", factor: 3 });
    });

    for (const factor of ["0", "-2", "0.0", "-0.5", "9".repeat(400)]) {
      it(`refuses "zoom ${factor.slice(0, 12)}", which is not a multiplier and would reach the camera's clamp as a silent no-op`, () => {
        expect(refused(`zoom ${factor}`, createEmptyDocument())).toContain("factor must be a positive number");
      });
    }

    it("names the offending factor in the refusal, because every refusal names what it is about", () => {
      expect(refused("zoom -2", createEmptyDocument())).toBe("factor must be a positive number, got -2");
    });
  });

  describe("fit", () => {
    it("carries an effect with no payload — the extent is render/'s geometry and never travels in one", () => {
      const outcome = succeeded("fit", sandbox());
      expect(outcome.effect).toEqual({ kind: "fit" });
      expect(outcome.lines).toEqual(["fit to the document extent"]);
    });

    it("refuses an empty document, rather than reporting success over an extent that does not exist", () => {
      expect(refused("fit", createEmptyDocument())).toBe("no objects to fit — create one first");
    });

    it("returns the document it was given, by identity — the extent is render/'s to compute, and nothing here writes one", () => {
      const document = sandbox();
      expect(succeeded("fit", document).document).toBe(document);
    });
  });

  describe("save and load", () => {
    it("save asks for the write and serializes nothing here — the outcome's own document is the one to write", () => {
      const document = sandbox();
      const outcome = succeeded("save", document);
      expect(outcome.effect).toEqual({ kind: "save" });
      expect(outcome.document).toBe(document);
      expect(outcome.lines).toEqual(["saving document"]);
    });

    it("load returns the CURRENT document unchanged, because reading a file is asynchronous and DOM-driven", () => {
      const document = sandbox();
      const outcome = succeeded("load", document);
      expect(outcome.effect).toEqual({ kind: "load" });
      expect(outcome.document).toBe(document);
      expect(outcome.lines).toEqual(["loading document"]);
    });

    it("save is allowed on an empty document — an empty document is a document", () => {
      expect(succeeded("save", createEmptyDocument()).effect).toEqual({ kind: "save" });
    });
  });

  describe("who carries an effect at all", () => {
    it("gives list and refs NONE, because their answer is lines", () => {
      const document = sandbox();
      expect(succeeded("list", document).effect).toBeUndefined();
      expect(succeeded("refs polygon_1", document).effect).toBeUndefined();
    });

    it("gives a command that CHANGES the document none either — the new document is the whole result", () => {
      expect(succeeded("circle x=0 y=0 r=1", createEmptyDocument()).effect).toBeUndefined();
      expect(succeeded("set polygon_1.radius 9", sandbox()).effect).toBeUndefined();
    });

    it("is plain, serializable data — no function survives a JSON round trip, so this pins the rule mechanically", () => {
      const document = sandbox();
      for (const line of ["select polygon_1", "zoom 2", "fit", "save", "load"]) {
        const effect = succeeded(line, document).effect;
        expect(JSON.parse(JSON.stringify(effect))).toEqual(effect);
      }
    });
  });
});

describe("end to end — a typed line, and a picked one, reach the same object", () => {
  it("runs a table-creation line through beginCommand into a document the render layer can hit-test at the origin it named", () => {
    const session = beginCommand("table x=40 y=20 rows=2 cols=3");
    if (session.status !== "complete") {
      throw new Error(`expected a complete command, got ${session.status}`);
    }
    const outcome = executeCommand(session.command, createEmptyDocument());
    if (isCommandFailure(outcome)) {
      throw new Error(`expected the table to commit, got: ${outcome.message}`);
    }
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(hitTest({ x: 41, y: 21 }, outcome.document.objects, camera)?.name).toBe("table_1");
    expect(hitTest({ x: 39, y: 19 }, outcome.document.objects, camera)).toBeUndefined();
  });

  it("makes a command-created table draggable, because its origin slots are the ones the per component rule writes", () => {
    const document = committed("table x=40 y=20 rows=2 cols=3", createEmptyDocument());
    const camera = { x: 0, y: 0, zoom: 1 };
    const pressed = pointerDown(INITIAL_INTERACTION_STATE, { x: 41, y: 21 }, document.objects, camera);
    const moved = pointerMove(pressed, { x: 51, y: 26 }, document.objects, document.journal, camera);
    expect(moved.rejection).toBeUndefined();
    expect(moved.notices).toEqual([]);
    const dragged = moved.objects.find((object) => object.name === "table_1");
    expect(dragged === undefined ? undefined : literalValue(dragged, ["origin", "x"])).toBe(50);
    expect(dragged === undefined ? undefined : literalValue(dragged, ["origin", "y"])).toBe(25);
  });

  it("produces the same circle from the prompt sequence as from the key=value form, because both build one Command", () => {
    const typed = committed("circle x=100 y=100 r=20", createEmptyDocument());

    const started = beginCommand("circle");
    if (started.status !== "prompting") {
      throw new Error(`expected a prompt, got ${started.status}`);
    }
    const afterCenter = respond(started.pending, { kind: "picked", point: { x: 100, y: 100 } });
    if (afterCenter.status !== "prompting") {
      throw new Error(`expected a second prompt, got ${afterCenter.status}`);
    }
    const finished = respond(afterCenter.pending, { kind: "picked", point: { x: 120, y: 100 } });
    if (finished.status !== "complete") {
      throw new Error(`expected the sequence to complete, got ${finished.status}`);
    }
    const pickedOutcome = executeCommand(finished.command, createEmptyDocument());
    if (isCommandFailure(pickedOutcome)) {
      throw new Error(`expected the picked circle to commit, got: ${pickedOutcome.message}`);
    }
    expect(onlyObject(pickedOutcome.document)).toEqual(onlyObject(typed));
  });
});

describe("the slot commands — set, link, unlink", () => {
  function sandbox(): Document {
    return committed("table x=0 y=0 rows=4 cols=4", committed("polygon sides=5 x=10 y=20 r=50", createEmptyDocument()));
  }

  function slotOf(document: Document, objectName: string, path: readonly string[]) {
    const object = document.objects.find((candidate) => candidate.name === objectName);
    if (object === undefined) {
      throw new Error(`test setup: no object named ${objectName}`);
    }
    return getSlot(object, path);
  }

  describe("set writes a literal", () => {
    it("replaces a literal slot's value and echoes what it wrote", () => {
      const outcome = run("set polygon_1.radius 42", sandbox());
      expect(outcome.ok && outcome.lines).toEqual(["polygon_1.radius = 42"]);
      expect(slotOf(committed("set polygon_1.radius 42", sandbox()), "polygon_1", ["radius"])).toEqual({ kind: "literal", value: 42 });
    });

    it("CREATES a table cell slot that did not exist, which is how an absent cell gets written at all", () => {
      const before = sandbox();
      expect(slotOf(before, "table_1", ["cells", "A1"])).toBeUndefined();
      expect(slotOf(committed("set table_1.A1 5", before), "table_1", ["cells", "A1"])).toEqual({ kind: "literal", value: 5 });
    });

    it("accepts a lowercase cell reference and writes the SAME slot as the uppercase one", () => {
      expect(slotOf(committed("set table_1.a1 5", sandbox()), "table_1", ["cells", "A1"])).toEqual({ kind: "literal", value: 5 });
    });

    it("writes a string and a boolean, the other two Values a command line can express", () => {
      const document = committed('set table_1.B2 "hello"', sandbox());
      expect(slotOf(document, "table_1", ["cells", "B2"])?.value).toBe("hello");
      expect(slotOf(committed("set table_1.B3 TRUE", document), "table_1", ["cells", "B3"])?.value).toBe(true);
    });
  });

  describe("what a slot command refuses (the handler owns an identity failure)", () => {
    it("refuses an unknown object name with parseAddress's own message", () => {
      expect(refused("set nosuch.radius 1", sandbox())).toBe('no object named "nosuch"');
    });

    it("refuses a DERIVED slot, naming it, because the schema fixes a derived slot and nothing converts it", () => {
      expect(refused("set polygon_1.area 1", sandbox())).toContain("polygon_1.area is a derived slot");
      expect(refused("link polygon_1.area table_1.A1", sandbox())).toContain("polygon_1.area is a derived slot");
    });

    it("refuses a path the object's type does not declare, rather than quietly creating a literal slot nothing reads", () => {
      expect(refused("set polygon_1.radius2 1", sandbox())).toBe('polygon_1 has no slot at "polygon_1.radius2" — object type "polygon" does not declare one');
    });

    it("refuses a cell outside the table's own extent, because a 4x4 table declares cells only up to D4", () => {
      expect(refused("set table_1.A99 1", sandbox())).toContain("has no slot at");
      expect(slotOf(committed("set table_1.D4 1", sandbox()), "table_1", ["cells", "D4"])?.value).toBe(1);
    });

    it("passes a mutate rejection through as a message and commits nothing (Rule 2's all-or-nothing)", () => {
      const document = sandbox();
      const message = refused(`set polygon_1.radius ${"1".repeat(400)}`, document);
      expect(message).toContain("Infinity");
      expect(slotOf(document, "polygon_1", ["radius"])?.value).toBe(50);
    });
  });

  describe("set writes a FORMULA when the value position begins with =", () => {
    it("stores a formula slot and lets step 7 of the same mutation evaluate it — no caller ever sees the null", () => {
      const document = committed("set table_1.A1 = 2 + 3 * 4", sandbox());
      const slot = slotOf(document, "table_1", ["cells", "A1"]);
      expect(slot?.kind).toBe("formula");
      expect(slot?.value).toBe(14);
    });

    it("echoes the formula back through the CURRENT names, which is the only form of its source that exists", () => {
      const outcome = run("set table_1.A1 = polygon_1.origin.x * 2", sandbox());
      expect(outcome.ok && outcome.lines).toEqual(["table_1.A1 = polygon_1.origin.x * 2"]);
    });

    it("resolves a BARE cell ref when the target is a cell of that table, and refuses one when it is not", () => {
      const seeded = committed("set table_1.A1 7", sandbox());
      expect(slotOf(committed("set table_1.B1 = A1 + 1", seeded), "table_1", ["cells", "B1"])?.value).toBe(8);
      expect(refused("set polygon_1.radius = A1", seeded)).toContain("A1");
    });

    it("accepts a formula containing a quoted string, because the command lexer stops at the =", () => {
      expect(slotOf(committed('set table_1.A1 = CONCAT("a", "b")', sandbox()), "table_1", ["cells", "A1"])?.value).toBe("ab");
    });

    it("rejects a cycle at mutation time and never stores it", () => {
      const seeded = committed("set table_1.A1 = table_1.B1", committed("set table_1.B1 1", sandbox()));
      expect(refused("set table_1.B1 = table_1.A1", seeded)).toContain("cyclic dependency");
      expect(slotOf(seeded, "table_1", ["cells", "B1"])).toEqual({ kind: "literal", value: 1 });
    });

    it("a bare reference to an EMPTY cell WITHIN the table's extent reads as 0 rather than a refusal", () => {
      expect(slotOf(committed("set table_1.A1 = table_1.B1", sandbox()), "table_1", ["cells", "A1"])?.value).toBe(0);
      expect(slotOf(committed("set table_1.A1 = SUM(B1:B4)", sandbox()), "table_1", ["cells", "A1"])?.value).toBe(0);
    });

    it("a bare reference to a cell OUTSIDE the table's extent is STILL a dangling reference, because there is no extent to make it legal", () => {
      expect(refused("set table_1.A1 = table_1.B9", sandbox())).toContain("references a slot that does not exist");
    });

    it("at the command line, a cycle that only closes once the empty cell is filled is refused at that line, naming both cells", () => {
      const acceptedWhileEmpty = committed("set table_1.A2 = table_1.A1", sandbox());
      expect(slotOf(acceptedWhileEmpty, "table_1", ["cells", "A2"])?.value).toBe(0);

      const message = refused("set table_1.A1 = table_1.A2", acceptedWhileEmpty);
      expect(message).toContain("cyclic dependency");
      expect(message).toContain("table_1.A1");
      expect(message).toContain("table_1.A2");
    });
  });

  describe("a formula that cannot be valid is refused when it is ENTERED, and its source is not discarded", () => {
    it("refuses an unknown function name, carrying the offending name and its position", () => {
      const message = refused("set table_1.A1 = NOSUCH(1)", sandbox());
      expect(message).toContain('unknown function "NOSUCH"');
      expect(message).toContain("at position 0");
      expect(message).toContain("NOSUCH(1)");
    });

    it("measures that position against the source it quotes, however much space follows the =", () => {
      expect(refused("set table_1.A1 =    1 + NOSUCH(1)", sandbox())).toBe('unknown function "NOSUCH" (at position 4 of "1 + NOSUCH(1)")');
    });

    it("refuses a known function called with the wrong argument count", () => {
      expect(refused("set table_1.A1 = ROUND(1)", sandbox())).toContain("ROUND");
    });

    it("refuses an unresolvable reference at parse time, regardless of which IF branch it sits in", () => {
      expect(refused("set table_1.A1 = IF(TRUE, 1, nosuch.value)", sandbox())).toContain('no object named "nosuch"');
    });

    it("echoes the source text back so the operator edits it rather than retyping it (clause 4)", () => {
      expect(refused("set table_1.A1 = 1 +", sandbox())).toContain('"1 +"');
    });
  });

  describe("an explicit write to a formula slot REPLACES it, and is not silent", () => {
    it("turns a formula slot back into a literal and reports the formula source it replaced", () => {
      const bound = committed("set table_1.A1 = polygon_1.radius + 1", sandbox());
      const outcome = run("set table_1.A1 9", bound);
      expect(outcome.ok && outcome.lines).toEqual(["table_1.A1 = 9", "replaced formula: = polygon_1.radius + 1"]);
      expect(slotOf(committed("set table_1.A1 9", bound), "table_1", ["cells", "A1"])).toEqual({ kind: "literal", value: 9 });
    });

    it("reports a replacement identically whether the new slot is a literal, a formula, or a link — one path writes all three", () => {
      const bound = committed("set table_1.A1 = 1 + 1", sandbox());
      for (const line of ["set table_1.A1 9", "set table_1.A1 = 2 + 2", "link table_1.A1 polygon_1.radius"]) {
        const outcome = run(line, bound);
        expect(outcome.ok && outcome.lines[1]).toBe("replaced formula: = 1 + 1");
      }
    });

    it("drops the replaced formula's inbound edges with it, so the old source no longer moves the slot", () => {
      const bound = committed("set table_1.A1 = polygon_1.radius", sandbox());
      expect(slotOf(bound, "table_1", ["cells", "A1"])?.value).toBe(50);
      const overwritten = committed("set table_1.A1 9", bound);
      expect(slotOf(committed("set polygon_1.radius 7", overwritten), "table_1", ["cells", "A1"])?.value).toBe(9);
    });

    it("still refuses a derived slot", () => {
      expect(refused("set polygon_1.vertices 1", sandbox())).toContain("is a derived slot");
    });
  });

  describe("link — a binding is a degenerate formula, down the same path", () => {
    it("makes the target read the source live, so writing the source moves the target", () => {
      const linked = committed("link polygon_1.origin.x table_1.A1", committed("set table_1.A1 5", sandbox()));
      expect(slotOf(linked, "polygon_1", ["origin", "x"])?.value).toBe(5);
      expect(slotOf(committed("set table_1.A1 11", linked), "polygon_1", ["origin", "x"])?.value).toBe(11);
    });

    it("stores exactly the reference node a formula-writing set would store — the two are one command underneath", () => {
      const seeded = committed("set table_1.A1 5", sandbox());
      const viaLink = slotOf(committed("link polygon_1.origin.x table_1.A1", seeded), "polygon_1", ["origin", "x"]);
      const viaSet = slotOf(committed("set polygon_1.origin.x = table_1.A1", seeded), "polygon_1", ["origin", "x"]);
      expect(viaLink).toEqual(viaSet);
    });

    it("refuses a source that is not an address, because the form is link <address> <address>", () => {
      expect(refused("link polygon_1.radius 42", sandbox())).toContain('"link" takes an address as its source');
    });

    it("refuses a source naming no object, with parseFormula's own message", () => {
      expect(refused("link polygon_1.radius nosuch.value", sandbox())).toContain('no object named "nosuch"');
    });
  });

  describe("unlink — the value last shown is the value kept", () => {
    it("freezes the formula's last value into a literal and names the formula it removed", () => {
      const bound = committed("link polygon_1.origin.x table_1.A1", committed("set table_1.A1 5", sandbox()));
      const outcome = run("unlink polygon_1.origin.x", bound);
      expect(outcome.ok && outcome.lines).toEqual(["unlinked polygon_1.origin.x — kept 5", "removed formula: = table_1.A1"]);
      expect(slotOf(committed("unlink polygon_1.origin.x", bound), "polygon_1", ["origin", "x"])).toEqual({ kind: "literal", value: 5 });
    });

    it("stops tracking the source, which is the whole point of unlinking", () => {
      const bound = committed("link polygon_1.origin.x table_1.A1", committed("set table_1.A1 5", sandbox()));
      const freed = committed("unlink polygon_1.origin.x", bound);
      expect(slotOf(committed("set table_1.A1 99", freed), "polygon_1", ["origin", "x"])?.value).toBe(5);
    });

    it("keeps an ERROR value rather than refusing or substituting a default, errors included", () => {
      const erroring = committed("set table_1.A1 = 1 / 0", sandbox());
      const freed = committed("unlink table_1.A1", erroring);
      const kept = slotOf(freed, "table_1", ["cells", "A1"]);
      expect(kept?.kind).toBe("literal");
      expect(kept?.value).toEqual({ error: "#DIV0", message: "division by zero" });
    });

    it("lets the operator type over that frozen error, which is what makes that safe", () => {
      const frozen = committed("unlink table_1.A1", committed("set table_1.A1 = 1 / 0", sandbox()));
      expect(slotOf(committed("set table_1.A1 3", frozen), "table_1", ["cells", "A1"])?.value).toBe(3);
    });

    it("refuses a slot that is not a formula, saying which state it is actually in", () => {
      expect(refused("unlink polygon_1.radius", sandbox())).toBe('polygon_1.radius is already a "literal" slot — "unlink" reverts a formula slot to a literal');
      expect(refused("unlink table_1.A1", sandbox())).toBe('table_1.A1 holds nothing — "unlink" reverts a formula slot to a literal');
      expect(refused("unlink polygon_1.area", sandbox())).toContain("is a derived slot");
    });
  });

  describe("clear — empties a table cell by REMOVING its slot", () => {
    it("removes the slot and names what was there", () => {
      const filled = committed("set table_1.A1 5", sandbox());
      const outcome = run("clear table_1.A1", filled);
      expect(outcome.ok && outcome.lines).toEqual(["cleared table_1.A1 — was 5"]);
      expect(slotOf(committed("clear table_1.A1", filled), "table_1", ["cells", "A1"])).toBeUndefined();
    });

    it("names a removed FORMULA by its source, not by its last value, the same courtesy `unlink` gives", () => {
      const bound = committed("set table_1.B1 = table_1.A1 * 2", committed("set table_1.A1 5", sandbox()));
      const outcome = run("clear table_1.B1", bound);
      expect(outcome.ok && outcome.lines).toEqual(["cleared table_1.B1 — was = table_1.A1 * 2"]);
    });

    it("SUCCEEDS on an already-empty cell and mutates nothing — asking for a state that already holds is not an error", () => {
      const before = sandbox();
      const outcome = run("clear table_1.A1", before);
      expect(outcome.ok && outcome.lines).toEqual(["table_1.A1 is already empty"]);
      expect(outcome.ok && outcome.document.journal).toHaveLength(before.journal.length);
    });

    it("refuses a slot that is not a table cell, and points at `set` instead", () => {
      const message = refused("clear polygon_1.radius", sandbox());
      expect(message).toContain("is not a table cell");
      expect(message).toContain("set polygon_1.radius");
    });

    it("refuses a table's own `rows` slot — a cell means a cell", () => {
      expect(refused("clear table_1.rows", sandbox())).toContain("is not a table cell");
    });

    it("refuses a derived slot with the derived-slot message, before the cell test is even reached", () => {
      expect(refused("clear polygon_1.area", sandbox())).toContain("is a derived slot");
    });

    it("refuses an address that resolves to nothing, through the same identity checks `set`/`link`/`unlink` use", () => {
      expect(refused("clear nosuch_1.A1", sandbox())).toBe('no object named "nosuch_1"');
    });

    it("a cell a formula READS can be cleared, and the dependent re-reads it as empty rather than breaking", () => {
      const wired = committed("set table_1.B1 = table_1.A1 * 2", committed("set table_1.A1 5", sandbox()));
      expect(slotOf(wired, "table_1", ["cells", "B1"])?.value).toBe(10);
      expect(slotOf(committed("clear table_1.A1", wired), "table_1", ["cells", "B1"])?.value).toBe(0);
    });

    it("leaves the cell writable again afterwards — clearing is not a tombstone", () => {
      const cleared = committed("clear table_1.A1", committed("set table_1.A1 5", sandbox()));
      expect(slotOf(committed("set table_1.A1 9", cleared), "table_1", ["cells", "A1"])).toEqual({ kind: "literal", value: 9 });
    });
  });

  describe("the loop these four commands close", () => {
    it("propagates a cell edit through a link to the geometry it drives, in one topological pass", () => {
      const wired = committed("link polygon_1.origin.x table_1.A1", committed("set table_1.A1 100", sandbox()));
      expect(slotOf(wired, "polygon_1", ["centroid", "x"])?.value).toBeCloseTo(100, 6);
      const moved = committed("set table_1.A1 250", wired);
      expect(slotOf(moved, "polygon_1", ["centroid", "x"])?.value).toBeCloseTo(250, 6);
    });

    it("reads geometry back out into a cell, the other direction of the example chain", () => {
      const document = committed("set table_1.B1 = polygon_1.origin.y * 2", sandbox());
      expect(slotOf(document, "table_1", ["cells", "B1"])?.value).toBe(40);
      expect(slotOf(committed("set polygon_1.origin.y 5", document), "table_1", ["cells", "B1"])?.value).toBe(10);
    });

    it("appends exactly one journal entry per slot command, each holding one setSlot (Rule 2)", () => {
      const document = committed("set table_1.A1 1", sandbox());
      expect(document.journal).toHaveLength(3);
      expect(document.journal[2]?.operations.map((operation) => operation.kind)).toEqual(["setSlot"]);
    });
  });
});

describe("delete, refs, props and list — the object commands that need no new Operation kind", () => {
  function sandbox(): Document {
    return committed("table x=0 y=0 rows=4 cols=4", committed("polygon sides=5 x=10 y=20 r=50", createEmptyDocument()));
  }

  function wired(): Document {
    return committed("link polygon_1.origin.x table_1.A1", committed("set table_1.A1 5", sandbox()));
  }

  function lines(line: string, document: Document): readonly string[] {
    const outcome = run(line, document);
    if (isCommandFailure(outcome)) {
      throw new Error(`expected "${line}" to succeed, got: ${outcome.message}`);
    }
    return outcome.lines;
  }

  function named(document: Document, objectName: string): GraphObject | undefined {
    return document.objects.find((candidate) => candidate.name === objectName);
  }

  describe("list — a dump of all objects and names", () => {
    it("says so plainly on an empty document rather than returning no lines at all", () => {
      expect(lines("list", createEmptyDocument())).toEqual(["no objects"]);
    });

    it("names every object with its type, in creation order", () => {
      expect(lines("list", sandbox())).toEqual(["polygon_1 — polygon", "table_1 — table"]);
    });

    it("never prints an object id, because the id is the layer the operator never writes", () => {
      const listed = lines("list", sandbox()).join("\n");
      for (const object of sandbox().objects) {
        expect(listed).not.toContain(object.id);
      }
    });

    it("returns the document it was given, unchanged and unjournalled, which is why it carries no effect", () => {
      const before = sandbox();
      const outcome = run("list", before);
      expect(outcome.ok && outcome.document).toBe(before);
      expect(before.journal).toHaveLength(2);
    });
  });

  describe("refs — look before you delete", () => {
    it("names the slot on another object that reads the target, in the edge's own source → dependent direction", () => {
      expect(lines("refs table_1", wired())[0]).toBe("table_1.A1 → polygon_1.origin.x");
    });

    it("counts other objects' dependents apart from the target's own, because only the first kind can block a delete", () => {
      const reported = lines("refs table_1", wired());
      expect(reported[reported.length - 1]).toBe("1 inbound edge from 1 dependent slot: 1 on other objects, 0 on table_1 itself");
    });

    it("reports a preset's own schema wiring rather than hiding it — its derived slots do read its parameters", () => {
      const reported = lines("refs polygon_1", sandbox());
      expect(reported[reported.length - 1]).toBe("13 inbound edges from 9 dependent slots: 0 on other objects, 9 on polygon_1 itself");
      expect(reported).toContain("polygon_1.origin.x → polygon_1.vertices");
      expect(reported).toContain("polygon_1.vertices → polygon_1.centroid.x");
    });

    it("answers about ONE slot when given an address, not the whole object", () => {
      expect(lines("refs polygon_1.origin.x", sandbox())).toEqual([
        "polygon_1.origin.x → polygon_1.vertices",
        "1 inbound edge from 1 dependent slot: 0 on other objects, 1 on polygon_1 itself",
      ]);
    });

    it("accepts a DERIVED slot as a target — reading who depends on a computed value is not an attempt to write it", () => {
      const reported = lines("refs polygon_1.vertices", sandbox());
      expect(reported[reported.length - 1]).toBe("8 inbound edges from 8 dependent slots: 0 on other objects, 8 on polygon_1 itself");
    });

    it("says nothing references a target rather than printing an empty report", () => {
      expect(lines("refs table_1", sandbox())).toEqual(["nothing references table_1"]);
      expect(lines("refs table_1.A1", sandbox())).toEqual(["nothing references table_1.A1"]);
    });

    it("accepts a cell path the table declares but nobody has written, because an absent cell is ordinary state", () => {
      expect(lines("refs table_1.D4", sandbox())).toEqual(["nothing references table_1.D4"]);
    });

    it("a disclosed consequence: it does not report a formula that reads an EMPTY in-extent cell as one of its dependents, because that reference has no edge, until the cell is populated, which makes the edge (and the report) appear on its own", () => {
      const linkedToEmptyCell = committed("link polygon_1.origin.x table_1.D4", sandbox());
      expect(lines("refs table_1.D4", linkedToEmptyCell)).toEqual(["nothing references table_1.D4"]);

      const populated = committed("set table_1.D4 1", linkedToEmptyCell);
      expect(lines("refs table_1.D4", populated)).toEqual([
        "table_1.D4 → polygon_1.origin.x",
        "1 inbound edge from 1 dependent slot: 1 on other objects, 0 on table_1 itself",
      ]);
    });

    it("but `refs <object>` DOES report that same dependent, and agrees with the refused `delete` — the two forms answer different questions", () => {
      const linkedToEmptyCell = committed("link polygon_1.origin.x table_1.D4", sandbox());

      expect(lines("refs table_1.D4", linkedToEmptyCell)).toEqual(["nothing references table_1.D4"]);
      expect(lines("refs table_1", linkedToEmptyCell)).toEqual([
        "table_1.D4 → polygon_1.origin.x",
        "1 inbound edge from 1 dependent slot: 1 on other objects, 0 on table_1 itself",
      ]);
      expect(refused("delete table_1", linkedToEmptyCell)).toContain("polygon_1.origin.x references a slot that does not exist");
    });

    it("names a dependent once even where the formula reads it twice, because the report is about which SLOTS read the target", () => {
      const twice = committed("set table_1.B1 = table_1.A1 + table_1.A1", committed("set table_1.A1 2", sandbox()));
      expect(lines("refs table_1.A1", twice)).toEqual([
        "table_1.A1 → table_1.B1",
        "1 inbound edge from 1 dependent slot: 0 on other objects, 1 on table_1 itself",
      ]);
    });

    it("counts EDGES and SLOTS apart where one slot reads two slots of the target, because only the slot count says how much unlinking a delete needs", () => {
      const both = committed(
        "set polygon_1.origin.x = table_1.A1 + table_1.A2",
        committed("set table_1.A2 7", committed("set table_1.A1 5", sandbox())),
      );
      expect(lines("refs table_1", both)).toEqual([
        "table_1.A1 → polygon_1.origin.x",
        "table_1.A2 → polygon_1.origin.x",
        "2 inbound edges from 1 dependent slot: 1 on other objects, 0 on table_1 itself",
      ]);
    });

    it("refuses a name no object has, rather than reporting that nothing references it", () => {
      expect(refused("refs nosuch", sandbox())).toBe('no object named "nosuch"');
    });

    it("refuses a path the schema does not declare, for the reason resolveWritableSlot does: a confident answer about a slot that does not exist is worse than a refusal", () => {
      expect(refused("refs polygon_1.radius2", sandbox())).toBe('polygon_1 has no slot at "polygon_1.radius2" — object type "polygon" does not declare one');
      expect(refused("refs table_1.E1", sandbox())).toContain("does not declare one");
    });

    it("returns the document it was given, unchanged and unjournalled", () => {
      const before = wired();
      const outcome = run("refs table_1", before);
      expect(outcome.ok && outcome.document).toBe(before);
    });

    it("reports exactly the dependent a non-forced delete then refuses, because both read deriveEdges over the same document", () => {
      const document = wired();
      expect(lines("refs table_1", document)[0]).toBe("table_1.A1 → polygon_1.origin.x");
      expect(refused("delete table_1", document)).toContain("polygon_1.origin.x");
    });

    describe("a range over cells nobody has written yet", () => {
      function rangeReader(): Document {
        const two = committed("table x=100 y=0 rows=4 cols=4", sandbox());
        return committed("set table_2.A1 = SUM(table_1.A1:table_1.A4)", two);
      }

      it("is reported by refs, because it is the edge the deletion would leave dangling", () => {
        expect(lines("refs table_1", rangeReader())).toEqual([
          "table_1.A1 → table_2.A1",
          "1 inbound edge from 1 dependent slot: 1 on other objects, 0 on table_1 itself",
        ]);
      });

      it("names the same dependent refs named when the delete is then refused", () => {
        const document = rangeReader();
        expect(lines("refs table_1", document)[0]).toContain("table_2.A1");
        expect(refused("delete table_1", document)).toContain("table_2.A1");
      });

      it("still reports nothing for the CELL itself, because an unwritten cell inside a range is not yet depended on", () => {
        expect(lines("refs table_1.A1", rangeReader())).toEqual(["nothing references table_1.A1"]);
      });
    });
  });

  describe("props — the slot list, read the way the panel reads it", () => {
    it("headers the report with the object's name and type, the same pair list uses", () => {
      expect(lines("props polygon_1", sandbox())[0]).toBe("polygon_1 — polygon");
    });

    it("lists every slot in SCHEMA order — non-derived first, then derived", () => {
      const paths = lines("props polygon_1", sandbox())
        .slice(1)
        .map((line) => line.split(" = ")[0]);
      expect(paths).toEqual([
        "sides",
        "radius",
        "origin.x",
        "origin.y",
        "rotation",
        "vertices",
        "centroid.x",
        "centroid.y",
        "area",
        "length",
        "bounds.minX",
        "bounds.minY",
        "bounds.maxX",
        "bounds.maxY",
      ]);
    });

    it("shows a literal slot's path, value and kind", () => {
      expect(lines("props polygon_1", sandbox())).toContain("radius = 50 (literal)");
    });

    it("marks a derived slot as derived, never as something the operator can set or link", () => {
      const reported = lines("props polygon_1", sandbox());
      expect(reported.some((line) => line.startsWith("vertices = ") && line.endsWith("(derived)"))).toBe(true);
    });

    it("shows a formula slot's reconstructed SOURCE alongside its current value", () => {
      const document = committed("link polygon_1.origin.x table_1.A1", committed("set table_1.A1 7", sandbox()));
      expect(lines("props polygon_1", document)).toContain("origin.x = 7 (formula, = table_1.A1)");
    });

    it("gives a table's cell family ONE row naming the grid and how many cells are WRITTEN, never one row per cell", () => {
      const document = committed("set table_1.B2 2", committed("set table_1.A1 5", sandbox()));
      const reported = lines("props table_1", document);
      expect(reported).toContain('cells = "4×4 grid — 2 of 16 cells written" (literal)');
      expect(reported.filter((line) => line.startsWith("cells"))).toHaveLength(1);
    });

    it("counts a table's WRITTEN cells, not its declared extent, because an absent cell is ordinary empty", () => {
      expect(lines("props table_1", sandbox())).toContain('cells = "4×4 grid — 0 of 16 cells written" (literal)');
    });

    it("lists a table's own slots in schema order, the summary row last", () => {
      const paths = lines("props table_1", sandbox())
        .slice(1)
        .map((line) => line.split(" = ")[0]);
      expect(paths).toEqual(["origin.x", "origin.y", "rows", "cols", "cells"]);
    });

    it("refuses a name no object has", () => {
      expect(refused("props nosuch", sandbox())).toBe('no object named "nosuch"');
    });

    it("returns the document it was given, unchanged and unjournalled", () => {
      const before = sandbox();
      const outcome = run("props polygon_1", before);
      expect(outcome.ok && outcome.document).toBe(before);
    });
  });

  describe("delete — the two paths, chosen by the force flag", () => {
    it("removes an object nothing reads, and says which one it removed", () => {
      const after = committed("delete table_1", sandbox());
      expect(lines("delete table_1", sandbox())).toEqual(["deleted table_1"]);
      expect(named(after, "table_1")).toBeUndefined();
      expect(named(after, "polygon_1")).toBeDefined();
    });

    it("REJECTS while another object still reads it, naming every dependent", () => {
      expect(refused("delete table_1", wired())).toContain("polygon_1.origin.x references a slot that does not exist");
    });

    it("names the force flag in that refusal, because a mutate rejection cannot — an Operation carries no command syntax", () => {
      expect(refused("delete table_1", wired())).toContain('unlink each, or "delete table_1 force" to rewrite them to #REF instead');
    });

    it("leaves prior state bit-for-bit unchanged when it rejects", () => {
      const before = wired();
      const snapshot = JSON.stringify(before);
      refused("delete table_1", before);
      expect(JSON.stringify(before)).toBe(snapshot);
    });

    it("takes the repair path under force, and reports every slot it broke", () => {
      const outcome = run("delete table_1 force", wired());
      expect(outcome.ok && outcome.lines).toEqual([
        "deleted table_1",
        "broke 1 formula: polygon_1.origin.x — each now reads #REF where it read table_1",
      ]);
    });

    it("leaves the broken formula holding a #REF value rather than a dangling edge, which is the whole reason for the repair path", () => {
      const repaired = committed("delete table_1 force", wired());
      const polygon = named(repaired, "polygon_1");
      const slot = polygon === undefined ? undefined : getSlot(polygon, ["origin", "x"]);
      expect(slot?.kind).toBe("formula");
      expect(slot?.value).toEqual({ error: "#REF", message: expect.any(String) });
    });

    it("says nothing about broken slots when the repair broke none, so the report is never noise", () => {
      expect(lines("delete table_1 force", sandbox())).toEqual(["deleted table_1"]);
    });

    it("refuses a name no object has", () => {
      expect(refused("delete nosuch", sandbox())).toBe('no object named "nosuch"');
    });

    it("treats an EXTERNAL formula reading a DERIVED slot exactly like any other reference: refused, then repaired under force", () => {
      const readsDerived = committed("set table_1.A1 = polygon_1.area", sandbox());
      expect(lines("refs polygon_1", readsDerived)[0]).toBe("polygon_1.area → table_1.A1");
      expect(refused("delete polygon_1", readsDerived)).toContain("table_1.A1 references a slot that does not exist");
      const repaired = committed("delete polygon_1 force", readsDerived);
      const cell = named(repaired, "table_1");
      expect(cell === undefined ? undefined : getSlot(cell, ["cells", "A1"])?.value).toEqual({ error: "#REF", message: expect.any(String) });
    });

    it("appends exactly one journal entry holding one deleteObject operation (Rule 2)", () => {
      const after = committed("delete table_1", sandbox());
      expect(after.journal).toHaveLength(3);
      expect(after.journal[2]?.operations).toEqual([{ kind: "deleteObject", objectId: "obj_2", force: false }]);
    });

    it("frees the deleted name for reuse while never reusing its id", () => {
      const recreated = committed("table x=0 y=0 rows=2 cols=2", committed("delete table_1", sandbox()));
      const table = named(recreated, "table_1");
      expect(table?.id).toBe("obj_3");
    });
  });
});

describe("addvertex / delvertex — growing and shrinking a polyline", () => {
  function sandbox(): Document {
    return committed("polyline 0,0 10,0 10,10", createEmptyDocument());
  }

  it("appends a new vertex and names its index and point", () => {
    const after = committed("addvertex polyline_1 20,20", sandbox());
    const object = onlyNamed(after, "polyline_1");
    expect(object.vertexCount).toBe(4);
    expect(literalValue(object, ["vertex", "3", "x"])).toBe(20);
    expect(literalValue(object, ["vertex", "3", "y"])).toBe(20);
    const outcome = run("addvertex polyline_1 20,20", sandbox());
    expect(outcome.ok && outcome.lines).toEqual(["added polyline_1.vertex.3 at 20,20"]);
  });

  it("refuses addvertex against a non-polyline object, naming its real type", () => {
    const withCircle = committed("circle x=0 y=0 r=5", sandbox());
    expect(refused("addvertex circle_1 1,1", withCircle)).toContain("only a polyline has vertices to add");
  });

  it("refuses addvertex given more than one point", () => {
    expect(refused("addvertex polyline_1 1,1 2,2", sandbox())).toContain("exactly one point");
  });

  it("refuses an unknown object", () => {
    expect(refused("addvertex nosuch 1,1", sandbox())).toBe('no object named "nosuch"');
  });

  it("removes the target vertex and renumbers the rest down by one", () => {
    const after = committed("delvertex polyline_1 0", sandbox());
    const object = onlyNamed(after, "polyline_1");
    expect(object.vertexCount).toBe(2);
    expect(literalValue(object, ["vertex", "0", "x"])).toBe(10);
    expect(literalValue(object, ["vertex", "0", "y"])).toBe(0);
    const outcome = run("delvertex polyline_1 0", sandbox());
    expect(outcome.ok && outcome.lines).toEqual(["deleted polyline_1.vertex.0"]);
  });

  it("REJECTS while another object's formula still reads the exact vertex, naming it and the force escape", () => {
    const wired = committed("link circle_1.origin.x polyline_1.vertex.1.x", committed("circle x=0 y=0 r=5", sandbox()));
    expect(refused("delvertex polyline_1 1", wired)).toContain("circle_1.origin.x");
    expect(refused("delvertex polyline_1 1", wired)).toContain('"delvertex polyline_1 1 force"');
  });

  it("leaves prior state bit-for-bit unchanged when it rejects", () => {
    const wired = committed("link circle_1.origin.x polyline_1.vertex.1.x", committed("circle x=0 y=0 r=5", sandbox()));
    const snapshot = JSON.stringify(wired);
    refused("delvertex polyline_1 1", wired);
    expect(JSON.stringify(wired)).toBe(snapshot);
  });

  it("takes the repair path under force, and reports the formula it broke", () => {
    const wired = committed("link circle_1.origin.x polyline_1.vertex.1.x", committed("circle x=0 y=0 r=5", sandbox()));
    const outcome = run("delvertex polyline_1 1 force", wired);
    expect(outcome.ok && outcome.lines).toEqual([
      "deleted polyline_1.vertex.1",
      "broke 1 formula: circle_1.origin.x — each now reads #REF where it read this vertex",
    ]);
  });

  it("shifts a reference to a SURVIVING vertex down to match, without breaking it", () => {
    const wired = committed("link circle_1.origin.x polyline_1.vertex.2.x", committed("circle x=0 y=0 r=5", sandbox()));
    const after = committed("delvertex polyline_1 0", wired);
    const circle = onlyNamed(after, "circle_1");
    const slot = getSlot(circle, ["origin", "x"]);
    expect(slot?.kind).toBe("formula");
    expect(slot?.value).toBe(10);
  });

  it("refuses an out of range vertex index, naming the current count", () => {
    expect(refused("delvertex polyline_1 99", sandbox())).toContain("out of range");
  });

  it("refuses delvertex against a non-polyline object, naming its real type", () => {
    const withCircle = committed("circle x=0 y=0 r=5", sandbox());
    expect(refused("delvertex circle_1 0", withCircle)).toContain("only a polyline has vertices to delete");
  });

  it("refuses an unknown object", () => {
    expect(refused("delvertex nosuch 0", sandbox())).toBe('no object named "nosuch"');
  });
});

describe("rename — the one object command that needed a new Operation kind", () => {
  function wired(): Document {
    const sandbox = committed("table x=0 y=0 rows=4 cols=4", committed("polygon sides=5 x=10 y=20 r=50", createEmptyDocument()));
    return committed("link polygon_1.origin.x table_1.A1", committed("set table_1.A1 5", sandbox));
  }

  function named(document: Document, objectName: string): GraphObject | undefined {
    return document.objects.find((candidate) => candidate.name === objectName);
  }

  it("writes the new name and echoes both, at the documented example line", () => {
    const outcome = run("rename polygon_1 intersection_a", wired());
    expect(outcome.ok && outcome.lines).toEqual(["renamed polygon_1 to intersection_a"]);
    expect(outcome.ok && named(outcome.document, "intersection_a")?.id).toBe("obj_1");
    expect(outcome.ok && named(outcome.document, "polygon_1")).toBeUndefined();
  });

  it("resolves the OLD name case-insensitively, the same resolver delete uses", () => {
    expect(committed("rename POLYGON_1 intersection_a", wired()).objects[0]?.name).toBe("intersection_a");
  });

  it("leaves every formula pointing at the renamed object working, which is the whole reason for storing ids", () => {
    const renamed = committed("rename table_1 grid", wired());
    const driven = committed("set grid.A1 42", renamed);
    expect(getSlot(named(driven, "polygon_1") as GraphObject, ["origin", "x"])?.value).toBe(42);
  });

  it("makes the NEW name the one an address is printed with, because formatAddress resolves a name from the id", () => {
    const renamed = committed("rename table_1 grid", wired());
    const outcome = run("refs grid", renamed);
    expect(outcome.ok && outcome.lines[0]).toBe("grid.A1 → polygon_1.origin.x");
  });

  it("makes the OLD name unresolvable to every other command at once, since they all resolve through the document", () => {
    const renamed = committed("rename table_1 grid", wired());
    expect(refused("refs table_1", renamed)).toContain("table_1");
    expect(refused("delete table_1", renamed)).toBe('no object named "table_1"');
    expect(refused("set table_1.A1 1", renamed)).toContain("table_1");
  });

  it("frees the old name for another object to take", () => {
    const renamed = committed("rename polygon_1 intersection_a", wired());
    const another = committed("polygon sides=3 x=0 y=0 r=1", renamed);
    expect(named(another, "polygon_1")?.id).toBe("obj_3");
  });

  it("refuses an old name no object has", () => {
    expect(refused("rename nosuch whatever", wired())).toBe('no object named "nosuch"');
  });

  it("refuses a new name another object already holds, in the words of mutate, because uniqueness has one gate and not a copy here", () => {
    expect(refused("rename polygon_1 table_1", wired())).toBe('operation 1 of 1 cannot rename: the name "table_1" is already in use');
    expect(refused("rename polygon_1 TABLE_1", wired())).toContain("already in use");
  });

  it("refuses a new name that fails the grammar, which the parser let through on purpose", () => {
    expect(refused("rename polygon_1 3bad", wired())).toBe(
      'operation 1 of 1 cannot rename: "3bad" is not a valid name — names must match [a-zA-Z_][a-zA-Z0-9_]*',
    );
  });

  it("ACCEPTS a rename that only changes case, since uniqueness excludes the object being renamed", () => {
    expect(committed("rename polygon_1 POLYGON_1", wired()).objects[0]?.name).toBe("POLYGON_1");
  });

  it("leaves prior state bit-for-bit unchanged when it refuses", () => {
    const before = wired();
    const snapshot = JSON.stringify(before);
    refused("rename polygon_1 table_1", before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("appends exactly one journal entry holding one renameObject operation (Rule 2)", () => {
    const after = committed("rename polygon_1 intersection_a", wired());
    expect(after.journal).toHaveLength(5);
    expect(after.journal[4]?.operations).toEqual([{ kind: "renameObject", objectId: "obj_1", name: "intersection_a" }]);
  });

  it("takes no id and moves no counter — a rename is not a create", () => {
    const before = wired();
    expect(committed("rename polygon_1 intersection_a", before).nextObjectId).toBe(before.nextObjectId);
  });

  it("refuses a new name the formula lexer treats as a keyword, naming all five and what to do", () => {
    const message = refused("rename table_1 TRUE", wired());
    expect(message).toContain("is a reserved word");
    expect(message).toContain("AND, OR, NOT, TRUE, FALSE");
    expect(message).toContain("choose another name");
  });

  it("refuses one in ANY case, and leaves prior state bit-for-bit unchanged", () => {
    const before = wired();
    const snapshot = JSON.stringify(before);
    expect(refused("rename table_1 not", before)).toContain("is a reserved word");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("leaves every ACCEPTED new name referenceable by a formula, which is the property that rule protects", () => {
    const renamed = committed("rename table_1 grid", wired());
    const driven = committed("set polygon_1.radius = grid.A1 + 1", renamed);
    expect(getSlot(named(driven, "polygon_1") as GraphObject, ["radius"])?.value).toBe(6);
  });
});

describe("a formula too deep to walk is refused, not thrown", () => {
  function sandbox(): Document {
    return committed("table x=0 y=0 rows=4 cols=4", createEmptyDocument());
  }

  function named(document: Document, objectName: string): GraphObject | undefined {
    return document.objects.find((candidate) => candidate.name === objectName);
  }

  function chain(terms: number): string {
    return Array.from({ length: terms }, () => "1").join(" + ");
  }

  it("refuses a 80,000-term formula through the failure arm — the line that used to unwind a RangeError", () => {
    const document = sandbox();
    let outcome: CommandOutcome | undefined;
    expect(() => {
      outcome = run(`set table_1.A1 = ${chain(80_000)}`, document);
    }).not.toThrow();
    expect(outcome !== undefined && isCommandFailure(outcome)).toBe(true);
    expect(outcome !== undefined && !outcome.ok && outcome.message).toContain("nested operations");
  });

  it("refuses a deeply parenthesized one the same way", () => {
    const source = `${"(".repeat(1000)}1${")".repeat(1000)}`;
    expect(() => run(`set table_1.A1 = ${source}`, sandbox())).not.toThrow();
    expect(refused(`set table_1.A1 = ${source}`, sandbox())).toContain("nests too deeply");
  });

  it("leaves the document untouched when it refuses one", () => {
    const document = sandbox();
    const snapshot = JSON.stringify(document);
    refused(`set table_1.A1 = ${chain(80_000)}`, document);
    expect(JSON.stringify(document)).toBe(snapshot);
  });

  it("still COMMITS and EVALUATES a 1,000-term formula, at the limit exactly", () => {
    const committed1000 = committed(`set table_1.A1 = ${chain(1000)}`, sandbox());
    expect(getSlot(named(committed1000, "table_1") as GraphObject, ["cells", "A1"])?.value).toBe(1000);
  });

  it("reports the replaced deep formula rather than throwing while formatting it", () => {
    const withDeep = committed(`set table_1.A1 = ${chain(1000)}`, sandbox());
    const outcome = run("set table_1.A1 7", withDeep);
    expect(outcome.ok && outcome.lines.join("\n")).toContain("1 + 1");
  });
});

describe("executeCommand forwards the EvalContext to the evaluation in mutate", () => {
  function textObject(): GraphObject {
    return {
      id: "obj_t",
      name: "text_1",
      type: "text",
      slots: {
        content: { kind: "literal", value: "hello there" },
        width: { kind: "literal", value: "auto" },
        "style.font": { kind: "literal", value: "sans" },
        "style.fontSize": { kind: "literal", value: 12 },
        "style.lineHeight": { kind: "literal", value: 14 },
        resolvedContent: { kind: "derived", value: null },
        measuredHeight: { kind: "derived", value: null },
        measuredWidth: { kind: "derived", value: null },
      },
    };
  }

  function docWithText(): Document {
    return { ...createEmptyDocument(), nextObjectId: 1, objects: [textObject()] };
  }

  function measuredHeightOf(document: Document): unknown {
    return getSlot(onlyNamed(document, "text_1"), ["measuredHeight"])?.value;
  }

  const realMeasurer: EvalContext = { measurer: { measure: () => ({ width: 3, height: 40 }) } };

  it("a `set` on a text slot re-evaluates measuredHeight against the threaded measurer — #MEASURE without one (writeSlot -> mutate)", () => {
    const doc = docWithText();
    expect(measuredHeightOf(committed("set text_1.style.fontSize 16", doc))).toMatchObject({ error: "#MEASURE" });

    const outcome = executeCommand(parsed("set text_1.style.fontSize 16"), doc, realMeasurer);
    if (isCommandFailure(outcome)) {
      throw new Error(outcome.message);
    }
    expect(measuredHeightOf(outcome.document)).toBe(40);
  });

  it("forwards the context on the creation path too — a new circle's mutate re-evaluates the text object (createObject -> mutate)", () => {
    const outcome = executeCommand(parsed("circle x=0 y=0 r=5"), docWithText(), realMeasurer);
    if (isCommandFailure(outcome)) {
      throw new Error(outcome.message);
    }
    expect(measuredHeightOf(outcome.document)).toBe(40);
  });

  it("hands the numeric `width` slot to the measurer as maxWidth through the command seam", () => {
    const wrapAware: EvalContext = {
      measurer: { measure: (_text, _style, maxWidth) => ({ width: 0, height: maxWidth === undefined ? 10 : 20 }) },
    };
    const outcome = executeCommand(parsed("set text_1.width 120"), docWithText(), wrapAware);
    if (isCommandFailure(outcome)) {
      throw new Error(outcome.message);
    }
    expect(measuredHeightOf(outcome.document)).toBe(20);
  });
});
