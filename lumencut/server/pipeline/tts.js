import path from 'node:path';
import { synthesize } from '../tts.js';
import { duration } from '../ffmpeg.js';

export async function tts(project, dir) {
  const result = await synthesize(project.scriptText, project.voice, path.join(dir, 'audio'));
  project.durationMs = result.durationMs;
  let cursor = 0;
  const totalChars = project.scenes.reduce((sum, scene) => sum + scene.text.length, 0) || 1;
  project.scenes.forEach(scene => {
    scene.startMs = cursor;
    scene.endMs = cursor + Math.max(300, Math.round(result.durationMs * scene.text.length / totalChars));
    cursor = scene.endMs;
  });
  project.scenes.at(-1).endMs = result.durationMs;
  project.durationMs = Math.round((await duration(result.path)) * 1000);
  return result;
}
