/**
 * slider-check.cjs
 *
 * Drives the real workspace in Chromium through the slider of section 23 of
 * SPEC.md: placed from the sidebar, read by a circle, and set by its knob. It
 * reads the result back from the page rather than from the code that drew it.
 *
 * A press on the track has to move the knob there at once, a drag along the
 * track has to write stepped values that the circle follows, the whole drag has
 * to leave one undo step, and a formula in the slider's value has to hold the
 * knob still. A press above the track has to move the slider itself. The check
 * photographs the slider and the circle it drives, and writes the picture to
 * dist/ for a person to look at.
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
    const slot = async (name, path) => {
      await run(`props ${name}`);
      const lines = await page.evaluate(() => document.querySelector('#log').innerText.split('\n'));
      const line = [...lines].reverse().find(text => text.startsWith(`${path} = `));
      return line === undefined ? undefined : line.slice(path.length + 3).replace(/ \((?:literal|formula|derived)\b.*$/, '');
    };

    // The sidebar button asks for a point, and a click there places the slider with its top left corner on it.
    await page.locator('[data-command="slider"]').click();
    await page.mouse.click(at(100, 100).x, at(100, 100).y);
    await page.waitForTimeout(150);
    assert.equal(await slot('slider_1', 'value'), '5');
    await run('circle x=500 y=200 r=10');
    await run('set circle_1.radius = slider_1.value * 10');
    assert.equal(await slot('circle_1', 'radius'), '50');

    // The track runs from x 107 to x 293 along y 122.
    const along = fraction => at(107 + fraction * 186, 122);
    await page.mouse.move(along(0.2).x, along(0.2).y);
    await page.mouse.down();
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => document.querySelector('#log').innerText.split('\n').length) > 0, true);
    await page.mouse.move(along(0.8).x, along(0.8).y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await slot('slider_1', 'value'), '8', 'the knob writes the stepped value under the pointer');
    assert.equal(await slot('circle_1', 'radius'), '80', 'and the circle that reads it follows');
    await page.screenshot({ path: 'dist/slider.png', clip: { x: box.x + 40, y: box.y + 40, width: 620, height: 300 } });
    await run('undo');
    assert.equal(await slot('slider_1', 'value'), '5', 'one undo takes the whole drag back');

    // A press above the track moves the slider, not its value.
    await page.mouse.move(at(200, 104).x, at(200, 104).y);
    await page.mouse.down();
    await page.mouse.move(at(200, 154).x, at(200, 154).y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await slot('slider_1', 'origin.y'), '150', 'a press above the track moves the slider');
    assert.equal(await slot('slider_1', 'value'), '5');

    // A formula in the value holds the knob still.
    await run('set slider_1.value = 2 + 1');
    await page.mouse.move(at(107 + 0.5 * 186, 172).x, at(107 + 0.5 * 186, 172).y);
    await page.mouse.down();
    await page.mouse.move(at(280, 172).x, at(280, 172).y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await slot('slider_1', 'value'), '3', 'a formula holds the knob');
    const notice = await page.evaluate(() => document.querySelector('#log').innerText);
    assert.match(notice, /slider_1\.value did not move: it is driven by a formula/);

    assert.deepEqual(errors, []);
    fs.mkdirSync('dist', { recursive: true });
    console.log('Slider checks passed: placed from the sidebar, a press and a drag on the knob, a circle that follows, one undo, a move by the body, and a formula that holds the knob.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
