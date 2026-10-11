/**
 * frame-check.cjs
 *
 * Drives the real workspace in Chromium through the frames of section 24 of
 * SPEC.md, and reads the results back from the page rather than from the code
 * that produced them.
 *
 * A frame placed from the sidebar by two corners has to draw beneath what lies
 * in it, a drag by its name has to take along what lies wholly inside it and
 * leave what lies half inside, a crossing box drawn inside it has to pick what
 * is in the frame and leave the frame, Page Down has to step the view to the
 * next frame, and `export png frame_1` has to download a picture of the frame's
 * box exactly, named after it. The check photographs the frame and writes the
 * picture to dist/ for a person to look at.
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
    const run = async line => { await command.fill(line); await command.press('Enter'); await page.waitForTimeout(120); };
    const box = await page.locator('#canvas').boundingBox();
    // The camera opens at the world origin at a zoom of 1.
    const at = (x, y) => ({ x: box.x + x, y: box.y + y });
    const log = () => page.evaluate(() => document.querySelector('#log').innerText.split('\n'));
    const selection = () => page.evaluate(() => [...document.querySelectorAll('.object-item[aria-pressed="true"] span')].map(span => span.textContent));
    const slot = async (name, path) => {
      await run(`props ${name}`);
      const line = [...await log()].reverse().find(text => text.startsWith(`${path} = `));
      return line === undefined ? undefined : line.slice(path.length + 3).replace(/ \((?:literal|formula|derived)\b.*$/, '');
    };
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(100);
    };

    // Two corners place the frame from 60,60 to 460,360.
    await page.locator('[data-command="frame"]').click();
    await page.mouse.click(at(60, 60).x, at(60, 60).y);
    await page.mouse.click(at(460, 360).x, at(460, 360).y);
    await page.waitForTimeout(150);
    assert.equal(await slot('frame_1', 'width'), '400');
    await run('snap off');
    await run('rect x=120 y=120 w=80 h=60');
    await run('circle x=460 y=200 r=30');
    await run('text x=120 y=240 "inside the frame"');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'dist/frame.png', clip: { x: box.x + 20, y: box.y + 20, width: 560, height: 380 } });

    // A crossing drawn inside the frame picks the rectangle and leaves the frame.
    await drag(at(220, 200), at(180, 160));
    assert.deepEqual(await selection(), ['rect_1'], 'a crossing inside a frame leaves the frame');

    // The name above the corner drags the frame and what lies wholly inside it.
    await drag(at(70, 50), at(70, 90));
    assert.equal(await slot('frame_1', 'origin.y'), '100', 'the frame moves');
    assert.equal(await slot('rect_1', 'origin.y'), '160', 'what lies inside it moves with it');
    assert.equal(await slot('circle_1', 'origin.y'), '200', 'what lies half inside stays');

    // Page Down steps the view to the next frame.
    await run('frame x=2000 y=0 w=300 h=200');
    await page.keyboard.press('Escape');
    await page.keyboard.press('PageDown');
    assert.equal((await log()).at(-1), 'viewing frame_1');
    await page.keyboard.press('PageDown');
    assert.equal((await log()).at(-1), 'viewing frame_2', 'Page Down steps to the next frame');
    await page.keyboard.press('PageUp');
    assert.equal((await log()).at(-1), 'viewing frame_1');

    // A picture of the frame covers its box exactly, at twice its size.
    const pending = page.waitForEvent('download');
    await run('export png frame_1');
    const download = await pending;
    assert.equal(download.suggestedFilename(), 'frame_1.png');
    const bytes = fs.readFileSync(await download.path());
    fs.writeFileSync('dist/frame-export.png', bytes);
    const size = await page.evaluate(async base64 => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      return { width: image.width, height: image.height };
    }, bytes.toString('base64'));
    assert.deepEqual(size, { width: 800, height: 600 });

    assert.deepEqual(errors, []);
    console.log('Frame checks passed: placed by two corners, a crossing inside it, a drag that takes what lies inside, Page Down and Page Up, and a picture of the frame alone.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
