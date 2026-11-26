import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(readFileSync(new URL('../catalogue.js', import.meta.url), 'utf8'), { window });
const { words, makeSearchIndex, matches, snapshots, changeSeries, measuredChange,
  channelLanguage, marketKey, competitionFor, competitionEvidence, checkTopic, entryAssessment, clusters } = window.NR_CATALOGUE_TOOLS;
const markets = JSON.parse(readFileSync(new URL('../collector/markets.json', import.meta.url), 'utf8'));

const index = makeSearchIndex({
  id: 'UCexample',
  handle: '@café-examples',
  notes_ru: 'Заброшенные города и съёмка с дрона',
  videos: [{ title: 'The Underground City', title_original: 'Ciudad subterránea' }],
}, ['Инженерия'], ['История']);
assert(matches(index, words('ИСТОРИЯ заброшенные')));
assert(matches(index, words('@cafe-examples')));
assert(matches(index, words('съемка')));
assert(matches(index, words('ciudad subterranea')));
assert(matches(index, words('underground city')));
assert(!matches(index, words('город сады')));

const history = snapshots([
  ['2026-11-08', 110, 1700],
  ['2026-11-01', 100, 1000],
  ['2026-11-06', null, 1500],
  ['bad date', 0, 0],
  ['2026-11-09', 108, 1800],
  ['2026-11-09', 107, 1805],
]);
assert.deepEqual(JSON.parse(JSON.stringify(changeSeries(history, 'views', 7))), [
  ['2026-11-08', 100, 2], ['2026-11-09', 105, 1],
]);
assert.deepEqual(JSON.parse(JSON.stringify(changeSeries(history, 'subs', 7))), [
  ['2026-11-09', -3, 1],
]);
assert.equal(measuredChange(history, 'views', 7, Date.parse('2026-11-09')), null);
assert.equal(measuredChange(history, 'views', 8, Date.parse('2026-11-09')), 805);
assert.equal(measuredChange(history, 'views', 8, Date.parse('2026-11-14')), null);
assert.equal(changeSeries(snapshots([['2026-11-09', 107, 1805]]), 'views', 30).length, 0);

const english = { niche: 'engineering', niche_ai: 'engineering', verified: true, style_group: 'live', language: 'en-GB', country: 'GB' };
const portuguese = { ...english, language: 'en', audio_language: 'pt-PT', languages: ['en', 'pt'], country: 'PT' };
assert.equal(channelLanguage(portuguese), 'pt');
assert.equal(marketKey(english, markets), 'engineering|en');
assert.equal(marketKey(portuguese, markets), 'engineering|pt');
assert.equal(marketKey({ ...portuguese, country: 'BR' }, markets), null);
assert.equal(marketKey({ ...english, country: null }, markets), null);
assert.equal(marketKey({ ...english, language_source: 'query_fallback' }, markets), null);
assert.equal(competitionFor({ ...english, competition: { index: 0 } }), null);
const today = Date.parse('2026-11-27T12:00:00Z');
const oldReading = { index: 0, language: 'en', language_verified: true, market_verified: true, region_code: 'GB' };
const measured = {
  ...oldReading, method_version: 2, niche: 'engineering', checked_at: '2026-11-26',
  queries: ['container ships', 'ship propellers'], videos_seen: 12, related_videos: 6, rival_channels: 3, index: 20,
};
const current = { ...english, videos: [{ published_at: '2026-11-21' }], competition: measured };
const grouping = { n: 4, entry_score: 82, verdict: 'open' };
assert.equal(competitionFor({ ...english, competition: oldReading }, today), null);
assert.equal(competitionFor(current, today).index, 20);
assert.equal(competitionFor({ ...current, competition: { ...measured, niche: 'aviation' } }, today), null);
assert.equal(competitionFor(current, today + 31 * 86400000), null);
const oneQuery = { ...current, competition: { ...measured, queries: ['container ships'], index: 0 } };
assert.equal(competitionEvidence(oneQuery, today).queries.length, 1);
assert.equal(competitionFor(oneQuery, today), null);
assert.equal(entryAssessment(oneQuery, grouping, 187, today).score, null);
assert.equal(entryAssessment(current, grouping, 187, today).score, 64);
assert.equal(entryAssessment(current, grouping, 4, today).score, 82);
assert.equal(entryAssessment({ ...current, verified: undefined }, grouping, 4, today).score, null);

const previous = {
  niche: 'finance', niche_ai: 'finance', verified: true, rpm: 14, rpm_source: 'baseline',
  videos: ['The First 150 Years of Christianity', 'Early Church Explained', 'Theology of the Nicene Creed',
    'What it was like to be an early Christian'].map(title => ({ title })),
};
const corrected = checkTopic(previous);
assert.equal(corrected.niche, 'religion');
assert.equal(corrected.rpm, undefined);
assert.equal(corrected.niche_ai, undefined);
const otherFinance = checkTopic({ ...previous, videos: ['Retirement planning', 'Personal Finance', 'How to invest', 'Bible Stories'].map(title => ({ title })) });
assert.equal(otherFinance.niche, 'finance');
assert.equal(otherFinance.rpm, 14);
const groups = clusters([english, portuguese, { ...portuguese, country: 'BR' }], markets);
assert.equal(groups['engineering|live|en'].n, 1);
assert.equal(groups['engineering|live|pt'].n, 1);
console.log('Catalogue search, historical changes, languages, and markets passed');
