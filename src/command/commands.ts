/**
 * commands.ts — Command handlers: where a `Command` meets a `Document` (§5.10).
 *
 * IMPLEMENTS: PROJECT_BRIEF §4's "commands.ts — command handlers -> mutation API
 * calls", §5.10's handler half, §5.5's three geometry presets and §5.4's table.
 * Binding here: D-069, D-070, D-002.
 * LAYER: command. Touches no canvas, DOM, or window. May import: engine/*, own
 *        layer. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `executeCommand(command, document)` is the ONLY place a `Command` meets a
 *   `Document` (D-069). Everything `parser.ts` and `prompt.ts` deliberately decline
 *   to do happens here: minting an id and a default name, building an `Operation`,
 *   and calling `mutate`. It returns a NEW document plus the lines §5.10 wants
 *   echoed above the input, or a failure message. It never mutates its arguments
 *   and never throws.
 *
 *   GRAMMAR failures are `parser.ts`'s and cannot arrive here — a `Command` exists
 *   only because a line already parsed. DOMAIN and IDENTITY failures are this
 *   file's: a count outside its range, and every rejection `mutate` itself makes.
 *
 * INVARIANTS UPHELD HERE
 *   - Every state change goes through `mutate` (Rule 2). Nothing here writes a
 *     slot, an object, or a journal entry directly.
 *   - An id comes only from `document.ts`'s `mintObjectId`, which returns the
 *     advanced counter with it, so D-002's "never reused" cannot break by someone
 *     forgetting to store the counter back.
 *   - A created object's slot set comes from its SCHEMA, never a hand-written path
 *     list: the caller supplies a value per literal path, and every
 *     `schema.derivedSlots` entry is filled in mechanically because D-018 requires
 *     each declared derived path to carry a `derived`-kind slot. A schema that
 *     gains a derived slot therefore reaches creation with no edit here.
 *   - D-070: `sides`, `rows` and `cols` are bounded HERE, before an `Operation`
 *     exists, and an out-of-range count REJECTS the whole command — an unbounded
 *     count is an unbounded slot allocation, which Rule 6 will not let an
 *     `ErrorValue` stand in for. `primitives/geometry.ts`'s `#TYPE` for
 *     `sides < 3` stays where it is, as the defensive arm for a loaded file.
 *   - Every `Command` arm appears in `executeCommand`'s switch, including the
 *     twelve with no handler yet: adding an arm is a compile error here, not a
 *     silent fall-through into "nothing happened".
 *
 * NOT DONE HERE
 *   - `set`/`link`/`unlink` and `rename`/`delete`/`refs`/`list`. Each resolves an
 *     address or a name that already exists rather than minting one, and
 *     D-040/D-041's reconciliation and D-071 clause 4's ONE shared slot-writing
 *     path belong with them. Owner: the cycle after this one.
 *   - `select`/`zoom`/`fit`/`save`/`load`. None of them changes the document: they
 *     move a selection, a camera, or a file, which live on the far side of the
 *     engine/render seam. Owner: `main.ts`'s wiring cycle, which widens
 *     `CommandOutcome` with the effect rather than teaching this file about a
 *     canvas.
 *   - Driving a prompt sequence, or parsing anything. `command/prompt.ts` turns a
 *     partial line into a `Command`; this file only ever receives a finished one.
 */
import { generateDefaultName } from "../engine/address.ts";
import { mintObjectId, type Document } from "../engine/document.ts";
import { slotKey, type GraphObject, type ObjectType, type Slot, type Value } from "../engine/graph/node.ts";
import { mutate, type Operation } from "../engine/mutation.ts";
import {
  MIN_POLYGON_SIDES,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  POLYGON_ROTATION_PATH,
  POLYGON_SIDES_PATH,
  RADIUS_PATH,
  RECT_HEIGHT_PATH,
  RECT_WIDTH_PATH,
} from "../engine/primitives/geometry.ts";
import { getObjectSchema } from "../engine/primitives/schema.ts";
import { TABLE_COLS_PATH, TABLE_ROWS_PATH } from "../engine/primitives/table.ts";
import type { Command, CreateCircleCommand, CreatePolygonCommand, CreateRectCommand, CreateTableCommand } from "./parser.ts";

/**
 * What running one command produced.
 *
 * `ok: true` always carries a document — a command that changes nothing returns the
 * one it was given — so a caller has exactly one thing to store either way, and no
 * branch deciding whether the document moved. `lines` is §5.10's echo ("echo results
 * and errors in a small scrolling log above the input"), one entry per line so a
 * multi-line answer needs no agreed-upon separator.
 *
 * Shaped as an `ok` result rather than an `error`-coded value for the same reason
 * `CommandParseResult` is: a refused command never becomes graph state, so it is not
 * an `ErrorValue` and must not be mistakable for one.
 */
export type CommandOutcome =
  | { readonly ok: true; readonly document: Document; readonly lines: readonly string[] }
  | { readonly ok: false; readonly message: string };

/** Narrows an outcome to its failure arm, discriminating on the VALUE of `ok` (D-032's principle) rather than a field's presence. */
export function isCommandFailure(outcome: CommandOutcome): outcome is { readonly ok: false; readonly message: string } {
  return outcome.ok === false;
}

// ---------------------------------------------------------------------------
// D-070 — the creation counts, bounded here and nowhere else
// ---------------------------------------------------------------------------

/**
 * D-070's provisional upper bound on `polygon sides=<n>`. Its lower bound is
 * `primitives/geometry.ts`'s `MIN_POLYGON_SIDES`, imported rather than re-spelled so
 * the handler and the compute function that defends against a loaded file cannot
 * disagree about what a polygon is.
 *
 * The brief states no bound; these constants are declared beside the code that
 * enforces them the way `render/camera.ts` declares `MIN_ZOOM`/`MAX_ZOOM` for a range
 * the brief likewise never states. D-070 marks the NUMBERS as the reviewer's
 * provisional pick, which the human may overrule without disturbing anything else
 * here.
 */
export const MAX_POLYGON_SIDES = 1000;

/** D-070's provisional bounds on `table rows=<n> cols=<n>`. A table with zero lines has no cells and cannot be drawn, so the floor is 1, not 0. */
export const MIN_TABLE_LINES = 1;
export const MAX_TABLE_LINES = 1000;

/** §5.5 gives `polygon` a `rotation` slot and §5.10's form gives it no argument, so creation supplies this and `set polygon_1.rotation` changes it. */
const DEFAULT_POLYGON_ROTATION = 0;

/**
 * D-070 clauses 3 and 4: the reason a count is refused, naming the argument and the
 * range, or `undefined` if it is in range.
 *
 * Why a count and not a coordinate: an out-of-range count decides how many SLOTS get
 * built, and Rule 6 fixes the slot set during evaluation — so there is no later
 * moment at which an `ErrorValue` could stand in for "a million cell slots already
 * exist". A coordinate has no such problem and is deliberately unbounded here; an
 * unrepresentable one is `mutate`'s to refuse (D-025).
 */
function refuseCountOutOfRange(name: string, value: number, minimum: number, maximum: number): string | undefined {
  if (Number.isInteger(value) && value >= minimum && value <= maximum) {
    return undefined;
  }
  return `${name} must be a whole number from ${minimum} to ${maximum}, got ${value}`;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Runs one parsed command against a document (§5.10).
 *
 * Never throws: every refusal — a count out of range, a `mutate` rejection, a
 * command with no handler yet — comes back as the failure arm.
 *
 * The switch names every `Command` arm, so a new arm fails to compile here rather
 * than falling through to a default that silently does nothing. The twelve arms with
 * no handler yet say so by name; see this file's NOT DONE HERE for who owns each.
 */
export function executeCommand(command: Command, document: Document): CommandOutcome {
  switch (command.kind) {
    case "circle":
      return createCircle(command, document);
    case "polygon":
      return createPolygon(command, document);
    case "rect":
      return createRect(command, document);
    case "table":
      return createTable(command, document);
    // `set` and `set-formula` are one command word at the input bar (D-071); the
    // parser splits them by whether the value position began with `=`, so both
    // report under the word the operator actually typed.
    case "set":
    case "set-formula":
      return noHandlerYet("set");
    case "link":
      return noHandlerYet("link");
    case "unlink":
      return noHandlerYet("unlink");
    case "rename":
      return noHandlerYet("rename");
    case "delete":
      return noHandlerYet("delete");
    case "refs":
      return noHandlerYet("refs");
    case "list":
      return noHandlerYet("list");
    case "select":
      return noHandlerYet("select");
    case "zoom":
      return noHandlerYet("zoom");
    case "fit":
      return noHandlerYet("fit");
    case "save":
      return noHandlerYet("save");
    case "load":
      return noHandlerYet("load");
    default: {
      // Compile-time exhaustiveness without a throw — the idiom every
      // discriminated-union switch in this codebase carries.
      const exhaustive: never = command;
      void exhaustive;
      return { ok: false, message: "this command declares a kind no handler reads" };
    }
  }
}

/** Every command word `executeCommand` actually runs. Enumerable so a test can pin it against `parser.ts`'s `COMMAND_NAMES` instead of anyone remembering to keep two lists aligned. */
export const COMMANDS_WITH_HANDLERS: readonly string[] = ["circle", "polygon", "rect", "table"];

/**
 * A command the parser understands and this file does not run yet.
 *
 * Says so by name and says that nothing changed, because §9 forbids reporting a
 * stub as complete and the operator's next move depends on knowing which it was —
 * a silent success would look like a command that ran and did nothing.
 */
function noHandlerYet(commandWord: string): CommandOutcome {
  return { ok: false, message: `"${commandWord}" has no handler yet — nothing was changed` };
}

// ---------------------------------------------------------------------------
// Creation (§5.5's presets, §5.4's table)
// ---------------------------------------------------------------------------

/** One literal slot a creation handler supplies by value. The path is a schema path constant, never a string built here (D-010). */
interface LiteralSlotDeclaration {
  readonly path: readonly string[];
  readonly value: Value;
}

/**
 * The one creation path all four handlers share: mint an id and a default name,
 * build the object's slots, and commit it through `mutate`.
 *
 * The derived slots are filled in from the schema rather than listed per type,
 * because D-018 requires every schema-declared derived path to carry a
 * `derived`-kind slot and there is nothing type-specific about satisfying that. Their
 * `value` is `null` only until step 7 of the same mutation overwrites it — evaluation
 * runs over the candidate before anything commits, so no caller ever observes it.
 *
 * `nextObjectId` advances only on success: a refused creation took no id, which is
 * what keeps a rejected `polygon sides=2` from leaving a gap in the counter.
 */
function createObjectFromCommand(document: Document, type: ObjectType, literals: readonly LiteralSlotDeclaration[]): CommandOutcome {
  const schema = getObjectSchema(type);
  if (schema === undefined) {
    // Unreachable for the four types below, all of which have entries — kept as a
    // returned failure rather than an assumption, because a type losing its schema
    // must not become an exception thrown out of the command line.
    return { ok: false, message: `object type "${type}" has no schema, so nothing can create one` };
  }

  const minted = mintObjectId(document);
  const name = generateDefaultName(type, document.objects);

  const slots: Record<string, Slot> = {};
  for (const literal of literals) {
    slots[slotKey(literal.path)] = { kind: "literal", value: literal.value };
  }
  for (const derived of schema.derivedSlots) {
    slots[slotKey(derived.path)] = { kind: "derived", value: null };
  }

  const object: GraphObject = { id: minted.id, name, type, slots };
  const operation: Operation = { kind: "createObject", object };
  const result = mutate(document.objects, [operation], document.journal);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    document: { ...document, nextObjectId: minted.nextObjectId, objects: result.objects, journal: result.journal },
    lines: [`created ${name}`],
  };
}

/** `circle x=100 y=100 r=20` (§5.10) — §5.5's `circle(origin, radius)` preset. A negative radius is `#TYPE` on the derived `vertices` slot, not a rejection: it is a value, not a slot count (D-070). */
function createCircle(command: CreateCircleCommand, document: Document): CommandOutcome {
  return createObjectFromCommand(document, "circle", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: RADIUS_PATH, value: command.radius },
  ]);
}

/** `polygon sides=5 x=0 y=0 r=50` (§5.10) — §5.5's `polygon(sides, radius, origin, rotation)`. `sides` is bounded before an `Operation` exists (D-070). */
function createPolygon(command: CreatePolygonCommand, document: Document): CommandOutcome {
  const refusal = refuseCountOutOfRange("sides", command.sides, MIN_POLYGON_SIDES, MAX_POLYGON_SIDES);
  if (refusal !== undefined) {
    return { ok: false, message: refusal };
  }
  return createObjectFromCommand(document, "polygon", [
    { path: POLYGON_SIDES_PATH, value: command.sides },
    { path: RADIUS_PATH, value: command.radius },
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: POLYGON_ROTATION_PATH, value: DEFAULT_POLYGON_ROTATION },
  ]);
}

/** `rect x=0 y=0 w=200 h=100` (§5.10) — §5.5's `rect(origin, width, height)`, corner-anchored (D-072 clause 8 normalises a two-corner pick before it reaches here). */
function createRect(command: CreateRectCommand, document: Document): CommandOutcome {
  return createObjectFromCommand(document, "rect", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: RECT_WIDTH_PATH, value: command.width },
    { path: RECT_HEIGHT_PATH, value: command.height },
  ]);
}

/**
 * `table x=0 y=0 rows=8 cols=8` (§5.10, §5.4).
 *
 * Creates NO cell slots. A cell with no slot and a cell holding `null` are the two
 * spellings of an empty cell, and D-047 requires them to behave identically inside an
 * aggregate — so creation is free to pick either. Absent wins: it is four slots
 * instead of sixty-eight for the default 8x8, and every consumer already handles it
 * (`insertTableLine` skips an absent cell, `readRange` omits it, the renderer draws
 * nothing). `set table_x.A1 5` creates the slot when there is something to put in it.
 * The extent itself is NOT absent — `rows`/`cols` are what
 * `enumerateTableCellSlotPaths` reads to declare which cells the table HAS.
 *
 * Both counts are checked before either is used, so `table rows=0 cols=0` names both
 * rather than sending the operator back twice (`mutate`'s own multi-problem style).
 */
function createTable(command: CreateTableCommand, document: Document): CommandOutcome {
  const refusals = [
    refuseCountOutOfRange("rows", command.rows, MIN_TABLE_LINES, MAX_TABLE_LINES),
    refuseCountOutOfRange("cols", command.cols, MIN_TABLE_LINES, MAX_TABLE_LINES),
  ].filter((refusal): refusal is string => refusal !== undefined);
  if (refusals.length > 0) {
    return { ok: false, message: refusals.join("; ") };
  }
  return createObjectFromCommand(document, "table", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: TABLE_ROWS_PATH, value: command.rows },
    { path: TABLE_COLS_PATH, value: command.cols },
  ]);
}
