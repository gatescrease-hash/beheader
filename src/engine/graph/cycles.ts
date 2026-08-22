/**
 * cycles.ts — Naive DFS cycle detection over a derived edge set.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1, mutation-loop step 5 ("Validate acyclicity.
 * Full DFS over the whole graph. Reject on cycle, naming every slot in the
 * cycle.") and Rule 5's naive-cycle-detection directive ("Cycle detection: a
 * full DFS from scratch on every mutation. No incremental bookkeeping.").
 * Load-bearing per Rule 3 (§6 trigger-2 file: graph/*).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   Given the edge set a mutation has already derived from every stored
 *   formula AST and schema declaration (§5.1 step 3 — not this file's job, see
 *   NOT DONE HERE), decide whether that edge set contains a cycle, and if so,
 *   report every slot in ONE such cycle, in order.
 *
 *   A cycle here is a directed cycle in the graph `Edge` describes: `Edge`'s
 *   own field names say sourceSlot's value feeds dependentSlot, so this file
 *   follows sourceSlot -> dependentSlot arcs; a cycle exists if following them
 *   can lead back to where you started. A single edge whose sourceSlot and
 *   dependentSlot are the SAME address (a self-reference — §5.3's own example,
 *   `A6 = SUM(A1:A6)`) is a valid one-slot cycle and is detected the same way
 *   as any other, with no special-casing (§5.3: "This is right; do not
 *   special-case it").
 *
 *   This module does not decide what happens when a cycle is found. It reports
 *   one, structurally — the ordered list of `Address`es — and leaves turning
 *   that into a human-readable rejection message (resolving each `Address`'s
 *   CURRENT object name via `address.ts`'s `formatAddress`) to `mutation.ts`,
 *   which is the one with the document's object list in hand. This module
 *   deliberately does not take an object list at all.
 *
 * INVARIANTS UPHELD HERE
 *   - Full DFS from scratch, every call (Rule 5) — no memoization or
 *     incremental tracking carried between calls. Every call to `detectCycle`
 *     starts every node at "white" and rebuilds its own adjacency from the
 *     `edges` it is given; nothing here is retained between calls.
 *   - Deliberately does NOT introduce a `#CYCLE` value or write anything to
 *     graph state. A detected cycle is reported as plain data (a readonly
 *     `Address[]`) for the caller to act on — §5.1 is explicit that cycles are
 *     rejected AT MUTATION TIME and never enter the graph as state, so this
 *     file must never be the thing that stores one.
 *   - Reports the FIRST cycle found by the DFS, not every cycle the edge set
 *     might contain. §5.1's acceptance criterion asks for "the offending
 *     slots named" for A cycle, not an exhaustive enumeration of every cycle a
 *     malformed document might contain; finding one is sufficient to reject
 *     the mutation, and finding only one is the dumbest correct
 *     implementation (Rule 5).
 *   - Visits every node that appears in at least one edge (a full DFS over the
 *     whole graph, §5.1), including nodes in components unrelated to the
 *     first one visited — unless a cycle is found first, at which point it
 *     returns immediately and the remaining nodes go unvisited. Finding ONE
 *     cycle is all a rejection needs, so there is nothing left to look for. A node that appears in NO edge cannot participate in
 *     a cycle and is correctly never visited (it was never added to the
 *     adjacency built below).
 *
 * NOT DONE HERE
 *   - Deriving the Edge[] from stored ASTs/schema declarations (mutation.ts
 *     step 3, not built yet).
 *   - Formatting a rejection message naming the cycle's slots by their current
 *     object names (mutation.ts, using address.ts's formatAddress).
 *   - Topological evaluation order for an ACYCLIC edge set (graph/eval.ts,
 *     next) — a distinct concern (an order to evaluate in) from this file's
 *     concern (whether a valid order exists at all).
 */
import { addressKey, type Edge } from "./edge.ts";
import type { Address } from "../address.ts";

/**
 * The result of a full-graph cycle check (§5.1 step 5). `hasCycle: false`
 * means `edges` describes a DAG. `hasCycle: true` carries every slot in ONE
 * detected cycle, IN ORDER: `cycle[i]`'s value feeds `cycle[i + 1]`, wrapping
 * around so that `cycle`'s last element feeds `cycle[0]`.
 */
export type CycleCheckResult =
  | { readonly hasCycle: false }
  | { readonly hasCycle: true; readonly cycle: readonly Address[] };

/**
 * DFS node coloring (the standard three-color algorithm for cycle detection in
 * a directed graph): `white` = not yet visited; `gray` = on the CURRENT
 * recursion stack — following an arc back to a gray node closes a cycle;
 * `black` = fully explored, proven not to lead back to anything still on the
 * stack, so revisiting it can never close a NEW cycle.
 */
type Color = "white" | "gray" | "black";

/**
 * Detects a cycle in the directed graph `edges` describes (§5.1 step 5).
 * `edges` is assumed already-derived (mutation.ts step 3) — this function
 * does no address resolution or AST walking of its own; it only walks the
 * `Edge[]` it is handed. Never throws.
 */
export function detectCycle(edges: readonly Edge[]): CycleCheckResult {
  // Adjacency, built fresh from `edges` on every call (Rule 5). Keyed by
  // addressKey so two structurally-equal Addresses (e.g. one from a formula's
  // AST and one freshly built for the edge) are treated as the same node.
  const allNodes = new Map<string, Address>();
  const outgoing = new Map<string, Address[]>();

  // Registers `address` as a graph node exactly once and returns ITS
  // outgoing-arc list (creating an empty one the first time), so a caller
  // never needs an unsafe non-null lookup right after registering.
  function outgoingArcsFor(address: Address): Address[] {
    const key = addressKey(address);
    const existing = outgoing.get(key);
    if (existing !== undefined) {
      return existing;
    }
    allNodes.set(key, address);
    const created: Address[] = [];
    outgoing.set(key, created);
    return created;
  }

  for (const edge of edges) {
    outgoingArcsFor(edge.dependentSlot); // ensure it is a known node even with no outgoing arcs of its own
    outgoingArcsFor(edge.sourceSlot).push(edge.dependentSlot);
  }

  const colors = new Map<string, Color>();
  function colorOf(key: string): Color {
    return colors.get(key) ?? "white";
  }

  // The path of Addresses from the DFS root to the node currently being
  // visited — real Address values, not just keys, so a detected cycle can be
  // sliced straight off this stack with no reverse lookup back to an Address.
  const stack: Address[] = [];

  function visit(address: Address): readonly Address[] | undefined {
    const key = addressKey(address);
    colors.set(key, "gray");
    stack.push(address);

    for (const neighbor of outgoing.get(key) ?? []) {
      const neighborKey = addressKey(neighbor);
      const neighborColor = colorOf(neighborKey);

      if (neighborColor === "gray") {
        // Closing a cycle: everything from where neighborKey first entered
        // the stack, through the current node, is IN the cycle (in order).
        const cycleStart = stack.findIndex((onStack) => addressKey(onStack) === neighborKey);
        return stack.slice(cycleStart);
      }
      if (neighborColor === "white") {
        const found = visit(neighbor);
        if (found !== undefined) {
          return found;
        }
      }
      // "black": already fully explored — by definition it cannot lead back
      // to anything still on the current stack, so there is nothing to find
      // by descending into it again.
    }

    colors.set(key, "black");
    stack.pop();
    return undefined;
  }

  for (const [key, address] of allNodes) {
    if (colorOf(key) === "white") {
      const cycle = visit(address);
      if (cycle !== undefined) {
        return { hasCycle: true, cycle };
      }
    }
  }

  return { hasCycle: false };
}
