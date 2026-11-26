(() => {
  const DAY = 86400000;
  const normalize = value => String(value ?? '').normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC').toLowerCase().replace(/ё/g, 'е');
  const words = value => normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
  const languageCode = value => {
    const code = String(value || '').trim().toLowerCase().split(/[-_]/, 1)[0];
    if (code === 'nb' || code === 'nn') return 'no';
    return /^[a-z]{2,3}$/.test(code) && !['und', 'mul', 'zxx'].includes(code) ? code : '';
  };
  const channelLanguage = channel => languageCode(channel.audio_language)
    || (channel.language_source !== 'query_fallback' ? languageCode(channel.language) : '');
  const videoLanguage = snippet => languageCode(snippet.defaultAudioLanguage) || languageCode(snippet.defaultLanguage);
  const competitionFor = channel => {
    const language = channelLanguage(channel);
    const reading = channel.competition;
    return language && reading?.language === language && reading.market_verified === true
      && reading.language_verified === true && reading.region_code === channel.country ? reading : null;
  };
  const marketKey = (channel, markets) => {
    const language = channelLanguage(channel);
    const niche = channel.niche_ai || channel.niche;
    return niche && allowedMarket(markets, language, channel.country) ? `${niche}|${language}` : null;
  };
  const allowedMarket = (markets, language, country) =>
    Boolean(markets?.[languageCode(language)]?.includes(String(country || '').trim().toUpperCase()));
  const clusterKey = (channel, markets) => {
    const market = marketKey(channel, markets);
    return market ? [channel.niche_ai || channel.niche, channel.style_group || '', channelLanguage(channel)].join('|') : null;
  };

  function clusters(channels, markets, now = Date.now()) {
    const groups = {};
    for (const channel of channels) {
      if (channel.stale || channel.graduated) continue;
      const key = clusterKey(channel, markets);
      if (key) (groups[key] ||= []).push(channel);
    }
    const median = values => {
      const sorted = values.sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
    };
    const clamp = value => Math.min(1, Math.max(0, value));
    return Object.fromEntries(Object.entries(groups).map(([key, group]) => {
      const count = group.length;
      const growing = group.filter(channel => (channel.avg_views_first_5 || channel.avg_views || 0) >= 20000).length / count;
      const medianViews = median(group.map(channel => channel.avg_views || 0));
      const medianRatio = median(group.map(channel => (channel.total_views || 0) / Math.max(1, channel.subs || 0)));
      const newcomers = group.filter(channel => now - Date.parse(channel.added_at) <= 30 * DAY).length;
      const supply = count <= 5 ? 1 : count <= 8 ? 0.5 : 0;
      const score = Math.round(35 * growing + 25 * clamp(Math.log10(Math.max(1, medianViews)) / 5.5)
        + 20 * clamp(medianRatio / 200) + 20 * supply);
      const [verdict, label] = count > 8 ? ['crowded', 'Много каналов в выборке']
        : growing < 0.4 || medianViews < 10000 ? ['unproven', 'Спрос не доказан']
        : count <= 5 && newcomers <= 2 ? ['open', 'Мало каналов в выборке'] : ['filling', 'Ниша заполняется'];
      return [key, {
        n: count, share_growing: growing, median_vpv: medianViews,
        newcomers_30d: newcomers, median_rpm: median(group.map(channel => channel.rpm || 0)),
        niche_ru: group.find(channel => channel.niche_ru)?.niche_ru,
        entry_score: score, verdict, verdict_ru: label,
      }];
    }));
  }

  function makeSearchIndex(channel, subniches, categories) {
    return normalize([
      channel.id, channel.handle, channel.title, channel.title_original,
      channel.description, channel.description_ru, channel.notes_ru,
      channel.niche, channel.niche_ru, channel.niche_ai, channel.niche_ai_ru,
      ...subniches, ...categories, ...(channel.tags || []), ...(channel.found_by_queries || []),
      ...(channel.videos || []).flatMap(video => [video.title, video.title_original]),
    ].filter(Boolean).join(' ').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' '));
  }

  function matches(index, terms) {
    return terms.every(term => index.includes(term));
  }

  function snapshots(daily) {
    const byDate = new Map();
    for (const row of daily || []) {
      if (!Array.isArray(row)) continue;
      const [date, subs, views] = row;
      const time = Date.parse(date);
      if (!Number.isFinite(time)) continue;
      byDate.set(time, { time, date, subs, views });
    }
    return [...byDate.values()].sort((a, b) => a.time - b.time);
  }

  function changeSeries(history, metric, days) {
    const rows = history.filter(row => Number.isFinite(row[metric]));
    if (rows.length < 2) return [];
    const cutoff = rows.at(-1).time - days * DAY;
    return rows.slice(1).flatMap((row, i) => {
      const previous = rows[i];
      if (previous.time < cutoff) return [];
      const interval = (row.time - previous.time) / DAY;
      const change = row[metric] - previous[metric];
      return [[row.date, change / interval, interval]];
    });
  }

  function measuredChange(history, metric, days, now = Date.now()) {
    if (history.length < 2) return null;
    const last = history.at(-1);
    const target = last.time - days * DAY;
    const baseline = history.find(row => row.time === target);
    if (!baseline || now - last.time > 3 * DAY) return null;
    if (!Number.isFinite(baseline[metric]) || !Number.isFinite(last[metric])) return null;
    return last[metric] - baseline[metric];
  }

  window.NR_CATALOGUE_TOOLS = {
    words, makeSearchIndex, matches, snapshots, changeSeries, measuredChange,
    languageCode, channelLanguage, videoLanguage, competitionFor, marketKey, allowedMarket, clusterKey, clusters,
  };
})();
