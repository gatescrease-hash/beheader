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
 *   echoed above the input, or a failure message. It never mutates its arguments.
 *   It throws in exactly one measured case — see `executeCommand`'s own doc, which
 *   states it rather than claiming it away.
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
 *     ones with no handler yet: adding an arm is a compile error here, not a
 *     silent fall-through into "nothing happened".
 *   - D-071 clause 4: `set <address> = <formula>` and `link` write their slot
 *     through ONE function (`writeSlot`), so D-040's report of a replaced formula
 *     and D-041's kept value cannot drift between the two commands. `unlink` shares
 *     it for the same reason.
 *   - A `derived` slot is refused by `set` and `link` alike (§5.1), and so is a path
 *     the target's schema does not declare — an undeclared LITERAL slot is legal
 *     document state, so `mutate` would accept one silently.
 *   - `refs` and `list` change nothing and say nothing a `mutate` could have said:
 *     they read `document.objects` and `deriveEdges` and return `lines` only, which
 *     is why D-075 gives them no `effect`.
 *   - `refs <object>` derives its blocking half over the document WITHOUT that
 *     object, so it reads the identical edge set `delete <object>` is validated
 *     against and the two can never name different dependents.
 *   - §5.1.1's two paths for `delete` are chosen by the operator's `force` flag and
 *     executed by `mutate`, never re-decided here. This file adds the remedy
 *     sentence to the rejection and reads D-057's `brokenSlots` on the repair.
 *   - `rename` resolves the OLD name here and refuses an unknown one; §5.2's grammar
 *     and uniqueness are `mutate`'s (`checkNameAvailable`), never re-checked here.
 *
 * NOT DONE HERE
 *   - `select`/`zoom`/`fit`/`save`/`load`. None of them changes the document, and
 *     **D-075** settles how they land: this file still resolves the name and reports
 *     the refusal, then returns the effect as plain data in a widened
 *     `CommandOutcome`, and `main.ts` performs it. The selection is
 *     `render/interaction.ts`'s state, zoom clamping is `render/camera.ts`'s (D-062),
 *     and `save`/`load` need a DOM this layer never touches. `list` and `refs` need
 *     no such widening (D-075 clause 4) and are built here already.
 *   - Driving a prompt sequence, or parsing anything. `command/prompt.ts` turns a
 *     partial line into a `Command`; this file only ever receives a finished one.
 */
import {
  findObjectByName,
  formatAddress,
  generateDefaultName,
  isAddressError,
  isValidName,
  parseAddress,
  TABLE_CELL_PATH_PREFIX,
  type Address,
} from "../engine/address.ts";
import { mintObjectId, type Document } from "../engine/document.ts";
import { isReferenceNode } from "../engine/formula/ast.ts";
import { formatFormula } from "../engine/formula/format.ts";
import { isParseError, parseFormula } from "../engine/formula/parser.ts";
import { addressKey, type Edge } from "../engine/graph/edge.ts";
import { getSlot, isErrorValue, slotKey, TABLE_TYPE, type GraphObject, type ObjectType, type Point, type Slot, type Value } from "../engine/graph/node.ts";
import { deriveEdges, mutate, type Operation } from "../engine/mutation.ts";
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
import { findDerivedSlotSchema, getObjectSchema, resolveNonDerivedSlotPaths } from "../engine/primitives/schema.ts";
import { TABLE_COLS_PATH, TABLE_ROWS_PATH } from "../engine/primitives/table.ts";
import type {
  Command,
  CreateCircleCommand,
  CreatePolygonCommand,
  CreateRectCommand,
  CreateTableCommand,
  DeleteCommand,
  LinkCommand,
  RefsCommand,
  RenameCommand,
  SetFormulaCommand,
  SetLiteralCommand,
  UnlinkCommand,
} from "./parser.ts";

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
 * Every refusal — a count out of range, a `mutate` rejection, a formula that will
 * not parse, a command with no handler yet — comes back as the failure arm rather
 * than as a throw.
 *
 * ONE MEASURED EXCEPTION, stated rather than claimed away (D-077 clause 2): a
 * formula whose AST nests deeper than about 5,000 levels — `set table_1.A1 = 1 + 1
 * + ...` with ~5,000 terms on one line — exhausts the stack inside
 * `formula/parser.ts`'s recursive descent, and a `RangeError` unwinds out of here.
 * `formula/format.ts`'s recursion fails at the same depth; both were measured
 * together at entry 0079 (band 5,000-6,000, stack-sensitive). The fix is a depth
 * limit inside the recursive-descent parser, returning `#PARSE` instead of
 * unwinding — that file's cycle to make, not a check bolted on here.
 *
 * The switch names every `Command` arm, so a new arm fails to compile here rather
 * than falling through to a default that silently does nothing. The five arms with
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
    // parser splits them by whether the value position began with `=`, and both
    // reach the same slot-writing path below.
    case "set":
      return setLiteral(command, document);
    case "set-formula":
      return setFormula(command, document);
    case "link":
      return link(command, document);
    case "unlink":
      return unlink(command, document);
    case "rename":
      return renameObject(command, document);
    case "delete":
      return deleteObject(command, document);
    case "refs":
      return refs(command, document);
    case "list":
      return list(document);
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
export const COMMANDS_WITH_HANDLERS: readonly string[] = ["circle", "polygon", "rect", "table", "set", "link", "unlink", "rename", "delete", "refs", "list"];

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

// ---------------------------------------------------------------------------
// The slot commands (§5.10's `set` / `link` / `unlink`; D-040, D-041, D-071)
// ---------------------------------------------------------------------------

/**
 * A target address that resolved to a slot the operator is allowed to write.
 *
 * `existing` is `undefined` for a table cell nobody has written yet: creation makes no
 * cell slots (D-047), so `set table_x.A1 5` is the ordinary way one comes into being,
 * and an absent slot at a DECLARED path is not an error here.
 */
interface WritableSlotTarget {
  readonly object: GraphObject;
  readonly address: Address;
  readonly existing: Slot | undefined;
  /** Resolved once so every message about this slot spells it identically, and always through `formatAddress` (D-015). */
  readonly displayName: string;
}

/** Either a resolved target or the reason it was refused — the shape every identity check in this section returns. */
type SlotTargetResult = { readonly ok: true; readonly target: WritableSlotTarget } | { readonly ok: false; readonly message: string };

/**
 * Resolves the address `set`/`link`/`unlink` was pointed at, and decides whether it
 * may be written at all.
 *
 * Why it exists: these are IDENTITY failures, which D-069 makes this file's — the
 * parser hands over the address string exactly as typed and checks nothing about it.
 * Three refusals live here, in the order that gives the most specific message:
 *
 * - the name resolves to no object, or the string is not an address at all
 *   (`parseAddress`'s own `#REF` message);
 * - the path names a `derived` slot. §5.1: "derived is fixed by schema and can never be
 *   converted; attempting to link or set a derived slot is rejected", which D-040's
 *   bound 3 leaves untouched. `mutate` would refuse this too, but with D-018's
 *   reconciliation message, which describes a schema disagreement rather than the thing
 *   the operator did;
 * - the path names no slot this object's type declares. An extra `literal` slot is
 *   legal document state, so `mutate` accepts one silently — meaning `set
 *   polygon_1.radius2 5` would otherwise "succeed" into a slot nothing reads, which is
 *   the silent-wrong-result this codebase refuses everywhere else. A table cell outside
 *   the table's own extent is refused by this same check, because
 *   `resolveNonDerivedSlotPaths` enumerates cells from the object's current
 *   `rows`/`cols`.
 */
function resolveWritableSlot(target: string, document: Document): SlotTargetResult {
  const address = parseAddress(target, document.objects);
  if (isAddressError(address)) {
    return { ok: false, message: address.message };
  }
  // Found by id inline rather than through `address.ts`'s `findObjectById`, which
  // returns an `AddressableObject`: this file needs the object's SLOTS. Same lookup
  // `graph/node.ts`'s `resolveSlot` already makes, for the same reason.
  const object = document.objects.find((candidate) => candidate.id === address.objectId);
  if (object === undefined) {
    // Unreachable: `parseAddress` resolved this id from the same list. Returned rather
    // than assumed, so a future change cannot turn it into a throw out of the command line.
    return { ok: false, message: `no object with id "${address.objectId}"` };
  }
  const displayName = formatSlotName(address, document.objects, target);

  if (findDerivedSlotSchema(object.type, address.path) !== undefined) {
    return { ok: false, message: `${displayName} is a derived slot — its value is computed by its object's schema and can never be set or linked (§5.1)` };
  }

  const schema = getObjectSchema(object.type);
  if (schema === undefined) {
    return { ok: false, message: `object type "${object.type}" has no schema, so nothing can say which slots ${object.name} has` };
  }
  const declared = resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths).some((path) => slotKey(path) === slotKey(address.path));
  if (!declared) {
    return { ok: false, message: `${object.name} has no slot at "${target}" — object type "${object.type}" does not declare one` };
  }

  return { ok: true, target: { object, address, existing: getSlot(object, address.path), displayName } };
}

/** Names one slot for a message, falling back to what the operator typed in the case `formatAddress` cannot resolve (D-015 — never `addressKey`, never a hand-joined name). */
function formatSlotName(address: Address, objects: readonly GraphObject[], typed: string): string {
  const formatted = formatAddress(address, objects);
  return isAddressError(formatted) ? typed : formatted;
}

/**
 * What one slot command wants written at its target. The three arms are the three
 * §5.10 commands, and they exist as DATA so all three go through the single
 * `writeSlot` below — D-071 clause 4 requires `link` and a formula-writing `set` to
 * share one slot-writing path, and `unlink` joins them because it obeys the same
 * resolution rules and reports through the same channel.
 */
type SlotWrite =
  | { readonly kind: "literal"; readonly value: number | string | boolean }
  | { readonly kind: "formula"; readonly source: string; readonly mustBeReference: boolean }
  | { readonly kind: "unlink" };

/**
 * The ONE path that puts a new `Slot` at an address (D-071 clause 4).
 *
 * Resolves the target, builds the slot the request asks for, and commits it as a single
 * `setSlot` operation. Every rejection — an unresolvable address, a derived slot, a
 * formula that will not parse, an `unlink` of something that is not a formula, and
 * `mutate`'s own (a cycle, a dangling reference, an illegal value) — comes back as the
 * failure arm rather than as a throw — with the ONE measured exception `executeCommand`'s
 * own doc states: `parseFormula` below unwinds a `RangeError` past ~5,000 nesting levels.
 *
 * D-040's "not silent" bound is discharged here rather than per command: whatever the
 * write, if the slot it lands on currently holds a formula, the report names that
 * formula's source. That is why this is one function and not three.
 */
function writeSlot(write: SlotWrite, targetText: string, document: Document): CommandOutcome {
  const resolved = resolveWritableSlot(targetText, document);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const { address, existing } = resolved.target;

  const built = buildSlot(write, resolved.target, document);
  if (!built.ok) {
    return { ok: false, message: built.message };
  }

  const result = mutate(document.objects, [{ kind: "setSlot", address, slot: built.slot }], document.journal);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  const lines = [...built.lines];
  if (write.kind !== "unlink" && existing !== undefined && existing.kind === "formula") {
    // D-040 clause 1: an explicit write over a formula is allowed and MUST NOT be
    // silent. The source is reconstructed from the stored AST against the CURRENT
    // names (§5.2), which is the only form of it that exists — nothing stores the
    // operator's own keystrokes.
    lines.push(`replaced formula: = ${formatFormula(existing.ast, document.objects)}`);
  }
  return { ok: true, document: { ...document, objects: result.objects, journal: result.journal }, lines };
}

/** Either the slot to commit plus what to say about it, or the reason the request was refused. */
type SlotBuildResult = { readonly ok: true; readonly slot: Slot; readonly lines: readonly string[] } | { readonly ok: false; readonly message: string };

/**
 * Turns one `SlotWrite` into the `Slot` that will be committed.
 *
 * A `formula` slot's `value` is `null` here and never observed: step 7 of the same
 * mutation evaluates it before anything commits, exactly as it does for the derived
 * slots creation fills in.
 */
function buildSlot(write: SlotWrite, target: WritableSlotTarget, document: Document): SlotBuildResult {
  switch (write.kind) {
    case "literal":
      return { ok: true, slot: { kind: "literal", value: write.value }, lines: [`${target.displayName} = ${describeSlotValue(write.value)}`] };
    case "formula": {
      // §5.3's bare cell refs (`A1`) are legal ONLY inside a table cell's own formula,
      // so the table id goes in exactly when the TARGET is a cell — a formula written
      // at `polygon_1.origin.x` must not be able to name one.
      // `parser.ts` reports a `#PARSE`'s `start` as an offset into the source string it
      // was HANDED, and the refusal below shows that source trimmed — so the trim happens
      // BEFORE the parse, or every position is off by the width of the space after the
      // `=` and points one character past the offending name (0080-REVIEW).
      const source = write.source.trim();
      const ast = parseFormula(source, document.objects, cellHostObjectId(target));
      if (isParseError(ast)) {
        // D-038 clause 2: the offending name and its position are what `parseFormula`
        // put in the `#PARSE`, carried through rather than flattened to "bad formula".
        // Clause 4: the source text is echoed rather than discarded, so the operator
        // edits it instead of retyping it.
        return { ok: false, message: `${ast.message} (at position ${ast.start} of "${source}")` };
      }
      if (write.mustBeReference && !isReferenceNode(ast)) {
        return { ok: false, message: `"link" takes an address as its source — usage: link <address> <address>. Use "set ${target.displayName} = ${source}" to write a formula` };
      }
      return { ok: true, slot: { kind: "formula", ast, value: null }, lines: [`${target.displayName} = ${formatFormula(ast, document.objects)}`] };
    }
    case "unlink": {
      const existing = target.existing;
      if (existing === undefined || existing.kind !== "formula") {
        const state = existing === undefined ? "holds nothing" : `is already a "${existing.kind}" slot`;
        return { ok: false, message: `${target.displayName} ${state} — "unlink" reverts a formula slot to a literal` };
      }
      // D-041: the value on screen is the value kept, errors included. No schema
      // default, no refusal for a formula that is currently erroring — an `ErrorValue`
      // is legitimate state (§5.1), and D-040 is what makes a frozen error escapable:
      // the operator types over it.
      return {
        ok: true,
        slot: { kind: "literal", value: existing.value },
        lines: [`unlinked ${target.displayName} — kept ${describeSlotValue(existing.value)}`, `removed formula: = ${formatFormula(existing.ast, document.objects)}`],
      };
    }
    default: {
      const exhaustive: never = write;
      void exhaustive;
      return { ok: false, message: "this slot write declares a kind no builder reads" };
    }
  }
}

/** The table whose cell this target is, or `undefined` for every other slot — §5.3's bare-cell-ref scope, decided once. */
function cellHostObjectId(target: WritableSlotTarget): string | undefined {
  const isCell = target.object.type === TABLE_TYPE && target.address.path.length === 2 && target.address.path[0] === TABLE_CELL_PATH_PREFIX;
  return isCell ? target.object.id : undefined;
}

/**
 * Renders a slot's VALUE for §5.10's echo.
 *
 * Distinct from `formula/eval.ts`'s `describeValueType`, which names a value's TYPE for
 * a `#TYPE` message: this one shows the value itself, because D-041's report is "here
 * is what was kept" and a type name would not tell the operator whether to type over it.
 */
function describeSlotValue(value: Value): string {
  if (value === null) {
    return "nothing";
  }
  if (isErrorValue(value)) {
    return `${value.error}: ${value.message}`;
  }
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} points`;
  }
  const point = value as Point;
  return `${point.x},${point.y}`;
}

/** `set polygon_1.radius 42` (§5.10) — a literal. Over a formula slot this REPLACES it and says so (D-040). */
function setLiteral(command: SetLiteralCommand, document: Document): CommandOutcome {
  return writeSlot({ kind: "literal", value: command.value }, command.target, document);
}

/** `set table_x.B1 = polygon_b.origin.x * 2` (D-071) — the same command word, writing a formula because the value position began with `=`. */
function setFormula(command: SetFormulaCommand, document: Document): CommandOutcome {
  // D-071 clause 1 keeps the `=` on the raw source so no offset is lost; `parseFormula`
  // wants the expression alone, and this is the one place the two meet.
  return writeSlot({ kind: "formula", source: command.source.slice(1), mustBeReference: false }, command.target, document);
}

/** `link polygon_1.origin.x table_x.A1` (§5.10) — §5.1's degenerate formula, so it is `set <target> = <source>` with the source constrained to a bare reference (D-071 clause 4). */
function link(command: LinkCommand, document: Document): CommandOutcome {
  return writeSlot({ kind: "formula", source: command.source, mustBeReference: true }, command.target, document);
}

/** `unlink polygon_1.origin.x` (§5.10) — back to a literal holding whatever was last displayed (D-041). */
function unlink(command: UnlinkCommand, document: Document): CommandOutcome {
  return writeSlot({ kind: "unlink" }, command.target, document);
}

// ---------------------------------------------------------------------------
// Renaming an object (§5.10's `rename`; §5.2's rules, enforced by `mutate`)
// ---------------------------------------------------------------------------

/**
 * `rename polygon_1 intersection_a` (§5.10, §5.2).
 *
 * Two names, resolved at two different layers, and the split is the whole design:
 * the OLD name is an IDENTITY question this file answers (`findGraphObjectByName`,
 * the same resolver `delete` uses, case-insensitive per §5.2), and the NEW name is
 * a RULE question `mutate` answers through `address.ts`'s `checkNameAvailable` —
 * §5.2's grammar and its case-insensitive uniqueness, in the one place that can see
 * a whole batch. Re-checking the new name here would be a second copy of a rule that
 * already has a single gate, free to drift from it; `parser.ts` declines the same
 * check for the same reason, which is why `rename polygon_1 3bad` parses.
 *
 * Nothing else in the document moves. §5.3's two-layer scheme stores an object ID in
 * every AST, so no formula, edge, or evaluated value changes — the echoed line says
 * only what happened, and there is no `brokenSlots` report to make because a rename
 * cannot break a reference.
 *
 * `rename polygon_1 POLYGON_1` is ACCEPTED and changes the stored case: uniqueness
 * excludes the object being renamed, so it collides with nothing, and §5.2 gives no
 * reason to refuse a display-case change.
 */
function renameObject(command: RenameCommand, document: Document): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"` };
  }

  const result = mutate(document.objects, [{ kind: "renameObject", objectId: object.id, name: command.newName }], document.journal);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    document: { ...document, objects: result.objects, journal: result.journal },
    lines: [`renamed ${object.name} to ${command.newName}`],
  };
}

// ---------------------------------------------------------------------------
// Removing an object (§5.10's `delete`; §5.1.1's two paths, D-057's report)
// ---------------------------------------------------------------------------

/**
 * `delete intersection_a [force]` (§5.10) — §5.1.1's two legal ways to remove slots
 * that something else may still read.
 *
 * This handler chooses NEITHER path. `force` travels to `DeleteObjectOperation` and
 * `mutate` runs whichever the flag selects — rejection by `validateIntegrity`'s
 * dangling-reference check, or the repair pass that rewrites every inbound reference
 * to `#REF` (D-028). Re-deciding here would be a second definition of §5.1.1, free to
 * disagree with the one that actually executes.
 *
 * What this handler DOES own is the two things `mutate` cannot say:
 *
 * - **The remedy.** `mutate`'s rejection names every dependent, which is §5.1.1's own
 *   requirement, and stops there — it does not know a `force` flag exists, because an
 *   `Operation` carries no command syntax. So the refusal is where the flag is named.
 *   That sentence is unconditional on the rejection path because it cannot be wrong
 *   there: over a document `mutate` already committed, a `deleteObject` without
 *   `force` has exactly one reachable rejection. Removing an object cannot make a
 *   schema disagree (D-017/D-018 are per-surviving-object), cannot make a value
 *   illegal (D-025), and cannot build a cycle out of fewer edges — it can only leave
 *   an edge whose source went away.
 * - **The report.** D-057's `brokenSlots` gets its FIRST reader here, which is what
 *   §5.1.1's "the command must report which slots were broken" asks for. D-059
 *   guarantees every address in it resolves against the COMMITTED objects, so the
 *   report is formatted against `result.objects`, never the pre-deletion list.
 */
function deleteObject(command: DeleteCommand, document: Document): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"` };
  }

  const result = mutate(document.objects, [{ kind: "deleteObject", objectId: object.id, force: command.force }], document.journal);
  if (!result.ok) {
    return {
      ok: false,
      message: command.force ? result.message : `${result.message} — unlink each, or "delete ${object.name} force" to rewrite them to #REF instead (§5.1.1)`,
    };
  }

  const lines = [`deleted ${object.name}`];
  if (result.brokenSlots.length > 0) {
    const broken = result.brokenSlots.map((address) => formatSlotAddress(address, result.objects));
    lines.push(`broke ${countedNoun(broken.length, "formula")}: ${broken.join(", ")} — each now reads #REF where it read ${object.name}`);
  }
  return { ok: true, document: { ...document, objects: result.objects, journal: result.journal }, lines };
}

// ---------------------------------------------------------------------------
// Reading the document (§5.10's `refs` and `list`) — no `effect`, D-075 clause 4
// ---------------------------------------------------------------------------

/**
 * `list` (§5.10: "dump all objects and names").
 *
 * Names and types only. An object's id is deliberately absent: §5.2 makes it opaque
 * and never written by the operator, so printing it would offer a second way to say
 * what a name already says — and D-023 sanctions showing one only where there is no
 * name to show instead.
 *
 * Document order, which is creation order, because that is the order `mutate` keeps
 * and sorting would hide it.
 */
function list(document: Document): CommandOutcome {
  if (document.objects.length === 0) {
    return { ok: true, document, lines: ["no objects"] };
  }
  return { ok: true, document, lines: document.objects.map((object) => `${object.name} — ${object.type}`) };
}

/** What `refs` was pointed at: a whole object, or one slot on one. Both forms come from §5.1.1's own `refs <object|slot>`. */
type RefsTarget =
  | { readonly kind: "object"; readonly object: GraphObject }
  | { readonly kind: "slot"; readonly object: GraphObject; readonly address: Address; readonly displayName: string };

/**
 * `refs intersection_a` / `refs polygon_1.origin.x` (§5.10, §5.1.1) — every slot that
 * reads the target.
 *
 * §5.1.1 states the purpose: "so the user can see what points at something before
 * deleting it. Without that, rule (1) is merely annoying; with it, it is workable."
 * So the report separates the dependents that would BLOCK a `delete` from the ones
 * that leave with the object and cannot. Nothing is filtered away: an object's own
 * derived slots genuinely do read its parameter slots, and hiding them would answer a
 * question the operator did not ask.
 *
 * **The blocking group is derived from the document WITHOUT the target**, which is the
 * same edge set `mutate` hands `validateIntegrity` when `delete <object>` runs — so
 * `refs` and a refused `delete` cannot disagree. Reading the CURRENT edge set for it
 * instead looks equivalent and is not: `table_2.A1 = SUM(table_1.A1:table_1.A4)` over
 * cells nobody has written yet expands to NO edges at all (D-047 item 1), and becomes
 * the one edge `deriveEdges` falls back to only once the table it names is gone. That
 * document refuses `delete table_1` while a current-edge `refs table_1` reports
 * nothing at all, which is the exact failure §5.1.1 provides this command to prevent.
 *
 * An address target takes the current edge set for both groups: no command removes a
 * single slot, so there is no removal to simulate, and an unwritten cell inside a
 * range is not something a formula is depending on yet.
 *
 * Either way the edges come from `deriveEdges`, the function step 3 of every mutation
 * calls — never a second, hand-maintained idea of who reads what.
 */
function refs(command: RefsCommand, document: Document): CommandOutcome {
  const resolved = resolveRefsTarget(command.target, document);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const target = resolved.target;
  const displayName = target.kind === "object" ? target.object.name : target.displayName;

  const current = partitionDependents(deriveEdges(document.objects), target, document.objects);
  const afterRemoval =
    target.kind === "object"
      ? partitionDependents(deriveEdges(document.objects.filter((candidate) => candidate.id !== target.object.id)), target, document.objects)
      : current;

  const own = current.onTarget;
  const others = afterRemoval.elsewhere;
  if (own.length + others.length === 0) {
    return { ok: true, document, lines: [`nothing references ${displayName}`] };
  }
  // Two counts, because they differ and only one of them answers the question §5.1.1
  // asks. `polygon_1.origin.x = table_1.A1 + table_1.A2` is TWO inbound edges and ONE
  // slot to unlink, so the split counts SLOTS; the lines above are edges, one per line,
  // which makes both numbers checkable against the report they summarise (0082-REVIEW).
  const ownSlots = current.onTargetSlotCount;
  const otherSlots = afterRemoval.elsewhereSlotCount;
  return {
    ok: true,
    document,
    lines: [
      ...others,
      ...own,
      `${countedNoun(others.length + own.length, "inbound edge")} from ${countedNoun(otherSlots + ownSlots, "dependent slot")}: ${otherSlots} on other objects, ${ownSlots} on ${target.object.name} itself`,
    ],
  };
}

/**
 * One `refs` report's two halves: the dependents that sit on the target's own object,
 * and the dependents that sit anywhere else.
 *
 * Each half carries its LINES — one per edge — and the number of distinct dependent
 * SLOTS those lines name. The two numbers differ whenever one slot reads two slots of
 * the target, and the slot count is the one an operator acts on: it is how many slots
 * have to be unlinked before a `delete` stops being refused (§5.1.1).
 */
interface PartitionedDependents {
  readonly onTarget: readonly string[];
  readonly elsewhere: readonly string[];
  readonly onTargetSlotCount: number;
  readonly elsewhereSlotCount: number;
}

/**
 * Renders every edge in `edges` whose SOURCE is `target` as a `source → dependent`
 * line, split by which side of the object boundary the dependent sits on.
 *
 * `objects` is what the addresses are formatted against and is deliberately a separate
 * parameter from whatever list `edges` was derived over: the blocking half of a `refs`
 * report is derived over a list with the target REMOVED, and its slots still have to
 * print as names rather than as `#REF` (§5.2).
 */
function partitionDependents(edges: readonly Edge[], target: RefsTarget, objects: readonly GraphObject[]): PartitionedDependents {
  const onTarget: string[] = [];
  const elsewhere: string[] = [];
  const onTargetSlots = new Set<string>();
  const elsewhereSlots = new Set<string>();
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!edgeReadsTarget(edge.sourceSlot, target)) {
      continue;
    }
    // `= A1 + A1` extracts the same dependency twice (§5.3's extraction is total, and
    // deduplicating it is not its job), so one dependent can arrive on two identical
    // edges. The operator is being told which SLOTS read the target, and a slot named
    // twice reads as two of them.
    const identity = `${addressKey(edge.sourceSlot)} ${addressKey(edge.dependentSlot)}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    const line = `${formatSlotAddress(edge.sourceSlot, objects)} → ${formatSlotAddress(edge.dependentSlot, objects)}`;
    if (edge.dependentSlot.objectId === target.object.id) {
      onTarget.push(line);
      onTargetSlots.add(addressKey(edge.dependentSlot));
    } else {
      elsewhere.push(line);
      elsewhereSlots.add(addressKey(edge.dependentSlot));
    }
  }
  return { onTarget, elsewhere, onTargetSlotCount: onTargetSlots.size, elsewhereSlotCount: elsewhereSlots.size };
}

/** Whether one edge's source slot is the thing `refs` was asked about — the whole object, or the one slot. */
function edgeReadsTarget(sourceSlot: Address, target: RefsTarget): boolean {
  if (target.kind === "object") {
    return sourceSlot.objectId === target.object.id;
  }
  return addressKey(sourceSlot) === addressKey(target.address);
}

/** Either a resolved `refs` target or the reason it was refused — the shape `resolveWritableSlot` already uses for the writing side. */
type RefsTargetResult = { readonly ok: true; readonly target: RefsTarget } | { readonly ok: false; readonly message: string };

/**
 * Decides which of §5.1.1's two `refs` forms the operator typed, and resolves it.
 *
 * The forms are told apart by `isValidName`, address.ts's own §5.2 name grammar,
 * rather than by looking for a dot here: a name admits no dot and an address requires
 * one, so the grammar already separates them, and a second rule spelled out here
 * would be free to drift from it (D-043's hazard, D-008's "key on the FORM").
 *
 * A path the object's schema does not declare is REFUSED rather than answered with
 * "nothing references it" — the same stance `resolveWritableSlot` takes, for the same
 * reason: a confident answer about a slot that does not exist is worse than a
 * refusal. Unlike that function, a `derived` path is ACCEPTED here: `refs
 * polygon_1.centroid.x` asks who reads a value rather than trying to write one, and a
 * derived slot is a first-class graph node other formulas are allowed to read (§5.1).
 */
function resolveRefsTarget(typed: string, document: Document): RefsTargetResult {
  if (isValidName(typed)) {
    const object = findGraphObjectByName(typed, document.objects);
    if (object === undefined) {
      return { ok: false, message: `no object named "${typed}"` };
    }
    return { ok: true, target: { kind: "object", object } };
  }

  const address = parseAddress(typed, document.objects);
  if (isAddressError(address)) {
    return { ok: false, message: address.message };
  }
  const object = document.objects.find((candidate) => candidate.id === address.objectId);
  if (object === undefined) {
    // Unreachable: `parseAddress` resolved this id from the same list. Returned rather
    // than assumed, so a future change cannot turn it into a throw out of the command line.
    return { ok: false, message: `no object with id "${address.objectId}"` };
  }
  if (!declaresSlotPath(object, address.path)) {
    return { ok: false, message: `${object.name} has no slot at "${typed}" — object type "${object.type}" does not declare one` };
  }
  return { ok: true, target: { kind: "slot", object, address, displayName: formatSlotName(address, document.objects, typed) } };
}

/**
 * Whether an object's schema declares a slot at this path, of ANY kind.
 *
 * A cell path a table declares but nobody has written yet counts (D-047: creation
 * makes no cell slots), because the question is what the schema SAYS the object has,
 * not what `object.slots` currently holds.
 *
 * `resolveWritableSlot` asks the narrower version of this question inline — non-derived
 * only, because it has already refused a derived path by then. The two are the same
 * schema lookup and should become one call when a cycle opens that function for its own
 * reason; a THIRD site asking it must not be written.
 */
function declaresSlotPath(object: GraphObject, path: readonly string[]): boolean {
  if (findDerivedSlotSchema(object.type, path) !== undefined) {
    return true;
  }
  const schema = getObjectSchema(object.type);
  if (schema === undefined) {
    return false;
  }
  const key = slotKey(path);
  // Walked one path at a time and never spread into a call: `resolveNonDerivedSlotPaths`
  // returns one entry per declared cell, which a 1000x1000 table makes a million of
  // (D-077 clause 1).
  return resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths).some((declared) => slotKey(declared) === key);
}

/** The `GraphObject` behind a user-typed name — `findObjectByName` owns §5.2's case-insensitive lookup, and this adds only the slots that function's `AddressableObject` does not carry. */
function findGraphObjectByName(name: string, objects: readonly GraphObject[]): GraphObject | undefined {
  const found = findObjectByName(name, objects);
  return found === undefined ? undefined : objects.find((candidate) => candidate.id === found.id);
}

/** One `Address` rendered for a message, always through `formatAddress` (D-015), falling back to its own `#REF` text where the id no longer resolves. */
function formatSlotAddress(address: Address, objects: readonly GraphObject[]): string {
  const formatted = formatAddress(address, objects);
  return isAddressError(formatted) ? formatted.message : formatted;
}

/** `1 formula` / `2 formulas` — pluralised once, because several messages here count something and a per-site `+ "s"` is one chance to disagree per site. */
function countedNoun(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
