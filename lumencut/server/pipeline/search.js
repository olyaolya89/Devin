import { search as wikimedia } from '../sources/wikimedia.js';
import { search as openverse } from '../sources/openverse.js';
import { search as pexels } from '../sources/pexels.js';
import { search as pixabay } from '../sources/pixabay.js';
import { log } from '../store.js';
import { getConfig } from '../settings.js';
import { rerankWithLLM } from '../llm.js';

const sources = { wikimedia, openverse, pexels, pixabay };

export async function search(project) {
  let cursor = 0;
  const sceneCounts = [];
  const workers = Array.from({ length: Math.min(4, project.scenes.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= project.scenes.length) return;
      const scene = project.scenes[index];
      const all = []; const counts = {};
      await Promise.all(scene.queries.map(async (query, queryRank) => {
        const results = await Promise.all(Object.entries(sources).map(async ([name, fn]) => {
          try {
            const items = await fn(query);
            counts[name] = (counts[name] || 0) + items.length;
            return items.map(item => ({ ...item, queryRank }));
          } catch (error) {
            log(project, 'search', `search ${scene.index + 1} ${name} error: ${error.message}`);
            return [];
          }
        }));
        all.push(...results.flat());
      }));
      const merged = new Map();
      for (const item of all.filter(candidate => candidate.url)) {
        const previous = merged.get(item.url);
        if (!previous || item.queryRank < previous.queryRank) merged.set(item.url, item);
      }
      scene.candidates = [...merged.values()];
      sceneCounts[index] = counts;
    }
  });
  await Promise.all(workers);
  const config = await getConfig();
  if (config.llmProvider !== 'none') {
    try {
      await rerankWithLLM(project.scenes, project.topic);
    } catch (error) {
      log(project, 'search', `LLM rerank skipped: ${error.message}`);
    }
  }
  project.scenes.forEach((scene, index) => {
    const counts = sceneCounts[index] || {};
    const llm = scene.llmRanked ? `, llm kept ${scene.candidates.filter(candidate => candidate.llmRank !== undefined).length}` : '';
    log(project, 'search', `search scene ${scene.index + 1}/${project.scenes.length}: "${scene.queries.join('" | "')}" → wikimedia ${counts.wikimedia || 0}, openverse ${counts.openverse || 0}, pexels ${counts.pexels || 0}, pixabay ${counts.pixabay || 0}, video ${scene.candidates.filter(candidate => candidate.kind === 'video').length}${llm}`);
  });
}
