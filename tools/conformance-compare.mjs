#!/usr/bin/env node
/**
 * conformance-compare.mjs
 *
 * Sends the shared fixtures to both engines and puts the answers side by side.
 * With no options it runs the TypeScript runner and the Rust runner itself,
 * into a scratch directory, and compares what they wrote.
 *
 *   node tools/conformance-compare.mjs
 *   node tools/conformance-compare.mjs --typescript <file> --rust <file>
 *
 * The second form compares two results files that already exist, which is how
 * the test drives a known match and a deliberate mismatch through the
 * comparator without a Rust toolchain.
 *
 * A case has one of four fates. It matches, it differs, it is one the Rust
 * engine cannot answer yet, or it is one neither engine answers. The third
 * is the ordinary state of most of the engine while the port runs, so it is
 * counted and listed rather than treated as a pass or as a failure. A
 * difference is a failure, and so is a fixture that one runner answered and
 * the other did not reach at all.
 *
 * Two answers compare by structure. The key order of an object is not part of
 * the answer, because one engine sorts the keys of a JSON object and the other
 * keeps the order they were written in. The order of an array is part of the
 * answer, because the order of a list of points, of candidates and of journal
 * entries is behaviour a document depends on. A number compares by Object.is,
 * so a negative zero never passes for a zero.
 *
 * Tooling code that runs under Node outside the application, so it has no part
 * in the browser bundle.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FIXTURES = "tests/conformance/fixtures";

const MANIFEST = "tests/conformance/manifest.json";

const INVENTORY = "tests/conformance/contract/inventory.json";

function option(name, fallback) {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }
  const inline = args.find((argument) => argument.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(`--${name}=`.length);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

/**
 * The comparison policy of a fixture. An exact policy is the default, and an
 * approximate one carries its own bounds, because a tolerance that covered a
 * whole document would hide a wrong answer beside a transcendental one.
 */
export function comparisonOf(fixture) {
  const policy = fixture?.comparison ?? "exact";
  if (policy === "exact") {
    return { kind: "exact" };
  }
  if (policy?.kind === "approximate") {
    return {
      kind: "approximate",
      absTolerance: Number(policy.absTolerance ?? 0),
      relTolerance: Number(policy.relTolerance ?? 0),
    };
  }
  return { kind: "unknown", policy };
}

function numbersAgree(expected, actual, policy) {
  if (Object.is(expected, actual)) {
    return true;
  }
  if (policy.kind !== "approximate" || typeof expected !== "number" || typeof actual !== "number") {
    return false;
  }
  return Math.abs(actual - expected) <= policy.absTolerance + policy.relTolerance * Math.abs(expected);
}

/** The first place two answers differ, as a path a reader can follow. */
export function firstDifference(expected, actual, policy, path) {
  if (typeof expected === "number" || typeof actual === "number") {
    return numbersAgree(expected, actual, policy) ? undefined : { path, expected, actual };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      return { path, expected, actual };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], policy, `${path}[${index}]`);
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }
  const bothObjects =
    typeof expected === "object" && expected !== null && typeof actual === "object" && actual !== null;
  if (bothObjects) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) {
        return { path: `${path}.${key}`, expected: expected[key], actual: actual[key] };
      }
      const difference = firstDifference(expected[key], actual[key], policy, `${path}.${key}`);
      if (difference !== undefined) {
        return difference;
      }
    }
    return undefined;
  }
  return expected === actual ? undefined : { path, expected, actual };
}

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

/**
 * Checks the manifest against what is on disk and against the engine modules
 * the contract inventory found. Every fixture file appears once, every module
 * is either covered by a fixture or listed as not covered yet, and no module
 * is in both places. A new engine file therefore fails this check until
 * somebody decides which of the two it belongs in.
 */
function checkManifest(fixturesDirectory) {
  const problems = [];
  const manifest = readJson(resolve(ROOT, MANIFEST));
  const onDisk = readdirSync(fixturesDirectory)
    .filter((name) => extname(name) === ".json")
    .sort();
  const listed = manifest.fixtures.map((entry) => entry.file.replace(/^fixtures\//, ""));

  for (const name of onDisk) {
    if (!listed.includes(name)) {
      problems.push(`${name} is a fixture the manifest does not list`);
    }
  }
  for (const entry of manifest.fixtures) {
    const name = entry.file.replace(/^fixtures\//, "");
    if (!onDisk.includes(name)) {
      problems.push(`${entry.file} is in the manifest and not on disk`);
      continue;
    }
    const fixture = readJson(join(fixturesDirectory, name));
    if (fixture.id !== entry.id) {
      problems.push(`${entry.file} holds the id "${fixture.id}" and the manifest says "${entry.id}"`);
    }
  }

  const covered = new Set(manifest.fixtures.flatMap((entry) => entry.covers));
  const uncovered = new Set(manifest.modulesWithoutFixtures);
  const modules = readJson(resolve(ROOT, INVENTORY)).modules.map((entry) => entry.file);
  for (const module of modules) {
    const inCovered = covered.has(module);
    const inUncovered = uncovered.has(module);
    if (!inCovered && !inUncovered) {
      problems.push(`${module} is an engine module the manifest accounts for nowhere`);
    }
    if (inCovered && inUncovered) {
      problems.push(`${module} is both covered by a fixture and listed as uncovered`);
    }
  }
  for (const module of [...covered, ...uncovered]) {
    if (!modules.includes(module)) {
      problems.push(`${module} is in the manifest and is not an engine module`);
    }
  }
  return { manifest, problems };
}

/* ------------------------------------------------------------------ */
/* Running the two engines                                             */
/* ------------------------------------------------------------------ */

function runTypescript(fixtures, out) {
  const runner = join(ROOT, "tools", "conformance-runner.mjs");
  return spawnSync(process.execPath, [runner, "--fixtures", fixtures, "--out", out], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

function runRust(fixtures, out) {
  return spawnSync(
    "cargo",
    ["run", "--quiet", "--locked", "-p", "beheader-conformance", "--", "--fixtures", fixtures, "--out", out],
    { encoding: "utf8", cwd: ROOT },
  );
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

function compare(typescript, rust, fixturesById) {
  const report = { matched: 0, differed: [], awaitingRust: [], awaitingBoth: [], misaligned: [] };
  if (typescript.results.length !== rust.results.length) {
    report.misaligned.push(
      `the TypeScript runner answered ${typescript.results.length} cases and the Rust runner answered ${rust.results.length}`,
    );
    return report;
  }
  for (let index = 0; index < typescript.results.length; index += 1) {
    const left = typescript.results[index];
    const right = rust.results[index];
    const where = `${left.fixture} case ${left.case} (${left.call})`;
    if (left.fixture !== right.fixture || left.case !== right.case || left.call !== right.call) {
      report.misaligned.push(`${where} met ${right.fixture} case ${right.case} (${right.call})`);
      continue;
    }
    const rustUnsupported = right.outcome.status === "unsupported";
    const typescriptUnsupported = left.outcome.status === "unsupported";
    if (rustUnsupported && typescriptUnsupported) {
      report.awaitingBoth.push(where);
      continue;
    }
    if (rustUnsupported) {
      report.awaitingRust.push(where);
      continue;
    }
    const policy = comparisonOf(fixturesById.get(left.fixture));
    if (policy.kind === "unknown") {
      report.misaligned.push(`${left.fixture} names a comparison policy nobody implements`);
      continue;
    }
    const difference = firstDifference(left.outcome, right.outcome, policy, "outcome");
    if (difference === undefined) {
      report.matched += 1;
    } else {
      report.differed.push({ where, name: left.name, ...difference });
    }
  }
  return report;
}

function describe(value) {
  return JSON.stringify(value)?.slice(0, 200) ?? String(value);
}

function main() {
  const fixtures = resolve(ROOT, option("fixtures", FIXTURES));
  if (!existsSync(fixtures)) {
    throw new Error(`${fixtures}: no fixture directory`);
  }

  const { problems } = checkManifest(fixtures);
  const fixturesById = new Map(
    readdirSync(fixtures)
      .filter((name) => extname(name) === ".json")
      .map((name) => readJson(join(fixtures, name)))
      .map((fixture) => [fixture.id, fixture]),
  );

  let typescriptPath = option("typescript", undefined);
  let rustPath = option("rust", undefined);
  let scratch;
  try {
    if (typescriptPath === undefined || rustPath === undefined) {
      scratch = mkdtempSync(join(tmpdir(), "beheader-conformance-"));
      typescriptPath = join(scratch, "typescript.json");
      rustPath = join(scratch, "rust.json");
      const typescriptRun = runTypescript(fixtures, typescriptPath);
      if (typescriptRun.status !== 0) {
        throw new Error(`the TypeScript runner failed.\n${typescriptRun.stderr ?? typescriptRun.error}`);
      }
      const rustRun = runRust(fixtures, rustPath);
      if (rustRun.status !== 0) {
        throw new Error(`the Rust runner failed.\n${rustRun.stderr ?? rustRun.error}`);
      }
    }

    const typescript = readJson(typescriptPath);
    const rust = readJson(rustPath);
    if (typescript.engine !== "typescript" || rust.engine !== "rust") {
      throw new Error(`the two results files name the engines "${typescript.engine}" and "${rust.engine}"`);
    }
    if (typescript.runnerVersion !== rust.runnerVersion) {
      throw new Error(
        `the runners wrote results versions ${typescript.runnerVersion} and ${rust.runnerVersion}`,
      );
    }

    const report = compare(typescript, rust, fixturesById);
    for (const problem of problems) {
      console.error(`manifest: ${problem}`);
    }
    for (const line of report.misaligned) {
      console.error(`misaligned: ${line}`);
    }
    for (const difference of report.differed) {
      console.error(`differs: ${difference.where} ${difference.name}`);
      console.error(`  at ${difference.path}`);
      console.error(`  typescript: ${describe(difference.expected)}`);
      console.error(`  rust:       ${describe(difference.actual)}`);
    }
    const calls = [...new Set(report.awaitingRust.map((line) => line.replace(/^.*\((.*)\)$/, "$1")))].sort();
    console.log(
      `${report.matched} matched, ${report.differed.length} differed, ${report.awaitingRust.length} awaiting Rust, ${report.awaitingBoth.length} awaiting both`,
    );
    if (calls.length > 0) {
      console.log(`  calls with no Rust implementation yet: ${calls.join(", ")}`);
    }
    const failed = report.differed.length > 0 || report.misaligned.length > 0 || problems.length > 0;
    process.exit(failed ? 1 : 0);
  } finally {
    if (scratch !== undefined) {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

// The comparison rules are exported so a test can drive them directly, and the
// command runs only when this file is the one Node was started on.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
