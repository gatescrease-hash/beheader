/**
 * slots.ts — Shared slot reads: narrowing a `Value` to a `number`, a non-empty
 * `string` or a `Point[]`, and the table primitive's fixed cell size.
 *
 * IMPLEMENTS: the slot reads §5.4/§5.5/§5.9 need every render-layer consumer
 * to perform identically — no spec section of its own; this file exists for
 * D-010, not for a brief clause.
 * LAYER: render (pure). No canvas, DOM, or window — reads `GraphObject`/
 * `Value` only. May import: engine/* (read-only). NEVER imports another
 * render/* file. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `readNumber`/`readText`/`asPointArray` narrow a slot's current value;
 *   `TABLE_CELL_WIDTH`/`TABLE_CELL_HEIGHT` are the table primitive's fixed
 *   cell size (§5.4). All five exist ONLY so `renderer.ts`, `hittest.ts`,
 *   `extent.ts` and `editor.ts` read the same slot paths the same way
 *   (D-010) — a table's click box, its drawn grid, and its drawn extent must
 *   never disagree about a cell's size; a shape's hit test must never
 *   disagree with its drawn `vertices` about what counts as a point; and the
 *   in-place editor's overlay must never disagree with the drawn text about
 *   which font it is in (entry 0147, which is why `readText` moved here).
 *
 *   This file is one half of D-093's split. `renderer.ts` used to define
 *   these four and `hittest.ts` imported them back out of it, while
 *   `renderer.ts` imported `objectExtent` out of `hittest.ts` — a module
 *   cycle (0094's ESCALATION). This file and `extent.ts` are the DAG that
 *   replaces it: every other `render/*` file may import THIS file; this file
 *   imports none of them.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. Every function returns `undefined` for a missing,
 *     wrong-typed, or `ErrorValue` slot rather than assuming a shape.
 *   - Reads only, writes nothing (Rule 2 — there is no state here to write).
 *
 * NOT DONE HERE
 *   - Extent/bounding-box computation — `extent.ts`, which imports this file.
 *   - Hit-testing and drawing themselves — `hittest.ts` and `renderer.ts`,
 *     which both import this file.
 */
import { getSlot, type GraphObject, type Point, type Value } from "../engine/graph/node.ts";

/**
 * A slot's current value, narrowed to `number` — `undefined` for anything else
 * (missing, wrong-typed, an `ErrorValue`). Never throws. Shared by
 * `renderer.ts`, `hittest.ts` and `extent.ts`, which all read the same
 * `origin.x`/`origin.y`/`radius` paths and must not re-derive this narrowing
 * separately (D-010).
 */
export function readNumber(object: GraphObject, path: readonly string[]): number | undefined {
  const value = getSlot(object, path)?.value;
  return typeof value === "number" ? value : undefined;
}

/**
 * A slot's current value, narrowed to a NON-EMPTY string — `undefined` for
 * anything else (missing, wrong-typed, an `ErrorValue`, or `""`). Never
 * throws. `readNumber`'s string sibling.
 *
 * Empty counts as absent because every caller pairs this with a `??` default
 * for a font family or an alignment keyword, where `""` is not a usable value
 * and the default is. Shared rather than kept local (it was `renderer.ts`'s
 * private helper until entry 0147) so `renderer.ts`'s drawn font and
 * `editor.ts`'s in-place overlay font resolve the SAME slot the SAME way and
 * cannot fall back differently (D-010) — a divergence there is directly
 * visible as the editor wrapping text the canvas draws on one line.
 *
 * Screens `""` only, NOT a blank `"   "` — a caller for whom whitespace is
 * also unusable (a font family: `measure.ts`'s `cssFont`, `editor.ts`'s
 * `editorTextStyle`) applies that second screen itself, and the two must
 * apply it alike (0148-REVIEW).
 */
export function readText(object: GraphObject, path: readonly string[]): string | undefined {
  const value = getSlot(object, path)?.value;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Narrows a slot's current value to a `Point[]` — `undefined` for everything
 * else, an `ErrorValue` included. `readonly Point[]` is the ONLY array arm of
 * `Value` (§5.1, `graph/node.ts`), so `Array.isArray` alone excludes every
 * other member and no separate `isErrorValue` guard is needed here (an
 * `ErrorValue` is not an array). Never throws. Shared by `renderer.ts`,
 * `hittest.ts` and `extent.ts`, which all read the same `vertices` slot and
 * must not re-derive this narrowing separately (D-010).
 */
export function asPointArray(value: Value | undefined): readonly Point[] | undefined {
  if (value === undefined || !Array.isArray(value)) {
    return undefined;
  }
  return value as readonly Point[];
}

/**
 * §5.4: "fixed-size cells." World-unit constants — untuned (Rule 5), scale on
 * screen with zoom like everything else drawn here. PROVISIONAL(Q-012): world
 * units or screen pixels, the same open question as every other stroke/size
 * constant `renderer.ts` declares. Shared so a table's drawn grid
 * (`renderer.ts`), its click box (`hittest.ts`) and its drawn extent
 * (`extent.ts`) can never disagree about a cell's size (D-010's "declare
 * once" principle).
 */
export const TABLE_CELL_WIDTH = 80;
export const TABLE_CELL_HEIGHT = 24;
