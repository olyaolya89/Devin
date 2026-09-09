import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const initial = { pexelsApiKey: '', pixabayApiKey: '', llmProvider: 'none', geminiApiKey: '', geminiModel: 'gemini-1.5-flash', ollamaModel: 'llama3.1', maxClipSeconds: 5, ttsProvider: 'edge', lumeanApiKey: '', lumeanTemplateId: '' };

export default function Settings() {
  const [settings, setSettings] = useState(initial);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/settings').then(setSettings).catch(error => setMessage(error.message)); }, []);

  async function save() {
    setBusy(true); setMessage('');
    try { setSettings(await api('/settings', { method: 'PUT', body: JSON.stringify(settings) })); setMessage('Настройки сохранены'); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  async function testKeys() {
    setBusy(true); setMessage('');
    try { setResult(await api('/settings/test', { method: 'POST' })); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }

  const update = (field, value) => setSettings(current => ({ ...current, [field]: value }));
  return <div className="settings-page">
    <Link to="/" className="back">← На рабочий стол</Link>
    <div className="page-heading"><div><p className="eyebrow">КОНФИГУРАЦИЯ</p><h1>Настройки</h1><p className="muted">Ключи сохраняются только локально на этом компьютере.</p></div></div>
    <section className="panel settings-card">
      <div className="settings-section"><h2>Источники медиа</h2><p className="section-note">Добавьте ключи, чтобы искать дополнительные изображения и видео.</p>
        <label className="settings-field">Pixabay API-ключ<input value={settings.pixabayApiKey || ''} onChange={e => update('pixabayApiKey', e.target.value)} placeholder="Введите ключ Pixabay" type="password" /><small>Ключ показан на странице после входа · <a href="https://pixabay.com/api/docs/" target="_blank" rel="noreferrer">pixabay.com/api/docs/</a></small></label>
        <label className="settings-field">Pexels API-ключ<input value={settings.pexelsApiKey || ''} onChange={e => update('pexelsApiKey', e.target.value)} placeholder="Введите ключ Pexels" type="password" /><small>Get Started → Your API Key · <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">pexels.com/api/</a></small></label>
      </div>
      <div className="settings-section"><h2>Поисковые запросы</h2><p className="section-note">LLM используется только для генерации поисковых запросов сцен.</p>
        <label className="settings-field">Провайдер LLM<select value={settings.llmProvider || 'none'} onChange={e => update('llmProvider', e.target.value)}><option value="none">Не использовать</option><option value="gemini">Gemini</option><option value="ollama">Ollama</option></select></label>
        <label className="settings-field">Gemini ключ<input value={settings.geminiApiKey || ''} onChange={e => update('geminiApiKey', e.target.value)} placeholder="Введите ключ Gemini" type="password" /><small><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Получить ключ на aistudio.google.com/apikey</a></small></label>
        <label className="settings-field">Gemini модель<input value={settings.geminiModel || ''} onChange={e => update('geminiModel', e.target.value)} /></label>
        <label className="settings-field">Ollama модель<input value={settings.ollamaModel || ''} onChange={e => update('ollamaModel', e.target.value)} /></label>
      </div>
      <div className="settings-section"><h2>Озвучка</h2><p className="section-note">Edge TTS остаётся бесплатным провайдером по умолчанию. Lumean подключается по API.</p>
        <label className="settings-field">Провайдер озвучки<select value={settings.ttsProvider || 'edge'} onChange={e => update('ttsProvider', e.target.value)}><option value="edge">Edge TTS — бесплатно</option><option value="lumean">Lumean</option></select></label>
        <label className="settings-field">Lumean API-ключ<input value={settings.lumeanApiKey || ''} onChange={e => update('lumeanApiKey', e.target.value)} placeholder="Введите ключ Lumean" type="password" /><small>Ключ из кабинета Lumean → API · <a href="https://lumean.app" target="_blank" rel="noreferrer">lumean.app</a></small></label>
        <label className="settings-field">Lumean ID шаблона TTS<input value={settings.lumeanTemplateId || ''} onChange={e => update('lumeanTemplateId', e.target.value)} placeholder="UUID шаблона TTS" /><small>ID шаблона TTS из кабинета Lumean (lumean.app/template)</small></label>
      </div>
      <div className="settings-section"><h2>Видео</h2><label className="settings-field short-field">Макс. длина клипа (с)<input type="number" min="1" max="60" step="1" value={settings.maxClipSeconds || 5} onChange={e => update('maxClipSeconds', Number(e.target.value))} /></label></div>
      <div className="settings-actions"><button className="primary" onClick={save} disabled={busy}>Сохранить</button><button className="ghost" onClick={testKeys} disabled={busy}>Проверить ключи</button>{message && <span className="settings-message">{message}</span>}</div>
      {result && <div className="settings-results"><b>Результат проверки</b><span className={result.pexels.ok ? 'ok' : result.pexels.error === 'ключ не задан' ? 'neutral' : 'bad'}>Pexels: {result.pexels.ok ? `доступен, найдено ${result.pexels.count}` : result.pexels.error}</span><span className={result.pixabay.ok ? 'ok' : result.pixabay.error === 'ключ не задан' ? 'neutral' : 'bad'}>Pixabay: {result.pixabay.ok ? `доступен, найдено ${result.pixabay.count}` : result.pixabay.error}</span>{result.lumean && <span className={result.lumean.ok ? 'ok' : result.lumean.error === 'ключ не задан' ? 'neutral' : 'bad'}>Lumean: {result.lumean.ok ? 'доступен' : result.lumean.error}</span>}</div>}
    </section>
  </div>;
}
