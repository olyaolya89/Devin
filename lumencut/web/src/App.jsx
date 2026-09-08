import React from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import Desk from './pages/Desk.jsx';
import Queue from './pages/Queue.jsx';
import Studio from './pages/Studio.jsx';

export default function App() {
  return <><header className="topbar"><Link to="/" className="brand"><span className="brand-mark">✦</span> LumenCut</Link><span className="tagline">видеостудия из сценария</span></header><main className="shell"><Routes><Route path="/" element={<Desk />} /><Route path="/queue/:id" element={<Queue />} /><Route path="/studio/:id" element={<Studio />} /></Routes></main></>;
}
