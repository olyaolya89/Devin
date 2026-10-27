// In-browser AI (free, no keys): Whisper word timestamps + CLIP meaning-to-image ranking.
const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
let tf, clip;
const lib = async () => (tf ||= await import(TF));
let dev;
const device = async () => (dev ||= await navigator.gpu?.requestAdapter().then(a => (a ? 'webgpu' : 'wasm'), () => 'wasm') || 'wasm');

export async function transcribe(float32, onProgress) {
  const T = await lib();
  let asr;
  try { asr = await T.pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', { device: await device(), dtype: 'fp32', progress_callback: p => p.status === 'progress' && onProgress?.(`Загрузка Whisper ${Math.round(p.progress || 0)}%`) }); }
  catch { asr = await T.pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', { device: 'wasm', progress_callback: p => p.status === 'progress' && onProgress?.(`Загрузка Whisper ${Math.round(p.progress || 0)}%`) }); }
  onProgress?.('Распознаю голос (Whisper)…');
  const out = await asr(float32, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
  return (out.chunks || []).map(c => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }));
}

async function loadClip(onProgress) {
  if (clip) return clip;
  const T = await lib(); const id = 'Xenova/clip-vit-base-patch32';
  const pc = p => p.status === 'progress' && onProgress?.(`Загрузка CLIP ${Math.round(p.progress || 0)}%`);
  const [tok, proc, text, vision] = await Promise.all([
    T.AutoTokenizer.from_pretrained(id), T.AutoProcessor.from_pretrained(id),
    T.CLIPTextModelWithProjection.from_pretrained(id, { progress_callback: pc }),
    T.CLIPVisionModelWithProjection.from_pretrained(id, { progress_callback: pc })
  ]);
  return (clip = { T, tok, proc, text, vision });
}
const unit = a => { let n = 0; for (const x of a) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(a, x => x / n); };
export const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export async function textEmbed(texts, onProgress) {
  const c = await loadClip(onProgress);
  const inp = c.tok(texts, { padding: true, truncation: true });
  const { text_embeds } = await c.text(inp);
  const d = text_embeds.dims[1];
  return texts.map((_, i) => unit(text_embeds.data.slice(i * d, (i + 1) * d)));
}

const imgCache = new Map();
export async function imageEmbed(urls, onProgress) {
  const c = await loadClip(onProgress);
  const todo = [...new Set(urls.filter(u => u && !imgCache.has(u)))];
  for (let k = 0; k < todo.length; k += 8) {
    const part = todo.slice(k, k + 8);
    const imgs = (await Promise.all(part.map(u => c.T.RawImage.fromURL(u).catch(() => null))));
    const ok = part.filter((_, i) => imgs[i]);
    if (!ok.length) { part.forEach(u => imgCache.set(u, null)); continue; }
    const inp = await c.proc(imgs.filter(Boolean));
    const { image_embeds } = await c.vision(inp);
    const d = image_embeds.dims[1];
    ok.forEach((u, i) => imgCache.set(u, unit(image_embeds.data.slice(i * d, (i + 1) * d))));
    part.forEach(u => imgCache.has(u) || imgCache.set(u, null));
  }
  return urls.map(u => imgCache.get(u) || null);
}
