import { describe, expect, it } from "vitest";
import { assignLayer, createLayer, displayObjects, inheritStyle, layerId, setLiteral } from "./layers.ts";
import { createEmptyDocument, loadDocument, saveDocument } from "./document.ts";
import { mutate, type Operation } from "./mutation.ts";
import { type GraphObject, type Slot } from "./graph/node.ts";
import { getObjectSchema, resolveDerivedSlots } from "./primitives/schema.ts";
import { replayJournal } from "./journal.ts";

function circle(): GraphObject {
  const slots: Record<string, Slot> = Object.fromEntries(Object.entries({ "origin.x": 50, "origin.y": 50, radius: 20, "style.strokeColor": "#1a1a1a", "style.strokeWidth": 1, "style.fillColor": null }).map(([key, value]) => [key, { kind: "literal", value }]));
  const object: GraphObject = { id: "circle", name: "circle_1", type: "circle", slots };
  for (const entry of resolveDerivedSlots(object, getObjectSchema("circle")!.derivedSlots)) slots[entry.path.join(".")] = { kind: "derived", value: null };
  return object;
}

const table: GraphObject = { id: "table", name: "table_1", type: "table", slots: { rows: { kind: "literal", value: 2 }, cols: { kind: "literal", value: 2 }, "cells.A1": { kind: "literal", value: 2 } } };

function setup() {
  const objects = [createLayer("geom", "GEOM"), createLayer("txt", "TXT"), circle(), table];
  const result = mutate([], objects.map(object => ({ kind: "createObject", object })), []);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("layers in the dependency graph", () => {
  it("keeps membership while another layer reads a table to drive one style", () => {
    const start = setup();
    const operations: Operation[] = [...assignLayer(start.objects[2]!, start.objects[0]!), inheritStyle("circle", ["style", "strokeWidth"], "txt"), { kind: "setSlot", address: { objectId: "txt", path: ["style", "strokeWidth"] }, slot: { kind: "formula", ast: { type: "reference", address: { objectId: "table", path: ["cells", "A1"] } }, value: null } }];
    const linked = mutate(start.objects, operations, start.journal);
    expect(linked.ok).toBe(true); if (!linked.ok) return;
    const changed = mutate(linked.objects, [setLiteral("table", ["cells", "A1"], 7)], linked.journal);
    expect(changed.ok).toBe(true); if (!changed.ok) return;
    expect(layerId(changed.objects[2]!)).toBe("geom");
    expect(changed.objects[2]!.slots["style.strokeWidth"]?.value).toBe(7);
    const saved = saveDocument({ ...createEmptyDocument(), objects: changed.objects, journal: changed.journal });
    const loaded = loadDocument(saved);
    expect(loaded.ok).toBe(true); if (loaded.ok) expect(loaded.document.objects).toEqual(changed.objects);
    const replay = replayJournal(changed.journal, changed.journal.length);
    expect(replay.ok).toBe(true); if (replay.ok) expect(replay.objects).toEqual(changed.objects);
  });

  it("retains custom literals on assignment and reassigns only inherited styles", () => {
    const start = setup();
    const custom = { ...start.objects[2]!, slots: { ...start.objects[2]!.slots, "style.strokeWidth": { kind: "literal" as const, value: 4 } } };
    const assigned = mutate([start.objects[0]!, start.objects[1]!, custom], assignLayer(custom, start.objects[0]!), []);
    expect(assigned.ok).toBe(true); if (!assigned.ok) return;
    expect(assigned.objects[2]!.slots["style.strokeWidth"]).toEqual({ kind: "literal", value: 4 });
    const moved = mutate(assigned.objects, assignLayer(assigned.objects[2]!, assigned.objects[1]!), assigned.journal);
    expect(moved.ok).toBe(true); if (!moved.ok) return;
    expect(moved.objects[2]!.slots["style.strokeWidth"]?.value).toBe(4);
    expect(moved.objects[2]!.slots["style.strokeColor"]).toMatchObject({ kind: "formula", ast: { address: { objectId: "txt" } } });
    const restored = mutate(moved.objects, [inheritStyle("circle", ["style", "strokeWidth"], "txt")], moved.journal);
    expect(restored.ok).toBe(true); if (restored.ok) expect(restored.objects[2]!.slots["style.strokeWidth"]?.value).toBe(1);
  });

  it("rejects cycles across layer style slots without changing the caller", () => {
    const start = setup();
    const result = mutate(start.objects, [inheritStyle("geom", ["style", "strokeWidth"], "txt"), inheritStyle("txt", ["style", "strokeWidth"], "geom")], start.journal);
    expect(result.ok).toBe(false);
    expect(start.objects[0]!.slots["style.strokeWidth"]?.kind).toBe("literal");
  });

  it("hides members without removing them or stopping graph updates", () => {
    const start = setup();
    const linked = mutate(start.objects, [...assignLayer(start.objects[2]!, start.objects[0]!), setLiteral("geom", ["view", "visible"], false), setLiteral("geom", ["style", "strokeWidth"], 8)], start.journal);
    expect(linked.ok).toBe(true); if (!linked.ok) return;
    expect(linked.objects).toHaveLength(4);
    expect(displayObjects(linked.objects).map(object => object.id)).toEqual(["table"]);
    expect(linked.objects[2]!.slots["style.strokeWidth"]?.value).toBe(8);
  });

  it("sorts by layer then object order and keeps ties stable", () => {
    const start = setup();
    const ordered = mutate(start.objects, [...assignLayer(start.objects[2]!, start.objects[0]!), setLiteral("geom", ["view", "order"], 3)], start.journal);
    expect(ordered.ok).toBe(true); if (!ordered.ok) return;
    expect(displayObjects(ordered.objects).map(object => object.id)).toEqual(["table", "circle"]);
  });

  it("refuses orphaned membership on deletion and invalid layer IDs", () => {
    const start = setup();
    expect(mutate(start.objects, [setLiteral("circle", ["view", "layer"], "missing")], start.journal).ok).toBe(false);
    const linked = mutate(start.objects, assignLayer(start.objects[2]!, start.objects[0]!), start.journal);
    expect(linked.ok).toBe(true); if (!linked.ok) return;
    expect(mutate(linked.objects, [{ kind: "deleteObject", objectId: "geom", force: true }], linked.journal).ok).toBe(false);
    const detached = mutate(linked.objects, [...assignLayer(linked.objects[2]!, undefined), { kind: "deleteObject", objectId: "geom" }], linked.journal);
    expect(detached.ok).toBe(true);
  });

  it("moves formatting, dimensions and references when table columns change", () => {
    const start = setup();
    const formatted = mutate(start.objects, [setLiteral("table", ["columns", "2", "width"], 140), setLiteral("table", ["cellStyle", "B1", "bold"], true), { kind: "setSlot", address: { objectId: "txt", path: ["style", "strokeWidth"] }, slot: { kind: "formula", ast: { type: "reference", address: { objectId: "table", path: ["columns", "2", "width"] } }, value: null } }], start.journal);
    expect(formatted.ok).toBe(true); if (!formatted.ok) return;
    const inserted = mutate(formatted.objects, [{ kind: "insertTableLine", objectId: "table", axis: "column", index: 1 }], formatted.journal);
    expect(inserted.ok).toBe(true); if (!inserted.ok) return;
    expect(inserted.objects[3]!.slots["columns.3.width"]?.value).toBe(140);
    expect(inserted.objects[3]!.slots["cellStyle.C1.bold"]?.value).toBe(true);
    expect(inserted.objects[1]!.slots["style.strokeWidth"]).toMatchObject({ value: 140, ast: { address: { path: ["columns", "3", "width"] } } });
    const deleted = mutate(inserted.objects, [{ kind: "deleteTableLine", objectId: "table", axis: "column", index: 3 }], inserted.journal);
    expect(deleted.ok).toBe(true); if (!deleted.ok) return;
    expect(deleted.objects[3]!.slots["columns.3.width"]).toBeUndefined();
    expect(deleted.objects[1]!.slots["style.strokeWidth"]?.value).toMatchObject({ error: "#REF" });
  });
});
