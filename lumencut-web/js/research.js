import { splitShots } from './plan.js';

const ARCHIVE = /\b(?:archival|archive footage|original footage|historical footage|newsreel|first recording)\b|кинохроник|архивн|историческ[а-яё]+\s+кадр/iu;
const EXACT_DATE = /\b(?:1[5-9]\d\d|20\d\d)\b/u;
const LATIN_OR_CYRILLIC_ACRONYM = /\b[A-Z]{2,6}\b|(?<!\p{L})[А-ЯЁ]{2,6}(?!\p{L})/gu;
const PROPER_NAME = /\p{Lu}[\p{Ll}\p{M}]+(?:[ -]\p{Lu}[\p{Ll}\p{M}]+){0,3}/gu;
const INTRO_WORDS = /^(?:(?:The|A|An|In|At|On|From|During|Before|After|By|Near|Over)\s+)+/u;

function namedSubjects(text) {
  const names = [...text.matchAll(PROPER_NAME)]
    .filter(match => match.index > 0 || match[0].includes(' '))
    .map(match => match[0].replace(INTRO_WORDS, ''));
  return [...new Set([...names, ...(text.match(LATIN_OR_CYRILLIC_ACRONYM) || [])])].slice(0, 4);
}

export function researchScenes(script) {
  return splitShots(script).map((scene, index) => {
    const subjects = namedSubjects(scene.text);
    const reasons = [
      ARCHIVE.test(scene.text) && 'Архивная или оригинальная съёмка',
      EXACT_DATE.test(scene.text) && 'Кадр должен соответствовать эпохе',
      subjects.length > 0 && 'Возможен точный объект'
    ].filter(Boolean);
    return { number: index + 1, narration: scene.text, subjects, reasons };
  });
}
