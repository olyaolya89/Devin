// "Doc" look: motion graphics modelled on the reference documentary (youtube.com/@MaraWardwell).
// Big counter with a spaced unit word ("46 COTTAGES"), small corner stat, big year, centred title, black lower third,
// news-style info card, navy side panel with bullets, paper checklist with red ticks, bar chart, glowing map with a pin,
// name circled with red marker, key sentence on black. Each graphic is timed to the spoken word it belongs to.
const MONT = 'Montserrat, "Arial Black", Arial, sans-serif', INTER = 'Inter, Arial, sans-serif', HAND = 'Caveat, "Segoe Print", cursive';
const clamp01 = x => Math.min(1, Math.max(0, x));
const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = x => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const norm = w => String(w).toLowerCase().replace(/[^a-z0-9]+/gi, '');
const fmtNum = (v, dec) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const FONTS = ['900 80px Montserrat', '800 80px Montserrat', '600 40px Montserrat', '700 40px Inter', '400 30px Inter', '600 40px Caveat'];

// Time (s) when `word` is spoken in shot s, searching from token index `from`; uses Whisper word timings when present.
function tokenTimes(s) {
  const toks = s.text.split(/\s+/), a = s.start, b = Math.max(a + 0.5, s.wordEnd ?? s.end);
  return { toks, times: s.wt?.length === toks.length ? s.wt : toks.map((_, i) => a + (b - a) * i / toks.length) };
}
export function wordTime(s, word, from = 0) {
  const n = norm(String(word ?? '').split(/\s+/)[0]); if (!n) return null;
  const { toks, times } = tokenTimes(s);
  for (let i = from; i < toks.length; i++) { const m = norm(toks[i]); if (m && (m === n || (m.length >= 3 && n.length >= 3 && (m.startsWith(n) || n.startsWith(m))))) return { t: times[i], i }; }
  return null;
}
// Times of a phrase's words (for the key sentence shown word by word): the place in the line where most of its words match in a row.
function phraseTimes(s, words) {
  const { toks, times } = tokenTimes(s), P = words.map(norm), T = toks.map(norm);
  let best = 0, bi = -1;
  for (let i = 0; i < T.length; i++) { let m = 0; for (let k = 0; k < P.length && i + k < T.length; k++) if (P[k] && T[i + k] === P[k]) m++; if (m > best) { best = m; bi = i; } }
  if (bi < 0) { const b = Math.max(s.start + 0.5, s.wordEnd ?? s.end); return words.map((_, k) => s.start + (b - s.start) * k / words.length); }
  return words.map((_, k) => times[Math.min(T.length - 1, bi + k)]);
}

const statementWords = o => String(o.text || '').split(/\s+/).filter(Boolean).slice(0, 16);

// When a graphic is on screen: counters land on the spoken number, titles/years appear with their word, list graphics
// stay for the scene. Pure function: also used by the mixer (audio.js) and the density filter (plan.js).
export function ovWindow(s) {
  const o = s.overlay || {}, type = o.type, at = wordTime(s, o.word)?.t ?? null;
  const voiceEnd = Math.max(s.end, (s.wordEnd ?? s.end) + 0.4);
  let t0, t1, land;
  if (type === 'counter' || type === 'stat') { land = at ?? s.start + 1.2; t0 = Math.max(s.start, land - 1.0); t1 = t0 + (type === 'counter' ? 4.6 : 4.2); }
  else if (type === 'year' || type === 'title' || type === 'name') { t0 = at != null ? Math.max(s.start, at - 0.25) : s.start + 0.3; t1 = t0 + (type === 'name' ? 4.6 : 3.4); }
  else if (type === 'lowerthird') { t0 = s.start + 0.4; t1 = t0 + 5; }
  else if (type === 'infocard') { t0 = s.start + 0.3; t1 = t0 + 5.5; }
  else if (type === 'statement') {
    const ws = statementWords(o); const ts = ws.length && s.text ? phraseTimes(s, ws) : [s.start];
    t0 = Math.max(s.start, ts[0] - 0.35); t1 = Math.max(t0 + 3, ts.at(-1) + 1.4);
  } else { t0 = s.start + 0.1; t1 = Math.min(t0 + 10, Math.max(t0 + (type === 'map' ? 5 : 6.5), voiceEnd)); }
  return { t0, t1, land: land ?? t0 };
}

// --- map data (loaded only when a map is planned) ---
let geo = null;
async function loadGeo() {
  if (geo) return geo;
  const [d3, topo, world] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm'),
    import('https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm'),
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json').then(r => { if (!r.ok) throw new Error('world-atlas'); return r.json(); })
  ]);
  return (geo = { d3, countries: topo.feature(world, world.objects.countries).features });
}
const COUNTRY_RU = { 'United States of America': 'UNITED STATES', 'United Kingdom': 'UNITED KINGDOM', 'Dem. Rep. Congo': 'DR CONGO' };
function prepareMap(o, W, H) {
  const { d3, countries } = geo, pt = [o.lon, o.lat];
  let c = countries.find(f => d3.geoContains(f, pt)), focus = c, proj;
  if (c?.geometry.type === 'MultiPolygon') { // keep the part around the pin: no Alaska for California, no French Guiana for France
    const polys = c.geometry.coordinates.map(cs => ({ cs, f: { type: 'Feature', geometry: { type: 'Polygon', coordinates: cs } } }));
    const main = polys.find(p => d3.geoContains(p.f, pt)) || polys.sort((a, b) => d3.geoDistance(d3.geoCentroid(a.f), pt) - d3.geoDistance(d3.geoCentroid(b.f), pt))[0];
    const [[x0, y0], [x1, y1]] = d3.geoBounds(main.f), mx = (x1 - x0) * 0.3 + 1, my = (y1 - y0) * 0.3 + 1;
    const keep = polys.filter(p => { const [lx, ly] = d3.geoCentroid(p.f); return lx > x0 - mx && lx < x1 + mx && ly > y0 - my && ly < y1 + my; });
    focus = { ...c, geometry: { type: 'MultiPolygon', coordinates: keep.map(p => p.cs) } };
  }
  if (c && c.id === '840' && o.lon > -130 && o.lat < 50) proj = d3.geoAlbers().fitExtent([[W * 0.2, H * 0.14], [W * 0.8, H * 0.86]], focus); // lower 48, as in the reference
  else {
    if (!focus) focus = d3.geoCircle().center(pt).radius(6)();
    proj = d3.geoMercator().fitExtent([[W * 0.24, H * 0.16], [W * 0.76, H * 0.84]], focus);
  }
  const path = d3.geoPath(proj), pin = proj(pt), lab = path.centroid(focus);
  const name = c ? (COUNTRY_RU[c.properties.name] || c.properties.name.toUpperCase()) : '';
  if (name && Math.hypot(lab[0] - pin[0], lab[1] - pin[1]) < 80 * W / 1920) lab[1] -= 80 * W / 1920;
  return { proj, focus, pin, lab, name, highlight: c };
}

// Overlays of all shots with their time windows, sorted; maps get their projection (or turn into a title if offline).
export async function buildOverlays(shots, W, H) {
  const list = shots.filter(s => s.overlay && s.overlay.type && s.overlay.type !== 'none').map(s => ({ s, o: s.overlay, ...ovWindow(s) }));
  if (list.some(ov => ov.o.type === 'map')) await loadGeo().catch(e => console.warn('map data', e));
  for (const ov of list) if (ov.o.type === 'map') {
    try { if (!geo) throw new Error('no map data'); ov.map = prepareMap(ov.o, W, H); }
    catch (e) { console.warn(e); ov.o = { type: 'title', text: String(ov.o.text || '').toUpperCase() }; }
  }
  return list.sort((a, b) => a.t0 - b.t0);
}

const fade = (ov, t, inD = 0.45, outD = 0.45) => Math.min(easeOut((t - ov.t0) / inD), easeOut((ov.t1 - t) / outD));
function shadow(ctx, u, blur = 22, a = 0.55, y = 3) { ctx.shadowColor = `rgba(0,0,0,${a})`; ctx.shadowBlur = blur * u; ctx.shadowOffsetY = y * u; }
function noShadow(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
function setFont(ctx, weight, px, fam, spacing = 0) { ctx.font = `${weight} ${px}px ${fam}`; ctx.letterSpacing = `${spacing}px`; }
function fit(ctx, weight, px, fam, text, maxW, spacing = 0) { let k = 1; for (; k > 0.3; k *= 0.94) { setFont(ctx, weight, px * k, fam, spacing * k); if (ctx.measureText(text).width <= maxW) break; } return px * k; }
function wrap(ctx, text, maxW) { const out = []; let line = ''; for (const w of String(text).split(/\s+/).filter(Boolean)) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; }
const decimals = v => (Number.isInteger(v) ? 0 : Math.abs(v) < 100 ? 1 : 0);
// $12,500,000 is shown as $12.5M
const countText = (o, cur, val) => {
  const big = !String(o.suffix || '').trim() && Math.abs(val) >= 1e6, div = !big ? 1 : Math.abs(val) >= 1e9 ? 1e9 : 1e6;
  return `${o.prefix || ''}${fmtNum(cur / div, decimals(val / div))}${big ? (div === 1e9 ? 'B' : 'M') : o.suffix || ''}`;
};

function counter(ctx, ov, t, W, H, u) {
  const { o } = ov, lt = t - ov.t0, val = +o.value || 0, from = o.from != null && Number.isFinite(+o.from) ? +o.from : 0;
  const land = Math.max(0.7, ov.land + 0.15 - ov.t0), p = easeInOut((lt - 0.1) / (land - 0.1)), cur = from + (val - from) * p;
  const unit = String(o.unit || '').toUpperCase().trim(), fin = countText(o, val, val);
  setFont(ctx, 900, 190 * u, MONT); const nw = ctx.measureText(fin).width;
  setFont(ctx, 600, 58 * u, MONT, 9 * u); const uw = unit ? ctx.measureText(unit).width : 0;
  const total = nw + (unit ? 28 * u + uw : 0), k = Math.min(1, W * 0.78 / total);
  const x = Math.min(W * 0.29, W * 0.93 - total * k), y = H * 0.57;
  ctx.globalAlpha = fade(ov, t, 0.4, 0.5); ctx.translate(x, y + (1 - easeOut(lt / 0.5)) * 26 * u); ctx.scale(k, k);
  shadow(ctx, u, 34, 0.6, 4); setFont(ctx, 900, 190 * u, MONT); ctx.fillStyle = '#fff'; ctx.fillText(countText(o, cur, val), 0, 0);
  if (unit) { const ua = easeOut((lt - 0.3) / 0.55); ctx.globalAlpha *= ua; setFont(ctx, 600, 58 * u, MONT, 9 * u); ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.fillText(unit, nw + 28 * u - (1 - ua) * 16 * u, -6 * u); }
}

function stat(ctx, ov, t, W, H, u) {
  const { o } = ov, lt = t - ov.t0, val = +o.value || 0, land = Math.max(0.7, ov.land + 0.15 - ov.t0);
  const cur = (o.from ?? 0) + (val - (o.from ?? 0)) * easeInOut((lt - 0.1) / (land - 0.1));
  ctx.globalAlpha = fade(ov, t); ctx.textAlign = 'right'; ctx.translate(0, (1 - easeOut(lt / 0.5)) * 14 * u);
  shadow(ctx, u, 18, 0.6, 2); setFont(ctx, 800, 78 * u, MONT); ctx.fillStyle = '#fff'; ctx.fillText(countText(o, cur, val), W - 118 * u, H - 196 * u);
  if (o.unit) { setFont(ctx, 600, 16 * u, MONT, 3.5 * u); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(String(o.unit).toUpperCase(), W - 118 * u + 3.5 * u, H - 164 * u); }
}

function year(ctx, ov, t, W, H, u) {
  const { o } = ov, lt = t - ov.t0, D = ov.t1 - ov.t0, txt = String(o.text || o.value || '').toUpperCase();
  ctx.globalAlpha = fade(ov, t, 0.35, 0.6); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const sc = 1.07 - 0.07 * easeOut(lt / D); ctx.translate(W / 2, H * 0.5); ctx.scale(sc, sc);
  shadow(ctx, u, 40, 0.55, 4); fit(ctx, 900, 220 * u, MONT, txt, W * 0.8, 4 * u); ctx.fillStyle = '#fff'; ctx.fillText(txt, 0, 0);
}

function title(ctx, ov, t, W, H, u) {
  const { o } = ov, lt = t - ov.t0, D = ov.t1 - ov.t0, txt = String(o.text || '').toUpperCase(), e = easeOut(lt / 0.7);
  ctx.globalAlpha = fade(ov, t, 0.5, 0.55); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const sp = (4 + 5 * easeOut(lt / D)) * u; fit(ctx, 800, 104 * u, MONT, txt, W * 0.8, sp);
  if (e < 1) ctx.filter = `blur(${((1 - e) * 10 * u).toFixed(1)}px)`;
  shadow(ctx, u, 36, 0.6, 4); ctx.fillStyle = '#fff'; ctx.fillText(txt, W / 2 + sp / 2, H * 0.5);
}

function lowerthird(ctx, ov, t, W, H, u) {
  const { o } = ov, lt = t - ov.t0, ttl = String(o.text || '').toUpperCase(), sub = String(o.sub || '').toUpperCase();
  setFont(ctx, 800, 40 * u, MONT, 0.5 * u); const tw = ctx.measureText(ttl).width;
  setFont(ctx, 600, 17 * u, MONT, 2 * u); const sw = sub ? ctx.measureText(sub).width : 0;
  const pad = 30 * u, bw = Math.max(tw, sw) + pad * 2 + 6 * u, bh = sub ? 106 * u : 76 * u, y = H * 0.72;
  const g = Math.min(easeOut(lt / 0.45), easeOut((ov.t1 - t) / 0.4));
  ctx.fillStyle = 'rgba(6,6,6,0.9)'; ctx.fillRect(0, y, bw * g, bh); ctx.fillStyle = '#f2c230'; ctx.fillRect(0, y, 6 * u, bh * Math.min(1, g * 1.6));
  ctx.beginPath(); ctx.rect(0, y, bw * g, bh); ctx.clip();
  ctx.globalAlpha = Math.min(easeOut((lt - 0.25) / 0.4), easeOut((ov.t1 - t) / 0.3));
  setFont(ctx, 800, 40 * u, MONT, 0.5 * u); ctx.fillStyle = '#fff'; ctx.fillText(ttl, 6 * u + pad, y + (sub ? 50 : 52) * u);
  if (sub) { setFont(ctx, 600, 17 * u, MONT, 2 * u); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText(sub, 6 * u + pad, y + 82 * u); }
}

function infocard(ctx, ov, t, W, H, u) {
  const { o } = ov, lt = t - ov.t0, x = W * 0.28, y = H * 0.27, a = fade(ov, t, 0.5, 0.5);
  setFont(ctx, 700, 46 * u, INTER); const tl = wrap(ctx, o.text, W * 0.36).slice(0, 3);
  setFont(ctx, 400, 26 * u, INTER); const sl = o.sub ? wrap(ctx, o.sub, W * 0.32).slice(0, 3) : [];
  const g = ctx.createRadialGradient(x + W * 0.16, y + H * 0.08, 0, x + W * 0.16, y + H * 0.08, W * 0.34);
  g.addColorStop(0, `rgba(0,0,0,${0.42 * a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = a; shadow(ctx, u, 16, 0.6, 2);
  const e = easeOut(lt / 0.55); setFont(ctx, 700, 46 * u, INTER); ctx.fillStyle = '#fff';
  tl.forEach((l, i) => ctx.fillText(l, x, y + i * 54 * u + (1 - e) * 20 * u));
  let yy = y + tl.length * 54 * u + 12 * u;
  if (sl.length) {
    const lh = 34 * u, h = sl.length * lh; noShadow(ctx); ctx.fillStyle = '#3fb6e8'; ctx.fillRect(x, yy - 24 * u, 4 * u, h * easeOut((lt - 0.3) / 0.5));
    ctx.globalAlpha = a * easeOut((lt - 0.5) / 0.5); shadow(ctx, u, 12, 0.6, 2); setFont(ctx, 400, 26 * u, INTER); ctx.fillStyle = 'rgba(255,255,255,0.86)';
    sl.forEach((l, i) => ctx.fillText(l, x + 20 * u, yy + i * lh)); yy += h;
  }
  if (o.source) { ctx.globalAlpha = a * 0.6 * easeOut((lt - 0.8) / 0.5); setFont(ctx, 500, 15 * u, INTER, 1.2 * u); ctx.fillStyle = '#fff'; ctx.fillText(String(o.source).toUpperCase(), x, yy + 14 * u); }
}

function panel(ctx, ov, t, W, H, u) {
  const { o } = ov, lt = t - ov.t0, px = W * 0.37, D = ov.t1 - ov.t0;
  const g = Math.min(easeOut(lt / 0.6), easeOut((ov.t1 - t) / 0.5)); ctx.translate((1 - g) * (W - px + 80 * u), 0);
  const bg = ctx.createLinearGradient(px - 90 * u, 0, W, 0); bg.addColorStop(0, 'rgba(10,17,30,0)'); bg.addColorStop(90 * u / (W - px + 90 * u), 'rgba(10,17,30,0.97)'); bg.addColorStop(1, 'rgba(7,12,22,0.99)');
  ctx.fillStyle = bg; ctx.fillRect(px - 90 * u, 0, W - px + 90 * u, H); ctx.fillStyle = '#2ec4b6'; ctx.fillRect(px, 0, 3 * u, H);
  const x = px + W * 0.055; let y = H * 0.4;
  ctx.globalAlpha = easeOut((lt - 0.35) / 0.45); fit(ctx, 800, 42 * u, MONT, String(o.text || '').toUpperCase(), W * 0.5, 1 * u); ctx.fillStyle = '#fff'; ctx.fillText(String(o.text || '').toUpperCase(), x, y);
  ctx.fillStyle = '#2ec4b6'; ctx.fillRect(x, y + 20 * u, 56 * u * easeOut((lt - 0.5) / 0.4), 3 * u);
  y += 76 * u; const items = o.items || [], step = Math.min(0.9, Math.max(0.35, (D - 2.5) / Math.max(1, items.length)));
  setFont(ctx, 500, 26 * u, INTER);
  items.forEach((it, i) => {
    const e = easeOut((lt - 0.9 - i * step) / 0.45); if (e <= 0) return; const lines = wrap(ctx, it, W * 0.46);
    ctx.globalAlpha = e; ctx.fillStyle = '#2ec4b6'; ctx.beginPath(); ctx.arc(x + 6 * u + (1 - e) * 20 * u, y - 9 * u, 4.5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; lines.forEach((l, k) => ctx.fillText(l, x + 26 * u + (1 - e) * 20 * u, y + k * 36 * u)); y += lines.length * 36 * u + 16 * u;
  });
}

function checklist(ctx, ov, t, W, H, u) {
  const { o, s } = ov, lt = t - ov.t0, D = ov.t1 - ov.t0, items = (o.items || []).slice(0, 5);
  const x = W * 0.565, w = W * 0.41, hh = 54 * u, lh = 62 * u, h = hh + 30 * u + items.length * lh + 10 * u;
  const e = easeOut(lt / 0.55), a = fade(ov, t, 0.4, 0.45), y = H * 0.15 - (1 - e) * 34 * u;
  ctx.globalAlpha = a; ctx.translate(x + w / 2, y + h / 2); ctx.rotate((1 - e) * -0.03); ctx.translate(-(x + w / 2), -(y + h / 2));
  shadow(ctx, u, 30, 0.45, 8); ctx.fillStyle = '#f3ebe1'; ctx.fillRect(x, y, w, h); noShadow(ctx);
  ctx.fillStyle = '#8c1f1f'; ctx.fillRect(x, y, w, hh); setFont(ctx, 800, 24 * u, MONT, 1.5 * u); ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
  ctx.fillText(String(o.text || '').toUpperCase(), x + 24 * u, y + hh / 2 + 1 * u, w - 48 * u);
  // each item is written when it is spoken (or spread over the scene), then ticked
  const step = Math.min(1.8, Math.max(0.7, (D - 2.2) / Math.max(1, items.length)));
  let from = 0;
  items.forEach((it, i) => {
    const r = o.words?.[i] ? wordTime(s, o.words[i], from) : null; if (r) from = r.i + 1;
    const ti = Math.max(0.6, (r ? r.t - ov.t0 : 0.8 + i * step)), cy = y + hh + 30 * u + i * lh + lh / 2 - 12 * u, bx = x + 26 * u, bs = 26 * u;
    ctx.strokeStyle = '#7a5c55'; ctx.lineWidth = 2.5 * u; ctx.strokeRect(bx, cy - bs / 2, bs, bs);
    const wE = clamp01((lt - ti + 0.5) / 0.7); if (wE <= 0) return;
    setFont(ctx, 600, 40 * u, HAND); const tw = ctx.measureText(it).width;
    ctx.save(); ctx.beginPath(); ctx.rect(bx + 44 * u, cy - 40 * u, (tw + 10 * u) * wE, 80 * u); ctx.clip(); ctx.fillStyle = '#2f2424'; ctx.fillText(it, bx + 44 * u, cy + 2 * u, w - 90 * u); ctx.restore();
    const k = clamp01((lt - ti - 0.35) / 0.25); if (k <= 0) return;
    const P = [[bx + 4 * u, cy - 1 * u], [bx + 11 * u, cy + 8 * u], [bx + 27 * u, cy - 14 * u]];
    ctx.strokeStyle = '#c0262d'; ctx.lineWidth = 4.5 * u; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(...P[0]);
    if (k < 0.4) ctx.lineTo(P[0][0] + (P[1][0] - P[0][0]) * k / 0.4, P[0][1] + (P[1][1] - P[0][1]) * k / 0.4);
    else { ctx.lineTo(...P[1]); const q = (k - 0.4) / 0.6; ctx.lineTo(P[1][0] + (P[2][0] - P[1][0]) * q, P[1][1] + (P[2][1] - P[1][1]) * q); }
    ctx.stroke();
  });
}
// Item tick times, for the mixer's soft click.
export function checklistTicks(ov) {
  const { o, s } = ov, items = (o.items || []).slice(0, 5), D = ov.t1 - ov.t0, step = Math.min(1.8, Math.max(0.7, (D - 2.2) / Math.max(1, items.length)));
  let from = 0; return items.map((_, i) => { const r = o.words?.[i] ? wordTime(s, o.words[i], from) : null; if (r) from = r.i + 1; return ov.t0 + Math.max(0.6, r ? r.t - ov.t0 : 0.8 + i * step) + 0.35; });
}

const BAR_COLORS = ['#3aa0ff', '#6f7bff', '#2ed3a6', '#a77bff', '#ffb547', '#ff6b8a'];
const niceMax = v => { const p = Math.pow(10, Math.floor(Math.log10(v || 1))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };
function chart(ctx, ov, t, W, H, u) {
  const { o } = ov, lt = t - ov.t0, bars = o.bars || [], a = fade(ov, t, 0.5, 0.5);
  ctx.globalAlpha = a; const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, W * 0.7); bg.addColorStop(0, '#142542'); bg.addColorStop(1, '#070d1a'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const x0 = W * 0.22, x1 = W * 0.88, top = H * 0.25, bot = H * 0.82, axis = H * 0.87;
  ctx.globalAlpha = a * easeOut(lt / 0.5); fit(ctx, 800, 46 * u, MONT, String(o.text || '').toUpperCase(), W * 0.7, 1 * u); ctx.fillStyle = '#fff'; ctx.fillText(String(o.text || '').toUpperCase(), x0, H * 0.14);
  const max = niceMax(Math.max(...bars.map(b => b.value)) * 1.1), slot = (bot - top) / Math.max(1, bars.length), bh = Math.min(30 * u, slot * 0.36);
  ctx.globalAlpha = a * 0.5; ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x0, axis, x1 - x0, 1.5 * u); ctx.fillRect(x0, top - 20 * u, 1.5 * u, axis - top + 20 * u);
  setFont(ctx, 500, 18 * u, INTER); ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
  for (let k = 0; k <= 5; k++) ctx.fillText(fmtNum(max * k / 5, max < 10 ? 1 : 0), x0 + (x1 - x0) * k / 5, axis + 30 * u);
  if (o.unit) { setFont(ctx, 500, 20 * u, INTER); ctx.fillText(String(o.unit), (x0 + x1) / 2, axis + 64 * u); }
  bars.forEach((b, i) => {
    const g = easeOut((lt - 0.6 - i * 0.28) / 0.9), y = top + slot * i + slot / 2, len = (x1 - x0) * b.value / max * g, col = BAR_COLORS[i % BAR_COLORS.length];
    ctx.globalAlpha = a * Math.min(1, g * 3 + 0.3); setFont(ctx, 600, 22 * u, INTER); ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(b.label, x0 - 16 * u, y + 7 * u);
    ctx.globalAlpha = a; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14 * u; ctx.fillRect(x0 + 2 * u, y - bh / 2, len, bh); noShadow(ctx);
    if (g > 0.85) { ctx.globalAlpha = a * (g - 0.85) / 0.15; setFont(ctx, 700, 26 * u, MONT); ctx.textAlign = 'left'; ctx.fillStyle = col; ctx.fillText(`${o.prefix || ''}${fmtNum(b.value, decimals(b.value))}${o.suffix || ''}`, x0 + len + 16 * u, y + 9 * u); }
  });
}

function map(ctx, ov, t, W, H, u) {
  const { o, map: m } = ov; if (!m) return; const lt = t - ov.t0, D = ov.t1 - ov.t0, a = fade(ov, t, 0.5, 0.5), { d3, countries } = geo;
  ctx.globalAlpha = a; const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.75); bg.addColorStop(0, '#0d1824'); bg.addColorStop(1, '#050a10'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const z = 1 + 0.07 * easeInOut(lt / D); ctx.translate(m.pin[0], m.pin[1]); ctx.scale(z, z); ctx.translate(-m.pin[0], -m.pin[1]);
  const path = d3.geoPath(m.proj, ctx);
  ctx.beginPath(); for (const c of countries) if (c !== m.highlight) path(c); ctx.fillStyle = '#15251f'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1 * u; ctx.stroke();
  const h = easeOut((lt - 0.2) / 0.8);
  ctx.beginPath(); path(m.focus); ctx.globalAlpha = a * (0.25 + 0.75 * h); ctx.shadowColor = 'rgba(90,160,255,0.9)'; ctx.shadowBlur = 40 * u; ctx.fillStyle = '#2b5fd9'; ctx.fill();
  ctx.shadowBlur = 12 * u; ctx.shadowColor = 'rgba(160,210,255,0.9)'; ctx.strokeStyle = '#e8f1ff'; ctx.lineWidth = 2.5 * u / z; ctx.stroke(); noShadow(ctx);
  if (m.name) { ctx.globalAlpha = a * easeOut((lt - 0.6) / 0.5); ctx.textAlign = 'center'; shadow(ctx, u, 14, 0.6, 2); setFont(ctx, 800, 40 * u, MONT, 3 * u); ctx.fillStyle = '#fff'; ctx.fillText(m.name, m.lab[0], m.lab[1]); noShadow(ctx); }
  const pe = easeOut((lt - 0.9) / 0.4); if (pe <= 0) return;
  ctx.globalAlpha = a * pe; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(m.pin[0], m.pin[1], 6 * u, 0, Math.PI * 2); ctx.fill();
  const ring = ((lt - 0.9) * 0.8) % 1; ctx.globalAlpha = a * pe * (1 - ring); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(m.pin[0], m.pin[1], 6 * u + 26 * u * ring, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = a * pe; ctx.textAlign = 'left'; shadow(ctx, u, 10, 0.7, 1); setFont(ctx, 700, 18 * u, MONT, 1.6 * u); ctx.fillStyle = '#fff'; ctx.fillText(String(o.text || '').toUpperCase(), m.pin[0] + 16 * u, m.pin[1] + 6 * u);
}

const hash = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function name(ctx, ov, t, W, H, u) {
  const { o } = ov, lt = t - ov.t0, D = ov.t1 - ov.t0, a = fade(ov, t, 0.45, 0.5), txt = String(o.text || '').toUpperCase();
  ctx.fillStyle = `rgba(0,0,0,${0.4 * a})`; ctx.fillRect(0, 0, W, H);
  const w = W * 0.6, h = H * 0.46, sc = 1.06 - 0.06 * easeOut(lt / D);
  ctx.globalAlpha = a; ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.rotate(-0.025);
  shadow(ctx, u, 40, 0.5, 10); const pg = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); pg.addColorStop(0, '#efe6d2'); pg.addColorStop(1, '#ddd0b5'); ctx.fillStyle = pg; ctx.fillRect(-w / 2, -h / 2, w, h); noShadow(ctx);
  let r = hash(txt); ctx.fillStyle = 'rgba(40,35,30,0.55)';
  for (let k = 0; k < 4; k++) { r = (r * 1103515245 + 12345) >>> 0; ctx.fillRect(-w / 2 + 50 * u, h * 0.2 + k * 26 * u, (0.25 + (r % 1000) / 1000 * 0.45) * w, 9 * u); }
  const ny = -h * 0.17; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; fit(ctx, 900, 104 * u, MONT, txt, w * 0.78, 1 * u); ctx.fillStyle = '#151515'; ctx.fillText(txt, 0, ny);
  const nw = Math.min(w * 0.78, ctx.measureText(txt).width);
  if (o.sub) { setFont(ctx, 600, 26 * u, INTER, 2 * u); ctx.fillStyle = '#5a5248'; ctx.fillText(String(o.sub).toUpperCase(), 0, ny + 118 * u, w * 0.8); }
  const e = easeOut((lt - 0.35) / 0.75); if (e <= 0) return;
  ctx.strokeStyle = 'rgba(198,40,40,0.92)'; ctx.lineWidth = 8 * u; ctx.lineCap = 'round'; ctx.beginPath();
  ctx.ellipse(0, ny, nw / 2 + 56 * u, 84 * u, -0.04, -2.6, -2.6 + Math.PI * 2.12 * e); ctx.stroke();
}

function statement(ctx, ov, t, W, H, u) {
  const { o, s } = ov, a = fade(ov, t, 0.35, 0.5), words = statementWords(o).map(w => w.toUpperCase()), times = phraseTimes(s, words);
  const hl = new Set(String(o.highlight || '').split(/\s+/).map(norm).filter(Boolean));
  ctx.globalAlpha = a; ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
  setFont(ctx, 800, 52 * u, MONT, 1 * u); const maxW = W * 0.5, sp = ctx.measureText(' ').width, lh = 70 * u, lines = [[]]; let lw = 0;
  words.forEach((w, i) => { const ww = ctx.measureText(w).width; if (lw && lw + sp + ww > maxW) { lines.push([]); lw = 0; } lines.at(-1).push({ w, i, ww, x: lw ? lw + sp : 0 }); lw += (lw ? sp : 0) + ww; });
  const x0 = W * 0.27, y0 = H / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((line, li) => line.forEach(({ w, i, ww, x }) => {
    const e = easeOut((t - times[i] + 0.1) / 0.25); if (e <= 0) return; const y = y0 + li * lh;
    ctx.globalAlpha = a * e;
    if (hl.has(norm(w))) { ctx.fillStyle = '#d7262e'; ctx.fillRect(x0 + x - 8 * u, y - 36 * u, (ww + 16 * u) * easeOut((t - times[i]) / 0.3), 64 * u); }
    ctx.fillStyle = '#fff'; ctx.fillText(w, x0 + x, y + (1 - e) * 10 * u + 18 * u);
  }));
}

const DRAW = { counter, stat, year, title, lowerthird, infocard, panel, checklist, chart, map, name, statement };
export const FULLSCREEN = new Set(['chart', 'map', 'statement']);
export function drawDoc(ctx, ov, t, W, H) {
  const f = DRAW[ov.o.type]; if (!f || t < ov.t0 || t > ov.t1) return;
  ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  try { f(ctx, ov, t, W, H, W / 1920); } catch (e) { console.warn('graphic', ov.o.type, e); } finally { ctx.restore(); }
}

// Archival still (Wikimedia, Library of Congress, Internet Archive) as in the reference: a soft-edged photo floating on navy.
export function drawFramed(ctx, m, W, H, p) {
  const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7); bg.addColorStop(0, '#1a2535'); bg.addColorStop(1, '#070b12'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (!m.img || !m.w) return;
  if (!m.framed || m.framed.width !== Math.round(W * 0.66)) {
    const k = Math.min(W * 0.62 / m.w, H * 0.74 / m.h), fw = Math.round(m.w * k), fh = Math.round(m.h * k), c = document.createElement('canvas');
    c.width = Math.round(W * 0.66); c.height = Math.round(H * 0.8); const x = c.getContext('2d'), ox = (c.width - fw) / 2, oy = (c.height - fh) / 2, f = Math.max(10, fw * 0.04);
    x.drawImage(m.img, ox, oy, fw, fh); x.globalCompositeOperation = 'destination-out';
    for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[ox, 0, ox + f, 0, ox, oy, f, fh], [ox + fw, 0, ox + fw - f, 0, ox + fw - f, oy, f, fh], [0, oy, 0, oy + f, ox, oy, fw, f], [0, oy + fh, 0, oy + fh - f, ox, oy + fh - f, fw, f]]) {
      const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(rx, ry, rw, rh);
    }
    m.framed = c;
  }
  const sc = 1 + 0.05 * p, c = m.framed; ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 40; ctx.drawImage(c, -c.width / 2, -c.height / 2); ctx.restore();
}
