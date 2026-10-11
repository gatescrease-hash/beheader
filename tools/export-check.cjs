/**
 * export-check.cjs
 *
 * Drives the real workspace in Chromium through the picture export of section
 * 22 of SPEC.md, and reads the pictures back rather than trusting the code that
 * wrote them.
 *
 * Notation reaches the screen as an element above the canvas, so a picture
 * read back from the canvas alone would hold every shape and no notation. This
 * check exports a raster of a document holding a math object, then of the same
 * document with the math object's source emptied, and counts the dark pixels
 * inside the box the notation fills. A large rectangle fixes the frame of both
 * pictures, so the box sits at the same pixels in each. The first picture has
 * to carry many dark pixels there and the second almost none. It also checks
 * that a raster at a scale of two has twice the pixels on a side, that the
 * vector form parses as SVG and carries the notation as MathML, and that a
 * selection picture covers the selected object alone. It writes the two
 * rasters to dist/ for a person to look at.
 *
 * It reads three environment variables, the same as workspace-check.cjs:
 * PLAYWRIGHT_MODULE for a Playwright installed outside the repository,
 * PLAYWRIGHT_EXECUTABLE for the browser binary, and WORKSPACE_URL for the dev
 * server, which defaults to http://127.0.0.1:5173/.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(process.env.WORKSPACE_URL || 'http://127.0.0.1:5173/');
    await page.locator('#command-status').filter({ hasText: 'Ready' }).waitFor();
    const command = page.locator('#command');
    const run = async line => { await command.fill(line); await command.press('Enter'); await page.waitForTimeout(150); };
    const lastLine = () => page.evaluate(() => document.querySelector('#log').innerText.split('\n').pop());
    const exported = async line => {
      const pending = page.waitForEvent('download');
      await run(line);
      const download = await pending;
      return { name: download.suggestedFilename(), bytes: fs.readFileSync(await download.path()) };
    };
    // The dark pixels inside a box of a PNG, and the picture's size.
    const darkIn = (bytes, box) => page.evaluate(async ({ base64, box }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(box.x, box.y, box.width, box.height).data;
      let dark = 0;
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] + pixels[index + 1] + pixels[index + 2] < 300) dark += 1;
      return { dark, width: image.width, height: image.height };
    }, { base64: bytes.toString('base64'), box });

    await run('rect x=0 y=0 w=600 h=400');
    await run('math x=100 y=100 "y=\\\\frac{x^2}{2}"');
    await page.waitForTimeout(400);
    // The frame starts a margin of 16 outside the rectangle, so world (100, 100)
    // lands at (116, 116). The box interior is inset from its border.
    const notationBox = { x: 122, y: 122, width: 50, height: 30 };
    const withNotation = await exported('export png 1');
    assert.equal(withNotation.name, 'beheader.png');
    fs.mkdirSync('dist', { recursive: true });
    fs.writeFileSync('dist/export-notation.png', withNotation.bytes);
    const holding = await darkIn(withNotation.bytes, notationBox);
    assert.equal(holding.width, 632);
    assert.equal(holding.height, 432);

    // A math source is written by editing the equations, never by a set, so
    // the same document without notation holds an empty math object instead.
    await run('delete math_1');
    await run('math x=100 y=100 ""');
    await page.waitForTimeout(300);
    const withoutNotation = await exported('export png 1');
    fs.writeFileSync('dist/export-plain.png', withoutNotation.bytes);
    const empty = await darkIn(withoutNotation.bytes, notationBox);
    assert.ok(holding.dark > 40, `the picture carries the notation: ${holding.dark} dark pixels in its box`);
    assert.ok(empty.dark < 5, `the same document without notation leaves the box clear: ${empty.dark} dark pixels`);

    await run('delete math_1');
    await run('math x=100 y=100 "y=x+1"');
    await page.waitForTimeout(300);
    const doubled = await exported('export png 2');
    assert.equal((await darkIn(doubled.bytes, { x: 0, y: 0, width: 1, height: 1 })).width, 1264);

    const vector = await exported('export svg');
    assert.equal(vector.name, 'beheader.svg');
    const parsed = await page.evaluate(text => {
      const document = new DOMParser().parseFromString(text, 'image/svg+xml');
      return { error: document.querySelector('parsererror')?.textContent ?? '', math: document.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math').length, paths: document.getElementsByTagName('path').length };
    }, vector.bytes.toString('utf8'));
    assert.equal(parsed.error, '');
    assert.equal(parsed.math, 1);
    assert.ok(parsed.paths >= 1);

    await page.locator('.object-item').filter({ hasText: 'math_1' }).click();
    const selection = await exported('export png 1 selection');
    const selected = await darkIn(selection.bytes, { x: 0, y: 0, width: 1, height: 1 });
    assert.ok(selected.width < 200, `a selection picture covers the selected object alone: ${selected.width} wide`);
    assert.match(await lastLine(), /exported a \d+×\d+ picture at 1× to beheader.png/);

    assert.deepEqual(errors, []);
    console.log(`Export checks passed: notation in the raster (${holding.dark} dark pixels against ${empty.dark} without it), scale, vector MathML, selection.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
