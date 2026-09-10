/**
 * interaction.test.ts
 *
 * Drag, select and resize. It covers the per component rule that keeps a
 * bound axis fixed.
 */
import { describe, expect, it } from "vitest";
import {
  type CameraState,
  type EvalContext,
  getObjectSchema,
  getSlot,
  type GraphObject,
  mutate,
  type MutationJournalEntry,
  resolveDerivedSlots,
  type Slot,
} from "../engine/index.ts";
import { deselect, focusPathPart, INITIAL_INTERACTION_STATE, pathGripUnder, pointerDown, pointerMove, pointerUp, type InteractionState } from "./interaction.ts";

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };

function derivedPlaceholders(type: "circle" | "polygon" | "rect"): Record<string, { readonly kind: "derived"; readonly value: null }> {
  const schema = getObjectSchema(type);
  if (schema === undefined) {
    throw new Error(`test setup: expected a schema for ${type}`);
  }
  const placeholders: Record<string, { readonly kind: "derived"; readonly value: null }> = {};
  const stub: GraphObject = { id: "stub", name: "stub", type, slots: {} };
  for (const slot of resolveDerivedSlots(stub, schema.derivedSlots)) {
    placeholders[slot.path.join(".")] = { kind: "derived", value: null };
  }
  return placeholders;
}

function rectObject(originX: number, originY: number): GraphObject {
  return {
    id: "obj_1",
    name: "rect_1",
    type: "rect",
    slots: {
      "origin.x": { kind: "literal", value: originX },
      "origin.y": { kind: "literal", value: originY },
      width: { kind: "literal", value: 20 },
      height: { kind: "literal", value: 20 },
      ...derivedPlaceholders("rect"),
    },
  };
}

/**
 * A path with no origin slot. Its corners sit at (0,0), (100,0) and (100,100),
 * so the first edge runs along y of 0 and the second along x of 100.
 */
function polylineObject(closed = false, overrides: Record<string, Slot> = {}): GraphObject {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  const slots: Record<string, Slot> = { closed: { kind: "literal", value: closed } };
  points.forEach((point, index) => {
    slots[`vertex.${index}.x`] = { kind: "literal", value: point.x };
    slots[`vertex.${index}.y`] = { kind: "literal", value: point.y };
    slots[`vertex.${index}.bulge`] = { kind: "literal", value: 0 };
  });
  const stub: GraphObject = { id: "obj_1", name: "polyline_1", type: "polyline", vertexCount: points.length, slots };
  for (const slot of resolveDerivedSlots(stub, getObjectSchema("polyline")?.derivedSlots ?? [])) {
    slots[slot.path.join(".")] = { kind: "derived", value: null };
  }
  return { ...stub, slots: { ...slots, ...overrides } };
}

function vertexAt(objects: readonly GraphObject[], index: number): { readonly x: unknown; readonly y: unknown } {
  return { x: slotValue(objects, "obj_1", `vertex.${index}.x`), y: slotValue(objects, "obj_1", `vertex.${index}.y`) };
}

function commit(objects: readonly GraphObject[]): { objects: readonly GraphObject[]; journal: readonly MutationJournalEntry[] } {
  const result = mutate(
    [],
    objects.map((object) => ({ kind: "createObject" as const, object })),
    [],
  );
  if (!result.ok) {
    throw new Error(`test setup: expected creation to succeed, got: ${result.message}`);
  }
  return { objects: result.objects, journal: result.journal };
}

function slotValue(objects: readonly GraphObject[], objectId: string, key: string): unknown {
  return objects.find((object) => object.id === objectId)?.slots[key]?.value;
}

function tableObject(cols: number, values: readonly number[]): GraphObject {
  const cells: Record<string, { readonly kind: "literal"; readonly value: number }> = {};
  values.forEach((value, index) => {
    cells[`cells.${String.fromCharCode(65 + index)}1`] = { kind: "literal", value };
  });
  return {
    id: "obj_2",
    name: "table_x",
    type: "table",
    slots: { rows: { kind: "literal", value: 1 }, cols: { kind: "literal", value: cols }, ...cells },
  };
}

function dragFromOrigin(objectId: string): InteractionState {
  return { selectedObjectIds: [objectId], drag: { objectId, lastWorldPoint: { x: 0, y: 0 }, emittedNotices: [], vertices: undefined }, resize: undefined, bend: undefined, focus: undefined };
}

describe("pointerDown — click to select, over a list of objects", () => {
  it("selects the object under the pointer and arms a drag from that world point", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    expect(state.selectedObjectIds).toEqual(["obj_1"]);
    expect(state.drag).toEqual({ objectId: "obj_1", lastWorldPoint: { x: 10, y: 0 }, emittedNotices: [] });
  });

  it("holds the object's id, not the GraphObject the hit test returned", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    expect(Object.keys(state.drag ?? {}).sort()).toEqual(["emittedNotices", "lastWorldPoint", "objectId", "vertices"]);
    expect(state.drag?.objectId).toBe(objects[0]?.id);
  });

  it("selects nothing and arms nothing when the pointer lands on empty canvas", () => {
    const { objects } = commit([rectObject(0, 0)]);
    expect(pointerDown(INITIAL_INTERACTION_STATE, { x: 500, y: 500 }, objects, CAMERA_IDENTITY)).toEqual(INITIAL_INTERACTION_STATE);
  });

  it("replaces a prior selection with whatever is under the pointer, empty canvas included", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const selected = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    expect(selected.selectedObjectIds).toEqual(["obj_1"]);
    expect(pointerDown(selected, { x: 500, y: 500 }, objects, CAMERA_IDENTITY).selectedObjectIds).toEqual([]);
  });

  it("a shift-click ADDS the object hit to the selection", () => {
    const rectB: GraphObject = { ...rectObject(30, 0), id: "obj_3", name: "rect_2" };
    const { objects } = commit([rectObject(0, 0), rectB]);
    const first = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const second = pointerDown(first, { x: 40, y: 0 }, objects, CAMERA_IDENTITY, true);
    expect(second.selectedObjectIds).toEqual(["obj_1", "obj_3"]);
  });

  it("a shift-click on an ALREADY-SELECTED object REMOVES it — the conventional toggle", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const first = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const toggled = pointerDown(first, { x: 10, y: 0 }, objects, CAMERA_IDENTITY, true);
    expect(toggled.selectedObjectIds).toEqual([]);
  });

  it("a shift-click on empty canvas leaves the SELECTION alone — neither clears nor adds", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const selected = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const missed = pointerDown(selected, { x: 500, y: 500 }, objects, CAMERA_IDENTITY, true);
    expect(missed.selectedObjectIds).toEqual(selected.selectedObjectIds);
  });

  it("a shift-click on empty canvas still ENDS a drag armed before it", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const armed = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    expect(armed.drag?.objectId).toBe("obj_1");
    expect(pointerDown(armed, { x: 500, y: 500 }, objects, CAMERA_IDENTITY, true).drag).toBeUndefined();
  });

  it("a shift-click on empty canvas with no drag running returns the prior state itself", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const idle: InteractionState = { selectedObjectIds: ["obj_1"], drag: undefined, resize: undefined, bend: undefined, focus: undefined };
    expect(pointerDown(idle, { x: 500, y: 500 }, objects, CAMERA_IDENTITY, true)).toBe(idle);
  });

  it("arms a drag on the object under THIS press even when the shift-click just removed it from the selection", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const first = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const toggled = pointerDown(first, { x: 10, y: 0 }, objects, CAMERA_IDENTITY, true);
    expect(toggled.selectedObjectIds).toEqual([]);
    expect(toggled.drag?.objectId).toBe("obj_1");
  });
});

describe("pointerUp and deselect", () => {
  it("pointerUp ends the drag and keeps the selection, because a select and a move are separate", () => {
    const state = pointerUp(dragFromOrigin("obj_1"));
    expect(state.selectedObjectIds).toEqual(["obj_1"]);
    expect(state.drag).toBeUndefined();
  });

  it("pointerUp returns the same state untouched when no drag is running", () => {
    const idle: InteractionState = { selectedObjectIds: ["obj_1"], drag: undefined, resize: undefined, bend: undefined, focus: undefined };
    expect(pointerUp(idle)).toBe(idle);
  });

  it("pointerUp keeps a MULTI-object selection untouched, ending only the drag", () => {
    const state: InteractionState = { selectedObjectIds: ["obj_1", "obj_2"], drag: { objectId: "obj_1", lastWorldPoint: { x: 0, y: 0 }, emittedNotices: [], vertices: undefined }, resize: undefined, bend: undefined, focus: undefined };
    expect(pointerUp(state)).toEqual({ selectedObjectIds: ["obj_1", "obj_2"], drag: undefined, resize: undefined, bend: undefined, focus: undefined });
  });

  it("deselect clears the selection AND a drag in progress, so no gesture survives Escape", () => {
    expect(deselect()).toEqual(INITIAL_INTERACTION_STATE);
  });
});

describe("pointerMove — a drag calls the mutation API", () => {
  it("moves a literal origin by the world delta and re-evaluates the derived slots that read it", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);

    const moved = pointerMove(state, { x: 13, y: 7 }, objects, journal, CAMERA_IDENTITY);

    expect(moved.rejection).toBeUndefined();
    expect(slotValue(moved.objects, "obj_1", "origin.x")).toBe(3);
    expect(slotValue(moved.objects, "obj_1", "origin.y")).toBe(7);
    expect(slotValue(moved.objects, "obj_1", "vertices")).toEqual([
      { x: 3, y: 7 },
      { x: 23, y: 7 },
      { x: 23, y: 27 },
      { x: 3, y: 27 },
    ]);
    expect(slotValue(moved.objects, "obj_1", "centroid.x")).toBeCloseTo(13);
  });

  it("journals exactly one entry per committed drag step (Rule 2's append-only journal)", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(state, { x: 13, y: 7 }, objects, journal, CAMERA_IDENTITY);
    expect(moved.journal.length).toBe(journal.length + 1);
    expect(moved.journal[moved.journal.length - 1]?.operations.length).toBe(2);
  });

  it("converts the screen delta into world units at the current zoom", () => {
    const zoomed: CameraState = { x: 0, y: 0, zoom: 2 };
    const { objects, journal } = commit([rectObject(0, 0)]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, zoomed);
    const moved = pointerMove(state, { x: 40, y: 20 }, objects, journal, zoomed);
    expect(slotValue(moved.objects, "obj_1", "origin.x")).toBe(10);
    expect(slotValue(moved.objects, "obj_1", "origin.y")).toBe(10);
  });

  it("keeps moving the right object across steps, because the drag holds an id and not a stale snapshot", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const first = pointerMove(pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY), { x: 13, y: 0 }, objects, journal, CAMERA_IDENTITY);
    const second = pointerMove(first.state, { x: 17, y: 0 }, first.objects, first.journal, CAMERA_IDENTITY);
    expect(slotValue(second.objects, "obj_1", "origin.x")).toBe(7);
  });

  it("is a no-op with no drag in progress, so a caller may wire it to every pointer move", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const idle: InteractionState = { selectedObjectIds: ["obj_1"], drag: undefined, resize: undefined, bend: undefined, focus: undefined };
    const outcome = pointerMove(idle, { x: 99, y: 99 }, objects, journal, CAMERA_IDENTITY);
    expect(outcome.state).toBe(idle);
    expect(outcome.objects).toBe(objects);
    expect(outcome.journal).toBe(journal);
    expect(outcome.notices).toEqual([]);
  });

  it("does not mutate when the pointer has not moved in world space — no journal entry for a step that moved nothing", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const outcome = pointerMove(state, { x: 10, y: 0 }, objects, journal, CAMERA_IDENTITY);
    expect(outcome.journal).toBe(journal);
    expect(outcome.objects).toBe(objects);
    expect(outcome.rejection).toBeUndefined();
  });

  it("writes only the component that actually changed when the pointer moves along one axis", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(state, { x: 15, y: 0 }, objects, journal, CAMERA_IDENTITY);
    expect(moved.journal[moved.journal.length - 1]?.operations.length).toBe(1);
    expect(slotValue(moved.objects, "obj_1", "origin.x")).toBe(5);
  });
});

describe("a drag works per component, never all or nothing", () => {
  it("slides in Y only when origin.x is driven, and the notice names what drives it", () => {
    const rect: GraphObject = {
      ...rectObject(0, 0),
      slots: {
        ...rectObject(0, 0).slots,
        "origin.x": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "A1"] } }, value: 10 },
      },
    };
    const { objects, journal } = commit([tableObject(1, [10]), rect]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);
    expect(state.selectedObjectIds).toEqual(["obj_1"]);

    const moved = pointerMove(state, { x: 25, y: 5 }, objects, journal, CAMERA_IDENTITY);

    expect(moved.rejection).toBeUndefined();
    expect(slotValue(moved.objects, "obj_1", "origin.x")).toBe(10);
    expect(slotValue(moved.objects, "obj_1", "origin.y")).toBe(5);
    expect(moved.notices).toHaveLength(1);
    expect(moved.notices[0]).toContain("rect_1.origin.x");
    expect(moved.notices[0]).toContain("table_x.A1");
  });

  it("does nothing at all when EVERY component is driven, and reports both", () => {
    const bothDriven: GraphObject = {
      ...rectObject(0, 0),
      slots: {
        ...rectObject(0, 0).slots,
        "origin.x": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "A1"] } }, value: 10 },
        "origin.y": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "B1"] } }, value: 0 },
      },
    };
    const { objects, journal } = commit([tableObject(2, [10, 0]), bothDriven]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);

    const moved = pointerMove(state, { x: 25, y: 5 }, objects, journal, CAMERA_IDENTITY);

    expect(moved.objects).toBe(objects);
    expect(moved.journal).toBe(journal);
    expect(moved.rejection).toBeUndefined();
    expect(moved.notices).toHaveLength(2);
    expect(moved.state.drag?.lastWorldPoint).toEqual({ x: 25, y: 5 });
  });

  it("names EVERY slot a branching formula could read, because extractDependencies is eager and total", () => {
    const branching: GraphObject = {
      ...rectObject(0, 0),
      slots: {
        ...rectObject(0, 0).slots,
        "origin.x": {
          kind: "formula",
          ast: {
            type: "functionCall",
            name: "IF",
            args: [
              { type: "reference", address: { objectId: "obj_2", path: ["cells", "A1"] } },
              { type: "reference", address: { objectId: "obj_2", path: ["cells", "B1"] } },
              { type: "reference", address: { objectId: "obj_2", path: ["cells", "C1"] } },
            ],
          },
          value: 0,
        },
      },
    };
    const { objects, journal } = commit([tableObject(3, [1, 2, 3]), branching]);
    const outcome = pointerMove(dragFromOrigin("obj_1"), { x: 5, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(outcome.notices).toHaveLength(1);
    expect(outcome.notices[0]).toContain("table_x.A1");
    expect(outcome.notices[0]).toContain("table_x.B1");
    expect(outcome.notices[0]).toContain("table_x.C1");
  });

  it("names a derived component as never writable rather than trying to move it", () => {
    const derivedOrigin: GraphObject = {
      id: "obj_1",
      name: "unbuilt_1",
      type: "unbuilt" as GraphObject["type"],
      slots: { "origin.x": { kind: "derived", value: 4 }, "origin.y": { kind: "literal", value: 0 } },
    };
    const { objects, journal } = commit([derivedOrigin]);
    const outcome = pointerMove(dragFromOrigin("obj_1"), { x: 5, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(outcome.rejection).toBeUndefined();
    expect(outcome.notices).toHaveLength(1);
    expect(outcome.notices[0]).toContain("derived slot");
    expect(slotValue(outcome.objects, "obj_1", "origin.y")).toBe(5);
  });

  it("does not move a literal component that does not hold a number", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const typed = mutate(
      objects,
      [{ kind: "setSlot", address: { objectId: "obj_1", path: ["origin", "x"] }, slot: { kind: "literal", value: "not a number" } }],
      journal,
    );
    if (!typed.ok) {
      throw new Error(`test setup: expected the string write to succeed, got: ${typed.message}`);
    }
    const outcome = pointerMove(dragFromOrigin("obj_1"), { x: 5, y: 5 }, typed.objects, typed.journal, CAMERA_IDENTITY);
    expect(outcome.notices).toHaveLength(1);
    expect(outcome.notices[0]).toContain("does not hold a number");
    expect(slotValue(outcome.objects, "obj_1", "origin.x")).toBe("not a number");
    expect(slotValue(outcome.objects, "obj_1", "origin.y")).toBe(5);
  });

  it("reports an object with no origin and no vertices as undraggable rather than swallowing the gesture", () => {
    const { objects, journal } = commit([tableObject(1, [10])]);
    // A press over such an object picks an empty vertex list, which is what
    // everyVertexOfPath gives when the object has no origin and no vertices.
    const state: InteractionState = {
      selectedObjectIds: ["obj_2"],
      drag: { objectId: "obj_2", lastWorldPoint: { x: 0, y: 0 }, emittedNotices: [], vertices: [] },
      resize: undefined, bend: undefined, focus: undefined,
    };
    const outcome = pointerMove(state, { x: 5, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(outcome.objects).toBe(objects);
    expect(outcome.journal).toBe(journal);
    expect(outcome.notices).toEqual(["table_x has no origin and no vertices, so a drag has nothing to move"]);
  });
});

describe("a path drags by its vertices, because it has no origin", () => {
  it("moves every vertex by the delta on a plain drag", () => {
    const { objects, journal } = commit([polylineObject()]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 50, y: 0 }, objects, CAMERA_IDENTITY);
    const outcome = pointerMove(state, { x: 57, y: 3 }, objects, journal, CAMERA_IDENTITY);
    expect(outcome.notices).toEqual([]);
    expect(vertexAt(outcome.objects, 0)).toEqual({ x: 7, y: 3 });
    expect(vertexAt(outcome.objects, 1)).toEqual({ x: 107, y: 3 });
    expect(vertexAt(outcome.objects, 2)).toEqual({ x: 107, y: 103 });
  });

  it("leaves a vertex a formula drives where it is, and moves the rest — the road holds its intersection", () => {
    const anchor: GraphObject = { id: "obj_2", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 0 } } };
    const bound = polylineObject(false, {
      "vertex.0.x": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["value"] } }, value: 0 },
    });
    const { objects, journal } = commit([anchor, bound]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 50, y: 0 }, objects, CAMERA_IDENTITY);
    const outcome = pointerMove(state, { x: 57, y: 3 }, objects, journal, CAMERA_IDENTITY);
    expect(vertexAt(outcome.objects, 0)).toEqual({ x: 0, y: 3 });
    expect(vertexAt(outcome.objects, 1)).toEqual({ x: 107, y: 3 });
    expect(outcome.notices.join(" ")).toContain("did not move");
  });
});

describe("a shift drag on a path moves only the segment it grabbed", () => {
  it("moves the two vertices of the edge under the pointer, and no others", () => {
    const { objects, journal } = commit([polylineObject()]);
    // The point sits on edge 1, which runs from vertex 1 to vertex 2.
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 100, y: 50 }, objects, CAMERA_IDENTITY, true);
    expect(state.drag?.vertices).toEqual([1, 2]);
    const outcome = pointerMove(state, { x: 110, y: 50 }, objects, journal, CAMERA_IDENTITY);
    expect(vertexAt(outcome.objects, 0)).toEqual({ x: 0, y: 0 });
    expect(vertexAt(outcome.objects, 1)).toEqual({ x: 110, y: 0 });
    expect(vertexAt(outcome.objects, 2)).toEqual({ x: 110, y: 100 });
  });

  it("wraps at the edge that closes a path, pairing the last vertex with the first", () => {
    const { objects } = commit([polylineObject(true)]);
    // The edge home to vertex 0 leaves vertex 2 and passes through (50,50).
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 50, y: 50 }, objects, CAMERA_IDENTITY, true);
    expect(state.drag?.vertices).toEqual([2, 0]);
  });

  it("picks its vertices once, so a pointer that wanders over another edge still moves the first pair", () => {
    const { objects, journal } = commit([polylineObject()]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 50, y: 0 }, objects, CAMERA_IDENTITY, true);
    expect(state.drag?.vertices).toEqual([0, 1]);
    const wandered = pointerMove(state, { x: 100, y: 50 }, objects, journal, CAMERA_IDENTITY);
    expect(wandered.state.drag?.vertices).toEqual([0, 1]);
    expect(vertexAt(wandered.objects, 2)).toEqual({ x: 100, y: 100 });
  });

  it("selects the path outright, rather than take it out of a selection it is already in", () => {
    const { objects } = commit([polylineObject()]);
    const selected: InteractionState = { selectedObjectIds: ["obj_1"], drag: undefined, resize: undefined, bend: undefined, focus: undefined };
    const state = pointerDown(selected, { x: 50, y: 0 }, objects, CAMERA_IDENTITY, true);
    expect(state.selectedObjectIds).toEqual(["obj_1"]);
    expect(state.drag?.vertices).toEqual([0, 1]);
  });

  it("keeps its usual meaning over a shape with an origin, which adds to the selection and drags whole", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY, true);
    expect(state.drag?.vertices).toBeUndefined();
    const outcome = pointerMove(state, { x: 15, y: 0 }, objects, journal, CAMERA_IDENTITY);
    expect(slotValue(outcome.objects, "obj_1", "origin.x")).toBe(5);
  });

  it("falls back to the whole path when the press reaches no edge, as a click inside a fill does", () => {
    const filled = polylineObject(true, { "style.fillColor": { kind: "literal", value: "#00ff00" } });
    const { objects } = commit([filled]);
    // Well inside the triangle, and far from every edge.
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 90, y: 40 }, objects, CAMERA_IDENTITY, true);
    expect(state.drag?.vertices).toEqual([0, 1, 2]);
  });
});

describe("per-gesture notice dedup", () => {
  function xDrivenRect(): GraphObject {
    return {
      ...rectObject(0, 0),
      slots: {
        ...rectObject(0, 0).slots,
        "origin.x": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "A1"] } }, value: 10 },
      },
    };
  }

  it("emits a repeated notice only ONCE per gesture, not once per pointerMove sample", () => {
    const { objects, journal } = commit([tableObject(1, [10]), xDrivenRect()]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);

    const first = pointerMove(state, { x: 25, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(first.notices).toHaveLength(1);
    expect(first.notices[0]).toContain("table_x.A1");

    const second = pointerMove(first.state, { x: 26, y: 9 }, first.objects, first.journal, CAMERA_IDENTITY);
    expect(second.notices).toEqual([]);
    expect(slotValue(second.objects, "obj_1", "origin.x")).toBe(10);
    expect(slotValue(second.objects, "obj_1", "origin.y")).toBe(9);

    const third = pointerMove(second.state, { x: 27, y: 11 }, second.objects, second.journal, CAMERA_IDENTITY);
    expect(third.notices).toEqual([]);
  });

  it("a DIFFERENT notice text within the same gesture still emits — dedup is per TEXT, not a blanket silence", () => {
    const { objects, journal } = commit([tableObject(2, [10, 20]), xDrivenRect()]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);
    const afterFirst = pointerMove(state, { x: 25, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(afterFirst.notices).toHaveLength(1);
    expect(afterFirst.notices[0]).toContain("table_x.A1");

    const relinked = mutate(
      afterFirst.objects,
      [
        {
          kind: "setSlot",
          address: { objectId: "obj_1", path: ["origin", "x"] },
          slot: { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "B1"] } }, value: 20 },
        },
      ],
      afterFirst.journal,
    );
    if (!relinked.ok) {
      throw new Error(`test setup: expected the relink to succeed, got: ${relinked.message}`);
    }

    const afterRelink = pointerMove(afterFirst.state, { x: 26, y: 6 }, relinked.objects, relinked.journal, CAMERA_IDENTITY);
    expect(afterRelink.notices).toHaveLength(1);
    expect(afterRelink.notices[0]).toContain("table_x.B1");

    const again = pointerMove(afterRelink.state, { x: 27, y: 7 }, afterRelink.objects, afterRelink.journal, CAMERA_IDENTITY);
    expect(again.notices).toEqual([]);
  });

  it("re-emits the same notice on a NEW gesture — pointerUp/pointerDown resets the per-gesture set", () => {
    const { objects, journal } = commit([tableObject(1, [10]), xDrivenRect()]);
    const firstGesture = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(firstGesture, { x: 25, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(moved.notices).toHaveLength(1);

    const released = pointerUp(moved.state);
    expect(released.drag).toBeUndefined();

    const secondGesture = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 5 }, moved.objects, CAMERA_IDENTITY);
    expect(secondGesture.drag?.emittedNotices).toEqual([]);

    const movedAgain = pointerMove(secondGesture, { x: 25, y: 9 }, moved.objects, moved.journal, CAMERA_IDENTITY);
    expect(movedAgain.notices).toHaveLength(1);
    expect(movedAgain.notices[0]).toContain("table_x.A1");
  });
});

describe("pointerMove — failure paths", () => {
  it("a rejected mutation returns the caller's own objects, journal and state, and the pending delta survives to the next move", () => {
    const { objects, journal } = commit([rectObject(1e308, 0)]);
    const state = dragFromOrigin("obj_1");

    const rejected = pointerMove(state, { x: 1e308, y: 7 }, objects, journal, CAMERA_IDENTITY);
    expect(rejected.rejection).toBeTypeOf("string");
    expect(rejected.objects).toBe(objects);
    expect(rejected.journal).toBe(journal);
    expect(rejected.state).toBe(state);

    const retried = pointerMove(rejected.state, { x: 0, y: 7 }, rejected.objects, rejected.journal, CAMERA_IDENTITY);
    expect(retried.rejection).toBeUndefined();
    expect(slotValue(retried.objects, "obj_1", "origin.y")).toBe(7);
    expect(slotValue(retried.objects, "obj_1", "origin.x")).toBe(1e308);
  });

  it("ends the drag when the object being dragged no longer exists", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const outcome = pointerMove(dragFromOrigin("obj_404"), { x: 5, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(outcome.state.drag).toBeUndefined();
    expect(outcome.objects).toBe(objects);
    expect(outcome.notices[0]).toContain(`id "obj_404"`);
  });

  it("never throws on a drag over an object whose slots are missing or error-valued", () => {
    const broken: GraphObject = {
      id: "obj_1",
      name: "rect_1",
      type: "rect",
      slots: { "origin.x": { kind: "literal", value: { error: "#REF", message: "gone" } } },
    };
    expect(() => pointerMove(dragFromOrigin("obj_1"), { x: 5, y: 5 }, [broken], [], CAMERA_IDENTITY)).not.toThrow();
    const outcome = pointerMove(dragFromOrigin("obj_1"), { x: 5, y: 5 }, [broken], [], CAMERA_IDENTITY);
    expect(outcome.notices).toHaveLength(2);
  });
});

describe("pointerMove forwards the EvalContext to mutate", () => {

  function textObject(): GraphObject {
    return {
      id: "obj_t",
      name: "text_1",
      type: "text",
      slots: {
        content: { kind: "literal", value: "label" },
        width: { kind: "literal", value: "auto" },
        "origin.x": { kind: "literal", value: 500 },
        "origin.y": { kind: "literal", value: 500 },
        "style.font": { kind: "literal", value: "sans" },
        "style.fontSize": { kind: "literal", value: 12 },
        "style.lineHeight": { kind: "literal", value: 14 },
        resolvedContent: { kind: "derived", value: null },
        measuredHeight: { kind: "derived", value: null },
        measuredWidth: { kind: "derived", value: null },
      },
    };
  }

  const realMeasurer: EvalContext = { measurer: { measure: () => ({ width: 1, height: 33 }) } };

  it("re-evaluates a co-resident text object's measuredHeight against the threaded measurer — #MEASURE without one", () => {
    const { objects, journal } = commit([rectObject(0, 0), textObject()]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);

    const withoutContext = pointerMove(state, { x: 13, y: 7 }, objects, journal, CAMERA_IDENTITY);
    expect(slotValue(withoutContext.objects, "obj_t", "measuredHeight")).toMatchObject({ error: "#MEASURE" });

    const withContext = pointerMove(state, { x: 13, y: 7 }, objects, journal, CAMERA_IDENTITY, realMeasurer);
    expect(withContext.rejection).toBeUndefined();
    expect(slotValue(withContext.objects, "obj_t", "measuredHeight")).toBe(33);
    expect(slotValue(withContext.objects, "obj_1", "origin.x")).toBe(3);
  });
});

describe("resize — a text box's eight grabbers (2026-09-02)", () => {
  function sizedTextObject(extra: Record<string, GraphObject["slots"][string]> = {}): GraphObject {
    return {
      id: "obj_t",
      name: "text_1",
      type: "text",
      slots: {
        content: { kind: "literal", value: "label" },
        width: { kind: "literal", value: "auto" },
        height: { kind: "literal", value: "auto" },
        autoresize: { kind: "literal", value: true },
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        "style.font": { kind: "literal", value: "sans" },
        "style.fontSize": { kind: "literal", value: 12 },
        "style.lineHeight": { kind: "literal", value: 14 },
        resolvedContent: { kind: "derived", value: null },
        measuredHeight: { kind: "derived", value: null },
        measuredWidth: { kind: "derived", value: null },
        ...extra,
      },
    };
  }

  function measuring(width: number, height: number): EvalContext {
    return { measurer: { measure: () => ({ width, height }) } };
  }

  const MEASURER = measuring(200, 40);

  function selectedBox(): { state: InteractionState; objects: readonly GraphObject[]; journal: readonly MutationJournalEntry[] } {
    const created = mutate([], [{ kind: "createObject", object: sizedTextObject() }], [], MEASURER);
    if (!created.ok) {
      throw new Error(`test setup: ${created.message}`);
    }
    return {
      state: { selectedObjectIds: ["obj_t"], drag: undefined, resize: undefined, bend: undefined, focus: undefined },
      objects: created.objects,
      journal: created.journal,
    };
  }

  function boundBox(): { state: InteractionState; objects: readonly GraphObject[]; journal: readonly MutationJournalEntry[] } {
    const bound = sizedTextObject({
      "origin.x": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "A1"] } }, value: 0 },
    });
    const created = mutate(
      [],
      [
        { kind: "createObject", object: tableObject(1, [0]) },
        { kind: "createObject", object: bound },
      ],
      [],
      MEASURER,
    );
    if (!created.ok) {
      throw new Error(`test setup: ${created.message}`);
    }
    return {
      state: { selectedObjectIds: ["obj_t"], drag: undefined, resize: undefined, bend: undefined, focus: undefined },
      objects: created.objects,
      journal: created.journal,
    };
  }

  it("a press on a grabber arms a resize, NOT a drag — a corner overhangs the body and must not move the box", () => {
    const { state, objects } = selectedBox();
    const pressed = pointerDown(state, { x: 200, y: 40 }, objects, CAMERA_IDENTITY);
    expect(pressed.resize).toMatchObject({ objectId: "obj_t", handle: "se" });
    expect(pressed.drag).toBeUndefined();
  });

  it("a press inside the box still selects and drags, so resizing never steals an ordinary gesture", () => {
    const { state, objects } = selectedBox();
    const pressed = pointerDown(state, { x: 100, y: 20 }, objects, CAMERA_IDENTITY);
    expect(pressed.resize).toBeUndefined();
    expect(pressed.drag).toMatchObject({ objectId: "obj_t" });
  });

  it("grabbers exist only on a SELECTED object, so a first click on an unselected box selects it instead of resizing", () => {
    const { objects } = selectedBox();
    const pressed = pointerDown(INITIAL_INTERACTION_STATE, { x: 200, y: 40 }, objects, CAMERA_IDENTITY);
    expect(pressed.resize).toBeUndefined();
    expect(pressed.selectedObjectIds).toEqual(["obj_t"]);
  });

  it("dragging the SE corner writes width and height, and turns autoresize OFF so the dragged height survives", () => {
    const { state, objects, journal } = selectedBox();
    const pressed = pointerDown(state, { x: 200, y: 40 }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(pressed, { x: 260, y: 90 }, objects, journal, CAMERA_IDENTITY, MEASURER);
    expect(moved.rejection).toBeUndefined();
    expect(slotValue(moved.objects, "obj_t", "width")).toBe(260);
    expect(slotValue(moved.objects, "obj_t", "height")).toBe(90);
    expect(slotValue(moved.objects, "obj_t", "autoresize")).toBe(false);
  });

  it("dragging the E edge writes ONLY the width, and leaves autoresize alone — a set width never shrinks anyway", () => {
    const { state, objects, journal } = selectedBox();
    const pressed = pointerDown(state, { x: 200, y: 20 }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(pressed, { x: 300, y: 20 }, objects, journal, CAMERA_IDENTITY, MEASURER);
    expect(slotValue(moved.objects, "obj_t", "width")).toBe(300);
    expect(slotValue(moved.objects, "obj_t", "height")).toBe("auto");
    expect(slotValue(moved.objects, "obj_t", "autoresize")).toBe(true);
  });

  it("dragging the NW corner moves the ORIGIN as well as the size — a left/top edge is the box's anchor", () => {
    const { state, objects, journal } = selectedBox();
    const pressed = pointerDown(state, { x: 0, y: 0 }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(pressed, { x: -30, y: -10 }, objects, journal, CAMERA_IDENTITY, MEASURER);
    expect(slotValue(moved.objects, "obj_t", "origin.x")).toBe(-30);
    expect(slotValue(moved.objects, "obj_t", "origin.y")).toBe(-10);
    expect(slotValue(moved.objects, "obj_t", "width")).toBe(230);
    expect(slotValue(moved.objects, "obj_t", "height")).toBe(50);
  });

  it("is ABSOLUTE, not incremental: a second step to the same point asks for the same box, so the gesture cannot run away from the pointer", () => {
    const { state, objects, journal } = selectedBox();
    const pressed = pointerDown(state, { x: 200, y: 40 }, objects, CAMERA_IDENTITY);
    const first = pointerMove(pressed, { x: 400, y: 40 }, objects, journal, CAMERA_IDENTITY, MEASURER);
    const second = pointerMove(first.state, { x: 400, y: 40 }, first.objects, first.journal, CAMERA_IDENTITY, MEASURER);
    expect(slotValue(second.objects, "obj_t", "width")).toBe(400);
  });

  it("skips a component whose slot is driven and says what drives it, under the per component rule", () => {
    const { state, objects, journal } = boundBox();
    const pressed = pointerDown(state, { x: 0, y: 0 }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(pressed, { x: -30, y: -10 }, objects, journal, CAMERA_IDENTITY, MEASURER);
    expect(moved.notices.join(" ")).toContain("text_1.origin.x");
    expect(slotValue(moved.objects, "obj_t", "origin.x")).toBe(0);
    expect(slotValue(moved.objects, "obj_t", "origin.y")).toBe(-10);
  });

  it("says the same thing only once across a gesture, like a drag's notices", () => {
    const { state, objects, journal } = boundBox();
    const pressed = pointerDown(state, { x: 0, y: 0 }, objects, CAMERA_IDENTITY);
    const first = pointerMove(pressed, { x: -30, y: -10 }, objects, journal, CAMERA_IDENTITY, MEASURER);
    const second = pointerMove(first.state, { x: -40, y: -20 }, first.objects, first.journal, CAMERA_IDENTITY, MEASURER);
    expect(first.notices).toHaveLength(1);
    expect(second.notices).toEqual([]);
  });

  it("ends the resize when its object is deleted mid-gesture, naming the id (there is no name left to resolve)", () => {
    const { state, objects, journal } = selectedBox();
    const pressed = pointerDown(state, { x: 200, y: 40 }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(pressed, { x: 260, y: 90 }, [], journal, CAMERA_IDENTITY);
    expect(moved.state.resize).toBeUndefined();
    expect(moved.notices.join(" ")).toContain("obj_t");
  });

  it("pointerUp ends a resize and keeps the selection", () => {
    const { state, objects } = selectedBox();
    const pressed = pointerDown(state, { x: 200, y: 40 }, objects, CAMERA_IDENTITY);
    const released = pointerUp(pressed);
    expect(released.resize).toBeUndefined();
    expect(released.selectedObjectIds).toEqual(["obj_t"]);
  });

  it("Escape clears a resize in progress, like every other gesture", () => {
    expect(deselect().resize).toBeUndefined();
  });
});

describe("resize — an image's grabbers write its own width/height slots", () => {
  function selectedImage(preserveAspect: boolean): { state: InteractionState; objects: readonly GraphObject[]; journal: readonly MutationJournalEntry[] } {
    const image: GraphObject = {
      id: "obj_i",
      name: "image_1",
      type: "image",
      slots: {
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        width: { kind: "literal", value: 200 },
        height: { kind: "literal", value: 100 },
        opacity: { kind: "literal", value: 1 },
        source: { kind: "literal", value: "" },
        preserveAspect: { kind: "literal", value: preserveAspect },
      },
    };
    const created = mutate([], [{ kind: "createObject", object: image }], []);
    if (!created.ok) {
      throw new Error(`test setup: ${created.message}`);
    }
    return {
      state: { selectedObjectIds: ["obj_i"], drag: undefined, resize: undefined, bend: undefined, focus: undefined },
      objects: created.objects,
      journal: created.journal,
    };
  }

  function afterDrag(preserveAspect: boolean, from: [number, number], to: [number, number]): { width: unknown; height: unknown } {
    const { state, objects, journal } = selectedImage(preserveAspect);
    const pressed = pointerDown(state, { x: from[0], y: from[1] }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(pressed, { x: to[0], y: to[1] }, objects, journal, CAMERA_IDENTITY);
    const image = moved.objects.find((candidate) => candidate.id === "obj_i");
    return { width: getSlot(image!, ["width"])?.value, height: getSlot(image!, ["height"])?.value };
  }

  it("arms a resize from a press on its corner, exactly as a text box does", () => {
    const { state, objects } = selectedImage(true);
    const pressed = pointerDown(state, { x: 200, y: 100 }, objects, CAMERA_IDENTITY);
    expect(pressed.resize).toMatchObject({ objectId: "obj_i", handle: "se" });
    expect(pressed.drag).toBeUndefined();
  });

  it("writes the IMAGE's own width/height slots, never the text ones", () => {
    expect(afterDrag(false, [200, 100], [300, 100])).toEqual({ width: 300, height: 100 });
  });

  it("distorts freely once `preserveAspect` is off — the human's note 3", () => {
    expect(afterDrag(false, [200, 100], [400, 120])).toEqual({ width: 400, height: 120 });
  });

  it("keeps the picture's proportions while `preserveAspect` is on, scaling BOTH sides from a corner", () => {
    expect(afterDrag(true, [200, 100], [300, 100])).toEqual({ width: 300, height: 150 });
  });

  it("scales BOTH sides from a SIDE grabber too, since keeping a ratio means the other side has to follow", () => {
    expect(afterDrag(true, [200, 50], [100, 50])).toEqual({ width: 100, height: 50 });
  });

  it("never writes `autoresize` on an image — that flag is a text box's, and an image has no text to shrink to", () => {
    const { state, objects, journal } = selectedImage(true);
    const pressed = pointerDown(state, { x: 200, y: 100 }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(pressed, { x: 300, y: 100 }, objects, journal, CAMERA_IDENTITY);
    const image = moved.objects.find((candidate) => candidate.id === "obj_i");
    expect(getSlot(image!, ["autoresize"])).toBeUndefined();
  });

  it("keeps the ratio when the slot is MISSING, so a document saved before it existed still resizes the way the default says", () => {
    const image: GraphObject = {
      id: "obj_i",
      name: "image_1",
      type: "image",
      slots: {
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        width: { kind: "literal", value: 200 },
        height: { kind: "literal", value: 100 },
        opacity: { kind: "literal", value: 1 },
        source: { kind: "literal", value: "" },
      },
    };
    const created = mutate([], [{ kind: "createObject", object: image }], []);
    if (!created.ok) {
      throw new Error(`test setup: ${created.message}`);
    }
    const state: InteractionState = { selectedObjectIds: ["obj_i"], drag: undefined, resize: undefined, bend: undefined, focus: undefined };
    const pressed = pointerDown(state, { x: 200, y: 100 }, created.objects, CAMERA_IDENTITY);
    const moved = pointerMove(pressed, { x: 300, y: 100 }, created.objects, created.journal, CAMERA_IDENTITY);
    const resized = moved.objects.find((candidate) => candidate.id === "obj_i");
    expect(getSlot(resized!, ["height"])?.value).toBe(150);
  });

  it("still applies the per component rule to a drag that keeps the ratio: a bound width refuses on its own and says what drives it", () => {
    const bound: GraphObject = {
      id: "obj_i",
      name: "image_1",
      type: "image",
      slots: {
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        width: { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "A1"] } }, value: 200 },
        height: { kind: "literal", value: 100 },
        opacity: { kind: "literal", value: 1 },
        source: { kind: "literal", value: "" },
        preserveAspect: { kind: "literal", value: true },
      },
    };
    const created = mutate([], [{ kind: "createObject", object: tableObject(1, [200]) }, { kind: "createObject", object: bound }], []);
    if (!created.ok) {
      throw new Error(`test setup: ${created.message}`);
    }
    const state: InteractionState = { selectedObjectIds: ["obj_i"], drag: undefined, resize: undefined, bend: undefined, focus: undefined };
    const pressed = pointerDown(state, { x: 200, y: 100 }, created.objects, CAMERA_IDENTITY);
    const moved = pointerMove(pressed, { x: 300, y: 100 }, created.objects, created.journal, CAMERA_IDENTITY);
    const resized = moved.objects.find((candidate) => candidate.id === "obj_i");
    expect(getSlot(resized!, ["height"])?.value).toBe(150);
    expect(getSlot(resized!, ["width"])?.kind).toBe("formula");
    expect(moved.notices.join(" ")).toContain("did not resize");
  });
});
describe("a selected path grows grips, and a grip names one part of it", () => {
  function selected(overrides: Record<string, Slot> = {}): {
    objects: readonly GraphObject[];
    journal: readonly MutationJournalEntry[];
    state: InteractionState;
  } {
    const { objects, journal } = commit([polylineObject(false, overrides)]);
    // Edge 1 runs straight from (100,0) to (100,100) in every fixture here, so
    // a press on it selects the path whatever shape edge 0 has.
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 100, y: 40 }, objects, CAMERA_IDENTITY);
    return { objects, journal, state };
  }

  it("takes no grip on the first press, because grips belong to a path already selected", () => {
    const first = pointerDown(INITIAL_INTERACTION_STATE, { x: 0, y: 0 }, commit([polylineObject()]).objects, CAMERA_IDENTITY);
    expect(first.focus).toBeUndefined();
    expect(first.drag?.vertices).toEqual([0, 1, 2]);
  });

  it("drags one vertex on a press over its grip, and leaves the others where they are", () => {
    const { objects, journal, state } = selected();
    const grabbed = pointerDown(state, { x: 100, y: 0 }, objects, CAMERA_IDENTITY);
    expect(grabbed.drag?.vertices).toEqual([1]);
    expect(grabbed.focus).toEqual({ objectId: "obj_1", grip: { kind: "vertex", index: 1 } });
    const outcome = pointerMove(grabbed, { x: 130, y: 40 }, objects, journal, CAMERA_IDENTITY);
    expect(vertexAt(outcome.objects, 0)).toEqual({ x: 0, y: 0 });
    expect(vertexAt(outcome.objects, 1)).toEqual({ x: 130, y: 40 });
    expect(vertexAt(outcome.objects, 2)).toEqual({ x: 100, y: 100 });
  });

  it("holds a vertex a formula drives, and says so, the way every other drag does", () => {
    const anchor: GraphObject = { id: "obj_2", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 0 } } };
    const bound = polylineObject(false, {
      "vertex.0.x": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["value"] } }, value: 0 },
    });
    const { objects, journal } = commit([anchor, bound]);
    let state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);
    state = pointerDown(state, { x: 0, y: 0 }, objects, CAMERA_IDENTITY);
    expect(state.drag?.vertices).toEqual([0]);
    const outcome = pointerMove(state, { x: 30, y: 30 }, objects, journal, CAMERA_IDENTITY);
    expect(vertexAt(outcome.objects, 0)).toEqual({ x: 0, y: 30 });
    expect(outcome.notices.join(" ")).toContain("did not move");
  });

  it("bends an edge on a press over its middle grip, and writes the bulge that puts it under the pointer", () => {
    const { objects, journal, state } = selected();
    const grabbed = pointerDown(state, { x: 50, y: 0 }, objects, CAMERA_IDENTITY);
    expect(grabbed.bend).toEqual({ objectId: "obj_1", index: 0, emittedNotices: [] });
    expect(grabbed.drag).toBeUndefined();
    const outcome = pointerMove(grabbed, { x: 50, y: -50 }, objects, journal, CAMERA_IDENTITY);
    expect(slotValue(outcome.objects, "obj_1", "vertex.0.bulge")).toBeCloseTo(1);
    expect(vertexAt(outcome.objects, 0)).toEqual({ x: 0, y: 0 });
    expect(vertexAt(outcome.objects, 1)).toEqual({ x: 100, y: 0 });
  });

  it("writes an absolute bulge, so a bend that wanders and comes back lands where the pointer is", () => {
    const { objects, journal, state } = selected();
    const grabbed = pointerDown(state, { x: 50, y: 0 }, objects, CAMERA_IDENTITY);
    const wandered = pointerMove(grabbed, { x: 50, y: -90 }, objects, journal, CAMERA_IDENTITY);
    const back = pointerMove(wandered.state, { x: 50, y: -50 }, wandered.objects, wandered.journal, CAMERA_IDENTITY);
    expect(slotValue(back.objects, "obj_1", "vertex.0.bulge")).toBeCloseTo(1);
  });

  it("straightens an edge again on a drag back to the chord", () => {
    const { objects, journal, state } = selected({ "vertex.0.bulge": { kind: "literal", value: 1 } });
    const grabbed = pointerDown(state, { x: 50, y: -50 }, objects, CAMERA_IDENTITY);
    expect(grabbed.bend?.index).toBe(0);
    const outcome = pointerMove(grabbed, { x: 50, y: 0 }, objects, journal, CAMERA_IDENTITY);
    expect(slotValue(outcome.objects, "obj_1", "vertex.0.bulge")).toBe(0);
  });

  it("holds a bulge a formula drives, and says so rather than write it", () => {
    const anchor: GraphObject = { id: "obj_2", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 0 } } };
    const bound = polylineObject(false, {
      "vertex.0.bulge": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["value"] } }, value: 0 },
    });
    const { objects, journal } = commit([anchor, bound]);
    let state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);
    state = pointerDown(state, { x: 50, y: 0 }, objects, CAMERA_IDENTITY);
    const outcome = pointerMove(state, { x: 50, y: -50 }, objects, journal, CAMERA_IDENTITY);
    expect(slotValue(outcome.objects, "obj_1", "vertex.0.bulge")).toBe(0);
    expect(outcome.notices.join(" ")).toContain("did not bend");
  });

  it("keeps shift on its old meaning, so a shift press at the same middle moves the segment", () => {
    const { objects, journal, state } = selected();
    const grabbed = pointerDown(state, { x: 50, y: 0 }, objects, CAMERA_IDENTITY, true);
    expect(grabbed.bend).toBeUndefined();
    expect(grabbed.drag?.vertices).toEqual([0, 1]);
    const outcome = pointerMove(grabbed, { x: 50, y: -50 }, objects, journal, CAMERA_IDENTITY);
    expect(slotValue(outcome.objects, "obj_1", "vertex.0.bulge")).toBe(0);
    expect(vertexAt(outcome.objects, 0)).toEqual({ x: 0, y: -50 });
  });

  it("drops the part again on a press over the body of the path", () => {
    const { objects, state } = selected();
    const grabbed = pointerDown(state, { x: 100, y: 0 }, objects, CAMERA_IDENTITY);
    expect(grabbed.focus).toBeDefined();
    expect(pointerDown(grabbed, { x: 20, y: 0 }, objects, CAMERA_IDENTITY).focus).toBeUndefined();
  });

  it("drops the part when the selection moves to another object", () => {
    const { objects } = commit([polylineObject(), { ...rectObject(400, 400), id: "obj_9", name: "rect_9" }]);
    let state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);
    state = pointerDown(state, { x: 100, y: 0 }, objects, CAMERA_IDENTITY);
    expect(state.focus).toBeDefined();
    expect(pointerDown(state, { x: 410, y: 410 }, objects, CAMERA_IDENTITY).focus).toBeUndefined();
  });

  it("keeps the part through the drag it started, so the panel does not flicker under the pointer", () => {
    const { objects, journal, state } = selected();
    const grabbed = pointerDown(state, { x: 100, y: 0 }, objects, CAMERA_IDENTITY);
    const outcome = pointerMove(grabbed, { x: 130, y: 40 }, objects, journal, CAMERA_IDENTITY);
    expect(outcome.state.focus).toEqual({ objectId: "obj_1", grip: { kind: "vertex", index: 1 } });
    expect(pointerUp(outcome.state).focus).toEqual({ objectId: "obj_1", grip: { kind: "vertex", index: 1 } });
  });

  it("reports the grip under the pointer, which is what a cursor reads", () => {
    const { objects, state } = selected();
    expect(pathGripUnder(state, { x: 100, y: 0 }, objects, CAMERA_IDENTITY)).toEqual({ kind: "vertex", index: 1 });
    expect(pathGripUnder(state, { x: 50, y: 0 }, objects, CAMERA_IDENTITY)).toEqual({ kind: "edge", index: 0 });
    expect(pathGripUnder(state, { x: 20, y: 0 }, objects, CAMERA_IDENTITY)).toBeUndefined();
  });
});

describe("focusPathPart, the way a click on a panel row picks a part", () => {
  it("focuses a part and selects its object", () => {
    const state = focusPathPart(INITIAL_INTERACTION_STATE, "obj_1", { kind: "vertex", index: 2 });
    expect(state.focus).toEqual({ objectId: "obj_1", grip: { kind: "vertex", index: 2 } });
    expect(state.selectedObjectIds).toEqual(["obj_1"]);
  });

  it("drops the part on a second click of the same row, so one gesture opens and closes it", () => {
    const opened = focusPathPart(INITIAL_INTERACTION_STATE, "obj_1", { kind: "edge", index: 1 });
    expect(focusPathPart(opened, "obj_1", { kind: "edge", index: 1 }).focus).toBeUndefined();
  });

  it("moves the part to the row just clicked", () => {
    const opened = focusPathPart(INITIAL_INTERACTION_STATE, "obj_1", { kind: "vertex", index: 0 });
    expect(focusPathPart(opened, "obj_1", { kind: "vertex", index: 1 }).focus?.grip).toEqual({ kind: "vertex", index: 1 });
  });

  it("keeps a selection that already holds the object, so it never drops the rest of one", () => {
    const many: InteractionState = { ...INITIAL_INTERACTION_STATE, selectedObjectIds: ["obj_9", "obj_1"] };
    expect(focusPathPart(many, "obj_1", { kind: "vertex", index: 0 }).selectedObjectIds).toEqual(["obj_9", "obj_1"]);
  });
});
