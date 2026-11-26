(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const catalogue = window.NR_CATALOGUE_TOOLS;
  const searchIndexes = new WeakMap();
  const LS = { saved: 'nr:saved', liked: 'nr:liked', seen: 'nr:seen', live: 'nr:live', liveAt: 'nr:liveAt', key: 'nr:apiKey', maxQ: 'nr:maxQueries', support: 'nr:support', labels: 'nr:labels' };
  const loadSet = k => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } };
  const saveSet = (k, set) => localStorage.setItem(k, JSON.stringify([...set]));
  const loadArr = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const state = { tab: 'all', q: '', sort: 'new', group: 'channels', supportedMarkets: {}, all: [], saved: loadSet(LS.saved), liked: loadSet(LS.liked), seen: loadSet(LS.seen), clusters: {}, size: {}, rpm: null, labels: (() => { try { return JSON.parse(localStorage.getItem('nr:labels') || '{}'); } catch { return {}; } })() };
  const LANG = { en: 'Английский', ru: 'Русский', es: 'Испанский', pt: 'Португальский', fr: 'Французский', de: 'Немецкий', it: 'Итальянский' };
  const fmt = n => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + ' млн'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.0', '') + ' тыс.'; return String(Math.round(n)); };
  const money = n => (Number(n) || 0).toFixed(2).replace('.', ',') + ' $';
  const num = n => Math.round(Number(n) || 0).toLocaleString('ru-RU');
  const dateRu = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString('ru-RU') : ''; };
  const agoRu = iso => { if (!iso) return ''; const d = Math.floor((Date.now() - new Date(iso)) / 864e5); if (d < 1) return 'сегодня'; if (d < 7) return `${d} дн назад`; if (d < 30) return `${Math.floor(d / 7)} нед назад`; if (d < 365) { const m = Math.floor(d / 30); return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')} назад`; } const y = Math.floor(d / 365); return `${y} ${plural(y, 'год', 'года', 'лет')} назад`; };
  // Every language a channel publishes in. Multi-language channels (one upload, several
  // title/audio tracks) used to be filed under whichever language YouTube happened to
  // return first, which quietly moved them out of their real competitive group.
  const primaryLang = catalogue.channelLanguage;
  const langsOf = c => [primaryLang(c)].filter(Boolean);
  const nicheOf = c => c.niche_ai || c.niche || '';
  // Channels collected before the language fix can still carry YouTube's default-locale
  // language while sitting in an English-speaking market — the exact shape of the bug that
  // filed a US channel under Spanish. Flag it instead of guessing: a re-run of the
  // collector resolves it from the channel's localizations.
  const EN_MARKETS = ['US', 'GB', 'CA', 'AU', 'NZ', 'IE'];
  const langDoubt = c => !c.language_source && EN_MARKETS.includes(c.country) && !langsOf(c).includes('en');
  const MAX_COMPETITORS = 20;
  const MAX_VIDEOS = 100;
  // Competitors come from `state.pool`, not `state.all`. `state.all` drops channels that
  // outgrew the catalogue (graduated) or stopped being re-found (stale), so a niche looked
  // emptiest exactly when its winners had grown — the rivals worth knowing about were the
  // ones being filtered out.
  function competitors(c) {
    const group = state.markets?.get(catalogue.marketKey(c, state.supportedMarkets)) || [];
    return group.filter(channel => channel.id !== c.id);
  }
  const compCount = c => {
    const group = state.markets?.get(catalogue.marketKey(c, state.supportedMarkets));
    return group ? group.length - 1 : 0;
  };
  const realComp = c => catalogue.competitionFor(c)?.index ?? null;
  const COMP_CLASS = { free: 'badge-green', moderate: 'badge-blue', competitive: 'badge-amber', saturated: 'badge-red' };
  const COMP_RU = { free: 'Свободно', moderate: 'Умеренно', competitive: 'Конкурентно', saturated: 'Переполнено' };
  const compVerdict = c => catalogue.competitionFor(c)?.verdict ?? null;
  const handleOf = c => c.handle ? '@' + c.handle.replace(/^@/, '') : '';
  const countryName = code => { if (!code) return '—'; try { return new Intl.DisplayNames(['ru'], { type: 'region' }).of(code) || code; } catch { return code; } };
  const STYLE_RU = { stock_footage: 'Стоковые видео', maps_graphics: 'Карты / графика', ai_images: 'ИИ-картинки', '2d_animation': '2D-анимация', '3d_animation': '3D-анимация', ai_video: 'ИИ-видео', highlights: 'Нарезки / шоу', illustrations: 'Иллюстрации', photos_stock: 'Фото / стоки', ai_illustrations: 'ИИ-иллюстрации', talking_head: 'Ведущий в кадре', screencast_slides: 'Скринкаст / слайды', stickman: 'Стикмены', code_generated: 'Производство кодом' };
  const styles = c => ((c.production_styles || []).length ? c.production_styles : [c.production_style]).filter(Boolean);
  const mix = c => (c.production_mix || []).filter(x => x.share >= 10);
  const isMixed = c => mix(c).length >= 2;
  const mixText = c => mix(c).map(x => `${styleName(x.style)} ${x.share}%`).join(' · ');
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
  const yt = (id, handle) => handle ? `https://www.youtube.com/@${encodeURIComponent(handle.replace(/^@/, ''))}` : `https://www.youtube.com/channel/${encodeURIComponent(id)}`;
  const vUrl = id => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const isNew = c => { const a = c.added_at || c.updated_at; return a && (Date.now() - new Date(a)) / 86400000 <= 7; };
  const isNew3 = c => { const a = c.added_at || c.updated_at; return a && (Date.now() - new Date(a)) / 86400000 <= 3; };
  const faceless = c => c.production_style !== 'talking_head';
  const monthly = c => c.monthly_income_est || ((c.views_per_day || 0) * 30 / 1000 * (c.rpm || 0));
  const monthlyViews = c => c.monthly_views_est ?? Math.round((c.views_per_day || 0) * 30);
  const LANG_ALL = { ...{ it: 'Итальянский', pl: 'Польский', hi: 'Хинди', id: 'Индонезийский', tr: 'Турецкий', ar: 'Арабский', ja: 'Японский', ko: 'Корейский' } };
  const languageNames = new Intl.DisplayNames(['ru'], { type: 'language' });
  const langName = l => {
    const code = catalogue.languageCode(l);
    const label = LANG[code] || LANG_ALL[code] || (code ? languageNames.of(code) : '');
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : '—';
  };
  const VERDICT_CLASS = { open: 'badge-green', filling: 'badge-amber', crowded: 'badge-red', unproven: 'badge-grey' };
  const VERDICT_HINT = { open: 'В выборке мало новичков, и часть уже набирает просмотры.', filling: 'В выборке несколько каналов с признаками спроса.', crowded: 'В выборке много каналов этого формата.', unproven: 'В выборке мало подтверждений устойчивого спроса.' };
  const clusterOf = c => state.clusters[catalogue.clusterKey(c, state.supportedMarkets)] || null;
  function prospects(c) {
    if (!state.rpm) return [];
    const nicheRpm = state.rpm.niches[c.niche] || state.rpm.niches.other;
    return Object.entries(state.supportedMarkets).map(([l, countries]) => {
      const region = state.rpm.country_to_region[countries[0]] || state.rpm.lang_to_region[l] || 'other';
      const rpm = nicheRpm[region] ?? nicheRpm.other;
      const income = Math.round(monthlyViews(c) / 1000 * rpm);
      const check = (state.langChecks || {})[c.niche + '|' + l];
      const ck = check?.market_verified && check.language === l && check.videos > 0
        && catalogue.allowedMarket(state.supportedMarkets, l, check.region_code) ? check : null;
      return { l, countries, rpm, income, ck, cur: primaryLang(c) === l };
    }).sort((a, b) => Number(b.cur) - Number(a.cur) || langName(a.l).localeCompare(langName(b.l), 'ru'));
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
    ['Авиация и самолёты', /\b(aviation|aircraft|planes?|airplanes?|pilots?|airlines?|aviação|avión|aviones|l'aviation)\b/i],
    ['Недвижимость и дома', /\b(real estate|houses?|homes?|farmhouses?|mansions?|acreage|land for sale|casas?|terreno)\b/i],
    ['Компании и бренды', /\b(compan(y|ies)|brands?|rise and fall|billionaires?|richest|factor(y|ies)|empresas?|firma)\b/i],
    ['Кулинария и продукты', /\b(cooking|recipes?|meats?|butcher|kitchen|beans|cocina|recetas?)\b/i],
    ['Сад и хозяйство', /\b(garden\w*|chickens?|homestead\w*|plants?|farm\w*|huerto)\b/i],
    ['Кино и сериалы', /\b(movies?|films?|ending explained|cinema|película|banned movies?)\b/i],
    ['Игры и лор', /\b(gta|games?|gaming|lore|easter eggs?|retro games?)\b/i],
    ['Marvel и DC', /\b(marvel|dc|villains?|superheroes?|avengers|batman|spider-?man)\b/i],
    ['Часы и обзоры вещей', /\b(watches|seiko|rolex|ranked by price|budget tools?)\b/i],
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
  // Was `state.size[c.cluster] - 1`, read off a `niche|style_group|language` key that
  // enrichment leaves stale whenever it reassigns a niche — so a channel could be counted
  // against a bucket it no longer belonged to.
  const FIRE = { videos: 10, views: 20000, rivals: 4, comp: 50 };
  const FIRE_CRITERIA = [
    [`Не больше ${FIRE.videos} длинных роликов — канал только начал`, c => longCount(c) <= FIRE.videos],
    [`Каждый ролик набрал от ${fmt(FIRE.views)} просмотров`, c => minVideoViews(c) >= FIRE.views],
    [`Не больше ${FIRE.rivals} конкурентов в той же нише и на том же языке`, c => !!primaryLang(c) && compCount(c) <= FIRE.rivals],
    [`Тема не переполнена на YouTube (индекс конкуренции до ${FIRE.comp})`, c => realComp(c) == null ? null : realComp(c) <= FIRE.comp],
  ];
  const EXTRA_RU = { own_product: 'Свой продукт', affiliate: 'Партнёрки', sponsors: 'Спонсоры', membership: 'Подписка/Patreon', merch: 'Мерч' };
  const flags = c => {
    const xs = (c.videos || []).map(v => outX(c, v)).sort((a, b) => b - a); const out = [];
    if (primaryLang(c) && compCount(c) <= 3 && (clusterOf(c)?.entry_score ?? 0) >= 65) out.push('Ранняя ниша');
    if (compVerdict(c) === 'saturated') out.push('Тема залита клонами');
    if (c.is_multilang) out.push('Несколько языков');
    if (langDoubt(c)) out.push('Язык под вопросом');
    if (xs[0] >= 5 && (xs[1] || 0) < 1.5) out.push('Один хит');
    return out;
  };
  const tagsOf = c => [...flags(c), ...(c.tags || [])];
  const isFire = c => (c.videos || []).length > 0 && FIRE_CRITERIA.every(([, f]) => f(c) !== false);
  const lastDays = c => { const t = Math.max(0, ...(c.videos || []).map(v => Date.parse(v.published_at || '') || 0)); return t ? (Date.now() - t) / 864e5 : 9999; };
  const CRITERIA = [
    ['Подписчиков от 500 до 300 тыс. — канал ещё небольшой', c => (c.subs || 0) >= 500 && (c.subs || 0) <= 300000],
    ['Всего просмотров от 200 тыс. — спрос уже доказан', c => (c.total_views || 0) >= 200000],
    ['На 1 подписчика ≥ 35 просмотров — ролики продвигает алгоритм', c => vps(c) >= 35],
    ['Есть прострел ≥ 2,5× от обычных просмотров канала', c => bestX(c) >= 2.5],
    ['Последний длинный ролик вышел не позже 90 дней назад — канал живой', c => lastDays(c) <= 90],
  ];
  const refMatch = c => CRITERIA.every(([, f]) => f(c));
  const entryIndex = c => { const group = clusterOf(c); if (!group || c.stale || c.graduated) return null; const { entry_score: score, verdict } = group; return verdict === 'crowded' ? Math.min(score, 40) : verdict === 'unproven' ? Math.min(score, 55) : score; };
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
  function channelMatches(channel, terms) {
    if (!terms.length) return true;
    if (!searchIndexes.has(channel)) {
      searchIndexes.set(channel, catalogue.makeSearchIndex(channel, subniches(channel), categories(channel)));
    }
    return catalogue.matches(searchIndexes.get(channel), terms);
  }
  function filtered() {
    const tag = $('#fTag').value, niche = $('#fNiche').value, sub = $('#fSub').value, cat = $('#fCat').value, lang = $('#fLang').value, format = $('#fFormat').value, style = $('#fStyle').value, diff = $('#fDiff').value, ai = $('#fAi').value, avatar = $('#fAvatar').value, face = $('#fFace').value, mon = $('#fMon').value, days = $('#fDays').value, extra = $('#fExtra').value, itv = $('#fItv').value;
    const sMin = +$('#subsMin').value, sMax = +$('#subsMax').value, vMin = +$('#viewsMin').value, vMax = +$('#viewsMax').value, aMin = +$('#avgMin').value, aMax = +$('#avgMax').value, rMin = +$('#rpmMin').value, rMax = +$('#rpmMax').value;
    const terms = catalogue.words(state.q);
    const country = $('#fCountry').value;
    let list = state.all.slice();
    if (state.tab === 'new') list = list.filter(isNew);
    if (state.tab === 'fire') list = list.filter(isFire);
    if (state.tab === 'live') list = list.filter(c => c.live);
    if (state.tab === 'saved') list = list.filter(c => state.saved.has(c.id));
    if (state.tab === 'liked') list = list.filter(c => state.liked.has(c.id));
    list = list.filter(c => {
      if (!channelMatches(c, terms)) return false;
      if (tag && !tagsOf(c).includes(tag)) return false;
      if (extra && !(c.extra_monetization || []).includes(extra)) return false;
      if (itv && (entryIndex(c) ?? -1) < +itv) return false;
      // This used to hide every channel with more than 20 catalogue competitors, which
      // removed exactly the channels needed to judge how crowded a niche is — and since a
      // mis-detected language produced a count of 0, the survivors all looked free.
      // Crowding is now judged by the YouTube probe, and only when it has actually run.
      if ($('#onlyFree').checked && (realComp(c) ?? Infinity) > 25) return false;
      const fm = $('#fMix').value; if ((fm === 'mixed' && !isMixed(c)) || (fm === 'single' && isMixed(c))) return false;
      const fc = $('#fComp').value; if (fc) { const [lo, hi] = fc.split('-').map(Number); const k = compCount(c); if (k < lo || (hi >= 0 && k > hi)) return false; }
      const fr = $('#fRealComp').value;
      if (fr) { const v = realComp(c); if (v == null || v > +fr) return false; }
      if (niche && c.niche !== niche && c.niche_ru !== niche) return false;
      if (sub && !subniches(c).includes(sub)) return false;
      if (cat && !categories(c).includes(cat)) return false;
      if (lang && primaryLang(c) !== lang) return false;
      if (country && c.country !== country) return false;
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
      if ($('#onlyRef').checked && !['fire', 'live'].includes(state.tab) && !refMatch(c)) return false;
      if ($('#onlyVerified').checked && state.tab !== 'live' && c.verified !== true) return false;
      return true;
    });
    const sorters = { new: (a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')) || (b.score || 0) - (a.score || 0), rpm: (a, b) => (b.rpm || 0) - (a.rpm || 0), growth: (a, b) => growth(b) - growth(a), outliers: (a, b) => outliers(b) - outliers(a) || bestX(b) - bestX(a), easy: (a, b) => (DIFF_ORDER[a.difficulty] ?? 1) - (DIFF_ORDER[b.difficulty] ?? 1) || (b.score || 0) - (a.score || 0), entry: (a, b) => (entryIndex(b) ?? -1) - (entryIndex(a) ?? -1), subs: (a, b) => (b.subs || 0) - (a.subs || 0), views: (a, b) => (b.total_views || 0) - (a.total_views || 0), income: (a, b) => monthly(b) - monthly(a), monetization: (a, b) => (a.days_to_monetization || 9e9) - (b.days_to_monetization || 9e9),
      // Unmeasured channels sort last either way: an unknown index is not evidence of a
      // free topic, and claiming otherwise is the mistake this whole change is undoing.
      freeTopic: (a, b) => (realComp(a) ?? 999) - (realComp(b) ?? 999) || (b.score || 0) - (a.score || 0),
      competition: (a, b) => (realComp(b) ?? -1) - (realComp(a) ?? -1) || compCount(b) - compCount(a) };
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
    fill('#fLang', Object.keys(state.supportedMarkets).sort((a, b) => langName(a).localeCompare(langName(b), 'ru')), langName);
    fillFilterCountries();
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
  // One pill per language the channel publishes in, so a channel that runs the same
  // videos in two languages is not shown as if it only had one audience.
  const langPills = c => langsOf(c).map(l => `<span class="pill" title="${l === primaryLang(c) ? 'Основной язык канала' : 'Дополнительный язык в метаданных'}">${esc(langName(l))}</span>`).join('');
  const compBadge = c => {
    const v = realComp(c), verdict = compVerdict(c);
    if (v == null || !verdict) return '<span class="badge badge-grey" title="Сборщик ещё не искал темы этого канала на YouTube">Конкуренция не проверена</span>';
    return `<span class="badge ${COMP_CLASS[verdict] || ''}" title="Индекс конкуренции на YouTube: ${v}/100">${esc(COMP_RU[verdict] || verdict)} (${v}/100)</span>`;
  };
  function card(c) {
    const comps = compCount(c);
    return `<article class="card" data-open="${esc(c.id)}"><div class="card-top"><img class="av" loading="lazy" src="${esc(c.thumbnail || '')}" alt=""><div class="who"><p class="ttl">${esc(c.title)}</p><div class="handle">${esc(handleOf(c))}</div></div><div class="pills">${isNew(c) ? '<span class="pill pill-new">Новое</span>' : ''}${isFire(c) ? '<span class="pill pill-fire">Стреляет</span>' : ''}${c.verified ? '<span class="pill pill-ok">Проверено ИИ</span>' : c.verified === false ? '<span class="pill">Отклонён ИИ</span>' : '<span class="pill">Не проверен</span>'}${langPills(c)}</div></div><div class="vts">${topVids(c, 3).map(v => vthumb(c, v)).join('')}</div><div class="nrow"><span>Ниша</span><span class="tag tag-b">${esc(c.niche_ai_ru || c.niche_ru || 'Другое')}</span></div><div class="nrow"><span>Подниша</span>${subniches(c).slice(0, 2).map(x => `<span class="tag tag-b">${esc(x)}</span>`).join('')}</div>${isMixed(c) ? `<div class="nrow"><span>Производство</span><span class="tag tag-mix">Смешанное: ${esc(mixText(c))}</span></div>` : ''}<div class="kpis3"><div><small>Подписчики</small><b>${num(c.subs)}</b></div><div><small>Просмотры</small><b>${num(c.total_views)}</b></div><div><small>RPM · оценка</small><b>${money(c.rpm)}</b></div></div>${entryBox(c, false)}<div class="nrow"><span>Конкуренция на YouTube</span>${compBadge(c)}</div>${flags(c).length ? `<div class="tags">${flags(c).map(f => `<span class="tag tag-o">${f}</span>`).join('')}</div>` : ''}<div class="foot"><button type="button" class="ic ${state.liked.has(c.id) ? 'on' : ''}" data-like="${esc(c.id)}" title="Нравится">${ICON.heart}</button><button type="button" class="ic ${state.saved.has(c.id) ? 'on' : ''}" data-save="${esc(c.id)}" title="Сохранить">${ICON.save}</button><button type="button" class="btn-comp" data-comps="${esc(c.id)}">Конкуренты (${comps})</button><button type="button" class="more" data-open="${esc(c.id)}">Подробнее →</button></div><div class="added">${esc(dateRu(c.added_at))}</div></article>`;
  }

  const MON = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
  const niceStep = x => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1)))); const m = x / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  function chart(pts, color, label) {
    if (!pts.length) return '<p class="muted">Для графика нужны два замера за выбранный период.</p>';
    const W = 640, H = 240, L = 70, B = 28, T = 12, R = 14;
    const vals = pts.map(p => p[1]); let lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
    const step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const t0 = Date.parse(pts[0][0]) - pts[0][2] * 86400000;
    const t1 = Date.parse(pts[pts.length - 1][0]);
    const X = t => L + (W - L - R) * (t - t0) / (t1 - t0), Y = v => T + (H - T - B) * (1 - (v - lo) / Math.max(1, hi - lo));
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="gl"/><text x="${L - 10}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${num(v)}</text>`;
    const ticks = Math.min(4, Math.round((t1 - t0) / 86400000));
    for (let i = 0; i <= ticks; i++) { const t = t0 + (t1 - t0) * i / ticks, d = new Date(t); g += `<text x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}">${d.getUTCDate()} ${MON[d.getUTCMonth()]}</text>`; }
    const xy = pts.map(p => [X(Date.parse(p[0])).toFixed(1), Y(p[1]).toFixed(1)]);
    return `<svg class="chart" role="img" aria-label="${esc(label)}" viewBox="0 0 ${W} ${H}">${g}<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="#d9dce3"/><polyline points="${xy.map(q => q.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>${xy.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="4" fill="${color}"><title>${dateRu(pts[i][0])} · ${num(pts[i][1])} в день${pts[i][2] > 1 ? ` · среднее за ${num(pts[i][2])} дн.` : ''}</title></circle>`).join('')}</svg>`;
  }

  function historyCharts(history, days) {
    return [['views', 'Изменение просмотров в день', '#ff3b1f'], ['subs', 'Изменение числа подписчиков в день', '#4a86c8']]
      .map(([metric, label, color]) => {
        const change = catalogue.measuredChange(history, metric, days);
        const total = change == null ? '' : `<p class="muted">За ${days} дн. · ${change > 0 ? '+' : ''}${num(change)}</p>`;
        return `<h4>${label}</h4>${total}${chart(catalogue.changeSeries(history, metric, days), color, label)}`;
      }).join('');
  }

  function entryBlock(c) {
    const g = clusterOf(c); if (!g) return '';
    return `<div class="block"><h3>Вход в нишу</h3><p><span class="badge ${VERDICT_CLASS[g.verdict] || ''}">${esc(g.verdict_ru || g.verdict)}</span> <b>Оценка входа: ${g.entry_score ?? '—'}/100</b></p><p class="muted">${esc(VERDICT_HINT[g.verdict] || '')}</p><div class="meta-grid"><div><small>Каналов в группе</small><b>${g.n}</b></div><div><small>Растут (≥20 тыс. на первых 5)</small><b>${Math.round((g.share_growing || 0) * 100)}%</b></div><div><small>Медиана просм./видео</small><b>${fmt(g.median_vpv)}</b></div><div><small>Новых за 30 дн.</small><b>${g.newcomers_30d}</b></div></div></div>`;
  }
  function prospectsBlock(c) {
    const rows = prospects(c); if (!rows.length) return '';
    const content = rows.map(row => {
      const countries = row.countries.map(countryName).join(', ');
      const reading = row.ck ? num(row.ck.channels) + ' · ' + countryName(row.ck.region_code) : '—';
      return `<tr${row.cur ? ' class="cur"' : ''}><td>${esc(langName(row.l))}</td><td>${esc(countries)}</td><td>${money(row.rpm)}</td><td>${esc(reading)}</td><td>~${fmt(row.income)} $</td></tr>`;
    }).join('');
    return `<div class="block"><h3>Рынки по языкам</h3><p class="muted">Число каналов относится к отдельной выборке YouTube для каждого языка. RPM и доход — ориентиры по первой стране в строке при текущих ${fmt(monthlyViews(c))} просмотрах в месяц.</p><div class="table-wrap"><table class="comp"><thead><tr><th>Язык</th><th>Страны каналов</th><th>RPM, оценка</th><th>Каналов в выборке · регион поиска</th><th>Доход/мес., оценка</th></tr></thead><tbody>${content}</tbody></table></div></div>`;
  }
  const COMP_HINT = {
    free: 'Эту тему почти никто не делает — можно заходить.',
    moderate: 'Тему делают, но копий заголовка мало — нужен свой угол подачи.',
    competitive: 'Заголовки канала уже копируют. Выделяться придётся не темой, а подачей и превью.',
    saturated: 'Тема залита клонами: тот же заголовок выпускают многие каналы. Входить сюда поздно.',
  };
  function competitionBlock(c) {
    const k = catalogue.competitionFor(c);
    const probe = topVids(c, 1)[0] ? '<form id="competitionForm" class="competition-form"><button type="submit" class="btn">Проверить конкуренцию на YouTube</button><label id="competitionKeyLabel" hidden>Ключ YouTube Data API v3<input id="competitionKey" type="password" autocomplete="off"></label><small class="muted">Один поисковый запрос по заголовку популярного ролика</small><p id="competitionStatus" class="muted" role="status" hidden></p></form>' : '';
    if (!k) {
      return '<div class="block" id="competitionBlock"><h3>Конкуренция на YouTube</h3><p class="muted">Для этого языка и рынка замер пока недоступен.</p>' + probe + '</div>';
    }
    const rows = (k.top_rivals || []).map(r => `<tr><td>${esc(r.title || r.id)}</td><td>${esc(countryName(r.country))}</td><td>${r.subs != null ? num(r.subs) : '—'}</td><td>${r.videos || 0}</td><td>${Math.round((r.best_overlap || 0) * 100)}%</td><td>${r.clone ? '<span class="badge badge-red">копия заголовка</span>' : '<span class="badge badge-grey">та же тема</span>'}</td><td>${esc(agoRu(r.latest))}</td></tr>`).join('');
    const clones = (k.clone_examples || []).map(x => `<tr><td>${esc(x.channel)}</td><td>${esc(x.title)}</td><td>${Math.round((x.overlap || 0) * 100)}%</td><td>${esc(agoRu(x.published_at))}</td></tr>`).join('');
    return `<div class="block" id="competitionBlock"><h3>Конкуренция на YouTube · ${esc(langName(k.language))}</h3><p>${compBadge(c)}</p><p class="muted">${esc(COMP_HINT[k.verdict] || '')}</p>
<p class="muted small">Замер от ${esc(dateRu(k.checked_at))}. Регион выдачи — ${esc(countryName(k.region_code))}. Язык и страна подтверждены у ${num(k.videos_seen)} из ${num(k.raw_videos)} роликов в выборке.</p>${probe}
<div class="meta-grid"><div><small>Каналов на эти темы</small><b>${k.rival_channels ?? '—'}</b></div><div><small>Копируют заголовок</small><b>${k.clone_channels ?? '—'}</b></div><div><small>Копий заголовка</small><b>${k.clone_videos ?? '—'}</b></div><div><small>Копий за 30 дней</small><b>${k.clones_30d ?? '—'}</b></div><div><small>Крупных конкурентов</small><b>${k.big_rivals ?? '—'}</b></div><div><small>Медиана подписчиков</small><b>${k.median_rival_subs != null ? num(k.median_rival_subs) : '—'}</b></div></div>
${clones ? `<h3 class="h">Копии заголовков</h3><div class="table-wrap"><table class="comp"><thead><tr><th>Канал</th><th>Заголовок</th><th>Совпадение</th><th>Когда</th></tr></thead><tbody>${clones}</tbody></table></div>` : ''}
${rows ? `<h3 class="h">Кто ещё делает эти темы</h3><div class="table-wrap"><table class="comp"><thead><tr><th>Канал</th><th>Страна</th><th>Подп.</th><th>Роликов в выдаче</th><th>Совпадение</th><th>Тип</th><th>Последний</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}</div>`;
  }
  function openDrawer(id) {
    const c = state.all.find(x => x.id === id) || state.pool?.find(x => x.id === id); if (!c) return;
    state.seen.add(id); saveSet(LS.seen, state.seen);
    const vids = topVids(c, 10);
    const byScore = (a, b) => (b.score || 0) - (a.score || 0);
    const comps = competitors(c).sort(byScore).slice(0, MAX_COMPETITORS);
    const history = catalogue.snapshots(c.daily);
    const banner = c.banner || (vids[0] ? `https://i.ytimg.com/vi/${vids[0].id}/hq720.jpg` : '');
    const extra = (c.extra_monetization || []).map(x => EXTRA_RU[x] || x).join(', ');
    const kpi = [['Подписчики', num(c.subs)], ['Просмотры', num(c.total_views)], ['Видео', num(c.videos_count)], ['RPM (оценка)', money(c.rpm)], ['RPM Shorts', money(c.rpm_short ?? (c.rpm || 0) * 0.08)], ['RPM длинных видео', money(c.rpm_long ?? c.rpm)], ['Прострелов', outliers(c)], ['Страна', countryName(c.country)], ['Язык', langsOf(c).map(langName).join(', ')], ['Конкуренция на YouTube', realComp(c) != null ? `${COMP_RU[compVerdict(c)] || ''} ${realComp(c)}/100` : 'не проверена'], ['Конкурентов в базе', primaryLang(c) ? `${compCount(c)} · ${langName(primaryLang(c))}` : 'Язык не определён'], ['Сложность производства', c.difficulty_ru || '—'], ['Использование ИИ', AI_RU[aiMode(c)]], ['Доп. монетизация', extra || '—'], ['Доход / мес.', '~' + num(monthly(c)) + ' $'], ['Монетизация YouTube', c.is_monetized ? 'Монетизирован' : c.is_monetized === false ? 'Не монетизирован' : 'Неизвестно'], ['До монетизации', c.is_monetized ? '—' : c.monetization_forecast || '—'], ['Формат контента', CONTENT_RU[contentType(c)]]];
    const trow = (label, items, cls) => items.length ? `<div class="trow"><span>${label}</span>${items.map(x => `<span class="tag ${cls}">${esc(x)}</span>`).join('')}</div>` : '';
    $('#drawerPanel').innerHTML = `<button type="button" class="x-close" data-close>× Закрыть</button>${banner ? `<img class="banner" src="${esc(banner)}" alt="">` : ''}<div class="m-head"><img class="av" src="${esc(c.thumbnail || '')}" alt=""><div><h2>${esc(c.title)}</h2><div class="handle">${esc(handleOf(c))}</div></div><div class="m-act"><button type="button" class="ic ${state.liked.has(c.id) ? 'on' : ''}" data-like="${esc(c.id)}" title="Нравится">${ICON.heart}</button><button type="button" class="ic ${state.saved.has(c.id) ? 'on' : ''}" data-save="${esc(c.id)}" title="Сохранить">${ICON.save}</button><a class="ic" href="${yt(c.id, c.handle)}" target="_blank" rel="noopener" title="Открыть на YouTube">${ICON.ext}</a><button type="button" class="btn-out" id="showComps">Конкуренты</button></div></div>
<div class="kpi">${kpi.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>${c.verified === false ? `<div class="warn"><b>Отклонён ИИ.</b> ${esc(c.reject_reason || '')}</div>` : c.verified !== true ? '<div class="warn">Канал ещё не проверен ИИ — ниша и подниша определены автоматически по названиям роликов и могут быть неточными.</div>' : ''}${risky(c) ? '<div class="warn"><b>Высокие риски.</b> Ниша может чаще получать ограничения монетизации.</div>' : ''}
${isMixed(c) ? trow('Смешанное производство', mix(c).map(x => `${styleName(x.style)} ${x.share}%`), 'tag-mix') : ''}${trow('Стиль производства', styles(c).map(styleName), 'tag-o')}${trow('Категории', categories(c).slice(0, 6), 'tag-g')}${trow('Ниша', [c.niche_ai_ru || c.niche_ru || 'Другое'], 'tag-b')}${trow('Подниша', subniches(c).slice(0, 3), 'tag-p')}${trow('Метки', flags(c), 'tag-o')}
<h3 class="h">Описание ниши</h3><p class="notes">${esc(c.notes_ru || describeRu(c))}</p>${c.notes_ru ? `<details><summary class="muted">Сводка по цифрам</summary><p class="notes">${esc(describeRu(c))}</p></details>` : ''}
<div style="margin-top:18px">${entryBox(c, true)}</div><p class="muted small">Обновлено: ${esc(dateRu(c.updated_at))}</p>
${c.description ? `<h3 class="h">Описание</h3><p class="notes">${esc(c.description)}</p>` : ''}
<h3 class="h">Топ-10 видео</h3><div class="vts vts-3">${vids.map(v => vthumb(c, v)).join('')}</div>
<section class="block"><div class="history-head"><h3>Динамика канала</h3><select id="historyDays" aria-label="Период графика"><option value="7">7 дней</option><option value="30" selected>30 дней</option><option value="90">90 дней</option></select></div><p class="muted">Публичные замеры YouTube${history.length ? ` по ${esc(dateRu(history.at(-1).date))}` : ''}. При пропусках показано среднее изменение за интервал.</p><div id="historyCharts">${historyCharts(history, 30)}</div></section>
<div class="block" id="compsBlock" hidden><h3>Конкуренты в базе</h3><p class="muted">${primaryLang(c) ? `Та же ниша и основной язык: ${esc(langName(primaryLang(c)))}. Показано ${comps.length} из ${compCount(c)}.` : 'Основной язык канала не определён.'}</p><div class="table-wrap"><table class="comp"><thead><tr><th>Канал</th><th>Подп.</th><th>Видео</th><th>Ср. просм.</th><th>Доход/мес.</th><th>RPM</th><th>Язык</th><th>ИТВ</th></tr></thead><tbody>${comps.map(x => `<tr data-open="${esc(x.id)}"><td>${esc(x.title)}${x.graduated ? ' <small class="muted">(вырос)</small>' : ''}</td><td>${num(x.subs)}</td><td>${x.videos_count || 0}</td><td>${num(x.avg_views)}</td><td>~${num(monthly(x))} $</td><td>${money(x.rpm)}</td><td>${esc(langName(primaryLang(x)))}</td><td>${entryIndex(x) ?? '—'}</td></tr>`).join('') || '<tr><td colspan="8">Нет других каналов</td></tr>'}</tbody></table></div></div>${competitionBlock(c)}
<div class="block"><h3>Критерии отбора</h3><ul class="crit">${CRITERIA.map(([t, f]) => `<li class="${f(c) ? 'ok' : 'no'}">${f(c) ? '✓' : '✗'} ${esc(t)}</li>`).join('')}</ul><p class="muted">Лучший ролик — ${bestX(c).toFixed(1).replace('.', ',')}× от обычного.</p></div>
<div class="block"><h3>Стреляющий канал</h3><ul class="crit">${FIRE_CRITERIA.map(([text, test]) => { const result = test(c); return result == null ? '<li class="muted">— Конкуренция на YouTube ещё не измерена</li>' : `<li class="${result ? 'ok' : 'no'}">${result ? '✓' : '✗'} ${esc(text)}</li>`; }).join('')}</ul></div>${entryBlock(c)}${prospectsBlock(c)}`;
    $('#drawer').hidden = false; $('#drawerPanel').scrollTop = 0;
    $('#historyDays').addEventListener('change', e => { $('#historyCharts').innerHTML = historyCharts(history, +e.target.value); });
    $('#competitionForm')?.addEventListener('submit', event => runCompetition(event, c, vids[0].title_original || vids[0].title));
    $('#showComps')?.addEventListener('click', () => { const b = $('#compsBlock'); b.hidden = !b.hidden; if (!b.hidden) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }

  async function runCompetition(event, channel, title) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('button', form);
    const input = $('#competitionKey', form);
    const status = $('#competitionStatus', form);
    if (button.disabled) return;
    const key = input.value.trim() || localStorage.getItem(LS.key);
    status.hidden = false;
    if (!key) {
      $('#competitionKeyLabel', form).hidden = false;
      input.focus();
      status.textContent = 'Введите ключ YouTube Data API v3 и запустите проверку.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Проверяю язык роликов и страну каналов…';
    try {
      const { patch } = await window.NR_LIVE.probeCompetition({
        key, channelId: channel.id, title, language: primaryLang(channel), region: channel.country,
        markets: state.supportedMarkets, catalogue: state.knownChannels,
      });
      if (!patch) {
        status.textContent = 'В выдаче не нашлось роликов с подтверждённым языком от каналов на этом рынке.';
        return;
      }
      const records = new Map(loadArr(LS.live).map(record => [record.id, record]));
      records.set(channel.id, { ...records.get(channel.id), id: channel.id, ...patch });
      localStorage.setItem(LS.live, JSON.stringify([...records.values()]));
      localStorage.setItem(LS.key, key);
      Object.assign(channel, patch);
      render();
      if (form.isConnected && !$('#drawer').hidden) {
        openDrawer(channel.id);
        const result = $('#competitionStatus');
        result.hidden = false;
        result.textContent = 'Замер сохранён в этом браузере.';
        $('#competitionBlock').scrollIntoView({ block: 'start' });
      }
    } catch (error) { status.textContent = error.message || 'Не удалось измерить конкуренцию.'; }
    finally { button.disabled = false; }
  }

  function render() {
    const counts = { new: state.all.filter(isNew).length, all: state.all.length, saved: state.all.filter(c => state.saved.has(c.id)).length, liked: state.all.filter(c => state.liked.has(c.id)).length, fire: state.all.filter(isFire).length };
    $$('[data-count]').forEach(el => { el.textContent = counts[el.dataset.count] ?? 0; });
    $$('[data-tab]').forEach(b => b.classList.toggle('is-on', b.dataset.tab === state.tab));
    $('#liveTab').hidden = !state.all.some(channel => channel.live);
    const nich = state.tab === 'niches';
    const topic = state.tab === 'topic';
    $('#niches').hidden = !nich; $('#grid').hidden = nich || topic;
    $('#catalogueControls').hidden = topic || nich;
    $('#topic').hidden = !topic;
    if (topic) { $('#resultsInfo').textContent = ''; $('#empty').hidden = true; return; }
    if (nich) { $('#niches').innerHTML = nichesTable(); $('#resultsInfo').textContent = Object.keys(state.clusters).length + ' групп ниш'; $('#empty').hidden = true; return; }
    const list = filtered();
    const nv = state.all.filter(c => c.verified === true).length, vb = $('#verifyInfo');
    vb.hidden = state.tab === 'live' || !$('#onlyVerified').checked || nv === state.all.length;
    vb.innerHTML = `<span>Проверено ИИ: <b>${nv}</b> из ${state.all.length} каналов. Каждый день в 7:00 МСК Gemini смотрит ролики ещё ~100 каналов, подтверждает нишу и поднишу и отсеивает неподходящие.</span><button type="button" class="btn" id="showUnverified">Показать непроверенные</button>`;
    $('#resultsInfo').textContent = `${list.length} ${plural(list.length, 'канал', 'канала', 'каналов')}` + (state.tab === 'fire' ? ` · до ${FIRE.videos} роликов, от ${fmt(FIRE.views)} просмотров на каждом, не больше ${FIRE.rivals} конкурентов` : '');
    if (state.group === 'channels') $('#grid').innerHTML = `<div class="cards">${list.map(card).join('')}</div>`;
    else {
      const key = state.group === 'language' ? c => langName(primaryLang(c))
        : state.group === 'niche' ? c => c.niche_ai_ru || c.niche_ru || 'Другое' : c => { const v = entryIndex(c); return v == null ? 'Без оценки' : entryLabel(v)[0]; };
      const groups = new Map(); list.forEach(c => { const k = key(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
      const order = ['Отличный вход', 'Хороший вход', 'Вход с отстройкой', 'Последний вагон', 'Вход закрыт', 'Без оценки'];
      const entries = [...groups].sort((a, b) => state.group === 'compet' ? order.indexOf(a[0]) - order.indexOf(b[0]) : b[1].length - a[1].length);
      $('#grid').innerHTML = entries.map(([k, arr]) => `<h2 class="grp">${esc(k)} <span>${arr.length}</span></h2><div class="cards">${arr.map(card).join('')}</div>`).join('');
    }
    $('#empty').hidden = list.length > 0;
    // Filtering by measured competition returns nothing until the probe has run, which
    // looks like a broken filter rather than missing data. Say which it is.
    if (!list.length) {
      const needsProbe = ($('#fRealComp').value || $('#onlyFree').checked) && !state.all.some(c => realComp(c) != null);
      $('#empty').querySelector('p').textContent = needsProbe
        ? 'Конкуренция на YouTube ещё ни по одному каналу не измерена — запустите collector/competition.py, тогда этот фильтр заработает.'
        : 'Сбросьте фильтры или нажмите «Обновить каналы».';
    }
  }

  function toggle(set, key, id) { if (set.has(id)) set.delete(id); else set.add(id); saveSet(key, set); render(); if (!$('#drawer').hidden) openDrawer(id); }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-comps],[data-label],[data-niche-open],#exportLabels,[data-close],[data-open],[data-save],[data-like],[data-tab],#filtersToggle,#resetFilters,#refreshBtn,#refreshRun,#liveClear,#supportBtn,#supportSend,#sideToggle,#refreshSide,#supportSide,#burger,#showUnverified,#toTop,#openTopic,#viewLive');
    if (!t) return;
    if (t.dataset.label) { const k = t.dataset.label; if (state.labels[k] === t.dataset.val) delete state.labels[k]; else state.labels[k] = t.dataset.val; localStorage.setItem(LS.labels, JSON.stringify(state.labels)); render(); return; }
    if (t.dataset.nicheOpen) { state.tab = 'all'; $('#fNiche').value = t.dataset.nicheOpen; $('#fLang').value = catalogue.languageCode(t.dataset.nicheLang); fillFilterCountries(); $('#filters').hidden = false; render(); return; }
    if (t.id === 'exportLabels') { exportLabels(); return; }
    if (t.hasAttribute('data-close')) { t.closest('.overlay').hidden = true; return; }
    if (t.id === 'toTop') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (t.id === 'showUnverified') { $('#onlyVerified').checked = false; render(); return; }
    if (t.id === 'sideToggle') { document.body.classList.toggle('side-min'); return; }
    if (t.id === 'burger') { document.body.classList.toggle('side-open'); return; }
    if (t.id === 'refreshSide') { openRefresh(); return; }
    if (t.id === 'supportSide') { $('#supportModal').hidden = false; return; }
    if (t.id === 'openTopic') {
      if (state.q.trim()) $('#topicQuery').value = state.q.trim();
      const language = $('#fLang').value;
      if (language) $('#topicLang').value = language;
      fillTopicCountries();
      const country = $('#fCountry').value;
      if (catalogue.allowedMarket(state.supportedMarkets, $('#topicLang').value, country)) $('#topicCountry').value = country;
      openTopic();
      $('#topicQuery').focus();
      return;
    }
    if (t.dataset.tab === 'topic') { openTopic(); return; }
    if (t.dataset.tab) { state.tab = t.dataset.tab; document.body.classList.remove('side-open'); render(); window.scrollTo({ top: 0 }); return; }
    if (t.dataset.save) { e.stopPropagation(); toggle(state.saved, LS.saved, t.dataset.save); return; }
    if (t.dataset.like) { e.stopPropagation(); toggle(state.liked, LS.liked, t.dataset.like); return; }
    if (t.dataset.comps) { e.stopPropagation(); openDrawer(t.dataset.comps); const b = $('#compsBlock'); if (b) { b.hidden = false; setTimeout(() => b.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); } return; }
    if (t.dataset.open) { openDrawer(t.dataset.open); return; }
    if (t.id === 'filtersToggle') { $('#filters').hidden = !$('#filters').hidden; return; }
    if (t.id === 'resetFilters') { $$('#filters select').forEach(s => { s.selectedIndex = 0; }); $('#subsMin').value = 0; $('#subsMax').value = $('#subsMax').max; $('#viewsMin').value = 0; $('#viewsMax').value = $('#viewsMax').max; $('#avgMin').value = 0; $('#avgMax').value = $('#avgMax').max; $('#rpmMin').value = 0; $('#rpmMax').value = 30; $('#onlyFree').checked = $('#onlyNew3').checked = $('#onlyUnseen').checked = false; $('#onlyRef').checked = true; $('#onlyVerified').checked = true; fillFilterCountries(); labs(); render(); return; }
    if (t.id === 'viewLive') {
      $('#refreshModal').hidden = true;
      state.tab = 'live';
      $('#search').value = state.q = '';
      $('#resetFilters').click();
      window.scrollTo({ top: 0 });
      return;
    }
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
  document.addEventListener('change', e => { if (e.target.id === 'sort') { state.sort = e.target.value; render(); } if (e.target.id === 'group') { state.group = e.target.value; render(); } if (e.target.id === 'fLang') fillFilterCountries(); if (e.target.closest('#filters')) render(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.overlay').forEach(o => o.hidden = true); });

  const optionsFor = (values, label) => values.map(value =>
    `<option value="${esc(value)}">${esc(label(value))}</option>`).join('');

  function fillFilterCountries() {
    const field = $('#fCountry');
    const previous = field.value;
    const language = $('#fLang').value;
    const countries = language ? state.supportedMarkets[language] || []
      : [...new Set(Object.values(state.supportedMarkets).flat())];
    const ordered = countries.slice().sort((a, b) => countryName(a).localeCompare(countryName(b), 'ru'));
    field.innerHTML = '<option value="">Все поддерживаемые страны</option>' + optionsFor(ordered, countryName);
    if (countries.includes(previous)) field.value = previous;
  }

  function fillTopicLanguages() {
    $('#topicLang').innerHTML = optionsFor(Object.keys(state.supportedMarkets), langName);
    fillTopicCountries();
  }

  function fillTopicCountries() {
    const field = $('#topicCountry');
    const previous = field.value;
    const countries = state.supportedMarkets[$('#topicLang').value] || [];
    field.innerHTML = optionsFor(countries, countryName);
    if (countries.includes(previous)) field.value = previous;
  }

  function openTopic() {
    state.tab = 'topic';
    document.body.classList.remove('side-open');
    if (!$('#topicKey').value) $('#topicKey').value = localStorage.getItem(LS.key) || '';
    $('#topicKeyDetails').open = !$('#topicKey').value;
    render();
  }

  function topicResults({ channels, videos }) {
    const orderedViews = videos.map(video => video.views).sort((a, b) => a - b);
    const mid = Math.floor(orderedViews.length / 2);
    const medianViews = (orderedViews[mid] + orderedViews[Math.floor((orderedViews.length - 1) / 2)]) / 2;
    const known = new Set((state.pool || []).map(channel => channel.id));
    const channelsTable = channels.map(channel => `<tr><td>${known.has(channel.id)
      ? `<button type="button" class="text-link" data-open="${esc(channel.id)}">${esc(channel.title)}</button>`
      : `<a class="text-link" href="${yt(channel.id)}" target="_blank" rel="noopener">${esc(channel.title)}</a>`}</td><td>${channel.subs == null ? '—' : num(channel.subs)}</td><td>${channel.total_videos == null ? '—' : num(channel.total_videos)}</td><td>${num(channel.matched)}</td><td>${num(channel.views)}</td><td>${esc(dateRu(channel.created_at)) || '—'}</td><td><a class="text-link" href="${vUrl(channel.top_video.id)}" target="_blank" rel="noopener">${esc(channel.top_video.title)}</a></td></tr>`).join('');
    const videosTable = videos.map(video => `<tr><td><a class="text-link" href="${vUrl(video.id)}" target="_blank" rel="noopener">${esc(video.title)}</a></td><td>${esc(video.channel_title)}</td><td>${num(video.views)}</td><td>${esc(dateRu(video.published_at)) || '—'}</td><td>${video.duration_sec ? `${Math.floor(video.duration_sec / 60)}:${String(video.duration_sec % 60).padStart(2, '0')}` : '—'}</td></tr>`).join('');
    return `<div class="block"><h3>Выдача YouTube</h3><div class="meta-grid"><div><small>Роликов в выборке</small><b>${videos.length}</b></div><div><small>Каналов в выборке</small><b>${channels.length}</b></div><div><small>Медиана просмотров</small><b>${num(medianViews)}</b></div></div><p class="muted">Показатели рассчитаны по возвращённым роликам. Просмотры указаны за всё время с момента публикации.</p></div>
      <div class="block"><h3>Каналы по теме</h3><div class="table-wrap"><table class="comp"><thead><tr><th>Канал</th><th>Подписчики</th><th>Всего видео</th><th>Видео в выдаче</th><th>Просмотры в выдаче</th><th>Создан</th><th>Лучший ролик в выдаче</th></tr></thead><tbody>${channelsTable}</tbody></table></div></div>
      <div class="block"><h3>Ролики по теме</h3><div class="table-wrap"><table class="comp"><thead><tr><th>Ролик</th><th>Канал</th><th>Просмотры</th><th>Опубликован</th><th>Длительность</th></tr></thead><tbody>${videosTable}</tbody></table></div></div>`;
  }

  $('#topicForm').addEventListener('submit', async event => {
    event.preventDefault();
    const key = $('#topicKey').value.trim();
    const button = $('#topicRun');
    const status = $('#topicStatus');
    if (button.disabled) return;
    if (!key) {
      $('#topicKeyDetails').open = true;
      $('#topicKey').focus();
      status.textContent = 'Введите ключ YouTube Data API v3.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Ищу ролики на YouTube…';
    $('#topicResults').replaceChildren();
    try {
      const query = $('#topicQuery').value.trim();
      const language = $('#topicLang').value;
      const region = $('#topicCountry').value;
      const result = await window.NR_LIVE.searchTopic({
        key, query, days: +$('#topicDays').value,
        language, region, order: $('#topicOrder').value,
        markets: state.supportedMarkets, catalogue: state.knownChannels,
      });
      localStorage.setItem(LS.key, key);
      status.textContent = result.videos.length ? `Тема «${query}» · ${langName(language)} · ${countryName(region)}` : (result.rawVideos ? 'В выборке нет роликов с подтверждённым языком от каналов из выбранной страны. Попробуйте другой запрос или период.' : 'YouTube не вернул роликов по теме. Измените запрос или период.');
      if (result.videos.length) $('#topicResults').innerHTML = topicResults(result);
    } catch (error) { status.textContent = error.message || 'Не удалось выполнить поиск.'; }
    finally { button.disabled = false; }
  });

  function openRefresh() {
    $('#refreshModal').hidden = false;
    const key = localStorage.getItem(LS.key);
    if (key) $('#apiKey').value = key;
    const q = localStorage.getItem(LS.maxQ);
    if (q) { $('#maxQueries').value = q; $('#maxQueriesVal').textContent = q; }
  }
  async function runLive() {
    if (state.liveRunning) return;
    const key = ($('#apiKey').value || '').trim();
    if (!key) { $('#refreshLog').textContent = 'Вставь ключ YouTube Data API v3'; return; }
    if (!window.NR_LIVE) { $('#refreshLog').textContent = 'Скрипт поиска не загрузился'; return; }
    state.liveRunning = true;
    $('#viewLive').hidden = true;
    localStorage.setItem(LS.key, key); localStorage.setItem(LS.maxQ, $('#maxQueries').value); $('#refreshProgress').hidden = false;
    try {
      const res = await window.NR_LIVE.run({
        key, maxQueries: +$('#maxQueries').value, niche: $('#fNiche').value, lang: $('#fLang').value,
        // Searches are planned from what the catalogue already knows, so a run digs into
        // proven clusters instead of sampling unrelated niches at random.
        catalogue: state.pool, knownCatalogue: state.knownChannels, markets: state.supportedMarkets, region: $('#fCountry').value,
      }, (t, f) => { $('#refreshLog').textContent = t; $('#refreshBar').style.width = Math.round((f || 0) * 100) + '%'; });
      const prev = loadArr(LS.live); const map = new Map(prev.map(c => [c.id, c])); (res.channels || []).forEach(c => map.set(c.id, c));
      // Competition readings for channels already in channels.json are stored as
      // id-plus-competition patches; boot() spreads live records over the catalogue entry,
      // so a partial record updates that channel instead of replacing it.
      (res.competition || []).forEach(p => map.set(p.id, { ...(map.get(p.id) || {}), ...p }));
      localStorage.setItem(LS.live, JSON.stringify([...map.values()]));
      localStorage.setItem(LS.liveAt, new Date().toISOString());
      const measured = (res.competition || []).length + (res.channels || []).filter(c => c.competition).length;
      $('#refreshLog').textContent = `Готово: ${res.channels.length} новых каналов, конкуренция измерена у ${measured}. `
        + `Запросов: ${res.mined} по кластерам, ${res.explored} на разведку`
        + (res.stopped ? ' · ' + res.stopped : '');
      applyCatalogue(state.baseData);
      $('#viewLive').hidden = !state.all.some(channel => channel.live);
    } catch (err) { $('#refreshLog').textContent = err.message || String(err); }
    finally { state.liveRunning = false; }
  }
  async function boot() {
    let data = { channels: [], generated_at: null };
    try { const r = await fetch('data/channels.json', { cache: 'no-store' }); if (r.ok) data = await r.json(); } catch {}
    try { const r = await fetch('collector/rpm_baseline.json', { cache: 'no-store' }); if (r.ok) state.rpm = await r.json(); } catch {}
    try { const r = await fetch('data/lang_checks.json', { cache: 'no-store' }); if (r.ok) state.langChecks = await r.json(); } catch {}
    try {
      const response = await fetch('collector/markets.json');
      if (!response.ok) throw new Error('Не удалось загрузить список рынков');
      state.supportedMarkets = await response.json();
    } catch {
      $('#resultsInfo').textContent = 'Не удалось загрузить список рынков. Обновите страницу.';
      return;
    }
    fillTopicLanguages();
    state.baseData = data;
    applyCatalogue(data);
  }

  function applyCatalogue(data) {
    const live = loadArr(LS.live).filter(c => c && c.id);
    const fresh = new Map(live.map(c => [c.id, c]));
    // Market-eligible graduated channels remain available to competitor tables.
    // A live record may be a whole channel or just a competition patch ({id, competition,
    // …}) written by the refresh for a channel the catalogue already holds. Patches must
    // merge; they must never reach the grid as a channel of their own.
    const shared = (data.channels || []).map(channel => {
      const update = fresh.get(channel.id);
      fresh.delete(channel.id);
      if (!update) return channel;
      const newer = catalogue.competitionFor(channel);
      const local = catalogue.competitionFor({ ...channel, ...update });
      if (newer && (!local || newer.checked_at > local.checked_at)) {
        return { ...channel, ...update, competition: newer, added_at: channel.added_at || update.added_at };
      }
      return { ...channel, ...update, added_at: channel.added_at || update.added_at };
    });
    state.knownChannels = shared.concat([...fresh.values()].filter(channel => channel.title));
    state.pool = state.knownChannels.filter(channel => catalogue.marketKey(channel, state.supportedMarkets));
    state.all = state.pool.filter(channel => (!channel.graduated && (channel.videos_count || 0) <= MAX_VIDEOS) || channel.labeled_role);
    state.markets = new Map();
    for (const channel of state.pool) {
      const key = catalogue.marketKey(channel, state.supportedMarkets);
      if (!state.markets.has(key)) state.markets.set(key, []);
      state.markets.get(key).push(channel);
    }
    state.clusters = catalogue.clusters(state.all, state.supportedMarkets);
    for (const [key, group] of Object.entries(state.clusters)) group.label = data.clusters?.[key]?.label;
    const fileAt = data.generated_at ? new Date(data.generated_at) : null;
    const rawAt = live.length ? localStorage.getItem(LS.liveAt) : null;
    const liveAt = rawAt && !isNaN(new Date(rawAt)) ? new Date(rawAt) : null;
    const when = liveAt && (!fileAt || liveAt > fileAt) ? liveAt : fileAt;
    $('#generatedAt').textContent = when ? 'Обновлено ' + when.toLocaleString('ru-RU') + (when === liveAt ? ' · в браузере: ' + live.length : '') : '';
    fillSelects(); render();
  }
  window.addEventListener('scroll', () => { $('#toTop').hidden = window.scrollY < 600; }, { passive: true });
  $('#topicLang').addEventListener('change', fillTopicCountries);
  boot();
})();
