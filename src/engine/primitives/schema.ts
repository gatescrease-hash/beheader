/**
 * schema.ts — Per-type derived-slot declarations and compute functions.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1 ("Each object type's schema declares, for every
 * derived slot: its address path, its dependencies, and its compute function.").
 * Load-bearing per Rule 3 (§6 trigger-2 file) and PROCESS_BRIEF §6 trigger-3 (new
 * engine file).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   The registry `graph/eval.ts` and `mutation.ts` read to know, for a given
 *   object TYPE: which of its slots are `derived` and how to compute each one
 *   (its stored path, the other slots it reads, and the compute function), and
 *   — as of this cycle — the full set of paths its NON-derived (`literal`/
 *   `formula`) slots occupy (`nonDerivedSlotPaths`). This file does not itself
 *   derive edges or evaluate anything — see NOT DONE HERE.
 *
 *   Scope, deliberately narrow: this cycle covers exactly the two Phase 0 fixture
 *   types PROJECT_BRIEF §6 names — `value` (one non-derived slot, no derived
 *   slots at all) and `add` (two non-derived input slots, one derived
 *   `out.result` reading both), per D-011. The other eight `ObjectType` members
 *   (`circle`, `polygon`, ...) do not have schema entries yet; `getObjectSchema`
 *   returns `undefined` for them, honestly, rather than a placeholder. Their
 *   schemas belong to the phases that introduce them (Phase 3 geometry, Phase 4
 *   table, Phase 5 text, Phase 6 script/image) — building them now would be
 *   building ahead of the brief's §6 build order.
 *
 * INVARIANTS UPHELD HERE
 *   - Derived slots, and now `nonDerivedSlotPaths`, are declared by PATH
 *     (`["out", "result"]`), never by a hand-built key string (D-010).
 *     `findDerivedSlotSchema` compares paths via `slotKey`, the one sanctioned
 *     way to turn a path into a comparable key — `mutation.ts`'s edge derivation
 *     does the same over `nonDerivedSlotPaths` (see its header): this is the
 *     mechanism that lets it recover a formula slot's OWN address without ever
 *     inverting a `GraphObject.slots` key, which has no sanctioned inverse.
 *   - Dependencies may be `static` (a fixed list of paths within the SAME object,
 *     §5.1's example: "centroid ← vertices") or `dynamic` (a function of the
 *     object's current state). Both forms are expressible here even though
 *     neither Phase 0 fixture needs `dynamic` — §5.1 names two later primitives
 *     that require it (`text.resolvedContent`, `script.out.*`), so the mechanism
 *     must support it now rather than being retrofitted.
 *   - `derivedSlotDependencyAddresses` is the ONLY place a static path list is
 *     turned into a full `Address` (by pairing it with the object's own id) or a
 *     dynamic resolver is invoked. Per §5.1, dynamic resolution happens during
 *     EDGE DERIVATION (mutation step 3), never during evaluation — callers MUST
 *     call this while building the edge set, not from inside the topological
 *     pass, or Rule 6 (slot set fixed during evaluation) is violated in spirit:
 *     a dynamic resolver reads the object's CURRENT state, and calling it mid-
 *     evaluation would let the dependency set drift while slots are being
 *     computed.
 *   - No `recompute()` phase is implied or supported here. A `compute` function
 *     is a pure function of (object, resolved inputs) that `graph/eval.ts` calls
 *     ONCE per derived slot, inside the same topological pass as every other
 *     slot kind (§5.1: "derived slots are first-class graph nodes and are
 *     evaluated inside the topological pass, exactly like formula slots").
 *   - `compute` never throws. `add`'s compute function demonstrates the required
 *     shape: propagate an upstream `ErrorValue` unchanged, then fail closed with
 *     a typed `ErrorValue` (`#REF` for a dependency that did not resolve, `#TYPE`
 *     for a wrong-shaped value, ALSO `#TYPE` for a non-finite result — D-025/
 *     Q-006, cycle 0023: `NaN`/`Infinity`/`-Infinity` are not legal document
 *     state) rather than throwing or returning `NaN`/`undefined` (§5.1: "Errors
 *     must never throw across the evaluation loop"). Every FUTURE derived
 *     slot's compute function that does arithmetic must map a non-finite
 *     result to `#TYPE` the same way — `graph/node.ts`'s `hasNonFiniteNumber`
 *     is the shared predicate (D-014's principle) for checking this.
 *
 * NOT DONE HERE
 *   - Declaring an object type's default KIND per slot (literal vs. formula) or
 *     its creation-time default value. `ObjectSchema.nonDerivedSlotPaths` (added
 *     this cycle, for `mutation.ts`'s edge derivation — see below) is only the
 *     PATH half of that: which paths exist, not what they default to. §5.1 does
 *     describe schemas as declaring a slot's "default kind," but the concrete
 *     need for THAT — object CREATION — still belongs to a future `mutation.ts`
 *     cycle. Widen this file again when that need is concrete, same principle
 *     as this cycle's own widening.
 *   - Deriving an actual `Edge[]` from these declarations (that is
 *     `mutation.ts`'s `deriveEdges`, which consumes this file — see its header
 *     for why `nonDerivedSlotPaths` had to be added here rather than solved by
 *     inverting a `GraphObject.slots` key), detecting cycles (graph/cycles.ts),
 *     or topological evaluation (graph/eval.ts).
 *   - Any geometry/table/text/script/image schema entries (Phases 3, 4, 5, 6).
 */
import type { Address } from "../address.ts";
import { hasNonFiniteNumber, isErrorValue, slotKey, type GraphObject, type ObjectType, type Value } from "../graph/node.ts";

// ---------------------------------------------------------------------------
// Dependency declarations (§5.1: "Dependencies may be declared statically ...
// or dynamically")
// ---------------------------------------------------------------------------

/**
 * How a derived slot's schema declares which other slots feed its compute
 * function (§5.1).
 *
 * - `static` — a fixed list of paths WITHIN THE SAME OBJECT, known from the
 *   schema alone with no need to inspect the object's current state (§5.1's own
 *   example: `centroid` reading `vertices`). Both Phase 0 fixture types use only
 *   this form.
 * - `dynamic` — a function of the object's CURRENT state, returning full
 *   `Address`es rather than same-object paths, because the two documented cases
 *   are not same-object: `text.resolvedContent` depends on whatever slots its
 *   parsed content happens to reference (anywhere in the document, and it
 *   changes on every edit); `script.out.*` depends on all of that node's
 *   currently declared `in.*` slots (which change as ports are added/removed).
 *   MUST be evaluated only during edge derivation, never during evaluation
 *   (§5.1) — see `derivedSlotDependencyAddresses` below.
 */
export type DerivedSlotDependencies =
  | { readonly kind: "static"; readonly paths: readonly (readonly string[])[] }
  | { readonly kind: "dynamic"; readonly resolve: (object: GraphObject) => readonly Address[] };

/**
 * A derived slot's compute function (§5.1). Called by `graph/eval.ts` (not yet
 * built) once per evaluation pass, with `read` able to resolve any `Address` —
 * including ones outside this object, for the `dynamic` dependency case — to
 * the VALUE that slot already holds from earlier in the same topological pass.
 * `read` returns `undefined` only for an address that could not be resolved at
 * all (see `graph/node.ts`'s `resolveSlot`); a compute function MUST turn that
 * into a typed `ErrorValue` rather than treating it as a JS `undefined` value,
 * because `undefined` is not a member of `Value` (§5.1).
 *
 * MUST NOT throw. A broken input (an error value, a wrong-shaped value, a
 * missing one) is legitimate graph state (§5.1) and must come back as an
 * `ErrorValue`, never an unwound exception.
 */
export type DerivedSlotCompute = (
  object: GraphObject,
  read: (address: Address) => Value | undefined,
) => Value;

/**
 * One derived slot's full declaration (§5.1): its stored path (D-010 — a path,
 * never a hand-built key), what it depends on, and how to compute it.
 */
export interface DerivedSlotSchema {
  readonly path: readonly string[];
  readonly dependencies: DerivedSlotDependencies;
  readonly compute: DerivedSlotCompute;
}

/**
 * Everything a given `ObjectType` declares about its slots.
 *
 * `nonDerivedSlotPaths` — added this cycle, for `mutation.ts`'s edge
 * derivation — is the full set of paths this type's `literal`/`formula`
 * slots occupy. It is PATHS only, not a default-kind declaration: §5.1 says
 * literal and formula slots are interchangeable at runtime (`link`/`unlink`),
 * so which of the two a given path currently holds is read from the object's
 * actual `slots`, never from this list. What this list answers is narrower and
 * purely structural: "does this type have a bindable slot at this path at
 * all" — exactly what `deriveEdges` needs to recover a formula slot's OWN
 * address (see `mutation.ts`'s header for why that need can't be met any
 * other way). Object CREATION (a slot's default kind/value) is a separate,
 * NOT-YET-BUILT concern — see the file header's NOT DONE HERE.
 *
 * TWO LIMITS, BOTH RULED ON AT 0014-REVIEW-phase0 (D-017). First: this list is
 * the ONLY thing `mutation.ts`'s `deriveEdges` walks, so a formula slot an
 * object actually carries but this list omits gets no edges at all — silently,
 * including a cycle running through it. Second: being a fixed list of paths, it
 * cannot express a slot FAMILY (a table's `cells.A1`…, D-005/D-009). Do not
 * extend it for tables without reading D-017 first — the answer there is likely
 * a different mechanism, not more entries in this one.
 */
export interface ObjectSchema {
  readonly type: ObjectType;
  readonly nonDerivedSlotPaths: readonly (readonly string[])[];
  readonly derivedSlots: readonly DerivedSlotSchema[];
}

// ---------------------------------------------------------------------------
// Turning a declaration into concrete Addresses (used at edge-derivation time)
// ---------------------------------------------------------------------------

/**
 * Resolves a derived slot's declared dependencies, for one object, into the
 * concrete `Address`es a future `mutation.ts` wires into the edge set.
 *
 * Why this exists as shared code rather than being inlined at each call site:
 * both branches need to happen at the SAME moment (edge derivation, §5.1 step
 * 3) and nowhere else, so the "never during evaluation" rule lives in exactly
 * one place instead of being re-stated at every future call site.
 *
 * `static`: pairs each declared same-object path with `object.id` — this is the
 * only place a static dependency path becomes a full `Address`.
 * `dynamic`: calls `dependencies.resolve(object)` directly against the object's
 * CURRENT state. The caller is responsible for calling this during edge
 * derivation and not from inside the topological pass (see file header).
 */
export function derivedSlotDependencyAddresses(
  object: GraphObject,
  dependencies: DerivedSlotDependencies,
): readonly Address[] {
  if (dependencies.kind === "static") {
    return dependencies.paths.map((path) => ({ objectId: object.id, path }));
  }
  return dependencies.resolve(object);
}

// ---------------------------------------------------------------------------
// Registry (D-011: real entries for the Phase 0 fixture types only)
// ---------------------------------------------------------------------------

/** Path constant for `value`'s one non-derived slot. */
const VALUE_VALUE_PATH: readonly string[] = ["value"];

/**
 * `value` (PROJECT_BRIEF §6): "a trivial `value` object (one literal numeric
 * slot)". That one slot is `literal`-by-default (§5.1: interchangeable with
 * `formula` at runtime) — this file declares its PATH via `nonDerivedSlotPaths`
 * but has nothing to declare under `derivedSlots`, which is genuinely empty,
 * not a placeholder.
 */
const VALUE_SCHEMA: ObjectSchema = {
  type: "value",
  nonDerivedSlotPaths: [VALUE_VALUE_PATH],
  derivedSlots: [],
};

/**
 * Path constants for `add`'s three slots, named `in.a` / `in.b` / `out.result`
 * to match the `in.<port>` / `out.<port>` convention §5.8 establishes for
 * script nodes and §5.2's own address-table example (`script_2.out.result`,
 * `script_2.in.speed`) — `add` is a smaller instance of the same shape, not a
 * separately invented naming scheme.
 */
const ADD_IN_A_PATH: readonly string[] = ["in", "a"];
const ADD_IN_B_PATH: readonly string[] = ["in", "b"];
const ADD_OUT_RESULT_PATH: readonly string[] = ["out", "result"];

/**
 * `add` (PROJECT_BRIEF §6): "two formula input slots, one derived output slot —
 * the `add` node exercises the derived-slot mechanism that geometry, text, and
 * scripts all rely on." `out.result` is the one derived slot; its compute
 * function sums `in.a` and `in.b`, propagating an upstream error unchanged
 * (§5.1: "Errors propagate") and failing closed — never throwing — on anything
 * else unexpected, INCLUDING a non-finite sum (D-025/Q-006: `1e308 + 1e308`
 * overflows to `Infinity`, which is not legal document state — mapped to
 * `#TYPE` here). This is NOT a redundant belt-and-braces check: `mutation.ts`'s
 * D-025 validateIntegrity check runs BEFORE `evaluate` in the mutation loop
 * and never re-inspects what `evaluate` itself just produced, so THIS is the
 * only guard a non-finite `derived`-slot result ever passes through —
 * verified by mutation-test (this cycle's log entry): removing it lets
 * `mutate` commit a raw `Infinity` with `ok: true`. An earlier draft of this
 * comment claimed the two checks were redundant; that was wrong and is
 * corrected here rather than left standing (see 0018-REVIEW-phase0's finding
 * 1 and 0020's own self-caught test-comment lesson — same failure shape).
 */
const ADD_SCHEMA: ObjectSchema = {
  type: "add",
  nonDerivedSlotPaths: [ADD_IN_A_PATH, ADD_IN_B_PATH],
  derivedSlots: [
    {
      path: ADD_OUT_RESULT_PATH,
      dependencies: {
        kind: "static",
        paths: [ADD_IN_A_PATH, ADD_IN_B_PATH],
      },
      compute: (object, read) => {
        const a = read({ objectId: object.id, path: ADD_IN_A_PATH });
        const b = read({ objectId: object.id, path: ADD_IN_B_PATH });
        // `undefined` means the address did not resolve at all (graph/node.ts's
        // resolveSlot) — distinct from any real Value, including `null`.
        if (a === undefined || b === undefined) {
          return { error: "#REF", message: "add: in.a/in.b did not resolve to a value" };
        }
        // §5.1: errors propagate. Check `a` first so a doubly-erroring add is
        // deterministic rather than depending on evaluation order.
        if (isErrorValue(a)) {
          return a;
        }
        if (isErrorValue(b)) {
          return b;
        }
        if (typeof a !== "number" || typeof b !== "number") {
          return { error: "#TYPE", message: "add: in.a and in.b must both be numbers" };
        }
        const sum = a + b;
        // D-025 (Q-006): a non-finite result is not legal document state.
        // Failing closed with the SAME #TYPE code the line above already uses
        // for a wrong-shaped input — and this is NOT merely the tidier of two
        // equally-safe options: mutation.ts's validateIntegrity runs BEFORE
        // `evaluate` in the mutation loop (deriveEdges -> validateIntegrity ->
        // detectCycle -> evaluate) and its result is returned AS-IS, never
        // re-validated. A non-finite `sum` returned here would commit straight
        // into `out.result`'s cached value with nothing downstream to catch
        // it — verified by mutation-test (see this cycle's log entry): with
        // this check removed, `mutate` returns `ok: true` holding a raw
        // `Infinity`. This function is the ONLY guard against that; it is not
        // a backstop for one that already exists elsewhere.
        if (!Number.isFinite(sum)) {
          return { error: "#TYPE", message: `add: in.a + in.b overflowed to a non-finite number (${sum})` };
        }
        return sum;
      },
    },
  ],
};

/**
 * The full registry. `Partial` because only the Phase 0 fixture types have
 * entries yet (see file header) — every other `ObjectType` genuinely has no
 * schema, and `getObjectSchema` reports that honestly via `undefined` rather
 * than a stand-in entry that would silently pass validation later.
 */
const SCHEMAS: Partial<Record<ObjectType, ObjectSchema>> = {
  value: VALUE_SCHEMA,
  add: ADD_SCHEMA,
};

/** Looks up an object type's schema. Pure; never throws. `undefined` for a type with no entry yet (see file header). */
export function getObjectSchema(type: ObjectType): ObjectSchema | undefined {
  return SCHEMAS[type];
}

/**
 * Looks up a single derived slot's declaration by (type, path). `undefined`
 * covers three honestly-indistinguishable cases: the type has no schema yet,
 * the type's schema exists but has no derived slot at this path, or the path
 * names a `literal`/`formula` slot instead — all three simply mean "this file
 * has nothing to say about that slot," which is exactly what `undefined`
 * means everywhere else in this codebase (`getSlot`, `resolveSlot`).
 *
 * Compares by `slotKey` (D-010), so a freshly built path array that is
 * structurally equal to a declared one still matches — this function does not
 * rely on the caller passing the exact same array reference back.
 */
export function findDerivedSlotSchema(
  type: ObjectType,
  path: readonly string[],
): DerivedSlotSchema | undefined {
  const schema = getObjectSchema(type);
  if (schema === undefined) {
    return undefined;
  }
  const key = slotKey(path);
  return schema.derivedSlots.find((entry) => slotKey(entry.path) === key);
}
