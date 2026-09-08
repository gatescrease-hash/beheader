/**
 * commands.ts — Command handlers: where a `Command` meets a `Document` (§5.10).
 *
 * IMPLEMENTS: PROJECT_BRIEF §4's "commands.ts — command handlers -> mutation API
 * calls", §5.10's handler half, §5.5's three geometry presets, §5.4's table,
 * §5.6's `text`, §5.7's `image`, and §5.8's `script` (creation only — D-141
 * clause 7). Binding here: D-069, D-070, D-002, D-121, D-122.
 * LAYER: command. Touches no canvas, DOM, or window. May import: engine/*, own
 *        layer. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `executeCommand(command, document, context?)` is the ONLY place a `Command` meets
 *   a `Document` (D-069). Everything `parser.ts` and `prompt.ts` deliberately decline
 *   to do happens here: minting an id and a default name, building an `Operation`,
 *   and calling `mutate`. It returns a NEW document plus the lines §5.10 wants
 *   echoed above the input, or a failure message. It never mutates its arguments.
 *   It never throws: every refusal, including a formula too deep to walk, comes back
 *   as the failure arm.
 *
 *   `context` is §5.1's `EvalContext` — the injected `TextMeasurer` (§5.6) that
 *   `mutate`'s step-7 evaluation hands every `derived`-slot compute. It is forwarded
 *   verbatim to every `mutate` call a handler makes and never inspected here. It
 *   defaults to `NULL_EVAL_CONTEXT`, so a `text` object's `measuredHeight` is
 *   `#MEASURE` (**D-118**) until `main.ts` threads a real one from `render/measure.ts`.
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
 *     `rows`/`cols` are bounded a SECOND time, at every later WRITE rather than
 *     only at creation — `mutation.ts`'s `findInvalidDimensionWrites` (D-097) —
 *     because `set table_1.rows = ...` reaches `mutate` through `writeSlot`
 *     below, which knows nothing about dimensions.
 *   - Every `Command` arm appears in `executeCommand`'s switch and every one of
 *     them now runs: adding an arm is a compile error here, not a silent
 *     fall-through into "nothing happened".
 *   - D-071 clause 4: `set <address> = <formula>` and `link` write their slot
 *     through ONE function (`writeSlot`), so D-040's report of a replaced formula
 *     and D-041's kept value cannot drift between the two commands. `unlink` shares
 *     it for the same reason.
 *   - A `derived` slot is refused by `set` and `link` alike (§5.1), and so is a path
 *     the target's schema does not declare — an undeclared LITERAL slot is legal
 *     document state, so `mutate` would accept one silently.
 *   - D-122: `link` and `set =` are refused for a `text` object's `content` slot
 *     too. It is `literal`-only — read as raw source at edge-derivation time, before
 *     any formula value exists (à la D-046 for a table dimension) — so a
 *     formula-driven `content`'s embedded references would go untracked. A plain
 *     `set text_1.content "…"` (a literal write) is unaffected.
 *   - `refs`, `props` and `list` change nothing and say nothing a `mutate` could
 *     have said: they read `document.objects` (`props` via `command/props.ts`'s
 *     `buildSlotDescriptors`, never a second enumeration — D-094 clause 9) and
 *     return `lines` only, which is why D-075 gives them no `effect`.
 *   - `refs <object>` derives its blocking half over the document WITHOUT that
 *     object, so it reads the identical edge set `delete <object>` is validated
 *     against and the two can never name different dependents.
 *   - §5.1.1's two paths for `delete` are chosen by the operator's `force` flag and
 *     executed by `mutate`, never re-decided here. This file adds the remedy
 *     sentence to the rejection and reads D-057's `brokenSlots` on the repair.
 *   - `rename` resolves the OLD name here and refuses an unknown one; §5.2's grammar
 *     and uniqueness are `mutate`'s (`checkNameAvailable`), never re-checked here.
 *   - D-075: a command that changes no document state returns an `effect` — plain,
 *     serializable data naming an object by ID, never a callback, a closure, a DOM
 *     handle, or a `CameraState`. `select` resolves its name here and refuses an
 *     unknown one; `zoom` refuses a factor that is not a positive finite multiplier;
 *     what the camera, the selection or a file then DOES with it is `main.ts`'s.
 *
 * NOT DONE HERE
 *   - PERFORMING an effect. `main.ts` does that, because each one lives on the far
 *     side of a seam this layer may not cross: the selection is
 *     `render/interaction.ts`'s state, zoom clamping is `render/camera.ts`'s (D-062),
 *     `fit` needs a viewport size only `main.ts` has (D-061), and `save`/`load` need
 *     a DOM this layer never touches. Nothing here reads or writes `document.camera`
 *     either — under D-027 clause 2 that write never goes through `mutate`, and under
 *     D-075 clause 5 it is `main.ts` that makes it, from the value `camera.ts` clamps.
 *   - Computing an extent. `fit` refuses an EMPTY document here, because "are there
 *     any objects" is a document read; the bounding box of the ones that exist is
 *     `render/`'s geometry and never travels in an effect.
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
import { getSlot, slotKey, TABLE_TYPE, TEXT_TYPE, type GraphObject, type ObjectType, type Slot, type Value } from "../engine/graph/node.ts";
import { deriveEdges, mutate, type Operation } from "../engine/mutation.ts";
import { NULL_EVAL_CONTEXT, type EvalContext } from "../engine/eval-context.ts";
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
import { findDerivedSlotSchema, getObjectSchema, resolveDerivedSlots, resolveNonDerivedSlotPaths } from "../engine/primitives/schema.ts";
import { MAX_TABLE_LINES, MIN_TABLE_LINES, TABLE_COLS_PATH, TABLE_ROWS_PATH } from "../engine/primitives/table.ts";
import {
  TEXT_AUTORESIZE_PATH,
  TEXT_CONTENT_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_STYLE_ALIGN_PATH,
  TEXT_STYLE_COLOR_PATH,
  TEXT_STYLE_FONT_PATH,
  TEXT_STYLE_FONT_SIZE_PATH,
  TEXT_STYLE_LINE_HEIGHT_PATH,
  TEXT_WIDTH_PATH,
} from "../engine/primitives/text.ts";
import { IMAGE_HEIGHT_PATH, IMAGE_OPACITY_PATH, IMAGE_PICTURE_ASPECT_PATH, IMAGE_PRESERVE_ASPECT_PATH, IMAGE_SOURCE_PATH, IMAGE_WIDTH_PATH } from "../engine/primitives/image.ts";
import { SCRIPT_LANGUAGE_PATH, SCRIPT_SOURCE_PATH } from "../engine/script/stub.ts";
import { buildSlotDescriptors, describeSlotValue, type SlotDescriptor } from "./props.ts";
import type {
  ClearCommand,
  Command,
  CreateCircleCommand,
  CreateImageCommand,
  CreatePolygonCommand,
  CreateRectCommand,
  CreateScriptCommand,
  CreateTableCommand,
  CreateTextCommand,
  DeleteCommand,
  LinkCommand,
  PropsCommand,
  RefsCommand,
  RenameCommand,
  SelectCommand,
  SetFormulaCommand,
  SetLiteralCommand,
  UnlinkCommand,
  ZoomCommand,
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
 *
 * `createdObjectId` is the id `mintObjectId` returned for a SUCCESSFUL creation
 * (`circle`/`polygon`/`rect`/`text`/`table`), `undefined` for every other command.
 * D-124's open-editor-on-create needs the new `text` box's id and this file resolves
 * nothing for the application layer (D-069, D-082 clause 4) — so it names what it
 * made, and `main.ts` decides what to do with it.
 */
export type CommandOutcome =
  | {
      readonly ok: true;
      readonly document: Document;
      readonly lines: readonly string[];
      readonly effect?: CommandEffect;
      readonly createdObjectId?: string;
    }
  | { readonly ok: false; readonly message: string };

/**
 * What a command asks the application layer to do once the document part is done
 * (D-075 clause 2).
 *
 * Why it exists: five of §5.10's commands change no document state and reach the
 * camera, the selection, or a file — none of which `command/` may touch. They still
 * enter through `executeCommand`, which stays the ONLY place a `Command` meets a
 * `Document` (D-069), do their IDENTITY and DOMAIN work here, and hand `main.ts` a
 * description of the rest.
 *
 * Plain data, discriminated on `kind`, the same stance every shape in this codebase
 * takes: NEVER a callback, a closure, or a DOM handle, and an object is named by ID
 * (§5.2) because a name can be renamed out from under a stored effect.
 *
 * It carries no `CameraState`: `zoom` reports the multiplier the operator typed, and
 * the clamped camera is `render/camera.ts`'s to compute (D-075 clause 5, D-062).
 *
 * An outcome without one changed only the document, or only reported on it —
 * `list` and `refs` deliberately have none (D-075 clause 4).
 */
export type CommandEffect =
  | { readonly kind: "select"; readonly objectId: string }
  | { readonly kind: "zoom"; readonly factor: number }
  | { readonly kind: "fit" }
  | { readonly kind: "save" }
  | { readonly kind: "load" };

/** Narrows an outcome to its failure arm, discriminating on the VALUE of `ok` (D-032's principle) rather than a field's presence. */
export function isCommandFailure(outcome: CommandOutcome): outcome is { readonly ok: false; readonly message: string } {
  return outcome.ok === false;
}

// ---------------------------------------------------------------------------
// D-070 — the creation counts, bounded at CREATION here; `table`'s two also
// bound every later WRITE, one layer down (D-097, see the import above)
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

// `MIN_TABLE_LINES`/`MAX_TABLE_LINES` — D-070's identical provisional bounds for
// `table rows=<n> cols=<n>` — MOVED to `engine/primitives/table.ts` at D-097 clause 3:
// `mutation.ts`'s write-time bound needs them and `engine/` may not import `command/`.
// Imported above, not re-declared, so creation and every later write read one number.

/** §5.5 gives `polygon` a `rotation` slot and §5.10's form gives it no argument, so creation supplies this and `set polygon_1.rotation` changes it. */
const DEFAULT_POLYGON_ROTATION = 0;

/**
 * §5.6 gives a `text` object eleven non-derived slots; §5.10's `text x=0 y=0
 * "<content>"` form supplies only `content` and (optionally) the position. This
 * handler fills the other eight — `width`/`height`/`autoresize` and the five
 * `style.*` — with these defaults, the same way `createPolygon` supplies
 * `rotation`. They are the handler's provisional pick, not the brief's: §5.6
 * states the shape of `style` but no default values, and §5.10's grammar has no
 * argument for any of them. `set text_1.<slot> …` changes each afterward
 * (D-046-style `content` aside — that one is `literal`-only per D-122).
 *
 * `overflow` is no longer among them: the human's 2026-09-02 ruling removed the
 * slot (see `primitives/text.ts`). A box created before that still carries one;
 * it is inert.
 *
 * `width`/`height` default to `"auto"` — §5.6's "Auto width + auto height means no
 * wrapping", the safe default for a command that cannot specify a width. `font`
 * is a family/stack string (`eval-context.ts`'s `TextStyle`); `fontSize` /
 * `lineHeight` are world units (Q-012 provisional (a)), `lineHeight` an ABSOLUTE
 * length, not a ratio (`render/measure.ts`).
 */
const DEFAULT_TEXT_WIDTH = "auto";
const DEFAULT_TEXT_HEIGHT = "auto";
/**
 * `autoresize` defaults ON (the human's 2026-09-02 text-box rework): a fresh
 * box hugs its text and shrinks back when text is deleted, which is what
 * `"auto"` width/height already did before the slot existed — so the default
 * changes nothing about a new box and only gives the operator something to turn
 * OFF once they have dragged a size they want kept. `render/textbox.ts` owns
 * what it means.
 */
const DEFAULT_TEXT_AUTORESIZE = true;
const DEFAULT_TEXT_STYLE_FONT = "sans-serif";
const DEFAULT_TEXT_STYLE_FONT_SIZE = 16;
const DEFAULT_TEXT_STYLE_LINE_HEIGHT = 20;
const DEFAULT_TEXT_STYLE_COLOR = "black";
const DEFAULT_TEXT_STYLE_ALIGN = "left";

/**
 * §5.7 gives an `image` object five slots and §5.10's `image x=0 y=0` form supplies
 * only the position, so the handler fills `width`/`height`/`opacity` and the two
 * slots `primitives/image.ts` adds, `source` and `preserveAspect` — the same split
 * `DEFAULT_TEXT_*` above already uses. They are the handler's pick, not the
 * brief's: §5.7 states no default size and §5.10's grammar has no argument for one.
 *
 * **`DEFAULT_IMAGE_EXTENT` is the LONG SIDE a chosen picture is scaled to, as well
 * as the empty frame's size**, and it is one number for both on purpose: a picture
 * appears at the same scale as the frame it replaces, so choosing one never makes
 * the object jump in size. `main.ts`'s `pictureBoxSize` is the other reader
 * (imported, never re-spelled — D-010).
 *
 * A plain number rather than `text`'s `"auto"`: an empty image has no picture to
 * take a size from, and `"auto"` works for `text` only because a measurer answers
 * it. Once a picture IS chosen, its own proportions replace both slots — the
 * human's **Q-027** ruling, entry 0173.
 *
 * `source` starts EMPTY — §5.10's creation form carries no picture; the file picker
 * `main.ts` opens on creation is what fills it. `preserveAspect` starts TRUE,
 * which is §5.7's "by default" read literally. `pictureAspect` starts ZERO, which
 * is D-144's spelling of "no picture whose shape is known" — the pick gesture
 * writes the real ratio beside the `width`/`height` it takes from the same decode.
 */
export const DEFAULT_IMAGE_EXTENT = 100;
const DEFAULT_IMAGE_WIDTH = DEFAULT_IMAGE_EXTENT;
const DEFAULT_IMAGE_HEIGHT = DEFAULT_IMAGE_EXTENT;
const DEFAULT_IMAGE_OPACITY = 1;
const DEFAULT_IMAGE_SOURCE = "";
const DEFAULT_IMAGE_PRESERVE_ASPECT = true;
const DEFAULT_IMAGE_PICTURE_ASPECT = 0;

/**
 * §5.8 fixes `language` to `"python"` and gives no creation-time default for
 * `source` at all — a fresh script node's code is empty until the operator
 * writes some, the same "nothing yet" posture `DEFAULT_IMAGE_SOURCE` takes for
 * a picture. `createScript` supplies both; §5.10's `script x= y=` form carries
 * no argument for either.
 */
const DEFAULT_SCRIPT_LANGUAGE = "python";
const DEFAULT_SCRIPT_SOURCE = "";

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
 * not parse, a `select` naming nothing — comes back as the failure arm rather than
 * as a throw.
 *
 * NO EXCEPTION REMAINS. A formula too deep to walk — `set table_1.A1 = 1 + 1 + ...`
 * with tens of thousands of terms on one line — used to unwind a `RangeError` out of
 * here from `formula/parser.ts`. It is now that file's own `#PARSE` refusal, bounded
 * by two fixed constants (**D-079**), and it arrives on the failure arm like any
 * other. This file adds no depth check of its own and must not: the limit belongs to
 * the recursion it bounds.
 *
 * The switch names every `Command` arm, so a new arm fails to compile here rather
 * than falling through to a default that silently does nothing. Five of them change
 * no document state and return a `CommandEffect` instead (D-075).
 */
export function executeCommand(command: Command, document: Document, context: EvalContext = NULL_EVAL_CONTEXT): CommandOutcome {
  switch (command.kind) {
    case "circle":
      return createCircle(command, document, context);
    case "polygon":
      return createPolygon(command, document, context);
    case "rect":
      return createRect(command, document, context);
    case "text":
      return createText(command, document, context);
    case "table":
      return createTable(command, document, context);
    case "image":
      return createImage(command, document, context);
    case "script":
      return createScript(command, document, context);
    // `set` and `set-formula` are one command word at the input bar (D-071); the
    // parser splits them by whether the value position began with `=`, and both
    // reach the same slot-writing path below.
    case "set":
      return setLiteral(command, document, context);
    case "set-formula":
      return setFormula(command, document, context);
    case "link":
      return link(command, document, context);
    case "unlink":
      return unlink(command, document, context);
    case "clear":
      return clearSlotCommand(command, document, context);
    case "rename":
      return renameObject(command, document, context);
    case "delete":
      return deleteObject(command, document, context);
    case "refs":
      return refs(command, document);
    case "props":
      return props(command, document);
    case "list":
      return list(document);
    case "select":
      return select(command, document);
    case "zoom":
      return zoom(command, document);
    case "fit":
      return fit(document);
    case "save":
      return save(document);
    case "load":
      return load(document);
    default: {
      // Compile-time exhaustiveness without a throw — the idiom every
      // discriminated-union switch in this codebase carries.
      const exhaustive: never = command;
      void exhaustive;
      return { ok: false, message: "this command declares a kind no handler reads" };
    }
  }
}

/**
 * Every command word `executeCommand` actually runs. Enumerable so a test can pin it
 * against `parser.ts`'s `COMMAND_NAMES` instead of anyone remembering to keep two
 * lists aligned.
 *
 * It holds EVERY registry entry, so the two lists are equal rather than
 * complementary, and no command word reaches this file without running. The eight
 * §5.10 commands still unbuilt never reach it at all — `parser.ts`'s
 * `COMMANDS_SPECIFIED_BUT_NOT_BUILT` refuses them before a `Command` exists.
 */
export const COMMANDS_WITH_HANDLERS: readonly string[] = [
  "circle",
  "polygon",
  "rect",
  "text",
  "table",
  "image",
  "script",
  "set",
  "link",
  "unlink",
  "clear",
  "rename",
  "delete",
  "refs",
  "props",
  "list",
  "select",
  "zoom",
  "fit",
  "save",
  "load",
];

// ---------------------------------------------------------------------------
// Creation (§5.5's presets, §5.4's table)
// ---------------------------------------------------------------------------

/** One literal slot a creation handler supplies by value. The path is a schema path constant, never a string built here (D-010). */
interface LiteralSlotDeclaration {
  readonly path: readonly string[];
  readonly value: Value;
}

/**
 * The one creation path every creation handler shares: mint an id and a default name,
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
 *
 * The success arm carries `createdObjectId` (D-124): every creation goes through
 * here, so naming the new object is done once rather than per handler, and
 * `main.ts` reads it to open D-125's editor on a fresh `text` box.
 */
function createObjectFromCommand(
  document: Document,
  type: ObjectType,
  literals: readonly LiteralSlotDeclaration[],
  context: EvalContext,
): CommandOutcome {
  const schema = getObjectSchema(type);
  if (schema === undefined) {
    // Unreachable for the six types below, all of which have entries — kept as a
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
  // D-141: resolved PER OBJECT (a `dynamic` derived group, once one exists,
  // reads the object's own structural state) — the object below carries no
  // `ports` yet, which every `static`-only schema in today's registry ignores.
  const objectSoFar: GraphObject = { id: minted.id, name, type, slots };
  for (const derived of resolveDerivedSlots(objectSoFar, schema.derivedSlots)) {
    slots[slotKey(derived.path)] = { kind: "derived", value: null };
  }

  const object: GraphObject = { id: minted.id, name, type, slots };
  const operation: Operation = { kind: "createObject", object };
  const result = mutate(document.objects, [operation], document.journal, context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    document: { ...document, nextObjectId: minted.nextObjectId, objects: result.objects, journal: result.journal },
    lines: [`created ${name}`],
    createdObjectId: minted.id,
  };
}

/** `circle x=100 y=100 r=20` (§5.10) — §5.5's `circle(origin, radius)` preset. A negative radius is `#TYPE` on the derived `vertices` slot, not a rejection: it is a value, not a slot count (D-070). */
function createCircle(command: CreateCircleCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "circle", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: RADIUS_PATH, value: command.radius },
  ], context);
}

/** `polygon sides=5 x=0 y=0 r=50` (§5.10) — §5.5's `polygon(sides, radius, origin, rotation)`. `sides` is bounded before an `Operation` exists (D-070). */
function createPolygon(command: CreatePolygonCommand, document: Document, context: EvalContext): CommandOutcome {
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
  ], context);
}

/** `rect x=0 y=0 w=200 h=100` (§5.10) — §5.5's `rect(origin, width, height)`, corner-anchored (D-072 clause 8 normalises a two-corner pick before it reaches here). */
function createRect(command: CreateRectCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "rect", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: RECT_WIDTH_PATH, value: command.width },
    { path: RECT_HEIGHT_PATH, value: command.height },
  ], context);
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
function createTable(command: CreateTableCommand, document: Document, context: EvalContext): CommandOutcome {
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
  ], context);
}

/**
 * `text x=0 y=0 "Hello {= table_x.A1 }"` (§5.10, §5.6).
 *
 * Supplies all ELEVEN non-derived slots — `origin.x`/`origin.y` (**D-121**, the
 * same `ORIGIN_X_PATH`/`ORIGIN_Y_PATH` every positioned object uses), the
 * operator's `content` string, and the eight layout/style slots at their
 * `DEFAULT_TEXT_*` values above. `createObjectFromCommand` then fills all three
 * derived placeholders (`resolvedContent`, `measuredHeight`, `measuredWidth` —
 * the last per **D-123**) mechanically, and `mutate`'s step 7 evaluates them:
 * `resolvedContent` parses `content` into a block tree and resolves it (D-114);
 * the two measured slots are `#MEASURE` under the default `NULL_EVAL_CONTEXT` and
 * real sizes once `main.ts` threads a Canvas2D measurer through the `context`
 * argument (**D-118**). `DEFAULT_TEXT_WIDTH` is `"auto"`, so `measuredWidth` is
 * what bounds a command-created `text` object on canvas (`render/extent.ts`).
 *
 * `content` is stored EXACTLY as typed — `{= }`/`{? }` markup and all — and is
 * never parsed here (§5.6: "raw source including markup"). A count-style refusal
 * has nothing to bound: `text` allocates a fixed eleven slots regardless of its
 * arguments (Rule 6), so unlike `polygon`/`table` there is no unbounded slot
 * allocation to guard against.
 *
 * **D-124**'s pointing path reaches this handler with `content` `""` (the prompt
 * sequence has no content step); the outcome's `createdObjectId` is what
 * `main.ts` opens D-125's in-place editor on.
 */
function createText(command: CreateTextCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "text", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: TEXT_CONTENT_PATH, value: command.content },
    { path: TEXT_WIDTH_PATH, value: DEFAULT_TEXT_WIDTH },
    { path: TEXT_HEIGHT_PATH, value: DEFAULT_TEXT_HEIGHT },
    { path: TEXT_AUTORESIZE_PATH, value: DEFAULT_TEXT_AUTORESIZE },
    { path: TEXT_STYLE_FONT_PATH, value: DEFAULT_TEXT_STYLE_FONT },
    { path: TEXT_STYLE_FONT_SIZE_PATH, value: DEFAULT_TEXT_STYLE_FONT_SIZE },
    { path: TEXT_STYLE_LINE_HEIGHT_PATH, value: DEFAULT_TEXT_STYLE_LINE_HEIGHT },
    { path: TEXT_STYLE_COLOR_PATH, value: DEFAULT_TEXT_STYLE_COLOR },
    { path: TEXT_STYLE_ALIGN_PATH, value: DEFAULT_TEXT_STYLE_ALIGN },
  ], context);
}

/**
 * `image x=0 y=0` (§5.10, §5.7).
 *
 * Supplies all EIGHT non-derived slots: `origin.x`/`origin.y` from the command, and
 * `width`/`height`/`opacity`/`source`/`preserveAspect`/`pictureAspect` from the
 * `DEFAULT_IMAGE_*` values above, exactly as `createText` supplies its eight
 * layout/style defaults. `IMAGE_SCHEMA` declares no derived slot, so
 * `createObjectFromCommand` fills none.
 *
 * No count-style refusal, and none is owed: an `image` object allocates a fixed
 * eight slots whatever its arguments say (Rule 6), so unlike `polygon`/`table` there
 * is no unbounded slot allocation for D-070 to bound. `opacity` is a VALUE, not a
 * count, and is deliberately unbounded here — see `primitives/image.ts`.
 *
 * A freshly created image draws as an EMPTY FRAME at `DEFAULT_IMAGE_EXTENT` square
 * and is immediately selectable: `source` is empty until `main.ts`'s file picker —
 * which this creation asks for, `AppTransition.pickImageFor` — fills it, and the
 * chosen picture's own proportions then replace `width`/`height` and are recorded
 * in `pictureAspect` so a later distortion can be undone (D-144).
 */
function createImage(command: CreateImageCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "image", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: IMAGE_WIDTH_PATH, value: DEFAULT_IMAGE_WIDTH },
    { path: IMAGE_HEIGHT_PATH, value: DEFAULT_IMAGE_HEIGHT },
    { path: IMAGE_OPACITY_PATH, value: DEFAULT_IMAGE_OPACITY },
    { path: IMAGE_SOURCE_PATH, value: DEFAULT_IMAGE_SOURCE },
    { path: IMAGE_PRESERVE_ASPECT_PATH, value: DEFAULT_IMAGE_PRESERVE_ASPECT },
    { path: IMAGE_PICTURE_ASPECT_PATH, value: DEFAULT_IMAGE_PICTURE_ASPECT },
  ], context);
}

/**
 * `script x=0 y=0` (§5.10, §5.8).
 *
 * Supplies the four STATIC non-derived slots `SCRIPT_SCHEMA` declares —
 * `origin.x`/`origin.y` from the command, `language`/`source` from the
 * `DEFAULT_SCRIPT_*` values above. `SCRIPT_SCHEMA`'s two dynamic non-derived
 * families (`in.*`/`placeholder.*`) and its one dynamic derived family
 * (`out.*`) all resolve against `ports`, which a freshly created object has
 * none of — `createObjectFromCommand` therefore fills no derived slot here
 * either, exactly as it fills none for `image`. A script node's ports are
 * declared afterward by explicit `addPort` mutations (D-141 clause 6); §5.10
 * names no command word for that, so none is invented here (§8's last bullet).
 *
 * No count-style refusal, and none is owed: a script node allocates a fixed
 * four slots whatever its arguments say (Rule 6) until a port is added, so
 * there is no unbounded slot allocation for D-070 to bound.
 */
function createScript(command: CreateScriptCommand, document: Document, context: EvalContext): CommandOutcome {
  return createObjectFromCommand(document, "script", [
    { path: ORIGIN_X_PATH, value: command.x },
    { path: ORIGIN_Y_PATH, value: command.y },
    { path: SCRIPT_LANGUAGE_PATH, value: DEFAULT_SCRIPT_LANGUAGE },
    { path: SCRIPT_SOURCE_PATH, value: DEFAULT_SCRIPT_SOURCE },
  ], context);
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

  if (findDerivedSlotSchema(object, address.path) !== undefined) {
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
 * failure arm rather than as a throw. `parseFormula` below refuses a formula nested past
 * **D-079**'s constants with a `#PARSE` instead of unwinding, so no size is an exception.
 *
 * D-040's "not silent" bound is discharged here rather than per command: whatever the
 * write, if the slot it lands on currently holds a formula, the report names that
 * formula's source. That is why this is one function and not three.
 */
function writeSlot(write: SlotWrite, targetText: string, document: Document, context: EvalContext): CommandOutcome {
  const resolved = resolveWritableSlot(targetText, document);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const { address, existing } = resolved.target;

  const built = buildSlot(write, resolved.target, document);
  if (!built.ok) {
    return { ok: false, message: built.message };
  }

  const result = mutate(document.objects, [{ kind: "setSlot", address, slot: built.slot }], document.journal, context);
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
      // D-122 (answers Q-023): a `text` object's `content` is `literal`-only.
      // It is read as raw source at edge-derivation time (§5.1 step 3), before
      // any formula value exists (step 7), so a `formula`-driven `content`'s
      // embedded `{= }`/`{? }` references cannot be tracked — the same step-3
      // -vs-step-7 obstacle D-046 guards for a table dimension slot. Both
      // `link text_1.content …` and `set text_1.content = …` reach here; a plain
      // `set text_1.content "…"` (the `"literal"` arm above) is how `content` is
      // authored and is unaffected.
      if (isTextContentTarget(target)) {
        return {
          ok: false,
          message: `${target.displayName} is read as raw source only — a text object's content cannot be a formula or a link (D-122). Write it with: set ${target.displayName} "..."`,
        };
      }
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

/** Whether this write target is a `text` object's `content` slot — the one slot D-122 forbids `link`/`set =` from making a formula. Type + path, not path alone: `["content"]` is only a slot on `text`, but the pair says so unambiguously. */
function isTextContentTarget(target: WritableSlotTarget): boolean {
  return target.object.type === TEXT_TYPE && slotKey(target.address.path) === slotKey(TEXT_CONTENT_PATH);
}

/** The table whose cell this target is, or `undefined` for every other slot — §5.3's bare-cell-ref scope, decided once. */
function cellHostObjectId(target: WritableSlotTarget): string | undefined {
  const isCell = target.object.type === TABLE_TYPE && target.address.path.length === 2 && target.address.path[0] === TABLE_CELL_PATH_PREFIX;
  return isCell ? target.object.id : undefined;
}

/** `set polygon_1.radius 42` (§5.10) — a literal. Over a formula slot this REPLACES it and says so (D-040). */
function setLiteral(command: SetLiteralCommand, document: Document, context: EvalContext): CommandOutcome {
  return writeSlot({ kind: "literal", value: command.value }, command.target, document, context);
}

/** `set table_x.B1 = polygon_b.origin.x * 2` (D-071) — the same command word, writing a formula because the value position began with `=`. */
function setFormula(command: SetFormulaCommand, document: Document, context: EvalContext): CommandOutcome {
  // D-071 clause 1 keeps the `=` on the raw source so no offset is lost; `parseFormula`
  // wants the expression alone, and this is the one place the two meet.
  return writeSlot({ kind: "formula", source: command.source.slice(1), mustBeReference: false }, command.target, document, context);
}

/** `link polygon_1.origin.x table_x.A1` (§5.10) — §5.1's degenerate formula, so it is `set <target> = <source>` with the source constrained to a bare reference (D-071 clause 4). */
function link(command: LinkCommand, document: Document, context: EvalContext): CommandOutcome {
  return writeSlot({ kind: "formula", source: command.source, mustBeReference: true }, command.target, document, context);
}

/** `unlink polygon_1.origin.x` (§5.10) — back to a literal holding whatever was last displayed (D-041). */
function unlink(command: UnlinkCommand, document: Document, context: EvalContext): CommandOutcome {
  return writeSlot({ kind: "unlink" }, command.target, document, context);
}

/**
 * `clear table_1.A1` — empties a table cell by REMOVING its slot (the human's
 * 2026-09-02 report; `mutation.ts`'s `ClearSlotOperation`).
 *
 * Deliberately NOT routed through `writeSlot`: that function's whole shape is
 * "build a `Slot`, commit one `setSlot`", and the point here is that there is
 * no slot to build — D-047 makes an ABSENT cell the empty state, and every
 * `Value` (`""` and `0` included) is content. It does reuse
 * `resolveWritableSlot`, because the IDENTITY questions are identical (does the
 * address parse, does the object exist, is it derived, does the type declare
 * it) and D-069 puts those in this file exactly once.
 *
 * Restricted to a table cell here as well as in `mutate`, and that duplication
 * is on purpose: the engine's refusal is the INVARIANT (a slot may only be
 * removed where an absent one has a settled meaning) while this one is the
 * OPERATOR'S message, which can name the command they typed and suggest `set`
 * instead. The engine check is not a backstop for this one — it holds for any
 * caller, including a test building operations directly.
 *
 * An ALREADY-EMPTY cell succeeds and mutates nothing. It is not an error to ask
 * for a state that already holds, and journalling a removal that removes
 * nothing would put an entry in §5.11's history for an event that did not
 * happen. This is the arm the in-place editor takes every time an empty cell is
 * opened and closed untouched — the exact gesture that used to write `""`.
 */
function clearSlotCommand(command: ClearCommand, document: Document, context: EvalContext): CommandOutcome {
  const resolved = resolveWritableSlot(command.target, document);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const { address, existing, displayName } = resolved.target;
  if (cellHostObjectId(resolved.target) === undefined) {
    return {
      ok: false,
      message: `${displayName} is not a table cell — "clear" empties a cell by removing it (D-047), and only a cell has an empty state. Use "set ${displayName} <value>" instead`,
    };
  }
  if (existing === undefined) {
    return { ok: true, document, lines: [`${displayName} is already empty`] };
  }
  const was = existing.kind === "formula"
    ? `= ${formatFormula(existing.ast, document.objects)}`
    : describeSlotValue(existing.value);
  const result = mutate(document.objects, [{ kind: "clearSlot", address }], document.journal, context);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, document: { ...document, objects: result.objects, journal: result.journal }, lines: [`cleared ${displayName} — was ${was}`] };
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
function renameObject(command: RenameCommand, document: Document, context: EvalContext): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"` };
  }

  const result = mutate(document.objects, [{ kind: "renameObject", objectId: object.id, name: command.newName }], document.journal, context);
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
function deleteObject(command: DeleteCommand, document: Document, context: EvalContext): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"` };
  }

  const result = mutate(document.objects, [{ kind: "deleteObject", objectId: object.id, force: command.force }], document.journal, context);
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
  if (findDerivedSlotSchema(object, path) !== undefined) {
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

// ---------------------------------------------------------------------------
// props — an object's slots, made legible (D-092 clause 4, D-094 clause 9)
// ---------------------------------------------------------------------------

/**
 * `props polygon_1` (D-092 clause 4) — every slot the object's schema declares:
 * its path, its kind, its current value, and for a formula slot the source
 * `formula/format.ts` reconstructs against current names.
 *
 * The enumeration itself is `command/props.ts`'s `buildSlotDescriptors` — D-094
 * clause 9 forbids a second one, so the properties panel it also feeds (queued,
 * not built) will render rows from the identical list rather than a fresh
 * reading of the schema.
 *
 * No `effect` (D-075 clause 4, D-092 clause 6): `props` reads and refuses to
 * write, exactly like `refs` and `list`.
 */
function props(command: PropsCommand, document: Document): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"` };
  }
  const descriptors = buildSlotDescriptors(object, document.objects);
  if (descriptors.length === 0) {
    // Only reachable for a type `primitives/schema.ts` has no registry entry
    // for yet (`props.ts`'s own file header) — every creatable type's schema
    // declares at least one slot, so this is a truthful "why", not a guess.
    return { ok: false, message: `object type "${object.type}" has no schema, so nothing can say which slots ${object.name} has` };
  }
  return {
    ok: true,
    document,
    lines: [`${object.name} — ${object.type}`, ...descriptors.map(formatSlotDescriptorLine)],
  };
}

/** One `SlotDescriptor` as a `props` log line — the path exactly as the operator would type it after the object's name (D-010's `slotKey`, never a hand-joined string). */
function formatSlotDescriptorLine(descriptor: SlotDescriptor): string {
  const path = slotKey(descriptor.path);
  const value = describeSlotValue(descriptor.value);
  if (descriptor.kind === "formula") {
    return `${path} = ${value} (formula, = ${descriptor.formulaSource})`;
  }
  return `${path} = ${value} (${descriptor.kind})`;
}

// ---------------------------------------------------------------------------
// The effect commands (§5.10's `select`/`zoom`/`fit`/`save`/`load`; D-075)
// ---------------------------------------------------------------------------

/**
 * `select intersection_a` (§5.10).
 *
 * The name is resolved HERE and an unknown one is refused here (D-075 clause 1):
 * `main.ts` never resolves a name, or there would be a second resolution site in the
 * one file no test reaches. The effect carries the ID, not the name — `render/`'s
 * selection state is ID-keyed and a name is mutable (§5.2).
 *
 * The echoed line is safe to state in the past tense: everything that could refuse
 * this command has already happened, and storing the id cannot fail.
 */
function select(command: SelectCommand, document: Document): CommandOutcome {
  const object = findGraphObjectByName(command.target, document.objects);
  if (object === undefined) {
    return { ok: false, message: `no object named "${command.target}"` };
  }
  return { ok: true, document, lines: [`selected ${object.name}`], effect: { kind: "select", objectId: object.id } };
}

/**
 * `zoom <factor>` (§5.10) — a MULTIPLIER on the current zoom, not a zoom level.
 *
 * A factor of zero, a negative one, or an infinity is refused here as a DOMAIN
 * failure, the same posture `refuseCountOutOfRange` takes: none of the three is a
 * multiplier, and `parser.ts` accepts all three — it validates the FORM of a number
 * and not its usefulness, so `0`, `-2` and a run of 400 digits (which `Number` reads
 * as `Infinity`) all arrive here as a `factor`. Letting them through would reach
 * `render/camera.ts`'s clamp, which would silently turn each into `MIN_ZOOM` or into
 * "no change" — a command that appears to work and does something else.
 *
 * The RANGE is not checked here and must not be: `[MIN_ZOOM, MAX_ZOOM]` is
 * `render/camera.ts`'s (D-062), it is a property of the resulting camera rather than
 * of the factor, and this layer cannot see the current zoom to apply it to. So the
 * echoed line names the REQUEST; a clamped result is `main.ts`'s to report.
 */
function zoom(command: ZoomCommand, document: Document): CommandOutcome {
  if (!Number.isFinite(command.factor) || command.factor <= 0) {
    return { ok: false, message: `factor must be a positive number, got ${command.factor}` };
  }
  return { ok: true, document, lines: [`zoom by ${command.factor}`], effect: { kind: "zoom", factor: command.factor } };
}

/**
 * `fit` (§5.10) — zoom to the document's extent.
 *
 * An EMPTY document is refused here: "are there any objects" is a document read, this
 * file is where a `Command` meets a `Document` (D-069), and the alternative is a
 * camera computed from an extent that does not exist. `render/camera.ts` would
 * survive it — `finiteOrFallback` leaves the camera where it was (D-027) — but the
 * operator would see a command that reported success and moved nothing.
 *
 * The extent itself does NOT travel in the effect. It is geometry over drawn objects,
 * which is `render/`'s, and it needs the viewport size only `main.ts` has (D-061).
 * A single-point extent still has to be guarded there (D-066); refusing the empty
 * document does not discharge that.
 */
function fit(document: Document): CommandOutcome {
  if (document.objects.length === 0) {
    return { ok: false, message: "no objects to fit — create one first" };
  }
  return { ok: true, document, lines: ["fit to the document extent"], effect: { kind: "fit" } };
}

/**
 * `save` (§5.10, §5.11) — hand the document to `main.ts` for a JSON download.
 *
 * Nothing is serialized here and the effect carries no document: the outcome's own
 * `document` is the one to write, by identity, and `main.ts` already stores it
 * (D-069). Every way this can fail — no DOM, a refused download — is on the far side
 * of the seam, so success here means only "there is nothing to refuse", which is why
 * the line is progressive rather than past tense.
 */
function save(document: Document): CommandOutcome {
  return { ok: true, document, lines: ["saving document"], effect: { kind: "save" } };
}

/**
 * `load` (§5.10, §5.11) — ask `main.ts` to read a document back through a file input.
 *
 * Returns the CURRENT document unchanged. The loaded one cannot come back through
 * this outcome: reading a file is asynchronous and DOM-driven, and `executeCommand`
 * is synchronous and DOM-free. `main.ts` performs the read and installs the result
 * through §5.11's loader, which is the one path allowed to build a `Document` from
 * JSON — not this file, and not a widened effect.
 */
function load(document: Document): CommandOutcome {
  return { ok: true, document, lines: ["loading document"], effect: { kind: "load" } };
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
