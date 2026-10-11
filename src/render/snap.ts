/**
 * snap.ts
 *
 * Where a drag lands when it comes near a line worth lining up with, and the
 * guides that show the lines it lines up with.
 *
 * What moves has a box, and the box offers three lines across each axis: its
 * two edges and its centre. Every other object on show offers the same three
 * lines of its own box, and a group offers the outline it draws. When one of
 * the moving lines comes within a few screen pixels of one of those, the drag
 * moves the rest of the way, so the objects land exactly on the line, and a
 * guide draws along it across both boxes. With no object line in reach, the
 * top left corner of the box snaps to the grid the canvas shows, the same grid
 * `arrange tidy` snaps to, with no guide, because the grid is on screen
 * already.
 *
 * The snap works from the box as it stood at the press plus the whole travel
 * of the pointer, never from where the last frame left the objects. A snap
 * built on the last frame would hold the box on a line for good, since every
 * small step afterwards lands back within reach of the line it just took.
 * Measured from the press, a pointer that moves out of reach leaves the line.
 *
 * An axis along which the drag writes nothing, because a formula holds that
 * position for every moving object, neither snaps nor draws a guide.
 *
 * The lines sit in arrays sorted by position, built once at the press, so each
 * frame finds its nearest line by a binary search rather than by a pass over
 * the document.
 *
 * Render-layer code: it reads boxes and draws through DrawingContext, with no
 * DOM and no engine state of its own.
 */
import type { CameraState } from "../engine/index.ts";
import { worldToScreen } from "./camera.ts";
import type { DrawingContext } from "./drawing.ts";
import type { WorldExtent } from "./extent.ts";

/** How near a line a moving edge or centre comes, in screen pixels, before it snaps. */
export const SNAP_TOLERANCE_SCREEN_PIXELS = 6;

/**
 * One line a moving box can line up with: where it sits across its axis, and
 * the span along the axis that the box offering it covers, which a guide draws.
 */
export interface SnapLine {
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/** What a drag snaps against, worked out once at the press. */
export interface SnapTargets {
  /** The box of what moves, as it stood at the press. */
  readonly box: WorldExtent;
  /** The vertical lines, which an x position lines up with, sorted by position. */
  readonly xs: readonly SnapLine[];
  /** The horizontal lines, which a y position lines up with, sorted by position. */
  readonly ys: readonly SnapLine[];
  readonly freeX: boolean;
  readonly freeY: boolean;
}

/** A line to draw while a snap holds: vertical for "x", horizontal for "y". */
export interface Guide {
  readonly axis: "x" | "y";
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

export interface SnapResult {
  readonly travel: { readonly x: number; readonly y: number };
  readonly guides: readonly Guide[];
}

/** The lines a box offers across one axis: its low edge, its centre and its high edge. */
function linesOf(box: WorldExtent, axis: "x" | "y"): readonly SnapLine[] {
  const [low, high, from, to] = axis === "x" ? [box.minX, box.maxX, box.minY, box.maxY] : [box.minY, box.maxY, box.minX, box.maxX];
  return [low, (low + high) / 2, high].map((at) => ({ at, from, to }));
}

/** The targets for a drag of a box, against the boxes of everything else on show. */
export function snapTargets(box: WorldExtent, others: readonly WorldExtent[], freeX: boolean, freeY: boolean): SnapTargets {
  const byPosition = (a: SnapLine, b: SnapLine): number => a.at - b.at;
  return {
    box,
    xs: others.flatMap((other) => linesOf(other, "x")).sort(byPosition),
    ys: others.flatMap((other) => linesOf(other, "y")).sort(byPosition),
    freeX,
    freeY,
  };
}

/** The index of the first line at or past a position. */
function firstAtOrPast(lines: readonly SnapLine[], at: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lines[middle]!.at < at) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The nearest line to a position within a tolerance, or undefined. */
function nearestLine(lines: readonly SnapLine[], at: number, tolerance: number): SnapLine | undefined {
  const index = firstAtOrPast(lines, at);
  const candidates = [lines[index - 1], lines[index]].filter((line): line is SnapLine => line !== undefined && Math.abs(line.at - at) <= tolerance);
  return candidates.sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
}

/** Every line that sits at a position, give or take a rounding error. */
function linesAt(lines: readonly SnapLine[], at: number): readonly SnapLine[] {
  const nearby = Math.max(1e-9, Math.abs(at) * 1e-12);
  const found: SnapLine[] = [];
  for (let index = firstAtOrPast(lines, at - nearby); index < lines.length && lines[index]!.at <= at + nearby; index += 1) {
    found.push(lines[index]!);
  }
  return found;
}

/**
 * The offset along one axis that puts the nearest of the three moving lines on
 * a target line, or failing that the low edge on the grid, within the
 * tolerance. Zero when nothing is in reach.
 */
function axisOffset(moving: readonly number[], lines: readonly SnapLine[], tolerance: number, gridStep: number | undefined): number {
  let best: number | undefined;
  for (const at of moving) {
    const line = nearestLine(lines, at, tolerance);
    if (line !== undefined && (best === undefined || Math.abs(line.at - at) < Math.abs(best))) {
      best = line.at - at;
    }
  }
  if (best !== undefined) {
    return best;
  }
  if (gridStep !== undefined && gridStep > 0) {
    const low = moving[0]!;
    const onGrid = Math.round(low / gridStep) * gridStep;
    if (Math.abs(onGrid - low) <= tolerance) {
      return onGrid - low;
    }
  }
  return 0;
}

/**
 * Where the drag lands: the travel of the pointer since the press, moved the
 * rest of the way onto the nearest line along each free axis, and the guides
 * for every line the moved box then sits on.
 */
export function snapTravel(targets: SnapTargets, travel: { readonly x: number; readonly y: number }, tolerance: number, gridStep?: number): SnapResult {
  const { box } = targets;
  const across = (low: number, high: number, shift: number): readonly number[] => [low + shift, (low + high) / 2 + shift, high + shift];
  const x = targets.freeX ? travel.x + axisOffset(across(box.minX, box.maxX, travel.x), targets.xs, tolerance, gridStep) : travel.x;
  const y = targets.freeY ? travel.y + axisOffset(across(box.minY, box.maxY, travel.y), targets.ys, tolerance, gridStep) : travel.y;
  const moved: WorldExtent = { minX: box.minX + x, minY: box.minY + y, maxX: box.maxX + x, maxY: box.maxY + y };
  const guides: Guide[] = [];
  const guideAlong = (axis: "x" | "y", positions: readonly number[], lines: readonly SnapLine[], from: number, to: number): void => {
    for (const at of positions) {
      const matched = linesAt(lines, at);
      if (matched.length === 0) continue;
      guides.push({ axis, at, from: Math.min(from, ...matched.map((line) => line.from)), to: Math.max(to, ...matched.map((line) => line.to)) });
    }
  };
  if (targets.freeX) guideAlong("x", across(moved.minX, moved.maxX, 0), targets.xs, moved.minY, moved.maxY);
  if (targets.freeY) guideAlong("y", across(moved.minY, moved.maxY, 0), targets.ys, moved.minX, moved.maxX);
  return { travel: { x, y }, guides };
}

/** The colour of a guide, which no object on the canvas uses by default. */
const GUIDE_COLOR = "#e8338b";

/**
 * Draws the guides in screen space, one device pixel wide at any zoom, so a
 * guide reads as a hairline over the drawing rather than as part of it.
 */
export function drawGuides(ctx: DrawingContext, camera: CameraState, guides: readonly Guide[], pixelRatio: number = 1): void {
  if (guides.length === 0) {
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = pixelRatio;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const guide of guides) {
    const start = worldToScreen(camera, guide.axis === "x" ? { x: guide.at, y: guide.from } : { x: guide.from, y: guide.at });
    const end = worldToScreen(camera, guide.axis === "x" ? { x: guide.at, y: guide.to } : { x: guide.to, y: guide.at });
    // Half a pixel off the pixel grid puts a hairline on one row of pixels.
    const offset = guide.axis === "x" ? { x: 0.5, y: 0 } : { x: 0, y: 0.5 };
    ctx.moveTo(Math.round(start.x) + offset.x, Math.round(start.y) + offset.y);
    ctx.lineTo(Math.round(end.x) + offset.x, Math.round(end.y) + offset.y);
  }
  ctx.stroke();
  ctx.restore();
}
