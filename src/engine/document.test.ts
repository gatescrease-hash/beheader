/**
 * document.test.ts
 *
 * These tests cover the save and load round trip. A document comes back the
 * same. A derived value never appears in the file.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "./address.ts";
import {
  FORMAT_VERSION,
  createEmptyDocument,
  deserializeDocument,
  loadDocument,
  saveDocument,
  serializeDocument,
  type Document,
} from "./document.ts";
import { deriveValidateAndEvaluate } from "./mutation.ts";
import type { EvalContext } from "./eval-context.ts";
import type { GraphObject } from "./graph/node.ts";
import { MAX_FORMULA_AST_DEPTH, type FormulaAst } from "./formula/ast.ts";

function addr(objectId: string, ...path: readonly string[]): Address {
  return { objectId, path };
}

function valueObject(id: string, name: string, value: number): GraphObject {
  return { id, name, type: "value", slots: { value: { kind: "literal", value } } };
}

function addObject(id: string, name: string, aRef: Address, bRef: Address): GraphObject {
  return {
    id,
    name,
    type: "add",
    slots: {
      "in.a": { kind: "formula", ast: { type: "reference", address: aRef }, value: null },
      "in.b": { kind: "formula", ast: { type: "reference", address: bRef }, value: null },
      "out.result": { kind: "derived", value: null },
    },
  };
}

function consistentFixture(): readonly GraphObject[] {
  const initial = [
    valueObject("obj_1", "value_1", 3),
    valueObject("obj_2", "value_2", 4),
    addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
  ];
  const result = deriveValidateAndEvaluate(initial);
  if (!result.ok) {
    throw new Error("test setup: expected the fixture to evaluate cleanly");
  }
  return result.objects;
}

describe("createEmptyDocument", () => {
  it("starts at formatVersion/nextObjectId 1, with no objects, no journal, and a default camera", () => {
    const document = createEmptyDocument();
    expect(document.formatVersion).toBe(FORMAT_VERSION);
    expect(document.nextObjectId).toBe(1);
    expect(document.objects).toEqual([]);
    expect(document.journal).toEqual([]);
    expect(document.camera).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe("serializeDocument — drops every derived slot's value", () => {
  it("omits `value` from a derived slot, but keeps literal/formula slots (including their cached value) unchanged", () => {
    const document: Document = { ...createEmptyDocument(), objects: consistentFixture() };

    const serialized = serializeDocument(document);

    const add1 = serialized.objects.find((object) => object.id === "obj_3");
    expect(add1?.slots["out.result"]).toEqual({ kind: "derived" });
    expect(Object.keys(add1?.slots["out.result"] ?? {})).toEqual(["kind"]);
    expect(add1?.slots["in.a"]).toMatchObject({ kind: "formula", value: 3 });
  });
});

describe("saveDocument / loadDocument — round-trips to JSON and back identically", () => {
  it("round-trips the value and add fixture — objects, nextObjectId, journal, and camera all identical", () => {
    const document: Document = {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 4,
      objects: consistentFixture(),
      journal: [{ operations: [{ kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 3 } }] }],
      camera: { x: 10, y: -5, zoom: 2 },
    };

    const json = saveDocument(document);
    const result = loadDocument(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document).toEqual(document);
    }
  });

  it("round-trips a JOURNAL carrying the SAME value vocabulary the object list does, including the saveDocument(loaded) === json text equality that catches this whole class", () => {
    const document: Document = {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 3,
      objects: [valueObject("obj_1", "value_1", 1), valueObject("obj_2", "value_2", 2)],
      journal: [
        {
          operations: [
            { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 42 } },
            { kind: "setSlot", address: addr("obj_1", "name_string"), slot: { kind: "literal", value: "hello" } },
            { kind: "setSlot", address: addr("obj_1", "flag"), slot: { kind: "literal", value: true } },
            { kind: "setSlot", address: addr("obj_1", "empty"), slot: { kind: "literal", value: null } },
            { kind: "setSlot", address: addr("obj_1", "origin"), slot: { kind: "literal", value: { x: 1, y: -2 } } },
            {
              kind: "setSlot",
              address: addr("obj_1", "vertices"),
              slot: { kind: "literal", value: [{ x: 0, y: 0 }, { x: 3, y: 4 }] },
            },
            { kind: "setSlot", address: addr("obj_1", "broken"), slot: { kind: "literal", value: { error: "#REF", message: "no such slot" } } },
          ],
        },
        {
          operations: [
            { kind: "createObject", object: valueObject("obj_2", "value_2", 2) },
            { kind: "deleteObject", objectId: "obj_2" },
          ],
        },
      ],
      camera: { x: 0, y: 0, zoom: 1 },
    };

    const json = saveDocument(document);
    const result = loadDocument(json);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(document);
    expect(saveDocument(result.document)).toBe(json);
  });

  it("round-trips an empty document (zero objects) without ever calling mutate's batch API", () => {
    const document = createEmptyDocument();

    const result = loadDocument(saveDocument(document));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document).toEqual(document);
    }
  });

  it("re-evaluates on load rather than trusting a stale cached formula/derived value sitting in the file", () => {
    const document: Document = { ...createEmptyDocument(), objects: consistentFixture() };
    const parsed = JSON.parse(saveDocument(document)) as { objects: Array<{ id: string; slots: Record<string, { value?: unknown }> }> };
    const add1 = parsed.objects.find((object) => object.id === "obj_3");
    if (add1 === undefined) {
      throw new Error("test setup: expected add_1 in the serialized document");
    }
    add1.slots["in.a"] = { ...add1.slots["in.a"], value: 999 };

    const result = deserializeDocument(parsed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reloadedAdd1 = result.document.objects.find((object) => object.id === "obj_3");
    expect(reloadedAdd1?.slots["in.a"]).toMatchObject({ value: 3 });
    expect(reloadedAdd1?.slots["out.result"]).toEqual({ kind: "derived", value: 7 });
  });

  it("round-trips an `image` object — six literal slots, no derived ones, and now a SCHEMA to be reconciled against", () => {
    const image: GraphObject = {
      id: "obj_1",
      name: "image_1",
      type: "image",
      slots: {
        "origin.x": { kind: "literal", value: 30 },
        "origin.y": { kind: "literal", value: 40 },
        width: { kind: "literal", value: 100 },
        height: { kind: "literal", value: 100 },
        opacity: { kind: "literal", value: 1 },
        source: { kind: "literal", value: "data:image/png;base64,iVBORw0KGgo=" },
      },
    };
    const document: Document = { ...createEmptyDocument(), nextObjectId: 2, objects: [image] };

    const result = loadDocument(saveDocument(document));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document).toEqual(document);
    }
  });
});

describe("deserializeDocument — malformed input, never throws", () => {
  it("loadDocument rejects invalid JSON syntax, without throwing", () => {
    expect(() => loadDocument("{ not valid json")).not.toThrow();
    const result = loadDocument("{ not valid json");
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object top level", () => {
    expect(deserializeDocument(42).ok).toBe(false);
    expect(deserializeDocument(null).ok).toBe(false);
    expect(deserializeDocument([1, 2, 3]).ok).toBe(false);
    expect(deserializeDocument("a string").ok).toBe(false);
    expect(deserializeDocument(undefined).ok).toBe(false);
  });

  it("rejects a mismatched formatVersion, naming both the file's version and the one this build reads", () => {
    const serialized = serializeDocument(createEmptyDocument());
    const result = deserializeDocument({ ...serialized, formatVersion: 999 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("999");
      expect(result.message).toContain(String(FORMAT_VERSION));
    }
  });

  it("rejects a non-integer, negative, or wrong-typed nextObjectId", () => {
    const serialized = serializeDocument(createEmptyDocument());
    expect(deserializeDocument({ ...serialized, nextObjectId: 1.5 }).ok).toBe(false);
    expect(deserializeDocument({ ...serialized, nextObjectId: -1 }).ok).toBe(false);
    expect(deserializeDocument({ ...serialized, nextObjectId: "1" }).ok).toBe(false);
  });

  it("rejects objects/journal that are not arrays", () => {
    const serialized = serializeDocument(createEmptyDocument());
    expect(deserializeDocument({ ...serialized, objects: {} }).ok).toBe(false);
    expect(deserializeDocument({ ...serialized, journal: {} }).ok).toBe(false);
  });

  it("rejects a missing or malformed camera", () => {
    const serialized = serializeDocument(createEmptyDocument());
    expect(deserializeDocument({ ...serialized, camera: undefined }).ok).toBe(false);
    expect(deserializeDocument({ ...serialized, camera: { x: 1, y: 2 } }).ok).toBe(false);
    expect(deserializeDocument({ ...serialized, camera: { x: "1", y: 2, zoom: 3 } }).ok).toBe(false);
  });

  it("rejects an object missing id/name/type, or with a non-object slots", () => {
    const serialized = serializeDocument(createEmptyDocument());
    expect(deserializeDocument({ ...serialized, objects: [{ name: "x", type: "value", slots: {} }] }).ok).toBe(false);
    expect(deserializeDocument({ ...serialized, objects: [{ id: "obj_1", name: "x", type: "value", slots: null }] }).ok).toBe(false);
  });

  it("rejects a slot with an unrecognised kind, or a literal/formula missing its required field", () => {
    const serialized = serializeDocument(createEmptyDocument());
    const badKind = { ...serialized, objects: [{ id: "obj_1", name: "x", type: "value", slots: { value: { kind: "bogus" } } }] };
    expect(deserializeDocument(badKind).ok).toBe(false);
    const missingValue = { ...serialized, objects: [{ id: "obj_1", name: "x", type: "value", slots: { value: { kind: "literal" } } }] };
    expect(deserializeDocument(missingValue).ok).toBe(false);
    const missingAst = { ...serialized, objects: [{ id: "obj_1", name: "x", type: "value", slots: { value: { kind: "formula" } } }] };
    expect(deserializeDocument(missingAst).ok).toBe(false);
  });

  it("routes a formula slot at an undeclared path through mutate's own rejection — the shape a hand-edited file could carry today, since document.ts trusts a slot's content unchecked", () => {
    const objects: readonly GraphObject[] = [
      {
        id: "obj_1",
        name: "value_1",
        type: "value",
        slots: {
          value: { kind: "literal", value: 1 },
          bogus: { kind: "formula", ast: { type: "literal", value: 1 }, value: null },
        },
      },
    ];
    const serialized = serializeDocument({ ...createEmptyDocument(), objects });

    const result = deserializeDocument(serialized);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.bogus");
    }
  });

  it("routes a genuinely broken graph (dangling reference) through mutate's own rejection, which proves that a load applies objects through the mutation API", () => {
    const objects = [valueObject("obj_2", "value_2", 5), addObject("obj_3", "add_1", addr("obj_999", "value"), addr("obj_2", "value"))];
    const serialized = serializeDocument({ ...createEmptyDocument(), objects });

    const result = deserializeDocument(serialized);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
    }
  });

  it("rejects a document whose objects share a duplicate id, via the duplicate id check in mutate", () => {
    const serialized = serializeDocument({
      ...createEmptyDocument(),
      objects: [valueObject("obj_1", "value_1", 1), valueObject("obj_1", "value_1_dup", 2)],
    });

    const result = deserializeDocument(serialized);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("obj_1");
    }
  });

  it("rejects a document whose objects share a duplicate NAME (case-insensitively), via the duplicate name check in mutate", () => {
    const serialized = serializeDocument({
      ...createEmptyDocument(),
      objects: [valueObject("obj_1", "value_1", 1), valueObject("obj_2", "VALUE_1", 2)],
    });

    const result = deserializeDocument(serialized);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("VALUE_1");
      expect(result.message).toContain("already in use");
    }
  });

  it("rejects a document whose object name fails the name grammar, via the name check in mutate", () => {
    const serialized = serializeDocument({ ...createEmptyDocument(), objects: [valueObject("obj_1", "3bad", 1)] });

    const result = deserializeDocument(serialized);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not a valid name");
    }
  });

  it("never throws for any of the malformed inputs above", () => {
    expect(() => deserializeDocument(42)).not.toThrow();
    expect(() => deserializeDocument({})).not.toThrow();
    expect(() => deserializeDocument({ formatVersion: FORMAT_VERSION, objects: "nope" })).not.toThrow();
  });
});

describe("deserializeDocument — a loaded formula AST's SHAPE is validated at the boundary", () => {
  function documentWithRawAst(ast: unknown): unknown {
    return {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 2,
      camera: { x: 0, y: 0, zoom: 1 },
      journal: [],
      objects: [{ id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "formula", ast, value: null } } }],
    };
  }

  const MALFORMED_ASTS: readonly { readonly label: string; readonly ast: unknown }[] = [
    { label: "a null ast", ast: null },
    { label: "a binaryOp with null children", ast: { type: "binaryOp", operator: "+", left: null, right: null } },
    { label: "a binaryOp with absent children", ast: { type: "binaryOp", operator: "+" } },
    { label: "a functionCall whose args is not an array", ast: { type: "functionCall", name: "SUM", args: "nope" } },
    { label: "an ast that is a bare string", ast: "1 + 1" },
    { label: "an ast that is an array", ast: [{ type: "literal", value: 1 }] },
    { label: "a node with an unrecognised type", ast: { type: "conditional", cond: null } },
    { label: "a literal whose value is null", ast: { type: "literal", value: null } },
    { label: "a binaryOp with an operator the language does not have", ast: { type: "binaryOp", operator: "**", left: { type: "literal", value: 1 }, right: { type: "literal", value: 2 } } },
    { label: "a unaryOp with an operator the language does not have", ast: { type: "unaryOp", operator: "~", operand: { type: "literal", value: 1 } } },
    { label: "a reference whose address is missing objectId", ast: { type: "reference", address: { path: ["value"] } } },
    { label: "a reference whose path holds a non-string", ast: { type: "reference", address: { objectId: "obj_1", path: [1] } } },
    { label: "a range with one bad endpoint", ast: { type: "range", start: { objectId: "obj_1", path: ["cells", "A1"] }, end: null } },
    { label: "an error node naming an error that is not #REF", ast: { type: "error", error: "#VALUE" } },
    { label: "a malformed node nested INSIDE a well-formed one", ast: { type: "unaryOp", operator: "-", operand: { type: "binaryOp", operator: "+", left: { type: "literal", value: 1 }, right: null } } },
  ];

  for (const { label, ast } of MALFORMED_ASTS) {
    it(`refuses ${label} with a message, rather than throwing`, () => {
      let result: ReturnType<typeof deserializeDocument> | undefined;
      expect(() => {
        result = deserializeDocument(documentWithRawAst(ast));
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      if (result !== undefined && !result.ok) {
        expect(result.message).toContain("value_1.value");
      }
    });
  }

  it("still ACCEPTS every well-formed node shape, so the guard did not cost the format anything", () => {
    const wellFormed: readonly FormulaAst[] = [
      { type: "literal", value: 1 },
      { type: "literal", value: "text" },
      { type: "literal", value: true },
      { type: "reference", address: addr("obj_1", "value") },
      { type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A3") },
      { type: "binaryOp", operator: "+", left: { type: "literal", value: 1 }, right: { type: "literal", value: 2 } },
      { type: "unaryOp", operator: "NOT", operand: { type: "literal", value: true } },
      { type: "functionCall", name: "SUM", args: [{ type: "literal", value: 1 }] },
      { type: "functionCall", name: "NOW", args: [] },
      { type: "error", error: "#REF" },
    ];
    for (const ast of wellFormed) {
      const result = deserializeDocument(documentWithRawAst(ast));
      if (!result.ok) {
        expect(result.message).not.toContain("is not a formula node type");
        expect(result.message).not.toContain("must be an object, not");
      }
    }
  });

  it("round-trips a document whose formula ASTs use every node shape, byte for byte", () => {
    const table: GraphObject = {
      id: "obj_1",
      name: "table_1",
      type: "table",
      slots: {
        rows: { kind: "literal", value: 3 },
        cols: { kind: "literal", value: 3 },
        "cells.A1": { kind: "literal", value: 2 },
        "cells.B1": { kind: "formula", ast: { type: "unaryOp", operator: "-", operand: { type: "reference", address: addr("obj_1", "cells", "A1") } }, value: null },
        "cells.C1": { kind: "formula", ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A1") }] }, value: null },
      },
    };
    const evaluated = deriveValidateAndEvaluate([table]);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) {
      return;
    }
    const json = saveDocument({ ...createEmptyDocument(), nextObjectId: 2, objects: evaluated.objects });
    const loaded = loadDocument(json);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(saveDocument(loaded.document)).toBe(json);
    }
  });
});

describe("deserializeDocument — the SCHEMA says which derived slots exist, not the file", () => {
  function documentMissingADerivedSlot(): unknown {
    return {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 4,
      camera: { x: 0, y: 0, zoom: 1 },
      journal: [],
      objects: [
        { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 3 } } },
        { id: "obj_2", name: "value_2", type: "value", slots: { value: { kind: "literal", value: 4 } } },
        {
          id: "obj_3",
          name: "add_1",
          type: "add",
          slots: {
            "in.a": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_1", path: ["value"] } }, value: null },
            "in.b": { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["value"] } }, value: null },
          },
        },
      ],
    };
  }

  it("LOADS a document missing a schema-declared derived slot, instead of refusing it as corrupt", () => {
    const result = deserializeDocument(documentMissingADerivedSlot());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected it to load, got: ${result.message}`);
    }
  });

  it("rebuilds that slot as a real derived slot, and EVALUATES it — the value comes back from the compute", () => {
    const result = deserializeDocument(documentMissingADerivedSlot());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const added = result.document.objects.find((object) => object.name === "add_1");
    expect(added?.slots["out.result"]?.kind).toBe("derived");
    expect(added?.slots["out.result"]?.value).toBe(7);
  });

  it("DROPS a derived slot the file carries that this build's schema no longer declares, because the schema fixes every derived slot", () => {
    const stale = documentMissingADerivedSlot() as { objects: { slots: Record<string, unknown> }[] };
    stale.objects[2]!.slots["out.legacyResult"] = { kind: "derived" };
    const result = deserializeDocument(stale);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const added = result.document.objects.find((object) => object.name === "add_1");
      expect(added?.slots["out.legacyResult"]).toBeUndefined();
    }
  });

  it("does NOT overwrite a LITERAL sitting at a declared derived path, because the schema kind check still refuses it", () => {
    const wrongKind = documentMissingADerivedSlot() as { objects: { slots: Record<string, unknown> }[] };
    wrongKind.objects[2]!.slots["out.result"] = { kind: "literal", value: 99 };
    const result = deserializeDocument(wrongKind);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("out.result");
    }
  });

  it("leaves an object whose type has NO schema exactly as the file had it — the same honest-undefined stance the type string itself gets", () => {
    const unknownType = {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 2,
      camera: { x: 0, y: 0, zoom: 1 },
      journal: [],
      objects: [{ id: "obj_1", name: "thing_1", type: "notAType", slots: { anything: { kind: "derived" } } }],
    };
    const result = deserializeDocument(unknownType);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.objects[0]?.slots["anything"]?.kind).toBe("derived");
    }
  });

  it("does not disturb a document that already has every declared derived slot — the round-trip is unchanged", () => {
    const json = saveDocument({ ...createEmptyDocument(), nextObjectId: 4, objects: consistentFixture() });
    const loaded = loadDocument(json);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(saveDocument(loaded.document)).toBe(json);
    }
  });
});

describe("deserializeDocument — ports, structural validation only", () => {
  function documentWithPorts(ports: unknown, slots: Record<string, unknown> = {}): unknown {
    return {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 2,
      camera: { x: 0, y: 0, zoom: 1 },
      journal: [],
      objects: [{ id: "obj_1", name: "script_1", type: "script", slots, ports }],
    };
  }

  it("is ABSENT on a document with no ports field at all — every document saved before ports existed still loads", () => {
    const noPorts = { formatVersion: FORMAT_VERSION, nextObjectId: 2, camera: { x: 0, y: 0, zoom: 1 }, journal: [], objects: [{ id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 1 } } }] };
    const result = deserializeDocument(noPorts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.objects[0]?.ports).toBeUndefined();
    }
  });

  it("round-trips a well-formed ports field unchanged", () => {
    const result = deserializeDocument(
      documentWithPorts(
        { in: ["factor", "speed"], out: ["result"] },
        {
          "in.factor": { kind: "literal", value: 1 },
          "in.speed": { kind: "literal", value: 2 },
          "placeholder.result": { kind: "literal", value: 0 },
        },
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.objects[0]?.ports).toEqual({ in: ["factor", "speed"], out: ["result"] });
    }
  });

  /** A document holding one math object that solves for an unknown. */
  function documentWithMathPorts(ports: unknown): unknown {
    return {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 2,
      camera: { x: 0, y: 0, zoom: 1 },
      journal: [],
      objects: [
        {
          id: "obj_1",
          name: "math_1",
          type: "math",
          ports,
          slots: {
            "origin.x": { kind: "literal", value: 0 },
            "origin.y": { kind: "literal", value: 0 },
            source: { kind: "literal", value: "\\solve{x}x^2=9" },
            display: { kind: "literal", value: "source" },
            "seed.x": { kind: "literal", value: 2 },
            "out.x": { kind: "derived", value: 3 },
          },
        },
      ],
    };
  }

  it("round-trips the seed family of a math object", () => {
    const result = deserializeDocument(documentWithMathPorts({ in: [], out: ["x"], seed: ["x"] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.objects[0]?.ports).toEqual({ in: [], out: ["x"], seed: ["x"] });
      expect(result.document.objects[0]?.slots["seed.x"]).toEqual({ kind: "literal", value: 2 });
    }
  });

  it("is ABSENT on a ports field with no seed family, so a document saved before a source could solve still loads", () => {
    const result = deserializeDocument(documentWithPorts({ in: [], out: ["result"] }, { "placeholder.result": { kind: "literal", value: 0 } }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.objects[0]?.ports).not.toHaveProperty("seed");
    }
  });

  it("rejects a seed family that is not an array, and an illegal or repeated name in one", () => {
    expect(deserializeDocument(documentWithMathPorts({ in: [], out: ["x"], seed: "x" })).ok).toBe(false);
    expect(deserializeDocument(documentWithMathPorts({ in: [], out: ["x"], seed: ["a.b"] })).ok).toBe(false);
    expect(deserializeDocument(documentWithMathPorts({ in: [], out: ["x"], seed: ["x", "x"] })).ok).toBe(false);
  });

  it("rejects a ports field that is not an object with array in/out fields", () => {
    expect(deserializeDocument(documentWithPorts("nope")).ok).toBe(false);
    expect(deserializeDocument(documentWithPorts({ in: "not an array", out: [] })).ok).toBe(false);
    expect(deserializeDocument(documentWithPorts({ in: [] })).ok).toBe(false);
  });

  it("rejects an illegal port name — empty or containing '.'", () => {
    expect(deserializeDocument(documentWithPorts({ in: [""], out: [] })).ok).toBe(false);
    expect(deserializeDocument(documentWithPorts({ in: ["a.b"], out: [] })).ok).toBe(false);
  });

  it("rejects a dot-free port name outside address.ts's path-segment grammar", () => {
    expect(deserializeDocument(documentWithPorts({ in: ["my-port"], out: [] })).ok).toBe(false);
    expect(deserializeDocument(documentWithPorts({ in: ["my port"], out: [] })).ok).toBe(false);
  });

  it("rejects a duplicate name WITHIN the same family", () => {
    expect(deserializeDocument(documentWithPorts({ in: ["factor", "factor"], out: [] })).ok).toBe(false);
  });

  it("ALLOWS the same name across DIFFERENT families — 'in' and 'out' are independent namespaces", () => {
    const withPorts = documentWithPorts(
      { in: ["result"], out: ["result"] },
      { "in.result": { kind: "literal", value: 1 }, "placeholder.result": { kind: "literal", value: 0 } },
    );
    expect(deserializeDocument(withPorts).ok).toBe(true);
  });

  it("round-trips through save/load unchanged (saveDocument(loadDocument(json)) === json)", () => {
    const json = JSON.stringify(
      documentWithPorts(
        { in: ["factor"], out: ["result"] },
        { "in.factor": { kind: "literal", value: 1 }, "placeholder.result": { kind: "literal", value: 0 } },
      ),
    );
    const loaded = loadDocument(json);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const expected = JSON.parse(json) as { objects: { slots: Record<string, unknown> }[] };
      const expectedSlots = expected.objects[0]?.slots;
      if (expectedSlots !== undefined) {
        expectedSlots["out.result"] = { kind: "derived" };
      }
      expect(JSON.parse(saveDocument(loaded.document)) as unknown).toEqual(expected);
    }
  });
});

describe("deserializeDocument — vertexCount, structural validation only", () => {
  function documentWithVertexCount(vertexCount: unknown, slots: Record<string, unknown> = {}): unknown {
    return {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 2,
      camera: { x: 0, y: 0, zoom: 1 },
      journal: [],
      objects: [{ id: "obj_1", name: "polyline_1", type: "polyline", slots, vertexCount }],
    };
  }

  it("is ABSENT on a document with no vertexCount field at all — every document saved before polyline existed still loads", () => {
    const noVertexCount = { formatVersion: FORMAT_VERSION, nextObjectId: 2, camera: { x: 0, y: 0, zoom: 1 }, journal: [], objects: [{ id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 1 } } }] };
    const result = deserializeDocument(noVertexCount);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.objects[0]?.vertexCount).toBeUndefined();
    }
  });

  it("round-trips a well-formed vertexCount unchanged", () => {
    const result = deserializeDocument(
      documentWithVertexCount(2, {
        "vertex.0.x": { kind: "literal", value: 0 },
        "vertex.0.y": { kind: "literal", value: 0 },
        "vertex.1.x": { kind: "literal", value: 10 },
        "vertex.1.y": { kind: "literal", value: 0 },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.objects[0]?.vertexCount).toBe(2);
    }
  });

  it("rejects a vertexCount that is not a non-negative integer", () => {
    expect(deserializeDocument(documentWithVertexCount("2")).ok).toBe(false);
    expect(deserializeDocument(documentWithVertexCount(-1)).ok).toBe(false);
    expect(deserializeDocument(documentWithVertexCount(1.5)).ok).toBe(false);
  });

  it("rejects a non-finite or -0 vertexCount, the same illegal number rule every other field follows", () => {
    expect(deserializeDocument(documentWithVertexCount(Number.POSITIVE_INFINITY)).ok).toBe(false);
    expect(deserializeDocument(documentWithVertexCount(-0)).ok).toBe(false);
  });

  it("round-trips through save/load unchanged (saveDocument(loadDocument(json)) === json)", () => {
    const json = JSON.stringify(
      documentWithVertexCount(2, {
        "vertex.0.x": { kind: "literal", value: 0 },
        "vertex.0.y": { kind: "literal", value: 0 },
        "vertex.1.x": { kind: "literal", value: 10 },
        "vertex.1.y": { kind: "literal", value: 0 },
      }),
    );
    const loaded = loadDocument(json);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const expected = JSON.parse(json) as { objects: { slots: Record<string, unknown> }[] };
      const expectedSlots = expected.objects[0]?.slots;
      if (expectedSlots !== undefined) {
        expectedSlots["centroid.x"] = { kind: "derived" };
        expectedSlots["centroid.y"] = { kind: "derived" };
        expectedSlots["area"] = { kind: "derived" };
        expectedSlots["length"] = { kind: "derived" };
        expectedSlots["bounds.minX"] = { kind: "derived" };
        expectedSlots["bounds.minY"] = { kind: "derived" };
        expectedSlots["bounds.maxX"] = { kind: "derived" };
        expectedSlots["bounds.maxY"] = { kind: "derived" };
        expectedSlots["vertices"] = { kind: "derived" };
      }
      expect(JSON.parse(saveDocument(loaded.document)) as unknown).toEqual(expected);
    }
  });
});

describe("deserializeDocument — the same value rules on the journal, read side", () => {
  it("rejects a document whose JOURNAL holds a raw non-finite number — probe I: the SAME 1e999 that is rejected in the object list must also be rejected here, not silently corrupted on the next save", () => {
    const parsed = JSON.parse(
      `{"formatVersion":${FORMAT_VERSION},"nextObjectId":1,"objects":[],"journal":[{"operations":[{"kind":"setSlot","address":{"objectId":"obj_1","path":["value"]},"slot":{"kind":"literal","value":1e999}}]}],"camera":{"x":0,"y":0,"zoom":1}}`,
    ) as unknown;

    const result = deserializeDocument(parsed);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("journal");
      expect(result.message).toContain("not legal document state");
    }
  });

  it("rejects a document whose journal holds -0, nested inside a Point", () => {
    const document = {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 1,
      objects: [],
      journal: [{ operations: [{ kind: "setSlot", address: { objectId: "obj_1", path: ["origin"] }, slot: { kind: "literal", value: { x: -0, y: 1 } } }] }],
      camera: { x: 0, y: 0, zoom: 1 },
    };

    const result = deserializeDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not legal document state");
    }
  });

  it("rejects an illegal number inside a createObject payload sitting in the journal, even though a deleteObject in the SAME entry removes it", () => {
    const document = {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 1,
      objects: [],
      journal: [
        {
          operations: [
            { kind: "createObject", object: { id: "obj_9", name: "value_9", type: "value", slots: { value: { kind: "literal", value: NaN } } } },
            { kind: "deleteObject", objectId: "obj_9" },
          ],
        },
      ],
      camera: { x: 0, y: 0, zoom: 1 },
    };

    const result = deserializeDocument(document);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not legal document state");
    }
  });

  it("does NOT reject a structurally garbled journal that happens to contain no illegal numbers — value-legality and structural validity are separate, and structure stays deliberately unvalidated (see file header)", () => {
    const document = {
      formatVersion: FORMAT_VERSION,
      nextObjectId: 1,
      objects: [],
      journal: ["garbage", 42, null],
      camera: { x: 0, y: 0, zoom: 1 },
    };

    const result = deserializeDocument(document);

    expect(result.ok).toBe(true);
  });
});

describe("deserializeDocument — the same value rule over the other numeric fields", () => {
  const legal = { formatVersion: FORMAT_VERSION, nextObjectId: 1, objects: [], journal: [], camera: { x: 0, y: 0, zoom: 1 } };

  it("rejects a camera whose zoom is non-finite (a file written as 1e999 parses to Infinity)", () => {
    const json = JSON.stringify(legal).replace('"zoom":1', '"zoom":1e999');

    const result = loadDocument(json);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("camera");
      expect(result.message).toContain("not legal document state");
    }
  });

  it("rejects a camera coordinate of -0, which JSON writes back as 0", () => {
    const result = deserializeDocument({ ...legal, camera: { x: -0, y: 0, zoom: 1 } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("camera");
    }
  });

  it("rejects a nextObjectId of -0 — Number.isInteger accepts it, JSON writes it back as 0", () => {
    const result = deserializeDocument({ ...legal, nextObjectId: -0 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("nextObjectId");
    }
  });

  it("still accepts a legal camera and counter, so the checks are not over-broad", () => {
    const result = deserializeDocument({ ...legal, nextObjectId: 0, camera: { x: -12.5, y: 0, zoom: 0.25 } });

    expect(result.ok).toBe(true);
  });
});

describe("deserializeDocument — a loaded AST has its depth checked once, at the load boundary", () => {
  function ladder(levels: number): FormulaAst {
    let ast: FormulaAst = { type: "literal", value: 1 };
    for (let index = 0; index < levels; index += 1) {
      ast = { type: "binaryOp", operator: "+", left: ast, right: { type: "literal", value: 1 } };
    }
    return ast;
  }

  function documentWithFormula(ast: FormulaAst): unknown {
    return {
      ...serializeDocument(createEmptyDocument()),
      objects: [{ id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "formula", ast, value: null } } }],
    };
  }

  it("accepts a formula slot's AST exactly at MAX_FORMULA_AST_DEPTH — the ceiling is not off by one", () => {
    const result = deserializeDocument(documentWithFormula(ladder(MAX_FORMULA_AST_DEPTH - 1)));
    expect(result.ok).toBe(true);
  });

  it("rejects a formula slot's AST one level past MAX_FORMULA_AST_DEPTH, naming the object and slot, with parser.ts's own vocabulary", () => {
    const result = deserializeDocument(documentWithFormula(ladder(MAX_FORMULA_AST_DEPTH)));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
      expect(result.message).toContain(`more than ${MAX_FORMULA_AST_DEPTH} nested operations`);
    }
  });

  it("never throws a RangeError for an ADVERSARIALLY deep AST (40,000 levels) — the size that broke this recursion's siblings (parser.ts, format.ts) before their own guards existed", () => {
    expect(() => deserializeDocument(documentWithFormula(ladder(40_000)))).not.toThrow();
    expect(deserializeDocument(documentWithFormula(ladder(40_000))).ok).toBe(false);
  });

  it("rejects the too-deep AST before mutate ever runs — the message names the DEPTH problem, not a dangling reference or an evaluation failure", () => {
    const result = deserializeDocument(documentWithFormula(ladder(MAX_FORMULA_AST_DEPTH)));
    expect(result.ok === false && result.message.includes("nested operations")).toBe(true);
  });
});

describe("deserializeDocument / loadDocument forward the EvalContext to the load batch", () => {
  function textObject(width: number | "auto" = "auto"): GraphObject {
    return {
      id: "obj_1",
      name: "text_1",
      type: "text",
      slots: {
        content: { kind: "literal", value: "loaded text" },
        width: { kind: "literal", value: width },
        "style.font": { kind: "literal", value: "sans" },
        "style.fontSize": { kind: "literal", value: 12 },
        "style.lineHeight": { kind: "literal", value: 14 },
        resolvedContent: { kind: "derived", value: null },
        measuredHeight: { kind: "derived", value: null },
        measuredWidth: { kind: "derived", value: null },
      },
    };
  }

  function savedDocumentWithText(width: number | "auto" = "auto"): string {
    return saveDocument({ ...createEmptyDocument(), nextObjectId: 1, objects: [textObject(width)] });
  }

  function measuredHeightOf(result: ReturnType<typeof loadDocument>): unknown {
    if (!result.ok) {
      throw new Error(result.message);
    }
    return result.document.objects.find((object) => object.id === "obj_1")?.slots.measuredHeight?.value;
  }

  const realMeasurer: EvalContext = { measurer: { measure: () => ({ width: 4, height: 55 }) } };

  it("regenerates measuredHeight as #MEASURE with no context and as a real height once a measurer is threaded", () => {
    const json = savedDocumentWithText();
    expect(measuredHeightOf(loadDocument(json))).toMatchObject({ error: "#MEASURE" });
    expect(measuredHeightOf(loadDocument(json, realMeasurer))).toBe(55);
  });

  it("deserializeDocument takes the same context as its second argument", () => {
    const raw = JSON.parse(savedDocumentWithText());
    expect(measuredHeightOf(deserializeDocument(raw, realMeasurer))).toBe(55);
  });

  it("passes a numeric `width` through as maxWidth on load", () => {
    const wrapAware: EvalContext = {
      measurer: { measure: (_text, _style, maxWidth) => ({ width: 0, height: maxWidth === undefined ? 10 : 20 }) },
    };
    expect(measuredHeightOf(loadDocument(savedDocumentWithText(200), wrapAware))).toBe(20);
  });
});
