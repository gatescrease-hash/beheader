/**
 * commands.test.ts — Tests for `command/commands.ts` (§5.10's handler half).
 *
 * Unlike `parser.test.ts`, every test here has a document: this is the file where a
 * `Command` meets one (D-069), so the tests are claims about IDENTITY and DOMAIN —
 * which id and name a creation takes, which counts are refused, what `mutate` does
 * with the object that comes out.
 *
 * Lines are pushed through `parseCommand`/`beginCommand` rather than hand-built
 * `Command` objects wherever the point is end to end, so a spec whose `build`
 * disagrees with its handler fails here instead of looking correct on both sides.
 * `render/hittest.ts` and `render/interaction.ts` appear in the last block only, and
 * deliberately: the claim that a table's handler writes its position at the paths the
 * render layer already reads is only testable across that seam, and those two files
 * pin their own table paths against hand-built fixtures rather than a real one.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type Document } from "../engine/document.ts";
import { getSlot, type GraphObject, type Point } from "../engine/graph/node.ts";
import { mutate } from "../engine/mutation.ts";
import { hitTest } from "../render/hittest.ts";
import { pointerDown, pointerMove } from "../render/interaction.ts";
import { COMMAND_NAMES, isCommandParseFailure, parseCommand, type Command } from "./parser.ts";
import { beginCommand, respond } from "./prompt.ts";
import {
  COMMANDS_WITH_HANDLERS,
  executeCommand,
  isCommandFailure,
  MAX_POLYGON_SIDES,
  MAX_TABLE_LINES,
  type CommandOutcome,
} from "./commands.ts";

/** The command a line parses to, or a thrown test failure naming the parser's own message. */
function parsed(line: string): Command {
  const result = parseCommand(line);
  if (isCommandParseFailure(result)) {
    throw new Error(`expected "${line}" to parse, got: ${result.message}`);
  }
  return result.command;
}

/** Runs a whole typed line against a document — the path `main.ts` will use. */
function run(line: string, document: Document): CommandOutcome {
  return executeCommand(parsed(line), document);
}

/** The document a line produced, or a thrown test failure naming the handler's own message. */
function committed(line: string, document: Document): Document {
  const outcome = run(line, document);
  if (isCommandFailure(outcome)) {
    throw new Error(`expected "${line}" to succeed, got: ${outcome.message}`);
  }
  return outcome.document;
}

/** The refusal message, or a thrown test failure — the mirror of `committed`. */
function refused(line: string, document: Document): string {
  const outcome = run(line, document);
  if (!isCommandFailure(outcome)) {
    throw new Error(`expected "${line}" to be refused, but it committed`);
  }
  return outcome.message;
}

/** The single object a freshly created document now holds. */
function onlyObject(document: Document): GraphObject {
  const object = document.objects[0];
  if (document.objects.length !== 1 || object === undefined) {
    throw new Error(`expected exactly one object, got ${document.objects.length}`);
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

describe("creation — a typed line becomes an object (§5.5, §5.4, §5.10)", () => {
  it("creates a circle with its three parameter slots literal, at §5.10's own example line", () => {
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
    // The 32-gon's own area, not πr²: §5.5 makes `vertices` a polygonal
    // approximation used for bounds and hit-testing, and `area` is derived from it.
    expect(getSlot(object, ["area"])?.value).toBeCloseTo(0.5 * 32 * 100 * Math.sin((2 * Math.PI) / 32), 6);
  });

  it("creates a polygon with the number of vertices its sides argument asked for, and rotation defaulted to 0 (§5.10's form gives no rotation)", () => {
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

  it("creates a table carrying its origin and both dimensions, and NO cell slots — an absent cell is D-047's other spelling of empty", () => {
    const object = onlyObject(committed("table x=0 y=0 rows=8 cols=8", createEmptyDocument()));
    expect(object.type).toBe("table");
    expect(object.name).toBe("table_1");
    expect(literalValue(object, ["origin", "x"])).toBe(0);
    expect(literalValue(object, ["origin", "y"])).toBe(0);
    expect(literalValue(object, ["rows"])).toBe(8);
    expect(literalValue(object, ["cols"])).toBe(8);
    expect(Object.keys(object.slots).filter((key) => key.startsWith("cells."))).toEqual([]);
  });

  it("gives a table an origin its SCHEMA declares, so its position may be DRIVEN by a formula the way a polygon's already is (D-017)", () => {
    // An undeclared slot may hold a literal, so the position would draw either way.
    // What the schema entry buys is this: D-017 rejects a `formula` slot at a path no
    // schema declares, so without it `link table_x.origin.x <address>` could never
    // commit. Written through `mutate` rather than through `link`, which has no
    // handler yet — the claim is about the schema, not about that command.
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

  it("takes §5.4's 8x8 default when rows and cols are omitted, because the parser supplied them", () => {
    const object = onlyObject(committed("table x=0 y=0", createEmptyDocument()));
    expect(literalValue(object, ["rows"])).toBe(8);
    expect(literalValue(object, ["cols"])).toBe(8);
  });

  it("accepts a negative radius and stores it — a value that computes to #TYPE is legitimate state (§5.1), not a rejection", () => {
    const object = onlyObject(committed("circle x=0 y=0 r=-5", createEmptyDocument()));
    expect(literalValue(object, ["radius"])).toBe(-5);
    expect(getSlot(object, ["vertices"])?.value).toEqual({ error: "#TYPE", message: "circle.vertices: radius must not be negative" });
  });
});

describe("identity — ids and names (D-002, §5.2)", () => {
  it("mints a fresh id per object and advances the document's own counter, never reusing one", () => {
    const first = committed("circle x=0 y=0 r=1", createEmptyDocument());
    const second = committed("circle x=1 y=1 r=1", first);
    expect(second.objects.map((object) => object.id)).toEqual(["obj_1", "obj_2"]);
    expect(second.nextObjectId).toBe(3);
  });

  it("counts default names up per type, so two circles are circle_1 and circle_2 (§5.2)", () => {
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

describe("D-070 — a creation count is bounded by the HANDLER, and out of range REJECTS", () => {
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

describe("a mutate rejection reaches the operator as a message, never as a throw", () => {
  it("reports a coordinate that overflowed to a non-finite number, and commits nothing (D-025)", () => {
    const document = createEmptyDocument();
    const overflowing = `circle x=${"1".repeat(400)} y=0 r=1`;
    const message = refused(overflowing, document);
    expect(message).toContain("Infinity");
    expect(document.objects).toEqual([]);
  });

  it("never throws for any command in the registry, run against an empty document", () => {
    for (const line of ["circle x=0 y=0 r=1", "polygon sides=3 x=0 y=0 r=1", "rect x=0 y=0 w=1 h=1", "table x=0 y=0", "list", "save"]) {
      expect(() => run(line, createEmptyDocument())).not.toThrow();
    }
  });
});

describe("the arms with no handler yet", () => {
  /** §5.10's own example line for every registry command that this file does not run yet. */
  const UNHANDLED_EXAMPLES: readonly { readonly line: string; readonly word: string }[] = [
    { line: "link polygon_1.origin.x table_x.A1", word: "link" },
    { line: "unlink polygon_1.origin.x", word: "unlink" },
    { line: "set polygon_1.radius 42", word: "set" },
    { line: "rename polygon_1 intersection_a", word: "rename" },
    { line: "delete intersection_a", word: "delete" },
    { line: "refs intersection_a", word: "refs" },
    { line: "list", word: "list" },
    { line: "select intersection_a", word: "select" },
    { line: "zoom 2", word: "zoom" },
    { line: "fit", word: "fit" },
    { line: "save", word: "save" },
    { line: "load", word: "load" },
  ];

  for (const example of UNHANDLED_EXAMPLES) {
    it(`reports "${example.word}" as having no handler yet, rather than silently doing nothing`, () => {
      expect(refused(example.line, createEmptyDocument())).toBe(`"${example.word}" has no handler yet — nothing was changed`);
    });
  }

  it("covers every registry command exactly once between the handled set and the list above, so a new entry cannot land unrouted", () => {
    expect([...COMMANDS_WITH_HANDLERS, ...UNHANDLED_EXAMPLES.map((example) => example.word)].sort()).toEqual([...COMMAND_NAMES].sort());
  });

  it("reports a formula-writing set under the word the operator typed — 'set-formula' is a Command kind, not a command word (D-071)", () => {
    expect(refused("set table_x.B1 = 2 + 2", createEmptyDocument())).toBe('"set" has no handler yet — nothing was changed');
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
    // The camera is the identity transform, so screen and world coordinates agree —
    // this is a claim about which SLOTS the handler wrote, not about camera math.
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(hitTest({ x: 41, y: 21 }, outcome.document.objects, camera)?.name).toBe("table_1");
    expect(hitTest({ x: 39, y: 19 }, outcome.document.objects, camera)).toBeUndefined();
  });

  it("makes a command-created table draggable, because its origin slots are the ones §5.9's per-component rule writes", () => {
    const document = committed("table x=40 y=20 rows=2 cols=3", createEmptyDocument());
    const camera = { x: 0, y: 0, zoom: 1 };
    const pressed = pointerDown({ x: 41, y: 21 }, document.objects, camera);
    const moved = pointerMove(pressed, { x: 51, y: 26 }, document.objects, document.journal, camera);
    expect(moved.rejection).toBeUndefined();
    expect(moved.notices).toEqual([]);
    const dragged = moved.objects.find((object) => object.name === "table_1");
    expect(dragged === undefined ? undefined : literalValue(dragged, ["origin", "x"])).toBe(50);
    expect(dragged === undefined ? undefined : literalValue(dragged, ["origin", "y"])).toBe(25);
  });

  it("produces the same circle from D-072's prompt sequence as from §5.10's key=value form, because both build one Command", () => {
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
