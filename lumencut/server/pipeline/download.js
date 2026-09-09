import fs from 'node:fs/promises';
import path from 'node:path';
import { run, probe } from '../ffmpeg.js';
import { log } from '../store.js';

let lastWikimediaDownloadAt = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForWikimediaSlot() {
  const wait = Math.max(0, 700 - (Date.now() - lastWikimediaDownloadAt));
  if (wait) await sleep(wait);
  lastWikimediaDownloadAt = Date.now();
}

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(5000, Math.max(0, seconds * 1000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.min(5000, Math.max(0, timestamp - Date.now())) : 0;
}

async function fetchFile(url, target, source) {
  let retryAfterUsed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (source === 'wikimedia') await waitForWikimediaSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'LumenCut/1.0 (personal tool)' } });
      clearTimeout(timer);
      if (response.status === 429 && !retryAfterUsed) {
        retryAfterUsed = true;
        await sleep(retryAfterMs(response.headers.get('retry-after')));
        continue;
      }
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
        await fetchFile(candidate.url, source, candidate.source);
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
