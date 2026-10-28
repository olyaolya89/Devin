// Reference video → style profile, all in the browser: pacing (cuts, dissolves), colour grade, music level,
// and with a Gemini key the kinds and frequency of the editor's on-screen graphics (frames are shown to Gemini).
import { gemini } from './plan.js';
import { STYLES } from './styles.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

export async function analyzeReference(file, { key, model } = {}, onProgress = () => { }) {
  const url = URL.createObjectURL(file);
  try {
    const v = await sampleVideo(url, onProgress);
    const shots = findCuts(v.samples);
    const color = colorStats(v.samples);
    onProgress('Слушаю звук референса…', 0.6);
    const sound = await analyzeAudio(file).catch(e => { console.warn(e); return null; });
    let gfx = null;
    if (key) { try { gfx = await classifyFrames(url, v.duration, key, model, onProgress); } catch (e) { console.warn(e); onProgress(`Gemini не смог посмотреть кадры (${e.message}) — виды графики беру из пресета`, 0.95); } }
    return buildProfile({ file: file.name, duration: v.duration, shots, color, sound, gfx });
  } finally { URL.revokeObjectURL(url); }
}

// Plays the video muted at high speed and keeps a 64×36 thumbnail of every frame the browser shows (~every 0.1–0.3 s).
function sampleVideo(url, onProgress) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    const c = document.createElement('canvas'); c.width = 64; c.height = 36; const ctx = c.getContext('2d', { willReadFrequently: true });
    const samples = []; let last = -1, stall;
    const done = () => { clearTimeout(stall); v.pause(); v.removeAttribute('src'); v.load(); resolve({ samples, duration: v.duration || samples.at(-1)?.t || 0 }); };
    v.onerror = () => reject(new Error('браузер не смог открыть видео — нужен MP4 (H.264) или WebM'));
    v.onloadedmetadata = () => {
      const dur = v.duration;
      const step = (now, meta) => {
        clearTimeout(stall); const t = meta.mediaTime;
        if (t - last >= 0.08) { ctx.drawImage(v, 0, 0, 64, 36); samples.push({ t, d: ctx.getImageData(0, 0, 64, 36).data.slice() }); last = t; if (samples.length % 40 === 0) onProgress(`Смотрю референс: ${Math.round(t / dur * 100)}% (не сворачивайте вкладку)`, 0.6 * t / dur); }
        if (v.ended) return done();
        stall = setTimeout(done, 15000); v.requestVideoFrameCallback(step);
      };
      v.onended = done; v.requestVideoFrameCallback(step);
      v.playbackRate = v.videoHeight > 720 ? 6 : 10; v.play().catch(reject);
    };
    v.src = url;
  });
}

const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4) / 3; };
const hist = d => { const h = new Float32Array(48); for (let i = 0; i < d.length; i += 4) { h[d[i] >> 5]++; h[8 + (d[i + 1] >> 5)]++; h[16 + (d[i + 2] >> 5)]++; h[24 + Math.min(23, Math.floor((d[i] + d[i + 1] + d[i + 2]) / 32))]++; } return h; };
const histDiff = (a, b) => { const x = hist(a), y = hist(b); let s = 0; for (let i = 0; i < 48; i++) s += Math.abs(x[i] - y[i]); return s / (a.length * 2); };

// Shot boundaries: a local peak of picture change across a ±0.6 s window that also changes the colour histogram
// (camera moves change pixels but keep the histogram). Frames in the middle of a dissolve look like neither side,
// frames around a hard cut look like one side or the other.
export function findCuts(samples) {
  const n = samples.length; if (n < 3) return { lengths: [], boundaries: [], dissolves: 0 };
  const lo = new Int32Array(n), hi = new Int32Array(n), D = new Float32Array(n); let j = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const t = samples[i].t;
    while (j < i && samples[j].t < t - 0.6) j++;
    while (k < n - 1 && samples[k + 1].t <= t + 0.6) k++;
    lo[i] = j; hi[i] = k; D[i] = diff(samples[j].d, samples[k].d);
  }
  const cand = [];
  for (let i = 1; i < n - 1; i++) {
    if (D[i] < 28) continue;
    const t = samples[i].t; let peak = true;
    for (let q = i - 1; q >= 0 && samples[q].t > t - 0.8 && peak; q--) if (D[q] > D[i]) peak = false;
    for (let q = i + 1; q < n && samples[q].t < t + 0.8 && peak; q++) if (D[q] >= D[i]) peak = false;
    if (!peak) continue;
    const a = samples[lo[i]].d, b = samples[hi[i]].d;
    if (histDiff(a, b) < 0.15) continue;
    let mix = 0; for (let q = lo[i] + 1; q < hi[i]; q++) mix = Math.max(mix, Math.min(diff(samples[q].d, a), diff(samples[q].d, b)) / D[i]);
    cand.push({ t, hard: mix < 0.33 });
  }
  const boundaries = []; for (const c of cand) if (!boundaries.length || c.t - boundaries.at(-1).t >= 0.8) boundaries.push(c);
  const ts = [samples[0].t, ...boundaries.map(b => b.t), samples.at(-1).t];
  const lengths = ts.slice(1).map((t, i) => t - ts[i]).filter(x => x > 0.3);
  return { lengths, boundaries, dissolves: boundaries.filter(b => !b.hard).length };
}

export function colorStats(samples) {
  const warm = [], sat = [], lum = [], con = [];
  for (let s = 0; s < samples.length; s += 3) {
    const d = samples[s].d; let r = 0, g = 0, b = 0, st = 0, l = 0, l2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B), y = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255; r += R; g += G; b += B; st += mx ? (mx - mn) / mx : 0; l += y; l2 += y * y; n++; }
    warm.push((r - b) / n / 255); sat.push(st / n); lum.push(l / n); con.push(Math.sqrt(Math.max(0, l2 / n - (l / n) ** 2)));
  }
  return { warm: pct(warm, 0.5), sat: pct(sat, 0.5), lum: pct(lum, 0.5), con: pct(con, 0.5) };
}

// Music bed level: loudness in the pauses between phrases compared with the loudness of speech.
export async function analyzeAudio(file) {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  return audioLevels(buf.getChannelData(0), buf.sampleRate);
}
export function audioLevels(x, sr) {
  const w = Math.round(sr * 0.05), n = Math.floor(x.length / w), dbs = new Float32Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let i = f * w; i < (f + 1) * w; i++) s += x[i] * x[i]; dbs[f] = 10 * Math.log10(s / w + 1e-12); }
  const all = Array.from(dbs), speech = pct(all, 0.8), gaps = all.filter(d => d < speech - 18 && d > -90);
  const gap = pct(gaps, 0.5), music = gaps.length > n * 0.03 && gap > -60;
  return { speech, gap, music, musicRel: music ? gap - speech : null };
}

const GFX_TYPES = ['counter', 'stat', 'year', 'title', 'lowerthird', 'infocard', 'panel', 'checklist', 'chart', 'map', 'name', 'statement'];
function framePrompt(times) {
  return `These are frames of a faceless YouTube documentary, labelled with their time in seconds. I want to copy its editing style.
For each frame, name the on-screen graphic that the EDITOR added on top of the footage. Ignore logos, news tickers and captions that were already burned into the source footage (TV news clips).
Types: none | counter (big number with a unit word, e.g. "46 COTTAGES") | stat (small number with a caption in a corner) | year (a year on screen) | title (big centred word or place name) | lowerthird (label box at the bottom) | infocard (headline and small description over footage) | panel (dark side panel with heading and bullet points) | checklist (paper card with tick boxes) | chart (bar or line chart) | map (map with highlighted area or pin) | name (a person's name, e.g. circled with a marker) | statement (a sentence of big text on a plain background) | framed (photo inside a frame or vignette on a plain background) | split (two or more images side by side) | scrapbook (old photos on paper) | other.
Return JSON only: {"subtitles": <true if word-by-word subtitles are burned in at the bottom of most frames>, "frames":[{"t":<time>,"type":"<type>","text":"<text on screen, max 8 words>"}]}
Frames: ${times.map(t => `t=${t}`).join(', ')}`;
}

async function grabFrames(url, times, onProgress) {
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
  await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('видео не открылось')); });
  const c = document.createElement('canvas'); c.width = 512; c.height = 288; const ctx = c.getContext('2d'); const out = [];
  for (const [i, t] of times.entries()) {
    await new Promise(r => { const to = setTimeout(r, 4000); v.onseeked = () => { clearTimeout(to); r(); }; v.currentTime = t; });
    ctx.drawImage(v, 0, 0, 512, 288); out.push(c.toDataURL('image/jpeg', 0.72).split(',')[1]);
    if (i % 10 === 0) onProgress(`Готовлю кадры для Gemini: ${i + 1}/${times.length}`, 0.65 + 0.1 * i / times.length);
  }
  v.removeAttribute('src'); v.load(); return out;
}

async function classifyFrames(url, duration, key, model, onProgress) {
  const every = Math.max(4, duration / 240), times = []; for (let t = 2; t < duration - 1; t += every) times.push(Math.round(t * 10) / 10);
  const imgs = await grabFrames(url, times, onProgress), frames = []; let subs = 0, votes = 0;
  for (let k = 0; k < times.length; k += 20) {
    onProgress(`Gemini смотрит кадры ${k + 1}–${Math.min(times.length, k + 20)} из ${times.length}`, 0.75 + 0.2 * k / times.length);
    const ts = times.slice(k, k + 20), parts = [{ text: framePrompt(ts) }];
    ts.forEach((t, i) => parts.push({ text: `t=${t}` }, { inline_data: { mime_type: 'image/jpeg', data: imgs[k + i] } }));
    const out = await gemini(key, model, parts);
    (out.frames || []).forEach(f => frames.push({ t: +f.t, type: String(f.type || 'none').toLowerCase(), text: f.text || '' }));
    votes++; if (out.subtitles) subs++;
  }
  return summarizeFrames(frames, duration, subs > votes / 2, every);
}

// Consecutive frames with the same graphic are one appearance.
export function summarizeFrames(frames, duration, subtitles, every = 4) {
  const events = []; frames.sort((a, b) => a.t - b.t);
  for (const f of frames) { if (f.type === 'none' || f.type === 'other') continue; const last = events.at(-1); if (last && last.type === f.type && f.t - last.t1 <= every * 1.6) last.t1 = f.t; else events.push({ type: f.type, t0: f.t, t1: f.t, text: f.text }); }
  const counts = {}; for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  const total = GFX_TYPES.reduce((n, t) => n + (counts[t] || 0), 0);
  return { counts, total, every: total ? duration / total : null, subtitles, framed: (counts.framed || 0) + (counts.scrapbook || 0), examples: events.slice(0, 40) };
}

export function buildProfile({ file, duration, shots, color, sound, gfx }) {
  const p = structuredClone(STYLES.doc);
  p.id = 'ref'; p.name = `Мой референс: ${file}`;
  const L = shots.lengths;
  if (L.length >= 8) {
    // graphics popping in also count as picture changes, so the shortest quarter is a low estimate: keep at least 2.5 s
    p.cut.min = Math.round(clamp(pct(L, 0.3), 2.5, 6) * 10) / 10;
    p.cut.max = Math.round(clamp(pct(L, 0.75) * 1.25, p.cut.min + 1.5, 10) * 10) / 10;
    p.dissolve = Math.round(clamp(shots.dissolves / Math.max(1, shots.boundaries.length), 0, 0.9) * 100) / 100;
  }
  if (color) p.grade = {
    warm: Math.round(clamp((color.warm - 0.02) * 1.5, 0, 0.3) * 100) / 100,
    // measured on the footage itself, so only nudged: stock clips differ from the reference's clips anyway
    sat: Math.round(clamp(color.sat / 0.3, 0.97, 1.15) * 100) / 100,
    contrast: Math.round(clamp(color.con / 0.19, 0.98, 1.12) * 100) / 100,
    bright: Math.round(clamp(0.45 / Math.max(0.2, color.lum), 0.97, 1.05) * 100) / 100
  };
  // never switches the music off: a bed the analysis could not hear is kept very quiet instead
  if (sound) p.music.db = sound.music ? Math.round(clamp(sound.musicRel + 3, -28, -12)) : -26;
  if (gfx?.total) {
    p.gfx.every = Math.round(clamp(gfx.every, 6, 90));
    p.gfx.types = Object.fromEntries(GFX_TYPES.map(t => [t, Math.round((gfx.counts[t] || 0) / gfx.total * 100) / 100]));
    if (!Object.values(p.gfx.types).some(w => w > 0)) p.gfx.types = structuredClone(STYLES.doc.gfx.types);
    p.subtitles = gfx.subtitles ? 'boxed' : 'none';
    p.framePhotos = gfx.framed > 0;
  }
  p.measured = { file, duration, cuts: shots.boundaries.length, median: pct(L, 0.5), musicRel: sound?.musicRel ?? null, gemini: !!gfx?.total, graphics: gfx?.counts || null, examples: gfx?.examples?.slice(0, 20) || [] };
  return p;
}
