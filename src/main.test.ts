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
import type { EvalContext } from "./engine/eval-context.ts";
import { getSlot, type GraphObject } from "./engine/graph/node.ts";
import { renderDocument } from "./render/renderer.ts";
import { MAX_ZOOM, MIN_ZOOM, screenToWorld, worldToScreen } from "./render/camera.ts";
import {
  buildPanelModel,
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
    expect(escaped.interaction.selectedObjectIds).toEqual([]);
    expect(escaped.log[escaped.log.length - 1]).toBe("cancelled");
  });
});

describe("submitLine — the returned AppTransition reports whether the line was REFUSED (D-109 clause 3)", () => {
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
    expect(outcome.state.pending?.stepIndex).toBe(1); // moved on, not re-asking step 0
  });

  it("IS refused when a prompt step's own answer is refused, so the same step re-asks (D-072 clause 7)", () => {
    const midSequence = typed(typed(opened(), "circle"), "100,100");
    const outcome = submitLine(midSequence, "not-a-radius", VIEWPORT);
    expect(outcome.refused).toBe(true);
    expect(outcome.state.pending?.stepIndex).toBe(1); // re-asks the SAME step
  });

  it("is NOT refused for an accepted command that also requests a file (save)", () => {
    const outcome = submitLine(opened(), "save", VIEWPORT);
    expect(outcome.refused).toBe(false);
    expect(outcome.fileRequest).toBe("save");
  });
});

describe("performEffect — select (D-075, D-082)", () => {
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

  it("refuses an unknown name in `commands.ts`, which is why no arm here has to (D-075 clause 1)", () => {
    const before = opened();
    const after = typed(before, "select nothing_here");
    expect(after.interaction.selectedObjectIds).toEqual([]);
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
    // the `text` command (entry 0136) always supplies a full slot set, so a
    // slotless `text` object is not one `createObject` would build (entry 0127
    // gave `text` a schema; `initialAppState` does not re-validate). It is the
    // other emptiness `documentExtent` reports,
    // and the branch exists because `commands.ts` cannot see it.
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
    expect(reopened.interaction.selectedObjectIds).toEqual([]);
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

describe("buildPanelModel — the properties panel's rows (D-094 clauses 3, 5-9)", () => {
  it("splits an object's slots into modifiable and derived groups, in schema declaration order", () => {
    const state = typed(opened(), "circle x=10 y=20 r=5");
    const model = buildPanelModel(objectNamed(state, "circle_1"), state.document.objects);
    expect(model.header).toBe("circle_1");
    expect(model.modifiable.map((row) => row.path)).toEqual(["origin.x", "origin.y", "radius"]);
    // Every derived row is read-only; `vertices` is the first the schema declares.
    expect(model.derived[0]?.path).toBe("vertices");
    expect(model.derived.map((row) => row.path)).toContain("centroid.x");
  });

  it("shows a literal slot's plain value and no formula source", () => {
    const state = typed(opened(), "circle x=10 y=20 r=5");
    const model = buildPanelModel(objectNamed(state, "circle_1"), state.document.objects);
    const originX = model.modifiable.find((row) => row.path === "origin.x");
    // `kind`/`synthetic` (D-102) round-trip `SlotDescriptor`'s own fields —
    // see the next `describe` block for what a row's writer does with them.
    // `editSeed` (D-107, F3) equals `value` here because an integer has
    // nothing D-099's rounding would ever change — see the dedicated test
    // below for the case where they diverge.
    expect(originX).toEqual({ path: "origin.x", value: "10", editSeed: "10", formulaSource: undefined, kind: "literal", synthetic: false });
  });

  it("seeds a row's editor with the value the command line would accept back, not the D-099-rounded display value (D-107, F3)", () => {
    const state = typed(opened(), "circle x=0.123456789 y=20 r=5");
    const model = buildPanelModel(objectNamed(state, "circle_1"), state.document.objects);
    const originX = model.modifiable.find((row) => row.path === "origin.x");
    expect(originX?.value).toBe("0.1235"); // D-099's rounded DISPLAY value — unchanged.
    expect(originX?.editSeed).toBe("0.123456789"); // The unrounded SEED.

    // Committing the seed back UNTOUCHED must leave the number bit-for-bit
    // as it was — this is the failure the review's F3 named: seeding with
    // `value` instead would have written back the truncated "0.1235".
    const circleId = objectNamed(state, "circle_1").id;
    const after = commitPanelEdit(state, circleId, "origin.x", originX?.editSeed ?? "");
    expect(numberAt(objectNamed(after, "circle_1"), ["origin", "x"])).toBe(0.123456789);
  });

  it("carries a formula slot's reconstructed source and keeps it in the modifiable group (D-094 clause 6)", () => {
    let state = typed(opened(), "circle x=0 y=0 r=5");
    state = typed(state, "table x=200 y=0 rows=2 cols=2");
    state = typed(state, "set table_1.A1 7");
    state = typed(state, "link circle_1.origin.x table_1.A1");
    const model = buildPanelModel(objectNamed(state, "circle_1"), state.document.objects);
    const originX = model.modifiable.find((row) => row.path === "origin.x");
    expect(originX?.formulaSource).toBe("table_1.A1");
    expect(model.derived.some((row) => row.path === "origin.x")).toBe(false);
    // D-102 clause 3: the paperclip's colour comes from `kind`, not from
    // whether a source string happens to be present.
    expect(originX?.kind).toBe("formula");
  });

  it("summarises a table's cells as ONE modifiable row, never one per cell (D-077, D-094 clause 8)", () => {
    const state = typed(opened(), "table x=0 y=0 rows=3 cols=3");
    const model = buildPanelModel(objectNamed(state, "table_1"), state.document.objects);
    expect(model.modifiable.map((row) => row.path)).toEqual(["origin.x", "origin.y", "rows", "cols", "cells"]);
    expect(model.derived).toEqual([]);
    // D-102 clause 2: the cells row is `synthetic` — it stands for a whole
    // family, not one slot, so the DOM writer must refuse it a paperclip.
    expect(model.modifiable.find((row) => row.path === "cells")?.synthetic).toBe(true);
    expect(model.modifiable.find((row) => row.path === "origin.x")?.synthetic).toBe(false);
  });

  it("rounds a derived number's float dust to 4 decimals (D-099), while `props` keeps full precision — the two formatters disagree on purpose", () => {
    // 0100-REVIEW's own example: a circle's area-weighted centroid (computed
    // from its polygon-approximated vertices) carries float dust even at an
    // integer origin.
    const state = typed(opened(), "circle x=10 y=20 r=7");
    const model = buildPanelModel(objectNamed(state, "circle_1"), state.document.objects);
    const centroidX = model.derived.find((row) => row.path === "centroid.x");
    expect(centroidX?.value).toBe("10"); // Rounded AND trimmed — never "10.0000".

    // The SAME slot, through `props`, is untouched — D-099 clause 5's
    // disclosed, deliberate divergence.
    const propsState = typed(state, "props circle_1");
    const propsLines = newLines(state, propsState);
    expect(propsLines.some((line) => line.includes("centroid.x = 10.000000000000002"))).toBe(true);
  });
});

describe("commitPanelEdit / unlinkPanelSlot — writing through the panel (D-102)", () => {
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

    // A doubled `=` would reach `parseFormula` as a malformed expression and
    // come back as a refusal, not a formula.
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

  it("is a no-op for an object id the document no longer has — nothing to name (D-023's posture)", () => {
    const state = typed(opened(), "circle x=10 y=20 r=5");
    expect(commitPanelEdit(state, "obj_404", "origin.x", "5")).toBe(state);
    expect(unlinkPanelSlot(state, "obj_404", "origin.x")).toBe(state);
  });

  it("unlink reverts a formula slot to a literal holding the last computed value (D-041), echoed the same way", () => {
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

describe("pointer and wheel (§5.9)", () => {
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

  it("a shift-click (the `additive` flag) ADDS to the selection instead of replacing it (D-100 clauses 3-4)", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "circle x=200 y=0 r=20");
    const polygonId = objectNamed(state, "polygon_1").id;
    const circleId = objectNamed(state, "circle_1").id;

    const first = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(first.interaction.selectedObjectIds).toEqual([polygonId]);

    const second = pointerDownAt(first, { x: 200, y: 20 }, VIEWPORT, true).state;
    expect(second.interaction.selectedObjectIds).toEqual([polygonId, circleId]);

    // Shift-clicking the SAME object again toggles it back out (D-100 clause 4).
    const third = pointerDownAt(second, { x: 200, y: 20 }, VIEWPORT, true).state;
    expect(third.interaction.selectedObjectIds).toEqual([polygonId]);
  });

  it("answers a live prompt step with a PICKED world point instead of selecting (D-072)", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "circle");
    // The pointer is over the polygon: without D-072's rule this press would
    // select it. During a live sequence it is an answer to the step instead.
    const picked = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(picked.interaction.selectedObjectIds).toEqual([]);
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

describe("panel UI state — dismissal and manual position (D-101, D-106)", () => {
  it("starts with no panel UI state for a freshly selected object — shown, auto-placed, is the default", () => {
    const state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    const selected = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    expect(selected.panels).toEqual({});
  });

  it("dismissPanel hides one selected object's panel without touching the selection (D-106 clauses 2-3)", () => {
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

  it("movePanel records a manual CSS position for a selected object's panel (D-101 clause 5)", () => {
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

  it("discards a dismissed panel's state when its object leaves the selection, and re-selecting shows it again (D-101 clause 6, D-106 clause 6)", () => {
    const opening = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    let state = pointerDownAt(opening, { x: 50, y: 0 }, VIEWPORT).state;
    const id = objectNamed(state, "polygon_1").id;
    state = dismissPanel(state, id);
    expect(state.panels[id]?.dismissed).toBe(true);

    state = escape(state); // Clears the whole selection (D-100 clause 5).
    expect(state.panels[id]).toBeUndefined();

    state = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state; // Re-selects it.
    expect(state.panels[id]).toBeUndefined(); // Fresh — shown again, per D-106 clause 6.
  });

  it("discards a manual position the same way, when a plain click REPLACES the selection (D-100 clause 2, D-101 clause 6)", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "circle x=200 y=0 r=20");
    const polygonId = objectNamed(state, "polygon_1").id;
    state = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    state = movePanel(state, polygonId, { left: 5, top: 5 });
    expect(state.panels[polygonId]?.manualPosition).toEqual({ left: 5, top: 5 });

    state = pointerDownAt(state, { x: 200, y: 20 }, VIEWPORT).state; // A plain click elsewhere.
    expect(state.panels[polygonId]).toBeUndefined();
  });

  it("keeps an object's panel state when a shift-click ADDS another object — nothing left the selection (D-100 clause 3)", () => {
    let state = typed(opened(), "polygon sides=5 x=0 y=0 r=50");
    state = typed(state, "circle x=200 y=0 r=20");
    const polygonId = objectNamed(state, "polygon_1").id;
    state = pointerDownAt(state, { x: 50, y: 0 }, VIEWPORT).state;
    state = dismissPanel(state, polygonId);
    state = pointerDownAt(state, { x: 200, y: 20 }, VIEWPORT, true).state; // Shift-click adds the circle.
    expect(state.panels[polygonId]?.dismissed).toBe(true);
  });

  it("`select <name>` from the input bar prunes panel state the same way a plain click does — it too REPLACES the selection (D-100 clause 7)", () => {
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
    expect(state.interaction.selectedObjectIds).toEqual([polygon.id]);

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
    expect(state.interaction.selectedObjectIds).toEqual([polygon.id]);

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

describe("PHASE 4'S ACCEPTANCE CRITERION — (a), (b) and (c) simultaneously in ONE document, with no false cycle", () => {
  /**
   * The brief's §6 Phase 4 gate, verbatim: "all three hold simultaneously in
   * one document, with no false cycle." The human ran this document by hand at
   * the gate session (entry 0114) and it passed; this pins the same document so
   * the result cannot silently regress. §12.1 is why it exists at all — a
   * criterion shown only by a screenshot is not shown.
   *
   * TWO polygons, deliberately, because the brief says so and says why: "one
   * polygon cannot satisfy both directions, because a bound `origin.x` is by
   * definition not draggable."
   *
   * The ingredients are each already tested elsewhere (`commands.test.ts` for
   * `link` and for a cell holding a formula; the drag test above for the
   * per-component rule). What is tested HERE and nowhere else is that they
   * COMPOSE — a false cycle is precisely the defect that appears only when both
   * directions are present in one graph at once.
   */
  function firstVertexOf(object: GraphObject): { readonly x: number; readonly y: number } {
    const vertices = getSlot(object, ["vertices"])?.value as readonly { x: number; y: number }[] | undefined;
    const vertex = vertices?.[0];
    if (vertex === undefined) {
      throw new Error(`expected ${object.name}'s derived vertices to have been evaluated`);
    }
    return vertex;
  }

  /** The gate document: `polygon_1` driven BY the table, `polygon_2` driving it. */
  function gateDocument(): AppState {
    let state = typed(opened(), "table x=0 y=0 rows=4 cols=4");
    state = typed(state, "set table_1.A1 500");
    state = typed(state, "polygon sides=5 x=100 y=100 r=50"); // polygon_1 — the DRIVEN one.
    state = typed(state, "polygon sides=4 x=300 y=300 r=40"); // polygon_2 — the DRIVING one.
    state = typed(state, "link polygon_1.origin.x table_1.A1"); // (a)
    state = typed(state, "set table_1.B1 = polygon_2.origin.x * 2"); // (b)
    return state;
  }

  it("builds the whole document without a single refusal — both directions coexist in one graph", () => {
    const state = gateDocument();
    expect(state.document.objects.map((object) => object.name)).toEqual(["table_1", "polygon_1", "polygon_2"]);
    // The binding is real in BOTH directions before anything is dragged. Assert
    // the slot KINDS, not only the values: a literal that happens to hold the
    // right number satisfies a value check and is not a binding at all (caught
    // by mutation-checking this very test — see entry 0115).
    expect(getSlot(objectNamed(state, "polygon_1"), ["origin", "x"])?.kind).toBe("formula");
    expect(getSlot(objectNamed(state, "table_1"), ["cells", "B1"])?.kind).toBe("formula");
    // (b)'s driving polygon is LITERAL in X — the half of the brief's own wording
    // ("polygon_b.origin.x is a literal slot") that is what makes it draggable at
    // all, and therefore what makes (b) and (c) different tests (0116-REVIEW).
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
    // And the polygon's DERIVED geometry followed the origin, not just the slot.
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
    // The cell recomputed inside the same mutation's topological pass — never a
    // stale value, never a post-pass (§9's standing prohibition).
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
    expect(numberAt(after, ["origin", "x"])).toBe(500); // driven by table_1.A1: did not move.
    expect(numberAt(after, ["origin", "y"])).toBeCloseTo(originYBefore + 30 / state.document.camera.zoom, 9);
    // §5.9's non-blocking feedback names what is holding X.
    expect(state.log.slice(logBefore).join("\n")).toContain("table_1.A1");
  });

  it("all three hold in ONE state at once — the criterion's own wording", () => {
    let state = gateDocument();

    // (a) drive polygon_1 from the table.
    state = typed(state, "set table_1.A1 650");
    // (b) drive the table from polygon_2.
    const polygon2 = objectNamed(state, "polygon_2");
    const onPolygon2 = worldToScreen(state.document.camera, firstVertexOf(polygon2));
    state = pointerDownAt(state, onPolygon2, VIEWPORT).state;
    state = pointerMoveTo(state, { x: onPolygon2.x + 40, y: onPolygon2.y });
    state = pointerUpNow(state);
    // (c) drag the driven polygon; only Y gives.
    const polygon1 = objectNamed(state, "polygon_1");
    const onPolygon1 = worldToScreen(state.document.camera, firstVertexOf(polygon1));
    state = pointerDownAt(state, onPolygon1, VIEWPORT).state;
    state = pointerMoveTo(state, { x: onPolygon1.x + 30, y: onPolygon1.y + 30 });
    state = pointerUpNow(state);

    const finalPolygon1 = objectNamed(state, "polygon_1");
    const finalPolygon2 = objectNamed(state, "polygon_2");
    const finalTable = objectNamed(state, "table_1");

    expect(numberAt(finalPolygon1, ["origin", "x"])).toBe(650); // (a) still driven.
    expect(numberAt(finalPolygon1, ["origin", "y"])).toBeCloseTo(130, 9); // (c) Y moved, X did not.
    expect(numberAt(finalTable, ["cells", "B1"])).toBeCloseTo(numberAt(finalPolygon2, ["origin", "x"]) * 2, 9); // (b) still live.
    expect(state.log.join("\n")).not.toContain("cyclic");
  });

  it("no FALSE cycle, and cycle detection is still alive — a genuinely cyclic link is refused", () => {
    // The distinction the criterion is really making: the document above must
    // NOT be reported as cyclic, while a real cycle still must be. Asserting
    // only the first would pass just as well if cycle detection were switched
    // off entirely, which is the failure this second half exists to exclude.
    const state = gateDocument();
    // polygon_1.origin.x already reads table_1.A1, so pointing A1 back at it closes the loop.
    const outcome = submitLine(state, "set table_1.A1 = polygon_1.origin.x", VIEWPORT);

    expect(newLines(state, outcome.state).join("\n")).toContain("cyclic");
    // §5.1: a rejected mutation leaves prior state bit-for-bit unchanged.
    expect(outcome.state.document).toBe(state.document);
  });

  it("no false cycle in §5.1's OWN shape either — ONE object driven BY the table and driving it back", () => {
    // Added at 0116-REVIEW, because the document above cannot fail this way.
    // The gate binds through TWO polygons, so its object-level graph —
    // polygon_2 → table_1 → polygon_1 — is acyclic even for an implementation
    // whose graph is object-granular rather than slot-granular. The shape §5.1
    // names as the whole reason for slot granularity is the round trip through
    // ONE object: "a chain like `table_x.A1 → polygon_1.origin.x →
    // table_x.B1` would register as `table → polygon → table` and be falsely
    // rejected as a cycle." That is where "no false cycle" can actually fail,
    // and it is legal: A1, C1 and origin.x are three distinct slots.
    let state = typed(gateDocument(), "set table_1.C1 = polygon_1.centroid.x");

    expect(state.log.join("\n")).not.toContain("cyclic");
    expect(getSlot(objectNamed(state, "table_1"), ["cells", "C1"])?.kind).toBe("formula");
    expect(numberAt(objectNamed(state, "table_1"), ["cells", "C1"])).toBeCloseTo(500, 9);

    // And the round trip propagates in one pass: the cell drives the polygon's
    // origin, and that same polygon's DERIVED centroid drives the cell beside it.
    state = typed(state, "set table_1.A1 650");

    expect(numberAt(objectNamed(state, "polygon_1"), ["origin", "x"])).toBe(650);
    expect(numberAt(objectNamed(state, "table_1"), ["cells", "C1"])).toBeCloseTo(650, 9);
  });
});

// The pure transitions gained a trailing `context` (§5.1's `EvalContext`) at
// entry 0132 so `start` can thread `render/measure.ts`'s Canvas2D measurer
// through to every `mutate`. The fixture document carries a hand-built `text`
// object (deliberately, not the entry-0136 `text` command — this keeps the test
// about context threading); `measuredHeight` is `#MEASURE` (D-118) on the
// default path and a real height once a measurer is passed.
describe("submitLine / pointerMoveTo forward §5.1's EvalContext (entry 0132, D-118)", () => {
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
        measuredWidth: { kind: "derived", value: null }, // D-123's third derived slot
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
    // The rect is created through the real command path (correct schema slots);
    // the text object was placed in the document directly (deliberately, not the
    // entry-0136 `text` command — the test is about the drag, not creation).
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
    expect(numberAt(objectNamed(dragged, "rect_1"), ["origin", "x"])).toBeCloseTo(8, 9); // the drag committed
  });
});

// **D-125** — in-place editing commits through the SAME `executeCommand` seam a
// typed line uses (Rule 2, D-069). These cover the pure half: the `Command`
// each receiver synthesises (clause 3, the trap) and the seed text. The
// geometry is `render/editor.test.ts`; the DOM element lifecycle is in `start`,
// untested by construction (D-001).
describe("commitTextContent — a `text` object's content is ALWAYS a literal `set` (D-125 clause 3, D-122)", () => {
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

  it("stores §5.6 markup verbatim, newlines included", () => {
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

describe("commitTableCell — Excel-style: `=` is a formula, a number is a number, else a string (D-125 clause 3)", () => {
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
});

describe("editorSeed — the text the in-place editor opens showing (D-125)", () => {
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

  it("shows a same-table cell reference in bare Excel form, not fully qualified (D-131)", () => {
    let state = typed(opened(), "table x=0 y=0");
    const id = objectNamed(state, "table_1").id;
    state = commitTableCell(state, id, "A2", "10");
    state = commitTableCell(state, id, "A1", "=A2 * 2");
    expect(editorSeed(state, { kind: "cell", objectId: id, cell: "A1" })).toBe("=A2 * 2");
  });

  it("round-trips a same-table cell formula: seed -> commit unchanged -> same stored AST (D-131)", () => {
    let state = typed(opened(), "table x=0 y=0");
    const id = objectNamed(state, "table_1").id;
    state = commitTableCell(state, id, "A1", "=SUM(A2:A5) + B1");
    const seed = editorSeed(state, { kind: "cell", objectId: id, cell: "A1" });
    expect(seed).toBe("=SUM(A2:A5) + B1");
    const before = getSlot(objectNamed(state, "table_1"), ["cells", "A1"]);
    const after = commitTableCell(state, id, "A1", seed);
    expect(getSlot(objectNamed(after, "table_1"), ["cells", "A1"])).toEqual(before);
  });

  it("keeps a cross-table reference fully qualified in the cell editor (D-131 clause 3)", () => {
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

// **D-124** — `text` is placed by POINTING (a `parser.ts` prompt step), and the
// new box hands straight to D-125's in-place editor: `advance` returns
// `AppTransition.openEditor` naming it, which `start` (untested by construction)
// reads to set `inPlaceEditor`. These cover the pure signal.
describe("text placed by pointing opens the in-place editor on the new box (D-124)", () => {
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
    // The editor opens showing nothing — the operator types the content in place.
    expect(editorSeed(outcome.state, outcome.openEditor!)).toBe("");
  });

  it("the typed forms also open the editor on the new box (STATUS: every newly-created text object)", () => {
    const outcome = submitLine(opened(), 'text x=5 y=6 "hi"', VIEWPORT);
    const created = objectNamed(outcome.state, "text_1");
    expect(getSlot(created, ["content"])).toEqual({ kind: "literal", value: "hi" });
    expect(outcome.openEditor).toEqual({ kind: "text", objectId: created.id });
  });

  it("a non-text creation never asks for an editor", () => {
    expect(submitLine(opened(), "circle x=0 y=0 r=5", VIEWPORT).openEditor).toBeUndefined();
    expect(submitLine(opened(), "table x=0 y=0", VIEWPORT).openEditor).toBeUndefined();
  });

  it("a refused text creation asks for no editor", () => {
    // `text` needs content in the typed form; the bare positional is missing.
    const outcome = submitLine(opened(), "text x=0 y=0", VIEWPORT);
    expect(outcome.refused).toBe(true);
    expect(outcome.openEditor).toBeUndefined();
  });
});
