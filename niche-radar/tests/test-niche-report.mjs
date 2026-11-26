import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const now = Date.parse('2026-11-26T20:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

const ago = days => new Date(now - days * 86400000).toISOString();
const video = (id, views, days, properties = {}) => ({
  id, views, published_at: ago(days), duration_sec: 600, title: 'Bridge engineering test ' + id, ...properties,
});
const window = {};
const ids = { local: 'UC' + 'A'.repeat(22), wrongLanguage: 'UC' + 'B'.repeat(22), wrongMarket: 'UC' + 'C'.repeat(22), knownOther: 'UC' + 'D'.repeat(22) };
const apiVideos = {
  found: [ids.local, 'en-US', 'Bridge engineering test', '4500'],
  fresh: [ids.local, 'en', 'Bridge engineering review', '1000'],
  unknownViews: [ids.local, 'en', 'Bridge engineering review', undefined],
  irrelevant: [ids.local, 'en', 'Chocolate cake recipe', '4000'],
  portuguese: [ids.wrongLanguage, 'pt-PT', 'Bridge engineering test', '20000'],
  brazil: [ids.wrongMarket, 'en', 'Bridge engineering test', '12000'],
  metadataConflict: [ids.knownOther, 'en', 'Bridge engineering report', '50000'],
};
const captured = [];
const fetch = async input => {
  const url = new URL(input);
  const resource = url.pathname.split('/').pop();
  const options = url.searchParams;
  captured.push([resource, Object.fromEntries(options)]);
  let items;
  if (resource === 'search') {
    items = ['found', 'found', 'portuguese', 'brazil', 'metadataConflict', 'irrelevant'].map(id => ({ id: { videoId: id } }));
  } else if (resource === 'videos') {
    items = options.get('id').split(',').map(id => {
      const [channelId, language, title, viewCount] = apiVideos[id];
      return { id, snippet: { channelId, title, defaultAudioLanguage: language, publishedAt: ago(id === 'fresh' ? 5 : 10) },
        statistics: { viewCount }, contentDetails: { duration: 'PT10M' } };
    });
  } else if (resource === 'channels') {
    const requested = options.get('id')?.split(',') || [ids.local];
    items = requested.map(id => ({
      id, snippet: { title: 'Channel ' + id, country: id === ids.wrongMarket ? 'BR' : 'US' },
      statistics: { subscriberCount: '12', videoCount: '4', viewCount: '9000' },
      contentDetails: { relatedPlaylists: { uploads: id } },
    }));
  } else if (resource === 'playlistItems') {
    items = ['found', 'fresh', 'unknownViews', 'irrelevant'].map(id => ({ contentDetails: { videoId: id } }));
  } else throw new Error('Unexpected endpoint ' + resource);
  return { ok: true, json: async () => ({ items }) };
};
const context = vm.createContext({ window, Date: FixedDate, URL, fetch });
for (const filename of ['catalogue.js', 'niche-analysis.js', 'live.js']) {
  vm.runInContext(readFileSync(new URL('../' + filename, import.meta.url), 'utf8'), context);
}
const { build, timeline, queryPlan } = window.NR_NICHE_ANALYSIS;
const model = build([
  { id: 'new', title: 'New', subs: 12, videos: [
    video('a', 100000, 12), video('b', 1500, 16), video('c', 1200, 20), video('new', 0, 2),
    video('missing', 0, 4, { views_available: false }), video('b', 1500, 16),
  ] },
  { id: 'low', title: 'Low', videos: [video('d', 0, 8), video('e', 10, 13), video('f', 50, 20)] },
  { id: 'old', title: 'Old', videos: [video('g', 200, 300)] },
], { now });
assert.equal(model.videos.length, 9);
assert.equal(model.measured.length, 8);
assert.equal(model.summary.views, 102960);
assert.equal(model.traction.length, 1);
assert.equal(model.low.length, 1);
assert.equal(model.summary.comparableNewcomers, 2);
assert.equal(model.hits.length, 1);
assert.equal(model.week.length, 2);
assert.equal(model.summary.weekChannels, 1);
assert.equal(timeline(model, 7, 4, 'median').at(-1).value, 0);
assert.equal(timeline(build([], { now }), 7, 4, 'median').at(-1).value, null);
assert.equal(model.packaging.phrases[0].channels, 3);
assert.equal(build([{ id: 'short', videos: [video('short', 50, 2, { duration_sec: 59 })] }], { now, minSeconds: 180 }).videos.length, 0);

const markets = { en: ['US', 'GB'] };
const plan = queryPlan({ query: 'bridge engineering', label: 'Engineering', regions: ['US'], language: 'en' });
assert.equal(plan.length, 2);
assert.equal(plan[0].query, 'bridge engineering');
assert.equal(plan[1].order, 'date');
const { researchNiche, inspectChannel } = window.NR_LIVE;
const result = await researchNiche({ key: 'fixture', language: 'en', markets, country: 'US', plan,
  catalogue: [{ id: ids.knownOther, language: 'pt', country: 'PT' }],
});
assert.equal(result.rawVideos, 5);
assert.equal(result.checkedChannels, 1);
assert.equal(result.languageRejected, 2);
assert.equal(result.topicRejected, 1);
assert.equal(result.marketRejected, 1);
assert.equal(result.channels.length, 1);
assert.equal(result.channels[0].id, ids.local);
assert.equal(result.channels[0].subs, 12, 'keeps small channels');
assert.deepEqual(Array.from(result.channels[0].videos, item => item.id), ['found', 'fresh', 'unknownViews']);
assert.equal(result.channels[0].videos[2].views_available, false);
assert.equal(captured.filter(([type]) => type === 'search').length, 2);
assert(captured.filter(([type]) => type === 'search').every(([, options]) => options.regionCode === 'US'));
await assert.rejects(researchNiche({ key: 'fixture', language: 'en', markets, plan: [{ ...plan[0], region: 'BR' }] }), /языка и страны/);
const owned = await inspectChannel({ key: 'fixture', reference: 'https://www.youtube.com/@actualchannel/videos' });
assert.equal(owned.total_views, 9000);
assert(captured.some(([type, options]) => type === 'channels' && options.forHandle === '@actualchannel'));
await assert.rejects(inspectChannel({ key: 'fixture', reference: 'https://example.com/@actualchannel' }), /Укажите/);
console.log('Niche report metrics, discovery checks, and channel lookup passed');
