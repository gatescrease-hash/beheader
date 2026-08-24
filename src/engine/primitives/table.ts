/**
 * table.ts — Table primitive: default dimensions, current-extent cell
 * enumeration (the dynamic slot family), and range-rectangle enumeration.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.4's "Default 8×8" fact, §5.4's own dimension
 * fields ("rows and columns can be added or removed"), the DYNAMIC SLOT
 * FAMILY mechanism D-017/0041-REVIEW-phase2 §9 named as Phase 2's critical
 * path (`enumerateTableCellSlotPaths`, cycle 0042/0043), and — as of THIS
 * cycle — the range "enumeration... helper" **D-036** (constraint 2) asked
 * for, now BOUNDED by the table's current extent per **D-044** and wired into
 * both `mutation.ts`'s `deriveEdges` and `graph/eval.ts`'s range-value lookup.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * This was the FIRST FILE of the table primitive subsystem (cycle 0040,
 * PROCESS_BRIEF §6.1 trigger 2). Cycle 0042/0043 solved the dynamic-slot-
 * family mechanism and registered a real `table` schema entry. THIS cycle is
 * the range-evaluation wiring slice STATUS.md named next: bounding
 * `enumerateRangeCellAddresses` by current extent (D-044) and reading
 * dimensions `literal`-only (D-046) the same way `enumerateTableCellSlotPaths`
 * already does. See NOT DONE HERE for what is still deliberately absent.
 *
 * WHAT THIS IS
 *   `DEFAULT_TABLE_ROWS`/`DEFAULT_TABLE_COLS` — §5.4's own stated fact ("Default
 *   8×8"), as plain constants a future table-creation mutation will read.
 *
 *   `enumerateRangeCellAddresses(start, end, tableObject)` — the pure function
 *   `graph/eval.ts` calls to expand a `RangeNode` for evaluation (D-036
 *   constraint 1: "`evaluate` expands the range itself, through its `read`
 *   callback, over addresses enumerated from the endpoint pair") and
 *   `mutation.ts`'s `deriveEdges` calls to expand a `RangeDependency` from the
 *   table's CURRENT state (D-036: "never a cached expansion") — both wired THIS
 *   cycle. Given two cell `Address`es and the `GraphObject` they name cells on,
 *   it returns every cell `Address` in the rectangle between them, inclusive,
 *   BOUNDED by that object's current `rows`/`cols` (D-044), in row-major order
 *   (every column of row `minRow`, then every column of `minRow + 1`, ...).
 *   Order is deterministic but not otherwise meaningful — every brief-specified
 *   aggregate (`SUM`/`MIN`/`MAX`/`AVG`) is order-independent over its inputs,
 *   so nothing downstream may depend on it beyond determinism (needed for test
 *   assertions and stable dependency lists).
 *
 *   Table dimensions ("is B10 within this table's current row count") ARE this
 *   function's concern as of D-044 (0041-REVIEW-phase2), reversing cycle
 *   0040's original stance: a range's expansion happens at EDGE DERIVATION
 *   time (§5.3), so an unbounded expansion would make `deriveEdges` produce
 *   edges pointing at slots that do not exist — a dangling edge a later
 *   evaluation-time `#REF` cannot repair, because the edge was already built.
 *   Cells outside the extent are OMITTED, never reported as `#REF` — see this
 *   function's own doc comment for D-044's full reasoning, including why this
 *   is also what keeps `A1:ZZ999999` a bounded loop rather than a
 *   millions-of-paths hazard.
 *
 *   A range whose two endpoints name DIFFERENT objects (`SUM(table_x.A1:
 *   table_y.B4)`) is rejected here, with a `RangeEnumerationError`, rather
 *   than silently enumerating a nonsensical cross-table rectangle — but this
 *   is now the DEFENSIVE arm only: the reachable case (an authored formula) is
 *   rejected at PARSE time as of **D-045** (`formula/parser.ts`'s
 *   `validateRangePlacement`), because which objects two endpoints name is
 *   decidable from the formula text alone. §5.4 frames a table as "a
 *   self-contained grid... without being regions of one giant sheet," and
 *   every range example the brief gives names one table on both sides — a
 *   range spanning two tables has no coherent rectangle to enumerate at all
 *   (rows/columns of DIFFERENT tables are not comparable quantities).
 *
 *   `TABLE_ROWS_PATH` / `TABLE_COLS_PATH` — the two ORDINARY, FIXED, literal
 *   slot paths that hold a table's current row/column count (§5.4: "rows and
 *   columns can be added or removed"). These are declared as a plain `static`
 *   `NonDerivedSlotPathGroup` in `TABLE_SCHEMA` (`primitives/schema.ts`) — the
 *   SAME mechanism `value`'s one slot already uses, no widening needed for
 *   them. Naming: the brief's own command-line words (§5.10:
 *   `table x=0 y=0 rows=8 cols=8`), reused rather than inventing a second pair
 *   of words for the same idea. Nothing in this cycle writes them (no
 *   table-creation mutation exists yet) or reads them for any purpose beyond
 *   `enumerateTableCellSlotPaths` below — a disclosed, reversible naming
 *   choice, not a brief-mandated one.
 *
 *   `enumerateTableCellSlotPaths(object)` — the `dynamic`
 *   `NonDerivedSlotPathGroup.enumerate` function `TABLE_SCHEMA` supplies for
 *   the cells family. Reads `TABLE_ROWS_PATH`/`TABLE_COLS_PATH` off the
 *   object's OWN slots (an ordinary, sanctioned forward `slotKey` lookup — see
 *   `graph/node.ts`'s `getSlot`) and generates every `["cells", ref]` path for
 *   `1..rows × 1..cols`, row-major, via the SAME `formatCellReference` helper
 *   `enumerateRangeCellAddresses` above also uses. This is deliberately NOT "read the
 *   object's actual `cells.*` slot keys and recover their paths" — D-010
 *   forbids ever inverting a `slotKey` back into a path array, even where it
 *   would happen to be safe (a cell reference never contains "."), so the only
 *   sanctioned way to get a concrete PATH for a slot this file did not just
 *   build itself is to GENERATE candidates from known state and look each one
 *   up — precisely the shape `primitives/schema.ts`'s existing `dynamic`
 *   `DerivedSlotDependencies` already established for `text.resolvedContent`/
 *   `script.out.*`, applied here to `nonDerivedSlotPaths` instead. Never
 *   throws: a missing or malformed dimension slot (not a `literal` kind, not a
 *   number, negative, non-integer) reads as `0` rather than guessing or
 *   throwing — see `readTableDimension`'s own doc comment for why that is safe
 *   rather than a silently-wrong answer. The `literal`-kind clause is **D-046**
 *   (0043-REVIEW) and is a RULE 6 guard, not a tidy-up: a `formula` dimension
 *   slot would let EVALUATION resize the declared cell family, because a
 *   formula slot's value is written at §5.1 step 7 — after edge derivation
 *   (step 3) and `validateIntegrity` (step 4) have already run.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. `enumerateRangeCellAddresses` returns a typed
 *     `RangeEnumerationError` (`#REF`, matching the code `formula/eval.ts`
 *     already uses for an unresolved reference) for both failure modes
 *     (cross-object endpoints — defensive only, see D-045; a malformed or
 *     non-cell-shaped endpoint path) — §5.1: "errors must never throw across
 *     the evaluation loop." `enumerateTableCellSlotPaths` never throws either
 *     — see above.
 *   - Builds every address through `address.ts`'s `TABLE_CELL_PATH_PREFIX` and
 *     `formatCellReference`, never a hand-built `["cells", ...]` array or a
 *     re-derived uppercase/column-arithmetic step — D-010's "declare it once"
 *     principle, and D-039's "normalisation happens at exactly one point"
 *     (which `formatCellReference`/`indexToColumnLetters` already are).
 *   - `enumerateTableCellSlotPaths` never inverts a `slotKey` (D-010) — see
 *     its own doc comment above and below.
 *   - Both dimension-reading functions (`enumerateRangeCellAddresses`,
 *     `enumerateTableCellSlotPaths`) route through the SAME `literal`-kind-only
 *     `readTableDimension` (D-046) — one guard, not two copies of the Rule 6
 *     reasoning.
 *
 * NOT DONE HERE
 *   - Row/column insert/delete mutations and §5.4's reference-adjustment pass
 *     (a range endpoint clamping to the remaining extent on delete). Clamping
 *     needs the concrete delete-mutation machinery — which row/column was
 *     removed, how surviving indices shift — that does not exist yet; nothing
 *     about table DIMENSIONS alone (this file's only concern) determines it.
 *     Nothing here PREVENTS a raw `setSlot` on `TABLE_ROWS_PATH`/
 *     `TABLE_COLS_PATH` from disagreeing with the cell slots that actually
 *     exist on the object — see `enumerateTableCellSlotPaths`'s own doc
 *     comment for why that is self-limiting (D-017's own check catches the
 *     dangerous half) rather than silently wrong, and why a real row/col
 *     mutation must not be built as a bare `setSlot` on these two paths.
 *   - A table-creation mutation/command (`table x=0 y=0 rows=8 cols=8`, §5.10)
 *     that would actually populate `TABLE_ROWS_PATH`/`TABLE_COLS_PATH` and the
 *     matching `cells.*` literal slots — Phase 3's command line.
 */
import { type Address, formatCellReference, parseCellReference, TABLE_CELL_PATH_PREFIX } from "../address.ts";
import { getSlot, type GraphObject } from "../graph/node.ts";

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
 * Expands a range's two endpoint `Address`es into every cell `Address` in the
 * inclusive rectangle between them (§5.3/§5.4), BOUNDED by `tableObject`'s
 * CURRENT `rows`/`cols` extent — **D-044**, ruled at 0041-REVIEW-phase2 and
 * wired THIS cycle. Returns `Address[]`, not bare paths (a signature decided
 * at the moment of wiring, per that review's §9 note): both this cycle's
 * consumers (`mutation.ts`'s `deriveEdges`, `graph/eval.ts`'s range-value
 * lookup) need a full `Address` — `{ objectId: start.objectId, path }` — to
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
 * non-negative integer: missing entirely (no table-creation mutation exists yet
 * to have populated it), a NON-LITERAL slot kind (`formula`/`derived` — D-046,
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
