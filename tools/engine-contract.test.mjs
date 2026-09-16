import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const tool = fileURLToPath(new URL("./engine-contract.mjs", import.meta.url));

const INVENTORY = "tests/conformance/contract/inventory.json";

const DISPOSITIONS = "tests/conformance/contract/dispositions.json";

function run(...args) {
  const result = spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" });
  assert.ifError(result.error);
  return result;
}

/**
 * Runs the check against a copy of one of the two files, so a deliberately
 * spoiled copy proves the check reports the fault without the committed pair
 * changing on disk.
 */
function withCopy(source, edit, body) {
  const directory = mkdtempSync(join(tmpdir(), "beheader-contract-"));
  const copy = join(directory, "copy.json");
  try {
    writeFileSync(copy, JSON.stringify(edit(JSON.parse(readFileSync(source, "utf8"))), null, 2));
    body(copy);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the committed inventory agrees with the source", () => {
  const result = run("--check");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a name a production file imports needs a disposition", () => {
  withCopy(DISPOSITIONS, (document) => {
    delete document.dispositions["mutate"];
    return document;
  }, (copy) => {
    const result = run("--check", `--dispositions=${copy}`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /"mutate" is imported by a production file and has no disposition/);
  });
});

test("a disposition for a name the engine no longer exports is a fault", () => {
  withCopy(DISPOSITIONS, (document) => {
    document.dispositions["thereIsNoSuchExport"] = "host-query";
    return document;
  }, (copy) => {
    const result = run("--check", `--dispositions=${copy}`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /"thereIsNoSuchExport" has a disposition and the engine no longer exports it/);
  });
});

test("a disposition outside the six is a fault", () => {
  withCopy(DISPOSITIONS, (document) => {
    document.dispositions["mutate"] = "whatever";
    return document;
  }, (copy) => {
    const result = run("--check", `--dispositions=${copy}`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /which is not one of the six/);
  });
});

test("a type recorded as an operation is a fault", () => {
  withCopy(DISPOSITIONS, (document) => {
    document.dispositions["GraphObject"] = "core-operation";
    return document;
  }, (copy) => {
    const result = run("--check", `--dispositions=${copy}`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /"GraphObject" has no runtime value and is recorded as "core-operation"/);
  });
});

test("a changed variant in the committed inventory reports where it differs", () => {
  withCopy(INVENTORY, (document) => {
    document.variants.Operation = document.variants.Operation.filter((kind) => kind !== "splitEdge");
    return document;
  }, (copy) => {
    const result = run("--check", `--inventory=${copy}`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /disagrees with the source at variants\.Operation/);
  });
});

test("an unreadable inventory fails the check", () => {
  const result = run("--check", "--inventory=tests/conformance/contract/no-such-file.json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot read/);
});
