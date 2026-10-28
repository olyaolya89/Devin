import { splitShots, alignTiming, estimateTiming, mergeShort, heuristicPlan, geminiPlan, toSrt, thinGraphics, SFX, MOODS, OVERLAYS, DOC_OVERLAYS, toDoc } from './plan.js';
import { gatherCandidates, pickMedia, planCuts, refillShort, cutsNeeded, CUT } from './match.js';
import { STYLES, SUB_LOOKS, loadStyle, saveStyle, describeStyle } from './styles.js';
import { analyzeReference } from './reference.js';
import { limits } from './sources.js';
import { transcribe } from './ai.js';
import { mixAudio, decodeFile, to16kMono } from './audio.js';
import { renderVideo } from './render.js';

const $ = s => document.querySelector(s);
const S = { script: '', shots: [], topic: '', voice: null, voiceName: '', style: loadStyle(), musicTrack: null };
const cfg = () => JSON.parse(localStorage.getItem('lumencut.settings') || '{}');
const log = m => { $('#log').textContent += `${new Date().toLocaleTimeString()}  ${m}\n`; $('#log').scrollTop = 1e9; };
const prog = (el, p) => { $(el + ' i').style.width = `${Math.round(p * 100)}%`; };
let lastMsg = ''; const status = m => { const pct = m.match(/(\d+)%$/); if (pct && +pct[1] % 25 !== 0) return; if (m !== lastMsg) { lastMsg = m; log(m); } };

document.querySelectorAll('nav button').forEach(b => b.onclick = () => tab(b.dataset.tab));
function tab(name) { document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === name)); document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + name)); }

// settings
const K = { pexels: 'k_pexels', pixabay: 'k_pixabay', gemini: 'k_gemini', model: 'k_model' };
function loadSettings() { const c = cfg(); for (const [k, id] of Object.entries(K)) if (c[k]) $('#' + id).value = c[k]; $('#k_wikimedia').checked = c.wikimedia !== false; for (const k of ['nasa', 'archive', 'loc']) $('#k_' + k).checked = c[k] !== false; $('#k_clip').checked = c.clip !== false; $('#k_video').checked = c.preferVideo !== false; keysInfo(); }
function keysInfo() { const c = cfg(); $('#keysInfo').textContent = `Pexels: ${c.pexels ? '✓' : '—'} · Pixabay: ${c.pixabay ? '✓' : '—'} · Gemini: ${c.gemini ? '✓' : '—'} (ключи хранятся только в этом браузере)`; }
$('#saveKeys').onclick = () => { const c = {}; for (const [k, id] of Object.entries(K)) c[k] = $('#' + id).value.trim(); c.wikimedia = $('#k_wikimedia').checked; for (const k of ['nasa', 'archive', 'loc']) c[k] = $('#k_' + k).checked; c.clip = $('#k_clip').checked; c.preferVideo = $('#k_video').checked; localStorage.setItem('lumencut.settings', JSON.stringify(c)); keysInfo(); };
loadSettings();

// style (from a reference video, a saved file, or a built-in preset)
const REF_KEY = 'lumencut.refStyle';
const refStyle = () => { try { return JSON.parse(localStorage.getItem(REF_KEY) || 'null'); } catch { return null; } };
$('#subs').innerHTML = Object.entries(SUB_LOOKS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
function styleChoices() {
  const ref = refStyle(), list = [STYLES.doc, STYLES.classic, ...(ref ? [ref] : [])];
  if (S.style.id !== 'ref' && !list.some(x => x.id === S.style.id)) list.push(S.style);
  $('#style').innerHTML = list.map(x => `<option value="${x.id}" ${x.id === S.style.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}
function applyStyle(st, persistIt = true) {
  if (!st?.look) st = STYLES.doc;
  S.style = structuredClone(st); CUT.max = S.style.cut.max || 5; if (persistIt) saveStyle(S.style);
  $('#styleInfo').innerHTML = describeStyle(S.style).map(l => `<li>${esc(l)}</li>`).join('');
  $('#subs').value = S.style.subtitles in SUB_LOOKS ? S.style.subtitles : 'none';
  $('#musicDb').value = Math.max(-30, Math.min(-8, S.style.music.db)); $('#music').checked = S.style.music.db > -50; musicDbVal();
  styleChoices();
}
const musicDbVal = () => ($('#musicDbVal').textContent = `${$('#musicDb').value} дБ`);
$('#musicDb').oninput = musicDbVal;
$('#style').onchange = e => { const id = e.target.value; applyStyle(id === 'ref' ? refStyle() : STYLES[id] || S.style); if (S.shots.length) drawBoard(); };
$('#refVideo').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; const c = cfg(), st = $('#refStatus'); $('#refVideo').disabled = true;
  try {
    st.textContent = `Открываю «${f.name}»…`;
    const prof = await analyzeReference(f, { key: c.gemini, model: c.model }, (m, p) => { st.textContent = m; if (p != null) prog('#refProgress', p); });
    localStorage.setItem(REF_KEY, JSON.stringify(prof)); applyStyle(prof); prog('#refProgress', 1);
    st.textContent = `✓ Стиль снят с «${f.name}». Теперь «Сделать готовое видео» соберёт ролик в этом стиле.${c.gemini ? '' : ' Без ключа Gemini виды графики взяты из пресета «Документалка».'}`;
    if (S.shots.length) log('Стиль поменялся — чтобы графика и длина кадров стали как в образце, сделайте раскадровку заново.');
  } catch (err) { st.textContent = '⚠ ' + err.message; console.error(err); }
  finally { $('#refVideo').disabled = false; e.target.value = ''; }
};
$('#saveStyleFile').onclick = () => download(new Blob([JSON.stringify(S.style, null, 1)], { type: 'application/json' }), `lumencut-style-${S.style.id}.json`);
$('#loadStyle').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const st = JSON.parse(await f.text()); if (!st.look || !st.gfx) throw new Error('это не файл стиля'); if (st.id === 'ref') localStorage.setItem(REF_KEY, JSON.stringify(st)); applyStyle(st); } catch (err) { alert('Не получилось открыть стиль: ' + err.message); } e.target.value = ''; };
$('#musicFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; $('#musicInfo').textContent = 'читаю…'; try { S.musicTrack = await decodeFile(f); $('#musicInfo').textContent = `✓ ${f.name} · ${fmt(S.musicTrack.duration)} — будет играть по кругу под всем видео (не забудьте указать автора в описании, если лицензия требует)`; } catch (err) { S.musicTrack = null; $('#musicInfo').textContent = '⚠ ' + err.message; } };

// project
const saved = JSON.parse(localStorage.getItem('lumencut.project') || 'null');
// CLIP vectors (512 numbers per clip) are dropped when saving: they overflowed localStorage and the project silently stopped saving.
const noEmb = (k, v) => (k === 'emb' ? undefined : v);
const persist = () => { try { localStorage.setItem('lumencut.project', JSON.stringify({ script: S.script, shots: S.shots, topic: S.topic, style: S.style }, noEmb)); } catch (e) { log('⚠ Проект не поместился в память браузера — нажмите «Сохранить проект», чтобы не потерять раскадровку.'); } };
async function setVoice(f) {
  if (!f) return; const vi = $('#voiceInfo'); vi.textContent = `читаю «${f.name}» (${(f.size / 1048576).toFixed(1)} МБ)…`;
  try { S.voice = await decodeFile(f); S.voiceName = f.name; vi.textContent = `✓ ${f.name} · ${fmt(S.voice.duration)}`; }
  catch (e) { S.voice = null; vi.textContent = '⚠ ' + e.message; console.error(e); }
}
$('#voice').onchange = e => setVoice(e.target.files[0]);
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { const f = [...(e.dataTransfer?.files || [])].find(x => /^audio\/|\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i.test(x.type || x.name)); if (f) { e.preventDefault(); tab('project'); setVoice(f); } });
$('#saveProj').onclick = () => download(new Blob([JSON.stringify({ script: $('#script').value, shots: S.shots, topic: S.topic, style: S.style }, noEmb, 1)], { type: 'application/json' }), 'lumencut-project.json');
$('#loadProj').onchange = async e => { const f = e.target.files[0]; if (!f) return; const pr = JSON.parse(await f.text()); Object.assign(S, { script: pr.script, shots: pr.shots || [], topic: pr.topic }); if (pr.style?.look) applyStyle(pr.style); $('#script').value = S.script || ''; drawBoard(); log('Проект открыт. Для рендера снова выберите файл озвучки.'); };

async function makeStoryboard() {
  const btns = [$('#go'), $('#auto')]; btns.forEach(b => (b.disabled = true)); $('#log').textContent = '';
  try {
    const c = cfg(); S.script = $('#script').value.trim(); if (!S.script) throw new Error('Вставьте сценарий');
    if (!c.pexels && !c.pixabay) log('⚠ Нет ключей Pexels/Pixabay — ищу только в Wikimedia. Добавьте бесплатные ключи во вкладке «Настройки» для качественного видео.');
    let shots = splitShots(S.script); log(`Сцен: ${shots.length}`); prog('#progress', 0.05);
    if (S.voice) {
      try { const words = await transcribe(await to16kMono(S.voice), status); shots = alignTiming(shots, words, S.voice.duration); log(`Тайминг по голосу: ${words.length} слов распознано`); }
      catch (e) { log(`Whisper не сработал (${e.message}) — оцениваю время по словам`); shots = estimateTiming(shots, shots.reduce((n, s) => n + s.text.split(/\s+/).length, 0) / S.voice.duration); shots.at(-1).end = S.voice.duration; }
    } else shots = estimateTiming(shots);
    const st = S.style; CUT.max = st.cut.max || 5;
    if (st.cut.min) { const n = shots.length; shots = mergeShort(shots, st.cut.min, st.cut.max + 1); if (shots.length < n) log(`Стиль «${st.name.split(' —')[0]}»: короткие фразы объединены, чтобы кадр держался ${st.cut.min}–${st.cut.max} сек — сцен стало ${shots.length}`); }
    prog('#progress', 0.25);
    let plan;
    if (c.gemini) { try { plan = await geminiPlan(c.gemini, c.model, shots, status, st); log(`Тема: ${plan.topic}`); } catch (e) { log(`Gemini ошибка (${e.message}) — использую простой план`); } }
    else if (st.look === 'doc') log('Без ключа Gemini графика будет только из цифр, годов и мест в тексте. Карты, списки, панели и диаграммы появятся с ключом Gemini.');
    plan ||= heuristicPlan(shots, st); S.shots = plan.shots; S.topic = plan.topic; prog('#progress', 0.4);
    limits.onLimit = src => log(`⚠ Лимит ${src} (200 запросов в час) исчерпан — дальше ищу в Pixabay и архивах. Через час лимит вернётся.`);
    const W = 1920; await gatherCandidates(S.shots, c, W, m => { status(m); }); prog('#progress', 0.7);
    await pickMedia(S.shots, c, status); prog('#progress', 0.9);
    const refilled = await refillShort(S.shots, c, S.topic, status); if (refilled) log(`Длинным сценам не хватало разных кадров — дополнительный поиск для ${refilled} сцен.`); prog('#progress', 1);
    const long = S.shots.filter(s => s.picks.length && s.picks.length < cutsNeeded(s)).length; if (long) log(`⚠ ${long} сцен с кадром длиннее 5 сек — их можно дополнить во вкладке «Раскадровка» (кнопка «Найти заново»).`);
    const miss = S.shots.filter(s => !s.picks.length).length; log(`Готово. ${miss ? `Без кадра: ${miss} сцен — замените вручную во вкладке «Раскадровка».` : 'Все сцены с уникальными кадрами.'}`);
    persist(); drawBoard(); return true;
  } catch (e) { log('Ошибка: ' + e.message); console.error(e); return false; }
  finally { btns.forEach(b => (b.disabled = false)); }
}
$('#go').onclick = async () => { if (await makeStoryboard()) tab('board'); };
$('#auto').onclick = async () => {
  if (!$('#script').value.trim()) return alert('Вставьте сценарий');
  if (!S.voice && !confirm('Озвучка не выбрана — видео будет без голоса. Продолжить?')) return;
  let fileHandle = false;
  if (window.showSaveFilePicker) { try { fileHandle = await window.showSaveFilePicker({ suggestedName: 'lumencut-video.mp4', types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }] }); } catch { return; } }
  log('Шаг 1/2: раскадровка…');
  if (!(await makeStoryboard())) return;
  tab('render'); await doRender(Infinity, fileHandle);
};

// storyboard
const opt = (list, v) => list.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('');
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function usedMap() { const m = new Map(); S.shots.forEach((s, i) => (s.picks || []).forEach(p => m.set(p.id, i))); return m; }
// The second graphic field of the doc look: unit, subline, list items, chart bars or highlighted words.
function subOf(o = {}) {
  if (['counter', 'stat'].includes(o.type)) return o.unit || '';
  if (['panel', 'checklist'].includes(o.type)) return (o.items || []).join(' | ');
  if (o.type === 'chart') return (o.bars || []).map(b => `${b.label}: ${b.value}`).join(' | ');
  if (o.type === 'statement') return o.highlight || '';
  return o.sub || '';
}
function setSub(o, v) {
  const parts = v.split('|').map(x => x.trim()).filter(Boolean);
  if (['counter', 'stat'].includes(o.type)) o.unit = v.trim().toUpperCase();
  else if (['panel', 'checklist'].includes(o.type)) o.items = parts;
  else if (o.type === 'chart') o.bars = parts.map(p => { const m = p.match(/^(.*?)[:=]\s*([\d.,]+)/); return m && { label: m[1].trim(), value: parseFloat(m[2].replace(/,/g, '')) }; }).filter(Boolean);
  else if (o.type === 'statement') o.highlight = v.trim();
  else o.sub = v.trim();
}
function drawBoard() {
  const used = usedMap(), doc = S.style.look === 'doc'; $('#boardInfo').textContent = `${S.shots.length} сцен · ${S.topic || ''} · клик по миниатюре внизу карточки — заменить кадр`;
  $('#board').innerHTML = S.shots.map((s, i) => `<div class="shot" data-i="${i}"><div class="media">${(s.picks || []).map(p => p.kind === 'video' ? `<video src="${esc(p.url)}#t=${(s.cuts?.find(c => c.media.id === p.id)?.from || 0).toFixed(1)}" muted preload="none" poster="${esc(p.thumb)}" onmouseenter="this.play()" onmouseleave="this.pause()"></video>` : `<img src="${esc(p.thumb)}">`).join('') || '<div class="muted">нет кадра</div>'}
   ${(s.picks || []).map(p => `<span class="badge">${p.source} · ${p.kind}${p.sim != null ? ' · смысл ' + Math.round(p.sim * 100) : ''}</span>`).join(' ')}</div>
   <div><div class="t">#${i + 1} · ${fmt(s.start)}–${fmt(s.end)} · ${(s.end - s.start).toFixed(1)} сек · кадров: ${(s.picks || []).length}</div><div class="txt">${esc(s.text)}</div>
   <div class="f"><label class="wide">Смысл / что показать (для поиска)<input data-k="visual" value="${esc(s.visual)}"></label>
   <label class="wide">Запросы через |<input data-k="queries" value="${esc((s.queries || []).join(' | '))}"></label>
   <label>Графика<select data-k="otype">${opt(doc ? DOC_OVERLAYS : OVERLAYS, (doc ? toDoc(s.overlay, i) : s.overlay)?.type || 'none')}</select></label><label>Текст графики${doc ? ' (для цифр — число)' : ''}<input data-k="otext" value="${esc(doc && ['counter', 'stat'].includes(s.overlay?.type) ? s.overlay.value ?? s.overlay.text : s.overlay?.text)}"></label>
   ${doc ? `<label class="wide" title="Цифры: что считаем (COTTAGES). Плашка, карточка, имя: строка под заголовком. Панель, чек-лист: пункты через |. Диаграмма: Orange County: 1.2 | Marin: 1. Тезис: слова, которые выделить красным.">Подпись или пункты через | (наведите мышь — подсказка)<input data-k="osub" value="${esc(subOf(s.overlay))}"></label>` : ''}
   <label>Звук<select data-k="sfx">${opt(['none', ...SFX], s.sfx || 'none')}</select></label><label>Музыка<select data-k="mood">${opt(MOODS, s.mood)}</select></label></div>
   <div class="row"><button data-act="research">Найти заново</button><button data-act="sfxplay">▶ звук</button></div>
   <div class="cands">${(s.candidates || []).map(c => `<img src="${esc(c.thumb)}" title="${esc(c.source + ': ' + c.tags)}" data-cid="${esc(c.id)}" class="${used.has(c.id) ? 'used' : ''}" loading="lazy">`).join('')}</div></div></div>`).join('');
}
$('#board').addEventListener('change', e => {
  const card = e.target.closest('.shot'); if (!card) return; const s = S.shots[card.dataset.i], k = e.target.dataset.k, v = e.target.value;
  if (k === 'visual') s.visual = v; if (k === 'queries') s.queries = v.split('|').map(x => x.trim()).filter(Boolean); if (k === 'sfx') s.sfx = v; if (k === 'mood') s.mood = v;
  if (k === 'otype' || k === 'otext') {
    s.overlay = { ...(S.style.look === 'doc' ? toDoc(s.overlay, +card.dataset.i) : s.overlay || {}), [k === 'otype' ? 'type' : 'text']: v };
    if (['number', 'counter', 'stat'].includes(s.overlay.type)) { const n = Number(String(s.overlay.text ?? s.overlay.value).replace(/[^\d.]/g, '')); if (n || k === 'otext') s.overlay.value = n || 0; }
    if (s.overlay.type === 'statement' && k === 'otype' && !s.overlay.text) s.overlay.text = s.text.split(/\s+/).slice(0, 12).join(' ');
    if (k === 'otype') drawBoard();
  }
  if (k === 'osub') setSub(s.overlay ||= { type: 'none' }, v);
  persist();
});
$('#board').addEventListener('click', async e => {
  const card = e.target.closest('.shot'); if (!card) return; const i = +card.dataset.i, s = S.shots[i];
  if (e.target.dataset.cid) {
    const c = s.candidates.find(x => x.id === e.target.dataset.cid), owner = usedMap().get(c.id);
    if (owner != null && owner !== i) return alert(`Этот кадр уже стоит в сцене #${owner + 1}. Кадры не повторяются.`);
    s.picks = s.picks?.length ? [c, ...s.picks.slice(1).filter(p => p.id !== c.id)] : [c]; planCuts(s); persist(); drawBoard();
  }
  if (e.target.dataset.act === 'sfxplay' && s.sfx !== 'none') new Audio(`sfx/${s.sfx}.mp3`).play();
  if (e.target.dataset.act === 'research') {
    e.target.disabled = true; const c = cfg(); const others = S.shots.filter((_, j) => j !== i).flatMap(x => x.picks || []);
    await gatherCandidates([s], c, 1920, m => (e.target.textContent = m)); await pickMedia([s], c, m => (e.target.textContent = m), others.flatMap(p => [p.id, p.url]), others.map(p => p.emb)); persist(); drawBoard();
  }
});

// render
async function doRender(limit, presetHandle = null) {
  if (!S.shots.length) return alert('Сначала сделайте раскадровку');
  if (!('VideoEncoder' in window)) return alert('Нужен Google Chrome или Microsoft Edge (последней версии).');
  const [W, H] = $('#res').value.split('x').map(Number); const buttons = [$('#test'), $('#full'), $('#auto')]; buttons.forEach(b => (b.disabled = true));
  $('#downloads').innerHTML = ''; const info = m => ($('#rinfo').textContent = m);
  try {
    const duration = limit < Infinity ? Math.min(limit, S.shots.at(-1).end) : S.shots.at(-1).end;
    let voice = S.voice; if (!voice) { info('Озвучка не выбрана — видео будет без голоса'); voice = new AudioBuffer({ length: Math.ceil(S.shots.at(-1).end * 48000), sampleRate: 48000, numberOfChannels: 1 }); }
    const shots = thinGraphics(S.shots, $('#gfx').value, S.style);
    const audio = await mixAudio({ voice, shots, duration: Math.max(duration, voice.duration), musicOn: $('#music').checked, musicDb: +$('#musicDb').value, sfxOn: $('#sfx').checked, level: $('#level')?.checked !== false, style: S.style, musicTrack: S.musicTrack }, info);
    let fileHandle = presetHandle || null;
    if (presetHandle == null && limit === Infinity && window.showSaveFilePicker) { try { fileHandle = await window.showSaveFilePicker({ suggestedName: 'lumencut-video.mp4', types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }] }); } catch { buttons.forEach(b => (b.disabled = false)); return; } }
    const t0 = performance.now();
    const blob = await renderVideo({ shots, audio, W, H, canvas: $('#canvas'), subtitles: $('#subs').value, style: S.style, limit, fileHandle, onProgress: (p, m) => { prog('#rprogress', p); info(m); } });
    prog('#rprogress', 1); info(`Готово за ${((performance.now() - t0) / 60000).toFixed(1)} мин.${fileHandle ? ' Файл сохранён туда, куда вы указали.' : ''}`);
    if (blob) { link(blob, limit < Infinity ? 'lumencut-test.mp4' : 'lumencut-video.mp4', 'Скачать MP4'); if (presetHandle === false) download(blob, 'lumencut-video.mp4'); }
    link(new Blob([toSrt(S.shots)], { type: 'text/plain' }), 'subtitles.srt', 'Субтитры .srt');
    const credits = [...new Map(S.shots.flatMap(s => s.picks || []).map(p => [p.id, `${p.source} — ${p.author || 'unknown'}${p.license ? ' (' + p.license + ')' : ''} — ${p.page || p.url}`])).values()].join('\n');
    link(new Blob([credits], { type: 'text/plain' }), 'credits.txt', 'Авторы кадров');
  } catch (e) { info('Ошибка рендера: ' + e.message); console.error(e); }
  buttons.forEach(b => (b.disabled = false));
}
function link(blob, name, label) { const a = document.createElement('a'); a.className = 'dl'; a.href = URL.createObjectURL(blob); a.download = name; a.textContent = label; $('#downloads').append(a); }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
$('#test').onclick = () => doRender(20);
$('#full').onclick = () => doRender(Infinity);

applyStyle(S.style, false);
try { if (saved) { Object.assign(S, { script: saved.script, shots: saved.shots || [], topic: saved.topic }); $('#script').value = S.script || ''; if (S.shots.length) drawBoard(); } } catch (e) { console.error(e); localStorage.removeItem('lumencut.project'); }
