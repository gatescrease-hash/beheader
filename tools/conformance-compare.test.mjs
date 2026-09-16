import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

import { comparisonOf, firstDifference } from "./conformance-compare.mjs";

const tool = fileURLToPath(new URL("./conformance-compare.mjs", import.meta.url));

const SAMPLES = "tests/conformance/comparator";

function run(rustResults) {
  const result = spawnSync(
    process.execPath,
    [tool, "--typescript", `${SAMPLES}/match.typescript.json`, "--rust", rustResults],
    { encoding: "utf8" },
  );
  assert.ifError(result.error);
  return result;
}

const EXACT = { kind: "exact" };

test("two answers that agree have no difference", () => {
  assert.equal(firstDifference({ status: "ok", value: [1, 2] }, { status: "ok", value: [1, 2] }, EXACT, "outcome"), undefined);
});

test("the order of the members of an object is not part of an answer", () => {
  const left = { status: "ok", value: { x: 1, y: 2 } };
  const right = { value: { y: 2, x: 1 }, status: "ok" };
  assert.equal(firstDifference(left, right, EXACT, "outcome"), undefined);
});

test("the order of a list is part of an answer", () => {
  const difference = firstDifference([1, 2], [2, 1], EXACT, "outcome");
  assert.equal(difference?.path, "outcome[0]");
});

test("a member one side is missing is reported where it is missing", () => {
  const difference = firstDifference({ a: 1 }, { a: 1, b: 2 }, EXACT, "outcome");
  assert.equal(difference?.path, "outcome.b");
});

test("a negative zero does not pass for a zero", () => {
  const difference = firstDifference({ value: -0 }, { value: 0 }, EXACT, "outcome");
  assert.equal(difference?.path, "outcome.value");
});

test("an exact policy refuses a number that is nearly right", () => {
  const difference = firstDifference({ value: 1 }, { value: 1.0000001 }, EXACT, "outcome");
  assert.equal(difference?.path, "outcome.value");
});

test("an approximate policy accepts a number inside its bounds and refuses one outside", () => {
  const policy = comparisonOf({ comparison: { kind: "approximate", absTolerance: 1e-9, relTolerance: 1e-9 } });
  assert.equal(policy.kind, "approximate");
  assert.equal(firstDifference({ value: 1 }, { value: 1 + 5e-10 }, policy, "outcome"), undefined);
  assert.equal(firstDifference({ value: 1 }, { value: 1.001 }, policy, "outcome")?.path, "outcome.value");
});

test("a fixture with no policy compares exactly", () => {
  assert.deepEqual(comparisonOf(undefined), EXACT);
  assert.deepEqual(comparisonOf({}), EXACT);
});

test("a policy nobody implements is not silently treated as exact", () => {
  assert.equal(comparisonOf({ comparison: { kind: "whatever" } }).kind, "unknown");
});

test("a known match reports every case matched", () => {
  const result = run(`${SAMPLES}/match.rust.json`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /3 matched, 0 differed/);
});

test("a deliberate mismatch fails and names where the two differ", () => {
  const result = run(`${SAMPLES}/mismatch.rust.json`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /differs: model\.slot-key case 0 \(slotKey\)/);
  assert.match(result.stderr, /at outcome\.value/);
  assert.match(result.stderr, /typescript: "vertex\.0\.x"/);
  assert.match(result.stderr, /rust: *"vertex\/0\/x"/);
});

test("a call the Rust engine cannot answer is counted apart from a pass", () => {
  const result = run(`${SAMPLES}/unsupported.rust.json`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /2 matched, 0 differed, 1 awaiting Rust/);
  assert.match(result.stdout, /no Rust implementation yet: numberToText/);
});

test("two runs that fell out of step fail rather than compare what is left", () => {
  const result = run(`${SAMPLES}/misaligned.rust.json`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /misaligned:/);
});

test("a results file that names the wrong engine fails", () => {
  const result = spawnSync(
    process.execPath,
    [tool, "--typescript", `${SAMPLES}/match.rust.json`, "--rust", `${SAMPLES}/match.rust.json`],
    { encoding: "utf8" },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /name the engines/);
});
