/**
 * index.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * The one public surface of the engine. A consumer outside src/engine must
 * import from this file, not from a path inside src/engine. A future Rust
 * port must match this same boundary. Its shape matters more than its
 * length.
 *
 * Two functions share the name evaluate: one runs a single formula AST, the
 * other runs the whole graph in topological order. Both are re-exported here
 * under a name that says which: evaluateFormulaAst and evaluateGraph.
 */

export * from "./address.ts";
export * from "./document.ts";
export * from "./eval-context.ts";
export * from "./journal.ts";
export * from "./mutation.ts";

export * from "./graph/edge.ts";
export * from "./graph/cycles.ts";
export * from "./graph/node.ts";
export { evaluate as evaluateGraph } from "./graph/eval.ts";

export * from "./formula/ast.ts";
export * from "./formula/parser.ts";
export * from "./formula/format.ts";
export * from "./formula/deps.ts";
export * from "./formula/lexer.ts";
export * from "./formula/functions.ts";
export type { ReadSlot, ReadRange } from "./formula/eval.ts";
export { evaluate as evaluateFormulaAst } from "./formula/eval.ts";

export * from "./primitives/schema.ts";
export * from "./primitives/edge.ts";
export * from "./primitives/geometry.ts";
export * from "./primitives/table.ts";
export * from "./primitives/text.ts";
export * from "./primitives/image.ts";

export * from "./script/stub.ts";
