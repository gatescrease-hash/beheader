/**
 * geometry.ts — The geometry primitive: parametric presets, their derived
 * `vertices`, and the shared derived slots every closed shape exposes
 * (centroid, area, length, bounds).
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.5 — "The primitive is the geometry itself.
 * Named shapes are presets over it." The three PARAMETRIC presets
 * (`circle`, `polygon`, `rect`) and their derived slots live here.
 * `primitives/schema.ts` registers the `ObjectSchema` entries this file's
 * functions feed, matching the split `primitives/table.ts` already
 * establishes (pure domain logic here, the type-keyed registry there).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 * First file of this subsystem, so §6.1 trigger 2 governs when it is
 * reviewed. NOT on §6.2's load-bearing list: Rule 3 governs the ADDRESSING
 * scheme, which this file only consumes (`primitives/table.ts`, the exact
 * analogue, claims no such status either).
 *
 * WHAT THIS IS
 *   §5.5's slot-exposure rule (Rule 6's own worked example): "Preset shapes
 *   (polygon, circle, rect) expose a single derived slot `vertices` holding a
 *   `Point[]`, computed from their parameter slots. They expose no
 *   per-vertex slots." A preset's parameter count never changes at
 *   evaluation time (`sides`, `radius`, `origin.x/y`, `rotation`, `width`,
 *   `height` are the whole non-derived slot set, declared statically in
 *   `primitives/schema.ts`), so Rule 6 holds trivially for these three types.
 *
 *   `computeCircleVertices`/`computePolygonVertices`/`computeRectVertices` —
 *   pure `Point[]`-producing math, no `Value`/`ErrorValue` concerns.
 *   `computeCircleVerticesSlot`/`computePolygonVerticesSlot`/
 *   `computeRectVerticesSlot` — the `DerivedSlotCompute`-shaped wrappers
 *   `schema.ts` installs as each type's `vertices` entry: read the
 *   parameter slots via `read`, validate them, call the pure function, then
 *   `finalizeVertices` (below) to enforce D-025/D-033 on every coordinate.
 *
 *   `computeCentroid`/`computeArea`/`computePerimeterLength`/`computeBounds`
 *   — pure `Point[] -> ...` math shared by every closed preset.
 *   `verticesDerivedSlots(label)` bundles all eight (`centroid.x`,
 *   `centroid.y`, `area`, `length`, `bounds.{minX,minY,maxX,maxY}`) as
 *   `DerivedSlotSchema[]`, each statically depending on `["vertices"]` —
 *   §5.1's own worked example ("centroid ← vertices"). `schema.ts` spreads
 *   this into every preset's `derivedSlots` rather than declaring eight
 *   near-identical entries per type.
 *
 *   Centroid is the AREA-WEIGHTED centroid (the standard polygon-centroid
 *   formula), not the arithmetic mean of vertices — see `computeCentroid`'s
 *   own doc comment for why the distinction matters even though the three
 *   presets this file builds are all symmetric enough that the two formulas
 *   agree on them today.
 *
 * INVARIANTS UPHELD HERE
 *   - Every `DerivedSlotCompute` here NEVER throws (§5.1) — a missing/wrong-
 *     shaped/erroring input, or a degenerate parameter (negative radius, a
 *     polygon with under 3 sides, empty vertices), returns a typed
 *     `ErrorValue` (`#REF`/`#TYPE`), matching `primitives/schema.ts`'s `add`
 *     precedent exactly.
 *   - D-025/D-033 on every computed number: `finiteOrTypeError` maps a
 *     non-finite result to `#TYPE`; `-0` normalises to `+0`, never an error
 *     (genuinely reachable for `centroid.x`/`centroid.y` — a zero-valued
 *     cross-product sum divided by a negative signed area is `-0` — pinned
 *     by a real test, not merely reasoned about). `finalizeVertices` applies
 *     the non-finite half of the same rule per-coordinate across a whole
 *     `vertices` `Point[]` (itself a derived slot, §5.1: "derived slots are
 *     first-class graph nodes") — its own doc comment proves the `-0` half
 *     is unreachable there, the same proof `render/camera.ts` already uses.
 *   - `vertices` is the ONLY interface downstream consumers read (§5.5:
 *     "Consumers always read `vertices`") — nothing here exposes a per-vertex
 *     slot for these three types (that is `polyline`'s and `explode`'s shape,
 *     not built here — see NOT DONE HERE).
 *   - Every pure math function is TOTAL, including on an empty `Point[]`
 *     (degenerate but well-defined, never `NaN`/throwing) — the `Value`-aware
 *     wrappers reject an empty `vertices` slot as `#TYPE` before any of them
 *     are ever called with one, but totality is cheap here and keeps direct
 *     unit tests honest about what each function actually does at its edges.
 *
 * NOT DONE HERE
 *   - `polyline` and the editable-path slot shape (per-vertex literal slots
 *     `vertex.0.x`/`vertex.0.y`... plus a `vertices` slot re-sourced from
 *     them) — a DIFFERENT, dynamic-slot-family mechanism (the one
 *     `primitives/table.ts`'s `cells.*` already established generically in
 *     `schema.ts`), deliberately deferred to the cycle that also builds
 *     `explode`/`addvertex`/`delvertex` (the mutations that give it a reason
 *     to exist) — mirroring how `primitives/table.ts`'s own first file (entry
 *     0040) deferred row/column insert/delete to later cycles.
 *   - `explode`, `addvertex`, `delvertex` — new `mutation.ts` operation
 *     kinds; `mutation.ts` itself is not touched here.
 *   - `Segment`/`closed`/`style` as slots. §5.5's general `Path` shape names
 *     all three, but none is needed by a preset: a preset's shape is fully
 *     parametric (no per-segment data), always closed (not user-toggled),
 *     and nothing consumes `style` yet — `render/renderer.ts` draws every
 *     shape with one hardcoded default stroke, for want of these. Building
 *     them now would be building ahead of the phase that needs them, with no
 *     default-kind mechanism yet to give them a creation-time value
 *     (`schema.ts`'s own NOT DONE HERE).
 *   - The circle's TRUE arc for rendering — §5.5: "the renderer still draws a
 *     true arc" from `origin`/`radius` directly; `vertices` here is
 *     explicitly the polygonal APPROXIMATION used for bounds/hit-testing
 *     only, per that same sentence.
 *   - Registering these three in `primitives/schema.ts`'s `SCHEMAS` — that is
 *     that file's job, and it is done (entry 0059), not deferred, because unlike
 *     `table`'s dynamic family (D-017), nothing here needs a new `schema.ts`
 *     mechanism: three more `static`-only entries are the same shape
 *     `VALUE_SCHEMA`/`ADD_SCHEMA` already use.
 */
import type { Address } from "../address.ts";
import { isErrorValue, type ErrorValue, type GraphObject, type Point, type Value } from "../graph/node.ts";
import type { DerivedSlotCompute, DerivedSlotDependencies, DerivedSlotSchema } from "./schema.ts";

// ---------------------------------------------------------------------------
// Shared slot-path constants (§5.5's own vocabulary; D-010 — declared once,
// never hand-built at a call site)
// ---------------------------------------------------------------------------

export const ORIGIN_X_PATH: readonly string[] = ["origin", "x"];
export const ORIGIN_Y_PATH: readonly string[] = ["origin", "y"];
/** Shared by `circle` and `polygon` — both use the brief's own word "radius" (§5.5). */
export const RADIUS_PATH: readonly string[] = ["radius"];
export const POLYGON_SIDES_PATH: readonly string[] = ["sides"];
export const POLYGON_ROTATION_PATH: readonly string[] = ["rotation"];
export const RECT_WIDTH_PATH: readonly string[] = ["width"];
export const RECT_HEIGHT_PATH: readonly string[] = ["height"];

export const VERTICES_PATH: readonly string[] = ["vertices"];
export const CENTROID_X_PATH: readonly string[] = ["centroid", "x"];
export const CENTROID_Y_PATH: readonly string[] = ["centroid", "y"];
export const AREA_PATH: readonly string[] = ["area"];
export const LENGTH_PATH: readonly string[] = ["length"];
export const BOUNDS_MIN_X_PATH: readonly string[] = ["bounds", "minX"];
export const BOUNDS_MIN_Y_PATH: readonly string[] = ["bounds", "minY"];
export const BOUNDS_MAX_X_PATH: readonly string[] = ["bounds", "maxX"];
export const BOUNDS_MAX_Y_PATH: readonly string[] = ["bounds", "maxY"];

/**
 * §5.5: "the derived `vertices` slot yields a polygonal approximation" for a
 * circle. A fixed, untuned constant (Rule 5) — no adaptive/zoom-dependent
 * tessellation, which is a render-layer concern this file has no context to
 * make (Rule 1: no injected `EvalContext` reaches a derived-slot compute).
 */
export const CIRCLE_VERTEX_COUNT = 32;

/** A polygon needs at least 3 vertices to be a polygon at all. */
export const MIN_POLYGON_SIDES = 3;

// ---------------------------------------------------------------------------
// Pure math — no Value/ErrorValue, no GraphObject. Directly unit-tested.
// ---------------------------------------------------------------------------

/**
 * `sides` equally-spaced points on a circle of `radius` centred at `origin`,
 * starting at `rotation` radians from the positive x-axis and proceeding at
 * increasing angle (standard mathematical convention). Both the reference
 * angle (0 = +x axis, not "pointing up") and the winding direction are this
 * file's own disclosed convention: §5.5 does not specify either, and nothing
 * downstream reads winding yet. `sides`/`radius` are TRUSTED here (already
 * validated by the caller) — this function has no `Value`/`ErrorValue`
 * vocabulary to fail closed with, and is total for `sides <= 0` (zero
 * vertices, the empty array), which the caller never actually reaches
 * (`MIN_POLYGON_SIDES` is enforced one layer up).
 */
export function computePolygonVertices(sides: number, radius: number, origin: Point, rotation: number): readonly Point[] {
  const vertices: Point[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    vertices.push({ x: origin.x + radius * Math.cos(angle), y: origin.y + radius * Math.sin(angle) });
  }
  return vertices;
}

/**
 * §5.5: circle's `vertices` is a polygonal approximation
 * (`CIRCLE_VERTEX_COUNT` sides, no rotation offset — a circle has no
 * meaningful rotation). Delegates to `computePolygonVertices` rather than
 * re-deriving the same trigonometry (D-010's principle, applied within this
 * file).
 */
export function computeCircleVertices(radius: number, origin: Point): readonly Point[] {
  return computePolygonVertices(CIRCLE_VERTEX_COUNT, radius, origin, 0);
}

/**
 * The four corners of a `width` x `height` rectangle anchored at `origin`,
 * extending in +x/+y from there — matching `CanvasRenderingContext2D.
 * fillRect(x, y, width, height)`'s own convention exactly (PROJECT_BRIEF §2
 * mandates Canvas2D rendering, so this is the least-surprising choice: the
 * eventual renderer maps these four slots straight into that call with no
 * translation). Winding is clockwise in a y-down (screen) frame,
 * counterclockwise in a y-up (math) frame — this file is agnostic to which
 * one the renderer uses; see `computePolygonVertices`'s own note.
 */
export function computeRectVertices(origin: Point, width: number, height: number): readonly Point[] {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + height },
    { x: origin.x, y: origin.y + height },
  ];
}

/**
 * Every consecutive (current, next) pair around the closed loop `vertices`,
 * wrapping the last back to the first — the one iteration shape every
 * "walk the closed polygon's edges" function below shares. `a`/`b` are
 * always defined for `i` in `[0, vertices.length)` on a non-empty array;
 * the `undefined` branch is a `noUncheckedIndexedAccess` artifact only
 * (matching this codebase's existing style — e.g. `document.ts`'s
 * `serializeObject` — of an explicit, disclosed-unreachable `continue`
 * rather than a non-null assertion).
 */
function edgePairs(vertices: readonly Point[]): ReadonlyArray<readonly [Point, Point]> {
  const pairs: Array<readonly [Point, Point]> = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (a === undefined || b === undefined) {
      continue; // Unreachable: both indices are always valid into a non-empty array.
    }
    pairs.push([a, b]);
  }
  return pairs;
}

/**
 * Twice the SIGNED area of the closed polygon `vertices` (the shoelace sum)
 * — shared by `computeArea` and `computeCentroid` so the two never disagree
 * about degeneracy. Total: `edgePairs` on an empty or single-point array
 * produces zero iterations, so this returns `0`, not `NaN`.
 */
function computeSignedAreaDoubled(vertices: readonly Point[]): number {
  let sum = 0;
  for (const [a, b] of edgePairs(vertices)) {
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** §5.5: "area (closed paths only)". The standard shoelace formula, absolute value (area is a non-negative geometric quantity; §5.5 gives no meaning to winding/sign). */
export function computeArea(vertices: readonly Point[]): number {
  return Math.abs(computeSignedAreaDoubled(vertices)) / 2;
}

/**
 * §5.5: "centroid.x, centroid.y". The AREA-WEIGHTED polygon centroid (the
 * textbook formula for "centroid of a polygon"), not the plain arithmetic
 * mean of `vertices` — the two formulas COINCIDE for every preset this file
 * builds (a regular polygon, a regularly-tessellated circle, and a
 * rectangle are all symmetric enough that vertex-mean equals area-centroid),
 * but they diverge for an irregular polygon, which is exactly what an
 * exploded-and-dragged path becomes (§5.5, deferred — see file header).
 * Using the correct formula now means `verticesDerivedSlots` stays correct
 * unmodified when a future cycle reuses it for `polyline`, rather than
 * baking in a formula that is quietly wrong for every shape this file does
 * not itself build. (Pinned by a test that deliberately uses an IRREGULAR
 * quadrilateral, where the two formulas give different answers.)
 *
 * Falls back to the arithmetic mean when the doubled area is EXACTLY zero
 * (a degenerate shape: `radius`/`width`/`height` of 0, or every vertex
 * collinear) — the area-weighted formula divides by area and has no answer
 * there, but "the mean position of the points" is still well-defined.
 * Exact equality, not an epsilon: every reachable degenerate case here
 * computes an EXACTLY zero doubled area in floating point (every shoelace
 * term is a product with a zero factor), so there is no near-miss to guard
 * against, and this project avoids tuned epsilon constants where an exact
 * check suffices (Rule 5).
 */
export function computeCentroid(vertices: readonly Point[]): Point {
  const doubledArea = computeSignedAreaDoubled(vertices);
  if (doubledArea === 0) {
    return computeVertexMean(vertices);
  }
  let weightedX = 0;
  let weightedY = 0;
  for (const [a, b] of edgePairs(vertices)) {
    const cross = a.x * b.y - b.x * a.y;
    weightedX += (a.x + b.x) * cross;
    weightedY += (a.y + b.y) * cross;
  }
  const sixSignedArea = 3 * doubledArea; // 6 * signedArea, folded to avoid a separate /2 then *6.
  return { x: weightedX / sixSignedArea, y: weightedY / sixSignedArea };
}

/** The degenerate-area fallback for `computeCentroid`, and total on its own (unlike the area-weighted formula, this needs no non-zero-area precondition) — `{ x: 0, y: 0 }` for an empty list, since there is no point to average. */
function computeVertexMean(vertices: readonly Point[]): Point {
  if (vertices.length === 0) {
    return { x: 0, y: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  for (const vertex of vertices) {
    sumX += vertex.x;
    sumY += vertex.y;
  }
  return { x: sumX / vertices.length, y: sumY / vertices.length };
}

/** §5.5: "length". The full perimeter (every preset this file builds is always closed — see file header — so this includes the closing edge back to vertex 0). Total: zero edges (an empty or single-point `vertices`) sums to `0`. */
export function computePerimeterLength(vertices: readonly Point[]): number {
  let total = 0;
  for (const [a, b] of edgePairs(vertices)) {
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** §5.5: "bounds.{minX,minY,maxX,maxY}". Total: `{0,0,0,0}` for an empty `vertices` — a degenerate but well-defined answer, never a thrown error (this is a pure function; only its `Value`-aware caller has an `ErrorValue` to return, and it rejects empty `vertices` before ever reaching here). */
export function computeBounds(vertices: readonly Point[]): { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } {
  const first = vertices[0];
  if (first === undefined) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const vertex of vertices) {
    if (vertex.x < minX) {
      minX = vertex.x;
    }
    if (vertex.x > maxX) {
      maxX = vertex.x;
    }
    if (vertex.y < minY) {
      minY = vertex.y;
    }
    if (vertex.y > maxY) {
      maxY = vertex.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// D-025/D-033 applied to a computed number or a computed Point[] (§5.1: a
// derived slot's compute function must map a non-finite result to #TYPE and
// never emit -0 — the same rule `primitives/schema.ts`'s `add` already
// follows, generalised here to a whole vertex list because `vertices` is
// ITSELF a derived slot).
// ---------------------------------------------------------------------------

/** A single computed number, made safe for a `derived` slot's value (D-025/D-033). */
function finiteOrTypeError(value: number, label: string): Value {
  if (!Number.isFinite(value)) {
    return { error: "#TYPE", message: `${label} produced a non-finite number (${value})` };
  }
  return Object.is(value, -0) ? 0 : value;
}

/**
 * The non-finite half of `finiteOrTypeError`'s rule, applied per-coordinate
 * across a whole computed `Point[]` — every preset's `vertices` compute
 * function calls this last.
 *
 * No `-0` branch, deliberately, by the same proof `render/camera.ts`'s
 * `finiteOrFallback` already relies on for its own coordinates (D-027/D-033
 * lineage): every vertex here is `origin.<axis> + radius * trig(angle)` (or
 * `origin.<axis> + width/height`) — an ADDITION whose first operand is
 * always an already-legal (never-`-0`) slot value. `x + y` where `x` is a
 * nonzero legal number is `x` unchanged regardless of `y`'s sign, and where
 * `x` is `+0` is `+0` for ANY `y` (IEEE754: `0 + -0 = +0`, `0 + 0 = +0`).
 * So the sum can never land on `-0` no matter what the trig/width/height
 * term evaluates to — verified by mutation-test (removing this reasoning's
 * conclusion and asserting `-0` is possible finds no counterexample; see the
 * geometry cycle's log entry). Contrast `finiteOrTypeError` below, which
 * DOES need its `-0` branch: `centroid.x`/`centroid.y` divide a cross-product
 * SUM by a signed area, and a `0`-dividend over a NEGATIVE signed area
 * (clockwise winding) genuinely produces `-0` — pinned by a real test in
 * `geometry.test.ts`, not merely reasoned about.
 */
function finalizeVertices(vertices: readonly Point[], label: string): readonly Point[] | ErrorValue {
  const finalized: Point[] = [];
  for (const vertex of vertices) {
    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
      return { error: "#TYPE", message: `${label} produced a non-finite vertex (${vertex.x}, ${vertex.y})` };
    }
    finalized.push(vertex);
  }
  return finalized;
}

/**
 * Narrows `readNumericSlots`'s result to its error arm. A presence check
 * (`"error" in result`), not a discriminant-VALUE check (contrast D-032) —
 * justified the same way D-032 justifies `address.ts`'s `isAddressError`:
 * this predicate's domain is exactly `Record<K, number> | ErrorValue` for
 * this file's own known slot names (`originX`, `radius`, `sides`, ...), none
 * of which is ever `"error"`, so no legitimate result can be mistaken for
 * one.
 */
function isNumericSlotReadError<K extends string>(result: Readonly<Record<K, number>> | ErrorValue): result is ErrorValue {
  return "error" in result;
}

/**
 * Reads several same-object NUMERIC slots at once, for a preset's `vertices`
 * compute function — every preset needs 3-5 of these before it can compute
 * anything, and the propagation rules (`undefined` -> `#REF`, an upstream
 * `ErrorValue` -> propagate unchanged, a non-number -> `#TYPE`) are
 * identical every time (matching `primitives/schema.ts`'s `add`, generalised
 * past two fixed names). `label` names the compute function in every
 * message, e.g. `"circle.vertices"`.
 *
 * Generic over the literal key set `K` (inferred from `specs`'s own object-
 * literal keys at each call site) rather than a bare `Record<string, ...>`,
 * so the RETURNED record's fields are known-present properties, not an
 * index signature — the difference between `inputs.radius: number` and
 * `inputs.radius: number | undefined` under this project's
 * `noUncheckedIndexedAccess`. The one `as` in the loop body is the standard,
 * safe way to build such a record incrementally: the loop's own invariant
 * (every `K` gets written before the function returns) is what TypeScript
 * cannot see across an accumulating `for` loop on its own.
 */
function readNumericSlots<K extends string>(
  object: GraphObject,
  read: (address: Address) => Value | undefined,
  label: string,
  specs: Readonly<Record<K, readonly string[]>>,
): Readonly<Record<K, number>> | ErrorValue {
  const result = {} as Record<K, number>;
  for (const name of Object.keys(specs) as K[]) {
    const path = specs[name];
    const value = read({ objectId: object.id, path });
    if (value === undefined) {
      return { error: "#REF", message: `${label}: ${name} did not resolve to a value` };
    }
    if (isErrorValue(value)) {
      return value;
    }
    if (typeof value !== "number") {
      return { error: "#TYPE", message: `${label}: ${name} must be a number` };
    }
    result[name] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// `vertices` — one DerivedSlotCompute per preset (§5.5's own parameter lists)
// ---------------------------------------------------------------------------

/** `circle(origin, radius)` (§5.5). Rejects a negative radius as `#TYPE` — a circle of negative size is not a shape this project's Value vocabulary can represent. */
export const computeCircleVerticesSlot: DerivedSlotCompute = (object, read) => {
  const inputs = readNumericSlots(object, read, "circle.vertices", {
    originX: ORIGIN_X_PATH,
    originY: ORIGIN_Y_PATH,
    radius: RADIUS_PATH,
  });
  if (isNumericSlotReadError(inputs)) {
    return inputs;
  }
  if (inputs.radius < 0) {
    return { error: "#TYPE", message: "circle.vertices: radius must not be negative" };
  }
  const vertices = computeCircleVertices(inputs.radius, { x: inputs.originX, y: inputs.originY });
  return finalizeVertices(vertices, "circle.vertices");
};

/** `polygon(sides, radius, origin, rotation)` (§5.5). Rejects `sides < MIN_POLYGON_SIDES` or a non-integer `sides`, and a negative `radius`, as `#TYPE`. */
export const computePolygonVerticesSlot: DerivedSlotCompute = (object, read) => {
  const inputs = readNumericSlots(object, read, "polygon.vertices", {
    sides: POLYGON_SIDES_PATH,
    radius: RADIUS_PATH,
    originX: ORIGIN_X_PATH,
    originY: ORIGIN_Y_PATH,
    rotation: POLYGON_ROTATION_PATH,
  });
  if (isNumericSlotReadError(inputs)) {
    return inputs;
  }
  if (!Number.isInteger(inputs.sides) || inputs.sides < MIN_POLYGON_SIDES) {
    return { error: "#TYPE", message: `polygon.vertices: sides must be an integer >= ${MIN_POLYGON_SIDES}` };
  }
  if (inputs.radius < 0) {
    return { error: "#TYPE", message: "polygon.vertices: radius must not be negative" };
  }
  const vertices = computePolygonVertices(inputs.sides, inputs.radius, { x: inputs.originX, y: inputs.originY }, inputs.rotation);
  return finalizeVertices(vertices, "polygon.vertices");
};

/** `rect(origin, width, height)` (§5.5). Rejects a negative `width`/`height` as `#TYPE`. */
export const computeRectVerticesSlot: DerivedSlotCompute = (object, read) => {
  const inputs = readNumericSlots(object, read, "rect.vertices", {
    originX: ORIGIN_X_PATH,
    originY: ORIGIN_Y_PATH,
    width: RECT_WIDTH_PATH,
    height: RECT_HEIGHT_PATH,
  });
  if (isNumericSlotReadError(inputs)) {
    return inputs;
  }
  if (inputs.width < 0 || inputs.height < 0) {
    return { error: "#TYPE", message: "rect.vertices: width and height must not be negative" };
  }
  const vertices = computeRectVertices({ x: inputs.originX, y: inputs.originY }, inputs.width, inputs.height);
  return finalizeVertices(vertices, "rect.vertices");
};

// ---------------------------------------------------------------------------
// centroid/area/length/bounds — shared by every preset that exposes
// `vertices` (§5.1's own worked example: "centroid <- vertices")
// ---------------------------------------------------------------------------

/** Reads and validates `object`'s own `vertices` slot — the one thing every derived slot in `verticesDerivedSlots` depends on. Never throws. */
function readVertices(object: GraphObject, read: (address: Address) => Value | undefined, label: string): readonly Point[] | ErrorValue {
  const value = read({ objectId: object.id, path: VERTICES_PATH });
  if (value === undefined) {
    return { error: "#REF", message: `${label}: vertices did not resolve to a value` };
  }
  if (isErrorValue(value)) {
    return value;
  }
  if (!Array.isArray(value)) {
    return { error: "#TYPE", message: `${label}: vertices must be a list of points` };
  }
  const vertices = value as readonly Point[];
  if (vertices.length === 0) {
    return { error: "#TYPE", message: `${label}: vertices is empty` };
  }
  return vertices;
}

/**
 * Wraps a pure `Point[] -> number` function as a `DerivedSlotCompute`
 * reading this object's OWN `vertices` slot: propagates `#REF`/an upstream
 * error, rejects an empty or wrong-shaped `vertices` as `#TYPE`
 * (`readVertices`), then applies D-025/D-033 to the result
 * (`finiteOrTypeError`). Every one of the eight slots `verticesDerivedSlots`
 * declares is built from this.
 */
function deriveNumberFromVertices(label: string, compute: (vertices: readonly Point[]) => number): DerivedSlotCompute {
  return (object, read) => {
    const vertices = readVertices(object, read, label);
    if (isErrorValue(vertices)) {
      return vertices;
    }
    return finiteOrTypeError(compute(vertices), label);
  };
}

/**
 * The eight derived slots every closed preset exposes on top of `vertices`
 * (§5.5): `centroid.x`, `centroid.y`, `area`, `length`,
 * `bounds.{minX,minY,maxX,maxY}` — each a `DerivedSlotSchema` statically
 * depending on `["vertices"]` alone (§5.1's own worked example). `label`
 * (e.g. `"circle"`) names the type in every error message this bundle can
 * produce. `schema.ts` spreads this into each preset's `derivedSlots`
 * alongside that type's own `vertices` entry.
 */
export function verticesDerivedSlots(label: string): readonly DerivedSlotSchema[] {
  const dependencies: DerivedSlotDependencies = { kind: "static", paths: [VERTICES_PATH] };
  return [
    { path: CENTROID_X_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.centroid.x`, (v) => computeCentroid(v).x) },
    { path: CENTROID_Y_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.centroid.y`, (v) => computeCentroid(v).y) },
    { path: AREA_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.area`, computeArea) },
    { path: LENGTH_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.length`, computePerimeterLength) },
    { path: BOUNDS_MIN_X_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.minX`, (v) => computeBounds(v).minX) },
    { path: BOUNDS_MIN_Y_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.minY`, (v) => computeBounds(v).minY) },
    { path: BOUNDS_MAX_X_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.maxX`, (v) => computeBounds(v).maxX) },
    { path: BOUNDS_MAX_Y_PATH, dependencies, compute: deriveNumberFromVertices(`${label}.bounds.maxY`, (v) => computeBounds(v).maxY) },
  ];
}
