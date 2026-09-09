import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, duration } from './ffmpeg.js';
import { getConfig } from './settings.js';
import * as lumean from './sources/lumean.js';

export const VOICES = [
  { value: 'en-GB-RyanNeural', label: 'English — Ryan', language: 'en' },
  { value: 'en-US-AriaNeural', label: 'English — Aria', language: 'en' },
  { value: 'ru-RU-DmitryNeural', label: 'Русский — Дмитрий', language: 'ru' }
];

async function synthesizeEdge(text, voice, dir) {
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

function edgeVoice(voice, text) {
  if (/^[a-z]{2}-[A-Z]{2}-/.test(voice || '')) return voice;
  const language = /[А-Яа-яЁё]/.test(text) ? 'ru' : 'en';
  return VOICES.find(item => item.language === language)?.value || VOICES[0].value;
}

export async function synthesize(text, voice, dir, onLog = () => {}) {
  const config = await getConfig();
  const isEdgeVoice = /^[a-z]{2}-[A-Z]{2}-/.test(voice || '');
  if (config.ttsProvider === 'lumean' && config.lumeanApiKey && config.lumeanTemplateId && !isEdgeVoice) {
    const target = path.join(dir, 'narration.mp3');
    try {
      await lumean.synthesize(config.lumeanApiKey, config.lumeanTemplateId, text, voice, target, onLog);
      return { path: target, boundaries: [], durationMs: Math.round((await duration(target)) * 1000) };
    } catch (error) {
      const warning = `Lumean: ${error.message}, использован Edge TTS`;
      console.warn(warning);
      const result = await synthesizeEdge(text, edgeVoice(voice, text), dir);
      return { ...result, warning };
    }
  }
  return synthesizeEdge(text, edgeVoice(voice, text), dir);
}

export async function makeSilentNarration(text, dir) {
  const out = path.join(dir, 'narration.mp3');
  await run(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(Math.max(1, text.length / 14)), '-c:a', 'libmp3lame', out]);
  return { path: out, boundaries: [], durationMs: Math.round((await duration(out)) * 1000) };
}
