import { search as wikimedia } from '../sources/wikimedia.js';
import { search as openverse } from '../sources/openverse.js';
import { search as pexels } from '../sources/pexels.js';
import { search as pixabay } from '../sources/pixabay.js';
import { log } from '../store.js';

const sources = { wikimedia, openverse, pexels, pixabay };

export async function search(project) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, project.scenes.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= project.scenes.length) return;
      const scene = project.scenes[index];
      const all = []; const counts = {};
      await Promise.all(scene.queries.map(async query => {
        await Promise.all(Object.entries(sources).map(async ([name, fn]) => {
          try {
            const items = await fn(query);
            counts[name] = (counts[name] || 0) + items.length;
            all.push(...items);
          } catch (error) {
            log(project, 'search', `search ${scene.index + 1} ${name} error: ${error.message}`);
          }
        }));
      }));
      scene.candidates = [...new Map(all.filter(x => x.url).map(x => [x.url, x])).values()];
      log(project, 'search', `search scene ${scene.index + 1}/${project.scenes.length}: "${scene.queries.join('" | "')}" → wikimedia ${counts.wikimedia || 0}, openverse ${counts.openverse || 0}, pexels ${counts.pexels || 0}, pixabay ${counts.pixabay || 0}, video ${scene.candidates.filter(x => x.kind === 'video').length}`);
    }
  });
  await Promise.all(workers);
}
