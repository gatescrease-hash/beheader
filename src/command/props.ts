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
 *   commands.ts`'s echo lines already used before this cycle moved it here —
 *   the same "one formatter, not two" reasoning D-094 clause 9 states for the
 *   descriptor list applies to the text built from it.
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
 *     than one per path. `TABLE_SCHEMA` is the only `dynamic` group in the
 *     registry today (`primitives/schema.ts`); a future one needs a summary
 *     of its own here, or it is silently dropped rather than spread.
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
import { getObjectSchema } from "../engine/primitives/schema.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import { TABLE_CELL_PATH_PREFIX } from "../engine/address.ts";

/**
 * One slot, described for display. `formulaSource` is present only when
 * `kind === "formula"` — the expression `formula/format.ts` reconstructed,
 * WITHOUT a leading `=` (the same convention `formatFormula` itself states),
 * so a caller that wants the authoring form prefixes one.
 */
export interface SlotDescriptor {
  readonly path: readonly string[];
  readonly kind: "literal" | "formula" | "derived";
  readonly value: Value;
  readonly formulaSource?: string;
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
      // D-077 / D-094 clause 8: summarise, never enumerate. See file header.
      if (object.type === TABLE_TYPE) {
        descriptors.push(tableCellsSummary(object));
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
      descriptors.push(describeNonDerivedSlot(path, slot, objects));
    }
  }
  for (const derived of schema.derivedSlots) {
    const slot = getSlot(object, derived.path);
    // D-018 requires a `derived`-kind slot at every declared derived path
    // once an object exists; `?? null` is defensive, not an expected case.
    descriptors.push({ path: derived.path, kind: "derived", value: slot?.value ?? null });
  }
  return descriptors;
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
  };
}

/**
 * Renders a slot's VALUE as display text — moved here from `command/
 * commands.ts` at this cycle (D-094 clause 9), which is where `set`'s and
 * `unlink`'s echo lines still call it.
 *
 * Distinct from `formula/eval.ts`'s `describeValueType`, which names a
 * value's TYPE for a `#TYPE` message: this one shows the value itself.
 */
export function describeSlotValue(value: Value): string {
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
