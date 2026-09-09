import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './store.js';

export const SETTINGS_FILE = path.join(DATA, 'settings.json');

const DEFAULTS = {
  pexelsApiKey: '',
  pixabayApiKey: '',
  llmProvider: 'none',
  geminiApiKey: '',
  geminiModel: 'gemini-1.5-flash',
  ollamaModel: 'llama3.1',
  maxClipSeconds: 5,
  ttsProvider: 'edge',
  lumeanApiKey: '',
  lumeanTemplateId: ''
};

const FIELDS = Object.keys(DEFAULTS);

export async function readStoredSettings() {
  try {
    return JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export async function readSettings() {
  return { ...DEFAULTS, ...await readStoredSettings() };
}

export async function writeSettings(settings) {
  await fs.mkdir(DATA, { recursive: true });
  const clean = Object.fromEntries(FIELDS.map(field => [field, settings[field] ?? DEFAULTS[field]]));
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

function settingOrEnv(settings, field, envField, fallback) {
  const value = settings[field];
  if (value !== undefined && value !== null && value !== '') return value;
  return process.env[envField] || fallback;
}

export async function getConfig() {
  const settings = await readStoredSettings();
  const provider = settingOrEnv(settings, 'llmProvider', 'LLM_PROVIDER', 'none');
  const ttsProvider = settingOrEnv(settings, 'ttsProvider', 'TTS_PROVIDER', 'edge');
  return {
    pexelsApiKey: settingOrEnv(settings, 'pexelsApiKey', 'PEXELS_API_KEY', ''),
    pixabayApiKey: settingOrEnv(settings, 'pixabayApiKey', 'PIXABAY_API_KEY', ''),
    llmProvider: ['none', 'gemini', 'ollama'].includes(provider) ? provider : 'none',
    geminiApiKey: settingOrEnv(settings, 'geminiApiKey', 'GEMINI_API_KEY', ''),
    geminiModel: settingOrEnv(settings, 'geminiModel', 'GEMINI_MODEL', 'gemini-1.5-flash'),
    ollamaModel: settingOrEnv(settings, 'ollamaModel', 'OLLAMA_MODEL', 'llama3.1'),
    maxClipSeconds: Number(settingOrEnv(settings, 'maxClipSeconds', 'MAX_CLIP_SECONDS', 5)) || 5,
    ttsProvider: ['edge', 'lumean'].includes(ttsProvider) ? ttsProvider : 'edge',
    lumeanApiKey: settingOrEnv(settings, 'lumeanApiKey', 'LUMEAN_API_KEY', ''),
    lumeanTemplateId: settingOrEnv(settings, 'lumeanTemplateId', 'LUMEAN_TEMPLATE_ID', '')
  };
}

export function maskKey(value) {
  return value ? `••••${String(value).slice(-4)}` : '';
}

export async function publicSettings() {
  const config = await getConfig();
  return {
    pexelsApiKey: maskKey(config.pexelsApiKey),
    pixabayApiKey: maskKey(config.pixabayApiKey),
    llmProvider: config.llmProvider,
    geminiApiKey: maskKey(config.geminiApiKey),
    geminiModel: config.geminiModel,
    ollamaModel: config.ollamaModel,
    maxClipSeconds: config.maxClipSeconds,
    ttsProvider: config.ttsProvider,
    lumeanApiKey: maskKey(config.lumeanApiKey),
    lumeanTemplateId: config.lumeanTemplateId,
    hasPexels: Boolean(config.pexelsApiKey),
    hasPixabay: Boolean(config.pixabayApiKey),
    hasGemini: Boolean(config.geminiApiKey),
    hasLumean: Boolean(config.lumeanApiKey)
  };
}

export async function updateSettings(input = {}) {
  const current = await readSettings();
  const next = { ...current };
  for (const field of FIELDS) {
    const value = input[field];
    if (value === undefined || (typeof value === 'string' && value.startsWith('••••'))) continue;
    if (field === 'maxClipSeconds') {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) next[field] = number;
    } else if (field === 'llmProvider') {
      if (['none', 'gemini', 'ollama'].includes(value)) next[field] = value;
    } else if (field === 'ttsProvider') {
      if (['edge', 'lumean'].includes(value)) next[field] = value;
    } else if (typeof value === 'string') {
      next[field] = value;
    }
  }
  await writeSettings(next);
  return publicSettings();
}
