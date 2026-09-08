function tokens(value) { return String(value || '').toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(Boolean).map(x => x.slice(0, 5)); }
export function rankScene(scene, used = new Set()) {
  const target = new Set([...tokens(scene.text), ...scene.queries.flatMap(tokens)]);
  scene.candidates = (scene.candidates || []).map(candidate => {
    const hay = new Set(tokens(`${candidate.title} ${candidate.description}`));
    const overlap = [...target].filter(x => hay.has(x)).length;
    return { ...candidate, score: overlap + (candidate.kind === 'video' ? 2 : 0) + (candidate.width >= 1920 ? 1 : 0) + (candidate.source === 'pexels' || candidate.source === 'pixabay' ? 1 : 0) - (used.has(candidate.url) ? 5 : 0) };
  }).sort((a, b) => b.score - a.score).slice(0, 12);
  scene.pick = scene.candidates[0] || null;
  return scene.pick;
}
