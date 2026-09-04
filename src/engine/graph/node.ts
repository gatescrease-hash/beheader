/**
 * node.ts — Slot/object data model.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1. Load-bearing (§6.2).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   §5.1's central claim: "the dependency graph is over addressable slots (individual
 *   properties), not over whole objects." This file defines both halves of that — the
 *   object shape and the three slot kinds it is built from.
 *
 *   A `GraphObject`'s `slots` is a flat map from a slot's stored path, joined with "."
 *   (`slotKey`), to that slot's data: `"origin.x"`, `"cells.A1"`, `"out.result"`. Path
 *   segments never contain "." (`address.ts`'s `PATH_SEGMENT_PATTERN` forbids it), so
 *   the join is a safe, collision-free canonical key. An `Address` resolves to a slot
 *   via `getSlot`. There is no sanctioned inverse (D-010) — never `key.split(".")`.
 *
 *   `Value`/`Point`/`ErrorValue` (§5.1's `Value` union) live here because they are what
 *   a Slot holds. Every module that produces a Value imports these rather than
 *   redefining them, and `isIllegalNumber`/`hasIllegalNumber` are the ONE shared
 *   predicate for "this number is not legal document state" (D-014's principle),
 *   covering non-finite values (D-025/Q-006) and `-0` (PROVISIONAL(Q-008)).
 *
 * INVARIANTS UPHELD HERE
 *   - `literal`/`formula`/`derived` are the only three slot kinds (§5.1's table).
 *     `derived` has no user-settable content field — it is computed, never written.
 *   - `GraphObject`, `Slot`, `Value`, `Point`, `ErrorValue` are all plain, readonly
 *     data: no closures, no class instances, no `Map`s. Everything here is trivially
 *     serializable and could be written in Rust unchanged (PROJECT_BRIEF §2).
 *   - **D-007**: a `GraphObject`'s `type` is MUTABLE STATE ACROSS MUTATIONS — `explode`
 *     changes a preset's type to its editable-path type in place, same id, same name.
 *     Each `GraphObject` VALUE is still immutable data (Rule 5's clone-based
 *     transactionality): such a mutation produces a NEW value with a different `type`,
 *     never an in-place write. "Mutable state on the object" means across the
 *     document's mutation history, not within one JS object.
 *
 * A NOTE ON "Object" — the exported type is `GraphObject`, not `Object`, purely to
 * avoid shadowing TypeScript's global. The brief's vocabulary word is still "object"
 * everywhere; this is a naming-collision workaround, not a synonym (PROCESS_BRIEF §5.1).
 *
 * NOT DONE HERE
 *   - Deriving edges, evaluating slots, detecting cycles, or any mutation at all —
 *     `graph/edge.ts`, `graph/cycles.ts`, `graph/eval.ts`, `mutation.ts`.
 *   - Per-type schema declarations (`primitives/schema.ts`).
 *   - Validating that a `GraphObject`'s `slots` match what its `type`'s schema
 *     declares. Nothing here rejects a malformed object; that is `mutation.ts`'s job.
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
 * The error codes a broken slot can hold. §5.1 enumerates five (`#REF`, `#TYPE`,
 * `#DIV0`, `#PARSE`, `#SCRIPT`); `#MEASURE` is a SIXTH, added at entry 0129 under
 * **D-118** — the same move **D-028** made for `formula/ast.ts`'s `ErrorNode`
 * (not in §5.3's grammar either): the type system needs a case the brief's list
 * did not foresee. `#MEASURE` is what §5.6's `measuredHeight` and D-123's
 * `measuredWidth` computes return when they must measure a real `text` object but
 * only the null `TextMeasurer` is wired (`eval-context.ts`) — a size they did not
 * earn is worse than an honest error (D-118). It is only ever produced by a
 * `derived` slot, whose value is never serialized (§5.11), so no saved document
 * can carry it.
 *
 * There is deliberately no `#CYCLE` — cycles are rejected at mutation time and
 * never enter the graph as state (§5.1, PROCESS_BRIEF §9's forbidden-moves list).
 */
export type ErrorCode = "#REF" | "#TYPE" | "#DIV0" | "#PARSE" | "#SCRIPT" | "#MEASURE";

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
 * The single leaf-level test every value-legality check in this codebase is
 * built from: is `n` a number that cannot survive this project's JSON-based
 * persistence format (§5.11) unchanged?
 *
 *   - Non-finite (`NaN`, `Infinity`, `-Infinity`) — D-025/Q-006 (ruled by the
 *     human directly, cycle 0023): JSON has no representation for any of the
 *     three, so `mutate` rejects them as document state.
 *   - Negative zero (`-0`) — PROVISIONAL(Q-008), taken at 0025-REVIEW-phase0's
 *     recommendation (a), cycle 0026: `Number.isFinite(-0)` is `true`, so the
 *     non-finite check alone does not cover it, but JSON cannot represent the
 *     sign either (`JSON.stringify(-0)` is `"0"`), and `mutate([setSlot
 *     value_1.value = -0])` committed it with `ok: true` while a save/load
 *     round-trip silently turned it into `0` — the same defect one arm
 *     further out. Reversible: one branch here, no stored data can depend on
 *     it (nothing in the tree today can author a `-0` except a hand-written
 *     literal).
 *
 * Exported (not merely an internal helper of `hasIllegalNumber` below)
 * because `document.ts`'s read-side journal check (0025-REVIEW-phase0 finding
 * 1's other half) walks raw, not-yet-typed JSON data rather than a `Value`,
 * and needs this exact leaf test rather than a duplicate of it.
 */
export function isIllegalNumber(n: number): boolean {
  return !Number.isFinite(n) || Object.is(n, -0);
}

/**
 * Whether `value` contains an illegal number (`isIllegalNumber` above)
 * anywhere within it — a bare number, or nested inside a `Point`/`Point[]`'s
 * `x`/`y` fields. Declared here, beside `Value` itself, for the same reason
 * `isErrorValue` is (D-014's principle: a predicate over the `Value` union is
 * declared once and imported everywhere, never redeclared) — `mutation.ts`'s
 * D-025/Q-008 checks and `primitives/schema.ts`'s compute functions both need
 * it. It covers BOTH non-finite values and `-0` (Q-008) as ONE widened
 * predicate, per this project's "widen, never add a parallel one" stance
 * (D-020, D-026) — never a second check beside it.
 *
 * `string`, `boolean`, `null`, and `ErrorValue` trivially cannot contain a
 * number at all, so they always return `false` — checked via `isErrorValue`
 * itself rather than duck-typing "has an `x`," so a `Point`-shaped value is
 * never mistaken for one and vice versa.
 */
export function hasIllegalNumber(value: Value): boolean {
  if (typeof value === "number") {
    return isIllegalNumber(value);
  }
  if (Array.isArray(value)) {
    return (value as readonly Point[]).some((point) => isIllegalNumber(point.x) || isIllegalNumber(point.y));
  }
  if (typeof value === "object" && value !== null && !isErrorValue(value)) {
    const point = value as Point;
    return isIllegalNumber(point.x) || isIllegalNumber(point.y);
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

/** The `text` member of `ObjectType`, exported so `command/commands.ts`'s D-122 guard tests `object.type` against this definition instead of a bare `"text"` literal (D-009). */
export const TEXT_TYPE: ObjectType = "text";

/** The `image` member of `ObjectType`, exported so `render/handles.ts`'s resize-grabber check and `render/interaction.ts`'s per-type resize plan test `object.type` against this definition instead of a bare `"image"` literal (D-009). A render-layer `switch` over the whole union needs no constant and does not use this. */
export const IMAGE_TYPE: ObjectType = "image";

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
 * and `unlink` have something to read without re-running evaluation — D-041 makes
 * this field exactly what `unlink` freezes into a literal, errors included.
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
 * in the object's schema (`primitives/schema.ts`). NEVER writable
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
 * A script node's port NAMES (§5.8), structural state on the `GraphObject`
 * itself — **D-141** (answering Q-026), option (a). Neither a slot value (no
 * `Value` arm holds a list of strings) nor recoverable from a slot KEY (D-010
 * has no sanctioned inverse), so the name list needs a home of its own,
 * exactly the "future `GraphObject`-structural field" D-046's scope note left
 * open. Plain, serializable, ID-free data (§2) — two ORDERED lists, because
 * slot enumeration must be deterministic and a `Record`'s key order is not
 * something the engine may lean on (D-141 clause 2).
 *
 * `in` is the in-port name order; `out` is the out-port name order and is the
 * SINGLE authority for the out-port NAME set — §5.8's `placeholders` holds
 * VALUES only and is reconciled against this two-way (D-141 clause 3).
 * Legality of an individual name is `isLegalPortName` below; uniqueness
 * within a family and the reject-on-referenced-removal rule are
 * `mutation.ts`'s job (D-141 clause 6) — this file only shapes the data.
 *
 * Optional on `GraphObject` because only `script` carries it today; every
 * other type's `ports` is simply absent, not an empty pair — see
 * `document.ts`'s loader for how an older saved document without this field
 * still loads.
 */
export interface GraphObjectPorts {
  readonly in: readonly string[];
  readonly out: readonly string[];
}

/**
 * Whether `name` is a legal port name (D-141 clause 2) — REVIEWER EDIT,
 * 0168-REVIEW: matches `address.ts`'s (private) `PATH_SEGMENT_PATTERN`,
 * `/^[a-zA-Z0-9_]+$/`, exactly, not merely "non-empty and dot-free" as the
 * original cycle had it. A port name becomes a path segment
 * (`in.<name>`/`out.<name>`, dot-joined by `slotKey`), and `parseAddress`
 * rejects any segment outside that pattern — the ORIGINAL check let through
 * a name like `"my-port"` or `"my port"`, which `addPort` would accept and
 * which no address could then ever name, exactly the "address nothing could
 * ever address correctly" outcome this function exists to prevent. `node.ts`
 * cannot import `address.ts` to share the one pattern (`address.ts` already
 * imports `node.ts` for `ObjectType`/`TABLE_TYPE` — importing back would
 * cycle), so this is a hand-maintained duplicate of that pattern, the same
 * posture D-119 already accepts for `resolveTextDependencyAddresses`/
 * `deriveEdges`'s Source 1: change one, change both, same cycle. Declared
 * here, beside `GraphObjectPorts`, so `mutation.ts`'s port operations and any
 * future caller share one predicate rather than each re-typing it.
 */
export function isLegalPortName(name: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(name);
}

/**
 * A user-visible thing on the canvas (§5.1): a polygon, a table, a text box, an
 * image, a script node, or (Phase 0 only) a `value`/`add` test fixture. `slots`
 * is keyed by `slotKey(path)` — see the file header for why that join is safe.
 *
 * Structurally satisfies address.ts's `AddressableObject` (`id`, `name`, `type`),
 * so a document's object list can be passed directly to `parseAddress` /
 * `formatAddress` without an adapter.
 *
 * `ports` (**D-141**) is the structural port-name state a `script` node
 * carries; every other type simply has no `ports` field. See
 * `GraphObjectPorts`'s own doc comment.
 */
export interface GraphObject extends AddressableObject {
  readonly slots: Readonly<Record<string, Slot>>;
  readonly ports?: GraphObjectPorts;
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
