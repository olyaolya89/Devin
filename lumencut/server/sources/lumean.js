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

export async function listVoices(key) {
  let payload;
  try {
    payload = await request(key, '/voices/library?per_page=100');
  } catch (error) {
    if (![400, 404, 422].includes(error.status)) throw error;
    payload = await request(key, '/voices/library');
  }
  return mapLibraryVoices(payload?.data?.items || []);
}

export async function testKey(key) {
  const payload = await request(key, '/user');
  return { ok: true, data: payload?.data };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function synthesize(key, templateId, text, voiceId, outFile, onLog = () => {}) {
  const order = await request(key, '/orders', {
    method: 'POST',
    body: {
      template_id: templateId,
      input_text: text,
      ...(voiceId ? { config_override: { tts_settings: { voice_id: voiceId } } } : {})
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
