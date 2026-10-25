// Free stock sources (all CORS-enabled): Pexels, Pixabay, Wikimedia Commons.
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
    const thumb = i.thumburl && i.width > 640 ? i.thumburl.replace(/\/\d+px-/, '/640px-') : (i.thumburl || i.url);
    return { id: 'wm-' + pg.pageid, group: 'wm-' + pg.pageid, source: 'Wikimedia', kind: video ? 'video' : 'image', url: video ? i.url : (i.thumburl || i.url), thumb, duration: Number(m.Duration?.value || 0) || null, author: strip(m.Artist?.value), license: m.LicenseShortName?.value || '', page: i.descriptionurl, tags: strip(m.ObjectName?.value || pg.title) + ' ' + strip(m.ImageDescription?.value).slice(0, 120) };
  }).filter(Boolean);
}

export async function searchAll(settings, q, W) {
  const tasks = [pexels(settings.pexels, q, W), pixabay(settings.pixabay, q, W)];
  if (settings.wikimedia !== false) tasks.push(wikimedia(q));
  const res = await Promise.allSettled(tasks);
  return res.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}
