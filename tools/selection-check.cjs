/**
 * selection-check.cjs
 *
 * Drives the real workspace in Chromium through the selection and the keys of
 * the canvas, as the subsection on selecting many in section 14 of SPEC.md
 * describes them, and reads the result back from the page rather than from the
 * code that produced it.
 *
 * A window box drawn left to right selects what it encloses, and a crossing
 * box drawn right to left selects what it touches. The check photographs each
 * box half drawn, because the rule a release follows has to show before the
 * release. A drag that starts on one of two selected objects has to move both,
 * and a click with no drag has to pick one. Ctrl+A, the arrows, Delete and
 * Ctrl+D have to reach the canvas from an empty command line, a held arrow has
 * to fold into one undo step, Up right after a command has to recall that
 * command rather than move the selection, a Backspace held to clear the
 * command line has to stop at the line, and Delete over the active cell of a
 * table has to clear that cell and leave the table.
 *
 * It reads selection from the object list, whose buttons carry aria-pressed,
 * and positions from the props command, so both come from what an operator can
 * see. It writes the photographs to dist/ for a person to look at.
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
  const errors = [];
  fs.mkdirSync('dist', { recursive: true });

  // Each part opens a fresh page, so no recovery copy or earlier name leaks between parts.
  const fresh = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(process.env.WORKSPACE_URL || 'http://127.0.0.1:5173/');
    await page.locator('#command-status').filter({ hasText: 'Ready' }).waitFor();
    const command = page.locator('#command');
    const box = await page.locator('#canvas').boundingBox();
    const tools = {
      page,
      command,
      run: async line => { await command.fill(line); await command.press('Enter'); await page.waitForTimeout(120); },
      // The camera opens at the world origin at a zoom of 1, so a world point sits that far into the canvas.
      at: (x, y) => ({ x: box.x + x, y: box.y + y }),
      selection: () => page.evaluate(() => [...document.querySelectorAll('.object-item[aria-pressed="true"] span')].map(span => span.textContent)),
      log: () => page.evaluate(() => document.querySelector('#log').innerText.split('\n')),
      slot: async (name, path) => {
        await tools.run(`props ${name}`);
        const lines = await tools.log();
        const line = [...lines].reverse().find(text => text.startsWith(`${path} = `));
        return line === undefined ? undefined : line.slice(path.length + 3).replace(/ \((literal|formula|derived)\)$/, '');
      },
      drag: async (from, to, { pause } = {}) => {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        if (pause !== undefined) await pause();
        await page.mouse.up();
        await page.waitForTimeout(80);
      },
      click: async point => { await page.mouse.click(point.x, point.y); await page.waitForTimeout(80); await command.focus(); },
    };
    return tools;
  };

  try {
    // Boxes. rect_1 spans 100..180, circle_1 spans 260..340, rect_2 spans 500..580.
    {
      const { page, run, at, selection, drag } = await fresh();
      await run('rect x=100 y=100 w=80 h=60');
      await run('circle x=300 y=130 r=40');
      await run('rect x=500 y=100 w=80 h=60');
      await drag(at(60, 60), at(400, 220), { pause: () => page.screenshot({ path: 'dist/selection-window.png' }) });
      assert.deepEqual(await selection(), ['rect_1', 'circle_1'], 'a window takes what it encloses');
      await drag(at(620, 60), at(540, 120), { pause: () => page.screenshot({ path: 'dist/selection-crossing.png' }) });
      assert.deepEqual(await selection(), ['rect_2'], 'a crossing takes what it touches, and a plain box replaces the selection');
      await page.keyboard.down('Shift');
      await drag(at(60, 60), at(200, 220));
      await page.keyboard.up('Shift');
      // The list shows objects in document order, whatever order they were selected in.
      assert.deepEqual(await selection(), ['rect_1', 'rect_2'], 'a shift box adds to the selection');
      // A crossing that only reaches into the hollow middle of the circle touches nothing.
      await drag(at(310, 140), at(290, 120));
      assert.deepEqual(await selection(), [], 'a crossing inside a hollow outline takes nothing');
    }

    // A drag of two, and a click that picks one of them.
    {
      const { page, run, at, selection, drag, click, slot } = await fresh();
      await run('rect x=100 y=100 w=80 h=60');
      await run('circle x=300 y=130 r=40');
      await drag(at(60, 60), at(400, 220));
      await drag(at(140, 100), at(190, 130));
      assert.deepEqual(await selection(), ['rect_1', 'circle_1'], 'the drag keeps the selection');
      assert.equal(await slot('rect_1', 'origin.x'), '150');
      assert.equal(await slot('circle_1', 'origin.x'), '350');
      assert.equal(await slot('circle_1', 'origin.y'), '160');
      await page.screenshot({ path: 'dist/selection-dragged.png' });
      await run('undo');
      assert.equal(await slot('circle_1', 'origin.x'), '300', 'one undo takes the whole drag of two back');
      await drag(at(60, 60), at(400, 220));
      await click(at(140, 100));
      assert.deepEqual(await selection(), ['rect_1'], 'a click on one of two selected objects picks it alone');
      await page.keyboard.press('Control+a');
      assert.deepEqual(await selection(), ['rect_1', 'circle_1'], 'Ctrl+A selects every unit');
    }

    // The keys: arrows, a held arrow, duplicate, delete, and a held Backspace.
    {
      const { page, command, run, at, selection, click, slot, log } = await fresh();
      await run('rect x=100 y=100 w=80 h=60');
      await click(at(140, 100));
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+ArrowDown');
      assert.equal(await slot('rect_1', 'origin.x'), '101', 'an arrow moves a tenth of the grid step');
      assert.equal(await slot('rect_1', 'origin.y'), '110', 'Shift moves a whole grid step');
      // The props line just ran, so Up recalls it rather than moving the selected rectangle.
      await page.keyboard.press('ArrowUp');
      assert.equal(await command.inputValue(), 'props rect_1', 'after a command runs, Up recalls it');
      await command.fill('');
      assert.equal(await slot('rect_1', 'origin.y'), '110');
      await click(at(141, 110));
      for (let press = 0; press < 5; press += 1) await page.keyboard.down('ArrowLeft');
      await page.keyboard.up('ArrowLeft');
      assert.equal(await slot('rect_1', 'origin.x'), '96');
      await run('undo');
      assert.equal(await slot('rect_1', 'origin.x'), '101', 'one undo takes a held arrow back');
      await page.keyboard.press('Control+d');
      assert.deepEqual(await selection(), ['rect_2'], 'Ctrl+D selects the copy');
      assert.equal(await slot('rect_2', 'origin.x'), '121');
      await page.keyboard.press('Delete');
      assert.ok((await log()).includes('> delete rect_2'), 'Delete runs the delete line');
      assert.deepEqual(await selection(), []);
      await click(at(141, 110));
      assert.deepEqual(await selection(), ['rect_1']);
      const before = (await log()).length;
      await command.fill('abc');
      for (let press = 0; press < 8; press += 1) await page.keyboard.down('Backspace');
      await page.keyboard.up('Backspace');
      assert.equal(await command.inputValue(), '');
      assert.ok(!(await log()).slice(before).some(line => line.startsWith('> delete')), 'a held Backspace stops at the empty line');
      assert.deepEqual(await selection(), ['rect_1']);
      await run('rect x=300 y=100 w=40 h=40');
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Control+g');
      await page.keyboard.press('Delete');
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.object-item span')].map(span => span.textContent)), [], 'Delete takes a group with everything in it');
      await run('undo');
      assert.equal((await page.evaluate(() => document.querySelectorAll('.object-item').length)), 3, 'one undo brings the group and its members back');
    }

    // Delete over the active cell of a table clears that cell.
    {
      const { page, run, at, slot } = await fresh();
      await run('table x=100 y=100 rows=2 cols=2');
      await run('set table_1.A1 5');
      await page.mouse.click(at(120, 110).x, at(120, 110).y);
      await page.waitForTimeout(100);
      await page.locator('#command').focus();
      await page.keyboard.press('Delete');
      await page.waitForTimeout(100);
      assert.equal(await slot('table_1', 'cells.A1'), undefined, 'Delete clears the active cell');
      assert.equal(await page.evaluate(() => document.querySelectorAll('.object-item').length), 1, 'and leaves the table');
    }

    // Snapping: rect_1 spans 100..180 and rect_2 spans 300..380. A travel of 197
    // puts the left edge of rect_1 at 297, within reach of rect_2's left edge.
    {
      const { page, run, at, drag, slot } = await fresh();
      await run('rect x=100 y=100 w=80 h=60');
      await run('rect x=300 y=300 w=80 h=60');
      await drag(at(140, 100), at(337, 153), { pause: () => page.screenshot({ path: 'dist/selection-snap.png' }) });
      assert.equal(await slot('rect_1', 'origin.x'), '300', 'a drag snaps onto a neighbour edge');
      assert.equal(await slot('rect_1', 'origin.y'), '150', 'and onto the grid along the other axis');
      await page.keyboard.down('Alt');
      await drag(at(340, 150), at(343, 157));
      await page.keyboard.up('Alt');
      assert.equal(await slot('rect_1', 'origin.x'), '303', 'Alt drags freely');
      assert.equal(await slot('rect_1', 'origin.y'), '157');
      await run('snap off');
      await drag(at(343, 157), at(340, 151));
      assert.equal(await slot('rect_1', 'origin.x'), '300');
      assert.equal(await slot('rect_1', 'origin.y'), '151', 'snap off drags freely');
    }

    assert.deepEqual(errors, []);
    console.log('Selection checks passed: window and crossing boxes, a drag of two, click to pick, Ctrl+A, arrows, a held arrow as one undo, Ctrl+D, Delete, a held Backspace, Delete over a cell, and snapping.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
