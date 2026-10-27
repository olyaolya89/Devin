(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LS = { saved: 'nr:saved', liked: 'nr:liked', seen: 'nr:seen', live: 'nr:live', key: 'nr:apiKey', support: 'nr:support', labels: 'nr:labels' };
  const loadSet = k => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } };
  const saveSet = (k, set) => localStorage.setItem(k, JSON.stringify([...set]));
  const loadArr = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const state = { tab: 'all', q: '', sort: 'rpm', all: [], saved: loadSet(LS.saved), liked: loadSet(LS.liked), seen: loadSet(LS.seen), clusters: {}, rpm: null, labels: (() => { try { return JSON.parse(localStorage.getItem('nr:labels') || '{}'); } catch { return {}; } })() };
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
  const monthlyViews = c => c.monthly_views_est ?? Math.round((c.views_per_day || 0) * 30);
  const REGION_LANGS = { us: ['en'], eu: ['de', 'fr', 'it', 'pl', 'es'], latam: ['es', 'pt'], ru: ['ru'], other: ['hi', 'id', 'tr', 'ar', 'ja', 'ko'] };
  const LANG_ALL = { ...{ it: 'Итальянский', pl: 'Польский', hi: 'Хинди', id: 'Индонезийский', tr: 'Турецкий', ar: 'Арабский', ja: 'Японский', ko: 'Корейский' } };
  const langName = l => LANG[(l || '').split('-')[0]] || LANG_ALL[(l || '').split('-')[0]] || l || '—';
  const VERDICT_CLASS = { open: 'badge-green', filling: 'badge-amber', crowded: 'badge-red', unproven: 'badge-grey' };
  const VERDICT_HINT = { open: 'Мало новичков, и они растут — хороший момент зайти.', filling: 'Ниша растёт, но новички уже идут — заходить быстро и с сильным отличием.', crowded: 'Новичков много — без явного отличия выделиться сложно.', unproven: 'Новички пока мало набирают — спрос не доказан.' };
  const clusterOf = c => state.clusters[c.cluster] || null;
  function prospects(c) {
    if (!state.rpm) return [];
    const nicheRpm = state.rpm.niches[c.niche] || state.rpm.niches.other;
    const byLang = {};
    state.all.filter(x => x.niche === c.niche).forEach(x => { const l = (x.language || '').split('-')[0]; byLang[l] = (byLang[l] || 0) + 1; });
    const rows = [];
    Object.entries(REGION_LANGS).forEach(([region, langs]) => langs.forEach(l => {
      const rpm = nicheRpm[region] ?? nicheRpm.other; const n = byLang[l] || 0;
      const income = Math.round(monthlyViews(c) / 1000 * rpm);
      const verdict = n === 0 && rpm >= 5 ? ['badge-green', 'Свободно, высокий RPM'] : n === 0 ? ['badge-amber', 'Свободно, низкий RPM'] : n < 3 ? ['badge-amber', `Мало конкурентов (${n})`] : ['badge-red', `Конкурентно (${n})`];
      rows.push({ l, region, region_ru: (state.rpm.region_ru || {})[region] || region, rpm, n, income, verdict, cur: l === (c.language || '').split('-')[0] });
    }));
    return rows.sort((a, b) => (a.n - b.n) || (b.rpm - a.rpm));
  }
  function nichesTable() {
    const styleNames = { live: 'Живое видео', ai: 'ИИ' };
    const rows = Object.entries(state.clusters).sort(([, a], [, b]) => (b.entry_score || 0) - (a.entry_score || 0)).map(([key, g]) => {
      const label = state.labels[key] || g.label;
      const [niche, sg, language] = key.split('|');
      return `<tr><td><b>${esc(g.niche_ru || niche)}</b></td><td>${esc(styleNames[sg] || sg || '—')}</td><td>${esc(langName(language))}</td><td>${g.n}</td><td>${Math.round((g.share_growing || 0) * 100)}%</td><td>${fmt(g.median_vpv)}</td><td>${g.newcomers_30d}</td><td>${money(g.median_rpm)}</td><td><span class="badge badge-blue">${g.entry_score ?? '—'}</span></td><td><span class="badge ${VERDICT_CLASS[g.verdict] || ''}" title="${esc(VERDICT_HINT[g.verdict] || '')}">${esc(g.verdict_ru || g.verdict || '—')}</span></td><td class="nowrap"><button type="button" class="icon ${label === 'good' ? 'on' : ''}" data-label="${esc(key)}" data-val="good" title="Хорошая ниша">👍</button> <button type="button" class="icon ${label === 'bad' ? 'on' : ''}" data-label="${esc(key)}" data-val="bad" title="Плохая ниша">👎</button></td><td><button type="button" class="more" data-niche-open="${esc(niche)}" data-niche-lang="${esc(language)}">Каналы →</button></td></tr>`;
    }).join('');
    return `<div class="block"><div class="niches-head"><h3>Ниши: где проще зайти новичку</h3><button type="button" class="btn" id="exportLabels">Экспорт разметки</button></div><p class="muted">Каналы сгруппированы по нише, формату и языку. Оценка входа 0–100: чем выше, тем больше доля растущих новичков, выше просмотры и меньше конкуренция. Наведи на вердикт — будет подсказка. 👍/👎 — твоя разметка, она сохраняется в браузере; «Экспорт разметки» скачает файл для обучения сборщика.</p><div class="table-wrap"><table class="comp niches-t"><thead><tr><th>Ниша</th><th>Формат</th><th>Язык</th><th>Каналов</th><th>Растут</th><th>Медиана просм./видео</th><th>Новых за 30 дн.</th><th>Медиана RPM</th><th>Оценка входа</th><th>Вердикт</th><th>Разметка</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="12" class="muted">Нет данных</td></tr>'}</tbody></table></div></div>`;
  }
  function exportLabels() {
    const niches = Object.entries(state.labels).map(([cluster, label]) => { const [niche, style_group, language] = cluster.split('|'); return { niche, style_group, language, label }; });
    const blob = new Blob([JSON.stringify({ version: 1, niches }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'labels_export.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const SUBNICHES = [
    ['Истории «Что если» со стикменами', /what if|what would happen|что если|qué pasaría|e se /i],
    ['Военная история и снаряжение', /\b(war|wwii|ww2|ww1|military|army|soldier|marines?|battle|tank|weapon|navy|pows?|guerra|soldados|krieg|ambush)/i],
    ['Дикий Запад и фронтир', /wild west|cowboy|frontier|saloon|western|outlaw/i],
    ['Смерти и трагедии знаменитостей', /tragic|tragedy|celebrit|hollywood|actor|actress|death of|schizophren/i],
    ['Вулканы и землетрясения', /volcan|earthquake|tecton|eruption|sinkhole|ground (opened|split)|terremoto/i],
    ['Мегамашины и гигантские конструкции', /biggest|largest|giant|mega ?machine|ship|machines?|cruise|excavator|barco/i],
    ['Инженерные провалы и мегапроекты', /invent|megaproject|engineer|built a|new .*(plane|car|battery|material)|erfind|invento|megaprojekt|cement|steel/i],
    ['Инфраструктура и стратегическая география', /infrastructure|canal|dam|bridge|aqueduct|railway|geograph|map|why (so few|nobody) .*live|state makes no sense|acueducto|infraestructura/i],
    ['Переезд за границу', /relocat|move to|moving to|abroad|expat|living in|retire in|vivir en/i],
    ['Пожилые люди и подготовка к старости', /senior|retire|over 6\d|elderly|social security|medicare|pension|jubilad|aposentad|después de los 60/i],
    ['Экономная жизнь и минимализм', /frugal|cheap|budget|save money|minimal|dirt cheap|barat|económic|ahorr/i],
    ['Питание и здоровье', /health|food|nutrition|vitamin|diet|body|eat|salud|cuerpo|comer/i],
    ['Ностальгия', /nostalg|retro|195\d|196\d|197\d|198\d|forgotten|old days|olvidad|antes/i],
    ['Монеты и коллекционирование', /coin|collect|antique|rare|worth|penny|stamp/i],
    ['Библейские истории и вера', /bible|biblical|jesus|god|church|prayer|faith|christ/i],
    ['Животные и дикая природа', /animal|wildlife|dog|cat|bird|shark|snake|predator|zoo/i],
    ['Космос и физика', /space|physics|universe|planet|light|quantum|galaxy|star/i],
    ['Личные финансы', /money|financ|invest|tax|income|wealth|dinero|negocio/i],
    ['История цивилизаций', /history|ancient|empire|civilization|historia|geschichte|história|méxico/i],
  ];
  const textOf = c => [...(c.tags || []), c.title, ...(c.videos || []).map(v => v.title)].join(' ');
  const subniche = c => { if (c.subniche_ru) return c.subniche_ru; const t = textOf(c); const hits = SUBNICHES.filter(([, re]) => re.test(t)).map(([n]) => n); return hits.slice(0, 2).join(', ') || (c.niche_ru || 'Другое'); };
  const outX = (c, v) => { const m = c.median_views || c.avg_views || 0; return m ? (v.views || 0) / m : 0; };
  const bestX = c => Math.max(0, ...(c.videos || []).map(v => outX(c, v)));
  const vps = c => (c.total_views || 0) / Math.max(c.subs || 1, 1);
  const lastUpload = c => { const d = (c.videos || []).map(v => v.published_at).filter(Boolean).sort().pop(); return d ? new Date(d) : null; };
  const CRITERIA = [
    ['Подписчиков от 1 тыс. до 60 тыс. — канал ещё маленький', c => (c.subs || 0) >= 1000 && (c.subs || 0) <= 60000],
    ['Всего просмотров от 200 тыс. — спрос уже доказан', c => (c.total_views || 0) >= 200000],
    ['На 1 подписчика ≥ 80 просмотров — ролики продвигает алгоритм', c => vps(c) >= 80],
    ['Есть ролик-аутлаер ≥ 2,5× от обычных просмотров канала', c => bestX(c) >= 2.5],
    ['Первый длинный ролик не старше года, видео от 3 до 30', c => (c.channel_age_days || 0) <= 365 && (c.videos_count || 0) <= 30],
  ];
  const refMatch = c => CRITERIA.every(([, f]) => f(c));
  const entryIndex = c => { let v = c.entry_score; if (v == null) return null; if (c.entry_verdict === 'crowded') v = Math.min(v, 40); if (c.entry_verdict === 'unproven') v = Math.min(v, 55); return v; };
  const entryLabel = v => v >= 80 ? ['Отличный вход', 'badge-green'] : v >= 65 ? ['Хороший вход', 'badge-blue'] : v >= 45 ? ['Вход с отстройкой', 'badge-amber'] : ['Последний вагон', 'badge-red'];
  const plural = (n, a, b, c5) => { n = Math.abs(Math.round(n)); const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c5; };
  function describeRu(c) {
    if (c.description_ru) return c.description_ru;
    const lang = (LANG[(c.language || '').split('-')[0]] || c.language || 'английском').toLowerCase().replace(/ий$/, 'ом');
    const style = (c.style_ru || 'смешанный').toLowerCase();
    const age = Math.round(c.channel_age_days || 0); const long = c.videos_count_long || c.videos_count || 0;
    const best = (c.videos || []).slice().sort((a, b) => (b.views || 0) - (a.views || 0))[0];
    const out = [];
    out.push(`Канал на ${lang} языке в нише «${c.niche_ru || 'Другое'}», подниша — «${subniche(c)}».`);
    out.push(`Формат: ${style}, ${faceless(c) ? 'без лица в кадре' : 'с ведущим в кадре'}, ${c.uses_ai ? 'с использованием нейросетей' : 'без явного использования нейросетей'}.`);
    out.push(`Канал молодой: первый длинный ролик вышел ${age} ${plural(age, 'день', 'дня', 'дней')} назад, всего ${long} ${plural(long, 'длинный ролик', 'длинных ролика', 'длинных роликов')}.`);
    out.push(`Подписчиков ${fmt(c.subs)}, а просмотров ${fmt(c.total_views)} — на каждого подписчика приходится ${Math.round(vps(c))} ${plural(vps(c), 'просмотр', 'просмотра', 'просмотров')}${vps(c) >= 80 ? ', значит ролики раскручивает алгоритм YouTube, а не база подписчиков' : ''}.`);
    if (best) out.push(`В среднем ролик набирает ${fmt(c.avg_views)} просмотров, лучший («${best.title}») — ${fmt(best.views)}, это ${outX(c, best).toFixed(1).replace('.', ',')}× от обычного для канала.`);
    out.push(`Монетизация: ${c.is_monetized ? 'уже включена' : c.monetization_forecast && c.monetization_forecast !== 'неясно' ? 'прогноз — ' + c.monetization_forecast : 'пока неясно'}. Оценка дохода — около ${fmt(monthly(c))} $ в месяц при RPM ${money(c.rpm)}.`);
    out.push(`Сложность производства: ${(c.difficulty_ru || 'средняя').toLowerCase()}${c.solo_friendly ? ', формат можно делать в одиночку' : ''}.`);
    return out.join(' ');
  }
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
      if (sub && !subniche(c).split(', ').includes(sub)) return false;
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
      if ($('#onlyRef').checked && !refMatch(c)) return false;
      return true;
    });
    const sorters = { rpm: (a, b) => (b.rpm || 0) - (a.rpm || 0), new: (a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')), subs: (a, b) => (b.subs || 0) - (a.subs || 0), views: (a, b) => (b.total_views || 0) - (a.total_views || 0), score: (a, b) => (b.score || 0) - (a.score || 0), income: (a, b) => monthly(b) - monthly(a), entry: (a, b) => (b.entry_score || 0) - (a.entry_score || 0), monetization: (a, b) => (a.days_to_monetization || 9e9) - (b.days_to_monetization || 9e9) };
    list.sort(sorters[state.sort] || sorters.rpm);
    return list;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  function fillSelects() {
    const uniq = key => [...new Set(state.all.flatMap(c => { const v = c[key]; return Array.isArray(v) ? v : v ? [v] : []; }))].filter(Boolean).sort();
    const fill = (id, arr, labelFn) => { const el = $(id); const cur = el.value; el.innerHTML = el.options[0].outerHTML + arr.map(v => `<option value="${esc(v)}">${esc(labelFn ? labelFn(v) : v)}</option>`).join(''); el.value = [...el.options].some(o => o.value === cur) ? cur : ''; };
    fill('#fTag', uniq('tags').slice(0, 40));
    fill('#fNiche', uniq('niche'), v => state.all.find(c => c.niche === v)?.niche_ru || v);
    fill('#fSub', [...new Set(state.all.flatMap(c => subniche(c).split(', ')))].sort());
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
    return `<article class="card" data-open="${esc(c.id)}"><div class="card-top"><img class="av" src="${esc(c.thumbnail || '')}" alt=""><div><p class="ttl">${esc(c.title)}</p><div class="handle">${esc(c.handle ? '@' + c.handle.replace(/^@/, '') : c.id)}</div></div><span class="pill pill-lang">${esc(LANG[(c.language || 'en').split('-')[0]] || c.language || 'en')}</span>${isNew(c) ? '<span class="pill pill-new">Новое</span>' : ''}</div><div class="thumbs">${vids.map(v => `<a class="thumb" href="${vUrl(v.id)}" target="_blank" rel="noopener"><img src="${esc(v.thumbnail || 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg')}" alt=""><p>${outX(c, v) >= 2 ? `<span class="x">${outX(c, v).toFixed(1)}×</span> ` : ''}${esc(v.title)}</p><small>${fmt(v.views)} просм. · ${ago(v.published_at)}</small></a>`).join('')}</div><div class="nrow"><span class="muted">Ниша</span><span class="tag">${esc(c.niche_ru || 'Другое')}</span></div><div class="nrow"><span class="muted">Подниша</span>${subniche(c).split(', ').map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div><div class="stats"><div><small>Подписчики</small><b>${fmt(c.subs)}</b></div><div><small>Просмотры</small><b>${fmt(c.total_views)}</b></div><div><small>RPM</small><b>${money(c.rpm)}</b></div><div><small>Доход/мес.</small><b>~${fmt(monthly(c))} $</b></div></div>${entryIndex(c) != null ? (() => { const v = entryIndex(c); const [l, cls] = entryLabel(v); return `<div class="entry"><small class="muted">Индекс точки входа</small><span class="badge ${cls}" title="${esc(VERDICT_HINT[c.entry_verdict] || '')}">${l} (${v}/100)</span></div>`; })() : ''}<div class="tags">${tags.map((t, i) => `<span class="tag ${i === 1 ? 'tag-g' : i === 2 ? 'tag-p' : ''}">${esc(t)}</span>`).join('')}</div><div class="foot"><button type="button" class="icon ${state.saved.has(c.id) ? 'on' : ''}" data-save="${esc(c.id)}">🔖</button><button type="button" class="icon ${state.liked.has(c.id) ? 'on' : ''}" data-like="${esc(c.id)}">❤</button><button type="button" class="btn-comp" data-comps="${esc(c.id)}">Конкуренты (${state.all.filter(x => x.niche === c.niche && x.id !== c.id).length})</button><button type="button" class="more" data-open="${esc(c.id)}">Подробнее →</button></div></article>`;
  }
  function pie(parts, colors) { let a = 0; return `<svg viewBox="0 0 36 36" width="90" height="90">` + parts.map((p, i) => { const x = a; a += p * 360; return `<circle r="16" cx="18" cy="18" fill="transparent" stroke="${colors[i]}" stroke-width="8" stroke-dasharray="${p * 100.5} 100.5" transform="rotate(${x - 90} 18 18)"></circle>`; }).join('') + '</svg>'; }
  function line(arr, color) { const max = Math.max(...arr, 1); const pts = arr.map((v, i) => `${(i / (arr.length - 1)) * 100},${28 - (v / max) * 24}`).join(' '); return `<svg class="line" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${pts}"/></svg>`; }
  function entryBlock(c) {
    const g = clusterOf(c); if (!g) return '';
    return `<div class="block"><h3>Вход в нишу</h3><p><span class="badge ${VERDICT_CLASS[g.verdict] || ''}">${esc(g.verdict_ru || g.verdict)}</span> <b>Оценка входа: ${g.entry_score ?? '—'}/100</b></p><p class="muted">${esc(VERDICT_HINT[g.verdict] || '')}</p><div class="meta-grid"><div><small>Каналов в группе</small><b>${g.n}</b></div><div><small>Растут (≥20 тыс. на первых 5)</small><b>${Math.round((g.share_growing || 0) * 100)}%</b></div><div><small>Медиана просм./видео</small><b>${fmt(g.median_vpv)}</b></div><div><small>Новых за 30 дн.</small><b>${g.newcomers_30d}</b></div></div></div>`;
  }
  function prospectsBlock(c) {
    const rows = prospects(c); if (!rows.length) return '';
    const mv = monthlyViews(c);
    return `<div class="block"><h3>Перспективы на другом языке</h3><p class="muted">Та же ниша на других языках: RPM региона, сколько таких каналов уже в базе и сколько принесли бы текущие ${fmt(mv)} просмотров в месяц.</p><div class="table-wrap"><table class="comp"><thead><tr><th>Язык</th><th>Регион</th><th>RPM</th><th>Конкурентов</th><th>Доход/мес.</th><th>Вывод</th></tr></thead><tbody>${rows.map(r => `<tr${r.cur ? ' class="cur"' : ''}><td>${esc(langName(r.l))}${r.cur ? ' <small class="muted">(сейчас)</small>' : ''}</td><td>${esc(r.region_ru)}</td><td>${money(r.rpm)}</td><td>${r.n}</td><td>~${fmt(r.income)} $</td><td><span class="badge ${r.verdict[0]}">${esc(r.verdict[1])}</span></td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function openDrawer(id) {
    const c = state.all.find(x => x.id === id); if (!c) return;
    state.seen.add(id); saveSet(LS.seen, state.seen);
    const vids = (c.videos || []).slice(0, 10);
    const comps = state.all.filter(x => x.niche === c.niche && x.id !== c.id).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 20);
    const d = demo(c); const banner = vids[0] ? `https://i.ytimg.com/vi/${vids[0].id}/hq720.jpg` : c.thumbnail;
    $('#drawerPanel').innerHTML = `<img class="banner" src="${esc(banner)}" alt=""><div class="sheet-body"><div class="sheet-head"><img class="av" src="${esc(c.thumbnail || '')}" alt=""><div><h2>${esc(c.title)}</h2><div class="handle">${esc(c.handle ? '@' + c.handle.replace(/^@/, '') : '')}</div></div><button type="button" class="close" data-close>Закрыть</button></div><div class="actions"><button type="button" class="icon ${state.liked.has(c.id) ? 'on' : ''}" data-like="${esc(c.id)}">❤</button><button type="button" class="icon ${state.saved.has(c.id) ? 'on' : ''}" data-save="${esc(c.id)}">🔖</button><a class="btn" href="${yt(c.id, c.handle)}" target="_blank" rel="noopener">YouTube</a><button type="button" class="btn" id="showComps">Конкуренты</button></div><div class="kpi"><div><small>Подписчики</small><b>${fmt(c.subs)}</b></div><div><small>Просмотры</small><b>${fmt(c.total_views)}</b></div><div><small>Видео</small><b>${c.videos_count || 0}</b></div><div><small>RPM</small><b>${money(c.rpm)}</b></div><div><small>RPM Shorts</small><b>${money((c.rpm || 0) * 0.08)}</b></div><div><small>RPM длинных</small><b>${money(c.rpm)}</b></div><div><small>Доход / мес.</small><b>${money(monthly(c))}</b></div><div><small>Аутлаеры</small><b>${(c.videos || []).filter(v => v.is_outlier).length}</b></div></div><div class="meta-grid"><div><small>Страна</small><b>${esc(c.country || '—')}</b></div><div><small>Язык</small><b>${esc(LANG[(c.language || '').split('-')[0]] || c.language || '—')}</b></div><div><small>Стиль</small><b>${esc(c.style_ru || c.production_style || '—')}</b></div><div><small>Сложность</small><b>${esc(c.difficulty_ru || '—')}</b></div><div><small>ИИ</small><b>${c.uses_ai ? 'ИИ' : 'Без ИИ'}</b></div><div><small>Монетизация</small><b>${esc(c.monetization_forecast || (c.is_monetized ? 'уже' : 'неясно'))}</b></div></div>${risky(c) ? '<div class="warn"><b>Высокие риски.</b> Ниша может чаще получать ограничения монетизации.</div>' : ''}<div class="tags">${(c.tags || []).slice(0, 6).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${c.niche_ru ? `<span class="tag tag-p">${esc(c.niche_ru)}</span>` : ''}</div><p class="muted">Обновлено: ${esc((c.updated_at || '').slice(0, 10))}</p><div class="block"><h3>Описание канала</h3><p>${esc(describeRu(c))}</p>${c.description ? `<details><summary class="muted">Оригинальное описание с YouTube</summary><p class="muted">${esc(c.description)}</p></details>` : ''}</div><div class="block"><h3>Критерии отбора</h3><ul class="crit">${CRITERIA.map(([t, f]) => `<li class="${f(c) ? 'ok' : 'no'}">${f(c) ? '✓' : '✗'} ${esc(t)}</li>`).join('')}</ul><p class="muted">Подниша: ${esc(subniche(c))}. Лучший ролик — ${bestX(c).toFixed(1).replace('.', ',')}× от обычного.</p></div><div class="block"><h3>Топ видео</h3><div class="vids">${vids.map(v => `<a class="thumb" href="${vUrl(v.id)}" target="_blank" rel="noopener"><img src="${esc(v.thumbnail || 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg')}" alt=""><p>${esc(v.title)}</p><small>${fmt(v.views)}</small></a>`).join('')}</div></div><div class="block"><h3>Демография <small class="muted">оценка</small></h3><div class="charts"><div class="chart">Пол<br>${pie([d.male, d.female], ['#4aa3e8', '#e45b7a'])}<div class="muted">Муж ${Math.round(d.male * 100)}% · Жен ${Math.round(d.female * 100)}%</div></div><div class="chart">Возраст<br>${pie(d.ages, ['#8ecae6', '#219ebc', '#023047', '#ffb703', '#fb8500'])}</div><div class="chart">Страны<br>${pie(d.countries.map(x => x[1]), ['#e23b32', '#3b6dff', '#1f8a4a', '#f5a623', '#888'])}<div class="muted">${d.countries.map(x => x[0]).join(', ')}</div></div></div></div><div class="block"><h3>Динамика просмотров</h3>${line(series(c, 'views'), '#e23b32')}</div><div class="block"><h3>Прирост подписчиков</h3>${line(series(c, 'subs'), '#3b6dff')}</div><div class="block"><h3>Оценка дохода за день</h3>${line(series(c, 'rev'), '#f5a623')}</div><div class="block" id="compsBlock" hidden><h3>Конкуренты</h3><p class="muted">Другие молодые каналы той же ниши в базе. Нажми на строку — откроется разбор канала.</p><div class="table-wrap"><table class="comp"><thead><tr><th>Канал</th><th>Подп.</th><th>Видео</th><th>Ср. просм.</th><th>Доход/мес.</th><th>RPM</th><th>Язык</th><th>Score</th></tr></thead><tbody>${comps.map(x => `<tr data-open="${esc(x.id)}"><td>${esc(x.title)}</td><td>${fmt(x.subs)}</td><td>${x.videos_count || 0}</td><td>${fmt(x.avg_views)}</td><td>~${fmt(monthly(x))} $</td><td>${money(x.rpm)}</td><td>${esc(langName(x.language))}</td><td>${x.score ?? '—'}</td></tr>`).join('') || '<tr><td colspan="8">Нет других каналов</td></tr>'}</tbody></table></div></div>${entryBlock(c)}${prospectsBlock(c)}</div>`;
    $('#drawer').hidden = false;
    $('#showComps')?.addEventListener('click', () => { const b = $('#compsBlock'); b.hidden = !b.hidden; if (!b.hidden) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }
  function render() {
    const nich = state.tab === 'niches';
    $('#niches').hidden = !nich; $('#grid').hidden = nich;
    if (nich) { $('#niches').innerHTML = nichesTable(); $('#resultsInfo').textContent = Object.keys(state.clusters).length + ' групп ниш'; $('#empty').hidden = true; $$('#tabs .tab').forEach(b => b.classList.toggle('is-on', b.dataset.tab === state.tab)); return; }
    const list = filtered();
    $('#resultsInfo').textContent = list.length + ' каналов';
    $('#grid').innerHTML = list.map(card).join('');
    $('#empty').hidden = list.length > 0;
    $$('#tabs .tab').forEach(b => b.classList.toggle('is-on', b.dataset.tab === state.tab));
  }
  function toggle(set, key, id) { if (set.has(id)) set.delete(id); else set.add(id); saveSet(key, set); render(); if (!$('#drawer').hidden) openDrawer(id); }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-comps],[data-label],[data-niche-open],#exportLabels,[data-close],[data-open],[data-save],[data-like],[data-tab],#filtersToggle,#resetFilters,#refreshBtn,#refreshRun,#liveClear,#supportBtn,#supportSend');
    if (!t) return;
    if (t.dataset.label) { const k = t.dataset.label; if (state.labels[k] === t.dataset.val) delete state.labels[k]; else state.labels[k] = t.dataset.val; localStorage.setItem(LS.labels, JSON.stringify(state.labels)); render(); return; }
    if (t.dataset.nicheOpen) { state.tab = 'all'; $('#fNiche').value = t.dataset.nicheOpen; $('#fLang').value = (t.dataset.nicheLang || '').split('-')[0]; $('#filters').hidden = false; render(); return; }
    if (t.id === 'exportLabels') { exportLabels(); return; }
    if (t.hasAttribute('data-close')) { t.closest('.overlay').hidden = true; return; }
    if (t.dataset.tab) { state.tab = t.dataset.tab; render(); return; }
    if (t.dataset.save) { e.stopPropagation(); toggle(state.saved, LS.saved, t.dataset.save); return; }
    if (t.dataset.like) { e.stopPropagation(); toggle(state.liked, LS.liked, t.dataset.like); return; }
    if (t.dataset.comps) { e.stopPropagation(); openDrawer(t.dataset.comps); const b = $('#compsBlock'); if (b) { b.hidden = false; setTimeout(() => b.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); } return; }
    if (t.dataset.open) { openDrawer(t.dataset.open); return; }
    if (t.id === 'filtersToggle') { $('#filters').hidden = !$('#filters').hidden; return; }
    if (t.id === 'resetFilters') { $$('#filters select').forEach(s => { s.selectedIndex = 0; }); $('#subsMin').value = 0; $('#subsMax').value = $('#subsMax').max; $('#viewsMin').value = 0; $('#viewsMax').value = $('#viewsMax').max; $('#avgMin').value = 0; $('#avgMax').value = $('#avgMax').max; $('#rpmMin').value = 0; $('#rpmMax').value = 30; $('#onlyNew3').checked = $('#onlyUnseen').checked = false; $('#onlyRef').checked = true; labs(); render(); return; }
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
    try { const r = await fetch('collector/rpm_baseline.json', { cache: 'no-store' }); if (r.ok) state.rpm = await r.json(); } catch {}
    state.clusters = data.clusters || {};
    const live = loadArr(LS.live); const seen = new Set((data.channels || []).map(c => c.id));
    state.all = (data.channels || []).filter(c => !c.graduated || c.labeled_role).concat(live.filter(c => c && c.id && !seen.has(c.id)));
    const when = data.generated_at ? new Date(data.generated_at) : null;
    $('#generatedAt').textContent = when ? 'Обновлено ' + when.toLocaleString('ru-RU') : (live.length ? 'Найдено в браузере: ' + live.length : '');
    fillSelects(); render();
  }
  boot();
})();
