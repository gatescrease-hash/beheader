/**
 * arrange.test.ts
 *
 * These tests cover the arrangements of section 20 through the command line:
 * `arrange flow` in dependency order, `arrange grid`, `arrange tidy`,
 * `align`, `distribute`, the rule that a position a formula drives holds
 * still, a group moving with its members, and one undo taking an arrangement
 * back.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type GraphObject } from "./engine/index.ts";
import { objectExtent } from "./render/extent.ts";
import { initialAppState, submitLine, withSelection, type AppState, type Viewport } from "./main.ts";

const VIEWPORT: Viewport = { width: 800, height: 600 };

function typed(state: AppState, ...lines: readonly string[]): AppState {
  return lines.reduce((current, line) => submitLine(current, line, VIEWPORT).state, state);
}

function named(state: AppState, name: string): GraphObject {
  const object = state.document.objects.find((candidate) => candidate.name === name);
  if (object === undefined) throw new Error(`no object named ${name}`);
  return object;
}

function box(state: AppState, name: string) {
  const extent = objectExtent(named(state, name));
  if (extent === undefined) throw new Error(`${name} has no box`);
  return extent;
}

function selecting(state: AppState, ...names: readonly string[]): AppState {
  return withSelection(state, names.map((name) => named(state, name).id));
}

/** A chain read right to left: circle_3 reads circle_2, which reads circle_1, and circle_4 stands alone. */
function chain(): AppState {
  return typed(
    initialAppState(createEmptyDocument()),
    "circle x=600 y=0 r=10",
    "circle x=300 y=50 r=10",
    "circle x=0 y=100 r=10",
    "circle x=900 y=200 r=10",
    "set circle_2.radius = circle_1.radius",
    "set circle_3.radius = circle_2.radius",
  );
}

describe("arrange flow", () => {
  it("puts sources left and readers right, one column per step of depth, as one undo step", () => {
    const arranged = typed(chain(), "arrange flow");
    expect(arranged.log.at(-1)).toBe("arrange flow moved 4 objects");
    expect(box(arranged, "circle_1").minX).toBe(box(arranged, "circle_4").minX);
    expect(box(arranged, "circle_1").minX).toBeLessThan(box(arranged, "circle_2").minX);
    expect(box(arranged, "circle_2").minX).toBeLessThan(box(arranged, "circle_3").minX);
    expect(arranged.document.journal.length).toBe(chain().document.journal.length + 1);
    const undone = typed(arranged, "undo");
    expect(box(undone, "circle_3")).toEqual(box(chain(), "circle_3"));
  });

  it("leaves a position a formula drives where it is, moves the literal part, and names the object", () => {
    const state = typed(chain(), "set circle_4.origin.x = 900");
    const arranged = typed(state, "arrange flow");
    expect(arranged.log.at(-1)).toBe("left 1 where a formula holds it: circle_4");
    expect(box(arranged, "circle_4").minX).toBe(890);
  });
});

describe("arrange grid and tidy", () => {
  it("lays the objects out in rows and columns in document order", () => {
    const arranged = typed(chain(), "arrange grid");
    expect(box(arranged, "circle_1").minY).toBe(box(arranged, "circle_2").minY);
    expect(box(arranged, "circle_3").minX).toBe(box(arranged, "circle_1").minX);
    expect(box(arranged, "circle_3").minY).toBeGreaterThan(box(arranged, "circle_1").maxY);
  });

  it("snaps each box to the grid the canvas shows at the current zoom", () => {
    const arranged = typed(initialAppState(createEmptyDocument()), "circle x=13 y=27 r=10", "arrange tidy");
    expect(box(arranged, "circle_1").minX % 10).toBe(0);
    expect(box(arranged, "circle_1").minY % 10).toBe(0);
  });
});

describe("align and distribute", () => {
  it("align left lines the selection up on its leftmost edge and leaves the rest alone", () => {
    const aligned = typed(selecting(chain(), "circle_1", "circle_2"), "align left");
    expect(box(aligned, "circle_1").minX).toBe(290);
    expect(box(aligned, "circle_2").minX).toBe(290);
    expect(box(aligned, "circle_3")).toEqual(box(chain(), "circle_3"));
  });

  it("distribute x makes every gap between neighbours the same, with the outer two still", () => {
    const state = typed(chain(), "set circle_2.origin.x 100");
    const spread = typed(selecting(state, "circle_1", "circle_2", "circle_3"), "distribute x");
    const left = box(spread, "circle_3");
    const middle = box(spread, "circle_2");
    const right = box(spread, "circle_1");
    expect(left.minX).toBe(-10);
    expect(right.maxX).toBe(610);
    expect(middle.minX - left.maxX).toBeCloseTo(right.minX - middle.maxX, 9);
  });

  it("refuses a selection too small to line up", () => {
    const refused = submitLine(selecting(chain(), "circle_1"), "align left", VIEWPORT);
    expect(refused.refused).toBe(true);
    expect(refused.state.log.at(-1)).toContain("2 or more");
    expect(submitLine(chain(), "distribute x", VIEWPORT).state.log.at(-1)).toContain("3 or more");
  });

  it("moves a group with everything in it", () => {
    const grouped = typed(chain(), "group circle_1,circle_2", "circle x=0 y=600 r=10");
    const aligned = typed(selecting(grouped, "group_1", "circle_5"), "align left");
    const groupShift = box(aligned, "circle_1").minX - box(grouped, "circle_1").minX;
    expect(groupShift).not.toBe(0);
    expect(box(aligned, "circle_2").minX - box(grouped, "circle_2").minX).toBe(groupShift);
  });
});
