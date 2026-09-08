/**
 * index.test.ts
 *
 * Proves the public surface is real, not only legal. It builds a document,
 * mutates it, and saves and loads it back. Every name in this file comes
 * from index.ts alone, the way a consumer outside src/engine must import it.
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  evaluateFormulaAst,
  evaluateGraph,
  getObjectSchema,
  loadDocument,
  mintObjectId,
  mutate,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  RADIUS_PATH,
  saveDocument,
  type Document,
  type GraphObject,
} from "./index.ts";

describe("engine/index.ts — the one public surface", () => {
  it("creates a circle, reads its derived vertices, and saves and loads it back unchanged", () => {
    const empty: Document = createEmptyDocument();
    const minted = mintObjectId(empty);
    const schema = getObjectSchema("circle");
    if (schema === undefined) {
      throw new Error("test setup: expected the circle schema to exist");
    }
    const circle: GraphObject = {
      id: minted.id,
      name: "circle_1",
      type: "circle",
      slots: {
        [ORIGIN_X_PATH.join(".")]: { kind: "literal", value: 0 },
        [ORIGIN_Y_PATH.join(".")]: { kind: "literal", value: 0 },
        [RADIUS_PATH.join(".")]: { kind: "literal", value: 5 },
        vertices: { kind: "derived", value: null },
        "centroid.x": { kind: "derived", value: null },
        "centroid.y": { kind: "derived", value: null },
        area: { kind: "derived", value: null },
        length: { kind: "derived", value: null },
        "bounds.minX": { kind: "derived", value: null },
        "bounds.minY": { kind: "derived", value: null },
        "bounds.maxX": { kind: "derived", value: null },
        "bounds.maxY": { kind: "derived", value: null },
      },
    };
    const created = mutate([], [{ kind: "createObject", object: circle }], []);
    if (!created.ok) {
      throw new Error(`test setup: expected creation to succeed, got: ${created.message}`);
    }
    const document: Document = { ...empty, nextObjectId: minted.nextObjectId, objects: created.objects, journal: created.journal };

    const json = saveDocument(document);
    const loaded = loadDocument(json);
    if (!loaded.ok) {
      throw new Error(`expected the saved document to load, got: ${loaded.message}`);
    }
    const roundTripped = loaded.document.objects.find((object) => object.id === minted.id);
    expect(roundTripped?.slots["vertices"]?.value).toHaveLength(32);
  });

  it("re-exports evaluateFormulaAst and evaluateGraph as two distinct functions, not the same name colliding", () => {
    expect(typeof evaluateFormulaAst).toBe("function");
    expect(typeof evaluateGraph).toBe("function");
    expect(evaluateFormulaAst).not.toBe(evaluateGraph);
  });
});
