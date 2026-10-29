import path from 'node:path';
import { saveProject, projectDir, log } from '../store.js';
import { normalize } from './normalize.js';
import { tts } from './tts.js';
import { queries } from './queries.js';
import { search } from './search.js';
import { rankScene } from './rank.js';
import { download } from './download.js';
import { cut } from './cut.js';
import { layout } from './layout.js';
import { render } from './render.js';

const steps = ['normalize', 'tts', 'queries', 'search', 'rank', 'download', 'cut', 'layout', 'render'];
export async function runPipeline(project, from = 'normalize') {
  const dir = projectDir(project.id);
  const start = Math.max(0, steps.indexOf(from));
  project.status = 'running';
  for (let i = start; i < steps.length; i++) {
    const step = steps[i]; project.stage = step; project.progress = Math.round(i / steps.length * 100);
    log(project, step, `start ${step}`); await saveProject(project);
    if (step === 'normalize') normalize(project);
    if (step === 'tts') await tts(project, dir);
    if (step === 'queries') await queries(project);
    if (step === 'search') await search(project);
    if (step === 'rank') {
      const used = new Set();
      project.scenes.forEach(scene => { rankScene(scene, used); if (scene.pick) used.add(scene.pick.url); });
    }
    if (step === 'download') await download(project, dir);
    if (step === 'cut') await cut(project, dir);
    if (step === 'layout') await layout(project, dir);
    if (step === 'render') await render(project, dir);
    project.progress = Math.round((i + 1) / steps.length * 100); await saveProject(project);
  }
  project.status = 'ready'; project.stage = 'done'; project.progress = 100; await saveProject(project);
  return project;
}
