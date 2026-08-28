/**
 * table.ts — Table primitive: default dimensions, current-extent cell enumeration
 * (the dynamic slot family), range-rectangle enumeration, and row/column resize.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.4 — "Default 8×8", the `rows`/`cols` dimension slots,
 * "rows and columns can be added or removed", and the reference-repair half of
 * §5.1.1 for a deleted line. Also the DYNAMIC SLOT FAMILY mechanism D-017 called for
 * and the range-enumeration helper D-036 asked for, bounded per D-044.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   `DEFAULT_TABLE_ROWS`/`DEFAULT_TABLE_COLS` — §5.4's "Default 8×8", as plain
 *   constants; `command/parser.ts` applies them when a `table` command omits
 *   `rows`/`cols`, and nothing in this file writes them anywhere.
 *
 *   `TABLE_ROWS_PATH`/`TABLE_COLS_PATH` — the two ordinary, fixed, literal slot paths
 *   holding a table's current row/column count, declared as a `static` group in
 *   `TABLE_SCHEMA` (`primitives/schema.ts`). Named after the brief's own command-line
 *   words (§5.10: `table x=0 y=0 rows=8 cols=8`) rather than inventing a second pair
 *   of words for the same idea — a disclosed, reversible naming choice.
 *
 *   `enumerateRangeCellAddresses(start, end, tableObject)` — expands a `RangeNode`
 *   endpoint pair into every cell `Address` in the rectangle between them, inclusive,
 *   row-major, BOUNDED by the object's current `rows`/`cols` (D-044). Called by
 *   `graph/eval.ts` (for values) and `mutation.ts`'s `deriveEdges` (for edges), so
 *   both agree by construction. Order is deterministic but not otherwise meaningful —
 *   every brief-specified aggregate is order-independent, so nothing downstream may
 *   depend on it beyond determinism.
 *
 *   WHY IT IS BOUNDED (D-044, reversing cycle 0040's original stance): a range expands
 *   at EDGE DERIVATION time, so an unbounded expansion would make `deriveEdges`
 *   produce edges pointing at slots that do not exist — a dangling edge a later
 *   evaluation-time `#REF` cannot repair, because the edge was already built. Cells
 *   outside the extent are OMITTED, never reported as `#REF`. Bounding is also what
 *   keeps `A1:ZZ999999` a bounded loop rather than a millions-of-paths hazard.
 *
 *   A range whose endpoints name DIFFERENT objects is rejected here with a
 *   `RangeEnumerationError` — but this is the DEFENSIVE arm only: the reachable case
 *   (an authored formula) is rejected at PARSE time by D-045, since which objects two
 *   endpoints name is decidable from the formula text alone. §5.4 frames a table as
 *   "a self-contained grid... without being regions of one giant sheet", and rows and
 *   columns of DIFFERENT tables are not comparable quantities, so there is no coherent
 *   rectangle to enumerate.
 *
 *   `enumerateTableCellSlotPaths(object)` — the `dynamic` `NonDerivedSlotPathGroup`
 *   enumerator `TABLE_SCHEMA` supplies for the `cells.*` family. Reads the dimension
 *   slots off the object and GENERATES every `["cells", ref]` path for `1..rows ×
 *   1..cols`. Deliberately NOT "read the object's actual `cells.*` keys and recover
 *   their paths": D-010 forbids inverting a `slotKey` even where it would happen to be
 *   safe, so the only sanctioned way to get a concrete PATH is to generate candidates
 *   from known state and look each one up.
 *
 *   `getTableDimensions` / `isTableDimensionResizable` — both dimension reads route
 *   through one `literal`-kind-only `readTableDimension` (**D-046**). That clause is a
 *   RULE 6 GUARD, not a tidy-up: a `formula` dimension slot would let EVALUATION
 *   resize the declared cell family, because a formula slot's value is written at §5.1
 *   step 7 — after edge derivation (step 3) and `validateIntegrity` (step 4) have
 *   already run. A missing or malformed dimension reads as `0` rather than throwing or
 *   guessing; `isTableDimensionResizable` is what lets `mutation.ts` REJECT a resize
 *   against an unreadable dimension instead of silently resizing from that fail-safe
 *   `0` and destroying every existing cell along the way.
 *
 *   `insertTableLine` / `deleteTableLine` — §5.4's two resize primitives, plus the
 *   address adjustment each implies: `shiftCellAddressForInsert` for insertion,
 *   `repairCellAddressForDelete`/`repairRangeEndpointsForDelete` for deletion. Cell
 *   slots and formula references shift through the SAME arithmetic, so the two can
 *   never disagree about whether line N moved. An inserted line gets no cell slots at
 *   all — an in-extent cell with no slot is the ordinary legal "empty" case (D-047),
 *   which is what makes insertion buildable without inventing a placeholder value.
 *   `insertTableLine` builds its new `slots` starting from `object.slots` in full,
 *   never from scratch (**D-049**), so it cannot drop a slot it does not own.
 *
 *   DELETION IS THE ASYMMETRIC ONE and the first real use of §5.1.1's REPAIR path in
 *   this codebase: it can ORPHAN a reference where insertion structurally cannot, so
 *   an address naming the removed line cannot simply shift — it becomes `#REF` (a
 *   plain reference, D-028) or clamps to the surviving extent (a range endpoint,
 *   §5.4). This file supplies the two callbacks `formula/deps.ts`'s
 *   `repairAddressesInAst` needs and has no notion of `FormulaAst` shapes itself,
 *   mirroring the insert side's separation exactly.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. `enumerateRangeCellAddresses` returns a typed
 *     `RangeEnumerationError` (`#REF`) for both failure modes — cross-object endpoints
 *     and a malformed/non-cell-shaped endpoint path (§5.1: errors never throw across
 *     the evaluation loop).
 *   - Every address is built through `address.ts`'s `TABLE_CELL_PATH_PREFIX` and
 *     `formatCellReference` — never a hand-built `["cells", ...]` array, never a
 *     re-derived column-arithmetic step (D-010; D-039's "normalisation happens at
 *     exactly one point").
 *   - No `slotKey` is ever inverted (D-010).
 *
 * NOT DONE HERE
 *   - **A raw `setSlot` lowering `rows`/`cols` does not remove the now-out-of-bounds
 *     cell slots it strands.** `MIN_TABLE_LINES`/`MAX_TABLE_LINES` below bound the KIND
 *     and RANGE a dimension write may commit (`mutation.ts`'s `findInvalidDimensionWrites`,
 *     **D-097**) — that closes "a formula/0/negative/non-integer dimension makes the
 *     table vanish," not "a stranded cell beyond the new extent." A stranded slot is
 *     simply invisible to `enumerateTableCellSlotPaths` (D-047's absent/empty
 *     equivalence), not a defect; `insertTableLine`/`deleteTableLine`, not a bare
 *     `setSlot`, remain the sanctioned way to add or remove an actual cell.
 *   - A table-creation command (`table x=0 y=0 rows=8 cols=8`, §5.10) — Phase 3.
 *     `createObject` already suffices to build one by hand (every test fixture does)
 *     and `command/parser.ts` reads the line; what is missing is the handler between
 *     those two, not an engine primitive.
 */
import { type Address, formatCellReference, parseCellReference, TABLE_CELL_PATH_PREFIX } from "../address.ts";
import { getSlot, slotKey, type GraphObject, type Slot } from "../graph/node.ts";

/**
 * The bounds a `rows`/`cols` write must fall inside to stay `readTableDimension`-
 * readable — a table with zero lines has no cells and cannot be drawn, so the
 * floor is 1, not 0. Provisional numbers, D-070's own reviewer pick, the human may
 * overrule without disturbing anything else here. **Moved from `command/commands.ts`
 * by D-097 clause 3**: `engine/` may not import `command/`, and `mutation.ts`'s
 * write-time bound (`findInvalidDimensionWrites`) needs them beside the primitive
 * they describe. `commands.ts`'s creation-time check (`createTable`) imports them
 * from here now — one declaration, two readers (D-010).
 */
export const MIN_TABLE_LINES = 1;
export const MAX_TABLE_LINES = 1000;

/** §5.4: "Default 8×8." `command/parser.ts` applies these when a `table` command omits `rows`/`cols`; nothing in this file writes them anywhere. */
export const DEFAULT_TABLE_ROWS = 8;
export const DEFAULT_TABLE_COLS = 8;

/**
 * The failure shape for `enumerateRangeCellPaths` — the `#REF` arm of
 * `graph/node.ts`'s `ErrorValue` union (§5.1), same code `formula/eval.ts`
 * already returns for an unresolved reference. Declared fresh here rather than
 * imported, following `address.ts`'s `AddressError` / `formula/parser.ts`'s
 * `ParseError` precedent: additively widenable, no import coupling to a type
 * this file's callers have no other reason to depend on.
 */
export interface RangeEnumerationError {
  readonly error: "#REF";
  readonly message: string;
}

/**
 * Narrows `enumerateRangeCellAddresses`'s result to its error arm. A plain
 * `Array.isArray` check does not reliably narrow a `ReadonlyArray`-flavoured
 * union under this project's TS config — the same reason `formula/parser.ts`'s
 * `isLexError` exists as an explicit predicate rather than an inline check.
 */
export function isRangeEnumerationError(
  result: readonly Address[] | RangeEnumerationError,
): result is RangeEnumerationError {
  return !Array.isArray(result);
}

/**
 * Reads a stored cell `Address`'s path (`["cells", "A1"]`) back into
 * `{ column, row }` coordinates, or `undefined` if the path is not that shape
 * at all — a defensive check, not a bounds check (see file header): this
 * rejects a MALFORMED address (wrong prefix, wrong length, an unparseable
 * second segment), never a well-formed one that merely names a cell outside
 * the table's current extent. Exported as of entry 0047 for
 * `shiftCellAddressForInsert` below, and for `mutation.ts`'s reference-
 * adjustment pass to reuse rather than re-deriving the same shape check.
 */
export function cellAddressToCoordinates(address: Address): { readonly column: number; readonly row: number } | undefined {
  if (address.path.length !== 2 || address.path[0] !== TABLE_CELL_PATH_PREFIX) {
    return undefined;
  }
  const cellReference = address.path[1];
  if (cellReference === undefined) {
    return undefined;
  }
  return parseCellReference(cellReference);
}

/**
 * Expands a range's two endpoint `Address`es into every cell `Address` in the
 * inclusive rectangle between them (§5.3/§5.4), BOUNDED by `tableObject`'s
 * CURRENT `rows`/`cols` extent (**D-044**). Returns `Address[]`, not bare
 * paths: both consumers (`mutation.ts`'s `deriveEdges`, `graph/eval.ts`'s
 * range-value lookup) need a full `Address` — `{ objectId: start.objectId,
 * path }` — to
 * build an `Edge` or a `read` lookup key, and building that pair at both call
 * sites would be the exact kind of small duplication D-010's "declare once"
 * principle argues against; this file already knows `start.objectId` is the
 * right one (the cross-object check below), so it is the one place that
 * pairing should happen.
 *
 * Row-major order (file header), same as before. Cells OUTSIDE the current
 * extent are OMITTED, not reported as `#REF` (D-044 point 2) — `maxRow`/
 * `maxColumn` are clamped to `tableObject`'s current `rows`/`cols` before the
 * loop runs, so `SUM(A1:A100)` over an 8-row table sums only the 8 rows that
 * exist, and a range entirely beyond the table's extent clamps to an EMPTY
 * result (`minRow > clampedMaxRow`) rather than an error — `functions.ts`'s
 * own existing zero-argument behaviour decides what an aggregate does with
 * that (D-044 point 2: "do not invent a new error path for it"). Clamping
 * here is also what keeps `A1:ZZ999999` a bounded loop (D-044 point 3) rather
 * than the millions-of-paths hazard the pre-D-044 shape had.
 *
 * Dimensions are read via `readTableDimension` below — the SAME
 * `literal`-kind-only guard **D-046** requires of `enumerateTableCellSlotPaths`,
 * for the identical Rule 6 reason: a `formula`-kind `rows`/`cols` slot's value
 * is written at evaluation time (§5.1 step 7), after edge derivation (step 3)
 * has already used this function to decide which cells a range depends on —
 * honouring a formula-computed dimension here would let evaluation change
 * what a PRIOR step already decided, the exact hazard D-046 closed for the
 * cell family. A non-`literal` (or missing, or malformed) dimension reads as
 * `0`, same fail-safe answer `readTableDimension` already gives everywhere
 * else — see its own doc comment.
 *
 * Rejects: `start`/`end` naming different objects (D-045's defensive arm —
 * the reachable case is now rejected at PARSE time, `formula/parser.ts`'s
 * `validateRangePlacement`; this stays as the backstop for a hand-built or
 * loaded AST), or either endpoint not being a well-formed cell address
 * (`cellAddressToCoordinates` above). Never throws.
 */
export function enumerateRangeCellAddresses(
  start: Address,
  end: Address,
  tableObject: GraphObject,
): readonly Address[] | RangeEnumerationError {
  if (start.objectId !== end.objectId) {
    return {
      error: "#REF",
      message: "a range's two endpoints must be cells in the same table",
    };
  }

  const startCoordinates = cellAddressToCoordinates(start);
  const endCoordinates = cellAddressToCoordinates(end);
  if (startCoordinates === undefined || endCoordinates === undefined) {
    return {
      error: "#REF",
      message: "a range endpoint is not a table cell address",
    };
  }

  // D-046: a non-literal (formula-kind) dimension reads as 0 — see this
  // function's own doc comment and readTableDimension's, below.
  const rows = readTableDimension(tableObject, TABLE_ROWS_PATH);
  const cols = readTableDimension(tableObject, TABLE_COLS_PATH);

  const minRow = Math.min(startCoordinates.row, endCoordinates.row);
  const maxRow = Math.min(Math.max(startCoordinates.row, endCoordinates.row), rows); // D-044: clamped.
  const minColumn = Math.min(startCoordinates.column, endCoordinates.column);
  const maxColumn = Math.min(Math.max(startCoordinates.column, endCoordinates.column), cols); // D-044: clamped.

  const addresses: Address[] = [];
  // Row-major: every column of one row before moving to the next (file header).
  // If minRow > maxRow (or minColumn > maxColumn) — the whole range clamped
  // away — this loop simply produces nothing (D-044 point 2).
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      addresses.push({ objectId: start.objectId, path: [TABLE_CELL_PATH_PREFIX, formatCellReference({ column, row })] });
    }
  }
  return addresses;
}

// ---------------------------------------------------------------------------
// The dynamic slot family (cycle after 0040; 0041-REVIEW-phase2 §9's critical
// path): a table's current CELL EXTENT, not a range's two endpoints. See the
// file header's WHAT THIS IS for why this generates candidate paths from known
// dimension slots rather than ever inverting a `slotKey` back into a path.
// ---------------------------------------------------------------------------

/**
 * The stored path of a table's current ROW count — an ORDINARY literal slot,
 * declared as a plain `static` `NonDerivedSlotPathGroup` entry in
 * `primitives/schema.ts`'s `TABLE_SCHEMA`, the same mechanism `value`'s one
 * slot already uses. Named after §5.10's own command-line word (`rows=8`).
 */
export const TABLE_ROWS_PATH: readonly string[] = ["rows"];

/** The stored path of a table's current COLUMN count. See `TABLE_ROWS_PATH`. */
export const TABLE_COLS_PATH: readonly string[] = ["cols"];

/**
 * Reads one of `TABLE_ROWS_PATH`/`TABLE_COLS_PATH` off `object`'s own slots —
 * an ordinary forward lookup (`graph/node.ts`'s `getSlot`), never an inversion
 * of anything. `0` for anything that is not a `literal` slot holding a
 * non-negative integer: missing entirely (a table a creation command never
 * built — a load, or a raw `setSlot`), a NON-LITERAL slot kind (`formula`/`derived` — D-046,
 * the Rule 6 guard; see the body comment for why this is the load-bearing
 * clause, not a tidy-up), or a value that is not a `number` at all — this function
 * must never throw and has no `#`-shaped failure to report (it runs during
 * edge derivation, §5.1 step 3, BEFORE `validateIntegrity`'s own checks have
 * had a chance to reject a malformed document), so it fails to the SAFEST
 * empty answer — zero rows/columns means `enumerateTableCellSlotPaths` below
 * declares NO cells for this object, which is what makes an actually-present
 * formula/derived cell slot on a malformed table get caught by
 * `mutation.ts`'s D-017 check (`findUndeclaredFormulaOrDerivedSlots`) as
 * undeclared, rather than this function silently guessing a dimension and
 * hiding the malformed document instead.
 */
function readTableDimension(object: GraphObject, path: readonly string[]): number {
  const slot = getSlot(object, path);
  // RULE 6, and the whole reason this reads `kind` and not just `value`
  // (0043-REVIEW finding 1, D-046): a dimension slot MUST be `literal`. A
  // `formula` slot's `value` is written by EVALUATION (§5.1 step 7), which runs
  // AFTER edge derivation (step 3) and `validateIntegrity` (step 4) — so
  // honouring one here would make the declared cell family a function of an
  // evaluated value, letting EVALUATION grow or shrink the slot set. Rule 6
  // forbids exactly that ("Evaluation never creates or destroys slots"), and
  // the brief names table resizing as one of the specs "shaped specifically to
  // preserve it." Demonstrated before this guard existed: a table whose `rows`
  // was a formula committed with `ok: true` and then failed its OWN
  // `validateIntegrity` on the very next pass.
  //
  // Reading a non-literal dimension as `0` is the SAME fail-closed answer this
  // function already gives a malformed one, and it lands in the same loud
  // place — zero cells declared means D-017's check rejects any formula/derived
  // cell the object actually carries, rather than this file guessing.
  if (slot === undefined || slot.kind !== "literal") {
    return 0;
  }
  if (typeof slot.value !== "number" || !Number.isInteger(slot.value) || slot.value < 0) {
    return 0;
  }
  return slot.value;
}

/**
 * The `dynamic` `NonDerivedSlotPathGroup.enumerate` function `TABLE_SCHEMA`
 * (`primitives/schema.ts`) supplies for a table's `cells.*` family — THE
 * dynamic-slot-family mechanism D-017/0041-REVIEW-phase2 §9 named as Phase 2's
 * critical path. Generates every `["cells", ref]` path for the object's
 * CURRENT `1..rows × 1..cols` extent (read via `readTableDimension` above),
 * row-major (matching `enumerateRangeCellPaths`'s own convention, though this
 * is a DIFFERENT operation — the table's WHOLE extent, not a range's two
 * endpoints — and does not call that function).
 *
 * Called by `mutation.ts`'s `deriveEdges`/`findUndeclaredFormulaOrDerivedSlots`/
 * `findSchemaSlotKindMismatches` — the SAME resolved list every time, per
 * object, so the three checks and edge derivation can never disagree about
 * which cell paths are currently declared (see `primitives/schema.ts`'s
 * `resolveNonDerivedSlotPaths` for why this must be the ONE place that
 * decision is made, not re-derived at each call site).
 *
 * Never throws: `readTableDimension` never throws, and this function only
 * loops and calls `formatCellReference` (pure string/integer arithmetic) —
 * `rows`/`cols` of `0` simply produce zero paths, which is the correct,
 * empty answer for a table with no declared dimensions yet, not an error.
 */
export function enumerateTableCellSlotPaths(object: GraphObject): readonly (readonly string[])[] {
  const rows = readTableDimension(object, TABLE_ROWS_PATH);
  const cols = readTableDimension(object, TABLE_COLS_PATH);

  const paths: (readonly string[])[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= cols; column += 1) {
      paths.push([TABLE_CELL_PATH_PREFIX, formatCellReference({ column, row })]);
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Row/column INSERTION (entry 0047; §5.4's "rows and columns can be added or
// removed" and the reference-adjustment pass it requires). Deletion, the
// REPAIR path, and the `force` flag are DELIBERATELY NOT built here — see the
// file header's NOT DONE HERE and STATUS.md's next slice.
// ---------------------------------------------------------------------------

/** `getTableDimensions`'s return shape — the same pair `readTableDimension` reads, bundled for a caller that needs both. */
export interface TableDimensions {
  readonly rows: number;
  readonly cols: number;
}

/**
 * The public, `literal`-only-safe (D-046) way for `mutation.ts` to read a
 * table's current `rows`/`cols` without a second, hand-rolled copy of
 * `readTableDimension`'s guard. Same fail-safe-to-`0` behaviour as every
 * other reader of these two slots in this file — see `readTableDimension`'s
 * own doc comment.
 */
export function getTableDimensions(object: GraphObject): TableDimensions {
  return {
    rows: readTableDimension(object, TABLE_ROWS_PATH),
    cols: readTableDimension(object, TABLE_COLS_PATH),
  };
}

/**
 * `mutation.ts`'s `findInvalidTableResizes` (0048-REVIEW-phase2 fix 3, D-046)
 * asks a narrower question than `readTableDimension` answers: not "how many
 * rows does this table currently have" but "CAN this dimension be resized at
 * all." `true` for an ABSENT dimension slot (a table a creation command never
 * built — a load, or a raw `setSlot`) or a
 * `literal`-kind one; `false` ONLY when the slot is PRESENT and NOT `literal`
 * (a `formula`/`derived` dimension) — the one case `readTableDimension`
 * reads as a fail-safe `0` (D-046) rather than the table's real extent, which
 * is exactly what let `insertTableLine` silently reset such a dimension to
 * `literal 1` before this fix (0048-REVIEW §4 case 3).
 */
export function isTableDimensionResizable(object: GraphObject, axis: "row" | "column"): boolean {
  const slot = getSlot(object, axis === "row" ? TABLE_ROWS_PATH : TABLE_COLS_PATH);
  return slot === undefined || slot.kind === "literal";
}

/**
 * Excel-style insertion (§5.4): given a table's CURRENT extent, returns the
 * new `{ column, row }` an existing cell address should occupy after a row or
 * column is inserted at `index` (1-based; the NEW line occupies `index`,
 * every existing line at or after it shifts by one) — or the SAME coordinates
 * unchanged if this cell is entirely before the insertion point. This is the
 * ONE place the shift arithmetic lives; both `insertTableLine` below (moving
 * a cell's SLOT) and `mutation.ts`'s reference-adjustment pass (moving what a
 * FORMULA's address points AT) call this, so the two can never disagree about
 * where row 5 goes when a row is inserted at index 3 (D-010's "declare it
 * once" principle, applied to this new piece of arithmetic the same way it
 * already applies to cell-reference formatting/parsing).
 */
function shiftCoordinates(
  coordinates: { readonly column: number; readonly row: number },
  axis: "row" | "column",
  index: number,
): { readonly column: number; readonly row: number } {
  if (axis === "row" && coordinates.row >= index) {
    return { column: coordinates.column, row: coordinates.row + 1 };
  }
  if (axis === "column" && coordinates.column >= index) {
    return { column: coordinates.column + 1, row: coordinates.row };
  }
  return coordinates;
}

/**
 * Shifts ONE stored `Address` for §5.4's reference-adjustment pass, if and
 * only if it names a cell on `tableId` — every other address (a different
 * object, or a non-cell path on the SAME table, e.g. `table_x.rows` itself)
 * is returned completely UNCHANGED. `mutation.ts` calls this once per
 * `ReferenceNode`/`RangeNode` endpoint address in the ENTIRE document
 * (`formula/deps.ts`'s `rewriteAddressesInAst`), so it must stay generic over
 * "is this address even relevant to this insertion" rather than assuming its
 * caller already filtered — the same defensive stance `enumerateRangeCellAddresses`
 * already takes for a malformed endpoint.
 */
export function shiftCellAddressForInsert(address: Address, tableId: string, axis: "row" | "column", index: number): Address {
  if (address.objectId !== tableId) {
    return address;
  }
  const coordinates = cellAddressToCoordinates(address);
  if (coordinates === undefined) {
    return address; // Not a cell address at all (e.g. `rows`/`cols` themselves) — nothing to shift.
  }
  const shifted = shiftCoordinates(coordinates, axis, index);
  if (shifted.row === coordinates.row && shifted.column === coordinates.column) {
    return address; // Entirely before the insertion point — unchanged, same reference identity.
  }
  return { objectId: address.objectId, path: [TABLE_CELL_PATH_PREFIX, formatCellReference(shifted)] };
}

/**
 * Returns a NEW table `GraphObject` with a row or column inserted at `index`
 * (clamped to `1..currentExtent+1` — see below): the relevant dimension slot
 * increments by one, and every EXISTING populated cell at or after `index`
 * moves to its shifted position via `shiftCoordinates` above. The newly
 * inserted line's cells get NO slots at all — an empty row/column is exactly
 * the ordinary, D-047-legal "no slot within the extent" case (0045-REVIEW's
 * whole point: this is what makes insertion safe to build at all), so there
 * is nothing to populate.
 *
 * Reads the CURRENT cell set via `enumerateTableCellSlotPaths` — the ONE
 * sanctioned way to enumerate a table's candidate cell paths (D-010: never
 * invert a `slotKey`) — and does a plain forward `getSlot`/`slotKey` lookup
 * per candidate, exactly the pattern that function's own doc comment
 * establishes. Builds a WHOLE NEW `slots` record rather than mutating
 * `object.slots` in place (Rule 2: every field is `readonly`).
 *
 * `index` is CLAMPED, not rejected, to `1..currentCount+1` — this function is
 * the DEFENSIVE arm; the PRIMARY validation (a clear rejection message naming
 * the out-of-range index) is `mutation.ts`'s `findInvalidTableResizes`, which
 * runs before this is ever called, mirroring the same primary-validation/
 * defensive-arm split D-045 already established for range placement. Both
 * `rows` and `cols` are (re)written as `literal` — safe unconditionally as of
 * 0048-REVIEW-phase2 fix 3: `findInvalidTableResizes` now REJECTS any insert
 * whose `rows`/`cols` slot is present and not already `literal` (D-046,
 * `isTableDimensionResizable` above) before this function is ever reached, so
 * re-asserting `literal` here confirms an invariant the precondition just
 * guaranteed, never silently overwrites a different kind.
 *
 * **D-049 (0048-REVIEW-phase2 fix 1).** Builds the new `slots` record by
 * starting from `object.slots` IN FULL — never a fresh record assembled from
 * only the paths this function happens to know about. Only the CURRENT
 * extent's cell keys (`enumerateTableCellSlotPaths`) are removed, and each
 * only because it is about to be re-written at its shifted position; every
 * other slot on the object (a literal at an unrecognised path, a cell OUTSIDE
 * the current extent, a future `origin.x`) is carried through completely
 * untouched. Before this fix, the record was rebuilt from exactly `rows`,
 * `cols`, and the in-extent cells, which silently DELETED everything else —
 * see D-049's ruling in `DECISIONS.md` for the three reachable ways that bit,
 * verified at review.
 */
export function insertTableLine(object: GraphObject, axis: "row" | "column", index: number): GraphObject {
  const { rows, cols } = getTableDimensions(object);
  const bound = axis === "row" ? rows : cols;
  const clampedIndex = Math.max(1, Math.min(index, bound + 1));

  // D-049: start from every slot this object already carries — nothing not
  // named below is ever removed.
  const newSlots: Record<string, Slot> = { ...object.slots };
  newSlots[slotKey(TABLE_ROWS_PATH)] = { kind: "literal", value: axis === "row" ? rows + 1 : rows };
  newSlots[slotKey(TABLE_COLS_PATH)] = { kind: "literal", value: axis === "column" ? cols + 1 : cols };

  const shiftedCells: Record<string, Slot> = {};
  for (const path of enumerateTableCellSlotPaths(object)) {
    const slot = getSlot(object, path);
    if (slot === undefined) {
      continue; // No slot at this candidate cell — nothing to move (D-047: already legally empty).
    }
    delete newSlots[slotKey(path)]; // Only an in-extent cell actually being MOVED is removed here — D-049.
    const cellReference = path[1]; // enumerateTableCellSlotPaths always yields [TABLE_CELL_PATH_PREFIX, ref].
    const coordinates = cellReference === undefined ? undefined : parseCellReference(cellReference);
    if (coordinates === undefined) {
      continue; // Defensive only — cannot actually happen for a path this file just generated.
    }
    const shifted = shiftCoordinates(coordinates, axis, clampedIndex);
    shiftedCells[slotKey([TABLE_CELL_PATH_PREFIX, formatCellReference(shifted)])] = slot;
  }
  Object.assign(newSlots, shiftedCells);

  return { ...object, slots: newSlots };
}

// ---------------------------------------------------------------------------
// Row/column DELETION (entry 0050; §5.4's other half of "rows and columns can
// be added or removed" — and the FIRST real use of §5.1.1's REPAIR path
// anywhere in this codebase). Mirrors insertion's shape wherever the two are
// symmetric (D-051's shared shift-arithmetic lineage) and diverges only where
// deletion's ability to ORPHAN a reference forces it to: an address naming the
// removed line cannot simply shift, it must become `#REF` (a plain reference,
// D-028) or clamp to the surviving extent (a range endpoint, §5.4) — decisions
// this file makes and hands to `formula/deps.ts`'s node-level
// `repairAddressesInAst` as plain data (`Address | "deleted"`), never by
// constructing an `ErrorNode` here: this file has no notion of `FormulaAst`
// shapes, matching the separation the insert side already keeps.
// ---------------------------------------------------------------------------

/**
 * The delete-side counterpart to `shiftCoordinates`: given a cell's CURRENT
 * coordinates and the row/column being removed at `index`, returns the
 * literal string `"deleted"` if this cell's own row/column IS the one being
 * removed, or the shifted coordinates otherwise — unchanged if entirely
 * before `index`, moved back by one if entirely after it. The mirror image of
 * insertion's "at or after shifts by one," except delete's boundary is
 * strictly `>` (not `>=`): the line AT `index` no longer exists at all, unlike
 * insertion's new line, which occupies `index`. D-051: this arithmetic joins
 * `shiftCoordinates` in this file rather than living anywhere else.
 */
function shiftCoordinatesForDelete(
  coordinates: { readonly column: number; readonly row: number },
  axis: "row" | "column",
  index: number,
): { readonly column: number; readonly row: number } | "deleted" {
  const value = axis === "row" ? coordinates.row : coordinates.column;
  if (value === index) {
    return "deleted";
  }
  if (value > index) {
    return axis === "row"
      ? { column: coordinates.column, row: coordinates.row - 1 }
      : { column: coordinates.column - 1, row: coordinates.row };
  }
  return coordinates;
}

/**
 * Shifts (or reports the deletion of) ONE stored cell `Address` for §5.4's
 * reference-adjustment pass on a DELETION — the delete-side sibling of
 * `shiftCellAddressForInsert`. Any address not on `tableId`, or not a cell
 * address at all, is returned completely UNCHANGED (same defensive stance as
 * the insert-side function — e.g. `rows`/`cols` themselves, or a reference
 * into a different table). Returns the literal string `"deleted"` — never an
 * `ErrorNode` itself — for `formula/deps.ts`'s `repairAddressesInAst` to turn
 * into one; this file stays blind to `FormulaAst` shapes, mirroring
 * `shiftCellAddressForInsert`'s own separation.
 */
export function repairCellAddressForDelete(address: Address, tableId: string, axis: "row" | "column", index: number): Address | "deleted" {
  if (address.objectId !== tableId) {
    return address;
  }
  const coordinates = cellAddressToCoordinates(address);
  if (coordinates === undefined) {
    return address; // Not a cell address at all (e.g. `rows`/`cols` themselves) — nothing to repair.
  }
  const shifted = shiftCoordinatesForDelete(coordinates, axis, index);
  if (shifted === "deleted") {
    return "deleted";
  }
  if (shifted.row === coordinates.row && shifted.column === coordinates.column) {
    return address; // Entirely before the deleted line — unchanged, same reference identity.
  }
  return { objectId: address.objectId, path: [TABLE_CELL_PATH_PREFIX, formatCellReference(shifted)] };
}

/**
 * One range endpoint's new coordinate along the axis being deleted, given the
 * OTHER endpoint's coordinate along the SAME axis — the tie-break §5.4's
 * "clamps to the remaining extent" needs when THIS endpoint's own line is the
 * one deleted. `thisValue === index` can mean one of two things depending on
 * which SIDE of the range this endpoint is on, and role is decided by VALUE
 * against the other endpoint, never by which AST field ("start"/"end") this
 * endpoint happens to occupy — a `RangeNode`'s two fields carry no min/max
 * guarantee (a user may legally write `A5:A1`):
 *
 *   - `otherValue > index`: this endpoint is the range's LOWER bound. The
 *     deleted line's successor (`index + 1`) becomes the new lower bound, and
 *     that successor shifts DOWN to `index` under deletion — so the new value
 *     is `index` itself, numerically unchanged.
 *   - `otherValue < index`: this endpoint is the range's UPPER bound. The
 *     deleted line's predecessor (`index - 1`) becomes the new upper bound,
 *     unaffected by the shift (it was already before `index`) — so the new
 *     value is `index - 1`.
 *   - `otherValue === index` too: both endpoints name the deleted line —
 *     handled by the CALLER before this function is ever reached (the whole
 *     range is deleted, §5.4's other clause); never called with this case.
 */
function clampRangeEndpointValue(thisValue: number, otherValue: number, index: number): number {
  if (thisValue < index) {
    return thisValue;
  }
  if (thisValue > index) {
    return thisValue - 1;
  }
  return otherValue > index ? index : index - 1; // thisValue === index — see doc comment above.
}

/**
 * The range-endpoint sibling of `repairCellAddressForDelete`: given a
 * `RangeNode`'s two stored endpoint `Address`es, returns their repaired pair,
 * or the literal string `"deleted"` if the WHOLE range named only the removed
 * line (§5.4: "a range deleted entirely becomes `#REF`" — the single-cell
 * range `A3:A3` deleting row 3 is the concrete shape of this). Endpoints not
 * naming `tableId`, or not well-formed cell addresses, pass through as an
 * UNCHANGED pair — defensive only, mirroring `enumerateRangeCellAddresses`'s
 * own stance on a malformed or cross-object range (D-045's defensive arm).
 *
 * Only the axis being deleted is ever touched, on either endpoint — the other
 * axis's coordinate (the column, for a row deletion) carries through
 * unchanged on each endpoint independently: a range spans a rectangle, and
 * deleting a row never moves a column.
 */
export function repairRangeEndpointsForDelete(
  start: Address,
  end: Address,
  tableId: string,
  axis: "row" | "column",
  index: number,
): { readonly start: Address; readonly end: Address } | "deleted" {
  if (start.objectId !== tableId || end.objectId !== tableId) {
    return { start, end };
  }
  const startCoordinates = cellAddressToCoordinates(start);
  const endCoordinates = cellAddressToCoordinates(end);
  if (startCoordinates === undefined || endCoordinates === undefined) {
    return { start, end };
  }

  const startValue = axis === "row" ? startCoordinates.row : startCoordinates.column;
  const endValue = axis === "row" ? endCoordinates.row : endCoordinates.column;

  if (startValue === index && endValue === index) {
    return "deleted"; // §5.4: a range naming only the deleted line becomes #REF entirely.
  }

  const newStartValue = clampRangeEndpointValue(startValue, endValue, index);
  const newEndValue = clampRangeEndpointValue(endValue, startValue, index);

  const newStartCoordinates =
    axis === "row" ? { column: startCoordinates.column, row: newStartValue } : { column: newStartValue, row: startCoordinates.row };
  const newEndCoordinates =
    axis === "row" ? { column: endCoordinates.column, row: newEndValue } : { column: newEndValue, row: endCoordinates.row };

  return {
    start: { objectId: start.objectId, path: [TABLE_CELL_PATH_PREFIX, formatCellReference(newStartCoordinates)] },
    end: { objectId: end.objectId, path: [TABLE_CELL_PATH_PREFIX, formatCellReference(newEndCoordinates)] },
  };
}

/**
 * Returns a NEW table `GraphObject` with the row/column at `index` REMOVED
 * (§5.4's other half of "rows and columns can be added or removed"): the
 * relevant dimension slot decrements by one, every populated cell AT `index`
 * is DROPPED (its content is gone — the line itself no longer exists), and
 * every populated cell AFTER `index` shifts back by one, via the SAME
 * per-cell arithmetic (`shiftCoordinatesForDelete`) `repairCellAddressForDelete`
 * uses for the reference-adjustment pass — so the cell-slot move and the
 * formula-reference move can never disagree about where row N goes, the same
 * discipline D-051 already established for insertion.
 *
 * **D-049 applies here exactly as it does to `insertTableLine`.** The new
 * `slots` record starts from `object.slots` IN FULL — a slot this function
 * does not recognise (an unrecognised literal, a cell outside the current
 * extent, a future `origin.x`) is carried through untouched, never rebuilt
 * from scratch. Only the CURRENT extent's cell keys are removed, and each
 * only because it is either being dropped (at `index`) or re-written at its
 * shifted position (after `index`).
 *
 * `index` MUST already be validated (an integer in `1..currentCount`) by the
 * caller — `mutation.ts`'s `findInvalidTableResizes` is the primary,
 * message-bearing check, mirroring the same primary-validation/defensive-arm
 * split `insertTableLine` already uses. Unlike insertion, this function does
 * NOT clamp an out-of-range index: there is no sensible "nearest line" to
 * delete instead of a nonexistent one, so an unvalidated call simply
 * decrements the dimension and moves whatever cells happen to satisfy
 * `shiftCoordinatesForDelete`'s arithmetic. A caller that only ever reaches
 * this after the precondition check passes never observes that distinction.
 */
export function deleteTableLine(object: GraphObject, axis: "row" | "column", index: number): GraphObject {
  const { rows, cols } = getTableDimensions(object);

  // D-049: start from every slot this object already carries.
  const newSlots: Record<string, Slot> = { ...object.slots };
  newSlots[slotKey(TABLE_ROWS_PATH)] = { kind: "literal", value: axis === "row" ? Math.max(0, rows - 1) : rows };
  newSlots[slotKey(TABLE_COLS_PATH)] = { kind: "literal", value: axis === "column" ? Math.max(0, cols - 1) : cols };

  const shiftedCells: Record<string, Slot> = {};
  for (const path of enumerateTableCellSlotPaths(object)) {
    const slot = getSlot(object, path);
    if (slot === undefined) {
      continue; // No slot at this candidate cell — nothing to move or drop.
    }
    delete newSlots[slotKey(path)]; // This cell is either dropped or moved — either way it leaves its old key.
    const cellReference = path[1]; // enumerateTableCellSlotPaths always yields [TABLE_CELL_PATH_PREFIX, ref].
    const coordinates = cellReference === undefined ? undefined : parseCellReference(cellReference);
    if (coordinates === undefined) {
      continue; // Defensive only — cannot actually happen for a path this file just generated.
    }
    const shifted = shiftCoordinatesForDelete(coordinates, axis, index);
    if (shifted === "deleted") {
      continue; // §5.4: this cell's own row/column was removed — its content goes with it.
    }
    shiftedCells[slotKey([TABLE_CELL_PATH_PREFIX, formatCellReference(shifted)])] = slot;
  }
  Object.assign(newSlots, shiftedCells);

  return { ...object, slots: newSlots };
}
