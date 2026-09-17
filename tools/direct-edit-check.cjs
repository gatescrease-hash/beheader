const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(process.env.WORKSPACE_URL || 'http://127.0.0.1:5173/');
    await page.locator('#command-status').filter({ hasText: 'Ready' }).waitFor();
    const roundTrips = await page.evaluate(async () => {
      const rich = await import('/src/render/rich-text.ts');
      const samples = ['Hello **world**', 'one\n\ntwo', '- first\n- second', '{$ x^2 }', '{$$ x^2 }', 'A {= table_1.A1 } B'];
      return samples.map(source => [source, rich.createRichText(source).value]);
    });
    for (const [source, output] of roundTrips) assert.equal(output, source);
    const command = page.locator('#command');
    const run = async line => { await command.fill(line); await command.press('Enter'); assert.equal(await command.inputValue(), '', await page.locator('#command-status').textContent()); };
    const save = async () => {
      const pending = page.waitForEvent('download'); await page.locator('[data-command="save"]').click();
      const download = await pending; return JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    };
    const object = (saved, name) => saved.objects.find(item => item.name === name);
    const select = async name => page.locator('.object-item, .layer-name').filter({ hasText: name }).click();
    const createLayer = async name => { await page.getByRole('textbox', { name: 'New layer name' }).fill(name); await page.getByRole('button', { name: 'Create layer', exact: true }).click(); };
    await run('table x=60 y=150 rows=2 cols=3');
    await run('set table_1.A1 2');
    await run('set table_1.B1 0.25');
    await run('circle x=500 y=280 r=55');
    await run('text x=60 y=330 "Hello **world** {= table_1.A1 }"');
    await createLayer('GEOM'); await createLayer('TXT');
    await select('circle_1');
    await page.getByLabel('Assign selected objects to layer').selectOption({ label: 'GEOM' });
    await page.getByLabel('Source for circle_1.style.strokeWidth', { exact: true }).selectOption({ label: 'From: TXT' });
    await run('set TXT.style.strokeWidth = table_1.A1');
    await run('set table_1.A1 4');
    let saved = await save();
    assert.equal(object(saved, 'circle_1').slots['style.strokeWidth'].value, 4);
    assert.equal(object(saved, 'circle_1').slots['view.layer'].value, object(saved, 'GEOM').id);
    await page.getByLabel('Source for circle_1.style.strokeWidth', { exact: true }).selectOption('local');
    await run('set table_1.A1 6');
    saved = await save(); assert.equal(object(saved, 'circle_1').slots['style.strokeWidth'].value, 4);
    await page.getByLabel('Source for circle_1.style.strokeWidth', { exact: true }).selectOption({ label: 'By layer: GEOM' });
    saved = await save(); assert.equal(object(saved, 'circle_1').slots['style.strokeWidth'].value, 1);

    const panelBefore = await page.locator('.panel').boundingBox();
    await select('table_1');
    assert.equal((await page.locator('.panel').boundingBox()).x, panelBefore.x);
    const header = await page.locator('.panel-header').boundingBox();
    await page.mouse.move(header.x + 50, header.y + 8); await page.mouse.down(); await page.mouse.move(header.x - 400, header.y + 400); await page.mouse.up();
    await select('circle_1');
    assert.equal(await page.locator('.panel').count(), 2);
    assert.equal(await page.locator('.property-threads line').count(), 1);
    const pinned = page.locator('.panel').filter({ hasText: 'table_1' });
    await pinned.locator('.panel-dismiss').click();

    await page.getByRole('button', { name: 'Hide GEOM', exact: true }).click();
    saved = await save(); assert.equal(object(saved, 'GEOM').slots['view.visible'].value, false);
    assert.ok(object(saved, 'circle_1'));
    await page.getByRole('button', { name: 'Show GEOM', exact: true }).click();
    await page.locator('#grid-toggle').click(); assert.equal(await page.locator('#stage').evaluate(el => getComputedStyle(el).backgroundImage), 'none');
    await page.locator('#grid-toggle').click();

    const canvas = await page.locator('#canvas').boundingBox();
    await select('table_1');
    await page.mouse.move(canvas.x + 140, canvas.y + 162);
    assert.equal(await page.locator('#canvas').evaluate(el => el.style.cursor), 'col-resize');
    await page.mouse.down(); await page.mouse.move(canvas.x + 190, canvas.y + 162); await page.mouse.up();
    saved = await save(); assert.equal(object(saved, 'table_1').slots['columns.1.width'].value, 130);
    await page.mouse.click(canvas.x + 215, canvas.y + 162);
    await page.getByRole('button', { name: 'Bold (Ctrl+B)', exact: true }).click();
    await page.getByLabel('Number format', { exact: true }).selectOption('percent');
    await page.getByLabel('Cell fill color', { exact: true }).fill('#dde8cf');
    saved = await save(); assert.equal(object(saved, 'table_1').slots['cellStyle.B1.bold'].value, true);
    assert.equal(object(saved, 'table_1').slots['cellStyle.B1.format'].value, 'percent');
    await page.mouse.dblclick(canvas.x + 215, canvas.y + 162);
    const cell = page.locator('input.text-editor'); await cell.fill('0.5'); await cell.press('Tab');
    assert.match(await page.locator('.format-target').textContent(), /C1/);
    await page.locator('input.text-editor').press('Escape');

    await page.mouse.dblclick(canvas.x + 88, canvas.y + 337);
    const editor = page.getByRole('textbox', { name: 'Edit text', exact: true });
    assert.equal(await editor.locator('b').textContent(), 'world');
    assert.equal(await editor.locator('.variable-chip').getAttribute('contenteditable'), 'false');
    await editor.fill('Quarterly revenue '); await editor.press('Control+a'); await editor.press('Control+b');
    assert.ok(await editor.locator('b, strong').count() > 0);
    await editor.press('ArrowRight');
    await page.locator('[data-format="variable"]').click();
    await page.getByRole('textbox', { name: 'Insert live value', exact: true }).fill('table_1.A1');
    await page.getByRole('button', { name: 'Insert value', exact: true }).click();
    assert.equal(await editor.locator('.variable-chip').count(), 1);
    await page.screenshot({ path: 'dist/direct-edit-text.png' });
    await command.click(); saved = await save();
    assert.match(object(saved, 'text_1').slots.content.value, /\*\*Quarterly revenue/);
    assert.match(object(saved, 'text_1').slots.content.value, /\{= table_1.A1 \}/);
    const content = await page.evaluate(async saved => {
      const engine = await import('/src/engine/index.ts');
      const loaded = engine.loadDocument(JSON.stringify(saved));
      if (!loaded.ok) throw Error(loaded.message);
      return loaded.document.objects.find(item => item.name === 'text_1').slots.resolvedContent.value;
    }, saved);
    assert.match(content, /6/);
    await page.screenshot({ path: 'dist/direct-edit-layers.png' });
    await page.setViewportSize({ width: 760, height: 850 });
    await page.screenshot({ path: 'dist/direct-edit-narrow.png' });
    assert.deepEqual(errors, []);
    console.log('Direct editing checks passed: layers, inheritance, overrides, saved formulas, pinned panels, grid, resizing, formatting, cell navigation, rich text and embedded values.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
