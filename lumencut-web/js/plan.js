// Script → shots, timing, meaning-based plan (Gemini or heuristic).
import { ovWindow } from './gfx.js';
export const SFX = ['whoosh','swish','impact','hit','riser','slowmo','freeze','tick','clock','heartbeat','pop','blip','counter','ding','shimmer','stinger','footstep','kick','whistle','carpass','phonebuzz','phonering','cheer','applause','murmur','rain','thunder','wind','roomtone','city','hum','powerup','glitch','flash','buzz'];
export const MOODS = ['mystery','tension','action','wonder','hopeful','sad','triumph','playful','calm','dark','epic'];
export const OVERLAYS = ['none','keyword','number','date','place','quote','chapter'];
// "doc" look (reference documentary): see gfx.js
export const DOC_OVERLAYS = ['none','counter','stat','year','title','lowerthird','infocard','panel','checklist','chart','map','name','statement'];
const CLASSIC_TO_DOC = { number: 'counter', date: 'year', place: 'title', keyword: 'title', chapter: 'title', quote: 'statement' };

const STOP = new Set('january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday the a an and or but in on at to for of with from by was were is are as this that these those it its they them their there then than so if not no yes be been being have has had do does did will would can could should just also very about into over only what when where which who why how you your we our he she his her i me my'.split(' '));

export const norm = w => String(w).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '');

export function splitShots(script, maxWords = 12) {
  const sentences = String(script).replace(/\r/g, '').split(/\n+/).flatMap(p => p.match(/[^.!?…]+[.!?…]+["»”')]*|[^.!?…]+$/g) || []).map(s => s.trim()).filter(Boolean);
  const shots = [];
  for (const s of sentences) {
    const words = s.split(/\s+/);
    if (words.length <= maxWords + 3) { shots.push(s); continue; }
    let cur = [];
    words.forEach((w, i) => {
      cur.push(w);
      const left = words.length - i - 1;
      const soft = /[,;:—–-]$/.test(w) && cur.length >= 5;
      if ((soft || cur.length >= maxWords) && left >= 4) { shots.push(cur.join(' ')); cur = []; }
    });
    if (cur.length) shots.push(cur.join(' '));
  }
  return shots.map((text, i) => ({ id: i, text }));
}

// Joins neighbouring short lines so one picture stays on screen at least minDur seconds (the reference holds shots
// 3–8 s, longer than one sentence often lasts). Runs after timing; word timings are carried over.
export function mergeShort(shots, minDur, maxDur = 9) {
  if (!minDur) return shots;
  const out = [];
  for (const s of shots) {
    const last = out.at(-1);
    if (last && last.end - last.start < minDur && s.end - last.start <= maxDur && last.text.split(/\s+/).length + s.text.split(/\s+/).length <= 34) {
      last.text = `${last.text} ${s.text}`; last.wt = last.wt && s.wt ? [...last.wt, ...s.wt] : undefined; last.end = s.end; last.wordEnd = s.wordEnd ?? s.end;
    } else out.push({ ...s });
  }
  return out.map((s, i) => ({ ...s, id: i }));
}

// Needleman–Wunsch alignment of script words to Whisper words → start/end per shot.
export function alignTiming(shots, asrWords, totalDur) {
  const sw = []; shots.forEach((s, si) => s.text.split(/\s+/).forEach((w, wi) => { const n = norm(w); if (n) sw.push({ n, si, wi }); }));
  const aw = asrWords.map(w => ({ n: norm(w.text), s: w.start, e: w.end })).filter(w => w.n);
  const N = sw.length, M = aw.length, W = M + 1;
  const score = new Int32Array((N + 1) * W), dir = new Uint8Array((N + 1) * W);
  for (let i = 1; i <= N; i++) { score[i * W] = -i; dir[i * W] = 1; }
  for (let j = 1; j <= M; j++) { score[j] = -j; dir[j] = 2; }
  for (let i = 1; i <= N; i++) for (let j = 1; j <= M; j++) {
    const a = sw[i - 1].n, b = aw[j - 1].n;
    const m = a === b ? 2 : (a.slice(0, 4) === b.slice(0, 4) ? 1 : -1);
    const d = score[(i - 1) * W + j - 1] + m, u = score[(i - 1) * W + j] - 1, l = score[i * W + j - 1] - 1;
    if (d >= u && d >= l) { score[i * W + j] = d; dir[i * W + j] = 0; } else if (u >= l) { score[i * W + j] = u; dir[i * W + j] = 1; } else { score[i * W + j] = l; dir[i * W + j] = 2; }
  }
  const match = new Array(N).fill(null); let i = N, j = M;
  while (i > 0 || j > 0) { const d = dir[i * W + j]; if (i > 0 && j > 0 && d === 0) { match[i - 1] = aw[j - 1]; i--; j--; } else if (i > 0 && (j === 0 || d === 1)) i--; else j--; }
  const first = shots.map(() => null), last = shots.map(() => null);
  const wt = shots.map(s => new Array(s.text.split(/\s+/).length).fill(null));
  sw.forEach((w, k) => { const m = match[k]; if (!m) return; if (first[w.si] == null) first[w.si] = m.s; last[w.si] = m.e; wt[w.si][w.wi] = m.s; });
  fillTiming(shots, first, last, totalDur);
  shots.forEach((s, k) => { s.wt = wordTimes(wt[k], s.start, s.wordEnd); });
  return shots;
}

// Start time of every script word (for karaoke subtitles in sync with the voice); unmatched words are interpolated.
function wordTimes(t, a, b) {
  const n = t.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (t[i] != null) { out[i] = t[i]; continue; }
    let p = i - 1; while (p >= 0 && t[p] == null) p--;
    let q = i + 1; while (q < n && t[q] == null) q++;
    const ta = p >= 0 ? t[p] : a, tb = q < n ? t[q] : b;
    out[i] = ta + (tb - ta) * (i - p) / (q - p);
  }
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1]);
  return out.map(x => Math.round(x * 100) / 100);
}

export function estimateTiming(shots, wps = 2.6) {
  let t = 0; const first = [], last = [];
  shots.forEach(s => { const n = s.text.split(/\s+/).length; first.push(t); t += n / wps + 0.25; last.push(t - 0.25); });
  return fillTiming(shots, first, last, t + 0.5);
}

function fillTiming(shots, first, last, totalDur) {
  const n = shots.length;
  for (let k = 0; k < n; k++) if (first[k] == null) { // interpolate missing
    const prev = k ? (last[k - 1] ?? first[k - 1] ?? 0) : 0;
    let nx = k + 1; while (nx < n && first[nx] == null) nx++;
    const next = nx < n ? first[nx] : totalDur; first[k] = prev + (next - prev) * 0.5 / (nx - k);
  }
  shots.forEach((s, k) => { s.start = k === 0 ? 0 : Math.max(first[k] - 0.08, shots[k - 1].start + 0.4); });
  shots.forEach((s, k) => { s.end = k < n - 1 ? shots[k + 1].start : Math.max(totalDur, s.start + 1); s.wordEnd = last[k] ?? s.end; });
  return shots;
}

export function significant(text) {
  return String(text).split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, '')).filter(w => w && !STOP.has(w.toLowerCase()) && (/\d/.test(w) || w.length > 3));
}

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
// Voiceover scripts often spell numbers out ("forty-six cottages"): returns { value, words } for the number starting at word i.
function spelledNumber(words, i) {
  let total = 0, cur = 0, k = i, any = false;
  for (; k < words.length; k++) {
    const w = words[k].toLowerCase().replace(/[^a-z-]/g, ''); if (!w) break;
    const parts = w.split('-'); let ok = true, v = 0;
    for (const p of parts) { if (p in ONES) v += ONES[p]; else if (p in TENS) v += TENS[p]; else { ok = false; break; } }
    if (ok && parts.every(Boolean)) { cur += v; any = true; continue; }
    if (w in SCALE && any) { if (SCALE[w] === 100) cur *= 100; else { total += cur * SCALE[w]; cur = 0; } continue; }
    if (w === 'and' && any && k + 1 < words.length && /^[a-z-]+$/i.test(words[k + 1]) && (words[k + 1].toLowerCase().split('-')[0] in ONES || words[k + 1].toLowerCase().split('-')[0] in TENS)) continue;
    break;
  }
  return any ? { value: total + cur, n: k - i } : null;
}

const UNIT_STOP = new Set([...STOP, 'more', 'less', 'times', 'per', 'cent', 'percent']);
function detectOverlay(text) {
  const words = String(text).split(/\s+/);
  const year = text.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  const num = text.match(/(\$|€|£)?\s?(\d[\d,.]*\d|\d)\s?(%|percent|million|billion|thousand|trillion)?(?:\s+([A-Za-z][A-Za-z-]+))?/i);
  if (year && (!num || num[2] === year[1])) return { type: 'date', text: year[1], word: year[1] };
  let value, prefix = '', suffix = '', unit = '', word;
  if (num && num[2].replace(/[,.]/g, '').length >= 2) {
    value = parseFloat(num[2].replace(/,/g, '')); prefix = num[1] || ''; word = num[2];
    suffix = num[3] ? (/percent|%/i.test(num[3]) ? '%' : ' ' + num[3].toUpperCase()) : '';
    if (num[4] && !UNIT_STOP.has(num[4].toLowerCase())) unit = num[4].toUpperCase();
  } else {
    for (let i = 0; i < words.length; i++) {
      const sp = spelledNumber(words, i); if (!sp || sp.value < 10) { if (sp) i += sp.n - 1; continue; }
      value = sp.value; word = words[i].replace(/[^A-Za-z-]/g, '');
      let next = (words[i + sp.n] || '').replace(/[^A-Za-z%-]/g, '');
      if (/^(percent|%)$/i.test(next)) { suffix = '%'; next = (words[i + sp.n + 1] || '').replace(/[^A-Za-z-]/g, ''); }
      if (/^dollars?$/i.test(next)) { prefix = '$'; next = ''; }
      if (next && !UNIT_STOP.has(next.toLowerCase())) unit = next.toUpperCase();
      break;
    }
  }
  if (value != null) return { type: 'number', value, prefix, suffix, unit, word, text: `${prefix}${value.toLocaleString('en-US')}${suffix}` };
  // place: two capitalised words after in/at/near ("in Crystal Cove")
  const place = text.match(/\b(?:in|at|near|from)\s+((?:[A-Z][a-z]+\s){1,2}[A-Z][a-z]+|[A-Z][a-z]{3,}\s[A-Z][a-z]{3,})/);
  if (place) return { type: 'place', text: place[1], word: place[1].split(' ')[0] };
  return { type: 'none' };
}

// Classic overlay → doc overlay (same facts, the reference's look).
export function toDoc(o, i = 0) {
  if (!o || o.type === 'none' || DOC_OVERLAYS.includes(o.type)) return o || { type: 'none' };
  const type = CLASSIC_TO_DOC[o.type] || 'none';
  if (type === 'counter' && i % 3 === 2) return { ...o, type: 'stat' };
  return { ...o, type };
}

export function heuristicPlan(shots, style) {
  const counts = new Map();
  shots.forEach(s => significant(s.text).forEach(w => { const k = w.toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); }));
  const topic = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(' ');
  shots.forEach((s, i) => {
    const words = significant(s.text); const longest = [...new Set(words)].sort((a, b) => b.length - a.length);
    s.meaning = s.text; s.visual = words.slice(0, 6).join(' ');
    s.queries = [longest.slice(0, 3).join(' '), `${longest.slice(0, 2).join(' ')} ${topic}`.trim(), longest[0] || topic].filter(Boolean);
    s.overlay = detectOverlay(s.text);
    s.sfx = { number: 'counter', date: 'blip', keyword: 'whoosh' }[s.overlay.type] || (i % 6 === 3 ? 'swish' : 'none');
    if (style?.look === 'doc') { s.overlay = toDoc(s.overlay, i); s.sfx = 'none'; }
    s.mood = 'mystery';
  });
  return { topic, shots };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function gemini(key, model, prompt, attempt = 0) {
  const models = [...new Set([model, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'].filter(Boolean))];
  let lastErr;
  for (const m of models) {
    for (let a = 0; a < 3; a++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: Array.isArray(prompt) ? prompt : [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.5 } })
      }).catch(e => ({ ok: false, status: 0, e }));
      if (res.ok) {
        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
        try { return JSON.parse(text.replace(/^```json|```$/g, '')); } catch (e) { lastErr = new Error('Gemini: неверный JSON'); continue; }
      }
      lastErr = new Error(`Gemini HTTP ${res.status}`);
      if ([429, 500, 503, 0].includes(res.status)) { await sleep(3000 * (a + 1)); continue; }
      break;
    }
  }
  throw lastErr;
}

function planPrompt(all, batch, offset, topic) {
  return `You are the video editor and motion designer of a faceless YouTube documentary channel (style: fast stock-footage cuts every 2-5 s, clean kinetic text callouts, subtle sound design).
Pick footage by MEANING, not by literal words: understand what each line is about in the context of the whole story, then describe a shot a camera could film that makes the viewer FEEL/UNDERSTAND that meaning (concrete subjects, places, actions, era). Metaphors are fine when the line is abstract ("debt kept growing" -> "stack of unpaid bills on kitchen table", "time ran out" -> "hourglass sand running out close up").
Whole script for context:
"""${all.map(s => s.text).join(' ').slice(0, 14000)}"""
${topic ? `Topic: ${topic}` : ''}
Lines to plan:
${batch.map((s, i) => `${offset + i + 1}. ${s.text}`).join('\n')}

Return JSON only:
{"topic":"<4-8 word English subject, era, place>","shots":[{"meaning":"<what this line means, English, <=15 words>","visual":"<one concrete filmable shot, English, <=14 words>","queries":["<2-4 word stock search>","<alternative angle>","<broader fallback>"],"overlay":{"type":"none|keyword|number|date|place|quote|chapter","text":"<short on-screen text, <=4 words, UPPERCASE for keyword/chapter>","value":<number or null>,"prefix":"<e.g. $>","suffix":"<e.g. %, M, YEARS>"},"sfx":"none|${SFX.join('|')}","mood":"${MOODS.join('|')}"}]}
Rules:
- Exactly one shots entry per numbered line, same order.
- The audience is American. Infer the story's setting (place, era, season) from the whole script; if it is unclear, assume the USA.
- Months, dates, weekdays and seasons are TIME references, not visuals. Never show snow, ice, frost, rain, autumn leaves, beaches or other weather/season imagery unless the line itself is about weather/season or the story's setting clearly has that weather. Show what HAPPENS in the line instead ("In February he lost his job" -> "man carrying cardboard box out of office building").
- Queries in English, concrete nouns/actions, no abstract words, no names of the script's people unless famous. Neighbouring lines must get visibly DIFFERENT shots (different subject, place or scale) so no frame feels repeated.
- overlay: RARELY - at most 1 of 8 lines, only for the strongest facts: number (a striking count, money, percent; give numeric value), date (a key year), place (first mention of a city/country), chapter (new section/turning point), quote (only a real spoken quote). Avoid keyword. The footage must carry the story, not text boxes. Otherwise type "none".
- sfx: counter for a shown number, blip for a shown date/place, whoosh/swish on a few fast transitions, riser/impact/stinger only for big reveals, ambience names rarely; "none" for about two thirds of lines.
- mood: background music mood for this part of the story; keep it stable for long stretches.`;
}

export async function geminiPlan(key, model, shots, onProgress, style) {
  if (style?.look === 'doc') return geminiDocPlan(key, model, shots, onProgress, style);
  let topic = '';
  for (let start = 0; start < shots.length; start += 25) {
    const batch = shots.slice(start, start + 25);
    onProgress?.(`Gemini: смысл сцен ${start + 1}–${start + batch.length} из ${shots.length}`);
    const out = await gemini(key, model, planPrompt(shots, batch, start, topic));
    if (!topic && out.topic) topic = out.topic;
    const fb = heuristicPlan(batch.map(s => ({ ...s }))).shots;
    batch.forEach((s, i) => {
      const p = out.shots?.[i] || {};
      s.meaning = p.meaning || fb[i].meaning; s.visual = p.visual || fb[i].visual;
      s.queries = (Array.isArray(p.queries) ? p.queries.filter(q => typeof q === 'string' && q.trim()) : []).slice(0, 3);
      if (!s.queries.length) s.queries = fb[i].queries;
      s.overlay = p.overlay && OVERLAYS.includes(p.overlay.type) ? p.overlay : fb[i].overlay;
      s.sfx = SFX.includes(p.sfx) ? p.sfx : 'none';
      s.mood = MOODS.includes(p.mood) ? p.mood : (shots[start + i - 1]?.mood || 'mystery');
    });
  }
  return { topic, shots };
}

// On-screen graphics ("плашки") and SFX density, applied at render time so the storyboard keeps everything.
// mode: 'none' = no graphics, 'rare' = as the style says (classic: numbers/dates/places/chapters at least 20 s apart;
// doc: the reference's graphic types, about one per style.gfx.every seconds, never overlapping), 'all' = as planned.
export function thinGraphics(shots, mode = 'rare', style) {
  const doc = style?.look === 'doc', allowed = style?.gfx?.types || {}, gap = doc ? (style.gfx.every || 18) * 0.6 : 20;
  let lastGfx = -Infinity, lastEnd = -Infinity, lastSfx = -Infinity;
  return shots.map((s0, i) => {
    const s = { ...s0 };
    if (doc) s.overlay = toDoc(s.overlay, i);
    const type = s.overlay?.type || 'none';
    const keep = type !== 'none' && (mode === 'all' || (mode === 'rare' && (doc ? (allowed[type] || 0) > 0 && s.start >= lastEnd + 1 : ['number', 'date', 'place', 'chapter'].includes(type)) && s.start - lastGfx >= gap));
    if (keep) { lastGfx = s.start; lastEnd = doc ? ovWindow(s).t1 : s.end; } else if (type !== 'none') s.overlay = { type: 'none' };
    // the doc look's quiet effects come from the graphics themselves (audio.js); planned cues are dropped
    if (doc && style.sfx?.soft) { s.sfx = 'none'; return s; }
    // pop/blip/counter only make sense together with the graphic they accompany
    if (!keep && ['pop', 'blip', 'counter', 'ding'].includes(s.sfx)) s.sfx = 'none';
    if (s.sfx && s.sfx !== 'none') { if (s.start - lastSfx < (mode === 'all' ? 2.5 : style?.sfx?.gap || 4)) s.sfx = 'none'; else lastSfx = s.start; }
    return s;
  });
}

const DOC_SPEC = {
  counter: 'counter: a striking count or amount spoken in the line. value (number), from (start value only if the line says "from X to Y"), unit (1-3 words UPPERCASE naming what is counted, e.g. "COTTAGES", "YEARS OLD", "MONTHS ADVANCE"), prefix ("$" or ""), suffix ("%", "M", "B" or ""), word (the number exactly as written in the line, first word if several)',
  stat: 'stat: a secondary number, shown small in a corner. value, unit (2-4 words, e.g. "COTTAGES EVACUATED"), prefix, suffix, word',
  year: 'year: a key year. text ("1979"), word',
  title: 'title: the first mention of a place, or one powerful key term of the story (max 3 words, UPPERCASE). text, word (first word of it as written in the line)',
  lowerthird: 'lowerthird: a label naming what the viewer sees. text (2-3 words UPPERCASE), sub (max 5 words)',
  infocard: 'infocard: a news-style headline about an event. text (max 7 words, Title Case), sub (max 12 words), source (optional, e.g. "NOAA, 2023")',
  panel: 'panel: a side panel explaining a concept. text (heading, max 3 words UPPERCASE), items (2-3 bullet facts, max 6 words each)',
  checklist: 'checklist: a list of steps, demands, promises or risks spoken in the line. text (header, max 4 words UPPERCASE), items (2-4 items, max 6 words each, in the order spoken), words (for each item the first word in the line where it is spoken, or "")',
  chart: 'chart: a comparison of 3-5 numbers given in the script. text (title UPPERCASE), bars ([{"label":"...","value":number}]), unit (axis label, e.g. "Avg sale ($M)")',
  map: 'map: the first mention of a real place that matters to the story. text (place name), country (English name), lat, lon (numbers)',
  name: 'name: the first mention of a real person. text (full name), sub (role, max 5 words)',
  statement: 'statement: the single key sentence of a section (its thesis), shown word by word on black as it is spoken. text (that sentence or its key clause copied EXACTLY from the line, max 12 words), highlight (2-4 consecutive words of text to mark in red)'
};

function docPrompt(all, batch, offset, topic, style, want) {
  const types = Object.entries(style.gfx.types).filter(([t, w]) => w > 0 && DOC_SPEC[t]).sort((a, b) => b[1] - a[1]);
  return `You are the video editor and motion designer of a faceless YouTube documentary channel. The look copies a reference documentary: calm pacing, shots held 3-8 s, cross-dissolves, and clean motion graphics ONLY at the strongest moments.
Pick footage by MEANING, not by literal words: understand what each line is about in the context of the whole story, then describe a shot a camera could film that makes the viewer FEEL/UNDERSTAND that meaning (concrete subjects, places, actions, era). Metaphors are fine when the line is abstract.
Whole script for context:
"""${all.map(s => s.text).join(' ').slice(0, 14000)}"""
${topic ? `Topic: ${topic}` : ''}
Lines to plan (with their length in seconds):
${batch.map((s, i) => `${offset + i + 1}. [${(s.end - s.start).toFixed(1)}s] ${s.text}`).join('\n')}

Graphic types you may use (share in the reference: ${types.map(([t, w]) => `${t} ${Math.round(w * 100)}%`).join(', ')}):
${types.map(([t]) => '- ' + DOC_SPEC[t]).join('\n')}

Return JSON only:
{"topic":"<4-8 word English subject, era, place>","shots":[{"meaning":"<what this line means, English, <=15 words>","visual":"<one concrete filmable shot, English, <=14 words>","queries":["<2-4 word stock search>","<alternative angle>","<broader fallback>"],"overlay":{"type":"none|${types.map(([t]) => t).join('|')}", ...fields of that type},"mood":"${MOODS.join('|')}"}]}
Rules:
- Exactly one shots entry per numbered line, same order.
- The audience is American. Infer the story's setting (place, era, season) from the whole script; if it is unclear, assume the USA.
- Months, dates, weekdays and seasons are TIME references, not visuals: no snow/rain/autumn/beach imagery unless the line is about weather or the setting has it.
- Queries in English, concrete nouns/actions, no abstract words. Neighbouring lines must get visibly DIFFERENT shots.
- Graphics: give a graphic to about ${want} of these ${batch.length} lines (one every ~${Math.round(style.gfx.every)} s of voice), spread out, never on two neighbouring lines, the rest "none". Choose the moments a viewer must remember: a number, a year, the first mention of a place or person, a list, a thesis. Every text must come from the script's facts; never invent numbers.
- Use the type that fits the content; match the share above roughly over the whole video.
- mood: background music mood for this part; keep it stable for long stretches.`;
}

async function geminiDocPlan(key, model, shots, onProgress, style) {
  let topic = '';
  for (let start = 0; start < shots.length; start += 25) {
    const batch = shots.slice(start, start + 25), dur = batch.at(-1).end - batch[0].start;
    const want = Math.max(1, Math.round(dur / (style.gfx.every || 18)));
    onProgress?.(`Gemini: смысл и графика сцен ${start + 1}–${start + batch.length} из ${shots.length}`);
    const out = await gemini(key, model, docPrompt(shots, batch, start, topic, style, want));
    if (!topic && out.topic) topic = out.topic;
    const fb = heuristicPlan(batch.map(s => ({ ...s })), style).shots;
    batch.forEach((s, i) => {
      const p = out.shots?.[i] || {};
      s.meaning = p.meaning || fb[i].meaning; s.visual = p.visual || fb[i].visual;
      s.queries = (Array.isArray(p.queries) ? p.queries.filter(q => typeof q === 'string' && q.trim()) : []).slice(0, 3);
      if (!s.queries.length) s.queries = fb[i].queries;
      s.overlay = cleanOverlay(p.overlay) || { type: 'none' };
      s.sfx = 'none';
      s.mood = MOODS.includes(p.mood) ? p.mood : (shots[start + i - 1]?.mood || 'mystery');
    });
  }
  return { topic, shots };
}

// Drops graphics Gemini returned without the data they need.
export function cleanOverlay(o) {
  if (!o || !DOC_OVERLAYS.includes(o.type) || o.type === 'none') return null;
  const n = x => (typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(/[^\d.-]/g, '')));
  const list = a => (Array.isArray(a) ? a.map(x => String(x ?? '').trim()).filter(Boolean).slice(0, 5) : []);
  const r = { ...o, text: String(o.text ?? '').trim() };
  if (['counter', 'stat'].includes(o.type)) { r.value = n(o.value); if (!Number.isFinite(r.value)) return null; if (o.from != null && Number.isFinite(n(o.from))) r.from = n(o.from); else delete r.from; }
  if (['panel', 'checklist'].includes(o.type)) { r.items = list(o.items); if (r.items.length < 2) return null; }
  if (o.type === 'checklist') r.words = Array.isArray(o.words) ? o.words.map(w => String(w ?? '')) : [];
  if (o.type === 'chart') { r.bars = (Array.isArray(o.bars) ? o.bars : []).map(b => ({ label: String(b?.label ?? ''), value: n(b?.value) })).filter(b => b.label && Number.isFinite(b.value)).slice(0, 6); if (r.bars.length < 2) return null; }
  if (o.type === 'map') { r.lat = n(o.lat); r.lon = n(o.lon); if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return { type: 'title', text: r.text.toUpperCase(), word: o.word || r.text.split(' ')[0] }; }
  if (o.type === 'statement') r.highlight = list(Array.isArray(o.highlight) ? o.highlight : [o.highlight]).join(' ');
  if (!['counter', 'stat', 'chart', 'statement'].includes(o.type) && !r.text) return null;
  return r;
}

export function toSrt(shots) {
  const ts = t => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  return shots.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(Math.min(s.end, (s.wordEnd ?? s.end) + 0.3))}\n${s.text}\n`).join('\n');
}
