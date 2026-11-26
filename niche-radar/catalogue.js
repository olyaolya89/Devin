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
  const COMPETITION_METHOD = 2;
  const CHRISTIAN_STORY = 'UCK44H7LgmSSiQdehlxBGwRg';
  const CHRISTIAN_HISTORY = /\b(?:christian(?:s|ity)?|church histor(?:y|ies)|early church|church fathers|theolog(?:y|ical)|bible|biblical|nicene|reformation|trinity|jesus christ|cristianismo|cristiandad|iglesia primitiva|igreja primitiva|teologia|jesus cristo|cristo|christianisme|christentum|fruhe kirche|jesus christus)\b/i;
  const FINANCIAL_TOPIC = /\b(?:retire(?:ment|e|es)?|pensions?|401k|ira contributions?|social security|tax(?:es|ation)?|personal finances?|invest(?:ments?|ing)?|savings|budgeting|mortgages?|jubilacion|aposentadoria|finanzas personales|financas pessoais|hipotecas?|inversiones|investimentos|retraite|altersvorsorge|rente|geldanlage)\b/i;

  function topicCorrection(channel) {
    if (channel.id === CHRISTIAN_STORY) {
      return { niche: 'religion', label: 'История христианства и богословие', source: 'public-review' };
    }
    if (!['finance', 'nostalgia_finance'].includes(channel.niche_ai || channel.niche)) return null;
    const titles = [...new Set((channel.videos || []).map(video => normalize(video.title_original || video.title)).filter(Boolean))];
    const religious = titles.filter(title => CHRISTIAN_HISTORY.test(title)).length;
    const financial = titles.filter(title => FINANCIAL_TOPIC.test(title)).length;
    return religious >= 3 && religious * 2 > titles.length && financial * 4 < titles.length
      ? { niche: 'religion', label: 'Религия', source: 'video-titles' } : null;
  }

  const nicheFor = channel => topicCorrection(channel)?.niche || channel.niche_ai || channel.niche || '';
  const topicConfirmed = channel => Boolean(['public-review', 'video-titles'].includes(channel.topic_source)
    || channel.verified === true && channel.niche_ai);

  function checkTopic(channel) {
    const correction = topicCorrection(channel);
    if (!correction && (topicConfirmed(channel) || channel.rpm_source !== 'baseline')) return channel;
    const checked = { ...channel };
    if (correction) {
      checked.niche = correction.niche;
      checked.niche_ru = 'Религия';
      checked.topic_source = correction.source;
      checked.subniche_ru = correction.label;
      for (const key of ['niche_ai', 'niche_ai_ru', 'notes_ru', 'description_ru', 'categories', 'tags', '_sub']) {
        delete checked[key];
      }
    }
    if (channel.rpm_source === 'baseline' || (correction && !channel.rpm_source)) {
      for (const key of ['rpm', 'rpm_short', 'rpm_long', 'monthly_income_est']) delete checked[key];
    }
    return checked;
  }

  function competitionEvidence(channel, now = Date.now()) {
    const language = channelLanguage(channel);
    const reading = channel.competition;
    const measured = Date.parse(reading?.checked_at || '');
    return language && reading?.method_version === COMPETITION_METHOD
      && reading.niche === nicheFor(channel) && reading.language === language && reading.market_verified === true
      && reading.language_verified === true && reading.region_code === channel.country
      && Number.isFinite(measured) && now - measured <= 30 * DAY && measured <= now ? reading : null;
  }

  function competitionCoverage({ queries = [], videos_seen, related_videos, rival_channels }) {
    return Array.isArray(queries) && new Set(queries).size >= 2 && videos_seen >= 12 && related_videos >= 6 && rival_channels >= 3;
  }

  const competitionFor = (channel, now) => {
    const reading = competitionEvidence(channel, now);
    return reading && competitionCoverage(reading) && Number.isFinite(reading.index) ? reading : null;
  };

  function entryAssessment(channel, grouping, categoryPeers, now = Date.now()) {
    if (!topicConfirmed(channel)) return { score: null, reason: 'Проверьте тему канала' };
    const latest = Math.max(0, ...(channel.videos || []).map(video => Date.parse(video.published_at || '') || 0));
    if (!latest || latest > now || now - latest > 90 * DAY || channel.stale || channel.graduated) {
      return { score: null, reason: 'Нет свежих данных по каналу' };
    }
    const measure = competitionFor(channel, now);
    if (!measure || !grouping || grouping.n < 3 || !Number.isFinite(grouping.entry_score)) {
      return { score: null, reason: 'Недостаточно данных для оценки входа' };
    }
    const marketCap = categoryPeers > 20 ? 64 : 100;
    const groupCap = grouping.verdict === 'crowded' ? 64 : grouping.verdict === 'unproven' ? 55 : 100;
    const competitionCap = measure.index > 75 ? 35 : measure.index > 50 ? 55 : measure.index > 25 ? 74 : 100;
    return { score: Math.min(grouping.entry_score, marketCap, groupCap, competitionCap), reason: '' };
  }
  const marketKey = (channel, markets) => {
    const language = channelLanguage(channel);
    const niche = nicheFor(channel);
    return niche && allowedMarket(markets, language, channel.country) ? `${niche}|${language}` : null;
  };
  const allowedMarket = (markets, language, country) =>
    Boolean(markets?.[languageCode(language)]?.includes(String(country || '').trim().toUpperCase()));
  const clusterKey = (channel, markets) => {
    const market = marketKey(channel, markets);
    return market ? [nicheFor(channel), channel.style_group || '', channelLanguage(channel)].join('|') : null;
  };

  function clusters(channels, markets, now = Date.now()) {
    const groups = {};
    for (const channel of channels) {
      if (channel.stale || channel.graduated || !topicConfirmed(channel)) continue;
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
    languageCode, channelLanguage, videoLanguage, competitionFor, competitionEvidence, competitionCoverage,
    marketKey, allowedMarket, clusterKey, clusters, checkTopic, topicConfirmed, nicheFor, entryAssessment, COMPETITION_METHOD,
  };
})();
