// Harness for niche-radar/live.js: loads the IIFE with a fake window + fetch so the
// discovery plan and the competition reading can be checked without an API key.
//
// Run it with:  node niche-radar/tests/test-live.mjs
//
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import vm from 'vm';

const SRC = process.argv[2] || fileURLToPath(new URL('../live.js', import.meta.url));
const code = readFileSync(SRC, 'utf8');

let assertions = 0, failures = 0;
const ok = (cond, name, extra) => {
  assertions++;
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b });

// ---- fixtures ---------------------------------------------------------------------
const PROBE = "How 10,000 People Live on the World's Biggest Cruise Ship";
const CATALOGUE = [
  { id: 'UCself', title: 'Civilization Engine', niche: 'engineering', language: 'en', score: 90,
    videos: [{ id: 'v1', title: PROBE, views: 3737406, is_outlier: true },
             { id: 'v2', title: 'The 5 Biggest Container Ships. Why Do Captains Fear Them?', views: 2004424, is_outlier: true }],
    avg_views_first_5: 1243069 },
  { id: 'UCww2', title: 'The Forgotten Front', niche: 'history', language: 'en', score: 70,
    videos: [{ id: 'v3', title: 'Why Chinese Soldiers Dreaded the Turkish Brigade in Korea', views: 588000, is_outlier: true }],
    avg_views_first_5: 300000, competition: { checked_at: '2026-11-01', index: 80 } },
  { id: 'UCgrown', title: 'Grown Rival', niche: 'engineering', language: 'en', score: 40,
    graduated: true, videos: [{ id: 'v4', title: 'Giant Machines Explained', views: 10 }] },
  { id: 'UCnovid', title: 'No Videos', niche: 'science', language: 'en', videos: [] },
];
const QUERIES = {
  modifiers: ['explained', 'documentary'],
  queries: [
    { text: 'the engineering behind', niche: 'engineering', lang: 'en' },
    { text: 'history explained stick figures', niche: 'history', lang: 'en' },
    { text: 'plate tectonics explained', niche: 'science', lang: 'en' },
    { text: 'retirement mistakes explained', niche: 'finance', lang: 'en' },
  ],
};
const RPM = {
  niches: { engineering: { ru_name: 'Инженерия', us: 7, other: 4 }, other: { ru_name: 'Другое', us: 4, other: 3 } },
  country_to_region: { US: 'us' }, lang_to_region: { en: 'us' }, region_ru: { us: 'США/UK' },
};
const SEARCH_PAGE = [
  ['UCnext', 'NEXT ENGINE', "The world's largest Cruise ship. How 10,000 People Live on a Giant Cruise Ship?", '2026-10-05T00:00:00Z'],
  ['UCpresh', 'Preshcute Builds', PROBE, '2026-10-26T00:00:00Z'],
  ['UCaurio', 'AURIO', "Life Inside the World's Biggest Cruise Ship | How 10,000 People Live in This Floating City", '2026-09-05T00:00:00Z'],
  ['UCroyal', 'ROYAL ARCHIVES', "Inside a Giant CRUISE SHIP |How 10,000 PEOPLE Live on the World's Biggest CRUISE SHIP!", '2026-10-22T00:00:00Z'],
  ['UCbeyond', 'Beyond Facts', "Inside the World's Largest Cruise Ship Ever Built", '2026-06-05T00:00:00Z'],
  ['UCnoise', 'CTV News', "Crews begin production of Canada's largest ever polar icebreaker", '2026-10-01T00:00:00Z'],
  ['UCself', 'Civilization Engine', PROBE, '2026-09-05T00:00:00Z'],
];

// ---- fake environment -------------------------------------------------------------
const calls = [];
function makeSandbox() {
  const win = {};
  const fakeFetch = async (input) => {
    const url = String(input);
    if (url.includes('queries.json')) return { ok: true, json: async () => QUERIES };
    if (url.includes('rpm_baseline.json')) return { ok: true, json: async () => RPM };
    const u = new URL(url);
    const resource = u.pathname.split('/').pop();
    calls.push({ resource, params: Object.fromEntries(u.searchParams) });
    if (resource === 'search') {
      return { ok: true, json: async () => ({
        items: SEARCH_PAGE.map(([cid, cname, title, pub]) => ({
          snippet: { channelId: cid, channelTitle: cname, title, publishedAt: pub },
        })),
      }) };
    }
    if (resource === 'channels') {
      const ids = (u.searchParams.get('id') || '').split(',');
      return { ok: true, json: async () => ({ items: ids.map(id => ({
        id,
        snippet: { title: 'Rival ' + id, customUrl: '@' + id, country: 'US',
          description: 'ships and engineering', thumbnails: { medium: { url: 't.jpg' } },
          localized: { title: 'Rival ' + id, description: 'ships and engineering' } },
        statistics: { subscriberCount: '5000', viewCount: '900000', videoCount: '12' },
        contentDetails: { relatedPlaylists: { uploads: 'UU' + id } },
      })) }) };
    }
    if (resource === 'playlistItems') {
      return { ok: true, json: async () => ({ items: [1, 2, 3, 4].map(i => ({ contentDetails: { videoId: 'vid' + i } })) }) };
    }
    if (resource === 'videos') {
      const ids = (u.searchParams.get('id') || '').split(',');
      // A multi-language channel: Spanish is the default locale, English is the
      // localization that hl=en returns. This is the exact shape that used to make a
      // US-facing channel read as Spanish.
      return { ok: true, json: async () => ({ items: ids.map((id, i) => ({
        id,
        snippet: { title: i === 0 ? 'Cómo Viven 10.000 Personas en el Crucero Más Grande' : 'Otro documental de barcos ' + i,
          description: 'd', tags: ['ships'], publishedAt: '2026-09-0' + (i + 1) + 'T00:00:00Z',
          defaultAudioLanguage: 'es', defaultLanguage: 'es',
          localized: { title: i === 0 ? PROBE : 'Another ship documentary ' + i },
          thumbnails: { medium: { url: 'v.jpg' } } },
        statistics: { viewCount: String(100000 * (i + 1)) },
        contentDetails: { duration: 'PT21M30S' },
      })) }) };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  };
  const sandbox = { window: win, fetch: fakeFetch, URL, console, Date, Math, JSON, Set, Map, Number, String, Object, Array, RegExp, Promise, isNaN, parseInt, parseFloat, setTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return win;
}

console.log('live.js discovery engine');
const win = makeSandbox();
ok(!!win.NR_LIVE && typeof win.NR_LIVE.run === 'function', 'exposes NR_LIVE.run');

const res = await win.NR_LIVE.run(
  { key: 'k', maxQueries: 9, catalogue: CATALOGUE },
  () => {},
);

const searches = calls.filter(c => c.resource === 'search');
console.log('\nquery plan');
searches.forEach(s => console.log(`     q="${s.params.q}" dur=${s.params.videoDuration} order=${s.params.order}`));

// This fixture only has two minable channels, so the plan mines both and fills the rest
// with seeds. The 2:1 ratio is checked separately against a catalogue big enough for it.
eq(res.mined, 2, 'mines every minable channel in the catalogue');
eq(res.mined + res.explored, res.queries, 'mined + explored accounts for every query');
// Only mined queries use order=relevance and the 180-day window; seeds use viewCount.
ok(searches.slice(0, 2).every(s => s.params.order === 'relevance'),
  'mined titles are searched first', searches.slice(0, 2).map(s => s.params.order));
ok(searches.slice(2).every(s => s.params.order === 'viewCount'), 'seed queries sort by views');
ok(searches.some(s => s.params.videoDuration === 'long'), 'searches long-form, not only medium');
ok(searches.every(s => s.params.maxResults === '50'), 'asks for a full result page');

// Channels already in the catalogue must not be re-fetched.
const fetchedIds = calls.filter(c => c.resource === 'channels').flatMap(c => (c.params.id || '').split(','));
ok(!fetchedIds.includes('UCself'), 'does not spend quota re-fetching known channels');
ok(fetchedIds.includes('UCnext'), 'fetches details for newly found channels');
ok(calls.filter(c => c.resource === 'channels').every(c => c.params.hl === 'en'), 'channels.list asks for English metadata');
ok(calls.filter(c => c.resource === 'videos').every(c => c.params.hl === 'en'), 'videos.list asks for English metadata');

console.log('\ncompetition measured from the same pages');
const patch = (res.competition || []).find(p => p.id === 'UCself');
ok(!!patch, 'produces a competition patch for the mined channel');
if (patch) {
  const k = patch.competition;
  console.log(`     index=${k.index} ${k.verdict_ru}  rivals=${k.rival_channels} clones=${k.clone_channels}/${k.clone_videos} share=${k.clone_share}`);
  eq(k.clone_channels, 4, 'counts the four channels copying the title');
  eq(k.rival_channels, 5, 'counts rivals on the topic, excluding unrelated news');
  ok(!k.top_rivals.some(r => r.id === 'UCself'), 'never counts the channel against itself');
  ok(!k.top_rivals.some(r => r.id === 'UCnoise'), 'excludes unrelated results');
  eq(k.verdict, 'competitive', 'verdict matches the observed clone cluster');
  eq(k.clones_30d, 2, 'counts copies published in the last 30 days');
}

console.log('\nlanguage of newly found channels');
const found = res.channels[0];
ok(!!found, 'returns the new channels it analysed');
if (found) {
  console.log(`     language=${found.language} languages=${JSON.stringify(found.languages)} source=${found.language_source} multilang=${found.is_multilang}`);
  eq(found.language, 'en', 'US channel with an English localization reads as English');
  ok(found.languages.includes('es'), 'keeps the channel\'s own language too');
  ok(found.is_multilang === true, 'marks it multi-language');
  ok(!!found.competition, 'new channel also gets a competition reading');
  ok(found.cluster && found.cluster.endsWith('|en'), 'cluster key uses the resolved language', found.cluster);
}

// ---- ratio on a catalogue large enough to show it ---------------------------------
console.log('\nmine:explore ratio on a full catalogue');
calls.length = 0;
// Distinct subjects, because the planner de-duplicates identical query text — two
// channels whose titles reduce to the same words are one search, not two.
const SUBJECTS = ['cruise ships', 'container vessels', 'icebreakers', 'oil platforms', 'cargo planes',
  'submarines', 'tunnel borers', 'dry docks', 'crane barges', 'nuclear reactors'];
const big = SUBJECTS.flatMap((subject, i) => [0, 1, 2, 3].map(j => ({
  id: `UCbig${i}_${j}`, title: `Channel ${i}-${j}`, niche: 'engineering', language: 'en', score: 50 + i,
  videos: [{ id: `b${i}${j}`, title: `How ${subject} really ${['work', 'fail', 'get built', 'get scrapped'][j]} explained`, views: 500000, is_outlier: true }],
  avg_views_first_5: 300000,
})));
const win2 = makeSandbox();
const res2 = await win2.NR_LIVE.run({ key: 'k', maxQueries: 9, catalogue: big }, () => {});
console.log(`     mined=${res2.mined} explored=${res2.explored}`);
eq(res2.mined, 6, 'two of every three queries dig into clusters');
eq(res2.explored, 3, 'one of every three queries explores new niches');

console.log('\nfilters restrict the plan');
calls.length = 0;
const win3 = makeSandbox();
await win3.NR_LIVE.run({ key: 'k', maxQueries: 4, catalogue: CATALOGUE, niche: 'history' }, () => {});
const q3 = calls.filter(c => c.resource === 'search').map(s => s.params.q);
ok(q3.some(q => /chinese soldiers/i.test(q)), 'mines only the chosen niche', q3);
ok(!q3.some(q => /cruise ship/i.test(q)), 'leaves other niches alone', q3);

console.log(`\n${assertions - failures}/${assertions} checks passed`);
process.exit(failures ? 1 : 0);
