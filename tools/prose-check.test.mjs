import { spawnSync } from "node:child_process";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const checker = fileURLToPath(new URL("./prose-check.mjs", import.meta.url));

test("an unreadable target fails even when another file is clean", () => {
  const directory = mkdtempSync(join(tmpdir(), "beheader-prose-"));
  const clean = join(directory, "clean.md");
  try {
    writeFileSync(clean, "The document stores objects.\n");
    const result = spawnSync(process.execPath, [checker, clean, join(directory, "missing.md")], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot read/);
  } finally {
    unlinkSync(clean);
    rmdirSync(directory);
  }
});

test("clean prose succeeds", () => {
  const result = spawnSync(process.execPath, [checker, "src/engine/journal.ts"], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
