const UA = { 'User-Agent': 'LumenCut/1.0 (personal tool)' };
const stripTags = value => String(value || '').replace(/<[^>]*>/g, '');

export async function search(query) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `filetype:bitmap|video ${query}`,
    gsrnamespace: '6', gsrlimit: '20', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1920', format: 'json', origin: '*'
  });
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Object.values(data.query?.pages || []).map(page => {
    const info = page.imageinfo?.[0] || {};
    const mime = info.mime || '';
    const meta = info.extmetadata || {};
    const title = meta.ObjectName?.value || page.title || '';
    const isVideo = /^video\/(webm|ogg|mp4)/.test(mime);
    return { source: 'wikimedia', kind: isVideo ? 'video' : 'image', url: info.url, thumbUrl: info.thumburl || info.url, width: info.width || 0, height: info.height || 0, durationSec: Number(meta.Duration?.value || 0) || null, title, description: stripTags(meta.ImageDescription?.value), author: stripTags(meta.Artist?.value), credit: stripTags(meta.Credit?.value), license: meta.LicenseShortName?.value || '', pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}` };
  }).filter(x => x.url && x.width >= 1000 && x.height <= x.width);
}
