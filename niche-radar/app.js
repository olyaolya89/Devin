/* Niche Radar — static frontend. Data: data/channels.json (built by collector). */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LS = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem('nr:' + k)) ?? d; } catch { return d; } },
    set: (k, v) => localStorage.setItem('nr:' + k, JSON.stringify(v)),
  };
  const state = {
    channels: [], tab: 'cards', sort: 'new', q: '', filters: {}, quick: new Set(), presets: new Set(),
    saved: new Set(LS.get('saved', [])), liked: new Set(LS.get('liked', [])), seen: new Set(LS.get('seen', [])),
    notes: LS.get('notes', {}), submissions: LS.get('submissions', []), videoTab: {},
  };
  const persist = () => { LS.set('saved', [...state.saved]); LS.set('liked', [...state.liked]); LS.set('seen', [...state.seen]); LS.set('notes', state.notes); LS.set('submissions', state.submissions); };

  const fmt = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'K' : String(Math.round(n));
  const money = n => n == null ? '—' : '$' + Number(n).toFixed(n >= 10 ? 0 : 1);
  const dur = s => { if (!s) return ''; const m = Math.floor(s / 60), ss = Math.round(s % 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`; };
  const daysAgo = iso => Math.max(0, Math.round((Date.now() - new Date(iso)) / 864e5));
  const ago = iso => { if (!iso) return ''; const d = daysAgo(iso); return d === 0 ? 'сегодня' : d === 1 ? 'вчера' : d < 30 ? `${d} дн. назад` : d < 365 ? `${Math.round(d / 30)} мес. назад` : `${(d / 365).toFixed(1)} г. назад`; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LANG_RU = { en: 'Английский', ru: 'Русский', es: 'Испанский', pt: 'Португальский', de: 'Немецкий', fr: 'Французский', it: 'Итальянский', tr: 'Турецкий', pl: 'Польский', id: 'Индонезийский', hi: 'Хинди', ja: 'Японский', ko: 'Корейский', ar: 'Арабский', unknown: 'Не определён' };
  const lang = c => LANG_RU[c.language] || c.language || '—';
  const ytUrl = c => c.handle ? `https://www.youtube.com/${c.handle.startsWith('@') ? c.handle : '@' + c.handle}` : `https://www.youtube.com/channel/${c.id}`;
  const monBadge = c => c.is_monetized === true || c.monetization_forecast === 'уже' ? ['badge--green', 'Монетизирован']
    : c.monetization_forecast === '≤30 дн.' ? ['badge--green', 'Монетизация ≤ 30 дн.']
    : c.monetization_forecast === '≤90 дн.' ? ['badge--amber', 'Монетизация ≤ 90 дн.']
    : ['badge', 'Монетизация неясна'];
  const monthlyViews = c => c.monthly_views_est ?? Math.round((c.views_per_day || 0) * 30);
  const monthlyIncome = c => c.monthly_income_est ?? Math.round(monthlyViews(c) / 1000 * (c.rpm || 0) * 100) / 100;
  const REGION_LANGS = { us: ['en'], eu: ['de', 'fr', 'it', 'pl', 'es'], latam: ['es', 'pt'], ru: ['ru'], other: ['hi', 'id', 'tr', 'ar', 'ja', 'ko'] };
  const competitors = c => state.channels.filter(x => x.id !== c.id && x.niche === c.niche).sort((a, b) => b.subs - a.subs);
  const isSoon = c => c.is_monetized === true || ['уже', '≤30 дн.', '≤90 дн.'].includes(c.monetization_forecast);
  const diffColor = d => d === 'low' ? 'badge--green' : d === 'medium' ? 'badge--amber' : 'badge--red';

  /* ---------- Russian description (template; Gemini can replace later) ---------- */
  function describe(c) {
    if (c.description_ru) return c.description_ru;
    const style = (c.style_ru || 'смешанный стиль').toLowerCase();
    const niche = (c.niche_ru || c.niche || 'нише').toLowerCase();
    const ai = c.uses_ai ? 'с помощью нейросетей' : 'без нейросетей';
    const first5 = c.avg_views_first_5 ? `Первые 5 роликов собирают в среднем ${fmt(c.avg_views_first_5)} просмотров.` : '';
    const out = (c.videos || []).filter(v => v.is_outlier).length;
    const outTxt = out ? ` ${out} ${out === 1 ? 'ролик-аутлаер' : 'ролика-аутлаера'} — есть форматы, которые «выстреливают».` : '';
    return `Молодой канал в нише «${niche}»: ${c.videos_count_long || c.videos_count} длинных роликов за ${c.channel_age_days} дней, стиль — ${style}, ${ai}. ${first5}${outTxt}`;
  }
  /* Prospects: same niche in other languages/regions */
  function prospects(c) {
    if (!state.rpm) return [];
    const nicheRpm = state.rpm.niches[c.niche] || state.rpm.niches.other;
    const byLang = {};
    state.channels.filter(x => x.niche === c.niche).forEach(x => { byLang[x.language] = (byLang[x.language] || 0) + 1; });
    const rows = [];
    Object.entries(REGION_LANGS).forEach(([region, langs]) => langs.forEach(l => {
      const rpm = nicheRpm[region] ?? nicheRpm.other;
      const n = byLang[l] || 0;
      const mv = monthlyViews(c);
      const income = Math.round(mv / 1000 * rpm);
      const verdict = n === 0 && rpm >= 5 ? ['badge--green', 'Свободно, высокий RPM'] : n === 0 ? ['badge--amber', 'Свободно, низкий RPM'] : n < 3 ? ['badge--amber', `Мало конкурентов (${n})`] : ['badge--red', `Конкурентно (${n})`];
      rows.push({ lang: l, region, region_ru: state.rpm.region_ru[region], rpm, n, income, verdict, isCurrent: l === c.language });
    }));
    return rows.sort((a, b) => (a.n - b.n) || (b.rpm - a.rpm));
  }
  function howTo(c) {
    const s = c.production_style;
    const tools = {
      stickman: ['Сценарий: ChatGPT/Claude по структуре топовых роликов канала', 'Персонажи-стикманы: Canva / Stick Nodes / шаблоны After Effects', 'Озвучка: ElevenLabs или Google TTS', 'Монтаж: CapCut / DaVinci Resolve (бесплатно)'],
      '2d_animation': ['Сценарий: ChatGPT/Claude', 'Анимация: Animaker, Vyond-стиль или AI-генерация кадров + Runway', 'Озвучка: ElevenLabs', 'Монтаж: CapCut / DaVinci'],
      ai_illustrations: ['Сценарий: ChatGPT/Claude', 'Иллюстрации: Midjourney / Flux / Leonardo (единый стиль через референс)', 'Озвучка: ElevenLabs', 'Монтаж с эффектом Кена Бёрнса: CapCut'],
      ai_video: ['Сценарий: ChatGPT/Claude', 'Видео-кадры: Kling / Veo / Runway / Higgsfield', 'Озвучка: ElevenLabs', 'Монтаж: CapCut / DaVinci'],
      maps_graphics: ['Сценарий и факт-чек: ChatGPT + Wikipedia/статистика', 'Карты: Google Earth Studio, MapChart, QGIS, After Effects', 'Озвучка: ElevenLabs / своя', 'Монтаж: DaVinci Resolve'],
      stock_footage: ['Сценарий: ChatGPT/Claude', 'Футаж: Pexels / Pixabay / Storyblocks', 'Озвучка: ElevenLabs', 'Монтаж: CapCut / DaVinci'],
      screencast_slides: ['Сценарий', 'Слайды: Canva / Google Slides; запись экрана OBS', 'Озвучка: своя или TTS', 'Монтаж: CapCut'],
      talking_head: ['Нужен ведущий в кадре — сложнее повторить без лица', 'Альтернатива: тот же сценарий в формате стоковый футаж + TTS'],
    };
    return tools[s] || tools.stock_footage;
  }

  /* ---------- data ---------- */
  async function load() {
    try {
      const r = await fetch('data/channels.json', { cache: 'no-store' });
      const d = await r.json();
      state.channels = (d.channels || []).filter(c => !c.graduated);
      try { state.rpm = await (await fetch('collector/rpm_baseline.json', { cache: 'no-store' })).json(); } catch { state.rpm = null; }
      $('#generatedAt').textContent = d.generated_at ? `Обновлено ${ago(d.generated_at)} · ${state.channels.length} каналов` : `${state.channels.length} каналов`;
      mergeLive();
    } catch (e) {
      $('#generatedAt').textContent = 'data/channels.json не найден';
    }
    fillSelects(); render();
  }
  /* Live (browser-side) collection results, stored locally */
  function mergeLive() {
    const live = LS.get('live', { channels: [], at: null });
    const byId = new Map(state.channels.map(c => [c.id, c]));
    live.channels.forEach(c => { const prev = byId.get(c.id); if (prev) c.added_at = prev.added_at; byId.set(c.id, c); });
    state.channels = [...byId.values()];
    if (live.at) $('#generatedAt').textContent = `Обновлено ${ago(live.at)} · ${state.channels.length} каналов (из них ${live.channels.length} найдено кнопкой)`;
  }
  async function runLive() {
    const key = $('#apiKey').value.trim();
    if (!key) { $('#refreshLog').textContent = 'Введите ключ YouTube Data API v3.'; return; }
    LS.set('apiKey', key);
    const btn = $('#refreshRun'); btn.disabled = true; $('#refreshProgress').hidden = false;
    const log = (t, f) => { $('#refreshLog').textContent = t; if (f != null) $('#refreshBar').style.width = Math.round(f * 100) + '%'; };
    try {
      const res = await window.NR_LIVE.run({ key, niche: state.filters.niche || '', lang: state.filters.lang || '', maxQueries: +$('#maxQueries').value }, log);
      const live = LS.get('live', { channels: [], at: null });
      const byId = new Map(live.channels.map(c => [c.id, c]));
      res.channels.forEach(c => { const prev = byId.get(c.id); if (prev) c.added_at = prev.added_at; byId.set(c.id, c); });
      LS.set('live', { channels: [...byId.values()], at: new Date().toISOString() });
      mergeLive(); fillSelects(); state.tab = 'new'; state.sort = 'new'; $('#sort').value = 'new';
      $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === 'new')); render();
      log(`Готово: найдено ${res.channels.length} каналов за ${res.queries} запросов (${res.units} ед. квоты). Они показаны во вкладке «Новые за неделю».${res.stopped ? ' ' + res.stopped : ''}`, 1);
    } catch (e) {
      const enable = 'https://console.cloud.google.com/apis/library/youtube.googleapis.com';
      $('#refreshLog').innerHTML = e instanceof window.NR_LIVE.ApiDisabled
        ? `${esc(e.message.replace(/\.$/, ""))}. <a href="${enable}" target="_blank" rel="noopener">Включить YouTube Data API v3</a> в проекте ключа и повторить.`
        : `Ошибка: ${esc(e.message)}`;
    } finally { btn.disabled = false; }
  }
  function fillSelects() {
    const opt = (sel, vals) => { const s = $(sel); [...s.options].slice(1).forEach(o => o.remove()); vals.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; s.appendChild(o); }); };
    const uniq = f => [...new Map(state.channels.map(f).filter(x => x[0])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
    opt('#fNiche', uniq(c => [c.niche, c.niche_ru || c.niche]));
    opt('#fLang', uniq(c => [c.language, lang(c)]));
    opt('#fStyle', uniq(c => [c.production_style, c.style_ru || c.production_style]));
    $('#fNiche').value = state.filters.niche || ''; $('#fLang').value = state.filters.lang || ''; $('#fStyle').value = state.filters.style || '';
  }

  /* ---------- filtering ---------- */
  function filtered() {
    const f = state.filters, q = state.q.trim().toLowerCase();
    let list = state.channels.filter(c => {
      if (state.tab === 'saved' && !state.saved.has(c.id)) return false;
      if (state.tab === 'new' && daysAgo(c.added_at) > 7) return false;
      if (q) {
        const hay = [c.title, c.handle, c.niche, c.niche_ru, c.style_ru, ...(c.tags || []), ...(c.found_by_queries || []), ...(c.videos || []).map(v => v.title)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (f.niche && c.niche !== f.niche) return false;
      if (f.lang && c.language !== f.lang) return false;
      if (f.style && c.production_style !== f.style) return false;
      if (f.rpm && (c.rpm || 0) < +f.rpm) return false;
      if (f.mon === 'yes' && c.is_monetized !== true && c.monetization_forecast !== 'уже') return false;
      if (f.mon === 'soon' && !isSoon(c)) return false;
      if (f.mon === 'no' && isSoon(c)) return false;
      if (f.ai === 'yes' && !c.uses_ai) return false;
      if (f.ai === 'no' && c.uses_ai) return false;
      if (f.subs) { const [a, b] = f.subs.split('-'); if (c.subs < +a || (b && c.subs > +b)) return false; }
      if (f.videos && (c.videos_count_long || c.videos_count) > +f.videos) return false;
      if (f.age && c.channel_age_days > +f.age) return false;
      if (f.diff && c.difficulty !== f.diff) return false;
      if (state.quick.has('liked') && !state.liked.has(c.id)) return false;
      if (state.quick.has('saved') && !state.saved.has(c.id)) return false;
      if (state.quick.has('unseen') && state.seen.has(c.id)) return false;
      const p = state.presets;
      if (p.has('beginner') && !(c.difficulty === 'low' && c.solo_friendly !== false)) return false;
      if (p.has('rpm10') && (c.rpm || 0) < 10) return false;
      if (p.has('noai') && c.uses_ai) return false;
      if (p.has('ai') && !c.uses_ai) return false;
      if (p.has('small') && c.subs > 10000) return false;
      if (p.has('solo') && c.solo_friendly === false) return false;
      if (p.has('monetized') && !(c.is_monetized === true || c.monetization_forecast === 'уже')) return false;
      if (p.has('soon') && !isSoon(c)) return false;
      return true;
    });
    const MON = { 'уже': 0, '≤30 дн.': 1, '≤90 дн.': 2, 'неясно': 3 };
    const cmp = {
      new: (a, b) => new Date(b.added_at) - new Date(a.added_at) || b.score - a.score,
      score: (a, b) => b.score - a.score,
      rpm: (a, b) => (b.rpm || 0) - (a.rpm || 0),
      income: (a, b) => monthlyIncome(b) - monthlyIncome(a),
      velocity: (a, b) => (b.avg_views_first_5 || 0) - (a.avg_views_first_5 || 0),
      monetization: (a, b) => (MON[a.monetization_forecast] ?? 3) - (MON[b.monetization_forecast] ?? 3) || b.score - a.score,
    }[state.sort];
    return list.sort(cmp);
  }

  /* ---------- rendering ---------- */
  function videoList(c, mode) {
    const vs = [...(c.videos || [])];
    if (mode === 'popular') vs.sort((a, b) => b.views - a.views);
    else if (mode === 'old') vs.sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
    else vs.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    return vs;
  }
  const videoHtml = v => `<a class="video" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">
      <div class="video__thumb">${v.thumbnail ? `<img loading="lazy" src="${esc(v.thumbnail)}" alt="">` : ''}${v.is_outlier ? '<span class="video__out">АУТЛАЕР</span>' : ''}<span class="video__dur">${dur(v.duration_sec)}</span></div>
      <div class="video__title">${esc(v.title)}</div><div class="video__meta">${fmt(v.views)} просм. · ${ago(v.published_at)}</div></a>`;

  function card(c) {
    const mode = state.videoTab[c.id] || 'new';
    const vids = videoList(c, mode).slice(0, 3);
    const [mcls, mtxt] = monBadge(c);
    const rpmSrc = c.rpm_source === 'nexlev' ? 'NexLev' : 'оценка по нише';
    return `<article class="card ${state.seen.has(c.id) ? 'is-seen' : ''}" data-id="${esc(c.id)}">
      <div class="card__head">
        <img class="avatar" src="${esc(c.thumbnail || '')}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div style="min-width:0;flex:1">
          <p class="card__title">${esc(c.title)}</p>
          <div class="card__meta">${esc(c.handle || '')} · ${fmt(c.subs)} подписчиков · ${c.videos_count} видео · ${lang(c)}</div>
          <div class="card__desc">${esc(c.description || '')}</div>
        </div>
        <button class="star ${state.saved.has(c.id) ? 'is-on' : ''}" data-act="save" title="Сохранить">★</button>
      </div>
      <a class="sub" href="${ytUrl(c)}" target="_blank" rel="noopener">Подписаться</a>
      <div class="subtabs"><b>Видео</b><span>${c.videos_count_long || c.videos_count} длинных</span><span>${fmt(c.total_views)} просмотров</span></div>
      <div class="vtabs">${[['new', 'Новые'], ['popular', 'Популярные'], ['old', 'Старые']].map(([k, l]) => `<button class="vtab ${mode === k ? 'is-active' : ''}" data-act="vtab" data-mode="${k}">${l}</button>`).join('')}</div>
      <div class="videos">${vids.map(videoHtml).join('') || '<span class="muted">Нет длинных видео</span>'}</div>
      <h2 class="card__name">${esc(c.niche_ru || c.niche)}</h2>
      <div class="tags"><span class="chip chip--tag is-style">${esc(c.style_ru || c.production_style)}</span><span class="chip chip--tag">${c.uses_ai ? 'С нейросетями' : 'Без нейросетей'}</span>${(c.tags || []).slice(0, 2).map(t => `<span class="chip chip--tag">${esc(t)}</span>`).join('')}</div>
      <p class="card__text">${esc(describe(c))}</p>
      <div class="rpm">
        <div><div class="rpm__label">Ставка RPM · ${rpmSrc}</div><div class="rpm__val">${money(c.rpm)} <small>за 1000 просм. · ${esc(c.region_ru || '')}</small></div></div>
        <div class="rpm__right"><div class="rpm__label">Первые 5 роликов</div><b>${fmt(c.avg_views_first_5)}</b> <span class="muted">просм./ролик</span></div>
      </div>
      <div class="rpm rpm--income">
        <div><div class="rpm__label">Доход в месяц ${c.is_monetized ? '(монетизация подключена)' : '(если подключить монетизацию)'}</div><div class="rpm__val">~${money(monthlyIncome(c))}<small>/мес. · ${fmt(monthlyViews(c))} просм./мес.${c.monthly_revenue_nexlev ? ` · NexLev: ${money(c.monthly_revenue_nexlev)}` : ''}</small></div></div>
        <div class="rpm__right"><div class="rpm__label">Конкуренты в нише</div><b>${competitors(c).length}</b> <span class="muted">каналов</span></div>
      </div>
      <div class="badges">
        <span class="badge ${mcls}">${mtxt}</span>
        <span class="badge ${diffColor(c.difficulty)}">Сложность: ${esc(c.difficulty_ru || c.difficulty)}</span>
        <span class="badge badge--blue">Score ${c.score}</span>
        <span class="badge">${c.channel_age_days} дн. каналу</span>
      </div>
      <div class="added ${daysAgo(c.added_at) === 0 ? 'is-today' : ''}">Добавлено ${ago(c.added_at)}${c.live ? ' · найдено кнопкой' : ''}${c.stale ? ' · не найден в последнем сборе' : ''}</div>
      <div class="card__actions">
        <button class="btn btn--primary btn--sm" data-act="open">Разбор канала</button>
        <button class="btn btn--sm" data-act="curator">Куратор</button>
        <a class="btn btn--sm btn--yt" href="${ytUrl(c)}" target="_blank" rel="noopener">▶ YouTube</a>
        <button class="like btn--sm ${state.liked.has(c.id) ? 'is-on' : ''}" data-act="like">❤</button>
      </div>
    </article>`;
  }

  function nichesTable(list) {
    const groups = {};
    list.forEach(c => { const g = groups[c.niche] ||= { name: c.niche_ru || c.niche, niche: c.niche, n: 0, rpm: [], score: [], v5: [], mon: 0, ai: 0 }; g.n++; if (c.rpm) g.rpm.push(c.rpm); g.score.push(c.score); if (c.avg_views_first_5) g.v5.push(c.avg_views_first_5); if (isSoon(c)) g.mon++; if (c.uses_ai) g.ai++; });
    const med = a => a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
    const rows = Object.values(groups).sort((a, b) => med(b.score) - med(a.score)).map(g => `<tr data-niche="${esc(g.niche)}"><td><b>${esc(g.name)}</b></td><td>${g.n}</td><td>${money(med(g.rpm))}</td><td>${fmt(med(g.v5))}</td><td>${g.mon}/${g.n}</td><td>${g.ai}/${g.n}</td><td><span class="badge badge--blue">${med(g.score) ?? '—'}</span></td></tr>`).join('');
    return `<div class="niches"><table><thead><tr><th>Ниша</th><th>Молодых каналов</th><th>Медиана RPM</th><th>Медиана просм. первых 5</th><th>Монетизация / прогноз</th><th>С ИИ</th><th>Score</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Нет данных</td></tr>'}</tbody></table></div>`;
  }

  function render() {
    const list = filtered();
    const grid = $('#grid');
    $('#savedCount').textContent = state.saved.size; $('#savedTabCount').textContent = state.saved.size;
    $('#resultsInfo').textContent = `${list.length} из ${state.channels.length} каналов`;
    if (state.tab === 'niches') { grid.innerHTML = nichesTable(list); $('#empty').hidden = true; return; }
    grid.innerHTML = list.map(card).join('');
    $('#empty').hidden = list.length > 0;
  }

  /* ---------- detail drawer ---------- */
  function openDetail(c) {
    state.seen.add(c.id); persist();
    const vids = videoList(c, 'popular');
    const max = Math.max(1, ...vids.map(v => v.views));
    const chrono = videoList(c, 'old');
    const [mcls, mtxt] = monBadge(c);
    const prop = (k, v) => `<div class="prop"><div class="prop__k">${k}</div><div class="prop__v">${v}</div></div>`;
    $('#drawerPanel').innerHTML = `
      <button class="close" data-close>✕ Закрыть</button>
      <div class="card__head"><img class="avatar" src="${esc(c.thumbnail || '')}" alt=""><div><p class="card__title">${esc(c.title)}</p><div class="card__meta">${esc(c.handle || '')} · ${fmt(c.subs)} подписчиков · ${c.videos_count} видео</div></div></div>
      <div class="d-videos">${vids.slice(0, 3).map(videoHtml).join('')}</div>
      <div class="d-actions">
        <a class="btn btn--primary" href="${ytUrl(c)}" target="_blank" rel="noopener">▶ Открыть канал</a>
        <button class="btn ${state.saved.has(c.id) ? 'is-on' : ''}" data-act="save" data-id="${esc(c.id)}">${state.saved.has(c.id) ? '★ Сохранено' : '☆ Сохранить'}</button>
        <button class="btn" data-act="curator" data-id="${esc(c.id)}">Спросить куратора</button>
        <a class="btn" href="https://www.youtube.com/results?search_query=${encodeURIComponent((c.found_by_queries || [])[0] || c.title)}" target="_blank" rel="noopener">Похожие на YouTube</a>
      </div>
      <h1 class="d-title">${esc(c.niche_ru || c.niche)}</h1>
      <p class="d-sub">${esc(describe(c))}</p>
      <div class="props">
        ${prop('Ставка RPM', `<b class="big">${money(c.rpm)}</b> <span class="muted">за 1000 просмотров · ${c.rpm_source === 'nexlev' ? 'данные NexLev' : 'оценка по нише и региону'} · ${esc(c.region_ru || '')}</span>`)}
        ${prop('Монетизация', `<span class="badge ${mcls}">${mtxt}</span> ${c.days_to_monetization != null ? `<span class="muted">· оценка ~${c.days_to_monetization} дн. до 1000 подп. и 4000 часов</span>` : ''}`)}
        ${prop('Просмотры первых 5 роликов', `<b>${fmt(c.avg_views_first_5)}</b> <span class="muted">в среднем на ролик</span>`)}
        ${prop('Средние / медианные просмотры', `<b>${fmt(c.avg_views)}</b> / <b>${fmt(c.median_views)}</b>`)}
        ${prop('Скорость роста', `${fmt(c.views_per_day)} просм./день · ${fmt(c.subs_per_day)} подп./день · ~${fmt(c.watch_hours_est)} часов просмотра`)}
        ${prop('Возраст канала', `${c.channel_age_days} дней · первый ролик ${ago(c.first_video_at)}`)}
        ${prop('Стиль производства', `<span class="chip chip--tag is-style">${esc(c.style_ru || c.production_style)}</span> ${c.uses_ai ? '<span class="chip chip--tag">С нейросетями</span>' : '<span class="chip chip--tag">Без нейросетей</span>'} <span class="chip chip--tag">${c.style_group === 'ai' ? 'Группа: ИИ' : c.style_group === 'live' ? 'Группа: живые видео' : 'Группа: с лицом'}</span>`)}
        ${prop('Сложность повторения', `<span class="badge ${diffColor(c.difficulty)}">${esc(c.difficulty_ru || c.difficulty)}</span> ${c.solo_friendly === false ? '<span class="muted">· нужна команда</span>' : '<span class="muted">· можно делать одному</span>'}`)}
        ${prop('Язык / страна', `${lang(c)} · ${esc(c.country || '—')}`)}
        ${prop('Score', `<b class="big">${c.score}</b> <span class="muted">/ 100</span>`)}
        ${prop('Найден по запросам', (c.found_by_queries || []).map(q => `<span class="chip chip--tag">${esc(q)}</span>`).join(' ') || '—')}
      </div>
      <div class="section"><h3>Доход</h3>
        <div class="kv">
          <div><small>Просмотров в месяц</small><b>${fmt(monthlyViews(c))}</b></div>
          <div><small>RPM</small><b>${money(c.rpm)}</b></div>
          <div><small>Оценка дохода/мес.</small><b>~${money(monthlyIncome(c))}</b></div>
          <div><small>Год при том же темпе</small><b>~${money(monthlyIncome(c) * 12)}</b></div>
          ${c.monthly_revenue_nexlev != null ? `<div><small>Оценка NexLev/мес.</small><b>${money(c.monthly_revenue_nexlev)}</b></div>` : ''}
        </div>
        <p class="muted" style="margin:8px 0 0;font-size:12px">${c.is_monetized ? 'Монетизация подключена — доход реальный по ставке RPM.' : 'Монетизация не подключена: столько канал получал бы при текущих просмотрах и RPM ниши.'}</p></div>
      <div class="section"><h3>Конкуренты в нише «${esc(c.niche_ru || c.niche)}» (${competitors(c).length})</h3>
        ${competitors(c).length ? `<div class="comp"><table><thead><tr><th>Канал</th><th>Подп.</th><th>Видео</th><th>Просм. всего</th><th>Ср. просм.</th><th>RPM</th><th>Язык</th><th>Монетиз.</th><th>Score</th></tr></thead><tbody>${competitors(c).map(x => `<tr><td><a href="${ytUrl(x)}" target="_blank" rel="noopener"><img class="avatar avatar--xs" src="${esc(x.thumbnail || '')}" alt="">${esc(x.title)}</a> <button class="chip" data-act="open" data-id="${esc(x.id)}">разбор</button></td><td>${fmt(x.subs)}</td><td>${x.videos_count}</td><td>${fmt(x.total_views)}</td><td>${fmt(x.avg_views)}</td><td>${money(x.rpm)}</td><td>${lang(x)}</td><td>${isSoon(x) ? '<span class="badge badge--green">да/скоро</span>' : '<span class="badge">нет</span>'}</td><td><span class="badge badge--blue">${x.score}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">В базе других молодых каналов этой ниши нет — ниша свободна.</p>'}
        <p style="margin:10px 0 0"><a class="btn btn--sm" href="https://www.youtube.com/results?search_query=${encodeURIComponent((c.found_by_queries || [])[0]?.replace(/^nexlev: /, '') || c.niche_ru || c.title)}&sp=EgIQAg%253D%253D" target="_blank" rel="noopener">Все каналы по запросу на YouTube</a></p></div>
      <div class="section"><h3>Перспективы: повторить нишу на другом языке</h3>
        ${prospects(c).length ? `<div class="comp"><table><thead><tr><th>Язык</th><th>Регион</th><th>RPM ниши</th><th>Конкурентов в базе</th><th>Доход при ${fmt(monthlyViews(c))} просм./мес.</th><th>Вердикт</th></tr></thead><tbody>${prospects(c).map(p => `<tr class="${p.isCurrent ? 'is-current' : ''}"><td><b>${LANG_RU[p.lang] || p.lang}</b>${p.isCurrent ? ' <span class="muted">(этот канал)</span>' : ''}</td><td>${esc(p.region_ru)}</td><td>${money(p.rpm)}</td><td>${p.n}</td><td>~${money(p.income)}/мес.</td><td><span class="badge ${p.verdict[0]}">${p.verdict[1]}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Таблица RPM не загрузилась.</p>'}
        <p class="muted" style="margin:8px 0 0;font-size:12px">RPM берётся из таблицы ниша × регион; конкуренты — молодые каналы этой ниши в нашей базе на данном языке. «Свободно + высокий RPM» — лучший кандидат для клона с переводом сценариев.</p></div>
      <div class="section"><h3>Просмотры по роликам (хронологически)</h3>
        <div class="bars">${chrono.map(v => `<div class="bar ${v.is_outlier ? 'is-out' : ''}" style="height:${Math.max(2, v.views / max * 100)}%" data-tip="${esc(v.title.slice(0, 50))} — ${fmt(v.views)}"></div>`).join('')}</div>
        <p class="muted" style="margin:8px 0 0;font-size:12px">Красные — ролики-аутлаеры (значительно выше медианы канала). Наведи на столбик.</p></div>
      <div class="section"><h3>Все длинные ролики</h3><div class="d-videos">${videoList(c, 'new').map(videoHtml).join('')}</div></div>
      <div class="section howto"><h3>Как повторить формат</h3><ol>${howTo(c).map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>
      <div class="section"><h3>Мои заметки</h3><textarea class="note" data-note="${esc(c.id)}" placeholder="Идеи, что взять из этого канала…">${esc(state.notes[c.id] || '')}</textarea></div>
      <div class="section" id="curatorBox" hidden><h3>Куратор</h3><div id="curatorText"></div></div>`;
    $('#drawer').hidden = false; document.body.style.overflow = 'hidden';
  }
  function closeDrawer() { $('#drawer').hidden = true; $('#submitModal').hidden = true; document.body.style.overflow = ''; render(); }

  /* Curator: rule-based answer until Gemini is connected */
  function curator(c) {
    const lines = [];
    const v5 = c.avg_views_first_5 || 0;
    lines.push(v5 > 50000 ? 'Ранние ролики набирают десятки тысяч просмотров — тема сама «тянет» новые каналы, YouTube активно тестирует такой контент.' : v5 > 5000 ? 'Ранние ролики стабильно набирают тысячи просмотров — ниша живая, но потребуется 10–20 роликов, чтобы выйти на монетизацию.' : 'Ранние просмотры скромные: смотри на ролики-аутлаеры — именно такие темы стоит повторять.');
    lines.push((c.rpm || 0) >= 10 ? `RPM ~${money(c.rpm)} — высокий; даже 100K просмотров в месяц дают ~$${Math.round(c.rpm * 100)}.` : (c.rpm || 0) >= 5 ? `RPM ~${money(c.rpm)} — средний; ставка на объём просмотров.` : `RPM ~${money(c.rpm)} — низкий; окупится только массовыми просмотрами или переводом на англоязычную аудиторию.`);
    lines.push(c.difficulty === 'low' ? `Формат «${c.style_ru}» повторяется одним человеком за 1–2 дня на ролик.` : c.difficulty === 'medium' ? `Формат «${c.style_ru}» требует 2–4 дня на ролик или помощника.` : `Формат «${c.style_ru}» сложно повторить — ищи упрощённый аналог (стоковый футаж + TTS).`);
    const outs = (c.videos || []).filter(v => v.is_outlier).sort((a, b) => b.views - a.views).slice(0, 2);
    if (outs.length) lines.push('Начни с тем, похожих на аутлаеры: ' + outs.map(v => `«${v.title}» (${fmt(v.views)})`).join(', ') + '.');
    lines.push(`Вердикт: ${c.score >= 70 ? 'сильный кандидат, заходить сейчас.' : c.score >= 50 ? 'перспективно, но проверь 2–3 похожих канала.' : 'скорее наблюдать, чем копировать.'}`);
    lines.push('<span class="muted">Ответ сформирован по правилам; после подключения Gemini здесь будет полноценный анализ транскриптов и роликов.</span>');
    if ($('#drawer').hidden) openDetail(c);
    $('#curatorBox').hidden = false; $('#curatorText').innerHTML = lines.map(l => `<p>${l}</p>`).join('');
    $('#curatorBox').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- submissions ---------- */
  function renderSubmissions() {
    $('#submitList').innerHTML = state.submissions.map((s, i) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a> ${s.note ? '— ' + esc(s.note) : ''} <span class="muted">(${ago(s.at)})</span> <button class="chip" data-del-sub="${i}">удалить</button></li>`).join('');
  }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tab],[data-quick],[data-preset],[data-act],[data-close],[data-niche],[data-del-sub],#filtersToggle,#resetFilters,#submitBtn,#submitSave,#refreshBtn,#refreshRun,#liveClear');
    if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; $$('.tab').forEach(b => b.classList.toggle('is-active', b === t)); render(); }
    else if (t.dataset.quick) { t.classList.toggle('is-active'); state.quick.has(t.dataset.quick) ? state.quick.delete(t.dataset.quick) : state.quick.add(t.dataset.quick); render(); }
    else if (t.dataset.preset) { t.classList.toggle('is-active'); state.presets.has(t.dataset.preset) ? state.presets.delete(t.dataset.preset) : state.presets.add(t.dataset.preset); render(); }
    else if (t.id === 'filtersToggle') { $('#filters').hidden = !$('#filters').hidden; }
    else if (t.id === 'resetFilters') { state.filters = {}; $$('#filters select').forEach(s => s.selectedIndex = 0); render(); }
    else if (t.id === 'submitBtn') { renderSubmissions(); $('#submitModal').hidden = false; }
    else if (t.id === 'refreshBtn') { $('#apiKey').value = LS.get('apiKey', ''); $('#refreshLog').textContent = ''; $('#refreshBar').style.width = '0'; $('#refreshProgress').hidden = true; $('#refreshModal').hidden = false; }
    else if (t.id === 'refreshRun') runLive();
    else if (t.id === 'liveClear') { localStorage.removeItem('nr:live'); load(); $('#refreshLog').textContent = 'Найденные кнопкой каналы убраны.'; }
    else if (t.id === 'submitSave') { const url = $('#submitUrl').value.trim(); if (!url) return; state.submissions.unshift({ url, note: $('#submitNote').value.trim(), at: new Date().toISOString() }); persist(); $('#submitUrl').value = ''; $('#submitNote').value = ''; renderSubmissions(); }
    else if (t.dataset.delSub != null) { state.submissions.splice(+t.dataset.delSub, 1); persist(); renderSubmissions(); }
    else if (t.hasAttribute('data-close')) closeDrawer();
    else if (t.dataset.niche) { state.tab = 'cards'; $$('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === 'cards')); state.filters.niche = t.dataset.niche; $('#fNiche').value = t.dataset.niche; render(); }
    else if (t.dataset.act) {
      const id = t.dataset.id || t.closest('.card')?.dataset.id; const c = state.channels.find(x => x.id === id); if (!c) return;
      const act = t.dataset.act;
      if (act === 'open' && !$('#drawer').hidden) { $('#drawerPanel').scrollTop = 0; }
      if (act === 'save') { state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id); persist(); if ($('#drawer').hidden) render(); else openDetail(c); }
      else if (act === 'like') { state.liked.has(id) ? state.liked.delete(id) : state.liked.add(id); persist(); render(); }
      else if (act === 'vtab') { state.videoTab[id] = t.dataset.mode; render(); }
      else if (act === 'open') openDetail(c);
      else if (act === 'curator') curator(c);
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'search') { state.q = e.target.value; render(); }
    if (e.target.dataset.note != null) { state.notes[e.target.dataset.note] = e.target.value; persist(); }
    if (e.target.id === 'maxQueries') $('#maxQueriesVal').textContent = e.target.value;
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'sort') { state.sort = e.target.value; render(); }
    if (e.target.closest('#filters')) {
      const map = { fNiche: 'niche', fLang: 'lang', fStyle: 'style', fRpm: 'rpm', fMon: 'mon', fAi: 'ai', fSubs: 'subs', fVideos: 'videos', fAge: 'age', fDiff: 'diff' };
      const k = map[e.target.id]; if (k) { state.filters[k] = e.target.value; render(); }
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  load();
})();
