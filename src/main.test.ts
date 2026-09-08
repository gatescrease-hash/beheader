/**
 * main.test.ts
 *
 * The pure state transitions. It drives the whole application with no
 * browser.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, deserializeDocument, saveDocument, type CameraState, type Document } from "./engine/document.ts";
import type { EvalContext } from "./engine/eval-context.ts";
import { getSlot, type GraphObject } from "./engine/graph/node.ts";
import { objectExtent } from "./render/extent.ts";
import { createCanvas2dTextMeasurer, type MeasurementContext } from "./render/measure.ts";
import { renderDocument } from "./render/renderer.ts";
import { MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen } from "./render/camera.ts";
import {
  abandonCreatedTextBox,
  buildPanelModel,
  commitImagePicture,
  commitPanelChoice,
  commitPanelEdit,
  commitTableCell,
  commitTextContent,
  dismissPanel,
  editorSeed,
  escape,
  initialAppState,
  movePanel,
  performEffect,
  pointerDownAt,
  pointerMoveTo,
  panByScreen,
  pointerUpNow,
  replaceDocument,
  respondToPrompt,
  submitLine,
  unlinkPanelSlot,
  wheelZoomAt,
  type AppState,
  type PanelRow,
  type Viewport,
} from "./main.ts";

const VIEWPORT: Viewport = { width: 800, height: 600 };

function opened(): AppState {
  return initialAppState(createEmptyDocument());
}

function typed(state: AppState, line: string): AppState {
  return submitLine(state, line, VIEWPORT).state;
}

function objectNamed(state: AppState, name: string): GraphObject {
  const found = state.document.objects.find((object) => object.name === name);
  if (found === undefined) {
    throw new Error(`expected an object named "${name}", have: ${state.document.objects.map((object) => object.name).join(", ")}`);
  }
  return found;
}

function numberAt(object: GraphObject, path: readonly string[]): number {
  const value = getSlot(object, path)?.value;
  if (typeof value !== "number") {
    throw new Error(`expected a number at ${path.join(".")}, got ${JSON.stringify(value)}`);
  }
  return value;
}

function newLines(before: AppState, after: AppState): readonly string[] {
  return after.log.slice(before.log.length);
}

describe("submitLine — a typed line reaches a handler and its result is echoed", () => {
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

describe("submitLine — a command word alone enters its prompt sequence", () => {
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

  it("re-asks the same step with the sequence's own refusal when an answer is refused, keeping the answers already gathered", () => {
    let state = typed(opened(), "circle");
    state = typed(state, "100,100");
    const before = state;
    state = typed(state, "not-a-radius");
    expect(state.pending?.stepIndex).toBe(1);
    expect(state.pending?.answers).toEqual(before.pending?.answers);
    expect(newLines(before, state).length).toBeGreaterThan(2);
  });

  it("escape abandons the sequence and clears the selection — one key does both the deselect and the cancel", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "select polygon_1");
    state = typed(state, "circle");
    expect(state.pending).toBeDefined();
    const escaped = escape(state);
    expect(escaped.pending).toBeUndefined();
    expect(escaped.interaction.selectedObjectIds).toEqual([]);
    expect(escaped.log[escaped.log.length - 1]).toBe("cancelled");
  });
});

describe("submitLine — the returned AppTransition reports whether the line was REFUSED", () => {
  it("is NOT refused for an accepted complete command", () => {
    expect(submitLine(opened(), "polygon sides=5 x=0 y=0 r=50", VIEWPORT).refused).toBe(false);
  });

  it("IS refused for a complete command the handler rejects", () => {
    expect(submitLine(opened(), "delete nothing_here", VIEWPORT).refused).toBe(true);
  });

  it("IS refused for a line no command can be parsed from", () => {
    expect(submitLine(opened(), "wobble 3", VIEWPORT).refused).toBe(true);
  });

  it("is NOT refused for a bare command word entering its prompt sequence — nothing was refused yet", () => {
    expect(submitLine(opened(), "circle", VIEWPORT).refused).toBe(false);
  });

  it("is NOT refused when a prompt step's answer is accepted and the sequence moves to the next step", () => {
    const midSequence = typed(opened(), "circle");
    const outcome = submitLine(midSequence, "100,100", VIEWPORT);
    expect(outcome.refused).toBe(false);
    expect(outcome.state.pending?.stepIndex).toBe(1);
  });

  it("IS refused when a prompt step's own answer is refused, so the same step re-asks", () => {
    const midSequence = typed(typed(opened(), "circle"), "100,100");
    const outcome = submitLine(midSequence, "not-a-radius", VIEWPORT);
    expect(outcome.refused).toBe(true);
    expect(outcome.state.pending?.stepIndex).toBe(1);
  });

  it("is NOT refused for an accepted command that also requests a file (save)", () => {
    const outcome = submitLine(opened(), "save", VIEWPORT);
    expect(outcome.refused).toBe(false);
    expect(outcome.fileRequest).toBe("save");
  });
});

describe("performEffect — select", () => {
  it("selects the ID the effect carried, resolving no name of its own", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const id = objectNamed(state, "polygon_1").id;
    const performed = performEffect({ kind: "select", objectId: id }, state, VIEWPORT).state;
    expect(performed.interaction.selectedObjectIds).toEqual([id]);
  });

  it("is what makes `select <name>` from the input bar actually select something", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const id = objectNamed(state, "polygon_1").id;
    state = typed(state, "select polygon_1");
    expect(state.interaction.selectedObjectIds).toEqual([id]);
  });

  it("clears any drag, because a selection made from the input bar has no pointer holding it", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(state.interaction.drag).toBeDefined();
    state = typed(state, "select polygon_1");
    expect(state.interaction.drag).toBeUndefined();
  });

  it("refuses an unknown name in `commands.ts`, which is why no arm here has to", () => {
    const before = opened();
    const after = typed(before, "select nothing_here");
    expect(after.interaction.selectedObjectIds).toEqual([]);
    expect(newLines(before, after).join("\n")).toContain("nothing_here");
  });
});

describe("performEffect — zoom and fit write the camera directly", () => {
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

  it("clamps to render/'s range and reports the CLAMPED value, which commands.ts could not have predicted", () => {
    const before = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const after = typed(before, "zoom 1000000");
    expect(after.document.camera.zoom).toBe(MAX_ZOOM);
    expect(newLines(before, after).join("\n")).toContain(`${MAX_ZOOM}`);
    expect(newLines(before, after).join("\n")).toContain("clamped");
  });

  it("refuses a zoom factor of 0 in `commands.ts` rather than absorbing it into MIN_ZOOM here", () => {
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
    expect(newLines(before, after).length).toBe(2);
  });

  it("centres a DEGENERATE single-point extent at the current zoom instead of dividing by it", () => {
    let state = typed(opened(), "circle x=100 y=100 r=0");
    const zoomBefore = state.document.camera.zoom;
    state = typed(state, "fit");
    expect(state.document.camera.zoom).toBe(zoomBefore);
    expect(Number.isFinite(state.document.camera.x)).toBe(true);
    expect(worldToScreen(state.document.camera, { x: 100, y: 100 })).toEqual({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    expect(state.log[state.log.length - 1]).toContain("single point");
  });

  it("fits a FLAT extent to its one real axis instead of calling it a point", () => {
    let state = typed(opened(), "rect x=0 y=0 w=200 h=0");
    const zoomBefore = state.document.camera.zoom;
    state = typed(state, "fit");
    expect(state.document.camera.zoom).toBe((VIEWPORT.width * 0.9) / 200);
    expect(state.document.camera.zoom).not.toBe(zoomBefore);
    expect(worldToScreen(state.document.camera, { x: 100, y: 0 })).toEqual({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    expect(state.log[state.log.length - 1]).not.toContain("single point");
  });

  it("says so, and moves nothing, when objects exist but none of them draws anything", () => {
    const undrawable: Document = { ...createEmptyDocument(), objects: [{ id: "obj_1", name: "text_1", type: "text", slots: {} }] };
    const before = initialAppState(undrawable);
    const after = performEffect({ kind: "fit" }, before, VIEWPORT).state;
    expect(after.document.camera).toEqual(before.document.camera);
    expect(after.log[after.log.length - 1]).toContain("extent");
  });
});

describe("performEffect — save and load are the two this file cannot finish alone", () => {
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

  it("reaches those requests from the typed lines the spec names", () => {
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
    expect(reopened.interaction.selectedObjectIds).toEqual([]);
    expect(reopened.pending).toBeUndefined();
  });
});

describe("the camera in AppState is always usable", () => {
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

describe("buildPanelModel — the rows of the properties panel", () => {
  it("splits an object's slots into modifiable and derived groups, in schema declaration order", () => {
    const state = typed(opened(), "circle x=10 y=20 r=5");
    const model = buildPanelModel(objectNamed(state, "circle_1"), state.document.objects);
    expect(model.header).toBe("circle_1");
    expect(model.modifiable.map((row) => row.path)).toEqual(["origin.x", "origin.y", "radius"]);
    expect(model.derived[0]?.path).toBe("vertices");
    expect(model.derived.map((row) => row.path)).toContain("centroid.x");
  });

  it("shows a literal slot's plain value and no formula source", () => {
    const state = typed(opened(), "circle x=10 y=20 r=5");
    const model = buildPanelModel(objectNamed(state, "circle_1"), state.document.objects);
    const originX = model.modifiable.find((row) => row.path === "origin.x");
    expect(originX).toEqual({ path: "origin.x", value: "10", editSeed: "10", formulaSource: undefined, kind: "literal", synthetic: false, picker: false });
  });

  it("seeds a row's editor with the value the command line would accept back, not the rounded display value", () => {
    const state = typed(opened(), "circle x=0.123456789 y=20 r=5");
    const model = buildPanelModel(objectNamed(state, "circle_1"), state.document.objects);
    const originX = model.modifiable.find((row) => row.path === "origin.x");
    expect(originX?.value).toBe("0.1235");
    expect(originX?.editSeed).toBe("0.123456789");

    const circleId = objectNamed(state, "circle_1").id;
    const after = commitPanelEdit(state, circleId, "origin.x", originX?.editSeed ?? "");
    expect(numberAt(objectNamed(after, "circle_1"), ["origin", "x"])).toBe(0.123456789);
  });

  it("carries a formula slot's reconstructed source and keeps it in the modifiable group", () => {
    let state = typed(opened(), "circle x=0 y=0 r=5");
    state = typed(state, "table x=200 y=0 rows=2 cols=2");
    state = typed(state, "set table_1.A1 7");
    state = typed(state, "link circle_1.origin.x table_1.A1");
    const model = buildPanelModel(objectNamed(state, "circle_1"), state.document.objects);
    const originX = model.modifiable.find((row) => row.path === "origin.x");
    expect(originX?.formulaSource).toBe("table_1.A1");
    expect(model.derived.some((row) => row.path === "origin.x")).toBe(false);
    expect(originX?.kind).toBe("formula");
  });

  it("summarises a table's cells as ONE modifiable row, never one per cell", () => {
    const state = typed(opened(), "table x=0 y=0 rows=3 cols=3");
    const model = buildPanelModel(objectNamed(state, "table_1"), state.document.objects);
    expect(model.modifiable.map((row) => row.path)).toEqual(["origin.x", "origin.y", "rows", "cols", "cells"]);
    expect(model.derived).toEqual([]);
    expect(model.modifiable.find((row) => row.path === "cells")?.synthetic).toBe(true);
    expect(model.modifiable.find((row) => row.path === "origin.x")?.synthetic).toBe(false);
  });

  it("rounds a derived number's float dust to 4 decimals, while `props` keeps full precision — the two formatters disagree on purpose", () => {
    const state = typed(opened(), "circle x=10 y=20 r=7");
    const model = buildPanelModel(objectNamed(state, "circle_1"), state.document.objects);
    const centroidX = model.derived.find((row) => row.path === "centroid.x");
    expect(centroidX?.value).toBe("10");

    const propsState = typed(state, "props circle_1");
    const propsLines = newLines(state, propsState);
    expect(propsLines.some((line) => line.includes("centroid.x = 10.000000000000002"))).toBe(true);
  });
});

describe("commitPanelEdit / unlinkPanelSlot — writing through the panel", () => {
  it("a bare number is a LITERAL write, echoed as the synthesised command the operator would have typed (clauses 5-7)", () => {
    const state = typed(opened(), "circle x=10 y=20 r=5");
    const circleId = objectNamed(state, "circle_1").id;
    const after = commitPanelEdit(state, circleId, "origin.x", "42");
    expect(newLines(state, after)).toEqual(["> set circle_1.origin.x 42", "circle_1.origin.x = 42"]);
    expect(numberAt(objectNamed(after, "circle_1"), ["origin", "x"])).toBe(42);
  });

  it("anything else is a FORMULA write (clause 6) — the same degenerate-formula reference `link` produces", () => {
    let state = typed(opened(), "table x=200 y=0 rows=2 cols=2");
    state = typed(state, "set table_1.A1 7");
    state = typed(state, "circle x=0 y=0 r=5");
    const circleId = objectNamed(state, "circle_1").id;

    const after = commitPanelEdit(state, circleId, "origin.x", "table_1.A1");
    const model = buildPanelModel(objectNamed(after, "circle_1"), after.document.objects);
    expect(model.modifiable.find((row) => row.path === "origin.x")).toMatchObject({ kind: "formula", formulaSource: "table_1.A1", value: "7" });
  });

  it("absorbs a leading '=' the operator typed rather than doubling it (clause 6)", () => {
    let state = typed(opened(), "table x=200 y=0 rows=2 cols=2");
    state = typed(state, "set table_1.A1 7");
    state = typed(state, "circle x=0 y=0 r=5");
    const circleId = objectNamed(state, "circle_1").id;

    const after = commitPanelEdit(state, circleId, "origin.x", "=table_1.A1");
    expect(numberAt(objectNamed(after, "circle_1"), ["origin", "x"])).toBe(7);
    expect(newLines(state, after).some((line) => line.includes("PARSE"))).toBe(false);
  });

  it("a refusal (a derived slot) reaches the log and changes the document not at all", () => {
    const state = typed(opened(), "circle x=10 y=20 r=5");
    const circleId = objectNamed(state, "circle_1").id;
    const after = commitPanelEdit(state, circleId, "centroid.x", "5");
    expect(after.document).toBe(state.document);
    expect(newLines(state, after).some((line) => line.includes("derived slot"))).toBe(true);
  });

  it("is a no-op for an object id the document no longer has — nothing to name", () => {
    const state = typed(opened(), "circle x=10 y=20 r=5");
    expect(commitPanelEdit(state, "obj_404", "origin.x", "5")).toBe(state);
    expect(unlinkPanelSlot(state, "obj_404", "origin.x")).toBe(state);
  });

  it("unlink reverts a formula slot to a literal holding the last computed value, echoed the same way", () => {
    let state = typed(opened(), "table x=200 y=0 rows=2 cols=2");
    state = typed(state, "set table_1.A1 7");
    state = typed(state, "circle x=0 y=0 r=5");
    state = typed(state, "link circle_1.origin.x table_1.A1");
    const circleId = objectNamed(state, "circle_1").id;

    const after = unlinkPanelSlot(state, circleId, "origin.x");
    expect(newLines(state, after)[0]).toBe("> unlink circle_1.origin.x");
    expect(numberAt(objectNamed(after, "circle_1"), ["origin", "x"])).toBe(7);
    const model = buildPanelModel(objectNamed(after, "circle_1"), after.document.objects);
    expect(model.modifiable.find((row) => row.path === "origin.x")?.kind).toBe("literal");
  });
});

describe("pointer and wheel", () => {
  it("selects what is under the pointer and arms a drag", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const pressed = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(pressed.interaction.selectedObjectIds).toEqual([objectNamed(state, "polygon_1").id]);
    expect(pressed.interaction.drag?.objectId).toBe(objectNamed(state, "polygon_1").id);
  });

  it("selects nothing on empty canvas", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    expect(pointerDownAt(state, { x: 9999, y: 9999 }, VIEWPORT).state.interaction.selectedObjectIds).toEqual([]);
  });

  it("a shift-click (the `additive` flag) adds to the selection instead of replacing it", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "circle x=200 y=0 r=20");
    const polygonId = objectNamed(state, "polygon_1").id;
    const circleId = objectNamed(state, "circle_1").id;

    const first = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(first.interaction.selectedObjectIds).toEqual([polygonId]);

    const second = pointerDownAt(first, { x: 200, y: 20 }, VIEWPORT, true).state;
    expect(second.interaction.selectedObjectIds).toEqual([polygonId, circleId]);

    const third = pointerDownAt(second, { x: 200, y: 20 }, VIEWPORT, true).state;
    expect(third.interaction.selectedObjectIds).toEqual([polygonId]);
  });

  it("answers a live prompt step with a PICKED world point instead of selecting", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "circle");
    const picked = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(picked.interaction.selectedObjectIds).toEqual([]);
    expect(picked.pending?.stepIndex).toBe(1);
  });

  it("drops a picked point when no sequence is live, rather than misrouting it into a command that ended", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    expect(respondToPrompt(state, { kind: "picked", point: { x: 1, y: 2 } }, VIEWPORT).state).toBe(state);
  });

  it("converts a pick to WORLD space with the current camera before it reaches command/", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "zoom 2");
    state = typed(state, "circle");
    const world = screenToWorld(state.document.camera, { x: 300, y: 200 });
    let picked = pointerDownAt(state, { x: 300, y: 200 }, VIEWPORT).state;
    picked = typed(picked, "10");
    const circle = objectNamed(picked, "circle_1");
    expect(numberAt(circle, ["origin", "x"])).toBeCloseTo(world.x, 9);
    expect(numberAt(circle, ["origin", "y"])).toBeCloseTo(world.y, 9);
  });

  it("zooms to the CURSOR on the wheel, keeping the world point under it fixed", () => {
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

describe("panel UI state — dismissal and manual position", () => {
  it("starts with no panel UI state for a freshly selected object — shown, auto-placed, is the default", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const selected = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(selected.panels).toEqual({});
  });

  it("dismissPanel hides one selected object's panel without touching the selection", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const selected = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    const id = objectNamed(selected, "polygon_1").id;
    const dismissed = dismissPanel(selected, id);
    expect(dismissed.panels[id]?.dismissed).toBe(true);
    expect(dismissed.interaction.selectedObjectIds).toEqual([id]);
  });

  it("dismissPanel is a no-op for an object that is not currently selected", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const id = objectNamed(state, "polygon_1").id;
    expect(dismissPanel(state, id)).toBe(state);
  });

  it("movePanel records a manual CSS position for a selected object's panel", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const selected = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    const id = objectNamed(selected, "polygon_1").id;
    const moved = movePanel(selected, id, { left: 12, top: 34 });
    expect(moved.panels[id]?.manualPosition).toEqual({ left: 12, top: 34 });
  });

  it("movePanel is a no-op for an object that is not currently selected", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const id = objectNamed(state, "polygon_1").id;
    expect(movePanel(state, id, { left: 1, top: 1 })).toBe(state);
  });

  it("discards a dismissed panel's state when its object leaves the selection, and re-selecting shows it again", () => {
    const opening = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    let state = pointerDownAt(opening, { x: 50, y: 0 }, VIEWPORT).state;
    const id = objectNamed(state, "polygon_1").id;
    state = dismissPanel(state, id);
    expect(state.panels[id]?.dismissed).toBe(true);

    state = escape(state);
    expect(state.panels[id]).toBeUndefined();

    state = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(state.panels[id]).toBeUndefined();
  });

  it("discards a manual position the same way, when a plain click REPLACES the selection", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "circle x=200 y=0 r=20");
    const polygonId = objectNamed(state, "polygon_1").id;
    state = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    state = movePanel(state, polygonId, { left: 5, top: 5 });
    expect(state.panels[polygonId]?.manualPosition).toEqual({ left: 5, top: 5 });

    state = pointerDownAt(state, { x: 200, y: 20 }, VIEWPORT).state;
    expect(state.panels[polygonId]).toBeUndefined();
  });

  it("keeps an object's panel state when a shift-click ADDS another object — nothing left the selection", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "circle x=200 y=0 r=20");
    const polygonId = objectNamed(state, "polygon_1").id;
    state = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    state = dismissPanel(state, polygonId);
    state = pointerDownAt(state, { x: 200, y: 20 }, VIEWPORT, true).state;
    expect(state.panels[polygonId]?.dismissed).toBe(true);
  });

  it("`select <name>` from the input bar prunes panel state the same way a plain click does — it too REPLACES the selection", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "circle x=200 y=0 r=20");
    const polygonId = objectNamed(state, "polygon_1").id;
    state = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    state = dismissPanel(state, polygonId);
    state = typed(state, "select circle_1");
    expect(state.panels[polygonId]).toBeUndefined();
  });
});

describe("Phase 3's acceptance criterion, end to end", () => {

  type DrawCall = { readonly op: string };

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
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  it("creates a polygon and a table by command, draws both, pans, zooms, selects, and drags the polygon", () => {
    let state = opened();

    state = typed(state, "polygon sides=5 x=100 y=100 r=50");
    state = typed(state, "table x=300 y=100 rows=3 cols=3");
    expect(state.document.objects.map((object) => object.name)).toEqual(["polygon_1", "table_1"]);

    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, VIEWPORT.width, VIEWPORT.height, state.document.objects, state.document.camera);
    expect(calls.filter((call) => call.op === "stroke").length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.op === "strokeRect").length).toBe(9);

    const worldAtScreenOrigin = state.document.camera;
    state = panByScreen(state, 40, 25);
    expect(state.document.camera.x).toBeCloseTo(worldAtScreenOrigin.x - 40, 9);
    expect(state.document.camera.y).toBeCloseTo(worldAtScreenOrigin.y - 25, 9);
    state = wheelZoomAt(state, { x: 400, y: 300 }, -100);
    expect(state.document.camera.zoom).toBeGreaterThan(1);
    state = typed(state, "zoom 2");
    expect(state.document.camera.zoom).toBeGreaterThan(2);

    const polygon = objectNamed(state, "polygon_1");
    const vertex = (getSlot(polygon, ["vertices"])?.value as readonly { x: number; y: number }[])[0];
    if (vertex === undefined) {
      throw new Error("expected the polygon's derived vertices to have been evaluated");
    }
    const onStroke = worldToScreen(state.document.camera, vertex);
    state = pointerDownAt(state, onStroke, VIEWPORT).state;
    expect(state.interaction.selectedObjectIds).toEqual([polygon.id]);

    const originXBefore = numberAt(objectNamed(state, "polygon_1"), ["origin", "x"]);
    const journalBefore = state.document.journal.length;
    state = pointerMoveTo(state, { x: onStroke.x + 40, y: onStroke.y + 40 });
    state = pointerUpNow(state);
    const originXAfter = numberAt(objectNamed(state, "polygon_1"), ["origin", "x"]);
    expect(originXAfter).toBeCloseTo(originXBefore + 40 / state.document.camera.zoom, 9);
    expect(state.document.journal.length).toBeGreaterThan(journalBefore);
    expect(state.interaction.drag).toBeUndefined();
    expect(state.interaction.selectedObjectIds).toEqual([polygon.id]);

    const second = createFakeContext();
    renderDocument(second.ctx, VIEWPORT.width, VIEWPORT.height, state.document.objects, state.document.camera);
    expect(second.calls.filter((call) => call.op === "strokeRect").length).toBe(9);
    expect(second.calls.filter((call) => call.op === "stroke").length).toBeGreaterThan(0);
  });

  it("drags a polygon whose origin.x is a formula along Y only, and says so in the log without blocking", () => {
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
    expect(numberAt(after, ["origin", "x"])).toBe(500);
    expect(numberAt(after, ["origin", "y"])).toBeCloseTo(130, 9);
    expect(state.log.slice(logBefore).join("\n")).toContain("table_1.A1");
  });
});

describe("PHASE 4'S ACCEPTANCE CRITERION — (a), (b) and (c) simultaneously in ONE document, with no false cycle", () => {

  function firstVertexOf(object: GraphObject): { readonly x: number; readonly y: number } {
    const vertices = getSlot(object, ["vertices"])?.value as readonly { x: number; y: number }[] | undefined;
    const vertex = vertices?.[0];
    if (vertex === undefined) {
      throw new Error(`expected ${object.name}'s derived vertices to have been evaluated`);
    }
    return vertex;
  }

  function gateDocument(): AppState {
    let state = typed(opened(), "table x=0 y=0 rows=4 cols=4");
    state = typed(state, "set table_1.A1 500");
    state = typed(state, "polygon sides=5 x=100 y=100 r=50");
    state = typed(state, "polygon sides=4 x=300 y=300 r=40");
    state = typed(state, "link polygon_1.origin.x table_1.A1");
    state = typed(state, "set table_1.B1 = polygon_2.origin.x * 2");
    return state;
  }

  it("builds the whole document without a single refusal — both directions coexist in one graph", () => {
    const state = gateDocument();
    expect(state.document.objects.map((object) => object.name)).toEqual(["table_1", "polygon_1", "polygon_2"]);
    expect(getSlot(objectNamed(state, "polygon_1"), ["origin", "x"])?.kind).toBe("formula");
    expect(getSlot(objectNamed(state, "table_1"), ["cells", "B1"])?.kind).toBe("formula");
    expect(getSlot(objectNamed(state, "polygon_2"), ["origin", "x"])?.kind).toBe("literal");
    expect(numberAt(objectNamed(state, "polygon_1"), ["origin", "x"])).toBe(500);
    expect(numberAt(objectNamed(state, "table_1"), ["cells", "B1"])).toBe(600);
    expect(state.log.join("\n")).not.toContain("cyclic");
  });

  it("(a) data drives geometry — typing a new number in the cell moves polygon_1", () => {
    let state = gateDocument();
    expect(numberAt(objectNamed(state, "polygon_1"), ["origin", "x"])).toBe(500);

    state = typed(state, "set table_1.A1 650");

    expect(numberAt(objectNamed(state, "polygon_1"), ["origin", "x"])).toBe(650);
    expect(numberAt(objectNamed(state, "polygon_1"), ["centroid", "x"])).toBeCloseTo(650, 9);
  });

  it("(b) geometry drives data — dragging polygon_2 on canvas updates its cell live", () => {
    let state = gateDocument();
    const before = objectNamed(state, "polygon_2");
    const originXBefore = numberAt(before, ["origin", "x"]);
    expect(numberAt(objectNamed(state, "table_1"), ["cells", "B1"])).toBe(originXBefore * 2);

    const onStroke = worldToScreen(state.document.camera, firstVertexOf(before));
    state = pointerDownAt(state, onStroke, VIEWPORT).state;
    expect(state.interaction.selectedObjectIds).toEqual([before.id]);
    state = pointerMoveTo(state, { x: onStroke.x + 40, y: onStroke.y });
    state = pointerUpNow(state);

    const originXAfter = numberAt(objectNamed(state, "polygon_2"), ["origin", "x"]);
    expect(originXAfter).toBeCloseTo(originXBefore + 40 / state.document.camera.zoom, 9);
    expect(numberAt(objectNamed(state, "table_1"), ["cells", "B1"])).toBeCloseTo(originXAfter * 2, 9);
  });

  it("(c) partial binding — dragging polygon_1 slides it in Y only, because its X is driven", () => {
    let state = gateDocument();
    const before = objectNamed(state, "polygon_1");
    const originYBefore = numberAt(before, ["origin", "y"]);

    const onStroke = worldToScreen(state.document.camera, firstVertexOf(before));
    state = pointerDownAt(state, onStroke, VIEWPORT).state;
    const logBefore = state.log.length;
    state = pointerMoveTo(state, { x: onStroke.x + 30, y: onStroke.y + 30 });

    const after = objectNamed(state, "polygon_1");
    expect(numberAt(after, ["origin", "x"])).toBe(500);
    expect(numberAt(after, ["origin", "y"])).toBeCloseTo(originYBefore + 30 / state.document.camera.zoom, 9);
    expect(state.log.slice(logBefore).join("\n")).toContain("table_1.A1");
  });

  it("all three hold in ONE state at once — the criterion's own wording", () => {
    let state = gateDocument();

    state = typed(state, "set table_1.A1 650");
    const polygon2 = objectNamed(state, "polygon_2");
    const onPolygon2 = worldToScreen(state.document.camera, firstVertexOf(polygon2));
    state = pointerDownAt(state, onPolygon2, VIEWPORT).state;
    state = pointerMoveTo(state, { x: onPolygon2.x + 40, y: onPolygon2.y });
    state = pointerUpNow(state);
    const polygon1 = objectNamed(state, "polygon_1");
    const onPolygon1 = worldToScreen(state.document.camera, firstVertexOf(polygon1));
    state = pointerDownAt(state, onPolygon1, VIEWPORT).state;
    state = pointerMoveTo(state, { x: onPolygon1.x + 30, y: onPolygon1.y + 30 });
    state = pointerUpNow(state);

    const finalPolygon1 = objectNamed(state, "polygon_1");
    const finalPolygon2 = objectNamed(state, "polygon_2");
    const finalTable = objectNamed(state, "table_1");

    expect(numberAt(finalPolygon1, ["origin", "x"])).toBe(650);
    expect(numberAt(finalPolygon1, ["origin", "y"])).toBeCloseTo(130, 9);
    expect(numberAt(finalTable, ["cells", "B1"])).toBeCloseTo(numberAt(finalPolygon2, ["origin", "x"]) * 2, 9);
    expect(state.log.join("\n")).not.toContain("cyclic");
  });

  it("no FALSE cycle, and cycle detection is still alive — a genuinely cyclic link is refused", () => {
    const state = gateDocument();
    const outcome = submitLine(state, "set table_1.A1 = polygon_1.origin.x", VIEWPORT);

    expect(newLines(state, outcome.state).join("\n")).toContain("cyclic");
    expect(outcome.state.document).toBe(state.document);
  });

  it("no false cycle in the hardest shape either: one object driven by the table and driving it back", () => {
    let state = typed(gateDocument(), "set table_1.C1 = polygon_1.centroid.x");

    expect(state.log.join("\n")).not.toContain("cyclic");
    expect(getSlot(objectNamed(state, "table_1"), ["cells", "C1"])?.kind).toBe("formula");
    expect(numberAt(objectNamed(state, "table_1"), ["cells", "C1"])).toBeCloseTo(500, 9);

    state = typed(state, "set table_1.A1 650");

    expect(numberAt(objectNamed(state, "polygon_1"), ["origin", "x"])).toBe(650);
    expect(numberAt(objectNamed(state, "table_1"), ["cells", "C1"])).toBeCloseTo(650, 9);
  });
});

describe("submitLine / pointerMoveTo forward the EvalContext", () => {
  function textObject(): GraphObject {
    return {
      id: "obj_t",
      name: "text_1",
      type: "text",
      slots: {
        content: { kind: "literal", value: "hello" },
        width: { kind: "literal", value: "auto" },
        "style.font": { kind: "literal", value: "sans" },
        "style.fontSize": { kind: "literal", value: 12 },
        "style.lineHeight": { kind: "literal", value: 14 },
        resolvedContent: { kind: "derived", value: null },
        measuredHeight: { kind: "derived", value: null },
        measuredWidth: { kind: "derived", value: null },
      },
    };
  }

  function stateWithText(): AppState {
    return initialAppState({ ...createEmptyDocument(), nextObjectId: 1, objects: [textObject()] });
  }

  function measuredHeightOf(state: AppState): unknown {
    return getSlot(objectNamed(state, "text_1"), ["measuredHeight"])?.value;
  }

  const realMeasurer: EvalContext = { measurer: { measure: () => ({ width: 2, height: 44 }) } };

  it("submitLine threads the context to executeCommand — a `set` re-evaluates measuredHeight for real, #MEASURE without it", () => {
    const base = stateWithText();
    expect(measuredHeightOf(submitLine(base, "set text_1.style.fontSize 16", VIEWPORT).state)).toMatchObject({
      error: "#MEASURE",
    });
    expect(measuredHeightOf(submitLine(base, "set text_1.style.fontSize 16", VIEWPORT, realMeasurer).state)).toBe(44);
  });

  it("pointerMoveTo threads the context to pointerMove — a drag keeps a co-resident text object's measuredHeight real", () => {
    const withRect = submitLine(stateWithText(), "rect x=0 y=0 w=20 h=20", VIEWPORT).state;
    const corner = (getSlot(objectNamed(withRect, "rect_1"), ["vertices"])?.value as readonly { x: number; y: number }[])[0];
    if (corner === undefined) {
      throw new Error("expected the rect's derived vertices to have been evaluated");
    }
    const onStroke = worldToScreen(withRect.document.camera, corner);
    const armed = pointerDownAt(withRect, onStroke, VIEWPORT).state;
    expect(armed.interaction.selectedObjectIds).toEqual([objectNamed(withRect, "rect_1").id]);

    const dragged = pointerMoveTo(armed, { x: onStroke.x + 8, y: onStroke.y + 6 }, realMeasurer);

    expect(measuredHeightOf(dragged)).toBe(44);
    expect(numberAt(objectNamed(dragged, "rect_1"), ["origin", "x"])).toBeCloseTo(8, 9);
  });
});

describe("commitTextContent — a `text` object's content is ALWAYS a literal `set`", () => {
  function withText(content: string): { state: AppState; id: string } {
    const state = typed(opened(), `text x=0 y=0 "${content}"`);
    return { state, id: objectNamed(state, "text_1").id };
  }

  it("writes a plain string as a literal", () => {
    const { state, id } = withText("old");
    const after = commitTextContent(state, id, "a whole new paragraph");
    expect(getSlot(objectNamed(after, "text_1"), ["content"])).toEqual({ kind: "literal", value: "a whole new paragraph" });
  });

  it("does NOT sniff a leading `=` — `=Hello` commits as the literal string `=Hello`, never a formula (the trap)", () => {
    const { state, id } = withText("old");
    const after = commitTextContent(state, id, "=Hello world");
    expect(getSlot(objectNamed(after, "text_1"), ["content"])).toEqual({ kind: "literal", value: "=Hello world" });
  });

  it("stores markup word for word, newlines included", () => {
    const { state, id } = withText("old");
    const raw = "# Title\n\n**bold** and {= table_x.A1 }";
    const after = commitTextContent(state, id, raw);
    expect(getSlot(objectNamed(after, "text_1"), ["content"])).toEqual({ kind: "literal", value: raw });
  });

  it("echoes the synthesised command into the log", () => {
    const { state, id } = withText("old");
    const after = commitTextContent(state, id, "new");
    expect(newLines(state, after)).toContain("> set text_1.content new");
  });

  it("is a no-op for a stale object id", () => {
    const { state } = withText("old");
    expect(commitTextContent(state, "obj_404", "x")).toBe(state);
  });
});

describe("commitTableCell — Excel-style: `=` is a formula, a number is a number, else a string", () => {
  function withTable(): { state: AppState; id: string } {
    const state = typed(opened(), "table x=0 y=0");
    return { state, id: objectNamed(state, "table_1").id };
  }

  it("a leading `=` makes the cell a formula", () => {
    const { state, id } = withTable();
    const after = commitTableCell(state, id, "A1", "=1+2");
    const slot = getSlot(objectNamed(after, "table_1"), ["cells", "A1"]);
    expect(slot?.kind).toBe("formula");
    expect(slot?.value).toBe(3);
  });

  it("a bare number is a literal number", () => {
    const { state, id } = withTable();
    const after = commitTableCell(state, id, "A2", "42");
    expect(getSlot(objectNamed(after, "table_1"), ["cells", "A2"])).toEqual({ kind: "literal", value: 42 });
  });

  it("anything else is a literal string", () => {
    const { state, id } = withTable();
    const after = commitTableCell(state, id, "A3", "hello");
    expect(getSlot(objectNamed(after, "table_1"), ["cells", "A3"])).toEqual({ kind: "literal", value: "hello" });
  });

  it("a refused commit (a broken formula) is echoed, not thrown, and the document is untouched", () => {
    const { state, id } = withTable();
    const after = commitTableCell(state, id, "A1", "=1 +");
    expect(getSlot(objectNamed(after, "table_1"), ["cells", "A1"])).toBeUndefined();
    expect(after.log.length).toBeGreaterThan(state.log.length);
  });

  it("is a no-op for a stale object id", () => {
    const { state } = withTable();
    expect(commitTableCell(state, "obj_404", "A1", "5")).toBe(state);
  });

  describe("an empty editor CLEARS the cell rather than writing `\"\"` (2026-09-02)", () => {
    it("leaves an already-empty cell with NO slot at all, not one holding an empty string", () => {
      const { state, id } = withTable();
      const after = commitTableCell(state, id, "A1", "");
      expect(getSlot(objectNamed(after, "table_1"), ["cells", "A1"])).toBeUndefined();
    });

    it("does not journal anything for that no-op — nothing happened, so the history says nothing happened", () => {
      const { state, id } = withTable();
      const after = commitTableCell(state, id, "A1", "");
      expect(after.document.journal.length).toBe(state.document.journal.length);
    });

    it("REMOVES a cell that held something, which is the gesture that was impossible before — `set A1 \"\"` left a phantom", () => {
      const { state, id } = withTable();
      const filled = commitTableCell(state, id, "A1", "hello");
      expect(getSlot(objectNamed(filled, "table_1"), ["cells", "A1"])).toEqual({ kind: "literal", value: "hello" });
      const emptied = commitTableCell(filled, id, "A1", "");
      expect(getSlot(objectNamed(emptied, "table_1"), ["cells", "A1"])).toBeUndefined();
    });

    it("treats a whitespace-only editor as empty too — nothing was typed", () => {
      const { state, id } = withTable();
      const after = commitTableCell(commitTableCell(state, id, "A1", "hello"), id, "A1", "   ");
      expect(getSlot(objectNamed(after, "table_1"), ["cells", "A1"])).toBeUndefined();
    });

    it("clears a cell that held a FORMULA, not just a literal", () => {
      const { state, id } = withTable();
      const after = commitTableCell(commitTableCell(state, id, "A1", "=1+2"), id, "A1", "");
      expect(getSlot(objectNamed(after, "table_1"), ["cells", "A1"])).toBeUndefined();
    });
  });
});

describe("editorSeed round-trips a cell exactly — an untouched commit changes nothing (2026-09-02)", () => {
  function withTable(): { state: AppState; id: string } {
    const state = typed(opened(), "table x=0 y=0");
    return { state, id: objectNamed(state, "table_1").id };
  }

  function reopenAndCommit(state: AppState, id: string, cell: string): AppState {
    return commitTableCell(state, id, cell, editorSeed(state, { kind: "cell", objectId: id, cell }));
  }

  it("seeds a string cell with the string itself — NOT wrapped in quotes", () => {
    const { state, id } = withTable();
    const after = commitTableCell(state, id, "A1", "hello");
    expect(editorSeed(after, { kind: "cell", objectId: id, cell: "A1" })).toBe("hello");
  });

  it("does not accumulate quotes over repeated open-and-close, which is the defect as reported", () => {
    const { state, id } = withTable();
    let current = commitTableCell(state, id, "A1", "hello");
    for (let round = 0; round < 5; round += 1) {
      current = reopenAndCommit(current, id, "A1");
    }
    expect(getSlot(objectNamed(current, "table_1"), ["cells", "A1"])).toEqual({ kind: "literal", value: "hello" });
  });

  it("an EMPTY cell opened and closed five times still has no slot — the case the operator actually hit", () => {
    const { state, id } = withTable();
    let current = state;
    for (let round = 0; round < 5; round += 1) {
      current = reopenAndCommit(current, id, "A1");
    }
    expect(getSlot(objectNamed(current, "table_1"), ["cells", "A1"])).toBeUndefined();
  });

  it("round-trips a number and a boolean unchanged, in their own types", () => {
    const { state, id } = withTable();
    let current = commitTableCell(state, id, "A1", "42");
    current = typed(current, "set table_1.B1 TRUE");
    current = reopenAndCommit(reopenAndCommit(current, id, "A1"), id, "B1");
    expect(getSlot(objectNamed(current, "table_1"), ["cells", "A1"])).toEqual({ kind: "literal", value: 42 });
    expect(getSlot(objectNamed(current, "table_1"), ["cells", "B1"])).toEqual({ kind: "literal", value: true });
  });

  it("seeds a boolean as parser.ts's exact-uppercase TRUE/FALSE, the only spelling that reads back", () => {
    const { state, id } = withTable();
    const after = typed(state, "set table_1.A1 FALSE");
    expect(editorSeed(after, { kind: "cell", objectId: id, cell: "A1" })).toBe("FALSE");
  });
});

describe("editorSeed — the text the in-place editor opens showing", () => {
  it("a `text` object's raw content, verbatim", () => {
    const state = typed(opened(), 'text x=0 y=0 "Radius is {= table_x.A1 }"');
    const id = objectNamed(state, "text_1").id;
    expect(editorSeed(state, { kind: "text", objectId: id })).toBe("Radius is {= table_x.A1 }");
  });

  it("a cell's literal value, as text", () => {
    let state = typed(opened(), "table x=0 y=0");
    const id = objectNamed(state, "table_1").id;
    state = commitTableCell(state, id, "A1", "7");
    expect(editorSeed(state, { kind: "cell", objectId: id, cell: "A1" })).toBe("7");
  });

  it("a cell's formula, Excel-style with a leading `=`", () => {
    let state = typed(opened(), "table x=0 y=0");
    const id = objectNamed(state, "table_1").id;
    state = commitTableCell(state, id, "A1", "=1+2");
    expect(editorSeed(state, { kind: "cell", objectId: id, cell: "A1" })).toBe("=1 + 2");
  });

  it("shows a same-table cell reference in bare Excel form, not fully qualified", () => {
    let state = typed(opened(), "table x=0 y=0");
    const id = objectNamed(state, "table_1").id;
    state = commitTableCell(state, id, "A2", "10");
    state = commitTableCell(state, id, "A1", "=A2 * 2");
    expect(editorSeed(state, { kind: "cell", objectId: id, cell: "A1" })).toBe("=A2 * 2");
  });

  it("round-trips a same-table cell formula: seed -> commit unchanged -> same stored AST", () => {
    let state = typed(opened(), "table x=0 y=0");
    const id = objectNamed(state, "table_1").id;
    state = commitTableCell(state, id, "A1", "=SUM(A2:A5) + B1");
    const seed = editorSeed(state, { kind: "cell", objectId: id, cell: "A1" });
    expect(seed).toBe("=SUM(A2:A5) + B1");
    const before = getSlot(objectNamed(state, "table_1"), ["cells", "A1"]);
    const after = commitTableCell(state, id, "A1", seed);
    expect(getSlot(objectNamed(after, "table_1"), ["cells", "A1"])).toEqual(before);
  });

  it("keeps a cross-table reference fully qualified in the cell editor", () => {
    let state = typed(opened(), "table x=0 y=0");
    state = typed(state, "table x=500 y=0");
    const id = objectNamed(state, "table_1").id;
    state = commitTableCell(state, objectNamed(state, "table_2").id, "A1", "3");
    state = commitTableCell(state, id, "A1", "=table_2.A1 + A2");
    expect(editorSeed(state, { kind: "cell", objectId: id, cell: "A1" })).toBe("=table_2.A1 + A2");
  });

  it("empty for a cell nobody has written", () => {
    const state = typed(opened(), "table x=0 y=0");
    const id = objectNamed(state, "table_1").id;
    expect(editorSeed(state, { kind: "cell", objectId: id, cell: "H8" })).toBe("");
  });

  it("empty for a stale object id", () => {
    expect(editorSeed(opened(), { kind: "text", objectId: "obj_404" })).toBe("");
  });
});

describe("text placed by pointing opens the in-place editor on the new box", () => {
  it("a bare `text` word enters the position prompt, not a refusal", () => {
    const before = opened();
    const outcome = submitLine(before, "text", VIEWPORT);
    expect(outcome.refused).toBe(false);
    expect(outcome.state.pending?.commandName).toBe("text");
    expect(newLines(before, outcome.state).join("\n")).toContain("specify text position");
  });

  it("the canvas pick that completes the sequence creates an empty box AND asks for its editor", () => {
    const state = typed(opened(), "text");
    const outcome = pointerDownAt(state, { x: 100, y: 100 }, VIEWPORT);
    const created = objectNamed(outcome.state, "text_1");
    expect(created.type).toBe("text");
    expect(numberAt(created, ["origin", "x"])).toBe(100);
    expect(getSlot(created, ["content"])).toEqual({ kind: "literal", value: "" });
    expect(outcome.openEditor).toEqual({ kind: "text", objectId: created.id });
    expect(editorSeed(outcome.state, outcome.openEditor!)).toBe("");
  });

  it("a content-bearing typed form does not open the editor", () => {
    const outcome = submitLine(opened(), 'text x=5 y=6 "hi"', VIEWPORT);
    const created = objectNamed(outcome.state, "text_1");
    expect(getSlot(created, ["content"])).toEqual({ kind: "literal", value: "hi" });
    expect(outcome.openEditor).toBeUndefined();
  });

  it("an explicit `text \"\"` (no content) DOES open the editor — same as the pointing path", () => {
    const outcome = submitLine(opened(), 'text x=0 y=0 ""', VIEWPORT);
    const created = objectNamed(outcome.state, "text_1");
    expect(getSlot(created, ["content"])).toEqual({ kind: "literal", value: "" });
    expect(outcome.openEditor).toEqual({ kind: "text", objectId: created.id });
  });

  it("a non-text creation never asks for an editor", () => {
    expect(submitLine(opened(), "circle x=0 y=0 r=5", VIEWPORT).openEditor).toBeUndefined();
    expect(submitLine(opened(), "table x=0 y=0", VIEWPORT).openEditor).toBeUndefined();
  });

  it("a refused text creation asks for no editor", () => {
    const outcome = submitLine(opened(), "text x=0 y=0", VIEWPORT);
    expect(outcome.refused).toBe(true);
    expect(outcome.openEditor).toBeUndefined();
  });
});

describe("image creation asks for a picture, and the chosen one is written to `source`", () => {
  const PICTURE = `data:image/png;base64,${"A".repeat(300)}`;
  const WIDE = { naturalWidth: 200, naturalHeight: 100 };

  it("a typed `image` creation names the new object as the one to pick a picture for", () => {
    const outcome = submitLine(opened(), "image x=10 y=20", VIEWPORT);
    const created = objectNamed(outcome.state, "image_1");
    expect(outcome.pickImageFor).toBe(created.id);
  });

  it("the canvas pick that completes a bare `image` sequence asks for the picker too, so pointing and choosing are one gesture", () => {
    const state = typed(opened(), "image");
    const outcome = pointerDownAt(state, { x: 40, y: 60 }, VIEWPORT);
    const created = objectNamed(outcome.state, "image_1");
    expect(numberAt(created, ["origin", "x"])).toBe(40);
    expect(outcome.pickImageFor).toBe(created.id);
  });

  it("no other creation asks for a picker, and neither does a refused image creation", () => {
    expect(submitLine(opened(), "circle x=0 y=0 r=5", VIEWPORT).pickImageFor).toBeUndefined();
    expect(submitLine(opened(), 'text x=0 y=0 "hi"', VIEWPORT).pickImageFor).toBeUndefined();
    const refused = submitLine(opened(), "image x=0", VIEWPORT);
    expect(refused.refused).toBe(true);
    expect(refused.pickImageFor).toBeUndefined();
  });

  it("commitImagePicture writes the whole data URL into the object's `source` slot as an ordinary literal (Rule 2, through executeCommand)", () => {
    const outcome = submitLine(opened(), "image x=10 y=20", VIEWPORT);
    const id = objectNamed(outcome.state, "image_1").id;
    const after = commitImagePicture(outcome.state, id, PICTURE, WIDE);
    expect(getSlot(objectNamed(after, "image_1"), ["source"])).toEqual({ kind: "literal", value: PICTURE });
  });

  it("echoes a SUMMARY of the write, never the URL itself — a line the operator could neither read nor retype", () => {
    const outcome = submitLine(opened(), "image x=10 y=20", VIEWPORT);
    const id = objectNamed(outcome.state, "image_1").id;
    const after = commitImagePicture(outcome.state, id, PICTURE, WIDE);
    const echoed = newLines(outcome.state, after).join("\n");
    expect(echoed).toContain("picture into image_1 — 322 characters, 200x100, box 100x50");
    expect(echoed).not.toContain(PICTURE);
  });

  it("is a no-op for a stale object id — the image was deleted while the picker was open", () => {
    const state = typed(opened(), "image x=10 y=20");
    expect(commitImagePicture(state, "obj_404", PICTURE, WIDE)).toBe(state);
  });

  it("is a no-op for an empty url, so a caller with nothing to write cannot clear a picture the operator already has", () => {
    const state = typed(opened(), "image x=10 y=20");
    expect(commitImagePicture(state, objectNamed(state, "image_1").id, "", WIDE)).toBe(state);
  });

  it("describes the source row by what the picture IS, and keeps an UNELIDED edit seed so a row committed untouched writes it back whole", () => {
    const outcome = submitLine(opened(), "image x=10 y=20", VIEWPORT);
    const withPicture = commitImagePicture(outcome.state, objectNamed(outcome.state, "image_1").id, PICTURE, WIDE);
    const image = objectNamed(withPicture, "image_1");
    const row = buildPanelModel(image, withPicture.document.objects).modifiable.find((candidate) => candidate.path === "source");
    expect(row?.value).toBe("PNG picture · about 0 KB");
    expect(row?.value).not.toContain(PICTURE);
    expect(row?.editSeed).toBe(`"${PICTURE}"`);
  });

  it("marks the source row as the one chosen from a file, and no other row", () => {
    const created = submitLine(opened(), "image x=10 y=20", VIEWPORT).state;
    const image = objectNamed(created, "image_1");
    const rows = buildPanelModel(image, created.document.objects).modifiable;
    expect(rows.filter((row) => row.picker).map((row) => row.path)).toEqual(["source"]);
  });

  it("says so plainly when no picture has been chosen yet", () => {
    const created = submitLine(opened(), "image x=10 y=20", VIEWPORT).state;
    const image = objectNamed(created, "image_1");
    const row = buildPanelModel(image, created.document.objects).modifiable.find((candidate) => candidate.path === "source");
    expect(row?.value).toBe("no picture chosen");
  });

  it("leaves a FORMULA-driven source with its ordinary paperclip, because the meaningful gesture on a driven slot is unlink", () => {
    const withTable = typed(opened(), "table x=0 y=0 rows=1 cols=1");
    const seeded = typed(withTable, 'set table_1.A1 "data:image/png;base64,AAAA"');
    const withImage = typed(seeded, "image x=0 y=0");
    const linked = typed(withImage, "link image_1.source table_1.A1");
    const image = objectNamed(linked, "image_1");
    const row = buildPanelModel(image, linked.document.objects).modifiable.find((candidate) => candidate.path === "source");
    expect(row?.kind).toBe("formula");
    expect(row?.picker).toBe(false);
  });
});

describe("a chosen picture gives the image its own proportions", () => {
  const PICTURE = `data:image/jpeg;base64,${"A".repeat(60)}`;

  function boxAfterChoosing(naturalWidth: number, naturalHeight: number): { width: unknown; height: unknown } {
    const created = submitLine(opened(), "image x=10 y=20", VIEWPORT).state;
    const after = commitImagePicture(created, objectNamed(created, "image_1").id, PICTURE, { naturalWidth, naturalHeight });
    const image = objectNamed(after, "image_1");
    return { width: getSlot(image, ["width"])?.value, height: getSlot(image, ["height"])?.value };
  }

  it("gives a WIDE picture a wide box, its longer side at the default extent", () => {
    expect(boxAfterChoosing(400, 300)).toEqual({ width: 100, height: 75 });
  });

  it("gives a TALL picture a tall box", () => {
    expect(boxAfterChoosing(300, 600)).toEqual({ width: 50, height: 100 });
  });

  it("scales a huge photograph DOWN to the default extent rather than writing its raw pixel size, so it does not dwarf everything else on the canvas", () => {
    expect(boxAfterChoosing(4000, 3000)).toEqual({ width: 100, height: 75 });
  });

  it("leaves a square picture square, unchanged from the empty frame it replaced", () => {
    expect(boxAfterChoosing(512, 512)).toEqual({ width: 100, height: 100 });
  });

  it("leaves the box alone but still records the source when the chosen file did not decode", () => {
    const created = submitLine(opened(), "image x=10 y=20", VIEWPORT).state;
    const after = commitImagePicture(created, objectNamed(created, "image_1").id, PICTURE, undefined);
    const image = objectNamed(after, "image_1");
    expect(getSlot(image, ["source"])?.value).toBe(PICTURE);
    expect(getSlot(image, ["width"])?.value).toBe(100);
    expect(newLines(created, after).join("\n")).toContain("did not decode, box unchanged");
  });

  it("takes no ratio from a degenerate natural size — the square default stands", () => {
    expect(boxAfterChoosing(0, 100)).toEqual({ width: 100, height: 100 });
    expect(boxAfterChoosing(100, Number.POSITIVE_INFINITY)).toEqual({ width: 100, height: 100 });
  });

  it("makes the drawn extent hug the picture, which is what the ruling asked for", () => {
    const created = submitLine(opened(), "image x=10 y=20", VIEWPORT).state;
    const after = commitImagePicture(created, objectNamed(created, "image_1").id, PICTURE, { naturalWidth: 400, naturalHeight: 300 });
    expect(objectExtent(objectNamed(after, "image_1"))).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 95 });
  });

  it("remembers the picture's own ratio in `pictureAspect`, so a later distortion has something to be put back to", () => {
    const created = submitLine(opened(), "image x=10 y=20", VIEWPORT).state;
    const after = commitImagePicture(created, objectNamed(created, "image_1").id, PICTURE, { naturalWidth: 400, naturalHeight: 300 });
    expect(getSlot(objectNamed(after, "image_1"), ["pictureAspect"])).toEqual({ kind: "literal", value: 4 / 3 });
  });

  it("leaves a formula-driven `width` alone when a picture is chosen, instead of silently unlinking it from the cell that drives it", () => {
    const withTable = typed(opened(), "table x=0 y=0 rows=1 cols=1");
    const seeded = typed(withTable, "set table_1.A1 250");
    const created = typed(seeded, "image x=0 y=0");
    const linked = typed(created, "link image_1.width table_1.A1");
    const after = commitImagePicture(linked, objectNamed(linked, "image_1").id, PICTURE, { naturalWidth: 400, naturalHeight: 300 });
    const image = objectNamed(after, "image_1");
    expect(getSlot(image, ["width"])?.kind).toBe("formula");
    expect(getSlot(image, ["source"])?.value).toBe(PICTURE);
    expect(numberAt(image, ["height"])).toBe(75);
    expect(newLines(linked, after).join("\n")).toContain("image_1.width left alone");
  });

  it("records NO ratio for a decode with a degenerate natural size, the same case `pictureBoxSize` refuses a shape from", () => {
    const created = submitLine(opened(), "image x=10 y=20", VIEWPORT).state;
    const after = commitImagePicture(created, objectNamed(created, "image_1").id, PICTURE, { naturalWidth: 0, naturalHeight: 100 });
    expect(getSlot(objectNamed(after, "image_1"), ["pictureAspect"])?.value).toBe(0);
  });

  it("offers `preserveAspect` as a panel drop-down, on by default", () => {
    const created = submitLine(opened(), "image x=10 y=20", VIEWPORT).state;
    const image = objectNamed(created, "image_1");
    expect(getSlot(image, ["preserveAspect"])).toEqual({ kind: "literal", value: true });
    const row = buildPanelModel(image, created.document.objects).modifiable.find((candidate) => candidate.path === "preserveAspect");
    expect(row?.choices?.labels).toEqual(["keep the picture's proportions", "stretch to fill the box"]);
    expect(row?.choices?.selectedIndex).toBe(0);
  });
});

describe("turning `preserve aspect ratio` back on undoes a distortion", () => {
  const PICTURE = `data:image/jpeg;base64,${"A".repeat(60)}`;

  function withWidePicture(): AppState {
    const created = submitLine(opened(), "image x=10 y=20", VIEWPORT).state;
    return commitImagePicture(created, objectNamed(created, "image_1").id, PICTURE, { naturalWidth: 400, naturalHeight: 200 });
  }

  function distorted(): AppState {
    const state = withWidePicture();
    const off = commitPanelChoice(state, objectNamed(state, "image_1").id, "preserveAspect", false);
    return typed(off, "set image_1.height 100");
  }

  it("puts the box back to the picture's proportions when the toggle goes back on", () => {
    const state = distorted();
    expect(numberAt(objectNamed(state, "image_1"), ["height"])).toBe(100);
    const back = commitPanelChoice(state, objectNamed(state, "image_1").id, "preserveAspect", true);
    const image = objectNamed(back, "image_1");
    expect(numberAt(image, ["width"])).toBe(100);
    expect(numberAt(image, ["height"])).toBe(50);
  });

  it("shrinks rather than grows — the restored box is the rectangle that FITS inside the distorted one, so undoing never pushes the image over its neighbours", () => {
    const state = withWidePicture();
    const off = commitPanelChoice(state, objectNamed(state, "image_1").id, "preserveAspect", false);
    const stretched = typed(off, "set image_1.width 400");
    const back = commitPanelChoice(stretched, objectNamed(stretched, "image_1").id, "preserveAspect", true);
    const image = objectNamed(back, "image_1");
    expect(numberAt(image, ["width"])).toBe(100);
    expect(numberAt(image, ["height"])).toBe(50);
  });

  it("leaves the origin alone, so the top-left corner does not move out from under the operator's eye", () => {
    const back = commitPanelChoice(distorted(), objectNamed(distorted(), "image_1").id, "preserveAspect", true);
    expect(objectExtent(objectNamed(back, "image_1"))).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  });

  it("echoes ONE line for the two writes, because the operator made one choice", () => {
    const state = distorted();
    const back = commitPanelChoice(state, objectNamed(state, "image_1").id, "preserveAspect", true);
    expect(newLines(state, back).filter((line) => line.startsWith(">"))).toEqual([
      "> set image_1.preserveAspect TRUE",
      "> image_1 back to the picture's proportions — box 100x50",
    ]);
  });

  it("writes nothing when the box is already in proportion — the restore is idempotent and silent", () => {
    const state = withWidePicture();
    const back = commitPanelChoice(state, objectNamed(state, "image_1").id, "preserveAspect", true);
    expect(newLines(state, back).filter((line) => line.includes("proportions"))).toEqual([]);
    expect(numberAt(objectNamed(back, "image_1"), ["width"])).toBe(100);
  });

  it("restores nothing for an image whose `source` was typed by hand, because no gesture ever recorded its shape, which is an accepted cost", () => {
    const created = typed(opened(), "image x=0 y=0");
    const seeded = typed(created, `set image_1.source "${PICTURE}"`);
    const stretched = typed(seeded, "set image_1.width 400");
    const back = commitPanelChoice(stretched, objectNamed(stretched, "image_1").id, "preserveAspect", true);
    expect(numberAt(objectNamed(back, "image_1"), ["width"])).toBe(400);
  });

  it("does not fire while the toggle is being turned OFF — the operator is asking for the distortion, not for its undo", () => {
    const state = withWidePicture();
    const stretched = typed(state, "set image_1.height 100");
    const off = commitPanelChoice(stretched, objectNamed(stretched, "image_1").id, "preserveAspect", false);
    expect(numberAt(objectNamed(off, "image_1"), ["height"])).toBe(100);
  });

  it("leaves a `text` box's own drop-down untouched — the restore is one condition-guarded call, not a special case in the generic choice path", () => {
    const state = typed(opened(), 'text x=0 y=0 "hello"');
    const after = commitPanelChoice(state, objectNamed(state, "text_1").id, "autoresize", false);
    expect(getSlot(objectNamed(after, "text_1"), ["autoresize"])?.value).toBe(false);
    expect(newLines(state, after).filter((line) => line.includes("proportions"))).toEqual([]);
  });

  it("leaves a formula-driven side ALONE and says so, instead of quietly replacing the link of the operator with a number, under the per component rule", () => {
    const withTable = typed(opened(), "table x=0 y=0 rows=1 cols=1");
    const seeded = typed(withTable, "set table_1.A1 120");
    const linked = typed(distortedIn(seeded), "link image_1.width table_1.A1");
    const back = commitPanelChoice(linked, objectNamed(linked, "image_1").id, "preserveAspect", true);
    expect(newLines(linked, back).join("\n")).toContain("image_1.width left alone");
    expect(getSlot(objectNamed(back, "image_1"), ["width"])?.kind).toBe("formula");
    expect(numberAt(objectNamed(back, "image_1"), ["height"])).toBe(60);
  });

  function distortedIn(base: AppState): AppState {
    const created = typed(base, "image x=10 y=20");
    const withPicture = commitImagePicture(created, objectNamed(created, "image_1").id, PICTURE, { naturalWidth: 400, naturalHeight: 200 });
    const off = commitPanelChoice(withPicture, objectNamed(withPicture, "image_1").id, "preserveAspect", false);
    return typed(off, "set image_1.height 100");
  }
});

describe("abandonCreatedTextBox — an abandoned just-created empty text box is removed", () => {
  function withEmptyTextBox(): { state: AppState; id: string } {
    const state = pointerDownAt(typed(opened(), "text"), { x: 50, y: 50 }, VIEWPORT).state;
    return { state, id: objectNamed(state, "text_1").id };
  }

  it("deletes the box (it has no content) and echoes the delete like any command", () => {
    const { state, id } = withEmptyTextBox();
    const after = abandonCreatedTextBox(state, id);
    expect(after.document.objects.find((object) => object.id === id)).toBeUndefined();
    expect(newLines(state, after)).toEqual(["> delete text_1", "deleted text_1"]);
  });

  it("keeps a box that received text before the edit ended (non-empty content is a no-op)", () => {
    const { state, id } = withEmptyTextBox();
    const withText = commitTextContent(state, id, "hello");
    const after = abandonCreatedTextBox(withText, id);
    expect(after).toBe(withText);
    expect(objectNamed(after, "text_1")).toBeDefined();
  });

  it("is a no-op for a stale object id", () => {
    const { state } = withEmptyTextBox();
    expect(abandonCreatedTextBox(state, "obj_404")).toBe(state);
  });
});

describe("panel drop-downs — a slot with a closed value set offers it (2026-09-02)", () => {
  function rowOf(state: AppState, path: string, name = "text_1"): PanelRow {
    const object = objectNamed(state, name);
    const found = buildPanelModel(object, state.document.objects).modifiable.find((row) => row.path === path);
    if (found === undefined) {
      throw new Error(`expected a modifiable row at ${path} on ${name}`);
    }
    return found;
  }

  function withText(): AppState {
    return typed(opened(), 'text x=0 y=0 "hello"');
  }

  it("gives `style.align` its three choices, with the current one selected", () => {
    const row = rowOf(withText(), "style.align");
    expect(row.choices?.values).toEqual(["left", "center", "right"]);
    expect(row.choices?.labels).toEqual(["left", "center", "right"]);
    expect(row.choices?.selectedIndex).toBe(0);
  });

  it("has no `overflow` row left to offer choices on — the slot is gone, not just its drop-down", () => {
    const object = objectNamed(withText(), "text_1");
    const model = buildPanelModel(object, withText().document.objects);
    expect(model.modifiable.map((row) => row.path)).not.toContain("overflow");
    expect(model.derived.map((row) => row.path)).not.toContain("overflow");
  });

  it("gives `autoresize` a BOOLEAN pair with readable labels — `true`/`false` says nothing about what it does", () => {
    const row = rowOf(withText(), "autoresize");
    expect(row.choices?.values).toEqual([true, false]);
    expect(row.choices?.labels).toEqual(["shrink to fit text", "keep the size I set"]);
    expect(row.choices?.selectedIndex).toBe(0);
  });

  it("leaves a free-text slot without choices, so the paperclip and its text box are unchanged for every row that had them", () => {
    expect(rowOf(withText(), "content").choices).toBeUndefined();
    expect(rowOf(withText(), "style.fontSize").choices).toBeUndefined();
    expect(rowOf(typed(opened(), "circle x=0 y=0 r=5"), "radius", "circle_1").choices).toBeUndefined();
  });

  it("reports selectedIndex -1 when the slot holds something none of the choices names, rather than claiming the first is live", () => {
    const state = typed(withText(), 'set text_1.style.align "sideways"');
    expect(rowOf(state, "style.align").choices?.selectedIndex).toBe(-1);
  });

  it("offers NO drop-down on a FORMULA row — it is driven, and a choice that silently overwrote the formula is what no gesture can do", () => {
    let state = typed(withText(), "table x=500 y=0");
    state = typed(state, 'set table_1.A1 "center"');
    state = typed(state, "link text_1.style.align table_1.A1");
    const row = rowOf(state, "style.align");
    expect(row.kind).toBe("formula");
    expect(row.choices).toBeUndefined();
  });

  it("commitPanelChoice writes the chosen STRING as a literal, not as a formula", () => {
    const state = withText();
    const after = commitPanelChoice(state, objectNamed(state, "text_1").id, "style.align", "center");
    expect(getSlot(objectNamed(after, "text_1"), ["style", "align"])).toEqual({ kind: "literal", value: "center" });
  });

  it("commitPanelChoice writes a BOOLEAN as a literal boolean — no string round-trip, which the free-text grammar could not do", () => {
    const state = withText();
    const after = commitPanelChoice(state, objectNamed(state, "text_1").id, "autoresize", false);
    expect(getSlot(objectNamed(after, "text_1"), ["autoresize"])).toEqual({ kind: "literal", value: false });
  });

  it("echoes the write like any other panel command, through the same executeCommand seam", () => {
    const state = withText();
    const after = commitPanelChoice(state, objectNamed(state, "text_1").id, "style.align", "right");
    expect(newLines(state, after)[0]).toBe("> set text_1.style.align right");
  });

  it("echoes a BOOLEAN choice in the uppercase spelling, so the echoed line retypes to the same boolean", () => {
    const state = withText();
    const after = commitPanelChoice(state, objectNamed(state, "text_1").id, "autoresize", false);
    expect(newLines(state, after)[0]).toBe("> set text_1.autoresize FALSE");
    const retyped = typed(withText(), "set text_1.autoresize FALSE");
    expect(getSlot(objectNamed(retyped, "text_1"), ["autoresize"])).toEqual(getSlot(objectNamed(after, "text_1"), ["autoresize"]));
  });

  it("is a no-op for a stale object id", () => {
    const state = withText();
    expect(commitPanelChoice(state, "obj_404", "style.align", "right")).toBe(state);
  });
});

describe("a text box's size follows its text (2026-09-02)", () => {
  it("`text` creates the box with autoresize ON, so a fresh box hugs its text", () => {
    const state = typed(opened(), 'text x=0 y=0 "hello"');
    expect(getSlot(objectNamed(state, "text_1"), ["autoresize"])).toEqual({ kind: "literal", value: true });
  });

  it("`set text_1.autoresize FALSE` is an ordinary literal write — the slot is authorable from the command line too, in the uppercase boolean spelling", () => {
    let state = typed(opened(), 'text x=0 y=0 "hello"');
    state = typed(state, "set text_1.autoresize FALSE");
    expect(getSlot(objectNamed(state, "text_1"), ["autoresize"])).toEqual({ kind: "literal", value: false });
  });
});

describe("a document saved before `autoresize` existed still loads (2026-09-02)", () => {
  function preAutoresizeDocument(): unknown {
    return {
      formatVersion: 1,
      nextObjectId: 2,
      camera: { x: 0, y: 0, zoom: 1 },
      journal: [],
      objects: [
        {
          id: "obj_1",
          name: "text_1",
          type: "text",
          slots: {
            "origin.x": { kind: "literal", value: 10 },
            "origin.y": { kind: "literal", value: 20 },
            content: { kind: "literal", value: "hello" },
            width: { kind: "literal", value: "auto" },
            height: { kind: "literal", value: "auto" },
            overflow: { kind: "literal", value: "visible" },
            "style.font": { kind: "literal", value: "sans-serif" },
            "style.fontSize": { kind: "literal", value: 16 },
            "style.lineHeight": { kind: "literal", value: 20 },
            "style.color": { kind: "literal", value: "black" },
            "style.align": { kind: "literal", value: "left" },
            resolvedContent: { kind: "derived" },
            measuredHeight: { kind: "derived" },
            measuredWidth: { kind: "derived" },
          },
        },
      ],
    };
  }

  it("loads, and the text object keeps its content", () => {
    const loaded = deserializeDocument(preAutoresizeDocument());
    if (!loaded.ok) {
      throw new Error(`expected it to load, got: ${loaded.message}`);
    }
    const state = initialAppState(loaded.document);
    expect(getSlot(objectNamed(state, "text_1"), ["content"])).toEqual({ kind: "literal", value: "hello" });
  });

  it("leaves the missing slot missing rather than inventing one, and the box behaves as autoresize ON — the default every reader applies", () => {
    const loaded = deserializeDocument(preAutoresizeDocument());
    if (!loaded.ok) {
      throw new Error(`expected it to load, got: ${loaded.message}`);
    }
    const state = initialAppState(loaded.document);
    expect(getSlot(objectNamed(state, "text_1"), ["autoresize"])).toBeUndefined();
    const extent = objectExtent(objectNamed(state, "text_1"));
    expect(extent === undefined || extent.maxY > extent.minY).toBe(true);
  });

  it("accepts a later `set text_1.autoresize FALSE`, which CREATES the slot — a setSlot replaces whatever is at the address, present or not", () => {
    const loaded = deserializeDocument(preAutoresizeDocument());
    if (!loaded.ok) {
      throw new Error(`expected it to load, got: ${loaded.message}`);
    }
    const state = typed(initialAppState(loaded.document), "set text_1.autoresize FALSE");
    expect(getSlot(objectNamed(state, "text_1"), ["autoresize"])).toEqual({ kind: "literal", value: false });
  });

  it("still loads a document carrying the REMOVED `overflow` slot, keeps it inert, and shows no panel row for it", () => {
    const loaded = deserializeDocument(preAutoresizeDocument());
    if (!loaded.ok) {
      throw new Error(`expected it to load, got: ${loaded.message}`);
    }
    const state = initialAppState(loaded.document);
    const object = objectNamed(state, "text_1");
    expect(getSlot(object, ["overflow"])).toEqual({ kind: "literal", value: "visible" });
    const model = buildPanelModel(object, state.document.objects);
    expect(model.modifiable.map((row) => row.path)).not.toContain("overflow");
    expect(model.derived.map((row) => row.path)).not.toContain("overflow");
  });
});

describe("PHASE 5'S ACCEPTANCE CRITERION — one text box, through mutate, with a REAL measurer", () => {

  const GATE_CONTENT =
    "Radius: {= table_1.A1 }{? table_1.A1 > 50 } — **LARGE** (max {= table_1.B1 }){:} — small (min {= table_1.C1 }){?}";

  const CHAR = 10;
  function realMeasurerContext(): EvalContext {
    const ctx: MeasurementContext = { font: "", measureText: (text: string) => ({ width: text.length * CHAR }) };
    return { measurer: createCanvas2dTextMeasurer(ctx) };
  }

  function typedWith(state: AppState, line: string, context: EvalContext): AppState {
    return submitLine(state, line, VIEWPORT, context).state;
  }

  function resolvedContentOf(state: AppState): unknown {
    return getSlot(objectNamed(state, "text_1"), ["resolvedContent"])?.value;
  }

  function measuredHeightOf(state: AppState): unknown {
    return getSlot(objectNamed(state, "text_1"), ["measuredHeight"])?.value;
  }

  function gateDocument(): AppState {
    const context = realMeasurerContext();
    let state = typedWith(opened(), "table x=0 y=0 rows=1 cols=3", context);
    state = typedWith(state, "set table_1.A1 30", context);
    state = typedWith(state, "set table_1.B1 999", context);
    state = typedWith(state, "set table_1.C1 5", context);
    state = typedWith(state, `text x=0 y=0 "${GATE_CONTENT}"`, context);
    return state;
  }

  it("resolves the number and the currently-taken FALSE branch inside the creating mutation", () => {
    expect(resolvedContentOf(gateDocument())).toBe("Radius: 30 — small (min 5)");
  });

  it("updates both the number and the branch as the cell changes — the criterion's own wording", () => {
    const raised = typedWith(gateDocument(), "set table_1.A1 80", realMeasurerContext());
    expect(resolvedContentOf(raised)).toBe("Radius: 80 — **LARGE** (max 999)");
  });

  it("a value referenced ONLY inside the currently non-taken branch is still a real, discoverable dependency, which eager and total extraction gives, proved end to end through `refs`", () => {
    const before = gateDocument();
    const after = typedWith(before, "refs table_1.B1", realMeasurerContext());
    expect(newLines(before, after)).toContain("table_1.B1 → text_1.resolvedContent");
  });

  it("a value changed while its branch is untaken is not stale once that branch is later taken — the observable half of 're-renders'", () => {
    let state = gateDocument();
    state = typedWith(state, "set table_1.B1 777", realMeasurerContext());
    expect(resolvedContentOf(state)).toBe("Radius: 30 — small (min 5)");
    state = typedWith(state, "set table_1.A1 80", realMeasurerContext());
    expect(resolvedContentOf(state)).toBe("Radius: 80 — **LARGE** (max 777)");
  });

  it("wraps at its set width — measuredHeight comes from the real word-wrap algorithm, not a fixed-size fake", () => {
    let state = gateDocument();
    state = typedWith(state, "set table_1.A1 80", realMeasurerContext());
    state = typedWith(state, "set text_1.width 100", realMeasurerContext());
    expect(measuredHeightOf(state)).toBe(60);
  });

  it("no false cycle — the criterion's own document builds and updates without ever refusing", () => {
    const state = typedWith(gateDocument(), "set table_1.A1 80", realMeasurerContext());
    expect(state.log.join("\n")).not.toContain("cyclic");
  });
});
