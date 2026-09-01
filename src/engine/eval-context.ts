/**
 * eval-context.ts — The injected services a topological evaluation pass carries.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1 ("Evaluation context" — "Evaluation needs injected
 * services (currently just the `TextMeasurer`). Pass an `EvalContext` object down
 * through evaluation rather than reaching for module-level globals") and Rule 1's
 * text-measurement trap ("Define an interface in the engine ... The engine depends
 * only on that interface and receives an implementation through the evaluation
 * context").
 * LAYER: engine (pure). May import: engine/* only (imports nothing today — a leaf).
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   Three interfaces and one null-object constant. `EvalContext` is the bag of
 *   injected services `graph/eval.ts` threads through every evaluation pass and
 *   hands to every `derived`-slot compute function (`primitives/schema.ts`'s
 *   `DerivedSlotCompute`). Today it carries one service: a `TextMeasurer`, which
 *   `primitives/text.ts`'s eventual `measuredHeight` derived slot (§5.6) needs and
 *   which the engine must NEVER obtain by reaching for a canvas itself (Rule 1).
 *
 *   `TextStyle` is the measurement-relevant subset of §5.6's `TextBox.style`
 *   (`font`, `fontSize`, `lineHeight`) — the fields a width/height computation
 *   actually depends on. `color`/`align` are omitted deliberately: they change how
 *   text is PAINTED, not how much room it takes.
 *
 *   `NULL_EVAL_CONTEXT` is the documented default for the many evaluation call
 *   sites that touch no `text` object at all (every current one). Its measurer
 *   reports a zero-size box. This is NOT a module-level mutable global — it is a
 *   frozen null-object a caller passes explicitly (or accepts as a parameter
 *   default), so §5.1's "rather than reaching for module-level globals" still
 *   holds: nothing here is hidden state. A document with real `text` objects is
 *   meant to get a Canvas2D-backed measurer instead, injected by `main.ts`
 *   through `mutate`'s `context` argument — that wiring is NOT DONE HERE and no
 *   caller supplies a non-null context yet.
 *
 * INVARIANTS UPHELD HERE
 *   - `measure` NEVER throws and always returns two finite, non-negative numbers.
 *     A `derived`-slot compute calling it must be able to trust that, the same way
 *     it trusts `read` (§5.1: "Errors must never throw across the evaluation loop").
 *   - `NULL_EVAL_CONTEXT` and its measurer are BOTH frozen, so a stray write to
 *     either (`.measurer =`, or `.measurer.measure =`) fails loudly in strict mode
 *     rather than corrupting every later pass that shares the default.
 *   - No `Value`/`ErrorValue` vocabulary here: a measurement is a pair of plain
 *     numbers, not graph state. Turning a nonsensical measurement into an
 *     `ErrorValue` is the calling compute function's job, not this interface's —
 *     `hasRealMeasurer` (below) is the one hook it gets, and even that returns a
 *     plain boolean, not a `Value`.
 *
 * NOT DONE HERE
 *   - WIRING the real `TextMeasurer` into `mutate`. `render/measure.ts`'s
 *     Canvas2D-backed measurer is BUILT (entry 0131); what is unbuilt is
 *     `main.ts` threading it — as a real `EvalContext` — through
 *     `command/commands.ts`'s `executeCommand`, `document.ts`'s loader, and the
 *     drag path. `measuredHeight` (entry 0129) is BUILT and consumes `measurer`,
 *     but no caller supplies a non-null context yet, so it reports `#MEASURE` in
 *     the running app until that wiring lands (D-118).
 *   - Wrapping / line-breaking itself — that lives inside the `TextMeasurer`
 *     IMPLEMENTATION (D-120, answering Q-021: `measure`'s `maxWidth` parameter is
 *     the wrap boundary; the engine never breaks lines). `render/measure.ts` does
 *     it with `ctx.measureText`; the test fake fakes it.
 *   - `resolvedContent` (`primitives/text.ts`) — this file only defines the
 *     service `measuredHeight` consumes.
 *   - Any service beyond `TextMeasurer`. §5.1: "currently just the TextMeasurer."
 *     Widen `EvalContext` when a second injected service actually exists.
 */

/**
 * The measurement-relevant subset of §5.6's `TextBox.style`. A `TextMeasurer`
 * needs the typeface, the point size, and the line spacing to compute a box;
 * `color` and `align` do not affect size and are not here.
 *
 * `font` is a family/stack string (e.g. `"Inter, system-ui, sans-serif"`), the
 * same shape `render/` will hand a canvas `ctx.font`. `fontSize` and
 * `lineHeight` are in the same length unit the rest of the document's geometry
 * uses (world units — Q-012's provisional (a), unchanged here).
 */
export interface TextStyle {
  readonly font: string;
  readonly fontSize: number;
  readonly lineHeight: number;
}

/** A measured text box: width and height in the same unit as `TextStyle.fontSize`. Both finite and >= 0. */
export interface TextMeasurement {
  readonly width: number;
  readonly height: number;
}

/**
 * Measures rendered text without the engine ever touching a canvas (Rule 1).
 *
 * Why: §5.6's `measuredHeight` is a `derived` slot evaluated inside the
 * topological pass, so the measurement must be available to a pure compute
 * function. `render/measure.ts` provides the Canvas2D-backed implementation and
 * `main.ts` injects it; tests inject a fixed-width fake.
 *
 * Guarantees: never throws; always returns finite, non-negative `width`/`height`
 * (§5.1's never-throw discipline — a compute function calling this must be able
 * to trust the result the same way it trusts `read`).
 *
 * `maxWidth` is the wrap boundary (**D-120**, answering Q-021), in the same
 * length unit as `TextStyle.fontSize`, from a `text` object's `width` slot when
 * it holds a number; `undefined` means no wrapping (§5.6: "Auto width + auto
 * height means no wrapping"). §5.6 makes `measuredHeight` depend on `width` while
 * Rule 1's interface as written at entry 0124 had no width parameter — D-120
 * resolves that inconsistency by widening the interface HERE and putting
 * LINE-BREAKING in the measurer implementation (`render/measure.ts`), never in
 * `src/engine/`. An implementation free to ignore `maxWidth` (the null measurer,
 * an early fake) simply does not wrap.
 */
export interface TextMeasurer {
  measure(text: string, style: TextStyle, maxWidth?: number): TextMeasurement;
}

/**
 * The injected services one evaluation pass carries (§5.1's "Evaluation
 * context"). One service today; see the file header's NOT DONE HERE before
 * adding a second.
 */
export interface EvalContext {
  readonly measurer: TextMeasurer;
}

/**
 * The measurer inside `NULL_EVAL_CONTEXT`: every box is zero-sized. Used only by
 * evaluation call sites that touch no `text` object (all of them today, until a
 * `mutate` caller threads a real context). §5.6's `measuredHeight` compute
 * (`primitives/text.ts`) MUST NOT return a height measured against this — it
 * detects the null measurer via `hasRealMeasurer` and returns `#MEASURE`
 * instead (**D-118**).
 */
const NULL_TEXT_MEASURER: TextMeasurer = Object.freeze({
  measure: () => ({ width: 0, height: 0 }),
});

/**
 * The default `EvalContext` for callers with no text to measure — a frozen
 * null-object (measurer included), not hidden mutable state (see the file
 * header). A document with real `text` objects is meant to get a real one
 * through `mutate`'s `context` argument instead; nothing wires that yet.
 */
export const NULL_EVAL_CONTEXT: EvalContext = Object.freeze({
  measurer: NULL_TEXT_MEASURER,
});

/**
 * Is `context` carrying a measurer that can actually measure text — as opposed
 * to `NULL_EVAL_CONTEXT`'s zero-box stand-in, or no context at all?
 *
 * **D-118**: a `measuredHeight`-style compute that would otherwise measure a real
 * `text` object against the null measurer MUST return an `ErrorValue` (`#MEASURE`)
 * rather than a height it did not earn. This predicate is how it tells. The check
 * lives here, next to `NULL_TEXT_MEASURER` (this file's private constant), rather
 * than as an identity compare scattered through every compute that measures —
 * D-118 clause 3 leaves the mechanism to the implementer and names exactly this
 * as one option ("an identity check against the exported `NULL_EVAL_CONTEXT`").
 * `context === undefined` is the isolated-unit-test path and is equivalent for
 * this purpose (D-118 clause 3). Typed as a guard so a caller that passes the
 * check can use `context.measurer` without re-narrowing.
 */
export function hasRealMeasurer(context: EvalContext | undefined): context is EvalContext {
  return context !== undefined && context.measurer !== NULL_TEXT_MEASURER;
}
