/**
 * address.ts — Addressing scheme and resolver.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.2. Load-bearing per Rule 3.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   Two layers of naming. Objects have opaque, stable, never-reused IDs (obj_7, per
 *   D-002 — the counter itself lives in document.ts, not here). Users write mutable
 *   names (polygon_1). Names resolve to IDs at parse time and stored ASTs hold IDs
 *   only, which is why renaming an object rewrites no formulas.
 *
 *   graph/node.ts does not exist yet (Phase 0, later in this cycle set). Every
 *   function here therefore takes the object list it needs to resolve against as a
 *   plain `readonly AddressableObject[]` parameter, rather than reading a `document`
 *   this module does not own. This mirrors the eventual shape: the resolver reads
 *   document state, it does not own it (STATUS.md gotcha, cycle 0000).
 *
 *   The path a user types and the path a slot is stored under are NOT always the
 *   same string (D-005). The one case specified so far: a table cell is written as
 *   `table_x.A1` but stored as `path: ["cells", "A1"]`, because §5.4 says "each cell
 *   is a slot" and that slot lives under the table's `cells` family, not bare at the
 *   object's root (§5.2's own address table states this explicitly, and §5.1 names
 *   the slot `cells.A1`, not `A1`). `parseAddress`/`formatAddress` apply that mapping
 *   by object `type` — see `toStoredPath`/`toSurfacePath` below. This is a stand-in
 *   for `primitives/schema.ts`, which does not exist yet: when it lands, the mapping
 *   should be driven by the schema's slot declarations rather than a hardcoded
 *   type check here, but the *contract* (surface string vs. stored path can differ)
 *   is settled now and must not be re-litigated per-object-type later.
 *
 * INVARIANTS UPHELD HERE
 *   - A stored Address NEVER contains a user-facing name — it is `{ objectId, path }`
 *     only. Renaming an object never touches a stored Address.
 *   - Address strings are only ever produced by formatAddress(); never concatenated
 *     ad hoc elsewhere.
 *   - `formatAddress` is the exact inverse of `parseAddress`: for every address form
 *     specified in §5.2's table, `formatAddress(parseAddress(s, os), os) === s`.
 *
 * NOT DONE HERE
 *   - Validating that `path` names a slot that actually exists on the object's schema
 *     (e.g. that `A1` is within the table's current bounds, or that `origin` is a
 *     real slot on this object's type). `primitives/schema.ts` does not exist yet;
 *     that check is layered on top of parseAddress in a later cycle, per §5.1's
 *     mutation-loop step 4. What IS done here (D-005) is narrower and structural:
 *     mapping a known type's surface path shape to its stored path shape, not
 *     verifying the resulting slot exists.
 *   - Resolving a BARE cell reference (`A1`, no leading `name.`) — legal only inside
 *     a table cell formula (§5.3), meaning "this table, that cell." That context
 *     (which table) belongs to `formula/parser.ts` (cycle 0031), which calls
 *     `isCellReferenceForm` below to detect the shape and builds the `Address`
 *     directly (there is no name to resolve — the table is already known), then
 *     falls through to `parseAddress` here for every other case (a real `name.path`).
 *   - Dependency extraction, cycle detection, mutation (formula/deps.ts,
 *     graph/cycles.ts, mutation.ts).
 */
import { type ObjectType, TABLE_TYPE } from "./graph/node.ts";

/**
 * The minimal shape address resolution needs from an object: its ID, current name,
 * and type. `type` was added under D-005 — resolving a table's bare cell reference
 * to its stored `cells.*` path requires knowing the object is a table. `type` is
 * `ObjectType`, not bare `string` (D-009, 0004-REVIEW-phase0) — `graph/node.ts`'s
 * `GraphObject` structurally satisfies this interface, so a document's real object
 * list can be passed here directly with no adapter.
 */
export interface AddressableObject {
  readonly id: string;
  readonly name: string;
  readonly type: ObjectType;
}

/**
 * A resolved address. Always `{ objectId, path }` — an ID, never a name. This is the
 * only shape a stored formula AST or binding is allowed to hold (§5.2).
 */
export interface Address {
  readonly objectId: string;
  readonly path: readonly string[];
}

/**
 * The failure shape for parseAddress / formatAddress: the `#REF` arm of
 * `graph/node.ts`'s `ErrorValue` union (§5.1) — an address that cannot be resolved
 * is exactly the situation `#REF` exists to represent. This is a plain data value,
 * not a thrown exception: the evaluation loop must never unwind on a broken
 * reference (§5.1).
 */
export interface AddressError {
  readonly error: "#REF";
  readonly message: string;
}

/** A name-validity or name-availability check that did not throw either way. */
export type NameCheckResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Narrows a `parseAddress`/`formatAddress` result to its `AddressError` arm. Exists
 * so callers (including tests) can discriminate `Address | AddressError` and
 * `string | AddressError` without an `as` cast — a cast would silently accept a
 * result of the wrong shape instead of catching it (L-2, 0002-REVIEW-phase0).
 */
export function isAddressError(value: unknown): value is AddressError {
  return typeof value === "object" && value !== null && "error" in value;
}

/**
 * Naming grammar (§5.2): starts with a letter or underscore, followed by any number
 * of letters, digits, or underscores.
 */
const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * A path segment's grammar is deliberately looser than an object name's: numeric
 * per-vertex indices (`vertex.0.x`, §5.5) and cell references (`cells.A1`, §5.4) are
 * both legal path segments, and neither matches NAME_PATTERN (a segment may start
 * with a digit). Any non-empty run of letters/digits/underscores is accepted; the
 * question of whether a given segment names a real slot is a schema-layer concern
 * (see NOT DONE HERE above).
 */
const PATH_SEGMENT_PATTERN = /^[a-zA-Z0-9_]+$/;

/** Checks a candidate object name against the naming grammar (§5.2). Nothing else. */
export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/**
 * Finds an object by name. Lookup is case-insensitive per §5.2 ("unique across the
 * document, case-insensitive for lookup") — "Table_X" and "table_x" name the same
 * object.
 */
export function findObjectByName(
  name: string,
  objects: readonly AddressableObject[],
): AddressableObject | undefined {
  const target = name.toLowerCase();
  return objects.find((object) => object.name.toLowerCase() === target);
}

/** Finds an object by its stable ID. IDs are compared exactly — case matters, unlike names. */
export function findObjectById(
  id: string,
  objects: readonly AddressableObject[],
): AddressableObject | undefined {
  return objects.find((object) => object.id === id);
}

/**
 * Whether `name` collides with an existing object's name, case-insensitively.
 * `excludeId` lets a rename check ignore the object's own current name.
 */
export function isNameTaken(
  name: string,
  objects: readonly AddressableObject[],
  excludeId?: string,
): boolean {
  const target = name.toLowerCase();
  return objects.some((object) => object.id !== excludeId && object.name.toLowerCase() === target);
}

/**
 * The single gate a create or rename mutation must pass before writing a name
 * (§5.2: unique, case-insensitive, `[a-zA-Z_][a-zA-Z0-9_]*`). Reports which rule
 * failed rather than a bare boolean, because §5.10 requires every rejection to name
 * the specific problem.
 *
 * Rejects: a name that fails the grammar, or a name already taken by another object
 * (case-insensitively). `excludeId` allows checking a rename against everything
 * except the object being renamed.
 */
export function checkNameAvailable(
  name: string,
  objects: readonly AddressableObject[],
  excludeId?: string,
): NameCheckResult {
  if (!isValidName(name)) {
    return {
      ok: false,
      message: `"${name}" is not a valid name — names must match [a-zA-Z_][a-zA-Z0-9_]*`,
    };
  }
  if (isNameTaken(name, objects, excludeId)) {
    return { ok: false, message: `the name "${name}" is already in use` };
  }
  return { ok: true };
}

/**
 * Generates the next default name for a newly created object of a given type
 * (`polygon_1`, `polygon_2`, ...), per §5.2 ("auto-generate defaults on creation").
 *
 * Why it counts up from 1 and re-checks each candidate, rather than counting
 * existing objects of this type and adding one: names can be freed by delete or
 * changed by rename, so "count + 1" can collide (delete polygon_1, then this would
 * suggest polygon_1 again only by accident, or skip past a name that is actually
 * free). Checking each candidate against the live name set is the dumbest correct
 * implementation (Rule 5) and is never wrong.
 */
export function generateDefaultName(typePrefix: string, objects: readonly AddressableObject[]): string {
  let n = 1;
  // Terminates: n grows on every iteration and the name space is infinite, so a
  // free candidate always exists eventually.
  while (true) {
    const candidate = `${typePrefix}_${n}`;
    if (!isNameTaken(candidate, objects)) {
      return candidate;
    }
    n += 1;
  }
}

// TABLE_TYPE ("table") is imported from graph/node.ts, not redeclared here — the
// object type vocabulary is defined exactly once, per D-009 (0004-REVIEW-phase0).
const TABLE_CELL_PATH_PREFIX = "cells";

/**
 * The A1-style cell-reference form (§5.4: "A1-style addressing scoped to the table"):
 * column letters followed by a row number.
 *
 * Uppercase only, deliberately (D-008). Matching case-insensitively here without also
 * normalising would store `table_x.a1` and `table_x.A1` as two DIFFERENT slots for
 * what the user sees as one cell. Normalisation is a table-primitive decision, not an
 * addressing one, so it is deferred to Phase 2 as Q-004. Uppercase-only is the
 * forward-safe choice: every ref the brief writes is uppercase, so adding lowercase
 * acceptance later is purely additive and migrates no stored data.
 */
const CELL_REFERENCE_PATTERN = /^[A-Z]+[0-9]+$/;

/**
 * Whether `segment` has the A1 cell-reference FORM (D-008: key on form, never a
 * structural proxy) — exported so `formula/parser.ts` can detect a BARE cell ref
 * (`A1`, no leading `name.`) using the exact same pattern this file uses for the
 * `table_x.A1` shorthand, rather than keeping a second copy that could drift from
 * this one. This file's own `parseAddress` cannot resolve a bare ref itself — it
 * requires a `name.path`, at least two segments (see `parseAddress`'s own rejection)
 * — because "legal only inside a table cell formula" (§5.3) is a context a plain
 * `input: string` doesn't carry; `parser.ts` supplies that context (which table) and
 * calls this predicate first, falling through to `parseAddress` for every other case.
 * Currently uppercase-only, same interim behaviour as everywhere else this pattern is
 * used (Q-004, still open, deferred to Phase 2) — `parser.ts` inherits that choice
 * rather than making a second one.
 */
export function isCellReferenceForm(segment: string): boolean {
  return CELL_REFERENCE_PATTERN.test(segment);
}

/**
 * Maps a user-typed path to the path a slot is actually stored under (D-005).
 * Identity for every type except `table`, where a single segment in A1 form (`A1`)
 * is shorthand for a `cells.*` slot.
 *
 * The A1-form test matters (D-008): keying on "table + exactly one segment" instead
 * would swallow every future scalar table slot — `table_x.rows`, `table_x.opacity`,
 * even `table_x.cells` itself — into a phantom `cells.<name>` slot that no schema
 * declares. A table path that is already 2+ segments is left alone, so a user typing
 * the stored form directly (`table_x.cells.A1`) is not double-prefixed.
 */
function toStoredPath(type: ObjectType, surfacePath: readonly string[]): readonly string[] {
  const onlySegment = surfacePath.length === 1 ? surfacePath[0] : undefined;
  if (type === TABLE_TYPE && onlySegment !== undefined && CELL_REFERENCE_PATTERN.test(onlySegment)) {
    return [TABLE_CELL_PATH_PREFIX, onlySegment];
  }
  return surfacePath;
}

/**
 * The exact inverse of toStoredPath: strips the `cells` prefix a table's stored
 * path carries, so formatAddress prints the short form the user actually typed
 * (`table_x.A1`, never `table_x.cells.A1`). Identity for every other case.
 *
 * The A1-form test is what makes "exact inverse" literally true rather than
 * approximately true (D-008). It only strips a prefix that toStoredPath could have
 * added: stripping `["cells","rows"]` would print `table_x.rows`, which re-parses to
 * `["rows"]` — a different slot than the one printed.
 */
function toSurfacePath(type: ObjectType, storedPath: readonly string[]): readonly string[] {
  if (type !== TABLE_TYPE || storedPath.length !== 2 || storedPath[0] !== TABLE_CELL_PATH_PREFIX) {
    return storedPath;
  }
  const cellRef = storedPath[1];
  if (cellRef === undefined || !CELL_REFERENCE_PATTERN.test(cellRef)) {
    return storedPath;
  }
  return [cellRef];
}

/**
 * Parses a user-written address string (`table_x.A1`, `polygon_1.origin.x`) into a
 * stored Address — resolving the leading name to an object ID (§5.2) and mapping
 * the typed path to the slot's actual stored path (D-005). This is the only place a
 * name is ever turned into an Address; every other consumer of addresses (formulas,
 * bindings, script ports) MUST funnel through here.
 *
 * Rejects: an empty or malformed string (no path segment, empty segment, a path
 * segment outside PATH_SEGMENT_PATTERN), or a name that does not resolve to any
 * object. Returns a `#REF`-shaped AddressError; NEVER throws — callers that reach
 * this from inside the evaluation loop must not have it unwind (§5.1).
 *
 * Does NOT validate that the resulting stored path names a real slot on the
 * resolved object's schema (e.g. that `A1` is within the table's current bounds) —
 * see NOT DONE HERE above. A caller that needs that stronger guarantee layers it on
 * top of a successful result from this function.
 */
export function parseAddress(input: string, objects: readonly AddressableObject[]): Address | AddressError {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { error: "#REF", message: "empty address" };
  }

  const segments = trimmed.split(".");
  if (segments.some((segment) => segment.length === 0)) {
    return { error: "#REF", message: `malformed address "${input}" — empty segment` };
  }
  if (segments.length < 2) {
    return {
      error: "#REF",
      message: `malformed address "${input}" — expected "name.path", e.g. "table_x.A1"`,
    };
  }

  // Safe: `segments.length >= 2` and no segment is empty (both checked above), so
  // there is always at least one name segment followed by at least one path segment.
  const [namePart, ...pathParts] = segments as [string, ...string[]];
  const badSegment = pathParts.find((segment) => !PATH_SEGMENT_PATTERN.test(segment));
  if (badSegment !== undefined) {
    return {
      error: "#REF",
      message: `malformed address "${input}" — invalid path segment "${badSegment}"`,
    };
  }

  // Deliberately not pre-checked against NAME_PATTERN: no object can exist with an
  // invalid name (checkNameAvailable is the only gate that creates/renames one), so
  // an ungrammatical namePart simply fails lookup below and reports as "no object
  // named" — one failure path instead of two, at the cost of a slightly imprecise
  // message for that one case. (L-4, 0002-REVIEW-phase0.)
  const object = findObjectByName(namePart, objects);
  if (object === undefined) {
    return { error: "#REF", message: `no object named "${namePart}"` };
  }

  return { objectId: object.id, path: toStoredPath(object.type, pathParts) };
}

/**
 * Formats a stored Address back into the string a user should see, by resolving the
 * ID to that object's *current* name (§5.2) and mapping the stored path back to its
 * surface form (D-005) — the exact inverse of parseAddress. This is why renaming is
 * free: the stored Address never changes, only what formatAddress prints for it does.
 *
 * Rejects: an Address whose objectId no longer resolves to any object (the object
 * was deleted out from under a stale reference somewhere the deletion logic missed —
 * see §5.1.1). Returns a `#REF`-shaped AddressError; NEVER throws, for the same
 * reason as parseAddress.
 */
export function formatAddress(address: Address, objects: readonly AddressableObject[]): string | AddressError {
  const object = findObjectById(address.objectId, objects);
  if (object === undefined) {
    return { error: "#REF", message: `no object with id "${address.objectId}"` };
  }
  return [object.name, ...toSurfacePath(object.type, address.path)].join(".");
}
