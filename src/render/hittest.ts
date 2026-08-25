/**
 * hittest.ts — Screen point -> topmost object.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.9 ("Hit-testing: screen point -> topmost
 * object. Point-in-polygon for fills, distance-to-segment with pixel
 * tolerance for strokes and open paths, bounding box for
 * text/tables/images/scripts."). First file building hit-testing — §6.1
 * trigger 2 governs its own review point, the same posture `renderer.ts`
 * took for drawing (0060-REVIEW §10 names this file as the next one).
 * LAYER: render. Touches no canvas/DOM at all — this file is pure coordinate
 * and geometry math over `GraphObject`/`CameraState`, structurally even
 * closer to `engine/` than `renderer.ts` is, but it lives in `render/`
 * because it depends on `render/camera.ts`'s `CameraState`/`screenToWorld`,
 * which Rule 1 forbids `engine/` from depending on in the other direction.
 * May import: engine/* (read-only), own layer. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `hitTest(screenPoint, objects, camera)` — the one exported entry point.
 *   Converts `screenPoint` to world space via `render/camera.ts`'s OWN
 *   `screenToWorld` (D-010: never a second copy of that formula), then walks
 *   `objects` from LAST to FIRST — z-order is array order (`renderer.ts`'s
 *   own disclosed reading; a later object draws OVER an earlier one, so it
 *   is also the one a click should hit first) — and returns the first object
 *   whose own hit-test passes, or `undefined` if none does.
 *
 *   Per-type test, dispatched the same switch-not-table way `renderer.ts`
 *   dispatches drawing (§5.1's own style, PROCESS_BRIEF §5.5):
 *     - `circle`/`polygon`/`rect` — §5.5, verbatim, is why these three share
 *       ONE test even though the renderer draws circle as a true arc: "the
 *       derived `vertices` slot yields a polygonal approximation used for
 *       bounds AND HIT-TESTING." Distance from the world point to the
 *       closest edge of the closed `vertices` polyline, against a tolerance
 *       converted from `STROKE_HIT_TOLERANCE_SCREEN_PIXELS` into world units
 *       via `camera.zoom` — §5.9's own words, "pixel tolerance," so the
 *       tolerance is screen-space regardless of Q-012's still-open
 *       world-vs-screen question for a drawn STROKE WIDTH (a different
 *       property of a different thing; this file takes no side in Q-012).
 *     - `table` — a plain bounding-box containment test (§5.9's own word for
 *       this category), built from the SAME `origin`/`TABLE_CELL_WIDTH`/
 *       `TABLE_CELL_HEIGHT` `renderer.ts` draws with (imported, not
 *       re-declared — D-010), so the clickable box can never drift from the
 *       drawn one.
 *     - `polyline`/`text`/`script`/`image`/`value`/`add` — never hit. None
 *       of these has a schema/visual definition yet (`renderer.ts`'s own
 *       stance, mirrored exactly): a click cannot land on something that is
 *       never drawn.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws. Every read funnels through `renderer.ts`'s own
 *     `readNumber`/`asPointArray` (typeof/`Array.isArray`-narrowed), and a
 *     missing/wrong-typed/`ErrorValue` slot makes that ONE object simply
 *     never hit — it does not abort the scan.
 *   - Reads only; writes nothing (Rule 2 — there is no document state here
 *     to write in the first place).
 *   - PRECONDITION, inherited from `screenToWorld`: `camera.zoom` is
 *     non-zero. A `CameraState` this file itself produces never violates it
 *     (this file produces none), but a camera read off a LOADED document can
 *     (D-062) — the same precondition `render/camera.ts`'s own doc comment
 *     states, and the same answer: the clamp belongs at `main.ts`'s
 *     boundary, not here (0062-REVIEW §9's ruling on `renderDocument`
 *     applies identically to this file's `screenToWorld` call).
 *
 * NOT DONE HERE
 *   - **Point-in-polygon for FILLS.** §5.9 names it explicitly, but nothing
 *     can be filled yet — `primitives/geometry.ts` declares no `style`
 *     slots (its own NOT DONE HERE), and `renderer.ts` never calls
 *     `ctx.fill()`. Building it now would test a property (`fillColor`) no
 *     object can hold, so a click inside an unfilled shape's outline
 *     correctly does NOT hit it today — only the stroke does. **D-064's
 *     CCW-winding invariant is the contract a point-in-polygon test must
 *     honour when it is built** (a winding-number test's sign convention
 *     depends on it); its own pinning test is still owed (0060-REVIEW fix
 *     list item 1) and is NOT added here, since this file's stroke-distance
 *     test does not consume winding at all — distance-to-segment is
 *     direction-agnostic. Comes due with the `style`-slots cycle, same as
 *     Q-012.
 *   - Selection state, click/drag event handling, and calling any mutation —
 *     all `render/interaction.ts`'s job. This file only ANSWERS "what is
 *     under this point," it does not decide what to do with the answer.
 *   - `text`/`script`/`image` bounding boxes — no schema/visual definition
 *     yet (`renderer.ts`'s own NOT DONE HERE); nothing to bound.
 *   - `polyline`'s per-vertex, open-path shape (§5.9: "distance-to-segment...
 *     for... open paths") — deferred with `explode`/`polyline` themselves
 *     (`primitives/geometry.ts`'s own NOT DONE HERE); there is no open-path
 *     schema to read yet.
 */
import { getSlot, type GraphObject, type Point } from "../engine/graph/node.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH, VERTICES_PATH } from "../engine/primitives/geometry.ts";
import { getTableDimensions } from "../engine/primitives/table.ts";
import type { CameraState } from "../engine/document.ts";
import { screenToWorld, type ScreenPoint, type WorldPoint } from "./camera.ts";
import { asPointArray, readNumber, TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./renderer.ts";

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
 * only reads schema-declared slot paths from). `Infinity` for fewer than
 * one vertex (never satisfies any real tolerance, so it reads as "no hit"
 * without a separate empty-array branch).
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
 * (`renderer.ts`'s own NOT DONE HERE) — never throws, and a `0`-row or
 * `0`-column table (D-046-safe `getTableDimensions`) collapses to a
 * zero-area box that no point can ever fall inside.
 */
function hitTestTable(object: GraphObject, worldPoint: WorldPoint): boolean {
  const originX = readNumber(object, ORIGIN_X_PATH) ?? 0;
  const originY = readNumber(object, ORIGIN_Y_PATH) ?? 0;
  const { rows, cols } = getTableDimensions(object);
  const width = cols * TABLE_CELL_WIDTH;
  const height = rows * TABLE_CELL_HEIGHT;
  return worldPoint.x >= originX && worldPoint.x <= originX + width && worldPoint.y >= originY && worldPoint.y <= originY + height;
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
    case "polyline":
    case "text":
    case "script":
    case "image":
    case "value":
    case "add":
      return false; // No schema/visual definition yet (file header) — nothing to hit.
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
