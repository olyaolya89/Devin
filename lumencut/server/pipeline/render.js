import fs from 'node:fs/promises';
import path from 'node:path';
import { run, duration } from '../ffmpeg.js';
import { log } from '../store.js';
import { existsSync } from 'node:fs';

const FONT_CANDIDATES = [
  process.env.SUBTITLE_FONT,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf'
].filter(Boolean);

export function fontFile() {
  return FONT_CANDIDATES.find(file => existsSync(file)) || FONT_CANDIDATES[0];
}

export function filterPath(file) {
  return String(file).replace(/\\/g, '/').replace(/:/g, '\\\\:').replace(/'/g, "\\'");
}

function drawtext(textFile, extra) {
  return `drawtext=fontfile=${filterPath(fontFile())}:textfile=${filterPath(textFile)}:fontcolor=white:fontsize=44:line_spacing=8:box=1:boxcolor=0x00000099:${extra}`;
}

export function wrapText(text, maxLength = 48) {
  return String(text).split(/\r?\n/).map(paragraph => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      if (word.length > maxLength) {
        if (line) lines.push(line);
        line = '';
        for (let i = 0; i < word.length; i += maxLength) {
          const chunk = word.slice(i, i + maxLength);
          if (chunk.length === maxLength || i + maxLength < word.length) lines.push(chunk);
          else line = chunk;
        }
      } else if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= maxLength) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }).join('\n');
}

export function holdDuration(sceneSeconds, clipSeconds) {
  return Math.max(0, sceneSeconds - clipSeconds);
}

async function placeholder(scene, dir) {
  const file = path.join(dir, 'media', `${scene.index}.placeholder.png`);
  const textFile = path.join(dir, 'render', `placeholder-${scene.index}.txt`);
  await fs.writeFile(textFile, wrapText(scene.text));
  await run(['-y', '-f', 'lavfi', '-i', 'color=c=0x151c2b:s=1920x1080:d=1', '-vf', drawtext(textFile, 'boxborderw=24:x=(w-text_w)/2:y=(h-text_h)/2'), '-frames:v', '1', file]);
  return file;
}

export async function render(project, dir) {
  const segments = [];
  for (const scene of project.scenes) {
    const seconds = Math.max(0.3, (scene.endMs - scene.startMs) / 1000);
    let input = scene.clipPath || scene.mediaPath;
    if (!input) {
      log(project, 'render', `placeholder for scene ${scene.index + 1}`);
      input = await placeholder(scene, dir);
    }
    const segment = path.join(dir, 'render', `segment-${scene.index}.mp4`);
    const subtitleFile = path.join(dir, 'render', `subtitle-${scene.index}.txt`);
    await fs.writeFile(subtitleFile, wrapText(scene.text));
    const subtitle = drawtext(subtitleFile, 'boxborderw=12:x=(w-text_w)/2:y=h-text_h-80');
    if (scene.clipPath) {
      const clipDuration = await duration(input);
      const padDuration = holdDuration(seconds, clipDuration);
      const filters = ['scale=1920:1080:force_original_aspect_ratio=decrease', 'pad=1920:1080:(ow-iw)/2:(oh-ih)/2'];
      if (padDuration > 0) filters.push(`tpad=stop_mode=clone:stop_duration=${padDuration}`);
      filters.push(subtitle);
      await run(['-y', '-i', input, '-t', String(seconds), '-vf', filters.join(','), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', segment]);
    } else {
      await run(['-y', '-loop', '1', '-i', input, '-t', String(seconds), '-vf', `scale=1920:1080,zoompan=z='min(zoom+0.0005,1.08)':d=${Math.max(1, Math.round(seconds * 30))}:s=1920x1080:fps=30,${subtitle}`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', segment]);
    }
    segments.push(segment);
  }
  const concat = path.join(dir, 'render', 'concat.txt');
  await fs.writeFile(concat, segments.map(file => `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const output = path.join(dir, 'render', 'video.mp4');
  await run(['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-i', path.join(dir, 'audio', 'narration.mp3'), '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output]);
  project.render = { url: `/api/projects/${project.id}/file/render/video.mp4`, size: (await fs.stat(output)).size, durationMs: Math.round((await duration(output)) * 1000), createdAt: new Date().toISOString() };
  log(project, 'render', `render complete: ${project.render.durationMs}ms`);
}
