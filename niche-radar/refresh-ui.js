(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const LS_KEY = 'nr:apiKey';
  const LS_LIVE = 'nr:live';
  const modal = $('#refreshModal');
  const open = () => { if (!modal) return; modal.hidden = false; const k = localStorage.getItem(LS_KEY); if (k) $('#apiKey').value = k; };
  const close = () => { if (modal) modal.hidden = true; };
  $('#refreshBtn')?.addEventListener('click', open);
  modal?.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  $('#maxQueries')?.addEventListener('input', e => { const el = $('#maxQueriesVal'); if (el) el.textContent = e.target.value; });
  $('#liveClear')?.addEventListener('click', () => { localStorage.removeItem(LS_LIVE); location.reload(); });
  $('#refreshRun')?.addEventListener('click', async () => {
    const key = ($('#apiKey')?.value || '').trim();
    if (!key) { $('#refreshLog').textContent = '\u0412\u0441\u0442\u0430\u0432\u044c \u043a\u043b\u044e\u0447 YouTube Data API v3'; return; }
    if (!window.NR_LIVE) { $('#refreshLog').textContent = 'live.js \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043b\u0441\u044f'; return; }
    localStorage.setItem(LS_KEY, key);
    const maxQueries = +($('#maxQueries')?.value || 6);
    const bar = $('#refreshBar'); const prog = $('#refreshProgress'); const log = $('#refreshLog');
    if (prog) prog.hidden = false;
    try {
      const res = await window.NR_LIVE.run(
        { key, maxQueries, niche: $('#fNiche')?.value || '', lang: $('#fLang')?.value || '' },
        (t, f) => { log.textContent = t; if (bar) bar.style.width = Math.round((f || 0) * 100) + '%'; }
      );
      const prev = (() => { try { return JSON.parse(localStorage.getItem(LS_LIVE) || '[]'); } catch { return []; } })();
      const map = new Map(prev.map(c => [c.id, c]));
      (res.channels || []).forEach(c => map.set(c.id, c));
      localStorage.setItem(LS_LIVE, JSON.stringify([...map.values()]));
      log.textContent = `\u0413\u043e\u0442\u043e\u0432\u043e: ${res.channels.length} \u043a\u0430\u043d\u0430\u043b\u043e\u0432, ${res.units} \u0435\u0434. \u043a\u0432\u043e\u0442\u044b` + (res.stopped ? ' \u00b7 ' + res.stopped : '');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      log.textContent = e.message || String(e);
    }
  });
})();
