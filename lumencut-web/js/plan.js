// Script → shots, timing, meaning-based plan (Gemini or heuristic).
export const SFX = ['whoosh','swish','impact','hit','riser','slowmo','freeze','tick','clock','heartbeat','pop','blip','counter','ding','shimmer','stinger','footstep','kick','whistle','carpass','phonebuzz','phonering','cheer','applause','murmur','rain','thunder','wind','roomtone','city','hum','powerup','glitch','flash','buzz'];
export const MOODS = ['mystery','tension','action','wonder','hopeful','sad','triumph','playful','calm','dark','epic'];
export const OVERLAYS = ['none','keyword','number','date','place','quote','chapter'];

const STOP = new Set('the a an and or but in on at to for of with from by was were is are as this that these those it its they them their there then than so if not no yes be been being have has had do does did will would can could should just also very about into over only what when where which who why how you your we our he she his her i me my'.split(' '));

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

// Needleman–Wunsch alignment of script words to Whisper words → start/end per shot.
export function alignTiming(shots, asrWords, totalDur) {
  const sw = []; shots.forEach((s, si) => s.text.split(/\s+/).forEach(w => { const n = norm(w); if (n) sw.push({ n, si }); }));
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
  sw.forEach((w, k) => { const m = match[k]; if (!m) return; if (first[w.si] == null) first[w.si] = m.s; last[w.si] = m.e; });
  return fillTiming(shots, first, last, totalDur);
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

function detectOverlay(text) {
  const num = text.match(/(\$|€|£)?\s?(\d[\d,.]*)\s?(%|percent|million|billion|thousand|trillion|km|miles|meters|years|tons|degrees)?/i);
  const year = text.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  if (year && (!num || num[2] === year[1])) return { type: 'date', text: year[1] };
  if (num && num[2].replace(/[,.]/g, '').length >= 2) {
    const value = parseFloat(num[2].replace(/,/g, ''));
    return { type: 'number', value, prefix: num[1] || '', suffix: num[3] ? ' ' + num[3].toUpperCase().replace('PERCENT', '%').replace(' %', '%') : '', text: num[0].trim() };
  }
  return { type: 'none' };
}

export function heuristicPlan(shots) {
  const counts = new Map();
  shots.forEach(s => significant(s.text).forEach(w => { const k = w.toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); }));
  const topic = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(' ');
  shots.forEach((s, i) => {
    const words = significant(s.text); const longest = [...new Set(words)].sort((a, b) => b.length - a.length);
    s.meaning = s.text; s.visual = words.slice(0, 6).join(' ');
    s.queries = [longest.slice(0, 3).join(' '), `${longest.slice(0, 2).join(' ')} ${topic}`.trim(), longest[0] || topic].filter(Boolean);
    s.overlay = i === 0 ? { type: 'keyword', text: longest.slice(0, 2).join(' ').toUpperCase() } : detectOverlay(s.text);
    s.sfx = { number: 'counter', date: 'blip', keyword: 'whoosh' }[s.overlay.type] || (i % 6 === 3 ? 'swish' : 'none');
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
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.5 } })
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
- Queries in English, concrete nouns/actions, no abstract words, no names of the script's people unless famous. Neighbouring lines must get visibly DIFFERENT shots (different subject, place or scale) so no frame feels repeated.
- overlay: use on about 1 of 3 lines only: number (counts, money, percent; give numeric value), date (years), place (city/country names), keyword (one key idea), quote (spoken quote), chapter (new section/turning point). Otherwise type "none".
- sfx: pop/blip when a keyword/date/place appears, counter for numbers, whoosh/swish on fast transitions, riser/impact/stinger only for big reveals, ambience names rarely; "none" for about half of lines.
- mood: background music mood for this part of the story; keep it stable for long stretches.`;
}

export async function geminiPlan(key, model, shots, onProgress) {
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

export function toSrt(shots) {
  const ts = t => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  return shots.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(Math.min(s.end, (s.wordEnd ?? s.end) + 0.3))}\n${s.text}\n`).join('\n');
}
