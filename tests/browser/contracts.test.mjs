import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { buildConlluData, parseConlluText } from '../../frontend/dependency-tree/data.mjs';
import { computeChunks } from '../../frontend/reader/chunk-model.mjs';
import { initializeText, isMyanmarChar, isMyanmarCombiningMark, hasBaseConsonant, needsDottedCircle } from '../../frontend/reader/text.mjs';

const fixture = async name => JSON.parse(await readFile(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'));
const normalize = value => JSON.parse(JSON.stringify(value, (_, v) => v instanceof Map || v instanceof Set ? Array.from(v) : v));

test('Unicode classification and dotted-circle decisions preserve original surfaces', async () => {
  initializeText();
  for (const row of await fixture('text')) {
    assert.deepEqual(Array.from(row.text, isMyanmarChar), row.isMyanmar);
    assert.deepEqual(Array.from(row.text, isMyanmarCombiningMark), row.combining);
    assert.equal(hasBaseConsonant(row.text), row.base);
    assert.equal(needsDottedCircle(row.text), row.dotted);
  }
});

test('dependency chunks preserve membership and canonical chunk selection', async () => {
  for (const id of [0, 1, 2]) {
    const row = await fixture(`chunks-${id}`);
    assert.deepEqual(normalize(computeChunks(row.overlay, 4, true, 1, 3)), row.expected);
  }
});

test('CoNLL-U conversion preserves sentence and segment mappings', async () => {
  const row = await fixture('conllu');
  assert.deepEqual(buildConlluData(parseConlluText(row.text)), row.expected);
});

test('archived userscript preserves its metadata at the beginning of the generated file', async () => {
  const directory = new URL('../../research/experiments/userscript-era/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('source-manifest.json', directory), 'utf8'));
  const metadata = await readFile(new URL('metadata.txt', directory), 'utf8');
  const output = await readFile(new URL('../../' + manifest.original_path, import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(metadata).digest('hex'), manifest.metadata_sha256);
  assert.ok(output.startsWith(metadata));
  assert.equal((output.match(/\/\/ ==UserScript==/g) || []).length, 1);
});
