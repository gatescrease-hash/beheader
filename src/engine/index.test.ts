/// <reference types="vite/client" />
/**
 * index.test.ts
 *
 * Proves the public surface is real, not only legal. It builds a document,
 * mutates it, and saves and loads it back. Every name in this file comes from
 * index.ts alone, the way a consumer outside src/engine imports it.
 */
import { describe, expect, it } from "vitest";
import * as engineSurface from "./index.ts";
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
  it("creates a circle, reads its exact derived measurements, and saves and loads it back unchanged", () => {
    const empty: Document = createEmptyDocument();
    const minted = mintObjectId(empty);
    if ("ok" in minted) throw new Error(minted.message);
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
    expect(roundTripped?.slots["vertices"]).toBeUndefined();
    expect(roundTripped?.slots["area"]?.value).toBeCloseTo(Math.PI * 25);
    expect(roundTripped?.slots["bounds.maxX"]?.value).toBe(5);
  });

  /**
   * Every engine file, found by the bundler and not by a list anybody keeps
   * by hand. A list goes stale the moment somebody adds a file, and that is
   * the one thing this test exists to catch. The pattern excludes a test
   * file. An eager import of one registers its tests inside this file as
   * well.
   */
  const ENGINE_MODULES = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./index.ts"], { eager: true }) as Record<
    string,
    Record<string, unknown>
  >;

  /** index.ts gives this name two clearer ones, so it never appears under the old one. */
  const RENAMED_ON_PURPOSE = new Set(["evaluate"]);

  it("re-exports every runtime name of every engine file, so a new file cannot hide from the surface", () => {
    const surface = engineSurface as Record<string, unknown>;
    const missing: string[] = [];
    expect(Object.keys(ENGINE_MODULES).length).toBeGreaterThan(10);
    for (const [path, module] of Object.entries(ENGINE_MODULES)) {
      for (const name of Object.keys(module)) {
        if (RENAMED_ON_PURPOSE.has(name) || name in surface) {
          continue;
        }
        missing.push(`${path} exports "${name}", which index.ts does not re-export`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * The source of every file outside the engine, read as text and never run.
   * A raw import stops a render file before it reaches for a canvas here.
   */
  const OUTER_SOURCES = import.meta.glob(["../command/**/*.ts", "../render/**/*.ts", "../*.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  const ENGINE_IMPORT = /from\s*"([^"]*\/engine\/[^"]*)"/g;

  it("is the only engine path any file outside the engine imports, so an engine rename stays inside the engine", () => {
    expect(Object.keys(OUTER_SOURCES).length).toBeGreaterThan(20);
    const deep: string[] = [];
    for (const [path, source] of Object.entries(OUTER_SOURCES)) {
      for (const match of source.matchAll(ENGINE_IMPORT)) {
        const specifier = match[1] ?? "";
        if (!specifier.endsWith("/engine/index.ts")) {
          deep.push(`${path} imports "${specifier}" instead of the index`);
        }
      }
    }
    expect(deep).toEqual([]);
  });

  it("re-exports evaluateFormulaAst and evaluateGraph as two distinct functions, not the same name colliding", () => {
    expect(typeof evaluateFormulaAst).toBe("function");
    expect(typeof evaluateGraph).toBe("function");
    expect(evaluateFormulaAst).not.toBe(evaluateGraph);
  });
});
