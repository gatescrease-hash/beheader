/**
 * parser.ts — Command string -> command object (PROJECT_BRIEF §5.10).
 *
 * IMPLEMENTS: §5.10's parsing half — "Table-driven parser; adding a command is one
 * registry entry." Not on §6.2's load-bearing list.
 * LAYER: command. Pure text processing: touches no canvas, DOM, or window, and reads
 * no document. May import: engine/*, own layer. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `parseCommand(line)` tokenises the line, looks its first word up in the command
 *   registry, matches the remaining tokens against that entry's declared arguments,
 *   and returns a typed `Command` — or a failure carrying a message and the character
 *   offset it points at. Never throws.
 *
 *   **It resolves nothing.** A `Command` carries the object names and address strings
 *   the operator typed, verbatim. Turning those into `Address`es (`parseAddress`),
 *   checking a new name (`checkNameAvailable`), building `Operation`s and calling
 *   `mutate` all belong to `command/commands.ts`, which has the document this file
 *   deliberately does not take. §5.2's "names resolve to IDs at parse time" governs a
 *   STORED AST; a command object is transient input to resolution, never stored and
 *   never journaled, so holding a name here breaks no invariant. The rejected
 *   alternative — pass the object list in and resolve here — splits resolution in
 *   two, because a creation command's fresh id and default name come from
 *   `nextObjectId`, which lives in the document this file would still not have.
 *
 *   The line that follows from that: GRAMMAR failures are this file's (how many
 *   arguments, which keys, whether a token is a number). IDENTITY failures are not
 *   (no object of that name, a name already taken, a slot that does not exist).
 *   `address.ts` draws the same line for the same reason (L-4, 0002-REVIEW-phase0):
 *   one failure path per problem, owned by the file that owns the form, rather than
 *   two copies free to drift apart.
 *
 *   Quoting decides TYPE, so it is never ignored: `set v.x 42` writes the number and
 *   `set v.x "42"` writes the string, and a quoted token is refused wherever a number
 *   is declared.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws; every malformed line is a returned failure.
 *   - Every failure names the offending token and, where the shape is wrong, the
 *     command's usage line — §5.10's "every rejection message must name the specific
 *     slots involved", at the one layer where there is no slot yet to name.
 *   - Every failure carries a character offset into the line, so an echo log can
 *     point at the problem. Same habit D-038 requires of a formula rejection.
 *   - Adding a command is one registry entry plus its `Command` arm. There is no
 *     dispatch switch here to extend, which is what §5.10 asks for.
 *   - A number produced here may be non-finite (a long digit run overflows). That is
 *     deliberate: D-031 clause 3 keeps document-state policy in `mutate` rather than
 *     in a text-scanning stage, and `mutate` refuses it (D-025).
 *
 * NOT DONE HERE
 *   - Command HANDLERS: resolution, `Operation` building, `mutate`, and the echo text
 *     §5.10 wants above the input. Owner: `command/commands.ts`, then `main.ts` for
 *     the input bar itself.
 *   - `pan`. §5.10 lists it with no arguments, §5.9 gives panning a mouse gesture, and
 *     a typed `pan <dx> <dy>` would have to say whether those are world units or
 *     screen pixels — which is Q-012's open question, not this slice's to settle.
 *     Owner: the cycle that wires camera commands in `main.ts`.
 *   - `polyline`/`text`/`script`/`image` creation, `explode`, `addvertex`,
 *     `delvertex`. `COMMANDS_SPECIFIED_BUT_NOT_BUILT` names them, and each waits on a
 *     primitive schema or an `Operation` kind that does not exist yet. Owner: the
 *     cycle that builds one.
 *   - PARSING a formula. `set <address> = <source>` (D-071) captures the source as a
 *     raw substring and stops; `parseFormula` is never called here. Owner:
 *     `command/commands.ts`, where D-038's four conditions come due.
 *   - PROMPTING. A bare command word starts an AutoCAD-style prompt sequence (D-072),
 *     and that state machine is `command/prompt.ts`'s. This file still answers only
 *     the one-shot question "is this complete line a command?" — `prompt.ts` calls it
 *     for the complete forms and drives the incomplete ones itself.
 */
import { DEFAULT_TABLE_COLS, DEFAULT_TABLE_ROWS } from "../engine/primitives/table.ts";

// ---------------------------------------------------------------------------
// The command object (§4: "parser.ts — command string -> command object")
// ---------------------------------------------------------------------------

/** `circle x=100 y=100 r=20` (§5.10) — §5.5's circle preset. */
export interface CreateCircleCommand {
  readonly kind: "circle";
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** `polygon sides=5 x=0 y=0 r=50` (§5.10). `rotation` is a real slot (§5.5) that §5.10's form gives no argument; `set polygon_1.rotation` reaches it. */
export interface CreatePolygonCommand {
  readonly kind: "polygon";
  readonly sides: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** `rect x=0 y=0 w=200 h=100` (§5.10). */
export interface CreateRectCommand {
  readonly kind: "rect";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** `table x=0 y=0 rows=8 cols=8` (§5.10). `rows`/`cols` default to §5.4's 8x8, read from `primitives/table.ts` rather than re-spelled here. */
export interface CreateTableCommand {
  readonly kind: "table";
  readonly x: number;
  readonly y: number;
  readonly rows: number;
  readonly cols: number;
}

/** `link polygon_1.origin.x table_x.A1` (§5.10) — `target` becomes a formula slot reading `source`, §5.1's degenerate formula. */
export interface LinkCommand {
  readonly kind: "link";
  readonly target: string;
  readonly source: string;
}

/** `unlink polygon_1.origin.x` (§5.10). D-041 binds the handler: the value last displayed is the value kept, errors included. */
export interface UnlinkCommand {
  readonly kind: "unlink";
  readonly target: string;
}

/**
 * `set polygon_1.radius 42` (§5.10) — a `literal` slot's new value.
 *
 * Only three arms of `graph/node.ts`'s `Value` are reachable from a command line;
 * there is no syntax for a `Point`, a `Point[]`, `null`, or an `ErrorValue`. The
 * field claims exactly those three rather than `Value`, because a type is a claim
 * about a domain (D-032's principle); a `LiteralSlot` accepts it unchanged.
 *
 * D-040 binds the handler, not this file: writing a slot that currently holds a
 * formula REPLACES the formula and must report what it replaced.
 */
export interface SetLiteralCommand {
  readonly kind: "set";
  readonly target: string;
  readonly value: number | string | boolean;
}

/**
 * `set table_x.B1 = polygon_b.origin.x * 2` (D-071) — the slot becomes a FORMULA.
 *
 * `source` is the RAW SUBSTRING of the line from the `=` to its end, verbatim,
 * including the `=` and the operator's own spacing. It is never re-joined from
 * tokens: re-joining would discard the offsets a `#PARSE` message points with, and
 * D-038 clause 4 forbids the layer that rejects a formula from discarding its source
 * text. Nothing here parses it — `commands.ts` calls `parseFormula` (D-069), and
 * D-038's four conditions come due there.
 *
 * A QUOTED value is never this: `set text_1.content "= not a formula"` is a string,
 * because quoting decides type everywhere on this line.
 */
export interface SetFormulaCommand {
  readonly kind: "set-formula";
  readonly target: string;
  readonly source: string;
}

/** `rename polygon_1 intersection_a` (§5.10). Both names pass through verbatim — §5.2's grammar and uniqueness are `checkNameAvailable`'s to enforce. */
export interface RenameCommand {
  readonly kind: "rename";
  readonly target: string;
  readonly newName: string;
}

/** `delete intersection_a [force]` (§5.10). `force` selects §5.1.1's repair path over its rejection path; running either is the handler's business. */
export interface DeleteCommand {
  readonly kind: "delete";
  readonly target: string;
  readonly force: boolean;
}

/** `refs intersection_a` (§5.10) — inbound dependents of an object or one slot, so the operator can look before deleting. */
export interface RefsCommand {
  readonly kind: "refs";
  readonly target: string;
}

/** `list` (§5.10) — dump all objects and names. */
export interface ListCommand {
  readonly kind: "list";
}

/** `select intersection_a` (§5.10) — the command-line route to `render/interaction.ts`'s selection. */
export interface SelectCommand {
  readonly kind: "select";
  readonly target: string;
}

/** `zoom 2` (§5.10) — a multiplier on the current zoom. Dimensionless, so it takes no side in Q-012. Clamping is `render/camera.ts`'s. */
export interface ZoomCommand {
  readonly kind: "zoom";
  readonly factor: number;
}

/** `fit` (§5.10) — zoom to the document's extent. Needs a viewport size the handler supplies per call (D-061). */
export interface FitCommand {
  readonly kind: "fit";
}

/** `save` (§5.10/§5.11) — serialize the document to JSON for download. */
export interface SaveCommand {
  readonly kind: "save";
}

/** `load` (§5.10/§5.11) — read a document back through a file input. */
export interface LoadCommand {
  readonly kind: "load";
}

/**
 * Every command this parser can produce. A new command WIDENS this union, the same
 * stance `mutation.ts`'s `Operation` takes (Q-005/D-020): widen, never restructure.
 * `kind` is the registry name verbatim, so a handler's switch reads as the command
 * the operator typed.
 */
export type Command =
  | CreateCircleCommand
  | CreatePolygonCommand
  | CreateRectCommand
  | CreateTableCommand
  | LinkCommand
  | UnlinkCommand
  | SetLiteralCommand
  | SetFormulaCommand
  | RenameCommand
  | DeleteCommand
  | RefsCommand
  | ListCommand
  | SelectCommand
  | ZoomCommand
  | FitCommand
  | SaveCommand
  | LoadCommand;

/** A line that parsed. */
export interface CommandParseSuccess {
  readonly ok: true;
  readonly command: Command;
}

/**
 * A line that did not parse. `start` is a character offset into the line the caller
 * passed in — the offending token's first character, or the line's end where what is
 * missing is an argument that was never typed at all.
 *
 * Shaped as an `ok` result rather than an `error`-coded value on purpose: a command
 * that fails to parse never becomes graph state, so it is not an `ErrorValue` and
 * must not be mistakable for one. `document.ts`'s `DocumentLoadResult` and
 * `address.ts`'s `NameCheckResult` have the same shape for the same reason.
 */
export interface CommandParseFailure {
  readonly ok: false;
  readonly message: string;
  readonly start: number;
}

export type CommandParseResult = CommandParseSuccess | CommandParseFailure;

/** Narrows a result to its failure arm, discriminating on the VALUE of `ok` (D-032's principle) rather than on a field's presence. */
export function isCommandParseFailure(value: CommandParseResult): value is CommandParseFailure {
  return value.ok === false;
}

// ---------------------------------------------------------------------------
// The registry (§5.10: "Table-driven parser; adding a command is one registry entry")
// ---------------------------------------------------------------------------

/** What a positional argument's token is read AS. `text` passes through verbatim, which is what the addresses and names this file does not resolve need. */
type PositionalKind = "text" | "number" | "literal" | "literal-or-formula";

/** One positional argument. Every one is required: §5.10 declares no optional positional, and an optional trailing word is a flag instead. */
interface PositionalParameter {
  readonly name: string;
  readonly kind: PositionalKind;
}

/**
 * One `key=value` argument. Every named argument §5.10 shows is a number, so there is
 * no kind to declare — the first non-numeric one widens this shape.
 * `defaultValue: undefined` means the argument is required.
 */
interface NamedParameter {
  readonly key: string;
  readonly defaultValue: number | undefined;
}

/**
 * One step of a command's AutoCAD-style prompt sequence (D-072).
 *
 * `accepts` is what the step reads a response AS, and it is the whole reason a step
 * exists as data rather than as code: `point` takes a pick verbatim or an `x,y` the
 * operator typed, while `distance` turns a pick into "how far from the point step
 * `relativeTo` already gave" — which is the CIRCLE gesture (pick a centre, then pick
 * anywhere on the rim) and cannot be expressed without letting a step see an earlier
 * step's answer.
 *
 * `defaultValue` makes the step optional: an empty response takes it, and `message`
 * shows it the way AutoCAD does (`specify rows <8>`).
 */
interface PromptStep {
  readonly name: string;
  readonly message: string;
  readonly accepts: "point" | "distance" | "number";
  /** For `distance` only: the name of the earlier `point` step a pick is measured from. */
  readonly relativeTo?: string;
  readonly defaultValue?: number;
}

/** One registry entry: the whole grammar of one command, plus the two lines that turn its matched arguments into its `Command` arm. */
interface CommandSpec {
  readonly name: string;
  readonly usage: string;
  readonly positional: readonly PositionalParameter[];
  readonly named: readonly NamedParameter[];
  readonly flags: readonly string[];
  readonly build: (args: MatchedArguments) => Command;
  /**
   * D-072: the steps a bare command word walks the operator through. A command with
   * no `prompts` is typed-form only and behaves exactly as it did before D-072 —
   * which is every non-creation command today, because an object-selection prompt
   * needs hit-testing and a document (see `prompt.ts`'s header).
   */
  readonly prompts?: readonly PromptStep[];
  /** D-072: turns a completed prompt sequence into the SAME `Command` the typed form produces. */
  readonly buildFromPrompts?: (answers: PromptAnswers) => Command;
}

/** Every answer a completed prompt sequence gathered, by step name. A `point` step yields a `Point`; `distance` and `number` yield a `number`. */
export interface PromptAnswers {
  readonly [stepName: string]: PromptValue;
}

/** What one prompt step resolves to. */
export type PromptValue = number | PromptPoint;

/** A world point. `render/camera.ts` converts a screen pick to one of these before it ever reaches `command/` (D-072, D-069). */
export interface PromptPoint {
  readonly x: number;
  readonly y: number;
}

/** One argument that matched its declared parameter, already converted to the value that parameter's kind asks for. */
interface MatchedArgument {
  readonly name: string;
  readonly value: number | string | boolean;
}

/** Everything one command line supplied, after matching: one entry per declared parameter, plus whichever flags were present. */
interface MatchedArguments {
  readonly positional: readonly MatchedArgument[];
  readonly named: readonly MatchedArgument[];
  readonly flags: readonly string[];
  /** D-071: the raw source of a `literal-or-formula` argument that began with `=`, `=` included. `undefined` whenever the value was a literal. */
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

/**
 * §5.10's command table, in §5.10's own listing order: creation, then the slot and
 * object commands, then the query and view commands.
 */
const COMMAND_SPECS: readonly CommandSpec[] = [
  {
    name: "circle",
    usage: "circle x=<number> y=<number> r=<number>",
    positional: [],
    named: [requiredNumber("x"), requiredNumber("y"), requiredNumber("r")],
    flags: [],
    build: (args) => ({ kind: "circle", x: numberArgument(args, "x"), y: numberArgument(args, "y"), radius: numberArgument(args, "r") }),
    // AutoCAD's CIRCLE, and D-072's worked example: centre, then a point on the rim.
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
    // AutoCAD's POLYGON order: how many sides, then centre, then the radius.
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
    // AutoCAD's RECTANG: two opposite corners, in either direction.
    prompts: [
      { name: "corner", message: "specify first corner", accepts: "point" },
      { name: "opposite", message: "specify opposite corner", accepts: "point" },
    ],
    // D-072 clause 8: normalise to the lower-left corner and a non-negative extent.
    // The preset is corner-anchored and `#TYPE`s on a negative width/height
    // (`primitives/geometry.ts`), so without this a pick up-and-left would draw an
    // error value instead of a rectangle.
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
    // The two counts carry §5.4's 8x8, so an operator who wants the default answers
    // both prompts with a bare Enter — D-072 clause 6's `<8>`.
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
    name: "set",
    usage: "set <address> <value> | set <address> = <formula>",
    positional: [text("target"), { name: "value", kind: "literal-or-formula" }],
    named: [],
    flags: [],
    // D-071: the same command word writes a literal or a formula, and the leading `=`
    // is what decides — the spreadsheet's own gesture, and what §5.4's formula bar
    // will do too. `commands.ts` routes both through one slot-writing path so D-040's
    // report and D-041's kept value cannot drift between them.
    build: (args) =>
      args.formula !== undefined
        ? { kind: "set-formula", target: textArgument(args, "target"), source: args.formula }
        : { kind: "set", target: textArgument(args, "target"), value: valueArgument(args, "value") },
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
    name: "refs",
    usage: "refs <object|address>",
    positional: [text("target")],
    named: [],
    flags: [],
    build: (args) => ({ kind: "refs", target: textArgument(args, "target") }),
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

/** Every command word this parser understands. Enumerable by design, the way D-038 clause 3 keeps `FUNCTION_REGISTRY` enumerable — a later autocomplete or `help` reads this rather than a private list. */
export const COMMAND_NAMES: readonly string[] = COMMAND_SPECS.map((spec) => spec.name);

/**
 * §5.10 commands with no registry entry yet, so an operator who types one is told the
 * truth ("not built") instead of "unknown command", which would be false. Each waits
 * on something that does not exist: `polyline`/`text`/`script`/`image` have no schema,
 * `explode`/`addvertex`/`delvertex` have no `Operation` kind, and `pan` has no stated
 * argument grammar (see the file header).
 *
 * A name moving into the registry MUST leave this list in the same cycle; the two
 * being disjoint is pinned by a test rather than by anyone remembering.
 */
export const COMMANDS_SPECIFIED_BUT_NOT_BUILT: readonly string[] = [
  "polyline",
  "text",
  "script",
  "image",
  "explode",
  "addvertex",
  "delvertex",
  "pan",
];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parses one command line (§5.10). Never throws: a malformed line comes back as a
 * `CommandParseFailure` naming what is wrong and where.
 *
 * Command words and `key=value` keys match case-insensitively — §5.2 already makes
 * object-name lookup case-insensitive and D-039 does the same for cell references, so
 * a case-sensitive command word would be the odd one out. Argument VALUES are never
 * case-folded: a name, an address, or a quoted string reaches the handler exactly as
 * typed, because folding either belongs elsewhere (`findObjectByName` folds its own
 * lookup; D-043 owns the cell form).
 */
export function parseCommand(line: string): CommandParseResult {
  const tokenized = tokenize(line);
  if (!tokenized.ok) {
    return tokenized;
  }
  const [head, ...rest] = tokenized.tokens;
  if (head === undefined) {
    return failure("empty command", 0);
  }
  const name = head.text.toLowerCase();
  const spec = COMMAND_SPECS.find((candidate) => candidate.name === name);
  if (spec === undefined) {
    if (COMMANDS_SPECIFIED_BUT_NOT_BUILT.includes(name)) {
      return failure(`"${head.text}" is a §5.10 command that is not built yet`, head.start);
    }
    return failure(`unknown command "${head.text}"`, head.start);
  }
  const matched = matchArguments(spec, rest, line);
  if (!matched.ok) {
    return matched;
  }
  return { ok: true, command: spec.build(matched.args) };
}

/** One token of a command line: a bare word, or the unescaped contents of a double-quoted run. `start` is its first character's offset, the opening quote included. */
interface CommandToken {
  readonly text: string;
  readonly start: number;
  readonly quoted: boolean;
}

type TokenizeResult = { readonly ok: true; readonly tokens: readonly CommandToken[] } | CommandParseFailure;

/**
 * Splits a line into tokens on whitespace, keeping a double-quoted run whole.
 *
 * A token is either a bare word or a WHOLE quoted string, and arguments are separated
 * by whitespace with nothing else allowed to join them: a quote inside a bare word
 * (`a"b"`) and a bare word running on from a closing quote (`"a"b`) are BOTH rejected
 * rather than given shell-like concatenation semantics. That keeps the one thing
 * quoting decides — whether `42` is a number or a string — legible at a glance instead
 * of dependent on where the quote sits inside a word.
 */
function tokenize(line: string): TokenizeResult {
  const tokens: CommandToken[] = [];
  let index = 0;
  while (index < line.length) {
    const character = line[index];
    if (character === undefined) {
      break;
    }
    if (isWhitespace(character)) {
      index += 1;
      continue;
    }
    if (character === '"') {
      const scanned = scanQuoted(line, index);
      if (!scanned.ok) {
        return scanned;
      }
      // A closing quote ends the whole argument. Without this, `delete "a"force`
      // splits into two tokens and silently sets the flag — §5.1.1's repair path
      // chosen by a line the operator never wrote as two words. It is the same
      // shell-style concatenation the bare-word branch below refuses, arriving from
      // the other side, so both directions refuse it or neither does (0069-REVIEW).
      if (scanned.next < line.length && !isWhitespace(line[scanned.next])) {
        return failure("a quoted argument ends at its closing quote — separate arguments with a space", scanned.next);
      }
      tokens.push(scanned.token);
      index = scanned.next;
      continue;
    }
    const start = index;
    while (index < line.length && !isWhitespace(line[index])) {
      index += 1;
    }
    const word = line.slice(start, index);
    const quoteOffset = word.indexOf('"');
    if (quoteOffset >= 0) {
      return failure('a quote must open an argument, not sit inside one — write set text_1.content "a b"', start + quoteOffset);
    }
    tokens.push({ text: word, start, quoted: false });
  }
  return { ok: true, tokens };
}

/** Reads the double-quoted run starting at `openIndex`, unescaping `\"` and `\\` — §5.3's own string escapes, so one spelling serves both surfaces. */
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

/**
 * The command line's number form: §5.3's own `[0-9]+(\.[0-9]+)?`, plus a sign.
 *
 * The sign is the one addition, and it is needed: a formula gets a negative from its
 * unary-minus operator, and a command line has no operators at all, so
 * `set polygon_1.origin.x -50` would otherwise be unwritable.
 */
const NUMBER_PATTERN = /^[+-]?[0-9]+(\.[0-9]+)?$/;

/**
 * Matches a command's tokens against its declared arguments, converting each to the
 * value its parameter's kind asks for.
 *
 * Takes the whole `line` because D-071's formula source is a RAW SUBSTRING of it, not
 * a re-join of tokens; `line.length` also points at "you never typed this argument",
 * the one failure with no token of its own to blame.
 */
function matchArguments(
  spec: CommandSpec,
  tokens: readonly CommandToken[],
  line: string,
): { readonly ok: true; readonly args: MatchedArguments } | CommandParseFailure {
  const endOffset = line.length;

  // D-071: at a `literal-or-formula` position, an unquoted leading `=` means the rest
  // of the LINE is the formula's source — so it is taken before tokens are
  // distributed, because the tokens after the `=` belong to the formula, not to the
  // command. The source keeps the `=` and the operator's spacing: `commands.ts` calls
  // `parseFormula` (D-069), and D-038 clause 4 forbids discarding the text it rejects.
  const formulaAt = spec.positional.findIndex((parameter) => parameter.kind === "literal-or-formula");
  const formulaToken = formulaAt >= 0 ? tokens[formulaAt] : undefined;
  const isFormula = formulaToken !== undefined && !formulaToken.quoted && formulaToken.text.startsWith("=");
  const formula = isFormula && formulaToken !== undefined ? line.slice(formulaToken.start) : undefined;
  if (formula !== undefined && formula.slice(1).trim().length === 0) {
    return failure(`"${spec.name}" needs a formula after "=" — usage: ${spec.usage}`, endOffset);
  }
  const argumentTokens = isFormula ? tokens.slice(0, formulaAt) : tokens;

  // Everywhere else a leading `=` is still refused, but only where a malformed
  // `key=value` cannot already explain it: `circle =1` is a keyless pair and
  // `matchNamedToken` says so precisely, which is the better message of the two.
  if (spec.named.length === 0) {
    const stray = argumentTokens.find((token) => !token.quoted && token.text.startsWith("="));
    if (stray !== undefined) {
      return failure(`"${spec.name}" takes no formula — only "set <address> = <formula>" does (D-071)`, stray.start);
    }
  }

  const positionalTokens: CommandToken[] = [];
  const namedTokens: NamedTokenMatch[] = [];
  const flags: string[] = [];

  for (const token of argumentTokens) {
    if (spec.named.length > 0 && !token.quoted && token.text.includes("=")) {
      const matched = matchNamedToken(spec, token, namedTokens);
      if (!matched.ok) {
        return matched;
      }
      namedTokens.push(matched.entry);
      continue;
    }
    if (positionalTokens.length < spec.positional.length) {
      positionalTokens.push(token);
      continue;
    }
    // Positionals fill BEFORE flags are considered, so `delete force` deletes the
    // object named `force` and `delete force force` deletes it down §5.1.1's repair
    // path. A flag is never quoted: quoting means "this is a value", everywhere.
    const flag = token.quoted ? undefined : spec.flags.find((candidate) => candidate === token.text.toLowerCase());
    if (flag !== undefined) {
      if (flags.includes(flag)) {
        return failure(`"${flag}" is given more than once — usage: ${spec.usage}`, token.start);
      }
      flags.push(flag);
      continue;
    }
    return failure(`"${spec.name}" does not take the argument "${token.text}" — usage: ${spec.usage}`, token.start);
  }

  const positional: MatchedArgument[] = [];
  for (const [index, parameter] of spec.positional.entries()) {
    // The formula swallowed this position and every one after it (there are none
    // after it today — a formula runs to end of line, so nothing can follow).
    if (isFormula && index >= formulaAt) {
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

/** One `key=value` token that matched a declared named parameter. `token` is kept so a bad VALUE can still be reported at the position it was typed. */
interface NamedTokenMatch {
  readonly parameter: NamedParameter;
  readonly token: CommandToken;
  readonly valueText: string;
}

/** Splits one `key=value` token and checks its key against the spec: an unknown key and a repeated one are both rejected, rather than silently taking the last. */
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

/** Reads one positional token as its parameter's kind. A `text` parameter takes whatever was typed — this file resolves nothing (see the header). */
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
    // A `literal-or-formula` position reaches here only when it was NOT a formula —
    // `matchArguments` takes the formula before tokens are distributed — so from here
    // the two kinds are the same reader.
    case "literal":
    case "literal-or-formula": {
      if (token.quoted) {
        return { ok: true, value: token.text };
      }
      if (NUMBER_PATTERN.test(token.text)) {
        return { ok: true, value: Number(token.text) };
      }
      // Exact uppercase, matching `lexer.ts`'s own booleans (§5.3), so one spelling
      // serves both surfaces; accepting `true` later widens and breaks nothing.
      if (token.text === "TRUE" || token.text === "FALSE") {
        return { ok: true, value: token.text === "TRUE" };
      }
      return failure(
        `<${parameter.name}> must be a number, a quoted string, TRUE, or FALSE, got "${token.text}" — usage: ${spec.usage}`,
        token.start,
      );
    }
    default: {
      // Compile-time exhaustiveness without a throw — the idiom every
      // discriminated-union switch in this codebase carries.
      const exhaustive: never = parameter.kind;
      void exhaustive;
      return failure(`<${parameter.name}> declares an argument kind this parser does not read`, token.start);
    }
  }
}

/**
 * Finds one matched argument by the name its spec declared, positional first.
 *
 * `undefined` is unreachable through `parseCommand`: `matchArguments` produces one
 * entry per declared parameter or fails outright, so a `build` reading only names its
 * own spec declares always finds one. The three wrappers below therefore return a loud
 * fallback rather than throwing, and the "every command parses its own example" test
 * is what catches a spec/build disagreement.
 */
function findArgument(args: MatchedArguments, name: string): MatchedArgument | undefined {
  return args.positional.find((argument) => argument.name === name) ?? args.named.find((argument) => argument.name === name);
}

function textArgument(args: MatchedArguments, name: string): string {
  const found = findArgument(args, name);
  return typeof found?.value === "string" ? found.value : "";
}

/** NaN, never 0: a spec/build disagreement must not read as a valid coordinate, and `mutate` refuses a non-finite value loudly (D-025). */
function numberArgument(args: MatchedArguments, name: string): number {
  const found = findArgument(args, name);
  return typeof found?.value === "number" ? found.value : Number.NaN;
}

function valueArgument(args: MatchedArguments, name: string): number | string | boolean {
  return findArgument(args, name)?.value ?? "";
}

function hasFlag(args: MatchedArguments, name: string): boolean {
  return args.flags.includes(name);
}

/**
 * Reads one prompt answer as the kind its step declared.
 *
 * Both fall back loudly rather than throwing, for the same reason the argument
 * readers above do: a step/build disagreement is a registry bug, and every command's
 * prompt sequence is driven end to end by a test, which is what catches one. NaN and
 * the origin are chosen because `mutate` refuses a non-finite coordinate (D-025) and
 * an object silently placed at (0,0) would look deliberate.
 */
function pointAnswer(answers: PromptAnswers, name: string): PromptPoint {
  const found = answers[name];
  return typeof found === "object" ? found : { x: Number.NaN, y: Number.NaN };
}

function numberAnswer(answers: PromptAnswers, name: string): number {
  const found = answers[name];
  return typeof found === "number" ? found : Number.NaN;
}

/**
 * The registry entry for a command word, or `undefined`.
 *
 * Exists so `command/prompt.ts` can read a command's prompt sequence without a second
 * copy of the registry — D-072 clause 2 keeps §5.10's "adding a command is one
 * registry entry" true, and two tables would be exactly the drift D-043 rules against.
 * Matches case-insensitively, as `parseCommand` does.
 */
export function findCommandSpec(name: string): CommandSpec | undefined {
  const folded = name.toLowerCase();
  return COMMAND_SPECS.find((candidate) => candidate.name === folded);
}

/**
 * The command line's number, or `undefined` if `text` is not one.
 *
 * Exported so `command/prompt.ts` reads a typed prompt response with the SAME number
 * form the typed command line uses — `circle x=-50 …` and answering `-50` at a prompt
 * must accept and reject exactly the same strings, or the two surfaces drift.
 */
export function parseCommandNumber(text: string): number | undefined {
  return NUMBER_PATTERN.test(text) ? Number(text) : undefined;
}

/** Splits a command line into tokens (see `tokenize`). Exported for `command/prompt.ts`, which must apply the same quoting rules rather than a second copy of them. */
export function tokenizeCommandLine(line: string): TokenizeResult {
  return tokenize(line);
}

export type { CommandSpec, CommandToken, PromptStep };

function failure(message: string, start: number): CommandParseFailure {
  return { ok: false, message, start };
}
