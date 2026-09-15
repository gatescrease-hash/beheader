/**
 * doc.ts
 *
 * The document variable and the copy of one that sits on the canvas. Section
 * 13 of the spec describes both.
 *
 * A variable is one slot at the top of a singleton object named `doc`, which
 * has no origin and never draws. The slot is an ordinary graph slot, so a
 * variable holds a literal or a formula and takes part in dependency
 * derivation, the cycle check and the journal without a case of its own.
 *
 * A copy is a second object that carries a position and an address and nothing
 * else. Its value, its width and its height are all derived, so two copies of
 * one variable are two objects reading one slot and neither holds a value that
 * could drift from the other. Deleting a copy deletes a drawing, and the
 * variable it read is untouched.
 *
 * A name a variable may not take is refused here rather than at each caller,
 * because every one of these collisions would otherwise be silent: a reserved
 * word of the formula language would shadow the word, a name of the `A1` form
 * would be read as a cell of the enclosing table, and a name an object carries
 * would make a bare reference ambiguous.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import { isCellReferenceForm, isValidName, type Address } from "../address.ts";
import { RESERVED_WORDS } from "../formula/lexer.ts";
import { getFunctionEntry } from "../formula/functions.ts";
import { hasRealMeasurer } from "../eval-context.ts";
import { isErrorValue, type GraphObject, type Value } from "../graph/node.ts";
import type { DerivedSlotSchema } from "./schema.ts";

/**
 * The type a copy carries, and the type of the singleton that holds every
 * variable. Both are here rather than in the caller so the two names that the
 * schema, the renderer and the mutation all spell stay in one place.
 */
export const DOC_TYPE = "doc";
export const DOCREF_TYPE = "docref";

/**
 * A copy draws in a monospaced font, so the name, the equals sign and the
 * value line up down a column of copies instead of drifting with the width of
 * whatever glyphs each value happens to use.
 */
export const DOCREF_STYLE = { font: "monospace", fontSize: 16, lineHeight: 20 } as const;

/**
 * The reason a name cannot become a variable, or `undefined` when it can.
 * `exclude` names the variable being renamed, which may keep its own spelling.
 *
 * The comparisons ignore case, because a bare name resolves without regard to
 * case and two variables that differed only in case would resolve to whichever
 * came first.
 */
export function documentVariableNameProblem(
  name: string,
  objects: readonly GraphObject[],
  exclude?: string,
): string | undefined {
  if (!isValidName(name)) {
    return `"${name}" is not a valid variable name`;
  }
  // A variable becomes a key of a plain object, so a name that `Object`
  // already carries on its prototype would read as a slot that nobody wrote.
  if (Object.getOwnPropertyNames(Object.prototype).some((key) => key.toLowerCase() === name.toLowerCase())) {
    return `"${name}" is reserved for object storage`;
  }
  if (RESERVED_WORDS.has(name.toUpperCase()) || getFunctionEntry(name.toUpperCase()) !== undefined) {
    return `"${name}" is a reserved formula word`;
  }
  if (isCellReferenceForm(name)) {
    return `"${name}" looks like a table cell`;
  }
  if (name.toLowerCase() === DOC_TYPE) {
    return `the name "${name}" is already in use by an object`;
  }
  if (objects.some((object) => object.type !== DOC_TYPE && object.name.toLowerCase() === name.toLowerCase())) {
    return `the name "${name}" is already in use by an object`;
  }
  const doc = objects.find((object) => object.type === DOC_TYPE);
  if (Object.keys(doc?.slots ?? {}).some((key) => key !== exclude && key.toLowerCase() === name.toLowerCase())) {
    return `the variable "${name}" already exists`;
  }
  return undefined;
}

/**
 * The line a copy draws, as `name = value`.
 *
 * A value with a line break or a tab in it is drawn with that character
 * escaped, because the canvas draws one line and an unescaped break would run
 * the rest of the value off the end of the box the measurement produced. An
 * error draws as its code alone, so a long message cannot stretch the box past
 * whatever sits beside it.
 */
export function docrefLabel(target: Address | undefined, value: Value): string {
  const shown = value === null
    ? "nothing"
    : isErrorValue(value)
      ? value.error
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value).replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  return `${target?.path[0] ?? "?"} = ${shown}`;
}

/**
 * The three derived slots of a copy.
 *
 * `value` depends on whatever address the copy carries, so the dependency is
 * dynamic: a copy that has lost its target declares no dependency rather than
 * one that cannot resolve. The two measured slots depend on `value` alone,
 * so a copy resizes when the variable moves.
 *
 * Measurement goes through the injected measurer of Rule 1 rather than through
 * a canvas, and a context with no real measurer gives `#MEASURE` instead of a
 * guess, so a headless evaluation cannot leave a box that a browser would
 * disagree with.
 */
export const DOCREF_DERIVED_SLOTS: readonly DerivedSlotSchema[] = [
  {
    path: ["value"],
    dependencies: {
      kind: "dynamic",
      resolve: (object) => (object.target === undefined ? [] : [object.target]),
    },
    compute: (object, read) =>
      object.target === undefined
        ? { error: "#REF", message: "copy has no target" }
        : read(object.target) ?? null,
  },
  ...(["measuredWidth", "measuredHeight"] as const).map((name): DerivedSlotSchema => ({
    path: [name],
    dependencies: { kind: "static", paths: [["value"]] },
    compute: (object, read, context) => {
      if (!hasRealMeasurer(context)) {
        return { error: "#MEASURE", message: "variable copy needs text measurement" };
      }
      const label = docrefLabel(object.target, read({ objectId: object.id, path: ["value"] }) ?? null);
      try {
        const size = context.measurer.measure(label, DOCREF_STYLE);
        const dimension = name === "measuredWidth" ? size.width : size.height;
        return Number.isFinite(dimension) && dimension >= 0
          ? dimension
          : { error: "#MEASURE", message: "variable copy measurement is invalid" };
      } catch {
        // A measurer that throws is a fault in the host rather than in the
        // document, and an error value leaves the rest of the graph evaluating.
        return { error: "#MEASURE", message: "variable copy could not be measured" };
      }
    },
  })),
];
