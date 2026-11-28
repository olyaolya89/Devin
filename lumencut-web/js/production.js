import { cleanOverlay, DOC_OVERLAYS, MOODS } from './plan.js';

export const PRODUCTION_FORMAT = 'lumencut.production';
export const LIVE_TARGET = 0.55;
const EPS = 0.025;

export const MEDIA_CONTEXTS = {
  exact: 'Точный кадр', stock: 'Иллюстративный кадр', archive: 'Архив',
  reconstruction: 'Реконструкция', graphic: 'Схема'
};

export function mediaContext(media) {
  if (Object.hasOwn(MEDIA_CONTEXTS, media?.context)) return media.context;
  if (media?.context === '') return '';
  if (media?.footage === 'illustration') return 'reconstruction';
  if (['Pexels', 'Pixabay'].includes(media?.source)) return 'stock';
  return '';
}

export function publicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function text(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function importMedia(input, label) {
  const kind = input?.kind;
  const file = text(input?.file);
  const url = publicUrl(input?.url);
  if (!['image', 'video'].includes(kind) || (!file && !url) || (file && /[/\\]/.test(file))) {
    throw new Error(`${label}: укажите тип кадра и имя файла или прямую HTTPS-ссылку.`);
  }
  const source = text(input.source), author = text(input.author), license = text(input.license);
  const page = publicUrl(input.page);
  if (!source || !author || !license) throw new Error(`${label}: укажите источник, автора и лицензию.`);
  return {
    id: file ? 'local:' + file : url, file, url, kind,
    thumb: publicUrl(input.thumb), page, source, author, license, licenseUrl: publicUrl(input.licenseUrl),
    tags: text(input.tags), context: mediaContext(input), caption: text(input.caption, 72),
    duration: Number.isFinite(input.duration) && input.duration > 0 ? input.duration : undefined
  };
}

export function importProduction(input) {
  if (input.version !== 1 || !Array.isArray(input.shots) || !input.shots.length) {
    throw new Error('Нужен монтажный план LumenCut версии 1 со сценами.');
  }
  let cursor = 0;
  const shots = input.shots.map((item, i) => {
    const label = `Сцена ${i + 1}`;
    const start = item?.start, end = item?.end, narration = text(item?.text, 4000);
    if (!narration || !Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.1 || Math.abs(start - cursor) > EPS || !Array.isArray(item.cuts)) {
      throw new Error(`${label}: нужен текст, интервал без разрывов и список кадров.`);
    }
    cursor = end;
    const cuts = item.cuts.map((cut, j) => {
      const name = `${label}, кадр ${j + 1}`;
      const media = importMedia(cut?.media, name);
      const { t0, t1, from = 0 } = cut;
      if (![t0, t1, from].every(Number.isFinite) || t1 <= t0 || from < 0) throw new Error(`${name}: неверный интервал.`);
      return { media, t0, t1, from };
    });
    const wt = item.wt;
    const overlay = cleanOverlay(item.overlay, narration);
    return {
      id: i, text: narration, start, end, cuts, picks: cuts.map(c => c.media),
      wt: Array.isArray(wt) && wt.length === narration.split(/\s+/).length && wt.every((t, j) => Number.isFinite(t) && t >= start && t <= end && (!j || t >= wt[j - 1])) ? wt : undefined,
      wordEnd: Number.isFinite(item.wordEnd) && item.wordEnd > start && item.wordEnd <= end ? item.wordEnd : end,
      meaning: text(item.meaning), visual: text(item.visual) || narration,
      subject: text(item.subject), reviewed: item.reviewed === true,
      queries: Array.isArray(item.queries) ? item.queries.slice(0, 3).map(q => text(q, 100)).filter(Boolean) : [],
      mood: MOODS.includes(item.mood) ? item.mood : 'wonder',
      overlay: overlay && DOC_OVERLAYS.includes(overlay.type) ? overlay : { type: 'none' }
    };
  });
  return { shots, script: shots.map(s => s.text).join('\n'), topic: text(input.topic), voiceFile: text(input.voiceFile) };
}

export function auditProduction(shots, { files, voice, maxCut = 5 }) {
  const issues = new Map(), used = new Set();
  let live = 0, reviewed = 0, end = 0;
  for (const [i, s] of shots.entries()) {
    const errors = [];
    const cuts = s.cuts || [];
    if (![s.start, s.end].every(Number.isFinite) || s.end <= s.start || Math.abs(s.start - end) > EPS) errors.push('проверьте время сцены');
    end = s.end;
    if (cuts.length && !s.reviewed) errors.push('проверьте смысл сцены, выбранные фрагменты, подписи и права');
    if (s.subject && !cuts.some(c => ['exact', 'archive'].includes(mediaContext(c.media)))) {
      errors.push(`нужен проверенный кадр для «${s.subject}»`);
    }
    let cursor = s.start;
    for (const c of cuts) {
      const p = c.media, length = c.t1 - c.t0;
      if (!Number.isFinite(length) || length <= 0 || Math.abs(c.t0 - cursor) > EPS || c.t1 > s.end + EPS) errors.push('проверьте интервалы кадров');
      cursor = c.t1;
      if (length > maxCut + EPS) errors.push(`добавьте кадр: текущий дольше ${maxCut} с`);
      if (!p?.author || !p?.license) errors.push('укажите автора и лицензию');
      if (!p) continue;
      const context = mediaContext(p);
      if (!context) errors.push('укажите, что показывает кадр');
      if (!['image', 'video'].includes(p.kind)) errors.push('проверьте тип исходника');
      if (p.kind === 'video' && (!Number.isFinite(c.from) || c.from < 0 ||
          (Number.isFinite(p.duration) && c.from + length * 0.75 > p.duration + EPS))) errors.push('проверьте точку входа и длину видео');
      if (p.file ? !files.has(p.file) : !publicUrl(p.url)) errors.push(p.file ? `прикрепите «${p.file}»` : 'нужна прямая ссылка на кадр');
      const key = p.file || p.url;
      if ((p.id && used.has(p.id)) || (key && used.has(key))) errors.push('замените повторяющийся кадр');
      if (p.id) used.add(p.id);
      if (key) used.add(key);
      if (p.kind === 'video' && ['exact', 'stock', 'archive'].includes(context) && Number.isFinite(length) && length > 0) live += length;
    }
    if (!cuts.length) errors.push('добавьте кадр');
    else if (Math.abs(cursor - s.end) > EPS) errors.push('закройте пропуск в конце сцены');
    if (errors.length) issues.set(i, [...new Set(errors)]);
    else reviewed++;
  }
  const global = [];
  if (!voice) global.push('Загрузите озвучку для финального MP4.');
  else if (Math.abs(voice.duration - end) > 0.1) global.push('Длительность озвучки не совпадает с монтажным планом.');
  return { issues, global, reviewed, liveShare: end > 0 ? Math.min(1, live / end) : 0 };
}

export function reviewPacket({ shots, topic, voiceFile, timing }, audit) {
  return {
    format: 'lumencut.review', version: 1, topic, voiceFile, timing,
    liveTarget: LIVE_TARGET, liveShare: audit.liveShare, global: audit.global,
    shots: shots.map((s, i) => ({
      number: i + 1, start: s.start, end: s.end, text: s.text,
      wt: s.wt, wordEnd: s.wordEnd, meaning: s.meaning, visual: s.visual,
      subject: s.subject, queries: s.queries, mood: s.mood, overlay: s.overlay,
      reviewed: s.reviewed === true, issues: audit.issues.get(i) || [],
      cuts: (s.cuts || []).map(({ t0, t1, from, media }) => ({
        t0, t1, from,
        media: media && {
          kind: media.kind, file: media.file, url: publicUrl(media.url), page: publicUrl(media.page),
          source: media.source, author: media.author, license: media.license, licenseUrl: publicUrl(media.licenseUrl),
          context: mediaContext(media), caption: media.caption, duration: media.duration
        }
      }))
    }))
  };
}

export function creditsFor(shots) {
  return [...new Map(shots.flatMap(s => s.picks || []).map(p => {
    const url = publicUrl(p.page) || publicUrl(p.url);
    const license = [p.license, publicUrl(p.licenseUrl)].filter(Boolean).join(' · ');
    return [p.id || p.file || url, [p.source, p.author, license, url || p.file].filter(Boolean).join(' — ')];
  })).values()].join('\n');
}
