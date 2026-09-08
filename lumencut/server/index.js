import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureProjectDirs, getProject, listProjects, saveProject, deleteProject, newId, projectDir } from './store.js';
import { VOICES } from './tts.js';
import { enqueue } from './queue.js';
import { runPipeline } from './pipeline/run.js';
import { spawn } from 'node:child_process';
import { getConfig, publicSettings, updateSettings } from './settings.js';
import { search as searchPexels } from './sources/pexels.js';
import { search as searchPixabay } from './sources/pixabay.js';

const app = express();
const port = Number(process.env.PORT || 8787);
const here = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '2mb' }));

function publicProject(project) { return project; }

app.get('/api/health', async (_req, res) => {
  const config = await getConfig();
  const ffmpeg = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']);
  ffmpeg.on('error', () => res.json({ version: '1.0.0', ffmpeg: false, llmProvider: config.llmProvider, pexels: Boolean(config.pexelsApiKey), pixabay: Boolean(config.pixabayApiKey) }));
  ffmpeg.on('close', code => res.json({ version: '1.0.0', ffmpeg: code === 0, llmProvider: config.llmProvider, pexels: Boolean(config.pexelsApiKey), pixabay: Boolean(config.pixabayApiKey) }));
});
app.get('/api/settings', async (_req, res) => res.json(await publicSettings()));
app.put('/api/settings', async (req, res) => res.json(await updateSettings(req.body)));
app.post('/api/settings/test', async (_req, res) => {
  const testSource = async search => {
    try {
      const results = await search('school dinner');
      return { ok: true, count: results.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  };
  res.json({ pexels: await testSource(searchPexels), pixabay: await testSource(searchPixabay) });
});
app.get('/api/voices', (_req, res) => res.json(VOICES));
app.get('/api/projects', async (_req, res) => res.json((await listProjects()).map(p => ({ id: p.id, title: p.title, status: p.status, durationMs: p.durationMs, createdAt: p.createdAt, updatedAt: p.updatedAt }))));
app.post('/api/projects', async (req, res) => {
  const scriptText = String(req.body.scriptText || '').trim();
  if (!scriptText) return res.status(400).json({ error: 'Нужен сценарий' });
  const language = /[А-Яа-яЁё]/.test(scriptText) ? 'ru' : 'en';
  const project = { id: newId(), title: req.body.title?.trim() || 'Новый проект', scriptText, language, voice: req.body.voice || (language === 'ru' ? 'ru-RU-DmitryNeural' : 'en-GB-RyanNeural'), status: 'queued', stage: 'waiting', progress: 0, log: [], scenes: [], render: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await ensureProjectDirs(project.id); await saveProject(project); res.status(201).json(publicProject(project));
});
app.get('/api/projects/:id', async (req, res) => {
  const project = await getProject(req.params.id); project ? res.json(publicProject(project)) : res.status(404).json({ error: 'Проект не найден' });
});
app.delete('/api/projects/:id', async (req, res) => { await deleteProject(req.params.id); res.status(204).end(); });
app.post('/api/projects/:id/run', async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Проект не найден' });
  if (project.status === 'running') return res.status(409).json({ error: 'Проект уже собирается' });
  project.status = 'queued'; project.error = null; await saveProject(project);
  enqueue(async () => {
    try { await runPipeline(project, req.query.from || 'normalize'); }
    catch (error) { project.status = 'error'; project.error = error.message; project.stage = 'error'; project.log.push({ ts: new Date().toISOString(), step: 'error', msg: error.stack || error.message }); await saveProject(project); }
  }).catch(() => {});
  res.status(202).json(project);
});
app.get('/api/projects/:id/events', async (req, res) => {
  const id = req.params.id; res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  const send = async () => { const project = await getProject(id); if (!project) return; res.write(`data: ${JSON.stringify(project)}\n\n`); if (!['running', 'queued'].includes(project.status)) clearInterval(timer); };
  const timer = setInterval(send, 1000); send(); req.on('close', () => clearInterval(timer));
});
app.get('/api/projects/:id/file/*', async (req, res) => {
  const project = await getProject(req.params.id); if (!project) return res.status(404).end();
  const relative = req.params[0]; const root = projectDir(req.params.id); const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});
app.patch('/api/projects/:id/scenes/:sceneId', async (req, res) => {
  const project = await getProject(req.params.id); if (!project) return res.status(404).end();
  const scene = project.scenes.find(x => x.id === req.params.sceneId); if (!scene) return res.status(404).json({ error: 'Сцена не найдена' });
  if (typeof req.body.text === 'string') scene.text = req.body.text;
  if (Number.isInteger(req.body.pickIndex)) scene.pick = scene.candidates[req.body.pickIndex] || scene.pick;
  if (req.body.pickUrl) scene.pick = scene.candidates.find(x => x.url === req.body.pickUrl) || scene.pick;
  project.status = 'edited'; await saveProject(project); res.json(project);
});

const dist = path.resolve(here, '../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.listen(port, () => console.log(`LumenCut server listening on http://localhost:${port}`));
