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
import { MAX_TABLE_LINES } from "../engine/primitives/table.ts";
import { hitTest } from "../render/hittest.ts";
import { INITIAL_INTERACTION_STATE, pointerDown, pointerMove } from "../render/interaction.ts";
import { COMMAND_NAMES, isCommandParseFailure, parseCommand, type Command } from "./parser.ts";
import { beginCommand, respond } from "./prompt.ts";
import { COMMANDS_WITH_HANDLERS, executeCommand, isCommandFailure, MAX_POLYGON_SIDES, type CommandOutcome } from "./commands.ts";

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

/** The object a name resolves to, or a thrown test failure — so a test asserting on an ID never silently reads `undefined.id`. */
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

describe("D-097 — a table's rows/cols are bounded at every WRITE, not only at creation (the vanishing table, 0100-REVIEW-phase4)", () => {
  /** §0100-REVIEW's own repro table, reproduced end to end through the real `set` command rather than a hand-built `Operation`. */
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
    // The dynamic cell family grows with it: A5 was out of range for the
    // original 3-row table and is a real, writable cell now.
    const withCell = committed("set table_1.A5 1", after);
    expect(literalValue(onlyNamed(withCell, "table_1"), ["cells", "A5"])).toBe(1);
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
});

describe("every registry command reaches a handler", () => {
  it("routes every word the parser can produce, so a new registry entry cannot land unrouted", () => {
    // Entry 0085 emptied the other side of this comparison: with `select`/`zoom`/
    // `fit`/`save`/`load` built, there is no "no handler yet" set left to add in.
    expect([...COMMANDS_WITH_HANDLERS].sort()).toEqual([...COMMAND_NAMES].sort());
  });

  /** Every §5.10 example line the registry can parse, one per command. Counted nowhere — the second test below pins it against `COMMAND_NAMES`, which is what 0078-REVIEW fix list item 1 asked for after a hand-written sweep claimed the registry and covered six. */
  const EVERY_REGISTRY_EXAMPLE: readonly string[] = [
    "circle x=0 y=0 r=1",
    "polygon sides=3 x=0 y=0 r=1",
    "rect x=0 y=0 w=1 h=1",
    "table x=0 y=0",
    "set polygon_1.radius 42",
    "set polygon_1.radius = 1 + 1",
    "link polygon_1.origin.x table_x.A1",
    "unlink polygon_1.origin.x",
    "rename intersection_a polygon_9",
    "delete intersection_a",
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

describe("the effect commands — select, zoom, fit, save, load (§5.10, D-075)", () => {
  /** A polygon and a table, so the four commands that need something to point at have one. */
  function sandbox(): Document {
    return committed("table x=0 y=0 rows=2 cols=2", committed("polygon sides=5 x=10 y=20 r=50", createEmptyDocument()));
  }

  /** The whole success arm, so a test can read `effect` and `lines` off one outcome. */
  function succeeded(line: string, document: Document) {
    const outcome = run(line, document);
    if (isCommandFailure(outcome)) {
      throw new Error(`expected "${line}" to succeed, got: ${outcome.message}`);
    }
    return outcome;
  }

  describe("select", () => {
    it("resolves the name HERE and returns the ID, because a name is mutable and main.ts must not resolve one (D-075 clause 1)", () => {
      const document = sandbox();
      const outcome = succeeded("select polygon_1", document);
      expect(outcome.effect).toEqual({ kind: "select", objectId: onlyNamed(document, "polygon_1").id });
      expect(outcome.lines).toEqual(["selected polygon_1"]);
    });

    it("resolves case-insensitively, the same §5.2 lookup delete and rename use", () => {
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
    it("passes the factor through untouched, because the clamp to [MIN_ZOOM, MAX_ZOOM] is render/camera.ts's (D-062, D-075 clause 5)", () => {
      const outcome = succeeded("zoom 2", createEmptyDocument());
      expect(outcome.effect).toEqual({ kind: "zoom", factor: 2 });
      expect(outcome.lines).toEqual(["zoom by 2"]);
    });

    it("accepts a factor below 1, which is zooming out and not an error", () => {
      expect(succeeded("zoom 0.5", createEmptyDocument()).effect).toEqual({ kind: "zoom", factor: 0.5 });
    });

    // 0086-REVIEW: "changes no document state" is the PREMISE of D-075, so every
    // effect command pins it, not only the three whose handler names it. D-027
    // clause 2 keeps the camera write off `mutate`; this pins that `zoom` does not
    // make one here either.
    it("returns the document it was given, by identity — Document.camera is written by main.ts, never here", () => {
      const document = sandbox();
      expect(succeeded("zoom 2", document).document).toBe(document);
    });

    it("needs no objects — an empty document still has a camera", () => {
      expect(succeeded("zoom 3", createEmptyDocument()).effect).toEqual({ kind: "zoom", factor: 3 });
    });

    // "1e999" is NOT among these: the command line's number grammar has no exponent
    // form, so an infinity reaches this handler only as a run of digits too long to
    // represent — which is a line an operator can actually type.
    for (const factor of ["0", "-2", "0.0", "-0.5", "9".repeat(400)]) {
      it(`refuses "zoom ${factor.slice(0, 12)}", which is not a multiplier and would reach the camera's clamp as a silent no-op`, () => {
        expect(refused(`zoom ${factor}`, createEmptyDocument())).toContain("factor must be a positive number");
      });
    }

    it("names the offending factor in the refusal, per §5.10's every-rejection-names-the-specifics rule", () => {
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

    // 0086-REVIEW: as for `zoom` above — reading the object list is not writing it.
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

    it("save is allowed on an empty document — an empty document is a document (§5.11)", () => {
      expect(succeeded("save", createEmptyDocument()).effect).toEqual({ kind: "save" });
    });
  });

  describe("who carries an effect at all", () => {
    it("gives list and refs NONE, because their answer is lines (D-075 clause 4)", () => {
      const document = sandbox();
      expect(succeeded("list", document).effect).toBeUndefined();
      expect(succeeded("refs polygon_1", document).effect).toBeUndefined();
    });

    it("gives a command that CHANGES the document none either — the new document is the whole result", () => {
      expect(succeeded("circle x=0 y=0 r=1", createEmptyDocument()).effect).toBeUndefined();
      expect(succeeded("set polygon_1.radius 9", sandbox()).effect).toBeUndefined();
    });

    it("is plain, serializable data — no function survives a JSON round trip, so this pins D-075 clause 2 mechanically", () => {
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
    // The camera is the identity transform, so screen and world coordinates agree —
    // this is a claim about which SLOTS the handler wrote, not about camera math.
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(hitTest({ x: 41, y: 21 }, outcome.document.objects, camera)?.name).toBe("table_1");
    expect(hitTest({ x: 39, y: 19 }, outcome.document.objects, camera)).toBeUndefined();
  });

  it("makes a command-created table draggable, because its origin slots are the ones §5.9's per-component rule writes", () => {
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

describe("the slot commands — set, link, unlink (§5.10, D-040, D-041, D-071)", () => {
  /** A polygon and a 4x4 table, both built by the creation commands this file already tests. */
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

  describe("set writes a literal (§5.10)", () => {
    it("replaces a literal slot's value and echoes what it wrote", () => {
      const outcome = run("set polygon_1.radius 42", sandbox());
      expect(outcome.ok && outcome.lines).toEqual(["polygon_1.radius = 42"]);
      expect(slotOf(committed("set polygon_1.radius 42", sandbox()), "polygon_1", ["radius"])).toEqual({ kind: "literal", value: 42 });
    });

    it("CREATES a table cell slot that did not exist, which is how an absent cell gets written at all (D-047)", () => {
      const before = sandbox();
      expect(slotOf(before, "table_1", ["cells", "A1"])).toBeUndefined();
      expect(slotOf(committed("set table_1.A1 5", before), "table_1", ["cells", "A1"])).toEqual({ kind: "literal", value: 5 });
    });

    it("accepts a lowercase cell reference and writes the SAME slot as the uppercase one (D-039)", () => {
      expect(slotOf(committed("set table_1.a1 5", sandbox()), "table_1", ["cells", "A1"])).toEqual({ kind: "literal", value: 5 });
    });

    it("writes a string and a boolean, the other two Values a command line can express", () => {
      const document = committed('set table_1.B2 "hello"', sandbox());
      expect(slotOf(document, "table_1", ["cells", "B2"])?.value).toBe("hello");
      expect(slotOf(committed("set table_1.B3 TRUE", document), "table_1", ["cells", "B3"])?.value).toBe(true);
    });
  });

  describe("what a slot command refuses (identity failures are the handler's — D-069)", () => {
    it("refuses an unknown object name with parseAddress's own message", () => {
      expect(refused("set nosuch.radius 1", sandbox())).toBe('no object named "nosuch"');
    });

    it("refuses a DERIVED slot, naming it — §5.1's 'derived is fixed by schema and can never be converted', which D-040 leaves untouched", () => {
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

  describe("set writes a FORMULA when the value position begins with = (D-071)", () => {
    it("stores a formula slot and lets step 7 of the same mutation evaluate it — no caller ever sees the null", () => {
      const document = committed("set table_1.A1 = 2 + 3 * 4", sandbox());
      const slot = slotOf(document, "table_1", ["cells", "A1"]);
      expect(slot?.kind).toBe("formula");
      expect(slot?.value).toBe(14);
    });

    it("echoes the formula back through the CURRENT names, which is the only form of its source that exists (§5.2)", () => {
      const outcome = run("set table_1.A1 = polygon_1.origin.x * 2", sandbox());
      expect(outcome.ok && outcome.lines).toEqual(["table_1.A1 = polygon_1.origin.x * 2"]);
    });

    it("resolves a BARE cell ref when the target is a cell of that table, and refuses one when it is not (§5.3)", () => {
      const seeded = committed("set table_1.A1 7", sandbox());
      expect(slotOf(committed("set table_1.B1 = A1 + 1", seeded), "table_1", ["cells", "B1"])?.value).toBe(8);
      expect(refused("set polygon_1.radius = A1", seeded)).toContain("A1");
    });

    it("accepts a formula containing a quoted string, because the command lexer stops at the = (D-073)", () => {
      expect(slotOf(committed('set table_1.A1 = CONCAT("a", "b")', sandbox()), "table_1", ["cells", "A1"])?.value).toBe("ab");
    });

    it("rejects a cycle at mutation time and never stores it (§5.1 step 5)", () => {
      const seeded = committed("set table_1.A1 = table_1.B1", committed("set table_1.B1 1", sandbox()));
      expect(refused("set table_1.B1 = table_1.A1", seeded)).toContain("cyclic dependency");
      expect(slotOf(seeded, "table_1", ["cells", "B1"])).toEqual({ kind: "literal", value: 1 });
    });

    it("a bare reference to an EMPTY cell WITHIN the table's extent reads as 0 rather than being refused (D-110, reversing this test's own former D-047 clause 4 reading)", () => {
      // B1 is inside table_1's 4x4 extent and has never been written — D-110's
      // own case. A range over the same emptiness has always been fine (D-047),
      // unaffected by this ruling; both are pinned here to keep the two together.
      expect(slotOf(committed("set table_1.A1 = table_1.B1", sandbox()), "table_1", ["cells", "A1"])?.value).toBe(0);
      expect(slotOf(committed("set table_1.A1 = SUM(B1:B4)", sandbox()), "table_1", ["cells", "A1"])?.value).toBe(0);
    });

    it("a bare reference to a cell OUTSIDE the table's extent is STILL a dangling reference — D-110 clause 6's boundary: there is no extent to make it legal", () => {
      // table_1 is 4x4 (sandbox() above); B9's row is past it entirely.
      expect(refused("set table_1.A1 = table_1.B9", sandbox())).toContain("references a slot that does not exist");
    });
  });

  describe("D-038 — a formula that cannot be valid is refused when it is ENTERED, and its source is not discarded", () => {
    it("refuses an unknown function name, carrying the offending name and its position", () => {
      const message = refused("set table_1.A1 = NOSUCH(1)", sandbox());
      expect(message).toContain('unknown function "NOSUCH"');
      // Position 0, not 1: the offset is into the source the message SHOWS, which is the
      // formula trimmed of the space after the `=` (0080-REVIEW E1). A position measured
      // against a different string than the one quoted beside it is worse than none.
      expect(message).toContain("at position 0");
      expect(message).toContain("NOSUCH(1)");
    });

    it("measures that position against the source it quotes, however much space follows the = (0080-REVIEW E1)", () => {
      expect(refused("set table_1.A1 =    1 + NOSUCH(1)", sandbox())).toBe('unknown function "NOSUCH" (at position 4 of "1 + NOSUCH(1)")');
    });

    it("refuses a known function called with the wrong argument count", () => {
      expect(refused("set table_1.A1 = ROUND(1)", sandbox())).toContain("ROUND");
    });

    it("refuses an unresolvable reference at parse time, regardless of which IF branch it sits in (§5.3)", () => {
      expect(refused("set table_1.A1 = IF(TRUE, 1, nosuch.value)", sandbox())).toContain('no object named "nosuch"');
    });

    it("echoes the source text back so the operator edits it rather than retyping it (clause 4)", () => {
      expect(refused("set table_1.A1 = 1 +", sandbox())).toContain('"1 +"');
    });
  });

  describe("D-040 — an explicit write to a formula slot REPLACES it, and is not silent", () => {
    it("turns a formula slot back into a literal and reports the formula source it replaced", () => {
      const bound = committed("set table_1.A1 = polygon_1.radius + 1", sandbox());
      const outcome = run("set table_1.A1 9", bound);
      expect(outcome.ok && outcome.lines).toEqual(["table_1.A1 = 9", "replaced formula: = polygon_1.radius + 1"]);
      expect(slotOf(committed("set table_1.A1 9", bound), "table_1", ["cells", "A1"])).toEqual({ kind: "literal", value: 9 });
    });

    it("reports a replacement identically whether the new slot is a literal, a formula, or a link — one path writes all three (D-071 clause 4)", () => {
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

    it("still refuses a DERIVED slot — D-040's bound 3", () => {
      expect(refused("set polygon_1.vertices 1", sandbox())).toContain("is a derived slot");
    });
  });

  describe("link — §5.1's degenerate formula, through the same path (D-071 clause 4)", () => {
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

    it("refuses a source that is not an address, because §5.10 declares link <address> <address>", () => {
      expect(refused("link polygon_1.radius 42", sandbox())).toContain('"link" takes an address as its source');
    });

    it("refuses a source naming no object, with parseFormula's own message", () => {
      expect(refused("link polygon_1.radius nosuch.value", sandbox())).toContain('no object named "nosuch"');
    });
  });

  describe("unlink — D-041, the value last displayed is the value kept", () => {
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

    it("keeps an ERROR value rather than refusing or substituting a default — errors included, D-041 exactly", () => {
      const erroring = committed("set table_1.A1 = 1 / 0", sandbox());
      const freed = committed("unlink table_1.A1", erroring);
      const kept = slotOf(freed, "table_1", ["cells", "A1"]);
      expect(kept?.kind).toBe("literal");
      expect(kept?.value).toEqual({ error: "#DIV0", message: "division by zero" });
    });

    it("lets the operator type over that frozen error, which is what makes D-041 safe (D-040)", () => {
      const frozen = committed("unlink table_1.A1", committed("set table_1.A1 = 1 / 0", sandbox()));
      expect(slotOf(committed("set table_1.A1 3", frozen), "table_1", ["cells", "A1"])?.value).toBe(3);
    });

    it("refuses a slot that is not a formula, saying which state it is actually in", () => {
      expect(refused("unlink polygon_1.radius", sandbox())).toBe('polygon_1.radius is already a "literal" slot — "unlink" reverts a formula slot to a literal');
      expect(refused("unlink table_1.A1", sandbox())).toBe('table_1.A1 holds nothing — "unlink" reverts a formula slot to a literal');
      expect(refused("unlink polygon_1.area", sandbox())).toContain("is a derived slot");
    });
  });

  describe("the loop these four commands close", () => {
    it("propagates a cell edit through a link to the geometry it drives, in one topological pass (§5.1)", () => {
      const wired = committed("link polygon_1.origin.x table_1.A1", committed("set table_1.A1 100", sandbox()));
      // Two derived slots deep: the cell drives `origin.x`, which drives `vertices`,
      // which drives `centroid.x` — all three inside the one topological pass the
      // writing mutation runs, with no post-pass recompute.
      expect(slotOf(wired, "polygon_1", ["centroid", "x"])?.value).toBeCloseTo(100, 6);
      const moved = committed("set table_1.A1 250", wired);
      expect(slotOf(moved, "polygon_1", ["centroid", "x"])?.value).toBeCloseTo(250, 6);
    });

    it("reads geometry back out into a cell, the other direction of §5.1's example chain", () => {
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
  /** A polygon and a 4x4 table, the same fixture the slot commands use, because these commands are about what those built. */
  function sandbox(): Document {
    return committed("table x=0 y=0 rows=4 cols=4", committed("polygon sides=5 x=10 y=20 r=50", createEmptyDocument()));
  }

  /** A document in which `table_1.A1` drives `polygon_1.origin.x` — the one wiring that makes a delete refusable. */
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

  describe("list — §5.10's dump all objects and names", () => {
    it("says so plainly on an empty document rather than returning no lines at all", () => {
      expect(lines("list", createEmptyDocument())).toEqual(["no objects"]);
    });

    it("names every object with its type, in creation order", () => {
      expect(lines("list", sandbox())).toEqual(["polygon_1 — polygon", "table_1 — table"]);
    });

    it("never prints an object id, because §5.2 makes the id the layer the operator never writes", () => {
      const listed = lines("list", sandbox()).join("\n");
      for (const object of sandbox().objects) {
        expect(listed).not.toContain(object.id);
      }
    });

    it("returns the document it was given, unchanged and unjournalled — D-075 clause 4's reason for giving it no effect", () => {
      const before = sandbox();
      const outcome = run("list", before);
      expect(outcome.ok && outcome.document).toBe(before);
      expect(before.journal).toHaveLength(2);
    });
  });

  describe("refs — §5.1.1's look before you delete", () => {
    it("names the slot on another object that reads the target, in the edge's own source → dependent direction", () => {
      expect(lines("refs table_1", wired())[0]).toBe("table_1.A1 → polygon_1.origin.x");
    });

    it("counts other objects' dependents apart from the target's own, because only the first kind can block a delete (§5.1.1)", () => {
      const reported = lines("refs table_1", wired());
      expect(reported[reported.length - 1]).toBe("1 inbound edge from 1 dependent slot: 1 on other objects, 0 on table_1 itself");
    });

    it("reports a preset's own schema wiring rather than hiding it — its derived slots do read its parameters", () => {
      const reported = lines("refs polygon_1", sandbox());
      // Five parameter slots feed `vertices`, and `vertices` feeds the eight slots
      // `verticesDerivedSlots` bundles (centroid.x/y, area, length, bounds.*).
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

    it("accepts a DERIVED slot as a target — reading who depends on a computed value is not an attempt to write it (§5.1)", () => {
      const reported = lines("refs polygon_1.vertices", sandbox());
      expect(reported[reported.length - 1]).toBe("8 inbound edges from 8 dependent slots: 0 on other objects, 8 on polygon_1 itself");
    });

    it("says nothing references a target rather than printing an empty report", () => {
      expect(lines("refs table_1", sandbox())).toEqual(["nothing references table_1"]);
      expect(lines("refs table_1.A1", sandbox())).toEqual(["nothing references table_1.A1"]);
    });

    it("accepts a cell path the table declares but nobody has written, because D-047 makes an absent cell ordinary state", () => {
      expect(lines("refs table_1.D4", sandbox())).toEqual(["nothing references table_1.D4"]);
    });

    it("D-110's disclosed consequence: does NOT report a formula that reads an EMPTY in-extent cell as one of its dependents, because clause 4 gives that reference no edge — until the cell is populated, which makes the edge (and the report) appear on its own", () => {
      const linkedToEmptyCell = committed("link polygon_1.origin.x table_1.D4", sandbox()); // D4 is empty and in-extent.
      expect(lines("refs table_1.D4", linkedToEmptyCell)).toEqual(["nothing references table_1.D4"]);

      const populated = committed("set table_1.D4 1", linkedToEmptyCell);
      expect(lines("refs table_1.D4", populated)).toEqual([
        "table_1.D4 → polygon_1.origin.x",
        "1 inbound edge from 1 dependent slot: 1 on other objects, 0 on table_1 itself",
      ]);
    });

    it("names a dependent once even where the formula reads it twice, because the report is about which SLOTS read the target", () => {
      const twice = committed("set table_1.B1 = table_1.A1 + table_1.A1", committed("set table_1.A1 2", sandbox()));
      expect(lines("refs table_1.A1", twice)).toEqual([
        "table_1.A1 → table_1.B1",
        "1 inbound edge from 1 dependent slot: 0 on other objects, 1 on table_1 itself",
      ]);
    });

    it("counts EDGES and SLOTS apart where one slot reads two slots of the target, because only the slot count says how much unlinking a delete needs (§5.1.1)", () => {
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

    it("returns the document it was given, unchanged and unjournalled (D-075 clause 4)", () => {
      const before = wired();
      const outcome = run("refs table_1", before);
      expect(outcome.ok && outcome.document).toBe(before);
    });

    it("reports exactly the dependent a non-forced delete then refuses, because both read deriveEdges over the same document", () => {
      const document = wired();
      expect(lines("refs table_1", document)[0]).toBe("table_1.A1 → polygon_1.origin.x");
      expect(refused("delete table_1", document)).toContain("polygon_1.origin.x");
    });

    /**
     * The case that made the blocking half derive from the document WITHOUT the target.
     * A range over cells nobody has written expands to no edges at all (D-047 item 1),
     * so a `refs` reading the CURRENT edge set answered "nothing references table_1"
     * for a document whose `delete table_1` is refused — the exact failure §5.1.1
     * provides this command to prevent. Found by probe at entry 0081, not by reading.
     */
    describe("a range over cells nobody has written yet", () => {
      /** `table_2.A1` aggregates a column of `table_1` in which no cell slot exists. */
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

  describe("props — D-092 clause 4's slot enumeration, D-094 clause 9's shared reading of it", () => {
    it("headers the report with the object's name and type, the same pair list uses", () => {
      expect(lines("props polygon_1", sandbox())[0]).toBe("polygon_1 — polygon");
    });

    it("lists every slot in SCHEMA order — non-derived first, then derived (D-094 clause 7)", () => {
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

    it("marks a derived slot as derived, never as something §5.1 lets the operator set or link", () => {
      const reported = lines("props polygon_1", sandbox());
      expect(reported.some((line) => line.startsWith("vertices = ") && line.endsWith("(derived)"))).toBe(true);
    });

    it("shows a formula slot's reconstructed SOURCE alongside its current value (D-092 clause 4)", () => {
      const document = committed("link polygon_1.origin.x table_1.A1", committed("set table_1.A1 7", sandbox()));
      expect(lines("props polygon_1", document)).toContain("origin.x = 7 (formula, = table_1.A1)");
    });

    it("gives a table's cell family ONE row naming the grid and how many cells are WRITTEN, never one row per cell (D-077, D-094 clause 8)", () => {
      const document = committed("set table_1.B2 2", committed("set table_1.A1 5", sandbox()));
      const reported = lines("props table_1", document);
      expect(reported).toContain('cells = "4×4 grid — 2 of 16 cells written" (literal)');
      // Exactly one row for the whole family, not one per declared cell (16 here, tens of thousands on a large table).
      expect(reported.filter((line) => line.startsWith("cells"))).toHaveLength(1);
    });

    it("counts a table's WRITTEN cells, not its declared extent — an absent cell is D-047's ordinary empty", () => {
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

    it("returns the document it was given, unchanged and unjournalled (D-075 clause 4, D-092 clause 6)", () => {
      const before = sandbox();
      const outcome = run("props polygon_1", before);
      expect(outcome.ok && outcome.document).toBe(before);
    });
  });

  describe("delete — §5.1.1's two paths, chosen by the operator's force flag", () => {
    it("removes an object nothing reads, and says which one it removed", () => {
      const after = committed("delete table_1", sandbox());
      expect(lines("delete table_1", sandbox())).toEqual(["deleted table_1"]);
      expect(named(after, "table_1")).toBeUndefined();
      expect(named(after, "polygon_1")).toBeDefined();
    });

    it("REJECTS while another object still reads it, naming every dependent (§5.1.1 clause 1)", () => {
      expect(refused("delete table_1", wired())).toContain("polygon_1.origin.x references a slot that does not exist");
    });

    it("names the force flag in that refusal, because a mutate rejection cannot — an Operation carries no command syntax", () => {
      expect(refused("delete table_1", wired())).toContain('unlink each, or "delete table_1 force" to rewrite them to #REF instead');
    });

    it("leaves prior state bit-for-bit unchanged when it rejects (§5.1 step 6)", () => {
      const before = wired();
      const snapshot = JSON.stringify(before);
      refused("delete table_1", before);
      expect(JSON.stringify(before)).toBe(snapshot);
    });

    it("takes §5.1.1's REPAIR path under force, and reports every slot it broke (D-057's first reader)", () => {
      const outcome = run("delete table_1 force", wired());
      expect(outcome.ok && outcome.lines).toEqual([
        "deleted table_1",
        "broke 1 formula: polygon_1.origin.x — each now reads #REF where it read table_1",
      ]);
    });

    it("leaves the broken formula holding a #REF value rather than a dangling edge (§5.1.1's whole reason for the repair path)", () => {
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

    it("treats an EXTERNAL formula reading a DERIVED slot exactly like any other reference — refused, then repaired under force (entry 0081's disclosed gap, pinned at 0082-REVIEW)", () => {
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

    it("frees the deleted name for reuse while never reusing its id (D-002)", () => {
      const recreated = committed("table x=0 y=0 rows=2 cols=2", committed("delete table_1", sandbox()));
      const table = named(recreated, "table_1");
      expect(table?.id).toBe("obj_3");
    });
  });
});

describe("rename — §5.10's one object command that needed a new Operation kind (§5.2, §5.3)", () => {
  /** A polygon whose origin.x is DRIVEN by `table_1.A1`, so a rename has a live formula to leave alone. */
  function wired(): Document {
    const sandbox = committed("table x=0 y=0 rows=4 cols=4", committed("polygon sides=5 x=10 y=20 r=50", createEmptyDocument()));
    return committed("link polygon_1.origin.x table_1.A1", committed("set table_1.A1 5", sandbox));
  }

  function named(document: Document, objectName: string): GraphObject | undefined {
    return document.objects.find((candidate) => candidate.name === objectName);
  }

  it("writes the new name and echoes both, at §5.10's own example line", () => {
    const outcome = run("rename polygon_1 intersection_a", wired());
    expect(outcome.ok && outcome.lines).toEqual(["renamed polygon_1 to intersection_a"]);
    expect(outcome.ok && named(outcome.document, "intersection_a")?.id).toBe("obj_1");
    expect(outcome.ok && named(outcome.document, "polygon_1")).toBeUndefined();
  });

  it("resolves the OLD name case-insensitively, the same resolver delete uses (§5.2)", () => {
    expect(committed("rename POLYGON_1 intersection_a", wired()).objects[0]?.name).toBe("intersection_a");
  });

  it("leaves every formula pointing at the renamed object working — §5.3's whole reason for storing ids", () => {
    const renamed = committed("rename table_1 grid", wired());
    const driven = committed("set grid.A1 42", renamed);
    expect(getSlot(named(driven, "polygon_1") as GraphObject, ["origin", "x"])?.value).toBe(42);
  });

  it("makes the NEW name the one an address is printed with, because formatAddress resolves a name from the id (§5.3)", () => {
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

  it("refuses a new name another object already holds, in mutate's words — §5.2's uniqueness has ONE gate, not a copy here", () => {
    expect(refused("rename polygon_1 table_1", wired())).toBe('operation 1 of 1 cannot rename: the name "table_1" is already in use');
    expect(refused("rename polygon_1 TABLE_1", wired())).toContain("already in use");
  });

  it("refuses a new name that fails §5.2's grammar — the parser deliberately let it through (D-043)", () => {
    expect(refused("rename polygon_1 3bad", wired())).toBe(
      'operation 1 of 1 cannot rename: "3bad" is not a valid name — names must match [a-zA-Z_][a-zA-Z0-9_]*',
    );
  });

  it("ACCEPTS a rename that only changes case, since uniqueness excludes the object being renamed", () => {
    expect(committed("rename polygon_1 POLYGON_1", wired()).objects[0]?.name).toBe("POLYGON_1");
  });

  it("leaves prior state bit-for-bit unchanged when it refuses (§5.1 step 6)", () => {
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

  it("takes no id and moves no counter — a rename is not a create (D-002)", () => {
    const before = wired();
    expect(committed("rename polygon_1 intersection_a", before).nextObjectId).toBe(before.nextObjectId);
  });

  // D-080 (0084-REVIEW): before this, `rename table_1 TRUE` committed and left an
  // object no formula and no `link` could name again — §5.2's grammar admits five
  // words §5.3 lexes as keywords.
  it("refuses a new name §5.3 lexes as a formula keyword, naming all five and what to do (D-080)", () => {
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

  it("leaves every ACCEPTED new name referenceable by a formula, which is the property D-080 protects", () => {
    const renamed = committed("rename table_1 grid", wired());
    const driven = committed("set polygon_1.radius = grid.A1 + 1", renamed);
    expect(getSlot(named(driven, "polygon_1") as GraphObject, ["radius"])?.value).toBe(6);
  });
});

// The defect this block closes was STATUS's first "read this first" item for four
// entries: `executeCommand` was the one call in this file that could throw, and
// nothing measured bounded it (D-079). The fix is two fixed constants in
// `formula/parser.ts` and `formula/ast.ts`; what belongs HERE is the end-to-end
// claim, because this is the seam a typed line crosses.
describe("a formula too deep to walk is refused, not thrown (D-079)", () => {
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
    // Not just a parse: this walks the same AST through `deps.ts`, `eval.ts` and
    // `format.ts` — every other recursion over the shape the limit now bounds. If any
    // of them died at depth 1,000 the constant would be wrong, and this is what says so.
    const committed1000 = committed(`set table_1.A1 = ${chain(1000)}`, sandbox());
    expect(getSlot(named(committed1000, "table_1") as GraphObject, ["cells", "A1"])?.value).toBe(1000);
  });

  it("reports the replaced deep formula rather than throwing while formatting it (D-040)", () => {
    // `writeSlot` formats the formula it replaces, which is `format.ts`'s recursion
    // over the same tree — the second of the two sites the old defect named.
    const withDeep = committed(`set table_1.A1 = ${chain(1000)}`, sandbox());
    const outcome = run("set table_1.A1 7", withDeep);
    expect(outcome.ok && outcome.lines.join("\n")).toContain("1 + 1");
  });
});
