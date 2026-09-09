import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const example = "In the 1970s, British school dinners were a daily ritual. Children lined up with metal trays for shepherd's pie. Dessert was sponge cake with pink custard.";
export default function Desk() {
  const [script, setScript] = useState(''); const [title, setTitle] = useState(''); const [voices, setVoices] = useState([]); const [voice, setVoice] = useState(''); const [projects, setProjects] = useState([]); const [health, setHealth] = useState(null); const [busy, setBusy] = useState(false); const navigate = useNavigate();
  const refresh = () => api('/projects').then(setProjects).catch(() => {});
  useEffect(() => { api('/voices').then(setVoices); api('/health').then(setHealth); refresh(); }, []);
  useEffect(() => {
    if (!voices.length) return;
    const lumeanVoices = voices.filter(item => item.provider === 'lumean');
    if (lumeanVoices.length) {
      if (!voice || !voices.some(item => item.value === voice)) setVoice(lumeanVoices[0].value);
      return;
    }
    const lang = /[А-Яа-яЁё]/.test(script) ? 'ru' : 'en';
    const found = voices.find(item => item.language === lang);
    if (found) setVoice(found.value);
  }, [script, voices, voice]);
  const lumeanVoices = voices.filter(item => item.provider === 'lumean');
  const edgeVoices = voices.filter(item => item.provider !== 'lumean');
  const voiceOptions = lumeanVoices.length
    ? <><optgroup label="Lumean">{lumeanVoices.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</optgroup><optgroup label="Edge TTS">{edgeVoices.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</optgroup></>
    : voices.map(item => <option key={item.value} value={item.value}>{item.label}</option>);
  async function create() { setBusy(true); try { const p = await api('/projects', { method: 'POST', body: JSON.stringify({ scriptText: script, title, voice }) }); await api(`/projects/${p.id}/run`, { method: 'POST' }); navigate(`/queue/${p.id}`); } catch (e) { alert(e.message); } finally { setBusy(false); } }
  return <div className="desk"><section className="hero"><div><p className="eyebrow">ЛИЧНАЯ МЕДИА-СТУДИЯ</p><h1>Превратите слова<br /><em>в живое видео.</em></h1><p className="hero-copy">Вставьте сценарий. LumenCut озвучит его и соберёт визуальный рассказ из открытых медиа.</p></div><div className="hero-glow">✦</div></section>
    <section className="panel composer"><div className="panel-head"><div><h2>Новый проект</h2><p>Сценарий останется дословным — без перевода и переписывания.</p></div><button className="ghost" onClick={() => setScript(example)}>Вставить пример</button></div><textarea value={script} onChange={e => setScript(e.target.value)} placeholder="Вставьте текст сценария…"></textarea><div className="form-row"><label>Название<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Например, Школьные обеды 1970-х" /></label><label>Голос<select value={voice} onChange={e => setVoice(e.target.value)}>{voiceOptions}</select></label><button className="primary" disabled={busy || !script.trim()} onClick={create}>{busy ? 'Создание…' : 'Собрать видео'} <span>→</span></button></div></section>
    {health && <div className="health"><b>Система</b><span className={health.ffmpeg ? 'ok' : 'bad'}>● ffmpeg {health.ffmpeg ? 'готов' : 'не найден'}</span><span>LLM: {health.llmProvider}</span><span>Pexels: {health.pexels ? 'ключ есть' : 'без ключа'}</span><span>Pixabay: {health.pixabay ? 'ключ есть' : 'без ключа'}</span>{(!health.pexels || !health.pixabay) && <Link to="/settings" className="settings-link">Ключи не заданы → Настройки</Link>}</div>}
    <section className="projects"><div className="section-title"><h2>Проекты</h2><span>{projects.length}</span></div>{projects.length ? <div className="project-list">{projects.map(p => <Link to={p.status === 'ready' || p.status === 'edited' ? `/studio/${p.id}` : `/queue/${p.id}`} className="project-row" key={p.id}><span className="project-icon">▰</span><span className="project-name">{p.title}</span><span className={`status ${p.status}`}>{p.status === 'ready' ? 'готово' : p.status === 'error' ? 'ошибка' : p.status === 'edited' ? 'изменён' : 'в очереди'}</span><span>{p.durationMs ? `${(p.durationMs / 1000).toFixed(1)} c` : '—'}</span><span className="arrow">↗</span></Link>)}</div> : <div className="empty">Здесь появятся ваши собранные видео</div>}</section>
  </div>;
}
