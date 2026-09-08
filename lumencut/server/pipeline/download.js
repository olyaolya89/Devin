import fs from 'node:fs/promises';
import path from 'node:path';
import { run, probe } from '../ffmpeg.js';
import { log } from '../store.js';

async function fetchFile(url, target) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'LumenCut/1.0 (personal tool)' } });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

export async function download(project, dir) {
    for (const scene of project.scenes) {
    const choices = scene.pick ? [scene.pick, ...(scene.candidates || []).filter(candidate => candidate.url !== scene.pick.url)] : [];
    if (!choices.length) {
      scene.mediaPath = null;
      log(project, 'download', `no media for scene ${scene.index + 1}`);
      continue;
    }
    scene.mediaPath = null;
    for (const candidate of choices) {
      const source = path.join(dir, 'media', `${scene.index}.source`);
      try {
        await fetchFile(candidate.url, source);
        const metadata = await probe(source);
        const stream = metadata.streams?.find(x => x.width && x.height);
        if (!stream) throw new Error('ffprobe returned no width/height');
        if (candidate.kind === 'image') {
          const normalized = path.join(dir, 'media', `${scene.index}.jpg`);
          await run(['-y', '-i', source, '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2', '-frames:v', '1', normalized]);
          scene.mediaPath = normalized;
        } else {
          scene.mediaPath = source;
        }
        scene.pick = candidate;
        break;
      } catch (error) {
        log(project, 'download', `download scene ${scene.index + 1} candidate failed: ${error.message}`);
      }
    }
  }
}
