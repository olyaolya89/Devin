function tokens(value) { return String(value || '').toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(Boolean).map(x => x.slice(0, 5)); }
export function rankScene(scene, used = new Set()) {
  const target = new Set([...tokens(scene.text), ...scene.queries.flatMap(tokens)]);
  const stock = candidate => candidate.source === 'pexels' || candidate.source === 'pixabay';
  const candidates = (scene.candidates || []).map(candidate => {
    const hay = new Set(tokens(`${candidate.title} ${candidate.description}`));
    const overlap = [...target].filter(x => hay.has(x)).length;
    const qr = candidate.queryRank ?? 0;
    if (!scene.llmRanked && overlap === 0 && !(qr === 0 && stock(candidate))) return null;
    if (scene.llmRanked && candidate.llmRank === undefined) return null;
    const score = scene.llmRanked
      ? (30 - candidate.llmRank) * 2 + overlap + (candidate.kind === 'video' ? 2 : 0) + (candidate.width >= 1920 ? 1 : 0) + (stock(candidate) ? 1 : 0) - (used.has(candidate.url) ? 5 : 0)
      : overlap * 2 + (qr === 0 ? 2 : qr === 1 ? 1 : 0) + (overlap > 0 && candidate.kind === 'video' ? 2 : 0) + (candidate.width >= 1920 ? 1 : 0) + (stock(candidate) ? 1 : 0) - (used.has(candidate.url) ? 5 : 0);
    return { ...candidate, overlap, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12);
  scene.candidates = candidates;
  scene.pick = scene.candidates[0] || null;
  return scene.pick;
}
