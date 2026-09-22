/**
 * differential.test.ts
 *
 * These tests cover deterministic scenario generation, the structural
 * comparison rules, and the proof that an evaluation strategy which leaves
 * cached formula values stale fails the differential runner.
 */

import { describe, expect, it } from "vitest";
import {
  assertMutationDifferential,
  compareDifferentialValues,
  generateMutationScenario,
  runMutationDifferential,
} from "./differential.ts";
import { NULL_EVAL_CONTEXT } from "./eval-context.ts";
import type { GraphObject } from "./graph/node.ts";
import {
  createIncrementalEvaluationStrategy,
  FULL_EVALUATION_STRATEGY,
  INCREMENTAL_EVALUATION_STRATEGY,
  mutate,
  type EvaluationStrategy,
  type MutationResult,
} from "./mutation.ts";

describe("compareDifferentialValues", () => {
  it("normalizes object key order while retaining array order", () => {
    expect(compareDifferentialValues(
      { second: 2, first: [1, 2, 3] },
      { first: [1, 2, 3], second: 2 },
    )).toBeUndefined();

    expect(compareDifferentialValues([1, 2, 3], [1, 3, 2])).toMatchObject({
      path: [1],
      expected: 2,
      actual: 3,
    });
  });

  it("compares numbers exactly by default, including the sign of zero", () => {
    expect(compareDifferentialValues(1, 1 + Number.EPSILON)).toMatchObject({
      reason: "numeric values differ",
    });
    expect(compareDifferentialValues(0, -0)).toMatchObject({
      reason: "numeric values differ",
    });
    expect(compareDifferentialValues(0, -0, {
      numericTolerances: [{ path: [], absTolerance: 1, relTolerance: 1 }],
    })).toMatchObject({ reason: "numeric values differ" });
  });

  it("applies absolute and relative tolerance only at the exact named path", () => {
    const policy = {
      numericTolerances: [{
        path: ["objects", 0, "slots", "value", "value"],
        absTolerance: 0.001,
        relTolerance: 0.01,
      }],
    } as const;
    const expected = { objects: [{ slots: { value: { value: 100 } } }], untouched: 100 };

    expect(compareDifferentialValues(
      expected,
      { objects: [{ slots: { value: { value: 100.5 } } }], untouched: 100 },
      policy,
    )).toBeUndefined();
    expect(compareDifferentialValues(
      expected,
      { objects: [{ slots: { value: { value: 100 } } }], untouched: 100.5 },
      policy,
    )).toMatchObject({ path: ["untouched"] });
  });

  it("keeps journal entries, broken-slot order and refusal text exact", () => {
    const success: MutationResult = {
      ok: true,
      objects: [],
      journal: [{ operations: [] }],
      brokenSlots: [
        { objectId: "obj_1", path: ["a"] },
        { objectId: "obj_2", path: ["b"] },
      ],
    };
    expect(compareDifferentialValues(success, {
      ...success,
      brokenSlots: [...success.brokenSlots].reverse(),
    })).toMatchObject({ path: ["brokenSlots", 0, "objectId"] });
    expect(compareDifferentialValues(success, {
      ...success,
      journal: [],
    })).toMatchObject({ path: ["journal"] });
    expect(compareDifferentialValues(
      { ok: false, message: "first refusal" },
      { ok: false, message: "second refusal" },
    )).toMatchObject({ path: ["message"] });
  });
});

describe("generateMutationScenario", () => {
  it("repeats a seed exactly and changes the generated case for another seed", () => {
    expect(generateMutationScenario(42)).toEqual(generateMutationScenario(42));
    expect(generateMutationScenario(42)).not.toEqual(generateMutationScenario(43));
  });

  it("includes successful batches, refusals and a forced repair", () => {
    const scenario = generateMutationScenario(7, { objectCount: 5, editBatchCount: 3 });
    expect(scenario.batches.some((batch) => batch.some((operation) =>
      operation.kind === "setSlot"
      && operation.slot.kind === "formula"
      && operation.slot.ast.type === "reference"
      && operation.slot.ast.address.objectId === "missing"))).toBe(true);
    expect(scenario.batches.at(-1)).toEqual([
      { kind: "deleteObject", objectId: "obj_1", force: true },
    ]);

    let objects = scenario.initialObjects;
    let journal = scenario.initialJournal;
    let sawRefusal = false;
    let sawBrokenSlots = false;
    for (const batch of scenario.batches) {
      const result = mutate(objects, batch, journal);
      if (!result.ok) {
        sawRefusal = true;
        continue;
      }
      sawBrokenSlots ||= result.brokenSlots.length > 0;
      objects = result.objects;
      journal = result.journal;
    }
    expect(sawRefusal).toBe(true);
    expect(sawBrokenSlots).toBe(true);
  });
});

describe("runMutationDifferential", () => {
  it("keeps incremental evaluation equal to full recomputation across generated documents", () => {
    for (const seed of [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 42, 8675309]) {
      expect(runMutationDifferential(
        generateMutationScenario(seed),
        FULL_EVALUATION_STRATEGY,
        INCREMENTAL_EVALUATION_STRATEGY,
      )).toEqual({ ok: true });
    }
  });

  it("evaluates a fixed dirty region as unrelated slot count grows", () => {
    const evaluatedCounts = [10, 100, 1000].map((unrelatedCount) => {
      const source: GraphObject = {
        id: "source",
        name: "source",
        type: "value",
        slots: { value: { kind: "literal", value: 1 } },
      };
      const dependent: GraphObject = {
        id: "dependent",
        name: "dependent",
        type: "value",
        slots: {
          value: {
            kind: "formula",
            ast: { type: "reference", address: { objectId: "source", path: ["value"] } },
            value: null,
          },
        },
      };
      const unrelated: GraphObject = {
        id: "unrelated",
        name: "unrelated",
        type: "table",
        slots: {
          rows: { kind: "literal", value: unrelatedCount },
          cols: { kind: "literal", value: 1 },
          ...Object.fromEntries(Array.from({ length: unrelatedCount }, (_, index) => [
            `cells.A${index + 1}`,
            { kind: "literal", value: index },
          ])),
        },
      };
      const created = mutate(
        [],
        [source, dependent, unrelated].map((object) => ({ kind: "createObject", object }) as const),
        [],
        NULL_EVAL_CONTEXT,
        FULL_EVALUATION_STRATEGY,
      );
      if (!created.ok) throw new Error(created.message);
      const operation = {
        kind: "setSlot",
        address: { objectId: "source", path: ["value"] },
        slot: { kind: "literal", value: 2 },
      } as const;
      const evaluated: string[] = [];
      const incremental = mutate(
        created.objects,
        [operation],
        created.journal,
        NULL_EVAL_CONTEXT,
        createIncrementalEvaluationStrategy((address) => evaluated.push(`${address.objectId}.${address.path.join(".")}`)),
      );
      const full = mutate(
        created.objects,
        [operation],
        created.journal,
        NULL_EVAL_CONTEXT,
        FULL_EVALUATION_STRATEGY,
      );
      expect(incremental).toEqual(full);
      expect(evaluated).toEqual(["source.value", "dependent.value"]);
      return evaluated.length;
    });

    expect(evaluatedCounts).toEqual([2, 2, 2]);
  });

  it("turns a deliberate stale-value strategy into a differential failure", () => {
    const staleStrategy: EvaluationStrategy = ({ stagedObjects }) => stagedObjects;
    const scenario = generateMutationScenario(1234);
    const result = runMutationDifferential(
      scenario,
      FULL_EVALUATION_STRATEGY,
      staleStrategy,
    );

    expect(result).toMatchObject({
      ok: false,
      seed: 1234,
      batchIndex: 0,
      mismatch: { reason: "values differ" },
    });
    expect(() => assertMutationDifferential(
      scenario,
      FULL_EVALUATION_STRATEGY,
      staleStrategy,
    )).toThrow(/differential mismatch for seed 1234, batch 0, \$\.objects/);
  });
});
