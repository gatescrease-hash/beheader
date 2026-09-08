/**
 * prompt.test.ts
 *
 * The prompt state machine, one argument at a time.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_TABLE_COLS, DEFAULT_TABLE_ROWS } from "../engine/primitives/table.ts";
import { COMMAND_NAMES, findCommandSpec, type Command } from "./parser.ts";
import { beginCommand, cancelCommand, respond, type CommandSession, type PendingCommand, type PromptResponse } from "./prompt.ts";

function prompting(session: CommandSession): { readonly pending: PendingCommand; readonly message: string; readonly error: string | undefined } {
  if (session.status !== "prompting") {
    throw new Error(`expected a prompt, got ${session.status}: ${JSON.stringify(session)}`);
  }
  return { pending: session.pending, message: session.message, error: session.error };
}

function completed(session: CommandSession): Command {
  if (session.status !== "complete") {
    throw new Error(`expected a completed command, got ${session.status}: ${JSON.stringify(session)}`);
  }
  return session.command;
}

function walk(line: string, ...responses: readonly PromptResponse[]): CommandSession {
  let session = beginCommand(line);
  for (const response of responses) {
    session = respond(prompting(session).pending, response);
  }
  return session;
}

const typed = (text: string): PromptResponse => ({ kind: "typed", text });
const picked = (x: number, y: number): PromptResponse => ({ kind: "picked", point: { x, y } });

const EQUIVALENT_FORMS: readonly { readonly name: string; readonly typedLine: string; readonly responses: readonly PromptResponse[] }[] = [
  { name: "circle", typedLine: "circle x=100 y=100 r=20", responses: [picked(100, 100), picked(120, 100)] },
  { name: "polygon", typedLine: "polygon sides=5 x=0 y=0 r=50", responses: [typed("5"), picked(0, 0), picked(0, 50)] },
  { name: "rect", typedLine: "rect x=0 y=0 w=200 h=100", responses: [picked(0, 0), picked(200, 100)] },
  { name: "table", typedLine: "table x=0 y=0 rows=8 cols=8", responses: [picked(0, 0), typed(""), typed("")] },
  { name: "image", typedLine: "image x=0 y=0", responses: [picked(0, 0)] },
  { name: "script", typedLine: "script x=0 y=0", responses: [picked(0, 0)] },
  { name: "text", typedLine: 'text x=0 y=0 ""', responses: [picked(0, 0)] },
];

describe("a command word alone starts a sequence (D-072: the AutoCAD gesture)", () => {
  it("prompts for a centre point instead of failing, which is the whole point of the ruling", () => {
    expect(prompting(beginCommand("circle")).message).toBe("specify center point:");
  });

  it("asks for the radius once the centre is given", () => {
    const afterCenter = prompting(respond(prompting(beginCommand("circle")).pending, picked(100, 100)));
    expect(afterCenter.message).toBe("specify radius:");
    expect(afterCenter.pending.stepIndex).toBe(1);
  });

  it("turns a pick at the radius prompt into the distance from the centre already given (D-072 clause 5)", () => {
    expect(walk("circle", picked(100, 100), picked(120, 100))).toEqual({
      status: "complete",
      command: { kind: "circle", x: 100, y: 100, radius: 20 },
    });
  });

  it("takes a typed number at the radius prompt just as readily as a pick", () => {
    expect(completed(walk("circle", typed("100,100"), typed("20")))).toEqual({ kind: "circle", x: 100, y: 100, radius: 20 });
  });

  it("takes a typed point at the radius prompt too, measuring it the same way a pick is measured", () => {
    expect(completed(walk("circle", picked(0, 0), typed("0,50")))).toEqual({ kind: "circle", x: 0, y: 0, radius: 50 });
  });

  it("matches the command word case-insensitively, as the typed form does", () => {
    expect(prompting(beginCommand("CIRCLE")).message).toBe("specify center point:");
  });
});

describe("a line is a sequence of answers (D-072 clause 3: AutoCAD's space-is-Enter)", () => {
  it("finishes on one line when the line says enough", () => {
    expect(completed(beginCommand("circle 100,100 20"))).toEqual({ kind: "circle", x: 100, y: 100, radius: 20 });
  });

  it("stops at the first unanswered step when the line says only some of it", () => {
    const partial = prompting(beginCommand("circle 100,100"));
    expect(partial.message).toBe("specify radius:");
    expect(partial.pending.answers).toEqual({ center: { x: 100, y: 100 } });
  });

  it("routes §5.10's key=value form to the parser untouched, so the documented form is unaffected", () => {
    expect(completed(beginCommand("circle x=100 y=100 r=20"))).toEqual({ kind: "circle", x: 100, y: 100, radius: 20 });
  });

  it("names the SURPLUS token, not the first one the sequence already read correctly (0071-REVIEW F2)", () => {
    const line = "circle 100,100 20 extra";
    const session = beginCommand(line);
    expect(session).toEqual({
      status: "failed",
      message: '"circle" does not take the argument "extra" — usage: circle x=<number> y=<number> r=<number>',
      start: line.indexOf("extra"),
    });
  });

  it("hands a command with no prompt sequence straight to the parser, unchanged", () => {
    expect(completed(beginCommand("zoom 2"))).toEqual({ kind: "zoom", factor: 2 });
    expect(completed(beginCommand("list"))).toEqual({ kind: "list" });
    expect(completed(beginCommand("delete intersection_a force"))).toEqual({ kind: "delete", target: "intersection_a", force: true });
  });

  it("still refuses an unknown word and still names a §5.10 command that is not built", () => {
    const unknown = beginCommand("frobnicate");
    expect(unknown.status === "failed" && unknown.message).toBe('unknown command "frobnicate"');
    const unbuilt = beginCommand("explode polygon_1");
    expect(unbuilt.status === "failed" && unbuilt.message).toContain("not built yet");
  });
});

describe("both forms of every prompting command produce the identical Command (D-072 clause 3)", () => {
  for (const form of EQUIVALENT_FORMS) {
    it(`agrees between "${form.typedLine}" and its prompt sequence`, () => {
      expect(completed(walk(form.name, ...form.responses))).toEqual(completed(beginCommand(form.typedLine)));
    });
  }

  it("has an entry above for every command that declares prompts, so a new sequence cannot land unproven", () => {
    const prompting = COMMAND_NAMES.filter((name) => findCommandSpec(name)?.prompts !== undefined);
    expect([...prompting].sort()).toEqual([...EQUIVALENT_FORMS.map((form) => form.name)].sort());
  });

  it("gives every prompting command a way to build from its answers, so a half-declared sequence fails the suite rather than the operator", () => {
    for (const name of COMMAND_NAMES) {
      const spec = findCommandSpec(name);
      expect(spec?.prompts === undefined).toBe(spec?.buildFromPrompts === undefined);
    }
  });

  it("gives no prompting command a `literal-or-formula` position, which is what lets beginCommand tokenize the rest of its line at all (D-073)", () => {
    for (const name of COMMAND_NAMES) {
      const spec = findCommandSpec(name);
      const carriesFormula = spec?.positional.some((parameter) => parameter.kind === "literal-or-formula") === true;
      expect(spec?.prompts !== undefined && carriesFormula).toBe(false);
    }
  });
});

describe("a refused answer re-prompts the same step and keeps what was gathered (D-072 clause 7)", () => {
  it("does not abandon the command when an answer cannot be read", () => {
    const afterCenter = prompting(respond(prompting(beginCommand("circle")).pending, picked(100, 100)));
    const refused = prompting(respond(afterCenter.pending, typed("wide")));
    expect(refused.error).toBe('specify radius needs a number or a point as x,y — got "wide"');
    expect(refused.pending.stepIndex).toBe(1);
    expect(refused.pending.answers).toEqual({ center: { x: 100, y: 100 } });
  });

  it("accepts the retry, so one typo costs one answer and not three picks", () => {
    const afterCenter = prompting(respond(prompting(beginCommand("circle")).pending, picked(100, 100)));
    const refused = prompting(respond(afterCenter.pending, typed("wide")));
    expect(completed(respond(refused.pending, typed("20")))).toEqual({ kind: "circle", x: 100, y: 100, radius: 20 });
  });

  it("refuses a point that is not x,y, naming the step and what it wanted", () => {
    expect(prompting(respond(prompting(beginCommand("circle")).pending, typed("100"))).error).toBe(
      'specify center point needs a point as x,y — got "100"',
    );
  });

  it("refuses a pick where only a typed number means anything", () => {
    expect(prompting(respond(prompting(beginCommand("polygon")).pending, picked(5, 5))).error).toBe(
      "specify number of sides takes a typed number, not a point",
    );
  });

  it("refuses an empty answer at a step that has no default", () => {
    expect(prompting(respond(prompting(beginCommand("circle")).pending, typed("   "))).error).toBe("specify center point needs a value");
  });
});

describe("defaults (D-072 clause 6: AutoCAD's <8>)", () => {
  it("shows the default in the prompt so the operator knows a bare Enter is enough", () => {
    const afterOrigin = prompting(respond(prompting(beginCommand("table")).pending, picked(0, 0)));
    expect(afterOrigin.message).toBe(`specify rows <${DEFAULT_TABLE_ROWS}>:`);
  });

  it("takes §5.4's 8x8 from an empty answer, reading it from primitives/table.ts rather than a second copy", () => {
    expect(completed(walk("table", picked(0, 0), typed(""), typed("")))).toEqual({
      kind: "table",
      x: 0,
      y: 0,
      rows: DEFAULT_TABLE_ROWS,
      cols: DEFAULT_TABLE_COLS,
    });
  });

  it("takes one count and defaults the other", () => {
    expect(completed(walk("table", picked(10, 20), typed("3"), typed("")))).toEqual({
      kind: "table",
      x: 10,
      y: 20,
      rows: 3,
      cols: DEFAULT_TABLE_COLS,
    });
  });
});

describe("rect prompts for two corners and normalises them (D-072 clause 8)", () => {
  it("builds the same rectangle whichever corner is picked first, because a negative extent is a #TYPE the preset would reject", () => {
    const downRight = completed(walk("rect", picked(0, 50), picked(100, 100)));
    const upLeft = completed(walk("rect", picked(100, 100), picked(0, 50)));
    expect(downRight).toEqual({ kind: "rect", x: 0, y: 50, width: 100, height: 50 });
    expect(upLeft).toEqual(downRight);
  });

  it("never yields a negative width or height from any pair of picks", () => {
    const command = completed(walk("rect", picked(30, 40), picked(-70, -60)));
    expect(command).toEqual({ kind: "rect", x: -70, y: -60, width: 100, height: 100 });
  });
});

describe("polygon walks sides, then centre, then radius (AutoCAD's POLYGON order)", () => {
  it("asks the three steps in order", () => {
    const sides = prompting(beginCommand("polygon"));
    expect(sides.message).toBe("specify number of sides:");
    const center = prompting(respond(sides.pending, typed("6")));
    expect(center.message).toBe("specify center point:");
    const radius = prompting(respond(center.pending, picked(10, 10)));
    expect(radius.message).toBe("specify radius:");
    expect(completed(respond(radius.pending, picked(10, 60)))).toEqual({ kind: "polygon", sides: 6, x: 10, y: 10, radius: 50 });
  });
});

describe("text is placed by pointing — one step, no content step (D-124)", () => {
  it("a bare `text` word prompts for a position instead of failing", () => {
    expect(prompting(beginCommand("text")).message).toBe("specify text position:");
  });

  it("the pick completes the command with empty content — the box is filled in D-125's editor, not here", () => {
    expect(completed(walk("text", picked(30, 40)))).toEqual({ kind: "text", x: 30, y: 40, content: "" });
  });

  it('still takes §5.10\'s quoted-content typed form, routed to parseCommand whole (D-124 clause 3)', () => {
    expect(completed(beginCommand('text "hello world"'))).toEqual({ kind: "text", x: 0, y: 0, content: "hello world" });
    expect(completed(beginCommand('text x=5 y=6 "hi"'))).toEqual({ kind: "text", x: 5, y: 6, content: "hi" });
  });

  it("an unquoted single word still falls through to parseCommand as content (D-124 clause 3)", () => {
    expect(completed(beginCommand("text hello"))).toEqual({ kind: "text", x: 0, y: 0, content: "hello" });
  });

  it("an unquoted `x,y` reads as the point shorthand — box there, empty content — the same as `circle 30,40`", () => {
    expect(completed(beginCommand("text 30,40"))).toEqual({ kind: "text", x: 30, y: 40, content: "" });
    expect(completed(beginCommand('text "30,40"'))).toEqual({ kind: "text", x: 0, y: 0, content: "30,40" });
  });
});

describe("a quoted token is refused as a prompt answer, not silently reinterpreted (0071-REVIEW F4)", () => {
  it("refuses a quoted point, deferring to parseCommand's own grammar rather than accepting it", () => {
    const line = 'circle "100,100" "20"';
    expect(beginCommand(line)).toEqual({
      status: "failed",
      message: '"circle" does not take the argument "100,100" — usage: circle x=<number> y=<number> r=<number>',
      start: line.indexOf('"100,100"'),
    });
  });

  it("refuses a quoted number the same way", () => {
    const line = 'polygon "5" 0,0 20';
    expect(beginCommand(line)).toEqual({
      status: "failed",
      message: '"polygon" does not take the argument "5" — usage: polygon sides=<number> x=<number> y=<number> r=<number>',
      start: line.indexOf('"5"'),
    });
  });
});

describe("a typed formula reaches parseCommand without this file tokenizing it first (D-073, one layer up from parser.ts's own fix)", () => {
  it("completes a `set ... = <formula>` line whose formula contains quoted strings, which `set` has no prompt sequence for", () => {
    expect(completed(beginCommand('set a.b = CONCAT("a", "b")'))).toEqual({
      kind: "set-formula",
      target: "a.b",
      source: '= CONCAT("a", "b")',
    });
  });
});

describe("cancelling", () => {
  it("abandons the sequence, which is the only thing that discards gathered answers", () => {
    expect(cancelCommand()).toEqual({ status: "cancelled" });
  });
});

describe("what the prompt machine deliberately does not decide", () => {
  it("passes a fractional or negative count straight through, because D-070 makes bounds the handler's", () => {
    expect(completed(walk("polygon", typed("2.5"), picked(0, 0), typed("-5")))).toEqual({
      kind: "polygon",
      sides: 2.5,
      x: 0,
      y: 0,
      radius: -5,
    });
  });

  it("holds a plain, serializable pending state — a name, an index and answers, with no spec object or closure in it", () => {
    const pending = prompting(beginCommand("circle")).pending;
    expect(JSON.parse(JSON.stringify(pending))).toEqual(pending);
    expect(pending).toEqual({ commandName: "circle", stepIndex: 0, answers: {} });
  });
});
