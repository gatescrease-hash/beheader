#!/usr/bin/env node
/**
 * hosting-proof.mjs
 *
 * Runs the hosting and measurement proof in a real browser. It builds the
 * browser binding, generates its JavaScript, serves the page in
 * tests/hosting, drives it with Playwright, and checks what came back.
 *
 *   node tools/hosting-proof.mjs
 *   node tools/hosting-proof.mjs --keep     # leaves the server up
 *
 * The proof answers one question: whether an engine in the page can ask the
 * host how wide a run of text is, part way through a pass, and carry on with
 * the answer. Every other case here is what that premise needs to be safe. A
 * host that throws, a host that answers with something that is not a
 * measurement, a host that cannot size notation, and a callback that starts
 * another pass each have to produce a defined result and leave the engine
 * usable.
 *
 * The font case is the one that cannot be faked. A measurement taken before a
 * font arrives is wrong by about a sixth, and the box drawn around the text is
 * too small for it. The proof loads a real font, evaluates the same inputs
 * either side of that load, and reads the two sets of numbers.
 *
 * Playwright is not a dependency of this repository, because it carries
 * browsers with it. The command installs it into a scratch directory, which is
 * how every browser check here is run.
 *
 * Tooling code that runs under Node outside the application, so it has no part
 * in the browser bundle.
 */

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PAGE_DIR = join(ROOT, "tests", "hosting");

const PORT = 5199;

/**
 * A font the proof can load at run time. Committing one would put a few
 * hundred kilobytes of glyphs in a repository that has none, and every system
 * that runs a browser already carries several.
 */
const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
  "/usr/share/fonts/dejavu/DejaVuSerif.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
  "/System/Library/Fonts/Supplemental/Georgia.ttf",
  "/Library/Fonts/Georgia.ttf",
  "C:\\Windows\\Fonts\\georgia.ttf",
  "C:\\Windows\\Fonts\\times.ttf",
];

/** The Chromium that Playwright was pointed at, whatever its version folder. */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  let names = [];
  try {
    names = readdirSync(root);
  } catch {
    return undefined;
  }
  for (const name of names.filter((entry) => entry.startsWith("chromium-")).sort().reverse()) {
    for (const suffix of [join("chrome-linux", "chrome"), join("chrome-win", "chrome.exe"), join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")]) {
      const candidate = join(root, name, suffix);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: "inherit", ...options });
  if (result.error !== undefined) {
    throw new Error(`${command} could not start. ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} gave exit code ${result.status}`);
  }
  return result;
}

/** Loads Playwright from wherever it was installed for a browser check. */
async function loadPlaywright() {
  const scratch = process.env.PLAYWRIGHT_DIR;
  const candidates = [
    "playwright",
    ...(scratch === undefined ? [] : [pathToFileURL(join(scratch, "node_modules", "playwright", "index.js")).href]),
  ];
  for (const candidate of candidates) {
    try {
      const loaded = await import(candidate);
      // Playwright is written for require, so importing it by path gives a
      // namespace with everything under default rather than beside it.
      return loaded.chromium === undefined ? loaded.default : loaded;
    } catch {
      continue;
    }
  }
  throw new Error(
    "Playwright is not here. Install it into a scratch directory and name that directory in PLAYWRIGHT_DIR:\n" +
      "  npm install --prefix <scratch> playwright",
  );
}

function build() {
  console.log("building the browser binding");
  run("cargo", ["build", "-p", "beheader-wasm", "--target", "wasm32-unknown-unknown", "--release", "--locked"]);
  rmSync(join(PAGE_DIR, "pkg"), { recursive: true, force: true });
  mkdirSync(join(PAGE_DIR, "pkg"), { recursive: true });
  run("wasm-bindgen", [
    "--target",
    "web",
    "--out-dir",
    join(PAGE_DIR, "pkg"),
    "--no-typescript",
    join(ROOT, "target", "wasm32-unknown-unknown", "release", "beheader_wasm.wasm"),
  ]);

  const font = FONT_CANDIDATES.find((path) => existsSync(path));
  if (font === undefined) {
    throw new Error(
      `the proof loads a font at run time and found none of these:\n  ${FONT_CANDIDATES.join("\n  ")}`,
    );
  }
  copyFileSync(font, join(PAGE_DIR, "proof-font.ttf"));
  console.log(`serving ${font} as the font the proof loads`);
}

function serve() {
  const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: PAGE_DIR,
    stdio: "ignore",
    detached: false,
  });
  return server;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${PORT}/`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is not up yet.
    }
    await new Promise((wake) => setTimeout(wake, 100));
  }
  throw new Error(`nothing answered on port ${PORT}`);
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

const failures = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FAILS ${name}`);
    failures.push(`${name}: ${detail}`);
  }
}

function refusal(outcome, wording) {
  return outcome.ok === false && outcome.error === "#MEASURE" && outcome.message.includes(wording);
}

async function drive(page) {
  const report = {};
  report.startup = await page.evaluate(() => window.proof.init());

  const base = await page.evaluate(() => window.proof.evaluate(7));
  const wider = await page.evaluate(() => window.proof.evaluate(1000000));
  report.base = base;
  report.wider = wider;

  console.log("\na measurement reaches the values below it");
  check(
    "the text is measured against real font metrics",
    base.values.ok === true && base.values.labelWidth > 0 && !Number.isInteger(base.values.labelWidth),
    `labelWidth was ${base.values.labelWidth}`,
  );
  check(
    "the measured width sets the width of the box",
    Math.abs(base.values.boxWidth - (base.values.labelWidth + 16)) < 1e-9,
    `boxWidth ${base.values.boxWidth} against labelWidth ${base.values.labelWidth}`,
  );
  check(
    "the geometry reaches the text of the object below it",
    base.values.noteText !== wider.values.noteText,
    `both read ${base.values.noteText}`,
  );
  check(
    "the line holding words and notation is as wide as both",
    Math.abs(base.values.lineWidth - (base.values.noteWidth + base.values.mathWidth)) < 1e-9,
    `lineWidth ${base.values.lineWidth}`,
  );
  check(
    "one pass makes one call for each measurement",
    base.hostCalls === 3,
    `the host was called ${base.hostCalls} times`,
  );

  console.log("\na font that arrives changes the values with no input changing");
  const before = await page.evaluate(() => ({
    loaded: window.proof.fontIsLoaded("ProofFont"),
    run: window.proof.evaluate(7, "ProofFont"),
  }));
  report.fontLoadMs = await page.evaluate(() => window.proof.loadProofFont());
  const after = await page.evaluate(() => ({
    loaded: window.proof.fontIsLoaded("ProofFont"),
    run: window.proof.evaluate(7, "ProofFont"),
  }));
  report.beforeFont = before;
  report.afterFont = after;
  check(
    "the font was absent and then present",
    before.loaded === false && after.loaded === true,
    `before ${before.loaded} and after ${after.loaded}`,
  );
  check(
    "the same inputs measure differently once the font is there",
    before.run.values.labelWidth !== after.run.values.labelWidth,
    `both measured ${before.run.values.labelWidth}`,
  );
  check(
    "the change reaches the text of the object below it",
    before.run.values.noteText !== after.run.values.noteText,
    `both read ${before.run.values.noteText}`,
  );

  console.log("\na host that cannot answer");
  const threw = await page.evaluate(() => {
    window.proof.host.fail = true;
    return window.proof.evaluate(7);
  });
  const afterThrow = await page.evaluate(() => window.proof.evaluate(7));
  const nonsense = await page.evaluate(() => {
    window.proof.host.nonsense = true;
    return window.proof.evaluate(7);
  });
  const noMath = await page.evaluate(() => ({
    canMeasureMath: window.proof.textOnlyEngine.canMeasureMath(),
    run: window.proof.evaluate(7, "sans-serif", window.proof.textOnlyEngine),
  }));
  report.threw = threw;
  report.nonsense = nonsense;
  report.noMath = noMath;
  check(
    "a callback that throws becomes a measurement error and not an exception",
    refusal(threw.values, "the canvas went away"),
    JSON.stringify(threw.values),
  );
  check(
    "the pass that failed stopped at the measurement that failed",
    threw.hostCalls === 1,
    `the host was called ${threw.hostCalls} times`,
  );
  check(
    "the engine is still usable after a host failure",
    afterThrow.values.ok === true && afterThrow.values.labelWidth === base.values.labelWidth,
    JSON.stringify(afterThrow.values),
  );
  check(
    "an answer that is not a measurement is refused",
    refusal(nonsense.values, "not a number"),
    JSON.stringify(nonsense.values),
  );
  check(
    "a host that cannot size notation says so rather than answering",
    noMath.canMeasureMath === false && refusal(noMath.run.values, "cannot size notation"),
    JSON.stringify(noMath.run.values),
  );
  check(
    "the pass measured the text it could before it reached the notation",
    noMath.run.hostCalls === 2,
    `the host was called ${noMath.run.hostCalls} times`,
  );

  console.log("\na callback that starts another pass");
  const reentry = await page.evaluate(() => {
    window.proof.host.reenter = true;
    const outer = window.proof.evaluate(7);
    return { outer, inner: window.proof.host.reentryOutcome };
  });
  report.reentry = reentry;
  check(
    "the inner pass is refused",
    refusal(reentry.inner, "started another evaluation"),
    JSON.stringify(reentry.inner),
  );
  check(
    "the outer pass finishes with the values it would have had",
    reentry.outer.values.ok === true && reentry.outer.values.lineWidth === base.values.lineWidth,
    JSON.stringify(reentry.outer.values),
  );

  console.log("\nwhat it costs");
  await page.evaluate(() => window.proof.repeat(500));
  report.cost = await page.evaluate(() => ({
    withCanvasMeasurementMs: window.proof.repeat(2000, false),
    withConstantAnswerMs: window.proof.repeat(2000, true),
  }));
  console.log(`  module startup            ${report.startup.startupMs.toFixed(2)} ms`);
  console.log(`  engine construction       ${report.startup.constructMs.toFixed(2)} ms`);
  console.log(`  one pass, real metrics    ${(report.cost.withCanvasMeasurementMs * 1000).toFixed(1)} us`);
  console.log(`  one pass, constant answer ${(report.cost.withConstantAnswerMs * 1000).toFixed(1)} us`);
  console.log(
    `  crossing per measurement  ${((report.cost.withConstantAnswerMs * 1000) / 3).toFixed(1)} us, the pass over three measurements with no canvas work in it`,
  );
  return report;
}

async function main() {
  build();
  const { chromium } = await loadPlaywright();
  const executablePath = findChromium();
  const server = serve();
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.proof !== undefined);
    await drive(page);
    check("the page raised no exception", pageErrors.length === 0, pageErrors.join(", "));
  } finally {
    if (browser !== undefined) {
      await browser.close();
    }
    if (!process.argv.includes("--keep")) {
      server.kill();
    }
  }

  console.log("");
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    console.error(`${failures.length} of the checks failed`);
    process.exit(1);
  }
  console.log("every check passed");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
