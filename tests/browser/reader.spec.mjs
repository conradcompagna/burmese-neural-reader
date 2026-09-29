import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('reader boots and looks up a synthetic document with dependency overlays', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/reader');
  await expect(page.locator('#renderedText .reader-token').first()).toBeVisible();
  await page.locator('#sourceText').fill('မြန်မာစာဖတ်');
  await expect.poll(() => page.evaluate(() => window.latestData?.display_text)).toBe('မြန်မာစာဖတ်');
  await expect(page.locator('#renderedText .reader-token')).toHaveCount(3);
  expect(await page.evaluate(() => window.latestData.ud_overlay.ok)).toBe(true);
  await page.locator('#renderedText .reader-token').first().hover();
  await expect(page.locator('#hoverPopup')).toBeVisible();
  expect(errors).toEqual([]);
});

test('archived userscript wraps text with a mocked local dictionary transport', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/ping');
  await page.setContent('<!doctype html><html><body><p>မြန်မာစာဖတ်</p></body></html>');
  await page.evaluate(() => {
    window.GM_xmlhttpRequest = options => options.onload({
      status: 200,
      responseText: JSON.stringify({ ok: true, segments: ['မြန်မာ', 'စာ', 'ဖတ်'], results: [], results_by_seg: [] })
    });
  });
  const source = await readFile(new URL('../../research/experiments/userscript-era/Burmese Hover Dictionary (Unlimited Nesting)-0.99m-grammar (bells ans whisltes version).user.js', import.meta.url), 'utf8');
  await page.addScriptTag({ content: source });
  await expect(page.locator('p .burmese-word').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('dictionary side panel and text upload preserve Burmese text', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/reader');
  await page.evaluate(() => window.lookupAndDisplay('စာ'));
  await expect(page.locator('#panel-content')).toContainText('text');
  await page.locator('#fileInput').setInputFiles({ name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('မြန်မာစာဖတ်') });
  await expect(page.locator('#fileNameText')).toContainText('fixture.txt');
  await expect.poll(() => page.evaluate(() => window.latestData?.display_text)).toBe('မြန်မာစာဖတ်');
  expect(errors).toEqual([]);
});

test('standalone dependency viewer renders, navigates and highlights CoNLL-U', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/reader');
  await page.addScriptTag({ url: '/__fixtures/dependency-tree.js' });
  const result = await page.evaluate(() => {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px;height:500px;position:relative';
    document.body.append(container);
    const view = window.DepTreeView;
    view.init({ container });
    view.loadConlluFromText('1\tစာ\tစာ\tNOUN\t_\t_\t2\tobj\t_\t_\n2\tဖတ်\tဖတ်\tVERB\t_\t_\t0\troot\t_\t_\n');
    view.setVisible(true);
    view.setChunkHighlight(true);
    view._applyHighlight(0);
    return { nodes: view.nodeEls.size, edges: view.edgeEls.length, svg: container.querySelectorAll('svg').length };
  });
  expect(result.nodes).toBe(2);
  expect(result.edges).toBe(1);
  expect(result.svg).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
