// Browser renderer: canvas motion graphics + WebCodecs H.264/AAC → MP4 (no server, no ffmpeg).
import { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } from '../vendor/mp4-muxer.mjs';
import { buildOverlays, drawDoc, drawFramed, FONTS } from './gfx.js';

const YEL = '#FFD400';
const easeBack = x => { const c = 1.9; x = Math.min(1, Math.max(0, x)); return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const easeOut = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

function loadMedia(c) {
  if (c.kind === 'video') return new Promise(res => {
    const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.playsInline = true; v.preload = 'auto';
    let alt = c.alt; const fail = () => res(loadImage(c.thumb)); let t = setTimeout(fail, 20000);
    v.onerror = () => { clearTimeout(t); if (alt) { v.src = alt; alt = null; t = setTimeout(fail, 20000); } else fail(); };
    v.onloadeddata = () => { clearTimeout(t); res({ v, w: v.videoWidth, h: v.videoHeight }); };
    v.src = c.url;
  });
  return loadImage(c.url).then(r => r.img ? r : loadImage(c.thumb));
}
function loadImage(url) { return new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res({ img: i, w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({}); i.src = url || ''; }); }
const seek = (v, t) => new Promise(r => { if (Math.abs(v.currentTime - t) < 0.01) return r(); const to = setTimeout(r, 5000); v.onseeked = () => { clearTimeout(to); r(); }; v.currentTime = t; });

function cover(ctx, el, w, h, W, H, scale, px, py) {
  if (!el || !w) { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1b2030'); g.addColorStop(1, '#07080c'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return; }
  const k = Math.max(W / w, H / h) * scale, dw = w * k, dh = h * k;
  ctx.drawImage(el, (W - dw) / 2 + px * (dw - W) / 2, (H - dh) / 2 + py * (dh - H) / 2, dw, dh);
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
function wrap(ctx, text, maxW) { const out = []; let line = ''; for (const w of text.split(/\s+/)) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; }

function drawOverlay(ctx, s, t, W, H) {
  const o = s.overlay; if (!o || o.type === 'none' || !(o.text || o.value != null)) return;
  const u = W / 1920, lt = t - s.start - 0.15, D = s.end - s.start; if (lt < 0) return;
  const fade = Math.min(1, Math.max(0, (s.end - t) / 0.25)); ctx.save(); ctx.globalAlpha = fade;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (o.type === 'keyword' || o.type === 'chapter') {
    const txt = String(o.text).toUpperCase(); const sc = easeBack(lt / 0.35);
    if (o.type === 'chapter') { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H); }
    ctx.font = `700 ${(o.type === 'chapter' ? 130 : 110) * u}px Oswald, Impact, sans-serif`;
    const tw = ctx.measureText(txt).width; ctx.translate(W / 2, H * 0.47); ctx.scale(sc, sc);
    if (o.type === 'keyword') { ctx.fillStyle = YEL; rrect(ctx, -tw / 2 - 34 * u, -78 * u, tw + 68 * u, 150 * u, 14 * u); ctx.fillStyle = '#0b0b0b'; ctx.fillText(txt, 0, 0); }
    else { ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 30 * u; ctx.fillText(txt, 0, 0); ctx.shadowBlur = 0; ctx.fillStyle = YEL; const lw = tw * easeOut((lt - 0.2) / 0.5); ctx.fillRect(-lw / 2, 92 * u, lw, 8 * u); }
  } else if (o.type === 'number') {
    const val = Number(o.value ?? String(o.text).replace(/[^\d.]/g, '')) || 0, p = easeOut(lt / 1.1), cur = val * p;
    const dec = Number.isInteger(val) ? 0 : 1;
    const txt = `${o.prefix || ''}${cur.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${o.suffix || ''}`;
    const sc = easeBack(lt / 0.3); ctx.translate(W / 2, H * 0.45); ctx.scale(sc, sc);
    ctx.font = `700 ${170 * u}px Oswald, Impact, sans-serif`; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 40 * u; ctx.fillText(txt, 0, 0);
    ctx.shadowBlur = 0; ctx.fillStyle = YEL; const tw = ctx.measureText(txt).width; ctx.fillRect(-tw / 2, 105 * u, tw * p, 10 * u);
  } else if (o.type === 'date' || o.type === 'place') {
    const txt = String(o.text).toUpperCase(); ctx.textAlign = 'left'; ctx.font = `700 ${64 * u}px Oswald, Impact, sans-serif`;
    const shown = txt.slice(0, Math.ceil(lt * 28)); const tw = ctx.measureText(txt).width, x = 110 * u, y = H - 250 * u, bw = (tw + 70 * u) * easeOut(lt / 0.3);
    ctx.fillStyle = 'rgba(10,10,14,.78)'; ctx.fillRect(x, y - 50 * u, bw, 100 * u); ctx.fillStyle = YEL; ctx.fillRect(x, y - 50 * u, 12 * u, 100 * u);
    ctx.fillStyle = '#fff'; ctx.fillText(shown, x + 40 * u, y + 4 * u);
  } else if (o.type === 'quote') {
    ctx.globalAlpha = fade * easeOut(lt / 0.4); ctx.font = `italic 600 ${58 * u}px Georgia, serif`;
    const lines = wrap(ctx, `“${o.text}”`, W * 0.62), lh = 76 * u, bh = lines.length * lh + 90 * u;
    ctx.fillStyle = 'rgba(8,8,12,.72)'; rrect(ctx, W * 0.17, H / 2 - bh / 2, W * 0.66, bh, 20 * u); ctx.fillStyle = YEL; ctx.fillRect(W * 0.17, H / 2 - bh / 2, 10 * u, bh);
    ctx.fillStyle = '#fff'; lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 - (lines.length - 1) * lh / 2 + i * lh));
  }
  ctx.restore();
}

// Subtitle looks (as Kutly's caption styles): karaoke = 6 words, spoken one yellow; boxed = line on a dark panel; word = one big word at a time.
function drawSubs(ctx, s, t, W, H, look = 'karaoke') {
  const words = s.text.split(/\s+/); const a = s.start, b = Math.max(a + 0.5, s.wordEnd ?? s.end); if (t > b + 0.3) return;
  // highlight the word actually being spoken (Whisper timings); even spread only when there was no voice to align to
  const wt = s.wt?.length === words.length ? s.wt : null;
  let k = 0; if (wt) { while (k + 1 < words.length && wt[k + 1] <= t) k++; } else k = Math.min(words.length - 1, Math.max(0, Math.floor((t - a) / (b - a) * words.length)));
  const u = W / 1920; ctx.save(); ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  if (look === 'word') {
    const w = words[k].replace(/[^\p{L}\p{N}'%$-]/gu, '').toUpperCase(), st = wt ? wt[k] : a + (b - a) * k / words.length, e = easeBack((t - st) / 0.18);
    ctx.font = `900 ${96 * u}px Montserrat, Inter, sans-serif`; ctx.textAlign = 'center'; ctx.translate(W / 2, H - 190 * u); ctx.scale(e, e);
    ctx.lineWidth = 16 * u; ctx.strokeStyle = '#000'; ctx.strokeText(w, 0, 0); ctx.fillStyle = k % 2 ? YEL : '#fff'; ctx.fillText(w, 0, 0); ctx.restore(); return;
  }
  const n = look === 'boxed' ? 8 : 6, g0 = Math.floor(k / n) * n, grp = words.slice(g0, g0 + n);
  ctx.font = `${look === 'boxed' ? 700 : 800} ${(look === 'boxed' ? 46 : 56) * u}px Inter, Arial, sans-serif`;
  const sp = ctx.measureText(' ').width, widths = grp.map(w => ctx.measureText(w).width), total = widths.reduce((x, y) => x + y, 0) + sp * (grp.length - 1);
  let x = (W - total) / 2; const y = H - 110 * u;
  if (look === 'boxed') { ctx.fillStyle = 'rgba(0,0,0,0.72)'; rrect(ctx, x - 24 * u, y - 40 * u, total + 48 * u, 80 * u, 10 * u); }
  grp.forEach((w, i) => {
    const on = g0 + i === k;
    if (look === 'boxed') { ctx.fillStyle = on ? YEL : (g0 + i < k ? '#fff' : 'rgba(255,255,255,0.7)'); ctx.fillText(w, x, y); }
    else { ctx.lineWidth = 10 * u; ctx.strokeStyle = '#000'; ctx.strokeText(w, x, y); ctx.fillStyle = on ? YEL : '#fff'; ctx.fillText(w, x, y); }
    x += widths[i] + sp;
  });
  ctx.restore();
}

function vignette(ctx, W, H) { const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }

const ARCHIVE = new Set(['Wikimedia', 'Library of Congress', 'Internet Archive']);
const pseudo = i => ((i * 2654435761) >>> 0) % 1000 / 1000;

// style: profile from styles.js (look, grade, dissolve share, framed archive photos). subtitles: false or a look name.
export async function renderVideo({ shots, audio, W = 1920, H = 1080, fps = 30, canvas, subtitles = 'karaoke', style = { look: 'classic' }, limit = Infinity, fileHandle, onProgress }) {
  await Promise.all(['700 80px Oswald', '800 40px Inter', ...FONTS].map(f => document.fonts.load(f).catch(() => {})));
  if (subtitles === true) subtitles = 'karaoke';
  const doc = style.look === 'doc', gr = style.grade || {};
  const grade = `contrast(${gr.contrast ?? 1.07}) saturate(${gr.sat ?? 1.06}) brightness(${gr.bright ?? 1})${gr.warm ? ` sepia(${gr.warm})` : ''}`;
  const overlays = doc ? await buildOverlays(shots, W, H) : [];
  const total = Math.min(audio.duration, limit), nFrames = Math.ceil(total * fps);
  canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d', { alpha: false });
  const snap = document.createElement('canvas'); snap.width = W; snap.height = H; const sctx = snap.getContext('2d');
  let codec = null; for (const c of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a']) { const r = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: W > 1300 ? 9e6 : 5e6, framerate: fps }).catch(() => ({})); if (r.supported) { codec = c; break; } }
  if (!codec) throw new Error('Браузер не умеет H.264. Откройте сайт в Google Chrome или Microsoft Edge.');
  const aac = (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }).catch(() => ({}))).supported;
  const target = fileHandle ? new FileSystemWritableFileStreamTarget(await fileHandle.createWritable()) : new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H }, audio: { codec: aac ? 'aac' : 'opus', sampleRate: 48000, numberOfChannels: 2 }, fastStart: fileHandle ? false : 'in-memory', firstTimestampBehavior: 'offset' });
  let err = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => (err = e) });
  venc.configure({ codec, width: W, height: H, bitrate: W > 1300 ? 9e6 : 5e6, framerate: fps, latencyMode: 'quality' });
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => (err = e) });
  aenc.configure({ codec: aac ? 'mp4a.40.2' : 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
  const L = audio.getChannelData(0), R = audio.getChannelData(audio.numberOfChannels > 1 ? 1 : 0), aEnd = Math.min(L.length, Math.ceil(total * 48000)); let apos = 0;
  const pushAudio = t => { const until = Math.min(aEnd, Math.ceil(t * 48000)); while (apos < until) { const n = Math.min(1024, until - apos), d = new Float32Array(n * 2); d.set(L.subarray(apos, apos + n), 0); d.set(R.subarray(apos, apos + n), n); const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(apos * 1e6 / 48000), data: d }); aenc.encode(ad); ad.close(); apos += n; } };

  const cuts = []; shots.forEach(s => (s.cuts || [{ media: null, t0: s.start, t1: s.end, from: 0 }]).forEach((c, k) => cuts.push({ ...c, shot: s, first: k === 0,
    trans: doc ? (pseudo(cuts.length + 1) < (style.dissolve ?? 0.6) ? 'dissolve' : 'cut') : k === 0 && s.overlay?.type === 'chapter' ? 'fade' : k === 0 && ['whoosh', 'swish'].includes(s.sfx) ? 'whip' : 'cut' })));
  let f = 0, started = performance.now();
  const emit = (cut, m, ci) => {
    const t = f / fps, p = (t - cut.t0) / Math.max(0.1, cut.t1 - cut.t0), dir = ci % 4;
    ctx.filter = grade;
    const isV = !!m.v, sc = isV ? 1.03 + 0.04 * p : 1.08 + 0.1 * p, px = isV ? 0 : [-.6, .6, 0, 0][dir] * (p - .5), py = isV ? 0 : [0, 0, -.6, .6][dir] * (p - .5);
    const lt = t - cut.t0;
    if (cut.trans === 'whip' && lt < 0.3 && f > 0) { const e = easeOut(lt / 0.3); ctx.save(); ctx.translate(W * (1 - e), 0); cover(ctx, m.v || m.img, m.w, m.h, W, H, sc, px, py); ctx.restore(); ctx.filter = 'blur(6px)'; ctx.drawImage(snap, -W * e, 0); }
    else if (cut.framed) drawFramed(ctx, m, W, H, p);
    else cover(ctx, m.v || m.img, m.w, m.h, W, H, sc, px, py);
    ctx.filter = 'none'; vignette(ctx, W, H);
    // cross-dissolve: the last picture of the previous cut fades out over the new one, still drifting slowly
    if (cut.trans === 'dissolve' && lt < 0.7 && f > 0) { const e = easeOut(lt / 0.7), z = 1 + 0.015 * lt; ctx.save(); ctx.globalAlpha = 1 - e; ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.drawImage(snap, -W / 2, -H / 2); ctx.restore(); }
    if (cut.trans === 'fade' && lt < 0.45) { ctx.fillStyle = `rgba(0,0,0,${1 - lt / 0.45})`; ctx.fillRect(0, 0, W, H); }
    if (f === cut.endF - 1) sctx.drawImage(canvas, 0, 0); // picture without graphics, for the next transition
    if (doc) { for (const ov of overlays) if (t >= ov.t0 && t <= ov.t1) drawDoc(ctx, ov, t, W, H); }
    else drawOverlay(ctx, cut.shot, t, W, H);
    if (subtitles && subtitles !== 'none') drawSubs(ctx, cut.shot, t, W, H, subtitles);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
    venc.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close(); f++;
    if (f % fps === 0) { pushAudio(f / fps); const el = (performance.now() - started) / 1000; onProgress?.(f / nFrames, `Кадр ${f}/${nFrames} · ${(f / fps / el).toFixed(2)}× скорость`); }
  };
  let next = cuts.length ? loadMedia(cuts[0].media || {}) : null;
  for (let ci = 0; ci < cuts.length && f < nFrames && !err; ci++) {
    const cut = cuts[ci], end = Math.min(nFrames, ci === cuts.length - 1 ? nFrames : Math.round(cut.t1 * fps));
    const m = await next; next = ci + 1 < cuts.length ? loadMedia(cuts[ci + 1].media || {}) : null;
    cut.endF = end; cut.framed = doc && style.framePhotos !== false && !m.v && m.img && ARCHIVE.has(cut.media?.source);
    if (m.v) {
      await seek(m.v, cut.from || 0);
      // A clip shorter than its cut is played slower (down to 0.5×) instead of freezing on its last frame.
      const avail = (Number.isFinite(m.v.duration) ? m.v.duration : Infinity) - m.v.currentTime, want = (end - f) / fps;
      const rate = avail < want ? Math.max(0.5, avail / want) : 1; m.v.playbackRate = rate;
      await new Promise(res => {
        let done = false, timer; const base = m.v.currentTime, start = f;
        const finish = () => { if (done) return; done = true; clearTimeout(timer); m.v.pause(); while (f < end) emit(cut, m, ci); res(); };
        const step = (now, meta) => { if (done) return; clearTimeout(timer); while (f < end && (f - start) / fps * rate <= meta.mediaTime - base + 0.5 / fps) emit(cut, m, ci); if (f >= end) return finish(); timer = setTimeout(finish, 4000); m.v.requestVideoFrameCallback(step); };
        m.v.onended = finish; timer = setTimeout(finish, 8000); m.v.requestVideoFrameCallback(step); m.v.play().catch(finish);
      });
      m.v.removeAttribute('src'); m.v.load();
    } else while (f < end) { emit(cut, m, ci); if (venc.encodeQueueSize > 20) await new Promise(r => setTimeout(r, 15)); else if (f % 15 === 0) await new Promise(r => setTimeout(r, 0)); }
  }
  if (err) throw err;
  pushAudio(total); await venc.flush(); await aenc.flush(); muxer.finalize();
  if (fileHandle) { await target.stream?.close?.(); return null; }
  return new Blob([target.buffer], { type: 'video/mp4' });
}
