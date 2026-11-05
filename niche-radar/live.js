/* Niche Radar — live collection in the browser via YouTube Data API v3.
   Mirrors collector/collect.py (filters, metrics, score) so that the button
   "Обновить каналы" produces records in the same schema as data/channels.json. */
(() => {
  const API = 'https://www.googleapis.com/youtube/v3';
  const STYLE_KEYWORDS = {
    stickman: ['stickman', 'stick figure', 'stick-figure', 'stickly', 'палочный'],
    '2d_animation': ['animated', 'animation', 'cartoon', 'анимация', 'мультфильм'],
    ai_illustrations: ['illustrated', 'ai art', 'midjourney', 'drawn', 'ilustrado', 'dibujado', 'иллюстрации'],
    ai_video: ['ai generated', 'ai video', 'sora', 'veo', 'kling', 'нейросеть'],
    maps_graphics: ['map', 'maps', 'geography', 'карта', 'состояние', 'state', 'border'],
    screencast_slides: ['tutorial', 'how to', 'screen', 'excel', 'code'],
    talking_head: ['vlog', 'my', 'i tried', 'я попробовал', 'reaction'],
  };
  const STYLE_RU = { stickman: 'Стикманы', '2d_animation': '2D-анимация', ai_illustrations: 'ИИ-иллюстрации', ai_video: 'ИИ-видео', stock_footage: 'Стоковый футаж', maps_graphics: 'Карты и графика', screencast_slides: 'Скринкаст/слайды', talking_head: 'С лицом', mixed: 'Смешанный' };
  const DIFFICULTY = { stock_footage: 'low', screencast_slides: 'low', ai_illustrations: 'low', maps_graphics: 'medium', stickman: 'medium', ai_video: 'medium', '2d_animation': 'high', talking_head: 'high' };
  const DIFFICULTY_RU = { low: 'Низкая', medium: 'Средняя', high: 'Высокая' };
  const AI_STYLES = new Set(['stickman', '2d_animation', 'ai_illustrations', 'ai_video']);

  class QuotaExhausted extends Error {}
  class ApiDisabled extends Error {}

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const countHits = (kw, text) => (text.match(new RegExp('(?<!\\w)' + escRe(kw) + '(?!\\w)', 'gi')) || []).length;
  const durationSec = iso => {
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
    return m ? num(m[1]) * 3600 + num(m[2]) * 60 + num(m[3]) : 0;
  };
  const median = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const r2 = v => Math.round(v * 100) / 100;

  /* ---- Title matching: the same rules as collector/competition.py ----------------
     Discovery and competition measurement are the same API call. Searching a channel's
     own hit title returns the channels working that topic, which is simultaneously the
     best way to find its siblings and the way to count how crowded the topic is. */
  const TITLE_NOISE = /[^\p{L}\p{N}\s']|\d+|_/gu;
  const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'how', 'why', 'what', 'who', 'this', 'that', 'it', 'its', 'with', 'from', 'at', 'by', 'as', 'be', 'been', 'do', 'does', 'did', 'will', 'would', 'can']);
  const titleQuery = (title, words = 6) => String(title || '').replace(TITLE_NOISE, ' ').toLowerCase().split(/\s+/)
    .map(w => w.replace(/^'+|'+$/g, '')).filter(w => w.length > 1 || ['a', 'i', 'y', 'e', 'o'].includes(w)).slice(0, words).join(' ');
  const titleWords = title => new Set(titleQuery(title, 40).replace(/'/g, '').split(' ').filter(w => w && !STOPWORDS.has(w)));
  // Asymmetric on purpose: a word-for-word copy padded with extra words scores 0.45 by
  // Jaccard and would be missed, but 0.83 by containment.
  const titleOverlap = (source, other) => {
    const a = titleWords(source), b = titleWords(other);
    if (!a.size || !b.size) return 0;
    let hit = 0; a.forEach(w => { if (b.has(w)) hit++; });
    return hit / a.size;
  };
  const CLONE_OVERLAP = 0.7;
  const TOPIC_OVERLAP = 0.4;
  const BIG_RIVAL_SUBS = 100000;
  const COMP_RU = { free: 'Свободно', moderate: 'Умеренно', competitive: 'Конкурентно', saturated: 'Переполнено' };
  function competitionIndex({ cloneChannels, cloneShare, rivalChannels, bigRivals }) {
    const value = Math.max(0, Math.min(100, Math.round(
      40 * clamp(cloneChannels / 8, 0, 1) + 25 * clamp(cloneShare / 0.25, 0, 1)
      + 20 * clamp(rivalChannels / 15, 0, 1) + 15 * clamp(bigRivals / 6, 0, 1))));
    const verdict = value <= 25 ? 'free' : value <= 50 ? 'moderate' : value <= 75 ? 'competitive' : 'saturated';
    return { index: value, verdict, verdict_ru: COMP_RU[verdict] };
  }

  /* ---- Audience language: mirrors collect._audience_language -------------------- */
  const EN_MARKETS = new Set(['US', 'GB', 'CA', 'AU', 'NZ', 'IE']);
  function audienceLanguage({ audioLangs, textLangs, enLocalized, videoCount, country, fallback }) {
    const majority = list => { if (!list.length) return null; const c = {}; list.forEach(v => { c[v] = (c[v] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; };
    const audio = majority(audioLangs), text = majority(textLangs);
    const found = [...new Set([...audioLangs, ...textLangs].filter(Boolean))];
    const shipsEnglish = videoCount > 0 && enLocalized * 2 >= videoCount;
    if (shipsEnglish && !found.includes('en')) found.push('en');
    let language, source;
    if (shipsEnglish && (EN_MARKETS.has((country || '').toUpperCase()) || audio === 'en')) { language = 'en'; source = 'en_localization'; }
    else if (audio) { language = audio; source = 'audio_majority'; }
    else if (text) { language = text; source = 'text_majority'; }
    else { language = String(fallback || 'en').split('-')[0]; source = 'query_fallback'; }
    if (!found.includes(language)) found.unshift(language);
    return { language, languages: [language, ...found.filter(v => v !== language)], audio_language: audio, is_multilang: found.length > 1, language_source: source };
  }

  async function ytGet(resource, params, st, cost) {
    const url = new URL(`${API}/${resource}`);
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    url.searchParams.set('key', st.key);
    const res = await fetch(url);
    st.units += cost;
    if (res.ok) return res.json();
    let err = {}; try { err = (await res.json()).error || {}; } catch { /* ignore */ }
    const reason = (err.errors || []).map(e => e.reason).join(',');
    if (res.status === 403 && /quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(reason)) throw new QuotaExhausted('Квота YouTube API на сегодня исчерпана');
    if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/.test(reason + (err.message || ''))) throw new ApiDisabled(err.message || 'YouTube Data API v3 не включён в проекте');
    if (res.status === 400 && /keyInvalid|API key not valid/.test(reason + (err.message || ''))) throw new ApiDisabled('Ключ API недействителен');
    throw new Error(`${resource}: HTTP ${res.status} ${err.message || ''}`);
  }

  // Requests pass hl=en, so `localized` holds the English metadata when the channel
  // publishes an English localization and `snippet.title` holds its own default locale.
  // A difference between the two is what marks a multi-language channel.
  const normVideo = item => ({
    id: item.id,
    title: item.snippet?.localized?.title || item.snippet?.title || '',
    title_original: item.snippet?.title || '',
    description: item.snippet?.localized?.description || item.snippet?.description || '',
    tags: item.snippet?.tags || [],
    default_language: item.snippet?.defaultAudioLanguage || item.snippet?.defaultLanguage || null,
    audio_language: item.snippet?.defaultAudioLanguage || null,
    text_language: item.snippet?.defaultLanguage || null,
    has_en_localization: !!(item.snippet?.localized?.title && item.snippet.localized.title !== item.snippet.title),
    thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
    views: num(item.statistics?.viewCount),
    published_at: item.snippet?.publishedAt || null,
    duration_sec: durationSec(item.contentDetails?.duration),
  });

  function classify(channel, videos, query) {
    const sn = channel.snippet || {};
    const textParts = [sn.title || '', sn.description || ''];
    const videoParts = []; const tags = [];
    const audioLangs = []; const textLangs = []; let enLocalized = 0;
    videos.forEach(v => {
      videoParts.push(v.title, v.description, ...v.tags.map(String));
      if (v.audio_language) audioLangs.push(v.audio_language.split('-')[0]);
      if (v.text_language) textLangs.push(v.text_language.split('-')[0]);
      else if (v.default_language) textLangs.push(v.default_language.split('-')[0]);
      if (v.has_en_localization) enLocalized++;
      tags.push(...v.tags.map(String));
    });
    const lang = audienceLanguage({
      audioLangs, textLangs, enLocalized, videoCount: videos.length,
      country: sn.country, fallback: query?.lang || 'en',
    });
    const scores = {};
    Object.entries(STYLE_KEYWORDS).forEach(([style, kws]) => {
      scores[style] = kws.reduce((acc, kw) => acc + 2 * textParts.reduce((a, t) => a + countHits(kw, t), 0) + videoParts.reduce((a, t) => a + countHits(kw, t), 0), 0);
    });
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const style = best && best[1] > 0 ? best[0] : (query?.style_hint || 'stock_footage');
    const difficulty = DIFFICULTY[style] || 'medium';
    const usesAi = new Set(['stickman', 'ai_illustrations', 'ai_video']).has(style)
      || [...textParts, ...videoParts].some(t => /\bai\b/i.test(t) || t.toLowerCase().includes('нейросет'));
    return {
      production_style: style, style_ru: STYLE_RU[style] || 'Смешанный', style_group: AI_STYLES.has(style) ? 'ai' : 'live',
      uses_ai: usesAi, difficulty, difficulty_ru: DIFFICULTY_RU[difficulty], solo_friendly: difficulty !== 'high',
      ...lang, tags: [...new Set(tags)].sort(),
    };
  }

  function metrics(channel, videos, now, isMonetized) {
    const long = videos.filter(v => v.duration_sec >= 90).sort((a, b) => (a.published_at || '').localeCompare(b.published_at || ''));
    const views = long.map(v => v.views); const durations = long.map(v => v.duration_sec);
    const firstAt = long.length ? new Date(long[0].published_at) : null;
    const ageDays = firstAt ? Math.max(1, (now - firstAt) / 86400000) : 1;
    const subs = num(channel.statistics?.subscriberCount); const totalViews = num(channel.statistics?.viewCount);
    const sum = a => a.reduce((x, y) => x + y, 0);
    const avgViews = views.length ? sum(views) / views.length : 0;
    const first5 = views.slice(0, 5); const avgFirst = first5.length ? sum(first5) / first5.length : 0;
    const med = median(views);
    const watchHours = views.reduce((acc, v, i) => acc + v * (durations[i] > 600 ? 0.35 : 0.45) * durations[i] / 3600, 0);
    const subsPerDay = subs / ageDays; const viewsPerDay = sum(views) / ageDays; const whPerDay = watchHours / ageDays;
    const daysSubs = Math.max(0, 1000 - subs) / Math.max(subsPerDay, 0.5);
    const daysHours = Math.max(0, 4000 - watchHours) / Math.max(whPerDay, 0.5);
    const daysMon = Math.max(daysSubs, daysHours);
    const thr = 3 * med;
    const outliers = long.filter(v => thr > 0 && v.views >= thr).map(v => v.id).slice(0, 5);
    const forecast = isMonetized ? 'уже' : daysMon <= 30 ? '≤30 дн.' : daysMon <= 90 ? '≤90 дн.' : 'неясно';
    return {
      videos_count_long: long.length, first_video_at: long[0]?.published_at || null, channel_age_days: Math.round(ageDays * 10) / 10,
      avg_views: r2(avgViews), median_views: r2(med), avg_views_first_5: r2(avgFirst),
      avg_duration_sec: durations.length ? r2(sum(durations) / durations.length) : 0,
      views_per_day: r2(viewsPerDay), monthly_views_est: Math.round(viewsPerDay * 30), subs_per_day: r2(subsPerDay),
      watch_hours_est: r2(watchHours), days_to_monetization: r2(isMonetized ? 0 : daysMon), monetization_forecast: forecast,
      outliers, long, subs, total_views: totalViews,
    };
  }

  function score(c) {
    const velocity = clamp(Math.log10(Math.max(c.avg_views_first_5 || 0, 1)) / 6, 0, 1);
    const rpmNorm = clamp((c.rpm || 0) / 15, 0, 1);
    const mon = { 'уже': 1, '≤30 дн.': 0.8, '≤90 дн.': 0.5, 'неясно': 0.2 }[c.monetization_forecast] ?? 0.2;
    const repl = { low: 1, medium: 0.6, high: 0.2 }[c.difficulty] ?? 0.2;
    const age = c.channel_age_days || 0;
    const fresh = age <= 90 ? 1 : age <= 180 ? 0.7 : 0.4;
    return Math.round(30 * velocity + 25 * rpmNorm + 20 * mon + 15 * repl + 10 * fresh);
  }

  function regionData(niche, country, language, rpm) {
    let region = rpm.country_to_region[country || ''];
    if (!region) region = rpm.lang_to_region[(language || '').split('-')[0]] || 'other';
    const nd = rpm.niches[niche] || rpm.niches.other;
    return { rpm: Number(nd[region] ?? nd.other), region, region_ru: rpm.region_ru[region] || 'Другое' };
  }

  /* ---- Seed planning ------------------------------------------------------------
     The old plan took N queries from a 277-entry seed list spread over 92 niche×language
     buckets, rotated by the day. With the default of 6 queries a bucket came up about
     once every 46 runs, so nothing ever became dense: 915 channels ended up scattered so
     thinly that most niches held one or two of them and a competitor count was an
     artefact of catalogue size rather than a fact about YouTube.

     The reference service's catalogue is the opposite shape — ~90 channels packed into a
     handful of formats, where every channel has visible siblings. That density is what
     makes its numbers mean something.

     So a run now digs rather than sweeps:
       * `mine` — search the actual hit titles of channels already in the catalogue. The
         channels publishing the same title are that channel's real siblings, so this is
         what fills a cluster out. It also measures the topic's crowding from the same
         response, at no extra quota cost.
       * `explore` — seed queries, weighted toward niches that already look alive, so the
         catalogue deepens where there is something to find instead of spreading evenly.
     Two mining queries per exploring one: keep growing what is proven, keep a path open
     to something new. */
  const MINE_RATIO = 2;

  function nicheWeights(channels) {
    const stats = {};
    channels.forEach(c => {
      const key = c.niche_ai || c.niche || 'other';
      const s = stats[key] || (stats[key] = { n: 0, growing: 0, comp: [] });
      s.n++;
      if ((c.avg_views_first_5 || c.avg_views || 0) >= 20000) s.growing++;
      const idx = c.competition ? c.competition.index : c.competition_index;
      if (idx != null) s.comp.push(idx);
    });
    const out = {};
    Object.entries(stats).forEach(([key, s]) => {
      const growing = s.n ? s.growing / s.n : 0;
      // An unmeasured niche is treated as middling, never as free.
      const comp = s.comp.length ? median(s.comp) / 100 : 0.5;
      out[key] = clamp(0.25 + growing - 0.5 * comp, 0.05, 1.5);
    });
    return out;
  }

  function planQueries(all, channels, opts) {
    const want = Math.max(1, opts.maxQueries || 6);
    const nicheOf = c => c.niche_ai || c.niche || 'other';
    const langsOf = c => {
      const list = (c.languages && c.languages.length ? c.languages : [c.language]).map(l => String(l || '').split('-')[0]);
      const uniq = [...new Set(list.filter(Boolean))];
      return uniq.length ? uniq : ['en'];
    };
    const matches = c => (!opts.niche || nicheOf(c) === opts.niche || c.niche_ru === opts.niche)
      && (!opts.lang || langsOf(c).includes(opts.lang));

    // --- mining seeds: the catalogue's own hits, strongest channels first
    const mine = [];
    const seenText = new Set();
    const pool = channels.filter(c => matches(c) && (c.videos || []).length && !c.graduated);
    pool.sort((a, b) => {
      // Channels never probed come first: mining them yields siblings *and* their first
      // real competition reading.
      const ap = (a.competition ? a.competition.checked_at : '') || '';
      const bp = (b.competition ? b.competition.checked_at : '') || '';
      return ap.localeCompare(bp) || (b.score || 0) - (a.score || 0);
    });
    pool.forEach(c => {
      const vids = (c.videos || []).slice().sort((x, y) => (y.views || 0) - (x.views || 0));
      const best = vids.find(v => v.is_outlier) || vids[0];
      if (!best || !best.title) return;
      const text = titleQuery(best.title, 7);
      if (text.split(' ').length < 3 || seenText.has(text)) return;
      seenText.add(text);
      mine.push({ text, kind: 'mine', niche: nicheOf(c), lang: langsOf(c)[0], source_id: c.id, source_title: best.title, source_name: c.title });
    });

    // --- exploring seeds: seed list, ordered by how promising the niche looks
    const weights = nicheWeights(channels);
    let seeds = all.queries.filter(q => (!opts.niche || q.niche === opts.niche) && (!opts.lang || q.lang === opts.lang));
    if (!seeds.length) seeds = all.queries;
    const day = Math.floor(Date.now() / 86400000);
    seeds = seeds.map((q, i) => ({ ...q, kind: 'explore', _w: (weights[q.niche] ?? 0.5) + ((i + day) % 7) / 100 }))
      .sort((a, b) => b._w - a._w);

    // --- interleave
    const plan = [];
    let mi = 0, si = 0;
    while (plan.length < want && (mi < mine.length || si < seeds.length)) {
      for (let k = 0; k < MINE_RATIO && mi < mine.length && plan.length < want; k++) plan.push(mine[mi++]);
      if (si < seeds.length && plan.length < want) plan.push(seeds[si++]);
    }
    return plan;
  }

  /* Competition read off search pages already fetched. Same shape as the `competition`
     object written by collector/competition.py, so the UI renders either identically.
     `subs` is left undefined here — the browser run does not spend extra calls on rival
     statistics, so `big_rivals` stays 0 and the index is, if anything, conservative. */
  function measureFromPage(sourceTitle, ownId, pages, now) {
    if (!sourceTitle || !pages.length) return null;
    const rivals = new Map(); const clones = []; let seen = 0; const queries = [];
    pages.forEach(({ text, items }) => {
      queries.push(text); seen += items.length;
      items.forEach(it => {
        const sn = it.snippet || {}; const rid = sn.channelId;
        if (!rid || rid === ownId) return;
        const overlap = titleOverlap(sourceTitle, sn.title || '');
        if (overlap < TOPIC_OVERLAP) return;
        const row = rivals.get(rid) || { id: rid, title: sn.channelTitle || '', videos: 0, best_overlap: 0, clone: false, latest: null };
        row.videos++;
        row.best_overlap = Math.max(row.best_overlap, r2(overlap));
        if (sn.publishedAt && (!row.latest || sn.publishedAt > row.latest)) row.latest = sn.publishedAt;
        if (overlap >= CLONE_OVERLAP) {
          row.clone = true;
          clones.push({ channel_id: rid, channel: sn.channelTitle || '', title: sn.title || '', published_at: sn.publishedAt || null, overlap: r2(overlap) });
        }
        rivals.set(rid, row);
      });
    });
    if (!seen) return null;
    const list = [...rivals.values()];
    const cloneChannels = list.filter(r => r.clone).length;
    const cloneShare = clones.length / Math.max(seen, 1);
    const bigRivals = list.filter(r => (r.subs || 0) >= BIG_RIVAL_SUBS).length;
    const cutoff = new Date(now - 30 * 86400000).toISOString();
    const verdict = competitionIndex({ cloneChannels, cloneShare, rivalChannels: list.length, bigRivals });
    const competition = {
      queries: [...new Set(queries)], videos_seen: seen, rival_channels: list.length,
      clone_channels: cloneChannels, clone_videos: clones.length, clone_share: Math.round(cloneShare * 1000) / 1000,
      clones_30d: clones.filter(c => (c.published_at || '') >= cutoff).length,
      big_rivals: bigRivals, median_rival_subs: null,
      top_rivals: list.sort((a, b) => b.best_overlap - a.best_overlap || b.videos - a.videos).slice(0, 10),
      clone_examples: clones.sort((a, b) => b.overlap - a.overlap).slice(0, 8),
      window_days: 180, checked_at: now.toISOString().slice(0, 10), source: 'live',
      ...verdict,
    };
    return { competition, competition_index: verdict.index, competition_verdict: verdict.verdict, competition_verdict_ru: verdict.verdict_ru };
  }

  /* opts: {key, niche, lang, maxQueries, catalogue}; onProgress(text, fraction) */
  async function run(opts, onProgress) {
    const log = (t, f) => onProgress && onProgress(t, f);
    const st = { key: opts.key, units: 0 };
    const [queries, rpm] = await Promise.all([
      fetch('collector/queries.json', { cache: 'no-store' }).then(r => r.json()),
      fetch('collector/rpm_baseline.json', { cache: 'no-store' }).then(r => r.json()),
    ]);
    const catalogue = Array.isArray(opts.catalogue) ? opts.catalogue : (window.NR_CATALOGUE || []);
    const known = new Set(catalogue.map(c => c.id));
    const chosen = planQueries(queries, catalogue, opts);
    const now = new Date();
    // Mining looks back further than a seed sweep: a clone cluster forms over months, and
    // a 45-day window hides most of it. Exploring still wants what is breaking out now.
    const mineAfter = new Date(now - 180 * 86400000).toISOString();
    const exploreAfter = new Date(now - 45 * 86400000).toISOString();
    const foundBy = new Map();
    // Every search response is kept so competition can be read off it afterwards without
    // spending another 100 units.
    const pages = [];
    let stopped = null;
    for (let i = 0; i < chosen.length; i++) {
      const q = chosen[i];
      const mining = q.kind === 'mine';
      // Seed queries get a rotating modifier; a mined title is searched verbatim, because
      // the point is to find the videos that carry that same title.
      const text = mining ? q.text : (i % 2 ? `${q.text} ${queries.modifiers[i % queries.modifiers.length]}` : q.text);
      log(`${mining ? 'Кластер' : 'Разведка'} ${i + 1}/${chosen.length}: «${text}»${mining ? ` (от «${q.source_name}»)` : ''}`, i / (chosen.length * 2));
      try {
        const d = await ytGet('search', {
          part: 'snippet', type: 'video',
          // Long-form is where these formats live; searching only `medium` (4-20 min) hid
          // the 20-minute documentaries entirely.
          videoDuration: mining ? (i % 2 ? 'long' : 'medium') : 'medium',
          order: mining ? 'relevance' : 'viewCount',
          publishedAfter: mining ? mineAfter : exploreAfter,
          maxResults: 50, relevanceLanguage: q.lang, q: text,
        }, st, 100);
        const items = d.items || [];
        pages.push({ query: q, text, items });
        items.forEach(it => { const id = it.snippet?.channelId; if (id && !foundBy.has(id)) foundBy.set(id, { ...q, text }); });
      } catch (e) { if (e instanceof QuotaExhausted || e instanceof ApiDisabled) { stopped = e; break; } log(`Пропуск запроса: ${e.message}`); }
    }
    if (stopped instanceof ApiDisabled) throw stopped;

    // Competition for the channels whose titles were mined — free, from the pages above.
    const competitionUpdates = [];
    pages.filter(p => p.query.kind === 'mine').forEach(p => {
      const measured = measureFromPage(p.query.source_title, p.query.source_id, [p], now);
      if (measured) competitionUpdates.push({ id: p.query.source_id, ...measured });
    });

    // Only unknown channels are worth 3 units of detail fetching; the catalogue already
    // holds the rest, and they just received a competition update.
    const ids = [...foundBy.keys()].filter(id => !known.has(id));
    log(`Найдено каналов: ${foundBy.size}, из них новых: ${ids.length}. Загружаю данные…`, 0.5);
    const channels = [];
    for (let i = 0; i < ids.length && !stopped; i += 50) {
      try {
        const d = await ytGet('channels', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50, hl: 'en' }, st, 1);
        channels.push(...(d.items || []));
      } catch (e) { if (e instanceof QuotaExhausted) stopped = e; }
    }
    // Same gate as collect.eligible, so the button and the daily run keep one standard:
    // 3-30 videos, 200-300 000 subscribers, subscriber count public.
    const eligible = channels.filter(c => {
      const v = num(c.statistics?.videoCount); const s = num(c.statistics?.subscriberCount);
      return v >= 3 && v <= 30 && s >= 200 && s <= 300000 && !c.statistics?.hiddenSubscriberCount;
    });
    log(`Подходит по числу видео и подписчикам: ${eligible.length}`, 0.55);
    const out = [];
    for (let i = 0; i < eligible.length && !stopped; i++) {
      const ch = eligible[i];
      log(`Анализ ${i + 1}/${eligible.length}: ${ch.snippet?.title || ch.id}`, 0.55 + 0.45 * i / eligible.length);
      try {
        const uploads = ch.contentDetails?.relatedPlaylists?.uploads; if (!uploads) continue;
        const pl = await ytGet('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 30 }, st, 1);
        const vids = (pl.items || []).map(x => x.contentDetails?.videoId).filter(Boolean);
        if (!vids.length) continue;
        const vd = await ytGet('videos', { part: 'snippet,contentDetails,statistics', id: vids.join(','), maxResults: 50, hl: 'en' }, st, 1);
        const videos = (vd.items || []).map(normVideo);
        const m = metrics(ch, videos, now, null);
        if (m.videos_count_long < 1 || !m.first_video_at || (now - new Date(m.first_video_at)) / 86400000 > 365) continue;
        const q = foundBy.get(ch.id);
        const cl = classify(ch, videos, q);
        const niche = q?.niche || 'other';
        const rd = regionData(niche, ch.snippet?.country, cl.language, rpm);
        const outSet = new Set(m.outliers);
        const rec = {
          id: ch.id, handle: ch.snippet?.customUrl || '',
          title: ch.snippet?.localized?.title || ch.snippet?.title || '',
          title_original: ch.snippet?.title || '',
          description: ch.snippet?.localized?.description || ch.snippet?.description || '',
          thumbnail: ch.snippet?.thumbnails?.medium?.url || ch.snippet?.thumbnails?.default?.url || '', country: ch.snippet?.country || null,
          language: cl.language, languages: cl.languages, audio_language: cl.audio_language,
          is_multilang: cl.is_multilang, language_source: cl.language_source,
          niche, niche_ru: rpm.niches[niche]?.ru_name || niche, tags: cl.tags.slice(0, 30),
          production_style: cl.production_style, style_ru: cl.style_ru, style_group: cl.style_group, uses_ai: cl.uses_ai,
          difficulty: cl.difficulty, difficulty_ru: cl.difficulty_ru, solo_friendly: cl.solo_friendly,
          subs: m.subs, total_views: m.total_views, videos_count: num(ch.statistics?.videoCount),
          videos_count_long: m.videos_count_long, first_video_at: m.first_video_at, channel_age_days: m.channel_age_days,
          avg_views: m.avg_views, median_views: m.median_views, avg_views_first_5: m.avg_views_first_5, avg_duration_sec: m.avg_duration_sec,
          views_per_day: m.views_per_day, monthly_views_est: m.monthly_views_est, subs_per_day: m.subs_per_day, watch_hours_est: m.watch_hours_est,
          days_to_monetization: m.days_to_monetization, monetization_forecast: m.monetization_forecast, is_monetized: null,
          rpm: rd.rpm, rpm_source: 'baseline', monthly_income_est: r2(m.monthly_views_est / 1000 * rd.rpm), region: rd.region, region_ru: rd.region_ru,
          found_by_queries: [q?.text].filter(Boolean), added_at: now.toISOString(), updated_at: now.toISOString(), live: true,
          videos: m.long.map(v => ({ id: v.id, title: v.title, thumbnail: v.thumbnail, views: v.views, published_at: v.published_at, duration_sec: v.duration_sec, is_outlier: outSet.has(v.id) })),
        };
        rec.cluster = `${niche}|${rec.style_group}|${rec.language}`;
        rec.score = score(rec);
        // The pages this channel turned up on already describe its competition, so its
        // own best title can be scored against them without another search.
        const best = rec.videos.slice().sort((a, b) => (b.views || 0) - (a.views || 0))[0];
        const mine = pages.filter(p => (p.items || []).some(it => it.snippet?.channelId === ch.id));
        const measured = best ? measureFromPage(best.title, ch.id, mine, now) : null;
        if (measured) Object.assign(rec, measured);
        out.push(rec);
      } catch (e) { if (e instanceof QuotaExhausted) stopped = e; else log(`Пропуск канала: ${e.message}`); }
    }
    const mined = chosen.filter(q => q.kind === 'mine').length;
    log(`Готово: ${out.length} новых каналов, конкуренция измерена у ${competitionUpdates.length + out.filter(c => c.competition).length}, ${st.units} ед. квоты${stopped ? ' · ' + stopped.message : ''}`, 1);
    return {
      channels: out, competition: competitionUpdates, units: st.units,
      stopped: stopped ? stopped.message : null,
      queries: chosen.length, mined, explored: chosen.length - mined,
    };
  }

  window.NR_LIVE = { run, QuotaExhausted, ApiDisabled };
})();
