// Meaning-based media matching with global no-repeat (same file, same source item, or visually near-identical frame).
import { searchAll } from './sources.js';
import { textEmbed, imageEmbed, cos } from './ai.js';

const WEATHER = /\b(snow\w*|ice|icy|frozen|frost\w*|blizzard|icicles?|winter\w*|autumn|fall leaves|rain|rainy|raining|rainfall|storm\w*|beach\w*)\b/i;
const tok = s => new Set(String(s || '').toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(w => w.length > 2).map(w => w.slice(0, 5)));
export const MAX_CUT = 5;

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

export async function pickMedia(shots, settings, onProgress, preUsed = []) {
  let useClip = settings.clip !== false, textE = [];
  if (useClip) try { textE = await textEmbed(shots.map(s => `a photo of ${s.visual || s.text}. ${s.meaning || ''}`.slice(0, 300)), onProgress); } catch (e) { console.warn(e); useClip = false; }
  const usedIds = new Set(preUsed), usedEmb = [];
  for (const [i, s] of shots.entries()) {
    onProgress?.(`Смысловой подбор (${useClip ? 'CLIP' : 'по словам'}): ${i + 1}/${shots.length}`);
    const target = tok(`${s.text} ${s.visual} ${s.queries.join(' ')}`);
    const pre = c => [...tok(c.tags)].filter(w => target.has(w)).length + (c.qr === 0 ? 1 : c.qr === 1 ? 0.5 : 0) + (c.kind === 'video' ? 0.5 : 0);
    const pool = (s.candidates || []).filter(c => !usedIds.has(c.id) && !usedIds.has(c.url)).sort((a, b) => pre(b) - pre(a)).slice(0, 48);
    let embs = [];
    if (useClip && pool.length) try { embs = await imageEmbed(pool.map(c => c.thumb), onProgress); } catch (e) { console.warn(e); }
    pool.forEach((c, k) => {
      c.emb = embs[k] || null;
      c.sim = c.emb && textE[i] ? cos(c.emb, textE[i]) : null;
      const overlap = [...tok(c.tags)].filter(w => target.has(w)).length;
      c.score = (c.sim != null ? c.sim * 100 : overlap * 3) + (c.kind === 'video' ? (settings.preferVideo ? 2.5 : 1) : 0) + (c.qr === 0 ? 0.8 : c.qr === 1 ? 0.4 : 0) + (c.sim != null ? overlap * 0.3 : 0) - (WEATHER.test(c.tags) && !WEATHER.test(`${s.text} ${s.visual} ${s.meaning}`) ? 8 : 0) - (/\b(chart|diagram|graph|logo|map|svg|icon|table|document|scan|text)\b/i.test(c.tags) ? 6 : 0);
    });
    pool.sort((a, b) => b.score - a.score);
    const dur = s.end - s.start, need = Math.max(1, Math.ceil(dur / MAX_CUT - 0.05));
    s.picks = [];
    for (const c of pool) {
      if (c.sim != null && c.sim < 0.17 && pool.some(x => x !== c && x.sim >= 0.17 && !s.picks.includes(x))) continue; // off-meaning
      if (s.picks.length >= need) break;
      if (c.emb && usedEmb.some(e => cos(e.v, c.emb) > 0.93)) continue; // visually the same frame
      if (c.emb && usedEmb.slice(-3).some(e => cos(e.v, c.emb) > 0.88)) continue; // too similar to neighbours
      s.picks.push(c); usedIds.add(c.id); usedIds.add(c.url); if (c.emb) usedEmb.push({ v: c.emb });
    }
    s.candidates = pool.slice(0, 16).map(({ emb, ...c }) => c);
    planCuts(s);
  }
}

export function planCuts(s) {
  const n = s.picks.length || 1, seg = (s.end - s.start) / n;
  s.cuts = s.picks.map((c, k) => {
    const len = Math.min(seg, MAX_CUT + 0.5);
    const d = c.duration || 0, room = Math.max(0, d - len - 0.5);
    return { media: c, t0: s.start + k * seg, t1: s.start + (k + 1) * seg, from: c.kind === 'video' ? Math.min(room, c.start != null ? c.start : 0.5 + room * 0.25) : 0 };
  });
}
