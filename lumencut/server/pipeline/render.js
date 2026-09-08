import fs from 'node:fs/promises';
import path from 'node:path';
import { run, duration } from '../ffmpeg.js';
import { log } from '../store.js';

function escaped(text) { return String(text).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/\n/g, ' '); }

async function placeholder(scene, dir) {
  const file = path.join(dir, 'media', `${scene.index}.placeholder.png`);
  await run(['-y', '-f', 'lavfi', '-i', 'color=c=0x151c2b:s=1920x1080:d=1', '-vf', `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${escaped(scene.text)}':fontcolor=white:fontsize=44:box=1:boxcolor=0x00000099:boxborderw=24:x=(w-text_w)/2:y=(h-text_h)/2`, '-frames:v', '1', file]);
  return file;
}

export async function render(project, dir) {
  const segments = [];
  for (const scene of project.scenes) {
    const seconds = Math.max(0.3, (scene.endMs - scene.startMs) / 1000);
    const input = scene.clipPath || scene.mediaPath || await placeholder(scene, dir);
    const segment = path.join(dir, 'render', `segment-${scene.index}.mp4`);
    const subtitle = escaped(scene.text);
    if (scene.clipPath) {
      await run(['-y', '-i', input, '-t', String(seconds), '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${subtitle}':fontcolor=white:fontsize=44:box=1:boxcolor=0x00000099:boxborderw=12:x=(w-text_w)/2:y=h-text_h-80`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', segment]);
    } else {
      await run(['-y', '-loop', '1', '-i', input, '-t', String(seconds), '-vf', `scale=1920:1080,zoompan=z='min(zoom+0.0005,1.08)':d=${Math.max(1, Math.round(seconds * 30))}:s=1920x1080:fps=30,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${subtitle}':fontcolor=white:fontsize=44:box=1:boxcolor=0x00000099:boxborderw=12:x=(w-text_w)/2:y=h-text_h-80`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', segment]);
    }
    segments.push(segment);
  }
  const concat = path.join(dir, 'render', 'concat.txt');
  await fs.writeFile(concat, segments.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'));
  const output = path.join(dir, 'render', 'video.mp4');
  await run(['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-i', path.join(dir, 'audio', 'narration.mp3'), '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output]);
  project.render = { url: `/api/projects/${project.id}/file/render/video.mp4`, size: (await fs.stat(output)).size, durationMs: Math.round((await duration(output)) * 1000), createdAt: new Date().toISOString() };
  log(project, 'render', `render complete: ${project.render.durationMs}ms`);
}
