import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://api.lumean.app/api/public';

async function request(key, route, { method = 'GET', body } = {}) {
  const headers = { 'X-API-KEY': key };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload?.success === false) {
    const error = new Error(payload?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function mapLibraryVoices(items = []) {
  return items
    .filter(item => item?.available !== false)
    .filter(item => !item?.voice || item.voice.voice_status === undefined || item.voice.voice_status === 'ready')
    .map(item => {
      const value = item.voice_id || item.voice?.id;
      return value
        ? {
            value,
            label: item.nickname || item.voice?.display_name || value,
            language: item.voice?.default_language_code || ''
          }
        : null;
    })
    .filter(Boolean);
}

export function mapPublicVoices(items = []) {
  return items
    .filter(item => item?.voice_status === 'ready' && item?.allow_usage_in_orders !== false)
    .map(item => ({
      value: item.id,
      label: item.display_name || item.id,
      language: item.default_language_code || ''
    }));
}

async function requestList(key, route) {
  try {
    return await request(key, `${route}?per_page=100`);
  } catch (error) {
    if (![400, 404, 422].includes(error.status)) throw error;
    return request(key, route);
  }
}

export function mapTemplates(items = []) {
  return items
    .filter(item => item?.id && item?.config?.tts_settings)
    .map(item => ({
      value: `tpl:${item.id}`,
      label: `${item.name || item.id} (шаблон)`,
      language: item.config.tts_settings.language_code || '',
      templateId: item.id
    }));
}

export function mapElevenLabsVoices(items = []) {
  return items
    .filter(item => item?.voice_id)
    .map(item => ({
      value: `el:${item.voice_id}${item.public_owner_id ? `:${item.public_owner_id}` : ''}`,
      label: `${item.name || item.voice_id}${item.language ? ` (${item.language}${item.gender ? `, ${item.gender}` : ''})` : ''}`,
      language: item.language || ''
    }));
}

export function parseVoice(voice, defaultTemplateId) {
  const value = String(voice || '');
  if (value.startsWith('tpl:')) return { templateId: value.slice(4) };
  if (value.startsWith('el:')) {
    const [, voiceId, publicOwnerId] = value.split(':');
    return { templateId: defaultTemplateId, override: { voice_id: voiceId, ...(publicOwnerId ? { public_owner_id: publicOwnerId } : {}) } };
  }
  return { templateId: defaultTemplateId, override: value ? { voice_id: value } : null };
}

export async function listTemplates(key) {
  const payload = await request(key, '/templates');
  return mapTemplates(Array.isArray(payload?.data) ? payload.data : payload?.data?.items || []);
}

export async function listVoices(key, languages = ['en', 'ru']) {
  const [templates, library, publicCatalog, ...elevenlabs] = await Promise.all([
    listTemplates(key).catch(() => []),
    requestList(key, '/voices/library'),
    requestList(key, '/voices/public').catch(() => null),
    ...languages.map(lang => request(key, `/voices/elevenlabs/library?page_size=50&required_languages=${lang}`).catch(() => null))
  ]);
  const voices = [...templates, ...mapLibraryVoices(library?.data?.items || [])];
  const seen = new Set(voices.map(voice => voice.value));
  const extra = [
    ...mapPublicVoices(publicCatalog?.data?.items || []),
    ...elevenlabs.flatMap(payload => mapElevenLabsVoices(payload?.data?.voices || []))
  ];
  for (const voice of extra) {
    if (!seen.has(voice.value)) { seen.add(voice.value); voices.push(voice); }
  }
  return voices;
}

export async function testKey(key) {
  const payload = await request(key, '/user');
  return { ok: true, data: payload?.data };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function synthesize(key, configuredTemplateId, text, voice, outFile, onLog = () => {}) {
  let defaultTemplateId = configuredTemplateId;
  if (!defaultTemplateId && !String(voice || '').startsWith('tpl:')) {
    defaultTemplateId = (await listTemplates(key))[0]?.templateId;
  }
  const { templateId, override } = parseVoice(voice, defaultTemplateId);
  if (!templateId) throw new Error('Lumean: не задан ID шаблона TTS и в кабинете нет ни одного шаблона');
  const order = await request(key, '/orders', {
    method: 'POST',
    body: {
      template_id: templateId,
      input_text: text,
      ...(override ? { config_override: { tts_settings: override } } : {})
    }
  });
  const orderId = order?.data?.id;
  if (!orderId) throw new Error('Lumean: ответ не содержит ID заказа');

  const deadline = Date.now() + 15 * 60 * 1000;
  let lastProgress;
  let data;
  while (Date.now() <= deadline) {
    const payload = await request(key, `/orders/${encodeURIComponent(orderId)}`);
    data = payload?.data;
    const progress = data?.progress_percent;
    if (progress !== undefined && progress !== lastProgress) {
      lastProgress = progress;
      onLog(`Lumean: заказ ${orderId}, прогресс ${progress}%`);
    }
    const status = data?.status;
    if (status === 'completed' || status === 'result_delivered') break;
    if (['failed', 'cancelled', 'compensated'].includes(status)) {
      throw new Error(data?.result?.user_message || `заказ завершился со статусом ${status}`);
    }
    await sleep(3000);
  }
  if (!data || !['completed', 'result_delivered'].includes(data.status)) {
    throw new Error('тайм-аут ожидания заказа Lumean');
  }

  const filePath = data.result?.files?.[0];
  if (!filePath) throw new Error('Lumean: заказ завершён без файла результата');
  const link = await request(key, '/storage/url', {
    method: 'POST',
    body: { path: filePath, download: true }
  });
  const url = link?.data?.url;
  if (!url) throw new Error('Lumean: ответ не содержит ссылки на файл');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`скачивание результата Lumean: HTTP ${response.status}`);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, Buffer.from(await response.arrayBuffer()));
  return outFile;
}
