/**
 * main.test.ts — Tests for `main.ts`'s pure half (§5.9, §5.10, §5.11).
 *
 * What is covered and what is not: `AppState` and every transition over it are
 * covered here; `start` and the two file helpers below it are NOT, because they
 * need a DOM and this project adds no test dependency to get one (D-001,
 * PROCESS_BRIEF §4). Importing this module is itself part of the claim — the
 * bootstrap is guarded on `typeof document`, so a `node` environment reaches the
 * pure half without touching a browser that is not there.
 *
 * Lines go in as the operator would type them, through `submitLine`, wherever
 * the point is end to end: this is the file where a typed line, a command
 * handler, a mutation, a camera and the selection all meet, and a fixture that
 * skipped the typing would not be testing that.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, deserializeDocument, saveDocument, type CameraState, type Document } from "./engine/document.ts";
import { getSlot, type GraphObject } from "./engine/graph/node.ts";
import { renderDocument } from "./render/renderer.ts";
import { MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen } from "./render/camera.ts";
import {
  escape,
  initialAppState,
  performEffect,
  pointerDownAt,
  pointerMoveTo,
  panByScreen,
  pointerUpNow,
  replaceDocument,
  respondToPrompt,
  submitLine,
  wheelZoomAt,
  type AppState,
  type Viewport,
} from "./main.ts";

const VIEWPORT: Viewport = { width: 800, height: 600 };

/** A fresh application, as `start` opens one. */
function opened(): AppState {
  return initialAppState(createEmptyDocument());
}

/** Types one line and returns the new state, or throws naming the last line echoed — the mirror of `commands.test.ts`'s `committed`. */
function typed(state: AppState, line: string): AppState {
  return submitLine(state, line, VIEWPORT).state;
}

/** The object of that name, or a thrown test failure. Tests may resolve a name; `main.ts` itself never does (D-082 clause 4). */
function objectNamed(state: AppState, name: string): GraphObject {
  const found = state.document.objects.find((object) => object.name === name);
  if (found === undefined) {
    throw new Error(`expected an object named "${name}", have: ${state.document.objects.map((object) => object.name).join(", ")}`);
  }
  return found;
}

/** A slot's current numeric value, or a thrown test failure naming what was there instead. */
function numberAt(object: GraphObject, path: readonly string[]): number {
  const value = getSlot(object, path)?.value;
  if (typeof value !== "number") {
    throw new Error(`expected a number at ${path.join(".")}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** The lines added by the last transition. */
function newLines(before: AppState, after: AppState): readonly string[] {
  return after.log.slice(before.log.length);
}

describe("submitLine — a typed line reaches a handler and its result is echoed (§5.10)", () => {
  it("creates an object from a complete line and echoes what the handler said", () => {
    const state = typed(opened(), "polygon sides=5 x=10 y=20 r=50");
    expect(state.document.objects).toHaveLength(1);
    expect(objectNamed(state, "polygon_1").type).toBe("polygon");
    expect(state.log.some((line) => line.includes("polygon_1"))).toBe(true);
  });

  it("echoes the line itself before the result, so the log reads as a transcript", () => {
    const before = opened();
    const after = typed(before, "list");
    expect(newLines(before, after)[0]).toBe("> list");
  });

  it("echoes a refusal and changes nothing", () => {
    const before = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const after = typed(before, "delete nothing_here");
    expect(after.document.objects).toEqual(before.document.objects);
    expect(newLines(before, after).join("\n")).toContain("nothing_here");
  });

  it("echoes a parse failure from a line no command could be built from", () => {
    const before = opened();
    const after = typed(before, "wobble 3");
    expect(after.document).toBe(before.document);
    expect(newLines(before, after).join("\n")).toContain("wobble");
  });

  it("carries the document forward across lines, so a later command sees an earlier one's object", () => {
    let state = typed(opened(), "table x=0 y=0 rows=2 cols=2");
    state = typed(state, "set table_1.A1 7");
    expect(numberAt(objectNamed(state, "table_1"), ["cells", "A1"])).toBe(7);
  });
});

describe("submitLine — a command word alone enters its prompt sequence (D-072)", () => {
  it("holds the pending command and echoes the first step's message", () => {
    const before = opened();
    const after = typed(before, "circle");
    expect(after.pending?.commandName).toBe("circle");
    expect(newLines(before, after).length).toBeGreaterThan(1);
  });

  it("routes the NEXT typed line to the live sequence rather than to a fresh command word", () => {
    let state = typed(opened(), "circle");
    state = typed(state, "100,100");
    expect(state.pending?.stepIndex).toBe(1);
    state = typed(state, "20");
    expect(state.pending).toBeUndefined();
    expect(objectNamed(state, "circle_1").type).toBe("circle");
    expect(numberAt(objectNamed(state, "circle_1"), ["radius"])).toBe(20);
  });

  it("re-asks the same step with the sequence's own refusal when an answer is refused, keeping the answers already gathered (D-072 clause 7, D-074)", () => {
    let state = typed(opened(), "circle");
    state = typed(state, "100,100");
    const before = state;
    state = typed(state, "not-a-radius");
    expect(state.pending?.stepIndex).toBe(1); // the same step, not the next one
    expect(state.pending?.answers).toEqual(before.pending?.answers);
    expect(newLines(before, state).length).toBeGreaterThan(2); // the echo, the refusal, the re-ask
  });

  it("escape abandons the sequence and clears the selection — one key, §5.9's deselect and D-072's cancel", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "select polygon_1");
    state = typed(state, "circle");
    expect(state.pending).toBeDefined();
    const escaped = escape(state);
    expect(escaped.pending).toBeUndefined();
    expect(escaped.interaction.selectedObjectId).toBeUndefined();
    expect(escaped.log[escaped.log.length - 1]).toBe("cancelled");
  });
});

describe("performEffect — select (D-075, D-082)", () => {
  it("selects the ID the effect carried, resolving no name of its own", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const id = objectNamed(state, "polygon_1").id;
    const performed = performEffect({ kind: "select", objectId: id }, state, VIEWPORT).state;
    expect(performed.interaction.selectedObjectId).toBe(id);
  });

  it("is what makes `select <name>` from the input bar actually select something", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const id = objectNamed(state, "polygon_1").id;
    state = typed(state, "select polygon_1");
    expect(state.interaction.selectedObjectId).toBe(id);
  });

  it("clears any drag, because a selection made from the input bar has no pointer holding it", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(state.interaction.drag).toBeDefined();
    state = typed(state, "select polygon_1");
    expect(state.interaction.drag).toBeUndefined();
  });

  it("refuses an unknown name in `commands.ts`, which is why no arm here has to (D-075 clause 1)", () => {
    const before = opened();
    const after = typed(before, "select nothing_here");
    expect(after.interaction.selectedObjectId).toBeUndefined();
    expect(newLines(before, after).join("\n")).toContain("nothing_here");
  });
});

describe("performEffect — zoom and fit write the camera directly (D-027 clause 2, D-075 clause 5)", () => {
  it("multiplies the current zoom by the factor and never reaches `mutate`", () => {
    const before = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const after = typed(before, "zoom 2");
    expect(after.document.camera.zoom).toBe(2);
    expect(after.document.journal).toEqual(before.document.journal);
    expect(after.document.objects).toBe(before.document.objects);
  });

  it("keeps the viewport's centre fixed in world space, because a typed zoom has no cursor to zoom toward", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const centre: { x: number; y: number } = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const worldBefore = screenToWorld(state.document.camera, centre);
    const zoomed = typed(state, "zoom 4");
    expect(screenToWorld(zoomed.document.camera, centre)).toEqual(worldBefore);
  });

  it("clamps to render/'s range and reports the CLAMPED value, which commands.ts could not have predicted (D-082 clause 5)", () => {
    const before = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const after = typed(before, "zoom 1000000");
    expect(after.document.camera.zoom).toBe(MAX_ZOOM);
    expect(newLines(before, after).join("\n")).toContain(`${MAX_ZOOM}`);
    expect(newLines(before, after).join("\n")).toContain("clamped");
  });

  it("refuses a zoom factor of 0 in `commands.ts` rather than absorbing it into MIN_ZOOM here (D-082 clauses 1-2)", () => {
    const before = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const after = typed(before, "zoom 0");
    expect(after.document.camera).toEqual(before.document.camera);
  });

  it("fits the whole document into the viewport and lands inside the zoom range", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "table x=1000 y=1000 rows=2 cols=2");
    const fitted = typed(state, "fit").document.camera;
    expect(fitted.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(fitted.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    // Everything the document draws is on screen afterwards: both corners of the
    // extent map inside the viewport under the fitted camera.
    const topLeft = worldToScreen(fitted, { x: -50, y: -50 });
    const bottomRight = worldToScreen(fitted, { x: 1160, y: 1048 });
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(VIEWPORT.width);
    expect(bottomRight.y).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("refuses `fit` over an empty document in `commands.ts`, and says so", () => {
    const before = opened();
    const after = typed(before, "fit");
    expect(after.document.camera).toEqual(before.document.camera);
    expect(newLines(before, after).length).toBe(2); // the echo, and one refusal
  });

  it("centres a DEGENERATE single-point extent at the current zoom instead of dividing by it (D-066)", () => {
    // A zero-radius circle: the extent is one point, so width and height are 0.
    // `commands.ts` cannot refuse this — the document is not empty — which is why
    // D-066 says the guard here is not discharged by that refusal.
    let state = typed(opened(), "circle x=100 y=100 r=0");
    const zoomBefore = state.document.camera.zoom;
    state = typed(state, "fit");
    expect(state.document.camera.zoom).toBe(zoomBefore);
    expect(Number.isFinite(state.document.camera.x)).toBe(true);
    expect(worldToScreen(state.document.camera, { x: 100, y: 100 })).toEqual({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    expect(state.log[state.log.length - 1]).toContain("single point");
  });

  it("fits a FLAT extent to its one real axis instead of calling it a point (0090-REVIEW F2)", () => {
    // `rect w=200 h=0` is legal — no creation handler bounds a rect's size — and
    // its extent has width but no height. That is not D-066's degeneracy: there
    // is an axis to fit to, and a guard demanding BOTH axes refused it and
    // reported "a single point", which was also untrue.
    let state = typed(opened(), "rect x=0 y=0 w=200 h=0");
    const zoomBefore = state.document.camera.zoom;
    state = typed(state, "fit");
    expect(state.document.camera.zoom).toBe((VIEWPORT.width * 0.9) / 200);
    expect(state.document.camera.zoom).not.toBe(zoomBefore);
    expect(worldToScreen(state.document.camera, { x: 100, y: 0 })).toEqual({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    expect(state.log[state.log.length - 1]).not.toContain("single point");
  });

  it("says so, and moves nothing, when objects exist but none of them draws anything", () => {
    // Reachable only through a document this build did not create by command —
    // `text` has no schema yet. It is the other emptiness `documentExtent`
    // reports, and the branch exists because `commands.ts` cannot see it.
    const undrawable: Document = { ...createEmptyDocument(), objects: [{ id: "obj_1", name: "text_1", type: "text", slots: {} }] };
    const before = initialAppState(undrawable);
    const after = performEffect({ kind: "fit" }, before, VIEWPORT).state;
    expect(after.document.camera).toEqual(before.document.camera);
    expect(after.log[after.log.length - 1]).toContain("extent");
  });
});

describe("performEffect — save and load are the two this file cannot finish alone (§5.11)", () => {
  it("asks the DOM half for a save and changes no state", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const transition = performEffect({ kind: "save" }, state, VIEWPORT);
    expect(transition.fileRequest).toBe("save");
    expect(transition.state).toBe(state);
  });

  it("asks the DOM half for a load and changes no state until a file arrives", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const transition = performEffect({ kind: "load" }, state, VIEWPORT);
    expect(transition.fileRequest).toBe("load");
    expect(transition.state).toBe(state);
  });

  it("reaches those requests from the typed lines §5.10 names", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    expect(submitLine(state, "save", VIEWPORT).fileRequest).toBe("save");
    expect(submitLine(state, "load", VIEWPORT).fileRequest).toBe("load");
  });

  it("round-trips a document the operator built by command, which is what `save` then `load` means", () => {
    let state = typed(opened(), "polygon sides=5 x=10 y=20 r=50");
    state = typed(state, "table x=0 y=0 rows=2 cols=2");
    const saved = saveDocument(state.document);
    const loaded = deserializeDocument(JSON.parse(saved));
    if (!loaded.ok) {
      throw new Error(`expected a saved document to load, got: ${loaded.message}`);
    }
    const reopened = replaceDocument(state, loaded.document, "loaded test.json");
    expect(saveDocument(reopened.document)).toBe(saved);
    expect(reopened.interaction.selectedObjectId).toBeUndefined();
    expect(reopened.pending).toBeUndefined();
  });
});

describe("the camera in AppState is always usable (D-062)", () => {
  it("clamps a loaded camera at the boundary, so hit-testing and drawing never see zoom 0", () => {
    const raw = { formatVersion: 1, nextObjectId: 1, objects: [], journal: [], camera: { x: 5, y: 6, zoom: 0 } };
    const loaded = deserializeDocument(raw);
    if (!loaded.ok) {
      throw new Error(`expected the zero-zoom camera to LOAD, got: ${loaded.message}`);
    }
    expect(initialAppState(loaded.document).document.camera.zoom).toBe(MIN_ZOOM);
  });

  it("clamps on a load that replaces a live document, not only at startup", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const strange: Document = { ...createEmptyDocument(), camera: { x: 0, y: 0, zoom: -5 } as CameraState };
    expect(replaceDocument(state, strange, "loaded strange.json").document.camera.zoom).toBe(MIN_ZOOM);
  });
});

describe("pointer and wheel (§5.9)", () => {
  it("selects what is under the pointer and arms a drag", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const pressed = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(pressed.interaction.selectedObjectId).toBe(objectNamed(state, "polygon_1").id);
    expect(pressed.interaction.drag?.objectId).toBe(objectNamed(state, "polygon_1").id);
  });

  it("selects nothing on empty canvas", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    expect(pointerDownAt(state, { x: 9999, y: 9999 }, VIEWPORT).state.interaction.selectedObjectId).toBeUndefined();
  });

  it("answers a live prompt step with a PICKED world point instead of selecting (D-072)", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "circle");
    // The pointer is over the polygon: without D-072's rule this press would
    // select it. During a live sequence it is an answer to the step instead.
    const picked = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(picked.interaction.selectedObjectId).toBeUndefined();
    expect(picked.pending?.stepIndex).toBe(1);
  });

  it("drops a picked point when no sequence is live, rather than misrouting it into a command that ended", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    expect(respondToPrompt(state, { kind: "picked", point: { x: 1, y: 2 } }, VIEWPORT).state).toBe(state);
  });

  it("converts a pick to WORLD space with the current camera before it reaches command/ (D-069)", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "zoom 2"); // camera is no longer the identity
    state = typed(state, "circle");
    const world = screenToWorld(state.document.camera, { x: 300, y: 200 });
    let picked = pointerDownAt(state, { x: 300, y: 200 }, VIEWPORT).state;
    picked = typed(picked, "10");
    const circle = objectNamed(picked, "circle_1");
    expect(numberAt(circle, ["origin", "x"])).toBeCloseTo(world.x, 9);
    expect(numberAt(circle, ["origin", "y"])).toBeCloseTo(world.y, 9);
  });

  it("zooms to the CURSOR on the wheel, keeping the world point under it fixed (§5.9)", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const cursor = { x: 700, y: 100 };
    const worldBefore = screenToWorld(state.document.camera, cursor);
    const zoomedIn = wheelZoomAt(state, cursor, -100);
    expect(zoomedIn.document.camera.zoom).toBeGreaterThan(state.document.camera.zoom);
    expect(screenToWorld(zoomedIn.document.camera, cursor).x).toBeCloseTo(worldBefore.x, 9);
    expect(screenToWorld(zoomedIn.document.camera, cursor).y).toBeCloseTo(worldBefore.y, 9);
    expect(wheelZoomAt(state, cursor, 100).document.camera.zoom).toBeLessThan(state.document.camera.zoom);
  });
});

describe("Phase 3's acceptance criterion, end to end", () => {
  // "Create a polygon and a table by command, see both drawn, pan/zoom, select,
  // and drag the polygon." Every step below is one typed line or one pointer
  // gesture against ONE state, in the order the criterion names them.
  //
  // What the tests CANNOT show is the picture itself: they assert the draw calls
  // `renderer.ts` makes, not pixels. The manual check is described in the log
  // entry (PROCESS_BRIEF §12 item 1).

  type DrawCall = { readonly op: string };

  /** A recording fake — only the members `renderer.ts` calls (the same posture `renderer.test.ts` takes; no jsdom, no dependency). */
  function createFakeContext(): { readonly ctx: CanvasRenderingContext2D; readonly calls: readonly DrawCall[] } {
    const calls: DrawCall[] = [];
    const record = (op: string) => () => {
      calls.push({ op });
    };
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textAlign: "left",
      textBaseline: "alphabetic",
      font: "",
      setTransform: record("setTransform"),
      clearRect: record("clearRect"),
      beginPath: record("beginPath"),
      moveTo: record("moveTo"),
      lineTo: record("lineTo"),
      closePath: record("closePath"),
      stroke: record("stroke"),
      arc: record("arc"),
      strokeRect: record("strokeRect"),
      fillText: record("fillText"),
      // `renderer.ts` measures a name label to place the chrome beside it
      // (entry 0094). A fixed-width fake, like `renderer.test.ts`'s — this
      // test asserts WHICH calls happen, never where the text lands.
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  it("creates a polygon and a table by command, draws both, pans, zooms, selects, and drags the polygon", () => {
    let state = opened();

    // 1. Create a polygon and a table by command.
    state = typed(state, "polygon sides=5 x=100 y=100 r=50");
    state = typed(state, "table x=300 y=100 rows=3 cols=3");
    expect(state.document.objects.map((object) => object.name)).toEqual(["polygon_1", "table_1"]);

    // 2. See both drawn. The polygon is a stroked path; the table is stroked
    //    cell rects. Both reach the context in one `renderDocument` call.
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, VIEWPORT.width, VIEWPORT.height, state.document.objects, state.document.camera);
    expect(calls.filter((call) => call.op === "stroke").length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.op === "strokeRect").length).toBe(9); // 3x3 cells

    // 3. Pan and zoom. The pan is the screen-space delta a middle-drag produces:
    //    the content follows the pointer, so the world point drawn at screen
    //    (0,0) moves left by exactly the delta at zoom 1.
    const worldAtScreenOrigin = state.document.camera;
    state = panByScreen(state, 40, 25);
    expect(state.document.camera.x).toBeCloseTo(worldAtScreenOrigin.x - 40, 9);
    expect(state.document.camera.y).toBeCloseTo(worldAtScreenOrigin.y - 25, 9);
    state = wheelZoomAt(state, { x: 400, y: 300 }, -100);
    expect(state.document.camera.zoom).toBeGreaterThan(1);
    state = typed(state, "zoom 2");
    expect(state.document.camera.zoom).toBeGreaterThan(2);

    // 4. Select the polygon by clicking its stroke. The polygon's own vertices
    //    are the hit shape (§5.5), and the camera is no longer the identity, so
    //    this also exercises the screen->world conversion.
    const polygon = objectNamed(state, "polygon_1");
    const vertex = (getSlot(polygon, ["vertices"])?.value as readonly { x: number; y: number }[])[0];
    if (vertex === undefined) {
      throw new Error("expected the polygon's derived vertices to have been evaluated");
    }
    const onStroke = worldToScreen(state.document.camera, vertex);
    state = pointerDownAt(state, onStroke, VIEWPORT).state;
    expect(state.interaction.selectedObjectId).toBe(polygon.id);

    // 5. Drag it. The origin slots are literal, so both components move, and
    //    they move through `mutate` — the journal grows (Rule 2).
    const originXBefore = numberAt(objectNamed(state, "polygon_1"), ["origin", "x"]);
    const journalBefore = state.document.journal.length;
    state = pointerMoveTo(state, { x: onStroke.x + 40, y: onStroke.y + 40 });
    state = pointerUpNow(state);
    const originXAfter = numberAt(objectNamed(state, "polygon_1"), ["origin", "x"]);
    expect(originXAfter).toBeCloseTo(originXBefore + 40 / state.document.camera.zoom, 9);
    expect(state.document.journal.length).toBeGreaterThan(journalBefore);
    expect(state.interaction.drag).toBeUndefined();
    expect(state.interaction.selectedObjectId).toBe(polygon.id);

    // 6. And the picture keeps up: a second render sees the moved polygon.
    const second = createFakeContext();
    renderDocument(second.ctx, VIEWPORT.width, VIEWPORT.height, state.document.objects, state.document.camera);
    expect(second.calls.filter((call) => call.op === "strokeRect").length).toBe(9);
    expect(second.calls.filter((call) => call.op === "stroke").length).toBeGreaterThan(0);
  });

  it("drags a polygon whose origin.x is a formula along Y only, with §5.9's non-blocking feedback in the log", () => {
    // Phase 4's (c) is not claimed here — this is the Phase 3 half of it: the
    // per-component rule reaching the LOG, which is the only place the operator
    // can currently see it (D-068 defers the on-canvas indicator).
    let state = typed(opened(), "table x=0 y=0 rows=2 cols=2");
    state = typed(state, "set table_1.A1 500");
    state = typed(state, "polygon sides=5 x=100 y=100 r=50");
    state = typed(state, "link polygon_1.origin.x table_1.A1");
    const before = objectNamed(state, "polygon_1");
    expect(numberAt(before, ["origin", "x"])).toBe(500);

    const vertex = (getSlot(before, ["vertices"])?.value as readonly { x: number; y: number }[])[0];
    if (vertex === undefined) {
      throw new Error("expected the polygon's derived vertices to have been evaluated");
    }
    state = pointerDownAt(state, worldToScreen(state.document.camera, vertex), VIEWPORT).state;
    const logBefore = state.log.length;
    state = pointerMoveTo(state, { x: worldToScreen(state.document.camera, vertex).x + 30, y: worldToScreen(state.document.camera, vertex).y + 30 });

    const after = objectNamed(state, "polygon_1");
    expect(numberAt(after, ["origin", "x"])).toBe(500); // driven: did not move
    expect(numberAt(after, ["origin", "y"])).toBeCloseTo(130, 9); // literal: moved
    expect(state.log.slice(logBefore).join("\n")).toContain("table_1.A1");
  });
});
