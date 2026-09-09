export function normalize(project) {
  const pieces = project.scriptText.split(/(?<=[.!?…])\s+|\n+/).map(text => text.trim()).filter(Boolean);
  project.scenes = pieces.map((text, index) => ({ id: `${project.id}-${index + 1}`, index, text, queries: [], candidates: [], pick: null }));
  return project.scenes;
}
