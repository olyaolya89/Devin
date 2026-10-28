// Style profiles ("style packs", like Kutly's): pacing, transitions, colour grade, graphics mix and density, subtitles, sound.
// 'doc' was measured by hand from the reference documentary (youtube.com/@MaraWardwell); a profile made from an uploaded
// reference video (reference.js) starts from 'doc' and overrides what it measured.
export const STYLES = {
  classic: {
    id: 'classic', name: 'Классика LumenCut — быстрые кадры, жёлтые плашки, караоке-субтитры', look: 'classic',
    cut: { min: 0, max: 5 }, dissolve: 0.05,
    grade: { warm: 0, sat: 1.06, contrast: 1.07, bright: 1 },
    gfx: { every: 20, types: { number: 1, date: 1, place: 1, chapter: 1, keyword: 0.2, quote: 0.2 } },
    subtitles: 'karaoke', music: { db: -16 }, sfx: { soft: false, gap: 4 }
  },
  doc: {
    id: 'doc', name: 'Документалка как у конкурента (@MaraWardwell) — плавные переходы, цифры с подписью, карты, карточки', look: 'doc',
    // reference: shots 3–8 s (median ≈ 5 s), about two thirds of changes are cross-dissolves, warm grade
    cut: { min: 3.2, max: 8 }, dissolve: 0.65,
    grade: { warm: 0.12, sat: 1.05, contrast: 1.06, bright: 1.01 },
    // reference: one editor graphic every ~18 s; the mix below is what was counted in the 15-minute reference
    gfx: { every: 18, types: { counter: 0.2, stat: 0.06, year: 0.08, title: 0.17, lowerthird: 0.07, infocard: 0.08, panel: 0.08, checklist: 0.08, chart: 0.04, map: 0.06, name: 0.04, statement: 0.04 } },
    // reference: no burned subtitles, quiet music bed ≈ 22 dB under the voice, effects barely audible
    subtitles: 'none', music: { db: -20 }, sfx: { soft: true, gap: 8 },
    framePhotos: true
  }
};

export const SUB_LOOKS = { none: 'Без субтитров', karaoke: 'Караоке — 6 слов, текущее жёлтым', boxed: 'На тёмной плашке — строка, текущее слово выделено', word: 'По одному слову, крупно (как Shorts)' };

const KEY = 'lumencut.style';
export function loadStyle() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s?.look) return s; } catch { }
  return structuredClone(STYLES.doc);
}
export function saveStyle(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { } }

// Plain-Russian summary for the UI.
const TYPE_RU = { counter: 'крупные цифры с подписью', stat: 'цифры в углу', year: 'годы', title: 'названия/ключевые слова', lowerthird: 'плашки снизу', infocard: 'инфокарточки', panel: 'боковые панели со списком', checklist: 'бумажные чек-листы', chart: 'диаграммы', map: 'карты', name: 'имена людей', statement: 'фраза-тезис на чёрном', number: 'счётчики', date: 'годы', place: 'места', chapter: 'главы', keyword: 'жёлтые плашки', quote: 'цитаты' };
export function describeStyle(s) {
  const types = Object.entries(s.gfx.types).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([k]) => TYPE_RU[k] || k);
  const m = s.measured;
  return [
    m ? `Референс: ${m.file} · ${Math.round(m.duration / 60)} мин · смен кадра: ${m.cuts}` : '',
    `Кадр держится ${s.cut.min ? `${s.cut.min.toFixed(1)}–` : 'до '}${s.cut.max.toFixed(0)} сек${m?.median ? ` (в референсе в среднем ${m.median.toFixed(1)} сек)` : ''}`,
    `Плавные переходы (наплыв): ${Math.round(s.dissolve * 100)}% смен кадра`,
    `Графика: примерно раз в ${Math.round(s.gfx.every)} сек — ${types.join(', ')}`,
    `Субтитры: ${SUB_LOOKS[s.subtitles] || s.subtitles}`,
    `Музыка: ${s.music.db} дБ${m?.musicRel != null ? ` (в референсе фон на ${Math.abs(Math.round(m.musicRel))} дБ тише голоса)` : ''} · звуки: ${s.sfx.soft ? 'тихие и редкие (шорох при появлении графики, щелчок галочки)' : 'обычные (whoosh, pop, counter)'}`,
    `Цвет: ${s.grade.warm > 0.05 ? 'тёплый' : 'нейтральный'}, насыщенность ×${s.grade.sat.toFixed(2)}, контраст ×${s.grade.contrast.toFixed(2)}`,
    m && !m.gemini ? 'Виды графики взяты из пресета «Документалка»: для их точного подсчёта по референсу нужен ключ Gemini.' : ''
  ].filter(Boolean);
}
