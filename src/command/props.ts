/**
 * props.ts — One object's slots, enumerated once for two readers.
 *
 * IMPLEMENTS: **D-092 clause 4** (`props <object>` needs an enumeration of an
 * object's slots — path, kind, value, and a formula's source) and **D-094
 * clause 9** ("ONE enumeration serves both `props` and the panel... a second
 * enumeration of an object's slots is forbidden").
 * LAYER: command. Pure: touches no canvas, DOM, or window, and performs no
 * `mutate` (D-092 clause 6 — `props` reads and refuses to write, like `refs`
 * and `list`). May import: engine/* (read-only), own layer. NEVER imported by
 * engine/*.
 *
 * WHAT THIS IS
 *   `buildSlotDescriptors(object, objects)` — every slot `object`'s schema
 *   declares, in SCHEMA declaration order (D-094 clause 7): non-derived paths
 *   first (`resolveNonDerivedSlotPaths`'s own group order), then
 *   `derivedSlots`' order. `objects` is needed only to format a formula
 *   slot's source against CURRENT names (§5.2) — this file resolves no
 *   address and writes nothing.
 *
 *   `describeSlotValue` renders one slot's VALUE as the text `command/
 *   commands.ts`'s echo lines show — the same "one formatter, not two"
 *   reasoning D-094 clause 9 states for the descriptor list applies to the
 *   text built from it (entry 0097 moved it here). **D-099** gives it one
 *   optional `maxDecimals` argument rather than a second copy: absent (every
 *   `commands.ts` caller, `props` included), a number renders exactly as
 *   before; `main.ts`'s `buildPanelModel` is the ONE caller that passes
 *   `{ maxDecimals: 4 }`, rounding a displayed number for the panel while
 *   leaving `props`'s own output byte-identical. A second option,
 *   `fullStrings`, is the same shape inverted — a very long string ELIDES
 *   unless the caller asks for it whole — so §5.7's data-URL `source` slot
 *   cannot print a hundred thousand characters into a log line, a panel row, or
 *   a `set` echo. `main.ts`'s `editSeed` is its one caller.
 *
 *   `commands.ts`'s `props` handler formats `SlotDescriptor[]` into log
 *   lines; the properties panel (D-094, not yet built) will render rows from
 *   the identical list. Neither may enumerate an object's slots any other
 *   way.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. An object whose type has no schema yet gets an empty
 *     list, not a throw — `commands.ts` is where that becomes a message.
 *   - **D-077: a table's `cells.*` family is NEVER enumerated path-by-path.**
 *     `resolveNonDerivedSlotPaths` would return one entry per declared cell —
 *     tens to hundreds of thousands for a large table (0078-REVIEW) — so this
 *     file walks `schema.nonDerivedSlotPaths` itself instead of calling that
 *     function, and a `dynamic` group becomes ONE summary descriptor rather
 *     than one per path. `TABLE_SCHEMA` is the only `dynamic` group this file
 *     SUMMARISES. **`SCRIPT_SCHEMA` (entry 0169) added TWO more — `in.*` and
 *     `placeholder.*` — and this file does not summarise those either: its
 *     `dynamic` branch below only special-cases `TABLE_TYPE`, so a script
 *     object's `in.*`/`placeholder.*` slots are silently ABSENT from
 *     `props`/the panel today, known and undisclosed-elsewhere until now.**
 *     `out.*` is unaffected — it is a DERIVED family, walked correctly by the
 *     `resolveDerivedSlots` loop below, which has no such gap. Giving `script`
 *     its own summary row is the next reader of this file's job, not this
 *     entry's (out of its declared scope).
 *   - A slot's PATH is never hand-built: every descriptor's `path` is a path
 *     array taken directly from the schema (or, for the table summary row,
 *     `address.ts`'s own `TABLE_CELL_PATH_PREFIX`) — D-010. A caller joins it
 *     with `graph/node.ts`'s `slotKey`, never string concatenation.
 *
 * NOT DONE HERE
 *   - Formatting a descriptor list into `command/commands.ts`'s log lines, or
 *     into the properties panel's DOM rows (D-094, queued). This file returns
 *     data; both readers decide how to show it.
 *   - Resolving the object name the operator typed. `commands.ts` does that,
 *     the same way it does for `refs`/`list`/`select` (D-069).
 */
import { formatFormula } from "../engine/formula/format.ts";
import { getSlot, isErrorValue, TABLE_TYPE, type GraphObject, type Point, type Slot, type Value } from "../engine/graph/node.ts";
import { findSlotOptions, getObjectSchema, resolveDerivedSlots, type SlotOptionSet } from "../engine/primitives/schema.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import { TABLE_CELL_PATH_PREFIX } from "../engine/address.ts";

/**
 * One slot, described for display. `formulaSource` is present only when
 * `kind === "formula"` — the expression `formula/format.ts` reconstructed,
 * WITHOUT a leading `=` (the same convention `formatFormula` itself states),
 * so a caller that wants the authoring form prefixes one.
 *
 * `synthetic` (**D-096** clause 2, added at **D-102**) marks a row that
 * stands in for a whole slot FAMILY rather than naming one real slot — today
 * only the table's `cells` summary row. `kind: "literal"` still puts it in
 * the modifiable group (D-096 clause 2's own reasoning is unchanged), but
 * D-102 clause 2 refuses it a paperclip: there is no single slot behind it
 * to `set`, `link`, or `unlink`. Absent (not `false`) on every ordinary row.
 */
export interface SlotDescriptor {
  readonly path: readonly string[];
  readonly kind: "literal" | "formula" | "derived";
  readonly value: Value;
  readonly formulaSource?: string;
  readonly synthetic?: true;
  /**
   * The closed value set this slot accepts, when its schema declares one
   * (`primitives/schema.ts`'s `slotOptions`) — the human's 2026-09-02
   * instruction that a slot with "only a small subset of valid inputs" should
   * OFFER them rather than make the operator know them. Absent on every
   * free-text slot, which is all of them but `text`'s three.
   *
   * Carried on the descriptor rather than looked up again by each reader, for
   * D-094 clause 9's reason: `props` and the panel enumerate an object's slots
   * ONCE, and what a slot accepts is part of describing it.
   */
  readonly options?: SlotOptionSet;
}

/**
 * Every slot `object`'s schema declares (D-092 clause 4, D-094 clauses 7–9).
 *
 * `undefined` schema (a type §6.2's registry has no entry for yet — see
 * `primitives/schema.ts`'s file header) returns an empty list rather than
 * throwing; `commands.ts` is where an empty list becomes a "no schema"
 * message, because this file has no message vocabulary of its own.
 */
export function buildSlotDescriptors(object: GraphObject, objects: readonly GraphObject[]): readonly SlotDescriptor[] {
  const schema = getObjectSchema(object.type);
  if (schema === undefined) {
    return [];
  }

  const descriptors: SlotDescriptor[] = [];
  for (const group of schema.nonDerivedSlotPaths) {
    if (group.kind === "dynamic") {
      // D-077 / D-094 clause 8: a TABLE's `cells.*` is summarised, never
      // enumerated — see file header for why (an 8x8 table is 64 rows of noise
      // and the family is sized by `rows`/`cols`, so it has no natural end).
      if (object.type === TABLE_TYPE) {
        descriptors.push(tableCellsSummary(object));
        continue;
      }
      // Every OTHER dynamic family IS enumerated, and a `script` node's ports
      // are why (D-146). D-077's reasoning is about a cell grid, not about
      // dynamic-ness: a port is a distinct thing the operator declared BY NAME
      // with `addport`, there are a handful, and `props` is the only way to see
      // one from the command line. Summarising them would mean an operator can
      // declare a port and then not find it.
      for (const path of group.enumerate(object)) {
        const dynamicSlot = getSlot(object, path);
        if (dynamicSlot === undefined) {
          continue; // Declared but unwritten — `addport` writes both halves (D-146), so this is defensive.
        }
        descriptors.push({ ...describeNonDerivedSlot(path, dynamicSlot, objects), ...optionsFor(object, path) });
      }
      continue;
    }
    for (const path of group.paths) {
      const slot = getSlot(object, path);
      if (slot === undefined) {
        // A declared, non-cell path with no slot: unreachable for every type
        // in today's registry (creation fills every static path — `command/
        // commands.ts`'s `createObjectFromCommand`), kept as a skip rather
        // than an assumption so a future type cannot make this throw.
        continue;
      }
      descriptors.push({ ...describeNonDerivedSlot(path, slot, objects), ...optionsFor(object, path) });
    }
  }
  for (const derived of resolveDerivedSlots(object, schema.derivedSlots)) {
    const slot = getSlot(object, derived.path);
    // D-018 requires a `derived`-kind slot at every declared derived path
    // once an object exists; `?? null` is defensive, not an expected case.
    descriptors.push({ path: derived.path, kind: "derived", value: slot?.value ?? null });
  }
  return descriptors;
}

/**
 * `{ options }` when this slot's schema declares a closed value set, `{}`
 * otherwise — spread onto the descriptor so the field is genuinely ABSENT for a
 * free-text slot rather than present-and-`undefined`, which is what every other
 * optional field on `SlotDescriptor` already does (`formulaSource`,
 * `synthetic`) and what keeps a `toEqual` in a test readable.
 */
function optionsFor(object: GraphObject, path: readonly string[]): { options?: SlotOptionSet } {
  const options = findSlotOptions(object.type, path);
  return options === undefined ? {} : { options };
}

/** One non-derived slot, described. Exhaustive over the three slot kinds — see the `"derived"` arm's own comment for why that case is reachable here at all. */
function describeNonDerivedSlot(path: readonly string[], slot: Slot, objects: readonly GraphObject[]): SlotDescriptor {
  switch (slot.kind) {
    case "literal":
      return { path, kind: "literal", value: slot.value };
    case "formula":
      return { path, kind: "formula", value: slot.value, formulaSource: formatFormula(slot.ast, objects) };
    case "derived":
      // The schema declares this PATH as non-derived, so a `derived`-kind
      // slot here is a schema/object mismatch — not an invariant this file
      // enforces (that is `mutation.ts`'s D-018). Reported honestly rather
      // than assumed away, the same "never throws" posture every reader in
      // this codebase takes over a `GraphObject` it did not itself validate.
      return { path, kind: "derived", value: slot.value };
    default: {
      const exhaustive: never = slot;
      void exhaustive;
      return { path, kind: "literal", value: null };
    }
  }
}

/**
 * `table`'s ONE row for its whole `cells.*` family (D-094 clause 8): the grid
 * shape and how many cells are WRITTEN — an absent cell is D-047's ordinary
 * "legally empty", so this counts stored slots, never
 * `enumerateTableCellSlotPaths`'s declared-but-possibly-absent full set.
 *
 * `kind: "literal"` places it in the panel's MODIFIABLE group (D-094 clause
 * 5): it is not `derived`, and no single kind could describe a family whose
 * cells are independently `literal` or `formula`. Per-cell detail is §5.4's
 * formula bar, not this row.
 */
function tableCellsSummary(object: GraphObject): SlotDescriptor {
  const { rows, cols } = getTableDimensions(object);
  const prefix = `${TABLE_CELL_PATH_PREFIX}.`;
  const written = Object.keys(object.slots).filter((key) => key.startsWith(prefix)).length;
  return {
    path: [TABLE_CELL_PATH_PREFIX],
    kind: "literal",
    value: `${rows}×${cols} grid — ${written} of ${rows * cols} cells written`,
    synthetic: true,
  };
}

/**
 * Renders a slot's VALUE as display text — §5.10's echo lines (`set`'s and
 * `unlink`'s, in `command/commands.ts`) and `props`'s own lines both call it,
 * which is why D-094 clause 9 puts it here rather than in either caller.
 *
 * Distinct from `formula/eval.ts`'s `describeValueType`, which names a
 * value's TYPE for a `#TYPE` message: this one shows the value itself,
 * because D-041's report is "here is what was kept" and a type name would
 * not tell the operator whether to type over it.
 *
 * `options.maxDecimals` (**D-099**): absent, every number renders via plain
 * `String(value)`, byte-identical to before this option existed — every
 * `command/commands.ts` caller, `props` included, relies on that. Set (only
 * by `main.ts`'s `buildPanelModel`), a `number` and each component of a
 * `Point` round to at most that many decimal places — see
 * `formatDisplayNumber`. Untouched either way (D-099 clause 4): the `n
 * points` summary, the table `cells` summary string (already text, not a bare
 * number, by the time it reaches here), and the error-value text.
 *
 * `options.fullStrings` inverts D-099's shape for the STRING arm, deliberately:
 * a very long string is ELIDED by default and rendered whole only when the
 * caller asks. §5.7's `image.source` holds a data URL of hundreds of thousands
 * of characters, and every display reader of this function — `props`'s log
 * lines, a `set` echo, a panel row — would otherwise print all of it. The one
 * caller that needs the string back verbatim is `main.ts`'s `editSeed`, which
 * must stay a value the operator could type back unchanged (D-107's own reason
 * for existing), so it opts in. Defaulting the other way would put the burden on
 * every future display caller to remember, and the failure mode of forgetting is
 * a megabyte in the log.
 */
export function describeSlotValue(value: Value, options?: { readonly maxDecimals?: number; readonly fullStrings?: boolean }): string {
  if (value === null) {
    return "nothing";
  }
  if (isErrorValue(value)) {
    return `${value.error}: ${value.message}`;
  }
  if (typeof value === "string") {
    return options?.fullStrings === true ? `"${value}"` : elideLongString(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number") {
    return formatDisplayNumber(value, options?.maxDecimals);
  }
  if (Array.isArray(value)) {
    return `${value.length} points`;
  }
  const point = value as Point;
  return `${formatDisplayNumber(point.x, options?.maxDecimals)},${formatDisplayNumber(point.y, options?.maxDecimals)}`;
}

/**
 * How much of a string `describeSlotValue` shows before eliding it, and how much
 * of the head it keeps. Round, untuned numbers (Rule 5), chosen only to be
 * comfortably longer than every string any other slot in the registry holds — a
 * font family, an alignment keyword, a text box's content — so the elision fires
 * for §5.7's data URLs and effectively nothing else.
 */
const DISPLAY_STRING_MAX_LENGTH = 80;
const DISPLAY_STRING_HEAD_LENGTH = 40;

/**
 * A string as display text: quoted whole when it is short, and otherwise its
 * head plus its true length.
 *
 * The elided form is deliberately NOT re-typeable — it says how many characters
 * were dropped rather than pretending to be the value — because a display string
 * that looks like a literal is exactly how a truncated value gets committed back
 * over a real one (the F3 defect D-107 fixed, in a different disguise).
 */
function elideLongString(value: string): string {
  if (value.length <= DISPLAY_STRING_MAX_LENGTH) {
    return `"${value}"`;
  }
  return `"${value.slice(0, DISPLAY_STRING_HEAD_LENGTH)}…" (${value.length} characters)`;
}

/**
 * One number, for `describeSlotValue`'s display (**D-099**). `maxDecimals`
 * absent — every caller but `buildPanelModel` — is plain `String(value)`,
 * unchanged from before this function existed.
 *
 * With `maxDecimals` set: rounds to AT MOST that many decimal places and
 * TRIMS trailing zeros, so an integer stays bare (`10`, never `10.0000`).
 * `toFixed` then a round-trip through `Number`/`String` is what does the
 * trimming for free — a JS number's own default string form never carries a
 * trailing zero, so there is nothing to strip by hand (D-099 clause 2).
 *
 * EXCEPT when that rounds a genuinely non-zero value to `0` (clause 3): a
 * `centroid.y` of float dust reading `0` on screen is a lie the operator
 * cannot detect, so that one case reports in EXPONENTIAL form instead, at the
 * same precision (`1.2246e-16`, not `0`) — an exact `0` is unaffected, since
 * `0 !== 0` is false.
 *
 * A non-finite number is unreachable through this path today — every
 * reachable `Value` is `finiteOrTypeError`-checked at evaluation time (D-025)
 * — but `toFixed`/`toExponential` both throw on `NaN`/`±Infinity`, so it is
 * guarded here rather than assumed away (clause 4; this file's own
 * "never throws" posture, matching every other reader of a `Value`).
 */
function formatDisplayNumber(value: number, maxDecimals: number | undefined): string {
  if (maxDecimals === undefined || !Number.isFinite(value)) {
    return String(value);
  }
  const rounded = Number(value.toFixed(maxDecimals));
  if (rounded === 0 && value !== 0) {
    return value.toExponential(maxDecimals);
  }
  return String(rounded);
}
