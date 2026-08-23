/**
 * node.ts — Slot/object data model.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1. Load-bearing per Rule 3 (§6 trigger-2 file).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   §5.1's central claim: "the dependency graph is over addressable slots
 *   (individual properties), not over whole objects." This file defines both
 *   halves of that: the Object shape and the three Slot kinds it's built from.
 *
 *   A GraphObject's `slots` is a flat map from a slot's *stored path*, joined with
 *   "." (`slotKey`), to that slot's data — e.g. an object might have slot keys
 *   "origin.x", "origin.y", "cells.A1", "out.result". Path segments never contain
 *   "." (address.ts's PATH_SEGMENT_PATTERN forbids it), so this join is a safe,
 *   collision-free canonical key. An `Address { objectId, path }` resolves to a
 *   slot via `getSlot(documentObjects[address.objectId], address.path)`.
 *
 *   Value/Point/ErrorValue (§5.1's Value union) live here because they are what a
 *   Slot holds — every other module that produces a Value (formula evaluation,
 *   geometry compute functions, script stubs) imports these rather than
 *   redefining them.
 *
 * INVARIANTS UPHELD HERE
 *   - `literal`/`formula`/`derived` are the only three slot kinds (§5.1's table).
 *     `derived` has no user-settable content field — it is computed, never written.
 *   - GraphObject, Slot, Value, Point, ErrorValue are all plain, readonly data:
 *     no closures, no class instances, no `Map`s. Everything here is trivially
 *     serializable and could be written in Rust unchanged (PROJECT_BRIEF §2).
 *
 * A NOTE ON "Object" — this file's exported type is named `GraphObject`, not
 * `Object`, purely to avoid shadowing TypeScript's own global `Object` type. The
 * brief's vocabulary word is still "object" everywhere in comments and docs — this
 * is a naming-collision workaround, not a synonym (PROCESS_BRIEF §5.1).
 *
 * D-007 (0002-REVIEW-phase0): a GraphObject's `type` is MUTABLE STATE ACROSS
 * MUTATIONS — `explode` changes a preset's type to its editable-path type in
 * place, same id, same name. Each individual GraphObject *value* here is still
 * immutable data (Rule 5's clone-based transactionality): a mutation that changes
 * an object's type produces a NEW GraphObject value with a different `type`
 * field, it does not mutate a GraphObject in place at the language level. "Mutable
 * state on the object" means across the document's mutation history, not within
 * one JS object.
 *
 * NOT DONE HERE
 *   - Deriving edges from ASTs/schema declarations, evaluating slots, detecting
 *     cycles, or any mutation at all (graph/edge.ts, graph/cycles.ts,
 *     graph/eval.ts, mutation.ts — none exist yet).
 *   - Per-type schema declarations (which derived slots a given ObjectType has,
 *     their compute functions, their dependencies) — primitives/schema.ts, next.
 *   - Validating that a GraphObject's `slots` actually match what its `type`'s
 *     schema declares. Nothing here rejects a malformed object; construction and
 *     validation are mutation.ts's job.
 */
import type { Address, AddressableObject } from "../address.ts";
import type { FormulaAst } from "../formula/ast.ts";

// ---------------------------------------------------------------------------
// Value union (§5.1)
// ---------------------------------------------------------------------------

/** A 2D point. Used for geometry vertices/origins and passed between objects (§5.1). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The five error codes a broken slot can hold (§5.1). There is deliberately no
 * `#CYCLE` — cycles are rejected at mutation time and never enter the graph as
 * state (§5.1, PROCESS_BRIEF §9's forbidden-moves list).
 */
export type ErrorCode = "#REF" | "#TYPE" | "#DIV0" | "#PARSE" | "#SCRIPT";

/**
 * An error is legitimate graph state, not an exception (§5.1: "An ErrorValue in
 * the graph is legitimate state, not a reason to reject a mutation"). Errors
 * propagate: any formula reading an error slot yields an error, and this must
 * never throw across the evaluation loop.
 */
export interface ErrorValue {
  readonly error: ErrorCode;
  readonly message: string;
}

/**
 * The complete runtime value union (§5.1). Deliberately small and explicit — no
 * indexing or vector arithmetic on `Point`/`Point[]` in the formula language (v1);
 * formulas read scalar components (`polygon_1.centroid.x`) instead.
 */
export type Value = number | string | boolean | Point | readonly Point[] | null | ErrorValue;

/**
 * Narrows a `Value` to its `ErrorValue` arm.
 *
 * Why it lives here rather than at its call site: §5.1 requires that errors
 * PROPAGATE — "any formula reading an error slot yields an error" — so every
 * derived slot's compute function (`primitives/schema.ts`) and, later,
 * `formula/eval.ts` must make exactly this check before touching a value.
 * It is defined once, beside `ErrorValue` itself, for the same reason `Value`
 * and `Point` are (D-009's principle: the value vocabulary is declared in one
 * place and imported, never redeclared).
 *
 * The `value !== null` guard is load-bearing, not defensive noise: `typeof
 * null === "object"`, and `null` is a member of `Value`. The other object-shaped
 * members (`Point`, `readonly Point[]`) are correctly excluded by the `"error"`
 * property test.
 */
export function isErrorValue(value: Value): value is ErrorValue {
  return typeof value === "object" && value !== null && "error" in value;
}

/**
 * Whether `value` contains a non-finite number (`NaN`, `Infinity`, `-Infinity`)
 * anywhere within it — a bare number, or nested inside a `Point`/`Point[]`'s
 * `x`/`y` fields (D-025/Q-006: non-finite numbers are not legal document
 * state). Declared here, beside `Value` itself, for the same reason
 * `isErrorValue` is (D-014's principle: a predicate over the `Value` union is
 * declared once and imported everywhere, never redeclared) — `mutation.ts`'s
 * D-025 check and `primitives/schema.ts`'s compute functions both need it.
 *
 * `string`, `boolean`, `null`, and `ErrorValue` trivially cannot contain a
 * number at all, so they always return `false` — checked via `isErrorValue`
 * itself rather than duck-typing "has an `x`," so a `Point`-shaped value is
 * never mistaken for one and vice versa.
 */
export function hasNonFiniteNumber(value: Value): boolean {
  if (typeof value === "number") {
    return !Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return (value as readonly Point[]).some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y));
  }
  if (typeof value === "object" && value !== null && !isErrorValue(value)) {
    const point = value as Point;
    return !Number.isFinite(point.x) || !Number.isFinite(point.y);
  }
  return false; // string, boolean, null, ErrorValue
}

// ---------------------------------------------------------------------------
// Object type vocabulary (D-009)
// ---------------------------------------------------------------------------

/**
 * The full set of object type strings, defined exactly once (D-009,
 * 0004-REVIEW-phase0). No other module may declare its own literal for one of
 * these strings — import `ObjectType` (or the specific member, e.g. `TABLE_TYPE`)
 * from here instead of re-typing `"table"` elsewhere. A typo in a bare `string`
 * would silently produce wrong behaviour with no compile error; a typo against
 * this union is a compile error.
 *
 * Two families:
 *   - The eight product primitives, taken directly from PROJECT_BRIEF §5.10's
 *     command-line syntax (`circle`, `polygon`, `polyline`, `rect`, `text`,
 *     `table`, `script`, `image`) — these are the brief's own vocabulary, not a
 *     guess. Per §5.5, `polyline` is already described as "editable path,
 *     per-vertex literal slots" — the editable-path type a preset's `type`
 *     changes to under D-007's `explode`, not a separate "path" type.
 *   - `value` and `add`, the two fixture-only types PROJECT_BRIEF §6 (Phase 0)
 *     names explicitly for exercising the graph mechanism before
 *     `primitives/schema.ts` exists. These are never reachable from the command
 *     line (§5.10 does not list them) and are not real product primitives.
 */
export type ObjectType =
  | "circle"
  | "polygon"
  | "polyline"
  | "rect"
  | "text"
  | "table"
  | "script"
  | "image"
  | "value"
  | "add";

/** The `table` member of `ObjectType`, exported so address.ts's D-005 mapping references this definition instead of its own string literal (D-009). */
export const TABLE_TYPE: ObjectType = "table";

// ---------------------------------------------------------------------------
// The three slot kinds (§5.1's table)
// ---------------------------------------------------------------------------

/**
 * `literal`: value comes from a stored constant. Writable by the user (`set`).
 * No inbound edges — nothing derives a literal's value from elsewhere.
 */
export interface LiteralSlot {
  readonly kind: "literal";
  readonly value: Value;
}

/**
 * `formula`: value comes from evaluating a stored AST. Writable by the user (by
 * editing the formula, e.g. `link`). A binding is the degenerate case — an AST
 * that is just a reference to another slot (§5.1).
 *
 * `value` is the LAST EVALUATED result, cached here so downstream formula slots
 * and `unlink` (Q-001) have something to read without re-running evaluation.
 * Step 7 of the mutation loop (§5.1) overwrites it on every mutation; it is
 * derived data, not a second source of truth — `ast` is what the user actually
 * edited.
 */
export interface FormulaSlot {
  readonly kind: "formula";
  readonly ast: FormulaAst;
  readonly value: Value;
}

/**
 * `derived`: value comes from an object-type-specific compute function declared
 * in the object's schema (`primitives/schema.ts`, not yet built). NEVER writable
 * — attempting to `link` or `set` a derived slot is rejected (§5.1). Accordingly
 * there is no user-settable content field here at all, only the cached result of
 * the last evaluation pass; unlike `FormulaSlot`, there is no separate "what the
 * user wrote" to preserve.
 */
export interface DerivedSlot {
  readonly kind: "derived";
  readonly value: Value;
}

/** A slot is exactly one of the three kinds above (§5.1). */
export type Slot = LiteralSlot | FormulaSlot | DerivedSlot;

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

/**
 * A user-visible thing on the canvas (§5.1): a polygon, a table, a text box, an
 * image, a script node, or (Phase 0 only) a `value`/`add` test fixture. `slots`
 * is keyed by `slotKey(path)` — see the file header for why that join is safe.
 *
 * Structurally satisfies address.ts's `AddressableObject` (`id`, `name`, `type`),
 * so a document's object list can be passed directly to `parseAddress` /
 * `formatAddress` without an adapter.
 */
export interface GraphObject extends AddressableObject {
  readonly slots: Readonly<Record<string, Slot>>;
}

// ---------------------------------------------------------------------------
// Path <-> slot-key helpers
// ---------------------------------------------------------------------------

/**
 * The canonical key a slot is stored under in `GraphObject.slots`, given the
 * slot's *stored* path (already through address.ts's D-005 mapping if
 * applicable — this function does not know about that mapping, it only joins
 * whatever path it's given). Safe because path segments never contain "."
 * (address.ts's `PATH_SEGMENT_PATTERN`), so no two distinct paths can collide.
 */
export function slotKey(path: readonly string[]): string {
  return path.join(".");
}

/** Looks up a slot on an object by its stored path. Pure; never throws. */
export function getSlot(object: GraphObject, path: readonly string[]): Slot | undefined {
  return object.slots[slotKey(path)];
}

/**
 * Resolves a full Address to the slot it names, given the document's object
 * list. Pure; never throws — returns `undefined` for a stale objectId or an
 * unset path, same as a plain lookup miss. Does not know about `#REF`; a caller
 * that needs the ErrorValue-shaped failure (e.g. formula evaluation reading a
 * dangling reference) constructs it from this `undefined`, since this file has
 * no opinion on when a missing slot is an error versus expected.
 */
export function resolveSlot(address: Address, objects: readonly GraphObject[]): Slot | undefined {
  const object = objects.find((candidate) => candidate.id === address.objectId);
  if (object === undefined) {
    return undefined;
  }
  return getSlot(object, address.path);
}
