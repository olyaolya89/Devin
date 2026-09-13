import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../server/pipeline/normalize.js';
import { applyLlmKeep, heuristicQueries, topicWords } from '../server/llm.js';
import { rankScene } from '../server/pipeline/rank.js';
import { holdDuration, wrapText } from '../server/pipeline/render.js';
import fs from 'node:fs/promises';
import { getConfig, maskKey, readSettings, writeSettings, updateSettings, SETTINGS_FILE } from '../server/settings.js';
import { mapLibraryVoices, mapPublicVoices } from '../server/sources/lumean.js';

test('normalize keeps every sentence verbatim', () => {
  const project = { id: 'test', scriptText: "One thing. Children lined up! Dessert?" };
  normalize(project);
  assert.deepEqual(project.scenes.map(s => s.text), ['One thing.', 'Children lined up!', 'Dessert?']);
});

test('heuristic queries produce three useful queries', () => {
  const queries = heuristicQueries('In the 1970s, British school dinners were a daily ritual.');
  assert.equal(queries.length, 3);
  assert.match(queries[0], /1970s/);
  assert.ok(queries.every(Boolean));
});

test('topicWords finds the most frequent school dinner words', () => {
  const topic = topicWords([
    { text: 'School dinners were served at noon.' },
    { text: 'Children queued for school dinners.' },
    { text: 'School dinners included pudding.' }
  ]);
  assert.deepEqual(new Set(topic.split(' ')), new Set(['school', 'dinners']));
});

test('heuristic queries append topic context to the second and third queries', () => {
  const queries = heuristicQueries('Children queue beside metal trays.', 'school dinners');
  assert.match(queries[1], /school dinners/);
  assert.match(queries[2], /school dinners/);
});

test('rank boosts video and avoids reused URLs', () => {
  const scene = { text: 'school dinners', queries: ['school dinner'], candidates: [
    { url: 'image', kind: 'image', source: 'wikimedia', width: 1200, title: 'school dinner' },
    { url: 'video', kind: 'video', source: 'wikimedia', width: 1920, title: 'school dinner' }
  ] };
  assert.equal(rankScene(scene, new Set()).url, 'video');
  assert.equal(rankScene(scene, new Set(['video'])).url, 'image');
});

test('rank keeps zero-overlap videos below relevant candidates', () => {
  const scene = { text: 'metal trays shepherd pie', queries: ['metal trays shepherd'], candidates: [
    { url: 'watch', kind: 'video', source: 'wikimedia', width: 1920, title: 'pocket watch', description: '' },
    { url: 'trays', kind: 'image', source: 'wikimedia', width: 1200, title: 'metal trays shepherd pie', description: '' }
  ] };
  assert.equal(rankScene(scene, new Set()).url, 'trays');
});

test('rank gates zero-overlap non-stock candidates but keeps first-query stock video', () => {
  const scene = { text: 'school dinners', queries: ['school dinners'], candidates: [
    { url: 'wiki', kind: 'image', source: 'wikimedia', title: 'pocket watch', description: '', queryRank: 0 },
    { url: 'pixabay', kind: 'video', source: 'pixabay', title: 'cinema', description: '', queryRank: 0 }
  ] };
  assert.deepEqual(rankScene(scene, new Set()), scene.candidates[0]);
  assert.equal(scene.pick.url, 'pixabay');
  assert.equal(scene.candidates.some(candidate => candidate.url === 'wiki'), false);
});

test('LLM-ranked scenes keep only ranked candidates and prefer rank zero', () => {
  const scene = { llmRanked: true, text: 'school dinners', queries: ['school dinners'], candidates: [
    { url: 'low-overlap', kind: 'image', source: 'wikimedia', title: 'school', description: '', llmRank: 1 },
    { url: 'best', kind: 'image', source: 'wikimedia', title: 'unrelated', description: '', llmRank: 0 },
    { url: 'unranked', kind: 'video', source: 'pixabay', title: 'school dinners', description: '' }
  ] };
  assert.equal(rankScene(scene, new Set()).url, 'best');
  assert.deepEqual(scene.candidates.map(candidate => candidate.url), ['best', 'low-overlap']);
});

test('applyLlmKeep ignores out-of-range indices and assigns ranks', () => {
  const scenes = [{ candidates: [{ url: 'first' }, { url: 'second' }] }];
  applyLlmKeep(scenes, [[1, 99, -1, 0]]);
  assert.equal(scenes[0].llmRanked, true);
  assert.equal(scenes[0].candidates[1].llmRank, 0);
  assert.equal(scenes[0].candidates[0].llmRank, 1);
});

test('scene timing allocation sums to audio duration', () => {
  const durationMs = 6000;
  const texts = ['Short.', 'A considerably longer sentence.'];
  let cursor = 0;
  const scenes = texts.map((text, i) => { const startMs = cursor; const endMs = cursor + Math.round(durationMs * text.length / texts.join('').length); cursor = endMs; return { index: i, startMs, endMs }; });
  scenes.at(-1).endMs = durationMs;
  assert.equal(scenes[0].startMs, 0);
  assert.equal(scenes.at(-1).endMs, durationMs);
  assert.ok(scenes[1].startMs > scenes[0].startMs);
});

test('long video scenes hold their last frame for the missing duration', () => {
  assert.equal(holdDuration(8.2, 5), 3.1999999999999993);
  assert.equal(holdDuration(4.2, 5), 0);
});

test('render text wraps at 48 characters without flattening newlines', () => {
  const wrapped = wrapText('A very long sentence about British school dinners that should wrap across several subtitle lines for readability. Next line stays separate.', 48);
  assert.ok(wrapped.split('\n').every(line => line.length <= 48));
  assert.ok(wrapped.includes('\n'));
});

test('settings take precedence over env and empty values fall back', async () => {
  const originalFile = await fs.readFile(SETTINGS_FILE).catch(() => null);
  const originalEnv = process.env.PEXELS_API_KEY;
  try {
    process.env.PEXELS_API_KEY = 'env-key';
    await writeSettings({ ...(await readSettings()), pexelsApiKey: 'file-key' });
    assert.equal((await getConfig()).pexelsApiKey, 'file-key');
    await writeSettings({ ...(await readSettings()), pexelsApiKey: '' });
    assert.equal((await getConfig()).pexelsApiKey, 'env-key');
    assert.equal(maskKey('abcdefgh'), '••••efgh');
    assert.equal(maskKey(''), '');
    await writeSettings({ ...(await readSettings()), ttsProvider: 'edge' });
    await updateSettings({ ttsProvider: 'bogus' });
    assert.equal((await readSettings()).ttsProvider, 'edge');
  } finally {
    if (originalEnv === undefined) delete process.env.PEXELS_API_KEY;
    else process.env.PEXELS_API_KEY = originalEnv;
    if (originalFile) await fs.writeFile(SETTINGS_FILE, originalFile);
    else await fs.rm(SETTINGS_FILE, { force: true });
  }
});

test('library voice mapping keeps only available ready voices with ids', () => {
  assert.deepEqual(mapLibraryVoices([
    { voice_id: 'ready-id', nickname: 'Ready voice', available: true, voice: { voice_status: 'ready', default_language_code: 'ru' } },
    { voice_id: 'unavailable-id', available: false, voice: { voice_status: 'ready' } },
    { available: true, voice: { voice_status: 'ready' } },
    { voice_id: 'cloning-id', available: true, voice: { voice_status: 'cloning' } }
  ]), [{ value: 'ready-id', label: 'Ready voice', language: 'ru' }]);
});

test('public voice catalog mapping keeps ready voices allowed in orders', () => {
  assert.deepEqual(mapPublicVoices([
    { id: 'pub-1', display_name: 'Ava', voice_status: 'ready', allow_usage_in_orders: true, default_language_code: 'en' },
    { id: 'pub-2', display_name: 'Blocked', voice_status: 'ready', allow_usage_in_orders: false },
    { id: 'pub-3', display_name: 'Cloning', voice_status: 'cloning', allow_usage_in_orders: true }
  ]), [{ value: 'pub-1', label: 'Ava', language: 'en' }]);
});
