// Meaning-based media matching with global no-repeat (same file, same source item, or visually near-identical frame).
import { searchAll } from './sources.js';
import { textEmbed, imageEmbed, cos } from './ai.js';

const WEATHER = /\b(snow\w*|ice|icy|frozen|frost\w*|blizzard|icicles?|winter\w*|autumn|fall leaves|rain|rainy|raining|rainfall|storm\w*|beach\w*)\b/i;
const tok = s => new Set(String(s || '').toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(w => w.length > 2).map(w => w.slice(0, 5)));
// Longest a single picture may stay on screen; set from the style (classic 5 s, reference documentary ~8 s).
export const CUT = { max: 5 };

export async function gatherCandidates(shots, settings, W, onProgress) {
  let cursor = 0, done = 0;
  const worker = async () => {
    while (cursor < shots.length) {
      const s = shots[cursor++];
      const lists = await Promise.all(s.queries.map((q, qr) => searchAll(settings, q, W, qr).then(r => r.map(c => ({ ...c, qr }))).catch(() => [])));
      const m = new Map(); for (const c of lists.flat()) if (!m.has(c.id) || m.get(c.id).qr > c.qr) m.set(c.id, c);
      s.candidates = [...m.values()];
      onProgress?.(`Поиск кадров: ${++done}/${shots.length}`);
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
}

export const cutsNeeded = s => Math.max(1, Math.ceil((s.end - s.start) / CUT.max - 0.05));

// preUsed: ids/urls already on screen elsewhere; preEmb: their CLIP vectors, so "Найти заново" can't bring back a look-alike frame.
export async function pickMedia(shots, settings, onProgress, preUsed = [], preEmb = []) {
  let useClip = settings.clip !== false, textE = [];
  if (useClip) try { textE = await textEmbed(shots.map(s => `a photo of ${s.visual || s.text}. ${s.meaning || ''}`.slice(0, 300)), onProgress); } catch (e) { console.warn(e); useClip = false; }
  const usedIds = new Set(preUsed), usedEmb = preEmb.filter(v => v?.length).map(v => ({ v }));
  for (const [i, s] of shots.entries()) {
    onProgress?.(`Смысловой подбор (${useClip ? 'CLIP' : 'по словам'}): ${i + 1}/${shots.length}`);
    const need = cutsNeeded(s), len = (s.end - s.start) / need;
    const target = tok(`${s.text} ${s.visual} ${s.queries.join(' ')}`);
    const pre = c => [...tok(c.tags)].filter(w => target.has(w)).length + (c.qr === 0 ? 1 : c.qr === 1 ? 0.5 : 0) + (c.kind === 'video' ? 0.5 : 0);
    const pool = (s.candidates || []).filter(c => !usedIds.has(c.id) && !usedIds.has(c.url)).sort((a, b) => pre(b) - pre(a)).slice(0, 48);
    let embs = [];
    if (useClip && pool.length) try { embs = await imageEmbed(pool.map(c => c.thumb), onProgress); } catch (e) { console.warn(e); }
    pool.forEach((c, k) => {
      c.emb = embs[k] || null;
      c.sim = c.emb && textE[i] ? cos(c.emb, textE[i]) : null;
      const overlap = [...tok(c.tags)].filter(w => target.has(w)).length;
      const tooShort = c.kind === 'video' && c.duration && c.duration < len * 0.6 ? 2 : 0; // would have to be slowed down a lot
      c.score = (c.sim != null ? c.sim * 100 : overlap * 3) + (c.kind === 'video' ? (settings.preferVideo ? 2.5 : 1) : 0) + (c.qr === 0 ? 0.8 : c.qr === 1 ? 0.4 : 0) + (c.sim != null ? overlap * 0.3 : 0) - tooShort - (WEATHER.test(c.tags) && !WEATHER.test(`${s.text} ${s.visual} ${s.meaning}`) ? 8 : 0) - (/\b(chart|diagram|graph|logo|map|svg|icon|table|document|scan|text)\b/i.test(c.tags) ? 6 : 0);
    });
    pool.sort((a, b) => b.score - a.score);
    // Off-meaning = clearly worse than the best match of this scene (not just below a fixed number).
    const best = Math.max(-1, ...pool.map(c => c.sim ?? -1));
    const floor = best >= 0.17 ? Math.max(0.17, best - 0.07) : -Infinity;
    const ok = (c, strict) => {
      if (c.sim != null && c.sim < (strict ? floor : Math.min(floor, 0.15))) return false;
      if (c.emb && usedEmb.some(e => cos(e.v, c.emb) > 0.93)) return false; // visually the same frame
      if (strict && c.emb && usedEmb.slice(-3).some(e => cos(e.v, c.emb) > 0.88)) return false; // too similar to neighbours
      return true;
    };
    s.picks = [];
    // Second, relaxed pass only fills long scenes, so a single clip is not stretched far past 5 s.
    for (const strict of [true, false]) for (const c of pool) {
      if (s.picks.length >= need) break;
      if (s.picks.includes(c) || !ok(c, strict)) continue;
      s.picks.push(c); usedIds.add(c.id); usedIds.add(c.url); if (c.emb) usedEmb.push({ v: c.emb });
    }
    s.candidates = pool.slice(0, 16).map(({ emb, ...c }) => c);
    planCuts(s);
  }
}

// Scenes that got fewer clips than they need: search wider (the visual description, the meaning, the story topic) and pick again.
export async function refillShort(all, settings, topic, onProgress) {
  const short = all.filter(s => (s.picks?.length || 0) < cutsNeeded(s));
  if (!short.length) return 0;
  const words = t => String(t || '').split(/\s+/).filter(w => w.length > 2).slice(0, 5).join(' ');
  for (const s of short) {
    s.oldCandidates = s.candidates || [];
    s.queriesBak = s.queries;
    s.queries = [...new Set([words(s.visual), words(s.meaning), topic].filter(q => q && !s.queries.includes(q)))].slice(0, 3);
  }
  await gatherCandidates(short.filter(s => s.queries.length), settings, 1920, onProgress);
  for (const s of short) {
    const fresh = s.queries.length ? s.candidates.map(c => ({ ...c, qr: 2 })) : []; // wider queries rank below the original ones
    const m = new Map([...fresh, ...s.oldCandidates].map(c => [c.id, c]));
    s.candidates = [...m.values()]; s.queries = s.queriesBak; delete s.oldCandidates; delete s.queriesBak;
  }
  const others = all.filter(s => !short.includes(s)).flatMap(s => s.picks || []);
  await pickMedia(short, settings, onProgress, others.flatMap(p => [p.id, p.url]), others.map(p => p.emb));
  return short.length;
}

export function planCuts(s) {
  const n = s.picks.length || 1, seg = (s.end - s.start) / n;
  s.cuts = s.picks.map((c, k) => {
    const len = Math.min(seg, CUT.max + 0.5);
    const d = c.duration || 0, room = Math.max(0, d - len - 0.5);
    return { media: c, t0: s.start + k * seg, t1: s.start + (k + 1) * seg, from: c.kind === 'video' ? Math.min(room, c.start != null ? c.start : 0.5 + room * 0.25) : 0 };
  });
}
