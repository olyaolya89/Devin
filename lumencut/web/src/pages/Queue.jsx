import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
const steps = ['normalize', 'tts', 'queries', 'search', 'rank', 'download', 'cut', 'layout', 'render'];
const names = { normalize: 'Подготовка сценария', tts: 'Озвучка', queries: 'Поисковые запросы', search: 'Поиск медиа', rank: 'Отбор кадров', download: 'Загрузка файлов', cut: 'Нарезка видео', layout: 'Раскладка сцен', render: 'Финальный рендер' };
export default function Queue() {
  const { id } = useParams(); const navigate = useNavigate(); const [project, setProject] = useState(null); const [error, setError] = useState('');
  useEffect(() => { let source; api(`/projects/${id}`).then(setProject).catch(e => setError(e.message)); source = new EventSource(`/api/projects/${id}/events`); source.onmessage = e => { const p = JSON.parse(e.data); setProject(p); if (p.status === 'ready' || p.status === 'edited') source.close(); }; return () => source?.close(); }, [id]);
  if (error) return <div className="error-box">{error}</div>; if (!project) return <div className="loading">Загрузка проекта…</div>;
  const active = steps.indexOf(project.stage);
  async function retry() { await api(`/projects/${id}/run?from=${project.stage === 'error' ? 'normalize' : project.stage}`, { method: 'POST' }); setProject({ ...project, status: 'queued' }); }
  return <div className="queue-page"><Link to="/" className="back">← Все проекты</Link><div className="page-heading"><div><p className="eyebrow">СБОРКА ПРОЕКТА</p><h1>{project.title}</h1><p className="muted">Сценарий сохранён дословно · {project.language === 'ru' ? 'русский' : 'английский'}</p></div><span className={`big-status ${project.status}`}>{project.status === 'ready' ? 'Готово' : project.status === 'error' ? 'Ошибка' : `${project.progress}%`}</span></div>
    <div className="progress-track"><div style={{ width: `${project.progress}%` }} /></div><section className="steps">{steps.map((step, i) => <div className={`step ${i < active || project.status === 'ready' ? 'done' : i === active ? 'active' : ''}`} key={step}><span>{i < active || project.status === 'ready' ? '✓' : String(i + 1).padStart(2, '0')}</span><div><b>{names[step]}</b>{i === active && project.status === 'running' && <small>Выполняется…</small>}</div></div>)}</section>
    {project.status === 'error' && <div className="error-box"><b>Сборка остановлена</b><p>{project.error}</p><button className="primary" onClick={retry}>Повторить сборку</button></div>}
    <section className="panel log-panel"><div className="panel-head"><div><h2>Журнал сборки</h2><p>Все этапы обработки проекта</p></div><span className="live-dot">● LIVE</span></div><div className="log">{(project.log || []).map((line, i) => <div key={i}><time>{new Date(line.ts).toLocaleTimeString('ru-RU')}</time><b>{line.step}</b><span>{line.msg}</span></div>)}</div></section>
    {project.render && <section className="result panel"><video controls src={project.render.url} /><div className="result-actions"><a className="primary" href={project.render.url} download>Скачать MP4 ↓</a><button className="ghost" onClick={() => navigate(`/studio/${id}`)}>Открыть в студии →</button></div></section>}
  </div>;
}
