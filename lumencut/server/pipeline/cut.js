import path from 'node:path';
import { run, duration } from '../ffmpeg.js';
import { log } from '../store.js';
import { getConfig } from '../settings.js';

export async function cut(project, dir) {
  const { maxClipSeconds: max } = await getConfig();
  for (const scene of project.scenes) {
    const seconds = Math.max(0.3, (scene.endMs - scene.startMs) / 1000);
    if (scene.mediaPath && scene.pick?.kind === 'video') {
      const sourceDuration = await duration(scene.mediaPath).catch(() => 0);
      const window = Math.min(max, seconds, sourceDuration || max);
      const start = sourceDuration > window ? sourceDuration * 0.15 : 0;
      const output = path.join(dir, 'clips', `${scene.index}.mp4`);
      await run(['-y', '-ss', String(start), '-t', String(window), '-i', scene.mediaPath, '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output]);
      scene.clipPath = output;
      log(project, 'cut', `scene ${scene.index + 1}: clip ${window.toFixed(2)}s`);
    }
  }
}
