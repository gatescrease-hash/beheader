/**
 * plot-check.cjs
 *
 * Drives the real workspace in Chromium through the plots of section 26 of
 * SPEC.md, and reads the results back from the page rather than from the code
 * that produced them.
 *
 * A plot of a math object has to sample its export at every place it can, a
 * pole has to leave a gap, a slider linked to an input of the math object has
 * to redraw the curve, and a resize by the corner handle has to change the
 * plot's width. The check photographs the plots and writes the picture to dist/
 * for a person to look at.
 *
 * It reads three environment variables, the same as workspace-check.cjs:
 * PLAYWRIGHT_MODULE for a Playwright installed outside the repository,
 * PLAYWRIGHT_EXECUTABLE for the browser binary, and WORKSPACE_URL for the dev
 * server, which defaults to http://127.0.0.1:5173/.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

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
    const box = await page.locator('#canvas').boundingBox();
    // The camera opens at the world origin at a zoom of 1.
    const at = (x, y) => ({ x: box.x + x, y: box.y + y });
    const log = () => page.evaluate(() => document.querySelector('#log').innerText.split('\n'));
    const slot = async (name, path) => {
      await run(`props ${name}`);
      const line = [...await log()].reverse().find(text => text.startsWith(`${path} = `));
      return line === undefined ? undefined : line.slice(path.length + 3).replace(/ \((?:literal|formula|derived)\b.*$/, '');
    };
    const pixels = () => page.evaluate(() => {
      const canvas = document.querySelector('#canvas');
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      return Array.from(canvas.getContext('2d').getImageData(Math.round(40 * ratio), Math.round(180 * ratio), Math.round(420 * ratio), Math.round(220 * ratio)).data).join(',');
    });

    await run('snap off');
    await run('math x=40 y=40 "y = a \\\\sin(x) + x / 4"');
    await run('slider x=40 y=120 min=0 max=3 step=0.1 value=1.5');
    await run('link math_1.in.a slider_1.value');
    await run('plot math_1 x=40 y=180 w=420 h=220');
    await run('math x=520 y=40 "y = 1 / x"');
    await run('plot math_2 x=520 y=180 w=300 h=220 from=-4 to=4');
    await page.keyboard.press('Escape');
    assert.equal(await slot('plot_1', 'samples'), '201 points', 'a smooth curve has a point at every place');
    assert.equal(await slot('plot_2', 'samples'), '200 points', 'the pole at zero leaves a gap');
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'dist/plot.png', clip: { x: box.x + 20, y: box.y + 20, width: 840, height: 400 } });

    // A slider linked to an input of the math object redraws the curve.
    const before = await pixels();
    await run('set slider_1.value 0.5');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.notEqual(await pixels(), before, 'the curve moves with the slider');

    // The corner handle resizes the plot.
    await page.mouse.click(at(250, 300).x, at(250, 300).y);
    await page.waitForTimeout(100);
    await page.mouse.move(at(460, 400).x, at(460, 400).y);
    await page.mouse.down();
    await page.mouse.move(at(500, 400).x, at(500, 400).y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await slot('plot_1', 'width'), '460', 'the handle widens the plot');

    assert.deepEqual(errors, []);
    console.log('Plot checks passed: every place sampled, a gap at a pole, a slider that redraws the curve, and a resize by the handle.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
