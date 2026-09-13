import { makeQueries } from '../llm.js';
import { log } from '../store.js';

export async function queries(project) {
  const result = await makeQueries(project.scenes);
  const topic = result.topic || '';
  project.topic = topic;
  project.scenes.topic = topic;
  project.scenes.forEach((scene, i) => {
    scene.queries = (result.queries[i] || []).slice(0, 3);
  });
  log(project, 'queries', `topic: ${topic}`);
}
