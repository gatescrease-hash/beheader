/**
 * schema.ts — Per-type slot declarations and derived-slot compute functions.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1 ("Each object type's schema declares, for every
 * derived slot: its address path, its dependencies, and its compute function.").
 * Load-bearing (§6.2).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   The registry `graph/eval.ts` and `mutation.ts` read to know, for a given object
 *   TYPE: which slots are `derived` and how to compute each (path, dependencies,
 *   compute function), and the full set of paths its NON-derived (`literal`/`formula`)
 *   slots occupy. Nothing here derives edges or evaluates anything.
 *
 *   `nonDerivedSlotPaths` is a list of GROUPS, each either `static` (a fixed path
 *   list) or `dynamic` (a function of the object's own current state).
 *   `resolveNonDerivedSlotPaths(object, groups)` is how every consumer resolves them —
 *   PER OBJECT, never per type. `table`'s `cells.*` is the dynamic case: its
 *   membership varies with that object's own `rows`/`cols`
 *   (`primitives/table.ts`'s `enumerateTableCellSlotPaths`).
 *
 *   Scope today: `value` and `add` (PROJECT_BRIEF §6's two Phase 0 fixture types,
 *   D-011), `table` (§5.4), the three PARAMETRIC geometry presets `circle`/
 *   `polygon`/`rect` (§5.5), and `text` (§5.6 — its eleven non-derived slots
 *   and BOTH derived slots, `resolvedContent` and `measuredHeight`). Every
 *   derived-slot's pure math lives in its own primitive file
 *   (`primitives/geometry.ts`, `primitives/text.ts`); this file only wires it
 *   into the registry, the same split `table`'s own entry already uses.
 *   `polyline`, `script`, and `image` have no entry; `getObjectSchema` returns
 *   `undefined` for them, honestly, rather than a placeholder. Their schemas
 *   belong to the phases/cycles that introduce them — building them now would be
 *   building ahead of the brief's §6 build order.
 *
 * INVARIANTS UPHELD HERE
 *   - Everything is declared by PATH (`["out", "result"]`), never by a hand-built key
 *     string (D-010). Comparison goes through `slotKey`, the one sanctioned way to
 *     turn a path into a comparable key. A `dynamic` group upholds the same rule the
 *     same way: it GENERATES paths from the object's own state, never decomposes an
 *     existing key back into one. This is the mechanism that lets `mutation.ts`
 *     recover a formula slot's OWN address without inverting a `GraphObject.slots`
 *     key, which has no sanctioned inverse.
 *   - Dependencies may be `static` (a fixed list of paths within the SAME object,
 *     §5.1's "centroid ← vertices") or `dynamic`. Both forms are expressible even
 *     though neither Phase 0 fixture needs `dynamic` — §5.1 names two later primitives
 *     that require it (`text.resolvedContent`, `script.out.*`), so the mechanism must
 *     support it now rather than be retrofitted.
 *   - `derivedSlotDependencyAddresses` is the ONLY place a static path list becomes a
 *     full `Address` or a dynamic resolver is invoked. Per §5.1, dynamic resolution
 *     happens during EDGE DERIVATION, never during evaluation — callers MUST call this
 *     while building the edge set, not from inside the topological pass, or Rule 6 is
 *     violated in spirit: a dynamic resolver reads the object's CURRENT state, and
 *     calling it mid-evaluation would let the dependency set drift while slots are
 *     being computed.
 *   - No `recompute()` phase is implied or supported. A `compute` function is a pure
 *     function of (object, resolved inputs via `read`, injected `EvalContext`
 *     services, and — for a compute that evaluates an embedded formula AST, i.e.
 *     `text.resolvedContent` — a `DerivedSlotComputeDeps` carrying `readRange` and
 *     the object list) that `graph/eval.ts` calls ONCE per derived slot, inside the
 *     same topological pass as every other slot kind (§5.1: "derived slots are
 *     first-class graph nodes and are evaluated inside the topological pass, exactly
 *     like formula slots").
 *   - `compute` NEVER throws. `add`'s implementation demonstrates the required shape:
 *     propagate an upstream `ErrorValue` unchanged, then fail closed with a typed
 *     `ErrorValue` — `#REF` for an unresolved dependency, `#TYPE` for a wrong-shaped
 *     value, and ALSO `#TYPE` for a non-finite result (D-025/Q-006) — rather than
 *     throwing or returning `NaN`/`undefined` (§5.1: "Errors must never throw across
 *     the evaluation loop"). Every FUTURE compute function doing arithmetic must map a
 *     non-finite result to `#TYPE` the same way, via `graph/node.ts`'s
 *     `hasIllegalNumber` (D-014's shared-predicate principle).
 *   - `add` does NOT additionally guard against a `-0` result (Q-008), and that
 *     exemption is SPECIFIC TO `+`: its inputs are already-legal `Value`s by the time
 *     it sees them (`mutation.ts` rejects `-0` before it can enter committed state),
 *     and IEEE 754 addition of two finite non-`-0` operands cannot produce `-0` — only
 *     `-0 + -0` does, which cannot arise. A future compute function using
 *     multiplication or division MUST reason about this freshly.
 *
 * NOT DONE HERE
 *   - An object type's default KIND per slot (literal vs. formula) or its
 *     creation-time default value. `nonDerivedSlotPaths` is only the PATH half: which
 *     paths exist, not what they default to. §5.1 does describe schemas as declaring a
 *     "default kind", and §5.10's creation commands (`command/commands.ts`) turned out
 *     not to need one: a creation command carries its own values, and the DERIVED half
 *     it does read from here is `derivedSlots` (D-018 requires a slot at each declared
 *     derived path). Widen this file if a second creation route ever needs a default
 *     rather than carrying its own.
 *   - Deriving an `Edge[]` from these declarations (`mutation.ts`'s `deriveEdges`,
 *     which consumes this file), cycle detection, or topological evaluation.
 *   - `polyline`/`script`/`image` schema entries (later Phase 3 cycle, Phase 6).
 */
import type { Address } from "../address.ts";
import type { EvalContext } from "../eval-context.ts";
import type { ReadRange } from "../formula/eval.ts";
import { isErrorValue, slotKey, type GraphObject, type ObjectType, type Value } from "../graph/node.ts";
import {
  computeCircleVerticesSlot,
  computePolygonVerticesSlot,
  computeRectVerticesSlot,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  POLYGON_ROTATION_PATH,
  POLYGON_SIDES_PATH,
  RADIUS_PATH,
  RECT_HEIGHT_PATH,
  RECT_WIDTH_PATH,
  VERTICES_PATH,
  verticesDerivedSlots,
} from "./geometry.ts";
import { enumerateTableCellSlotPaths, TABLE_COLS_PATH, TABLE_ROWS_PATH } from "./table.ts";
import {
  computeMeasuredHeight,
  computeMeasuredWidth,
  computeResolvedContent,
  resolveTextDependencyAddresses,
  TEXT_CONTENT_PATH,
  TEXT_HEIGHT_PATH,
  TEXT_MEASURED_HEIGHT_PATH,
  TEXT_MEASURED_WIDTH_PATH,
  TEXT_OVERFLOW_PATH,
  TEXT_RESOLVED_CONTENT_PATH,
  TEXT_STYLE_ALIGN_PATH,
  TEXT_STYLE_COLOR_PATH,
  TEXT_STYLE_FONT_PATH,
  TEXT_STYLE_FONT_SIZE_PATH,
  TEXT_STYLE_LINE_HEIGHT_PATH,
  TEXT_WIDTH_PATH,
} from "./text.ts";

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
 * - `dynamic` — a function of the object's CURRENT state AND the document's
 *   object list, returning full `Address`es rather than same-object paths,
 *   because the two documented cases are not same-object: `text.resolvedContent`
 *   depends on whatever slots its parsed content happens to reference (anywhere
 *   in the document, and it changes on every edit — and RESOLVING those
 *   references needs the object list to map names to ids and to expand a range
 *   by the target table's current extent, hence the second parameter);
 *   `script.out.*` depends on all of that node's currently declared `in.*` slots
 *   (which change as ports are added/removed — same-object, so it ignores the
 *   second parameter). MUST be evaluated only during edge derivation, never
 *   during evaluation (§5.1) — see `derivedSlotDependencyAddresses` below.
 */
export type DerivedSlotDependencies =
  | { readonly kind: "static"; readonly paths: readonly (readonly string[])[] }
  | {
      readonly kind: "dynamic";
      readonly resolve: (object: GraphObject, objects: readonly GraphObject[]) => readonly Address[];
    };

/**
 * A derived slot's compute function (§5.1). Called by `graph/eval.ts` once per
 * evaluation pass, with `read` able to resolve any `Address` — including ones
 * outside this object, for the `dynamic` dependency case — to the VALUE that
 * slot already holds from earlier in the same topological pass. `read` returns
 * `undefined` only for an address that could not be resolved at all (see
 * `graph/node.ts`'s `resolveSlot`); a compute function MUST turn that into a
 * typed `ErrorValue` rather than treating it as a JS `undefined` value, because
 * `undefined` is not a member of `Value` (§5.1).
 *
 * `context` carries §5.1's injected services — today just a `TextMeasurer`, used
 * by §5.6's `measuredHeight` (`primitives/text.ts`'s `computeMeasuredHeight`).
 * Rule 1's text-measurement trap: a compute needing to measure text calls
 * `context.measurer`, and NEVER reaches for a canvas itself. `graph/eval.ts`
 * ALWAYS supplies it (defaulting to `NULL_EVAL_CONTEXT`); it is typed optional
 * ONLY so a unit test can call a compute that ignores it in isolation — §5.1's
 * "keeps tests trivial". A compute that genuinely NEEDS a measurement must not
 * treat `undefined`/`NULL_EVAL_CONTEXT` as "measure as zero": **D-118** requires
 * it to return an `ErrorValue` (`#MEASURE`) instead — see `hasRealMeasurer`
 * (`eval-context.ts`).
 *
 * `deps` carries the extra evaluation environment a compute needs only when it
 * must ITSELF evaluate an embedded formula AST — §5.6's `resolvedContent`
 * (`primitives/text.ts`) is the sole user today. `graph/eval.ts` always supplies
 * it in the real pipeline; typed optional for the same reason `context` is (an
 * isolated unit test of a compute that ignores it — every geometry / `add`
 * compute — needn't build one). See `DerivedSlotComputeDeps` below.
 *
 * MUST NOT throw. A broken input (an error value, a wrong-shaped value, a
 * missing one) is legitimate graph state (§5.1) and must come back as an
 * `ErrorValue`, never an unwound exception.
 */
export type DerivedSlotCompute = (
  object: GraphObject,
  read: (address: Address) => Value | undefined,
  context?: EvalContext,
  deps?: DerivedSlotComputeDeps,
) => Value;

/**
 * The extra evaluation environment `graph/eval.ts`'s `evaluateDerivedSlot`
 * hands a `DerivedSlotCompute` — needed ONLY by a compute that evaluates an
 * embedded formula sub-language (§5.6's `resolvedContent`; **D-114**).
 *
 * - `readRange` — the range analogue of `read`, built on the SAME
 *   `primitives/table.ts` `enumerateRangeCellAddresses` a formula slot's
 *   evaluation uses (D-114 clause 1). A compute embedding `SUM(A1:A4)` hands
 *   this straight to `formula/eval.ts` via `evaluateBlockTree`. Optional,
 *   matching `formula/eval.ts`'s own `evaluate` — a `RangeNode` with no
 *   `readRange` wired evaluates to a disclosed `#PARSE`.
 * - `objects` — the document's object identity table, needed to RE-PARSE
 *   `content` into a block tree on demand for name -> id resolution. The tree is
 *   NEVER cached (D-114 clause 4: `content` is the single source of truth), so
 *   this is re-consulted every pass.
 */
export interface DerivedSlotComputeDeps {
  readonly readRange?: ReadRange;
  readonly objects: readonly GraphObject[];
}

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
 * One declaration inside `ObjectSchema.nonDerivedSlotPaths` (D-017).
 * Deliberately the SAME `static`/`dynamic` shape as
 * `DerivedSlotDependencies` above, applied to a different question
 * ("which non-derived paths does this object currently have," not "which
 * addresses does this derived slot currently depend on") — reusing the shape
 * rather than inventing a second one for the same underlying need (a fixed
 * list is not expressive enough; a function of the object's CURRENT state is).
 *
 * - `static` — a fixed list of paths every object of this type has, known from
 *   the schema alone (`value`'s one slot, `add`'s two, `table`'s `rows`/`cols`).
 * - `dynamic` — a function of the object's CURRENT state, returning whatever
 *   paths currently belong to the family. `table`'s `cells.*` family
 *   (`primitives/table.ts`'s `enumerateTableCellSlotPaths`) is the first and
 *   only user: cell paths are NOT fixed per type — they grow and shrink with
 *   the object's own `rows`/`cols` — so no fixed list can express them (D-017's
 *   own forward note, see below). MUST be resolved only during edge
 *   derivation, same "never during evaluation" rule as
 *   `DerivedSlotDependencies`'s `dynamic` case (Rule 6) — see
 *   `resolveNonDerivedSlotPaths` below.
 */
export type NonDerivedSlotPathGroup =
  | { readonly kind: "static"; readonly paths: readonly (readonly string[])[] }
  | { readonly kind: "dynamic"; readonly enumerate: (object: GraphObject) => readonly (readonly string[])[] };

/**
 * Resolves every `nonDerivedSlotPathGroup` in `groups`, for ONE object, into
 * the concrete list of paths currently declared — concatenating every
 * `static` group's fixed list with every `dynamic` group's `enumerate(object)`
 * result. This is the ONLY place that concatenation happens: `mutation.ts`'s
 * `deriveEdges`, `findUndeclaredFormulaOrDerivedSlots`, and
 * `findSchemaSlotKindMismatches` all call this — not
 * `schema.nonDerivedSlotPaths` directly — so the three can never disagree
 * about which paths a given object currently declares (the exact
 * disagreement D-017 exists to prevent, reached through a NEW door if the
 * three call sites each resolved `dynamic` groups their own way).
 *
 * Never throws: a `dynamic` group's `enumerate` function must not throw
 * either (`enumerateTableCellSlotPaths`'s own doc comment explains why it
 * cannot), and the concatenation below appends one path at a time — see its
 * own comment for why a spread would make this claim false at a size D-070's
 * bounds already allow.
 */
export function resolveNonDerivedSlotPaths(
  object: GraphObject,
  groups: readonly NonDerivedSlotPathGroup[],
): readonly (readonly string[])[] {
  const paths: (readonly string[])[] = [];
  for (const group of groups) {
    if (group.kind === "static") {
      paths.push(...group.paths);
    } else {
      // Appended ONE AT A TIME, never `push(...group.enumerate(object))`: a
      // dynamic family's size is DOCUMENT STATE (a table declares rows x cols
      // cell paths), and spreading an array that large into a call passes it as
      // arguments and dies of `RangeError: Maximum call stack size exceeded` —
      // measured at 0078-REVIEW between 90,000 and 130,000 paths, which
      // `table x=0 y=0 rows=1000 cols=200` reaches from one typed line with both
      // counts inside D-070's range (D-077). A `static` group's list is a literal
      // in this file, so the spread above is bounded by construction.
      for (const path of group.enumerate(object)) {
        paths.push(path);
      }
    }
  }
  return paths;
}

/**
 * Everything a given `ObjectType` declares about its slots.
 *
 * `nonDerivedSlotPaths` — the full set of `NonDerivedSlotPathGroup`
 * declarations for this type; resolve with `resolveNonDerivedSlotPaths` above
 * to get concrete paths for a given object. It is PATHS only, not a
 * default-kind declaration: §5.1 says literal and formula slots are
 * interchangeable at runtime (`link`/`unlink`), so which of the two a given
 * path currently holds is read from the object's actual `slots`, never from
 * this list. What this list answers is narrower and purely structural: "does
 * this type have a bindable slot at this path at all" — exactly what
 * `deriveEdges` needs to recover a formula slot's OWN address (see
 * `mutation.ts`'s header for why that need can't be met any other way).
 * Object CREATION reads this list for the paths it must fill and supplies the
 * VALUES itself (`command/commands.ts`) — see the file header's NOT DONE HERE.
 *
 * ONE LIMIT REMAINS, RULED ON AT 0014-REVIEW-phase0 (D-017): a resolved path
 * list is the ONLY thing `mutation.ts`'s `deriveEdges`/`validateIntegrity`
 * walk for a given object, so a formula slot an object actually carries but
 * `resolveNonDerivedSlotPaths` does not currently produce for it gets no edge
 * at all — silently, including a cycle running through it. THIS is exactly
 * why `table`'s `cells.*` group is `dynamic` rather than a best-effort fixed
 * upper bound: a fixed list large enough to "probably" cover every table
 * would still have this failure mode at its edge, silently, while `dynamic`
 * has none — it is *defined* as whatever the object's own `rows`/`cols`
 * currently say. D-017's original forward note ("being a fixed list of paths,
 * it cannot express a slot FAMILY... do not extend it for tables without
 * reading D-017 first — the answer there is likely a different mechanism, not
 * more entries in this one") is resolved BY this widening, not superseded by
 * it — no `nonDerivedSlotPaths` entry anywhere is a fixed enumeration of a
 * table's cells, matching that note's own instruction.
 */
export interface ObjectSchema {
  readonly type: ObjectType;
  readonly nonDerivedSlotPaths: readonly NonDerivedSlotPathGroup[];
  readonly derivedSlots: readonly DerivedSlotSchema[];
}

// ---------------------------------------------------------------------------
// Turning a declaration into concrete Addresses (used at edge-derivation time)
// ---------------------------------------------------------------------------

/**
 * Resolves a derived slot's declared dependencies, for one object, into the
 * concrete `Address`es `mutation.ts` wires into the edge set.
 *
 * Why this exists as shared code rather than being inlined at each call site:
 * both branches need to happen at the SAME moment (edge derivation, §5.1 step
 * 3) and nowhere else, so the "never during evaluation" rule lives in exactly
 * one place instead of being re-stated at every future call site.
 *
 * `static`: pairs each declared same-object path with `object.id` — this is the
 * only place a static dependency path becomes a full `Address`.
 * `dynamic`: calls `dependencies.resolve(object, objects)` directly against the
 * object's CURRENT state and the current document (the latter for name -> id
 * resolution and range expansion — `text.resolvedContent`). The caller is
 * responsible for calling this during edge derivation and not from inside the
 * topological pass (see file header). `objects` defaults to `[]` so the existing
 * `static`-only call sites and unit tests need no change; a `dynamic` resolver
 * that ignores it (`script.out.*`) is unaffected either way.
 */
export function derivedSlotDependencyAddresses(
  object: GraphObject,
  dependencies: DerivedSlotDependencies,
  objects: readonly GraphObject[] = [],
): readonly Address[] {
  if (dependencies.kind === "static") {
    return dependencies.paths.map((path) => ({ objectId: object.id, path }));
  }
  return dependencies.resolve(object, objects);
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
  nonDerivedSlotPaths: [{ kind: "static", paths: [VALUE_VALUE_PATH] }],
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
 * verified by mutation-test: removing it lets `mutate` commit a raw
 * `Infinity` with `ok: true`.
 */
const ADD_SCHEMA: ObjectSchema = {
  type: "add",
  nonDerivedSlotPaths: [{ kind: "static", paths: [ADD_IN_A_PATH, ADD_IN_B_PATH] }],
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
        // it — verified by mutation-test: with this check
        // removed, `mutate` returns `ok: true` holding a raw
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
 * `table` (PROJECT_BRIEF §5.4): "Each cell is a slot, literal or formula" over
 * a grid whose "rows and columns can be added or removed," positioned on the
 * canvas by §5.10's own `table x=0 y=0` arguments. FOUR FIXED non-derived
 * slots — `origin.x`/`origin.y` (the same two paths every geometry preset
 * uses, imported rather than re-spelled, because `render/renderer.ts`,
 * `render/hittest.ts` and `render/interaction.ts` all read a table's position
 * from them and a second spelling would give one object two positions) plus
 * `rows`/`cols` (§5.10's own command-line words, ordinary literal number
 * slots) — plus one DYNAMIC non-derived slot FAMILY (`cells.*`), whose
 * membership is the object's own CURRENT `rows`/`cols` — see
 * `primitives/table.ts`'s `enumerateTableCellSlotPaths` for why this must be
 * `dynamic` rather than a fixed list (D-017's forward note). No derived
 * slots: §5.4 does not give a table object itself any computed slot (a
 * cell's OWN value may be a `formula` slot, which is a different thing —
 * `derivedSlots` here is about slots the SCHEMA computes, and nothing about
 * a table itself is schema-computed in v1).
 *
 * Declaring `origin.x`/`origin.y` is what makes them ordinary slots rather
 * than tolerated undeclared ones: only a DECLARED path may hold a `formula`
 * slot (D-017), so this is what lets `link table_x.origin.x <address>` bind a
 * table's position to a cell the way a polygon's already binds.
 */
const TABLE_SCHEMA: ObjectSchema = {
  type: "table",
  nonDerivedSlotPaths: [
    { kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, TABLE_ROWS_PATH, TABLE_COLS_PATH] },
    { kind: "dynamic", enumerate: enumerateTableCellSlotPaths },
  ],
  derivedSlots: [],
};

/**
 * `circle`/`polygon`/`rect` (§5.5): the three PARAMETRIC geometry presets.
 * Each declares a `vertices` derived slot (its own `DerivedSlotCompute`,
 * imported from `primitives/geometry.ts`, statically depending on that
 * type's own parameter paths) plus the eight shared slots
 * `geometry.ts`'s `verticesDerivedSlots` bundles (`centroid.x/y`, `area`,
 * `length`, `bounds.*` — all statically depending on `["vertices"]` alone,
 * §5.1's own worked example). Unlike `table`, none of these three needed a
 * `dynamic` `NonDerivedSlotPathGroup`: a preset's parameter COUNT never
 * changes (Rule 6; §5.5's own reason presets expose one `vertices` slot
 * rather than per-vertex ones), so a `static` list is the correct — not
 * merely convenient — declaration for every non-derived path below.
 */
const CIRCLE_SCHEMA: ObjectSchema = {
  type: "circle",
  nonDerivedSlotPaths: [{ kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, RADIUS_PATH] }],
  derivedSlots: [
    { path: VERTICES_PATH, dependencies: { kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, RADIUS_PATH] }, compute: computeCircleVerticesSlot },
    ...verticesDerivedSlots("circle"),
  ],
};

const POLYGON_SCHEMA: ObjectSchema = {
  type: "polygon",
  nonDerivedSlotPaths: [{ kind: "static", paths: [POLYGON_SIDES_PATH, RADIUS_PATH, ORIGIN_X_PATH, ORIGIN_Y_PATH, POLYGON_ROTATION_PATH] }],
  derivedSlots: [
    {
      path: VERTICES_PATH,
      dependencies: { kind: "static", paths: [POLYGON_SIDES_PATH, RADIUS_PATH, ORIGIN_X_PATH, ORIGIN_Y_PATH, POLYGON_ROTATION_PATH] },
      compute: computePolygonVerticesSlot,
    },
    ...verticesDerivedSlots("polygon"),
  ],
};

const RECT_SCHEMA: ObjectSchema = {
  type: "rect",
  nonDerivedSlotPaths: [{ kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, RECT_WIDTH_PATH, RECT_HEIGHT_PATH] }],
  derivedSlots: [
    {
      path: VERTICES_PATH,
      dependencies: { kind: "static", paths: [ORIGIN_X_PATH, ORIGIN_Y_PATH, RECT_WIDTH_PATH, RECT_HEIGHT_PATH] },
      compute: computeRectVerticesSlot,
    },
    ...verticesDerivedSlots("rect"),
  ],
};

/**
 * `text` (PROJECT_BRIEF §5.6): "One text object type, not two." ELEVEN fixed
 * non-derived slots (`origin.x`/`origin.y` + `content` + `width`/`height`/
 * `overflow` + five `style.*`, all `static` — a `text` object's slot set never
 * changes, Rule 6) and TWO derived slots, `resolvedContent` (entry 0127) and
 * `measuredHeight` (entry 0129). The `content`/`width`/`height`/`overflow`/
 * `style.*` paths and both compute functions live in `primitives/text.ts` (the
 * pure-logic-here / registry-there split — `text.ts` reads several of the
 * paths, so one spelling must serve both); this entry only wires them.
 *
 * `origin.x`/`origin.y` (**D-121**, answering Q-022) reuse `primitives/
 * geometry.ts`'s `ORIGIN_X_PATH`/`ORIGIN_Y_PATH` — the identical spelling
 * `circle`/`polygon`/`rect`/`table` already use, so `render/interaction.ts`'s
 * origin-drag path and a `link text_1.origin.y intersection_a.centroid.y`
 * (Phase 7) both work with no `text`-specific code. §5.6's `TextBox` block omits
 * a position, but so does §5.4's for `table`, and §5.10's own `text x=0 y=0`
 * grammar, §5.7's `image`, and Phase 7 all need one — D-121 reconciles that. Both
 * are ordinary `literal` slots and NOT dependency-required (nothing derived
 * reads them): an absent one is tolerated exactly as every other primitive's
 * origin is (`findSchemaSlotKindMismatches`); the `text` command always creates
 * them, `x=`/`y=` defaulting to `0`.
 *
 * `resolvedContent`'s dependencies are `dynamic` (§5.1 names it as one of the two
 * cases that require the form): whatever `content`'s parsed block tree
 * references, re-derived every mutation by `resolveTextDependencyAddresses` —
 * which also returns `content` itself, so a `formula`-driven `content`
 * re-triggers and `computeResolvedContent` may `read` it. Its compute evaluates
 * the block tree through the `read`/`readRange` `graph/eval.ts`'s
 * `evaluateDerivedSlot` builds to a formula slot's own contract (**D-114**: D-110
 * coercion, a real range reader, clause 3's ordering) — never a second
 * evaluation path.
 *
 * `measuredHeight` (§5.6) and `measuredWidth` (**D-123**) share ONE `static`
 * dependency list — `resolvedContent` + `width` +
 * `style.font`/`style.fontSize`/`style.lineHeight` (§5.6: "from `resolvedContent`,
 * `width`, and `style`"; `color`/`align` do not affect size) — and ONE
 * measurement: both computes call `primitives/text.ts`'s `measureTextBox` and
 * take their own component off its result, which is how D-123 clause 2's "never
 * one succeeding while the other fails" holds by construction. Both return
 * `#MEASURE` (**D-118**) rather than a size off `NULL_EVAL_CONTEXT`'s zero-box
 * measurer, which is what a `mutate` caller with no wired measurer passes.
 * **D-120** (answering Q-021): the `width` slot reaches `measure` as `maxWidth`
 * and wrapping is the measurer implementation's job (`render/measure.ts`).
 *
 * `measuredWidth` is the ONE derived slot here §5.6 does not name. D-123 rules it
 * a deliberate extension of that list: `render/extent.ts` is pure, cannot measure
 * glyphs, and `DEFAULT_TEXT_WIDTH` is `"auto"`, so without it §5.9's "bounding
 * box for text" and D-066's one-extent rule cannot both hold for a
 * command-created `text` object.
 */
const TEXT_SCHEMA: ObjectSchema = {
  type: "text",
  nonDerivedSlotPaths: [
    {
      kind: "static",
      paths: [
        // D-121: same spelling as every other positioned object, imported from
        // `primitives/geometry.ts` rather than re-declared (Q-022 answered).
        ORIGIN_X_PATH,
        ORIGIN_Y_PATH,
        TEXT_CONTENT_PATH,
        TEXT_WIDTH_PATH,
        TEXT_HEIGHT_PATH,
        TEXT_OVERFLOW_PATH,
        TEXT_STYLE_FONT_PATH,
        TEXT_STYLE_FONT_SIZE_PATH,
        TEXT_STYLE_LINE_HEIGHT_PATH,
        TEXT_STYLE_COLOR_PATH,
        TEXT_STYLE_ALIGN_PATH,
      ],
    },
  ],
  derivedSlots: [
    {
      path: TEXT_RESOLVED_CONTENT_PATH,
      dependencies: { kind: "dynamic", resolve: resolveTextDependencyAddresses },
      compute: computeResolvedContent,
    },
    {
      path: TEXT_MEASURED_HEIGHT_PATH,
      dependencies: {
        kind: "static",
        paths: [
          TEXT_RESOLVED_CONTENT_PATH,
          TEXT_WIDTH_PATH,
          TEXT_STYLE_FONT_PATH,
          TEXT_STYLE_FONT_SIZE_PATH,
          TEXT_STYLE_LINE_HEIGHT_PATH,
        ],
      },
      compute: computeMeasuredHeight,
    },
    {
      // D-123 clause 1: the same dependency list as `measuredHeight`, unchanged —
      // one measurement answers both, so they must subscribe to the same inputs.
      path: TEXT_MEASURED_WIDTH_PATH,
      dependencies: {
        kind: "static",
        paths: [
          TEXT_RESOLVED_CONTENT_PATH,
          TEXT_WIDTH_PATH,
          TEXT_STYLE_FONT_PATH,
          TEXT_STYLE_FONT_SIZE_PATH,
          TEXT_STYLE_LINE_HEIGHT_PATH,
        ],
      },
      compute: computeMeasuredWidth,
    },
  ],
};

/**
 * The full registry. `Partial` because most `ObjectType`s have no schema entry
 * yet (see file header) — those genuinely have none, and `getObjectSchema`
 * reports that honestly via `undefined` rather than a stand-in entry that
 * would silently pass validation later.
 */
const SCHEMAS: Partial<Record<ObjectType, ObjectSchema>> = {
  value: VALUE_SCHEMA,
  add: ADD_SCHEMA,
  table: TABLE_SCHEMA,
  circle: CIRCLE_SCHEMA,
  polygon: POLYGON_SCHEMA,
  rect: RECT_SCHEMA,
  text: TEXT_SCHEMA,
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
