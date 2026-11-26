(() => {
  const DAY = 86400000;
  const WEEK = 7 * DAY;
  const NEWCOMER_DAYS = 180;
  const MIN_RECENT_VIDEOS = 3;
  const TRACTION_VIEWS = 1000;
  const HIT_VIEWS = 100000;
  const { words } = window.NR_CATALOGUE_TOOLS;
  const STOP = new Set('the a an of in to for how why what with from was are is this that and or you your el la los las un una de del en por para que con y le les une des du et der die das ein eine und mit von il lo gli che em com uma os as do da um og och en ett'.split(' '));

  function median(values) {
    if (!values.length) return null;
    const ordered = values.slice().sort((a, b) => a - b);
    return (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2;
  }

  const avg = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const latest = (a, b) => b.time - a.time;
  const byViews = (a, b) => (b.views ?? -1) - (a.views ?? -1) || latest(a, b);
  const hasViews = video => Number.isFinite(video.views);
  const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const ageDays = (now, then) => Math.floor((now - then) / DAY);
  const titleOf = video => video.title_original || video.title;
  const within = (time, from, to) => time >= from && time < to;

  function collectVideos(channel, now, minSeconds) {
    const seen = new Set();
    return (channel.videos || []).flatMap(video => {
      const time = Date.parse(video.published_at);
      if (!video.id || seen.has(video.id) || !Number.isFinite(time) || time > now) return [];
      seen.add(video.id);
      const duration = validNumber(video.duration_sec);
      if (minSeconds && (duration == null || duration < minSeconds)) return [];
      return [{
        id: video.id, title: titleOf(video) || 'Без названия', thumbnail: video.thumbnail,
        publishedAt: video.published_at, time, duration,
        views: video.views_available === false ? null : validNumber(video.views),
        channelId: channel.id, channelTitle: channel.title, country: channel.country,
      }];
    }).sort(latest);
  }

  function analyseChannel(channel, now, minSeconds = 0) {
    const videos = collectVideos(channel, now, minSeconds);
    const earliest = videos.at(-1)?.time ?? null;
    const recent = videos.filter(video => hasViews(video) && ageDays(now, video.time) >= 7 && ageDays(now, video.time) <= 45).slice(0, 10);
    const recentMedian = median(recent.map(video => video.views));
    const mature = videos.filter(video => hasViews(video) && ageDays(now, video.time) >= 7);
    const baseline = mature.length >= 3 ? median(mature.map(video => video.views)) : null;
    const active = videos.some(video => ageDays(now, video.time) < 30);
    const status = !active ? 'inactive' : recent.length < MIN_RECENT_VIDEOS ? 'unknown'
      : recentMedian >= TRACTION_VIEWS ? 'traction' : 'low';
    return {
      id: channel.id, title: channel.title, country: channel.country, subs: validNumber(channel.subs),
      totalVideos: validNumber(channel.videos_count), totalViews: validNumber(channel.total_views),
      videos, earliest, newcomer: earliest != null && ageDays(now, earliest) < NEWCOMER_DAYS,
      active, status, recent, recentMedian, baseline,
      medianViews: median(videos.filter(hasViews).map(video => video.views)),
      best: videos.filter(hasViews).sort(byViews)[0] || null,
      measuredAt: channel.updated_at || null, historyLimited: channel.history_limited === true,
    };
  }

  function repeatedPhrases(videos, max = 8) {
    const byPhrase = new Map();
    for (const video of videos) {
      const tokens = words(video.title).map(token => /^\d+$/.test(token) ? '#' : token);
      const seen = new Set();
      for (let size = 2; size <= 4; size++) {
        for (let i = 0; i + size <= tokens.length; i++) {
          const group = tokens.slice(i, i + size);
          if (group.filter(token => token.length >= 3 && !STOP.has(token)).length < 2) continue;
          const phrase = group.join(' ');
          if (seen.has(phrase)) continue;
          seen.add(phrase);
          if (!byPhrase.has(phrase)) byPhrase.set(phrase, []);
          byPhrase.get(phrase).push(video);
        }
      }
    }
    const ranked = [...byPhrase].map(([phrase, matched]) => ({
      phrase, videos: matched, channels: new Set(matched.map(video => video.channelId)).size,
      median: median(matched.filter(hasViews).map(video => video.views)),
    })).filter(item => item.channels >= 2)
      .sort((a, b) => b.channels - a.channels || b.videos.length - a.videos.length || b.phrase.length - a.phrase.length);
    const result = [];
    for (const item of ranked) {
      if (result.length === max) break;
      if (result.some(previous => previous.videos.length === item.videos.length && previous.phrase.includes(item.phrase))) continue;
      result.push(item);
    }
    return result;
  }

  function packaging(videos, now) {
    const comparable = videos.filter(video => hasViews(video) && within(now - video.time, WEEK, 46 * DAY));
    const features = [
      ['Число в названии', video => /\p{N}/u.test(video.title)],
      ['Вопросительный знак', video => /[?¿？]/.test(video.title)],
      ['Двоеточие или тире', video => /[:：—–]/.test(video.title)],
      ['Название от 70 знаков', video => [...video.title].length >= 70],
    ].map(([name, match]) => {
      const yes = comparable.filter(match);
      const no = comparable.filter(video => !match(video));
      return { name, yes, no, medianYes: median(yes.map(video => video.views)), medianNo: median(no.map(video => video.views)) };
    });
    return { comparable, comparableMedian: median(comparable.map(video => video.views)), features, phrases: repeatedPhrases(videos.filter(hasViews)) };
  }

  function build(channels, { now = Date.now(), minSeconds = 0 } = {}) {
    const unique = new Map(channels.filter(channel => channel.id).map(channel => [channel.id, channel]));
    const usedVideos = new Set();
    const rows = [...unique.values()].map(channel => {
      const videos = (channel.videos || []).filter(video => {
        if (usedVideos.has(video.id)) return false;
        usedVideos.add(video.id);
        return true;
      });
      return analyseChannel({ ...channel, videos }, now, minSeconds);
    }).filter(channel => channel.videos.length);
    rows.sort((a, b) => (b.recentMedian ?? -1) - (a.recentMedian ?? -1) || (b.best?.views ?? -1) - (a.best?.views ?? -1));
    const newcomers = rows.filter(row => row.newcomer);
    const videos = rows.flatMap(row => row.videos).sort(latest);
    const measured = videos.filter(hasViews);
    const hits = measured.filter(video => video.views >= HIT_VIEWS).sort(byViews);
    const eligible = rows.flatMap(row => row.baseline > 0
      ? row.videos.filter(video => hasViews(video) && ageDays(now, video.time) >= 7)
        .map(video => ({ video, ratio: video.views / row.baseline })) : []);
    const outliers = eligible.filter(item => item.ratio >= 2);
    const week = videos.filter(video => within(video.time, now - WEEK, now + 1));
    const month = videos.filter(video => within(video.time, now - 30 * DAY, now + 1));
    const traction = newcomers.filter(row => row.status === 'traction');
    const low = newcomers.filter(row => row.status === 'low');
    const durations = videos.map(video => video.duration).filter(duration => duration > 0);
    const sourceDates = rows.map(row => Date.parse(row.measuredAt)).filter(Number.isFinite).sort((a, b) => a - b);
    const references = rows.filter(row => row.best);
    const highest = references.slice().sort((a, b) => byViews(a.best, b.best))[0];
    const leaders = [...new Set([references[0], highest, references[1]].filter(Boolean))].slice(0, 2);
    return {
      now, rows, newcomers, traction, low, videos, measured, hits, outliers, week, month,
      leaders,
      topVideos: measured.slice().sort(byViews).slice(0, 12),
      sourceDates, packaging: packaging(videos, now),
      summary: {
        views: measured.length ? measured.reduce((sum, video) => sum + video.views, 0) : null,
        median: median(measured.map(video => video.views)),
        meanDuration: avg(durations), durationCount: durations.length,
        outlierCount: outliers.length, outlierEligible: eligible.length,
        weekChannels: new Set(week.map(video => video.channelId)).size,
        hitsChannels: new Set(hits.map(video => video.channelId)).size,
        observedNewWeek: newcomers.filter(row => row.earliest >= now - WEEK).length,
        comparableNewcomers: traction.length + low.length,
        missingRecent: newcomers.length - traction.length - low.length,
        medianCadence: median(rows.filter(row => row.earliest <= now - 30 * DAY)
          .map(row => row.videos.filter(video => within(video.time, now - 30 * DAY, now + 1)).length)),
      },
    };
  }

  function timeline(model, span, count, metric) {
    const end = model.now + 1;
    return Array.from({ length: count }, (_, index) => {
      const from = end - (count - index) * span * DAY;
      const to = from + span * DAY;
      const videos = model.videos.filter(video => within(video.time, from, to));
      const first = model.newcomers.filter(row => within(row.earliest, from, to));
      const traction = first.filter(row => row.status === 'traction').length;
      const stats = {
        entrants: first.length, uploads: videos.length, active: new Set(videos.map(video => video.channelId)).size,
        median: median(videos.filter(hasViews).map(video => video.views)),
        hits: videos.filter(video => video.views != null && video.views >= HIT_VIEWS).length,
      };
      return { from, to, value: stats[metric], traction: metric === 'entrants' ? traction : 0 };
    });
  }

  function queryPlan({ query, label, seeds = [], channels = [], regions = [], limit = 6, language }) {
    const scoped = query?.trim();
    const unique = new Set();
    const samples = channels.flatMap(channel => (channel.videos || []).slice().sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).slice(0, 1))
      .sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
    const hits = samples.slice(0, 30).flatMap(video => {
      const title = titleOf(video);
      const compact = title?.trim().split(/\s+/).slice(0, 8).join(' ');
      const westernQuery = language !== 'ja' && language !== 'ko';
      return compact && (!westernQuery || words(compact).length >= 3) ? [compact] : [];
    });
    const candidates = scoped ? [scoped, ...hits] : [...seeds.slice(0, 3), ...hits, ...seeds.slice(3), label];
    const phrases = candidates.filter(candidate => {
      const normalized = words(candidate).join(' ');
      if (!normalized || unique.has(normalized)) return false;
      unique.add(normalized);
      return true;
    });
    if (!phrases.length || !regions.length) return [];
    const searches = [];
    const max = Math.min(limit, Math.max(regions.length, (phrases.length + 1)));
    for (let index = 0; index < max; index++) {
      const queryIndex = index < 2 ? 0 : (index - 1) % phrases.length;
      searches.push({
        query: phrases[queryIndex],
        region: regions[index % regions.length],
        order: ['relevance', 'date', 'viewCount'][index % 3],
        days: index % 3 === 1 ? 90 : 180,
      });
    }
    return searches;
  }

  window.NR_NICHE_ANALYSIS = { build, timeline, analyseChannel, queryPlan, HIT_VIEWS, TRACTION_VIEWS, MIN_RECENT_VIDEOS };
})();
