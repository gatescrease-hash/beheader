/**
 * hittest.ts — Screen point -> topmost object.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.9's hit-testing sentence ("Point-in-polygon for
 * fills, distance-to-segment with pixel tolerance for strokes and open paths,
 * bounding box for text/tables/images/scripts").
 * LAYER: render. Touches no canvas or DOM at all — pure coordinate and
 * geometry math over `GraphObject`/`CameraState`. It lives in `render/`
 * rather than `engine/` because it depends on `camera.ts`'s
 * `CameraState`/`screenToWorld`, which Rule 1 forbids `engine/` from
 * depending on in the other direction. May import: engine/* (read-only), own
 * layer. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `hitTest(screenPoint, objects, camera)` — the primary entry point. It
 *   converts to world space via `camera.ts`'s OWN `screenToWorld` (D-010: never
 *   a second copy of that formula), walks `objects` from LAST to FIRST (z-order
 *   is array order, the same reading `renderer.ts` draws under, so a later
 *   object is tested first), and returns the first object whose per-type test
 *   passes. `circle`/`polygon`/`rect` share ONE test even though the renderer
 *   draws a circle as a true arc — §5.5 is verbatim on this: "the derived
 *   `vertices` slot yields a polygonal approximation used for bounds AND
 *   HIT-TESTING."
 *
 *   The stroke tolerance is screen-space (§5.9's "pixel tolerance"), converted
 *   to world units via `camera.zoom` at the point of use. It takes no side in
 *   Q-012, which asks about a drawn stroke WIDTH — a different property.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. Every read funnels through `slots.ts`'s
 *     `readNumber`/`asPointArray`; a missing, wrong-typed, or `ErrorValue`
 *     slot makes that ONE object never hit without aborting the scan.
 *   - Reads only, writes nothing (Rule 2 — there is no state here to write).
 *   - An object that draws nothing is not hittable (D-066). A degenerate
 *     extent gets an explicit guard rather than being left to inclusive
 *     bounds, which would contain the points ON a zero-area box.
 *   - HAZARD, inherited from `screenToWorld`: `camera.zoom` must be non-zero.
 *     A loaded document's camera can violate it (D-062), and the consequence
 *     here is worse than `screenToWorld`'s own "silently useless point" — at
 *     `zoom: 0` the world tolerance is `Infinity`, so every shape hits at
 *     every point and any click returns the topmost object (0064-REVIEW
 *     Finding 2). The clamp belongs at `main.ts`'s boundary, once, NOT here
 *     (0062-REVIEW §9).
 *
 * NOT DONE HERE
 *   - **Point-in-polygon for FILLS.** §5.9 names it, but nothing can be
 *     filled yet — no `style` slots exist and `renderer.ts` never calls
 *     `ctx.fill()` — so a click inside an unfilled outline correctly misses
 *     and only the stroke hits. D-067 rules this correct and not a partial
 *     implementation. When it IS built it must honour D-064's CCW winding,
 *     which is exactly where that ruling becomes load-bearing; the current
 *     distance-to-segment test is direction-agnostic and consumes no winding.
 *   - Selection state and calling any mutation — `render/interaction.ts`'s
 *     job; DOM event handling is `main.ts`'s. This file only ANSWERS "what is
 *     under this point."
 *   - `script`'s bounding box and `polyline`'s open-path distance test — no
 *     VISUAL definition exists to read for either yet, and D-066 makes the
 *     drawn extent and the clickable extent one extent, so a type that draws
 *     nothing has nothing to hit. `text` (entry 0138) and `image` (**D-142**)
 *     ARE tested now: §5.9's "bounding box for text/tables/images/scripts",
 *     read straight
 *     off `extent.ts`'s `objectExtent` so the click box is exactly the drawn
 *     box (D-066/D-010). An `image` object's box is its `width`/`height` slots
 *     whether or not its picture has decoded — `extent.ts`'s `imageExtent`
 *     says why. An auto-width `text` object's box comes from its
 *     `measuredWidth`/`measuredHeight` derived slots (**D-123**); only a `text`
 *     object nothing could measure (no `TextMeasurer` wired — `#MEASURE`, D-118)
 *     falls back to `extent.ts`'s fixed size.
 *   - An object's or the document's drawn extent — `extent.ts` (D-093's
 *     split; see that file's header). This file used to define both; moved
 *     out because "where is everything" is a different question from "what
 *     is under this point," and the two functions had nothing left in common
 *     once the shared slot reads moved to `slots.ts` too.
 */
import { getSlot, type GraphObject, type Point } from "../engine/graph/node.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH, VERTICES_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import type { CameraState } from "../engine/document.ts";
import { screenToWorld, type ScreenPoint, type WorldPoint } from "./camera.ts";
import { objectExtent } from "./extent.ts";
import { asPointArray, readNumber, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";

/**
 * §5.9: "pixel tolerance" for stroke/open-path hit-testing. A round, untuned
 * screen-space constant (Rule 5) — converted to world units via
 * `camera.zoom` at the point of use, never compared against a world-space
 * distance directly.
 */
export const STROKE_HIT_TOLERANCE_SCREEN_PIXELS = 5;

/**
 * The shortest distance from `point` to the segment `a`-`b`. Standard
 * point-to-segment projection, clamped to the segment's own extent; falls
 * back to plain point-to-point distance for a degenerate zero-length segment
 * (`a` and `b` coincide) rather than dividing by zero. Total; never throws.
 */
function distanceToSegment(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * abx), point.y - (a.y + t * aby));
}

/**
 * The shortest distance from `point` to any edge of the CLOSED polyline
 * `vertices` (§5.5: every preset's `vertices` is closed — see
 * `primitives/geometry.ts`'s own `edgePairs`, whose wraparound this mirrors
 * rather than importing, since that helper is private to a file this one
 * only reads schema-declared slot paths from). `Infinity` when there is no
 * edge to measure, or when every measurement is `NaN` — which reads as "no
 * hit" against any FINITE tolerance, and so needs no separate empty-array
 * branch. Against an infinite tolerance it reads as a HIT instead; that is
 * reachable only through an unclamped `camera.zoom` of `0` (file header's
 * PRECONDITION, D-062), never through this file's own arithmetic.
 */
function distanceToClosedPolyline(point: Point, vertices: readonly Point[]): number {
  let minDistance = Infinity;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (a === undefined || b === undefined) {
      continue; // noUncheckedIndexedAccess artifact only — both indices are always in range.
    }
    const distance = distanceToSegment(point, a, b);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
}

/**
 * `circle`/`polygon`/`rect`'s shared hit test (file header: all three read
 * `vertices`). `false` for a missing/wrong-typed/`ErrorValue` `vertices`
 * slot — never throws.
 */
function hitTestVerticesShape(object: GraphObject, worldPoint: WorldPoint, strokeToleranceWorld: number): boolean {
  const vertices = asPointArray(getSlot(object, VERTICES_PATH)?.value);
  if (vertices === undefined || vertices.length === 0) {
    return false;
  }
  return distanceToClosedPolyline(worldPoint, vertices) <= strokeToleranceWorld;
}

/**
 * `table`'s bounding-box test (§5.9). Built from the exact same
 * origin/cell-size reading `renderer.ts`'s `drawTable` uses, including its
 * `(0, 0)` fallback for a table with no `origin.x`/`origin.y` slots yet
 * (`renderer.ts`'s own NOT DONE HERE) — never throws.
 *
 * A table with NO EXTENT is not hittable (D-066): `getTableDimensions` fails
 * safe to `0` for an absent or non-`literal` dimension (D-046), and
 * `drawTable`'s loops then run zero times, so nothing is drawn to click on.
 * The bounds below are inclusive — a real table's boundary is exactly where
 * its outermost cell rect is STROKED — which is why the degenerate case needs
 * its own guard rather than falling out: without it a `0`-row table is
 * clickable along a line, and one carrying no dimension slots at all is
 * clickable at world `(0, 0)`.
 */
function hitTestTable(object: GraphObject, worldPoint: WorldPoint): boolean {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);
  const width = cols * TABLE_CELL_WIDTH;
  const height = rows * TABLE_CELL_HEIGHT;
  if (width <= 0 || height <= 0) {
    return false;
  }
  return worldPoint.x >= originX && worldPoint.x <= originX + width && worldPoint.y >= originY && worldPoint.y <= originY + height;
}

/**
 * §5.9's "bounding box for text ... and images" — an inclusive point-in-box test
 * against the object's `extent.ts` extent, which is the exact box `renderer.ts`
 * draws into (D-066: drawn extent and clickable extent are ONE extent; D-010:
 * read once, not re-derived). `false` for an object with no extent — a `text`
 * object with no resolved content, or an `image` object with a non-positive
 * `width`/`height` — since nothing is drawn to click on. Inclusive bounds, the
 * same as `hitTestTable`; neither `textExtent` nor `imageExtent` returns a
 * zero-area box, so no separate degenerate guard is needed here.
 */
function hitTestBoundingBox(object: GraphObject, worldPoint: WorldPoint): boolean {
  const extent = objectExtent(object);
  if (extent === undefined) {
    return false;
  }
  return worldPoint.x >= extent.minX && worldPoint.x <= extent.maxX && worldPoint.y >= extent.minY && worldPoint.y <= extent.maxY;
}

/** Dispatches by `ObjectType` (mirrors `renderer.ts`'s `drawObject` switch exactly — same style, same exhaustiveness idiom). */
function hitTestObject(object: GraphObject, worldPoint: WorldPoint, strokeToleranceWorld: number): boolean {
  switch (object.type) {
    case "circle":
    case "polygon":
    case "rect":
      return hitTestVerticesShape(object, worldPoint, strokeToleranceWorld);
    case "table":
      return hitTestTable(object, worldPoint);
    case "text":
    case "image":
    case "script":
      return hitTestBoundingBox(object, worldPoint);
    case "polyline":
    case "value":
    case "add":
      return false; // No visual definition yet (file header) — nothing to hit.
    default: {
      // Compile-time exhaustiveness, without a throw — the same idiom
      // `renderer.ts`'s `drawObject` carries (0062-REVIEW edit 1), so a new
      // `ObjectType` is a compile error here too, not a silently un-hittable object.
      const exhaustive: never = object.type;
      void exhaustive;
      return false;
    }
  }
}

/**
 * §5.9: "screen point -> topmost object." Returns the topmost (highest
 * array index — see file header) object whose own hit test passes at
 * `screenPoint`, or `undefined` if none does. Never throws.
 */
export function hitTest(screenPoint: ScreenPoint, objects: readonly GraphObject[], camera: CameraState): GraphObject | undefined {
  const worldPoint = screenToWorld(camera, screenPoint);
  const strokeToleranceWorld = STROKE_HIT_TOLERANCE_SCREEN_PIXELS / camera.zoom;
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const object = objects[i];
    if (object === undefined) {
      continue; // noUncheckedIndexedAccess artifact only — i is always in range.
    }
    if (hitTestObject(object, worldPoint, strokeToleranceWorld)) {
      return object;
    }
  }
  return undefined;
}
