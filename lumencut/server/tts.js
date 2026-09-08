import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, duration } from './ffmpeg.js';

export const VOICES = [
  { value: 'en-GB-RyanNeural', label: 'English — Ryan', language: 'en' },
  { value: 'en-US-AriaNeural', label: 'English — Aria', language: 'en' },
  { value: 'ru-RU-DmitryNeural', label: 'Русский — Дмитрий', language: 'ru' }
];

export async function synthesize(text, voice, dir) {
  await fs.mkdir(dir, { recursive: true });
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
    sentenceBoundaryEnabled: true
  });
  const result = await tts.toFile(dir, text);
  const target = path.join(dir, 'narration.mp3');
  await fs.rename(result.audioFilePath, target);
  let boundaries = [];
  if (result.metadataFilePath) {
    try {
      const raw = await fs.readFile(result.metadataFilePath, 'utf8');
      boundaries = raw.split(/\n/).filter(Boolean).map(line => JSON.parse(line))
        .filter(x => x.type === 'WordBoundary' || x.type === 'wordBoundary');
    } catch {}
  }
  const durationMs = Math.round((await duration(target)) * 1000);
  return { path: target, boundaries, durationMs };
}

export async function makeSilentNarration(text, dir) {
  const out = path.join(dir, 'narration.mp3');
  await run(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(Math.max(1, text.length / 14)), '-c:a', 'libmp3lame', out]);
  return { path: out, boundaries: [], durationMs: Math.round((await duration(out)) * 1000) };
}
