/**
 * stub.ts — The `script` node: a real graph citizen whose execution is fake (§5.8).
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.8 in full for Phase 6's stub half — `ScriptNode`'s
 * shape, the one-function execution seam (`evaluateScriptOutput`), and the
 * path/slot-family plumbing `primitives/schema.ts`'s `SCRIPT_SCHEMA` wires into the
 * registry, on top of **D-141**'s already-built-and-reviewed data model
 * (`graph/node.ts`'s `GraphObjectPorts`, `mutation.ts`'s `addPort`/`removePort`).
 * D-141 clause 7 makes this file's own creation a §6.1 trigger 2 review point.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   §4's project structure puts `script/` beside `primitives/`, not inside it, but
 *   this file plays the identical role `primitives/text.ts`/`primitives/geometry.ts`
 *   play for their own types: the pure per-type logic `primitives/schema.ts` wires
 *   into the registry, never the registry entry itself.
 *
 *   A `script` node's THREE fixed slots — `SCRIPT_LANGUAGE_PATH` (`"python"`,
 *   fixed — §5.8: "language: 'python' // fixed for now"), `SCRIPT_SOURCE_PATH`
 *   (the user's code, stored and NEVER executed, NEVER a dependency of anything —
 *   §5.8's own words) — plus `origin.x`/`origin.y` (`primitives/geometry.ts`'s own
 *   constants, imported rather than re-declared, the identical identity D-121 gave
 *   `text` and entry 0165 gave `image`, so a script node is draggable by the same
 *   per-component rule with no script-specific code anywhere in `render/`).
 *
 *   THREE DYNAMIC SLOT FAMILIES, each sized by the object's structural `ports`
 *   field (D-141), never by an evaluated value (Rule 6 holds by construction —
 *   D-141's own rationale):
 *     - `in.<port>` (`enumerateScriptInPaths`) — one path per name in
 *       `object.ports.in`, a normal non-derived (literal-by-default) slot family.
 *       §5.8: "a normal formula slot (a binding to some upstream address)" — the
 *       schema does not narrow its KIND (contrast `text.content`'s D-122 guard):
 *       nothing here parses or restricts what an `in.<port>` holds, so it is
 *       `literal` until a `link` converts it, like any other non-derived slot.
 *     - `placeholder.<port>` (`enumerateScriptPlaceholderPaths`) — one literal
 *       slot per name in `object.ports.out`, holding §5.8's "stub output values,
 *       user-editable" — see below for why this is a SEPARATE family from `out.*`
 *       rather than the same one.
 *     - `out.<port>` (`enumerateScriptOutDerivedSlots`, a `DerivedSlotGroup` of
 *       kind `"dynamic"`) — one DERIVED slot per name in `object.ports.out`,
 *       computed by `makeScriptOutputCompute`, which adapts the object's current
 *       state into `evaluateScriptOutput`'s call shape.
 *
 *   WHY `placeholders` IS ITS OWN SLOT FAMILY, NOT PART OF `out.*`: §5.8's
 *   `placeholders: Record<string, Value>` is described as "user-editable" — but
 *   `out.<port>` is `derived` (§5.1: "derived is fixed by schema and can never be
 *   converted; attempting to link or set a derived slot is rejected"), so the
 *   user-settable value it reads FROM cannot live at the same path. A LITERAL
 *   `placeholder.<port>` slot is the ordinary, already-existing mechanism for "a
 *   user-editable value a derived slot depends on" — no new mechanism, the same
 *   shape `text.content` feeding `resolvedContent` already has.
 *
 *   `evaluateScriptOutput` is §5.8's "one-function seam", copied verbatim from the
 *   brief's own code block: "TODO: dispatch to persistent Python interpreter over
 *   IPC... For now: return the user-set placeholder for this output port." When
 *   Python lands, only this function's BODY changes — its signature, and every
 *   caller, stays exactly as built here.
 *
 * INVARIANTS UPHELD HERE
 *   - Rule 6 by construction: every dynamic family here is sized by `object.ports`
 *     (structural, mutation-only state), never by a slot VALUE — D-046/D-097 have
 *     nothing to bind here, the same posture D-141's own rationale gives `in.*`/
 *     `out.*` and this file extends unchanged to `placeholder.*`.
 *   - `out.<port>`'s compute NEVER reads `SCRIPT_SOURCE_PATH` and never declares it
 *     as a dependency — §5.8: "it is not an input to any derived slot — editing it
 *     must not trigger recomputation, because nothing reads it."
 *   - `makeScriptOutputCompute`'s `read` calls are restricted to addresses this
 *     file itself declares as dependencies (D-013, enforced by `graph/eval.ts`) —
 *     every `in.<port>` address AND this port's own `placeholder.<port>` address,
 *     the latter being what makes editing the placeholder actually re-evaluate
 *     `out.<port>` rather than reading a stale cached value.
 *   - §5.1: errors propagate. An unresolved or error-valued input, checked in
 *     PORT-DECLARATION ORDER (deterministic, mirroring `add`'s "check `a` first"),
 *     or an unresolved/error-valued placeholder, is returned AS the whole
 *     `out.<port>` value rather than reaching `evaluateScriptOutput` — never
 *     thrown, never silently swallowed.
 *   - No script-specific logic leaks into `graph/eval.ts` — every arm here is an
 *     ordinary `DerivedSlotCompute`/`NonDerivedSlotPathGroup`/`DerivedSlotGroup`,
 *     indistinguishable to the evaluator from `text`'s or `table`'s own.
 *
 * NOT DONE HERE
 *   - Real Python execution — `evaluateScriptOutput`'s body is the ONE thing that
 *     changes when it lands (§5.8).
 *   - `SCRIPT_SCHEMA` itself, or wiring these groups into the registry —
 *     `primitives/schema.ts` owns the `ObjectSchema` shape and the `SCHEMAS` map.
 *   - §5.10's `script` command (`command/parser.ts` + `command/commands.ts`) and
 *     any port-declaring command — `addPort`/`removePort` are reachable today only
 *     through `mutation.ts`'s operations directly (D-141 clause 6); §5.10 names no
 *     command word for declaring a port, and inventing one is the gold-plating §8's
 *     last bullet forbids until a real need names the grammar.
 *   - Rendering a labelled box with ports, hit-testing it, or giving it an extent.
 *     A SEPARATE future slice, the same posture `image`'s 0165 cycle took for
 *     drawing (D-066: no extent without the drawing pass that makes it correct).
 */
import type { Address } from "../address.ts";
import { isErrorValue, type GraphObject, type Value } from "../graph/node.ts";
import type { DerivedSlotCompute, DerivedSlotDependencies, DerivedSlotSchema } from "../primitives/schema.ts";

// ---------------------------------------------------------------------------
// §5.8's ScriptNode shape and its one-function execution seam
// ---------------------------------------------------------------------------

/**
 * §5.8's own shape, reproduced for `evaluateScriptOutput`'s signature. This is
 * NOT how a script node's state lives in `GraphObject.slots` — `in`/`out` are
 * dynamic SLOT FAMILIES (see file header), not fields of a stored value — it is
 * the call-shape the brief's seam function is specified against, so a future
 * Python integration sees the identical interface this stub does.
 */
export interface ScriptNode {
  readonly language: "python";
  readonly source: string;
  readonly in: Readonly<Record<string, Value>>;
  readonly out: Readonly<Record<string, Value>>;
  readonly placeholders: Readonly<Record<string, Value>>;
}

/**
 * §5.8's "one-function seam", verbatim: "TODO: dispatch to persistent Python
 * interpreter over IPC. Warm-but-stateless: fresh namespace per graph-script
 * execution. For now: return the user-set placeholder for this output port."
 *
 * `inputs` is handed the resolved CURRENT values of every `in.*` slot
 * (`makeScriptOutputCompute` builds it), matching `node.in`'s own values —
 * carried as a separate parameter because a real dispatch needs the raw
 * argument map to pass into the interpreter, independent of whatever shape
 * `ScriptNode` itself takes. This stub ignores it; that is the whole point of a
 * stub whose body is the only thing later work changes.
 */
export function evaluateScriptOutput(node: ScriptNode, portName: string, inputs: Readonly<Record<string, Value>>): Value {
  void inputs;
  return node.placeholders[portName] ?? null;
}

// ---------------------------------------------------------------------------
// Path constants (§5.8)
// ---------------------------------------------------------------------------

/** §5.8's `language` — fixed to `"python"`. A literal slot rather than a bare structural field: it is document state a formula could in principle read, and every other primitive's fixed-per-object data (`image.opacity`, `text.style.font`) is a slot too, never a `GraphObject`-level field (D-141's `ports` is structural for the opposite reason — its role is sizing a family, which a slot value may never do). */
export const SCRIPT_LANGUAGE_PATH: readonly string[] = ["language"];

/** §5.8's `source` — the user's code. Stored and NEVER executed, and never a dependency of `out.<port>` — see the file header. */
export const SCRIPT_SOURCE_PATH: readonly string[] = ["source"];

/** One `in.<port>` path, given the port's NAME (not its index — D-141 clause 2's ordered-but-name-addressed ports). */
export function scriptInPortPath(name: string): readonly string[] {
  return ["in", name];
}

/** One `out.<port>` path. */
export function scriptOutPortPath(name: string): readonly string[] {
  return ["out", name];
}

/** One `placeholder.<port>` path — see the file header for why this is a separate family from `out.<port>` rather than the same path. */
export function scriptPlaceholderPath(name: string): readonly string[] {
  return ["placeholder", name];
}

// ---------------------------------------------------------------------------
// Dynamic non-derived slot families — `in.*` and `placeholder.*`
// ---------------------------------------------------------------------------

/**
 * `NonDerivedSlotPathGroup`'s `dynamic` `enumerate` for `in.*` — one path per
 * name currently in `object.ports.in`, in declared order. Mirrors
 * `primitives/table.ts`'s `enumerateTableCellSlotPaths` in shape: reads only
 * `object`'s own structural state, never throws, and is sized by the
 * MUTATION-only `ports` field rather than any evaluated value (Rule 6, D-046's
 * concern does not reach it).
 */
export function enumerateScriptInPaths(object: GraphObject): readonly (readonly string[])[] {
  return (object.ports?.in ?? []).map(scriptInPortPath);
}

/** The `placeholder.*` analogue, sized by `object.ports.out` instead. */
export function enumerateScriptPlaceholderPaths(object: GraphObject): readonly (readonly string[])[] {
  return (object.ports?.out ?? []).map(scriptPlaceholderPath);
}

// ---------------------------------------------------------------------------
// The dynamic derived-slot family — `out.*`
// ---------------------------------------------------------------------------

/**
 * `out.<name>`'s declared dependencies (§5.1's dynamic-dependency case named for
 * exactly this: "`script.out.*` depends on all of that node's currently declared
 * `in.*` slots"). ALSO includes this port's own `placeholder.<name>` address —
 * not part of the brief's one-sentence description, but required by
 * construction: `graph/eval.ts`'s `evaluateDerivedSlot` restricts a compute's
 * `read` to addresses THIS SLOT declared as a dependency (D-013), so without it
 * `makeScriptOutputCompute` could never read the very value it exists to
 * surface, and editing the placeholder would never re-trigger `out.<name>`.
 */
function scriptOutDependencies(portName: string): DerivedSlotDependencies {
  return {
    kind: "dynamic",
    resolve: (object) => [
      ...(object.ports?.in ?? []).map((name): Address => ({ objectId: object.id, path: scriptInPortPath(name) })),
      { objectId: object.id, path: scriptPlaceholderPath(portName) },
    ],
  };
}

/**
 * `out.<name>`'s compute function: reads every `in.*` value (in PORT-DECLARATION
 * ORDER, so a doubly-broken node fails deterministically — the same reasoning
 * `primitives/schema.ts`'s `add` compute states for checking its own two inputs
 * in a fixed order) and this port's own placeholder, propagating the first
 * `ErrorValue` or unresolved address found (§5.1: errors propagate) rather than
 * ever reaching `evaluateScriptOutput` with a broken input.
 *
 * `node.in`/`node.out` are NOT populated from live cross-references here —
 * `evaluateScriptOutput`'s current body reads only `.placeholders[portName]`,
 * and reconstructing full same-object slot data for fields the seam does not
 * touch would be untested, unused code with no correctness claim resting on it
 * (Rule 5: the dumbest correct implementation). Populating them for real is
 * exactly the kind of change owed WHEN Python lands and the seam's body starts
 * reading them, not before.
 */
function makeScriptOutputCompute(portName: string): DerivedSlotCompute {
  return (object, read) => {
    const inputs: Record<string, Value> = {};
    for (const name of object.ports?.in ?? []) {
      const value = read({ objectId: object.id, path: scriptInPortPath(name) });
      if (value === undefined) {
        return { error: "#REF", message: `script: in.${name} did not resolve to a value` };
      }
      if (isErrorValue(value)) {
        return value;
      }
      inputs[name] = value;
    }

    const placeholderValue = read({ objectId: object.id, path: scriptPlaceholderPath(portName) });
    if (placeholderValue === undefined) {
      return { error: "#REF", message: `script: out.${portName}'s placeholder value did not resolve` };
    }
    if (isErrorValue(placeholderValue)) {
      return placeholderValue;
    }

    const node: ScriptNode = {
      language: "python",
      source: "", // Never read by evaluateScriptOutput; see the file header.
      in: inputs,
      out: {},
      placeholders: { [portName]: placeholderValue },
    };
    return evaluateScriptOutput(node, portName, inputs);
  };
}

/**
 * `DerivedSlotGroup`'s `dynamic` `enumerate` for `out.*` — one `DerivedSlotSchema`
 * per name currently in `object.ports.out`, in declared order. Mirrors
 * `enumerateScriptInPaths`/`enumerateScriptPlaceholderPaths` above: reads only
 * `object`'s own structural state, sized by the mutation-only `ports` field,
 * never throws.
 */
export function enumerateScriptOutDerivedSlots(object: GraphObject): readonly DerivedSlotSchema[] {
  return (object.ports?.out ?? []).map((name) => ({
    path: scriptOutPortPath(name),
    dependencies: scriptOutDependencies(name),
    compute: makeScriptOutputCompute(name),
  }));
}
