/**
 * parser.test.ts — Tests for `command/parser.ts` (§5.10).
 *
 * No document fixtures anywhere in this file, and that is the point: the subject
 * resolves nothing, so every test here is a claim about GRAMMAR alone. The tests that
 * look like they are missing — "rejects an unknown object name", "rejects a name
 * already in use" — belong to `command/commands.ts`, which has the document.
 *
 * `DOCUMENTED_EXAMPLES` is the load-bearing block: it holds §5.10's own example line
 * for every registered command, and a coverage assertion fails if a command is added
 * to the registry without one. That is also what pins each entry's `build` against
 * its own spec — a `build` reading an argument name its spec does not declare
 * produces the loud fallback instead of the value, and the expected command object
 * catches it.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_TABLE_COLS, DEFAULT_TABLE_ROWS } from "../engine/primitives/table.ts";
import { COMMAND_NAMES, COMMANDS_SPECIFIED_BUT_NOT_BUILT, isCommandParseFailure, parseCommand, type Command } from "./parser.ts";

/** The parsed command, or a thrown test failure naming the parser's own message. */
function parsed(line: string): Command {
  const result = parseCommand(line);
  if (isCommandParseFailure(result)) {
    throw new Error(`expected "${line}" to parse, got: ${result.message}`);
  }
  return result.command;
}

/** The failure, or a thrown test failure — the mirror of `parsed`. */
function rejected(line: string): { readonly message: string; readonly start: number } {
  const result = parseCommand(line);
  if (!isCommandParseFailure(result)) {
    throw new Error(`expected "${line}" to be rejected, but it parsed as ${JSON.stringify(result.command)}`);
  }
  return { message: result.message, start: result.start };
}

/**
 * One example line per registered command, taken verbatim from §5.10 wherever §5.10
 * writes one out. `zoom 2` and `delete intersection_a` supply the argument §5.10
 * leaves as a placeholder.
 */
const DOCUMENTED_EXAMPLES: readonly { readonly line: string; readonly command: Command }[] = [
  { line: "circle x=100 y=100 r=20", command: { kind: "circle", x: 100, y: 100, radius: 20 } },
  { line: "polygon sides=5 x=0 y=0 r=50", command: { kind: "polygon", sides: 5, x: 0, y: 0, radius: 50 } },
  { line: "rect x=0 y=0 w=200 h=100", command: { kind: "rect", x: 0, y: 0, width: 200, height: 100 } },
  { line: "table x=0 y=0 rows=8 cols=8", command: { kind: "table", x: 0, y: 0, rows: 8, cols: 8 } },
  { line: "link polygon_1.origin.x table_x.A1", command: { kind: "link", target: "polygon_1.origin.x", source: "table_x.A1" } },
  { line: "unlink polygon_1.origin.x", command: { kind: "unlink", target: "polygon_1.origin.x" } },
  { line: "set polygon_1.radius 42", command: { kind: "set", target: "polygon_1.radius", value: 42 } },
  { line: "rename polygon_1 intersection_a", command: { kind: "rename", target: "polygon_1", newName: "intersection_a" } },
  { line: "delete intersection_a", command: { kind: "delete", target: "intersection_a", force: false } },
  { line: "refs intersection_a", command: { kind: "refs", target: "intersection_a" } },
  { line: "list", command: { kind: "list" } },
  { line: "select intersection_a", command: { kind: "select", target: "intersection_a" } },
  { line: "zoom 2", command: { kind: "zoom", factor: 2 } },
  { line: "fit", command: { kind: "fit" } },
  { line: "save", command: { kind: "save" } },
  { line: "load", command: { kind: "load" } },
];

describe("the command registry (§5.10: table-driven, one entry per command)", () => {
  for (const example of DOCUMENTED_EXAMPLES) {
    it(`parses §5.10's own "${example.line}" into its command object`, () => {
      expect(parsed(example.line)).toEqual(example.command);
    });
  }

  it("has an example above for every registered command, so a new entry cannot land untested", () => {
    expect([...COMMAND_NAMES].sort()).toEqual([...DOCUMENTED_EXAMPLES.map((example) => example.command.kind)].sort());
  });

  it("registers each command word exactly once, in lower case", () => {
    expect(new Set(COMMAND_NAMES).size).toBe(COMMAND_NAMES.length);
    expect(COMMAND_NAMES.filter((name) => name !== name.toLowerCase())).toEqual([]);
  });

  it("never lists a command as both registered and not built, so a command that lands cannot keep reporting itself missing", () => {
    expect(COMMAND_NAMES.filter((name) => COMMANDS_SPECIFIED_BUT_NOT_BUILT.includes(name))).toEqual([]);
  });

  it("reports a §5.10 command that has no entry yet as not built, rather than as unknown", () => {
    expect(rejected("explode polygon_1").message).toBe('"explode" is a §5.10 command that is not built yet');
    expect(rejected("pan 10 10").message).toContain("not built yet");
  });

  it("reports a word §5.10 does not name at all as an unknown command, at that word's own offset", () => {
    expect(rejected("  frobnicate x=1")).toEqual({ message: 'unknown command "frobnicate"', start: 2 });
  });

  it("matches the command word case-insensitively, the way §5.2 already matches object names", () => {
    expect(parsed("LIST")).toEqual({ kind: "list" });
    expect(parsed("Delete intersection_a FORCE")).toEqual({ kind: "delete", target: "intersection_a", force: true });
  });

  it("rejects an empty line rather than returning a command that does nothing", () => {
    expect(rejected("")).toEqual({ message: "empty command", start: 0 });
    expect(rejected("   \t ").message).toBe("empty command");
  });
});

describe("tokenising", () => {
  it("ignores runs of whitespace between arguments", () => {
    expect(parsed("  set   polygon_1.radius    42  ")).toEqual({ kind: "set", target: "polygon_1.radius", value: 42 });
  });

  it("keeps a double-quoted argument whole, spaces included", () => {
    expect(parsed('set text_1.content "hello there"')).toEqual({ kind: "set", target: "text_1.content", value: "hello there" });
  });

  it('unescapes \\" and \\\\ inside a quoted argument, matching §5.3\'s own string escapes', () => {
    expect(parsed('set text_1.content "say \\"hi\\""')).toEqual({ kind: "set", target: "text_1.content", value: 'say "hi"' });
    expect(parsed('set text_1.content "a\\\\b"')).toEqual({ kind: "set", target: "text_1.content", value: "a\\b" });
  });

  it("rejects an escape it does not recognise, rather than silently dropping the backslash", () => {
    expect(rejected('set text_1.content "a\\nb"').message).toBe('unknown escape "\\n" — a quoted value escapes only \\" and \\\\');
  });

  it("rejects an unterminated quoted value, pointing at the quote that opened it", () => {
    expect(rejected('set text_1.content "oops')).toEqual({ message: "unterminated quoted value — add a closing quote", start: 19 });
  });

  it("rejects a quote inside a bare word rather than giving it shell-like concatenation, pointing at the quote", () => {
    expect(rejected('set a"b 1').start).toBe(5);
    expect(rejected('set a"b 1').message).toContain("a quote must open an argument");
  });

  it("rejects a bare word running on from a closing quote, so `delete \"a\"force` cannot silently select §5.1.1's repair path", () => {
    expect(rejected('delete "a"force')).toEqual({
      message: "a quoted argument ends at its closing quote — separate arguments with a space",
      start: 10,
    });
  });

  it("rejects a second quoted run touching the first, refusing concatenation from the same side", () => {
    expect(rejected('set a.b "x""y"').start).toBe(11);
    expect(rejected('set a.b "x"y').message).toContain("ends at its closing quote");
  });
});

describe("named arguments (the creation commands)", () => {
  it("applies §5.4's 8x8 default when rows and cols are omitted, reading it from primitives/table.ts rather than a second copy", () => {
    expect(parsed("table x=0 y=0")).toEqual({ kind: "table", x: 0, y: 0, rows: DEFAULT_TABLE_ROWS, cols: DEFAULT_TABLE_COLS });
  });

  it("takes one of the two optional arguments without the other", () => {
    expect(parsed("table x=1 y=2 cols=3")).toEqual({ kind: "table", x: 1, y: 2, rows: DEFAULT_TABLE_ROWS, cols: 3 });
  });

  it("accepts the arguments in any order", () => {
    expect(parsed("circle r=20 y=100 x=0")).toEqual({ kind: "circle", x: 0, y: 100, radius: 20 });
  });

  it("matches a key case-insensitively", () => {
    expect(parsed("polygon SIDES=5 X=0 y=0 R=50")).toEqual({ kind: "polygon", sides: 5, x: 0, y: 0, radius: 50 });
  });

  it("rejects a key the command does not declare, naming it and the usage line", () => {
    expect(rejected("circle x=1 y=2 z=3 r=4").message).toBe('"circle" has no argument "z" — usage: circle x=<number> y=<number> r=<number>');
  });

  it("rejects a key given twice rather than quietly taking the last one", () => {
    expect(rejected("circle x=1 x=2 y=0 r=1").message).toContain('"x" is given more than once');
  });

  it("rejects a missing required argument, naming which one and pointing past the end of the line", () => {
    const line = "circle x=1 y=2";
    expect(rejected(line)).toEqual({
      message: '"circle" needs r=<number> — usage: circle x=<number> y=<number> r=<number>',
      start: line.length,
    });
  });

  it("rejects a positional argument to a command that takes only key=value", () => {
    expect(rejected("circle 100 100 20").message).toBe('"circle" does not take the argument "100" — usage: circle x=<number> y=<number> r=<number>');
  });

  it("rejects a key with no value and a value with no key", () => {
    expect(rejected("circle x= y=0 r=1").message).toContain('"x=" is not a key=value argument');
    expect(rejected("circle =1 y=0 r=1").message).toContain('"=1" is not a key=value argument');
  });

  it("rejects a non-numeric value, pointing at the argument that carries it", () => {
    expect(rejected("circle x=wide y=0 r=1")).toEqual({
      message: 'x must be a number, got "wide" — usage: circle x=<number> y=<number> r=<number>',
      start: 7,
    });
  });

  it("accepts a negative and a fractional coordinate", () => {
    expect(parsed("rect x=-50 y=0 w=1.5 h=2")).toEqual({ kind: "rect", x: -50, y: 0, width: 1.5, height: 2 });
  });
});

describe("positional arguments", () => {
  it("reads a set value as a number, a quoted string, or a boolean, and quoting is what decides", () => {
    expect(parsed("set v.x 42")).toEqual({ kind: "set", target: "v.x", value: 42 });
    expect(parsed('set v.x "42"')).toEqual({ kind: "set", target: "v.x", value: "42" });
    expect(parsed("set v.x TRUE")).toEqual({ kind: "set", target: "v.x", value: true });
    expect(parsed("set v.x FALSE")).toEqual({ kind: "set", target: "v.x", value: false });
  });

  it("requires a boolean in the exact uppercase §5.3's lexer requires, so one spelling serves both surfaces", () => {
    expect(rejected("set v.x true").message).toContain("must be a number, a quoted string, TRUE, or FALSE");
  });

  it("rejects a bare word that is no literal at all, naming the parameter and the usage", () => {
    expect(rejected("set v.x hello").message).toBe('<value> must be a number, a quoted string, TRUE, or FALSE, got "hello" — usage: set <address> <value> | set <address> = <formula>');
  });

  it("refuses a quoted number where a number is declared, because quoting means the value is text", () => {
    expect(rejected('zoom "2"').message).toContain("<factor> must be a number");
    expect(parsed("zoom 0.5")).toEqual({ kind: "zoom", factor: 0.5 });
  });

  it("rejects too few arguments, naming the one that is missing", () => {
    const line = "link polygon_1.origin.x";
    expect(rejected(line)).toEqual({ message: '"link" needs <source> — usage: link <address> <address>', start: line.length });
  });

  it("rejects an argument past the ones a command declares", () => {
    expect(rejected("link a.b c.d e.f").message).toBe('"link" does not take the argument "e.f" — usage: link <address> <address>');
    expect(rejected("list extra").message).toBe('"list" does not take the argument "extra" — usage: list');
  });

  it("passes a name or address through exactly as typed, folding no case (§5.2 folds case in its own lookup, D-043 owns the cell form)", () => {
    expect(parsed("select Table_X")).toEqual({ kind: "select", target: "Table_X" });
    expect(parsed("rename polygon_1 Intersection_A")).toEqual({ kind: "rename", target: "polygon_1", newName: "Intersection_A" });
    expect(parsed("refs table_x.A1")).toEqual({ kind: "refs", target: "table_x.A1" });
  });
});

describe("the force flag (§5.1.1's repair path, selected by the operator)", () => {
  it("is absent by default", () => {
    expect(parsed("delete intersection_a")).toEqual({ kind: "delete", target: "intersection_a", force: false });
  });

  it("is set when the word follows the object", () => {
    expect(parsed("delete intersection_a force")).toEqual({ kind: "delete", target: "intersection_a", force: true });
  });

  it("fills the positional argument before the flag, so an object actually named force is still deletable", () => {
    expect(parsed("delete force")).toEqual({ kind: "delete", target: "force", force: false });
    expect(parsed("delete force force")).toEqual({ kind: "delete", target: "force", force: true });
  });

  it("rejects the same flag twice", () => {
    expect(rejected("delete a force force").message).toContain('"force" is given more than once');
  });
});

describe("what this parser deliberately leaves to command/commands.ts", () => {
  it("parses a command naming an object that could not possibly exist — identity is resolved with a document, which this file never sees", () => {
    expect(parsed("delete nothing_is_named_this")).toEqual({ kind: "delete", target: "nothing_is_named_this", force: false });
  });

  it("parses an address-shaped argument without checking it is an address, so address.ts stays the one definition of that form (D-043)", () => {
    expect(parsed("set polygon_1 42")).toEqual({ kind: "set", target: "polygon_1", value: 42 });
    expect(parsed("link .. ..")).toEqual({ kind: "link", target: "..", source: ".." });
  });

  it("parses a name that §5.2's grammar forbids, leaving checkNameAvailable to reject it with one message rather than two", () => {
    expect(parsed("rename polygon_1 3bad")).toEqual({ kind: "rename", target: "polygon_1", newName: "3bad" });
  });

  it("produces a non-finite number from an overflowing digit run rather than refusing it here — D-031 clause 3 keeps document-state policy in mutate (D-025)", () => {
    const command = parsed(`set v.x ${"1".repeat(400)}`);
    expect(command).toEqual({ kind: "set", target: "v.x", value: Number.POSITIVE_INFINITY });
  });

  it("produces a negative zero rather than normalising it, for the same reason (Q-008 option (a) lives in mutate)", () => {
    const command = parsed("set v.x -0");
    expect(command.kind).toBe("set");
    expect(Object.is(command.kind === "set" ? command.value : undefined, -0)).toBe(true);
  });
});

describe("formula syntax on the command line (D-071 — Q-013 answered by the human: option (a))", () => {
  it("makes `set <address> = <formula>` a formula command rather than a literal one", () => {
    expect(parsed("set table_x.B1 = polygon_b.origin.x * 2")).toEqual({
      kind: "set-formula",
      target: "table_x.B1",
      source: "= polygon_b.origin.x * 2",
    });
  });

  it("carries the RAW substring of the line, spacing and all, because re-joining tokens would discard what a #PARSE message points at (D-071 clause 1, D-038 clause 4)", () => {
    expect(parsed("set a.b =   SUM(A1:A5)  *  2  ")).toEqual({
      kind: "set-formula",
      target: "a.b",
      source: "=   SUM(A1:A5)  *  2  ",
    });
  });

  it("does not require a space after the equals sign, so the shape rather than the spacing decides", () => {
    expect(parsed("set table_x.B1 =polygon_b.origin.x")).toEqual({
      kind: "set-formula",
      target: "table_x.B1",
      source: "=polygon_b.origin.x",
    });
  });

  it("parses nothing in the source — commands.ts calls parseFormula, so a syntactically broken formula still reaches it (D-069, D-071 clause 2)", () => {
    expect(parsed("set a.b = ((( not a formula")).toEqual({
      kind: "set-formula",
      target: "a.b",
      source: "= ((( not a formula",
    });
  });

  it("keeps an equals sign inside a quoted value a string, because quoting decides type everywhere on this line (D-071 clause 3)", () => {
    expect(parsed('set text_1.content "= not a formula"')).toEqual({ kind: "set", target: "text_1.content", value: "= not a formula" });
  });

  it("rejects an equals sign with no formula after it, which is arity and therefore this file's", () => {
    expect(rejected("set a.b =").message).toContain('needs a formula after "="');
    expect(rejected("set a.b =    ").message).toContain('needs a formula after "="');
  });

  it("refuses a formula to a command that takes none, naming the one command that does", () => {
    expect(rejected("rename polygon_1 =other").message).toBe('"rename" takes no formula — only "set <address> = <formula>" does (D-071)');
    expect(rejected("link a.b =c.d").message).toContain("takes no formula");
  });

  it("lets a keyless key=value explain itself rather than blaming a formula, which is the better of the two messages", () => {
    expect(rejected("circle =1 y=0 r=1").message).toContain('"=1" is not a key=value argument');
  });
});

describe("the command lexer stops at a formula's `=` (D-073) — §5.3's string literals are typeable", () => {
  it("carries a formula containing a quoted string argument, spaced around its parens the way an operator naturally would", () => {
    expect(parsed('set a.b = CONCAT("a", "b")')).toEqual({
      kind: "set-formula",
      target: "a.b",
      source: '= CONCAT("a", "b")',
    });
  });

  it("carries a formula whose quoted strings sit right against a comma, which the command lexer's own quoting rules would otherwise reject", () => {
    expect(parsed('set a.b = IF(t.c > 1, "big", "small")')).toEqual({
      kind: "set-formula",
      target: "a.b",
      source: '= IF(t.c > 1, "big", "small")',
    });
  });

  it("carries a formula whose closing quote is immediately followed by more formula text, not whitespace", () => {
    expect(parsed('set a.b = LEN("hello") > 3')).toEqual({
      kind: "set-formula",
      target: "a.b",
      source: '= LEN("hello") > 3',
    });
  });

  it("takes the whole line raw even with no space between the `=` and the quote", () => {
    expect(parsed('set a.b =CONCAT("a","b")')).toEqual({
      kind: "set-formula",
      target: "a.b",
      source: '=CONCAT("a","b")',
    });
  });

  it("still applies the command lexer's quoting rules to everything BEFORE the formula's `=`, unchanged", () => {
    expect(rejected('set a"b = CONCAT("x")').start).toBe(5);
    expect(rejected('set a"b = CONCAT("x")').message).toContain("a quote must open an argument");
  });
});
