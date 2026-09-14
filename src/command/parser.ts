/**
 * parser.ts
 *
 * Turns one complete typed line into one command object, against a table of
 * specs. Adding a command is an entry in that table rather than a new
 * branch in a parser.
 *
 * It never throws. A line it cannot read comes back as a failure that names
 * what is wrong and the column it went wrong at, so the operator gets a
 * useful message instead of a stack trace.
 *
 * It also holds COMMANDS_SPECIFIED_BUT_NOT_BUILT, the list of commands the
 * spec describes and the code has not built yet. An operator who types one
 * of those is told it is not built, rather than that it does not exist.
 * That list and the built registry have to stay disjoint, and a test pins
 * them apart.
 *
 * polyline and addvertex take a points argument, which swallows every
 * remaining token on the line as an x,y pair. It is the only argument kind
 * matchArguments lets grow past its declared count, and a points list stops
 * when it meets a flag name, so polyline can end with the word closed. The
 * grammar puts no upper bound on addvertex, so commands.ts is what refuses
 * more than one point, the same way it checks a polygon's side count. Each
 * spec carries its own usage string, so the accepted shape of a command is
 * declared as data here rather than described in prose.
 *
 * polylineFromStrokes is in this file too. It reads a run of picks and
 * words into a finished polyline command, and it is the only code that
 * knows what arc, line and close mean. prompt.ts moves the strokes around
 * and never reads them. The preview runs the same walk with the pointer
 * joined on as one more pick.
 *
 * Command-layer code: it turns a typed line into mutation calls, and
 * imports from the engine and from its own layer.
 */
import { bulgeForTangentArc, DEFAULT_TABLE_COLS, DEFAULT_TABLE_ROWS, edgeEndDirection, MIN_POLYLINE_VERTICES } from "../engine/index.ts";

export interface CreateCircleCommand {
  readonly kind: "circle";
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface CreatePolygonCommand {
  readonly kind: "polygon";
  readonly sides: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface CreateRectCommand {
  readonly kind: "rect";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CreatePolylineCommand {
  readonly kind: "polyline";
  readonly points: readonly CommandPoint[];
  /** One bulge for each vertex, for the edge that leaves it. The last one closes the path. */
  readonly bulges: readonly number[];
  readonly closed: boolean;
}

/** The three shapes one edge of a path can take. */
export type EdgeTypeName = "line" | "arc" | "curve";

export const EDGE_TYPE_NAMES: readonly EdgeTypeName[] = ["line", "arc", "curve"];

export interface EdgeTypeCommand {
  readonly kind: "edgetype";
  readonly target: string;
  readonly index: number;
  readonly shape: string;
}

export interface SplitEdgeCommand {
  readonly kind: "split";
  readonly target: string;
  readonly index: number;
  readonly points: readonly CommandPoint[];
}

export interface CommandPoint {
  readonly x: number;
  readonly y: number;
}

export interface CreateImageCommand {
  readonly kind: "image";
  readonly x: number;
  readonly y: number;
}

export interface CreateScriptCommand {
  readonly kind: "script";
  readonly x: number;
  readonly y: number;
}

export interface CreateMathCommand {
  readonly kind: "math";
  readonly x: number;
  readonly y: number;
  readonly source: string;
}

export interface CreateTableCommand {
  readonly kind: "table";
  readonly x: number;
  readonly y: number;
  readonly rows: number;
  readonly cols: number;
}

export interface CreateTextCommand {
  readonly kind: "text";
  readonly x: number;
  readonly y: number;
  readonly content: string;
}

export interface LinkCommand {
  readonly kind: "link";
  readonly target: string;
  readonly source: string;
}

export interface UnlinkCommand {
  readonly kind: "unlink";
  readonly target: string;
}

export interface AddPortCommand {
  readonly kind: "addport";
  readonly target: string;
}

export interface RemovePortCommand {
  readonly kind: "removeport";
  readonly target: string;
}

export interface ClearCommand {
  readonly kind: "clear";
  readonly target: string;
}

export interface SetLiteralCommand {
  readonly kind: "set";
  readonly target: string;
  readonly value: number | string | boolean;
}

export interface SetFormulaCommand {
  readonly kind: "set-formula";
  readonly target: string;
  readonly source: string;
}

export interface RenameCommand {
  readonly kind: "rename";
  readonly target: string;
  readonly newName: string;
}

export interface DeleteCommand {
  readonly kind: "delete";
  readonly target: string;
  readonly force: boolean;
}

export interface AddVertexCommand {
  readonly kind: "addvertex";
  readonly target: string;
  readonly points: readonly CommandPoint[];
}

export interface DeleteVertexCommand {
  readonly kind: "delvertex";
  readonly target: string;
  readonly index: number;
  readonly force: boolean;
}

export interface ExplodeCommand {
  readonly kind: "explode";
  readonly target: string;
  readonly force: boolean;
}

export interface RefsCommand {
  readonly kind: "refs";
  readonly target: string;
}

export interface PropsCommand {
  readonly kind: "props";
  readonly target: string;
}

export interface ListCommand {
  readonly kind: "list";
}

export interface SelectCommand {
  readonly kind: "select";
  readonly target: string;
}

export interface ZoomCommand {
  readonly kind: "zoom";
  readonly factor: number;
}

export interface FitCommand {
  readonly kind: "fit";
}

export interface SaveCommand {
  readonly kind: "save";
}

export interface LoadCommand {
  readonly kind: "load";
}

export type Command =
  | CreateCircleCommand
  | CreatePolygonCommand
  | CreateRectCommand
  | CreatePolylineCommand
  | CreateTextCommand
  | CreateTableCommand
  | CreateImageCommand
  | CreateScriptCommand
  | CreateMathCommand
  | LinkCommand
  | UnlinkCommand
  | AddPortCommand
  | RemovePortCommand
  | ClearCommand
  | SetLiteralCommand
  | SetFormulaCommand
  | RenameCommand
  | DeleteCommand
  | AddVertexCommand
  | DeleteVertexCommand
  | ExplodeCommand
  | SplitEdgeCommand
  | EdgeTypeCommand
  | RefsCommand
  | PropsCommand
  | ListCommand
  | SelectCommand
  | ZoomCommand
  | FitCommand
  | SaveCommand
  | LoadCommand;

export interface CommandParseSuccess {
  readonly ok: true;
  readonly command: Command;
}

export interface CommandParseFailure {
  readonly ok: false;
  readonly message: string;
  readonly start: number;
}

export type CommandParseResult = CommandParseSuccess | CommandParseFailure;

export function isCommandParseFailure(value: CommandParseResult): value is CommandParseFailure {
  return value.ok === false;
}

type PositionalKind = "text" | "number" | "literal" | "literal-or-formula" | "points";

interface PositionalParameter {
  readonly name: string;
  readonly kind: PositionalKind;
}

interface NamedParameter {
  readonly key: string;
  readonly defaultValue: number | undefined;
}

interface PromptStep {
  readonly name: string;
  readonly message: string;
  readonly accepts: "point" | "distance" | "number";
  readonly relativeTo?: string;
  readonly defaultValue?: number;

  /** A step that repeats collects answers until the operator ends it. */
  readonly repeats?: true;
  /** What the step asks the first time, when it has collected nothing yet. */
  readonly firstMessage?: string;
  /** How many points the step needs before an empty answer can end it. */
  readonly minimum?: number;
  readonly options?: readonly PromptOption[];
}

/**
 * One word an operator can type at a prompt that repeats, in the AutoCAD manner.
 * The prompt offers it by name, and accepts the name or its first letter.
 */
interface PromptOption {
  readonly name: string;
  /**
   * "record" keeps the word in the answer and asks again. "undo" drops the
   * last answer and asks again. "end" keeps the word and finishes the step.
   */
  readonly effect: "record" | "undo" | "end";
  /** How many points the step needs before the prompt offers this word. */
  readonly needs?: number;
}

/** One answer to a prompt that repeats. It is a point the operator gave, or a word they typed. */
export type PromptStroke =
  | { readonly kind: "point"; readonly point: PromptPoint }
  | { readonly kind: "option"; readonly option: string };

interface CommandSpec {
  readonly name: string;
  readonly usage: string;
  readonly positional: readonly PositionalParameter[];
  readonly named: readonly NamedParameter[];
  readonly flags: readonly string[];
  readonly build: (args: MatchedArguments) => Command;

  readonly prompts?: readonly PromptStep[];
  readonly buildFromPrompts?: (answers: PromptAnswers) => Command;
  /**
   * The shape a half finished command draws now, with the pointer as its next
   * point. The render layer paints it. Nothing here reads the pointer itself.
   */
  readonly previewFromPrompts?: (answers: PromptAnswers, cursor: PromptPoint | undefined) => CreatePolylineCommand;
}

export interface PromptAnswers {
  readonly [stepName: string]: PromptValue;
}

export type PromptValue = number | PromptPoint | readonly PromptStroke[];

export interface PromptPoint {
  readonly x: number;
  readonly y: number;
}

interface MatchedArgument {
  readonly name: string;
  readonly value: number | string | boolean | readonly CommandPoint[];
}

interface MatchedArguments {
  readonly positional: readonly MatchedArgument[];
  readonly named: readonly MatchedArgument[];
  readonly flags: readonly string[];
  readonly formula: string | undefined;
}

function requiredNumber(key: string): NamedParameter {
  return { key, defaultValue: undefined };
}

function optionalNumber(key: string, defaultValue: number): NamedParameter {
  return { key, defaultValue };
}

function text(name: string): PositionalParameter {
  return { name, kind: "text" };
}

const COMMAND_SPECS: readonly CommandSpec[] = [
  {
    name: "circle",
    usage: "circle x=<number> y=<number> r=<number>",
    positional: [],
    named: [requiredNumber("x"), requiredNumber("y"), requiredNumber("r")],
    flags: [],
    build: (args) => ({ kind: "circle", x: numberArgument(args, "x"), y: numberArgument(args, "y"), radius: numberArgument(args, "r") }),
    prompts: [
      { name: "center", message: "specify center point", accepts: "point" },
      { name: "radius", message: "specify radius", accepts: "distance", relativeTo: "center" },
    ],
    buildFromPrompts: (answers) => {
      const center = pointAnswer(answers, "center");
      return { kind: "circle", x: center.x, y: center.y, radius: numberAnswer(answers, "radius") };
    },
  },
  {
    name: "polygon",
    usage: "polygon sides=<number> x=<number> y=<number> r=<number>",
    positional: [],
    named: [requiredNumber("sides"), requiredNumber("x"), requiredNumber("y"), requiredNumber("r")],
    flags: [],
    build: (args) => ({
      kind: "polygon",
      sides: numberArgument(args, "sides"),
      x: numberArgument(args, "x"),
      y: numberArgument(args, "y"),
      radius: numberArgument(args, "r"),
    }),
    prompts: [
      { name: "sides", message: "specify number of sides", accepts: "number" },
      { name: "center", message: "specify center point", accepts: "point" },
      { name: "radius", message: "specify radius", accepts: "distance", relativeTo: "center" },
    ],
    buildFromPrompts: (answers) => {
      const center = pointAnswer(answers, "center");
      return {
        kind: "polygon",
        sides: numberAnswer(answers, "sides"),
        x: center.x,
        y: center.y,
        radius: numberAnswer(answers, "radius"),
      };
    },
  },
  {
    name: "rect",
    usage: "rect x=<number> y=<number> w=<number> h=<number>",
    positional: [],
    named: [requiredNumber("x"), requiredNumber("y"), requiredNumber("w"), requiredNumber("h")],
    flags: [],
    build: (args) => ({
      kind: "rect",
      x: numberArgument(args, "x"),
      y: numberArgument(args, "y"),
      width: numberArgument(args, "w"),
      height: numberArgument(args, "h"),
    }),
    prompts: [
      { name: "corner", message: "specify first corner", accepts: "point" },
      { name: "opposite", message: "specify opposite corner", accepts: "point" },
    ],
    buildFromPrompts: (answers) => {
      const corner = pointAnswer(answers, "corner");
      const opposite = pointAnswer(answers, "opposite");
      return {
        kind: "rect",
        x: Math.min(corner.x, opposite.x),
        y: Math.min(corner.y, opposite.y),
        width: Math.abs(opposite.x - corner.x),
        height: Math.abs(opposite.y - corner.y),
      };
    },
  },
  {
    name: "polyline",
    usage: "polyline <x,y> <x,y> [<x,y> ...] [closed]",
    positional: [{ name: "points", kind: "points" }],
    named: [],
    flags: ["closed"],
    build: (args) => {
      const points = pointsArgument(args, "points");
      return { kind: "polyline", points, bulges: points.map(() => 0), closed: hasFlag(args, "closed") };
    },
    prompts: [
      {
        name: "strokes",
        firstMessage: "specify start point",
        message: "specify next point",
        accepts: "point",
        repeats: true,
        minimum: MIN_POLYLINE_VERTICES,
        options: [
          { name: "arc", effect: "record", needs: 1 },
          { name: "line", effect: "record", needs: 1 },
          { name: "close", effect: "end", needs: MIN_POLYLINE_VERTICES },
          { name: "undo", effect: "undo", needs: 1 },
        ],
      },
    ],
    buildFromPrompts: (answers) => polylineFromStrokes(strokeAnswer(answers, "strokes")),
    previewFromPrompts: (answers, cursor) => polylineFromStrokes(strokeAnswer(answers, "strokes"), cursor),
  },
  {
    name: "text",
    usage: 'text [x=<number>] [y=<number>] "<content>"',
    positional: [text("content")],
    named: [optionalNumber("x", 0), optionalNumber("y", 0)],
    flags: [],
    build: (args) => ({
      kind: "text",
      x: numberArgument(args, "x"),
      y: numberArgument(args, "y"),
      content: textArgument(args, "content"),
    }),
    prompts: [{ name: "position", message: "specify text position", accepts: "point" }],
    buildFromPrompts: (answers) => {
      const position = pointAnswer(answers, "position");
      return { kind: "text", x: position.x, y: position.y, content: "" };
    },
  },
  {
    name: "table",
    usage: "table x=<number> y=<number> [rows=<number>] [cols=<number>]",
    positional: [],
    named: [requiredNumber("x"), requiredNumber("y"), optionalNumber("rows", DEFAULT_TABLE_ROWS), optionalNumber("cols", DEFAULT_TABLE_COLS)],
    flags: [],
    build: (args) => ({
      kind: "table",
      x: numberArgument(args, "x"),
      y: numberArgument(args, "y"),
      rows: numberArgument(args, "rows"),
      cols: numberArgument(args, "cols"),
    }),
    prompts: [
      { name: "origin", message: "specify origin point", accepts: "point" },
      { name: "rows", message: "specify rows", accepts: "number", defaultValue: DEFAULT_TABLE_ROWS },
      { name: "cols", message: "specify columns", accepts: "number", defaultValue: DEFAULT_TABLE_COLS },
    ],
    buildFromPrompts: (answers) => {
      const origin = pointAnswer(answers, "origin");
      return {
        kind: "table",
        x: origin.x,
        y: origin.y,
        rows: numberAnswer(answers, "rows"),
        cols: numberAnswer(answers, "cols"),
      };
    },
  },
  {
    name: "image",
    usage: "image x=<number> y=<number>",
    positional: [],
    named: [requiredNumber("x"), requiredNumber("y")],
    flags: [],
    build: (args) => ({ kind: "image", x: numberArgument(args, "x"), y: numberArgument(args, "y") }),
    prompts: [{ name: "origin", message: "specify image position", accepts: "point" }],
    buildFromPrompts: (answers) => {
      const origin = pointAnswer(answers, "origin");
      return { kind: "image", x: origin.x, y: origin.y };
    },
  },
  {
    name: "script",
    usage: "script x=<number> y=<number>",
    positional: [],
    named: [requiredNumber("x"), requiredNumber("y")],
    flags: [],
    build: (args) => ({ kind: "script", x: numberArgument(args, "x"), y: numberArgument(args, "y") }),
    prompts: [{ name: "origin", message: "specify script position", accepts: "point" }],
    buildFromPrompts: (answers) => {
      const origin = pointAnswer(answers, "origin");
      return { kind: "script", x: origin.x, y: origin.y };
    },
  },
  {
    name: "math",
    usage: 'math [x=<number>] [y=<number>] "<latex>"',
    positional: [text("source")],
    named: [optionalNumber("x", 0), optionalNumber("y", 0)],
    flags: [],
    build: (args) => ({
      kind: "math",
      x: numberArgument(args, "x"),
      y: numberArgument(args, "y"),
      source: textArgument(args, "source"),
    }),
    prompts: [{ name: "position", message: "specify math position", accepts: "point" }],
    buildFromPrompts: (answers) => {
      const position = pointAnswer(answers, "position");
      return { kind: "math", x: position.x, y: position.y, source: "" };
    },
  },
  {
    name: "link",
    usage: "link <address> <address>",
    positional: [text("target"), text("source")],
    named: [],
    flags: [],
    build: (args) => ({ kind: "link", target: textArgument(args, "target"), source: textArgument(args, "source") }),
  },
  {
    name: "unlink",
    usage: "unlink <address>",
    positional: [text("target")],
    named: [],
    flags: [],
    build: (args) => ({ kind: "unlink", target: textArgument(args, "target") }),
  },
  {
    name: "clear",
    usage: "clear <address>",
    positional: [text("target")],
    named: [],
    flags: [],
    build: (args) => ({ kind: "clear", target: textArgument(args, "target") }),
  },
  {
    name: "set",
    usage: "set <address> <value> | set <address> = <formula>",
    positional: [text("target"), { name: "value", kind: "literal-or-formula" }],
    named: [],
    flags: [],
    build: (args) =>
      args.formula !== undefined
        ? { kind: "set-formula", target: textArgument(args, "target"), source: args.formula }
        : { kind: "set", target: textArgument(args, "target"), value: valueArgument(args, "value") },
  },
  {
    name: "addport",
    usage: "addport <object>.<in|out>.<port>",
    positional: [text("target")],
    named: [],
    flags: [],
    build: (args) => ({ kind: "addport", target: textArgument(args, "target") }),
  },
  {
    name: "removeport",
    usage: "removeport <object>.<in|out>.<port>",
    positional: [text("target")],
    named: [],
    flags: [],
    build: (args) => ({ kind: "removeport", target: textArgument(args, "target") }),
  },
  {
    name: "rename",
    usage: "rename <object> <new-name>",
    positional: [text("target"), text("new-name")],
    named: [],
    flags: [],
    build: (args) => ({ kind: "rename", target: textArgument(args, "target"), newName: textArgument(args, "new-name") }),
  },
  {
    name: "delete",
    usage: "delete <object> [force]",
    positional: [text("target")],
    named: [],
    flags: ["force"],
    build: (args) => ({ kind: "delete", target: textArgument(args, "target"), force: hasFlag(args, "force") }),
  },
  {
    name: "addvertex",
    usage: "addvertex <object> <x,y>",
    positional: [text("target"), { name: "points", kind: "points" }],
    named: [],
    flags: [],
    build: (args) => ({ kind: "addvertex", target: textArgument(args, "target"), points: pointsArgument(args, "points") }),
  },
  {
    name: "delvertex",
    usage: "delvertex <object> <index> [force]",
    positional: [text("target"), { name: "index", kind: "number" }],
    named: [],
    flags: ["force"],
    build: (args) => ({
      kind: "delvertex",
      target: textArgument(args, "target"),
      index: numberArgument(args, "index"),
      force: hasFlag(args, "force"),
    }),
  },
  {
    name: "edgetype",
    usage: "edgetype <object> <edge> line|arc|curve",
    positional: [text("target"), { name: "index", kind: "number" }, text("shape")],
    named: [],
    flags: [],
    build: (args) => ({
      kind: "edgetype",
      target: textArgument(args, "target"),
      index: numberArgument(args, "index"),
      shape: textArgument(args, "shape"),
    }),
  },
  {
    name: "split",
    usage: "split <object> <edge> <x,y>",
    positional: [text("target"), { name: "index", kind: "number" }, { name: "points", kind: "points" }],
    named: [],
    flags: [],
    build: (args) => ({
      kind: "split",
      target: textArgument(args, "target"),
      index: numberArgument(args, "index"),
      points: pointsArgument(args, "points"),
    }),
  },
  {
    name: "explode",
    usage: "explode <object> [force]",
    positional: [text("target")],
    named: [],
    flags: ["force"],
    build: (args) => ({ kind: "explode", target: textArgument(args, "target"), force: hasFlag(args, "force") }),
  },
  {
    name: "refs",
    usage: "refs <object|address>",
    positional: [text("target")],
    named: [],
    flags: [],
    build: (args) => ({ kind: "refs", target: textArgument(args, "target") }),
  },
  {
    name: "props",
    usage: "props <object>",
    positional: [text("target")],
    named: [],
    flags: [],
    build: (args) => ({ kind: "props", target: textArgument(args, "target") }),
  },
  {
    name: "list",
    usage: "list",
    positional: [],
    named: [],
    flags: [],
    build: () => ({ kind: "list" }),
  },
  {
    name: "select",
    usage: "select <object>",
    positional: [text("target")],
    named: [],
    flags: [],
    build: (args) => ({ kind: "select", target: textArgument(args, "target") }),
  },
  {
    name: "zoom",
    usage: "zoom <factor>",
    positional: [{ name: "factor", kind: "number" }],
    named: [],
    flags: [],
    build: (args) => ({ kind: "zoom", factor: numberArgument(args, "factor") }),
  },
  {
    name: "fit",
    usage: "fit",
    positional: [],
    named: [],
    flags: [],
    build: () => ({ kind: "fit" }),
  },
  {
    name: "save",
    usage: "save",
    positional: [],
    named: [],
    flags: [],
    build: () => ({ kind: "save" }),
  },
  {
    name: "load",
    usage: "load",
    positional: [],
    named: [],
    flags: [],
    build: () => ({ kind: "load" }),
  },
];

export const COMMAND_NAMES: readonly string[] = COMMAND_SPECS.map((spec) => spec.name);

// Nothing is on this list today. It stays here, empty, for the next command
// SPEC.md documents before the code builds it.
export const COMMANDS_SPECIFIED_BUT_NOT_BUILT: readonly string[] = [];

/** One line to one command object. It never throws. */
export function parseCommand(line: string): CommandParseResult {
  const headScan = nextToken(line, 0);
  if (!headScan.ok) {
    return headScan;
  }
  const head = headScan.token;
  if (head === undefined) {
    return failure("empty command", 0);
  }
  const name = head.text.toLowerCase();
  const spec = COMMAND_SPECS.find((candidate) => candidate.name === name);
  if (spec === undefined) {
    if (COMMANDS_SPECIFIED_BUT_NOT_BUILT.includes(name)) {
      return failure(`"${head.text}" is a specified command that is not built yet`, head.start);
    }
    return failure(`unknown command "${head.text}"`, head.start);
  }
  const matched = matchArguments(spec, line, headScan.next);
  if (!matched.ok) {
    return matched;
  }
  return { ok: true, command: spec.build(matched.args) };
}

interface CommandToken {
  readonly text: string;
  readonly start: number;
  readonly quoted: boolean;
}

type TokenizeResult = { readonly ok: true; readonly tokens: readonly CommandToken[] } | CommandParseFailure;

type NextTokenResult = { readonly ok: true; readonly token: CommandToken | undefined; readonly next: number } | CommandParseFailure;

function nextToken(line: string, index: number): NextTokenResult {
  let cursor = index;
  while (cursor < line.length && isWhitespace(line[cursor])) {
    cursor += 1;
  }
  if (cursor >= line.length) {
    return { ok: true, token: undefined, next: cursor };
  }
  const character = line[cursor];
  if (character === '"') {
    const scanned = scanQuoted(line, cursor);
    if (!scanned.ok) {
      return scanned;
    }
    if (scanned.next < line.length && !isWhitespace(line[scanned.next])) {
      return failure("a quoted argument ends at its closing quote — separate arguments with a space", scanned.next);
    }
    return { ok: true, token: scanned.token, next: scanned.next };
  }
  const start = cursor;
  while (cursor < line.length && !isWhitespace(line[cursor])) {
    cursor += 1;
  }
  const word = line.slice(start, cursor);
  const quoteOffset = word.indexOf('"');
  if (quoteOffset >= 0) {
    return failure('a quote must open an argument, not sit inside one — write set text_1.content "a b"', start + quoteOffset);
  }
  return { ok: true, token: { text: word, start, quoted: false }, next: cursor };
}

function scanQuoted(line: string, openIndex: number): { readonly ok: true; readonly token: CommandToken; readonly next: number } | CommandParseFailure {
  let index = openIndex + 1;
  let text = "";
  while (index < line.length) {
    const character = line[index];
    if (character === undefined) {
      break;
    }
    if (character === '"') {
      return { ok: true, token: { text, start: openIndex, quoted: true }, next: index + 1 };
    }
    if (character === "\\") {
      const escaped = line[index + 1];
      if (escaped !== '"' && escaped !== "\\") {
        return failure(`unknown escape "\\${escaped ?? ""}" — a quoted value escapes only \\" and \\\\`, index);
      }
      text += escaped;
      index += 2;
      continue;
    }
    text += character;
    index += 1;
  }
  return failure("unterminated quoted value — add a closing quote", openIndex);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

const NUMBER_PATTERN = /^[+-]?[0-9]+(\.[0-9]+)?$/;

function readPointToken(
  spec: CommandSpec,
  parameterName: string,
  token: CommandToken,
): { readonly ok: true; readonly point: CommandPoint } | CommandParseFailure {
  const commaIndex = token.quoted ? -1 : token.text.indexOf(",");
  if (commaIndex < 0) {
    return failure(`<${parameterName}> takes a point as x,y — got "${token.text}" — usage: ${spec.usage}`, token.start);
  }
  const xText = token.text.slice(0, commaIndex);
  const yText = token.text.slice(commaIndex + 1);
  if (!NUMBER_PATTERN.test(xText) || !NUMBER_PATTERN.test(yText)) {
    return failure(`<${parameterName}> takes a point as x,y — got "${token.text}" — usage: ${spec.usage}`, token.start);
  }
  return { ok: true, point: { x: Number(xText), y: Number(yText) } };
}

function matchArguments(
  spec: CommandSpec,
  line: string,
  startIndex: number,
): { readonly ok: true; readonly args: MatchedArguments } | CommandParseFailure {
  const endOffset = line.length;
  const formulaAt = spec.positional.findIndex((parameter) => parameter.kind === "literal-or-formula");

  const positionalTokens: CommandToken[] = [];
  const namedTokens: NamedTokenMatch[] = [];
  const flags: string[] = [];
  let formula: string | undefined;

  let cursor = startIndex;
  for (;;) {
    let tokenStart = cursor;
    while (tokenStart < line.length && isWhitespace(line[tokenStart])) {
      tokenStart += 1;
    }
    if (tokenStart >= line.length) {
      break;
    }

    if (formulaAt >= 0 && positionalTokens.length === formulaAt && line[tokenStart] === "=") {
      formula = line.slice(tokenStart);
      break;
    }

    const scanned = nextToken(line, cursor);
    if (!scanned.ok) {
      return scanned;
    }
    const token = scanned.token;
    if (token === undefined) {
      break;
    }
    cursor = scanned.next;

    if (spec.named.length === 0 && !token.quoted && token.text.startsWith("=")) {
      return failure(`"${spec.name}" takes no formula — only "set <address> = <formula>" does`, token.start);
    }

    if (spec.named.length > 0 && !token.quoted && token.text.includes("=")) {
      const matched = matchNamedToken(spec, token, namedTokens);
      if (!matched.ok) {
        return matched;
      }
      namedTokens.push(matched.entry);
      continue;
    }
    const lastPositional = spec.positional[spec.positional.length - 1];
    const flag = token.quoted ? undefined : spec.flags.find((candidate) => candidate === token.text.toLowerCase());
    // A points list takes every token after it. A flag name is the one exception.
    const takesMorePoints = lastPositional?.kind === "points" && !token.quoted && flag === undefined;
    if (positionalTokens.length < spec.positional.length || takesMorePoints) {
      positionalTokens.push(token);
      continue;
    }
    if (flag !== undefined) {
      if (flags.includes(flag)) {
        return failure(`"${flag}" is given more than once — usage: ${spec.usage}`, token.start);
      }
      flags.push(flag);
      continue;
    }
    return failure(`"${spec.name}" does not take the argument "${token.text}" — usage: ${spec.usage}`, token.start);
  }

  if (formula !== undefined && formula.slice(1).trim().length === 0) {
    return failure(`"${spec.name}" needs a formula after "=" — usage: ${spec.usage}`, endOffset);
  }

  const positional: MatchedArgument[] = [];
  for (const [index, parameter] of spec.positional.entries()) {
    if (formula !== undefined && index >= formulaAt) {
      break;
    }
    if (parameter.kind === "points") {
      const pointTokens = positionalTokens.slice(index);
      if (pointTokens.length === 0) {
        return failure(`"${spec.name}" needs <${parameter.name}>, given as x,y — usage: ${spec.usage}`, endOffset);
      }
      const points: CommandPoint[] = [];
      for (const pointToken of pointTokens) {
        const read = readPointToken(spec, parameter.name, pointToken);
        if (!read.ok) {
          return read;
        }
        points.push(read.point);
      }
      positional.push({ name: parameter.name, value: points });
      break;
    }
    const token = positionalTokens[index];
    if (token === undefined) {
      return failure(`"${spec.name}" needs <${parameter.name}> — usage: ${spec.usage}`, endOffset);
    }
    const read = readPositionalValue(spec, parameter, token);
    if (!read.ok) {
      return read;
    }
    positional.push({ name: parameter.name, value: read.value });
  }

  const named: MatchedArgument[] = [];
  for (const parameter of spec.named) {
    const supplied = namedTokens.find((candidate) => candidate.parameter.key === parameter.key);
    if (supplied === undefined) {
      if (parameter.defaultValue === undefined) {
        return failure(`"${spec.name}" needs ${parameter.key}=<number> — usage: ${spec.usage}`, endOffset);
      }
      named.push({ name: parameter.key, value: parameter.defaultValue });
      continue;
    }
    if (!NUMBER_PATTERN.test(supplied.valueText)) {
      return failure(`${parameter.key} must be a number, got "${supplied.valueText}" — usage: ${spec.usage}`, supplied.token.start);
    }
    named.push({ name: parameter.key, value: Number(supplied.valueText) });
  }

  return { ok: true, args: { positional, named, flags, formula } };
}

interface NamedTokenMatch {
  readonly parameter: NamedParameter;
  readonly token: CommandToken;
  readonly valueText: string;
}

function matchNamedToken(
  spec: CommandSpec,
  token: CommandToken,
  alreadyMatched: readonly NamedTokenMatch[],
): { readonly ok: true; readonly entry: NamedTokenMatch } | CommandParseFailure {
  const separator = token.text.indexOf("=");
  const key = token.text.slice(0, separator);
  const valueText = token.text.slice(separator + 1);
  if (key.length === 0 || valueText.length === 0) {
    return failure(`"${token.text}" is not a key=value argument — usage: ${spec.usage}`, token.start);
  }
  const parameter = spec.named.find((candidate) => candidate.key === key.toLowerCase());
  if (parameter === undefined) {
    return failure(`"${spec.name}" has no argument "${key}" — usage: ${spec.usage}`, token.start);
  }
  if (alreadyMatched.some((candidate) => candidate.parameter.key === parameter.key)) {
    return failure(`"${key}" is given more than once — usage: ${spec.usage}`, token.start);
  }
  return { ok: true, entry: { parameter, token, valueText } };
}

function readPositionalValue(
  spec: CommandSpec,
  parameter: PositionalParameter,
  token: CommandToken,
): { readonly ok: true; readonly value: number | string | boolean } | CommandParseFailure {
  switch (parameter.kind) {
    case "text":
      return { ok: true, value: token.text };
    case "number": {
      if (token.quoted || !NUMBER_PATTERN.test(token.text)) {
        return failure(`<${parameter.name}> must be a number, got "${token.text}" — usage: ${spec.usage}`, token.start);
      }
      return { ok: true, value: Number(token.text) };
    }
    case "literal":
    case "literal-or-formula": {
      if (token.quoted) {
        return { ok: true, value: token.text };
      }
      if (NUMBER_PATTERN.test(token.text)) {
        return { ok: true, value: Number(token.text) };
      }
      if (token.text === "TRUE" || token.text === "FALSE") {
        return { ok: true, value: token.text === "TRUE" };
      }
      return failure(
        `<${parameter.name}> must be a number, a quoted string, TRUE, or FALSE, got "${token.text}" — usage: ${spec.usage}`,
        token.start,
      );
    }
    case "points":
      return failure(`<${parameter.name}> is a point list — matchArguments must read it before this switch runs`, token.start);
    default: {
      const exhaustive: never = parameter.kind;
      void exhaustive;
      return failure(`<${parameter.name}> declares an argument kind this parser does not read`, token.start);
    }
  }
}

function findArgument(args: MatchedArguments, name: string): MatchedArgument | undefined {
  return args.positional.find((argument) => argument.name === name) ?? args.named.find((argument) => argument.name === name);
}

function textArgument(args: MatchedArguments, name: string): string {
  const found = findArgument(args, name);
  return typeof found?.value === "string" ? found.value : "";
}

function numberArgument(args: MatchedArguments, name: string): number {
  const found = findArgument(args, name);
  return typeof found?.value === "number" ? found.value : Number.NaN;
}

function valueArgument(args: MatchedArguments, name: string): number | string | boolean {
  const value = findArgument(args, name)?.value ?? "";
  return typeof value === "number" || typeof value === "string" || typeof value === "boolean" ? value : "";
}

function pointsArgument(args: MatchedArguments, name: string): readonly CommandPoint[] {
  const value = findArgument(args, name)?.value;
  return Array.isArray(value) ? (value as readonly CommandPoint[]) : [];
}

function hasFlag(args: MatchedArguments, name: string): boolean {
  return args.flags.includes(name);
}

/**
 * True for a single point answer. A step that repeats answers with a list, and
 * a list is an object too, so a plain typeof test is not enough here.
 */
export function isPromptPoint(value: PromptValue | undefined): value is PromptPoint {
  return typeof value === "object" && !Array.isArray(value);
}

function pointAnswer(answers: PromptAnswers, name: string): PromptPoint {
  const found = answers[name];
  return isPromptPoint(found) ? found : { x: Number.NaN, y: Number.NaN };
}

function numberAnswer(answers: PromptAnswers, name: string): number {
  const found = answers[name];
  return typeof found === "number" ? found : Number.NaN;
}

function strokeAnswer(answers: PromptAnswers, name: string): readonly PromptStroke[] {
  const found = answers[name];
  return Array.isArray(found) ? found : [];
}

/**
 * The polyline a run of picks and words describes.
 *
 * "arc" and "line" pick how the next edge bends. An arc leaves the point
 * before it along the direction the path already travels, so the two meet
 * smoothly. The first edge of a path has no direction to follow, so it stays
 * straight. "close" sets the flag, and in arc mode it bends the edge home the
 * same way.
 *
 * A cursor point joins the end as one more pick. So a preview and a finished
 * command run the same walk.
 */
function polylineFromStrokes(strokes: readonly PromptStroke[], cursor?: PromptPoint): CreatePolylineCommand {
  const points: CommandPoint[] = [];
  const bulges: number[] = [];
  let arcMode = false;
  let closed = false;
  for (const stroke of strokes) {
    if (stroke.kind === "option") {
      arcMode = stroke.option === "arc" ? true : stroke.option === "line" ? false : arcMode;
      closed = closed || stroke.option === "close";
      continue;
    }
    appendVertex(points, bulges, stroke.point, arcMode);
  }
  if (cursor !== undefined && !closed) {
    appendVertex(points, bulges, cursor, arcMode);
  }
  if (closed && points.length > 0) {
    bulges[points.length - 1] = closingBulge(points, bulges, arcMode);
  }
  return { kind: "polyline", points, bulges, closed };
}

function appendVertex(points: CommandPoint[], bulges: number[], point: CommandPoint, arcMode: boolean): void {
  const previous = points[points.length - 1];
  if (previous !== undefined) {
    bulges[points.length - 1] = arcMode ? bulgeForTangentArc(previous, point, directionAtEnd(points, bulges)) : 0;
  }
  points.push(point);
  bulges.push(0);
}

function closingBulge(points: readonly CommandPoint[], bulges: readonly number[], arcMode: boolean): number {
  const last = points[points.length - 1];
  const first = points[0];
  if (!arcMode || last === undefined || first === undefined || points.length < MIN_POLYLINE_VERTICES) {
    return 0;
  }
  return bulgeForTangentArc(last, first, directionAtEnd(points, bulges));
}

/** The direction the path travels as it reaches its last point, or nothing before the first edge. */
function directionAtEnd(points: readonly CommandPoint[], bulges: readonly number[]): CommandPoint {
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  if (end === undefined || before === undefined) {
    return { x: 0, y: 0 };
  }
  return edgeEndDirection({ start: before, end, bulge: bulges[points.length - 2] ?? 0 });
}

export function findCommandSpec(name: string): CommandSpec | undefined {
  const folded = name.toLowerCase();
  return COMMAND_SPECS.find((candidate) => candidate.name === folded);
}

export function parseCommandNumber(text: string): number | undefined {
  return NUMBER_PATTERN.test(text) ? Number(text) : undefined;
}

export function parseCommandBoolean(text: string): boolean | undefined {
  if (text === "TRUE") {
    return true;
  }
  return text === "FALSE" ? false : undefined;
}

export function tokenizeCommandLine(line: string, startIndex = 0): TokenizeResult {
  const tokens: CommandToken[] = [];
  let cursor = startIndex;
  for (;;) {
    const scanned = nextToken(line, cursor);
    if (!scanned.ok) {
      return scanned;
    }
    if (scanned.token === undefined) {
      return { ok: true, tokens };
    }
    tokens.push(scanned.token);
    cursor = scanned.next;
  }
}

export function readCommandHead(line: string): NextTokenResult {
  return nextToken(line, 0);
}

export type { CommandSpec, CommandToken, NextTokenResult, PromptOption, PromptStep };

function failure(message: string, start: number): CommandParseFailure {
  return { ok: false, message, start };
}
