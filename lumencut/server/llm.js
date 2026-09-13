import { getConfig } from './settings.js';

const STOP = new Set('the a an and or but in on at to for of with from by was were is are as this that these those daily lined up with children their about into over very'.split(' '));

export function significant(text) {
  return String(text || '').replace(/[.!?…,\n]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.replace(/^[^A-Za-zА-Яа-я0-9'-]+|[^A-Za-zА-Яа-я0-9'-]+$/g, ''))
    .filter(w => w && (!STOP.has(w.toLowerCase()) && (/\d/.test(w) || /^[A-ZА-ЯЁ]/.test(w) || w.length > 3)));
}

export function topicWords(scenes) {
  const counts = new Map();
  let order = 0;
  for (const scene of scenes) {
    for (const word of significant(scene.text)) {
      const normalized = word.toLowerCase();
      if (normalized.length <= 3 || STOP.has(normalized)) continue;
      const current = counts.get(normalized) || { count: 0, order: order++ };
      current.count += 1;
      counts.set(normalized, current);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order)
    .slice(0, 2)
    .map(([word]) => word)
    .join(' ');
}

export function heuristicQueries(text, topic = '') {
  const words = significant(text);
  const full = words.join(' ');
  const longest = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 3).join(' ');
  const first = words.slice(0, 2).join(' ');
  const queries = [full || text.slice(0, 80), longest || first || text.slice(0, 50), first || full || text.slice(0, 50)];
  if (topic) {
    queries[1] = `${queries[1]} ${topic}`.trim();
    queries[2] = `${queries[2]} ${topic}`.trim();
  }
  return queries;
}

async function geminiJson(config, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
    })
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response');
  return JSON.parse(text);
}

async function ollamaJson(config, prompt) {
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.ollamaModel, prompt, stream: false, format: 'json' })
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  if (!data.response) throw new Error('Ollama returned an empty response');
  return JSON.parse(data.response);
}

function sceneQueryPrompt(allScenes, topic = '', batchScenes = allScenes, offset = 0) {
  const script = allScenes.map(scene => scene.text).join('\n');
  const numbered = batchScenes.map((scene, index) => `${offset + index + 1}. ${scene.text}`).join('\n');
  return `You are a stock-footage researcher. Find concrete visuals that a camera can show for this video's script.
Whole script for topic context:
${script}

Video topic from the first batch, if known:
${topic}

Numbered scene sentences:
${numbered}

Return JSON only in exactly this shape:
{"topic":"<3-6 word English description of the video's subject, era, place>","scenes":[{"queries":["q1","q2","q3"]}]}

Rules:
- Return exactly one scenes entry per numbered sentence, in the same order.
- Each query must be a concrete English stock-search query of 2-5 words: nouns, objects, places, or actions a camera can show.
- Translate queries to English when the script is not English.
- Include the relevant era and place from the topic when useful, for example "1970s british school canteen".
- Do not use abstract words such as emotion, tradition, or memory.
- Do not use quotes or punctuation in queries.`;
}

function queryEntries(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.scenes)) return parsed.scenes;
  throw new Error('LLM query response has no scenes array');
}

function entryQueries(entry, fallback) {
  const values = Array.isArray(entry?.queries)
    ? entry.queries.filter(value => typeof value === 'string' && value.trim()).slice(0, 3)
    : [];
  return values.length ? values : fallback;
}

export async function askGemini(scenes) {
  const config = await getConfig();
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not set');
  let topic = '';
  const queries = [];
  for (let start = 0; start < scenes.length; start += 20) {
    const chunk = scenes.slice(start, start + 20);
    const parsed = await geminiJson(config, sceneQueryPrompt(scenes, topic, chunk, start));
    const entries = queryEntries(parsed);
    if (start === 0 && typeof parsed?.topic === 'string') topic = parsed.topic.trim();
    chunk.forEach((scene, index) => {
      queries.push(entryQueries(entries[index], heuristicQueries(scene.text, topic)));
    });
  }
  return { topic, queries };
}

export async function askOllama(scenes) {
  const config = await getConfig();
  const parsed = await ollamaJson(config, sceneQueryPrompt(scenes));
  const entries = queryEntries(parsed);
  const topic = typeof parsed?.topic === 'string' ? parsed.topic.trim() : '';
  return {
    topic,
    queries: scenes.map((scene, index) => entryQueries(entries[index], heuristicQueries(scene.text, topic)))
  };
}

export async function makeQueries(scenes) {
  const { llmProvider: provider } = await getConfig();
  if (provider === 'gemini') return askGemini(scenes);
  if (provider === 'ollama') return askOllama(scenes);
  const topic = topicWords(scenes);
  return { topic, queries: scenes.map(scene => heuristicQueries(scene.text, topic)) };
}

function rerankPrompt(scenes, topic) {
  const input = scenes.map((scene, index) => ({
    i: index,
    sentence: scene.text,
    candidates: (scene.candidates || []).slice(0, 30).map((candidate, candidateIndex) => ({
      i: candidateIndex,
      kind: candidate.kind,
      text: `${candidate.title || ''} ${candidate.description || ''}`.trim().slice(0, 120),
      q: candidate.queryRank ?? 0
    }))
  }));
  return `You are a stock-footage relevance researcher. Video topic: ${topic}
For each scene, keep only candidates whose text and kind visually match the scene sentence. Return candidates in relevance order, best first.
Candidate indices are local to each scene. A video candidate with empty text may be kept only when its q value is 0.
Return JSON only in exactly this shape:
{"scenes":[{"keep":[0,2]}]}

Scenes and candidates:
${JSON.stringify(input)}`;
}

export function applyLlmKeep(scenes, keepLists) {
  scenes.forEach((scene, sceneIndex) => {
    const candidates = scene.candidates || [];
    candidates.forEach(candidate => { delete candidate.llmRank; });
    const seen = new Set();
    let rank = 0;
    for (const index of keepLists[sceneIndex] || []) {
      if (!Number.isInteger(index) || index < 0 || index >= candidates.length || seen.has(index)) continue;
      candidates[index].llmRank = rank++;
      seen.add(index);
    }
    scene.llmRanked = true;
  });
  return scenes;
}

export async function rerankWithLLM(scenes, topic = '') {
  const config = await getConfig();
  if (!['gemini', 'ollama'].includes(config.llmProvider)) return scenes;
  topic = topic || topicWords(scenes);
  const keepLists = [];
  for (let start = 0; start < scenes.length; start += 10) {
    const chunk = scenes.slice(start, start + 10);
    const parsed = config.llmProvider === 'gemini'
      ? await geminiJson(config, rerankPrompt(chunk, topic))
      : await ollamaJson(config, rerankPrompt(chunk, topic));
    if (!Array.isArray(parsed?.scenes) || parsed.scenes.length !== chunk.length) {
      throw new Error('LLM rerank response has an invalid scenes array');
    }
    parsed.scenes.forEach(entry => {
      if (!Array.isArray(entry?.keep)) throw new Error('LLM rerank response has an invalid keep array');
      keepLists.push(entry.keep);
    });
  }
  return applyLlmKeep(scenes, keepLists);
}
