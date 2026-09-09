import { makeQueries } from '../llm.js';
export async function queries(project) {
  const result = await makeQueries(project.scenes);
  project.scenes.forEach((scene, i) => { scene.queries = (result[i] || []).slice(0, 3); });
}
