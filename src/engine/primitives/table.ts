/**
 * table.ts — Table primitive: default dimensions and range-rectangle enumeration.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.4's "Default 8×8" fact, and the range
 * "enumeration... helper" **D-036** (constraint 2) asks for — turning a range's
 * two endpoint `Address`es into the concrete list of cell paths between them.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * This is the FIRST FILE of the table primitive subsystem (PROCESS_BRIEF §6.1
 * trigger 2) — the cycle that adds it stops immediately after, per that trigger,
 * before touching `primitives/schema.ts`'s registry or `mutation.ts`. See NOT
 * DONE HERE.
 *
 * WHAT THIS IS
 *   `DEFAULT_TABLE_ROWS`/`DEFAULT_TABLE_COLS` — §5.4's own stated fact ("Default
 *   8×8"), as plain constants a future table-creation mutation will read.
 *
 *   `enumerateRangeCellPaths(start, end)` — the pure function `formula/eval.ts`
 *   will call to expand a `RangeNode` (D-036 constraint 1: "`evaluate` expands
 *   the range itself, through its `read` callback, over addresses enumerated
 *   from the endpoint pair") and `mutation.ts`'s `deriveEdges` will call to
 *   expand a `RangeDependency` from the table's CURRENT state (D-036: "never a
 *   cached expansion"). Neither consumer is wired up this cycle — see NOT DONE
 *   HERE — but the function itself needs no table-dimension input to do its one
 *   job correctly: given two cell `Address`es in the SAME object, it returns
 *   every `["cells", ref]` path in the rectangle between them, inclusive, in
 *   row-major order (every column of row `minRow`, then every column of
 *   `minRow + 1`, ...). Order is deterministic but not otherwise meaningful —
 *   every brief-specified aggregate (`SUM`/`MIN`/`MAX`/`AVG`) is order-
 *   independent over its inputs, so nothing downstream may depend on it beyond
 *   determinism (needed for test assertions and stable dependency lists).
 *
 *   Table dimensions ("is B10 within this table's current row count") are
 *   DELIBERATELY not this function's concern and are not checked here. A cell
 *   outside the table's actual bounds simply has no real slot at that path —
 *   `formula/eval.ts`'s existing `evaluateReference` already turns a `read`
 *   miss into `#REF` (see that file), so bounds-checking falls out for free at
 *   the consumer, the same way an ordinary out-of-range reference already
 *   works today. Duplicating that check here would be a second, parallel
 *   mechanism for one invariant — exactly what this project's "declare it
 *   once" principle (D-009/D-014, applied structurally rather than to a type)
 *   argues against.
 *
 *   A range whose two endpoints name DIFFERENT objects (`SUM(table_x.A1:
 *   table_y.B4)` — nothing upstream of this file currently rejects that; see
 *   `formula/parser.ts`'s own grammar, which resolves each endpoint through
 *   the ordinary `name.path` address grammar independently) is rejected here,
 *   with a `RangeEnumerationError`, rather than silently enumerating a
 *   nonsensical cross-table rectangle. §5.4 frames a table as "a
 *   self-contained grid... without being regions of one giant sheet," and
 *   every range example the brief gives names one table on both sides — a
 *   range spanning two tables has no coherent rectangle to enumerate at all
 *   (rows/columns of DIFFERENT tables are not comparable quantities). This is
 *   a disclosed implementation decision, not a brief-mandated one: nothing in
 *   §5.3/§5.4 discusses this case explicitly.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. `enumerateRangeCellPaths` returns a typed
 *     `RangeEnumerationError` (`#REF`, matching the code `formula/eval.ts`
 *     already uses for an unresolved reference) for both failure modes
 *     (cross-object endpoints; a malformed or non-cell-shaped endpoint path) —
 *     §5.1: "errors must never throw across the evaluation loop."
 *   - Builds every path through `address.ts`'s `TABLE_CELL_PATH_PREFIX` and
 *     `formatCellReference`, never a hand-built `["cells", ...]` array or a
 *     re-derived uppercase/column-arithmetic step — D-010's "declare it once"
 *     principle, and D-039's "normalisation happens at exactly one point"
 *     (which `formatCellReference`/`indexToColumnLetters` already are).
 *
 * NOT DONE HERE
 *   - A `primitives/schema.ts` entry for the `table` `ObjectType`. A table's
 *     cells are a DYNAMIC slot family (`cells.A1`...`cells.H8`, growing and
 *     shrinking with row/column count) and `ObjectSchema.nonDerivedSlotPaths`
 *     is currently a FIXED list — D-017's own words: "being a fixed list of
 *     paths, it cannot express a slot FAMILY... do not extend it for tables
 *     without reading D-017 first — the answer there is likely a different
 *     mechanism, not more entries in this one." Solving that requires widening
 *     `ObjectSchema`'s shape AND both of `mutation.ts`'s consumers of it
 *     (`deriveEdges`, `validateIntegrity`) — a load-bearing, mutation.ts-
 *     touching design decision that deserves its own dedicated, reviewed
 *     cycle, not a rider on this one. `getObjectSchema("table")` still
 *     returns `undefined` after this cycle, honestly — not a placeholder.
 *   - Row/column insert/delete mutations and §5.4's reference-adjustment pass
 *     (a range endpoint clamping to the remaining extent on delete). Clamping
 *     needs the concrete delete-mutation machinery — which row/column was
 *     removed, how surviving indices shift — that does not exist yet; nothing
 *     about table DIMENSIONS alone (this file's only concern) determines it.
 *   - Wiring `enumerateRangeCellPaths` into `formula/eval.ts` (D-036
 *     constraint 1) or `mutation.ts`'s edge derivation (the other half of
 *     constraint 2) — both are the wiring cycle's job.
 *   - `MIN`/`MAX`'s `Math.min(...)`/`Math.max(...)` spread risk (0035-REVIEW
 *     Finding 4, D-036 constraint 5) — owned by the SAME future cycle, once
 *     this function's output actually reaches a long argument list.
 *   - Any table-specific command (`table x=0 y=0 rows=8 cols=8`, §5.10) —
 *     Phase 3's command line.
 */
import { type Address, formatCellReference, parseCellReference, TABLE_CELL_PATH_PREFIX } from "../address.ts";

/** §5.4: "Default 8×8." A future table-creation mutation reads these; nothing in this file writes them anywhere. */
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
 * Narrows `enumerateRangeCellPaths`'s result to its error arm. A plain
 * `Array.isArray` check does not reliably narrow a `ReadonlyArray`-flavoured
 * union under this project's TS config — the same reason `formula/parser.ts`'s
 * `isLexError` exists as an explicit predicate rather than an inline check.
 */
export function isRangeEnumerationError(
  result: readonly (readonly string[])[] | RangeEnumerationError,
): result is RangeEnumerationError {
  return !Array.isArray(result);
}

/**
 * Reads a stored cell `Address`'s path (`["cells", "A1"]`) back into
 * `{ column, row }` coordinates, or `undefined` if the path is not that shape
 * at all — a defensive check, not a bounds check (see file header): this
 * rejects a MALFORMED address (wrong prefix, wrong length, an unparseable
 * second segment), never a well-formed one that merely names a cell outside
 * the table's current extent.
 */
function cellAddressToCoordinates(address: Address): { readonly column: number; readonly row: number } | undefined {
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
 * Expands a range's two endpoint `Address`es into every `["cells", ref]` path
 * in the inclusive rectangle between them (§5.3/§5.4) — the enumeration half
 * of D-036 constraint 2. See the file header for row-major ordering, the
 * deliberate absence of a table-dimension bounds check, and the disclosed
 * decision to reject cross-object endpoints.
 *
 * Rejects: `start`/`end` naming different objects, or either one not being a
 * well-formed cell address (`cellAddressToCoordinates` above). Never throws.
 */
export function enumerateRangeCellPaths(
  start: Address,
  end: Address,
): readonly (readonly string[])[] | RangeEnumerationError {
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

  const minRow = Math.min(startCoordinates.row, endCoordinates.row);
  const maxRow = Math.max(startCoordinates.row, endCoordinates.row);
  const minColumn = Math.min(startCoordinates.column, endCoordinates.column);
  const maxColumn = Math.max(startCoordinates.column, endCoordinates.column);

  const paths: (readonly string[])[] = [];
  // Row-major: every column of one row before moving to the next (file header).
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      paths.push([TABLE_CELL_PATH_PREFIX, formatCellReference({ column, row })]);
    }
  }
  return paths;
}
