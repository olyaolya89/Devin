// Mix voice + procedural music (Razgon kit, by mood) + SFX cues, with ducking and loudness normalization.
const SR = 48000;
const cache = new Map();
async function load(ctx, url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); }));
  return ctx.decodeAudioData((await cache.get(url)).slice(0));
}
const db = x => Math.pow(10, x / 20);

export function sfxCues(shots) {
  const cues = [];
  for (const s of shots) {
    const name = s.sfx; if (!name || name === 'none') continue;
    if (['whoosh', 'swish'].includes(name)) cues.push({ at: s.start - 0.18, name, gain: -11 });
    else if (['riser', 'slowmo'].includes(name)) { cues.push({ at: s.start - 1.6, name, gain: -12 }); cues.push({ at: s.start, name: 'impact', gain: -9 }); }
    else if (['pop', 'blip', 'counter', 'ding', 'shimmer', 'tick'].includes(name)) cues.push({ at: s.start + 0.15, name, gain: -14 });
    else cues.push({ at: s.start, name, gain: -12 });
  }
  return cues.filter(c => c.at >= 0);
}

function voiceEnvelope(buf, dur) {
  const ch = buf.getChannelData(0), hop = Math.round(buf.sampleRate * 0.02), n = Math.ceil(dur / 0.02), env = new Float32Array(n);
  let peak = 1e-6; const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = i * hop; j < Math.min(ch.length, (i + 1) * hop); j++) { s += ch[j] * ch[j]; c++; } rms[i] = Math.sqrt(s / (c || 1)); peak = Math.max(peak, rms[i]); }
  let v = 0; for (let i = 0; i < n; i++) { const on = rms[i] > peak * 0.08 ? 1 : 0; v = on > v ? v + (on - v) * 0.6 : v + (on - v) * 0.04; env[i] = v; }
  return env;
}

// Rides the voice gain toward a steady speech level (max ±12 dB, held through pauses) so jumps in loudness are evened out.
function levelVoice(buf) {
  const sr = buf.sampleRate, n = buf.length, chs = buf.numberOfChannels, win = Math.round(sr * 0.05), frames = Math.ceil(n / win), rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0, c = 0; for (let ch = 0; ch < chs; ch++) { const d = buf.getChannelData(ch); for (let i = f * win; i < Math.min(n, (f + 1) * win); i++) { s += d[i] * d[i]; c++; } } rms[f] = Math.sqrt(s / (c || 1)); }
  const speech = Array.from(rms).filter(x => x > 1e-4).sort((a, b) => a - b); if (!speech.length) return buf;
  const target = speech[Math.floor(speech.length * 0.7)], gate = target * 0.12, gains = new Float32Array(frames);
  let g = 1;
  for (let f = 0; f < frames; f++) {
    let s = 0, c = 0; for (let k = Math.max(0, f - 6); k <= Math.min(frames - 1, f + 6); k++) if (rms[k] > gate) { s += rms[k] * rms[k]; c++; }
    const want = c ? Math.min(4, Math.max(0.25, target / Math.sqrt(s / c))) : g;
    g += (want - g) * (want < g ? 0.5 : 0.15); gains[f] = g;
  }
  const out = new AudioBuffer({ length: n, numberOfChannels: chs, sampleRate: sr });
  for (let ch = 0; ch < chs; ch++) { const d = buf.getChannelData(ch), o = out.getChannelData(ch); for (let i = 0; i < n; i++) { const p = i / win - 0.5, f0 = Math.max(0, Math.min(frames - 1, Math.floor(p))), f1 = Math.min(frames - 1, f0 + 1), t = Math.max(0, Math.min(1, p - f0)); o[i] = d[i] * (gains[f0] * (1 - t) + gains[f1] * t); } }
  return out;
}

export async function mixAudio({ voice, shots, duration, musicOn = true, musicDb = -16, sfxOn = true, level = true }, onProgress) {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);
  if (level) { onProgress?.('Выравнивание громкости голоса…'); voice = levelVoice(voice); }
  const v = ctx.createBufferSource(); v.buffer = voice; v.start(0);
  if (level) { const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.15; v.connect(comp); comp.connect(ctx.destination); } else v.connect(ctx.destination);
  if (musicOn) {
    onProgress?.('Музыка по настроению сцен…');
    const env = voiceEnvelope(voice, duration);
    const duckCurve = Float32Array.from(env, e => db(musicDb) * (1 - 0.65 * e));
    const bus = ctx.createGain(); bus.connect(ctx.destination); bus.gain.setValueCurveAtTime(duckCurve, 0, duration);
    const sections = []; for (const s of shots) { const last = sections.at(-1); if (last && last.mood === s.mood) last.end = s.end; else sections.push({ mood: s.mood || 'mystery', start: s.start, end: s.end }); }
    // merge very short sections into previous to avoid jumpy music
    const merged = []; for (const sec of sections) { if (merged.length && sec.end - sec.start < 12) merged.at(-1).end = sec.end; else merged.push(sec); }
    for (const [k, sec] of merged.entries()) {
      const buf = await load(ctx, `music/${sec.mood}.mp3`).catch(() => load(ctx, 'music/mystery.mp3'));
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); src.connect(g); g.connect(bus);
      const a = Math.max(0, sec.start - (k ? 1.5 : 0)), b = Math.min(duration, sec.end + 1.5);
      g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(1, a + (k ? 1.5 : 0.8)); g.gain.setValueAtTime(1, Math.max(a + 1.6, b - 1.5)); g.gain.linearRampToValueAtTime(0, b);
      src.start(a, (a * 0.37) % buf.duration); src.stop(b);
    }
  }
  if (sfxOn) {
    onProgress?.('Звуковые эффекты…');
    for (const c of sfxCues(shots)) {
      const buf = await load(ctx, `sfx/${c.name}.mp3`).catch(() => null); if (!buf) continue;
      const src = ctx.createBufferSource(); src.buffer = buf; const g = ctx.createGain(); g.gain.value = db(c.gain);
      src.connect(g); g.connect(ctx.destination); src.start(c.at);
    }
  }
  onProgress?.('Сведение звука…');
  const out = await ctx.startRendering();
  // normalize: gated RMS → about -14 LUFS-ish, peak ceiling -1 dBFS
  const L = out.getChannelData(0), R = out.getChannelData(1); let s = 0, c = 0, pk = 0;
  for (let i = 0; i < L.length; i += 4) { const m = (L[i] + R[i]) / 2, a = m * m; if (a > 1e-5) { s += a; c++; } pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  const rmsDb = 10 * Math.log10(s / (c || 1) + 1e-12);
  const gain = Math.min(db(-14 - 3 - rmsDb), db(-1) / (pk || 1));
  for (const ch of [L, R]) for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-0.99, Math.min(0.99, ch[i] * gain));
  return out;
}

export async function decodeFile(file) {
  const data = await file.arrayBuffer();
  let lastErr;
  for (const make of [() => new AudioContext({ sampleRate: SR }), () => new AudioContext(), () => new OfflineAudioContext(1, 1, SR)]) {
    let ctx; try { ctx = make(); return await ctx.decodeAudioData(data.slice(0)); } catch (e) { lastErr = e; } finally { ctx?.close?.().catch(() => { }); }
  }
  throw new Error(`браузер не смог прочитать «${file.name}» (${lastErr?.message || 'неизвестный формат'}). Пересохраните озвучку как MP3 или WAV.`);
}

export async function to16kMono(buf) {
  const ctx = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
  const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start();
  return (await ctx.startRendering()).getChannelData(0);
}
