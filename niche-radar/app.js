(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LS = { saved: 'nr:saved', liked: 'nr:liked', seen: 'nr:seen', live: 'nr:live', key: 'nr:apiKey', support: 'nr:support' };
  const loadSet = k => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } };
  const saveSet = (k, set) => localStorage.setItem(k, JSON.stringify([...set]));
  const loadArr = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const state = { tab: 'all', q: '', sort: 'rpm', all: [], saved: loadSet(LS.saved), liked: loadSet(LS.liked), seen: loadSet(LS.seen) };
  const LANG = { en: 'Английский', ru: 'Русский', es: 'Испанский', pt: 'Португальский', fr: 'Французский', de: 'Немецкий' };
  const fmt = n => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + ' млн'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.0', '') + ' тыс.'; return String(Math.round(n)); };
  const money = n => (Number(n) || 0).toFixed(2) + ' $';
  const ago = iso => { if (!iso) return ''; const d = (Date.now() - new Date(iso)) / 86400000; if (d < 1) return 'сегодня'; if (d < 7) return Math.floor(d) + ' дн.'; if (d < 45) return Math.floor(d / 7) + ' нед.'; return Math.floor(d / 30) + ' мес.'; };
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = seed => { let x = seed || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };
  const yt = (id, handle) => handle ? `https://www.youtube.com/${handle.startsWith('@') ? handle : '@' + handle.replace(/^@/, '')}` : `https://www.youtube.com/channel/${id}`;
  const vUrl = id => `https://www.youtube.com/watch?v=${id}`;
  const isNew = c => { const a = c.added_at || c.updated_at; return a && (Date.now() - new Date(a)) / 86400000 <= 7; };
  const isNew3 = c => { const a = c.added_at || c.updated_at; return a && (Date.now() - new Date(a)) / 86400000 <= 3; };
  const faceless = c => c.production_style !== 'talking_head';
  const monthly = c => c.monthly_income_est || ((c.views_per_day || 0) * 30 / 1000 * (c.rpm || 0));
  const risky = c => /politic|news|crime|horror|religion/i.test([c.niche, ...(c.tags || [])].join(' '));
  function demo(c) {
    const r = rng(hash(c.id)); const male = 0.45 + r() * 0.4;
    const ages = [0.04 + r() * 0.06, 0.18 + r() * 0.12, 0.28 + r() * 0.1, 0.22 + r() * 0.08, 0.1 + r() * 0.08];
    const s = ages.reduce((a, b) => a + b, 0);
    const countries = c.region === 'us' ? [['United States', 0.62], ['Canada', 0.12], ['United Kingdom', 0.1], ['India', 0.08], ['Australia', 0.08]] : [['United States', 0.35], ['India', 0.2], ['United Kingdom', 0.15], ['Canada', 0.15], ['Other', 0.15]];
    return { male, female: 1 - male, ages: ages.map(x => x / s), countries };
  }
  function series(c, kind) {
    const r = rng(hash(c.id + kind)); const n = 18; const out = [];
    let v = kind === 'subs' ? Math.max(2, (c.subs_per_day || 5)) : kind === 'rev' ? Math.max(1, monthly(c) / 20) : Math.max(200, (c.views_per_day || 1000));
    for (let i = 0; i < n; i++) { v = Math.max(0, v * (0.75 + r() * 0.6)); out.push(v); }
    return out;
  }
  function filtered() {
    const tag = $('#fTag').value, niche = $('#fNiche').value, sub = $('#fSub').value, cat = $('#fCat').value, lang = $('#fLang').value, format = $('#fFormat').value, style = $('#fStyle').value, diff = $('#fDiff').value, ai = $('#fAi').value, face = $('#fFace').value, mon = $('#fMon').value, days = $('#fDays').value;
    const sMin = +$('#subsMin').value, sMax = +$('#subsMax').value, vMin = +$('#viewsMin').value, vMax = +$('#viewsMax').value, aMin = +$('#avgMin').value, aMax = +$('#avgMax').value, rMin = +$('#rpmMin').value, rMax = +$('#rpmMax').value;
    const q = state.q.trim().toLowerCase();
    let list = state.all.slice();
    if (state.tab === 'new') list = list.filter(isNew);
    if (state.tab === 'saved') list = list.filter(c => state.saved.has(c.id));
    if (state.tab === 'liked') list = list.filter(c => state.liked.has(c.id));
    list = list.filter(c => {
      if (q && !`${c.title} ${c.handle} ${(c.tags || []).join(' ')}`.toLowerCase().includes(q)) return false;
      if (tag && !(c.tags || []).includes(tag)) return false;
      if (niche && c.niche !== niche && c.niche_ru !== niche) return false;
      if (sub && !(c.tags || []).includes(sub)) return false;
      if (cat && !(c.tags || []).includes(cat)) return false;
      if (lang && (c.language || '').split('-')[0] !== lang) return false;
      if (format && c.production_style !== format) return false;
      if (style && c.production_style !== style) return false;
      if (diff && c.difficulty !== diff) return false;
      if (ai === 'yes' && !c.uses_ai) return false;
      if (ai === 'no' && c.uses_ai) return false;
      if (face === 'yes' && !faceless(c)) return false;
      if (face === 'no' && faceless(c)) return false;
      if (mon === 'yes' && !c.is_monetized) return false;
      if (mon === 'no' && c.is_monetized) return false;
      if (mon === 'soon' && !['≤30 дн.', '≤90 дн.'].includes(c.monetization_forecast)) return false;
      if (days && (c.days_to_monetization || 999) > +days) return false;
      if ((c.subs || 0) < sMin || (c.subs || 0) > sMax) return false;
      if ((c.total_views || 0) < vMin || (c.total_views || 0) > vMax) return false;
      if ((c.avg_views || 0) < aMin || (c.avg_views || 0) > aMax) return false;
      if ((c.rpm || 0) < rMin || (c.rpm || 0) > rMax) return false;
      if ($('#onlyNew3').checked && !isNew3(c)) return false;
      if ($('#onlyUnseen').checked && state.seen.has(c.id)) return false;
      return true;
    });
    const sorters = { rpm: (a, b) => (b.rpm || 0) - (a.rpm || 0), new: (a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')), subs: (a, b) => (b.subs || 0) - (a.subs || 0), views: (a, b) => (b.total_views || 0) - (a.total_views || 0), score: (a, b) => (b.score || 0) - (a.score || 0), monetization: (a, b) => (a.days_to_monetization || 9e9) - (b.days_to_monetization || 9e9) };
    list.sort(sorters[state.sort] || sorters.rpm);
    return list;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  function fillSelects() {
    const uniq = key => [...new Set(state.all.flatMap(c => { const v = c[key]; return Array.isArray(v) ? v : v ? [v] : []; }))].filter(Boolean).sort();
    const fill = (id, arr, labelFn) => { const el = $(id); const cur = el.value; el.innerHTML = el.options[0].outerHTML + arr.map(v => `<option value="${esc(v)}">${esc(labelFn ? labelFn(v) : v)}</option>`).join(''); el.value = [...el.options].some(o => o.value === cur) ? cur : ''; };
    fill('#fTag', uniq('tags').slice(0, 40));
    fill('#fNiche', uniq('niche'), v => state.all.find(c => c.niche === v)?.niche_ru || v);
    fill('#fSub', uniq('tags').slice(0, 30));
    fill('#fCat', uniq('tags').slice(0, 30));
    fill('#fLang', [...new Set(uniq('language').map(l => l.split('-')[0]))], v => LANG[v] || v);
    fill('#fFormat', uniq('production_style'), v => state.all.find(c => c.production_style === v)?.style_ru || v);
    fill('#fStyle', uniq('production_style'), v => state.all.find(c => c.production_style === v)?.style_ru || v);
    const maxS = Math.max(1000, ...state.all.map(c => c.subs || 0));
    const maxV = Math.max(1000, ...state.all.map(c => c.total_views || 0));
    const maxA = Math.max(100, ...state.all.map(c => c.avg_views || 0));
    $('#subsMax').max = $('#subsMin').max = maxS; $('#viewsMax').max = $('#viewsMin').max = maxV; $('#avgMax').max = $('#avgMin').max = maxA;
    if (+$('#subsMax').value >= 200000) $('#subsMax').value = maxS;
    if (+$('#viewsMax').value >= 10000000) $('#viewsMax').value = maxV;
    if (+$('#avgMax').value >= 500000) $('#avgMax').value = maxA;
    labs();
  }
  function labs() {
    $('#subsLab').textContent = fmt($('#subsMin').value) + ' — ' + fmt($('#subsMax').value);
    $('#viewsLab').textContent = fmt($('#viewsMin').value) + ' — ' + fmt($('#viewsMax').value);
    $('#avgLab').textContent = fmt($('#avgMin').value) + ' — ' + fmt($('#avgMax').value);
    $('#rpmLab').textContent = '$' + $('#rpmMin').value + ' — $' + $('#rpmMax').value;
  }
  function card(c) {
    const vids = (c.videos || []).slice(0, 3); const tags = (c.tags || []).slice(0, 4);
    return `<article class="card" data-open="${esc(c.id)}"><div class="card-top"><img class="av" src="${esc(c.thumbnail || '')}" alt=""><div><p class="ttl">${esc(c.title)}</p><div class="handle">${esc(c.handle ? '@' + c.handle.replace(/^@/, '') : c.id)}</div></div><span class="pill pill-lang">${esc(LANG[(c.language || 'en').split('-')[0]] || c.language || 'en')}</span>${isNew(c) ? '<span class="pill pill-new">Новое</span>' : ''}</div><div class="thumbs">${vids.map(v => `<a class="thumb" href="${vUrl(v.id)}" target="_blank" rel="noopener"><img src="${esc(v.thumbnail || 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg')}" alt=""><p>${esc(v.title)}</p><small>${fmt(v.views)} просм. · ${ago(v.published_at)}</small></a>`).join('')}</div><div class="stats"><div><small>Подписчики</small><b>${fmt(c.subs)}</b></div><div><small>Просмотры</small><b>${fmt(c.total_views)}</b></div><div><small>RPM</small><b>${money(c.rpm)}</b></div></div><div class="tags">${tags.map((t, i) => `<span class="tag ${i === 1 ? 'tag-g' : i === 2 ? 'tag-p' : ''}">${esc(t)}</span>`).join('')}</div><div class="foot"><button type="button" class="icon ${state.saved.has(c.id) ? 'on' : ''}" data-save="${esc(c.id)}">🔖</button><button type="button" class="icon ${state.liked.has(c.id) ? 'on' : ''}" data-like="${esc(c.id)}">❤</button><button type="button" class="more" data-open="${esc(c.id)}">Подробнее →</button></div></article>`;
  }
  function pie(parts, colors) { let a = 0; return `<svg viewBox="0 0 36 36" width="90" height="90">` + parts.map((p, i) => { const x = a; a += p * 360; return `<circle r="16" cx="18" cy="18" fill="transparent" stroke="${colors[i]}" stroke-width="8" stroke-dasharray="${p * 100.5} 100.5" transform="rotate(${x - 90} 18 18)"></circle>`; }).join('') + '</svg>'; }
  function line(arr, color) { const max = Math.max(...arr, 1); const pts = arr.map((v, i) => `${(i / (arr.length - 1)) * 100},${28 - (v / max) * 24}`).join(' '); return `<svg class="line" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${pts}"/></svg>`; }
  function openDrawer(id) {
    const c = state.all.find(x => x.id === id); if (!c) return;
    state.seen.add(id); saveSet(LS.seen, state.seen);
    const vids = (c.videos || []).slice(0, 10);
    const comps = state.all.filter(x => x.niche === c.niche && x.id !== c.id).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 8);
    const d = demo(c); const banner = vids[0] ? `https://i.ytimg.com/vi/${vids[0].id}/hq720.jpg` : c.thumbnail;
    $('#drawerPanel').innerHTML = `<img class="banner" src="${esc(banner)}" alt=""><div class="sheet-body"><div class="sheet-head"><img class="av" src="${esc(c.thumbnail || '')}" alt=""><div><h2>${esc(c.title)}</h2><div class="handle">${esc(c.handle ? '@' + c.handle.replace(/^@/, '') : '')}</div></div><button type="button" class="close" data-close>Закрыть</button></div><div class="actions"><button type="button" class="icon ${state.liked.has(c.id) ? 'on' : ''}" data-like="${esc(c.id)}">❤</button><button type="button" class="icon ${state.saved.has(c.id) ? 'on' : ''}" data-save="${esc(c.id)}">🔖</button><a class="btn" href="${yt(c.id, c.handle)}" target="_blank" rel="noopener">YouTube</a><button type="button" class="btn" id="showComps">Конкуренты</button></div><div class="kpi"><div><small>Подписчики</small><b>${fmt(c.subs)}</b></div><div><small>Просмотры</small><b>${fmt(c.total_views)}</b></div><div><small>Видео</small><b>${c.videos_count || 0}</b></div><div><small>RPM</small><b>${money(c.rpm)}</b></div><div><small>RPM Shorts</small><b>${money((c.rpm || 0) * 0.08)}</b></div><div><small>RPM длинных</small><b>${money(c.rpm)}</b></div><div><small>Доход / мес.</small><b>${money(monthly(c))}</b></div><div><small>Аутлаеры</small><b>${(c.videos || []).filter(v => v.is_outlier).length}</b></div></div><div class="meta-grid"><div><small>Страна</small><b>${esc(c.country || '—')}</b></div><div><small>Язык</small><b>${esc(LANG[(c.language || '').split('-')[0]] || c.language || '—')}</b></div><div><small>Стиль</small><b>${esc(c.style_ru || c.production_style || '—')}</b></div><div><small>Сложность</small><b>${esc(c.difficulty_ru || '—')}</b></div><div><small>ИИ</small><b>${c.uses_ai ? 'ИИ' : 'Без ИИ'}</b></div><div><small>Монетизация</small><b>${esc(c.monetization_forecast || (c.is_monetized ? 'уже' : 'неясно'))}</b></div></div>${risky(c) ? '<div class="warn"><b>Высокие риски.</b> Ниша может чаще получать ограничения монетизации.</div>' : ''}<div class="tags">${(c.tags || []).slice(0, 6).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${c.niche_ru ? `<span class="tag tag-p">${esc(c.niche_ru)}</span>` : ''}</div><p class="muted">Обновлено: ${esc((c.updated_at || '').slice(0, 10))}</p><div class="block"><h3>Описание</h3><p>${esc(c.description || 'Нет описания.')}</p></div><div class="block"><h3>Топ видео</h3><div class="vids">${vids.map(v => `<a class="thumb" href="${vUrl(v.id)}" target="_blank" rel="noopener"><img src="${esc(v.thumbnail || 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg')}" alt=""><p>${esc(v.title)}</p><small>${fmt(v.views)}</small></a>`).join('')}</div></div><div class="block"><h3>Демография <small class="muted">оценка</small></h3><div class="charts"><div class="chart">Пол<br>${pie([d.male, d.female], ['#4aa3e8', '#e45b7a'])}<div class="muted">Муж ${Math.round(d.male * 100)}% · Жен ${Math.round(d.female * 100)}%</div></div><div class="chart">Возраст<br>${pie(d.ages, ['#8ecae6', '#219ebc', '#023047', '#ffb703', '#fb8500'])}</div><div class="chart">Страны<br>${pie(d.countries.map(x => x[1]), ['#e23b32', '#3b6dff', '#1f8a4a', '#f5a623', '#888'])}<div class="muted">${d.countries.map(x => x[0]).join(', ')}</div></div></div></div><div class="block"><h3>Динамика просмотров</h3>${line(series(c, 'views'), '#e23b32')}</div><div class="block"><h3>Прирост подписчиков</h3>${line(series(c, 'subs'), '#3b6dff')}</div><div class="block"><h3>Оценка дохода за день</h3>${line(series(c, 'rev'), '#f5a623')}</div><div class="block" id="compsBlock" hidden><h3>Конкуренты</h3><table class="comp"><thead><tr><th>Канал</th><th>Подп.</th><th>RPM</th></tr></thead><tbody>${comps.map(x => `<tr data-open="${esc(x.id)}"><td>${esc(x.title)}</td><td>${fmt(x.subs)}</td><td>${money(x.rpm)}</td></tr>`).join('') || '<tr><td colspan="3">Нет других каналов</td></tr>'}</tbody></table></div></div>`;
    $('#drawer').hidden = false;
    $('#showComps')?.addEventListener('click', () => { const b = $('#compsBlock'); b.hidden = !b.hidden; if (!b.hidden) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }
  function render() {
    const list = filtered();
    $('#resultsInfo').textContent = list.length + ' каналов';
    $('#grid').innerHTML = list.map(card).join('');
    $('#empty').hidden = list.length > 0;
    $$('#tabs .tab').forEach(b => b.classList.toggle('is-on', b.dataset.tab === state.tab));
  }
  function toggle(set, key, id) { if (set.has(id)) set.delete(id); else set.add(id); saveSet(key, set); render(); if (!$('#drawer').hidden) openDrawer(id); }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-close],[data-open],[data-save],[data-like],[data-tab],#filtersToggle,#resetFilters,#refreshBtn,#refreshRun,#liveClear,#supportBtn,#supportSend');
    if (!t) return;
    if (t.hasAttribute('data-close')) { t.closest('.overlay').hidden = true; return; }
    if (t.dataset.tab) { state.tab = t.dataset.tab; render(); return; }
    if (t.dataset.save) { e.stopPropagation(); toggle(state.saved, LS.saved, t.dataset.save); return; }
    if (t.dataset.like) { e.stopPropagation(); toggle(state.liked, LS.liked, t.dataset.like); return; }
    if (t.dataset.open) { openDrawer(t.dataset.open); return; }
    if (t.id === 'filtersToggle') { $('#filters').hidden = !$('#filters').hidden; return; }
    if (t.id === 'resetFilters') { $$('#filters select').forEach(s => { s.selectedIndex = 0; }); $('#subsMin').value = 0; $('#subsMax').value = $('#subsMax').max; $('#viewsMin').value = 0; $('#viewsMax').value = $('#viewsMax').max; $('#avgMin').value = 0; $('#avgMax').value = $('#avgMax').max; $('#rpmMin').value = 0; $('#rpmMax').value = 30; $('#onlyNew3').checked = $('#onlyUnseen').checked = false; labs(); render(); return; }
    if (t.id === 'refreshBtn') { $('#refreshModal').hidden = false; const k = localStorage.getItem(LS.key); if (k) $('#apiKey').value = k; return; }
    if (t.id === 'liveClear') { localStorage.removeItem(LS.live); location.reload(); return; }
    if (t.id === 'refreshRun') runLive();
    if (t.id === 'supportBtn') { $('#supportModal').hidden = false; return; }
    if (t.id === 'supportSend') { const text = $('#supportText').value.trim(); if (!text) return; const prev = loadArr(LS.support); prev.push({ text, at: new Date().toISOString() }); localStorage.setItem(LS.support, JSON.stringify(prev)); $('#supportOk').hidden = false; $('#supportText').value = ''; }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'search') { state.q = e.target.value; render(); }
    if (e.target.id === 'maxQueries') $('#maxQueriesVal').textContent = e.target.value;
    if (['subsMin', 'subsMax', 'viewsMin', 'viewsMax', 'avgMin', 'avgMax', 'rpmMin', 'rpmMax'].includes(e.target.id)) { if (+$('#subsMin').value > +$('#subsMax').value) $('#subsMin').value = $('#subsMax').value; labs(); render(); }
  });
  document.addEventListener('change', e => { if (e.target.id === 'sort') { state.sort = e.target.value; render(); } if (e.target.closest('#filters')) render(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.overlay').forEach(o => o.hidden = true); });
  async function runLive() {
    const key = ($('#apiKey').value || '').trim();
    if (!key) { $('#refreshLog').textContent = 'Вставь ключ YouTube Data API v3'; return; }
    if (!window.NR_LIVE) { $('#refreshLog').textContent = 'Скрипт поиска не загрузился'; return; }
    localStorage.setItem(LS.key, key); $('#refreshProgress').hidden = false;
    try {
      const res = await window.NR_LIVE.run({ key, maxQueries: +$('#maxQueries').value, niche: $('#fNiche').value, lang: $('#fLang').value }, (t, f) => { $('#refreshLog').textContent = t; $('#refreshBar').style.width = Math.round((f || 0) * 100) + '%'; });
      const prev = loadArr(LS.live); const map = new Map(prev.map(c => [c.id, c])); (res.channels || []).forEach(c => map.set(c.id, c));
      localStorage.setItem(LS.live, JSON.stringify([...map.values()]));
      $('#refreshLog').textContent = `Готово: ${res.channels.length} каналов, ${res.units} ед. квоты` + (res.stopped ? ' · ' + res.stopped : '');
      setTimeout(() => location.reload(), 700);
    } catch (err) { $('#refreshLog').textContent = err.message || String(err); }
  }
  async function boot() {
    let data = { channels: [], generated_at: null };
    try { const r = await fetch('data/channels.json', { cache: 'no-store' }); if (r.ok) data = await r.json(); } catch {}
    const live = loadArr(LS.live); const seen = new Set((data.channels || []).map(c => c.id));
    state.all = (data.channels || []).filter(c => !c.graduated).concat(live.filter(c => c && c.id && !seen.has(c.id)));
    const when = data.generated_at ? new Date(data.generated_at) : null;
    $('#generatedAt').textContent = when ? 'Обновлено ' + when.toLocaleString('ru-RU') : (live.length ? 'Найдено в браузере: ' + live.length : '');
    fillSelects(); render();
  }
  boot();
})();
