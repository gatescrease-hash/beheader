/**
 * index.ts
 *
 * The single public surface of the engine. Everything outside src/engine
 * imports from this file and never from a path inside it, so the engine can
 * be rearranged without touching the three layers above it. A future Rust
 * port draws the boundary in the same place.
 *
 * Two different functions are called evaluate. The one in formula/eval.ts
 * runs a single AST, and the one in graph/eval.ts runs the whole graph in
 * topological order. Both are re-exported here under names that say which
 * is which: evaluateFormulaAst and evaluateGraph.
 *
 * Two tests in index.test.ts hold this boundary, and neither reads a list
 * anybody maintains by hand. One walks every engine file through the
 * bundler and names any export this file leaves out. The other reads the
 * source of every file outside the engine and names any deep import. The
 * surface is not curated. It re-exports every file in the engine, so names
 * that no outside layer uses still cross the boundary. Replacing the star
 * exports with a hand written list is an open decision rather than an
 * oversight.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so
 * the tests run headless and the file can move to Rust later.
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
