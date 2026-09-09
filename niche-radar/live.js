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

  const normVideo = item => ({
    id: item.id,
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    tags: item.snippet?.tags || [],
    default_language: item.snippet?.defaultAudioLanguage || item.snippet?.defaultLanguage || null,
    thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
    views: num(item.statistics?.viewCount),
    published_at: item.snippet?.publishedAt || null,
    duration_sec: durationSec(item.contentDetails?.duration),
  });

  function classify(channel, videos, query) {
    const sn = channel.snippet || {};
    const textParts = [sn.title || '', sn.description || ''];
    const videoParts = []; const langs = []; const tags = [];
    videos.forEach(v => {
      videoParts.push(v.title, v.description, ...v.tags.map(String));
      if (v.default_language) langs.push(v.default_language.split('-')[0]);
      tags.push(...v.tags.map(String));
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
      language: langs[0] || query?.lang || 'en', tags: [...new Set(tags)].sort(),
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

  function pickQueries(all, opts) {
    let qs = all.queries.filter(q => (!opts.niche || q.niche === opts.niche) && (!opts.lang || q.lang === opts.lang));
    if (!qs.length) qs = all.queries;
    const day = Math.floor(Date.now() / 86400000);
    const shift = day % qs.length;
    return [...qs.slice(shift), ...qs.slice(0, shift)].slice(0, opts.maxQueries);
  }

  /* opts: {key, niche, lang, maxQueries}; onProgress(text, fraction) */
  async function run(opts, onProgress) {
    const log = (t, f) => onProgress && onProgress(t, f);
    const st = { key: opts.key, units: 0 };
    const [queries, rpm] = await Promise.all([
      fetch('collector/queries.json', { cache: 'no-store' }).then(r => r.json()),
      fetch('collector/rpm_baseline.json', { cache: 'no-store' }).then(r => r.json()),
    ]);
    const chosen = pickQueries(queries, opts);
    const now = new Date();
    const publishedAfter = new Date(now - 45 * 86400000).toISOString();
    const foundBy = new Map();
    let stopped = null;
    for (let i = 0; i < chosen.length; i++) {
      const q = chosen[i];
      const mod = queries.modifiers[i % queries.modifiers.length];
      const text = i % 2 ? `${q.text} ${mod}` : q.text;
      log(`Поиск ${i + 1}/${chosen.length}: «${text}»`, i / (chosen.length * 2));
      try {
        const d = await ytGet('search', { part: 'snippet', type: 'video', videoDuration: 'medium', order: 'viewCount', publishedAfter, maxResults: 25, relevanceLanguage: q.lang, q: text }, st, 100);
        (d.items || []).forEach(it => { const id = it.snippet?.channelId; if (id && !foundBy.has(id)) foundBy.set(id, { ...q, text }); });
      } catch (e) { if (e instanceof QuotaExhausted || e instanceof ApiDisabled) { stopped = e; break; } log(`Пропуск запроса: ${e.message}`); }
    }
    if (stopped instanceof ApiDisabled) throw stopped;
    const ids = [...foundBy.keys()];
    log(`Найдено каналов: ${ids.length}. Загружаю данные…`, 0.5);
    const channels = [];
    for (let i = 0; i < ids.length && !stopped; i += 50) {
      try {
        const d = await ytGet('channels', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50 }, st, 1);
        channels.push(...(d.items || []));
      } catch (e) { if (e instanceof QuotaExhausted) stopped = e; }
    }
    const eligible = channels.filter(c => { const v = num(c.statistics?.videoCount); return v >= 3 && v <= 30 && num(c.statistics?.subscriberCount) >= 200; });
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
        const vd = await ytGet('videos', { part: 'snippet,contentDetails,statistics', id: vids.join(','), maxResults: 50 }, st, 1);
        const videos = (vd.items || []).map(normVideo);
        const m = metrics(ch, videos, now, null);
        if (m.videos_count_long < 3 || !m.first_video_at || (now - new Date(m.first_video_at)) / 86400000 > 365) continue;
        const q = foundBy.get(ch.id);
        const cl = classify(ch, videos, q);
        const niche = q?.niche || 'other';
        const rd = regionData(niche, ch.snippet?.country, cl.language, rpm);
        const outSet = new Set(m.outliers);
        const rec = {
          id: ch.id, handle: ch.snippet?.customUrl || '', title: ch.snippet?.title || '', description: ch.snippet?.description || '',
          thumbnail: ch.snippet?.thumbnails?.medium?.url || ch.snippet?.thumbnails?.default?.url || '', country: ch.snippet?.country || null,
          language: cl.language, niche, niche_ru: rpm.niches[niche]?.ru_name || niche, tags: cl.tags.slice(0, 30),
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
        rec.score = score(rec);
        out.push(rec);
      } catch (e) { if (e instanceof QuotaExhausted) stopped = e; else log(`Пропуск канала: ${e.message}`); }
    }
    log(`Готово: ${out.length} молодых каналов, ${st.units} единиц квоты${stopped ? ' · ' + stopped.message : ''}`, 1);
    return { channels: out, units: st.units, stopped: stopped ? stopped.message : null, queries: chosen.length };
  }

  window.NR_LIVE = { run, QuotaExhausted, ApiDisabled };
})();
