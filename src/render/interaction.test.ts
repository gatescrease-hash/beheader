/**
 * interaction.test.ts — Tests for `interaction.ts` (§5.9).
 *
 * No Canvas2D fake needed (contrast `renderer.test.ts`): this file's subject
 * touches no canvas. Fixtures are built through the real `mutate()` wherever
 * the object under test is one the current schemas can actually produce, so a
 * drag is proved end to end — the operation, the commit, and the derived-slot
 * re-evaluation that follows it. The few objects no schema can produce today
 * (a `derived` `origin.x`, an object with no origin at all) are hand-built and
 * say so at the site: `pointerMove` is total over whatever object list it is
 * handed, which is exactly the contract those cases pin.
 */
import { describe, expect, it } from "vitest";
import type { CameraState } from "../engine/document.ts";
import type { GraphObject } from "../engine/graph/node.ts";
import { mutate, type MutationJournalEntry } from "../engine/mutation.ts";
import { getObjectSchema } from "../engine/primitives/schema.ts";
import { deselect, INITIAL_INTERACTION_STATE, pointerDown, pointerMove, pointerUp, type InteractionState } from "./interaction.ts";

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };

/** Every derived slot a preset's schema declares, as a null placeholder — `createObject` requires all of them (D-018). Copied from `geometry.test.ts`'s helper of the same name. */
function derivedPlaceholders(type: "circle" | "polygon" | "rect"): Record<string, { readonly kind: "derived"; readonly value: null }> {
  const schema = getObjectSchema(type);
  if (schema === undefined) {
    throw new Error(`test setup: expected a schema for ${type}`);
  }
  const placeholders: Record<string, { readonly kind: "derived"; readonly value: null }> = {};
  for (const slot of schema.derivedSlots) {
    placeholders[slot.path.join(".")] = { kind: "derived", value: null };
  }
  return placeholders;
}

/** A 20x20 `rect` anchored at (`originX`, `originY`) — vertices run (0,0),(20,0),(20,20),(0,20) when anchored at the origin, so its top edge is easy to click. */
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

/** Commits `objects` through the real mutation channel, so every fixture below starts from evaluated state rather than hand-written derived values. */
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

/** Reads one slot's committed value out of a result, by object id and slot key. */
function slotValue(objects: readonly GraphObject[], objectId: string, key: string): unknown {
  return objects.find((object) => object.id === objectId)?.slots[key]?.value;
}

/**
 * A `table` named `table_x` with one row and `cols` columns, holding `values`
 * in A1, B1, ... — the upstream a formula-driven origin component reads from,
 * so a notice can name a real address (§5.9's "x is driven by `table_x.A1`").
 */
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

/** A drag already in progress on `objectId`, starting from world (0, 0) — for the cases `pointerDown` cannot set up because the object is not hittable. */
function dragFromOrigin(objectId: string): InteractionState {
  return { selectedObjectIds: [objectId], drag: { objectId, lastWorldPoint: { x: 0, y: 0 }, emittedNotices: [] } };
}

describe("pointerDown — §5.9 'click to select', widened by D-100 to a list", () => {
  it("selects the object under the pointer and arms a drag from that world point", () => {
    const { objects } = commit([rectObject(0, 0)]);
    // World (10, 0) sits exactly on the rect's top edge (0,0)-(20,0).
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    expect(state.selectedObjectIds).toEqual(["obj_1"]);
    expect(state.drag).toEqual({ objectId: "obj_1", lastWorldPoint: { x: 10, y: 0 }, emittedNotices: [] });
  });

  it("holds the object's id, not the GraphObject the hit test returned", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    // Pins the SHAPE, not the absence of one guessed field name: a drag that
    // carried the object itself — the natural wrong implementation, and the
    // one that goes stale on the first commit — adds a key here and fails.
    expect(Object.keys(state.drag ?? {}).sort()).toEqual(["emittedNotices", "lastWorldPoint", "objectId"]);
    expect(state.drag?.objectId).toBe(objects[0]?.id);
  });

  it("selects nothing and arms nothing when the pointer lands on empty canvas", () => {
    const { objects } = commit([rectObject(0, 0)]);
    // Far outside the rect and well past the 5-pixel stroke tolerance.
    expect(pointerDown(INITIAL_INTERACTION_STATE, { x: 500, y: 500 }, objects, CAMERA_IDENTITY)).toEqual(INITIAL_INTERACTION_STATE);
  });

  it("replaces a prior selection with whatever is under the pointer, empty canvas included (D-100 clause 2)", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const selected = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    expect(selected.selectedObjectIds).toEqual(["obj_1"]);
    expect(pointerDown(selected, { x: 500, y: 500 }, objects, CAMERA_IDENTITY).selectedObjectIds).toEqual([]);
  });

  it("a shift-click ADDS the object hit to the selection (D-100 clause 3)", () => {
    const rectB: GraphObject = { ...rectObject(30, 0), id: "obj_3", name: "rect_2" };
    const { objects } = commit([rectObject(0, 0), rectB]);
    const first = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const second = pointerDown(first, { x: 40, y: 0 }, objects, CAMERA_IDENTITY, true);
    expect(second.selectedObjectIds).toEqual(["obj_1", "obj_3"]);
  });

  it("a shift-click on an ALREADY-SELECTED object REMOVES it — the conventional toggle (D-100 clause 4, PROVISIONAL(Q-015))", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const first = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const toggled = pointerDown(first, { x: 10, y: 0 }, objects, CAMERA_IDENTITY, true);
    expect(toggled.selectedObjectIds).toEqual([]);
  });

  it("a shift-click on empty canvas changes nothing at all — neither clears nor adds (D-100 clause 3)", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const selected = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const missed = pointerDown(selected, { x: 500, y: 500 }, objects, CAMERA_IDENTITY, true);
    expect(missed).toBe(selected);
  });

  it("arms a drag on the object under THIS press even when the shift-click just removed it from the selection (D-100 clause 6)", () => {
    const { objects } = commit([rectObject(0, 0)]);
    const first = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);
    const toggled = pointerDown(first, { x: 10, y: 0 }, objects, CAMERA_IDENTITY, true);
    expect(toggled.selectedObjectIds).toEqual([]);
    expect(toggled.drag?.objectId).toBe("obj_1");
  });
});

describe("pointerUp and deselect", () => {
  it("pointerUp ends the drag and keeps the selection — §5.9 separates selecting from moving", () => {
    const state = pointerUp(dragFromOrigin("obj_1"));
    expect(state.selectedObjectIds).toEqual(["obj_1"]);
    expect(state.drag).toBeUndefined();
  });

  it("pointerUp returns the same state untouched when no drag is running", () => {
    const idle: InteractionState = { selectedObjectIds: ["obj_1"], drag: undefined };
    expect(pointerUp(idle)).toBe(idle);
  });

  it("pointerUp keeps a MULTI-object selection untouched, ending only the drag", () => {
    const state: InteractionState = { selectedObjectIds: ["obj_1", "obj_2"], drag: { objectId: "obj_1", lastWorldPoint: { x: 0, y: 0 }, emittedNotices: [] } };
    expect(pointerUp(state)).toEqual({ selectedObjectIds: ["obj_1", "obj_2"], drag: undefined });
  });

  it("deselect clears the selection AND a drag in progress, so no gesture survives Escape (§5.9)", () => {
    expect(deselect()).toEqual(INITIAL_INTERACTION_STATE);
  });
});

describe("pointerMove — dragging calls the mutation API (§5.9, Rule 2)", () => {
  it("moves a literal origin by the world delta and re-evaluates the derived slots that read it", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY);

    const moved = pointerMove(state, { x: 13, y: 7 }, objects, journal, CAMERA_IDENTITY);

    expect(moved.rejection).toBeUndefined();
    expect(slotValue(moved.objects, "obj_1", "origin.x")).toBe(3);
    expect(slotValue(moved.objects, "obj_1", "origin.y")).toBe(7);
    // The payoff of going through `mutate` rather than writing the slot: the
    // derived slots reading `origin` were recomputed inside the same
    // topological pass, not left one step stale.
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
    // Screen (20, 0) is world (10, 0) at zoom 2 — on the rect's top edge.
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, zoomed);
    // Screen (40, 20) is world (20, 10): a 20x20 SCREEN delta is a 10x10 WORLD
    // delta. A file that skipped the conversion would move the rect by 20.
    const moved = pointerMove(state, { x: 40, y: 20 }, objects, journal, zoomed);
    expect(slotValue(moved.objects, "obj_1", "origin.x")).toBe(10);
    expect(slotValue(moved.objects, "obj_1", "origin.y")).toBe(10);
  });

  it("keeps moving the right object across steps, because the drag holds an id and not a stale snapshot", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const first = pointerMove(pointerDown(INITIAL_INTERACTION_STATE, { x: 10, y: 0 }, objects, CAMERA_IDENTITY), { x: 13, y: 0 }, objects, journal, CAMERA_IDENTITY);
    // `mutate` returned NEW objects; the second step is fed those, and the
    // drag's id still resolves. A held GraphObject would have moved the rect
    // from its original position again, landing on 4 instead of 7.
    const second = pointerMove(first.state, { x: 17, y: 0 }, first.objects, first.journal, CAMERA_IDENTITY);
    expect(slotValue(second.objects, "obj_1", "origin.x")).toBe(7);
  });

  it("is a no-op with no drag in progress, so a caller may wire it to every pointer move", () => {
    const { objects, journal } = commit([rectObject(0, 0)]);
    const idle: InteractionState = { selectedObjectIds: ["obj_1"], drag: undefined };
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
    // One operation, not two: `origin.y`'s delta is zero, and a write that
    // stores the value already there would still journal a mutation.
    expect(moved.journal[moved.journal.length - 1]?.operations.length).toBe(1);
    expect(slotValue(moved.objects, "obj_1", "origin.x")).toBe(5);
  });
});

describe("per-component dragging — §5.9 'not all-or-nothing'", () => {
  it("slides in Y only when origin.x is driven, and the notice names what drives it", () => {
    const rect: GraphObject = {
      ...rectObject(0, 0),
      slots: {
        ...rectObject(0, 0).slots,
        "origin.x": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "A1"] } }, value: 10 },
      },
    };
    const { objects, journal } = commit([tableObject(1, [10]), rect]);
    // origin is (10, 0) once evaluated, so the top edge runs (10,0)-(30,0).
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);
    expect(state.selectedObjectIds).toEqual(["obj_1"]);

    const moved = pointerMove(state, { x: 25, y: 5 }, objects, journal, CAMERA_IDENTITY);

    expect(moved.rejection).toBeUndefined();
    expect(slotValue(moved.objects, "obj_1", "origin.x")).toBe(10); // Still the cell's value.
    expect(slotValue(moved.objects, "obj_1", "origin.y")).toBe(5); // The free axis moved.
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
    // The drag still ADVANCED — there is no delta to retry when nothing here
    // can ever move.
    expect(moved.state.drag?.lastWorldPoint).toEqual({ x: 25, y: 5 });
  });

  it("names EVERY slot a branching formula could read, because extractDependencies is eager and total (§5.3)", () => {
    // `IF(A1, B1, C1)`: evaluation takes one branch, but the graph subscribes
    // to all three, so all three genuinely drive this component. A notice that
    // named only the live branch would be describing a different graph than the
    // one that exists. Added at 0067-REVIEW — the doc comment claimed this and
    // nothing defended it.
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
    // A `polyline`, because no other type can legally carry this shape: on a
    // `rect`, `origin.x` is a schema-declared NON-derived path, so D-018's
    // kind-mismatch check would reject the object outright. `polyline` has no
    // schema entry at all yet, which is D-017's one permitted exception — so
    // the fixture goes through the real `mutate` rather than being hand-fed.
    const derivedOrigin: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
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

  it("reports an object with no origin slots as undraggable rather than swallowing the gesture", () => {
    // A `table` is that object today: `TABLE_SCHEMA` declares no
    // `origin.x`/`origin.y` (entry 0061). §5.9's per-vertex drag path, which
    // would otherwise apply here, is not built (file header).
    const { objects, journal } = commit([tableObject(1, [10])]);
    const outcome = pointerMove(dragFromOrigin("obj_2"), { x: 5, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(outcome.objects).toBe(objects);
    expect(outcome.journal).toBe(journal);
    expect(outcome.notices).toEqual(["table_x has no origin slots, and dragging by vertex is not built yet — nothing moved"]);
  });
});

describe("per-gesture notice dedup (D-098)", () => {
  /** The `slides in Y only` fixture above, reused: `origin.x` driven by `table_x.A1`, `origin.y` free. */
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
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY); // origin is (10, 0) once evaluated.

    const first = pointerMove(state, { x: 25, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(first.notices).toHaveLength(1);
    expect(first.notices[0]).toContain("table_x.A1");

    // Same drag, another sample: origin.x is STILL driven by the SAME formula,
    // so the notice text is identical — D-098 says once per gesture, not once
    // per sample. x must actually move THIS step too (a zero x-delta would
    // skip the component before it ever gets to report anything, which would
    // pass this assertion for the WRONG reason — see `planComponent`).
    const second = pointerMove(first.state, { x: 26, y: 9 }, first.objects, first.journal, CAMERA_IDENTITY);
    expect(second.notices).toEqual([]);
    // The gesture still advances and the free axis still moves — dedup only
    // silences the REPORT, never the underlying per-component behaviour.
    expect(slotValue(second.objects, "obj_1", "origin.x")).toBe(10);
    expect(slotValue(second.objects, "obj_1", "origin.y")).toBe(9);

    // And a third sample, same story again.
    const third = pointerMove(second.state, { x: 27, y: 11 }, second.objects, second.journal, CAMERA_IDENTITY);
    expect(third.notices).toEqual([]);
  });

  it("a DIFFERENT notice text within the same gesture still emits — dedup is per TEXT, not a blanket silence", () => {
    const { objects, journal } = commit([tableObject(2, [10, 20]), xDrivenRect()]);
    const state = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);
    const afterFirst = pointerMove(state, { x: 25, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(afterFirst.notices).toHaveLength(1);
    expect(afterFirst.notices[0]).toContain("table_x.A1");

    // Re-point origin.x's OWN formula at a DIFFERENT cell mid-gesture (the
    // operator typed `link rect_1.origin.x table_x.B1` without releasing the
    // drag) — the notice's TEXT changes even though the SHAPE of the report
    // ("did not move: it is driven by...") does not.
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

    // x must actually move THIS step (a zero delta skips the component
    // entirely, before it can even report — see `planComponent`), so the
    // screen point moves in x too, not just y.
    const afterRelink = pointerMove(afterFirst.state, { x: 26, y: 6 }, relinked.objects, relinked.journal, CAMERA_IDENTITY);
    expect(afterRelink.notices).toHaveLength(1); // A genuinely NEW text — surfaces despite the still-running gesture.
    expect(afterRelink.notices[0]).toContain("table_x.B1");

    // But the SAME new text, on the very next sample, dedupes again.
    const again = pointerMove(afterRelink.state, { x: 27, y: 7 }, afterRelink.objects, afterRelink.journal, CAMERA_IDENTITY);
    expect(again.notices).toEqual([]);
  });

  it("re-emits the same notice on a NEW gesture — pointerUp/pointerDown resets the per-gesture set", () => {
    const { objects, journal } = commit([tableObject(1, [10]), xDrivenRect()]);
    const firstGesture = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 0 }, objects, CAMERA_IDENTITY);
    const moved = pointerMove(firstGesture, { x: 25, y: 5 }, objects, journal, CAMERA_IDENTITY);
    expect(moved.notices).toHaveLength(1);

    const released = pointerUp(moved.state);
    expect(released.drag).toBeUndefined(); // The per-gesture set is discarded WITH the drag.

    // A fresh gesture on the same object — its top edge is now (10,5)-(30,5).
    const secondGesture = pointerDown(INITIAL_INTERACTION_STATE, { x: 20, y: 5 }, moved.objects, CAMERA_IDENTITY);
    expect(secondGesture.drag?.emittedNotices).toEqual([]); // D-098: a fresh gesture starts with nothing surfaced yet.

    const movedAgain = pointerMove(secondGesture, { x: 25, y: 9 }, moved.objects, moved.journal, CAMERA_IDENTITY);
    expect(movedAgain.notices).toHaveLength(1); // Same text — but a NEW gesture, so it surfaces again.
    expect(movedAgain.notices[0]).toContain("table_x.A1");
  });
});

describe("pointerMove — failure paths", () => {
  it("a rejected mutation returns the caller's own objects, journal and state, and the pending delta survives to the next move", () => {
    const { objects, journal } = commit([rectObject(1e308, 0)]);
    const state = dragFromOrigin("obj_1");

    // origin.x is 1e308; a +1e308 delta overflows it to Infinity, which is not
    // legal document state (D-025), so `mutate` refuses the whole batch —
    // origin.y's own operation included.
    const rejected = pointerMove(state, { x: 1e308, y: 7 }, objects, journal, CAMERA_IDENTITY);
    expect(rejected.rejection).toBeTypeOf("string");
    expect(rejected.objects).toBe(objects);
    expect(rejected.journal).toBe(journal);
    expect(rejected.state).toBe(state);

    // Because `lastWorldPoint` never advanced, the next move's delta is still
    // measured from world (0, 0): y moves the full 7. Had the drag advanced
    // through the rejection to (1e308, 7), this delta would be 0 and y would
    // stay put — which is what makes this assertion discriminating rather than
    // merely consistent. x's own delta is now 0, so it is not written at all
    // and keeps the value the rejected step failed to change.
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
    expect(outcome.notices).toHaveLength(2); // origin.x holds an error; origin.y has no slot at all.
  });
});
