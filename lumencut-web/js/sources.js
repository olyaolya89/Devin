// Free, copyright-safe sources (all CORS-enabled): Pexels, Pixabay, Wikimedia Commons, NASA, Internet Archive (public-domain collections only), Library of Congress ("no known restrictions" only).
const fitFile = (files, W) => files.filter(f => f.link && (f.file_type || '').includes('mp4') && f.width >= f.height).sort((a, b) => Math.abs(a.width - W) - Math.abs(b.width - W))[0];

export async function pexels(key, q, W) {
  if (!key) return [];
  const h = { Authorization: key };
  const [v, p] = await Promise.all([
    fetch('https://api.pexels.com/videos/search?' + new URLSearchParams({ query: q, per_page: '15', orientation: 'landscape' }), { headers: h }).then(r => r.ok ? r.json() : { videos: [] }),
    fetch('https://api.pexels.com/v1/search?' + new URLSearchParams({ query: q, per_page: '8', orientation: 'landscape' }), { headers: h }).then(r => r.ok ? r.json() : { photos: [] })
  ]);
  return [
    ...(v.videos || []).map(x => { const f = fitFile(x.video_files || [], W); return f && { id: 'pexels-v' + x.id, group: 'pexels-v' + x.id, source: 'Pexels', kind: 'video', url: f.link, thumb: x.image, duration: x.duration, author: x.user?.name || '', page: x.url, tags: (x.url || '').split('/').slice(-2, -1)[0]?.replace(/-\d+$/, '').replace(/-/g, ' ') || '' }; }),
    ...(p.photos || []).map(x => ({ id: 'pexels-p' + x.id, group: 'pexels-p' + x.id, source: 'Pexels', kind: 'image', url: x.src.large2x, thumb: x.src.medium, author: x.photographer, page: x.url, tags: x.alt || '' }))
  ].filter(Boolean);
}

export async function pixabay(key, q, W) {
  if (!key) return [];
  const [v, p] = await Promise.all([
    fetch('https://pixabay.com/api/videos/?' + new URLSearchParams({ key, q, per_page: '15', safesearch: 'true' })).then(r => r.ok ? r.json() : { hits: [] }),
    fetch('https://pixabay.com/api/?' + new URLSearchParams({ key, q, per_page: '8', image_type: 'photo', orientation: 'horizontal', safesearch: 'true' })).then(r => r.ok ? r.json() : { hits: [] })
  ]);
  return [
    ...(v.hits || []).map(x => { const vs = x.videos || {}; const f = (W >= 1900 ? vs.large?.url && vs.large : null) || vs.medium || vs.large || vs.small; return f?.url && f.width >= f.height && { id: 'pixabay-v' + x.id, group: 'pixabay-v' + x.id, source: 'Pixabay', kind: 'video', url: f.url, thumb: vs.medium?.thumbnail || vs.small?.thumbnail || vs.tiny?.thumbnail, duration: x.duration, author: x.user, page: x.pageURL, tags: x.tags || '' }; }),
    ...(p.hits || []).map(x => ({ id: 'pixabay-p' + x.id, group: 'pixabay-p' + x.id, source: 'Pixabay', kind: 'image', url: x.largeImageURL, thumb: x.webformatURL, author: x.user, page: x.pageURL, tags: x.tags || '' }))
  ].filter(Boolean);
}

const strip = s => String(s || '').replace(/<[^>]*>/g, '').trim();
export async function wikimedia(q) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `filetype:bitmap|video ${q}`, gsrnamespace: '6', gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1920', format: 'json', origin: '*' });
  const r = await fetch(url); if (!r.ok) return [];
  const d = await r.json();
  return Object.values(d.query?.pages || {}).map(pg => {
    const i = pg.imageinfo?.[0] || {}, m = i.extmetadata || {}; const video = /^video\//.test(i.mime || '');
    if (!i.url || (i.width || 0) < 900 || i.height > i.width) return null;
    if (/fair use|non-free|copyrighted|all rights reserved/i.test(`${m.LicenseShortName?.value} ${m.UsageTerms?.value}`)) return null;
    const thumb = i.thumburl && i.width > 640 ? i.thumburl.replace(/\/\d+px-/, '/640px-') : (i.thumburl || i.url);
    return { id: 'wm-' + pg.pageid, group: 'wm-' + pg.pageid, source: 'Wikimedia', kind: video ? 'video' : 'image', url: video ? i.url : (i.thumburl || i.url), thumb, duration: Number(m.Duration?.value || 0) || null, author: strip(m.Artist?.value), license: m.LicenseShortName?.value || '', page: i.descriptionurl, tags: strip(m.ObjectName?.value || pg.title) + ' ' + strip(m.ImageDescription?.value).slice(0, 120) };
  }).filter(Boolean);
}

const gate = gap => { let next = 0; return async () => { const now = Date.now(), wait = Math.max(0, next - now); next = Math.max(now, next) + gap; if (wait) await new Promise(r => setTimeout(r, wait)); }; };
const locGate = gate(700), iaGate = gate(400);
const getJson = async url => { const r = await fetch(url); return r.ok ? r.json() : null; };

// NASA Image and Video Library: NASA media is generally not copyrighted; items crediting third parties are skipped.
export async function nasa(q) {
  const d = await getJson('https://images-api.nasa.gov/search?' + new URLSearchParams({ q, media_type: 'image,video', page_size: '16' }));
  return (d?.collection?.items || []).map(it => {
    const x = it.data?.[0] || {}, links = it.links || [], id = x.nasa_id;
    if (!id || /copyright|courtesy of (?!nasa)|©/i.test(`${x.description} ${x.photographer} ${x.secondary_creator}`)) return null;
    const thumb = (links.find(l => l.rel === 'preview') || links[0])?.href; if (!thumb) return null;
    const base = { id: 'nasa-' + id, group: 'nasa-' + id, source: 'NASA', thumb: thumb.replace(/^http:/, 'https:'), author: x.photographer || x.secondary_creator || 'NASA', license: 'Public domain (NASA)', page: 'https://images.nasa.gov/details/' + encodeURIComponent(id), tags: `${x.title || ''} ${(x.keywords || []).join(' ')}`.slice(0, 200) };
    if (x.media_type === 'video') { const dir = `https://images-assets.nasa.gov/video/${encodeURIComponent(id)}/${encodeURIComponent(id)}`; return { ...base, kind: 'video', url: dir + '~medium.mp4', alt: dir + '~mobile.mp4', duration: null }; }
    const big = links.filter(l => l.render === 'image' && l.width).sort((a, b) => b.width - a.width).find(l => l.width <= 1920);
    return big && big.width >= 900 && big.width >= big.height && { ...base, kind: 'image', url: big.href.replace(/^http:/, 'https:') };
  }).filter(Boolean);
}

// Internet Archive: only curated public-domain film collections (Prelinger, US government films). Uploader-set licences are not trusted.
const IA_COLLECTIONS = 'prelinger OR FedFlix OR usgovfilms OR nasa';
const secs = v => String(v || '').split(':').reduce((a, b) => a * 60 + Number(b || 0), 0) || null;
export async function archive(q) {
  await iaGate();
  const d = await getJson('https://archive.org/advancedsearch.php?' + new URLSearchParams({ q: `(${q.replace(/[():"\\]/g, ' ')}) AND mediatype:movies AND collection:(${IA_COLLECTIONS})`, 'fl[]': 'identifier', rows: '5', output: 'json' }));
  const ids = (d?.response?.docs || []).map(x => x.identifier);
  const items = await Promise.all(ids.map(async id => { await iaGate(); return getJson('https://archive.org/metadata/' + encodeURIComponent(id)).catch(() => null); }));
  return items.map((m, k) => {
    if (!m?.files) return null;
    const id = ids[k], md = m.metadata || {}, rank = f => /h\.264 hd/i.test(f.format) ? 0 : /^h\.264/i.test(f.format) ? 1 : /^(hires )?mpeg4$/i.test(f.format) ? 2 : /mpeg4/i.test(f.format) ? 3 : 9;
    const vid = m.files.filter(f => /\.mp4$/i.test(f.name) && rank(f) < 9).sort((a, b) => rank(a) - rank(b))[0]; if (!vid) return null;
    // archive.org/cors/ is the only CORS-enabled video path but it ignores Range, so cut near the start (the browser streams up to that point).
    const dur = secs(vid.length) || 60, want = Math.min(45, dur * 0.3);
    const thumbs = m.files.filter(f => f.format === 'Thumbnail').map(f => ({ n: f.name, t: Number((f.name.match(/_(\d+)\.jpg$/) || [])[1]) })).filter(x => x.t >= 0).sort((a, b) => Math.abs(a.t - want) - Math.abs(b.t - want));
    const path = n => `${encodeURIComponent(id)}/${n.split('/').map(encodeURIComponent).join('/')}`;
    return { id: 'ia-' + id, group: 'ia-' + id, source: 'Internet Archive', kind: 'video', url: 'https://archive.org/cors/' + path(vid.name), thumb: 'https://archive.org/download/' + path(thumbs[0]?.n || '__ia_thumb.jpg'), start: thumbs[0] ? thumbs[0].t : 0, duration: dur, author: [].concat(md.creator || 'unknown')[0], license: md.licenseurl || 'Public domain collection', page: 'https://archive.org/details/' + id, tags: `${[].concat(md.title)[0] || ''} ${[].concat(md.subject || []).join(' ')}`.slice(0, 200) };
  }).filter(Boolean);
}

// Library of Congress photos: only items whose rights advisory says "No known restrictions".
export async function loc(q) {
  await locGate();
  const d = await getJson('https://www.loc.gov/photos/?' + new URLSearchParams({ q, fo: 'json', c: '20', fa: 'online-format:image', at: 'results' }));
  return (d?.results || []).map(r => {
    const rights = [].concat(r.item?.rights_advisory || r.rights_advisory || []).join(' ');
    if (r.access_restricted || !/no known restrictions/i.test(rights)) return null;
    const imgs = (r.image_url || []).map(u => ({ u: u.split('#')[0], w: Number((u.match(/[#&]w=(\d+)/) || [])[1] || 0), h: Number((u.match(/[#&]h=(\d+)/) || [])[1] || 0) })).sort((a, b) => b.w - a.w);
    const big = imgs[0]; if (!big || big.w < 640 || big.h > big.w) return null;
    const id = String(r.id || r.url).replace(/\/$/, '').split('/').pop();
    return { id: 'loc-' + id, group: 'loc-' + id, source: 'Library of Congress', kind: 'image', url: big.u, thumb: (imgs.find(i => i.w >= 300 && i.w <= 640) || big).u, author: [].concat(r.contributor || 'Library of Congress')[0], license: 'No known restrictions (LoC)', page: r.url || r.id, tags: `${r.title || ''} ${[].concat(r.subject || []).join(' ')}`.slice(0, 200) };
  }).filter(Boolean);
}

export async function searchAll(settings, q, W, qr = 0) {
  const tasks = [pexels(settings.pexels, q, W), pixabay(settings.pixabay, q, W)];
  if (settings.wikimedia !== false) tasks.push(wikimedia(q));
  if (settings.nasa !== false && qr < 2) tasks.push(nasa(q));
  if (settings.archive !== false && qr === 0) tasks.push(archive(q));
  if (settings.loc !== false && qr === 0) tasks.push(loc(q));
  const res = await Promise.allSettled(tasks);
  return res.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}
