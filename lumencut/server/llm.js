const STOP = new Set('the a an and or but in on at to for of with from by was were is are as this that these those daily lined up with children their about into over very'.split(' '));

function significant(text) {
  return text.replace(/[.!?…,\n]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.replace(/^[^A-Za-zА-Яа-я0-9'-]+|[^A-Za-zА-Яа-я0-9'-]+$/g, ''))
    .filter(w => w && (!STOP.has(w.toLowerCase()) && (/\d/.test(w) || /^[A-ZА-ЯЁ]/.test(w) || w.length > 3)));
}

export function heuristicQueries(text) {
  const words = significant(text);
  const full = words.join(' ');
  const longest = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 3).join(' ');
  const first = words.slice(0, 2).join(' ');
  return [full || text.slice(0, 80), longest || first || text.slice(0, 50), first || full || text.slice(0, 50)];
}

async function askGemini(scenes) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const prompt = `Для каждой фразы дай 3 коротких английских стоковых запроса (2–4 слова), JSON-массив массивов.\n${JSON.stringify(scenes.map(s => s.text))}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text.match(/\[[\s\S]*\]/)[0]);
}

async function askOllama(scenes) {
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.OLLAMA_MODEL || 'llama3.1', prompt: `Return JSON array of arrays of 3 English stock queries for these phrases:\n${scenes.map(s => s.text).join('\n')}`, stream: false })
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.response.match(/\[[\s\S]*\]/)[0]);
}

export async function makeQueries(scenes) {
  const provider = process.env.LLM_PROVIDER || 'none';
  if (provider === 'gemini') return askGemini(scenes);
  if (provider === 'ollama') return askOllama(scenes);
  return scenes.map(s => heuristicQueries(s.text));
}
