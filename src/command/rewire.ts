/**
 * rewire.ts
 *
 * Plans the rewire of section 19: one slot edge of the overlay moves from the
 * address it reads to a new address, and the formula behind it rewrites. The
 * plan is the `set` line that writes the new formula, so the rewire is an
 * ordinary mutation. The log shows the line, an undo takes it back, and a
 * rewire that would close a cycle refuses the way any `set` refuses, naming
 * the slots around it.
 *
 * The new address replaces every reference to the old one in that formula,
 * because an edge exists for the address and not for one place it is written.
 * A range is left alone: one cell inside a range stands for no single place in
 * the formula, so a rewire of an edge that the formula reads only through a
 * range refuses. A text box reads through its content, which is text with
 * formulas inside it rather than one formula, so a rewire of a text box
 * refuses and names the content to edit.
 *
 * Command-layer code: it reads the engine through its public surface, and
 * touches no DOM.
 */
import {
  addressKey,
  formatAddress,
  formatFormula,
  slotKey,
  TEXT_RESOLVED_CONTENT_PATH,
  TEXT_TYPE,
  type Address,
  type Edge,
  type FormulaAst,
  type GraphObject,
} from "../engine/index.ts";

export type RewirePlan = { readonly ok: true; readonly line: string } | { readonly ok: false; readonly message: string };

export function planRewire(objects: readonly GraphObject[], edge: Edge, newSource: Address): RewirePlan {
  const reader = objects.find((object) => object.id === edge.dependentSlot.objectId);
  const name = (address: Address): string => {
    const formatted = formatAddress(address, objects);
    return typeof formatted === "string" ? formatted : formatted.message;
  };
  if (reader === undefined) {
    return { ok: false, message: `the reader of ${name(edge.sourceSlot)} is gone` };
  }
  if (reader.type === TEXT_TYPE && slotKey(edge.dependentSlot.path) === slotKey(TEXT_RESOLVED_CONTENT_PATH)) {
    return { ok: false, message: `${reader.name} reads ${name(edge.sourceSlot)} inside its text — edit ${reader.name}.content to change what it reads` };
  }
  const slot = reader.slots[slotKey(edge.dependentSlot.path)];
  if (slot?.kind !== "formula") {
    return { ok: false, message: `${name(edge.dependentSlot)} holds no formula to rewrite — its reads come from its own object` };
  }
  const oldKey = addressKey(edge.sourceSlot);
  if (addressKey(newSource) === oldKey) {
    return { ok: false, message: `${name(edge.dependentSlot)} already reads ${name(newSource)}` };
  }
  let replaced = 0;
  const rewritten = replaceReferences(slot.ast, (address) => {
    if (addressKey(address) !== oldKey) return address;
    replaced += 1;
    return newSource;
  });
  if (replaced === 0) {
    return { ok: false, message: `${name(edge.dependentSlot)} reads ${name(edge.sourceSlot)} through a range, which a rewire leaves alone — edit the formula instead` };
  }
  return { ok: true, line: `set ${name(edge.dependentSlot)} = ${formatFormula(rewritten, objects)}` };
}

/** Rewrites the address of every reference node, and leaves ranges as they are. */
function replaceReferences(ast: FormulaAst, rewrite: (address: Address) => Address): FormulaAst {
  switch (ast.type) {
    case "literal":
    case "error":
    case "range":
      return ast;
    case "reference":
      return { ...ast, address: rewrite(ast.address) };
    case "binaryOp":
      return { ...ast, left: replaceReferences(ast.left, rewrite), right: replaceReferences(ast.right, rewrite) };
    case "unaryOp":
      return { ...ast, operand: replaceReferences(ast.operand, rewrite) };
    case "functionCall":
      return { ...ast, args: ast.args.map((arg) => replaceReferences(arg, rewrite)) };
    default: {
      const exhaustive: never = ast;
      return exhaustive;
    }
  }
}
