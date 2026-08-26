/**
 * address.ts — Addressing scheme and resolver.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.2. Load-bearing (§6.2).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   Two layers of naming. Objects have opaque, stable, never-reused IDs (`obj_7`,
 *   D-002 — the counter itself lives in `document.ts`). Users write mutable names
 *   (`polygon_1`). Names resolve to IDs at parse time and stored ASTs hold IDs only,
 *   which is why renaming an object rewrites no formulas.
 *
 *   Every function here takes the object list to resolve against as a plain
 *   `readonly AddressableObject[]`, rather than reading a document this module does
 *   not own: the resolver READS document state, it does not own it.
 *
 *   **The path a user types and the path a slot is stored under are NOT always the
 *   same string (D-005).** The one case specified so far: a table cell is written as
 *   `table_x.A1` but stored as `["cells", "A1"]`, because §5.4 says "each cell is a
 *   slot" and that slot lives under the table's `cells` family, not bare at the
 *   object's root. `parseAddress`/`formatAddress` apply that mapping by object `type`
 *   (`toStoredPath`/`toSurfacePath`). Driving the mapping from `primitives/schema.ts`'s
 *   declarations instead of a type check here would be the tidier home for it, but the
 *   CONTRACT — surface string and stored path can differ — is settled and must not be
 *   re-litigated per object type.
 *
 * INVARIANTS UPHELD HERE
 *   - A stored `Address` NEVER contains a user-facing name — it is `{ objectId, path }`
 *     only. Renaming an object never touches a stored `Address`.
 *   - Address strings are only ever produced by `formatAddress()`, never concatenated
 *     ad hoc elsewhere.
 *   - `formatAddress` is the exact inverse of `parseAddress`: for every address form
 *     in §5.2's table, `formatAddress(parseAddress(s, os), os) === s`.
 *
 * NOT DONE HERE
 *   - Validating that `path` names a slot that actually EXISTS on the object's schema
 *     (that `A1` is within the table's bounds, that `origin` is a real slot on this
 *     type). That is `mutation.ts`'s step-4 job. What IS done here (D-005) is narrower
 *     and structural: mapping a known type's surface path shape to its stored path
 *     shape, not verifying the resulting slot exists.
 *   - Resolving a BARE cell reference (`A1`, no leading `name.`), legal only inside a
 *     table cell formula (§5.3). Which table that is belongs to `formula/parser.ts`,
 *     which calls `isCellReferenceForm` here to detect the shape and builds the
 *     `Address` directly (there is no name to resolve), then falls through to
 *     `parseAddress` for every real `name.path`.
 *   - Dependency extraction, cycle detection, mutation.
 */
import { RESERVED_WORDS } from "./formula/lexer.ts";
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
 * The gate every name a mutation writes is meant to pass (§5.2: unique,
 * case-insensitive, `[a-zA-Z_][a-zA-Z0-9_]*`). Reports which rule failed rather than
 * a bare boolean, because §5.10 requires every rejection to name the specific problem.
 *
 * Rejects: a name that fails the grammar; a name §5.3 lexes as a formula keyword, in
 * ANY case (**D-080**, reading `formula/lexer.ts`'s `RESERVED_WORDS` rather than a
 * second copy of those five strings); or a name already taken by another object
 * (case-insensitively). `excludeId` allows checking a rename against everything except
 * the object being renamed, which is why a rename that only changes CASE is accepted.
 *
 * `mutation.ts`'s `renameObject` passes this gate. **`createObject` does not yet** — a
 * duplicate or ungrammatical name still commits through it, pinned by a test in
 * `mutation.test.ts` and owed to the cycle that builds §5.11's load path (**D-081**).
 * Do not read this function's existence as proof that no document holds a bad name.
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
  // D-080: §5.3 lexes these five words as keywords, so `TRUE.A1` never reaches
  // `parseAddress` at all — an object named one of them can still be listed, renamed
  // and deleted, but no formula and no `link` can ever READ it. Refused in EVERY case,
  // not just the uppercase `formula/lexer.ts` matches, so that accepting lowercase
  // keywords later (which that file's header calls purely additive) cannot break names
  // already saved in a document.
  if (RESERVED_WORDS.has(name.toUpperCase())) {
    return {
      ok: false,
      message: `"${name}" is a reserved word — §5.3 reads ${[...RESERVED_WORDS].join(", ")} as formula keywords in any case, so no formula could reference this object; choose another name`,
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
// Exported so `primitives/table.ts` builds a `["cells", ref]` path
// against the SAME constant this file's own `toStoredPath`/`bareCellAddress` use,
// rather than a second copy of the string `"cells"` — D-010's "declare vocabulary
// once" principle, applied to this literal the same way `TABLE_TYPE` already applies
// it to the type string.
export const TABLE_CELL_PATH_PREFIX = "cells";

/**
 * The A1-style cell-reference form (§5.4: "A1-style addressing scoped to the table"):
 * column letters followed by a row number.
 *
 * Accepts EITHER case (D-039, Q-004 answered by the human 2026-08-23): `a1` and `A1`
 * are both this FORM. Matching case-insensitively here without ALSO normalising would
 * store `table_x.a1` and `table_x.A1` as two DIFFERENT slots for what the user sees as
 * one cell — D-008's own two-slots-for-one-cell hazard, reached from case instead of
 * from a structural proxy. The fix is the same shape D-008 already established:
 * normalisation happens at exactly ONE point, where the stored path is actually built
 * (`toStoredPath` and `bareCellAddress` below, both routed through
 * `normalizeCellReference`), never at this pattern-matching stage and never re-derived
 * at a call site.
 *
 * **Exactly one spelling of a cell is ever stored (D-043).** Two things follow, and
 * both are enforced by this one pattern rather than by callers:
 *   - Either CASE is the same cell (D-039), normalised at the single point below.
 *   - The row is `[1-9][0-9]*` — no leading zeros, no row `0`. `A007` and `A0` are
 *     NOT this form and resolve as ordinary path segments (which name no slot), so
 *     they fail rather than quietly becoming a second `cells.A007` slot beside
 *     `cells.A7`, or a `cells.A0` for a row A1 notation does not have. Tightened at
 *     0041-REVIEW-phase2, where `A007` and `A7` were confirmed to store as two
 *     different slots for one cell — D-008's own two-slots hazard, a third time.
 *
 * The capture groups are load-bearing: `parseCellReference` below `exec`s this SAME
 * pattern rather than keeping a second, near-identical one. One regex, one definition
 * of the form — a second copy is how the predicate and the splitter drift apart.
 */
const CELL_REFERENCE_PATTERN = /^([A-Za-z]+)([1-9][0-9]*)$/;

/**
 * The ONE point a cell reference's case is decided (D-039) — called by both
 * `toStoredPath` and `bareCellAddress`, the only two places that build a cell slot's
 * actual stored path segment. Never called anywhere else; a call site normalising its
 * own copy would be exactly the "two sources of truth" bug D-008/D-039 both exist to
 * prevent.
 */
function normalizeCellReference(cellReference: string): string {
  return cellReference.toUpperCase();
}

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
 * Accepts either case (D-039) — `parser.ts` inherits that from this one pattern rather
 * than making a second decision.
 */
export function isCellReferenceForm(segment: string): boolean {
  return CELL_REFERENCE_PATTERN.test(segment);
}

/**
 * Builds the stored `Address` a BARE cell ref (`A1`) resolves to inside table
 * `tableObjectId` (§5.3: "this table, that cell"). The other half of
 * `isCellReferenceForm` above, and exported for the same reason: `parser.ts` needs the
 * cell path shape this file already owns (`TABLE_CELL_PATH_PREFIX`, D-005's
 * surface-to-stored mapping), and a hand-built `["cells", segment]` at the call site
 * would be a second copy of it, free to drift from `toStoredPath`'s (0032-REVIEW-phase1).
 * A bare ref and the equivalent `table_x.A1` MUST resolve to the same slot — two
 * spellings of one cell resolving to two slots is exactly the hazard Q-004 was raised
 * about. Pinned by a test comparing this against `parseAddress`'s own result.
 *
 * `cellReference` MUST already satisfy `isCellReferenceForm` — the caller checks that
 * (it is what decides this is a bare cell ref at all); this function does not re-check.
 * The reference is normalised to uppercase (D-039) via `normalizeCellReference`, the
 * same single point `toStoredPath` routes through, so `a1` and `A1` typed as bare
 * refs resolve to the identical stored slot `table_x.A1` does.
 */
export function bareCellAddress(tableObjectId: string, cellReference: string): Address {
  return { objectId: tableObjectId, path: [TABLE_CELL_PATH_PREFIX, normalizeCellReference(cellReference)] };
}

// ---------------------------------------------------------------------------
// Column-letter <-> index arithmetic and cell-reference splitting
//
// §5.4's A1 form is bijective base-26 over columns ("Excel" numbering): A=1,
// B=2, ..., Z=26, AA=27, AB=28, .... `address.ts` already owns every other
// cell-reference-FORM concern (the pattern, isCellReferenceForm,
// bareCellAddress), and `CELL_REFERENCE_PATTERN` already admits multi-letter
// columns (D-039's widened form), so this is that same ownership extended one
// step: taking a reference apart / putting one back together, not a new
// concept. `primitives/table.ts` (the table primitive's own domain — default
// dimensions, enumerating a RANGE's rectangle of cells) is the first consumer,
// per D-036 constraint 2's own wording ("lives beside the table primitive or
// in address.ts"). Both directions are pure integer/string arithmetic with no
// document-state or schema dependency, so they are exported standalone here,
// same posture `formula/*`'s Phase 1 files took before Phase 2 wired them in.
// ---------------------------------------------------------------------------

/**
 * Converts a column-letters string (already known to match `[A-Za-z]+`, per
 * `isCellReferenceForm`/`CELL_REFERENCE_PATTERN`) to its 1-based bijective
 * base-26 index: `"A"` -> 1, `"Z"` -> 26, `"AA"` -> 27. Accepts either case —
 * `columnLetters.charCodeAt` is normalised per character rather than requiring
 * the caller to uppercase first, matching D-039's "accept either case" stance
 * generally, though every caller in this codebase happens to pass an
 * already-uppercase string post-D-039 normalisation.
 *
 * Precondition (not re-checked, same posture as `bareCellAddress`): every
 * character is an ASCII letter. A caller MUST validate the form first (e.g.
 * via `isCellReferenceForm`'s pattern, or `parseCellReference` below) — this
 * function has no `#`-shaped failure to return and this file's "never throw"
 * discipline means it cannot fail loudly on bad input, only silently produce
 * a meaningless number. Never called directly on unvalidated user text.
 */
export function columnLettersToIndex(columnLetters: string): number {
  let index = 0;
  for (const char of columnLetters) {
    // 'A'/'a' -> 1: charCodeAt of the uppercased char, minus 'A' (64), plus 1.
    index = index * 26 + (char.toUpperCase().charCodeAt(0) - 64);
  }
  return index;
}

/**
 * The exact inverse of `columnLettersToIndex`: a 1-based column index to its
 * bijective base-26 letters, always uppercase (D-039: exactly one spelling is
 * ever stored or displayed). `index` MUST be a positive integer — same
 * precondition posture as the function above; not re-checked here.
 */
export function indexToColumnLetters(index: number): string {
  let remaining = index;
  let letters = "";
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/** One cell reference split into its column-letters and row-number parts (both halves of the A1 form, §5.4). */
export interface CellCoordinates {
  readonly column: number;
  readonly row: number;
}

/**
 * Splits a cell reference (`"AB12"`) into 1-based `{ column, row }` numbers —
 * the structured form a rectangle-enumeration helper (`primitives/table.ts`)
 * needs; `columnLettersToIndex` handles the column half. `undefined` for
 * anything not matching `CELL_REFERENCE_PATTERN` (D-039's either-case form) —
 * never throws, matching this file's discipline everywhere else.
 */
export function parseCellReference(cellReference: string): CellCoordinates | undefined {
  // The SAME `CELL_REFERENCE_PATTERN` `isCellReferenceForm` tests with, `exec`d for its
  // two capture groups (0041-REVIEW-phase2: this used to carry a second, near-identical
  // regex whose row part was `[0-9]+`, so it split `A007` into row 7 while the stored
  // path kept `A007` — the splitter and the predicate had already drifted).
  const match = CELL_REFERENCE_PATTERN.exec(cellReference);
  const columnLetters = match?.[1];
  const rowDigits = match?.[2];
  if (columnLetters === undefined || rowDigits === undefined) {
    return undefined;
  }
  return { column: columnLettersToIndex(columnLetters), row: Number(rowDigits) };
}

/**
 * The exact inverse of `parseCellReference`: 1-based `{ column, row }` numbers
 * to an A1-form string, always uppercase (D-039). `column`/`row` MUST both be
 * positive integers — not re-checked, same precondition posture as
 * `indexToColumnLetters`.
 */
export function formatCellReference(coordinates: CellCoordinates): string {
  return `${indexToColumnLetters(coordinates.column)}${coordinates.row}`;
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
 *
 * The matched segment is normalised to uppercase (D-039) via `normalizeCellReference`
 * before it becomes part of the stored path — `table_x.a1` and `table_x.A1` both
 * resolve to `{ path: ["cells", "A1"] }`, never to two different slots for one cell.
 */
function toStoredPath(type: ObjectType, surfacePath: readonly string[]): readonly string[] {
  if (type !== TABLE_TYPE) {
    return surfacePath;
  }
  const onlySegment = surfacePath.length === 1 ? surfacePath[0] : undefined;
  if (onlySegment !== undefined && CELL_REFERENCE_PATTERN.test(onlySegment)) {
    return [TABLE_CELL_PATH_PREFIX, normalizeCellReference(onlySegment)];
  }
  // The already-written stored form (`table_x.cells.a1`) is normalised too (D-043,
  // 0041-REVIEW-phase2). The shorthand above was the only path routed through
  // `normalizeCellReference`, so typing the two-segment form — which this file
  // explicitly supports, see the comment above — stored `cells.a1` beside the
  // `cells.A1` that `table_x.a1` produced: two slots for one cell, which is the exact
  // failure D-039 was ruled to prevent. Same form test, same single normalisation
  // point; no prefix is added here, so D-008's `toSurfacePath` inverse is untouched.
  const [prefix, cellReference] = surfacePath;
  if (surfacePath.length === 2 && prefix === TABLE_CELL_PATH_PREFIX && cellReference !== undefined && CELL_REFERENCE_PATTERN.test(cellReference)) {
    return [TABLE_CELL_PATH_PREFIX, normalizeCellReference(cellReference)];
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

  // Deliberately not pre-checked against NAME_PATTERN: an ungrammatical namePart
  // simply fails the lookup below and reports as "no object named" — one failure path
  // instead of two, at the cost of a slightly imprecise message for that one case.
  // (L-4, 0002-REVIEW-phase0.) The message stays imprecise rather than WRONG even for
  // a document that really does hold an ungrammatical name — which `createObject` can
  // still commit (see `checkNameAvailable`, D-081) — because such a name is looked up
  // like any other and simply matches or does not.
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
