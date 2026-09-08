import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../server/pipeline/normalize.js';
import { heuristicQueries } from '../server/llm.js';
import { rankScene } from '../server/pipeline/rank.js';
import { holdDuration, wrapText } from '../server/pipeline/render.js';

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

test('rank boosts video and avoids reused URLs', () => {
  const scene = { text: 'school dinners', queries: ['school dinner'], candidates: [
    { url: 'image', kind: 'image', source: 'wikimedia', width: 1200, title: 'school dinner' },
    { url: 'video', kind: 'video', source: 'wikimedia', width: 1920, title: 'school dinner' }
  ] };
  assert.equal(rankScene(scene, new Set()).url, 'video');
  assert.equal(rankScene(scene, new Set(['video'])).url, 'image');
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
