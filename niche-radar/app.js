(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LS = { saved: 'nr:saved', liked: 'nr:liked', seen: 'nr:seen', live: 'nr:live', liveAt: 'nr:liveAt', key: 'nr:apiKey', maxQ: 'nr:maxQueries', support: 'nr:support', labels: 'nr:labels' };
  const loadSet = k => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } };
  const saveSet = (k, set) => localStorage.setItem(k, JSON.stringify([...set]));
  const loadArr = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const state = { tab: 'all', q: '', sort: 'new', group: 'channels', all: [], saved: loadSet(LS.saved), liked: loadSet(LS.liked), seen: loadSet(LS.seen), clusters: {}, size: {}, rpm: null, labels: (() => { try { return JSON.parse(localStorage.getItem('nr:labels') || '{}'); } catch { return {}; } })() };
  const LANG = { en: 'Английский', ru: 'Русский', es: 'Испанский', pt: 'Португальский', fr: 'Французский', de: 'Немецкий', it: 'Итальянский' };
  const fmt = n => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + ' млн'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.0', '') + ' тыс.'; return String(Math.round(n)); };
  const money = n => (Number(n) || 0).toFixed(2).replace('.', ',') + ' $';
  const num = n => Math.round(Number(n) || 0).toLocaleString('ru-RU');
  const dateRu = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString('ru-RU') : ''; };
  const agoRu = iso => { if (!iso) return ''; const d = Math.floor((Date.now() - new Date(iso)) / 864e5); if (d < 1) return 'сегодня'; if (d < 7) return `${d} дн назад`; if (d < 30) return `${Math.floor(d / 7)} нед назад`; if (d < 365) { const m = Math.floor(d / 30); return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')} назад`; } const y = Math.floor(d / 365); return `${y} ${plural(y, 'год', 'года', 'лет')} назад`; };
  const sameLang = (a, b) => (a.language || 'en').split('-')[0] === (b.language || 'en').split('-')[0];
  const compCount = c => c._comp ?? (c._comp = state.all.filter(x => x.niche === c.niche && x.id !== c.id && sameLang(x, c)).length);
  const handleOf = c => c.handle ? '@' + c.handle.replace(/^@/, '') : '';
  const countryName = code => { if (!code) return '—'; try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; } };
  const STYLE_RU = { stock_footage: 'Стоковые видео', maps_graphics: 'Карты / графика', ai_images: 'ИИ-картинки', '2d_animation': '2D-анимация', '3d_animation': '3D-анимация', ai_video: 'ИИ-видео', highlights: 'Нарезки / шоу', illustrations: 'Иллюстрации', photos_stock: 'Фото / стоки', ai_illustrations: 'ИИ-иллюстрации', talking_head: 'Ведущий в кадре', screencast_slides: 'Скринкаст / слайды', stickman: 'Стикмены', code_generated: 'Производство кодом' };
  const styles = c => ((c.production_styles || []).length ? c.production_styles : [c.production_style]).filter(Boolean);
  const styleName = v => STYLE_RU[v] || state.all.find(c => c.production_style === v)?.style_ru || v;
  const categories = c => ((c.categories || []).length ? c.categories : c.tags || []);
  const contentType = c => { const v = c.videos || []; if (!v.length) return 'long'; const sh = v.filter(x => (x.duration_sec || 0) > 0 && x.duration_sec <= 60).length / v.length; return sh >= 0.7 ? 'shorts' : sh <= 0.1 ? 'long' : 'mixed'; };
  const CONTENT_RU = { long: 'Длинные видео', shorts: 'Shorts', mixed: 'Длинные + Shorts' };
  const aiMode = c => c.uses_ai_mode || (c.uses_ai ? 'with' : 'without');
  const AI_RU = { with: 'С ИИ', without: 'Без ИИ', mix: 'Микс' };
  const growth = c => (c.subs_per_day || 0) / Math.max(c.subs || 1, 1);
  const DIFF_ORDER = { low: 0, medium: 1, high: 2 };
  const ICON = { heart: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>', save: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>', ext: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>' };
  const BAND_HINT = { 'Отличный вход': 'Ниша свежая, конкурентов мало — лучший момент зайти.', 'Хороший вход': 'Спрос есть, конкуренция умеренная — заходить можно.', 'Вход с отстройкой': 'Заходить можно, но нужно заметно отличаться от конкурентов.', 'Последний вагон': 'Входить рискованно — рост уже маловероятен.', 'Вход закрыт': 'Ниша переполнена — новичку не пробиться.' };
  const BAND_COLOR = { 'badge-green': '#22a653', 'badge-blue': '#2c6bed', 'badge-amber': '#f5a623', 'badge-red': '#ff6a2b', 'badge-grey': '#9aa0ab' };
  const gauge = (v, cls) => { const f = Math.max(0.04, Math.min(1, v / 100)), a = Math.PI * (1 - f); return `<svg viewBox="0 0 36 21" width="30" height="18"><path d="M3 18A15 15 0 0 1 33 18" fill="none" stroke="#eceef2" stroke-width="4.5" stroke-linecap="round"/><path d="M3 18A15 15 0 0 1 ${(18 + 15 * Math.cos(a)).toFixed(2)} ${(18 - 15 * Math.sin(a)).toFixed(2)}" fill="none" stroke="${BAND_COLOR[cls]}" stroke-width="4.5" stroke-linecap="round"/></svg>`; };
  const topVids = (c, n) => (c.videos || []).slice().sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, n);
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
      const ck = (state.langChecks || {})[`${c.niche}|${l}`];
      const verdict = !ck ? ['badge-grey', 'Не проверено на YouTube'] : ck.channels <= 10 ? ['badge-green', 'Свободно (YouTube)'] : ck.channels <= 25 ? ['badge-amber', 'Средняя конкуренция (YouTube)'] : ['badge-red', 'Конкурентно (YouTube)'];
      rows.push({ l, region, region_ru: (state.rpm.region_ru || {})[region] || region, rpm, n, ck, income, verdict, cur: l === (c.language || '').split('-')[0] });
    }));
    return rows.sort((a, b) => ((a.ck ? a.ck.channels : 999) - (b.ck ? b.ck.channels : 999)) || (b.rpm - a.rpm));
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
    ['Истории «Что если» со стикменами', /\bwhat if\b|what would happen|что если|qué pasaría|\be se\b/i],
    ['Военная история и снаряжение', /\b(wars?|wwii|ww2|ww1|world war|military|army|soldiers?|marines|battles?|tanks?|weapons?|navy|pows?|guerra|soldados|krieg|ambush\w*)\b/i],
    ['Дикий Запад и фронтир', /\b(wild west|cowboys?|frontier|saloons?|outlaws?)\b/i],
    ['Смерти и трагедии знаменитостей', /\b(tragic|tragedy|celebrit\w*|hollywood|actors?|actress\w*|death of|schizophren\w*)\b/i],
    ['Вулканы и землетрясения', /\b(volcan\w*|earthquakes?|tecton\w*|eruptions?|sinkholes?|terremotos?)\b|ground (opened|split)/i],
    ['Мегамашины и гигантские конструкции', /\b(biggest|largest|giant|mega ?machines?|ships?|machines?|cruise|excavators?|barcos?)\b/i],
    ['Инженерные провалы и мегапроекты', /\b(invent\w*|megaprojects?|engineer\w*|erfindung\w*|invento\w*|megaprojekt\w*|cement|steel)\b|built a|new \w+ (plane|car|battery|material)/i],
    ['Инфраструктура и стратегическая география', /\b(infrastructure|canals?|dams?|bridges?|aqueducts?|railways?|railroads?|geograph\w*|maps?|acueductos?|infraestructura)\b|why (so few|nobody) .*live|state makes no sense/i],
    ['Переезд за границу', /\b(relocat\w*|move to|moving to|abroad|expats?|retire in|vivir en)\b/i],
    ['Пожилые люди и подготовка к старости', /\b(seniors?|retire\w*|retirement|over 6\d|elderly|social security|medicare|pensions?|jubilad\w*|jubilarte|aposentad\w*)\b|después de los 60/i],
    ['Экономная жизнь и минимализм', /\b(frugal\w*|cheap\w*|budget\w*|save money|minimalis\w*|barat\w*|económic\w*|ahorr\w*)\b/i],
    ['Питание и здоровье', /\b(health\w*|foods?|nutrition|vitamins?|diet|eat|eating|salud|cuerpo|comer)\b/i],
    ['Ностальгия', /\b(nostalg\w*|retro|19[5-9]0s|forgotten|old days|olvidad\w*)\b/i],
    ['Ювелирка и драгоценности', /\b(jewel\w*|gemstones?|gems?|pearls?|diamonds?|brooch\w*|earrings?|necklaces?|rings?|jade|gold)\b/i],
    ['Монеты и коллекционирование', /\b(coins?|collect\w*|antiques?|penny|pennies|stamps?|worth a fortune|vintage)\b/i],
    ['Библейские истории и вера', /\b(bible|biblical|jesus|god|church|prayer|faith|christian\w*|archangels?|catholic|demons?)\b/i],
    ['Животные и дикая природа', /\b(animals?|wildlife|dogs?|cats?|kittens?|birds?|sharks?|snakes?|predators?|zoo)\b/i],
    ['Космос и физика', /\b(space|physics|universe|planets?|quantum|galax\w*|nasa)\b/i],
    ['Психология и личностный рост', /\b(psycholog\w*|personality|traits?|introverts?|stoic\w*|habits?)\b/i],
    ['Личные финансы', /\b(money|financ\w*|invest\w*|tax|taxes|income|wealth\w*|dinero|negocios?)\b/i],
    ['Авто и техника', /\b(cars?|suvs?|trucks?|pickups?|engines?|motorcycles?)\b/i],
    ['История цивилизаций', /\b(history|historical|ancient|empires?|civilizations?|historia|geschichte|história)\b/i],
  ];

  const textOf = c => [...(c.tags || []), c.title, ...(c.videos || []).map(v => v.title)].join(' ');
  const subniches = c => { if (c.subniche_ru) return c.subniche_ru.split(', '); if (c._sub) return c._sub; const texts = [c.title, (c.tags || []).join(' '), ...(c.videos || []).map(v => v.title)].filter(Boolean); const need = (c.videos || []).length >= 5 ? 2 : 1; const hits = SUBNICHES.map(([n, re]) => [n, texts.filter(t => re.test(t)).length]).filter(([, k]) => k >= need).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n); c._sub = hits.length ? hits : [c.niche_ru || 'Другое']; return c._sub; };
  const subniche = c => subniches(c).slice(0, 2).join(', ');
  const ageDays = c => { const t = Date.parse(c.first_video_at || ''); return Number.isFinite(t) ? (Date.now() - t) / 864e5 : (c.channel_age_days || 0); };
  const longCount = c => c.videos_count_long ?? c.videos_count ?? 0;
  const outliers = c => (c.videos || []).filter(v => outX(c, v) >= 2.5).length;
  const outX = (c, v) => { const m = c.median_views || c.avg_views || 0; return m ? (v.views || 0) / m : 0; };
  const bestX = c => Math.max(0, ...(c.videos || []).map(v => outX(c, v)));
  const vps = c => (c.total_views || 0) / Math.max(c.subs || 1, 1);
  const lastUpload = c => { const d = (c.videos || []).map(v => v.published_at).filter(Boolean).sort().pop(); return d ? new Date(d) : null; };
  const minVideoViews = c => { const v = (c.videos || []).map(x => Number(x.views) || 0); return v.length ? Math.min(...v) : 0; };
  const rivals = c => Math.max(0, (state.size[c.cluster] || 1) - 1);
  const FIRE = { videos: 10, views: 20000, rivals: 4 };
  const FIRE_CRITERIA = [
    [`Не больше ${FIRE.videos} длинных роликов — канал только начал`, c => longCount(c) <= FIRE.videos],
    [`Каждый ролик набрал от ${fmt(FIRE.views)} просмотров`, c => minVideoViews(c) >= FIRE.views],
    [`Не больше ${FIRE.rivals} конкурентов в той же нише, стиле и языке`, c => rivals(c) <= FIRE.rivals],
  ];
  const EXTRA_RU = { own_product: 'Свой продукт', affiliate: 'Партнёрки', sponsors: 'Спонсоры', membership: 'Подписка/Patreon', merch: 'Мерч' };
  const flags = c => {
    const xs = (c.videos || []).map(v => outX(c, v)).sort((a, b) => b - a); const out = [];
    if (c.cluster && state.all.filter(x => x.cluster === c.cluster).length <= 3 && (c.entry_score ?? 0) >= 65) out.push('Ранняя ниша');
    if (xs[0] >= 5 && (xs[1] || 0) < 1.5) out.push('Один хит');
    return out;
  };
  const tagsOf = c => [...flags(c), ...(c.tags || [])];
  const isFire = c => (c.videos || []).length > 0 && FIRE_CRITERIA.every(([, f]) => f(c));
  const lastDays = c => { const t = Math.max(0, ...(c.videos || []).map(v => Date.parse(v.published_at || '') || 0)); return t ? (Date.now() - t) / 864e5 : 9999; };
  const CRITERIA = [
    ['Подписчиков от 500 до 300 тыс. — канал ещё небольшой', c => (c.subs || 0) >= 500 && (c.subs || 0) <= 300000],
    ['Всего просмотров от 200 тыс. — спрос уже доказан', c => (c.total_views || 0) >= 200000],
    ['На 1 подписчика ≥ 35 просмотров — ролики продвигает алгоритм', c => vps(c) >= 35],
    ['Есть прострел ≥ 2,5× от обычных просмотров канала', c => bestX(c) >= 2.5],
    ['Последний длинный ролик вышел не позже 90 дней назад — канал живой', c => lastDays(c) <= 90],
  ];
  const refMatch = c => CRITERIA.every(([, f]) => f(c));
  const entryIndex = c => { let v = c.entry_score; if (v == null) return null; if (c.entry_verdict === 'crowded') v = Math.min(v, 40); if (c.entry_verdict === 'unproven') v = Math.min(v, 55); return v; };
  const entryLabel = v => v < 20 ? ['Вход закрыт', 'badge-grey'] : v >= 80 ? ['Отличный вход', 'badge-green'] : v >= 65 ? ['Хороший вход', 'badge-blue'] : v >= 45 ? ['Вход с отстройкой', 'badge-amber'] : ['Последний вагон', 'badge-red'];
  const plural = (n, a, b, c5) => { n = Math.abs(Math.round(n)); const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c5; };
  function describeRu(c) {
    if (c.description_ru) return c.description_ru;
    const lang = (LANG[(c.language || '').split('-')[0]] || c.language || 'английском').toLowerCase().replace(/ий$/, 'ом');
    const style = (c.style_ru || 'смешанный').toLowerCase();
    const age = Math.round(ageDays(c)); const long = longCount(c);
    const best = (c.videos || []).slice().sort((a, b) => (b.views || 0) - (a.views || 0))[0];
    const out = [];
    out.push(`Канал на ${lang} языке в нише «${c.niche_ru || 'Другое'}», подниша — «${subniche(c)}».`);
    out.push(`Формат: ${style}, ${faceless(c) ? 'без лица в кадре' : 'с ведущим в кадре'}, ${c.uses_ai ? 'с использованием нейросетей' : 'без явного использования нейросетей'}.`);
    out.push(`${age <= 365 ? 'Канал молодой' : 'Канал уже старше года'}: первый длинный ролик вышел ${age} ${plural(age, 'день', 'дня', 'дней')} назад, всего ${long} ${plural(long, 'длинный ролик', 'длинных ролика', 'длинных роликов')}.`);
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
  const realDaily = c => (c.daily || []).length >= 3;
  const estNote = c => realDaily(c) ? '' : ' <small class="muted">оценка — реальный график после 3 дней сбора</small>';
  function series(c, kind) {
    if (realDaily(c)) {
      const d = c.daily; const out = [];
      for (let i = 1; i < d.length; i++) { const dv = Math.max(0, d[i][2] - d[i - 1][2]), ds = Math.max(0, d[i][1] - d[i - 1][1]); out.push(kind === 'subs' ? ds : kind === 'rev' ? dv / 1000 * (c.rpm || 0) : dv); }
      return out;
    }
    const r = rng(hash(c.id + kind)); const n = 18; const out = [];
    let v = kind === 'subs' ? Math.max(2, (c.subs_per_day || 5)) : kind === 'rev' ? Math.max(1, monthly(c) / 20) : Math.max(200, (c.views_per_day || 1000));
    for (let i = 0; i < n; i++) { v = Math.max(0, v * (0.75 + r() * 0.6)); out.push(v); }
    return out;
  }
  function filtered() {
    const tag = $('#fTag').value, niche = $('#fNiche').value, sub = $('#fSub').value, cat = $('#fCat').value, lang = $('#fLang').value, format = $('#fFormat').value, style = $('#fStyle').value, diff = $('#fDiff').value, ai = $('#fAi').value, avatar = $('#fAvatar').value, face = $('#fFace').value, mon = $('#fMon').value, days = $('#fDays').value, extra = $('#fExtra').value, itv = $('#fItv').value;
    const sMin = +$('#subsMin').value, sMax = +$('#subsMax').value, vMin = +$('#viewsMin').value, vMax = +$('#viewsMax').value, aMin = +$('#avgMin').value, aMax = +$('#avgMax').value, rMin = +$('#rpmMin').value, rMax = +$('#rpmMax').value;
    const q = state.q.trim().toLowerCase();
    let list = state.all.slice();
    if (state.tab === 'new') list = list.filter(isNew);
    if (state.tab === 'fire') list = list.filter(isFire);
    if (state.tab === 'saved') list = list.filter(c => state.saved.has(c.id));
    if (state.tab === 'liked') list = list.filter(c => state.liked.has(c.id));
    list = list.filter(c => {
      if (q && !`${c.title} ${c.handle} ${(c.tags || []).join(' ')} ${c.niche_ru || ''} ${subniches(c).join(' ')}`.toLowerCase().includes(q)) return false;
      if (tag && !tagsOf(c).includes(tag)) return false;
      if (extra && !(c.extra_monetization || []).includes(extra)) return false;
      if (itv && (entryIndex(c) ?? -1) < +itv) return false;
      const fc = $('#fComp').value; if (fc) { const [lo, hi] = fc.split('-').map(Number); const k = compCount(c); if (k < lo || (hi >= 0 && k > hi)) return false; }
      if (niche && c.niche !== niche && c.niche_ru !== niche) return false;
      if (sub && !subniches(c).includes(sub)) return false;
      if (cat && !categories(c).includes(cat)) return false;
      if (lang && (c.language || '').split('-')[0] !== lang) return false;
      if (format && contentType(c) !== format) return false;
      if (style && !styles(c).includes(style)) return false;
      if (diff && c.difficulty !== diff) return false;
      if (ai && aiMode(c) !== ai) return false;
      if (avatar && !!c.has_ai_avatar !== (avatar === 'yes')) return false;
      if (face === 'yes' && !faceless(c)) return false;
      if (face === 'no' && faceless(c)) return false;
      if (mon === 'yes' && c.is_monetized !== true) return false;
      if (mon === 'no' && c.is_monetized !== false) return false;
      if (mon === 'unknown' && c.is_monetized != null) return false;
      if (mon === 'soon' && !['≤30 дн.', '≤90 дн.'].includes(c.monetization_forecast)) return false;
      if (days && (c.days_to_monetization || 999) > +days) return false;
      if ((c.subs || 0) < sMin || (c.subs || 0) > sMax) return false;
      if ((c.total_views || 0) < vMin || (c.total_views || 0) > vMax) return false;
      if ((c.avg_views || 0) < aMin || (c.avg_views || 0) > aMax) return false;
      if ((c.rpm || 0) < rMin || (c.rpm || 0) > rMax) return false;
      if ($('#onlyNew3').checked && !isNew3(c)) return false;
      if ($('#onlyUnseen').checked && state.seen.has(c.id)) return false;
      if ($('#onlyRef').checked && state.tab !== 'fire' && !refMatch(c)) return false;
      if ($('#onlyVerified').checked && c.verified !== true) return false;
      return true;
    });
    const sorters = { new: (a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')) || (b.score || 0) - (a.score || 0), rpm: (a, b) => (b.rpm || 0) - (a.rpm || 0), growth: (a, b) => growth(b) - growth(a), outliers: (a, b) => outliers(b) - outliers(a) || bestX(b) - bestX(a), easy: (a, b) => (DIFF_ORDER[a.difficulty] ?? 1) - (DIFF_ORDER[b.difficulty] ?? 1) || (b.score || 0) - (a.score || 0), entry: (a, b) => (entryIndex(b) ?? -1) - (entryIndex(a) ?? -1), subs: (a, b) => (b.subs || 0) - (a.subs || 0), views: (a, b) => (b.total_views || 0) - (a.total_views || 0), income: (a, b) => monthly(b) - monthly(a), monetization: (a, b) => (a.days_to_monetization || 9e9) - (b.days_to_monetization || 9e9) };
    list.sort(sorters[state.sort] || sorters.new);
    return list;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  function fillSelects() {
    const uniq = key => [...new Set(state.all.flatMap(c => { const v = c[key]; return Array.isArray(v) ? v : v ? [v] : []; }))].filter(Boolean).sort();
    const fill = (id, arr, labelFn) => { const el = $(id); const cur = el.value; el.innerHTML = el.options[0].outerHTML + arr.map(v => `<option value="${esc(v)}">${esc(labelFn ? labelFn(v) : v)}</option>`).join(''); el.value = [...el.options].some(o => o.value === cur) ? cur : ''; };
    fill('#fTag', [...new Set([...state.all.flatMap(flags), ...uniq('tags')])].slice(0, 40));
    fill('#fExtra', Object.keys(EXTRA_RU), v => EXTRA_RU[v]);
    fill('#fNiche', uniq('niche'), v => state.all.find(c => c.niche === v)?.niche_ru || v);
    fill('#fSub', [...new Set(state.all.flatMap(subniches))].sort());
    fill('#fCat', [...new Set(state.all.flatMap(categories))].filter(Boolean).sort().slice(0, 60));
    fill('#fLang', [...new Set(uniq('language').map(l => l.split('-')[0]))], v => LANG[v] || v);
    fill('#fFormat', ['long', 'mixed', 'shorts'].filter(t => state.all.some(c => contentType(c) === t)), v => CONTENT_RU[v]);
    fill('#fStyle', [...new Set([...Object.keys(STYLE_RU), ...state.all.flatMap(styles)])].sort((a, b) => styleName(a).localeCompare(styleName(b), 'ru')), styleName);
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
  const entryBox = (c, full) => { const v = entryIndex(c); if (v == null) return ''; const [l, cls] = entryLabel(v); return `<div class="entry-box"><small>Индекс точки входа</small><div class="entry-val">${gauge(v, cls)}<b>${l} (${v}/100)</b></div>${full ? `<p class="muted">${esc(BAND_HINT[l] || '')}</p>` : ''}</div>`; };
  const vthumb = (c, v) => { const x = outX(c, v); return `<a class="vt" href="${vUrl(v.id)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(v.thumbnail || 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg')}" alt=""><p>${x >= 2 ? `<span class="x">${x.toFixed(1)}×</span> ` : ''}${esc(v.title)}</p><small>${fmt(v.views)} просм.</small><small>${agoRu(v.published_at)}</small></a>`; };
  function card(c) {
    const comps = compCount(c);
    return `<article class="card" data-open="${esc(c.id)}"><div class="card-top"><img class="av" src="${esc(c.thumbnail || '')}" alt=""><div class="who"><p class="ttl">${esc(c.title)}</p><div class="handle">${esc(handleOf(c))}</div></div><div class="pills">${isNew(c) ? '<span class="pill pill-new">Новое</span>' : ''}${isFire(c) ? '<span class="pill pill-fire">Стреляет</span>' : ''}${c.verified ? '<span class="pill pill-ok">Проверено ИИ</span>' : c.verified === false ? '<span class="pill">Отклонён ИИ</span>' : '<span class="pill">Не проверен</span>'}<span class="pill">${esc(langName(c.language))}</span></div></div><div class="vts">${topVids(c, 3).map(v => vthumb(c, v)).join('')}</div><div class="nrow"><span>Ниша</span><span class="tag tag-b">${esc(c.niche_ai_ru || c.niche_ru || 'Другое')}</span></div><div class="nrow"><span>Подниша</span>${subniches(c).slice(0, 2).map(x => `<span class="tag tag-b">${esc(x)}</span>`).join('')}</div><div class="kpis3"><div><small>Подписчики</small><b>${num(c.subs)}</b></div><div><small>Просмотры</small><b>${num(c.total_views)}</b></div><div><small>RPM</small><b>${money(c.rpm)}</b></div></div>${entryBox(c, false)}${flags(c).length ? `<div class="tags">${flags(c).map(f => `<span class="tag tag-o">${f}</span>`).join('')}</div>` : ''}<div class="foot"><button type="button" class="ic ${state.liked.has(c.id) ? 'on' : ''}" data-like="${esc(c.id)}" title="Нравится">${ICON.heart}</button><button type="button" class="ic ${state.saved.has(c.id) ? 'on' : ''}" data-save="${esc(c.id)}" title="Сохранить">${ICON.save}</button><button type="button" class="btn-comp" data-comps="${esc(c.id)}">Конкуренты (${comps})</button><button type="button" class="more" data-open="${esc(c.id)}">Подробнее →</button></div><div class="added">${esc(dateRu(c.added_at))}</div></article>`;
  }

  function pie(parts, colors) {
    const tot = parts.reduce((a, b) => a + b, 0) || 1; let a = -Math.PI / 2;
    return '<svg viewBox="0 0 100 100" width="130" height="130">' + parts.map((p, i) => { const f = p / tot; if (f >= 0.999) return `<circle cx="50" cy="50" r="48" fill="${colors[i]}"/>`; const a2 = a + f * 2 * Math.PI; const d = `M50 50L${(50 + 48 * Math.cos(a)).toFixed(2)} ${(50 + 48 * Math.sin(a)).toFixed(2)}A48 48 0 ${f > 0.5 ? 1 : 0} 1 ${(50 + 48 * Math.cos(a2)).toFixed(2)} ${(50 + 48 * Math.sin(a2)).toFixed(2)}Z`; a = a2; return `<path d="${d}" fill="${colors[i]}" stroke="#fff" stroke-width="1.5"><title>${Math.round(f * 100)}%</title></path>`; }).join('') + '</svg>';
  }
  const legend = (names, colors) => `<div class="legend">${names.map((n, i) => `<span><i style="background:${colors[i]}"></i>${esc(n)}</span>`).join('')}</div>`;
  const MON = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
  const niceStep = x => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1)))); const m = x / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  function chart(pts, color) {
    if (pts.length < 2) return '<p class="muted">Мало данных</p>';
    const W = 640, H = 240, L = 70, B = 28, T = 12, R = 14;
    const vals = pts.map(p => p[1]); let lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
    const step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const t0 = Date.parse(pts[0][0]), t1 = Math.max(t0 + 1, Date.parse(pts[pts.length - 1][0]));
    const X = t => L + (W - L - R) * (t - t0) / (t1 - t0), Y = v => T + (H - T - B) * (1 - (v - lo) / Math.max(1, hi - lo));
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="gl"/><text x="${L - 10}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${num(v)}</text>`;
    for (let i = 0; i <= 4; i++) { const t = t0 + (t1 - t0) * i / 4, d = new Date(t); g += `<text x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${d.getDate()} ${MON[d.getMonth()]}</text>`; }
    const xy = pts.map(p => [X(Date.parse(p[0])).toFixed(1), Y(p[1]).toFixed(1)]);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#d9dce3"/><polyline points="${xy.map(q => q.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>${xy.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="2.8" fill="${color}"><title>${dateRu(pts[i][0])}: ${num(pts[i][1])}</title></circle>`).join('')}</svg>`;
  }
  function dated(c, kind) {
    if (realDaily(c)) { const d = c.daily, out = []; for (let i = 1; i < d.length; i++) out.push([d[i][0], kind === 'subs' ? d[i][1] - d[i - 1][1] : d[i][2] - d[i - 1][2]]); return out; }
    const s = series(c, kind), now = Date.now();
    return s.map((v, i) => [new Date(now - (s.length - 1 - i) * 864e5).toISOString().slice(0, 10), Math.round(v)]);
  }

  function entryBlock(c) {
    const g = clusterOf(c); if (!g) return '';
    return `<div class="block"><h3>Вход в нишу</h3><p><span class="badge ${VERDICT_CLASS[g.verdict] || ''}">${esc(g.verdict_ru || g.verdict)}</span> <b>Оценка входа: ${g.entry_score ?? '—'}/100</b></p><p class="muted">${esc(VERDICT_HINT[g.verdict] || '')}</p><div class="meta-grid"><div><small>Каналов в группе</small><b>${g.n}</b></div><div><small>Растут (≥20 тыс. на первых 5)</small><b>${Math.round((g.share_growing || 0) * 100)}%</b></div><div><small>Медиана просм./видео</small><b>${fmt(g.median_vpv)}</b></div><div><small>Новых за 30 дн.</small><b>${g.newcomers_30d}</b></div></div></div>`;
  }
  function prospectsBlock(c) {
    const rows = prospects(c); if (!rows.length) return '';
    const mv = monthlyViews(c);
    return `<div class="block"><h3>Перспективы на другом языке</h3><p class="muted">Сколько каналов этой ниши реально выпускают ролики на YouTube на каждом языке: сборщик ищет нишу на YouTube и считает разные каналы среди 50 самых популярных роликов за 90 дней. RPM и доход (при текущих ${fmt(mv)} просмотрах в месяц) — оценка по средним RPM региона.</p><div class="table-wrap"><table class="comp"><thead><tr><th>Язык</th><th>Регион</th><th>RPM (оценка)</th><th>Каналов на YouTube</th><th>Доход/мес. (оценка)</th><th>Вывод</th></tr></thead><tbody>${rows.map(r => `<tr${r.cur ? ' class="cur"' : ''}><td>${esc(langName(r.l))}${r.cur ? ' <small class="muted">(сейчас)</small>' : ''}</td><td>${esc(r.region_ru)}</td><td>${money(r.rpm)}</td><td>${r.ck ? `${r.ck.channels} <small class="muted">${esc(dateRu(r.ck.checked_at))}</small>` : '—'}</td><td>~${fmt(r.income)} $</td><td><span class="badge ${r.verdict[0]}">${esc(r.verdict[1])}</span></td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function openDrawer(id) {
    const c = state.all.find(x => x.id === id); if (!c) return;
    state.seen.add(id); saveSet(LS.seen, state.seen);
    const vids = topVids(c, 10);
    const comps = state.all.filter(x => x.niche === c.niche && x.id !== c.id && sameLang(x, c)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 20);
    const d = demo(c); const banner = c.banner || (vids[0] ? `https://i.ytimg.com/vi/${vids[0].id}/hq720.jpg` : '');
    const extra = (c.extra_monetization || []).map(x => EXTRA_RU[x] || x).join(', ');
    const kpi = [['Подписчики', num(c.subs)], ['Просмотры', num(c.total_views)], ['Видео', num(c.videos_count)], ['RPM', money(c.rpm)], ['RPM Shorts', money(c.rpm_short ?? (c.rpm || 0) * 0.08)], ['RPM длинных видео', money(c.rpm_long ?? c.rpm)], ['Прострелов', outliers(c)], ['Страна', countryName(c.country)], ['Язык', langName(c.language)], ['Сложность производства', c.difficulty_ru || '—'], ['Использование ИИ', AI_RU[aiMode(c)]], ['Доп. монетизация', extra || '—'], ['Доход / мес.', '~' + num(monthly(c)) + ' $'], ['Монетизация YouTube', c.is_monetized ? 'Монетизирован' : c.is_monetized === false ? 'Не монетизирован' : 'Неизвестно'], ['До монетизации', c.is_monetized ? '—' : c.monetization_forecast || '—'], ['Формат контента', CONTENT_RU[contentType(c)]]];
    const trow = (label, items, cls) => items.length ? `<div class="trow"><span>${label}</span>${items.map(x => `<span class="tag ${cls}">${esc(x)}</span>`).join('')}</div>` : '';
    const ageN = ['13–17 лет', '18–24 лет', '25–34 лет', '35–44 лет', '45+ лет'], pc = ['#ff3b1f', '#4a86c8', '#e8a93a', '#4caf88', '#9b6fd3', '#9aa0ab'];
    $('#drawerPanel').innerHTML = `<button type="button" class="x-close" data-close>× Закрыть</button>${banner ? `<img class="banner" src="${esc(banner)}" alt="">` : ''}<div class="m-head"><img class="av" src="${esc(c.thumbnail || '')}" alt=""><div><h2>${esc(c.title)}</h2><div class="handle">${esc(handleOf(c))}</div></div><div class="m-act"><button type="button" class="ic ${state.liked.has(c.id) ? 'on' : ''}" data-like="${esc(c.id)}" title="Нравится">${ICON.heart}</button><button type="button" class="ic ${state.saved.has(c.id) ? 'on' : ''}" data-save="${esc(c.id)}" title="Сохранить">${ICON.save}</button><a class="ic" href="${yt(c.id, c.handle)}" target="_blank" rel="noopener" title="Открыть на YouTube">${ICON.ext}</a><button type="button" class="btn-out" id="showComps">Конкуренты</button></div></div>
<div class="kpi">${kpi.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>${c.verified === false ? `<div class="warn"><b>Отклонён ИИ.</b> ${esc(c.reject_reason || '')}</div>` : c.verified !== true ? '<div class="warn">Канал ещё не проверен ИИ — ниша и подниша определены автоматически по названиям роликов и могут быть неточными.</div>' : ''}${risky(c) ? '<div class="warn"><b>Высокие риски.</b> Ниша может чаще получать ограничения монетизации.</div>' : ''}
${trow('Стиль производства', styles(c).map(styleName), 'tag-o')}${trow('Категории', categories(c).slice(0, 6), 'tag-g')}${trow('Ниша', [c.niche_ai_ru || c.niche_ru || 'Другое'], 'tag-b')}${trow('Подниша', subniches(c).slice(0, 3), 'tag-p')}${trow('Метки', flags(c), 'tag-o')}
<h3 class="h">Описание ниши</h3><p class="notes">${esc(c.notes_ru || describeRu(c))}</p>${c.notes_ru ? `<details><summary class="muted">Сводка по цифрам</summary><p class="notes">${esc(describeRu(c))}</p></details>` : ''}
<div style="margin-top:18px">${entryBox(c, true)}</div><p class="muted small">Обновлено: ${esc(dateRu(c.updated_at))}</p>
${c.description ? `<h3 class="h">Описание</h3><p class="notes">${esc(c.description)}</p>` : ''}
<h3 class="h">Топ-10 видео</h3><div class="vts vts-3">${vids.map(v => vthumb(c, v)).join('')}</div>
<h3 class="h">Демография аудитории <small>оценка по нише и языку</small></h3><div class="demo"><div><b>Пол</b>${pie([d.male, d.female], pc)}${legend(['Муж', 'Жен'], pc)}</div><div><b>Возраст</b>${pie(d.ages, pc)}${legend(ageN, pc)}</div><div><b>Страны аудитории</b>${pie(d.countries.map(x => x[1]), pc)}${legend(d.countries.map(x => x[0]), pc)}</div></div>
<h3 class="h">Динамика просмотров${estNote(c)}</h3>${chart(dated(c, 'views'), '#ff3b1f')}
<h3 class="h">Прирост подписчиков за день${estNote(c)}</h3>${chart(dated(c, 'subs'), '#4a86c8')}
<div class="block" id="compsBlock" hidden><h3>Конкуренты</h3><p class="muted">Другие каналы той же ниши и на том же языке. Нажмите на строку — откроется разбор канала.</p><div class="table-wrap"><table class="comp"><thead><tr><th>Канал</th><th>Подп.</th><th>Видео</th><th>Ср. просм.</th><th>Доход/мес.</th><th>RPM</th><th>Язык</th><th>ИТВ</th></tr></thead><tbody>${comps.map(x => `<tr data-open="${esc(x.id)}"><td>${esc(x.title)}</td><td>${num(x.subs)}</td><td>${x.videos_count || 0}</td><td>${num(x.avg_views)}</td><td>~${num(monthly(x))} $</td><td>${money(x.rpm)}</td><td>${esc(langName(x.language))}</td><td>${entryIndex(x) ?? '—'}</td></tr>`).join('') || '<tr><td colspan="8">Нет других каналов</td></tr>'}</tbody></table></div></div>
<div class="block"><h3>Критерии отбора</h3><ul class="crit">${CRITERIA.map(([t, f]) => `<li class="${f(c) ? 'ok' : 'no'}">${f(c) ? '✓' : '✗'} ${esc(t)}</li>`).join('')}</ul><p class="muted">Лучший ролик — ${bestX(c).toFixed(1).replace('.', ',')}× от обычного.</p></div>
<div class="block"><h3>Стреляющий канал</h3><ul class="crit">${FIRE_CRITERIA.map(([t, f]) => `<li class="${f(c) ? 'ok' : 'no'}">${f(c) ? '✓' : '✗'} ${esc(t)}</li>`).join('')}</ul></div>${entryBlock(c)}${prospectsBlock(c)}`;
    $('#drawer').hidden = false; $('#drawerPanel').scrollTop = 0;
    $('#showComps')?.addEventListener('click', () => { const b = $('#compsBlock'); b.hidden = !b.hidden; if (!b.hidden) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }

  function render() {
    const counts = { new: state.all.filter(isNew).length, all: state.all.length, saved: state.all.filter(c => state.saved.has(c.id)).length, liked: state.all.filter(c => state.liked.has(c.id)).length, fire: state.all.filter(isFire).length };
    $$('[data-count]').forEach(el => { el.textContent = counts[el.dataset.count] ?? 0; });
    $$('[data-tab]').forEach(b => b.classList.toggle('is-on', b.dataset.tab === state.tab));
    const nich = state.tab === 'niches';
    $('#niches').hidden = !nich; $('#grid').hidden = nich;
    if (nich) { $('#niches').innerHTML = nichesTable(); $('#resultsInfo').textContent = Object.keys(state.clusters).length + ' групп ниш'; $('#empty').hidden = true; return; }
    const list = filtered();
    const nv = state.all.filter(c => c.verified === true).length, vb = $('#verifyInfo');
    vb.hidden = !$('#onlyVerified').checked || nv === state.all.length;
    vb.innerHTML = `<span>Проверено ИИ: <b>${nv}</b> из ${state.all.length} каналов. Каждый день в 7:00 МСК Gemini смотрит ролики ещё ~100 каналов, подтверждает нишу и поднишу и отсеивает неподходящие.</span><button type="button" class="btn" id="showUnverified">Показать непроверенные</button>`;
    $('#resultsInfo').textContent = `${list.length} ${plural(list.length, 'канал', 'канала', 'каналов')}` + (state.tab === 'fire' ? ` · до ${FIRE.videos} роликов, от ${fmt(FIRE.views)} просмотров на каждом, не больше ${FIRE.rivals} конкурентов` : '');
    if (state.group === 'channels') $('#grid').innerHTML = `<div class="cards">${list.map(card).join('')}</div>`;
    else {
      const key = state.group === 'niche' ? c => c.niche_ru || 'Другое' : c => { const v = entryIndex(c); return v == null ? 'Без оценки' : entryLabel(v)[0]; };
      const groups = new Map(); list.forEach(c => { const k = key(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
      const order = ['Отличный вход', 'Хороший вход', 'Вход с отстройкой', 'Последний вагон', 'Вход закрыт', 'Без оценки'];
      const entries = [...groups].sort((a, b) => state.group === 'compet' ? order.indexOf(a[0]) - order.indexOf(b[0]) : b[1].length - a[1].length);
      $('#grid').innerHTML = entries.map(([k, arr]) => `<h2 class="grp">${esc(k)} <span>${arr.length}</span></h2><div class="cards">${arr.map(card).join('')}</div>`).join('');
    }
    $('#empty').hidden = list.length > 0;
  }

  function toggle(set, key, id) { if (set.has(id)) set.delete(id); else set.add(id); saveSet(key, set); render(); if (!$('#drawer').hidden) openDrawer(id); }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-comps],[data-label],[data-niche-open],#exportLabels,[data-close],[data-open],[data-save],[data-like],[data-tab],#filtersToggle,#resetFilters,#refreshBtn,#refreshRun,#liveClear,#supportBtn,#supportSend,#sideToggle,#refreshSide,#supportSide,#burger,#showUnverified,#toTop');
    if (!t) return;
    if (t.dataset.label) { const k = t.dataset.label; if (state.labels[k] === t.dataset.val) delete state.labels[k]; else state.labels[k] = t.dataset.val; localStorage.setItem(LS.labels, JSON.stringify(state.labels)); render(); return; }
    if (t.dataset.nicheOpen) { state.tab = 'all'; $('#fNiche').value = t.dataset.nicheOpen; $('#fLang').value = (t.dataset.nicheLang || '').split('-')[0]; $('#filters').hidden = false; render(); return; }
    if (t.id === 'exportLabels') { exportLabels(); return; }
    if (t.hasAttribute('data-close')) { t.closest('.overlay').hidden = true; return; }
    if (t.id === 'toTop') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (t.id === 'showUnverified') { $('#onlyVerified').checked = false; render(); return; }
    if (t.id === 'sideToggle') { document.body.classList.toggle('side-min'); return; }
    if (t.id === 'burger') { document.body.classList.toggle('side-open'); return; }
    if (t.id === 'refreshSide') { openRefresh(); return; }
    if (t.id === 'supportSide') { $('#supportModal').hidden = false; return; }
    if (t.dataset.tab) { state.tab = t.dataset.tab; document.body.classList.remove('side-open'); render(); window.scrollTo({ top: 0 }); return; }
    if (t.dataset.save) { e.stopPropagation(); toggle(state.saved, LS.saved, t.dataset.save); return; }
    if (t.dataset.like) { e.stopPropagation(); toggle(state.liked, LS.liked, t.dataset.like); return; }
    if (t.dataset.comps) { e.stopPropagation(); openDrawer(t.dataset.comps); const b = $('#compsBlock'); if (b) { b.hidden = false; setTimeout(() => b.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); } return; }
    if (t.dataset.open) { openDrawer(t.dataset.open); return; }
    if (t.id === 'filtersToggle') { $('#filters').hidden = !$('#filters').hidden; return; }
    if (t.id === 'resetFilters') { $$('#filters select').forEach(s => { s.selectedIndex = 0; }); $('#subsMin').value = 0; $('#subsMax').value = $('#subsMax').max; $('#viewsMin').value = 0; $('#viewsMax').value = $('#viewsMax').max; $('#avgMin').value = 0; $('#avgMax').value = $('#avgMax').max; $('#rpmMin').value = 0; $('#rpmMax').value = 30; $('#onlyNew3').checked = $('#onlyUnseen').checked = false; $('#onlyRef').checked = true; $('#onlyVerified').checked = true; labs(); render(); return; }
    if (t.id === 'refreshBtn') { openRefresh(); return; }
    if (t.id === 'liveClear') { localStorage.removeItem(LS.live); localStorage.removeItem(LS.liveAt); location.reload(); return; }
    if (t.id === 'refreshRun') runLive();
    if (t.id === 'supportBtn') { $('#supportModal').hidden = false; return; }
    if (t.id === 'supportSend') { const text = $('#supportText').value.trim(); if (!text) return; const prev = loadArr(LS.support); prev.push({ text, at: new Date().toISOString() }); localStorage.setItem(LS.support, JSON.stringify(prev)); $('#supportOk').hidden = false; $('#supportText').value = ''; }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'search') { state.q = e.target.value; render(); }
    if (e.target.id === 'maxQueries') $('#maxQueriesVal').textContent = e.target.value;
    if (['subsMin', 'subsMax', 'viewsMin', 'viewsMax', 'avgMin', 'avgMax', 'rpmMin', 'rpmMax'].includes(e.target.id)) { if (+$('#subsMin').value > +$('#subsMax').value) $('#subsMin').value = $('#subsMax').value; labs(); render(); }
  });
  document.addEventListener('change', e => { if (e.target.id === 'sort') { state.sort = e.target.value; render(); } if (e.target.id === 'group') { state.group = e.target.value; render(); } if (e.target.closest('#filters')) render(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.overlay').forEach(o => o.hidden = true); });
  function openRefresh() {
    $('#refreshModal').hidden = false;
    const key = localStorage.getItem(LS.key);
    if (key) $('#apiKey').value = key;
    const q = localStorage.getItem(LS.maxQ);
    if (q) { $('#maxQueries').value = q; $('#maxQueriesVal').textContent = q; }
    if (key) runLive();
  }
  async function runLive() {
    if (state.liveRunning) return;
    const key = ($('#apiKey').value || '').trim();
    if (!key) { $('#refreshLog').textContent = 'Вставь ключ YouTube Data API v3'; return; }
    if (!window.NR_LIVE) { $('#refreshLog').textContent = 'Скрипт поиска не загрузился'; return; }
    state.liveRunning = true;
    localStorage.setItem(LS.key, key); localStorage.setItem(LS.maxQ, $('#maxQueries').value); $('#refreshProgress').hidden = false;
    try {
      const res = await window.NR_LIVE.run({ key, maxQueries: +$('#maxQueries').value, niche: $('#fNiche').value, lang: $('#fLang').value }, (t, f) => { $('#refreshLog').textContent = t; $('#refreshBar').style.width = Math.round((f || 0) * 100) + '%'; });
      const prev = loadArr(LS.live); const map = new Map(prev.map(c => [c.id, c])); (res.channels || []).forEach(c => map.set(c.id, c));
      localStorage.setItem(LS.live, JSON.stringify([...map.values()]));
      localStorage.setItem(LS.liveAt, new Date().toISOString());
      $('#refreshLog').textContent = `Готово: ${res.channels.length} каналов, ${res.units} ед. квоты` + (res.stopped ? ' · ' + res.stopped : '');
      setTimeout(() => location.reload(), 700);
    } catch (err) { $('#refreshLog').textContent = err.message || String(err); }
    finally { state.liveRunning = false; }
  }
  async function boot() {
    let data = { channels: [], generated_at: null };
    try { const r = await fetch('data/channels.json', { cache: 'no-store' }); if (r.ok) data = await r.json(); } catch {}
    try { const r = await fetch('collector/rpm_baseline.json', { cache: 'no-store' }); if (r.ok) state.rpm = await r.json(); } catch {}
    try { const r = await fetch('data/lang_checks.json', { cache: 'no-store' }); if (r.ok) state.langChecks = await r.json(); } catch {}
    state.clusters = data.clusters || {};
    const live = loadArr(LS.live).filter(c => c && c.id);
    const fresh = new Map(live.map(c => [c.id, c]));
    state.all = (data.channels || []).filter(c => !c.graduated || c.labeled_role).map(c => {
      const f = fresh.get(c.id); if (!f) return c;
      fresh.delete(c.id); return { ...c, ...f, added_at: c.added_at || f.added_at };
    }).concat([...fresh.values()]);
    state.size = state.all.reduce((m, c) => { m[c.cluster] = (m[c.cluster] || 0) + 1; return m; }, {});
    const fileAt = data.generated_at ? new Date(data.generated_at) : null;
    const rawAt = live.length ? localStorage.getItem(LS.liveAt) : null;
    const liveAt = rawAt && !isNaN(new Date(rawAt)) ? new Date(rawAt) : null;
    const when = liveAt && (!fileAt || liveAt > fileAt) ? liveAt : fileAt;
    $('#generatedAt').textContent = when ? 'Обновлено ' + when.toLocaleString('ru-RU') + (when === liveAt ? ' · в браузере: ' + live.length : '') : '';
    fillSelects(); render();
  }
  window.addEventListener('scroll', () => { $('#toTop').hidden = window.scrollY < 600; }, { passive: true });
  boot();
})();
