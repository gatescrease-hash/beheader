/**
 * document.test.ts — Tests for §5.11's save/load format, closing PROJECT_BRIEF
 * §6 Phase 0 acceptance clause 4 ("a document round-trips to JSON and back
 * identically").
 *
 * Colocated with document.ts per D-001. Fixtures are built by hand, matching
 * `mutation.test.ts`'s own convention — but round-trip fixtures are first run
 * through `deriveValidateAndEvaluate` so their formula/derived caches are
 * ALREADY correct before being saved; otherwise a "round-trip" test would be
 * comparing against a deliberately-stale fixture rather than the document's
 * true, internally-consistent state (evaluate() always recomputes on load,
 * so a stale input fixture would legitimately differ after reload — that
 * would be a bug in the TEST, not in document.ts).
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
import type { GraphObject } from "./graph/node.ts";

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

/** PROJECT_BRIEF §6's value/add fixture, already evaluated (see file header). */
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

describe("serializeDocument — drops every derived slot's value (§5.11)", () => {
  it("omits `value` from a derived slot, but keeps literal/formula slots (including their cached value) unchanged", () => {
    const document: Document = { ...createEmptyDocument(), objects: consistentFixture() };

    const serialized = serializeDocument(document);

    const add1 = serialized.objects.find((object) => object.id === "obj_3");
    expect(add1?.slots["out.result"]).toEqual({ kind: "derived" });
    expect(Object.keys(add1?.slots["out.result"] ?? {})).toEqual(["kind"]);
    expect(add1?.slots["in.a"]).toMatchObject({ kind: "formula", value: 3 });
  });
});

describe("saveDocument / loadDocument — round-trips to JSON and back identically (PROJECT_BRIEF §6 clause 4)", () => {
  it("round-trips PROJECT_BRIEF §6's value/add fixture — objects, nextObjectId, journal, and camera all identical", () => {
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

  it("round-trips an empty document (zero objects) without ever calling mutate's batch API", () => {
    const document = createEmptyDocument();

    const result = loadDocument(saveDocument(document));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document).toEqual(document);
    }
  });

  it("re-evaluates on load rather than trusting a stale cached formula/derived value sitting in the file", () => {
    // Simulates drift/tampering: the file's own cached in.a value disagrees
    // with what value_1.value actually holds. Loading must recompute, not
    // trust the file — §5.11: "then evaluates."
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
    expect(reloadedAdd1?.slots["in.a"]).toMatchObject({ value: 3 }); // recomputed from value_1, not the tampered 999
    expect(reloadedAdd1?.slots["out.result"]).toEqual({ kind: "derived", value: 7 });
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
    expect(deserializeDocument({ ...serialized, camera: { x: 1, y: 2 } }).ok).toBe(false); // missing zoom
    expect(deserializeDocument({ ...serialized, camera: { x: "1", y: 2, zoom: 3 } }).ok).toBe(false);
  });

  it("rejects an object missing id/name/type, or with a non-object slots", () => {
    const serialized = serializeDocument(createEmptyDocument());
    expect(deserializeDocument({ ...serialized, objects: [{ name: "x", type: "value", slots: {} }] }).ok).toBe(false); // missing id
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

  it("routes a genuinely broken graph (dangling reference) through mutate's own rejection — proving §5.11's 'applies objects through the mutation API' end-to-end", () => {
    const objects = [valueObject("obj_2", "value_2", 5), addObject("obj_3", "add_1", addr("obj_999", "value"), addr("obj_2", "value"))];
    const serialized = serializeDocument({ ...createEmptyDocument(), objects });

    const result = deserializeDocument(serialized);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
    }
  });

  it("rejects a document whose objects share a duplicate id, via mutate's own D-002/D-021 check", () => {
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

  it("never throws for any of the malformed inputs above", () => {
    expect(() => deserializeDocument(42)).not.toThrow();
    expect(() => deserializeDocument({})).not.toThrow();
    expect(() => deserializeDocument({ formatVersion: FORMAT_VERSION, objects: "nope" })).not.toThrow();
  });
});
