/**
 * connector-check.cjs
 *
 * Drives the real workspace in Chromium through the connectors of section 25
 * of SPEC.md, and reads the results back from the page rather than from the
 * code that produced them.
 *
 * A connector placed from the sidebar by a press on each of two objects has to
 * join their boxes, a drag of one object has to redraw the line, an arrowhead
 * word has to change the heads, a delete of an object has to take the connector
 * along, and an undo has to bring both back. The check photographs a small
 * diagram and writes the picture to dist/ for a person to look at.
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
    const run = async line => { await command.fill(line); await command.press('Enter'); await page.waitForTimeout(120); };
    const box = await page.locator('#canvas').boundingBox();
    // The camera opens at the world origin at a zoom of 1.
    const at = (x, y) => ({ x: box.x + x, y: box.y + y });
    const log = () => page.evaluate(() => document.querySelector('#log').innerText.split('\n'));
    const slot = async (name, path) => {
      await run(`props ${name}`);
      const line = [...await log()].reverse().find(text => text.startsWith(`${path} = `));
      return line === undefined ? undefined : line.slice(path.length + 3).replace(/ \((?:literal|formula|derived)\b.*$/, '');
    };
    // True when a dark stroke crosses the few canvas pixels around a world point.
    const inkNear = (x, y) => page.evaluate(([px, py]) => {
      const canvas = document.querySelector('#canvas');
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      const data = canvas.getContext('2d').getImageData(Math.round((px - 3) * ratio), Math.round((py - 3) * ratio), Math.round(7 * ratio), Math.round(7 * ratio)).data;
      for (let index = 0; index < data.length; index += 4) if (data[index] + data[index + 1] + data[index + 2] < 200 && data[index + 3] > 200) return true;
      return false;
    }, [x, y]);
    const names = () => page.evaluate(() => [...document.querySelectorAll('.object-item span')].map(span => span.textContent));

    await run('snap off');
    await run('rect x=80 y=120 w=140 h=70');
    await run('text x=420 y=60 "the result"');
    await run('circle x=480 y=330 r=40');
    await page.keyboard.press('Escape');

    // A press on each object places the connector between their boxes.
    await page.locator('[data-command="connect"]').click();
    await page.mouse.click(at(150, 155).x, at(150, 155).y);
    await page.mouse.click(at(470, 330).x, at(470, 330).y);
    await page.waitForTimeout(150);
    assert.equal(await slot('connector_1', 'from'), '2 points', 'the first end reads the box of the rectangle');
    await run('connect rect_1 text_1 both');
    assert.equal(await slot('connector_2', 'arrow'), '"both"');

    // A drag of the rectangle redraws both lines from its new place. The line
    // from the moved box at 80,260 to the circle crosses 330,314 by the
    // arithmetic of section 25, and the line before the drag does not.
    await page.keyboard.press('Escape');
    assert.equal(await inkNear(330, 314), false, 'no line passes there before the drag');
    await page.mouse.move(at(150, 120).x, at(150, 120).y);
    await page.mouse.down();
    await page.mouse.move(at(150, 260).x, at(150, 260).y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    assert.equal(await slot('rect_1', 'origin.y'), '260', 'the drag moves the rectangle');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.equal(await inkNear(330, 314), true, 'the line follows the rectangle');
    await page.screenshot({ path: 'dist/connector.png', clip: { x: box.x + 40, y: box.y + 20, width: 560, height: 420 } });

    // Deleting the rectangle takes both connectors along, and an undo brings all three back.
    await run('delete rect_1');
    assert.equal((await log()).at(-1), 'deleted rect_1, connector_1, connector_2');
    assert.deepEqual((await names()).filter(name => name.startsWith('connector')), []);
    await run('undo');
    assert.deepEqual((await names()).filter(name => name.startsWith('connector')).sort(), ['connector_1', 'connector_2']);

    assert.deepEqual(errors, []);
    console.log('Connector checks passed: placed by two presses, typed with both heads, a drag that redraws, a delete that takes the connectors along, and an undo.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
