(() => {
  const analysis = window.NR_NICHE_ANALYSIS;
  const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const short = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
  const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  const dateFormat = new Intl.DateTimeFormat('ru-RU');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const fmt = value => value == null ? '—' : number.format(value);
  const compact = value => value == null ? '—' : short.format(value);
  const date = value => Number.isFinite(new Date(value).getTime()) && value != null ? dateFormat.format(new Date(value)) : '—';
  const country = new Intl.DisplayNames('ru', { type: 'region' });
  const region = code => /^[A-Z]{2}$/.test(code || '') ? country.of(code) : 'Не указана';
  const duration = seconds => seconds == null ? '—'
    : seconds < 60 ? fmt(seconds) + ' сек.' : fmt(seconds / 60) + ' мин.';
  const share = (value, total) => total ? fmt(100 * value / total) + ' %' : '—';
  const videoUrl = id => 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
  const channelUrl = id => 'https://www.youtube.com/channel/' + encodeURIComponent(id);
  const videoLink = (video, text = video.title) => `<a class="text-link" href="${videoUrl(video.id)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
  const channelLink = (channel, text = channel.title) => `<a class="text-link" href="${channelUrl(channel.id)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
  const statusName = { traction: 'Набирает просмотры', low: 'Слабый отклик', inactive: 'Без публикаций за 30 дней', unknown: 'Мало сопоставимых роликов' };
  const metrics = {
    entrants: ['Первые ролики в теме', 'Выделены каналы, чьи сопоставимые ролики набирают просмотры.'],
    uploads: ['Публикации', 'Число найденных роликов по дате публикации.'],
    active: ['Активные каналы', 'Уникальные каналы с публикациями в каждом интервале.'],
    median: ['Медиана просмотров', 'Текущие просмотры роликов, опубликованных в каждом интервале.'],
    hits: ['Ролики от 100 тыс.', 'Ролики, которые набрали не менее 100 000 просмотров к дате сбора.'],
  };

  function imageUrl(video) {
    try {
      const url = new URL(video.thumbnail);
      if (url.protocol === 'https:' && (url.hostname.endsWith('.ytimg.com') || url.hostname === 'ytimg.com')) return url.href;
    } catch {}
    return 'https://i.ytimg.com/vi/' + encodeURIComponent(video.id) + '/hqdefault.jpg';
  }

  const tile = (label, value, detail = '') => `<div class="report-tile"><dt>${esc(label)}</dt><dd>${esc(value)}</dd>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
  const section = (id, title, content, open = true) => `<details class="report-section" id="${id}"${open ? ' open' : ''}><summary>${title}</summary><div class="report-body">${content}</div></details>`;

  function videoCard(video) {
    return `<article class="report-video">
      <a href="${videoUrl(video.id)}" target="_blank" rel="noopener noreferrer" class="report-thumb" aria-label="${esc(video.title)}">
        <img src="${esc(imageUrl(video))}" alt="" loading="lazy"><span>${compact(video.views)}</span>
      </a>
      <div>${videoLink(video)}<p>${esc(video.channelTitle)} · ${date(video.time)} · ${duration(video.duration)}</p></div>
    </article>`;
  }

  function channelCard(channel) {
    return `<article class="report-channel">
      ${channel.best ? `<a href="${videoUrl(channel.best.id)}" class="report-thumb" target="_blank" rel="noopener noreferrer" aria-label="${esc(channel.best.title)}"><img src="${esc(imageUrl(channel.best))}" alt="" loading="lazy"><span>${compact(channel.best.views)}</span></a>` : ''}
      <div><h4>${channelLink(channel)}</h4><p>${fmt(channel.subs)} подписчиков · ${fmt(channel.videos.length)} роликов в выборке</p>
      <p>Первый найденный · ${date(channel.earliest)}<br>Медиана свежих · <strong>${fmt(channel.recentMedian)}</strong> <small>(${channel.recent.length} рол.)</small></p>
      ${channel.best ? `<p>Лучший в выборке · ${videoLink(channel.best)}</p>` : ''}</div>
    </article>`;
  }

  function collectionNote(model, source) {
    if (!source) {
      const first = model.sourceDates[0];
      const last = model.sourceDates.at(-1);
      const range = first == null ? 'Дата замера не указана.' : date(first) === date(last)
        ? 'Дата замеров · ' + date(last) + '.' : 'Даты замеров · ' + date(first) + ' – ' + date(last) + '.';
      return `<p class="report-note">Снимок каталога. ${range} Показатели охватывают сохранённые в каталоге ролики выбранной группы.</p>`;
    }
    const searches = source.searches.map(step => `<li>${esc(step.query)} · ${esc(region(step.region))} · ${step.days} дн. · ${({ date: 'свежие', viewCount: 'просмотры', relevance: 'релевантность' })[step.order]}</li>`).join('');
    return `<p class="report-note">Свежий сбор YouTube · ${date(source.date)}. Уникальных роликов в выдаче ${fmt(source.rawVideos)}, метаданные получены для ${fmt(source.checkedVideos)}. Из кандидатов проверено ${fmt(source.checkedChannels)} из ${fmt(source.eligibleChannels)} каналов подходящих стран.</p>
      <details><summary>Запросы и полнота проверки</summary><ul>${searches}</ul>
      <p>Исключено по языку или отсутствию подтверждения · ${fmt(source.languageRejected)} роликов. По совпадению темы · ${fmt(source.topicRejected)}. По стране или её отсутствию · ${fmt(source.marketRejected)} каналов. Историю публикаций удалось получить у ${fmt(source.checkedChannels - source.playlistFailures)} каналов. У ${fmt(source.otherPrimary)} каналов история показала другой основной язык.</p>
      <p>Для каждого канала проверяется до 100 публичных загрузок. Тема определяется по совпадению слов в названиях и метаданных. Полный охват рынка через поисковую выдачу измерить нельзя.</p>
      ${source.stop ? `<p>${esc(source.stop)}. Показаны результаты завершённых запросов.</p>` : ''}</details>`;
  }

  function findings(model) {
    const { summary, rows, newcomers, traction, low, hits, week } = model;
    if (!rows.length) return '<p>В этой выборке пока нет роликов. Уточните тему или соберите свежие данные YouTube.</p>';
    const line = traction.length + low.length
      ? `У <strong>${traction.length} из ${summary.comparableNewcomers}</strong> сопоставимых новичков медиана свежих роликов достигла ${fmt(analysis.TRACTION_VIEWS)} просмотров. У ${low.length} медиана ниже порога.`
      : 'Для сравнения новичков нужно не меньше трёх роликов с известными просмотрами в окне 7–45 дней у каждого канала.';
    const hitLine = hits.length
      ? `Порог в 100 тыс. просмотров преодолели <strong>${hits.length} роликов</strong> у ${summary.hitsChannels} каналов. Лидер выборки · ${videoLink(hits[0])} (${fmt(hits[0].views)}).`
      : 'В выборке пока нет роликов с известными просмотрами от 100 тысяч.';
    return `<ul class="report-findings">
      <li>${line} ${summary.missingRecent ? `У ${summary.missingRecent} из ${newcomers.length} недавно замеченных каналов недостаточно свежих данных или публикаций.` : ''}</li>
      <li>${hitLine}</li>
      <li>За последние 7 дней найдено <strong>${week.length} публикаций</strong> от ${summary.weekChannels} каналов. У ${summary.observedNewWeek} каналов это первые обнаруженные публикации по теме.</li>
    </ul>`;
  }

  function numbers(model) {
    const { rows, videos, measured, newcomers, traction, hits, month, summary } = model;
    return `<dl class="report-tiles">
      ${tile('Каналы в выборке', fmt(rows.length))}
      ${tile('Впервые замечены за 180 дней', fmt(newcomers.length))}
      ${tile('Новички с откликом', fmt(traction.length), 'из ' + fmt(summary.comparableNewcomers) + ' сопоставимых')}
      ${tile('Найденные ролики', fmt(videos.length), fmt(measured.length) + ' с просмотрами')}
      ${tile('Просмотры этих роликов', fmt(summary.views))}
      ${tile('Медиана просмотров', fmt(summary.median))}
      ${tile('Ролики от 100 тыс.', fmt(hits.length), 'каналов с такими роликами · ' + summary.hitsChannels)}
      ${tile('Не менее 2× медианы канала', share(summary.outlierCount, summary.outlierEligible), summary.outlierCount + ' из ' + summary.outlierEligible + ' сопоставимых роликов')}
      ${tile('Публикации за 30 дней', fmt(month.length))}
      ${tile('Средняя длительность', duration(summary.meanDuration), 'известна у ' + summary.durationCount + ' роликов')}
    </dl>`;
  }

  function bars(values, label, { log = false, timeline = false } = {}) {
    const transform = value => log ? Math.log10(Math.max(0, value) + 1) : value;
    const max = Math.max(1, ...values.map(item => transform(item.value || 0)));
    return `<div class="report-chart-scroll"><ol class="report-bars${timeline ? ' report-bars-timeline' : ''}" aria-label="${esc(label)}" style="--bars:${values.length || 1}">${values.map(item => {
      const height = 100 * transform(item.value || 0) / max;
      const portion = item.value > 0 ? (item.traction || 0) / item.value * 100 : 0;
      const title = `${item.label} · ${fmt(item.value)}${item.detail ? ' · ' + item.detail : ''}`;
      return `<li title="${esc(title)}"><div class="report-bar-track"><span class="report-bar${item.highlight ? ' report-bar-hit' : ''}" style="--height:${height.toFixed(2)}%;--portion:${portion.toFixed(2)}%"></span></div><span class="report-bar-value">${compact(item.value)}</span><small>${esc(item.short || item.label)}</small></li>`;
    }).join('')}</ol></div>`;
  }

  function chartPanel(model) {
    const choices = Object.entries(metrics).map(([key, [label]]) => `<option value="${key}">${label}</option>`).join('');
    return `<div class="report-inline">
      <label>Показатель <select id="reportMetric">${choices}</select></label>
      <label>Период <select id="reportWindow"><option value="30">6 интервалов по 30 дней</option><option value="7">4 недели</option></select></label>
    </div><div id="reportActivityChart">${activityChart(model, 30, 'entrants')}</div>`;
  }

  function activityChart(model, span, metric) {
    const rows = analysis.timeline(model, span, span === 7 ? 4 : 6, metric).map(bin => ({
      ...bin, label: dayFormat.format(bin.from) + ' – ' + dayFormat.format(bin.to - 1),
      detail: bin.traction ? 'с откликом · ' + bin.traction : '',
    }));
    return bars(rows, metrics[metric][0], { timeline: true }) + `<p class="report-note">${metrics[metric][1]}</p>`;
  }

  function newcomers(model) {
    const { newcomers, traction, low, now } = model;
    const comparable = newcomers.filter(row => row.recentMedian != null);
    const maxViews = Math.max(10, ...comparable.map(row => row.recentMedian));
    const dots = comparable.slice().reverse().map(row => {
      const age = (now - row.earliest) / 86400000;
      const left = Math.max(1, Math.min(98, age * 100 / 180));
      const bottom = Math.max(2, Math.min(96, Math.log10(row.recentMedian + 1) / Math.log10(maxViews + 1) * 100));
      const size = Math.min(19, 7 + Math.log10((row.subs || 0) + 1) * 2);
      const label = `${row.title} · ${Math.floor(age)} дн. · медиана ${fmt(row.recentMedian)} · ${statusName[row.status]}`;
      return `<a class="report-dot dot-${row.status}" style="--x:${left.toFixed(2)}%;--y:${bottom.toFixed(2)}%;--size:${size.toFixed(1)}px" href="${channelUrl(row.id)}" target="_blank" rel="noopener noreferrer" title="${esc(label)}" aria-label="${esc(label)}"></a>`;
    }).join('');
    const classified = traction.length + low.length;
    const rate = classified ? 100 * traction.length / classified : 0;
    return `<p><strong>${traction.length} набирают просмотры</strong> · ${low.length} со слабым откликом · ${newcomers.length - classified} пока без достаточных данных.</p>
      ${classified ? `<div class="report-proportion" role="img" aria-label="Доля новичков с откликом ${share(traction.length, classified)}"><span style="width:${rate.toFixed(2)}%"></span></div>` : ''}
      ${dots ? `<div class="report-scatter"><div class="report-scatter-y"><span>${compact(maxViews)}</span><span>${compact(Math.sqrt(maxViews + 1) - 1)}</span><span>0</span></div><div class="report-scatter-area" aria-label="Медиана просмотров и возраст найденных новичков">${dots}</div></div><div class="report-scatter-x"><span>0 дней</span><span>90</span><span>180 дней</span></div><p class="report-note">По горизонтали — дней с первого найденного ролика по теме. По вертикали — медиана роликов 7–45 дней по логарифмической шкале. Размер точки зависит от числа подписчиков. Точка открывает канал.</p>` : '<p class="report-note">Для карты нужны датированные ролики с известными просмотрами.</p>'}
      <p class="report-note">Сопоставимый канал опубликовал ролик за последние 30 дней и имеет минимум три ролика возрастом 7–45 дней. Порог отклика для этой группировки — 1 000 просмотров по медиане. Это критерий выборки.</p>`;
  }

  function channelDetail(channel, asOwn = false) {
    if (!channel) return '<p class="report-note">В выборке пока нет канала с доступными данными.</p>';
    const ordered = channel.videos.slice().reverse();
    const values = ordered.map((video, index) => ({
      value: video.views, label: video.title, short: index + 1, highlight: video.views != null && video.views >= analysis.HIT_VIEWS,
    }));
    const recentIds = new Set(ordered.slice(-4).map(video => video.id));
    const earlyHits = ordered.filter(video => video.views != null && !recentIds.has(video.id)).sort((a, b) => b.views - a.views).slice(0, 4);
    return `<div class="report-reference-head">
      <div><h3>${channelLink(channel)}</h3><p>${esc(region(channel.country))} · ${asOwn ? 'публичные загрузки' : statusName[channel.status]}</p>
      ${channel.best ? `<p>Лучший ролик выборки · ${videoLink(channel.best)} · <strong>${fmt(channel.best.views)}</strong> просмотров.</p>` : ''}
      ${channel.recent.length >= 3 && channel.medianViews != null ? `<p>Медиана свежих роликов · ${fmt(channel.recentMedian)}. Медиана всех найденных роликов канала · ${fmt(channel.medianViews)}.</p>` : ''}</div>
      <dl class="report-tiles">
        ${tile('Подписчиков', fmt(channel.subs))}
        ${tile('Роликов в выборке', fmt(channel.videos.length))}
        ${tile('Медиана выборки', fmt(channel.medianViews))}
        ${tile('Медиана свежих роликов', fmt(channel.recentMedian), channel.recent.length + ' сопоставимых')}
      </dl></div>
      ${ordered.length ? `<h4>Просмотры роликов по порядку выхода</h4>${bars(values, 'Просмотры роликов от ранних к поздним', { log: true })}<p class="report-note">От ранних к поздним. Шкала логарифмическая, значения на столбцах — публичные просмотры. ${ordered.length} роликов в выборке${channel.totalVideos == null ? '.' : ' из ' + fmt(channel.totalVideos) + ' публичных загрузок канала.'}</p>
        ${earlyHits.length ? `<h4>Сильные ранние ролики</h4><div class="report-video-grid">${earlyHits.map(videoCard).join('')}</div>` : ''}
        <h4>Последние найденные ролики</h4><div class="report-video-grid">${ordered.slice(-4).reverse().map(videoCard).join('')}</div>` : ''}`;
  }

  function channelGroup(rows, noData) {
    if (!rows.length) return `<p class="report-note">${noData}</p>`;
    const cards = rows.slice(0, 12).map(channelCard).join('');
    const more = rows.slice(12);
    return `<div class="report-channel-grid">${cards}</div>${more.length ? `<details><summary>Остальные каналы · ${more.length}</summary><div class="report-channel-grid">${more.map(channelCard).join('')}</div></details>` : ''}`;
  }

  function channelsTable(rows, sort = 'median') {
    const values = { median: item => item.recentMedian, hits: item => item.best?.views, subs: item => item.subs, recent: item => item.videos[0]?.time };
    const order = values[sort] || values.median;
    const body = rows.slice().sort((a, b) => (order(b) ?? -1) - (order(a) ?? -1)).map(row =>
      `<tr><th scope="row">${channelLink(row)}</th><td>${esc(region(row.country))}</td><td>${statusName[row.status]}</td><td>${fmt(row.subs)}</td><td>${fmt(row.videos.length)}</td><td>${date(row.earliest)}</td><td>${fmt(row.recentMedian)}</td><td>${row.best ? videoLink(row.best, fmt(row.best.views)) : '—'}</td></tr>`).join('');
    return body ? `<div class="table-wrap"><table class="comp"><thead><tr><th>Канал</th><th>Страна</th><th>Отклик</th><th>Подписчики</th><th>Ролики в выборке</th><th>Первый по теме</th><th>Медиана свежих</th><th>Лучший ролик</th></tr></thead><tbody>${body}</tbody></table></div>` : '<p>В выборке пока нет каналов.</p>';
  }

  function recentWeek(model) {
    const values = Array.from({ length: 7 }, (_, index) => {
      const from = model.now + 1 - (7 - index) * 86400000;
      const to = from + 86400000;
      return { value: model.week.filter(video => video.time >= from && video.time < to).length, label: dayFormat.format(from) };
    });
    const shown = model.week.slice(0, 12);
    return `<p>${model.week.length} публикаций · ${model.summary.weekChannels} каналов за 7 дней до даты отчёта.</p>
      ${bars(values, 'Число публикаций за последние семь дней', { timeline: true })}
      ${shown.length ? `<div class="report-video-grid">${shown.map(videoCard).join('')}</div>` : ''}`;
  }

  function packaging(model) {
    const { comparable, features, phrases } = model.packaging;
    const patterns = features.map(item => `<tr><th scope="row">${item.name}</th><td>${item.yes.length}</td><td>${fmt(item.medianYes)}</td><td>${item.no.length}</td><td>${fmt(item.medianNo)}</td></tr>`).join('');
    const repetitions = phrases.map(item => `<tr><th scope="row">«${esc(item.phrase)}»</th><td>${fmt(item.channels)}</td><td>${item.videos.length}</td><td>${fmt(item.median)}</td><td>${item.videos.slice(0, 2).map(video => videoLink(video)).join('<br>')}</td></tr>`).join('');
    return `<p>Сравнение названий по ${comparable.length} роликам возрастом 7–45 дней. Таблица отражает наблюдаемую связь в выборке.</p>
      <div class="table-wrap"><table class="comp"><thead><tr><th>Признак</th><th>Роликов с признаком</th><th>Их медиана</th><th>Без признака</th><th>Их медиана</th></tr></thead><tbody>${patterns}</tbody></table></div>
      <h4>Обороты, которые повторяют разные каналы</h4>
      ${repetitions ? `<div class="table-wrap"><table class="comp"><thead><tr><th>Фрагмент</th><th>Каналов</th><th>Роликов</th><th>Медиана просмотров</th><th>Примеры</th></tr></thead><tbody>${repetitions}</tbody></table></div><p class="report-note">Символ # обозначает число в заголовке.</p>` : '<p class="report-note">В этой выборке пока нет устойчивых повторов между разными каналами.</p>'}
      <h4>Названия и превью самых просматриваемых роликов</h4>
      <div class="report-video-grid">${model.topVideos.slice(0, 8).map(videoCard).join('')}</div>`;
  }

  function takeaways(model) {
    if (!model.rows.length) return '<p>Соберите данные для выбранной темы, чтобы получить рекомендации с примерами.</p>';
    const best = model.topVideos[0];
    const recurring = model.packaging.phrases[0];
    const alternate = model.topVideos.find(video => best && video.channelId !== best.channelId);
    return `<ol class="report-plan">
      <li><strong>Проверьте повторяемость результата.</strong> ${model.summary.hitsChannels > 1 ? `Ролики от 100 тыс. есть у ${model.summary.hitsChannels} разных каналов. Сверьте хиты с их последними публикациями в разделе референсов.` : 'Пока сильные результаты либо отсутствуют, либо сосредоточены у одного канала. Начните с сравнения динамики конкурентов.'}</li>
      <li><strong>Выберите отстройку.</strong> ${recurring ? `Оборот «${esc(recurring.phrase)}» встретился у ${recurring.channels} каналов. Для своей связки выберите конкретный объект, случай или регион и добавьте проверяемую деталь. Пример повтора · ${videoLink(recurring.videos[0])}.` : best ? `Разберите конкретный вопрос из ${videoLink(best)} и проверьте, какие соседние вопросы уже освещены у конкурентов.` : 'Начните с конкретного вопроса и проверьте его в свежих публикациях.'}</li>
      <li><strong>Подготовьте две связки названия и превью.</strong> ${best ? `Для первой проверьте, какой вопрос обещает решить ${videoLink(best)}. Сделайте заголовок про другой конкретный случай и покажите его на превью.` : ''} ${alternate ? `Для второй сравните композицию с ${videoLink(alternate)}. Проверьте, читается ли смысл превью при уменьшении.` : ''}</li>
      <li><strong>Возьмите темп за ориентир.</strong> ${model.summary.medianCadence == null ? 'Для ориентира по темпу истории пока мало.' : `У каналов, чья наблюдаемая история охватывает 30 дней, медиана — ${fmt(model.summary.medianCadence)} найденных публикаций за этот период.`} Сравните свои первые ролики в одинаковом возрасте.</li>
      <li><strong>Снимите показатели в Studio.</strong> После публикации запишите показы, CTR и удержание в одинаковом окне. По ним можно понять, на каком этапе теряется зритель.</li>
    </ol>`;
  }

  function topicRecipes(model) {
    const selected = [];
    for (const video of [...model.hits, ...model.topVideos]) {
      if (selected.some(other => other.channelId === video.channelId)) continue;
      selected.push(video);
      if (selected.length === 3) break;
    }
    if (!selected.length) return '';
    const angles = [
      ['Новый случай с тем же вопросом', '«Почему [результат] случился с [другой объект]»', 'Покажите объект и одну видимую деталь, которую объяснит ролик.'],
      ['Сравнение двух случаев', '«[Объект A] и [объект B] · что объясняет разницу?»', 'Поставьте рядом два сопоставимых кадра и выделите одно различие.'],
      ['Проверка того, что было дальше', '«Что изменилось в [место или объект] после [событие]»', 'Сопоставьте два проверенных изображения из разных дат.'],
    ];
    return `<h4>Связки для проверки</h4><div class="report-recipe-grid">${selected.map((video, index) => {
      const [angle, title, thumbnail] = angles[index];
      return `<article class="report-recipe"><h5>${angle}</h5><p><strong>Референс</strong> · ${videoLink(video)} · ${fmt(video.views)} просмотров.</p><p><strong>Основа заголовка</strong> · ${title}</p><p><strong>Превью</strong> · ${thumbnail}</p></article>`;
    }).join('')}</div>`;
  }

  function compare(current, other) {
    if (!other) return '<p class="report-note">Выберите вторую нишу в том же языке и стране.</p>';
    const metrics = [
      ['Каналов', item => item.model.rows.length],
      ['Роликов', item => item.model.videos.length],
      ['Медиана просмотров', item => item.model.summary.median],
      ['Роликов от 100 тыс.', item => item.model.hits.length],
      ['Каналов с такими роликами', item => item.model.summary.hitsChannels],
      ['Публикаций за 7 дней', item => item.model.week.length],
      ['Новички с откликом / сопоставимые', item => item.model.traction.length + ' / ' + item.model.summary.comparableNewcomers],
    ];
    return `<div class="table-wrap"><table class="comp"><thead><tr><th>Показатель</th><th>${esc(current.label)}</th><th>${esc(other.label)}</th></tr></thead><tbody>
      ${metrics.map(([label, value]) => `<tr><th scope="row">${label}</th>${[current, other].map(item => {
        const result = value(item);
        return `<td>${typeof result === 'string' ? esc(result) : fmt(result)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div><p class="report-note">Обе колонки рассчитаны по сохранённому каталогу и одним правилам, с одинаковыми языком и страной.</p>`;
  }

  function mount(root, { scope, model, source, label, scopeLabel, similar, actions }) {
    const title = scope.query ? label + ' · ' + scope.query : label;
    const anchors = [['reportNumbers', 'Цифры'], ['reportRivals', 'Каналы'], ['reportPackaging', 'Упаковка'], ['reportCompare', 'Сравнение'], ['reportOwn', 'Свой канал'], ['reportPlan', 'План']];
    root.innerHTML = `<div class="report-toolbar"><button type="button" class="btn" id="reportBack">← К списку ниш</button></div>
      <header class="report-hero">
        <p class="report-scope">${esc(scopeLabel)} · ${source ? 'Свежий сбор YouTube' : 'Снимок каталога'}</p>
        <h1 tabindex="-1" id="reportTitle">${esc(title)}</h1>${findings(model)}
      </header>
      <nav class="report-nav" aria-label="Разделы разбора">${anchors.map(([id, text]) => `<button type="button" data-report-jump="${id}">${text}</button>`).join('')}</nav>
      <div class="report-controls">
        <form id="reportScopeForm" class="report-inline">
          <label>Уточнить поднишу <input id="reportQuery" type="search" maxlength="150" value="${esc(scope.query)}" placeholder="Уточнение на языке ниши"></label>
          <label>Длина роликов <select id="reportLength"><option value="0">Любая доступная</option><option value="180">От 3 минут</option><option value="600">От 10 минут</option></select></label>
          <button type="submit" class="btn">Применить</button>
        </form>
        <div class="report-inline"><button type="button" id="reportRefresh" class="btn btn-red">Собрать свежий разбор</button>
        ${source ? '<button type="button" id="reportSnapshot" class="btn">Снимок каталога</button>' : ''}
        <button type="button" class="text-link" id="reportKeyEdit">Изменить ключ YouTube API</button><p id="reportProgress" class="report-note" role="status"></p></div>
        <form id="reportKeyForm" class="report-inline" hidden>
          <label>Ключ YouTube Data API<input id="reportKey" type="password" autocomplete="off" required></label>
          <button type="submit" class="btn">Продолжить</button>
        </form>
        ${collectionNote(model, source)}
      </div>
      ${section('reportNumbers', 'Ниша в цифрах', numbers(model) + chartPanel(model))}
      ${section('reportRivals', 'Карта новичков', newcomers(model))}
      ${section('reportLeaders', 'Референсы · сильные каналы', model.leaders.length ? model.leaders.map(row => `<details class="report-reference"><summary>${esc(row.title)} · ${compact(row.best.views)} у лучшего ролика</summary>${channelDetail(row)}</details>`).join('') : '<p>Пока нет референсов с открытыми просмотрами.</p>')}
      ${section('reportGrowing', `Кто набирает просмотры · ${model.traction.length}`, channelGroup(model.traction, 'Нет сопоставимых новичков выше порога отклика.'), false)}
      ${section('reportLow', `Кто буксует · ${model.low.length}`, channelGroup(model.low, 'Нет сопоставимых новичков ниже порога отклика.'), false)}
      ${section('reportAll', `Все найденные каналы · ${model.rows.length}`, `<label class="report-inline">Сортировка <select id="reportSort"><option value="median">Медиана свежих</option><option value="hits">Лучший ролик</option><option value="subs">Подписчики</option><option value="recent">Последние публикации</option></select></label><div id="reportTable">${channelsTable(model.rows)}</div>`, false)}
      ${section('reportWeek', 'Кто снимал за последнюю неделю', recentWeek(model))}
      ${section('reportPackaging', 'Упаковка · названия и превью', packaging(model))}
      ${section('reportCompare', 'Сравнение ниш', `<label class="report-inline">Вторая ниша <select id="reportOther"><option value="">Выберите нишу</option>${similar.map(item => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join('')}</select></label><div id="reportComparison">${compare(null, null)}</div>`, false)}
      ${section('reportOwn', 'Свой канал или дополнительный референс', `<form id="reportOwnForm" class="report-inline"><label>Ссылка или @имя <input id="reportOwnQuery" placeholder="@название" required maxlength="200"></label><button type="submit" class="btn">Сравнить канал</button></form>
        <p id="reportOwnProgress" role="status" class="report-note"></p><div id="reportOwnResult"></div>
        <details class="report-studio"><summary>Добавить данные из YouTube Studio</summary>
          <form id="reportStudioForm"><p class="report-note">Возьмите показатели из одного периода и одного набора роликов. Их можно ввести на этой странице. Данные используются только здесь.</p>
            <div class="report-inline"><label>Период <input name="period" placeholder="Например, первые 7 дней" maxlength="70" required></label><label>Показы <input name="impressions" type="number" min="0" step="1"></label><label>CTR, % <input name="ctr" type="number" min="0" max="100" step="any"></label><label>Средний процент просмотра <input name="retention" type="number" min="0" step="any"></label><label>Доход, USD <input name="revenue" type="number" step="any"></label><button type="submit" class="btn">Добавить к отчёту</button></div>
          </form><div id="reportStudioResult" role="status"></div>
        </details>`, false)}
      ${section('reportPlan', 'Отстройка, связки и план проверки', takeaways(model) + topicRecipes(model))}
      ${section('reportMethod', 'Как посчитаны показатели', '<p>Объём и медианы рассчитаны по опубликованным роликам выборки. Просмотры накоплены к дате замера. Пропуски данных пропускаются при расчёте медиан. Для показателя 2× используются ролики от 7 дней и минимум три ролика для медианы канала.</p><p>Язык определяется по открытым метаданным. Страна — по профилю канала. Дата входа — первый найденный ролик по теме. Показы, CTR, удержание и реальный доход доступны владельцу в YouTube Studio. Публичное число подписчиков YouTube округляет.</p>', false)}`;

    const find = selector => root.querySelector(selector);
    find('#reportLength').value = String(scope.minSeconds);
    find('#reportBack').addEventListener('click', actions.back);
    find('#reportScopeForm').addEventListener('submit', event => {
      event.preventDefault();
      actions.scope(find('#reportQuery').value.trim(), Number(find('#reportLength').value));
    });
    root.querySelectorAll('[data-report-jump]').forEach(button => button.addEventListener('click', () => {
      const section = find('#' + button.dataset.reportJump);
      section.open = true;
      section.scrollIntoView({ block: 'start' });
    }));
    const updateChart = () => { find('#reportActivityChart').innerHTML = activityChart(model, Number(find('#reportWindow').value), find('#reportMetric').value); };
    find('#reportWindow').addEventListener('change', updateChart);
    find('#reportMetric').addEventListener('change', updateChart);
    find('#reportSort').addEventListener('change', event => { find('#reportTable').innerHTML = channelsTable(model.rows, event.target.value); });
    find('#reportOther').addEventListener('change', event => {
      find('#reportComparison').innerHTML = compare(actions.baseline(), actions.comparison(event.target.value));
    });
    find('#reportSnapshot')?.addEventListener('click', actions.snapshot);
    find('#reportStudioForm').addEventListener('submit', event => {
      event.preventDefault();
      const values = new FormData(event.target);
      const impressions = values.get('impressions');
      const ctr = values.get('ctr');
      const reading = impressions === '0' ? 'В выбранном окне Studio показывает 0 показов. Сначала проверьте даты и выбранные ролики в Studio.'
        : impressions && Number(impressions) > 0 && ctr === '0' ? 'Studio показывает ненулевые показы и CTR 0 %. Проверьте первые кадры, название и превью на тех же роликах.'
          : 'Для диагностики сравните эти показатели с предыдущими публикациями своего канала в таком же окне.';
      find('#reportStudioResult').innerHTML = `<h4>Статистика из Studio · ${esc(values.get('period'))}</h4><dl class="report-tiles">${[
        ['Показы', 'impressions'], ['CTR, %', 'ctr'], ['Средний процент просмотра', 'retention'], ['Доход, USD', 'revenue'],
      ].map(([label, key]) => tile(label, values.get(key) === '' ? '—' : fmt(Number(values.get(key))))).join('')}</dl><p>${reading}</p>`;
    });

    let pendingAction;
    function requestKey(run) {
      pendingAction = run;
      find('#reportKey').value = '';
      find('#reportKeyForm').hidden = false;
      find('#reportKey').focus();
      find('#reportProgress').textContent = 'Укажите ключ для прямого запроса к YouTube.';
      find('#reportKeyForm').scrollIntoView({ block: 'nearest' });
    }

    function withKey(run) {
      const saved = actions.getKey();
      if (saved) return run(saved);
      requestKey(run);
    }

    find('#reportKeyForm').addEventListener('submit', async event => {
      event.preventDefault();
      const key = find('#reportKey').value.trim();
      if (!key || !pendingAction) return;
      const run = pendingAction;
      pendingAction = null;
      find('#reportKeyForm').hidden = true;
      await run(key);
    });

    async function refresh(key) {
      const button = find('#reportRefresh');
      const progress = find('#reportProgress');
      if (!button || button.disabled) return;
      button.disabled = true;
      progress.textContent = 'Собираю публичные данные YouTube…';
      try {
        const result = await actions.refresh(key, message => { progress.textContent = message; });
        if (!result) return;
        if (!result.channels.length) {
          progress.textContent = 'В запросах не осталось каналов с подтверждёнными темой, языком и страной. Можно уточнить тему и повторить сбор.';
          return;
        }
        actions.showSource(result);
      } catch (error) { progress.textContent = error.message || 'Не удалось получить данные YouTube.'; }
      finally { button.disabled = false; }
    }
    find('#reportRefresh').addEventListener('click', () => withKey(refresh));
    find('#reportKeyEdit').addEventListener('click', () => requestKey(refresh));

    find('#reportOwnForm').addEventListener('submit', event => {
      event.preventDefault();
      const handle = find('#reportOwnQuery').value.trim();
      const form = event.target;
      withKey(async key => {
        const progress = find('#reportOwnProgress');
        const button = form.querySelector('button');
        if (!form.isConnected || button.disabled) return;
        button.disabled = true;
        progress.textContent = 'Загружаю публичные данные канала…';
        try {
          const data = await actions.inspect(key, handle);
          if (!form.isConnected) return;
          const row = analysis.analyseChannel(data, Date.now(), scope.minSeconds);
          const sameAge = row.recentMedian == null || model.packaging.comparableMedian == null ? ''
            : `<p>У канала медиана ${fmt(row.recentMedian)} на ${row.recent.length} роликах возрастом 7–45 дней. У выборки ниши по тому же возрасту публикаций медиана ${fmt(model.packaging.comparableMedian)} на ${model.packaging.comparable.length} роликах.</p>`;
          progress.textContent = '';
          find('#reportOwnResult').innerHTML = sameAge + channelDetail(row, true);
        } catch (error) { progress.textContent = error.message || 'Не удалось получить данные канала.'; }
        finally { button.disabled = false; }
      });
    });
  }

  window.NR_NICHE_REPORT = { mount };
})();
