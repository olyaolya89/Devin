import { splitShots, alignTiming, estimateTiming, estimateVoiceTiming, mergeShort, heuristicPlan, geminiPlan, toSrt, thinGraphics, SFX, MOODS, OVERLAYS, DOC_OVERLAYS, toDoc } from './plan.js';
import { gatherCandidates, pickMedia, planCuts, refillShort, cutsNeeded, CUT } from './match.js';
import { STYLES, SUB_LOOKS, loadStyle, saveStyle, describeStyle } from './styles.js';
import { analyzeReference } from './reference.js';
import { limits } from './sources.js';
import { transcribe } from './ai.js';
import { mixAudio, decodeFile, to16kMono } from './audio.js';
import { renderVideo } from './render.js';
import { researchScenes } from './research.js';
import { auditProduction, creditsFor, importProduction, LIVE_TARGET, MEDIA_CONTEXTS, mediaContext, PRODUCTION_FORMAT, publicUrl, reviewPacket } from './production.js';

const $ = s => document.querySelector(s);
const S = { script: '', shots: [], topic: '', voice: null, voiceName: '', style: loadStyle(), musicTrack: null };
const files = new Map(), selectedSlots = new Map();
const previews = new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) {
    if (isIntersecting) { target.preload = 'auto'; previews.unobserve(target); }
  }
});
const isProduction = () => S.style.id === 'discovery';
const readStored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const cfg = () => readStored('lumencut.settings', {});
const plannerSettings = () => ({ ...cfg(), production: isProduction() });
let working = false;
const pipelineControls = ['go', 'auto', 'full', 'test', 'voice', 'loadProj', 'style', 'refVideo', 'loadStyle', 'mediaBundle', 'planMode', 'script'];
function setWorking(state) {
  working = state;
  for (const id of pipelineControls) $('#' + id).disabled = state;
}
const prettyPercent = value => `${Math.round(value * 100)}%`;
const resolveMedia = p => p?.file ? files.get(p.file) || '' : publicUrl(p?.url);
function bindFile(file) {
  if (files.has(file.name)) URL.revokeObjectURL(files.get(file.name));
  files.set(file.name, URL.createObjectURL(file));
}
function mediaKind(file) {
  if (/^video\//.test(file.type) || /\.(mp4|webm|m4v|mov)$/i.test(file.name)) return 'video';
  if (/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) || /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name)) return 'image';
  return '';
}
const log = m => { $('#log').textContent += `${new Date().toLocaleTimeString()}  ${m}\n`; $('#log').scrollTop = 1e9; };
const prog = (el, p) => { $(el + ' i').style.width = `${Math.round(p * 100)}%`; };
let lastMsg = ''; const status = m => { const pct = m.match(/(\d+)%$/); if (pct && +pct[1] % 25 !== 0) return; if (m !== lastMsg) { lastMsg = m; log(m); } };

document.querySelectorAll('nav button').forEach(b => b.onclick = () => tab(b.dataset.tab));
function tab(name) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + name));
  if (name !== 'board') document.querySelectorAll('#board video').forEach(video => video.pause());
}

// settings
const K = { pexels: 'k_pexels', pixabay: 'k_pixabay', gemini: 'k_gemini', model: 'k_model' };
function loadSettings() { const c = cfg(); for (const [k, id] of Object.entries(K)) if (c[k]) $('#' + id).value = c[k]; $('#k_wikimedia').checked = c.wikimedia !== false; for (const k of ['nasa', 'archive', 'loc']) $('#k_' + k).checked = c[k] !== false; $('#k_clip').checked = c.clip !== false; $('#k_video').checked = c.preferVideo !== false; keysInfo(); }
function keysInfo() { const c = cfg(); $('#keysInfo').textContent = `Pexels: ${c.pexels ? '✓' : '—'} · Pixabay: ${c.pixabay ? '✓' : '—'} · Gemini: ${c.gemini ? '✓' : '—'} (ключи хранятся только в этом браузере)`; }
$('#saveKeys').onclick = () => { const c = { planMode: cfg().planMode }; for (const [k, id] of Object.entries(K)) c[k] = $('#' + id).value.trim(); c.wikimedia = $('#k_wikimedia').checked; for (const k of ['nasa', 'archive', 'loc']) c[k] = $('#k_' + k).checked; c.clip = $('#k_clip').checked; c.preferVideo = $('#k_video').checked; localStorage.setItem('lumencut.settings', JSON.stringify(c)); keysInfo(); };
loadSettings();

// style (from a reference video, a saved file, or a built-in preset)
const REF_KEY = 'lumencut.refStyle';
const refStyle = () => { try { return JSON.parse(localStorage.getItem(REF_KEY) || 'null'); } catch { return null; } };
$('#subs').innerHTML = Object.entries(SUB_LOOKS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
function styleChoices() {
  const ref = refStyle(), list = [STYLES.discovery, STYLES.doc, STYLES.classic, ...(ref ? [ref] : [])];
  if (S.style.id !== 'ref' && !list.some(x => x.id === S.style.id)) list.push(S.style);
  $('#style').innerHTML = list.map(x => `<option value="${esc(x.id)}" ${x.id === S.style.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}
function applyStyle(st, persistIt = true) {
  if (!st?.look) st = STYLES.discovery;
  S.style = structuredClone(st); CUT.max = S.style.cut.max || 5; if (persistIt) saveStyle(S.style);
  $('#styleInfo').innerHTML = describeStyle(S.style).map(l => `<li>${esc(l)}</li>`).join('');
  $('#subs').value = S.style.subtitles in SUB_LOOKS ? S.style.subtitles : 'none';
  // a profile saved by the first version could carry -60 dB ("no music heard"): music stays on, quiet
  if (!(S.style.music.db > -50)) S.style.music.db = -26;
  $('#musicDb').value = Math.max(-30, Math.min(-8, S.style.music.db)); $('#music').checked = true; musicDbVal();
  styleChoices(); updatePlanEstimate();
}
const musicDbVal = () => ($('#musicDbVal').textContent = `${$('#musicDb').value} дБ`);
$('#musicDb').oninput = musicDbVal;
$('#style').onchange = e => { const id = e.target.value; applyStyle(id === 'ref' ? refStyle() : STYLES[id] || S.style); if (S.shots.length) drawBoard(); };
$('#refVideo').onchange = async e => {
  const f = e.target.files[0]; if (!f || working) return; const st = $('#refStatus'), settings = cfg();
  const useGemini = $('#refGemini').checked;
  if (useGemini && !settings.gemini) { st.textContent = 'Для анализа графики добавьте ключ Gemini в настройках.'; e.target.value = ''; return; }
  setWorking(true);
  try {
    st.textContent = `Открываю «${f.name}»…`;
    const prof = await analyzeReference(f, useGemini ? { key: settings.gemini, model: settings.model } : {}, (m, p) => { st.textContent = m; if (p != null) prog('#refProgress', p); });
    localStorage.setItem(REF_KEY, JSON.stringify(prof)); applyStyle(prof); prog('#refProgress', 1);
    st.textContent = `✓ Стиль снят с «${f.name}». Теперь «Сделать готовое видео» соберёт ролик в этом стиле.${prof.measured?.gemini ? ' Графика оценена по выборочным кадрам.' : ' Виды графики взяты из пресета «Документалка».'}`;
    if (S.shots.length) log('Стиль поменялся — чтобы графика и длина кадров стали как в образце, сделайте раскадровку заново.');
  } catch (err) { st.textContent = '⚠ ' + err.message; console.error(err); }
  finally { setWorking(false); e.target.value = ''; }
};
$('#saveStyleFile').onclick = () => download(new Blob([JSON.stringify(S.style, null, 1)], { type: 'application/json' }), `lumencut-style-${S.style.id}.json`);
$('#loadStyle').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const st = JSON.parse(await f.text()); if (!st.look || !st.gfx) throw new Error('это не файл стиля'); if (st.id === 'ref') localStorage.setItem(REF_KEY, JSON.stringify(st)); applyStyle(st); } catch (err) { alert('Не получилось открыть стиль: ' + err.message); } e.target.value = ''; };
$('#musicFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; $('#musicInfo').textContent = 'читаю…'; try { S.musicTrack = await decodeFile(f); $('#musicInfo').textContent = `✓ ${f.name} · ${fmt(S.musicTrack.duration)} — будет играть по кругу под всем видео (не забудьте указать автора в описании, если лицензия требует)`; } catch (err) { S.musicTrack = null; $('#musicInfo').textContent = '⚠ ' + err.message; } };

// project
const saved = readStored('lumencut.project', null);
const noEmb = (k, v) => (k === 'emb' ? undefined : v);
const projectData = () => ({
  script: S.script, shots: S.shots, topic: S.topic, style: S.style,
  boardLook: S.boardLook, boardStyle: S.boardStyle, boardVoice: S.boardVoice,
  boardVoiceFile: S.boardVoiceFile, importedPlan: S.importedPlan, boardPlanner: S.boardPlanner, boardTiming: S.boardTiming
});
const persist = () => {
  try { localStorage.setItem('lumencut.project', JSON.stringify(projectData(), noEmb)); }
  catch { log('Проект не поместился в память браузера. Скачайте JSON кнопкой «Сохранить проект».'); }
};
const voiceKey = file => [file.name, file.size, file.lastModified].join('|');
async function setVoice(file) {
  if (!file || working) return;
  const info = $('#voiceInfo');
  setWorking(true);
  info.textContent = `Читаю «${file.name}»…`;
  try {
    S.voice = await decodeFile(file); S.voiceName = file.name; S.voiceKey = voiceKey(file);
    info.textContent = `✓ ${file.name} · ${fmt(S.voice.duration)}`;
  } catch (error) {
    S.voice = null; S.voiceName = ''; S.voiceKey = '';
    info.textContent = '⚠ ' + error.message;
  } finally {
    setWorking(false);
    if (S.shots.length) drawBoard();
  }
}
$('#voice').onchange = e => setVoice(e.target.files[0]);
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files || [])].find(x => /^audio\//.test(x.type) || /\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i.test(x.name));
  if (file && !working) { tab('project'); setVoice(file); }
});
$('#saveProj').onclick = () => {
  const data = S.shots.length ? projectData() : { ...projectData(), script: $('#script').value.trim() };
  if (S.shots.length && $('#script').value.trim() !== S.script) {
    data.draftScript = $('#script').value.trim();
  }
  download(new Blob([JSON.stringify(data, noEmb, 1)], { type: 'application/json' }), 'lumencut-project.json');
};

function openProject(data, showBoard) {
  if (!data || typeof data !== 'object') throw new Error('Нужен JSON проекта или монтажного плана.');
  if (data.format === PRODUCTION_FORMAT) {
    const plan = importProduction(data);
    Object.assign(S, plan, { boardStyle: 'discovery', boardLook: 'doc', boardVoice: null, boardVoiceFile: plan.voiceFile, importedPlan: true, boardPlanner: null, boardTiming: 'imported' });
    applyStyle(STYLES.discovery);
  } else {
    if (typeof data.script !== 'string' || !Array.isArray(data.shots) ||
        data.shots.some(s => !s || typeof s.text !== 'string' || !Number.isFinite(s.start) || !Number.isFinite(s.end))) {
      throw new Error('Неверный формат проекта LumenCut.');
    }
    Object.assign(S, {
      script: data.script, shots: data.shots, topic: data.topic, boardLook: data.boardLook,
      boardStyle: data.boardStyle, boardVoice: data.boardVoice, boardVoiceFile: data.boardVoiceFile, importedPlan: data.importedPlan, boardPlanner: data.boardPlanner, boardTiming: data.boardTiming
    });
    if (data.style?.look) applyStyle(data.style);
  }
  selectedSlots.clear();
  $('#script').value = data.draftScript ?? S.script;
  updatePlanEstimate();
  updateResearch();
  drawBoard();
  if (showBoard) {
    persist();
    if (S.shots.length) tab('board');
    log('Открыт проект. Выберите исходную озвучку и прикрепите файлы, указанные в раскадровке.');
  }
}

$('#loadProj').onchange = async e => {
  const file = e.target.files[0];
  if (!file || working) return;
  setWorking(true);
  try { openProject(JSON.parse(await file.text()), true); }
  catch (error) { alert(error.message); }
  finally { setWorking(false); e.target.value = ''; }
};

function syncPlanMode() {
  const settings = cfg();
  $('#planMode').value = settings.planMode === 'codex' ? 'codex' : 'local';
  updatePlanEstimate();
}

function updatePlanEstimate() {
  const gemini = $('#planMode').value === 'gemini', hasKey = !!cfg().gemini;
  const count = Math.ceil(splitShots($('#script').value.trim()).length / 25);
  let message = $('#planMode').value === 'codex'
    ? 'Склейки по озвучке и задание для Codex. Запросов Gemini: 0.'
    : 'Локальный подбор. Запросов Gemini: 0.';
  if (gemini && !hasKey) message = 'Для смыслового плана Gemini добавьте ключ в настройках.';
  if (gemini && hasKey) {
    message = count
      ? `До ${count} ${count === 1 ? 'запроса' : 'запросов'} после запуска подбора`
      : 'Один запрос на группу до 25 сцен после запуска подбора.';
  }
  $('#planEstimate').textContent = message;
}

$('#script').addEventListener('input', () => {
  updatePlanEstimate();
  updateResearch();
});
$('#planMode').addEventListener('change', () => {
  localStorage.setItem('lumencut.settings', JSON.stringify({ ...cfg(), planMode: $('#planMode').value === 'codex' ? 'codex' : 'local' }));
  updatePlanEstimate();
});
$('#saveKeys').addEventListener('click', syncPlanMode);
syncPlanMode();

let researchScript, researchDraft = [], showAllScenes = false;
const researchSelection = new Set();

function updateResearch() {
  const script = $('#script').value.trim();
  if (script !== researchScript) {
    researchScript = script;
    researchDraft = researchScenes(script);
    researchSelection.clear();
    for (const scene of researchDraft) if (scene.reasons.length) researchSelection.add(scene.number);
  }
  const suggested = researchDraft.filter(scene => scene.reasons.length);
  $('#researchSummary').textContent = suggested.length
    ? `Подбор ключевых кадров с Codex · предложено ${suggested.length}`
    : 'Подбор ключевых кадров с Codex';
  $('#researchMore').hidden = suggested.length === researchDraft.length || !suggested.length;
  $('#researchMore').textContent = showAllScenes ? 'Показать предложенные сцены' : 'Показать все сцены';
  $('#researchDownload').disabled = !researchSelection.size;
  if (!$('#researchPanel').open) return;

  const visible = showAllScenes || !suggested.length ? researchDraft : researchDraft.filter(scene =>
    scene.reasons.length || researchSelection.has(scene.number));
  $('#researchScenes').innerHTML = visible.length ? visible.map(scene => `<label class="research-scene">
    <input type="checkbox" data-research-scene="${scene.number}" ${researchSelection.has(scene.number) ? 'checked' : ''}>
    <span><b>Сцена ${scene.number}</b> · ${esc(scene.narration)}
      ${scene.reasons.length ? `<small>${esc([...scene.reasons, ...scene.subjects].join(' · '))}</small>` : ''}
    </span></label>`).join('') : '<p class="muted">Вставьте текст сценария, чтобы выбрать сцены.</p>';
}

$('#researchPanel').addEventListener('toggle', updateResearch);
$('#researchMore').onclick = () => { showAllScenes = !showAllScenes; updateResearch(); };
$('#researchScenes').addEventListener('change', event => {
  const number = Number(event.target.dataset.researchScene);
  if (!number) return;
  if (event.target.checked) researchSelection.add(number);
  else researchSelection.delete(number);
  $('#researchDownload').disabled = !researchSelection.size;
});
$('#researchDownload').onclick = () => {
  const packet = {
    format: 'lumencut.research', version: 1,
    script: researchScript, style: S.style.name, maxCutSeconds: S.style.cut.max,
    scenes: researchDraft.filter(scene => researchSelection.has(scene.number))
  };
  const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
  download(blob, 'lumencut-codex-research.json');
};

async function makeStoryboard() {
  if (working) return false;
  setWorking(true);
  $('#log').textContent = '';
  try {
    const c = plannerSettings(), script = $('#script').value.trim(), mode = $('#planMode').value;
    if (mode === 'gemini' && !c.gemini) throw new Error('Добавьте ключ Gemini в настройках и нажмите «Сохранить».');
    let shots = splitShots(script);
    if (!shots.length) throw new Error('Вставьте текст сценария.');
    if (mode !== 'codex' && !c.pexels && !c.pixabay) log('Поиск идёт по открытым источникам. Ключи Pexels и Pixabay расширят выбор стоковых кадров.');
    log(`Сцен до синхронизации: ${shots.length}`);
    prog('#progress', 0.05);
    let timing = 'estimated';
    if (S.voice) {
      try {
        const words = await transcribe(await to16kMono(S.voice), status);
        if (!words.length) throw new Error('слова не распознаны');
        shots = alignTiming(shots, words, S.voice.duration);
        timing = 'whisper';
        log(`Тайминг по голосу: ${words.length} слов распознано`);
      } catch (error) {
        log(`Whisper: ${error.message}. Время оценено по словам, проверьте склейки на черновике.`);
        shots = estimateVoiceTiming(shots, S.voice.duration);
      }
    } else shots = estimateTiming(shots);
    const st = S.style;
    CUT.max = st.cut.max || 5;
    if (st.cut.min) shots = mergeShort(shots, st.cut.min, st.cut.max + (c.production ? 0 : 1));
    prog('#progress', 0.25);
    let plan;
    if (mode === 'gemini') {
      try { plan = await geminiPlan(c.gemini, c.model, shots, status, st); }
      catch (error) {
        throw new Error(`Смысловой план не получен (${error.message}). Проверьте доступ к Gemini в настройках или выберите локальный план.`);
      }
    } else {
      log('План строится локально. Запросов Gemini: 0.');
      plan = heuristicPlan(shots, st);
    }
    prog('#progress', 0.4);
    if (mode !== 'codex') {
      limits.onLimit = src => log(`Достигнут лимит ${src}. Продолжаю с доступными источниками.`);
      await gatherCandidates(plan.shots, c, 1920, status);
      prog('#progress', 0.7);
      await pickMedia(plan.shots, c, status);
      prog('#progress', 0.9);
      await refillShort(plan.shots, c, plan.topic, status);
    }
    prog('#progress', 1);
    const missing = plan.shots.filter(s => (s.picks?.length || 0) < cutsNeeded(s)).length;
    log(mode === 'codex' ? 'Тайминг готов. Скачайте задание в раскадровке.' :
      missing ? `Нужны дополнительные материалы для сцен: ${missing}.` : 'Для каждой сцены найден кадр.');
    Object.assign(S, {
      script, shots: plan.shots, topic: plan.topic, boardStyle: st.id, boardLook: st.look,
      boardVoice: S.voiceKey || null, boardVoiceFile: S.voiceName, importedPlan: false, boardPlanner: mode, boardTiming: timing
    });
    selectedSlots.clear();
    persist();
    drawBoard();
    return true;
  } catch (error) {
    log('Ошибка: ' + error.message);
    console.error(error);
    return false;
  } finally { setWorking(false); }
}
$('#go').onclick = async () => { if (await makeStoryboard()) tab('board'); };
$('#auto').onclick = async () => {
  if (working) return;
  const needsSemanticPlan = $('#planMode').value === 'gemini' && !S.importedPlan && S.boardPlanner !== 'gemini';
  const reuse = S.shots.length && !staleReason() && !needsSemanticPlan;
  if (!reuse && !(await makeStoryboard())) return;
  if (S.boardPlanner === 'codex' && !reuse) { tab('board'); return; }
  if (isProduction()) {
    const audit = productionAudit();
    if (audit.issues.size || audit.global.length || !reuse) {
      tab('board');
      drawBoard();
      return;
    }
    tab('render');
    await doRender(Infinity);
    return;
  }
  if (!S.voice && !confirm('Экспортировать видео без озвучки?')) return;
  tab('render');
  await doRender(Infinity, false);
};

// storyboard
const opt = (list, v) => list.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('');
const fmt = t => {
  const tenths = Math.round(t * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function usedMap() {
  const used = new Map();
  S.shots.forEach((s, i) => (s.picks || []).forEach((p, j) => {
    if (p.id) used.set(p.id, { i, j });
    if (p.file || p.url) used.set(p.file || p.url, { i, j });
  }));
  return used;
}
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
function slotFor(i) { return selectedSlots.get(i) ?? 0; }
function productionAudit() { return auditProduction(S.shots, { files, voice: S.voice, maxCut: S.style.cut.max }); }
$('#reviewDownload').onclick = () => {
  const packet = reviewPacket({
    shots: S.shots, topic: S.topic, voiceFile: S.boardVoiceFile || S.voiceName, timing: S.boardTiming || 'unknown'
  }, productionAudit());
  download(new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' }), 'lumencut-review.json');
};
function localAssets() {
  return new Map(S.shots.flatMap(s => (s.picks || []).filter(p => p.file).map(p => [p.file, p])));
}

function drawBoard() {
  previews.disconnect();
  const used = usedMap(), doc = S.style.look === 'doc';
  const audit = isProduction() && S.shots.length ? productionAudit() : null;
  $('#boardInfo').textContent = S.shots.length ? `${S.shots.length} сцен · ${fmt(S.shots.at(-1).end)}${S.topic ? ' · ' + S.topic : ''}` : 'Раскадровки ещё нет';
  $('#productionStatus').innerHTML = audit ? [
    `<p>Реальная съёмка: <b>${prettyPercent(audit.liveShare)}</b> таймлайна. Ориентир — ${prettyPercent(LIVE_TARGET)}–65%.</p>`,
    audit.liveShare < LIVE_TARGET && S.shots.at(-1).end >= 60 ? '<p class="issue">Мало движущихся кадров. Для современного материала ищите съёмку самого места, действия или результата.</p>' : '',
    `<p>Готово сцен: <b>${audit.reviewed} из ${S.shots.length}</b>.</p>`,
    S.boardTiming === 'estimated' ? '<p class="issue">Тайминг приблизительный. Сверьте склейки с озвучкой.</p>' : '',
    ...audit.global.map(m => `<p class="issue">${esc(m)}</p>`),
    !audit.issues.size && !audit.global.length ? '<p>Монтажный план готов к экспорту. Исходники будут проверены при чтении.</p>' : ''
  ].join('') : '';
  $('#reviewDownload').hidden = !S.shots.length || (!isProduction() && S.boardPlanner !== 'codex');
  $('#toRender').hidden = !S.shots.length;
  const needed = localAssets(), missing = [...needed.keys()].filter(name => !files.has(name));
  $('#mediaBundleLabel').hidden = !needed.size;
  $('#mediaBundleInfo').hidden = !needed.size;
  $('#mediaBundleInfo').textContent = missing.length ? 'Прикрепите файлы с теми же именами: ' + missing.join(', ') : 'Все файлы плана прикреплены.';
  $('#board').innerHTML = S.shots.map((s, i) => {
    const issues = audit?.issues.get(i);
    const active = slotFor(i);
    const assets = (s.picks || []).map((p, j) => {
      const url = resolveMedia(p), thumb = publicUrl(p.thumb);
      const cut = s.cuts?.[j], page = publicUrl(p.page);
      const title = p.file || p.tags || p.source || 'Кадр';
      const visual = !url ? '<p class="issue">Файл не прикреплён</p>' : p.kind === 'video'
        ? `<video src="${esc(url)}#t=${Number(cut?.from) || 0}" muted controls playsinline preload="none"${p.file ? ' data-local' : ''}${thumb ? ` poster="${esc(thumb)}"` : ''}></video>`
        : `<img src="${esc(thumb || url)}" alt="${esc(title)}" loading="lazy">`;
      return `<div class="asset-slot${j === active ? ' active' : ''}">${visual}
        <button data-act="slot" data-slot="${j}" aria-pressed="${j === active}">Кадр ${j + 1}${cut ? ' · ' + fmt(cut.t0) + '–' + fmt(cut.t1) : ''}</button>
        <div class="muted">${esc([p.source, p.author, p.license].filter(Boolean).join(' · '))}</div>
        ${isProduction() ? `<label>Что показывает кадр<select data-k="context" data-slot="${j}">
          <option value="">Укажите тип</option>${Object.entries(MEDIA_CONTEXTS).map(([key, label]) =>
            `<option value="${key}" ${mediaContext(p) === key ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>` : ''}
        ${isProduction() ? `<label>Уточнение в кадре<input data-k="caption" data-slot="${j}" maxlength="72" value="${esc(p.caption)}" placeholder="Место, дата или материал"></label>` : ''}
        ${page ? `<a href="${esc(page)}" target="_blank" rel="noopener noreferrer">Первоисточник</a>` : ''}
        ${isProduction() && p.kind === 'video' ? `<label>Начало фрагмента, с<input type="number" min="0" step="0.1" data-k="inpoint" data-slot="${j}" value="${Number(cut?.from) || 0}"></label>` : ''}
      </div>`;
    }).join('');
    const visual = esc(s.visual), type = (doc ? toDoc(s.overlay, i) : s.overlay)?.type || 'none';
    const choices = (s.candidates || []).map(c => {
      const owner = used.get(c.id) || used.get(c.url), blocked = owner && (owner.i !== i || owner.j !== active);
      const label = esc([c.source, c.tags, c.license].filter(Boolean).join(' · '));
      const thumb = publicUrl(c.thumb);
      return `<button data-cid="${esc(c.id)}" title="${label}" aria-label="${label}" ${blocked ? 'disabled' : ''}>${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : esc(c.source)}</button>`;
    }).join('');
    return `<article class="shot" data-i="${i}"><div class="media">${assets || '<div class="muted">Кадр пока не выбран</div>'}
      ${isProduction() && assets ? `<button data-act="slot" data-slot="${s.picks.length}" aria-pressed="${active === s.picks.length}">Добавить кадр</button>` : ''}
    </div><div>
      <div class="t">Сцена ${i + 1} · ${fmt(s.start)}–${fmt(s.end)}</div><div class="txt">${esc(s.text)}</div>
      ${issues ? `<ul class="issues">${issues.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      ${s.meaning && s.meaning !== s.text ? `<p class="scene-meaning"><b>Смысл реплики</b><span>${esc(s.meaning)}</span></p>` : ''}
      <div class="f">
        <label class="wide">Что показать<input data-k="visual" value="${visual}"></label>
        <label class="wide">Поисковые запросы через |<input data-k="queries" value="${esc((s.queries || []).join(' | '))}"></label>
        ${isProduction() ? `<label class="wide">Точный человек, место или событие для этой сцены<input data-k="subject" value="${esc(s.subject)}"></label>
          ${s.picks?.length ? `<label class="wide"><input data-k="reviewed" type="checkbox" ${s.reviewed ? 'checked' : ''}> Кадры и графика соответствуют озвучке, источники и права проверены</label>` : ''}` : ''}
        <label>Графика<select data-k="otype">${opt(doc ? DOC_OVERLAYS : OVERLAYS, type)}</select></label>
        <label>Текст графики<input data-k="otext" value="${esc(doc && ['counter', 'stat'].includes(type) ? s.overlay?.value ?? s.overlay?.text : s.overlay?.text)}"></label>
        ${doc ? `<label class="wide">Подпись или пункты через |<input data-k="osub" value="${esc(subOf(s.overlay))}"></label>` : ''}
        ${S.style.sfx?.soft ? '' : `<label>Звук<select data-k="sfx">${opt(['none', ...SFX], s.sfx || 'none')}</select></label>`}
        <label>Музыка<select data-k="mood">${opt(MOODS, s.mood)}</select></label>
      </div>
      <div class="row"><button data-act="research">Найти заново</button><button data-act="attach">Выбрать файл</button>
      ${!S.style.sfx?.soft && s.sfx && s.sfx !== 'none' ? '<button data-act="sfxplay">▶ звук</button>' : ''}</div>
      <div class="cands">${choices}</div>
    </div></article>`;
  }).join('');
  document.querySelectorAll('#board video[data-local]').forEach(video => previews.observe(video));
}

$('#board').addEventListener('change', e => {
  const card = e.target.closest('.shot');
  if (!card || working) return;
  const i = +card.dataset.i, s = S.shots[i], k = e.target.dataset.k, v = e.target.value;
  if (k === 'visual') { s.visual = v; s.reviewed = false; }
  if (k === 'queries') s.queries = v.split('|').map(x => x.trim()).filter(Boolean);
  if (k === 'sfx') s.sfx = v;
  if (k === 'mood') s.mood = v;
  if (k === 'subject') { s.subject = v.trim(); s.reviewed = false; }
  if (k === 'reviewed') s.reviewed = e.target.checked;
  if (['context', 'caption'].includes(k) && s.cuts?.[e.target.dataset.slot]) {
    const slot = +e.target.dataset.slot;
    const media = { ...s.cuts[slot].media, [k]: v.trim() };
    if (k === 'context') delete media.footage;
    s.cuts[slot].media = media;
    s.picks[slot] = media;
    s.reviewed = false;
  }
  if (k === 'inpoint' && s.cuts?.[e.target.dataset.slot]) {
    s.cuts[e.target.dataset.slot].from = Math.max(0, Number(v) || 0);
    s.reviewed = false;
  }
  if (k === 'otype' || k === 'otext') {
    s.reviewed = false;
    s.overlay = { ...(S.style.look === 'doc' ? toDoc(s.overlay, i) : s.overlay || {}), [k === 'otype' ? 'type' : 'text']: v };
    if (['number', 'counter', 'stat'].includes(s.overlay.type)) {
      const n = Number(String(s.overlay.text ?? s.overlay.value).replace(/[^\d.-]/g, ''));
      if (n || k === 'otext') s.overlay.value = n || 0;
    }
    if (s.overlay.type === 'statement' && k === 'otype' && !s.overlay.text) s.overlay.text = s.text.split(/\s+/).slice(0, 12).join(' ');
  }
  if (k === 'osub') { setSub(s.overlay ||= { type: 'none' }, v); s.reviewed = false; }
  persist();
  if (['subject', 'reviewed', 'inpoint', 'otype', 'context', 'caption', 'visual', 'otext', 'osub'].includes(k)) drawBoard();
});

function selectMedia(i, media) {
  const s = S.shots[i], slot = slotFor(i);
  const owner = usedMap().get(media.id) || usedMap().get(media.file || media.url);
  if (owner && (owner.i !== i || owner.j !== slot)) throw new Error(`Кадр уже используется в сцене ${owner.i + 1}.`);
  if (!s.picks) s.picks = [];
  if (slot < s.picks.length && s.cuts?.[slot]) {
    s.picks[slot] = media;
    s.cuts[slot] = { ...s.cuts[slot], media, from: media.start || 0 };
  } else {
    s.picks.push(media);
    planCuts(s);
  }
  s.reviewed = false;
  persist();
  drawBoard();
}

let attachScene;
$('#assetCancel').onclick = () => $('#assetDialog').close();
$('#assetForm').addEventListener('submit', e => {
  e.preventDefault();
  const file = $('#assetFile').files[0], kind = file && mediaKind(file);
  const author = $('#assetAuthor').value.trim(), license = $('#assetLicense').value.trim();
  const inputPage = $('#assetPage').value.trim();
  if (!kind || !author || !license || (inputPage && !publicUrl(inputPage))) {
    $('#assetError').textContent = 'Выберите фото или видео, заполните автора и лицензию. Ссылка на источник должна начинаться с https://.';
    return;
  }
  try {
    const media = { id: 'local:' + file.name, file: file.name, kind, author, license,
      page: publicUrl(inputPage), source: 'Локальный файл', context: $('#assetContext').value };
    selectMedia(attachScene, media);
    bindFile(file);
    drawBoard();
    $('#assetDialog').close();
  } catch (error) { $('#assetError').textContent = error.message; }
});
$('#mediaBundle').onchange = e => {
  const wanted = localAssets();
  for (const file of e.target.files) if (wanted.get(file.name)?.kind === mediaKind(file)) bindFile(file);
  e.target.value = '';
  drawBoard();
};

$('#board').addEventListener('click', async e => {
  const control = e.target.closest('button'), card = control?.closest('.shot');
  if (!card || working) return;
  const i = +card.dataset.i, s = S.shots[i], action = control.dataset.act;
  if (control.dataset.cid) {
    const media = s.candidates.find(x => x.id === control.dataset.cid);
    if (media) {
      try { selectMedia(i, media); }
      catch (error) { alert(error.message); }
    }
  } else if (action === 'slot') {
    selectedSlots.set(i, +control.dataset.slot);
    drawBoard();
  } else if (action === 'attach') {
    attachScene = i;
    $('#assetForm').reset();
    $('#assetError').textContent = '';
    $('#assetDialog').showModal();
  } else if (action === 'sfxplay' && SFX.includes(s.sfx)) {
    new Audio(`sfx/${s.sfx}.mp3`).play().catch(() => {});
  } else if (action === 'research') {
    if (!s.queries?.length) return alert('Введите хотя бы один поисковый запрос.');
    setWorking(true);
    control.disabled = true;
    try {
      const c = plannerSettings();
      const draft = { ...s };
      await gatherCandidates([draft], { ...c, wideSearch: true }, 1920, m => (control.textContent = m));
      const others = S.shots.filter((_, j) => j !== i).flatMap(x => x.picks || []);
      await pickMedia([draft], c, m => (control.textContent = m), others.flatMap(p => [p.id, p.url].filter(Boolean)), others.map(p => p.emb));
      s.candidates = draft.candidates;
      if (!s.picks?.length) { s.picks = draft.picks; s.cuts = draft.cuts; s.reviewed = false; }
      persist();
    } catch (error) { alert(error.message); }
    finally { setWorking(false); drawBoard(); }
  }
});

// render
// The storyboard belongs to the script, voice and style it was made from; rendering an old one gives footage and
// graphics for another text (this happened in the first test: an old storyboard under a new voiceover).
function staleReason() {
  if ($('#script').value.trim() !== S.script) return 'сценарий изменился';
  if ((S.boardStyle && S.boardStyle !== S.style.id) || (S.boardLook && S.boardLook !== S.style.look)) return 'выбран другой стиль';
  if (S.voice && S.boardVoiceFile && S.voiceName !== S.boardVoiceFile) return `выберите озвучку «${S.boardVoiceFile}» или соберите раскадровку под новый файл`;
  if (S.voice && typeof S.boardVoice === 'string' && S.boardVoice !== S.voiceKey) return 'выбран другой файл озвучки';
  if (S.voice && !S.boardVoiceFile && !S.boardVoice && S.boardStyle && !S.importedPlan) return 'раскадровка подготовлена без озвучки';
  if (S.voice && Math.abs(S.voice.duration - S.shots.at(-1).end) > (isProduction() ? 0.1 : 2)) return 'длительность озвучки изменилась';
  return '';
}

async function doRender(limit, presetHandle = null) {
  if (working) return;
  const info = message => ($('#rinfo').textContent = message);
  if (!S.shots.length) return info('Сначала подготовьте раскадровку.');
  if (!('VideoEncoder' in window) || !('AudioEncoder' in window)) return info('Для экспорта нужен актуальный Chrome или Edge с поддержкой WebCodecs.');
  const final = limit === Infinity, production = isProduction();
  const why = staleReason();
  if (why && (production || !confirm(`Причина: ${why}. Продолжить с текущей раскадровкой?`))) {
    return info(`Проверьте раскадровку перед экспортом: ${why}.`);
  }
  if (production && final) {
    const audit = productionAudit();
    if (audit.issues.size || audit.global.length) { drawBoard(); tab('board'); return; }
  }
  setWorking(true);
  try {
    let fileHandle = presetHandle;
    // Save picker needs the export button's user gesture.
    if (final && presetHandle === null && window.showSaveFilePicker) {
      try {
        fileHandle = await window.showSaveFilePicker({ suggestedName: 'lumencut-video.mp4', types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }] });
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (error.name !== 'SecurityError') throw error;
      }
    }
    for (const item of $('#downloads').querySelectorAll('a')) URL.revokeObjectURL(item.href);
    $('#downloads').replaceChildren();
    prog('#rprogress', 0);
    const [W, H] = $('#res').value.split('x').map(Number);
    const duration = Math.min(limit, S.shots.at(-1).end);
    const voice = S.voice || new AudioBuffer({ length: Math.ceil(duration * 48000), sampleRate: 48000, numberOfChannels: 1 });
    const shots = thinGraphics(S.shots.filter(s => s.start < duration), $('#gfx').value, S.style).map(s => ({
      ...s, cuts: (s.cuts || []).filter(c => c.t0 < duration).map(c => ({
        ...c, media: { ...c.media, url: resolveMedia(c.media), alt: publicUrl(c.media?.alt), thumb: publicUrl(c.media?.thumb) }
      }))
    }));
    const audio = await mixAudio({
      voice, shots, duration, musicOn: $('#music').checked, musicDb: +$('#musicDb').value,
      sfxOn: $('#sfx').checked, level: $('#level').checked, style: S.style, musicTrack: S.musicTrack
    }, info);
    const started = performance.now();
    const blob = await renderVideo({
      shots, audio, W, H, canvas: $('#canvas'), subtitles: $('#subs').value, style: S.style, limit: duration,
      strict: production && final, fileHandle, onProgress: (p, m) => { prog('#rprogress', p); info(m); }
    });
    prog('#rprogress', 1);
    info(`Готово за ${((performance.now() - started) / 1000).toFixed(0)} с.${fileHandle ? ' MP4 сохранён.' : ''}${!final ? ' В черновике могут отображаться заглушки.' : ''}`);
    if (blob) link(blob, final ? 'lumencut-video.mp4' : 'lumencut-test.mp4', 'Скачать MP4');
    const subs = shots.map(s => ({ ...s, end: Math.min(s.end, duration) }));
    link(new Blob([toSrt(subs)], { type: 'text/plain' }), 'subtitles.srt', 'Субтитры .srt');
    const credits = creditsFor(shots.map(s => ({ picks: s.cuts.map(c => c.media) })));
    link(new Blob([credits], { type: 'text/plain' }), 'credits.txt', 'Источники и авторы');
  } catch (error) {
    info('Ошибка рендера: ' + error.message);
    console.error(error);
  } finally { setWorking(false); }
}
function link(blob, name, label) { const a = document.createElement('a'); a.className = 'dl'; a.href = URL.createObjectURL(blob); a.download = name; a.textContent = label; $('#downloads').append(a); }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }
$('#test').onclick = () => doRender(20);
$('#full').onclick = () => doRender(Infinity);

$('#toRender').onclick = () => tab('render');

applyStyle(S.style, false);
updateResearch();
if (saved) {
  try { openProject(saved, false); }
  catch (error) { log(`Не удалось открыть сохранённый проект: ${error.message}`); }
}
